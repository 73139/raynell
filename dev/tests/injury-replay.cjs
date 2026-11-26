// Exercise normal field, transaction, timeout and JSON paths using independent tabs/profiles.
const {assert, boot, clone, finish, go, stamp, valid} = require('./game-fixture.cjs');
const units = g => Array.from(g.s.field.bag.filter(tile => tile.g==='bandage'), tile => tile.uid);
function stocked() {
  const b=boot(),g=b.g;
  assert.ok(g.trade('medic','buy','bandage',2).ok);
  for(let i=0;i<2;i++)g.gear({gear:'pack',id:'bandage'});
  assert.equal(g.s.equipment.bag.length,2);
  g.start();
  return b;
}
function hurt(b) {
  const g=b.g;
  for(let n=0;n<6 && !g.s.field.contact;n++){
    if(n%2===0)go(b,'landmark',{index:n/2});
    go(b,'scan');finish(b);
  }
  assert.ok(g.s.field.contact);
  b.setRandom(.90);go(b,'evade');finish(b);
  assert.ok(g.s.field.contact && g.s.field.hp<100);
  valid(g);
}
async function copy(b,time=b.clock.now) {
  const exported=await b.exportData();
  const other=boot({}, {now:time});
  await other.g.importFile(new Blob([JSON.stringify(exported)]));
  return other;
}
async function run() {
  const b=stocked();hurt(b);
  const g=b.g,ids=units(g),before=g.s.field.hp;
  assert.equal(ids.length,2);
  // The inventory entry point for a health item must not consume a unit and
  // silently leave the active injury in place.
  g.gear({gear:'consume',unit:ids[0]});
  assert.deepEqual(units(g),ids);
  assert.equal(g.s.field.hp,before);
  assert.equal(g.s.field.action,null);
  g.beginInjuryTreatment('arm',ids[1]);
  const original=clone(g.s.field.action);
  assert.equal(original.type,'treat');
  const imported=await copy(b,b.clock.now+350);
  assert.deepEqual(clone(imported.g.s.field.action),original);
  const stale=boot(b.storage,b.clock),latest=boot(b.storage,b.clock);
  stamp(latest,original.end);
  assert.deepEqual(units(latest.g),[ids[0]]);
  const once=clone(latest.g.s.injuryState),hp=latest.g.s.field.hp;
  stamp(stale,original.end+1);
  assert.deepEqual(units(stale.g),[ids[0]]);
  assert.deepEqual(clone(stale.g.s.injuryState),once);
  assert.equal(stale.g.s.field.hp,hp);
  finish(imported);
  assert.deepEqual(clone(imported.g.s.injuryState),once);
  assert.equal(imported.g.s.field.hp,hp);
  for(let n=0;n<3;n++)latest.g.tick();
  valid(latest.g);
  console.log('PASS a carried health item opens target selection with zero premature debit; two writers completing the same saved timer, repeated ticks, and an independent JSON branch agree on exactly one UID, one treatment and identical HP.');

  // Time-expired units appear in the normal loss manifest if still carried.
  const prior=stocked();hurt(prior);
  const duration=3000;
  for(const [delta,expectedLeft] of [[-1,1],[0,2],[1,2]]){
    const fork=await copy(prior);
    const e=fork.g.s.raid.endsAt;
    stamp(fork,e-duration+delta);
    const original=fork.g.s.injuryState.events.length;
    fork.g.beginInjuryTreatment('arm',units(fork.g)[0]);
    stamp(fork,e);
    const result=fork.g.s.lastSummary;
    assert.equal(result.result,'expired');
    assert.equal(result.goods.filter(id=>id==='bandage').length,expectedLeft);
    assert.equal(result.injuries.events.length,original+(delta<0?1:0));
    valid(fork.g);
    fork.g.ack();fork.g.start();
    assert.equal(fork.g.s.injuryState.events.length,0);
    assert.equal(fork.g.s.field.hp,100);
    assert.deepEqual(clone(fork.g.s.lastSummary.injuries),clone(result.injuries));
  }
  console.log('PASS treatment ending 1 ms before, exactly at, and 1 ms after sortie expiry: exact count in the lost inventory, accurate event ledger, healthy next departure and unchanged prior report.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
