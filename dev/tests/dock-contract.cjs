const {assert,boot,clone,epoch,extract,go,stamp,v12,valid}=require('./game-fixture.cjs');
const id='quarter-dock-chain';
// New quest IDs are not understood by v0.95; sharing its writer build would erase the trader record.
assert.ok(boot().g.s.writerBuild>=96000,'dock-cycle release requires a new writer build');
function seed(){
  const b=boot(),s=clone(b.g.s);
  s.career.surveyedBoxes=['2-3','2-4','2-8'];
  s.contracts.quarter.done=b.g.quests.filter(q=>q.trader==='quarter'&&q.tier<4).map(q=>q.id);
  const u=b.g.unit('flash');u.x=0;u.y=0;u.uid='dock-contract-test';
  u.gear.durability=57;u.gear.module='battery';s.equipment.bag=[u];
  return s;
}
function launch(b){
  if(b.g.s.raid)b.g.ack();
  b.g.moveNow(2);b.clock.now+=1000;b.g.start();go(b,'landmark',{index:1});
}
function ctl(b,action,u=b.g.s.dockCache?.unit){
  return {field:'dock-'+action,uid:u.uid,gearUid:u.gear.uid,raidId:String(b.g.s.raid.startedAt)};
}
function count(b){return b.g.status(id).goals[0].value}
function fresh(accepted=true){
  const b=boot({[v12]:seed()},{now:epoch});
  if(accepted)assert.ok(b.g.contract(id,'accept').ok);
  launch(b);return b;
}
function book(b){
  const u=b.g.s.field.bag[0];b.g.field(ctl(b,'deposit',u));extract(b,'lift');return u.gear.uid;
}
const b=fresh(),serial=book(b);
assert.equal(count(b),1);valid(b.g);
assert.equal(b.g.s.contracts.quarter.active.dockProof.uid,serial);
const ready=clone(b.g.s);
for(const change of [
  s=>delete s.contracts.quarter.active.dockProof,
  s=>s.contracts.quarter.active.dockProof.uid='other',
  s=>s.contracts.quarter.active.progress=[2]
]){
  const s=clone(ready);change(s);assert.equal(b.g.check({format:'rustline-tc01',session:s}),false);
}
b.g.ack();launch(b);
const second=clone(b.g.s);
const reloaded=boot(b.storage,b.clock);
reloaded.g.field(ctl(reloaded,'claim'));
assert.equal(count(reloaded),1);valid(reloaded.g);
assert.equal(reloaded.g.s.field.bag[0].gear.uid,serial);
reloaded.g.field({field:'dock-claim',uid:'old',gearUid:serial,raidId:String(reloaded.g.s.raid.startedAt)});
assert.equal(reloaded.g.s.field.bag.length,1);
extract(reloaded,'lift');assert.equal(count(reloaded),2);valid(reloaded.g);
assert.equal(reloaded.g.s.stashSlots.find(u=>u.gear?.uid===serial).gear.module,'battery');
reloaded.g.ack();
const before=clone(reloaded.g.s),rival=boot(reloaded.storage,reloaded.clock);
assert.ok(rival.g.contract(id,'claim').ok);
assert.equal(rival.g.s.wallet-before.wallet,30000);assert.equal(rival.g.s.career.xp-before.career.xp,120);
assert.equal(reloaded.g.contract(id,'claim').ok,false);assert.equal(reloaded.g.s.wallet,rival.g.s.wallet);
assert.equal(boot(reloaded.storage,reloaded.clock).g.status(id).status,'claimed');
for(const mode of ['missed','abandon','timeout','claimed-lost']){
  const q=boot({[v12]:clone(second)},{now:second.raid.startedAt+500});
  if(mode==='claimed-lost')q.g.field(ctl(q,'claim'));
  if(mode==='missed')extract(q,'lift');
  else if(mode==='timeout')stamp(q,q.g.s.raid.endsAt);
  else go(q,'abandon');
  assert.equal(count(q),0,mode);assert.equal(q.g.s.contracts.quarter.active.dockProof,undefined);valid(q.g);
}
const late=fresh(false);book(late);late.g.ack();assert.ok(late.g.contract(id,'accept').ok);launch(late);
late.g.field(ctl(late,'claim'));extract(late,'lift');assert.equal(count(late),0);
const wrong=fresh();const first=wrong.g.s.field.bag[0];wrong.g.field(ctl(wrong,'deposit',first));
const {move}=require('./game-fixture.cjs');move(wrong,0);extract(wrong);assert.equal(count(wrong),0);valid(wrong.g);
const failure=fresh();const gear=failure.g.s.field.bag[0];failure.g.field(ctl(failure,'deposit',gear));go(failure,'extract',{exit:'lift'});
const due=failure.g.s.field.action.end,write=failure.storage.set;
failure.storage.set=()=>{throw Error('quota')};stamp(failure,due);assert.equal(count(failure),0);failure.storage.set=write;
stamp(failure,due);assert.equal(count(failure),1);valid(failure.g);
console.log('PASS: dock contract requires a fresh booking and next-outing same serial; failure, timeout, missed pickup, reload, quota and once-only claim.');
