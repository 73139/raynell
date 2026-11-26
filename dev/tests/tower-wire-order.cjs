// Run from the source root: node tests/tower-wire-order.cjs
const {assert,boot,clone,extract,finish,go,move,stamp,valid}=require('./game-fixture.cjs');
const id='tower-wire',tower=5;

function start(zone=0) {
  const b=boot();
  b.g.order(id);
  assert.ok(b.g.pin({kind:'order',id}));
  b.g.moveNow(zone);
  b.setRandom(.35); // Within the industrial table's wire interval; actual scans and searches still run.
  b.g.start();
  return b;
}
function recover(b,landmark,ordinal=0) {
  const {g}=b,z=g.s.raid.zone,box=g.places[z][landmark].boxes[ordinal];
  go(b,'landmark',{index:landmark});
  while(!g.s.field.found[z].includes(box)){go(b,'scan');finish(b);}
  go(b,'open',{index:box});
  assert.ok(!b.content().includes('class="obj-tile-mark"'),'unidentified slots must have no pin');
  assert.ok(!b.content().includes('의뢰 회수품'),'unidentified slots must have no recovery hint');
  go(b,'search');
  while(g.s.field.action)finish(b);
  const unit=g.s.field.boxes[z+'-'+box].items.find(u=>u.g==='wire');
  assert.ok(unit,'wire should roll in the test container');
  const qualifies=z===0 && landmark===tower;
  b.click({pick:unit.uid,side:'loot'});
  assert.equal(b.content().includes('의뢰 회수품'),qualifies,'hint must match the actual wire source');
  assert.equal(b.content().includes('data-objective-item="wire"'),qualifies);
  assert.equal(b.content().includes('class="obj-tile-mark"'),qualifies);
  if(qualifies)assert.ok(b.content().includes('현장 가방 0개 / 필요 1개'));
  g.selectLoot(unit.uid);
  assert.ok(g.s.field.bag.some(u=>u.uid===unit.uid));
  go(b,'close'); return unit.uid;
}
function verifyUnpaid(b,rating) {
  const s=b.g.s;
  assert.equal(s.lastSummary.rating,rating);assert.equal(s.lastSummary.commission,0);
  assert.equal(s.lastSummary.missionXp,0);assert.equal(s.career.order,id);
  assert.ok(!s.career.done.includes(id));valid(b.g);
}
function normal(b){stamp(b,b.g.s.raid.startedAt+7*60000);extract(b);}
async function run() {
  let b=start(),g=b.g;
  assert.deepEqual(clone(g.objective().locations),[{zone:0,landmark:tower}]);
  assert.equal(g.objective().goals[0].projected,undefined);
  const uid=recover(b,tower);
  assert.equal(g.objective().goals[0].projected,1);
  g.gear({gear:'drop',unit:uid});assert.equal(g.objective().goals[0].projected,undefined);
  g.gear({gear:'recover',unit:uid});assert.equal(g.objective().goals[0].projected,1);
  const payload=await b.exportData();
  const imported=boot({},b.clock);await imported.g.importFile(new Blob([JSON.stringify(payload)]));
  assert.equal(imported.g.objective().goals[0].projected,1);
  normal(imported);
  const paid=clone(imported.g.s);
  assert.equal(paid.lastSummary.commission,36000);assert.equal(paid.lastSummary.missionXp,130);
  assert.equal(paid.lastSummary.completedObjectiveOrder,id);assert.equal(paid.wallet,66000);
  assert.equal(paid.stash.wire,1);assert.equal(paid.career.xp,paid.lastSummary.earned+130);
  assert.equal(paid.career.order,null);assert.deepEqual(paid.career.done,[id]);valid(imported.g);
  const reopened=boot(imported.storage,imported.clock);reopened.g.tick();reopened.g.ack();reopened.g.order(id);
  assert.equal(reopened.g.s.career.order,null);assert.equal(reopened.g.s.wallet,paid.wallet);
  assert.equal(reopened.g.s.career.xp,paid.career.xp);
  b=start();recover(b,tower);extract(b);verifyUnpaid(b,'quick');
  b.g.ack();b.g.gear({gear:'pack',id:'wire'});b.clock.now++;b.g.start();
  assert.equal(b.g.s.field.bag.filter(u=>u.g==='wire').length,1);
  assert.equal(b.g.objective().goals[0].projected,undefined);
  normal(b);verifyUnpaid(b,'success');
  b=start();recover(b,tower);stamp(b,b.g.s.raid.endsAt);verifyUnpaid(b,'expired');
  b=start();recover(b,tower);go(b,'abandon');verifyUnpaid(b,'abandoned');
  b=start(2);recover(b,1,1);assert.equal(b.g.objective().goals[0].projected,undefined);
  move(b,1);move(b,0);normal(b);verifyUnpaid(b,'success');
  console.log('PASS target container, drop/recover, JSON restore, normal reward/retained material, idempotent reload, quick, re-deployed wire, MIA, abandoned, wrong-zone industrial wire.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
