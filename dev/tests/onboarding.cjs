// Verify the same compiled game and persisted state used by the browser.
const {assert, boot, clone, extract, finish, go, stamp, valid} = require('./game-fixture.cjs');
const fs = require('node:fs');
const path = require('node:path');
const PANTRY = 'supply-pantry';
const FLASK = 'supply-spare-flask';
const OLD = 'rl-reboot-session-v18';
const CURRENT = 'rl-reboot-session-v36';
const legacy = () => {
  const {session} = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/possessions-v17.json'),'utf8'));
  session.version = 18;
  session.stashSlots[0].alias = '장기 비축';
  session.contracts.supply.active = {id:FLASK,progress:[0]};
  session.objectivePin = {kind:'contract', id:FLASK};
  return session;
};
function step(g,expected) {
  assert.equal(g.onboarding().mode,'active');
  assert.equal(g.onboarding().step,expected, 'expected guide step '+expected);
}
function search(b,landmark) {
  go(b,'landmark',{index:landmark});
  go(b,'scan');finish(b);
  const index = b.g.places[0][landmark].boxes[0];
  go(b,'open',{index});
  const box = b.g.s.field.boxes['0-'+index];
  if (!box.complete) {
    go(b,'search');
    while (b.g.s.field.action) finish(b);
  }
  assert.ok(box.complete);
}
async function success() {
  let b = boot(), g = b.g;
  step(g,'accept');
  assert.equal(g.status(PANTRY).status,'available');
  assert.ok(g.contract(PANTRY,'accept').ok);step(g,'deploy');
  assert.equal(g.contract(PANTRY,'claim').ok,false);
  b.click({page:'map'});b.click({page:'prep'});step(g,'deploy');
  g.start();step(g,'search');
  search(b,0);step(g,'search');go(b,'close');
  // Whole save import follows the real JSON validator and importer while the sortie is active.
  const backup = await b.exportData();
  const restored = boot({},b.clock);
  await restored.g.importFile(new Blob([JSON.stringify(backup)]));
  assert.equal(restored.g.s.raid.startedAt,g.s.raid.startedAt);
  step(restored.g,'search');
  b=restored;g=b.g;
  search(b,3);step(g,'extract');
  // A refresh keeps the completed box and its projected progress, prior to extraction.
  b=boot(b.storage,b.clock);g=b.g;step(g,'extract');
  assert.equal(g.status(PANTRY).goals[0].value,0);
  go(b,'close');extract(b);step(g,'debrief');
  assert.equal(g.status(PANTRY).goals[0].value,1);
  const settled=clone(g.s.career);
  g.tick();g.tick();assert.deepEqual(clone(g.s.career),settled);
  g.ack();step(g,'claim');
  const {wallet,career}=clone(g.s);
  assert.ok(g.contract(PANTRY,'claim').ok);
  assert.equal(g.onboarding().mode,'completed');
  assert.equal(g.fee,wallet+4200);assert.equal(g.s.career.xp,career.xp+25);
  assert.equal(g.standing('supply').points,10);
  assert.equal(g.contract(PANTRY,'claim').ok,false);
  const result=boot(b.storage,b.clock).g;
  assert.equal(result.onboarding().mode,'completed');
  assert.equal(result.fee,wallet+4200);
  assert.equal(result.s.career.xp,career.xp+25);
  assert.deepEqual(clone(result.s.contracts.supply.done),[PANTRY]);
  valid(result);
}
function failureAndDiversions() {
  const b=boot(),g=b.g;
  g.contract(PANTRY,'accept');g.start();
  search(b,3);step(g,'extract');go(b,'close');
  go(b,'abandon');step(g,'failed');
  const last=clone(g.s.lastSummary);
  assert.equal(last.rating,'abandoned');
  assert.equal(g.status(PANTRY).goals[0].value,0);
  const report=boot(b.storage,b.clock);
  step(report.g,'failed');report.g.ack();step(report.g,'retry');
  const retry=boot(report.storage,report.clock);step(retry.g,'retry');
  retry.g.gear({gear:'issue'});retry.g.start();step(retry.g,'search');
  assert.ok(retry.g.s.raid.startedAt!==last.raidId);
  assert.equal(retry.g.s.career.sorties,1);
  extract(retry);step(retry.g,'debrief');
  assert.equal(retry.g.status(PANTRY).status,'active','survival without the pantry search is insufficient');
  retry.g.ack();step(retry.g,'deploy');
  retry.g.start();stamp(retry,retry.g.s.raid.endsAt);
  assert.equal(retry.g.s.lastSummary.rating,'expired');step(retry.g,'failed');
  assert.equal(retry.g.contract(PANTRY,'claim').ok,false);
  valid(retry.g);
}
function acceptAfterFirstLoss() {
  const first=boot();
  first.g.start();step(first.g,'unassigned');
  go(first,'abandon');step(first.g,'failed');first.g.ack();
  const restored=boot(first.storage,first.clock);
  const g=restored.g;
  step(g,'accept');
  g.gear({gear:'issue'});
  assert.ok(g.contract(PANTRY,'accept',true).ok);
  step(g,'retry');
  restored.clock.now+=1000;
  g.start();step(g,'search');
  assert.equal(g.s.field.worn.back,'issued_pack');
  assert.equal(g.s.wallet,30000);
  assert.equal(g.status(PANTRY).goals[0].value,0);
}

