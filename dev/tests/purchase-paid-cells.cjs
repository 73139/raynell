// Physical CR leaves the grid on payment. Check purchase, overflow and rollback as one operation.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');

function paidBoard(cells=192, money=30000) {
  const s=clone(boot().g.s);
  s.cash.pocket=[];
  s.stashSlots=Array.from({length:192},(_,index)=>{
    const isCash=cells===192 || index===0 || index===6;
    const tile={uid:'s-paid-'+index,g:isCash?'cr_notes':'bolt',x:index%6,y:Math.floor(index/6),w:1,h:1};
    if(isCash)tile.amount=cells===192 ? (index===191?money-191:1) : money/2;
    return tile;
  });
  s.stash={cr_notes:cells};
  if(cells<192)s.stash.bolt=192-cells;
  s.wallet=money;
  return boot({[v12]:s});
}
function units(g,item){return clone(g.s.stashSlots.filter(unit=>unit.g===item));}
function savedAgain(b){const restored=boot(new Map(b.storage),b.clock);valid(restored.g);return restored.g;}

// Do not place any older queue entries just because funds moved.
const src=paidBoard(), pending=clone(src.g.s);pending.stash.food=1;
const b=boot({[v12]:pending}),g=b.g;
assert.ok(g.marketCartAdd('supply','matches',1).ok);
const cart=clone(g.s.marketCarts);
assert.ok(g.trade('supply','buy','water',1).ok);
assert.equal(g.s.wallet,25000);
assert.equal(g.cashBalance(),25000);
assert.equal(units(g,'cr_notes').length,1);assert.equal(units(g,'cr_notes')[0].amount,25000);
assert.equal(g.stock('water'),1);assert.equal(units(g,'water').length,1);
assert.deepEqual([units(g,'water')[0].x,units(g,'water')[0].y],[0,0]);
assert.equal(g.stock('food'),1);assert.equal(units(g,'food').length,0);
assert.deepEqual(clone(g.s.marketCarts),cart);
const cold=savedAgain(b);assert.deepEqual(units(cold,'water'),units(g,'water'));assert.equal(cold.cashBalance(),25000);

// Exactly two aligned cells become free. A second 1×2 water remains queued.
const partial=paidBoard(2,10000);assert.ok(partial.g.trade('supply','buy','water',2).ok);
assert.equal(partial.g.cashBalance(),0);assert.equal(partial.g.stock('water'),2);assert.equal(units(partial.g,'water').length,1);
assert.equal(units(partial.g,'bolt').length,190);valid(partial.g);

const failed=paidBoard();const before=clone(failed.g.s);const write=failed.storage.set;
failed.storage.set=()=>{throw new Error('quota')};assert.equal(failed.g.trade('supply','buy','water').ok,false);failed.storage.set=write;
assert.deepEqual(clone(failed.g.s),before);
assert.ok(failed.g.trade('supply','buy','water').ok);assert.equal(units(failed.g,'water').length,1);valid(failed.g);
const shared=paidBoard(), winner=boot(shared.storage,shared.clock);
assert.ok(winner.g.trade('supply','buy','water').ok);assert.equal(shared.g.trade('supply','buy','matches').ok,false);
assert.deepEqual(clone(shared.g.s),clone(winner.g.s));assert.equal(shared.g.stock('matches'),0);valid(shared.g);

// The separate catalog-only material uses the same post-payment geometry.
const shop=paidBoard(),material='rl_08_27';shop.g.lookup(material);shop.g.supply(material);
assert.equal(shop.g.stock(material),1);assert.equal(units(shop.g,material).length,1);
assert.equal(shop.g.s.wallet,30000-shop.g.price(material));valid(shop.g);
console.log('PASS paid cash cells: one physical water, one partial overflow, pre-existing queue and cart preserved, failed write, stale tab, catalog purchase and reload.');
