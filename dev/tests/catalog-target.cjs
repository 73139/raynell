const {assert, boot, clone, valid}=require('./game-fixture.cjs');
const boxOdds=(boxes,g,item)=>1-boxes.reduce((miss,box)=>miss*(1-g.huntContainerOdds(box.table,item).whole),1);
const b=boot(),g=b.g;
let tracked=0,unavailable=0,sites=0;
for(const item of Object.keys(g.goods)){
  const natural=g.huntRegions(item);
  const exists=natural.some(region=>region.landmarks.length);
  const result=g.setLootGoal('item/'+item);
  assert.equal(result.ok,exists,item);
  if(!exists){unavailable++;continue;}
  tracked++;
  const plan=g.lootGoalView();assert.equal(plan.selected,'item/'+item);
  assert.equal(plan.goals.find(goal=>goal.id===plan.selected).item,item);
  for(const group of plan.regions){
    const physical=natural[group.zone].landmarks.map(point=>point.index).sort((a,b)=>a-b);
    assert.deepEqual(clone(group.landmarks.map(point=>point.index).sort((a,b)=>a-b)),clone(physical));
    for(const [i,point] of group.landmarks.entries()){
      sites++;
      assert.ok(Math.abs(point.score-boxOdds(point.boxes,g,item))<1e-12);
      assert.ok(!i||group.landmarks[i-1].score>=point.score);
      for(const box of point.boxes)assert.equal(box.score,g.huntContainerOdds(box.table,item).whole);
    }
  }
}
assert.equal(tracked,513);assert.equal(unavailable,18);
assert.ok(g.pin({kind:'facility',id:'water',tier:1}));
assert.ok(g.setLootGoal('item/filter').ok);
const point=g.lootGoalView().regions[2].landmarks[0];assert.ok(g.selectLootDestination(2,point.index).ok);
const saved=clone(g.s);valid(g);
assert.deepEqual(clone(saved.lootDestination),{goal:'item/filter',zone:2,index:point.index});
assert.ok(!g.setLootGoal('item/__proto__').ok);assert.ok(!g.setLootGoal('item/rl_sealed_mail').ok);
assert.deepEqual(clone(g.s),saved);
const restored=boot(b.storage,b.clock).g;
assert.deepEqual(clone(restored.s.lootDestination),saved.lootDestination);assert.deepEqual(clone(restored.s.objectivePin),saved.objectivePin);
assert.ok(restored.setLootGoal('medical').ok);assert.equal(restored.s.lootDestination,null);assert.deepEqual(clone(restored.s.objectivePin),saved.objectivePin);
assert.ok(!g.setLootGoal('item/bandage').ok);assert.equal(g.s.lootGoal,'medical');
const before=clone(g.s);const put=b.storage.set;b.storage.set=()=>{throw Error('quota')};
assert.ok(!g.setLootGoal('item/bandage').ok);b.storage.set=put;assert.deepEqual(clone(g.s),before);
console.log('PASS',tracked,'physical item targets,',unavailable,'without sources,',sites,'location ranks; real pricing-independent probabilities, backup restore, facility pin, quota and stale tabs.');
