const fs=require('fs');
const {assert,boot,clone,epoch,extract,finish,go,move,stamp,v12,valid,setTestCash}=require('./game-fixture.cjs');
const ITEM='rl_craft_dressing', JOB='ward-packing', KEY='rl_16_19';
const fresh=boot(),base=clone(fresh.g.s);
Object.assign(base.hideout.levels,{power:1,water:1,med:1});
base.hideout.wardManual={registered:true,waiting:[]};
setTestCash(base,150000);
const original=boot({[v12]:base}),g=original.g;
function craft(b){
 const old=new Set(b.g.s.stashSlots.filter(u=>u.g===ITEM).map(u=>u.uid));
 b.g.build({id:'med',hideout:'produce',recipe:'folded-dressing'});
 const job=b.g.s.hideout.production.med;assert.ok(job);
 stamp(b,job.end);
 return b.g.s.stashSlots.find(u=>u.g===ITEM&&!old.has(u.uid)).uid;
}
function search(b,zone,target){
 const point=zone?1:7;go(b,'landmark',{index:point});
 while(!b.g.s.field.found[zone].includes(target)){go(b,'scan');finish(b);if(b.g.s.field.contact){go(b,'evade');}}
 if(b.g.lootBoxIsLocked(zone,target)){assert.ok(b.g.unlockLootBox(b.g.s.raid.startedAt,zone,target).ok);}
 if(!b.g.s.field.open)go(b,'open',{index:target});
 assert.equal(b.g.s.field.open,zone+'-'+target);
 go(b,'search');while(b.g.s.field.action)finish(b);
 assert.equal(b.g.s.field.boxes[zone+'-'+target].complete,true);
 go(b,'close');if(b.g.s.field.contact)go(b,'evade');
}
function mark(b,uid){go(b,'ward-compare',{uid,raidId:String(b.g.s.raid.startedAt)});}
function quota(b,fn){const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};try{fn()}finally{b.storage.set=set}}
g.order(JOB);assert.equal(g.s.career.order,null);
for(const item of ['bandage','gauze'])assert.ok(g.trade('medic','buy',item,4).ok);
const first=craft(original);assert.ok(g.wardTrialAction('accept').ok);g.order(JOB);assert.equal(g.s.career.order,null);
assert.ok(g.wardTrialAction('deliver',first).ok);valid(g);
async function main(){
 if(process.env.RUSTLINE_EXPORT_WARD_PAID){fs.writeFileSync(process.env.RUSTLINE_EXPORT_WARD_PAID,JSON.stringify(await original.exportData()));return;}
 const a=craft(original),b=craft(original);assert.notEqual(a,b);assert.notEqual(a,first);
 const completed=clone(g.s);
 const run=(zone=0)=>{
  const box=boot({[v12]:completed},{now:original.clock.now+1000}),p=box.g;
  p.order(JOB);assert.equal(p.s.career.order,JOB);
  assert.ok(p.pin({kind:'order',id:JOB}));
  for(const uid of [a,b])p.gear({gear:'pack',id:ITEM,unit:uid});
  assert.deepEqual(clone(p.s.equipment.bag.map(u=>u.uid)),[a,b]);
  if(zone){assert.ok(p.trade('medic','buy',KEY,1).ok);p.gear({gear:'wear-stash',id:KEY});}
  p.moveNow(zone);box.setRandom(.1);p.start();valid(p);return box;
 };
 for(const z of [0,1]){
  const box=run(z),p=box.g,wallet=p.fee;
  mark(box,b);assert.ok(!p.s.field.wardCheck);
  search(box,z,z?2:14);quota(box,()=>mark(box,b));assert.ok(!p.s.field.wardCheck);
  mark(box,b);const rec=clone(p.s.field.wardCheck);assert.equal(rec.uid,b);
  mark(box,a);assert.deepEqual(clone(p.s.field.wardCheck),rec);
  p.gear({gear:'drop',unit:b});assert.equal(p.objective().goals[0].projected??0,0);
  assert.ok(p.s.field.bag.some(u=>u.uid===a));valid(p);
  const data=await box.exportData();const restored=boot({},box.clock);await restored.g.importFile(new Blob([JSON.stringify(data)]));
  assert.deepEqual(clone(restored.g.s.field.wardCheck),rec);const q=restored.g;
  q.gear({gear:'recover',unit:b});assert.equal(q.objective().goals[0].projected??0,1);
  assert.deepEqual(clone(q.s.field.bag.map(u=>u.uid)).sort(),[a,b].sort());
  search(restored,z,z?6:15);if(z)move(restored,0);
  go(restored,'extract',{exit:'b04'});const end=q.s.field.action.end;
  quota(restored,()=>stamp(restored,end));assert.equal(q.s.field.result,null);assert.equal(q.fee,wallet);
  q.tick();assert.equal(q.s.lastSummary.commission,18000);assert.equal(q.s.lastSummary.missionXp,75);
  assert.equal(q.fee,wallet+18000);assert.deepEqual(clone(q.s.career.wardCheckReceipt),rec);
  assert.ok(q.s.stashSlots.some(u=>u.uid===b&&u.g===ITEM));q.ack();
  const check=await restored.exportData();
  if(!z && process.env.RUSTLINE_EXPORT_WARD_PACKED){fs.writeFileSync(process.env.RUSTLINE_EXPORT_WARD_PACKED,JSON.stringify(check));return;}
  const cold=boot({},restored.clock);await cold.g.importFile(new Blob([JSON.stringify(check)]));
  assert.deepEqual(clone(cold.g.s.career.wardCheckReceipt),rec);cold.g.order(JOB);assert.equal(cold.g.s.career.order,null);
  for(const mutate of [s=>delete s.career.wardCheckReceipt,s=>{s.career.wardCheckReceipt.uid=first},s=>delete s.hideout.wardTrial,s=>s.lastSummary.commission=0]){
   const copy=clone(check);mutate(copy.session);assert.equal(cold.g.check(copy),false);
  }
  for(const mutate of [s=>s.field.wardCheck.raidId++,s=>s.field.wardCheck.site=4,s=>s.field.wardCheck.at=s.raid.endsAt,s=>s.stashSlots[0].uid=b,s=>s.field.found[z]=[]]){
   const copy=clone(data);mutate(copy.session);assert.equal(q.check(copy),false);
  }
  valid(cold.g);
 }
 // A saturated layout queues recovered consumables by quantity; the receipt keeps the comparison UID.
 const busy=run();search(busy,0,14);mark(busy,a);search(busy,0,15);
 const full=clone(busy.g.s);full.stash={cloth:192};full.stashSlots=Array.from({length:192},(_,i)=>({uid:'s-grid-'+i,g:'cloth',w:1,h:1,x:i%6,y:Math.floor(i/6)}));
 const crowded=boot({[v12]:full},busy.clock);valid(crowded.g);extract(crowded);crowded.g.ack();
 assert.equal(crowded.g.s.career.wardCheckReceipt.uid,a);assert.equal(crowded.g.stock(ITEM),2);
 assert.equal(crowded.g.s.stashSlots.filter(u=>u.g===ITEM).length,0);valid(crowded.g);
 // A v.77 packed kit copy has a generic UID. The new sortie assigns its stable reference prior to choosing a specimen.
 const prev=clone(completed),old=prev.stashSlots.find(u=>u.uid===a);
 prev.stashSlots=prev.stashSlots.filter(u=>u.uid!==a);prev.stash[ITEM]--;
 prev.equipment.bag=[{...old,uid:'old-kit-unit',x:0,y:0,revealed:true}];
 const legacy=boot({[v12]:prev},{now:original.clock.now+1000});legacy.g.order(JOB);legacy.g.start();legacy.setRandom(.1);
 const tracked=legacy.g.s.field.bag[0].uid;assert.match(tracked,/^s-/);
 search(legacy,0,14);mark(legacy,tracked);search(legacy,0,15);extract(legacy);legacy.g.ack();
 assert.equal(legacy.g.s.career.wardCheckReceipt.uid,tracked);assert.ok(legacy.g.s.stashSlots.some(u=>u.uid===tracked&&u.g===ITEM));valid(legacy.g);
 for(const mode of ['swap','consumed','quick','expired','abandoned']){
  const box=run(),p=box.g,money=p.fee;search(box,0,14);mark(box,b);assert.equal(p.s.field.wardCheck.uid,b);
  if(mode==='swap'){p.gear({gear:'drop',unit:b});mark(box,a);assert.equal(p.s.field.wardCheck.uid,b);search(box,0,15);}
  if(mode==='consumed'){
   const injured=clone(p.s);injured.field.hp=45;const temp=boot({[v12]:injured},box.clock);
   temp.g.gear({gear:'consume',unit:b});assert.ok(!temp.g.s.field.bag.some(u=>u.uid===b));valid(temp.g);
   search(temp,0,15);extract(temp);assert.equal(temp.g.s.lastSummary.commission,0);assert.ok(temp.g.s.stashSlots.some(u=>u.uid===a));continue;
  }
  if(mode==='expired')stamp(box,p.s.raid.endsAt);else if(mode==='abandoned')go(box,'abandon');else extract(box);
  assert.equal(p.s.lastSummary.commission,0);assert.equal(p.fee,money);
  assert.ok(!p.s.field.wardCheck&&!p.s.career.wardCheckReceipt);p.ack();valid(p);
  box.clock.now+=1500;p.start();assert.ok(!p.s.field.wardCheck);assert.equal(p.objective().goals[0].projected??0,0);
 }
 console.log('PASS first delivery prerequisite, two genuine crafted UIDs, both cases/key, partial vs complete, full linked physical UID, lost writes, JSON restore while dropped, second specimen rejected, normal/quick/loss/single award.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
