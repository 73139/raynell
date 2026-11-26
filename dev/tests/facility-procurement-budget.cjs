// Verify advisory values against real merchant receipts and the same facility's construction debit.
const {assert,boot,clone,valid,v12,setTestCash}=require('./game-fixture.cjs');
const data=require('../Rustline_Database_v10.json');
const source={kind:'facility',id:'power',tier:1};
const pin=(g,target=source)=>assert.ok(g.pin(target));
const quote=g=>g.objectiveCartView();
const figures=g=>{const v=quote(g).budget;return [v.materials,v.inCart,v.build,v.total,v.wallet,v.balance]};
const repairItems=g=>g.s.marketCarts.traders.repair;
const launch=(g,id='power')=>g.build({hideout:'build',id,tier:'1'});
function funds(wallet){
  const s=clone(boot().g.s);setTestCash(s,wallet);return boot({[v12]:s});
}
{
  const b=boot(),g=b.g;pin(g);
  const untouched=clone(g.s),q=quote(g);
  assert.deepEqual(figures(g),[56000,0,20000,76000,30000,-46000]);assert.deepEqual(clone(g.s),untouched);
  assert.ok(g.marketCartAdd('repair','wire',3).ok);assert.ok(g.marketCartAdd('repair','tape',1).ok);assert.ok(g.marketCartAdd('medic','bandage',1).ok);
  assert.deepEqual(figures(g),[56000,10000,20000,76000,30000,-46000]);assert.equal(quote(g).total,46000);
  assert.notEqual(g.marketCartView('repair').total,10000); // Actual cart includes a third wire and unrelated tape.
  assert.ok(!g.objectiveCartApply(q.token).ok);assert.equal(g.fee,30000);
  assert.ok(g.trade('repair','buy','bolt',1).ok);assert.deepEqual(figures(g),[51500,10000,20000,71500,25500,-46000]);
  assert.ok(g.trade('repair','buy','wire',1).ok);assert.deepEqual(figures(g),[46500,5000,20000,66500,20500,-46000]);
  const reloaded=boot(b.storage,b.clock);assert.deepEqual(figures(reloaded.g),figures(g));valid(reloaded.g);
}
{
  const {g}=funds(76000);pin(g);
  assert.ok(g.cashAction(g.s.cash.pocket[0].uid,'bag',1).ok);
  assert.deepEqual(figures(g),[56000,0,20000,76000,75999,-1]);
  const carried=g.s.equipment.bag.find(unit=>unit.g==='cr_notes');assert.ok(g.cashAction(carried.uid,'pocket').ok);
  assert.equal(quote(g).budget.balance,0);
  assert.ok(g.trade('medic','buy','bandage',1).ok);
  assert.deepEqual(figures(g),[56000,0,20000,76000,71500,-4500]);
  assert.ok(g.trade('medic','sell','bandage',1).ok);
  assert.deepEqual(figures(g),[56000,0,20000,76000,73750,-2250]);valid(g);
}
for(const balance of [75999,76000,76001]){
  const {g}=funds(balance);pin(g);assert.equal(quote(g).budget.balance,balance-76000);
  assert.ok(g.objectiveCartApply(quote(g).token).ok);assert.equal(quote(g).total,0);
  assert.equal(quote(g).budget.materials,56000);assert.equal(quote(g).budget.inCart,56000);assert.equal(g.fee,balance);
  assert.ok(g.marketCartCheckout('repair',repairItems(g).token).ok);assert.equal(g.fee,balance-56000);
  assert.deepEqual(figures(g),[0,0,20000,20000,balance-56000,balance-76000]);launch(g);
  if(balance<76000){assert.ok(!g.s.hideout.builds.power);assert.equal(g.fee,19999);assert.equal(g.stock('fuel'),1);}
  else{assert.ok(g.s.hideout.builds.power);assert.equal(g.fee,balance-76000);assert.equal(g.stock('wire'),0);assert.equal(quote(g).budget,null);}
  valid(g);
}
{
  const s=clone(boot().g.s);s.stash={wire:2,rs_case_junk:1};delete s.stashSlots;setTestCash(s,30000);
  const {g}=boot({[v12]:s});pin(g);const box=g.s.stashSlots.find(u=>u.g==='rs_case_junk').uid;
  assert.ok(g.caseMove(box,'put','wire').ok);assert.equal(quote(g).budget.materials,51000);
  const inside=g.s.stashSlots.find(u=>u.uid===box).contents[0].uid;assert.ok(g.caseMove(box,'take',inside).ok);
  assert.equal(quote(g).budget.materials,46000);assert.equal(g.fee,30000);valid(g);
}
{
  const target={kind:'facility',id:'med',tier:1},b=boot(),g=b.g;pin(g,target);const initial=quote(g).budget;
  assert.deepEqual([initial.materials,initial.build,initial.total,initial.balance],[21500,20000,null,null]);
  assert.deepEqual(clone(initial.unavailable.map(line=>[line.item,line.missing])),[['medkit',1]]);
  const s=clone(g.s);
  s.contracts.medic.done=g.quests.filter(q=>q.trader==='medic' && q.tier<=2).map(q=>q.id);
  const friendly=boot({[v12]:s});assert.ok(friendly.g.standing('medic').tier>=3);pin(friendly.g,target);
  assert.deepEqual(figures(friendly.g),[46500,0,20000,66500,30000,-36500]);
  s.contracts.medic.done=[];s.stash={medkit:1};s.stashSlots=[];const held=boot({[v12]:s});pin(held.g,target);
  assert.deepEqual(figures(held.g),[21500,0,20000,41500,30000,-11500]);valid(held.g);
  g.pin({kind:'campaign',id:'power'});assert.equal(quote(g).budget,null);
}
{
  const historic=require('./fixtures/trade-grid-v28.json').session;
  const b=boot({'rl-reboot-session-v28':historic});pin(b.g);const before=clone(b.g.s);
  assert.deepEqual(figures(b.g),[56000,0,data.hideout.facilities.power.levels[0].costCR,76000,historic.wallet,historic.wallet-76000]);
  assert.deepEqual(clone(b.g.s),before);valid(b.g);
}
{
  const water={kind:'facility',id:'water',tier:1};
  const {g}=funds(75500);pin(g,water);
  let budget=quote(g).budget;
  assert.deepEqual(figures(g),[50000,0,20000,null,75500,null]);
  assert.equal(budget.retail,0);assert.equal(budget.direct,50000);
  assert.deepEqual(clone(budget.catalog),[
    {item:'rl_08_15',missing:2,unit:16000,subtotal:32000},
    {item:'rl_08_19',missing:1,unit:18000,subtotal:18000}
  ]);
  assert.deepEqual(clone(budget.unavailable.map(line=>line.item)),['filter']);
  assert.match(budget.unavailable[0].reason,/임도현.*우호도/);
  assert.equal(quote(g).total,0);assert.equal(quote(g).ok,false);
  const oldCart=clone(g.s.marketCarts);
  for(const [item,remaining] of [['rl_08_15',34000],['rl_08_15',18000],['rl_08_19',0]]){
    const before=g.fee;
    g.lookup(item);assert.equal(g.fee,before);
    g.supply(item);budget=quote(g).budget;
    assert.equal(budget.materials,remaining);assert.equal(budget.total,null);
    assert.equal(g.fee,before-data.items[item].valueCR);
  }
  assert.equal(g.fee,25500);assert.deepEqual(clone(g.s.marketCarts),oldCart);valid(g);
  const poor=funds(0).g;pin(poor,water);
  assert.equal(quote(poor).budget.direct,50000);
  poor.lookup('rl_08_15');poor.supply('rl_08_15');assert.equal(poor.stock('rl_08_15'),0);
  const trusted=clone(poor.s);
  trusted.contracts.repair.done=poor.quests.filter(q=>q.trader==='repair' && q.tier<=2).map(q=>q.id);
  const friendly=boot({[v12]:trusted}).g;pin(friendly,water);
  assert.ok(friendly.marketCartAdd('repair','filter',2).ok);
  assert.deepEqual(figures(friendly),[86000,36000,20000,106000,0,-106000]);
  assert.equal(quote(friendly).budget.direct,50000);assert.equal(quote(friendly).budget.retail,36000);
  assert.equal(quote(friendly).quantity,0);
  const old=require('./fixtures/trade-grid-v28.json').session;
  const legacy=boot({'rl-reboot-session-v28':old}).g;pin(legacy,water);
  assert.deepEqual(figures(legacy),[50000,0,20000,null,17000,null]);valid(legacy);
}
console.log('PASS facility-only retail/ground budget, physical/queued/contained holdings, excess and unrelated carts, live standing and unavailable goods, v28 migration and actual checkout/build at +/-1 CR.');
