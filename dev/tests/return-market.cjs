const {assert,boot,clone,extract,finish,go,stamp,v12,valid}=require('./game-fixture.cjs');

function recovered(normal=false){
  const b=boot(),g=b.g;
  b.setRandom(.1);g.start();
  go(b,'landmark',{index:7});go(b,'scan');finish(b);
  const box=g.places[0][7].boxes[0];
  go(b,'open',{index:box});go(b,'search');finish(b);
  const bandage=g.s.field.boxes['0-'+box].items.find(item=>item.g==='bandage');
  g.selectLoot(bandage.uid);go(b,'close');
  if(normal)stamp(b,g.s.raid.startedAt+7*60000);
  extract(b);
  return b;
}
function enterReport(b){b.click({page:'raid'});return b.content();}
function sale(b,data={}){
  b.click({raid:'sale',trader:'medic',id:'bandage',returnId:String(b.g.s.raid?.startedAt),...data});
}
function priceAndConfirmedSale(normal){
  const b=recovered(normal),g=b.g,panel=enterReport(b),before=clone(g.s);
  assert.equal(g.s.lastSummary.rating,normal?'success':'quick');
  assert.match(panel,/<details data-return-market><summary>매입처·단가 보기/);
  assert.match(panel,/data-return-item="bandage"/);
  const buyers=g.traders.filter(t=>g.accepts(t.id,'bandage'));
  const quoted=g.quote('medic','sell','bandage').unit;
  assert.ok(panel.includes('data-return-unit="'+quoted+'"'));
  assert.deepEqual([...panel.matchAll(/data-raid="sale" data-trader="([^"]+)"/g)].map(m=>m[1]),Array.from(buyers,t=>t.id));
  const id=String(g.s.raid.startedAt);
  sale(b,{trader:'repair'});sale(b,{returnId:String(Number(id)-1)});
  assert.deepEqual(clone(g.s),before);
  sale(b);
  assert.equal(g.s.raid,null);
  assert.match(b.content(),/data-market="mode" data-mode="sell" aria-pressed="true"/);
  assert.doesNotMatch(b.content(),/data-tg="sell-remove"/);
  assert.deepEqual(clone(g.s.stash),before.stash);
  assert.deepEqual(clone(g.s.stashSlots),before.stashSlots);
  assert.deepEqual(clone(g.s.saleReceipts),before.saleReceipts);
  assert.equal(g.s.wallet,before.wallet);
  const sold=g.s.stashSlots.find(u=>u.g==='bandage').uid;
  const quote=g.saleQuote('medic',[sold]);
  assert.equal(quote.ok,true);assert.equal(quote.total,quoted);
  assert.ok(g.saleCommit('medic',[sold],quote.token).ok);
  assert.equal(g.s.wallet,before.wallet+quoted);
  const paid=clone(g.s);
  sale(b,{returnId:id});
  assert.deepEqual(clone(g.s),paid);
  valid(g);
}
function failedAndStale(){
  const b=recovered();enterReport(b);
  const disk=b.storage.get(v12),set=b.storage.set;
  b.storage.set=()=>{throw Error('simulated quota');};
  sale(b);b.storage.set=set;
  assert.equal(b.storage.get(v12),disk);
  assert.ok(b.g.s.raid);
  assert.match(b.content(),/복귀 기록을 저장하지 못했습니다/);
  assert.match(b.content(),/data-return-market/);
  const viewer=boot(b.storage,b.clock,{locks:{request:()=>new Promise(()=>{})}});enterReport(viewer);
  assert.match(viewer.content(),/data-raid="sale"[^>]+disabled/);
  sale(viewer);assert.ok(viewer.g.s.raid);
  const newer=boot(b.storage,b.clock);
  newer.g.ack();newer.clock.now++;newer.g.start();
  const active=clone(newer.g.s),latest=b.storage.get(v12);
  sale(b);
  assert.equal(b.storage.get(v12),latest);
  assert.equal(b.g.s.raid.startedAt,active.raid.startedAt);
  assert.doesNotMatch(b.content(),/data-return-market|data-tg="sell-confirm"/);
}
function restrictedAndQueue(){
  const b=recovered(),before=clone(b.g.s);
  function show(edit){
    const snap=clone(before);edit(snap);
    const variant=boot({[v12]:snap},b.clock);
    return enterReport(variant);
  }
  assert.doesNotMatch(show(s=>{s.lastSummary.raidId--;}),/data-return-market/);
  assert.doesNotMatch(show(s=>{delete s.lastSummary.rating;}),/data-return-market/);
  assert.doesNotMatch(show(s=>{s.lastSummary.goods=[];}),/data-return-market/);
  assert.doesNotMatch(show(s=>{s.lastSummary.goods=['cr_notes','rl_bp_dressing','rl_craft_dressing','rl_x_core','keycard','rs_case_docs'];}),/data-return-market/);
  assert.doesNotMatch(show(s=>{
    s.stash={matches:192,bandage:1};
    s.stashSlots=Array.from({length:192},(_,i)=>({uid:'s-filler-'+i,g:'matches',x:i%6,y:Math.floor(i/6),w:1,h:1}));
  }),/data-return-market/);
  const loss=boot();loss.g.start();go(loss,'abandon');
  assert.doesNotMatch(enterReport(loss),/data-return-market/);
}
function multipleBuyers(){
  const b=boot(),g=b.g;
  assert.ok(g.trade('medic','buy','soap',2).ok);
  g.gear({gear:'pack',id:'soap'});g.gear({gear:'pack',id:'soap'});
  g.start();extract(b);
  const panel=enterReport(b).match(/<details data-return-market>[\s\S]*?<\/details>/)[0];
  assert.equal((panel.match(/data-return-item="soap"/g)||[]).length,1);
  assert.match(panel,/data-trader="supply"/);assert.match(panel,/data-trader="medic"/);
  assert.ok(panel.includes('data-return-unit="'+g.quote('medic','sell','soap').unit+'"'));
  sale(b,{trader:'supply',id:'soap'});
  assert.equal(g.stock('soap'),2);
  assert.match(b.content(),/data-market="mode" data-mode="sell" aria-pressed="true"/);
}
priceAndConfirmedSale(false);priceAndConfirmedSale(true);failedAndStale();restrictedAndQueue();multipleBuyers();
console.log('PASS return-market prices and buyers, normal/quick real recovery, explicit UID sale matches price, no auto transfer, stale id/other tab, quota rollback, viewer, queue, special items, loss and old receipts.');
