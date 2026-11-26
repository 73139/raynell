const {assert,boot,clone,extract,v12,valid}=require('./game-fixture.cjs');
const now=Date.parse('2026-12-10T04:00:00Z');

function operator(cadence){
  const initial=boot({},{now}).g;
  const data=clone(initial.s);
  const count=cadence==='daily'?2:4;
  const bag=Array.from({length:count+2},(_,index)=>{
    const unit=initial.unit(index===count+1?'water':'flash');
    unit.x=index;unit.y=0;
    if(index===count)unit.gear.module='battery';
    return unit;
  });
  data.equipment.bag=bag;
  const run=boot({[v12]:data},{now});
  valid(run.g);
  return run;
}
function ground(run) {
  run.click({page:'inventory'});
  return run.content().match(/<section class="panel kit-ground">[\s\S]*?<\/section>/)?.[0]||'';
}
function test(cadence){
  const b=operator(cadence),g=b.g,board=g.board('quarter',cadence);
  const quest=board.entries.find(e=>e.quest.type==='delivery').quest;
  const goal=quest.goals.find(row=>row.item==='flash');
  assert.ok(goal);
  assert.ok(g.cycleWork('quarter',cadence,board.key,quest.id,'accept').ok);
  assert.ok(g.pin({kind:cadence,id:quest.id,trader:'quarter',key:board.key}));
  g.start();
  const bag=[...g.s.field.bag],bare=bag.filter(u=>u.g==='flash'&&!u.gear.module);
  const fitted=bag.find(u=>u.gear?.module),water=bag.find(u=>u.g==='water');
  for(const u of bag)g.gear({gear:'drop',unit:u.uid});
  const before=clone(g.s),panel=ground(b);
  assert.deepEqual(clone(g.s),before);
  assert.equal((panel.match(/data-ground-delivery="flash"/g)||[]).length,goal.target+2);
  assert.ok(panel.includes('모듈을 분리해야 납품 가능 · 지금 회수해도 부족 '+goal.target+'개'));
  assert.ok(panel.includes('현재 생환 시 부족 '+goal.target+'개'));
  assert.doesNotMatch(panel,/data-ground-delivery="water"/);
  g.gear({gear:'recover',unit:fitted.uid});
  for(let i=0;i<goal.target;i++){
    const short=goal.target-i;
    assert.ok(ground(b).includes('현장 가방 납품 가능 '+i+'개 · 현재 생환 시 부족 '+short+'개'));
    g.gear({gear:'recover',unit:bare[i].uid});
  }
  assert.ok(ground(b).includes('현재 가방으로 생환하면 이 품목 충족'));
  const restored=boot(new Map(b.storage),{now});
  assert.ok(ground(restored).includes('현재 가방으로 생환하면 이 품목 충족'));
  assert.deepEqual(clone(g.s.field.gearGround[0]).map(u=>u.uid),[bare.at(-1).uid,water.uid]);
  assert.equal(g.objective().status,cadence==='daily'?'생환하면 보고 가능':'진행 중');
  const unpinned=boot(new Map(b.storage),{now});
  unpinned.g.pin(null);assert.doesNotMatch(ground(unpinned),/data-ground-delivery/);
  extract(b);assert.equal(g.stock('flash'),goal.target+1);
  g.ack();
  const result=g.cycleWork('quarter',cadence,board.key,quest.id,'claim');
  assert.equal(result.ok,cadence==='daily'); // Weekly offer also requires two separate patches.
  assert.ok(g.s.stashSlots.some(u=>u.gear?.uid===fitted.gear.uid&&u.gear.module==='battery'));
  valid(g);
}
function alreadyInBunker(){
  const time=Date.parse('2026-11-26T04:00:00Z'),start=boot({},{now:time}).g;
  const data=clone(start.s);
  data.stash.food=2;
  data.equipment.bag=[start.unit('food')];
  const run=boot({[v12]:data},{now:time}),g=run.g,board=g.board('supply','daily');
  const quest=board.entries.find(entry=>entry.quest.type==='delivery').quest;
  assert.equal(quest.goals[0].item,'food');
  assert.ok(g.cycleWork('supply','daily',board.key,quest.id,'accept').ok);
  assert.ok(g.pin({kind:'daily',id:quest.id,trader:'supply',key:board.key}));
  g.start();
  const food=g.s.field.bag[0];
  g.gear({gear:'drop',unit:food.uid});
  assert.ok(ground(run).includes('벙커 납품 가능 2개 · 현장 가방 납품 가능 0개 · 벙커에 이 품목 납품량 확보'));
  valid(g);
}
if(require.main===module){
  alreadyInBunker();
  for(const cadence of ['daily','weekly'])test(cadence);
  console.log('PASS ground delivery projections, both accepted periods, fitted exception, exact UID, duplicate coverage, unrelated items/goal, settlement and reload.');
}
module.exports={operator,now};
