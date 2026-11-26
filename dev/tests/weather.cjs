// Exercise the distribution through normal deployment, field, gear and save entry points.
const {assert,boot,clone,epoch,finish,go,stamp,v12,valid}=require('./game-fixture.cjs');
const slotMs=120000;
const conditions=[['clear','맑음',4000],['fog','안개',6000],['rain','강우',5000]];
const timer=g=>g.s.field.action.end-g.s.field.action.start;

function timetable(){
  const {g}=boot();
  for(let period=-4;period<=10;period++){
    const start=epoch+period*slotMs;
    for(let region=0;region<3;region++){
      const index=((period+region)%3+3)%3;
      const current=conditions[index],next=conditions[(index+1)%3];
      for(const offset of [0,1,slotMs-1]){
        const f=g.weatherForecast(region,start+offset);
        assert.deepEqual([f.zone,f.id,f.label,f.scanMs,f.scanFactor,f.startsAt,f.endsAt],
                         [region,...current,current[2]/4000,start,start+slotMs]);
        assert.deepEqual([f.nextId,f.nextLabel,f.nextScanMs],next);
      }
      const f=g.weatherForecast(region,start+slotMs);
      assert.equal(f.id,next[0]);assert.equal(f.scanMs,next[2]);assert.equal(f.startsAt,start+slotMs);
    }
  }
  console.log('PASS three distinct sectors, exact current/next forecasts across fifteen signed slot offsets and inclusive/exclusive millisecond endpoints.');
}

function kitAndInjury(){
  const seed=clone(boot().g.s);
  seed.stash={flash:1,battery:1,rl_13_01:1};delete seed.stashSlots;
  seed.hideout.levels.power=1;seed.hideout.levels.light=1;
  const b=boot({[v12]:seed}),g=b.g;
  const wanted=g.presetCurrent();
  Object.assign(wanted.worn,{light:'flash',ears:'rl_13_01'});wanted.modules.light='battery';
  assert.ok(g.applyPreset(wanted).ok);
  const clear=Math.round(4000*0.92*0.8*0.9*0.9);
  const fog=Math.round(clear*1.5);
  const pre=g.weatherForecast(1);
  assert.equal(pre.scanMs,fog);g.moveNow(1);g.start();
  assert.deepEqual(clone(g.weatherForecast(1)),clone(pre));
  const broken=clone(g.s);broken.field.instances.light.durability=0;
  const damagedKit=boot({[v12]:broken},b.clock).g;
  assert.equal(damagedKit.weatherForecast(1).scanMs,Math.round(Math.round(4000*0.92*0.9)*1.5));
  for(let i=0;i<6&&!g.s.field.contact;i++){
    if(i%2===0)go(b,'landmark',{index:i/2});
    go(b,'scan');assert.equal(timer(g),fog);finish(b);
  }
  assert.ok(g.s.field.contact);b.setRandom(.99);
  for(let i=0;i<3;i++){go(b,'evade');finish(b);}
  assert.equal(g.injuryView().parts.find(p=>p.id==='torso').status,'wounded');
  const injured=Math.round(Math.round(clear*1.25)*1.5);
  assert.equal(g.weatherForecast(1).scanMs,injured);
  b.setRandom(.01);go(b,'evade');assert.equal(timer(g),3000);finish(b);
  go(b,'landmark',{index:2});go(b,'scan');assert.equal(timer(g),injured);finish(b);
  const box=g.s.field.found[1].at(-1);go(b,'open',{index:box});go(b,'search');
  assert.equal(timer(g),2250);valid(g);
  console.log('PASS predeployment and field timing agree with facility light, physical working torch/battery and headset; broken host suppresses both bonuses, torso injury composes, arm/escape timers stay weather-independent.');
}

