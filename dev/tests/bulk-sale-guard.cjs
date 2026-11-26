// Check the legacy quantity-based trade entry point independently of grid sale and hand-ins.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const gun='rl10_carbine';
function fixture(overflow){
  const seed=boot().g,s=clone(seed.s);
  const [_,w,h]=seed.goods[gun];
  const plain={uid:'bulk-plain',g:gun,ammo:30,durability:100,module:null};
  const fitted={uid:'bulk-fitted',g:gun,ammo:7,durability:40,module:'optic'};
  s.stash=overflow?{bolt:192,[gun]:2}:{[gun]:2};
  s.stashSlots=overflow?Array.from({length:192},(_,i)=>({...seed.unit('bolt'),uid:'s-fill-'+i,x:i%6,y:Math.floor(i/6)})):
    [{uid:'s-plain',g:gun,x:0,y:0,w,h,gear:plain},{uid:'s-fitted',g:gun,x:0,y:h,w,h,gear:fitted}];
  // Fitted first in the queue, fitted last in the grid: both previously selected for sale.
  s.gearOverflow=overflow?[fitted,plain]:[];
  return {b:boot({[v12]:s}),fitted};
}
for(const overflow of [false,true]){
  const {b,fitted}=fixture(overflow),g=b.g;
  valid(g);
  const before=clone(g.s),wallet=before.wallet;
  assert.equal(g.quote('quarter','sell',gun,1).max,1);
  assert.equal(g.trade('quarter','sell',gun,2).ok,false);
  assert.deepEqual(clone(g.s),before);
  const set=b.storage.set;
  b.storage.set=()=>{throw Error('quota')};
  assert.equal(g.trade('quarter','sell',gun,1).ok,false);
  assert.deepEqual(clone(g.s),before);
  b.storage.set=set;
  const result=g.trade('quarter','sell',gun,1);
  assert.equal(result.ok,true);
  assert.equal(g.s.wallet,wallet+result.total);
  assert.equal(g.stock(gun),1);
  assert.deepEqual(clone(g.gearOwned().find(r=>r.gear.uid===fitted.uid).gear),fitted);
  assert.equal(g.gearOwned().some(r=>r.gear.uid==='bulk-plain'),false);
  assert.equal(g.quote('quarter','sell',gun,1).ok,false);
  assert.equal(g.listed('quarter','sell').includes(gun),false);
  const persisted=clone(g.s);
  const reopened=boot(new Map(b.storage),b.clock).g;
  assert.equal(reopened.trade('quarter','sell',gun,1).ok,false);
  assert.deepEqual(clone(reopened.s),persisted);
  valid(reopened);
  console.log('PASS fitted host and module preserved in '+(overflow?'overflow':'grid')+'; quote, rollback and reload agree.');
}
