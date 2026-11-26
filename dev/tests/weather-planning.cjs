// A predeparture forecast selected without a pinned loot target travels with the save.
const {assert, boot, clone, epoch, valid} = require('./game-fixture.cjs');

async function main() {
  for (const zone of [0, 1, 2]) {
    const origin = boot({}, {now:epoch});
    origin.g.moveNow(zone);
    const exported = await origin.exportData();
    assert.equal(exported.session.lootDestination, null);
    assert.equal(exported.session.plannedDepartureZone, zone);
    assert.ok(origin.g.check(exported));

    const restored = boot({}, {now:epoch});
    await restored.g.importFile(new Blob([JSON.stringify(exported)]));
    assert.equal((await restored.exportData()).session.plannedDepartureZone, zone);
    restored.g.start();
    assert.equal(restored.g.s.raid.zone, zone);
    const active = await restored.exportData();
    assert.equal(active.session.plannedDepartureZone, undefined);
    valid(restored.g);
    active.session.plannedDepartureZone = zone;
    assert.equal(restored.g.check(active), false);

    for (const invalid of [-1, 3, '1', 0.5]) {
      const malformed = clone(exported);
      malformed.session.plannedDepartureZone = invalid;
      assert.equal(origin.g.check(malformed), false);
    }
    const old = clone(exported);
    old.session.version = 26;
    assert.equal(origin.g.check(old), false);
    delete old.session.plannedDepartureZone;
    assert.ok(origin.g.check(old));
  }
  const old = require('./fixtures/weather-v26-scan.json').session;
  const key = 'rl-reboot-session-v26';
  const waiting = boot({[key]:old}, {now:old.field.action.start+1},
                       {locks:{request:()=>new Promise(()=>{})}});
  assert.equal(waiting.g.w, false);
  const update = clone(old);
  update.revision++;
  update.field.action = null; // The still-open v26 writer canceled its old scan.
  waiting.storage.set(key, JSON.stringify(update));
  waiting.element('window').dispatch('storage', {key});
  assert.equal(waiting.g.s.field.action, null);
  assert.equal(waiting.storage.has('rl-reboot-session-v36'), false);
  console.log('PASS a read-only v27 terminal follows the live v26 writer before migration without creating a second save.');
  console.log('PASS all three ordinary planning destinations survive independent exports and imports, active and out-of-range selections rejected, v26 compatibility preserved.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
