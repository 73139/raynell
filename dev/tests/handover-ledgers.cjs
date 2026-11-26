// Exercise real drawer discovery/search, movement, settlement and persisted ledger progress.
const {assert, boot, clone, extract, finish, go, move, stamp, valid} = require('./game-fixture.cjs');

const order = 'handover-ledgers';
const station = {zone:0, landmark:8, box:17, name:'화물표 서랍'};
const checkpoint = {zone:1, landmark:1, box:6, name:'검역 접수 서랍'};
const sites = [station, checkpoint];

function start(first, roll) {
  const b = boot();
  b.g.order(order);
  assert.equal(b.g.s.career.order, order);
  assert.ok(b.g.pin({kind:'order', id:order}));
  b.g.moveNow(first.zone);
  b.setRandom(roll);
  b.g.start();
  return b;
}

function assertProgress(b, done) {
  const objective = b.g.objective();
  assert.equal(objective.goals[0].projected ?? 0, done.length);
  assert.deepEqual(clone(objective.locations), sites.filter(s => !done.includes(s))
    .map(({zone, landmark}) => ({zone, landmark})));
  assert.deepEqual(clone(objective.inspections).map(s => [s.zone, s.index, s.complete]),
    sites.map(s => [s.zone, s.box, done.includes(s)]));
  valid(b.g);
}

function evadeContact(b) {
  if (b.g.s.field.contact) {
    b.setRandom(.01);
    go(b, 'evade');
    finish(b);
    assert.equal(b.g.s.field.contact, null);
  }
}

function open(b, site) {
  const g = b.g;
  if (g.s.raid.zone !== site.zone) move(b, site.zone);
  go(b, 'landmark', {index:site.landmark});
  while (!g.s.field.found[site.zone].includes(site.box)) {
    go(b, 'scan');
    finish(b);
    evadeContact(b);
  }
  assert.equal(g.lootBoxIsLocked(site.zone, site.box), false);
  go(b, 'open', {index:site.box});
  assert.equal(g.s.field.open, site.zone + '-' + site.box);
  return g.s.field.boxes[g.s.field.open];
}

function search(b) {
  go(b, 'search');
  while (b.g.s.field.action) finish(b);
  go(b, 'close');
}

async function success(first, second, roll) {
  let b = start(first, roll);
  assertProgress(b, []);
  for (const site of sites) {
    assert.equal(b.g.areas[site.zone].boxes[site.box][0], site.name);
    assert.equal(b.g.places[site.zone][site.landmark].boxes[1], site.box);
  }
  const box = open(b, first);
  assertProgress(b, []); // A scanner detection and opening the drawer do not count.
  if (roll === .8) {
    assert.ok(box.items.length >= 2);
    go(b, 'search', {uid:box.items[0].uid});
    assertProgress(b, []);
    finish(b);
    assert.equal(box.complete, false);
    assertProgress(b, []); // Only one of the drawer's contents has been identified.
  } else {
    assert.equal(box.items.length, 0);
    assert.equal(box.complete, false);
  }
  search(b);
  assertProgress(b, [first]);
  // Reopening and confirming the same drawer cannot count twice.
  open(b, first);
  search(b);
  assertProgress(b, [first]);
  const exported = await b.exportData();
  const restored = boot({}, b.clock);
  await restored.g.importFile(new Blob([JSON.stringify(exported)]));
  b = restored;
  assertProgress(b, [first]);
  open(b, second);
  search(b);
  assertProgress(b, sites);
  assert.equal(b.g.s.field.bag.length, 0);
  if (b.g.s.raid.zone !== 0) move(b, 0);
  extract(b);
  const s = b.g.s;
  assert.equal(s.lastSummary.rating, 'success');
  assert.ok(s.lastSummary.elapsed < 420000, 'the two searched containers qualify without a seven-minute wait');
  assert.equal(s.lastSummary.commission, 34000);
  assert.equal(s.lastSummary.missionXp, 115);
  assert.equal(s.career.xp, s.lastSummary.earned + 115);
  assert.deepEqual(clone(s.career.done), [order]);
  assert.equal(s.wallet, 64000);
  assert.equal(s.career.sorties, 1);
  for (let i=0; i<2; i++) b = boot(b.storage, b.clock);
  b.g.ack();
  b.g.ack();
  b.g.order(order);
  assert.equal(b.g.s.career.order, null);
  assert.equal(b.g.s.wallet, 64000);
  assert.deepEqual(clone(b.g.s.career.history), clone(s.career.history));
  valid(b.g);
}

