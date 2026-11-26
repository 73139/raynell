// Complete a known v0.14 contract from a packed item without visiting the warehouse.
const {assert, boot, clone, v12, valid} = require('./game-fixture.cjs');
const legacy = boot();
const questId = 'supply-spare-flask';
assert.ok(legacy.g.trade('supply','buy','water',2).ok);
legacy.g.gear({gear:'pack',id:'water'});
assert.equal(legacy.g.s.equipment.bag.length,1);
assert.equal(legacy.g.s.stash.water,1);
assert.ok(legacy.g.contract(questId,'accept').ok);
const previouslySaved = clone(legacy.g.s);
delete previouslySaved.periodic;
const b = boot({[v12]:previouslySaved}), g = b.g;
assert.equal(g.status(questId).status,'ready');
assert.ok(g.contract(questId,'claim').ok);
assert.equal(g.s.equipment.bag.length,0,'loose carried unit delivered first');
assert.equal(g.s.stash.water,1,'untouched warehouse unit');
assert.equal(g.fee,23500);
assert.equal(g.standing('supply').points,10);
assert.equal(g.contract(questId,'claim').ok,false);
valid(g);

// With only a packed item, restoring a failed save must restore its original unit and position.
const packed=clone(previouslySaved);packed.stash={};packed.stashSlots=[];
const full=boot({[v12]:packed});
assert.equal(full.g.status(questId).status,'ready');
const snapshot=clone(full.g.s);
full.storage.set=()=>{throw Error('simulated quota')};
assert.equal(full.g.contract(questId,'claim').ok,false);
assert.deepEqual(clone(full.g.s),snapshot);

// A two-unit delivery spans carried and stored inventory in the same claim.
// Worn gear is excluded even when it is the requested item.
const prepped=boot(), scenario=clone(prepped.g.s);
const target=prepped.g.quests.find(q=>q.id==='quarter-faceshields');
const slots=prepped.g.quests.filter(q=>q.trader==='quarter' && q.tier<target.tier).map(q=>q.id);
scenario.contracts.quarter={done:slots,active:{id:target.id,progress:target.goals.map(goal=>goal.type==='delivery'?0:goal.target)}};
scenario.equipment.worn.head='rl12_helmet';
scenario.stash={rl12_helmet:1};scenario.stashSlots=[];
const one=boot({[v12]:scenario});
assert.equal(one.g.status(target.id).status,'active','equipped helmet must stay protected');
assert.equal(one.g.contract(target.id,'claim').ok,false);
one.g.gear({gear:'buy',id:'rl12_helmet'});one.g.gear({gear:'pack',id:'rl12_helmet'});
assert.equal(one.g.s.stash.rl12_helmet,1);
assert.ok(one.g.contract(target.id,'claim').ok);
assert.equal(one.g.s.stash.rl12_helmet,undefined);
assert.equal(one.g.s.equipment.bag.length,0);
assert.equal(one.g.s.equipment.worn.head,'rl12_helmet');
valid(one.g);
console.log('PASS NPC hand-in from carried, mixed sources, worn gear protection, rollback and duplicate claims.');
