const test = require('node:test');
const {assert, boot, clone, extract, stamp, valid, v12} = require('./game-fixture.cjs');

const order = 'tower-wire';
const pin = {kind:'order', id:order};

function withStorageFailure(b, method, action, limit = Infinity) {
  const original = b.storage[method];
  let failures = 0;
  b.storage[method] = function(key, ...args) {
    if (key === v12 && failures < limit) {
      failures++;
      throw new Error('test storage ' + method + ' failure');
    }
    return original.call(this, key, ...args);
  };
  try { action(); } finally { delete b.storage[method]; }
  assert.ok(failures > 0, 'the requested fault was exercised');
}

function payout(g) {
  const s = g.s;
  return clone({wallet:s.wallet, banknotes:s.cash, warehouse:s.stashSlots, career:s.career, result:s.lastSummary});
}

function checkOrder(b, expectedOrder, expectedPin = null) {
  const saved = JSON.parse(b.storage.get(v12));
  for (const s of [b.g.s, saved]) {
    assert.equal(s.career.order, expectedOrder);
    assert.deepEqual(clone(s.objectivePin), expectedPin);
  }
}

function enterOrders(b) {
  b.click({page:'orders'});
  b.click({bui:'order', id:order});
}

function resultScreen() {
  const b = boot();
  b.g.start();
  extract(b);
  assert.equal(b.g.s.lastSummary.earned, 25);
  valid(b.g);
  return b;
}

test('failed order acceptance/cancellation preserves both the visible order and its pin; retry survives reopen', () => {
  const b = boot();
  enterOrders(b);
  const before = b.storage.get(v12);
  withStorageFailure(b, 'set', () => b.click({order}));
  checkOrder(b, null);
  assert.equal(b.storage.get(v12), before);
  assert.match(b.content(), /role="status"[^>]*>[^<]*(저장|다시)/);
  b.click({order});
  checkOrder(b, order);
  assert.ok(b.g.pin(pin));
  const accepted = b.storage.get(v12);
  withStorageFailure(b, 'set', () => b.click({order}));
  checkOrder(b, order, pin);
  assert.equal(b.storage.get(v12), accepted);
  b.click({order});
  checkOrder(b, null);
  const opened = boot(b.storage, b.clock);
  checkOrder(opened, null);
  valid(opened.g);
});

test('an older writer cannot replace a different order or pin committed by the newer writer', () => {
  const older = boot();
  const newer = boot(older.storage, older.clock);
  newer.g.order('stores');
  const latestPin = {kind:'order', id:'stores'};
  assert.ok(newer.g.pin(latestPin));
  const latest = newer.storage.get(v12);
  // A transient read error must not let the stale tab skip the revision comparison.
  withStorageFailure(older, 'get', () => older.g.order(order));
  assert.equal(older.g.s.career.order, null);
  assert.equal(older.storage.get(v12), latest);
  older.g.order(order);
  assert.equal(older.storage.get(v12), latest);
  checkOrder(older, 'stores', latestPin);
  valid(older.g);
});

test('a tab waiting for the writer lock cannot accept, cancel, or acknowledge via its handlers', () => {
  const writer = boot();
  writer.g.order(order);
  assert.ok(writer.g.pin(pin));
  const waitingLocks = {locks:{request:() => new Promise(() => {})}};
  const viewer = boot(writer.storage, writer.clock, waitingLocks);
  assert.equal(viewer.g.w, false);
  enterOrders(viewer);
  assert.match(viewer.content().match(/<button[^>]*data-order="tower-wire"[^>]*>/)?.[0] || '', /\bdisabled\b/);
  const before = writer.storage.get(v12);
  viewer.g.order(order);
  checkOrder(viewer, order, pin);
  assert.equal(viewer.storage.get(v12), before);
  const finished = resultScreen();
  const reader = boot(finished.storage, finished.clock, waitingLocks);
  const resultBytes = finished.storage.get(v12);
  reader.g.ack();
  assert.ok(reader.g.s.raid);
  assert.equal(reader.storage.get(v12), resultBytes);
});