async function backupAcrossBoundary(){
  const edge=epoch+slotMs;
  const b=boot({}, {now:edge-1001}),g=b.g;g.start();stamp(b,edge-1);
  go(b,'scan');const pending=clone(g.s.field.action);
  assert.equal(pending.start,edge-1);assert.equal(pending.end,pending.start+4000);
  stamp(b,edge);const next=g.weatherForecast(0);assert.equal(next.id,'fog');assert.equal(next.scanMs,6000);
  assert.deepEqual(clone(g.s.field.action),pending);
  const json=await b.exportData(),reloaded=boot(b.storage,b.clock),restored=boot({},b.clock);
  await restored.g.importFile(new Blob([JSON.stringify(json)]));
  for(const same of [reloaded,restored]){
    assert.deepEqual(clone(same.g.s.field.action),pending);
    assert.deepEqual(clone(same.g.weatherForecast(0)),clone(next));
    assert.equal(same.g.s.field.action.end-same.clock.now,3999);valid(same.g);
  }
  const c=restored;stamp(c,pending.end-1);assert.equal(c.g.s.field.found[0].length,0);
  stamp(c,pending.end);assert.equal(c.g.s.field.found[0].length,1);
  go(c,'scan');assert.equal(timer(c.g),6000);valid(c.g);
  console.log('PASS clear scan at transition minus 1ms keeps original deadline, independent JSON + reload in fog retain 3999ms, result becomes available once, and next scan uses 6000ms.');
}

function storageConflict(){
  const b=boot(),g=b.g;g.start();
  const put=b.storage.set;
  b.storage.set=()=>{throw Error('quota')};go(b,'scan');
  assert.equal(g.s.field.action,null);b.storage.set=put;
  const other=boot(b.storage,b.clock);
  go(other,'scan');const winner=clone(other.g.s.field.action);
  const late=winner.start+slotMs;
  b.clock.now=late;go(b,'scan');
  assert.deepEqual(clone(g.s.field.action),winner);
  b.storage.set=()=>{throw Error('quota')};g.tick();
  assert.deepEqual(clone(g.s.field.action),winner);assert.equal(g.s.field.found[0].length,0);
  b.storage.set=put;g.tick();g.tick();
  assert.equal(g.s.field.action,null);assert.equal(g.s.field.found[0].length,1);valid(g);
  console.log('PASS quota rollback on start and completion, stale concurrent writer restores authoritative start/end across slots, one discovery after retry.');
}

async function departureAndLegacy(){
  const origin=boot();
  origin.click({cui:'weather-select',index:'2'});
  const plan=await origin.exportData();
  assert.equal(plan.session.plannedDepartureZone,2);assert.ok(origin.g.check(plan));
  const copy=boot({},origin.clock);
  await copy.g.importFile(new Blob([JSON.stringify(plan)]));
  copy.g.start();assert.equal(copy.g.s.raid.zone,2);
  go(copy,'scan');assert.equal(timer(copy.g),5000);
  const legacy=require('./fixtures/weather-v26-scan.json');
  const old=legacy.session.field.action;
  const clock={now:old.start+1};
  const local=boot({'rl-reboot-session-v26':legacy.session},clock),fresh=boot({},clock);
  await fresh.g.importFile(new Blob([JSON.stringify(legacy)]));
  for(const player of [local,fresh]){
    assert.deepEqual(clone(player.g.s.field.action),old);assert.equal(timer(player.g),5000);
    assert.equal(player.g.weatherForecast(0).scanMs,7500);
    assert.equal(player.g.s.field.hp,legacy.session.field.hp);valid(player.g);
  }
  finish(fresh);
  assert.equal(fresh.g.s.field.found[0].length,legacy.session.field.found[0].length+1);
  assert.equal(fresh.g.s.field.action,null);valid(fresh.g);
  console.log('PASS ordinary departure choice restored through backup without a loot target, plus local migration and file import of an authentic v26 injured player with a frozen 5s scan during v27 fog (new quote 7.5s).');
}

(async()=>{timetable();kitAndInjury();await backupAcrossBoundary();storageConflict();await departureAndLegacy();})().catch(error=>{console.error(error);process.exitCode=1});
