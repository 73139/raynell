// Reach the physical gauge, record a reading, and settle through the normal release controls.
const {assert,boot,clone,epoch,extract,finish,go,stamp,valid,v12,setTestCash}=require('./game-fixture.cjs');
const id='pump-gauge',site={zone:0,landmark:6};
const answer=n=>n<4?'below':n>4?'above':'level';
const rec=b=>b.g.s.field.pumpGauge;
const gauge=(b,action,choice,raidId=b.g.s.raid?.startedAt)=>go(b,'gauge-'+action,{answer:choice,raidId:String(raidId)});
const visit=(b,i=6)=>go(b,'landmark',{index:i});
function seeded(offset=0,pinned=true,accepted=true){
  const clock={now:epoch+offset};const b=boot({},clock);
  if(accepted){b.g.order(id);if(pinned)assert.ok(b.g.pin({kind:'order',id}));}
  b.g.moveNow(0);b.g.start();return b;
}
function complete(b){
  gauge(b,'read');const reading=rec(b).reading;
  gauge(b,'report',answer(reading));assert.equal(rec(b).answer,answer(reading));valid(b.g);
}
function denied(b,fn){const s=clone(b.g.s);fn();assert.deepEqual(clone(b.g.s),s);}
function broken(b,edit){const s=clone(b.g.s);edit(s);assert.equal(b.g.check({format:'rustline-tc01',session:s}),false);}
function quota(b,action){
  const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};try{action();}finally{b.storage.set=set;}
}
const labels=new Set();
for(const offset of [0,1000,2000]){
  const b=seeded(offset);const g=b.g,boxes=clone(g.s.field.boxes);assert.deepEqual(clone(g.objective().locations),[site]);
  denied(b,()=>gauge(b,'read'));visit(b);assert.match(g.readField(),/data-pump-gauge="unread"/);
  denied(b,()=>gauge(b,'report','below'));denied(b,()=>gauge(b,'read',null,123));
  quota(b,()=>gauge(b,'read'));assert.equal(rec(b),undefined);
  gauge(b,'read');const record=clone(rec(b)),right=answer(record.reading);labels.add(right);
  assert.equal(record.raidId,g.s.raid.startedAt);assert.equal(record.answer,null);assert.match(g.readField(),/기준선 4칸/);
  const wrong=right==='below'?'level':'below';denied(b,()=>gauge(b,'report',wrong));assert.match(g.readField(),/다시 비교/);
  assert.ok(!g.objective().goals[0].projected);assert.ok(g.objective().locations.length);
  visit(b,0);denied(b,()=>gauge(b,'report',right));visit(b);assert.deepEqual(clone(rec(b)),record);denied(b,()=>gauge(b,'read'));
  const restored=boot(b.storage,b.clock);assert.deepEqual(clone(rec(restored)),record);
  quota(restored,()=>gauge(restored,'report',right));assert.deepEqual(clone(rec(restored)),record);
  gauge(restored,'report',right);assert.deepEqual(clone(restored.g.objective().locations),[]);
  assert.equal(restored.g.objective().goals[0].projected,1);assert.deepEqual(clone(restored.g.s.field.found),[[],[],[]]);
  assert.deepEqual(clone(restored.g.s.field.boxes),boxes);assert.deepEqual(clone(restored.g.s.field.bag),[]);
  denied(restored,()=>gauge(restored,'report',right));valid(restored.g);
  broken(restored,s=>s.field.pumpGauge.raidId++);broken(restored,s=>s.field.pumpGauge.reading=9);
  broken(restored,s=>s.field.pumpGauge.answer=wrong);broken(restored,s=>s.field.pumpGauge.readAt=s.raid.endsAt);
  broken(restored,s=>s.career.order='stores');broken(restored,s=>s.field.visited=[1]);
}
assert.deepEqual(Array.from(labels).sort(),['above','below','level']);
{
  const b=seeded(0,false,false);visit(b);assert.doesNotMatch(b.g.readField(),/data-pump-gauge/);denied(b,()=>gauge(b,'read'));
}
{
  const b=seeded(0,false);visit(b);assert.match(b.g.readField(),/수위계 읽기/);complete(b);
  const old=b.g.s.raid.startedAt,initialWallet=b.g.fee;
  stamp(b,old+410000-1);extract(b);assert.equal(b.g.s.lastSummary.rating,'quick');assert.equal(b.g.s.lastSummary.commission,0);assert.equal(rec(b),undefined);
  assert.equal(b.g.s.career.order,id);b.g.ack();b.g.start();visit(b);assert.equal(rec(b),undefined);
  denied(b,()=>gauge(b,'read',null,old));gauge(b,'read');
  stamp(b,b.g.s.raid.startedAt+410000);extract(b);assert.equal(b.g.s.lastSummary.rating,'success');assert.equal(b.g.s.lastSummary.commission,0);
  assert.equal(b.g.fee,initialWallet);b.g.ack();b.g.start();visit(b);complete(b);
  stamp(b,b.g.s.raid.startedAt+410000);extract(b);assert.equal(b.g.s.lastSummary.rating,'success');
  assert.equal(b.g.s.lastSummary.commission,12000);assert.equal(b.g.s.lastSummary.missionXp,55);assert.equal(b.g.fee,initialWallet+12000);
  assert.equal(b.g.s.career.order,null);assert.deepEqual(clone(b.g.s.career.done),[id]);assert.equal(rec(b),undefined);
  const restored=boot(b.storage,b.clock);valid(restored.g);restored.g.ack();restored.g.ack();
  assert.equal(restored.g.fee,initialWallet+12000);restored.g.order(id);assert.equal(restored.g.s.career.order,null);valid(restored.g);
}
for(const mode of ['open','action','contact','journey']){
  const b=seeded();visit(b);gauge(b,'read');
  if(mode==='action'){go(b,'scan');assert.ok(b.g.s.field.action);}
  if(mode==='open'||mode==='contact'){
    if(mode==='contact'){
      for(const lm of [0,1,2,3]){
        if(b.g.s.field.steps+1>=b.g.s.field.nextContact)break;
        visit(b,lm);go(b,'scan');finish(b);
      }
      visit(b);
    }
    go(b,'scan');finish(b);
    if(mode==='open'){go(b,'open',{index:b.g.s.field.found[0][0]});assert.ok(b.g.s.field.open);}
    else assert.ok(b.g.s.field.contact);
  }
  if(mode==='journey'){b.setRandom(.2);go(b,'move',{index:1});assert.ok(b.g.s.field.journey);}
  const reading=rec(b).reading;denied(b,()=>gauge(b,'report',answer(reading)));assert.equal(rec(b).answer,null);
}
for(const ended of ['abandon','expired']){
  const b=seeded();visit(b);complete(b);const fee=b.g.fee;
  if(ended==='expired')stamp(b,b.g.s.raid.endsAt);else go(b,'abandon');
  assert.equal(b.g.fee,fee);assert.equal(b.g.s.lastSummary.commission,0);assert.ok(!rec(b));valid(b.g);
}
{
  const b=seeded();visit(b);gauge(b,'read');const other=boot(b.storage,b.clock);
  gauge(other,'report',answer(rec(other).reading));gauge(b,'report',answer(rec(b).reading));
  assert.deepEqual(clone(b.g.s),clone(other.g.s));valid(b.g);
}
{
  const b=seeded();visit(b);complete(b);const s=clone(b.g.s);setTestCash(s,Number.MAX_SAFE_INTEGER-11999);
  const full=boot({[v12]:s},b.clock);stamp(full,full.g.s.raid.startedAt+410000);extract(full);assert.equal(full.g.s.lastSummary.commission,0);
  assert.equal(full.g.s.career.order,id);assert.equal(full.g.fee,s.wallet);valid(full.g);
}
{
  const old=require('./fixtures/active-v11.json');const b=boot({'rl-reboot-session-v11':old.session??old});
  assert.equal(rec(b),undefined);valid(b.g);
}
console.log('PASS: physical rain gauge, three readable states, pending and accepted records on reload, wrong/duplicate/stale/concurrent actions, quota rollback, 7-minute edge, no unsolicited loot or XP, one reward, timeout/abandon and legacy saves.');
