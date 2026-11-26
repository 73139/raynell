// Historical observations remain tied to a particular sortie, even after its physical gear is gone.
const {assert,boot,clone,extract,go,valid,v12}=require('./game-fixture.cjs');
async function main(){
  const b=boot(),g=b.g,uid=g.s.equipment.instances.primary.uid;
  const db=require('../Rustline_Database_v10.json');
  const bounds=g.areas.flatMap(z=>z.boxes).reduce((n,box)=>n+Math.max(...db.containers[box[2]].itemcountDistribution.map(draw=>draw.count)),0);
  const [cols,rows]=g.kitCapacity({back:'rl_x_pack',support:'rl_13_16'});
  assert.ok(bounds+cols*rows+15<=320);
  for(const from of [0,1,2])for(const to of [0,1,2]){
    assert.ok((g.routeProfile(from,to)?.items||[]).every(entry=>!g.gearSpec(entry.tpl)));
  }
  function sortie(disposition){
    b.clock.now+=1000;g.start();
    if(disposition==='left')g.gear({gear:'ground-worn',slot:'primary'});
    if(disposition==='lost')go(b,'abandon');else extract(b);
    const report=clone(g.s.lastSummary.gearReport),history=clone(g.s.career.history[0]);
    assert.deepEqual(history.gearReport,report);valid(g);g.ack();return report;
  }
  assert.equal(sortie('returned').find(r=>r.uid===uid).disposition,'returned');
  assert.equal(sortie('left').find(r=>r.uid===uid).disposition,'left');
  assert.deepEqual(sortie('empty'),[]);
  const backup=await b.exportData(),other=boot({},b.clock);
  await other.g.importFile(new Blob([JSON.stringify(backup)]));
  assert.deepEqual(clone(other.g.s.career.history),clone(g.s.career.history));
  assert.equal(other.g.s.stashSlots.length,0);
  for(const [i,term] of ['개별 정산 장비 없음','현장에 남김','회수'].entries()){
    other.click({page:'journal'});other.click({bui:'history',index:String(i)});
    assert.ok(other.content().includes(term));assert.equal(other.content().includes(uid),i>0);
  }
  const legacy=clone(backup);
  for(const row of legacy.session.career.history)delete row.gearReport;
  assert.ok(g.check(legacy));const old=boot({[v12]:legacy.session});old.click({page:'journal'});old.click({bui:'history',index:'1'});
  assert.ok(old.content().includes('이전 출격의 개별 장비 내역은 보관되지 않았습니다.'));
  assert.ok(!old.content().includes(uid));
  const prior=clone(backup.session.career.history[1].gearReport[0]);
  for(const mutate of [
    row=>row.gearReport[0].ammoUsed=31,row=>row.gearReport[0].wear=101,row=>row.gearReport[0].durabilityBefore=-1,
    row=>row.gearReport[0].uid='bad*id',row=>row.gearReport[0].g='water',row=>row.gearReport[0].disposition='lost',
    row=>row.gearReport[0].spare=5,row=>row.gearReport.push({...row.gearReport[0]}),row=>row.gearOmitted=1,
    row=>row.gearReport=Array.from({length:321},(_,n)=>({...prior,uid:'s-test-'+n}))
  ]){
    const bad=clone(backup);mutate(bad.session.career.history[1]);assert.equal(g.check(bad),false);
  }
  const contradiction=clone(backup);contradiction.session.career.history[0].gearReport=[prior];
  assert.equal(g.check(contradiction),false);
  const bounded=clone(backup);const cap=bounded.session.career.history[1];
  cap.gearReport=Array.from({length:320},(_,n)=>({...prior,uid:'s-test-'+n}));cap.gearOmitted=1;
  assert.ok(g.check(bounded));const big=boot({[v12]:bounded.session});big.click({page:'journal'});big.click({bui:'history',index:'1'});
  assert.ok(big.content().includes('추가 1개 생략'));
  // Import rejection keeps all previous physical holdings, balance and real receipts.
  const held=JSON.stringify(other.g.s);await other.g.importFile(new Blob([JSON.stringify(contradiction)]));assert.equal(JSON.stringify(other.g.s),held);
  const local=clone(backup.session);local.career.history[1].gearReport[0].g='invalid';const corrupt=boot({[v12]:local});assert.ok(!corrupt.g.s.career.history[1].gearReport);
  for(let i=0;i<12;i++)sortie('empty');
  assert.equal(g.s.career.history.length,12);assert.ok(g.s.career.history.every(r=>r.gearReport.length===0));valid(g);
  const spent=boot();spent.g.start();go(spent,'abandon');
  assert.equal(spent.g.s.career.history[0].gearReport[0].disposition,'lost');valid(spent.g);
  console.log('PASS original UID returned → left behind → absent, explicit loss, 12-row retention, 320-instance cap, whole-file restore and old/malformed observations');
}
main().catch(error=>{console.error(error);process.exitCode=1});
