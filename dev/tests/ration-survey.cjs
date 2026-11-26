const {assert,boot,clone,extract,finish,go,move,stamp,v12,valid}=require('./game-fixture.cjs');
const JOB='ration-survey',b=boot(),g=b.g;
g.order(JOB);assert.equal(g.s.career.order,null);
g.order('scout');g.start();move(b,1);move(b,0);stamp(b,g.s.raid.startedAt+420000);extract(b);g.ack();
assert.equal(g.fee,50000);g.order(JOB);
for(const [id,n] of [['water',3],['food',3]]){assert.ok(g.trade('supply','buy',id,n).ok);for(let i=0;i<n;i++)g.gear({gear:'pack',id});}
b.clock.now+=1000;g.start();const seed=clone(g.s);
const open=()=>boot({[v12]:seed},{now:b.clock.now});
function use(t,id,val){
  const state=clone(t.g.s);state.field[id==='water'?'water':'energy']=val;
  const z=boot({[v12]:state},{now:t.clock.now+3});const u=z.g.s.field.bag.find(o=>o.g===id);
  z.g.gear({gear:'consume',unit:u.uid});valid(z.g);return z;
}
function payment(t,normal){move(t,0);if(normal)stamp(t,t.g.s.raid.startedAt+420000);extract(t);return t.g.s.lastSummary.commission;}
async function check(){
 const small=use(open(),'water',96);assert.equal(small.g.s.field.rationUses,undefined);assert.equal(small.g.s.field.water,100);
 let t=use(open(),'water',92),record=clone(t.g.s.field.rationUses[0]);
 t=use(t,'water',94);assert.deepEqual(clone(t.g.s.field.rationUses),[record]);
 t=use(t,'water',91);assert.equal(t.g.s.field.rationUses.length,1);assert.equal(t.g.s.field.rationUses[0].before,91);
 const same=use(t,'food',80);assert.equal(payment(same,true),0);assert.ok(!same.g.s.career.done.includes(JOB));
 for(const [water,meal,total,pass] of [[95,86,19,false],[95,85,20,true],[91,89,20,true],[96,79,21,false]]){
   let test=use(open(),'water',water);move(test,1);test=use(test,'food',meal);
   const backup=await test.exportData();
   const cold=boot({},test.clock);await cold.g.importFile(new Blob([JSON.stringify(backup)]));
   assert.deepEqual(clone(cold.g.s.field.rationUses),clone(test.g.s.field.rationUses));
   for(const bad of [s=>s.field.rationUses[0].after=110,s=>s.field.rationUses[0].nominal+=3,
     s=>s.field.visited=[],s=>s.field.rationUses[0].uid=s.field.bag[0].uid,s=>s.career.order=null]){
     const copy=clone(backup);bad(copy.session);assert.equal(test.g.check(copy),false);
   }
   if(pass){
     for(const fail of ['quick','abandoned','expired']){
       const q=boot({[v12]:clone(cold.g.s)},{now:cold.clock.now});
       if(fail==='quick')payment(q,false);else if(fail==='abandoned')go(q,'abandon');else stamp(q,q.g.s.raid.endsAt);
       assert.equal(q.g.s.lastSummary.commission,0);assert.equal(q.g.s.field.rationUses,undefined);assert.equal(q.g.s.career.order,JOB);
     }
   }
   const cash=cold.g.fee;assert.equal(payment(cold,true),pass?36000:0);assert.equal(cold.g.fee,cash+(pass?36000:0));valid(cold.g);
   if(pass){
     const report=cold.g.s.lastSummary;assert.equal(report.missionXp,125);assert.equal(report.rationUses.reduce((n,r)=>n+r.after-r.before,0),total);
     const forged=await cold.exportData();forged.session.lastSummary.rationUses[1].zone=forged.session.lastSummary.rationUses[0].zone;assert.equal(cold.g.check(forged),false);
     cold.g.ack();cold.g.order(JOB);assert.equal(cold.g.s.career.order,null);assert.equal(cold.g.s.career.done.filter(q=>q===JOB).length,1);
   }
 }
 console.log('PASS: genuine scout unlock, actual units, same-zone best, weak use excluded, mixed-route total 19/20, native file handoff, forged records rejected, 3 loss/early modes, two alternative allocations and one commission.');
}
check().catch(e=>{console.error(e);process.exitCode=1});
