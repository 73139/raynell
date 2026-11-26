// Exercise mixed ownership while opening exactly the cells needed for the old gear.
const {assert,boot,clone,v12,valid} = require('./game-fixture.cjs');

function fullWarehouse(hosts,oldWorn,bag,modules={}) {
  const base = boot().g, state = clone(base.s);
  let serial = 0;
  function tile(id,x,y) {
    return {...base.unit(id),uid:'s-placement-'+(++serial),x,y};
  }
  state.stash = {};
  state.stashSlots = hosts.map(([id,x,y]) => tile(id,x,y));
  for (let y=0;y<32;y++) for (let x=0;x<6;x++) {
    if (state.stashSlots.some(u => u.x<=x && u.x+u.w>x && u.y<=y && u.y+u.h>y)) continue;
    state.stashSlots.push(tile('bolt',x,y));
  }
  for (const u of state.stashSlots) state.stash[u.g]=(state.stash[u.g] || 0)+1;
  state.equipment.worn = oldWorn;
  state.equipment.modules = modules;
  state.equipment.bag = bag.map(([id,x,y]) => tile(id,x,y));
  return boot({[v12]:state}).g;
}
function applyWithConservation(g,target) {
  const counted = ['flash','water','radio','rl_13_07','rl10_vest','battery','bolt'];
  const tally = () => counted.map(id => g.presetStock(id));
  const original = tally(), disk = clone(g.s);
  const preview = g.presetPreview(target);
  assert.equal(preview.ok,true,preview.message);
  assert.deepEqual(clone(g.s),disk,'preview must not claim or reserve real stock');
  assert.equal(g.applyPreset(target).ok,true);
  assert.deepEqual(tally(),original,'all physical items retained');
  const after = clone(g.s);
  assert.equal(g.applyPreset(target).ok,true);
  assert.deepEqual(clone(g.s.equipment),after.equipment);
  assert.deepEqual(clone(g.s.stashSlots),after.stashSlots);
  valid(g);
}

{
  // Drawing both from either single source fails. Taking one from each fits exactly.
  const g = fullWarehouse([['radio',0,0],['rl_13_07',1,0]],
    {back:'issued_pack',light:'flash'},
    [['radio',0,0],['rl_13_07',1,0],['water',2,0],['water',3,0]]);
  applyWithConservation(g,{worn:{eyes:'rl_13_07',comms:'radio'},modules:{}});
  assert.equal(g.s.equipment.bag.length,3);
  assert.equal(g.s.stash.flash,1);
}
{
  // The most recently placed duplicates at opposite corners leave two separate gaps.
  // Only the adjacent pair can receive the 2×2 vest.
  const g = fullWarehouse([['radio',0,0],['rl_13_07',1,0],['radio',4,4],['rl_13_07',0,28]],
    {armor:'rl10_vest'},[]);
  applyWithConservation(g,{worn:{eyes:'rl_13_07',comms:'radio'},modules:{}});
  const vest = g.s.stashSlots.find(u => u.g==='rl10_vest');
  assert.equal(vest.x,0);
  assert.equal(vest.y,0);
  assert.deepEqual(clone(g.s.stashSlots.filter(u=>u.g==='radio'||u.g==='rl_13_07').map(u=>[u.g,u.x,u.y])),
    [['radio',4,4],['rl_13_07',0,28]]);
}
{
  // Two 1×1 batteries are required. Removing one from each source leaves room for both
  // the 1×1 key in the warehouse and the remaining supplies in the six pocket cells.
  const actual = fullWarehouse([['battery',0,0],['battery',4,12]],
    {back:'issued_pack',light:'flash',access:'key',comms:'radio'},
    [['battery',0,0],['battery',1,0],['water',2,0],['water',3,0],['bolt',4,0]]);
  applyWithConservation(actual,{worn:{light:'flash',comms:'radio'},modules:{light:'battery',comms:'battery'}});
  assert.equal(actual.s.equipment.bag.filter(u=>u.g==='battery').length,1);
  assert.equal(actual.s.stash.battery,1);
}
{
  // An inner UID is scoped to its physical case. Equal local IDs in separate cases are
  // two items, and a single reservation of each must leave both original cases identifiable.
  const base=boot().g,s=clone(base.s);
  s.equipment.worn={comms:'radio',light:'flash'};
  s.equipment.instances=Object.fromEntries([['comms','radio'],['light','flash']].map(([slot,g])=>
    [slot,{uid:'s-host-'+slot,g,ammo:0,durability:100,module:null}]));
  s.stash={rs_case_junk:2};
  s.stashSlots=['첫 상자','둘째 상자'].map((alias,index) => ({
    ...base.unit('rs_case_junk'),uid:'s-parts-'+index,alias,y:index*4,
    contents:[{...base.unit('battery'),uid:'s-same-local-id'}]
  }));
  assert.equal(base.check({format:'rustline-tc01',session:s}),true);
  const game=boot({[v12]:s}).g;
  applyWithConservation(game,{worn:game.s.equipment.worn,modules:{comms:'battery',light:'battery'}});
  assert.deepEqual(clone(game.s.stashSlots.map(box => [box.uid,box.alias,box.contents.length])),
    [['s-parts-0','첫 상자',0],['s-parts-1','둘째 상자',0]]);
}
console.log('Preset placement passed: mixed sources under dual capacity constraints, adjacent donor selection, split allocation of two identical modules, equal local IDs in two named cases.');
