// The product owns state, cooldowns, injury status, actual purchases and the physical bag.
const {assert,boot,clone,extract,finish,go,stamp,valid}=require('./game-fixture.cjs');

function quota(b,fn) {
  const write=b.storage.set;
  b.storage.set=()=>{throw Error('simulated storage full')};
  try {return fn();} finally {b.storage.set=write;}
}
function body(g) {return Array.from(g.injuryView().parts,p=>p.status);}
function count(g,id){return g.s.field.bag.filter(u=>u.g===id).length;}
function prepare(b) {
  const g=b.g;
  assert.ok(g.trade('medic','buy','bandage',3).ok);
  for(let i=0;i<3;i++)g.gear({gear:'pack',id:'bandage'});
  g.start();
  for(let i=0;i<6&&!g.s.field.contact;i++){
    if(i%2===0)go(b,'landmark',{index:i/2});
    go(b,'scan');finish(b);
  }
  assert.ok(g.s.field.contact);
}
function failEvade(b) {
  b.setRandom(.99);
  go(b,'evade');
  assert.equal(b.g.s.field.action?.escaped,false);
  finish(b);
}
async function routeRecovery() {
  const b=boot(),g=b.g;
  assert.ok(g.trade('medic','buy','bandage',2).ok);
  g.gear({gear:'pack',id:'bandage'});g.gear({gear:'pack',id:'bandage'});
  g.start();b.setRandom(.99);go(b,'move',{index:2});
  const route=clone(g.s.field.journey.schedule);
  finish(b);assert.equal(g.s.field.journey.event,'contact');
  failEvade(b);failEvade(b);
  const med=g.s.field.bag[0];
  assert.ok(g.beginInjuryTreatment('arm',med.uid).ok);
  const live=await b.exportData();
  assert.ok(g.check(live));
  const c=boot({},b.clock);await c.g.importFile(new Blob([JSON.stringify(live)]));
  assert.deepEqual(clone(c.g.s.field.journey.schedule),route);
  assert.deepEqual(clone(c.g.s.field.action),live.session.field.action);
  finish(c);valid(c.g);
  c.setRandom(.01);go(c,'evade');
  assert.equal(c.g.s.field.action.end-c.g.s.field.action.start,3000);
  finish(c);
  const next=c.g.s.field.action;
  assert.equal(next.type,'travel-step');
  assert.equal(next.end-next.start,route.stepMs);
  assert.deepEqual(clone(c.g.s.field.journey.schedule),route);
  const carried=count(c.g,'bandage'),moving=boot(c.storage,c.clock);
  assert.deepEqual(clone(moving.g.s.field.action),clone(next));
  assert.equal(count(moving.g,'bandage'),carried);
  assert.equal(moving.g.beginInjuryTreatment('leg',moving.g.s.field.bag[0].uid).ok,false);
  valid(moving.g);
  console.log('PASS real scheduled route contact, treatment while paused, independent JSON, 3s injured escape and resumed leg deadlines with unchanged itinerary and supply count.');
}
async function main(){
  await routeRecovery();
  let b=boot(),g=b.g;prepare(b);
  const uid=g.s.field.bag[0].uid;
  const second=g.s.field.bag[1].uid;
  assert.deepEqual(body(g),['normal','normal','normal']);
  const initial=g.s.field.hp;
  failEvade(b);
  assert.deepEqual(body(g),['wounded','normal','normal']);
  assert.equal(g.actionDuration('search',1800),2250);
  failEvade(b);
  assert.deepEqual(body(g),['wounded','wounded','normal']);
  assert.equal(g.actionDuration('evade',2000),3000);
  assert.equal(g.actionDuration('scan',4000),4000);
  assert.equal(g.s.field.hp,initial-g.s.injuryState.events.reduce((n,e)=>n+e.damage,0));
  valid(g);

  const before=clone(g.s),viewBefore=clone(g.injuryView());
  assert.equal(g.beginInjuryTreatment('torso',uid).ok,false);
  assert.equal(g.beginInjuryTreatment('arm','unknown').ok,false);
  assert.equal(quota(b,()=>g.beginInjuryTreatment('arm',uid)).ok,false);
  assert.deepEqual(clone(g.s),before);
  assert.ok(g.beginInjuryTreatment('arm',uid).ok);
  const cancelled=clone(g.s.field.action);
  assert.equal(g.beginInjuryTreatment('leg',second).ok,false);
  assert.equal(quota(b,()=>g.cancelInjuryTreatment()).ok,false);
  assert.deepEqual(clone(g.s.field.action),cancelled);
  assert.ok(g.cancelInjuryTreatment().ok);
  assert.deepEqual(clone(g.injuryView()),viewBefore);
  assert.equal(count(g,'bandage'),3);

  assert.ok(g.beginInjuryTreatment('arm',uid).ok);
  const pending=clone(g.s.field.action);
  assert.equal(pending.end-pending.start,3000);
  const data=await b.exportData();valid(g);
  for(const change of [
    s=>s.injuryState.raidId++,s=>s.injuryState.legacy=true,s=>s.injuryState.events[0].part='leg',
    s=>s.injuryState.events[0].damage=0,s=>s.injuryState.events[1].at=s.injuryState.raidId-1,
    s=>s.field.action.part='torso',s=>s.field.action.uid='elsewhere',s=>s.field.action.item='water',
    s=>s.field.action.end++,s=>s.field.bag.push({...s.field.bag[0]}),
    s=>s.injuryState.events.push({kind:'treat',part:'arm',uid,item:'bandage',at:pending.start,gain:18})
  ]){
    const bad=clone(data);change(bad.session);
    assert.equal(g.check(bad),false,change.toString());
  }
  const c=boot({},b.clock);await c.g.importFile(new Blob([JSON.stringify(data)]));b=c;g=b.g;
  assert.deepEqual(clone(g.s.field.action),pending);
  stamp(b,pending.end-1);
  assert.deepEqual(body(g),['wounded','wounded','normal']);
  assert.equal(count(g,'bandage'),3);
  quota(b,()=>stamp(b,pending.end));
  assert.deepEqual(clone(g.s.field.action),pending);
  assert.deepEqual(clone(g.injuryView()),viewBefore);
  assert.equal(count(g,'bandage'),3);
  stamp(b,pending.end);
  const after=g.injuryView();
  assert.equal(after.treatments,1);
  assert.deepEqual(body(g),['recovered','wounded','normal']);
  assert.equal(g.actionDuration('evade',2000),3000);
  assert.equal(g.actionDuration('search',1800),1800);
  assert.equal(g.s.field.hp,Math.min(100,before.field.hp+18));
  assert.equal(count(g,'bandage'),2);
  assert.equal(after.events.at(-1).uid,uid);
  assert.equal(g.s.field.bag.some(u=>u.uid===uid),false);
  assert.equal(g.s.field.bag.some(u=>u.uid===second),true);
  assert.equal(g.beginInjuryTreatment('arm',uid).ok,false);
  for(let i=0;i<3;i++)g.tick();
  assert.equal(count(g,'bandage'),2);valid(g);
  console.log('PASS real tier-one purchase/pack and contact, separate arm/leg hits and penalties, exact three-second UID reservation, cancel/duplicate/failed writes, independent pending JSON, one-unit charge and eleven invalid backups.');

  // Explicitly simulate the third failed evasion. It increases area-scan time only;
  // the already-treated arm remains recovered until that part is hit again.
  failEvade(b);
  assert.deepEqual(body(g),['recovered','wounded','wounded']);
  assert.equal(g.actionDuration('scan',4000),5000);
  failEvade(b);
  assert.deepEqual(body(g),['wounded','wounded','wounded']);
  b.setRandom(.01);go(b,'evade');finish(b);
  assert.equal(g.s.field.contact,null);
  const finalEvents=clone(g.s.injuryState);
  extract(b);valid(g);
  assert.equal(g.s.injuryState,null);
  assert.deepEqual(clone(g.s.lastSummary.injuries),finalEvents);
  assert.deepEqual(Array.from(g.injuryView(g.s.lastSummary.injuries).parts,p=>p.hits),[2,1,1]);
  const out=await b.exportData(),other=boot({},b.clock);
  await other.g.importFile(new Blob([JSON.stringify(out)]));
  assert.deepEqual(clone(other.g.s.lastSummary.injuries),finalEvents);
  other.g.ack();other.g.start();
  assert.equal(other.g.injuryView().hits,0);
  assert.deepEqual(body(other.g),['normal','normal','normal']);
  assert.deepEqual(clone(other.g.s.lastSummary.injuries),finalEvents);
  valid(other.g);
  console.log('PASS third and repeated contact hits, actual scan/search/evade timers, extraction and post-result JSON preserve exact event receipt, next sortie starts healthy.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
