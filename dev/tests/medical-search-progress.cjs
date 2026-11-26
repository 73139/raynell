const {assert,boot,clone,finish,go,move,valid}=require('./game-fixture.cjs');
const order='med-supply',sites=[{zone:0,landmark:7},{zone:1,landmark:1}];

function start(roll){
  const b=boot(),g=b.g;
  assert.ok(g.trade('medic','buy','rl_16_19',1).ok);
  g.gear({gear:'wear-stash',id:'rl_16_19'});
  g.order(order);
  assert.ok(g.pin({kind:'order',id:order}));
  b.setRandom(roll);
  g.start();
  return b;
}
function open(b,site){
  const g=b.g, index=g.places[site.zone][site.landmark].boxes[0];
  if(g.s.raid.zone!==site.zone)move(b,site.zone);
  go(b,'landmark',{index:site.landmark});
  go(b,'scan');finish(b);
  if(g.lootBoxIsLocked(site.zone,index))assert.ok(g.unlockLootBox(g.s.raid.startedAt,site.zone,index).ok);
  else go(b,'open',{index});
  assert.equal(g.s.field.open,site.zone+'-'+index);
  return g.s.field.boxes[g.s.field.open];
}
function search(b){
  go(b,'search');
  while(b.g.s.field.action)finish(b);
}
function known(b){
  const model=b.g.objective();
  return [clone(model.search),clone(model.locations)];
}
function assertState(b,site,state){
  const row=b.g.objective().search.sites.find(s=>s.zone===site.zone);
  assert.equal(row.state,state);
  assert.ok(b.g.readField().includes('data-recovery-site="'+site.zone+'-'+site.landmark+'" data-recovery-state="'+state+'"'));
}
function noSeedLeak(){
  // With fixed rolls the shipping table really generates an empty box, one bandage or one other item.
  const outcomes=[.01,.1,.2].map(roll=>{
    const b=start(roll),base=known(b),box=open(b,sites[0]);
    const sealed=known(b),persisted=clone(b.g.s);
    assert.deepEqual(sealed,base);
    for(let i=0;i<3;i++){assert.deepEqual(known(b),sealed);b.g.readField();}
    assert.deepEqual(clone(b.g.s),persisted);
    assertState(b,sites[0],'unsearched');
    return {base,sealed,contents:box.items.map(o=>o.g).join(',')};
  });
  assert.equal(new Set(outcomes.map(o=>o.contents)).size,3);
  for(const o of outcomes)assert.deepEqual(o.sealed,outcomes[0].sealed);
  const b=start(.5),box=open(b,sites[0]);
  assert.ok(box.items.length>=2);
  go(b,'search',{uid:box.items[0].uid});assertState(b,sites[0],'searching');
  finish(b);assertState(b,sites[0],'partial');
  assert.doesNotMatch(b.g.readField(),/data-recovery-advice=/);
}
function missedBoth(){
  const b=start(.2);
  open(b,sites[0]);search(b);
  assertState(b,sites[0],'empty');
  assert.deepEqual(clone(b.g.objective().locations),[sites[1]]);
  assert.match(b.g.readField(),/data-recovery-advice="alternate"[^>]*>[^<]*검역 천막[^<]*응급 케이스[^<]*검역실 열쇠/);
  go(b,'close');open(b,sites[1]);search(b);
  assertState(b,sites[1],'empty');
  assert.deepEqual(clone(b.g.objective().locations),[]);
  assert.match(b.g.readField(),/data-recovery-advice="retry"/);
  const reload=boot(b.storage,b.clock);
  assert.deepEqual(known(reload),known(b));
  valid(reload.g);
}
function groundInThirdRegion(){
  const b=start(.1),g=b.g,first=open(b,sites[0]);search(b);
  assertState(b,sites[0],'available');
  assert.match(g.readField(),/data-recovery-advice="collect"/);
  const uid=first.items[0].uid;
  g.selectLoot(uid);go(b,'close');
  assert.equal(g.objective().search,null);
  move(b,2);
  g.gear({gear:'drop',unit:uid});
  assert.deepEqual(clone(g.objective().locations),[{zone:2}]);
  assert.match(g.readField(),/data-recovery-advice="ground"[^>]*>군수 보급 창고/);
  const second=open(b,sites[1]);search(b);
  assertState(b,sites[1],'available');
  const otherUid=second.items[0].uid;
  g.selectLoot(otherUid);go(b,'close');
  g.s.field.hp=40;
  g.gear({gear:'consume',unit:otherUid});
  assert.match(g.readField(),/data-recovery-advice="ground"[^>]*>군수 보급 창고/);
  assert.doesNotMatch(g.readField(),/data-recovery-advice="retry"/);
  assertState(b,sites[0],'empty');assertState(b,sites[1],'empty');
  const reloaded=boot(b.storage,b.clock),r=reloaded.g;
  assert.deepEqual(known(reloaded),known(b));
  move(reloaded,2);r.gear({gear:'recover',unit:uid});
  assert.equal(r.objective().search,null);
  r.gear({gear:'consume',unit:uid});
  assert.match(r.readField(),/data-recovery-advice="retry"/);
  valid(r);
}
noSeedLeak();missedBoth();groundInThirdRegion();
console.log('PASS recovery search knowledge, sealed/empty/partial, alternate site and key, second miss, dropped specimen in third region, consumed samples, reload and no model writes.');
