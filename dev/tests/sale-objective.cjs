// Compare each quotation with the result of selling exactly the same warehouse units.
const {assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
function profile(total,inBox){
  const first=boot(),seed=clone(first.g.s);
  seed.career.sorties=2;seed.career.returns=2;
  seed.campaign={claimed:[1700000000000,1700000100000],delivered:0,returnId:null};
  seed.hideout.levels.power=1;seed.hideout.levels.water=1;
  seed.stash={bandage:total,rs_case_med:1};delete seed.stashSlots;
  const g=boot({[v12]:seed}).g;
  const uid=g.s.stashSlots.find(u=>u.g==='rs_case_med').uid;
  for(let i=0;i<inBox;i++)assert.ok(g.caseMove(uid,'put','bandage').ok);
  assert.ok(g.pin({kind:'campaign',id:'med'}));valid(g);return g;
}
const missing=g=>g.objective().materials.find(row=>row.id==='bandage').missing;
let combinations=0;
for(let total=1;total<=6;total++)for(let inBox=0;inBox<=Math.min(total-1,3);inBox++){
 for(let removed=1;removed<=total-inBox;removed++){
  const g=profile(total,inBox),units=g.s.stashSlots.filter(u=>u.g==='bandage').slice(-removed);
  const uids=units.map(u=>u.uid),quote=g.saleQuote('medic',uids);
  assert.ok(quote.ok);
  const snapshot=clone(g.s),before=missing(g),impact=g.saleObjectiveImpact(quote);
  assert.deepEqual(clone(g.s),snapshot,'preview has no persistence or reservation');
  assert.ok(g.saleCommit('medic',uids,quote.token).ok);
  const after=missing(g);
  if(after===before)assert.equal(impact,null);
  else assert.deepEqual(clone(impact.lines),[{item:'bandage',quantity:removed,before,after}]);
  assert.ok(!g.saleObjectiveImpact(g.saleQuote('medic',uids)),'sold IDs no longer yield a valid preview');
  valid(g);combinations++;
 }
}
const plain=boot().g;assert.ok(plain.trade('repair','buy','wire',3).ok);
const wires=plain.s.stashSlots.filter(u=>u.g==='wire').map(u=>u.uid);
assert.equal(plain.saleObjectiveImpact(plain.saleQuote('repair',wires)),null);
plain.pin({kind:'facility',id:'power',tier:1});
assert.equal(plain.saleObjectiveImpact(plain.saleQuote('repair',wires.slice(0,1))),null);
const quote=plain.saleQuote('repair',wires);
assert.deepEqual(clone(plain.saleObjectiveImpact(quote).lines),[{item:'wire',quantity:3,before:0,after:2}]);
assert.ok(plain.saleCommit('repair',wires,quote.token).ok);
assert.equal(plain.objective().materials.find(row=>row.id==='wire').missing,2);
console.log('PASS '+combinations+' mixed warehouse/case campaign sale quotations matched exact post-sale objective shortages; surplus, no pin and facility-only construction tested.');
