// Physical CR follows the same ownership, revision, settlement and backup paths as other inventory.
const {assert,boot,clone,epoch,extract,go,valid,v12}=require('./game-fixture.cjs');
const v28='rl-reboot-session-v28';
const copy=b=>clone(b.g.s);
const cash=(list)=>list.filter(u=>u.g==='cr_notes');
function conserved(g,total){
  const s=g.s,available=s.cash.pocket.concat(cash(s.stashSlots)).reduce((n,u)=>n+u.amount,0);
  assert.equal(s.wallet,available);assert.equal(g.cashBalance(),available);
  assert.equal(available+cash(s.equipment.bag).concat(cash(s.field.bag),...(s.field.gearGround||[]).map(cash)).reduce((n,u)=>n+u.amount,0),total);
  valid(g);
}
function fillWarehouse(s,empty=0){
  s.stashSlots=Array.from({length:192-empty},(_,i)=>({uid:'s-bolt-'+i,g:'bolt',x:i%6,y:Math.floor(i/6),w:1,h:1}));
  s.stash={bolt:s.stashSlots.length};
}
async function run(){
  const old=copy(boot()); old.version=28;delete old.cash;old.wallet=347001;fillWarehouse(old);
  let b=boot({[v28]:old}),g=b.g;
  conserved(g,347001);assert.deepEqual(clone(g.s.stashSlots),old.stashSlots);
  assert.equal(g.s.cash.pocket.length,1);assert.equal(g.s.cash.pocket[0].amount,347001);
  b=boot(b.storage,b.clock);g=b.g;conserved(g,347001);
  let u=g.s.cash.pocket[0];assert.ok(!g.cashAction(u.uid,'stash',25).ok);conserved(g,347001);
  assert.ok(g.cashAction(u.uid,'pocket',1000,5,1).ok);conserved(g,347001);
  let split=g.s.cash.pocket.find(r=>r.uid!==u.uid);
  assert.ok(g.cashAction(split.uid,'pocket',250,undefined,undefined,u.uid).ok);
  assert.equal(g.s.cash.pocket.find(r=>r.uid===split.uid).amount,750);
  assert.ok(g.cashAction(split.uid,'bag').ok);conserved(g,347001);assert.equal(g.fee,346251);
  b=boot(b.storage,b.clock);g=b.g;conserved(g,347001);
  assert.equal(g.s.equipment.bag[0].uid,split.uid);
  assert.ok(g.cashAction(split.uid,'pocket').ok);conserved(g,347001);
  const full=copy(b);fillWarehouse(full,1);b=boot({[v12]:full});g=b.g;
  u=g.s.cash.pocket[0];assert.ok(g.cashAction(u.uid,'stash',900).ok);
  const tile=cash(g.s.stashSlots)[0];assert.equal(tile.amount,900);
  assert.deepEqual([tile.x,tile.y],[5,31]);assert.equal(g.s.stash.cr_notes,1);
  assert.equal(g.accepts('medic','cr_notes'),false);
  assert.ok(!g.saleQuote('medic',[tile.uid]).ok);conserved(g,347001);
  let restored=boot(b.storage);conserved(restored.g,347001);
  assert.equal(cash(restored.g.s.stashSlots)[0].uid,tile.uid);
  const raw=await b.exportData();assert.ok(g.check(raw));
  const importing=boot();await importing.g.importFile(new Blob([JSON.stringify(raw)]));
  conserved(importing.g,347001);assert.deepEqual(clone(importing.g.s.cash),raw.session.cash);
  assert.equal(cash(importing.g.s.stashSlots)[0].uid,tile.uid);
  const paidBack=boot({[v12]:clone(raw.session)});
  const bolt=paidBack.g.s.stashSlots[0];
  const accepted=paidBack.g.saleQuote('repair',[bolt.uid]);assert.ok(accepted.ok);
  assert.ok(paidBack.g.saleCommit('repair',[bolt.uid],accepted.token).ok);
  conserved(paidBack.g,347001+accepted.total);
  for(const edit of [
    s=>{s.wallet++},s=>{s.cash.pocket[0].amount=-1},s=>{s.cash.pocket[0].uid=tile.uid},
    s=>{s.cash.pocket[0].x=6},s=>{s.cash.pocket[1].x=s.cash.pocket[0].x;s.cash.pocket[1].y=s.cash.pocket[0].y;},
    s=>{s.stash.cr_notes++},s=>{s.stashSlots.at(-1).amount=1.5},s=>{delete s.cash},
    s=>{s.cash.pocket[0].uid=s.stashSlots[0].uid}
  ]){let corrupted=clone(raw);edit(corrupted.session);assert.ok(!g.check(corrupted));}
  b=restored;g=b.g;const before=JSON.stringify(g.s),setter=b.storage.set;b.storage.set=()=>{throw Error('quota')};
  assert.ok(!g.cashAction(tile.uid,'bag').ok);assert.equal(JSON.stringify(g.s),before);b.storage.set=setter;
  const other=boot(b.storage,b.clock);assert.ok(other.g.cashAction(tile.uid,'bag').ok);
  assert.ok(!g.cashAction(tile.uid,'pocket').ok);assert.equal(g.s.equipment.bag[0].uid,tile.uid);
  conserved(g,347001);
  const gift=copy(boot());fillWarehouse(gift,1);
  b=boot({[v12]:gift});g=b.g;
  u=g.s.cash.pocket[0];assert.ok(g.cashAction(u.uid,'stash').ok);
  assert.ok(g.cashAction(u.uid,'bag',25500).ok);
  assert.equal(g.fee,4500);
  assert.ok(g.marketCartAdd('medic','bandage',1).ok);
  assert.ok(g.marketCartCheckout('medic',g.marketCartView('medic').token).ok);
  assert.equal(g.fee,0);assert.equal(g.s.stash.bandage,1);assert.equal(g.s.stash.cr_notes,undefined);
  assert.equal(g.s.stashSlots.length,192);conserved(g,25500);
  const sell=g.s.stashSlots.find(s=>s.g==='bandage');
  let q=g.saleQuote('medic',[sell.uid]);assert.ok(q.ok);assert.ok(g.saleCommit('medic',[sell.uid],q.token).ok);
  assert.equal(g.fee,q.total);assert.equal(g.s.cash.pocket[0].amount,q.total);conserved(g,25500+q.total);
  b=boot();g=b.g;assert.ok(g.cashAction(g.s.cash.pocket[0].uid,'bag',5500).ok);
  g.start();conserved(g,30000);assert.equal(cash(g.s.field.bag)[0].amount,5500);
  b=boot(b.storage,b.clock);g=b.g;extract(b);assert.equal(g.s.lastSummary.carriedCash,5500);
  assert.equal(g.fee,30000);conserved(g,30000);g.ack();
  assert.ok(g.cashAction(g.s.cash.pocket[0].uid,'bag',7000).ok);g.start();
  go(b,'abandon');if(!g.s.field.result){b.clock.now=g.s.raid.endsAt;g.tick();}
  assert.equal(g.fee,23000);assert.equal(g.s.lastSummary.carriedCash,7000);assert.equal(g.s.career.history[0].carriedCash,7000);assert.equal(g.s.career.history[0].cash,0);conserved(g,23000);
  restored=boot(b.storage,b.clock);conserved(restored.g,23000);
  console.log('PASS physical CR: full v28 warehouse migration, split/merge, stash coordinates, carried cash, last-note checkout, sale receipt, quota/conflict, backup validation, extraction and loss.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
