// Compare the opt-in multi-material guide with independent physical-box enumeration and real holdings.
const {assert,boot,clone,v12,valid,go,finish,extract,stamp}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
function plan(g){
  const inputs=g.facilitySearchInputs(g.objective(),g.objectiveCartView());
  return inputs?g.facilitySearchPlan(inputs):null;
}
const pin=(g,id,tier=1)=>assert.ok(g.pin({kind:'facility',id,tier}));
function setup(id){
  const s=clone(boot().g.s);
  s.hideout.levels.power=1;
  if(id==='med')s.hideout.levels.water=1;
  // Starting materials are an explicit fixture. Finish the real prerequisite construction.
  if(id==='repair')s.stash={...db.hideout.facilities.workshop.levels[0].materials};
  const b=boot({[v12]:s});
  if(id==='repair'){
    b.g.build({hideout:'build',id:'workshop',tier:'1'});
    assert.equal(b.g.s.wallet,10000);const end=b.g.s.hideout.builds.workshop.end;
    stamp(b,end+1);assert.equal(b.g.s.hideout.levels.workshop,1);
  }
  pin(b.g,id);return b;
}
{
  const b=setup('repair'),g=b.g;
  b.click({page:'map'});assert.match(b.content(),/data-facility-search="repair"/);
  assert.doesNotMatch(b.content(),/data-material-site="/,'do not evaluate or render forecasts on a collapsed guide');
  const before=JSON.stringify(g.s),forecast=plan(g),best=forecast.sites[0];
  assert.deepEqual(clone(forecast.sites.map(s=>s.zone)),[0,1,2]);
  assert.equal(best.landmark,6);assert.equal(best.expected,0.5223212506553452);
  assert.equal(best.items.find(i=>i.id==='lube').quantity,2);
  for(const site of forecast.sites){
    assert.equal(site.expected,site.items.reduce((n,i)=>n+i.chance,0));
    for(const {id,chance} of site.items){
      const tables=g.places[site.zone][site.landmark].boxes.map(index=>g.areas[site.zone].boxes[index][2]);
      const miss=tables.reduce((n,table)=>n*(1-g.huntCalculateOdds(db.containers[table],id).whole),1);
      assert.equal(chance,1-miss);
    }
  }
  assert.match(g.facilitySearchMarkup(forecast),/윤활유 2개 부족 · 19.17% · 현재 CR 구매 불가/);
  assert.equal(JSON.stringify(g.s),before);
  assert.ok(g.marketCartAdd('repair','driver',1).ok);
  assert.ok(plan(g).sites[0].items.some(i=>i.id==='driver'),'unpaid cart is not a physical holding');
  // The guide cannot consume an RNG draw or change a spawn. A seeded roll is reserved for the real toolbox.
  b.setRandom(.3757);plan(g);g.start();assert.equal(g.s.raid.zone,0);
  go(b,'landmark',{index:6});go(b,'scan');finish(b);
  const index=g.places[0][6].boxes[0];
  go(b,'open',{index});go(b,'search');finish(b);
  const item=g.s.field.boxes['0-'+index].items[0];assert.equal(item.g,'driver');
  g.selectLoot(item.uid);assert.ok(g.s.field.bag.some(u=>u.g==='driver'));
  b.click({page:'map'});assert.doesNotMatch(b.content(),/data-facility-search/);
  extract(b);assert.equal(plan(g),null);g.ack();
  assert.equal(g.stock('driver'),1);
  assert.equal(plan(g).sites[0].zone,1,'a real recovered driver changes the top site to the road depot');
  g.gear({gear:'pack',id:'driver'});assert.equal(g.stock('driver'),0);
  assert.ok(g.s.equipment.bag.some(u=>u.g==='driver'));
  assert.ok(plan(g).sites.every(site=>site.items.every(i=>i.id!=='driver')));
  const again=boot(b.storage,b.clock).g;
  assert.deepEqual(clone(plan(again)),clone(plan(g)));valid(again);
}
{
  const {g}=setup('med'),key='rl_16_19';
  const canReach=()=>Boolean(plan(g).sites.find(s=>s.zone===1&&s.landmark===1));
  assert.ok(!canReach());assert.ok(plan(g).excluded.some(b=>b.name==='응급 케이스'&&b.key==='검역실 열쇠'));
  assert.ok(g.trade('medic','buy',key,1).ok);assert.ok(!canReach());
  g.gear({gear:'pack',id:key});assert.ok(canReach());
  const packed=g.s.equipment.bag.find(u=>u.g===key);
  g.gear({gear:'wear-bag',unit:packed.uid});assert.ok(canReach());
  assert.ok(plan(g).sites.some(s=>s.boxes.some(row=>row.key==='검역실 열쇠')));
  g.gear({gear:'unwear',slot:'access'});assert.ok(!canReach());valid(g);
}
{
  // Unusable loose stock, case contents, and parts still fitted to a stored radio are real holdings.
  const b=setup('comms'),s=clone(b.g.s);s.stash={radio:1,cable:1};
  s.stashSlots=[{uid:'s-comms-radio',g:'radio',x:0,y:0,w:2,h:1,
    gear:{uid:'s-comms-equipped-antenna',g:'radio',durability:87,ammo:0,module:'rl_13_02'}}];
  const c=boot({[v12]:s});valid(c.g);assert.equal(plan(c.g),null,'one remaining cable is not a multi-item hunt');
  const {g}=setup('repair'),s2=clone(g.s);
  const toolCase=Object.keys(g.cases).find(id=>g.caseAllowed(id,'wrench')&&g.caseAllowed(id,'driver'));
  assert.ok(toolCase);
  const [w,h]=g.goods[toolCase].slice(1,3);
  const units=['wrench','driver'].map((id,i)=>({uid:'s-contained-'+id,g:id,x:0,y:i*2,w:g.goods[id][1],h:g.goods[id][2],revealed:true}));
  s2.stash={[toolCase]:1};s2.stashSlots=[{uid:'s-advice-case',g:toolCase,x:0,y:0,w,h,contents:units}];
  const c2=boot({[v12]:s2});valid(c2.g);assert.equal(plan(c2.g),null);
}
{
  const b=setup('repair'),s=clone(b.g.s);
  for(const tier of [2,3]){
    s.contracts.repair.done=b.g.quests.filter(q=>q.trader==='repair'&&q.tier<tier).map(q=>q.id);
    const g=boot({[v12]:s}).g;assert.equal(g.standing('repair').tier,tier);
    if(tier===2){
      const items=plan(g).sites[0].items;
      assert.equal(items.find(i=>i.id==='wrench').blocked,false);assert.equal(items.find(i=>i.id==='lube').blocked,true);
    }else assert.equal(plan(g),null,'all target items can be bought now');
  }
  const o=b.g.objective(),q=b.g.objectiveCartView();
  const craftOnly={...o,materials:[{id:'rl_craft_dressing',required:2,owned:0},o.materials[0]]};
  assert.equal(b.g.facilitySearchInputs(craftOnly,q),null);
  assert.ok(b.g.pin(null));b.click({page:'map'});assert.doesNotMatch(b.content(),/data-facility-search/);
}
console.log('PASS multi-material ranking and probabilities, real repair prerequisite and recovered driver, held/key/standing transitions, no live raid or single/craft-only candidates');
