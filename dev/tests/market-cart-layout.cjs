// Compare the real order planner with an independent test on every possible 3 × 2 opening.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');

function openCells(mask) {
  return Array.from({length:6},(_,i)=>i).filter(i=>(mask & (1<<i))!==0);
}

function canFitOrder(cells) {
  if(cells.length<5)return false;
  const neighbours=[];
  for(const a of cells)for(const b of cells) {
    if(b<=a)continue;
    const distance=Math.abs(a%3-b%3)+Math.abs(Math.floor(a/3)-Math.floor(b/3));
    if(distance===1)neighbours.push([a,b]);
  }
  return neighbours.some(([a,b])=>neighbours.some(([c,d])=>a!==c&&a!==d&&b!==c&&b!==d));
}

const initial=clone(boot().g.s);
let fitsCount=0,failCount=0;
for(let mask=0;mask<64;mask++) {
  const cells=openCells(mask),seed=clone(initial);
  seed.stashSlots=[];
  for(let y=0;y<32;y++)for(let x=0;x<6;x++) {
    if(y<2 && x<3 && cells.includes(y*3+x))continue;
    seed.stashSlots.push({uid:'s-block-'+x+'-'+y,g:'bolt',x,y,w:1,h:1});
  }
  seed.stash={bolt:seed.stashSlots.length};
  const player=boot({[v12]:seed}),g=player.g;
  assert.ok(g.marketCartAdd('supply','matches',1).ok);
  assert.ok(g.marketCartAdd('supply','water',2).ok);
  const cart=g.marketCartView('supply');
  const expected=canFitOrder(cells),prior=clone(g.s);
  assert.equal(cart.ok,expected,'preview mask '+mask);
  const result=g.marketCartCheckout('supply',cart.token);
  assert.equal(result.ok,expected,'checkout mask '+mask);
  if(expected) {
    fitsCount++;
    assert.equal(g.s.wallet,18500);
    const incoming=g.s.stashSlots.filter(u=>u.g!=='bolt');
    assert.deepEqual(Array.from(incoming,u=>u.g).sort(),['matches','water','water']);
    const used=new Set();
    for(const u of incoming)for(let dy=0;dy<u.h;dy++)for(let dx=0;dx<u.w;dx++) {
      const x=u.x+dx,y=u.y+dy,i=y*3+x;
      assert.ok(x<3&&y<2&&cells.includes(i)&&!used.has(i),'valid placement');
      used.add(i);
    }
    assert.equal(used.size,5);
    assert.deepEqual(clone(g.s.stashSlots.filter(u=>u.g==='bolt')),seed.stashSlots);
    valid(g);
  }else{
    failCount++;
    assert.deepEqual(clone(g.s),prior,'failed order changes no persistent game state');
  }
}
assert.equal(fitsCount+failCount,64);assert.ok(fitsCount>=5&&failCount>50);
console.log('PASS exhaustive 64 six-cell layouts for two 1×2 water bottles and one 1×1 matchbox ('+fitsCount+' fit, '+failCount+' fully rejected), actual unique grid cells, original inventory preserved.');
