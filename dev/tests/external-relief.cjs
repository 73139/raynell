// Earn the permanent reply from the archived pre-ending v22 fixture before testing the request.
const {assert,boot,clone,epoch,extract,go,move,stamp,v12,valid}=require('./game-fixture.cjs');
const archived=require('./fixtures/finale-v22.json');
const job='external-relief';
const initial=boot({'rl-reboot-session-v22':archived.session},{now:epoch+3000000});
const g=initial.g;
function start(b){b.clock.now+=1000;b.g.start();return b.g.s.raid.startedAt}
function normal(b){stamp(b,b.g.s.raid.startedAt+420000);extract(b)}
function deliver(b,kind,id=b.g.s.raid.startedAt){go(b,'relief-deliver',{kind,raidId:String(id)})}
function site(b,kind){const z=kind==='meals'?0:1;if(z!==b.g.s.raid.zone)move(b,z);go(b,'landmark',{index:3})}
g.order(job);assert.equal(g.s.career.order,null);
assert.ok(g.contract('repair-first-call','claim').ok);assert.ok(g.finaleAction('arm').ok);
start(initial);
for(const z of [0,1,2]){if(g.s.raid.zone!==z)move(initial,z);assert.ok(g.finaleAction('signal',z,g.s.raid.startedAt).ok)}
move(initial,0);normal(initial);g.ack();assert.ok(g.s.finale.reply);valid(g);
const ending=clone(g.s);
function loaded(items){
  // Real item shapes and UIDs, arranged in two rows of the issued pack.
  const s=clone(ending);s.equipment.bag=items.map(([id,x,y])=>({...g.unit(id),x,y}));
  const b=boot({[v12]:s},{now:initial.clock.now+1000});b.g.order(job);assert.equal(b.g.s.career.order,job);start(b);valid(b.g);return b;
}
const meals=[['food',0,0],['food',1,0],['water',2,0],['water',3,0],['food',0,1]];
const power=[['battery',0,0],['rl_03_25',1,0]];
async function run(){
  if(process.env.RUSTLINE_EXPORT_RELIEF_FIXTURE){
    const prepared=clone(ending);
    prepared.equipment.bag=[...meals.slice(0,4),['battery',0,2],['rl_03_25',1,2]].map(([id,x,y])=>({...g.unit(id),x,y}));
    const example=boot({[v12]:prepared},{now:initial.clock.now+1000});
    for(const unit of [...example.g.s.equipment.bag]){example.g.gear({gear:'select',unit:unit.uid});example.g.gear({gear:'unpack'})}
    valid(example.g);assert.equal(example.g.s.equipment.bag.length,0);
    for(const id of ['food','water','battery','rl_03_25'])assert.ok(example.g.stock(id)>0);
    require('node:fs').writeFileSync(process.env.RUSTLINE_EXPORT_RELIEF_FIXTURE,JSON.stringify(await example.exportData()));return;
  }
  for(const [kind,items,used] of [['meals',meals,4],['power',power,2]]){
    const b=loaded(items),wallet=b.g.s.wallet,id=b.g.s.raid.startedAt,original=b.g.s.field.bag.map(u=>u.uid);
    deliver(b,kind);assert.equal(b.g.s.field.reliefDelivery,undefined);site(b,kind);
    deliver(b,kind,id-1);assert.equal(b.g.s.field.reliefDelivery,undefined);
    const setter=b.storage.set;b.storage.set=()=>{throw Error('quota')};deliver(b,kind);assert.equal(b.g.s.field.reliefDelivery,undefined);assert.deepEqual(clone(b.g.s.field.bag.map(u=>u.uid)),clone(original));b.storage.set=setter;
    deliver(b,kind);const receipt=clone(b.g.s.field.reliefDelivery);assert.deepEqual(receipt,{kind,raidId:id,at:b.clock.now});
    assert.deepEqual(clone(b.g.s.field.bag.map(u=>u.uid)),clone(original.slice(used)));assert.equal(b.g.s.wallet,wallet);
    deliver(b,kind);assert.equal(b.g.s.field.bag.length,items.length-used);valid(b.g);
    const transfer=await b.exportData();const renewed=boot({},b.clock);await renewed.g.importFile(new Blob([JSON.stringify(transfer)]));
    assert.deepEqual(clone(renewed.g.s.field.reliefDelivery),receipt);
    const other=kind==='meals'?'power':'meals';site(renewed,other);deliver(renewed,other);assert.deepEqual(clone(renewed.g.s.field.reliefDelivery),receipt);
    if(renewed.g.s.raid.zone!==0)move(renewed,0);normal(renewed);
    assert.equal(renewed.g.s.lastSummary.commission,36000);assert.equal(renewed.g.s.lastSummary.missionXp,110);
    assert.equal(renewed.g.s.wallet,wallet+36000);assert.equal(renewed.g.s.field.reliefDelivery,undefined);
    assert.deepEqual(clone(renewed.g.s.career.reliefReceipt),receipt);valid(renewed.g);renewed.g.ack();
    const finished=await renewed.exportData();for(const fn of [s=>delete s.career.reliefReceipt,s=>{s.career.reliefReceipt.kind='nope'},s=>{s.career.reliefReceipt.at=id-1},s=>{s.finale.reply=null},s=>{s.lastSummary.commission=0}]){const x=clone(finished);fn(x.session);assert.equal(renewed.g.check(x),false)}
    const third=boot({},renewed.clock);await third.g.importFile(new Blob([JSON.stringify(finished)]));third.g.order(job);assert.equal(third.g.s.career.order,null);start(third);normal(third);assert.equal(third.g.s.lastSummary.commission,0);assert.deepEqual(clone(third.g.s.career.reliefReceipt),receipt);valid(third.g);
  }
  const insufficient=loaded([['food',0,0],['water',1,0]]);site(insufficient,'meals');deliver(insufficient,'meals');assert.equal(insufficient.g.s.field.bag.length,2);assert.equal(insufficient.g.s.field.reliefDelivery,undefined);
  for(const loss of ['quick','expired','abandoned']){
    const b=loaded(meals),startWallet=b.g.s.wallet;site(b,'meals');deliver(b,'meals');
    if(loss==='quick')extract(b);else if(loss==='expired')stamp(b,b.g.s.raid.endsAt);else go(b,'abandon');
    assert.equal(b.g.s.lastSummary.rating,loss);assert.equal(b.g.s.lastSummary.commission,0);assert.equal(b.g.s.wallet,startWallet);assert.equal(b.g.s.career.reliefReceipt,undefined);assert.equal(b.g.s.field.reliefDelivery,undefined);valid(b.g);
  }
  console.log('PASS completed-reply unlock, both delivery options, exact physical units, blocked location/incomplete supplies, persistence rollback, native save import, quick/expired/abandoned and single durable 36,000 CR / 110 XP settlement.');
}
run().catch(err=>{console.error(err);process.exitCode=1});
