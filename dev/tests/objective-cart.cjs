// Run against the actual built browser script. No synthetic order is delivered by this test.
const {setTestCash,assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const plan=g=>g.objectiveCartView();
const line=(g,item)=>plan(g).lines.find(row=>row.item===item);
const draft=(g,trader)=>g.s.marketCarts.traders[trader];
const add=(g,trader=null)=>g.objectiveCartApply(plan(g).token,trader);
function startMedical(){
  const s=clone(boot().g.s);
  s.career.sorties=2;s.career.returns=2;
  s.campaign={claimed:[1700000000000,1700000100000],delivered:0,returnId:null};
  s.hideout.levels.power=1;s.hideout.levels.water=1;
  s.stash={bandage:2,gauze:2,medkit:1};
  delete s.stashSlots;
  const b=boot({[v12]:s});assert.ok(b.g.pin({kind:'campaign',id:'med'}));valid(b.g);
  return b;
}
function inspectSaveWrites(b,run){
  const original=b.storage.set;let writes=0;
  b.storage.set=function(k,v){if(k===v12)writes++;return original.call(this,k,v);};
  try{return {result:run(),writes};}finally{b.storage.set=original;}
}
function medical(){
  const {g}=startMedical();
  assert.ok(g.marketCartAdd('medic','bandage',1,{x:4,y:1}).ok);
  const before=clone(g.s), price=g.price('bandage'), token=plan(g).token, m=line(g,'bandage');
  assert.deepEqual([m.required,m.owned,m.usable,m.missing,m.inCart,m.add,m.subtotal],[5,2,2,3,1,2,2*price]);
  assert.equal(add(g,'supply').ok,false);
  const result=g.objectiveCartApply(token,'medic');
  assert.ok(result.ok);assert.equal(result.total,9000);
  const r=draft(g,'medic');
  assert.deepEqual(clone(r.items),[{item:'bandage',quantity:3,x:4,y:1}]);
  assert.equal(g.s.wallet,before.wallet);assert.deepEqual(clone(g.s.stashSlots),before.stashSlots);
  assert.deepEqual(clone(g.s.cash),before.cash);
  assert.equal(line(g,'bandage').status,'covered');
  assert.equal(g.objectiveCartApply(token).ok,false);assert.equal(r.token,draft(g,'medic').token);
  assert.ok(g.marketCartCheckout('medic',r.token).ok);
  assert.deepEqual([line(g,'bandage').missing,line(g,'bandage').add,g.stock('bandage'),g.fee],[0,0,5,16500]);
  assert.equal(plan(g).ok,false);assert.ok(plan(g).goals.length);
  valid(g);
}
function severalMerchants(){
  const b=boot(),g=b.g;assert.ok(g.pin({kind:'campaign',id:'power'}));
  // The actual first power restoration stage needs food for aid and industrial goods for construction.
  const initial=plan(g);
  assert.deepEqual(clone(initial.groups.map(x=>x.trader)),['supply','repair']);
  assert.equal(initial.quantity,7);
  assert.ok(g.marketCartAdd('medic','gauze',1).ok);
  const unrelated=clone(draft(g,'medic'));
  const snap=clone(g.s),fresh=plan(g),fee=g.fee;
  const {result,writes}=inspectSaveWrites(b,()=>g.objectiveCartApply(fresh.token));
  assert.ok(result.ok);assert.equal(writes,1);
  assert.equal(result.total,2*g.price('food')+g.price('fuel')+2*g.price('wire')+2*g.price('bolt'));
  assert.equal(g.fee,fee);assert.deepEqual(clone(g.s.stash),snap.stash);
  assert.deepEqual(clone(draft(g,'medic')),unrelated);
  assert.equal(draft(g,'supply').items[0].quantity,2);assert.equal(draft(g,'repair').items.length,3);
  const reloaded=boot(b.storage,b.clock).g;
  assert.equal(plan(reloaded).quantity,0);assert.deepEqual(clone(reloaded.s.marketCarts),clone(g.s.marketCarts));
  assert.ok(reloaded.marketCartCheckout('supply',draft(reloaded,'supply').token).ok);
  assert.equal(line(reloaded,'food').missing,0);assert.equal(line(reloaded,'wire').missing,2);
  assert.equal(draft(reloaded,'repair').items.length,3);valid(reloaded);
}
function failures(){
  const b=boot(),g=b.g;assert.ok(g.pin({kind:'campaign',id:'power'}));
  const before=clone(g.s),token=plan(g).token,original=b.storage.set;
  b.storage.set=()=>{throw Error('simulated storage quota');};
  try{assert.equal(g.objectiveCartApply(token).ok,false);assert.deepEqual(clone(g.s),before);}
  finally{b.storage.set=original;}
  const winner=boot(b.storage,b.clock).g;
  assert.ok(winner.marketCartAdd('supply','food',1).ok);
  assert.equal(g.objectiveCartApply(token).ok,false);
  assert.deepEqual(clone(g.s.marketCarts),clone(winner.s.marketCarts));assert.equal(g.s.wallet,before.wallet);
  assert.equal(g.objectiveCartApply(token).ok,false);
  const oldTarget=plan(g).token;assert.ok(g.pin({kind:'facility',id:'med',tier:1}));
  assert.equal(g.objectiveCartApply(oldTarget).ok,false);
  assert.equal(draft(g,'medic'),undefined);
  g.start();assert.equal(plan(g).ok,false);assert.equal(add(g).ok,false);
}
function fundsAndSourceRules(){
  const data=clone(boot().g.s);setTestCash(data,1);
  const {g}=boot({[v12]:data});
  assert.equal(plan(g).source,null);assert.equal(add(g).ok,false);
  assert.ok(g.pin({kind:'facility',id:'med',tier:1}));
  const locked=line(g,'medkit');
  assert.deepEqual([locked.status,locked.trader,locked.add,locked.unit],['unavailable',null,0,0]);
  assert.ok(add(g).ok);assert.equal(g.fee,1);
  assert.equal(g.marketCartCheckout('medic',draft(g,'medic').token).ok,false);
  assert.equal(line(g,'bandage').missing,3);assert.equal(line(g,'bandage').add,0);
  g.order('stores');assert.ok(g.pin({kind:'order',id:'stores'}));
  assert.ok(plan(g).goals.length);assert.equal(plan(g).lines.length,0);assert.equal(add(g).ok,false);valid(g);
}
function eligibleInventory(){
  const initial=clone(boot().g.s);
  initial.stash={wire:2,water:1,rs_case_junk:1};delete initial.stashSlots;
  const g=boot({[v12]:initial}).g;
  const box=g.s.stashSlots.find(u=>u.g==='rs_case_junk');
  assert.ok(g.caseMove(box.uid,'put','wire').ok);
  g.gear({gear:'pack',id:'water'});
  assert.ok(g.pin({kind:'facility',id:'power',tier:1}));
  assert.deepEqual([line(g,'wire').required,line(g,'wire').owned,line(g,'wire').usable,line(g,'wire').add],[2,2,1,1]);
  assert.ok(g.caseMove(box.uid,'take',g.s.stashSlots.find(x=>x.uid===box.uid).contents[0].uid).ok);
  assert.equal(line(g,'wire').add,0);
  assert.ok(g.contract('supply-spare-flask','accept').ok);
  assert.ok(g.pin({kind:'contract',id:'supply-spare-flask'}));
  assert.deepEqual([line(g,'water').required,line(g,'water').usable,line(g,'water').add],[1,1,0]);
  valid(g);
}
function overlapAndExclusive(){
  const {g}=startMedical();
  // An overlapping future catalogue may sell an ordinary retail SKU at two merchants.
  g.traders.find(t=>t.id==='supply').stockTiers[0].push('bandage');
  assert.ok(g.marketCartAdd('supply','bandage',1).ok);
  assert.ok(g.marketCartAdd('medic','bandage',1).ok);
  assert.equal(line(g,'bandage').inCart,2);
  assert.equal(line(g,'bandage').add,1);assert.ok(add(g).ok);
  assert.equal(draft(g,'supply').items[0].quantity+draft(g,'medic').items[0].quantity,3);
  // Simulate future objectives targeting a drop and a barter result even if a bad retail table lists both.
  const q=g.quests.find(quest=>quest.id==='supply-spare-flask');
  assert.ok(g.contract(q.id,'accept').ok);assert.ok(g.pin({kind:'contract',id:q.id}));
  for(const id of ['rl_x_field_ammo','rl_x_armor']){
    q.goals[0].item=id;g.traders[0].stockTiers[0].push(id);
    const restricted=line(g,id);
    assert.deepEqual([restricted.trader,restricted.status,restricted.add,restricted.inCart],[null,'unavailable',0,0]);
    assert.equal(add(g).ok,false);
  }
}
medical();severalMerchants();failures();fundsAndSourceRules();eligibleInventory();overlapAndExclusive();
console.log('PASS pinned objective procurement: 5-2-1=2 with persisted layout; owned-only after checkout; one save across two traders; concurrent/expired quote and failure rollback; overlapping drafts, no duplicates, raid/standing/barter/field-only gates.');
