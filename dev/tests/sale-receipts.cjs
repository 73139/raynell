// Uses the shipped exchange, revision guard, cash projection and native backup path.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
function sell(g,trader,uids){
  const q=g.saleQuote(trader,uids);
  assert.ok(q.ok,q.reason);
  return g.saleCommit(trader,uids,q.token);
}
function warehouse(g){
  return clone({stock:g.s.stash,slots:g.s.stashSlots,cr:g.s.cash,wallet:g.s.wallet,receipts:g.s.saleReceipts,revision:g.s.revision});
}
async function run(){
  const b=boot(),g=b.g;
  assert.deepEqual(clone(g.s.saleReceipts),{});
  for(const [item,n] of [['bandage',2],['gauze',1]])assert.ok(g.marketCartAdd('medic',item,n).ok);
  assert.ok(g.marketCartCheckout('medic',g.marketCartView('medic').token).ok);
  const units=g.s.stashSlots.filter(u=>u.g==='bandage'||u.g==='gauze'),uids=clone(units.map(u=>u.uid));
  const purchase=clone(g.marketCartView('medic').receipt);
  const quote=g.saleQuote('medic',uids),stored=warehouse(g),put=b.storage.set;
  b.storage.set=()=>{throw Error('quota')};
  assert.ok(!g.saleCommit('medic',uids,quote.token).ok);
  assert.deepEqual(warehouse(g),stored);
  let writes=0;b.storage.set=function(k,v){writes++;return put.call(this,k,v)};
  const result=g.saleCommit('medic',uids,quote.token);
  b.storage.set=put;assert.ok(result.ok);assert.equal(writes,1);
  const receipt=clone(g.s.saleReceipts.medic);
  assert.equal(receipt.before,17000);assert.equal(receipt.balance,23500);assert.equal(receipt.total,6500);
  assert.equal(g.cashBalance(),23500);assert.equal(receipt.lines.length,2);
  assert.deepEqual(receipt.lines[0],{item:'bandage',unit:2250,uids:uids.slice(0,2)});
  assert.deepEqual(receipt.lines[1],{item:'gauze',unit:2000,uids:uids.slice(2)});
  const after=warehouse(g);
  assert.ok(!g.saleCommit('medic',uids,quote.token).ok);assert.deepEqual(warehouse(g),after);
  assert.deepEqual(clone(g.marketCartView('medic').receipt),purchase);
  valid(g);
  const checkpoint=await b.exportData(),restored=boot();
  await restored.g.importFile(new Blob([JSON.stringify(checkpoint)]));
  assert.deepEqual(clone(restored.g.s.saleReceipts.medic),receipt);
  const legacy=clone(checkpoint);delete legacy.session.saleReceipts;
  await restored.g.importFile(new Blob([JSON.stringify(legacy)]));
  assert.deepEqual(clone(restored.g.s.saleReceipts),{});assert.equal(restored.g.cashBalance(),23500);

  // Physical cases legitimately accept punctuation in their aliases. Retain independent labels on sale.
  const s=clone(g.s),[,w,h]=g.goods.rs_case_food;
  for(const [n,alias] of ['간식 <왼쪽>','작전 & 예비'].entries()){
    s.stashSlots.push({g:'rs_case_food',uid:'s-named-'+n,x:0,y:h*n,w,h,alias});
  }
  s.stash.rs_case_food=2;
  const c=boot({[v12]:s}),cg=c.g;
  const names=s.stashSlots.filter(u=>u.g==='rs_case_food');
  assert.ok(sell(cg,'supply',names.map(u=>u.uid)).ok);
  const pair=cg.s.saleReceipts.supply;
  assert.deepEqual(clone(pair.lines.map(line=>line.alias)),names.map(u=>u.alias));
  assert.deepEqual(clone(cg.s.saleReceipts.medic),receipt);
  c.click({page:'trade'});c.click({market:'trader',id:'supply'});c.click({market:'mode',mode:'sell'});
  assert.ok(c.content().includes('간식 &lt;왼쪽&gt;'));assert.ok(!c.content().includes('간식 <왼쪽>'));
  const backed=await c.exportData(),fresh=boot();await fresh.g.importFile(new Blob([JSON.stringify(backed)]));
  assert.deepEqual(clone(fresh.g.s.saleReceipts),clone(cg.s.saleReceipts));valid(fresh.g);
  for(const alter of [
    r=>{r.balance++},r=>{r.lines[0].uids[0]=r.lines[1].uids[0]},r=>{r.lines[0].unit=0},
    r=>{r.lines[0].item='cr_notes'},r=>{r.lines[0].alias='x'.repeat(25)},r=>{r.trader='repair'},
    r=>{r.lines.push(r.lines[0])},r=>{r.at=9e15},r=>{r.lines=[]}
  ]){
    const bad=clone(backed);alter(bad.session.saleReceipts.supply);assert.ok(!cg.check(bad));
  }
  // A subsequent sale at the same merchant replaces its receipt; a competing write cannot replace it twice.
  assert.ok(cg.trade('supply','buy','water',1).ok);
  const water=cg.s.stashSlots.find(o=>o.g==='water'),oldq=cg.saleQuote('supply',[water.uid]);
  const winner=boot(c.storage,c.clock);
  assert.ok(sell(winner.g,'supply',[water.uid]).ok);
  assert.ok(!cg.saleCommit('supply',[water.uid],oldq.token).ok);
  assert.deepEqual(clone(cg.s.saleReceipts.supply),clone(winner.g.s.saleReceipts.supply));
  assert.equal(cg.s.saleReceipts.supply.lines.length,1);assert.equal(cg.s.saleReceipts.supply.lines[0].item,'water');
  assert.deepEqual(clone(cg.s.saleReceipts.medic),receipt);valid(cg);
  console.log('PASS exact 2×2,250 + 1×2,000 sale, 17,000 → 23,500 physical CR, one durable revision, quota/double/race behavior, per-trader replacement, named case identity and escaped labels, real backup/restore, legacy absence and nine damaged receipts.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
