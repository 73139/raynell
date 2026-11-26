const {assert,boot,clone,extract,finish,go,move,stamp,v12,valid}=require('./game-fixture.cjs');
const registered=['2-3','2-4','2-8'];
function openProfile(keys=registered,items=[]){
  const b=boot(),s=clone(b.g.s);if(keys.length)s.career.surveyedBoxes=keys.slice();
  for(const item of items)s.stash[item]=(s.stash[item]||0)+1;
  delete s.stashSlots;
  const next=boot({[v12]:s});for(const id of items)next.g.gear({gear:'pack',id});
  assert.equal(next.g.s.equipment.bag.length,items.length);return next;
}
function start(b){b.g.moveNow(2);b.clock.now+=1000;b.g.start();}
function site(b,index){go(b,'landmark',{index});}
function lift(b){go(b,'extract',{exit:'lift'});}
const allowed=b=>b.g.s.field.exits.includes('lift');
async function main(){
  const unearned=openProfile([]),earned=openProfile();
  for(const n of [0,.1,.33,.49,.66,.98]){
    unearned.setRandom(n);earned.setRandom(n);
    const a=clone(unearned.g.shuffle()),b=clone(earned.g.shuffle());
    assert.deepEqual(b,[...a,'lift']);assert.ok(!a.includes('lift')&&a.includes('b04'));
  }
  const first=openProfile([]),second=openProfile();
  for(let i=0;i<150;i++)assert.deepEqual(clone(second.g.shuffle()),[...clone(first.g.shuffle()),'lift']);
  for(const missing of registered){
    const b=openProfile(registered.filter(key=>key!==missing));start(b);assert.ok(!allowed(b));
    const active=clone(b.g.s);active.field.exits=['b04','train'];active.career.surveyedBoxes=registered;
    const old=boot({[v12]:active},b.clock);assert.deepEqual(clone(old.g.s.field.exits),['b04','train']);
    delete active.field.exits;
    assert.deepEqual(clone(boot({[v12]:active},b.clock).g.s.field.exits),['b04','truck','tunnel','security','train','rescue']);
    const spoof=await b.exportData();spoof.session.field.exits.push('lift');assert.equal(b.g.check(spoof),false);
  }
  // The notebook is written at return. Three fully searched boxes remain a provisional observation during this sortie.
  const pending=openProfile([]);start(pending);pending.setRandom(.1);
  for(const [location,index] of [[1,3],[2,4],[4,8]]){
    site(pending,location);
    while(!pending.g.s.field.found[2].includes(index)){
      go(pending,'scan');finish(pending);
      while(pending.g.s.field.contact){go(pending,'evade');finish(pending);}
    }
    go(pending,'open',{index});go(pending,'search');while(pending.g.s.field.action)finish(pending);
    assert.ok(pending.g.s.field.boxes['2-'+index].complete);go(pending,'close');
  }
  assert.equal(pending.g.s.career.surveyedBoxes,undefined);assert.ok(!allowed(pending));
  for(const result of ['abandoned','expired']){
    const b=boot({[v12]:clone(pending.g.s)},{now:pending.clock.now});
    if(result==='abandoned')go(b,'abandon');else stamp(b,b.g.s.raid.endsAt);
    b.g.ack();start(b);assert.ok(!allowed(b));assert.equal(b.g.s.career.surveyedBoxes,undefined);
  }
  move(pending,0);extract(pending);assert.ok(!allowed(pending));pending.g.ack();start(pending);assert.ok(allowed(pending));
  for(const [items,grams] of [
    [Array(10).fill('food'),4000],
    [['rl_x_core','rl_01_08','rl_01_08','rl_01_06',...Array(9).fill('food'),'bandage'],4001],
    [[],0]
  ]){
    const b=openProfile(registered,items),g=b.g;start(b);assert.ok(allowed(b));valid(g);
    assert.match(g.condition('lift'),/하역 도크/);site(b,1);
    assert.equal(g.s.field.bag.reduce((a,u)=>a+g.kitUnitGrams(u),0),grams);
    lift(b);
    if(grams>4000){assert.match(g.condition('lift'),/0\.001 kg 초과/);assert.equal(g.s.field.action,null);continue;}
    const a=g.s.field.action;assert.equal(a.end-a.start,25000);
    const backup=await b.exportData();assert.ok(g.check(backup));
    for(const change of [s=>s.field.action.end--,s=>s.field.landmarkByZone[2]=0,s=>s.raid.zone=1,
      s=>s.field.exits.push('lift'),s=>s.career.surveyedBoxes.pop(),s=>s.field.bag.push({g:'nonsense'})]){
      const invalid=clone(backup);change(invalid.session);assert.equal(g.check(invalid),false);
    }
    const cold=boot({},b.clock);await cold.g.importFile(new Blob([JSON.stringify(backup)]));
    assert.equal(cold.g.s.field.action.end,a.end);const money=cold.g.fee;stamp(cold,a.end);
    assert.equal(cold.g.s.lastSummary.liftGrams,grams);assert.equal(cold.g.s.career.history[0].liftGrams,grams);
    assert.equal(cold.g.fee,money);assert.equal(cold.g.s.lastSummary.cost,0);valid(cold.g);
    const result=clone(cold.g.s);for(const bad of [4001,-1,1.5,undefined]){
      const s=clone(result);s.lastSummary.liftGrams=bad;
      assert.equal(cold.g.check({format:'rustline-tc01',session:s}),false);
    }
    cold.g.ack();cold.g.tick();assert.equal(cold.g.s.career.sorties,1);
  }
  {
    const b=openProfile(),g=b.g,kit=clone(g.s);
    const lamp=g.unit('flash');lamp.gear.module='battery';kit.equipment.bag=[{...lamp,x:0,y:0}];
    const q=boot({[v12]:kit});start(q);site(q,1);lift(q);finish(q);
    assert.equal(q.g.s.lastSummary.liftGrams,500);
    const restored=q.g.s.stashSlots.find(u=>u.g==='flash');assert.equal(restored.gear.module,'battery');
  }
  {
    const b=openProfile(),g=b.g;start(b);site(b,1);const end=g.s.raid.endsAt;
    stamp(b,end-25000);lift(b);assert.equal(g.s.field.action,null);assert.match(g.condition('lift'),/시간 부족/);
    const edge=openProfile();start(edge);site(edge,1);stamp(edge,edge.g.s.raid.endsAt-25001);lift(edge);
    assert.equal(edge.g.s.field.action.end,edge.g.s.raid.endsAt-1);finish(edge);assert.equal(edge.g.s.lastSummary.liftGrams,0);
    stamp(b,end);assert.equal(g.s.lastSummary.rating,'expired');assert.equal(g.s.lastSummary.liftGrams,undefined);
    const death=openProfile();start(death);site(death,1);
    const low=clone(death.g.s);low.field.hp=1;low.field.energy=0;low.field.nextContact=99;
    const d=boot({[v12]:low},death.clock);go(d,'scan');finish(d);
    assert.equal(d.g.s.lastSummary.rating,'kia');assert.equal(d.g.s.lastSummary.liftGrams,undefined);
  }
  {
    const b=openProfile(registered,['rl10_vest','rl10_vest']);start(b);site(b,1);assert.match(b.g.condition('lift'),/0\.200 kg/);
    const keep=b.g.s.field.bag[1].gear.uid,drop=b.g.s.field.bag[0].uid;b.g.gear({gear:'drop',unit:drop});
    const raw=clone(b.g.s),observer=boot({[v12]:raw},b.clock,{locks:{request:()=>Promise.resolve()}});
    assert.equal(observer.g.w,false);lift(observer);assert.equal(observer.g.s.field.action,null);
    lift(b);const a=b.g.s.field.action,set=b.storage.set;
    b.storage.set=()=>{throw Error('quota');};stamp(b,a.end);b.storage.set=set;
    assert.equal(b.g.s.field.result,null);assert.equal(b.g.s.career.sorties,0);
    const other=boot(b.storage,b.clock);other.g.tick();assert.equal(other.g.s.lastSummary.liftGrams,2100);
    b.g.tick();const final=JSON.parse(b.storage.get(v12));
    assert.equal(final.career.history.length,1);assert.equal(final.stash.rl10_vest,1);
    assert.equal(final.stashSlots.find(u=>u.g==='rl10_vest').gear.uid,keep);
    valid(other.g);
  }
  console.log('PASS: same RNG distribution, old assignments, exact 4.000/4.001 kg, equipped module, read-only/competing writers, atomic single receipt, native action restore, deadline and loss.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
