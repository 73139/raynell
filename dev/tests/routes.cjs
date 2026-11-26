// Exercise shipping route data via real departure/settlement and normal backup/import.
const fs = require('node:fs');
const path = require('node:path');
const {assert, boot, clone, finish, go, stamp, valid, v12} = require('./game-fixture.cjs');
const OLD = 'rl-reboot-session-v19';
const routes = [
  [0,1,'배수로 옆길',1,8,65,25,10,[['water',50],['bandage',30],['food',20]]],
  [0,2,'폐철도 화물선',3,10,38,27,35,[['battery',45],['wire',35],['tape',20]]],
  [1,0,'검문소 후문길',1,7,72,20,8,[['bandage',50],['water',35],['medkit',15]]],
  [1,2,'화물차 대기선',2,9,46,34,20,[['food',45],['tape',35],['battery',20]]],
  [2,0,'방벽 정비로',3,8,55,30,15,[['wire',50],['tape',30],['bandage',20]]],
  [2,1,'적재장 연결로',2,7,40,32,28,[['medkit',25],['bandage',40],['battery',35]]]
];
function departure(from,to,rolls,rest=0){
  const b=boot();
  b.g.s.hideout.levels.rest=rest;
  b.g.moveNow(from);b.g.start();b.setRolls(rolls);go(b,'move',{index:to});
  return b;
}
function routeProfiles(){
  for(const [from,to,name,steps,sec,clear,supply,contact,items] of routes){
    const b=departure(from,to,[0]),g=b.g,p=g.routeProfile(from,to);
    assert.deepEqual([p.from,p.to,p.name,p.distance,p.stepMs,p.clear,p.supply,p.contact],
      [from,to,name,steps,sec*1000,clear,supply,contact]);
    assert.deepEqual(clone(p.items.map(i=>[i.tpl,i.relativeProbability])),items);
    assert.equal(clear+supply+contact,100);
    assert.equal(items.reduce((n,i)=>n+i[1],0),100);assert.ok(items.every(([id])=>g.goods[id]));
    const epsilon=.000001;
    for (const [roll,event] of [[0,'clear'],[clear/100-epsilon,'clear'],[clear/100,'supply'],
      [(clear+supply)/100-epsilon,'supply'],[(clear+supply)/100,'contact'],[1-epsilon,'contact']]){
      const test=departure(from,to,[roll,0]);
      assert.equal(test.g.s.field.action.outcome,event,name+' event boundary '+roll);
    }
    let lower=0;
    for (const [id,weight] of items){
      for(const roll of [(lower+.001)/100,(lower+weight-.001)/100]){
        const test=departure(from,to,[(clear+supply/2)/100,roll]);
        assert.equal(test.g.s.field.action.supply,id,name+' supply roll '+roll);
      }
      lower+=weight;
    }
    for(const rest of [0,1,2,3]){
      const walk=departure(from,to,Array(steps).fill(0),rest),game=walk.g;
      const ms=Math.round(sec*1000*(100-5*rest)/100);
      const end=walk.clock.now+steps*ms;
      assert.equal(game.routeStepDuration(game.routeProfile(from,to)),ms);
      assert.equal(game.journeyTiming().arrivalAt,end);
      assert.equal(game.journeyTiming().remainingMs,steps*ms);
      for(let i=0;i<steps;i++){
        const a=game.s.field.action;
        assert.equal(a.end-a.start,ms);
        assert.equal(game.s.raid.zone,from);valid(game);
        stamp(walk,a.end-1);assert.equal(game.journeyTiming().arrivalAt,end);
        finish(walk);
      }
      assert.equal(walk.clock.now,end);assert.equal(game.s.raid.zone,to);
      assert.deepEqual(clone(game.s.field.visited),[from,to]);
    }
  }
  console.log('PASS six directed profiles, 36 event boundaries, 36 item-selection checks and 24 route/rest timing runs.');
}
async function restoredSchedules(){
  const b=departure(0,2,[.5,.05,.99,.01]),g=b.g;
  const j=g.s.field.journey,schedule=clone(j.schedule),start=b.clock.now;
  assert.deepEqual(schedule.legs.map(l=>l.outcome),['supply','contact','clear']);
  assert.equal(schedule.legs[0].supply,'battery');
  const target=start+30000;
  assert.equal(g.journeyTiming().arrivalAt,target);
  stamp(b,start+2600);
  const saved=await b.exportData();
  const r=boot({},b.clock);
  await r.g.importFile(new Blob([JSON.stringify(saved)]));
  assert.deepEqual(clone(r.g.s.field.journey.schedule),schedule);
  assert.deepEqual(clone(r.g.s.field.action),saved.session.field.action);
  assert.equal(r.g.journeyTiming().arrivalAt,target);
  r.setRandom(.9999);finish(r);assert.equal(r.g.s.field.journey.event,'supply');
  assert.equal(r.g.journeyTiming().arrivalAt,null);
  assert.equal(r.g.journeyTiming().remainingMs,20000);
  // A rest upgrade completing during this trip must only change future departures.
  r.g.s.hideout.levels.rest=3;r.g.persist();
  assert.equal(r.g.routeStepDuration(r.g.routeProfile(0,2)),8500);
  const offer=r.g.s.field.journey.supply, bag=r.g.s.field.bag.length;
  const during=boot(r.storage,{now:r.clock.now+60000});during.setRandom(.001);
  assert.equal(during.g.s.field.journey.supply,offer);
  assert.equal(during.g.journeyTiming().arrivalAt,null);
  go(during,'journey-take');go(during,'journey-take');
  assert.equal(during.g.s.field.bag.length,bag+1);
  assert.equal(during.g.s.field.bag.at(-1).g,offer);
  assert.equal(during.g.s.field.action.outcome,'contact');
  assert.equal(during.g.journeyTiming().arrivalAt,during.clock.now+20000);
  finish(during);assert.ok(during.g.s.field.contact);assert.equal(during.g.journeyTiming().arrivalAt,null);
  const midway=await during.exportData(), fight=boot({},during.clock);
  await fight.g.importFile(new Blob([JSON.stringify(midway)]));
  assert.deepEqual(clone(fight.g.s.field.journey.schedule),schedule);
  fight.setRandom(.01);go(fight,'evade');assert.equal(fight.g.s.field.action.escaped,true);
  const combat=boot(fight.storage,fight.clock);combat.setRandom(.99999);finish(combat);
  assert.equal(combat.g.s.field.action.outcome,'clear');
  assert.equal(combat.g.journeyTiming().arrivalAt,combat.clock.now+10000);
  finish(combat);assert.equal(combat.g.s.raid.zone,2);assert.equal(combat.g.s.field.bag.length,bag+1);
  valid(combat.g);
  const full=departure(0,2,[0,0,0]);stamp(full,full.clock.now+60000);
  assert.equal(full.g.s.raid.zone,2);assert.deepEqual(clone(full.g.s.field.visited),[0,2]);
  for(const mutation of [
    x=>x.field.journey.schedule.legs.pop(),x=>x.field.journey.schedule.legs[0].supply='water',
    x=>x.field.journey.schedule.legs[0].outcome='other',x=>x.field.journey.schedule.stepMs=-1000,
    x=>x.field.journey.schedule.rules='future',x=>x.field.action.supply='tape'
  ]){
    const bad=clone(saved);mutation(bad.session);
    assert.equal(g.check(bad),false);
  }
  console.log('PASS frozen three-step supplies/contact/clear, end times, paused clock, export/import, late reconnection, interrupted evasion and malformed plans.');
}
function storageFailures(){
  const shortage=departure(0,1,[.8,.01]);finish(shortage);
  const g=shortage.g,initial=clone(g.s.field),originalWrite=shortage.storage.set;
  shortage.storage.set=()=>{throw Error('test storage quota')};
  go(shortage,'journey-take');
  assert.deepEqual(clone(g.s.field),initial,'failed save must restore the choice and entire bag');
  shortage.storage.set=originalWrite;
  go(shortage,'journey-take');
  assert.equal(g.s.field.bag.length,initial.bag.length+1);
  assert.equal(g.s.raid.zone,1);
  const first=departure(0,2,[.5,.01,0,0]);finish(first);
  const winner=boot(first.storage,first.clock),n=winner.g.s.field.bag.length;
  go(winner,'journey-take');go(first,'journey-take');
  assert.equal(winner.g.s.field.bag.length,n+1);assert.equal(first.g.s.field.bag.length,n+1);
  assert.deepEqual(clone(first.g.s.field.journey),clone(winner.g.s.field.journey));
  assert.equal(first.g.s.field.action.outcome,'clear');
  console.log('PASS full inventory rollback on write failure and no duplicate offer across concurrent tabs.');
}
async function oldTravels(){
  const samples=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/routes-v19.json'),'utf8'));
  for(const sample of samples.checkpoints){
    const raw={...clone(samples.base),...clone(sample.other),field:{...clone(samples.base.field),...clone(sample.field)}};
    assert.equal(raw.version,19);
    const saved=JSON.stringify(raw);
    const b=boot({[OLD]:raw},{now:sample.now}),g=b.g,j=g.s.field.journey;
    assert.equal(b.storage.get(OLD),saved);
    assert.equal(g.check({format:'rustline-tc01',session:raw}),true);
    assert.equal(j.schedule.rules,'legacy');assert.equal(j.schedule.stepMs,7200);
    assert.deepEqual(clone(g.s.field.action),raw.field.action);
    assert.deepEqual(clone(g.s.field.contact??null),raw.field.contact??null);
    if(sample.scenario.endsWith('supply')) {
      const id=sample.scenario.startsWith('moving')?g.s.field.action.supply:j.supply;
      assert.equal(id,'food');
      assert.ok(!g.routeProfile(0,2).items.some(row=>row.tpl===id),'old-only supply must survive migration');
    }
    assert.equal(j.supply,raw.field.journey.supply);assert.equal(j.event,raw.field.journey.event);
    const backup=await b.exportData();assert.equal(backup.session.version,35);valid(g);
    const recovered=boot({},b.clock);await recovered.g.importFile(new Blob([JSON.stringify(backup)]));
    assert.deepEqual(clone(recovered.g.s.field.journey),clone(j));
    const f=boot({},b.clock);await f.g.importFile(new Blob([JSON.stringify({format:'rustline-tc01',session:raw})]));
    assert.deepEqual(clone(f.g.s.field.journey.schedule),clone(j.schedule));
    assert.deepEqual(clone(f.g.s.field.action),raw.field.action);
    if(raw.field.action?.type==='travel-step')assert.equal(g.journeyTiming().arrivalAt,raw.field.action.end+(3-j.done-1)*7200);
    else assert.equal(g.journeyTiming().arrivalAt,null);
    f.setRandom(.01);
    for(let i=0;i<20&&f.g.s.field.journey;i++){
      const s=f.g.s;
      if(s.field.action)finish(f);
      else if(s.field.contact)go(f,'evade');
      else if(s.field.journey.event==='supply')go(f,'journey-pass');
      else assert.fail('legacy journey blocked: '+sample.scenario);
    }
    assert.equal(f.g.s.raid.zone,2,sample.scenario);
    assert.equal(b.storage.get(OLD),saved);assert.ok(b.storage.has(v12));
  }
  console.log('PASS seven real v0.19 saves: old moving rolls, paused supply/contact, resolved evasion, later segment, import and original save immutability.');
}
(async()=>{routeProfiles();storageFailures();await restoredSchedules();await oldTravels()})().catch(e=>{console.error(e);process.exitCode=1});
