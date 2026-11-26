const legacyGearShape = require('./legacy-gear-shape.js');
// Exercise the built, single-file game. The starting inventory is a JSON file
// exported by the v0.20 engine after packing goods and naming/filling a case.
const {assert, boot, clone, extract, finish, go, valid} = require('./game-fixture.cjs');
const legacy = require('./fixtures/presets-v20.json');
const oldKey = 'rl-reboot-session-v20';
const saveKey = 'rl-reboot-session-v36';
const alpha = '야간 조명';
const bravo = '관측 통신';
const baseWorn = {back:'issued_pack',primary:'rl10_carbine'};
const make = (worn, modules) => ({worn:{...baseWorn,...worn},modules});
const light = make({light:'flash'},{light:'battery'});
const scout = make({eyes:'rl_13_07',comms:'radio'},{eyes:'optic',comms:'rl_13_02'});
const starving = make({light:'flash',comms:'radio'},{light:'battery',comms:'battery'});
function legacyBoot(session = legacy.session) {
  return boot({[oldKey]:clone(session)});
}
function inventory(s) {
  return clone({stash:s.stash,grid:s.stashSlots,equipment:s.equipment,wallet:s.wallet});
}
// Aggregate loose stock includes its queue. Count case contents separately,
// and use field ownership only while a sortie is live.
function totals(s) {
  const counts = {...s.stash};
  function one(id) { counts[id] = (counts[id] || 0) + 1; }
  for (const box of s.stashSlots) for (const item of box.contents || []) one(item.g);
  const kit = s.raid && !s.field.result ? s.field : s.equipment;
  for (const item of kit.bag) one(item.g);
  for (const id of Object.values(kit.worn)) one(id);
  for (const id of Object.values(kit.modules || {})) one(id);
  if (s.raid && !s.field.result) {
    for (const region of s.field.gearGround) for (const item of region) one(item.g);
  }
  const stored=[...s.stashSlots,...s.stashSlots.flatMap(u=>u.contents||[]),...kit.bag,...(s.raid&&!s.field.result?s.field.gearGround.flat():[])];
  for(const unit of stored) if(unit.gear?.module) one(unit.gear.module);
  for(const gear of s.gearOverflow||[]) if(gear.module) one(gear.module);
  return counts;
}
const namedCase = s => s.stashSlots.find(x => x.alias === '야간 정비함');
const requirement = (preview,id) => preview.requirements.find(row => row.id === id);
function good(result) { assert.equal(result.ok,true,result.message); }
function bad(result) { assert.equal(result.ok,false,result.message); }
function beforeAfter(b,fn) {
  const before = inventory(b.g.s), onDisk = b.storage.get(saveKey);
  fn();
  assert.deepEqual(inventory(b.g.s),before);
  assert.equal(b.storage.get(saveKey),onDisk);
}
async function mixedStockAndRecovery() {
  const b = legacyBoot(), g=b.g, initial=totals(g.s);
  assert.equal(g.s.version,36);
  assert.deepEqual(clone(g.presetBook),[null,null]);
  assert.deepEqual(clone(g.s.objectivePin),legacy.session.objectivePin);
  assert.equal(b.storage.get(oldKey),JSON.stringify(legacy.session));
  assert.equal(g.s.equipment.bag.find(u=>u.g==='radio').gear.durability,100);
  assert.deepEqual(clone(g.s.equipment.bag).map(({gear,...tile})=>tile),legacy.session.equipment.bag);
  good(g.savePreset(0,alpha,light));
  good(g.savePreset(1,bravo,scout));
  assert.deepEqual(clone(g.presetBook).map(p=>p.name),[alpha,bravo]);
  assert.deepEqual(totals(g.s),initial);
  beforeAfter(b,()=>good(g.presetPreview(light)));
  const oneBattery=g.presetPreview(starving);
  bad(oneBattery);
  const row=requirement(oneBattery,'battery');
  assert.deepEqual([row.needed,row.owned,row.missing],[2,1,1]);
  beforeAfter(b,()=>bad(g.applyPreset(starving)));
  for (const wrong of [
    make({comms:'radio'},{comms:'optic'}),
    make({eyes:'radio'},{eyes:'optic'}),
    make({},{light:'battery'}),
    make({left:'flash'},{})
  ]) beforeAfter(b,()=>bad(g.applyPreset(wrong)));
  const independent=clone(namedCase(g.s).contents.find(x=>x.g==='matches'));
  good(g.applyPreset(g.presetBook[0]));
  assert.deepEqual(clone(g.s.equipment.modules),light.modules);
  assert.equal(g.s.stash.flash,undefined);
  assert.equal(namedCase(g.s).contents.some(x=>x.g==='battery'),false);
  assert.deepEqual(clone(namedCase(g.s).contents.find(x=>x.g==='matches')),independent);
  assert.deepEqual(totals(g.s),initial);
  const same=inventory(g.s);
  good(g.applyPreset(g.presetBook[0])); assert.deepEqual(inventory(g.s),same);
  const preview=g.presetPreview(g.presetBook[1]);good(preview);
  assert.ok(preview.returns.some(row=>row.id==='battery'&&row.quantity===1));
  good(g.applyPreset(g.presetBook[1]));
  assert.deepEqual(clone(g.s.equipment.worn),scout.worn);
  assert.deepEqual(clone(g.s.equipment.modules),scout.modules);
  assert.deepEqual(Array.from(g.s.equipment.bag,x=>x.g),['water']);
  assert.deepEqual(Array.from(namedCase(g.s).contents,x=>x.g),['matches']);
  assert.equal(g.s.stash.battery,1);assert.equal(g.s.stash.flash,1);
  assert.deepEqual(totals(g.s),initial);
  valid(g);
  const reloaded=boot(b.storage,b.clock);
  const backup=await reloaded.exportData();assert.ok(reloaded.g.check(backup));
  const fresh=boot({},b.clock);
  await fresh.g.importFile(new Blob([JSON.stringify(backup)]));
  assert.deepEqual(inventory(fresh.g.s),inventory(g.s));
  assert.deepEqual(clone(fresh.g.presetBook),clone(g.presetBook));
  console.log('PASS authentic v20 migration, two named v21 combinations, dry-run, all ownership scopes, shortage ×2/×1 and incompatible slot, repeat apply and separate-profile JSON import.');
}
async function activeVersion20Transfers() {
  // Both deltas came from v0.20's own backup exporter, branching from the same
  // complete inventory fixture. Fixtures never need v0.20 source at test time.
  const checkpoints=require('./fixtures/presets-v20-field.json');
  for (const [kind,checkpoint] of Object.entries(checkpoints)) {
    const raw={...clone(legacy.session),...clone(checkpoint.sessionChanges)};
    const oldJson=JSON.stringify(raw);
    for (const transfer of ['local','backup']) {
      const clock={now:checkpoint.now};
      const b=boot(transfer==='local'?{[oldKey]:clone(raw)}:{},clock),g=b.g;
      if(transfer==='backup'){
        const data={format:'rustline-tc01',session:raw};assert.ok(g.check(data));
        await g.importFile(new Blob([JSON.stringify(data)]));
      }
      assert.equal(g.s.version,36);assert.deepEqual(clone(g.presetBook),[null,null]);
      assert.deepEqual(clone(g.s.equipment.modules),{});
      assert.deepEqual(legacyGearShape(g.s.field),{...raw.field,modules:{},lootLocks:{raidId:raw.raid.startedAt,legacy:true,unlocked:[]}});
      for(const key of ['raid','stash','stashSlots','objectivePin','wallet','career'])
        assert.deepEqual(legacyGearShape(g.s[key]),raw[key],kind+' '+transfer+' '+key);
      assert.deepEqual(legacyGearShape(g.s.equipment),{...raw.equipment,modules:{}});
      const backup=await b.exportData();assert.ok(g.check(backup));
      const reloaded=boot(b.storage,clock);
      assert.deepEqual(clone(reloaded.g.s.field.action),raw.field.action);
      if(kind==='route'){
        assert.equal(g.journeyTiming().arrivalAt,1800000030000);
        assert.equal(g.journeyTiming().remainingMs,26000);
        assert.deepEqual(clone(g.s.field.journey.schedule),raw.field.journey.schedule);
        finish(reloaded);
        assert.equal(reloaded.g.s.field.journey.supply,'battery');
        const bag=reloaded.g.s.field.bag.length;
        go(reloaded,'journey-take');assert.equal(reloaded.g.s.field.bag.length,bag+1);
        assert.equal(reloaded.g.s.field.bag.at(-1).g,'battery');
        finish(reloaded);assert.ok(reloaded.g.s.field.contact);
        reloaded.setRandom(.01);go(reloaded,'evade');finish(reloaded);finish(reloaded);
        assert.equal(reloaded.g.s.raid.zone,2);
      }else{
        const key=raw.field.action.key,first=raw.field.action.uid;
        const revealed=raw.field.boxes[key].items.filter(u=>u.revealed).length;
        finish(reloaded);
        const sameBox=reloaded.g.s.field.boxes[key];
        assert.equal(sameBox.items.filter(u=>u.revealed).length,revealed+1);
        assert.equal(sameBox.items.find(u=>u.uid===first).revealed,true);
      }
      valid(reloaded.g);
      if(transfer==='local')assert.equal(b.storage.get(oldKey),oldJson);
    }
  }
  console.log('PASS two authentic v20 in-flight checkpoints × local migration and file import: 26s route ETA, frozen encounters and supply, exact 1.8s search target/timer and one reveal.');
}
function failureAndConcurrency() {
  const b=legacyBoot(), g=b.g;
  good(g.savePreset(0,alpha,light));
  const original=b.storage.set;
  b.storage.set=()=>{throw Error('test quota')};
  beforeAfter(b,()=>bad(g.applyPreset(light)));
  const oldBook=clone(g.presetBook);
  beforeAfter(b,()=>bad(g.savePreset(1,bravo,scout)));
  assert.deepEqual(clone(g.presetBook),oldBook);
  b.storage.set=original;
  good(g.applyPreset(light));assert.equal(g.s.equipment.modules.light,'battery');
  // The second tab commits a different loadout, before the first confirms its preview.
  const second=boot(b.storage,b.clock);
  good(second.g.applyPreset(scout));
  const onDisk=b.storage.get(saveKey);
  bad(g.applyPreset(light));
  assert.equal(b.storage.get(saveKey),onDisk);
  assert.deepEqual(inventory(g.s),inventory(second.g.s));
  // A real bag that fits the 6×6 issued pack, but exceeds a 3×2 pocket.
  const filled=clone(legacy.session);
  for(let i=0;i<7;i++)filled.equipment.bag.push({uid:'kit-bandage-'+i,g:'bandage',x:2+i%4,y:Math.floor(i/4),w:1,h:1,revealed:true});
  const packed=legacyBoot(filled);valid(packed.g);
  const small={worn:{primary:'rl10_carbine'},modules:{}};
  beforeAfter(packed,()=>{
    bad(packed.g.presetPreview(small));
    bad(packed.g.applyPreset(small));
  });
  console.log('PASS failed storage writes and retries, stale tab loses to disk revision, oversized retained cargo cancels the entire transaction.');
}
function warehouseAndBackupBoundaries() {
  const full=clone(legacy.session);
  full.stash={matches:192,battery:1,flash:1};
  full.stashSlots=Array.from({length:192},(_,i)=>({
    uid:'s-tile-'+i,g:'matches',x:i%6,y:Math.floor(i/6),w:1,h:1
  }));
  const b=legacyBoot(full),g=b.g;
  valid(g);
  assert.equal(g.s.stashSlots.length,192);
  assert.equal(g.s.stashSlots.filter(u=>u.g==='battery'||u.g==='flash').length,0);
  // Headroom in the incoming-goods queue does not constitute a physical slot for returns.
  beforeAfter(b,()=>bad(g.applyPreset({worn:{back:'issued_pack'},modules:{}})));
  // Taking queued goods without returning any does not require a free grid cell.
  const initial=totals(g.s);
  good(g.applyPreset(light));
  assert.deepEqual(totals(g.s),initial);
  assert.equal(g.s.stashSlots.length,192);assert.equal(g.s.stash.battery,undefined);
  beforeAfter(b,()=>bad(g.applyPreset(make({},{}))));
  const stored=clone(g.s);
  const reject=mutate=>{
    const invalid=clone(stored);mutate(invalid);
    assert.equal(g.check({format:'rustline-tc01',session:invalid}),false);
  };
  reject(s=>s.equipment.modules.light='optic');
  reject(s=>s.equipment.modules.comms='battery');
  reject(s=>s.presets=[null]);
  reject(s=>s.presets=[{name:'길'.repeat(25),...light},null]);
  reject(s=>s.presets=[{name:alpha,worn:{light:'flash'},modules:{eyes:'optic'}},null]);
  const readOnly=boot(b.storage,b.clock,{locks:{request(){return new Promise(()=>{})}}});
  assert.equal(readOnly.g.w,false);
  const before=b.storage.get(saveKey);
  bad(readOnly.g.savePreset(0,alpha,light));bad(readOnly.g.applyPreset(scout));
  assert.equal(b.storage.get(saveKey),before);
  console.log('PASS physical warehouse saturation and queued stock, five invalid v21 backup variants and read-only tab operations.');
}
async function raidsAndLegacyActions() {
  const b=legacyBoot(),g=b.g,initial=totals(g.s);
  good(g.savePreset(0,alpha,light));good(g.savePreset(1,bravo,scout));
  good(g.applyPreset(g.presetBook[0]));g.start();
  assert.equal(g.s.field.modules.light,'battery');assert.deepEqual(clone(g.s.equipment.modules||{}),{});
  assert.equal(g.actionDuration('scan',10000),7200);
  beforeAfter(b,()=>bad(g.applyPreset(scout)));
  const backed=await b.exportData();assert.ok(g.check(backed));
  const restored=boot({},b.clock);await restored.g.importFile(new Blob([JSON.stringify(backed)]));
  assert.equal(restored.g.s.field.modules.light,'battery');assert.deepEqual(totals(restored.g.s),initial);
  extract(b);assert.equal(g.s.field.result,'success');assert.equal(g.s.equipment.modules.light,'battery');
  g.ack();good(g.applyPreset(g.presetBook[1]));b.clock.now+=1000;g.start();
  assert.deepEqual(clone(g.s.field.modules),scout.modules);
  assert.equal(g.actionDuration('scan',10000),9000);assert.equal(g.actionDuration('search',10000),9000);
  assert.deepEqual(totals(g.s),initial);
  // A physical host retains its installed component when it is dropped and recovered.
  g.gear({gear:'ground-worn',slot:'eyes'});
  assert.ok(!g.s.field.modules.eyes);
  let dropped=g.s.field.gearGround[0];
  assert.equal(dropped.filter(u=>u.g==='optic').length,0);
  assert.equal(dropped.find(u=>u.g==='rl_13_07').gear.module,'optic');
  assert.equal(dropped.filter(u=>u.g==='rl_13_07').length,1);
  assert.deepEqual(totals(g.s),initial);
  g.gear({gear:'recover',unit:dropped.find(x=>x.g==='rl_13_07').uid});
  assert.deepEqual(totals(g.s),initial);
  go(b,'abandon');g.ack();
  const remaining=totals(g.s);assert.equal(remaining.flash,1);assert.equal(remaining.battery,1);
  for(const id of ['optic','radio','rl_13_07','rl_13_02'])assert.equal(remaining[id],undefined);
  assert.equal(namedCase(g.s).contents.length,1);
  bad(g.presetPreview(g.presetBook[1]));valid(g);
  console.log('PASS two equipped sorties and live timings, active backup restoration, extraction and loss, in-field detachment/recovery and retained warehouse goods.');
}
(async()=>{await mixedStockAndRecovery();await activeVersion20Transfers();failureAndConcurrency();warehouseAndBackupBoundaries();await raidsAndLegacyActions()})().catch(error=>{console.error(error);process.exitCode=1});
