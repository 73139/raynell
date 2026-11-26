// Start from the old game's exported save, then drive contracts, construction
// recognition, campaign receipts and final operation through the normal actions.
const fs=require('node:fs');
const {assert,boot,clone,extract,finish,go,move,stamp,valid}=require('./game-fixture.cjs');
const {baseline,prebuilt}=require('./fixtures/campaign-v21.json');
const oldFlagged=require('./fixtures/finale-v21.json');
const fileKey='rl-reboot-session-v36',oldKey='rl-reboot-session-v21';
const finalQuest='repair-first-call';
const old=()=>({...clone(baseline.session),...clone(prebuilt.changes),...clone(oldFlagged.changes)});
function ok(r){assert.equal(r.ok,true,r.message)}
function reject(r){assert.equal(r.ok,false,r.message)}
function begin(b){b.clock.now+=1000;b.g.start();return b.g.s.raid.startedAt}
function sign(b,zone,id=b.g.s.raid.startedAt){return b.g.finaleAction('signal',zone,id)}
function advanceChapters(){
  const b=boot({[oldKey]:old()},{now:oldFlagged.now+1000}),g=b.g;
  assert.equal(g.s.finale.armed,false);assert.equal(g.s.finale.reply,null);assert.equal(g.s.finale.attempt,null);
  assert.equal(g.campaignView().done,0);assert.equal(g.finaleView().status,'locked');
  assert.equal(g.status(finalQuest).status,'ready');
  for(const name of ['power','water','med']){
    ok(g.campaignAction(name,'deliver',2,0));
    begin(b);extract(b);g.ack();ok(g.campaignAction(name,'claim'));
  }
  assert.equal(g.campaignView().done,3);assert.equal(g.finaleView().status,'locked');
  assert.ok(g.finaleView().facilities.every(x=>x.built));
  reject(g.finaleAction('arm'));
  valid(g);
  return b;
}
function checkFlags(g){
  for(const q of ['supply-pantry','medic-ward-round','quarter-rollcall',finalQuest])
    assert.equal(g.status(q).status,'claimed');
  assert.equal(g.finaleView().traders.filter(t=>t.done).length,4);
}
async function workflow(){
  const base=advanceChapters(),g=base.g;
  if(process.env.RUSTLINE_EXPORT_FINALE_FIXTURE){
    fs.writeFileSync(process.env.RUSTLINE_EXPORT_FINALE_FIXTURE,JSON.stringify(await base.exportData())+'\n');
    return;
  }
  const sourceWallet=g.s.wallet, q=g.quests.find(x=>x.id===finalQuest);
  ok(g.contract(finalQuest,'claim'));
  assert.equal(g.s.wallet,sourceWallet+q.cr);checkFlags(g);
  assert.equal(g.finaleView().status,'available');
  // Claimed fourth quest and completed chapters still require explicit arming.
  begin(base);assert.equal(g.s.finale.attempt,null);reject(sign(base,0));extract(base);g.ack();
  ok(g.finaleAction('arm'));ok(g.finaleAction('cancel'));assert.equal(g.finaleView().armed,false);
  const originalWrite=base.storage.set;
  base.storage.set=()=>{throw Error('arm quota')};
  reject(g.finaleAction('arm'));assert.equal(g.s.finale.armed,false);
  base.storage.set=originalWrite;ok(g.finaleAction('arm'));
  let id=begin(base);assert.equal(g.s.finale.attempt.raidId,id);
  reject(sign(base,1));reject(sign(base,0,id-1));ok(sign(base,0));reject(sign(base,0));
  extract(base);assert.equal(g.s.finale.reply,null);g.ack();assert.equal(g.finaleView().status,'available');
  ok(g.finaleAction('arm'));id=begin(base);ok(sign(base,0));move(base,1);ok(sign(base,1));move(base,2);ok(sign(base,2));move(base,0);
  // The game's hard cutoff rejects a ten-second countdown with exactly ten seconds left.
  const end=g.s.raid.endsAt;stamp(base,end-10000);go(base,'extract',{exit:'b04'});assert.equal(g.s.field.action,null);assert.match(g.condition('b04'),/시간 부족/);
  stamp(base,end);assert.equal(g.s.field.result,'expired');assert.equal(g.s.finale.reply,null);g.ack();
  assert.equal(g.finaleView().status,'available');assert.equal(g.s.finale.attempt,null);
  ok(g.finaleAction('arm'));id=begin(base);
  const stored=base.storage.get(fileKey);
  base.storage.set=()=>{throw Error('station quota')};reject(sign(base,0));assert.equal(base.storage.get(fileKey),stored);
  assert.deepEqual(clone(g.s.finale.attempt.confirmed),[]);
  base.storage.set=originalWrite;ok(sign(base,0));
  const first=boot(new Map(base.storage),base.clock);assert.deepEqual(clone(first.g.s.finale),clone(g.s.finale));
  first.setRandom(.01);go(first,'move',{index:1});reject(sign(first,0));reject(sign(first,1));
  const backup=await first.exportData();assert.ok(first.g.check(backup));valid(first.g);
  const other=boot({},first.clock);await other.g.importFile(new Blob([JSON.stringify(backup)]));
  assert.deepEqual(clone(other.g.s.finale.attempt),{raidId:id,confirmed:[0]});
  assert.equal(other.g.s.field.action.end,first.g.s.field.action.end);
  finish(other);ok(sign(other,1));
  const concurrent=boot(other.storage,other.clock);
  // Two independent views of an older revision must never append a second station.
  reject(sign(concurrent,1));move(concurrent,2);ok(sign(concurrent,2));reject(sign(other,1));
  assert.deepEqual(clone(concurrent.g.s.finale.attempt.confirmed),[0,1,2]);
  move(concurrent,0);const wallet=concurrent.g.s.wallet;extract(concurrent);
  assert.equal(concurrent.g.s.lastSummary.finaleReply,true);
  assert.equal(concurrent.g.finaleView().status,'complete');
  assert.deepEqual(clone(concurrent.g.s.finale.reply),{raidId:id});assert.equal(concurrent.g.s.finale.attempt,null);
  assert.equal(concurrent.g.s.wallet,wallet);
  concurrent.g.ack();reject(concurrent.g.finaleAction('arm'));checkFlags(concurrent.g);
  const complete=await concurrent.exportData();assert.ok(concurrent.g.check(complete));valid(concurrent.g);
  const saved=boot({},concurrent.clock);await saved.g.importFile(new Blob([JSON.stringify(complete)]));
  assert.deepEqual(clone(saved.g.s.finale),clone(concurrent.g.s.finale));
  begin(saved);extract(saved);saved.g.ack();assert.equal(saved.g.s.finale.reply.raidId,id);
  assert.ok(!saved.g.s.lastSummary.finaleReply);
  for(const mutate of [
    s=>{s.finale.armed=true},s=>{s.finale.reply.raidId=0},s=>{s.campaign.claimed.pop()},
    s=>{s.contracts.repair.done=[]},s=>{s.finale.attempt={raidId:id,confirmed:[0,0]}}
  ]){const invalid=clone(complete);mutate(invalid.session);assert.equal(saved.g.check(invalid),false)}
  console.log('PASS actual v21 permanent quest receipts + unclaimed ready gate, 3 campaign receipts, explicit arming/cancel, incomplete extraction and exact-deadline failure, 3 in-zone signals, reload/JSON mid-travel, rollback/retry and durable one-time ending.');
}
workflow().catch(e=>{console.error(e);process.exitCode=1});
