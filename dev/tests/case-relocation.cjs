const {assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const fixture=require('./fixtures/possessions-v17.json').session;
const source='s-rations',receiver='s-drinks',water='s-water-a';
const start=()=>boot({[v12]:clone(fixture)});
const box=(s,uid)=>s.stashSlots.find(unit=>unit.uid===uid);
const move=g=>g.moveBetweenCases(source,receiver,water);

const crowded=clone(start().g.s);
for(let y=0;y<32;y++)for(let x=0;x<6;x++){
  if(crowded.stashSlots.some(u=>x>=u.x&&x<u.x+u.w&&y>=u.y&&y<u.y+u.h))continue;
  crowded.stashSlots.push({g:'matches',uid:'s-space-'+x+'-'+y,x,y,w:1,h:1});
  crowded.stash.matches++;
}
const run=boot({[v12]:crowded}),initial=clone(run.g.s);
const chosen=box(initial,source).contents.find(unit=>unit.uid===water);
assert.equal(move(run.g).ok,true);
assert.equal(move(run.g).ok,false);
const reloaded=boot(run.storage).g;
assert.deepEqual(clone(reloaded.s.stash),initial.stash);
assert.equal(reloaded.s.wallet,initial.wallet);
assert.deepEqual(clone(box(reloaded.s,source).contents),box(initial,source).contents.filter(unit=>unit.uid!==water));
assert.deepEqual(clone(box(reloaded.s,receiver).contents),[...box(initial,receiver).contents,chosen]);
valid(reloaded);

const packed=clone(initial),dest=box(packed,receiver);
dest.contents=[];
for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  if(y===0&&x<2)continue;
  dest.contents.push({uid:'s-can-'+x+'-'+y,g:'food',x,y,w:1,h:1});
}
const tight=boot({[v12]:packed}).g;
assert.equal(move(tight).ok,true);
assert.deepEqual(clone(box(tight.s,receiver).contents.at(-1)),{...chosen,x:0,y:0,w:2,h:1});
valid(tight);
const full=clone(tight.s);
box(full,source).contents.push({...chosen,uid:'s-second-water'});
const blocked=boot({[v12]:full}).g,unchanged=clone(blocked.s);
assert.equal(blocked.moveBetweenCases(source,receiver,'s-second-water').ok,false);
assert.equal(blocked.moveBetweenCases(source,source,'s-second-water').ok,false);
assert.equal(blocked.moveBetweenCases(source,'s-loose-matches','s-second-water').ok,false);
assert.deepEqual(clone(blocked.s),unchanged);

const unwritable=start(),before=clone(unwritable.g.s);
unwritable.storage.set=()=>{throw Error('storage full');};
assert.equal(move(unwritable.g).ok,false);
assert.deepEqual(clone(unwritable.g.s),before);
const first=start(),stale=boot(first.storage);
assert.equal(move(stale.g).ok,true);
assert.equal(move(first.g).ok,false);
assert.deepEqual(clone(first.g.s),clone(stale.g.s));
console.log('PASS direct transfer at warehouse capacity, exact physical copy, rotation, full/incompatible receivers, duplicate inputs, save failure, concurrent writer and restored save.');
