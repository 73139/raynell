// Run the built game. Every debit must match the quote at the time of the purchase or build.
const {assert,boot,clone,valid,v12,setTestCash}=require('./game-fixture.cjs');
const {hideout:{facilities}}=require('../Rustline_Database_v10.json');
const plan=(g,id='stash',level=3)=>g.constructionBudget(g.facilityConstructionSteps(id,level));
const line=(q,id)=>q.lines.find(row=>row.item===id);
const totals=q=>[q.budget.build,q.budget.materials,q.budget.total,q.budget.balance];
{
  const {g}=boot(),before=clone(g.s),q=plan(g);
  assert.deepEqual(totals(q),[265000,279200,544200,-514200]);
  assert.deepEqual(clone(q.phases).map(s=>s.materials),[86400,106400,86400]);
  assert.equal(q.lines.length,9);assert.equal(q.budget.retail,0);assert.equal(q.budget.direct,279200);
  for(const [id,f] of Object.entries(facilities)){
    for(const tier of f.levels){
      const steps=g.facilityConstructionSteps(id,tier.level),result=g.constructionBudget(steps);
      assert.equal(new Set(steps.map(row=>row.room+row.level)).size,steps.length);
      assert.equal(result.phases.reduce((sum,row)=>sum+(row?.materials||0),0),result.budget.materials);
      assert.equal(result.phases.some(row=>row?.partial),result.budget.total===null);
      for(const row of result.lines){
        const required=steps.reduce((sum,s)=>sum+(facilities[s.room].levels[s.level-1].materials[row.item]||0),0);
        assert.equal(row.required,required);
      }
    }
  }
  assert.deepEqual(clone(g.s),before);
}
{
  const s=clone(boot().g.s);setTestCash(s,544200);
  const b=boot({[v12]:s}),g=b.g;
  for(const [index,stage] of facilities.stash.levels.entries()){
    const initial=plan(g),cash=g.fee;
    for(const [id,count] of Object.entries(stage.materials)){
      g.lookup(id);
      for(let n=0;n<count;n++){const old=g.fee;g.supply(id);assert.equal(old-g.fee,g.price(id));}
    }
    assert.equal(cash-g.fee,initial.phases[0].materials);
    assert.equal(plan(g).budget.materials,initial.budget.materials-initial.phases[0].materials);
    g.build({hideout:'build',id:'stash',tier:String(index+1)});
    const paid=plan(g),end=g.s.hideout.builds.stash.end;
    assert.equal(cash-g.fee,stage.costCR+initial.phases[0].materials);
    assert.equal(paid.phases[0],null);
    assert.equal(paid.budget.materials,initial.budget.materials-initial.phases[0].materials);
    assert.equal(paid.budget.build,initial.budget.build-stage.costCR);
    assert.equal(paid.budget.total,g.fee);
    assert.deepEqual(totals(plan(boot(new Map(b.storage),b.clock).g)),totals(paid));
    b.clock.now=end+1;g.prepare();
    assert.equal(g.s.hideout.levels.stash,index+1);
    assert.deepEqual(totals(plan(g)),totals(paid));
  }
  assert.equal(g.fee,0);valid(g);
}
{
  const b=boot(),g=b.g;
  g.pin({kind:'facility',id:'power',tier:1});
  assert.ok(g.marketCartAdd('repair','wire',3).ok);
  assert.ok(g.marketCartAdd('medic','bandage',1).ok);
  assert.ok(g.trade('repair','buy','wire',2).ok);
  // Both the power and the light room need 2 wires. A paid wire assigned to power cannot cover light too.
  let q=plan(g,'light',1);
  assert.deepEqual([line(q,'wire').required,line(q,'wire').usable,line(q,'wire').missing],[4,2,2]);
  assert.deepEqual(clone(q.phases).map(s=>s.materials),[46000,36000]);
  assert.equal(q.budget.inCart,10000);
  const before=clone(g.s);assert.match(g.constructionBudgetBody(q),/전체 예산 미정/);assert.deepEqual(clone(g.s),before);
  const s=clone(g.s);s.stash.rs_case_junk=1;
  delete s.stashSlots;
  const packed=boot({[v12]:s}).g;
  const wire=packed.s.stashSlots.find(u=>u.g==='wire');
  packed.gear({gear:'pack',id:'wire',unit:wire.uid});
  const box=packed.s.stashSlots.find(u=>u.g==='rs_case_junk').uid;
  assert.ok(packed.caseMove(box,'put','wire').ok);
  const outside=line(plan(packed,'light',1),'wire');
  assert.equal(outside.usable,0);assert.equal(outside.missing,4);assert.equal(outside.owned,2);
}
{
  const old=require('./fixtures/presets-v20.json').session,g=boot({'rl-reboot-session-v20':old}).g;
  const preset=g.presetCurrent();preset.worn.light='flash';preset.modules.light='battery';
  assert.ok(g.applyPreset(preset).ok);g.gear({gear:'unwear',slot:'light'});
  const s=clone(g.s);s.hideout.levels={};const fitted=s.stashSlots.find(u=>u.g==='flash'&&u.gear?.module);
  assert.ok(fitted);
  const funded=boot({[v12]:s}).g,stock=funded.stock('flash');
  assert.equal(line(plan(funded,'light',1),'flash').usable,stock-1);
  const fresh=boot().g,blocked=plan(fresh,'med',1);
  assert.deepEqual(totals(blocked),[60000,127500,null,null]);
  assert.deepEqual(clone(blocked.budget.unavailable.map(row=>row.item)),['filter','medkit']);
  const markup=g.constructionBudgetBody(blocked);
  assert.match(markup,/157,500 CR 부족/);assert.doesNotMatch(markup,/data-plan-total/);
  const trusted=clone(fresh.s);
  for(const trader of ['repair','medic'])trusted.contracts[trader].done=fresh.quests.filter(q=>q.trader===trader&&q.tier<=2).map(q=>q.id);
  const unlocked=boot({[v12]:trusted}).g;
  assert.deepEqual(totals(plan(unlocked,'med',1)),[60000,188500,248500,-218500]);
  valid(unlocked);
}
console.log('PASS: 54 targets, shared prerequisites and stock, packed/contained/fitted exclusions, v20, active jobs, all warehouse purchases and 3 debits match 544,200 CR.');
