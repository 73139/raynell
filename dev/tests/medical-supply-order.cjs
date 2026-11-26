const {assert,boot,clone,extract,finish,go,move,stamp,valid}=require('./game-fixture.cjs');

const order='med-supply';
const sites=[{zone:0,landmark:7},{zone:1,landmark:1}];
function deploy(zone,roll=.1){
  const b=boot(),g=b.g;
  g.order(order);
  assert.ok(g.pin({kind:'order',id:order}));
  assert.deepEqual(clone(g.objective().locations),sites);
  if(zone===1){
    assert.ok(g.trade('medic','buy','rl_16_19',1).ok);
    g.gear({gear:'wear-stash',id:'rl_16_19'});
  }
  g.moveNow(zone);
  b.setRandom(roll);
  g.start();
  return b;
}
function collect(b,site,ordinal=0){
  const g=b.g, f=g.s.field, box=g.places[site.zone][site.landmark].boxes[ordinal];
  go(b,'landmark',{index:site.landmark});
  assert.ok(g.readField().includes('data-order-container'));
  while(!f.found[site.zone].includes(box)){
    go(b,'scan');
    finish(b);
  }
  if(g.lootBoxIsLocked(site.zone,box)){
    assert.match(g.readField(),/검역실 열쇠 필요/);
    assert.ok(g.unlockLootBox(g.s.raid.startedAt,site.zone,box).ok);
  }else go(b,'open',{index:box});
  assert.doesNotMatch(b.content(),/의뢰 회수품/);
  go(b,'search');
  while(f.action)finish(b);
  const unit=f.boxes[site.zone+'-'+box].items.find(u=>u.g==='bandage');
  assert.ok(unit,'natural container roll must yield the test bandage');
  b.click({pick:unit.uid,side:'loot'});
  assert.equal(b.content().includes('data-objective-item="bandage"'),ordinal===0);
  b.click({field:'take'});
  go(b,'close');
  return unit.uid;
}
function leave(b){
  if(b.g.s.raid.zone!==0)move(b,0);
  stamp(b,b.g.s.raid.startedAt+7*60000);
  extract(b);
}
function unpaid(b){
  assert.equal(b.g.s.lastSummary.commission,0);
  assert.equal(b.g.s.lastSummary.missionXp,0);
  assert.equal(b.g.s.career.order,order);
  assert.ok(!b.g.s.career.done.includes(order));
  valid(b.g);
}
async function routesAndPayment(){
  for(const site of sites){
    const b=deploy(site.zone),g=b.g;
    const uid=collect(b,site);
    assert.equal(g.objective().goals[0].projected,1);
    assert.deepEqual(clone(g.objective().locations),[]);
    assert.doesNotMatch(g.readField(),/data-order-container/);
    g.gear({gear:'drop',unit:uid});
    assert.deepEqual(clone(g.objective().locations),[{zone:site.zone}]);
    assert.match(g.readField(),/data-order-container/);
    g.gear({gear:'recover',unit:uid});
    const imported=boot({},b.clock);
    await imported.g.importFile(new Blob([JSON.stringify(await b.exportData())]));
    assert.equal(imported.g.objective().goals[0].projected,1);
    const expectedStock=imported.g.stock('bandage')+imported.g.s.field.bag.filter(u=>u.g==='bandage').length;
    const wallet=imported.g.s.wallet,xp=imported.g.s.career.xp;
    leave(imported);
    const paid=imported.g.s;
    assert.equal(paid.lastSummary.commission,28000);
    assert.equal(paid.lastSummary.missionXp,100);
    assert.equal(paid.lastSummary.completedObjectiveOrder,order);
    assert.equal(paid.wallet,wallet+28000);
    assert.equal(paid.career.xp,xp+paid.lastSummary.earned+100);
    assert.equal(imported.g.stock('bandage'),expectedStock);
    assert.deepEqual(clone(paid.career.done),[order]);
    const again=boot(imported.storage,imported.clock);
    again.g.tick();again.g.ack();again.g.order(order);
    assert.equal(again.g.s.wallet,paid.wallet);
    assert.equal(again.g.s.career.xp,paid.career.xp);
    assert.equal(again.g.s.career.order,null);
    valid(again.g);
  }
}
function wrongOrigins(){
  const b=deploy(0,.35);
  collect(b,sites[0],1); // A real bandage from the home-visit bag beside the correct case.
  assert.equal(b.g.objective().goals[0].projected,undefined);
  leave(b);unpaid(b);
  b.g.ack();b.g.gear({gear:'pack',id:'bandage'});b.clock.now++;b.g.start();
  assert.ok(b.g.s.field.bag.some(u=>u.g==='bandage'));
  assert.equal(b.g.objective().goals[0].projected,undefined);
  leave(b);unpaid(b);

  const road=deploy(0);
  road.setRolls([.8,.65]);
  go(road,'move',{index:1});finish(road);
  assert.equal(road.g.s.field.journey.supply,'bandage');
  go(road,'journey-take');
  assert.equal(road.g.objective().goals[0].projected,undefined);
  leave(road);unpaid(road);
}
function competingSettlements(){
  const first=deploy(0);
  collect(first,sites[0]);
  stamp(first,first.g.s.raid.startedAt+7*60000);
  go(first,'extract',{exit:'b04'});
  const end=first.g.s.field.action.end;
  const second=boot(first.storage,{now:first.clock.now});
  stamp(second,end);stamp(first,end);
  for(const tab of [first,second,boot(first.storage,first.clock)]){
    assert.deepEqual(clone(tab.g.s.career.done),[order]);
    assert.equal(tab.g.s.career.sorties,1);
    assert.equal(tab.g.s.wallet,58000);
    assert.equal(tab.g.s.career.xp,tab.g.s.lastSummary.earned+100);
    valid(tab.g);
  }
}
function failedReturns(){
  const consumed=deploy(0),uid=collect(consumed,sites[0]);
  consumed.g.s.field.hp=50;
  consumed.g.gear({gear:'consume',unit:uid});
  assert.ok(!consumed.g.s.field.bag.some(u=>u.uid===uid));
  assert.equal(consumed.g.objective().goals[0].projected,undefined);
  leave(consumed);unpaid(consumed);
  const fast=deploy(0);
  collect(fast,sites[0]);extract(fast);
  assert.equal(fast.g.s.lastSummary.rating,'quick');unpaid(fast);
  const expired=deploy(1);
  collect(expired,sites[1]);stamp(expired,expired.g.s.raid.endsAt);
  assert.equal(expired.g.s.lastSummary.rating,'expired');unpaid(expired);
}
(async()=>{
  await routesAndPayment();
  competingSettlements();
  wrongOrigins();
  failedReturns();
  console.log('PASS two medical routes, medical box provenance, hint lifecycle, retained bandage, export/import and concurrent single award, wrong sibling, brought-in and roadside bandages, consumed bandage, early and expired returns.');
})().catch(error=>{console.error(error);process.exitCode=1;});