function combatLossAfterSearching() {
  const b=boot(),g=b.g;
  assert.ok(g.contract(PANTRY,'accept',true).ok);
  g.start();search(b,3);go(b,'close');step(g,'extract');
  const wallet=g.fee,xp=g.s.career.xp;
  // Generate an encounter with normal scans. No HP, contact or settlement is injected.
  for (const index of [0,1,2,4]) {
    go(b,'landmark',{index});go(b,'scan');finish(b);
    if (g.s.field.contact) break;
  }
  assert.ok(g.s.field.contact);
  b.setRandom(.95);
  go(b,'engage');finish(b);
  assert.ok(g.s.field.contact && g.s.field.hp < 100);
  for (let tries=0; g.s.field.contact && tries<20; tries++) {
    go(b,'evade');finish(b);
  }
  assert.equal(g.s.lastSummary.result,'kia');assert.equal(g.s.field.hp,0);step(g,'failed');
  assert.equal(g.s.lastSummary.searched,1);
  assert.equal(g.status(PANTRY).goals[0].value,0);
  assert.equal(g.fee,wallet);assert.equal(g.s.career.xp,xp);
  const retry=boot(b.storage,b.clock);
  step(retry.g,'failed');retry.g.ack();step(retry.g,'retry');
  assert.equal(retry.g.contract(PANTRY,'claim').ok,false);
  assert.equal(retry.g.standing('supply').points,0);
  assert.equal(retry.g.fee,wallet);assert.equal(retry.g.s.career.xp,xp);
  retry.g.start();step(retry.g,'search');
  valid(retry.g);
}
async function existingAndPreferences() {
  const source=legacy();
  const b=boot({[OLD]:source}),g=b.g;
  assert.equal(g.onboarding().mode,'available');
  assert.equal(b.storage.get(OLD),JSON.stringify(source));
  assert.equal(g.s.stashSlots[0].alias,'장기 비축');
  assert.deepEqual(clone(g.s.objectivePin),source.objectivePin);
  const before=clone(g.s.contracts),wallet=g.fee,items=clone(g.s.stashSlots);
  assert.ok(g.setGuide('active'));step(g,'busy');
  assert.deepEqual(clone(g.s.contracts),before);assert.equal(g.fee,wallet);
  assert.deepEqual(clone(g.s.stashSlots),items);
  assert.deepEqual(clone(g.s.objectivePin),source.objectivePin);
  assert.ok(g.setGuide('skipped'));assert.equal(g.onboarding().mode,'skipped');
  const fresh=boot(b.storage,b.clock);assert.equal(fresh.g.onboarding().mode,'skipped');
  const saved=await fresh.exportData();
  const z=boot();await z.g.importFile(new Blob([JSON.stringify(saved)]));
  assert.equal(z.g.onboarding().mode,'skipped');
  assert.deepEqual(clone(z.g.s.objectivePin),source.objectivePin);
  assert.ok(z.g.setGuide('active'));step(z.g,'busy');
  assert.deepEqual(clone(z.g.s.stashSlots),items);
  const bad=clone(saved);bad.session.onboarding.mode='unknown';
  assert.equal(z.g.check(bad),false);valid(z.g);
  const oldImport=boot();await oldImport.g.importFile(new Blob([JSON.stringify({format:'rustline-tc01',session:source})]));
  assert.equal(oldImport.g.onboarding().mode,'available');
  assert.deepEqual(clone(oldImport.g.s.stashSlots),items);
  assert.deepEqual(clone(oldImport.g.s.objectivePin),source.objectivePin);
  // A failed preference save must not record a local success or overwrite a concurrent writer.
  const failed=boot();failed.storage.set=()=>{throw Error('quota')};
  assert.equal(failed.g.setGuide('skipped'),false);step(failed.g,'accept');
  const x=boot(),y=boot(x.storage);
  assert.ok(y.g.setGuide('skipped'));
  assert.equal(x.g.setGuide('skipped'),false);
  assert.equal(x.g.onboarding().mode,'skipped');
  assert.equal(JSON.parse(x.storage.get(CURRENT)).onboarding.mode,'skipped');
}
function atomicGuidedAccept() {
  const failed=boot();failed.storage.set=()=>{throw Error('quota')};
  assert.equal(failed.g.contract(PANTRY,'accept',true).ok,false);
  assert.equal(failed.g.status(PANTRY).status,'available');assert.equal(failed.g.s.objectivePin,null);
  const active=boot();assert.ok(active.g.contract(PANTRY,'accept',true).ok);
  assert.deepEqual(clone(active.g.s.objectivePin),{kind:'contract',id:PANTRY});
  assert.equal(active.g.contract(PANTRY,'accept',true).ok,false);
  assert.equal(active.g.s.onboarding.step,'deploy');
  const stale=boot(),winner=boot(stale.storage);
  assert.ok(winner.g.contract(FLASK,'accept',true).ok);
  assert.equal(stale.g.contract(PANTRY,'accept',true).ok,false);
  assert.deepEqual(clone(stale.g.s.objectivePin),{kind:'contract',id:FLASK});
  assert.equal(stale.g.s.contracts.supply.active.id,FLASK);
}
(async()=>{
  atomicGuidedAccept();
  await success();failureAndDiversions();acceptAfterFirstLoss();combatLossAfterSearching();await existingAndPreferences();
  console.log('PASS onboarding: real quest, wrong landmark, mid-sortie save import, true/empty extraction, KIA/abandoned/timeout retry, reward once, opt-out, old alias/pin, conflict and quota.');
})().catch(error=>{console.error(error);process.exitCode=1});
