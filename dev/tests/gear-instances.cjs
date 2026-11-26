// Normal game entry points perform every move, purchase and settlement. The two condition values
// in the first fixture represent previously used, already-owned equipment.
const {setTestCash,assert,boot,clone,extract,go,valid,v12}=require('./game-fixture.cjs');
const gun='rl10_carbine';
const shape=g=>[g.uid,g.g,g.ammo,g.durability,g.module];
const get=(g,uid)=>g.gearOwned().find(r=>r.gear.uid===uid);
function twoGuns(){
  const initial=boot(), state=clone(initial.g.s);
  state.stash={optic:1,rs_case_weapon:1};
  state.stashSlots=[{uid:'s-optic',g:'optic',x:0,y:0,w:1,h:1},
    {...initial.g.unit('rs_case_weapon'),uid:'s-weapon-box',x:0,y:1}];
  const record=state.equipment.instances.primary;
  record.ammo=7;record.durability=40;
  const b=boot({[v12]:state}),g=b.g;
  assert.ok(g.trade('quarter','buy',gun,1).ok);
  const other=g.gearOwned().find(r=>r.gear.g===gun&&r.location==='stash').gear.uid;
  assert.notEqual(other,record.uid);
  const target=g.presetCurrent();target.modules.primary='optic';
  assert.ok(g.applyPreset(target).ok);valid(g);
  return {b,g,old:record.uid,other};
}
async function physicalMoves(){
  const {b,g,old,other}=twoGuns(), one=[old,gun,7,40,'optic'],two=[other,gun,30,100,null];
  g.gear({gear:'wear-instance',unit:other});
  assert.deepEqual(shape(g.s.equipment.instances.primary),two);
  assert.deepEqual(shape(get(g,old).gear),one);
  assert.equal(g.s.stash.optic,undefined);
  assert.equal(g.searchOwned(g.goods.optic[0]).filter(r=>r.id==='optic').length,1);
  assert.ok(g.caseMove('s-weapon-box','put',gun).ok);
  assert.equal(get(g,old).location,'case');
  assert.deepEqual(shape(get(g,old).gear),one);
  const originalSet=b.storage.set, before=clone(g.s);
  b.storage.set=()=>{throw Error('quota')};
  g.gear({gear:'wear-instance',unit:old});
  assert.deepEqual(clone(g.s),before);
  b.storage.set=originalSet;
  g.gear({gear:'wear-instance',unit:old});
  assert.equal(get(g,old).location,'worn');
  assert.deepEqual(shape(get(g,old).gear),one);
  assert.deepEqual(shape(get(g,other).gear),two);
  const source=get(g,other);
  g.gear({gear:'pack',id:gun,unit:source.unit.uid});
  assert.equal(get(g,other).location,'bag');
  g.start();
  assert.deepEqual(shape(g.s.field.instances.primary),one);
  g.gear({gear:'wear-bag',unit:g.s.field.bag.find(u=>u.gear?.uid===other).uid});
  assert.deepEqual(shape(g.s.field.instances.primary),two);
  const ground=g.s.field.gearGround[0].find(u=>u.gear?.uid===old);
  assert.deepEqual(shape(ground.gear),one);
  g.gear({gear:'recover',unit:ground.uid});valid(g);
  const restored=boot({},b.clock);
  await restored.g.importFile(new Blob([JSON.stringify(await b.exportData())]));
  assert.deepEqual(shape(restored.g.s.field.instances.primary),two);
  assert.deepEqual(shape(restored.g.s.field.bag.find(u=>u.gear?.uid===old).gear),one);
  extract(restored);restored.g.ack();valid(restored.g);
  assert.deepEqual(shape(get(restored.g,old).gear),one);
  assert.equal(get(restored.g,old).location,'stash');
  assert.deepEqual(shape(get(restored.g,other).gear),two);
  const raw=await restored.exportData();
  for(const mutate of [
    s=>s.stashSlots.find(u=>u.gear).gear.uid=other,
    s=>s.stashSlots.find(u=>u.gear).gear.ammo=31,
    s=>s.stashSlots.find(u=>u.gear).gear.durability=-1,
    s=>s.equipment.instances.primary.module='battery',
    s=>delete s.equipment.instances.primary,
    s=>s.gearOverflow.push({...s.equipment.instances.primary,uid:'inconsistent-overflow'}),
    s=>s.stashSlots.find(u=>u.gear).gear.g='rl12_sidearm'
  ]){
    const malformed=clone(raw);
    mutate(malformed.session);
    assert.equal(restored.g.check(malformed),false);
  }
  restored.clock.now+=1000;restored.g.start();go(restored,'abandon');restored.g.ack();
  assert.equal(get(restored.g,other),undefined);assert.deepEqual(shape(get(restored.g,old).gear),one);
  console.log('PASS purchased same-model spare, mounted optic, case/equip/bag/ground/recover, failed exchange rollback, independent export/import, extracted bag UID, worn loss and seven invalid backups.');
}
function presetAttachedIncoming(){
  const {g,old,other}=twoGuns();
  g.gear({gear:'unwear',slot:'primary'});
  assert.ok(g.caseMove('s-weapon-box','put',gun).ok);
  assert.equal(get(g,old).location,'case');
  assert.equal(g.s.stash.optic,undefined);
  const plan={worn:{back:'issued_pack',primary:gun},modules:{primary:'optic'}};
  assert.ok(g.applyPreset(plan).ok);
  assert.equal(g.s.equipment.instances.primary.uid,old);
  assert.deepEqual(shape(g.s.equipment.instances.primary),[old,gun,7,40,'optic']);
  assert.equal(get(g,other).location,'stash');
  const unmodded=g.presetCurrent();delete unmodded.modules.primary;
  assert.ok(g.applyPreset(unmodded).ok);
  assert.equal(g.s.stash.optic,1);assert.equal(g.s.equipment.instances.primary.uid,old);
  assert.equal(g.s.equipment.instances.primary.module,null);
  console.log('PASS preset consumes the selected host and its installed part once, explicit workshop detach returns one part and preserves host condition.');
}
function overflow(){
  const seed=boot().g,state=clone(seed.s);
  setTestCash(state,30000000); state.stash={bolt:192};
  state.stashSlots=Array.from({length:192},(_,i)=>({...seed.unit('bolt'),uid:'s-fill-'+i,x:i%6,y:Math.floor(i/6)}));
  const b=boot({[v12]:state}),g=b.g, old=g.s.equipment.instances.primary.uid;
  assert.ok(g.trade('quarter','buy',gun,2).ok);
  const a=g.s.gearOverflow[0].uid,c=g.s.gearOverflow[1].uid;
  assert.notEqual(a,c);assert.equal(g.s.stash[gun],2);
  assert.ok(g.gearOwned().filter(r=>r.location==='overflow').length===2);
  const set=b.storage.set,before=clone(g.s);
  b.storage.set=()=>{throw Error('quota')};
  assert.equal(g.trade('quarter','buy',gun,1).ok,false);
  assert.deepEqual(clone(g.s),before);
  assert.equal(g.trade('quarter','sell',gun,1).ok,false);
  assert.deepEqual(clone(g.s),before);
  b.storage.set=set;
  g.gear({gear:'wear-instance',unit:c});
  assert.equal(g.s.equipment.instances.primary.uid,c);
  assert.deepEqual(Array.from(g.s.gearOverflow,x=>x.uid).sort(),[a,old].sort());
  assert.ok(g.trade('quarter','buy',gun,150).ok);
  const lots=g.s.gearOverflow.filter(x=>x.batch);assert.equal(lots.length,1);assert.equal(lots[0].batch.count,150);
  valid(g);
  const first=lots[0].uid;
  g.gear({gear:'wear-instance',unit:first});
  assert.equal(g.s.equipment.instances.primary.uid,first);assert.equal(g.s.equipment.instances.primary.batch,undefined);
  assert.equal(g.s.gearOverflow.find(x=>x.batch).batch.count,149);
  valid(g);
  assert.ok(g.trade('quarter','sell',gun,150).ok);valid(g);
  assert.equal(g.s.stash[gun],2);
  console.log('PASS full-grid purchases retain two individually selectable UIDs, failed buy/sale preserve queue, and a 150-unit bulk serial range remains valid through equip and sale.');
}
physicalMoves().then(()=>{presetAttachedIncoming();overflow()}).catch(e=>{console.error(e);process.exitCode=1});
