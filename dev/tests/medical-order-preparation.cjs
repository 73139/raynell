const {assert,boot,clone,finish,go,v12,valid}=require('./game-fixture.cjs');
const key='rl_16_19',order='med-supply';

function pin(b){
  b.g.order(order);
  assert.ok(b.g.pin({kind:'order',id:order}));
}
function status(b,expected,screen='prep'){
  b.click({page:screen});
  const panel=b.content().match(/<section data-order-readiness>[\s\S]*?<\/section>/)?.[0];
  assert.ok(panel);
  assert.match(panel,/data-ready-site="0-7" data-key-state="free"[\s\S]*열쇠 없이 개방 가능/);
  assert.ok(panel.includes('data-ready-site="1-1" data-key-state="'+expected+'"'));
  if(screen==='prep')assert.match(b.content(),/<button[^>]+data-raid="start"[^>]*>/);
  return panel;
}
function deployAndTry(b,canOpen){
  const g=b.g;
  g.moveNow(1);g.start();
  go(b,'landmark',{index:1});go(b,'scan');finish(b);
  assert.equal(g.lootLockView(1,2).carried,canOpen);
  assert.equal(g.unlockLootBox(g.s.raid.startedAt,1,2).ok,canOpen);
  assert.equal(g.s.field.open,canOpen?'1-2':null);
  b.click({page:'map'});
  assert.doesNotMatch(b.content(),/data-order-readiness/);
  valid(g);
}
function shoppingAndLoadout(){
  const b=boot(),g=b.g;
  b.click({page:'prep'});
  assert.doesNotMatch(b.content(),/data-order-readiness/);
  pin(b);
  assert.match(status(b,'missing','map'),/윤서진의 열쇠 보기/);
  const before=g.s.wallet;
  b.click({lootplan:'shop',id:key});
  assert.match(b.content(),/data-trader="medic"/);
  assert.equal(g.s.wallet,before);
  assert.equal(g.stock(key),0);
  assert.ok(g.trade('medic','buy',key,1).ok);
  const stored=status(b,'stored');
  const location=stored.match(/data-pos="locate" data-key="([^"]+)"/)[1];
  const beforeLocate=clone(g.s);
  b.click({pos:'locate',key:location});
  assert.deepEqual(clone(g.s),beforeLocate);
  assert.ok(b.content().includes('data-gear="wear-stash"'));
  assert.ok(b.content().includes('data-gear="pack"'));
  deployAndTry(boot(new Map(b.storage),b.clock),false);

  g.gear({gear:'pack',id:key});
  status(b,'bag');
  deployAndTry(boot(new Map(b.storage),b.clock),true);
  const packed=g.s.equipment.bag.find(u=>u.g===key);
  g.gear({gear:'wear-bag',unit:packed.uid});
  status(b,'equipped','map');
  deployAndTry(boot(new Map(b.storage),b.clock),true);

  const reload=boot(b.storage,b.clock);
  status(reload,'equipped');
  reload.g.gear({gear:'unwear',slot:'access'});
  status(reload,'stored');
  assert.ok(reload.g.pin(null));
  reload.click({page:'prep'});
  assert.doesNotMatch(reload.content(),/data-order-readiness/);
}
function nestedKey(){
  const base=clone(boot().g.s);
  base.stash={rs_case_keys:1};
  const b=boot({[v12]:base});
  b.click({page:'inventory'});b.click({loadout:'sort'});
  const ring=b.g.s.stashSlots.find(slot=>slot.g==='rs_case_keys');
  assert.ok(ring);
  assert.ok(b.g.trade('medic','buy',key,1).ok);
  assert.ok(b.g.caseMove(ring.uid,'put',key).ok);
  pin(b);
  const panel=status(b,'stored');
  assert.ok(!b.g.stock(key));
  assert.match(panel,/data-key="case:/);
  assert.ok(panel.includes('출격 장비로 옮겨야 개방 가능'));
  const target=panel.match(/data-pos="locate" data-key="([^"]+)"/)[1];
  b.click({pos:'locate',key:target});
  assert.ok(b.content().includes('data-stash="case-take"'));
  deployAndTry(b,false);
}
function queuedKey(){
  const saved=clone(boot().g.s);
  saved.stash={matches:192,[key]:1};
  saved.stashSlots=Array.from({length:192},(_,i)=>({uid:'s-filler-'+i,g:'matches',x:i%6,y:Math.floor(i/6),w:1,h:1}));
  const b=boot({[v12]:saved});
  pin(b);
  const panel=status(b,'stored');
  assert.match(panel,/창고 입고 대기/);
  assert.match(panel,/data-key="overflow:rl_16_19"/);
  assert.equal(b.g.s.stashSlots.filter(item=>item.g===key).length,0);
  deployAndTry(b,false);
}
shoppingAndLoadout();nestedKey();queuedKey();
console.log('PASS pinned pre-raid medical routes, missing/loose/case/bag/equipped key, exact merchant/storage navigation, persisted loadout, and actual field opening rules.');
