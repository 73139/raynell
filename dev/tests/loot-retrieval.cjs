// The public transfer operation must commit the box and bag together, even across two tabs.
const {assert,boot,clone,finish,go,valid,v12}=require('./game-fixture.cjs');
const keyId='rl_16_14';

function preparedPantry(){
  const b=boot(),g=b.g;
  assert.ok(g.trade('supply','buy',keyId,1).ok);
  g.gear({gear:'pack',id:keyId});
  b.setRandom(.72);g.start();b.setRandom(.01);
  go(b,'landmark',{index:3});
  for(let n=0;n<2;n++){go(b,'scan');finish(b);}
  assert.equal(g.lootBoxIsLocked(0,8),true);
  go(b,'open',{index:8});assert.equal(g.s.field.open,null);
  const before=clone(g.s.field.boxes['0-8']);
  assert.ok(g.unlockLootBox(g.s.raid.startedAt,0,8).ok);
  assert.deepEqual(clone(g.s.field.boxes['0-8']),before);
  go(b,'search');while(g.s.field.action)finish(b);
  return b;
}

async function restorePlan(){
  const before=boot({},undefined,{},'#lootplan'), g=before.g;
  before.click({lootplan:'goal',id:'medical'});
  const zone=1, point=g.places[zone].findIndex(l=>l.name==='검역 천막');
  before.click({lootplan:'candidate',zone:String(zone),landmark:String(point)});
  assert.deepEqual(clone(g.s.lootDestination),{goal:'medical',zone,index:point});
  const data=await before.exportData();
  assert.equal(data.session.plannedDepartureZone,zone);
  const imported=boot({},before.clock);
  await imported.g.importFile(new Blob([JSON.stringify(data)]));
  imported.g.start();
  assert.equal(imported.g.s.raid.zone,zone);
  assert.equal(imported.g.s.field.landmarkByZone[zone],point);
  assert.deepEqual(clone(imported.g.s.field.found[zone]),[]);
  g.moveNow(0);
  const alternate=await before.exportData();
  const other=boot({},before.clock);
  await other.g.importFile(new Blob([JSON.stringify(alternate)]));
  other.g.start();assert.equal(other.g.s.raid.zone,0);
  assert.equal(other.g.s.lootDestination.zone,zone);
  console.log('PASS exact planned destination and an explicitly changed deployment zone survive independent pre-departure JSON; arrival still needs a real scan.');
}
async function run(){
  await restorePlan();
  const b=preparedPantry(),g=b.g,code='0-8';
  const originals=clone(g.s.field.boxes[code].items),before=clone(g.s.field.bag),logs=clone(g.s.field.log);
  assert.ok(originals.length>=2);
  const unit=originals[0],originalWrite=b.storage.set;
  b.storage.set=()=>{throw Error('quota during field pickup')};
  g.selectLoot(unit.uid);
  assert.deepEqual(clone(g.s.field.bag),before);
  assert.deepEqual(clone(g.s.field.boxes[code].items),originals);
  assert.deepEqual(clone(g.s.field.log),logs);
  b.storage.set=originalWrite;
  const stale=boot(b.storage,b.clock);
  // Instantiating a second simulated writer advances the saved revision. Rebase the first one normally.
  const winner=boot(b.storage,b.clock);winner.g.selectLoot(unit.uid);
  stale.g.selectLoot(unit.uid);
  const saved=JSON.parse(b.storage.get(v12));
  for(const snap of [winner.g.s,stale.g.s,saved]){
    assert.equal(snap.field.bag.filter(u=>u.uid===unit.uid).length,1);
    assert.equal(snap.field.bag.filter(u=>u.g===keyId).length,1);
    assert.deepEqual(clone(snap.field.boxes[code].items),originals.slice(1));
    assert.deepEqual(clone(snap.field.lootLocks.unlocked),[code]);
  }
  const file=await winner.exportData(), imported=boot({},b.clock);
  await imported.g.importFile(new Blob([JSON.stringify(file)]));
  assert.deepEqual(clone(imported.g.s.field.boxes[code]),clone(saved.field.boxes[code]));
  assert.deepEqual(clone(imported.g.s.field.bag),clone(saved.field.bag));
  go(imported,'close');go(imported,'open',{index:8});
  imported.g.selectLoot(unit.uid);
  assert.deepEqual(clone(imported.g.s.field.bag),clone(saved.field.bag));
  assert.deepEqual(clone(imported.g.s.field.boxes[code].items),originals.slice(1));
  valid(imported.g);
  console.log('PASS real tier-one purchase, carried reusable key, engine denies raw open, storage quota rollback on pickup, concurrent writers cannot duplicate a UID, partial box cells and bag survive independent JSON and reopening.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
