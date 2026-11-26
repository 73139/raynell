// Generate a real progression checkpoint from an empty 30,000 CR profile. Only field RNG/time are controlled.
const {assert,boot,clone,finish,go,move,extract,valid}=require('./game-fixture.cjs');
const fs=require('node:fs');
const db=require('../Rustline_Database_v10.json'),fabric='rl_x_fabric',recipe='rl_x_ammo';
function success(result){assert.ok(result.ok,result.reason||result.message);}
function takeFromBus(b,item){
  const g=b.g,table=db.containers.bag,[w,h]=table.size;
  const pool=table.itemDistribution.filter(({tpl})=>{const i=db.items[tpl];return i.width<=w&&i.height<=h||i.width<=h&&i.height<=w;});
  const weight=rows=>rows.reduce((n,r)=>n+r.relativeProbability,0),i=pool.findIndex(r=>r.tpl===item);
  assert.ok(i>=0); const roll=(weight(pool.slice(0,i))+pool[i].relativeProbability/2)/weight(pool);
  b.setRandom(roll);g.moveNow(0);g.start();b.setRandom(.1);
  if(item===fabric){
    assert.ok(g.s.field.boxes['0-2'].items.some(unit=>unit.g===fabric&&!unit.revealed));
    assert.equal(g.huntMaterialCases('quarter',recipe,fabric).length,0);assert.equal(g.barterHuntView().carried,0);
  }
  go(b,'landmark',{index:1});const box=clearBox(b,2);
  const unit=box.items.find(u=>u.g===item&&u.revealed);assert.ok(unit,item);
  g.selectLoot(unit.uid);go(b,'close');extract(b);g.ack();
  assert.ok(g.s.stashSlots.some(u=>u.g===item));
}
function clearBox(b,index){
  const g=b.g,z=g.s.raid.zone,key=z+'-'+index;
  while(!g.s.field.found[z].includes(index)){go(b,'scan');finish(b);}
  go(b,'open',{index});assert.equal(g.s.field.open,key);
  go(b,'search');while(g.s.field.action)finish(b);
  const box=g.s.field.boxes[key];assert.ok(box.complete,key);return box;
}
function freshCases(){
  const b=boot(),g=b.g;assert.equal(g.fee,30000);assert.equal(g.s.stashSlots.length,0);
  success(g.pinBarterHunt('quarter',recipe,fabric));
  assert.equal(g.huntMaterialCases('quarter',recipe,fabric).length,0);
  takeFromBus(b,'gpu');
  const uid=g.s.stashSlots.find(u=>u.g==='gpu').uid;
  const sale=g.saleQuote('repair',[uid]);success(g.saleCommit('repair',[uid],sale.token));
  assert.equal(sale.total,210000);
  for(const quest of g.quests.filter(q=>q.trader==='repair'&&q.tier<=2)){
    success(g.contract(quest.id,'accept'));
    for(const goal of quest.goals.filter(k=>k.type==='delivery')){
      success(g.trade('repair','buy',goal.item,goal.target));
    }
    const search=quest.goals.find(k=>k.type==='searches');
    if(search||quest.goals.some(k=>k.type==='returns')){
      const z=search?.zone??0;
      b.setRandom(.001);g.moveNow(z);g.start();b.setRandom(.1);
      if(search){
        go(b,'landmark',{index:search.landmark});const boxes=g.places[z][search.landmark].boxes;
        for(const idx of boxes.slice(0,search.target)){clearBox(b,idx);go(b,'close');}
      }
      if(z!==0)move(b,0);
      extract(b);g.ack();
    }
    success(g.contract(quest.id,'claim'));
  }
  assert.equal(g.standing('repair').tier,3);success(g.trade('repair','buy','rs_case_junk',2));
  success(g.trade('supply','buy','cloth',3));takeFromBus(b,fabric);
  valid(g);return b;
}

