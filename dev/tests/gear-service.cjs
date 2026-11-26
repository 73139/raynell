// Exercise the built game's production action, timer, receipt, quote and restore paths.
const {setTestCash,assert,boot,clone,extract,finish,go,stamp,valid,v12}=require('./game-fixture.cjs');

function contact(b){
  const g=b.g;
  g.start();
  for(let n=0;n<5 && !g.s.field.contact;n++){
    if(n%2===0)go(b,'landmark',{index:n/2});
    go(b,'scan');finish(b);
  }
  assert.ok(g.s.field.contact);
}

function quota(store,action){
  const put=store.set;
  store.set=()=>{throw Error('storage quota')};
  try{action();}finally{store.set=put;}
}

async function run(){
  let b=boot(),g=b.g;
  const gun=g.gearWorn(g.s.equipment,'primary'),uid=gun.uid;
  assert.equal(gun.ammo,30);assert.equal(gun.durability,100);
  contact(b);valid(g);
  const view=g.s.field;
  quota(b.storage,()=>go(b,'engage',{slot:'primary'}));
  assert.equal(view.action,null);assert.equal(g.gearWorn(view,'primary').ammo,30);
  go(b,'engage',{slot:'primary'});
  const pending=clone(g.s.field.action);
  for(const edit of [a=>a.end--,a=>a.strike.uid='other',a=>{delete a.strike;a.legacyGear=true;},a=>a.strike.attackRoll=7]){
    const bad=clone(g.s);edit(bad.field.action);assert.equal(g.check({format:'rustline-tc01',session:bad}),false);
  }
  assert.equal(pending.strike.uid,uid);
  go(b,'engage',{slot:'primary'});assert.deepEqual(clone(g.s.field.action),pending);
  valid(g);
  const data=await b.exportData(),savedClock=b.clock;
  const other=boot({},savedClock);await other.g.importFile(new Blob([JSON.stringify(data)]));
  b=other;g=b.g;
  assert.equal(g.s.field.action.end,pending.end);
  quota(b.storage,()=>stamp(b,pending.end));
  assert.deepEqual(clone(g.s.field.action),pending);
  assert.equal(g.gearWorn(g.s.field,'primary').ammo,30);
  assert.equal(g.s.field.gearUsage,undefined);
  stamp(b,pending.end);
  assert.equal(g.gearWorn(g.s.field,'primary').ammo,27);
  assert.equal(g.gearWorn(g.s.field,'primary').durability,98);
  assert.equal(g.s.field.gearUsage.length,1);
  for(let i=0;i<4;i++)g.tick();
  valid(g);
  for(const edit of [
    s=>s.field.gearUsage[0].ammoUsed++,
    s=>s.field.gearUsage[0].uid='foreign',
    s=>s.field.gearUsage.push({...s.field.gearUsage[0]}),
    s=>s.field.gearUsage[0].wear=-1
  ]){
    const bad=clone(g.s);edit(bad);assert.equal(g.check({format:'rustline-tc01',session:bad}),false);
  }
  b.setRandom(.01);if(g.s.field.contact){go(b,'evade');finish(b);}
  extract(b);
  const row=g.s.lastSummary.gearReport.find(row=>row.uid===uid);
  assert.deepEqual(clone(g.s.career.history[0].gearReport),clone(g.s.lastSummary.gearReport));
  assert.deepEqual(clone(row),{uid,g:'rl10_carbine',ammoBefore:30,durabilityBefore:100,ammoUsed:3,wear:2,disposition:'returned'});
  valid(g);g.ack();
  const before=g.fee,q=g.gearServiceQuote(uid,'repair');
  assert.deepEqual([q.before,q.after,q.qty,q.cost,q.reason],[98,100,2,180,'']);
  quota(b.storage,()=>assert.equal(g.performGearService(uid,'repair',98).ok,false));
  assert.equal(g.fee,before);assert.equal(g.gearWorn(g.s.equipment,'primary').durability,98);
  const stale=boot(b.storage,b.clock),first=boot(b.storage,b.clock);
  assert.equal(first.g.performGearService(uid,'repair',98).ok,true);
  assert.equal(stale.g.performGearService(uid,'repair',98).ok,false);
  g=stale.g;
  assert.equal(g.fee,before-180);
  assert.equal(g.gearWorn(g.s.equipment,'primary').durability,100);
  assert.equal(g.performGearService(uid,'repair',98).ok,false);
  assert.equal(g.performGearService(uid,'reload',26).ok,false);
  const refill=g.gearServiceQuote(uid,'reload');
  assert.deepEqual([refill.before,refill.after,refill.cost],[27,30,120]);
  quota(b.storage,()=>assert.equal(g.performGearService(uid,'reload',27).ok,false));
  assert.equal(g.performGearService(uid,'reload',27).ok,true);
  assert.equal(g.performGearService(uid,'reload',27).ok,false);
  assert.equal(g.fee,before-300);
  const restored=boot({},b.clock);await restored.g.importFile(new Blob([JSON.stringify(await stale.exportData())]));
  assert.equal(restored.g.fee,before-300);assert.equal(restored.g.gearWorn(restored.g.s.equipment,'primary').ammo,30);valid(restored.g);
  console.log('PASS normal 3s engagement, duplicate input, pending JSON import, storage rejection at both action and resolution, single spend and settlement. Recovery, repair and refill quotes, stale/wrong input, quota and concurrent tabs; one 180 CR and one 120 CR deduction persisted.');
}

