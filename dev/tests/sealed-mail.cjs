const {assert,boot,clone,extract,go,move,stamp,valid,v12}=require('./game-fixture.cjs');
const order='sealed-mail',item='rl_sealed_mail';
const initial=clone(boot().g.s);initial.career.done=['handover-ledgers'];
function deploy(save=initial){const b=boot({[v12]:clone(save)});b.g.order(order);assert.equal(b.g.s.career.order,order);b.g.pin({kind:'order',id:order});b.g.moveNow(2);b.g.start();return b;}
function issue(b){go(b,'postal-pickup',{raidId:String(b.g.s.raid.startedAt)});}
function hand(b){go(b,'postal-stamp',{raidId:String(b.g.s.raid.startedAt)});}
function site(b,zone){if(b.g.s.raid.zone!==zone)move(b,zone);go(b,'landmark',{index:4});}
function noChange(b,f){const before=clone(b.g.s);f();assert.deepEqual(clone(b.g.s),before);}
function failWrite(b,f){const set=b.storage.set;b.storage.set=()=>{throw Error('quota')};try{noChange(b,f)}finally{b.storage.set=set;}}
function denied(b,edit){const s=clone(b.g.s);edit(s);assert.equal(b.g.check({format:'rustline-tc01',session:s}),false);}
function status(b){return b.g.readField().match(/data-postal-stage="([^"]+)"/)?.[1];}
function current(b){return b.g.s.field.bag.find(u=>u.g===item);}
function settled(b,normal){if(b.g.s.raid.zone!==0)move(b,0);if(normal)stamp(b,b.g.s.raid.startedAt+410000);extract(b);}
const fresh=boot();fresh.g.order(order);assert.equal(fresh.g.s.career.order,null);assert.ok(!Object.keys(fresh.g.goods).includes(item));
let b=deploy();assert.deepEqual(clone(b.g.objective().locations),[{zone:2,landmark:4}]);noChange(b,()=>issue(b));site(b,2);assert.equal(status(b),'waiting');
noChange(b,()=>go(b,'postal-pickup',{raidId:'1'}));failWrite(b,()=>issue(b));issue(b);assert.equal(status(b),'carried');
const uid=current(b).uid;assert.equal(uid,'post-'+b.g.s.raid.startedAt);assert.equal(current(b).w*current(b).h,2);valid(b.g);
noChange(b,()=>issue(b));noChange(b,()=>hand(b));assert.deepEqual(clone(b.g.objective().locations),[{zone:1,landmark:4}]);
denied(b,s=>s.field.bag.push({...s.field.bag[0],uid:'duplicate'}));denied(b,s=>s.field.postal.raidId++);denied(b,s=>s.field.postal.issuedAt=s.raid.endsAt);denied(b,s=>s.career.done=[]);denied(b,s=>s.career.order='scout');denied(b,s=>s.stash[item]=1);denied(b,s=>s.field.gearGround[0].push(s.field.bag.pop()));
const busy=deploy();site(busy,2);go(busy,'scan');noChange(busy,()=>issue(busy));
b.g.gear({gear:'drop',unit:uid});assert.equal(status(b),'ground');assert.deepEqual(clone(b.g.objective().locations),[{zone:2}]);assert.equal(current(b),undefined);
b=boot(b.storage,b.clock);valid(b.g);noChange(b,()=>issue(b));site(b,1);noChange(b,()=>hand(b));assert.equal(status(b),'ground');
site(b,2);b.g.gear({gear:'recover',unit:uid});assert.equal(current(b).uid,uid);site(b,1);failWrite(b,()=>hand(b));hand(b);assert.equal(status(b),'stamped');valid(b.g);
assert.equal(current(b),undefined);assert.equal(b.g.s.field.gearGround.flat().some(u=>u.g===item),false);
noChange(b,()=>hand(b));denied(b,s=>s.field.postal.stampedAt=s.field.postal.issuedAt);denied(b,s=>s.field.postal.stampedAt=s.raid.endsAt);denied(b,s=>s.field.visited=[2]);
const restored=boot(b.storage,b.clock);assert.equal(status(restored),'stamped');settled(restored,true);
assert.equal(restored.g.s.lastSummary.commission,30000);assert.equal(restored.g.s.lastSummary.missionXp,105);assert.equal(restored.g.s.wallet,60000);
assert.deepEqual(clone(restored.g.s.lastSummary.goods),[]);assert.equal(restored.g.s.field.postal,undefined);assert.equal(restored.g.stock(item),0);assert.equal(restored.g.s.career.order,null);valid(restored.g);
const receipt=clone(restored.g.s.career.history);restored.g.ack();restored.g.ack();restored.g.order(order);assert.equal(restored.g.s.career.order,null);assert.deepEqual(clone(restored.g.s.career.history),receipt);assert.equal(restored.g.s.wallet,60000);
for(const end of ['quick-stamped','normal-unstamped','abandon','expire']){
 const q=deploy();site(q,2);issue(q);const old=q.g.s.raid.startedAt;
 if(end==='quick-stamped'){site(q,1);hand(q);settled(q,false);assert.equal(q.g.s.lastSummary.rating,'quick');}
 else if(end==='normal-unstamped'){settled(q,true);assert.equal(q.g.s.lastSummary.rating,'success');}
 else if(end==='expire'){stamp(q,q.g.s.raid.endsAt);assert.equal(q.g.s.lastSummary.rating,'expired');}else go(q,'abandon');
 assert.equal(q.g.s.lastSummary.commission,0);assert.equal(q.g.s.career.order,order);assert.ok(!q.g.s.lastSummary.goods.includes(item));assert.equal(q.g.stock(item),0);valid(q.g);
 q.g.ack();stamp(q,q.clock.now+10);q.g.moveNow(2);q.g.start();site(q,2);assert.equal(status(q),'waiting');noChange(q,()=>go(q,'postal-stamp',{raidId:String(old)}));issue(q);assert.equal(current(q).uid,'post-'+q.g.s.raid.startedAt);
}
// Every normal orientation is considered, but no footprint can be created on a full grid.
const full=deploy();site(full,2);const save=clone(full.g.s),[cols,rows]=full.g.kitCapacity(save.field.worn);
save.field.bag=Array.from({length:cols*rows},(_,i)=>({uid:'test-'+i,g:'bandage',x:i%cols,y:Math.floor(i/cols),w:1,h:1,revealed:true}));
const packed=boot({[v12]:save},full.clock);valid(packed.g);noChange(packed,()=>issue(packed));assert.match(packed.g.readField(),/가방 공간이 부족/);
packed.g.gear({gear:'drop',unit:'test-0'});packed.g.gear({gear:'drop',unit:'test-'+cols});issue(packed);assert.equal(current(packed).w,1);assert.equal(current(packed).h,2);valid(packed.g);
// Stale same-build writers load the newer state on the attempted write. Old command IDs are inert.
const a=deploy();site(a,2);const peer=boot(a.storage,a.clock);issue(peer);issue(a);assert.deepEqual(clone(a.g.s.field.postal),clone(peer.g.s.field.postal));assert.equal(a.g.s.field.bag.filter(u=>u.g===item).length,1);
const old=require('./fixtures/pump-pipe-done-v60.json');const historic=boot({'rl-reboot-session-v35':old.session});valid(historic.g);assert.equal(historic.g.s.field.postal,undefined);historic.g.order(order);assert.equal(historic.g.s.career.order,null);
console.log('PASS prerequisite and physical 2-cell cargo, full/rotated bag, genuine relay and region ground/reload recovery, stale/duplicate/quota checks, quick/fail/success, one 30,000 CR/105 XP settlement, no stash or sale, legacy records.');
