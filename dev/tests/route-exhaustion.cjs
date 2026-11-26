// Exercise the trip forecast against walking the same route in the shipping engine.
const {assert,boot,clone,go,finish}=require('./game-fixture.cjs');

function checkWalk({energy,water,hp,destination,expectedEnergy,expectedHP,warning,steps,arrived}) {
  const run=boot();
  run.g.start();
  Object.assign(run.g.s.field,{energy,water,hp});
  const original=clone(run.g.s);
  const route=run.g.readField().split('<article class="route-card"').find(card=>
    card.startsWith(' data-route-card data-from="0" data-to="'+destination+'"'));
  assert.ok(route);
  assert.equal(route.match(/data-route-energy>([^<]+)/)[1],energy+' → '+expectedEnergy);
  assert.equal(route.match(/data-route-exhaustion>([^<]+)/)?.[1],warning);
  assert.deepEqual(clone(run.g.s),original,'reading the forecast must not modify the save');
  run.setRandom(0.1);
  go(run,'move',{index:destination});
  for (let step=0;step<steps;step++) finish(run);
  assert.equal(run.g.s.field.energy,expectedEnergy);
  assert.equal(run.g.s.field.hp,expectedHP);
  assert.equal(run.g.s.raid.zone,arrived?destination:0);
  assert.equal(run.g.s.field.result,arrived?null:'kia');
}

checkWalk({energy:10,water:1,hp:100,destination:2,expectedEnergy:1,expectedHP:100,
  steps:3,arrived:true});
checkWalk({energy:9,water:1,hp:100,destination:2,expectedEnergy:0,expectedHP:92,
  warning:'3칸째부터 체력 −8 (합계)',steps:3,arrived:true});
checkWalk({energy:6,water:1,hp:20,destination:2,expectedEnergy:0,expectedHP:4,
  warning:'2칸째부터 체력 −16 (합계)',steps:3,arrived:true});
checkWalk({energy:0,water:0,hp:16,destination:2,expectedEnergy:0,expectedHP:0,
  warning:'2칸째 전투 불능',steps:2,arrived:false});
checkWalk({energy:100,water:0,hp:5,destination:2,expectedEnergy:97,expectedHP:0,
  warning:'1칸째 전투 불능',steps:1,arrived:false});
checkWalk({energy:3,water:10,hp:8,destination:1,expectedEnergy:0,expectedHP:0,
  warning:'1칸째 전투 불능',steps:1,arrived:false});
console.log('PASS 6 route forecasts match live movement, energy, exhaustion and defeat boundaries.');
