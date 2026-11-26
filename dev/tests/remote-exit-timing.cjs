const {assert, boot, clone, extract, go, move, stamp, valid} = require('./game-fixture.cjs');

function checkpoint() {
  const run = boot();
  run.g.moveNow(1);
  run.setRolls([.23, .45]); // Assign the train through the normal sortie draw.
  run.g.start();
  assert.ok(run.g.s.field.exits.includes('train'));
  return run;
}
function card(game, exit) {
  const section = game.readField().split('<div class="exit-card">').find(part =>
    part.startsWith('<div><span class="mono">EXIT / ' + exit.toUpperCase() + '<'));
  assert.ok(section, 'Assigned exit is visible: ' + exit);
  return section.split('</button></div>')[0];
}

const boundary = checkpoint();
const {g} = boundary;
const end = g.s.raid.endsAt;
stamp(boundary, end - 17000); // 7 s to B-04, then 10 s to extract.
assert.match(card(g, 'b04'), /시간 부족/);
assert.doesNotMatch(card(g, 'b04'), /이용 가능/);
const before = clone(g.s);
assert.match(card(g, 'b04'), /data-field="move" data-index="0"\s*>/);
assert.deepEqual(clone(g.s), before);
const reloaded = boot(new Map(boundary.storage), {now:boundary.clock.now});
assert.match(card(reloaded.g, 'b04'), /시간 부족/);
move(boundary, 0);
go(boundary, 'extract', {exit:'b04'});
assert.equal(g.s.field.action, null);
stamp(boundary, end);
assert.equal(g.s.lastSummary.rating, 'expired');

for (const level of [0, 3]) {
  const run = checkpoint();
  run.g.s.hideout.levels.rest = level;
  const walk = run.g.routeStepDuration(run.g.routeProfile(1, 0));
  stamp(run, run.g.s.raid.endsAt - walk - 10001);
  assert.match(card(run.g, 'b04'), /직행 도착 기준 · 이용 가능/);
  move(run, 0);
  extract(run);
  assert.equal(run.g.s.lastSummary.rating, 'success');
  assert.equal(run.clock.now, run.g.s.raid.endsAt - 1);
  if (!level) valid(run.g);
}

const rail = checkpoint();
const [opens, closes] = rail.g.window();
const walk = 18000; // Two 9-second legs from the checkpoint to the warehouse.
stamp(rail, opens - walk - 1);
assert.match(card(rail.g, 'train'), /열차 도착 대기/);
stamp(rail, opens - walk);
assert.match(card(rail.g, 'train'), /직행 도착 기준 · 이용 가능/);
stamp(rail, closes - walk - 30001);
assert.match(card(rail.g, 'train'), /직행 도착 기준 · 이용 가능/);
const catchTrain = boot(new Map(rail.storage), {now:rail.clock.now});
move(catchTrain, 2);
extract(catchTrain, 'train');
assert.equal(catchTrain.clock.now, closes - 1);
valid(catchTrain.g);
stamp(rail, closes - walk - 30000);
assert.match(card(rail.g, 'train'), /열차 탑승 마감/);
move(rail, 2);
go(rail, 'extract', {exit:'train'});
assert.equal(rail.g.s.field.action, null);

const closure = checkpoint();
closure.g.s.career.order = 'passage-test';
closure.g.s.career.gateTest = {from:1, raidId:closure.g.s.raid.startedAt - 1};
assert.match(card(closure.g, 'b04'), /직행로 차단/);
assert.match(card(closure.g, 'b04'), /data-field="move" data-index="0" disabled/);
assert.doesNotMatch(card(closure.g, 'train'), /직행로 차단/);
console.log('PASS remote exits project direct travel and dwell, ±1 ms deadlines, train boarding, actual arrivals, rest upgrades, reload, one-way closure and unchanged movement.');
