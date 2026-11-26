const {assert,boot,clone,setTestCash,v12}=require('./game-fixture.cjs');
const start=clone(boot().g.s);
const funding=(g)=>g.objectiveCartView().budget?.funding;
const eligible=['scout','stores','pump-gauge','handover-ledgers','weather-survey'];
function scenario({wallet=30000,done=[],order=null,materials={},room='power'}={}){
  const s=clone(start);setTestCash(s,wallet);
  s.career.done=done;s.career.order=order;s.stash=materials;
  const b=boot({[v12]:s});
  assert.ok(b.g.pin({kind:'facility',id:room,tier:1}));return b;
}
function expectPlan(b,ids,reward,remaining){
  const bytes=b.storage.get(v12);
  const plan=funding(b.g);
  assert.deepEqual(clone(plan),{orders:ids,reward,remaining});
  assert.equal(b.storage.get(v12),bytes,'calculating the suggestion is read-only');
}
const fresh=scenario();
expectPlan(fresh,['pump-gauge','handover-ledgers'],46000,0);
expectPlan(scenario({wallet:64000}),['pump-gauge'],12000,0);
expectPlan(scenario({wallet:64001}),['pump-gauge'],12000,-1);
expectPlan(scenario({wallet:42000}),['handover-ledgers'],34000,0);
expectPlan(scenario({wallet:30000,order:'scout'}),['scout','weather-survey'],46000,0);
expectPlan(scenario({wallet:30000,order:'handover-ledgers'}),['handover-ledgers','pump-gauge'],46000,0);
expectPlan(scenario({done:eligible.filter(id=>!['pump-gauge','scout'].includes(id))}),['pump-gauge','scout'],32000,14000);
expectPlan(scenario({wallet:0}),['stores','handover-ledgers'],66000,10000);
expectPlan(scenario({wallet:0,materials:{fuel:1,wire:2,bolt:2}}),['scout'],20000,0);
for(const config of [{wallet:76000},{wallet:76001},{done:eligible},{order:'signals'},{room:'water'}]){
  assert.equal(funding(scenario(config).g),null,JSON.stringify(config));
}
fresh.g.start();assert.equal(funding(fresh.g),null);
const historic=require('./fixtures/pump-pipe-done-v60.json');
const restored=boot({'rl-reboot-session-v35':historic.session});
assert.ok(restored.g.pin({kind:'facility',id:'power',tier:1}));
expectPlan(restored,['stores'],32000,0);
assert.deepEqual(clone(restored.g.s.career.done),['pump-gauge','pump-pipe']);
console.log('PASS complete and incomplete funding, exact / surplus / uncovered CR, 1-vs-2 sorties, active priority, paid/locked/raid gates, known-only budget omission, ready materials and v0.60 completed career.');
