// Run against the same single HTML file used for deployment (optional argv[2]).
const {setTestCash,assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const oldKey='rl-reboot-session-v27';
const view=(g,id='medic')=>g.marketCartView(id);
const add=(g,item,n=1,id='medic')=>g.marketCartAdd(id,item,n);
const pay=(g,id='medic',token=view(g,id).token)=>g.marketCartCheckout(id,token);
function seed(update) {
  const copy=clone(boot().g.s);update(copy);return boot({[v12]:copy});
}
function blankGrid(s,free) {
  const cells=[];
  for(let y=0;y<32;y++) for(let x=0;x<6;x++){
    if(free[y]?.[x]==='.') continue;
    cells.push({uid:'s-fixed-'+x+'-'+y,g:'bolt',x,y,w:1,h:1});
  }
  s.stash={bolt:cells.length};s.stashSlots=cells;
}
function buyMedic(g) {
  assert.ok(add(g,'bandage',2).ok);assert.ok(add(g,'gauze').ok);
}
function signatures(g) {
  return JSON.stringify({wallet:g.fee,stash:g.s.stash,slots:g.s.stashSlots,queue:g.s.gearOverflow,cart:g.s.marketCarts});
}
function quota(b,fn) {
  const save=b.storage.set;b.storage.set=()=>{throw Error('quota')};
  try{return fn();}finally{b.storage.set=save;}
}
async function standardAndRetry() {
  const b=boot(),g=b.g;
  assert.ok(add(g,'bandage').ok);assert.ok(add(g,'bandage').ok);assert.ok(add(g,'gauze').ok);
  assert.equal(view(g).quantity,3);assert.equal(view(g).total,13000);assert.equal(view(g).after,17000);
  const offered=view(g).token;
  assert.ok(add(g,'water',1,'supply').ok);
  assert.equal(view(g).token,offered);
  assert.deepEqual(clone(view(g).lines).map(row=>[row.item,row.quantity,row.unit,row.total]),[
    ['bandage',2,4500,9000],['gauze',1,4000,4000]]);
  const draft=await b.exportData(), fresh=boot();assert.ok(g.check(draft));
  await fresh.g.importFile(new Blob([JSON.stringify(draft)]));
  assert.deepEqual(clone(view(fresh.g)),clone(view(g)));
  let writes=0;const original=b.storage.set;
  b.storage.set=function(k,v){if(k===v12)writes++;return original.call(this,k,v);};
  const result=pay(g);assert.ok(result.ok);
  assert.equal(writes,1);assert.equal(result.receipt.before,30000);assert.equal(result.receipt.balance,17000);
  assert.equal(view(g).lines.length,0);assert.equal(view(g,'supply').quantity,1);
  assert.equal(g.s.stash.bandage,2);assert.equal(g.s.stash.gauze,1);assert.equal(g.s.stashSlots.length,3);
  assert.equal(new Set(g.s.stashSlots.map(u=>u.uid)).size,3);valid(g);
  const done=signatures(g);
  const repeat=pay(g,'medic',offered);assert.ok(repeat.replayed);assert.equal(writes,1);assert.equal(signatures(g),done);
  const final=await b.exportData();const c=boot();await c.g.importFile(new Blob([JSON.stringify(final)]));
  assert.deepEqual(clone(view(c.g).receipt),clone(result.receipt));
  assert.ok(pay(c.g,'medic',offered).replayed);
  assert.ok(add(c.g,'soap').ok);const newOrder=view(c.g).token;assert.notEqual(newOrder,offered);
  assert.ok(pay(c.g,'medic',offered).replayed);assert.equal(view(c.g).token,newOrder);
  assert.equal(view(c.g).quantity,1);assert.equal(c.g.fee,17000);
  assert.ok(pay(c.g).ok);assert.equal(c.g.fee,14500);assert.ok(!pay(c.g,'medic',offered).ok);
  console.log('PASS independent merchant drafts and backup, 2×4500 + 1×4000, single write and 3 coordinates, durable receipt and stale button after a new order.');
}
function failures() {
  const b=boot(),g=b.g;
  assert.ok(add(g,'bandage',7).ok);assert.equal(view(g).after,-1500);
  const prior=signatures(g);assert.match(view(g).reason,/CR/);assert.ok(!pay(g).ok);assert.equal(signatures(g),prior);
  assert.ok(g.marketCartSet('medic','bandage',0,view(g).token).ok);
  assert.ok(!add(g,'medkit').ok);assert.ok(!add(g,'bandage',Number.MAX_SAFE_INTEGER).ok);
  buyMedic(g);
  const before=signatures(g),oldDisk=b.storage.get(v12);
  assert.ok(!quota(b,()=>pay(g)).ok);assert.equal(before,signatures(g));assert.equal(b.storage.get(v12),oldDisk);
  assert.ok(!quota(b,()=>g.marketCartSet('medic','bandage',1,view(g).token)).ok);assert.equal(before,signatures(g));
  assert.ok(pay(g).ok);
  const crowded=seed(s=>blankGrid(s,['..####'])),h=crowded.g;buyMedic(h);
  const unchanged=signatures(h);assert.match(view(h).reason,/창고/);assert.ok(!pay(h).ok);assert.equal(signatures(h),unchanged);
  assert.equal(h.stock('bandage'),0);assert.equal(h.stock('gauze'),0);
  assert.ok(h.marketCartSet('medic','gauze',0,view(h).token).ok);assert.ok(pay(h).ok);
  const maxed=seed(s=>{s.stash={bandage:Number.MAX_SAFE_INTEGER};s.stashSlots=[];});
  assert.ok(add(maxed.g,'bandage').ok);assert.ok(!pay(maxed.g).ok);
  const huge=seed(s=>{setTestCash(s,Number.MAX_SAFE_INTEGER);});
  assert.ok(add(huge.g,'bandage',1000000000).ok);
  assert.match(view(huge.g).reason,/창고/);assert.ok(!pay(huge.g).ok);
  g.start();assert.ok(!add(g,'soap').ok);
  console.log('PASS insufficient credits, two free tiles for three units, locked shelf, safe-integer and billion-unit preflight, draft and checkout quota rollback, unchanged partial stock.');
}
function layouts() {
  const b=seed(s=>{setTestCash(s,100000);blankGrid(s,['.#..#.','..###.','......','#....#']);}),g=b.g;
  const old=clone(g.s.stashSlots);
  for(const id of ['rl10_pack','rl10_vest','rl10_carbine'])assert.ok(add(g,id,1,'quarter').ok);
  assert.ok(view(g,'quarter').ok);assert.ok(pay(g,'quarter').ok);
  const all=clone(g.s.stashSlots),newUnits=all.slice(old.length);
  assert.deepEqual(all.slice(0,old.length),old);assert.equal(g.fee,55500);
  assert.equal(newUnits.length,3);assert.equal(g.s.gearOverflow.length,0);
  const host=newUnits.find(u=>u.g==='rl10_carbine');
  assert.equal(host.w,1);assert.equal(host.h,3);assert.equal(host.gear.ammo,30);
  assert.equal(host.gear.durability,100);valid(g);
  const taken=new Set();for(const u of all)for(let y=u.y;y<u.y+u.h;y++)for(let x=u.x;x<u.x+u.w;x++){
    const key=x+','+y;assert.ok(!taken.has(key));taken.add(key);
  }
  const c=seed(s=>{setTestCash(s,100000);blankGrid(s,['.#.#.#','#.#.#.']);}),h=c.g;
  assert.ok(add(h,'rl10_pack',1,'quarter').ok);assert.match(view(h,'quarter').reason,/연속/);
  const prev=signatures(h);assert.ok(!pay(h,'quarter').ok);assert.equal(signatures(h),prev);
  console.log('PASS fragmented warehouse requires rotated 3×2 pack / 1×3 carbine and backtracking; incumbent coordinates untouched, pristine host IDs retained, disconnected area rejected.');
}
function preserveExistingItems() {
  const b=seed(s=>{
    setTestCash(s,60000);s.stash={rs_case_med:1,flash:1,bolt:2};
    s.stashSlots=[
      {uid:'s-existing-case',g:'rs_case_med',x:0,y:0,w:3,h:3,alias:'야간 의료품',
       contents:[{uid:'s-existing-dressing',g:'bandage',x:5,y:4,w:1,h:1}]},
      {uid:'s-existing-torch',g:'flash',x:4,y:4,w:2,h:1,
       gear:{uid:'s-equipped-before',g:'flash',durability:23,ammo:0,module:'battery'}}
    ];
  });
  const g=b.g;assert.equal(g.s.stashSlots.length,2);valid(g);
  const old=clone(g.s.stashSlots);buyMedic(g);assert.ok(pay(g).ok);
  assert.deepEqual(clone(g.s.stashSlots.slice(0,old.length)),old);
  assert.equal(g.stock('bolt'),2);assert.equal(g.s.stashSlots.filter(u=>u.g==='bolt').length,0);
  valid(g);const other=boot(b.storage,b.clock);valid(other.g);
  assert.deepEqual(clone(other.g.s.stashSlots),clone(g.s.stashSlots));
  console.log('PASS a named populated medical case, its inner UID/coordinates, a damaged fitted torch and unrelated waiting stock survive checkout and reload unchanged.');
}
function writers() {
  const b=boot();buyMedic(b.g);
  const c=boot(b.storage,b.clock),token=view(c.g).token;
  // The second writer has the newer revision after loading; old tab cannot overwrite.
  const latest=pay(c.g);assert.ok(latest.ok);
  const replay=pay(b.g,'medic',token);assert.ok(replay.replayed);assert.equal(b.g.fee,17000);
  assert.deepEqual(clone(b.g.s.stashSlots),clone(c.g.s.stashSlots));
  const d=boot(b.storage,b.clock);assert.ok(add(d.g,'soap').ok);const editor=boot(b.storage,b.clock);
  assert.ok(editor.g.marketCartSet('medic','soap',2,view(editor.g).token).ok);
  assert.ok(!pay(d.g).ok);assert.equal(view(d.g).quantity,2);assert.equal(d.g.fee,17000);
  const before=signatures(d.g);assert.ok(!d.g.marketCartSet('medic','soap',0,token).ok);assert.equal(signatures(d.g),before);
  console.log('PASS competing writer committing identical token returns same receipt; other editor changing draft wins, stale checkout/line removal cannot overwrite.');
}
async function malformedAndMigration() {
  const session=clone(boot().g.s);
  session.version=27;delete session.marketCarts;
  const p=boot({[oldKey]:session}),g=p.g;assert.equal(g.fee,session.wallet);
  assert.equal(view(g).quantity,0);buyMedic(g);assert.ok(pay(g).ok);assert.ok(add(g,'bandage').ok);
  const good=await p.exportData();assert.ok(g.check(good));
  const edits=[
    c=>{c.lastTrader='nope';}, c=>{c.traders.medic.items.push({item:'bandage',quantity:1});},
    c=>{c.traders.medic.items[0].item='medkit';}, c=>{c.traders.medic.items[0].quantity=1.5;},
    c=>{c.traders.medic.receipt.total++;}, c=>{c.traders.medic.receipt.balance--;},
    c=>{c.traders.medic.receipt.lines[0].unit++;}, c=>{c.traders.medic.receipt.lines[1].total++;},
    c=>{c.traders.medic.receipt.quantity++;}, c=>{c.traders.medic.token=c.traders.medic.receipt.token;},
    c=>{c.traders.medic.items[0].quantity=Number.MAX_SAFE_INTEGER;},c=>{c.traders.other=c.traders.medic;}
  ];
  for(const edit of edits){const bad=clone(good);edit(bad.session.marketCarts);assert.equal(g.check(bad),false);}
  console.log('PASS old local v27 migration and twelve malformed draft/receipt backups rejected, including locked item, unsafe sums and token reuse.');
}
(async()=>{await standardAndRetry();failures();layouts();preserveExistingItems();writers();await malformedAndMigration();})().catch(e=>{console.error(e);process.exitCode=1;});