async function run(){
  const b=freshCases(),g=b.g;
  if(process.env.RUSTLINE_CASE_CHECKPOINT)fs.writeFileSync(process.env.RUSTLINE_CASE_CHECKPOINT,JSON.stringify(await b.exportData()));
  const [a,other]=g.s.stashSlots.filter(u=>u.g==='rs_case_junk').map(u=>u.uid);
  const cases=item=>clone(g.huntMaterialCases('quarter',recipe,item)),oldMap=JSON.stringify(g.huntRegions(fabric));
  success(g.renameCase(a,'상자 <하나>'));success(g.renameCase(other,'둘 & 예비'));
  for(const [box,id] of [[a,'cloth'],[a,'cloth'],[other,'cloth'],[other,fabric]])success(g.caseMove(box,'put',id));
  assert.equal(g.barterHuntView().owned,0);assert.equal(g.barterHuntView().missing,1);assert.equal(g.barterHuntView().carried,0);
  const stacks=cases('cloth'),material=cases(fabric)[0];
  assert.equal(stacks.length,2);assert.deepEqual(stacks.map(r=>r.quantity),[2,1]);assert.equal(material.caseUid,other);assert.equal(material.name,'둘 & 예비');
  assert.equal(g.locateOwned(material.key).id,fabric);
  assert.equal(g.huntMaterialCases('quarter','rl_x_carbine','rl_x_core').length,0);
  assert.equal(JSON.stringify(g.huntRegions(fabric)),oldMap);
  const before=clone(g.s);const kit=g.barterOffers('quarter').find(r=>r.id===recipe);
  assert.ok(!g.barterCommit('quarter',recipe,kit.token).ok);
  assert.deepEqual(clone(g.s),before);
  const fresh=boot();await fresh.g.importFile(new Blob([JSON.stringify(await b.exportData())]));valid(fresh.g);
  assert.deepEqual(clone(fresh.g.huntMaterialCases('quarter',recipe,fabric)),[material]);
  const cash=g.fee,otherStock=clone(g.s.stashSlots.find(u=>u.uid===other).contents.filter(u=>u.g==='cloth'));
  const second=boot(b.storage,b.clock);const bound=second.g.locateOwned(material.key);
  success(second.g.caseMove(bound.caseUid,'take',bound.uid));
  // An old, previously visible locate button cannot open or withdraw the old item after the winning save.
  b.click({page:'barterhunt'});
  g.handleHuntCase({bh:'case',trader:'quarter',recipe,item:fabric,key:material.key,caseUid:material.caseUid});
  assert.equal(cases(fabric).length,0);assert.equal(g.barterHuntView().owned,1);assert.equal(g.barterHuntView().missing,0);
  assert.equal(g.locateOwned(material.key),null);assert.equal(g.fee,cash);
  assert.deepEqual(clone(g.s.stashSlots.find(u=>u.uid===other).contents),otherStock);
  assert.ok(!g.caseMove(bound.caseUid,'take',bound.uid).ok);
  for(let n=0;n<2;n++){
    const entry=cases('cloth').find(row=>row.caseUid===a);const row=g.locateOwned(entry.key);
    success(g.caseMove(row.caseUid,'take',row.uid));
  }
  const final=g.barterOffers('quarter').find(r=>r.id===recipe);success(g.barterCommit('quarter',recipe,final.token));
  assert.equal(g.stock(recipe),1);assert.equal(g.fee,cash);assert.equal(g.stock('cloth'),0);
  assert.deepEqual(clone(g.s.stashSlots.find(u=>u.uid===other).contents),otherStock);
  valid(g);
  console.log('PASS from empty: field GPU sold for 210,000 CR, nine actual repair contracts to standing III, two 95,000 CR junk cases purchased, three cloth bought and sealed patch extracted from a generated bus bag. No stock/rank/cash injections.');
  console.log('PASS eligible recipe only, names and exact case/content UIDs, independent 2+1 stack counts, unopened field privacy, unchanged map/loose shortages, restore, stale-tab withdrawal invalidation, physical debit, one original barter award and preserved other-case units/cash.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
