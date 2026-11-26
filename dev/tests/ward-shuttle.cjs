const {assert,boot,clone,extract,finish,go,move,stamp,v12,valid}=require('./game-fixture.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rustline-shuttle-'));
const filename=path.join(folder,'packed.json');
const job='ward-shuttle';
let verified;
try{
  execFileSync(process.execPath,['tests/ward-packing.cjs'],{env:{...process.env,RUSTLINE_EXPORT_WARD_PACKED:filename}});
  verified=JSON.parse(fs.readFileSync(filename,'utf8')).session;
}finally{fs.rmSync(folder,{recursive:true,force:true});}
function begin(s=verified){
  return boot({[v12]:s},{now:Math.max(verified.career.wardCheckReceipt.at+300000,s.career.shuttle?.returnedAt+1||0)});
}
function launch(b,zone){
  b.clock.now+=1000;b.g.moveNow(zone);b.setRandom(.10);b.g.start();
}
const site=(b,n)=>go(b,'landmark',{index:n});
const action=(b,step,route)=>go(b,'shuttle',{step,route,raidId:String(b.g.s.raid.startedAt)});
function depart(b,normal){
  if(b.g.s.raid.zone!==0)move(b,0);
  if(normal)stamp(b,Math.max(b.clock.now,b.g.s.raid.startedAt+420000));
  extract(b);
}
function failure(b,fn){
 const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};
 try{fn()}finally{b.storage.set=set;}
}
function beforePaid(b){assert.equal(b.g.s.lastSummary.commission,0);assert.ok(!b.g.s.career.done.includes(job));}
async function main(){
  const locked=boot();locked.g.order(job);assert.equal(locked.g.s.career.order,null);
  for(const chosen of ['local','freight']){
    const b=begin(),g=b.g,money=g.fee,xp=g.s.career.xp;
    g.order(job);assert.equal(g.s.career.order,job);assert.ok(g.pin({kind:'order',id:job}));
    launch(b,1);action(b,'plan',chosen);assert.ok(!g.s.field.shuttle);
    site(b,6);failure(b,()=>action(b,'plan',chosen));assert.ok(!g.s.field.shuttle);
    action(b,'plan',chosen);valid(g);depart(b,false);beforePaid(b);assert.equal(g.s.career.shuttle,undefined);g.ack();
    launch(b,1);site(b,6);action(b,'plan',chosen==='local'?'freight':'local');action(b,'plan',chosen);
    const select=clone(g.s.field.shuttle);valid(g);depart(b,true);
    assert.equal(g.s.career.shuttle.route,chosen);assert.equal(g.s.career.shuttle.at,select.at);
    assert.equal(g.fee,money);beforePaid(b);valid(g);g.ack();
    const remembered=clone(g.s.career.shuttle);
    g.order(job);assert.equal(g.s.career.order,null);g.order(job);assert.deepEqual(clone(g.s.career.shuttle),remembered);assert.ok(g.pin({kind:'order',id:job}));
    // A failed switch cannot erase the last confirmed route.
    launch(b,1);site(b,6);action(b,'plan',chosen==='local'?'freight':'local');go(b,'abandon');
    assert.deepEqual(clone(g.s.career.shuttle),remembered);g.ack();
    const cost=chosen==='local'?38000:50000,bonus=chosen==='local'?120:155,zone=chosen==='local'?0:2;
    launch(b,zone);site(b,1);action(b,'call');valid(g);let run=clone(g.s.field.shuttle);
    assert.equal(run.route,chosen);action(b,'call');assert.deepEqual(clone(g.s.field.shuttle),run);
    action(b,'arrive');assert.ok(!g.s.field.shuttle.arrived);
    for(const offset of [-1,0]){
      const cutoff=boot({[v12]:clone(g.s)},{now:b.clock.now});
      if(zone)move(cutoff,1);
      site(cutoff,zone?1:7);
      stamp(cutoff,run.at+(chosen==='local'?45000:90000)+offset);
      action(cutoff,'arrive');assert.equal(Boolean(cutoff.g.s.field.shuttle.arrived),offset<0);
    }
    stamp(b,run.at+(chosen==='local'?45000:90000));action(b,'arrive');assert.ok(!g.s.field.shuttle.arrived);
    assert.equal(g.objective().locations[0].zone,zone);action(b,'call');assert.ok(g.s.field.shuttle.at>run.at);
    run=clone(g.s.field.shuttle);const back=await b.exportData();
    const restored=boot({},b.clock);await restored.g.importFile(new Blob([JSON.stringify(back)]));const p=restored.g;
    assert.deepEqual(clone(p.s.field.shuttle),run);
    if(zone)move(restored,1);site(restored,zone?1:7);
    failure(restored,()=>action(restored,'arrive'));assert.ok(!p.s.field.shuttle.arrived);
    action(restored,'arrive');assert.ok(p.s.field.shuttle.arrived);valid(p);
    const receipt=clone(p.s.field.shuttle);
    // Independent copies exercise quick return and MIA. Earlier booking persists without the call.
    for(const trial of ['quick','expired']){
      const t=boot({[v12]:clone(p.s)},{now:restored.clock.now});
      if(trial==='quick')depart(t,false);else stamp(t,t.g.s.raid.endsAt);
      beforePaid(t);assert.deepEqual(clone(t.g.s.career.shuttle),remembered);valid(t.g);
    }
    if(zone)move(restored,0);stamp(restored,p.s.raid.startedAt+420000);
    go(restored,'extract',{exit:'b04'});failure(restored,()=>finish(restored));assert.equal(p.s.field.result,null);assert.equal(p.fee,money);
    p.tick();assert.equal(p.fee,money+cost);assert.equal(p.s.lastSummary.missionXp,bonus);
    assert.equal(p.s.career.shuttle.receipt.at,receipt.at);assert.equal(p.s.career.shuttle.receipt.arrived,receipt.arrived);
    assert.ok(p.s.career.xp>=xp+bonus);valid(p);p.ack();p.order(job);assert.equal(p.s.career.order,null);
    const final=await restored.exportData();const cold=boot({},restored.clock);await cold.g.importFile(new Blob([JSON.stringify(final)]));
    assert.deepEqual(clone(cold.g.s.career.shuttle),clone(p.s.career.shuttle));assert.equal(cold.g.fee,money+cost);
    for(const change of [s=>s.career.shuttle.receipt.route='bogus',s=>s.career.shuttle.receipt.arrived+=100000,
      s=>delete s.career.wardCheckReceipt,s=>s.career.shuttle.receipt.raidId=s.career.shuttle.raidId,s=>s.lastSummary.commission=1,
      s=>delete s.career.shuttle.receipt]){
      const copy=clone(final);change(copy.session);assert.equal(cold.g.check(copy),false);
    }
  }
  console.log('PASS: genuinely paid packing prerequisite; both 2-sortie lines, route changes, expiry/retry, failed writes, real JSON restore, lost runs, remote premium and single final payment.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
