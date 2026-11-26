// Campaign integration against the packed game, with v0.21 exporter fixtures.
const {assert,boot,clone,extract,go,stamp,valid} = require('./game-fixture.cjs');
const {baseline,prebuilt} = require('./fixtures/campaign-v21.json');
const oldKey='rl-reboot-session-v21', key='rl-reboot-session-v36';
const definitions=[
  ['power','food',5000,35],
  ['water','water',6500,45],
  ['med','bandage',8000,60]
];
function legacy(mode='baseline') {
  const data=clone(baseline.session);
  if(mode==='prebuilt')Object.assign(data,clone(prebuilt.changes));
  return boot({[oldKey]:data},{now:(mode==='prebuilt'?prebuilt.now:data.lastSummary.raidId)+60000});
}
const names=s=>Array.from(s.presets,x=>x.name);
const box=s=>s.stashSlots.find(x=>x.alias==='야간 정비함');
const raw=s=>clone({campaign:s.campaign,stash:s.stash,slots:s.stashSlots,bag:s.equipment.bag,wallet:s.wallet,career:s.career,pin:s.objectivePin});
function goods(s,id){
  return (s.stash[id]||0)+s.equipment.bag.filter(u=>u.g===id).length+
    s.stashSlots.reduce((n,u)=>n+(u.contents?.filter(x=>x.g===id).length||0),0);
}
function good(result){assert.equal(result.ok,true,result.message)}
function bad(result){assert.equal(result.ok,false,result.message)}
function donate(g,id,qty=1,expected=undefined){return g.campaignAction(id,'deliver',qty,expected)}
function claim(g,id){return g.campaignAction(id,'claim')}
function sortie(b,success){
  b.clock.now+=5000;
  b.g.start();
  const id=b.g.s.raid.startedAt;
  if(success)extract(b);else go(b,'abandon');
  assert.equal(b.g.s.field.result,success?'success':'abandoned');b.g.ack();
  return id;
}
function noChange(b,fn){const before=raw(b.g.s),disk=b.storage.get(key);fn();assert.deepEqual(raw(b.g.s),before);assert.equal(b.storage.get(key),disk)}
function receipt(g,claimed,delivered,returnId){assert.deepEqual(clone(g.s.campaign),{claimed,delivered,returnId});}
async function chapterLoop() {
  let b=legacy(),g=b.g;
  assert.equal(g.s.version,36);assert.equal(g.s.career.returns,1);
  assert.deepEqual(names(g.s),['전력 복구반','정수 복구반']);
  assert.deepEqual(clone(g.s.objectivePin),baseline.session.objectivePin);
  assert.equal(g.s.campaign.returnId,null,'old successful sortie is not credit for a new chapter');
  receipt(g,[],0,null);
  const oldDisk=b.storage.get(oldKey), paid=[];
  valid(g);assert.equal(g.pin({kind:'campaign',id:'power'}),true);
  const spectator=clone(box(g.s).contents.find(u=>u.g==='matches'));
  for(let i=0;i<definitions.length;i++){
    const [id,item,cash,xp]=definitions[i];
    const v=g.campaignView();assert.equal(v.delivered,0);assert.equal(v.remaining,2);assert.equal(v.returned,false);
    const c=g.s.campaign;
    assert.equal(c.claimed.length,i);
    noChange(b,()=>bad(claim(g,id)));
    noChange(b,()=>bad(donate(g,id,3)));
    if(i<2)noChange(b,()=>bad(donate(g,definitions[i+1][0],1)));
    // Pay for the actual facility and settle its real 10-minute timer.
    const oldWallet=g.s.wallet;
    g.build({hideout:'build',id,tier:1});
    const end=g.s.hideout.builds[id]?.end;
    assert.equal(end,b.clock.now+600000);
    assert.equal(g.s.wallet,oldWallet-20000);
    const left=goods(g.s,item);
    good(donate(g,id,1,0));
    assert.equal(goods(g.s,item),left-1);assert.equal(g.campaignView().delivered,1);
    const remaining=g.campaignView().available;
    noChange(b,()=>bad(donate(g,id,1,0)));
    assert.equal(g.campaignView().available,remaining);
    if(i===0){
      assert.equal(g.s.equipment.bag.some(x=>x.g==='food'),false,'held food is submitted first');
      assert.equal(box(g.s).contents.filter(x=>x.g==='food').length,1);
      // One failure while construction and a donation are pending must not grant a return.
      sortie(b,false);assert.equal(g.campaignView().returned,false);assert.equal(g.campaignView().delivered,1);
      const backup=await b.exportData();assert.ok(g.check(backup));valid(g);
      const other=boot({},b.clock);
      await other.g.importFile(new Blob([JSON.stringify(backup)]));
      assert.deepEqual(raw(other.g.s),raw(g.s));
      assert.equal(other.g.s.hideout.builds.power.end,end);
      b=other;g=b.g;
    }
    good(donate(g,id,1,1));assert.equal(goods(g.s,item),left-2);
    noChange(b,()=>bad(donate(g,id,1,2)));
    const raidId=sortie(b,true);
    assert.equal(g.s.campaign.returnId,raidId);
    assert.equal(g.campaignView().ready,false);
    stamp(b,end-1);assert.equal(g.s.hideout.levels[id],0);
    const old=clone(g.s.campaign);
    b=boot(b.storage,b.clock);g=b.g;
    assert.deepEqual(clone(g.s.campaign),old);
    stamp(b,end);assert.equal(g.s.hideout.levels[id],1);assert.equal(g.campaignView().ready,true);
    const before=clone(g.s);good(claim(g,id));paid.push(raidId);
    assert.equal(g.s.wallet,before.wallet+cash);assert.equal(g.s.career.xp,before.career.xp+xp);
    assert.equal(g.s.campaign.claimed.length,i+1);
    receipt(g,paid.slice(),0,null);noChange(b,()=>bad(claim(g,id)));
    const next=definitions[i+1];
    assert.deepEqual(clone(g.s.objectivePin),next?{kind:'campaign',id:next[0]}:null);
    assert.deepEqual(clone(box(g.s).contents.find(u=>u.g==='matches')),spectator);
    valid(g);
  }
  assert.equal(g.campaignView().completed,true);assert.equal(g.campaignView().done,3);
  const final=await b.exportData(),newProfile=boot({},b.clock);
  await newProfile.g.importFile(new Blob([JSON.stringify(final)]));
  assert.equal(newProfile.g.campaignView().completed,true);
  assert.deepEqual(raw(newProfile.g.s),raw(g.s));
  assert.equal(oldDisk,JSON.stringify(baseline.session));
  console.log('PASS little-by-little donations from real bag, loose stock and named case; 3 distinct successful sorties and 1 failure, 3 × 10-minute jobs, active checkpoint export/import, 3 exactly-once awards, automatic pin advancement and durable final state.');
}
async function migrationAndFailures() {
  const full=legacy('prebuilt'),g=full.g;
  for(const [id] of definitions)assert.equal(g.s.hideout.levels[id],1);
  assert.equal(g.campaignView().built,true);receipt(g,[],0,null);
  const before=raw(g.s),intercept=full.storage.set;
  full.storage.set=()=>{throw Error('simulated quota')};
  noChange(full,()=>bad(donate(g,'power',1,0)));
  assert.deepEqual(raw(g.s),before);
  full.storage.set=intercept;
  const winner=boot(full.storage,full.clock);
  good(donate(winner.g,'power',1,0));
  const win=raw(winner.g.s),disk=full.storage.get(key);
  bad(donate(g,'power',1,0));
  assert.equal(full.storage.get(key),disk);assert.deepEqual(raw(g.s),win);
  good(donate(g,'power',1,1));sortie(full,true);
  assert.equal(g.campaignView().ready,true);
  full.storage.set=()=>{throw Error('claim quota')};
  noChange(full,()=>bad(claim(g,'power')));
  full.storage.set=intercept;
  const other=boot(full.storage,full.clock);good(claim(other.g,'power'));
  const redeemed=raw(other.g.s);bad(claim(g,'power'));assert.deepEqual(raw(g.s),redeemed);
  assert.deepEqual(clone(g.s.objectivePin),baseline.session.objectivePin,'claim leaves a player-selected non-campaign objective in place');
  const ok=await full.exportData();assert.ok(g.check(ok));valid(g);
  const failures=[
    c=>{c.delivered=3}, c=>{c.delivered=0.5},c=>{c.returnId=0},
    c=>{c.claimed=[0]},c=>{c.claimed=[111,111]},c=>{c.claimed=[1,2,3,4]},
    c=>{c.returnId=c.claimed[0]},c=>{c.claimed=[1,2,3];c.delivered=1}
  ];
  for(const mutate of failures){
    const invalid=clone(ok);mutate(invalid.session.campaign);
    assert.equal(g.check(invalid),false,mutate.toString());
  }
  for(const change of [{campaignStage:'med'},{result:'abandoned'}]){
    const invalid=clone(ok);Object.assign(invalid.session.lastSummary,change);
    assert.equal(g.check(invalid),false,JSON.stringify(change));
  }
  const payload={format:'rustline-tc01',session:{...clone(baseline.session),...clone(prebuilt.changes)}};
  const restored=boot({},full.clock);await restored.g.importFile(new Blob([JSON.stringify(payload)]));
  assert.equal(restored.g.campaignView().built,true);receipt(restored.g,[],0,null);
  assert.deepEqual(names(restored.g.s),['전력 복구반','정수 복구반']);
  console.log('PASS authentic prebuilt v21 save and file migration; no past-return award, donation/claim quota rollback, revision conflicts, readback and malformed campaign backup rejects.');
}
(async()=>{await chapterLoop();await migrationAndFailures()})().catch(e=>{console.error(e);process.exitCode=1});
