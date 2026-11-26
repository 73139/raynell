// Exercise the packed game's warehouse, equipped operator, NPC and market transactions.
const {setTestCash,assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const med='rs_case_med', food='rs_case_food', junk='rs_case_junk';
const base=boot();
// External size and internal size are independent; the grid orientation is part of each case.
const dimensions={
  med:[3,3,7,7], food:[3,3,8,8], junk:[4,4,14,14],
  weapon:[5,2,5,10], weapon_large:[5,2,6,15], pistol:[2,2,4,3], ammo:[2,2,7,7],
  docs:[1,2,4,4], keys:[1,1,4,4], items:[4,4,8,8], injector:[1,1,3,3], cards:[1,1,3,3]
};
function seedCaseInventory(){
  const profile=clone(base.g.s);
  setTestCash(profile,2000000);
  profile.stash={[med]:2,[food]:1,[junk]:1};
  profile.stashSlots=[];
  const packed=boot({[v12]:profile});
  packed.click({page:'inventory'});packed.click({loadout:'sort'});
  profile.stashSlots=clone(packed.g.s.stashSlots);
  assert.equal(profile.stashSlots.length,4,'the normal warehouse must physically place the four seed cases');
  const names={[med]:['s-med-first','s-med-second'],[food]:['s-food'],[junk]:['s-junk']};
  for(const slot of profile.stashSlots)slot.uid=names[slot.g].shift();
  Object.assign(profile.stash,{bandage:51,medkit:2,food:65,water:3,cloth:197,matches:1,nut:2,fan:1,diamond:1});
  return profile;
}
const box=(g,uid)=>g.s.stashSlots.find(u=>u.uid===uid);
const inside=(g,uid)=>box(g,uid)?.contents||[];
const move=(g,uid,action,id)=>g.caseMove(uid,action,id).ok;
function checkGeometry(box,cols,rows){
  const cells=new Set(), ids=new Set();
  for(const unit of box.contents??[]){
    assert.ok(!ids.has(unit.uid));
    ids.add(unit.uid);
    assert.ok(unit.x>=0&&unit.y>=0&&unit.x+unit.w<=cols&&unit.y+unit.h<=rows);
    for(let y=unit.y;y<unit.y+unit.h;y++)for(let x=unit.x;x<unit.x+unit.w;x++){
      const key=x+','+y;
      assert.ok(!cells.has(key),'internal tiles must be disjoint');
      cells.add(key);
    }
  }
  return cells.size;
}

async function verify(){
  const {g:basis}=base;
  assert.equal(Object.keys(basis.cases).length,12);
  const ammo=Object.keys(basis.goods).find(id=>basis.goods[id][5]==='탄약');
  assert.ok(ammo);
  const examples={
    med:[['bandage','medkit'],['water','diamond']], food:[['food','tea','water'],['cloth','bandage']],
    junk:[['cloth','nut','wire','wrench','fuel'],['water','matches','tiger']],
    weapon:[['rl10_carbine','rl12_sidearm','optic',ammo],['medkit','fuel']],
    weapon_large:[['rl10_carbine','rl_05_15','optic',ammo],['food','tiger']],
    pistol:[['rl12_sidearm',ammo],['rl10_carbine','optic']], ammo:[[ammo],['rl12_sidearm','nut']],
    docs:[['key','keycard','ssd','rl_04_06'],['water','medkit']], keys:[['key'],['keycard','rl_16_21','ssd']],
    cards:[['keycard','rl_16_21'],['key','medkit']], injector:[['rl_11_29'],['bandage','medkit']],
    items:[['diamond','tiger','water','rl12_helmet'],[]]
  };
  for(const [kind,[w,h,cols,rows]] of Object.entries(dimensions)){
    const id='rs_case_'+kind;
    assert.deepEqual(clone(basis.goods[id].slice(1,3)),[w,h]);
    assert.deepEqual(clone(basis.cases[id].size),[cols,rows]);
    const [accepted,rejected]=examples[kind];
    for(const item of accepted)assert.equal(basis.caseAllowed(id,item),true,id+' accepts '+item);
    for(const item of [...rejected,'unknown',...Object.keys(basis.cases)])assert.equal(basis.caseAllowed(id,item),false,id+' rejects '+item);
  }
  // A player with all four merchants promoted can buy and use every case via the product's own transactions.
  const customer=clone(basis.s);
  setTestCash(customer,50000000);
  customer.stash={};customer.stashSlots=[];
  for(const trader of basis.traders){
    customer.contracts[trader.id].done=basis.quests.filter(q=>q.trader===trader.id&&q.tier<4)
      .sort((a,b)=>a.tier-b.tier).map(q=>q.id);
  }
  for(const [accepted] of Object.values(examples))customer.stash[accepted[0]]=1;
  const counter=boot({[v12]:customer}).g;
  for(const [kind,[accepted]] of Object.entries(examples)){
    const id='rs_case_'+kind, seller=counter.traders.find(t=>counter.listed(t.id,'buy').includes(id));
    assert.ok(seller,id+' must have a retailer');
    assert.ok(counter.trade(seller.id,'buy',id,1).ok);
    const acquired=counter.s.stashSlots.find(s=>s.g===id);
    assert.ok(acquired,'paid case occupies its external footprint');
    assert.ok(move(counter,acquired.uid,'put',accepted[0]));
    const contents=inside(counter,acquired.uid);
    assert.equal(contents.length,1);
    assert.equal(contents[0].g,accepted[0]);
    assert.ok(move(counter,acquired.uid,'take',contents[0].uid));
  }
  valid(counter);
  const baseState=seedCaseInventory();
  const b=boot({[v12]:baseState}),{g,click}=b;
  const one='s-med-first',two='s-med-second';
  click({page:'stash'});click({stash:'select',uid:one,id:med});
  assert.match(b.content(),/보관함 열기/);
  click({stash:'case-open',box:one});
  assert.match(b.content(),/보관함 내부 7열 7행/);
  assert.ok(b.content().includes('data-id="bandage" aria-label="구급 붕대 1개 넣기'));
  assert.ok(!b.content().includes('data-stash="case-put" data-box="'+one+'" data-id="diamond"'));
  click({stash:'case-put',box:two,id:'medkit'}); // stale button from another box
  assert.equal(inside(g,two).length,0);
  click({stash:'case-put',box:one,id:'medkit'});
  assert.equal(g.stock('medkit'),1);
  const kit=clone(inside(g,one)[0]);
  assert.equal(kit.g,'medkit');
  assert.ok(b.content().includes('aria-label="치료 키트 꺼내기"'));
  click({stash:'case-take',box:one,unit:kit.uid});
  click({stash:'case-take',box:one,unit:kit.uid});
  assert.equal(g.stock('medkit'),2);
  assert.equal(inside(g,one).length,0);
  click({stash:'case-close',box:one});
  assert.doesNotMatch(b.content(),/class="sc-grid"/);
  click({stash:'case-put',box:one,id:'bandage'});
  assert.equal(inside(g,one).length,0);
  assert.equal(move(g,one,'put','diamond'),false);
  assert.equal(move(g,one,'put','medkit'),true);
  for(let n=0;n<45;n++)assert.equal(move(g,one,'put','bandage'),true);
  assert.equal(checkGeometry(box(g,one),7,7),49);
  assert.equal(move(g,one,'put','bandage'),false,'full case cannot consume a loose item');
  assert.equal(g.stock('bandage'),6);
  assert.equal(inside(g,two).length,0);
  assert.equal(move(g,two,'take',inside(g,one)[0].uid),false);
  // Fill the two largest provision and salvage grids without dropping the surplus item.
  const filled=boot({[v12]:baseState}).g;
  for(const [uid,item,side] of [['s-food','food',8],['s-junk','cloth',14]]){
    for(let n=0;n<side*side;n++)assert.ok(move(filled,uid,'put',item));
    assert.equal(checkGeometry(box(filled,uid),side,side),side*side);
    assert.equal(move(filled,uid,'put',item),false);
    assert.equal(filled.stock(item),1);
    const last=inside(filled,uid).find(tile=>tile.x===side-1&&tile.y===side-1);
    assert.ok(last);
    assert.ok(move(filled,uid,'take',last.uid));
    assert.equal(move(filled,uid,'take',last.uid),false);
    assert.equal(filled.stock(item),2);
  }
  valid(filled);
  const firstContents=clone(inside(g,one));
  click({page:'inventory'});click({loadout:'sort'});
  assert.deepEqual(clone(inside(g,one)),firstContents,'sorting keeps box identity and contents');
  valid(g);
  const again=boot(new Map(b.storage));
  assert.deepEqual(clone(inside(again.g,one)),firstContents);
  const backup=await b.exportData(), imported=boot();
  await imported.g.importFile(new Blob([JSON.stringify(backup)]));
  assert.deepEqual(clone(inside(imported.g,one)),firstContents);
  for(const mutate of [
    map=>{map[0].x=100}, map=>{map[1].uid=map[0].uid},
    map=>{map[1].x=map[0].x;map[1].y=map[0].y},
    map=>{map[0].g='diamond'}
  ]){
    const broken=clone(backup);
    mutate(broken.session.stashSlots.find(s=>s.uid===one).contents);
    assert.equal(g.check(broken),false);
  }

  // Selecting this filled physical box never sells its empty twin.
  const beforeSale=g.fee;
  g.sell(med,one);
  assert.equal(g.stock(med),2);
  assert.equal(g.fee,beforeSale);
  assert.ok(g.trade('medic','sell',med,1).ok,'generic sale may use the empty twin');
  assert.equal(g.stock(med),1);
  assert.deepEqual(clone(inside(g,one)),firstContents);
  assert.equal(g.trade('medic','sell',med,1).ok,false);
  assert.ok(box(g,one));
  assert.equal(box(g,two),undefined);

  const rollback=boot(new Map(b.storage));
  const beforeFailed=clone(rollback.g.s);
  rollback.storage.set=()=>{throw Error('simulated full warehouse storage')};
  assert.equal(move(rollback.g,'s-food','put','water'),false);
  assert.deepEqual(clone(rollback.g.s),beforeFailed);
  assert.equal(move(rollback.g,one,'take',firstContents[0].uid),false);
  assert.deepEqual(clone(rollback.g.s),beforeFailed);
  const shared=boot({[v12]:baseState}), stale=boot(shared.storage);
  assert.equal(move(stale.g,one,'put','bandage'),true);
  assert.equal(move(shared.g,one,'put','bandage'),false);
  assert.deepEqual(clone(shared.g.s),clone(stale.g.s));
  const readonly=boot(new Map(b.storage),b.clock,{locks:{request(){return new Promise(()=>{})}}});
  assert.equal(readonly.g.w,false);
  assert.equal(move(readonly.g,one,'take',firstContents[0].uid),false);
  const raid=boot(new Map(b.storage));
  raid.g.start();
  assert.ok(raid.g.s.raid);
  assert.equal(move(raid.g,'s-food','put','water'),false);
  assert.equal(move(raid.g,one,'take',firstContents[0].uid),false);

  // Two required nuts span one loose unit and the other unit inside a junk box.
  const npc=seedCaseInventory(),qid='repair-fan-mount';
  npc.contracts.repair.done=basis.quests.filter(q=>q.trader==='repair'&&q.tier===1).map(q=>q.id);
  const delivery=boot({[v12]:npc}).g;
  assert.ok(move(delivery,'s-junk','put','nut'));
  assert.equal(delivery.stock('nut'),1);
  assert.ok(delivery.contract(qid,'accept').ok);
  assert.equal(delivery.status(qid).status,'ready');
  assert.ok(delivery.contract(qid,'claim').ok);
  assert.equal(delivery.stock('nut'),0);
  assert.equal(inside(delivery,'s-junk').length,0);
  assert.equal(delivery.stock(junk),1);
  assert.equal(delivery.contract(qid,'claim').ok,false);
  valid(delivery);
}
verify().then(()=>console.log('PASS: 12 case footprints and category rules, 49/64/196-cell capacity, visible buttons, internal fit/overflow, protected sale, sorting, reload/backup/import validation, shared/failed storage, raid locks, and NPC delivery from mixed sources.')).catch(e=>{console.error(e);process.exitCode=1});
