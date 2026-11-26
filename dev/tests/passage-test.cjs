const {assert,boot,clone,extract,finish,go,move,stamp,v12,valid}=require('./game-fixture.cjs');
const JOB='passage-test';
const site=(b,index)=>go(b,'landmark',{index});
const act=(b,step,from)=>go(b,'passage',{step,from:String(from),raidId:String(b.g.s.raid.startedAt)});
function newRaid(b,zone){b.clock.now+=1000;b.g.moveNow(zone);b.setRandom(.1);b.g.start();}
function search(b,index){
  while(!b.g.s.field.found[0].includes(index)){go(b,'scan');finish(b);}
  go(b,'open',{index});go(b,'search');
  while(b.g.s.field.action)finish(b);
  assert.equal(b.g.s.field.boxes['0-'+index].complete,true);go(b,'close');
}
function normal(b){stamp(b,b.g.s.raid.startedAt+420000);extract(b);}
function quota(b,fn){const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};try{fn();}finally{b.storage.set=set;}}
async function main(){
  const first=boot(),g=first.g;g.order(JOB);assert.equal(g.s.career.order,null);valid(g);
  g.order('stores');newRaid(first,0);search(first,0);search(first,1);extract(first);g.ack();
  assert.equal(g.fee,62000);g.order(JOB);
  const baseline=clone(g.s);
  for(const [origin,fix,cr,xp] of [[0,'local',28000,90],[1,'service',46000,145]]){
    const b=boot({[v12]:baseline},{now:first.clock.now+1000}),e=b.g;
    newRaid(b,0);act(b,'plan',origin);assert.equal(e.s.field.gateTest,undefined);
    site(b,9);quota(b,()=>act(b,'plan',origin));assert.equal(e.s.field.gateTest,undefined);
    act(b,'plan',1-origin);act(b,'plan',origin);valid(e);
    const planned=boot({[v12]:clone(e.s)},{now:b.clock.now});extract(planned);
    assert.equal(planned.g.s.career.gateTest,undefined);assert.equal(planned.g.s.lastSummary.commission,0);
    normal(b);assert.equal(e.s.career.gateTest.from,origin);assert.equal(e.s.lastSummary.commission,0);valid(e);e.ack();
    e.order(JOB);newRaid(b,origin);move(b,1-origin);go(b,'abandon');e.ack();
    e.order(JOB);newRaid(b,origin);
    const before=JSON.stringify(e.s);go(b,'move',{index:1-origin});assert.equal(JSON.stringify(e.s),before);
    // Enumerate all nine pairs on actual fresh copies of the active closure, without unlocking it.
    for(const start of [0,1,2])for(const end of [0,1,2]){
      const path=boot({[v12]:clone(e.s)},{now:b.clock.now});
      if(start!==origin){if(start===1-origin)move(path,2);move(path,start);}
      if(start===origin&&end===1-origin){
        go(path,'move',{index:end});assert.ok(!path.g.s.field.journey);
        assert.equal(path.g.route(start,2)+path.g.route(2,end),5);
        move(path,2);move(path,end);
      }else if(start!==end)move(path,end);
      assert.equal(path.g.s.raid.zone,end);
      assert.equal(path.g.s.career.gateTest.from,origin);assert.ok(!path.g.s.field.gateTest);
    }
    const backup=await b.exportData();
    const reopen=boot({},b.clock);await reopen.g.importFile(new Blob([JSON.stringify(backup)]));const t=reopen.g;
    assert.equal(t.s.career.gateTest.from,origin);go(reopen,'move',{index:1-origin});assert.ok(!t.s.field.journey);
    if(origin===1){move(reopen,2);site(reopen,3);act(reopen,'service');assert.ok(!t.s.field.gateTest);move(reopen,origin);}
    site(reopen,origin===0?9:0);act(reopen,'inspect');valid(t);
    const exam=clone(t.s.field.gateTest);act(reopen,'inspect');assert.deepEqual(clone(t.s.field.gateTest),exam);
    if(fix==='service'){move(reopen,2);site(reopen,3);}
    quota(reopen,()=>act(reopen,fix));assert.equal(t.s.field.gateTest.fix,undefined);
    act(reopen,fix);valid(t);const repaired=clone(t.s.field.gateTest);
    act(reopen,fix);assert.deepEqual(clone(t.s.field.gateTest),repaired);
    if(t.s.raid.zone!==origin)move(reopen,origin);
    move(reopen,1-origin);if(t.s.raid.zone!==0)move(reopen,0);
    for(const end of ['quick','expired','abandoned']){
      const q=boot({[v12]:clone(t.s)},{now:reopen.clock.now});
      if(end==='quick')extract(q);else if(end==='expired')stamp(q,q.g.s.raid.endsAt);else go(q,'abandon');
      assert.equal(q.g.s.lastSummary.commission,0);assert.ok(!q.g.s.career.gateTest.receipt);assert.equal(q.g.s.field.gateTest,undefined);
      q.g.ack();newRaid(q,origin);go(q,'move',{index:1-origin});assert.ok(!q.g.s.field.journey);
    }
    stamp(reopen,t.s.raid.startedAt+420000);go(reopen,'extract',{exit:'b04'});
    quota(reopen,()=>finish(reopen));assert.equal(t.fee,62000);assert.ok(!t.s.career.gateTest.receipt);
    t.tick();assert.equal(t.fee,62000+cr);assert.equal(t.s.lastSummary.missionXp,xp);valid(t);
    const data=await reopen.exportData();
    for(const mutate of [s=>s.career.gateTest.receipt.from=1-origin,s=>s.career.gateTest.receipt.fix='other',
        s=>s.career.gateTest.receipt.fixedAt=s.career.gateTest.receipt.at-1,s=>s.lastSummary.commission+=1,
        s=>s.career.gateTest.receipt.raidId=s.career.gateTest.raidId]){
      const bad=clone(data);mutate(bad.session);assert.equal(t.check(bad),false);
    }
    const cold=boot({},reopen.clock);await cold.g.importFile(new Blob([JSON.stringify(data)]));
    cold.g.ack();cold.g.order(JOB);assert.equal(cold.g.s.career.order,null);
    assert.equal(cold.g.s.career.done.filter(x=>x===JOB).length,1);newRaid(cold,origin);move(cold,1-origin);
    assert.equal(cold.g.fee,62000+cr);
  }
  console.log('PASS: genuine two searches unlock, optional one-way closure, cancellation, inverse and warehouse roads, three real zone locations, wrong site/no inspect protected, both restoration rates, early/MIA/abandon retry, save quota rollback, restored original receipt and 1x settlement.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
