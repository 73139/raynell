// Shop state and actual button delegation, using the same packed script as the website.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const b=boot(),{g,click}=b;
const open=()=>click({page:'trade'});
const choose=(market,id)=>click({market,id});
const mode=mode=>click({market:'mode',mode});
const buy=(trader,id,qty)=>click({market:'trade',trader,mode:'buy',id,qty:String(qty)});
const counter=(n)=>assert.equal(g.stock('water'),n);
click({page:'home'});assert.match(b.content(),/data-page="trade"/);
assert.match(b.element('.nav').innerHTML,/data-page="trade"/);
open();assert.match(b.content(),/벙커 상점/);
const initial=g.s.wallet;
const all=new Set();
for(const t of g.traders){
  choose('trader',t.id);
  assert.match(b.content(),new RegExp(t.name));
  const items=g.listed(t.id,'buy');assert.ok(items.length);
  for(const id of items){
    assert.ok(g.goods[id],id);
    assert.equal(g.quote(t.id,'buy',id).unit,g.goods[id][6]);
    assert.ok(g.accepts(t.id,id));
    assert.ok(g.quote(t.id,'sell',id).unit<g.quote(t.id,'buy',id).unit);
    all.add(id);
  }
}
assert.equal(g.traders.length,4);
assert.equal(all.size,27);
assert.ok(Object.keys(g.goods).filter(id=>id!=='cr_notes').every(id=>g.traders.some(t=>g.accepts(t.id,id))));
assert.ok(g.traders.every(t=>!g.accepts(t.id,'cr_notes')));
choose('trader','supply');choose('item','water');click({market:'quantity',step:'1'});
buy('supply','water',2);counter(2);assert.equal(g.s.wallet,initial-2*g.price('water'));
buy('supply','water',2);counter(2);
assert.match(b.content(),/계속 거래/);
const reloaded=boot(new Map(b.storage),b.clock);assert.equal(reloaded.g.s.wallet,g.s.wallet);assert.equal(reloaded.g.stock('water'),2);
click({market:'continue'});mode('sell');
const selectedWater=g.s.stashSlots.filter(unit=>unit.g==='water')[1].uid;
click({tg:'stash-select',uid:selectedWater});click({tg:'sell-add',uid:selectedWater});
const sale={tg:'sell-confirm',trader:'supply',token:g.saleQuote('supply',[selectedWater]).token};
click(sale);counter(1);assert.equal(g.s.wallet,initial-2*g.price('water')+Math.floor(g.price('water')/2));
click(sale);counter(1);assert.ok(!g.s.stashSlots.some(unit=>unit.uid===selectedWater));
valid(g);
const before=clone(g.s);
for(const [t,m,id,n] of [
  ['unknown','buy','water',1],['medic','buy','water',1],['medic','sell','water',1],
  ['supply','buy','water',0],['supply','buy','water',-2],['supply','buy','water',.5],
  ['supply','buy','water',100000],['supply','sell','water',2]]){
  assert.equal(g.trade(t,m,id,n).ok,false);
}
assert.deepEqual(clone(g.s),before);
g.start();
assert.equal(g.trade('supply','buy','water').ok,false);
g.field({field:'abandon'});
assert.ok(g.s.field.result);
assert.equal(g.trade('supply','sell','water',1).ok,false);
g.ack();assert.ok(g.quote('supply','sell','water',1).ok);
const linked=boot({},undefined,{},'#shop');assert.match(linked.content(),/벙커 상점/);
const regular=boot();assert.doesNotMatch(regular.content(),/class="mk-screen"/);
const failStore=boot();const beforeFail=clone(failStore.g.s);
failStore.storage.set=()=>{throw Error('simulated full storage')};
assert.equal(failStore.g.trade('supply','buy','water',1).ok,false);
assert.deepEqual(clone(failStore.g.s),beforeFail);
const shared=boot(),stale=boot(shared.storage,shared.clock);
assert.equal(stale.g.trade('supply','buy','water',1).ok,true);
assert.equal(shared.g.trade('supply','buy','water',1).ok,false);
assert.deepEqual(clone(shared.g.s),clone(stale.g.s));
const full=clone(g.s);
full.stash={wire:400};full.stashSlots=[];
const queue=boot({[v12]:full});
assert.ok(queue.g.trade('supply','buy','water',2).ok);
assert.ok(queue.g.trade('supply','sell','water',2).ok);
assert.equal(queue.g.stock('wire'),400);
valid(queue.g);
console.log('PASS: 4 Korean traders with 27 starter offers, every tradable DB item has a buyer, price quotes; buy/sell buttons, receipt and repeat click, old session reload and direct link, invalid quotes, raid/settlement locks, concurrent and failed save rollback, overflow.');
