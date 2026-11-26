// This profile has completed the ordinary campaign and built its own clinic starting from 30,000 CR.
const fs=require('node:fs');
const {assert,boot,clone,epoch,extract,finish,go,stamp,v12,valid,setTestCash}=require('./game-fixture.cjs');
const b=require('./campaign-new-player.cjs'),g=b.g;
const item='rl_craft_dressing',sheet='rl_bp_dressing',recipe='folded-dressing';
const copies=g=>g.s.stashSlots.filter(u=>u.g===item),success=r=>assert.ok(r.ok,r.message);
const quota=(b,fn)=>{const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};try{return fn();}finally{b.storage.set=set;}};
const sameEconomy=g=>JSON.stringify({r:g.s.revision,t:g.s.hideout.wardTrial,slots:g.s.stashSlots,qty:g.stock(item),cash:g.s.cash,wallet:g.fee,xp:g.s.career.xp});
async function run(){
  assert.equal(g.s.hideout.levels.med,1);assert.equal(g.quests.length,64);assert.equal(g.s.hideout.wardManual.registered,false);
  assert.equal(g.wardTrialView(),null);assert.equal(g.wardTrialPanel(),'');assert.ok(!g.wardTrialAction('accept').ok);
  const quest=g.quests.find(q=>q.trader==='medic'&&g.status(q.id).status==='available');
  success(g.contract(quest.id,'accept'));assert.ok(g.pin({kind:'contract',id:quest.id}));
  const contracts=clone(g.s.contracts),pin=clone(g.s.objectivePin),standing=clone(g.standing('medic'));
  g.moveNow(0);b.setRandom(.999999);g.start();b.setRandom(.1);
  go(b,'landmark',{index:7});go(b,'scan');finish(b);go(b,'open',{index:14});
  const original=g.s.field.boxes['0-14'].items.find(u=>u.g===sheet);assert.ok(original&&!original.revealed);
  go(b,'search',{uid:original.uid});finish(b);g.selectLoot(original.uid);go(b,'close');extract(b);g.ack();
  assert.ok(g.s.stashSlots.some(u=>u.uid===original.sheetUid));assert.equal(g.wardTrialPanel(),'');
  for(const id of ['bandage','gauze'])success(g.trade('medic','buy',id,2));
  if(process.env.RUSTLINE_TRIAL_CHECKPOINT){
    fs.writeFileSync(process.env.RUSTLINE_TRIAL_CHECKPOINT,JSON.stringify(await b.exportData()));
    fs.writeFileSync(process.env.RUSTLINE_TRIAL_CHECKPOINT+'.time',String(b.clock.now));
  }
  g.build({id:'med',hideout:'manual-register',uid:original.sheetUid});assert.equal(g.wardTrialView().stage,'available');
  const beforeAccept=sameEconomy(g);assert.ok(!quota(b,()=>g.wardTrialAction('accept')).ok);assert.equal(sameEconomy(g),beforeAccept);
  success(g.wardTrialAction('accept'));assert.ok(!g.wardTrialAction('accept').ok);
  for(let i=0;i<2;i++){g.build({id:'med',hideout:'produce',recipe});const end=g.s.hideout.production.med.end;stamp(b,end);assert.ok(!g.s.hideout.production.med);}
  const two=copies(g);assert.ok(two.length>=2);
  const first=two[0].uid,chosen=two[1].uid;
  const snap=clone(g.s),stored=await b.exportData();
  assert.notEqual(first,chosen);assert.ok(!g.wardTrialAction('deliver','unknown').ok);
  const before=sameEconomy(g),atXP=g.s.career.xp,atCR=g.fee,r=g.s.revision;
  assert.ok(!quota(b,()=>g.wardTrialAction('deliver',chosen)).ok);assert.equal(sameEconomy(g),before);
  success(g.wardTrialAction('deliver',chosen));assert.equal(g.s.revision,r+1);
  assert.ok(copies(g).some(u=>u.uid===first)&&!copies(g).some(u=>u.uid===chosen));
  assert.deepEqual(clone(g.s.hideout.wardTrial.paid),{uid:chosen,at:b.clock.now,beforeCR:atCR,beforeXP:atXP});
  assert.equal(g.fee,atCR+10000);assert.equal(g.cashBalance(),g.fee);assert.equal(g.s.career.xp,atXP+25);
  assert.deepEqual(clone(g.s.contracts),contracts);assert.deepEqual(clone(g.s.objectivePin),pin);assert.deepEqual(clone(g.standing('medic')),standing);
  const paid=sameEconomy(g);assert.ok(!g.wardTrialAction('deliver',first).ok);assert.equal(sameEconomy(g),paid);valid(g);
  const reloaded=boot(new Map(b.storage),b.clock);const copied=boot();await copied.g.importFile(new Blob([JSON.stringify(await b.exportData())]));
  for(const n of [reloaded,copied]){assert.equal(n.g.wardTrialView().stage,'paid');assert.ok(!n.g.wardTrialAction('deliver',first).ok);assert.equal(n.g.cashBalance(),atCR+10000);valid(n.g);}
  const legacy=clone(stored);delete legacy.session.hideout.wardTrial;assert.ok(g.check(legacy));
  const old=boot();await old.g.importFile(new Blob([JSON.stringify(legacy)]));assert.equal(old.g.wardTrialView().stage,'available');assert.equal(old.g.fee,atCR);
  for(const damage of [
    s=>s.hideout.wardManual.registered=false,s=>s.hideout.levels.med=0,s=>s.hideout.wardTrial.paid.uid=first,
    s=>s.hideout.wardTrial.paid.beforeXP=Number.MAX_SAFE_INTEGER,s=>s.hideout.wardTrial.paid.beforeCR=Number.MAX_SAFE_INTEGER,
    s=>s.hideout.wardTrial.paid.at=s.hideout.wardTrial.acceptedAt-1,s=>s.career.xp=0
  ]){const v=await b.exportData();damage(v.session);assert.ok(!g.check(v));}

  // Older tabs and concurrent deliveries of two different physical copies compete for the same one-time receipt.
  const alpha=boot({[v12]:snap},b.clock),beta=boot(alpha.storage,b.clock);
  success(beta.g.wardTrialAction('deliver',chosen));
  assert.ok(!alpha.g.wardTrialAction('deliver',first).ok);assert.deepEqual(clone(alpha.g.s.hideout.wardTrial),clone(beta.g.s.hideout.wardTrial));
  assert.ok(copies(alpha.g).some(u=>u.uid===first));assert.equal(alpha.g.fee,atCR+10000);
  const bagged=boot({[v12]:snap},b.clock);
  bagged.g.gear({gear:'pack',id:item,unit:chosen});
  const carried=bagged.g.s.equipment.bag.find(u=>u.g===item);assert.ok(carried);
  assert.ok(!bagged.g.wardTrialAction('deliver',carried.uid).ok);assert.ok(!bagged.g.wardTrialAction('deliver',chosen).ok);
  assert.equal(bagged.g.wardTrialView().copies.length,two.length-1);assert.equal(bagged.g.fee,atCR);
  const waiting=clone(snap);
  waiting.stashSlots=waiting.stashSlots.filter(u=>u.g!==item);
  const unplaced=boot({[v12]:waiting},b.clock);
  assert.ok(unplaced.g.stock(item)>=2);assert.equal(unplaced.g.wardTrialView().copies.length,0);
  assert.ok(!unplaced.g.wardTrialAction('deliver','overflow').ok);
  const max=Number.MAX_SAFE_INTEGER;
  for(const [cr,xp,canPay] of [[max-9999,149,false],[5000,max-24,false],[max-10000,max-25,true]]){
    const s=clone(snap);setTestCash(s,cr);s.career.xp=xp;
    const n=boot({[v12]:s},b.clock),originalState=sameEconomy(n.g),res=n.g.wardTrialAction('deliver',chosen);
    assert.equal(res.ok,canPay);if(!canPay)assert.equal(sameEconomy(n.g),originalState);else{assert.equal(n.g.fee,max);assert.equal(n.g.s.career.xp,max);valid(n.g);}
  }
  // The reward uses the physical drawer even when every grid cell was occupied and the drawer was empty.
  const packed=clone(snap);setTestCash(packed,0);packed.career.xp=149;
  const rows=32+8*packed.hideout.levels.stash;
  for(let y=0;y<rows;y++)for(let x=0;x<6;x++){
    if(packed.stashSlots.some(u=>x>=u.x&&x<u.x+u.w&&y>=u.y&&y<u.y+u.h))continue;
    packed.stashSlots.push({g:'cloth',uid:'s-cap-'+x+'-'+y,x,y,w:1,h:1});
    packed.stash.cloth=(packed.stash.cloth||0)+1;
  }
  const full=boot({[v12]:packed},b.clock);assert.equal(full.g.level(),1);success(full.g.wardTrialAction('deliver',chosen));
  assert.equal(full.g.s.cash.pocket[0].amount,10000);assert.equal(full.g.level(),2);valid(full.g);
  const field=boot({[v12]:snap},b.clock);field.g.moveNow(0);field.g.start();assert.ok(!field.g.wardTrialAction('deliver',chosen).ok);
  assert.equal(field.g.wardTrialView().stage,'active');
  console.log('PASS earned clinic + searched/recovered original → native registration/2 real timed crafts → choose second loose UID; full 64-contract/standing and objective isolation, +10,000 physical CR/+25 cumulative XP once.');
  console.log('PASS durable JSON/legacy restoration, seven invalid receipts, lost writes, duplicate/racing tabs, full grid & empty drawer, exact/overflowing safe-integer boundaries, level crossing, raid lock.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