function otherPaths(){
  const b=boot(),g=b.g;
  const primary=g.gearWorn(g.s.equipment,'primary');
  // Construct a boundary-condition fixture; play proceeds through the ordinary handlers.
  primary.ammo=2;primary.durability=1;g.persist();
  contact(b);
  const q=g.gearStrikeQuote('primary');
  assert.match(q.reason,/3발 필요/);assert.match(q.reason,/내구도 2 필요/);
  const rendered=g.readField();assert.match(rendered,/data-slot="primary" disabled/);
  go(b,'engage');assert.equal(g.s.field.action,null);
  go(b,'engage',{slot:'none'});assert.equal(g.s.field.action,null);
  go(b,'evade');assert.equal(g.s.field.action.type,'evade');
  b.setRandom(.01);finish(b);
  const early=boot();early.g.start();
  early.g.s.field.contact={zone:0,hp:36};early.g.persist();
  stamp(early,early.g.s.raid.endsAt-2500);
  go(early,'engage');stamp(early,early.g.s.raid.endsAt);
  const loss=early.g.s.lastSummary.gearReport[0];assert.equal(loss.ammoUsed,0);assert.equal(loss.disposition,'lost');
  assert.equal(early.g.s.equipment.worn.primary,undefined);valid(early.g);
  const poor=boot(),p=poor.g,gun=p.gearWorn(p.s.equipment,'primary'),snap=clone(p.s);
  setTestCash(snap,1);snap.equipment.instances.primary.durability=98;
  const debtor=boot({[v12]:snap}).g;
  assert.match(debtor.gearServiceQuote(gun.uid,'repair').reason,/179 CR/);
  assert.equal(debtor.performGearService(gun.uid,'repair',98).ok,false);assert.equal(debtor.fee,1);
  console.log('PASS insufficient 2 rounds and 1 durability denies 3/2 spend, unarmed bypass blocked, escape available; expiry before action deadline uses zero resources and loses carried gear only; insufficient bunker balance blocks repair.');
}
async function auxiliary(){
  const old=require('./fixtures/gear-v24-engage.json'),clock={now:old.session.field.action.start+1};
  const migrated=boot({},clock);
  await migrated.g.importFile(new Blob([JSON.stringify(old)]));
  const primary=migrated.g.gearWorn(migrated.g.s.field,'primary');
  assert.equal(primary.ammo,30);valid(migrated.g);finish(migrated);
  assert.equal(primary.ammo,30);assert.equal(primary.durability,100);
  assert.equal(migrated.g.s.field.legacyEngagement,undefined);
  go(migrated,'engage');finish(migrated);assert.equal(primary.ammo,27);valid(migrated.g);
  const b=boot(),g=b.g;
  const k=g.s.equipment;
  const rifle=g.gearWorn(k,'primary');rifle.ammo=1;
  // Controlled setup of gear from several unlock tiers. Field interaction and settlement use the real handlers.
  Object.assign(k.worn,{secondary:'rl12_sidearm',armor:'rl10_vest',head:'rl12_helmet',light:'flash'});
  const sidearm=g.gearWorn(k,'secondary').uid;
  g.gearWorn(k,'armor');g.gearWorn(k,'head');g.gearWorn(k,'light');g.persist();
  contact(b);
  const scans=g.s.field.steps;
  go(b,'engage',{slot:'secondary'});finish(b);
  const field=g.s.field;
  assert.equal(g.gearWorn(field,'secondary').ammo,10);assert.equal(g.gearWorn(field,'secondary').durability,99);
  assert.equal(g.gearWorn(field,'primary').ammo,1);
  assert.equal(g.gearWorn(field,'armor').durability,99);assert.equal(g.gearWorn(field,'head').durability,99);
  assert.equal(g.gearWorn(field,'light').durability,100-scans);
  b.setRandom(.01);go(b,'evade');finish(b);
  g.gear({gear:'ground-worn',slot:'secondary'});
  const ground=field.gearGround[g.s.raid.zone].find(u=>u.gear?.uid===sidearm);
  assert.ok(ground);valid(g);
  const checkpoint=await b.exportData(),other=boot({},b.clock);
  await other.g.importFile(new Blob([JSON.stringify(checkpoint)]));
  other.g.gear({gear:'recover',unit:ground.uid});valid(other.g);
  extract(other);
  assert.equal(other.g.s.lastSummary.gearReport.find(r=>r.uid===sidearm).disposition,'returned');
  assert.equal(other.g.s.stashSlots.find(u=>u.gear?.uid===sidearm).gear.ammo,10);
  extract(b);
  const left=g.s.lastSummary.gearReport.find(r=>r.uid===sidearm);assert.equal(left.disposition,'left');assert.equal(left.ammoUsed,2);
  assert.ok(!g.s.stashSlots.some(u=>u.gear?.uid===sidearm));valid(g);
  console.log('PASS real v24 pending combat backup migrated at original deadline without retrospective cost; separate secondary spend with dry primary, armor on impact, light wear on scan, leaving or recovering same gear UID on ground, cross-profile continuation and bag-to-stash settlement.');
}
run().then(otherPaths).then(auxiliary).catch(error=>{console.error(error);process.exitCode=1});
