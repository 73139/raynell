// A forecast-driven order must only settle real, distinct weather observations from the current raid.
const {assert,boot,clone,epoch,extract,finish,go,move,stamp,valid}=require('./game-fixture.cjs');
const order='weather-survey',stations=[9,6,1],slot=120000;
function start(zone=0,accepted=true){
  const b=boot({},{now:epoch+1000});
  if(accepted){b.g.order(order);assert.ok(b.g.pin({kind:'order',id:order}));}
  b.g.moveNow(zone);b.g.start();b.setRandom(.01);return b;
}
function visit(b,z,point=stations[z]){
  if(b.g.s.raid.zone!==z)move(b,z);
  go(b,'landmark',{index:point});
}
function action(b,extra={}){
  const zone=b.g.s.raid.zone;
  go(b,'survey-observe',{raidId:String(b.g.s.raid.startedAt),zone:String(zone),window:String(b.g.weatherForecast(zone).startsAt),...extra});
}
function records(b){return clone(b.g.s.field.weatherSurvey?.observations||[]);}
function observe(b,z){
  visit(b,z);
  const at=b.clock.now,id=b.g.weatherForecast(z,at).id,old=records(b);
  action(b);
  assert.deepEqual(records(b),[...old,{at,zone:z,landmark:stations[z],condition:id}]);
  valid(b.g);
}
function denied(b,fn){
  const before=clone(b.g.s);fn();assert.deepEqual(clone(b.g.s),before);
}
function settle(b,rating){
  if(b.g.s.raid.zone!==0)move(b,0);
  if(rating==='success')stamp(b,b.g.s.raid.startedAt+420000);
  extract(b);assert.equal(b.g.s.lastSummary.rating,rating);
  assert.equal(b.g.s.field.weatherSurvey,undefined);valid(b.g);
}
function quota(b,fn){
  const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};
  try{fn();}finally{b.storage.set=set;}
}
(async()=>{
  const naked=start(0,false);visit(naked,0);denied(naked,()=>action(naked));
  const partial=start();
  denied(partial,()=>action(partial)); // Origin landmark is the supply station.
  visit(partial,0);denied(partial,()=>action(partial,{raidId:'3'}));denied(partial,()=>action(partial,{zone:'2'}));
  denied(partial,()=>action(partial,{window:'3'}));denied(partial,()=>quota(partial,()=>action(partial)));
  go(partial,'scan');denied(partial,()=>action(partial));finish(partial);
  observe(partial,0);denied(partial,()=>action(partial));
  stamp(partial,partial.g.weatherForecast(0).endsAt);
  assert.equal(partial.g.weatherForecast(0).id,'fog');
  denied(partial,()=>action(partial)); // Same location changing weather never earns a second entry.
  const restored=boot(partial.storage,partial.clock);
  assert.deepEqual(records(restored),records(partial));
  visit(restored,2);assert.equal(restored.g.weatherForecast(2).id,'clear');
  denied(restored,()=>action(restored)); // A different station repeating the condition is not evidence.
  visit(restored,1);assert.equal(restored.g.weatherForecast(1).id,'rain');denied(restored,()=>action(restored));
  settle(restored,'success');assert.equal(restored.g.s.lastSummary.commission,0);
  assert.equal(restored.g.s.wallet,30000);restored.g.ack();restored.g.start();assert.deepEqual(records(restored),[]);

  const beforeEdge=start();visit(beforeEdge,0);
  const prev=beforeEdge.g.weatherForecast(0);stamp(beforeEdge,prev.endsAt-1);
  assert.equal(beforeEdge.g.weatherForecast(0).id,'clear');
  stamp(beforeEdge,prev.endsAt);denied(beforeEdge,()=>action(beforeEdge,{window:String(prev.startsAt)}));
  assert.equal(beforeEdge.g.weatherForecast(0).id,'fog');observe(beforeEdge,0);

  for(const ending of ['quick','abandoned','expired']){
    const b=start();observe(b,0);observe(b,1);
    if(ending==='quick')settle(b,'quick');
    else if(ending==='abandoned')go(b,'abandon');
    else stamp(b,b.g.s.raid.endsAt);
    assert.equal(b.g.s.lastSummary.rating,ending);
    assert.equal(b.g.s.lastSummary.commission,0);assert.equal(b.g.s.lastSummary.missionXp,0);
    assert.equal(b.g.s.wallet,30000);assert.equal(b.g.s.career.order,order);
    assert.equal(b.g.s.field.weatherSurvey,undefined);
    b.g.ack();b.g.start();assert.deepEqual(records(b),[]);
  }

  for(const first of [0,1]){
    let b=start(first);
    const second=1-first;
    assert.deepEqual(clone(b.g.objective().locations),stations.map((landmark,zone)=>({zone,landmark})));
    observe(b,first);
    const data=await b.exportData();
    for(const edit of [
      s=>s.field.weatherSurvey.raidId++,
      s=>s.field.weatherSurvey.observations[0].condition='rain',
      s=>s.field.weatherSurvey.observations[0].landmark=0,
      s=>s.field.weatherSurvey.observations[0].at+=slot,
      s=>s.field.weatherSurvey.observations.push({...s.field.weatherSurvey.observations[0]}),
      s=>s.career.order='scout'
    ]){
      const invalid=clone(data);edit(invalid.session);assert.equal(b.g.check(invalid),false);
    }
    const recovered=boot({},b.clock);await recovered.g.importFile(new Blob([JSON.stringify(data)]));
    assert.deepEqual(records(recovered),records(b));b=recovered;
    assert.equal(b.g.objective().locations.length,2);
    observe(b,second);assert.deepEqual(clone(b.g.objective().locations),[]);
    assert.equal(b.g.objective().goals[0].projected,1);assert.equal(b.g.objective().goals[1].projected,1);
    settle(b,'success');
    const paid=b.g.s;
    assert.deepEqual([paid.lastSummary.commission,paid.lastSummary.missionXp,paid.wallet],[26000,95,56000]);
    assert.deepEqual(clone(paid.career.done),[order]);assert.deepEqual(clone(paid.stash),{});
    for(let i=0;i<2;i++)b=boot(b.storage,b.clock);
    b.g.ack();b.g.ack();b.g.order(order);
    assert.equal(b.g.s.career.order,null);assert.equal(b.g.s.wallet,56000);
    assert.deepEqual(clone(b.g.s.career),clone(paid.career));valid(b.g);
  }
  // Local automatic migration and file import must keep an older in-flight scouting timer.
  const legacy=require('./fixtures/weather-v26-scan.json');
  const prior=legacy.session,oldClock={now:prior.field.action.start+1};
  const migrated=boot({'rl-reboot-session-v26':prior},oldClock),imported=boot({},oldClock);
  await imported.g.importFile(new Blob([JSON.stringify(legacy)]));
  for(const old of [migrated,imported]){
    assert.equal(old.g.s.field.weatherSurvey,undefined);
    assert.deepEqual(clone(old.g.s.field.action),prior.field.action);
    assert.equal(old.g.s.wallet,prior.wallet);
    assert.equal(old.g.s.career.order,prior.career.order);
    assert.deepEqual(clone(old.g.s.career.done),prior.career.done);
    valid(old.g);
  }
  finish(imported);
  assert.equal(imported.g.s.field.found[0].length,prior.field.found[0].length+1);
  assert.equal(imported.g.s.field.weatherSurvey,undefined);
  const tab=start();visit(tab,0);
  const owner=boot(tab.storage,tab.clock);
  action(owner);action(tab); // A previous revision cannot append the same report a second time.
  const reopened=boot(tab.storage,tab.clock);
  assert.deepEqual(records(reopened),records(owner));
  assert.equal(records(reopened).length,1);assert.equal(reopened.g.s.wallet,30000);
  console.log('PASS visibility expedition: real regional forecasts, both observation orders, no wait or loot requirement, location/window/raid and weather validation, wrong/duplicate/missing/failed/early reports, quota, export/import and exactly one normal settlement.');
})().catch(e=>{console.error(e);process.exitCode=1});
