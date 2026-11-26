// A chosen copy can differ from the default unplaced stock. Exercise the stored game entry point.
const {assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const fixture=require('./fixtures/possessions-v17.json').session;
const start=()=>boot({[v12]:clone(fixture)});
const box='s-rations',other='s-drinks',uid='s-loose-water';
const items=(g,key)=>g.s.stashSlots.find(u=>u.uid===key).contents;

const direct=start(),g=direct.g,original=clone(g.s);
assert.equal(g.caseMove(box,'put','water','s-unknown').ok,false);
assert.deepEqual(clone(g.s),original);
assert.equal(g.caseMove(box,'put','water',uid).ok,true);
assert.equal(g.caseMove(box,'put','water',uid).ok,false);
assert.equal(items(g,box).filter(u=>u.uid===uid).length,1);
assert.deepEqual(clone(items(g,other)),clone(items(start().g,other)));
assert.equal(g.caseMove(box,'take',uid).ok,true);
assert.equal(g.caseMove(box,'take',uid).ok,false);
assert.equal(g.s.stash.water,original.stash.water);
assert.equal(g.s.wallet,original.wallet);
assert.equal(g.s.stashSlots.filter(u=>u.uid===uid&&u.g==='water').length,1);
valid(g);

const unwritable=start(),before=clone(unwritable.g.s);
unwritable.storage.set=()=>{throw Error('storage full');};
assert.equal(unwritable.g.caseMove(box,'put','water',uid).ok,false);
assert.deepEqual(clone(unwritable.g.s),before);
const shared=start(),late=boot(shared.storage);
assert.equal(late.g.caseMove(other,'put','water',uid).ok,true);
assert.equal(shared.g.caseMove(box,'put','water',uid).ok,false);
assert.deepEqual(clone(late.g.s),clone(shared.g.s));
console.log('PASS chosen placed copy, count-only queued twins, exact withdrawal, repeated input, full storage and concurrent writers.');