function earlyAndWrong() {
  const early = start(station, .001);
  open(early, station);
  search(early);
  assertProgress(early, [station]);
  extract(early);
  assert.equal(early.g.s.lastSummary.rating, 'quick');
  assert.equal(early.g.s.lastSummary.commission, 0);
  assert.equal(early.g.s.lastSummary.missionXp, 0);
  assert.equal(early.g.s.career.order, order);

  const wrong = start(station, .001);
  open(wrong, {...station, box:16}); // The suitcase beside the freight drawer.
  search(wrong);
  assertProgress(wrong, []);
  open(wrong, station);
  search(wrong);
  assertProgress(wrong, [station]);
  extract(wrong);
  assert.equal(wrong.g.s.lastSummary.rating, 'success');
  assert.equal(wrong.g.s.lastSummary.commission, 0);
  assert.deepEqual(clone(wrong.g.s.career.done), []);
}

function failedThenFresh(failure) {
  const b = start(station, .001);
  open(b, station);
  search(b);
  assertProgress(b, [station]);
  if (failure === 'expired') stamp(b, b.g.s.raid.endsAt);
  else go(b, 'abandon');
  assert.equal(b.g.s.lastSummary.rating, failure);
  assert.equal(b.g.s.lastSummary.commission, 0);
  assert.equal(b.g.s.wallet, 30000);
  b.g.ack();
  b.g.moveNow(checkpoint.zone);
  b.g.start();
  assertProgress(b, []);
  open(b, checkpoint);
  search(b);
  assertProgress(b, [checkpoint]);
}

function endedChecklist() {
  const b = start(station, .001);
  for (const site of sites) {
    open(b, site);
    search(b);
  }
  assertProgress(b, sites);
  go(b, 'abandon');
  for (const game of [b, boot(b.storage, b.clock)]) {
    assertProgress(game, []);
    const result = game.g.readField();
    for (const site of sites) {
      assert.ok(result.includes('data-inspection-box="' + site.zone + '-' + site.box + '" data-complete="false"'));
    }
    assert.match(result, /다음 출격에서 두 서랍을 다시 확인하세요/);
    assert.doesNotMatch(result, /두 서랍을 확인했습니다/);
  }
}

async function incompleteRestores() {
  const b = start(station, .8);
  const undiscovered = clone(b.g.s.field.found[station.zone]);
  const first = open(b, station);
  go(b, 'search', {uid:first.items[0].uid});
  finish(b);
  const partial = clone(first.items);
  assert.ok(partial.some(unit => unit.revealed) && partial.some(unit => !unit.revealed));
  search(b);
  open(b, checkpoint);
  search(b);
  move(b, 0);
  const complete = await b.exportData();
  // Restore mixed-generation records from the observed checkpoints above.
  for (const checkpointField of ['discovery', 'identification']) {
    const saved = clone(complete);
    const field = saved.session.field;
    if (checkpointField === 'discovery') field.found[station.zone] = undiscovered;
    else field.boxes['0-17'].items = partial;
    const restored = boot({}, b.clock);
    await restored.g.importFile(new Blob([JSON.stringify(saved)]));
    assertProgress(restored, [checkpoint]);
    extract(restored);
    assert.equal(restored.g.s.lastSummary.rating, 'success');
    assert.equal(restored.g.s.lastSummary.commission, 0);
    assert.equal(restored.g.s.lastSummary.missionXp, 0);
    assert.deepEqual(clone(restored.g.s.career.done), []);
    assert.equal(restored.g.s.wallet, 30000);
  }
}

(async () => {
  earlyAndWrong();
  failedThenFresh('abandoned');
  failedThenFresh('expired');
  endedChecklist();
  await incompleteRestores();
  await success(station, checkpoint, .001);
  await success(checkpoint, station, .8);
  console.log('PASS ledger drawers: both directions, empty/partial search, neighbor exclusion, active and mixed-generation imports, ended checklist, fresh sortie after MIA/abandon, quick vs normal return and exactly one award.');
})().catch(error => { console.error(error); process.exitCode=1; });
