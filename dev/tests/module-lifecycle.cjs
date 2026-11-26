// Check the normal field/search/settlement entry points in the distributed game.
const {assert,boot,clone,extract,finish,go,v12,valid} = require('./game-fixture.cjs');

function prepare(){
  const state=clone(boot().g.s);
  state.stash={flash:1,radio:1,rl_13_07:1,rl_13_08:1,battery:2,optic:1,rl_13_02:1};
  state.hideout.levels.power=1;
  delete state.stashSlots;
  const b=boot({[v12]:state});
  const target=b.g.presetCurrent();
  Object.assign(target.worn,{light:'flash',eyes:'rl_13_07',comms:'radio'});
  Object.assign(target.modules,{light:'battery',eyes:'optic',comms:'battery'});
  assert.ok(b.g.applyPreset(target).ok);
  return b;
}
const hits=(g,id)=>g.searchOwned(g.goods[id][0]).filter(row=>row.id===id);
const count=(g,id)=>hits(g,id).reduce((sum,row)=>sum+row.quantity,0);
function fieldTimersAndReceipts(){
  const b=prepare(),g=b.g;
  let rows=hits(g,'battery');
  assert.equal(rows.length,2);
  assert.equal(new Set(rows.map(row=>row.key)).size,2);
  assert.ok(rows.every(row=>row.kind==='module' && row.scope==='bunker'));
  assert.ok(g.pin({kind:'facility',id:'comms',tier:1}));
  const comm=()=>g.objective().materials.find(row=>row.id==='radio');
  assert.equal(comm().owned,1);assert.equal(comm().usable,0);
  g.start();
  assert.equal(comm().field,0);assert.equal(comm().fieldWorn,1);
  assert.ok(hits(g,'battery').every(row=>row.scope==='raid'));
  go(b,'scan');
  assert.equal(g.s.field.action.end-g.s.field.action.start,2880);
  finish(b);
  const boxIndex=g.s.field.found[0][0];
  const box=g.s.field.boxes['0-'+boxIndex];
  // Three hidden entries exercise the first clock and both queued search clocks.
  box.items=[0,1,2].map(i=>({...g.unit('bandage'),uid:'test-box-'+i,x:i,revealed:false}));
  go(b,'open',{index:boxIndex}); go(b,'search');
  for(let i=0;i<3;i++){
    const action=g.s.field.action;
    assert.equal(action.type,'search');
    assert.equal(action.end-action.start,1458);
    finish(b);
    assert.equal(box.items.filter(o=>o.revealed).length,i+1);
  }
  go(b,'close');
  assert.ok(!g.s.field.contact);
  extract(b);
  const report=clone(g.s.lastSummary);
  assert.equal(report.worn.find(row=>row.slot==='eyes').module,'optic');
  assert.equal(report.worn.filter(row=>row.module==='battery').length,2);
  assert.equal(count(g,'battery'),2);
  assert.ok(hits(g,'battery').every(row=>row.scope==='bunker'));
  g.ack();
  g.gear({gear:'wear-stash',id:'rl_13_08'});
  assert.equal(g.s.equipment.worn.eyes,'rl_13_08');
  assert.equal(g.s.equipment.modules.eyes,undefined);
  assert.equal(g.s.stash.optic,undefined);assert.equal(g.s.stashSlots.find(u=>u.g==='rl_13_07').gear.module,'optic');assert.equal(g.s.stash.rl_13_07,1);
  g.gear({gear:'unwear',slot:'light'});
  assert.equal(g.s.stash.battery,undefined);assert.equal(g.s.stashSlots.find(u=>u.g==='flash').gear.module,'battery');
  assert.equal(count(g,'battery'),2);
  assert.equal(g.s.equipment.modules.comms,'battery');
  valid(g);
}
function manualStorageFailure(){
  const b=prepare(),g=b.g, original=b.storage.set;
  const equipped=clone(g.s.equipment),stock=clone(g.s.stash);
  b.storage.set=()=>{throw Error('quota')};
  g.gear({gear:'unwear',slot:'light'});
  assert.deepEqual(clone(g.s.equipment),equipped);
  assert.deepEqual(clone(g.s.stash),stock);
  b.storage.set=original;
  g.gear({gear:'unwear',slot:'light'});
  assert.equal(g.s.stash.battery,undefined);assert.equal(g.s.stashSlots.find(u=>u.g==='flash').gear.module,'battery');
  assert.equal(g.s.equipment.modules.light,undefined);
  g.start();
  const field=clone(g.s.field);
  b.storage.set=()=>{throw Error('quota')};
  g.gear({gear:'ground-worn',slot:'eyes'});
  assert.deepEqual(clone(g.s.field),field);
  b.storage.set=original;
}
function warehouseCountLimit(){
  const b=prepare(),seed=clone(b.g.s);
  for(const id of ['rl_13_07']){
    const capped=clone(seed);
    capped.stash[id]=Number.MAX_SAFE_INTEGER;
    const player=boot({[v12]:capped}),g=player.g;
    const state=clone(g.s.equipment),grid=clone(g.s.stashSlots);
    g.gear({gear:'wear-stash',id:'rl_13_08'});
    assert.deepEqual(clone(g.s.equipment),state);
    assert.deepEqual(clone(g.s.stashSlots),grid);
    assert.equal(g.s.stash.rl_13_08,1);
  }
}
function runtimeBackups(){
  const b=prepare(),g=b.g;
  const target=g.presetCurrent();
  target.modules.comms='rl_13_02';
  assert.ok(g.applyPreset(target).ok);
  assert.ok(g.savePreset(0,'야간 <A&B>',target).ok);
  const live=()=>({format:'rustline-tc01',session:clone(g.s)});
  valid(g);
  g.start();
  assert.equal(g.actionDuration('scan',4000),2592);
  assert.equal(g.actionDuration('search',1800),1620);
  assert.equal(g.actionDuration('move',10000),10000);
  valid(g);
  let bad=live();bad.session.field.modules.comms='optic';
  assert.equal(g.check(bad),false);
  bad=live();bad.session.equipment.modules.light='battery';
  assert.equal(g.check(bad),false);
  bad=live();bad.session.presets[0].modules.eyes='battery';
  assert.equal(g.check(bad),false);
  go(b,'abandon');
  valid(g);
  bad=live();bad.session.lastSummary.worn.find(row=>row.slot==='light').module='optic';
  assert.equal(g.check(bad),false);
  const restored=boot(b.storage,b.clock);
  assert.equal(restored.g.s.lastSummary.worn.find(row=>row.slot==='comms').module,'rl_13_02');
  assert.equal(restored.g.s.presets[0].name,'야간 <A&B>');
}
fieldTimersAndReceipts();
manualStorageFailure();
warehouseCountLimit();
runtimeBackups();
console.log('PASS installed-part ownership, bunker/field objective availability, repeated search timing and stacking, old gear actions, return/loss receipts and strict module validation.');
