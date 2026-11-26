// Exercise shared goal inventory and actual paid facility jobs through the normal game entry points.
const {setTestCash,assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
function base(){
  const seed=clone(boot().g.s);
  seed.career.sorties=2;seed.career.returns=2;
  seed.campaign={claimed:[1700000000000,1700000100000],delivered:0,returnId:null};
  seed.hideout.levels.power=1;seed.hideout.levels.water=1;
  setTestCash(seed,100000);
  seed.stash={bandage:5,rs_case_med:1,gauze:2,medkit:1};
  delete seed.stashSlots;
  const b=boot({[v12]:seed});
  const box=b.g.s.stashSlots.find(u=>u.g==='rs_case_med').uid;
  for(let i=0;i<2;i++)assert.ok(b.g.caseMove(box,'put','bandage').ok);
  assert.ok(b.g.pin({kind:'campaign',id:'med'}));valid(b.g);
  return b;
}
const row=g=>g.objective().materials.find(m=>m.id==='bandage');
function counters(g){const m=row(g);return [m.required,m.construction,m.aid,m.usable,m.missing];}
function materialAllocation(){
  const b=base(),g=b.g;
  assert.deepEqual(counters(g),[5,3,2,5,0]);
  b.click({page:'prep'});assert.ok(b.content().includes('구호 납품 2개 · 시설 건설 3개'));
  assert.ok(g.campaignAction('med','deliver',2,0).ok);
  assert.equal(g.s.stash.bandage,3);
  assert.equal(g.s.stashSlots.find(u=>u.g==='rs_case_med').contents.length,0);
  assert.deepEqual(counters(g),[3,3,0,3,0]);
  const before=g.s.wallet;
  g.build({hideout:'build',id:'med',tier:1});
  assert.equal(g.s.wallet,before-20000);
  assert.ok(g.s.hideout.builds.med);
  assert.equal(row(g),undefined);
  assert.equal(g.objective().status,'시설 공사 중');
  valid(g);
}
function guardedBuild(){
  const b=base(),g=b.g,stock=clone(g.s.stash),slots=clone(g.s.stashSlots),wallet=g.s.wallet;
  const original=b.storage.set;
  b.storage.set=()=>{throw Error('quota')};
  g.build({hideout:'build',id:'med',tier:1});
  assert.equal(g.s.hideout.builds.med,undefined);
  assert.deepEqual(clone(g.s.stash),stock);assert.deepEqual(clone(g.s.stashSlots),slots);assert.equal(g.s.wallet,wallet);
  b.storage.set=original;
  const other=boot(b.storage,b.clock);
  assert.ok(other.g.campaignAction('med','deliver',1,0).ok);
  g.build({hideout:'build',id:'med',tier:1});
  assert.equal(g.s.hideout.builds.med,undefined);assert.equal(g.s.campaign.delivered,1);
  assert.equal(g.s.wallet,wallet);assert.deepEqual(clone(g.s.stashSlots),clone(other.g.s.stashSlots));
  g.build({hideout:'build',id:'med',tier:1});
  assert.ok(g.s.hideout.builds.med);assert.equal(g.s.wallet,wallet-20000);
  assert.deepEqual(counters(g),[1,0,1,1,0]);valid(g);
}
materialAllocation();
guardedBuild();
console.log('PASS separate relief and facility requirements on a shared item, protected construction reserve and real facility write rollback/conflict/retry.');

function finalReceiptFailure(){
  const {go,move}=require('./game-fixture.cjs');
  const progress=require('./fixtures/finale-v22.json').session;
  const b=boot({[v12]:clone(progress)}),g=b.g;
  assert.ok(g.contract('repair-first-call','claim').ok);
  assert.ok(g.pin({kind:'finale',id:'relay'}));
  assert.equal(g.objective().source.kind,'finale');
  assert.ok(g.finaleAction('arm').ok);
  const original=b.storage.set;
  b.storage.set=()=>{throw Error('mission launch quota')};
  g.start();
  assert.equal(g.s.raid,null);assert.equal(g.s.finale.armed,true);
  b.storage.set=original;g.start();
  const id=g.s.raid.startedAt, before=g.s.career.returns;
  for(const zone of [0,1,2]){
    if(zone)move(b,zone);
    assert.ok(g.finaleAction('signal',zone,id).ok);
  }
  assert.match(g.objective().status,/생환 필요/);
  move(b,0);go(b,'extract',{exit:'b04'});
  const deadline=g.s.field.action.end;
  b.storage.set=()=>{throw Error('ending receipt quota')};
  b.clock.now=deadline;g.tick();
  assert.equal(g.s.finale.reply,null);
  assert.equal(g.s.field.action.end,deadline);
  assert.equal(g.s.finale.attempt.confirmed.length,3);
  assert.equal(g.s.career.returns,before);
  b.storage.set=original;g.tick();
  assert.equal(g.s.career.returns,before+1);
  assert.equal(g.s.finale.reply.raidId,id);
  assert.equal(g.s.objectivePin,null);
  g.tick();assert.equal(g.s.career.returns,before+1);valid(g);
}
finalReceiptFailure();
console.log('PASS opt-in mission launch and final receipt roll back on quota, retry settles once and clears the tracked mission.');