test('an unreadable checkpoint blocks order changes and acknowledgements without replacing memory or disk', () => {
  const b = boot();
  const before = b.storage.get(v12);
  withStorageFailure(b, 'get', () => b.g.order(order));
  checkOrder(b, null);
  assert.equal(b.storage.get(v12), before);
  b.g.order(order);
  checkOrder(b, order);

  const finished = resultScreen();
  const resultBytes = finished.storage.get(v12);
  const raidId = finished.g.s.raid.startedAt;
  const expected = payout(finished.g);
  withStorageFailure(finished, 'get', () => finished.g.ack());
  assert.equal(finished.g.s.raid?.startedAt, raidId);
  assert.deepEqual(payout(finished.g), expected);
  assert.equal(finished.storage.get(v12), resultBytes);
  finished.g.ack();
  assert.equal(finished.g.s.raid, null);
  assert.deepEqual(payout(finished.g), expected);
});

test('failed return keeps the settled raid; successful retry, repeated input, reload and JSON restore pay once', async () => {
  const b = resultScreen();
  const expected = payout(b.g);
  const before = b.storage.get(v12);
  const raidId = b.g.s.raid.startedAt;
  withStorageFailure(b, 'set', () => b.click({raid:'ack'}));
  assert.equal(b.g.s.raid?.startedAt, raidId);
  assert.equal(b.g.s.field.result, 'success');
  assert.equal(b.storage.get(v12), before);
  assert.deepEqual(payout(b.g), expected);
  assert.match(b.content(), /role="status"[^>]*>[^<]*(저장|다시)/);
  assert.match(b.content(), /data-raid="ack"/);
  b.click({raid:'ack'});
  assert.equal(b.g.s.raid, null);
  b.g.ack();
  const reopened = boot(b.storage, b.clock);
  const exported = await b.exportData();
  assert.ok(b.g.check(exported));
  const imported = boot({}, b.clock);
  await imported.g.importFile(new Blob([JSON.stringify(exported)]));
  for (const profile of [b, reopened, imported]) {
    assert.equal(profile.g.s.raid, null);
    assert.deepEqual(payout(profile.g), expected);
    valid(profile.g);
  }
});

test('a stale return cannot undo a winning return, a newly accepted order, or the next active raid', () => {
  const older = resultScreen();
  const newer = boot(older.storage, older.clock);
  newer.g.ack();
  newer.g.order(order);
  newer.g.start();
  const latest = newer.storage.get(v12);
  const newId = newer.g.s.raid.startedAt;
  assert.notEqual(newId, older.g.s.raid.startedAt);
  older.g.ack();
  assert.equal(older.g.s.raid?.startedAt, newId);
  assert.equal(older.g.s.field.result, null);
  assert.equal(older.storage.get(v12), latest);
  checkOrder(older, order);
  assert.deepEqual(payout(older.g), payout(newer.g));
  valid(older.g);
});

test('acknowledging at the simultaneous MIA/craft deadline cannot discard unpaid settlement after a failed write', () => {
  const seed = boot();
  seed.g.start();
  const s = clone(seed.g.s);
  // One previously paid production job and one live raid mature at the exact same millisecond.
  s.hideout.levels.power = 1;
  s.hideout.levels.water = 1;
  s.hideout.levels.med = 1;
  s.hideout.wardManual.registered = true;
  s.hideout.production.med = {recipe:'folded-dressing', end:s.raid.endsAt};
  const b = boot({[v12]:s}, seed.clock);
  valid(b.g);
  stamp(b, s.raid.endsAt - 1);
  assert.equal(b.g.stock('rl_craft_dressing'), 0);
  const before = b.storage.get(v12);
  b.clock.now = s.raid.endsAt;
  withStorageFailure(b, 'set', () => b.g.ack());
  assert.equal(b.storage.get(v12), before);
  assert.equal(b.g.s.raid?.startedAt, s.raid.startedAt);
  assert.equal(b.g.s.career.sorties, 0);
  assert.equal(b.g.stock('rl_craft_dressing'), 0);

  // Recover storage immediately after the failed settlement write inside this very same button event.
  withStorageFailure(b, 'set', () => b.g.ack(), 1);
  b.g.tick();
  assert.equal(b.g.s.lastSummary?.rating, 'expired');
  assert.equal(b.g.s.career.sorties, 1);
  assert.equal(b.g.s.career.returns, 0);
  assert.equal(b.g.stock('rl_craft_dressing'), 1);
  assert.equal(b.g.s.hideout.production.med, undefined);
  b.g.ack();
  const reopened = boot(b.storage, b.clock);
  reopened.g.tick();
  assert.equal(reopened.g.s.raid, null);
  assert.equal(reopened.g.s.career.history.length, 1);
  assert.equal(reopened.g.stock('rl_craft_dressing'), 1);
  valid(reopened.g);
});
