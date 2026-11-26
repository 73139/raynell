// The same journey uses the product's traders, bag packing, movement, backup and settlement.
const {assert,boot,clone,finish,go,move,stamp,valid}=require('./game-fixture.cjs');
const good=r=>assert.equal(r.ok,true,r.message);
const bad=r=>assert.equal(r.ok,false,r.message);
const state=b=>b.g.s.survivor;
const view=b=>b.g.survivorView();
const act=(b,action,token,rid=state(b).active?.raidId)=>b.g.survivorAction(action,rid,token);
function launch(b,zone=0,withWater=true) {
  if(withWater){
    good(b.g.trade('supply','buy','water',1));
    b.g.gear({gear:'pack',id:'water'});
    assert.equal(b.g.s.equipment.bag.filter(o=>o.g==='water').length,1);
  }
  b.g.moveNow(zone);b.g.start();
  return b.g.s.raid.startedAt;
}
function sampleClue(b){
  good(act(b,'observe',String(b.g.s.raid.zone)));
  assert.equal(view(b).encounter,null);
  const clue=view(b).clues[0];assert.equal(clue.kind,'boots');
  good(act(b,'pass',clue.id));assert.equal(view(b).encounter,null);
  good(act(b,'follow',clue.id));
  const enc=view(b).encounter;
  assert.equal(enc.name,'흔적의 주인');assert.equal(enc.departAt,null);
  good(act(b,'meet',enc.token));return enc.token;
}
function unchanged(b,op) {
  const before=clone({sv:state(b),wallet:b.g.s.wallet,bag:b.g.s.field.bag});
  bad(op());assert.deepEqual(clone({sv:state(b),wallet:b.g.s.wallet,bag:b.g.s.field.bag}),before);
}
async function restored(b) {
  const data=await b.exportData(),fresh=boot({}, {now:b.clock.now});
  assert.equal(fresh.g.check(data),true);
  await fresh.g.importFile({text:async()=>JSON.stringify(data),size:JSON.stringify(data).length});
  assert.deepEqual(clone(state(fresh)),clone(state(b)));
  return fresh;
}
async function run(){
  let b=boot();assert.equal(view(b).mode,'empty');
  const start=launch(b);
  assert.equal(view(b).zone,0);
  assert.deepEqual(clone(view(b).clues),[]);
  assert.equal(view(b).encounter,null);
  assert.ok(!JSON.stringify(view(b)).includes('은서'));
  unchanged(b,()=>act(b,'observe','1'));unchanged(b,()=>act(b,'follow','boots-0'));
  const first=sampleClue(b),water=b.g.s.field.bag.find(o=>o.g==='water');
  const wallet=b.g.s.wallet;
  const set=b.storage.set;b.storage.set=()=>{throw Error('quota')};
  unchanged(b,()=>act(b,'help',first));
  b.storage.set=set;
  b=await restored(b);good(act(b,'help',first));
  assert.equal(b.g.s.wallet,wallet+6000);assert.equal(b.g.s.field.bag.some(o=>o.uid===water.uid),false);
  unchanged(b,()=>act(b,'help',first));unchanged(b,()=>act(b,'decline',first));
  assert.equal(view(b).reward,6000);
  const payer=b;
  b=await restored(b);unchanged(b,()=>act(b,'help',first));
  stamp(b,start+89999);assert.equal(view(b).encounter.met,true);
  stamp(b,start+90000);assert.equal(view(b).encounter,null);
  good(act(b,'observe','0'));const cloth=view(b).clues.find(c=>c.kind==='cloth');
  assert.equal(cloth.to,1);assert.equal(cloth.at,start+90000);
  good(act(b,'follow',cloth.id));
  b.setRandom(0.2);go(b,'move',{index:1});
  unchanged(b,()=>act(b,'observe','0'));finish(b);
  assert.equal(b.g.s.raid.zone,1);assert.equal(view(b).encounter,null);
  b=await restored(b);assert.equal(view(b).encounter,null);
  stamp(b,start+105000);
  good(act(b,'meet',view(b).encounter.token));
  assert.match(view(b).encounter.text,/건네주신 물/);
  assert.equal(view(b).meetings.length,2);assert.equal(new Set(view(b).meetings.map(x=>x.name)).size,1);
  unchanged(b,()=>act(b,'help',view(b).encounter.token));
  assert.equal(view(b).choice,'help');assert.equal(b.g.s.wallet,wallet+6000);
  valid(b.g);good(act(b,'observe','1'));
  const data=await b.exportData();
  for(const change of [
    r=>{r.origin=1},r=>{r.meetings[0].at=r.raidId+93000},
    r=>{r.clues[0].firstFollow=null},r=>{r.clues.find(c=>c.id==='cloth-0').at=r.raidId+3000},
    r=>{r.meetings[1].step=2},r=>{r.clues[0].id='prototype'},
    r=>{r.choice.step=2},r=>{r.choice.at=r.raidId+100000},
    r=>{r.clues.push({...r.clues[0]})}
  ]){const d=clone(data);change(d.session.survivor.active);assert.equal(b.g.check(d),false);}
  go(b,'abandon');assert.equal(view(b).mode,'archive');assert.equal(view(b).clues.length,3);
  b.g.ack();b=await restored(b);assert.equal(view(b).choice,'help');
  assert.equal(b.g.s.wallet,wallet+6000);valid(b.g);
  b.g.start();assert.equal(view(b).choice,null);valid(b.g);
  // A stale unlocked tab must restore the winner's bag and receipt on the first attempted write.
  let stale=boot(payer.storage,{now:payer.clock.now});
  good(act(stale,'pass','boots-0'));
  bad(act(payer,'pass','boots-0'));assert.deepEqual(clone(state(stale)),clone(state(payer)));
  assert.equal(stale.g.s.wallet,payer.g.s.wallet);
  for(const origin of [0,1,2]){
    const x=boot();const t=launch(x,origin,false);const token=sampleClue(x);
    unchanged(x,()=>act(x,'help',token));good(act(x,'decline',token));
    const destination=(origin+1)%3;
    stamp(x,t+90000);good(act(x,'observe',String(origin)));
    good(act(x,'follow','cloth-0'));move(x,destination);stamp(x,Math.max(t+105000,x.clock.now));
    good(act(x,'meet',view(x).encounter.token));assert.match(view(x).encounter.text,/아껴야/);
    assert.equal(x.g.s.wallet,30000);assert.equal(view(x).reward,0);
    stamp(x,t+405000);assert.equal(view(x).encounter,null);
    good(act(x,'observe',String(destination)));good(act(x,'follow','cloth-1'));
    move(x,(origin+2)%3);stamp(x,Math.max(t+425000,x.clock.now));
    good(act(x,'meet',view(x).encounter.token));assert.equal(view(x).meetings.length,3);
    stamp(x,t+1680000);assert.equal(view(x).encounter,null);
    stamp(x,t+1800000);assert.equal(view(x).mode,'archive');valid(x.g);
  }
  // Competing tabs both have a carried unit and the same unanswered encounter.
  // Exactly one write succeeds; the older tab reads the winning receipt and balances.
  const contender=boot();launch(contender);const key=sampleClue(contender),cash=contender.g.s.wallet;
  const winner=boot(contender.storage,{now:contender.clock.now});
  good(act(winner,'help',key));bad(act(contender,'help',key));
  for(const profile of [contender,winner]){
    assert.equal(profile.g.s.wallet,cash+6000);assert.equal(view(profile).reward,6000);
    assert.ok(!profile.g.s.field.bag.some(u=>u.g==='water'));valid(profile.g);
  }
  // Seeing a region on the map or passing the survivor's stop in transit is not a sighting.
  const unknown=boot();const t=launch(unknown,0,false);
  stamp(unknown,t+105000);move(unknown,1);
  assert.equal(view(unknown).encounter,null);assert.deepEqual(clone(view(unknown).meetings),[]);
  unchanged(unknown,()=>act(unknown,'meet',t+'-1'));
  const seen=sampleClue(unknown);
  go(unknown,'scan');unchanged(unknown,()=>act(unknown,'decline',seen));finish(unknown);
  const boxIndex=unknown.g.s.field.found[1][0];go(unknown,'open',{index:boxIndex});
  assert.ok(unknown.g.s.field.open);unchanged(unknown,()=>act(unknown,'decline',seen));
  go(unknown,'close');good(act(unknown,'decline',seen));
  move(unknown,0);go(unknown,'extract',{exit:'b04'});
  unchanged(unknown,()=>act(unknown,'observe','0'));finish(unknown);
  assert.equal(view(unknown).mode,'archive');assert.equal(view(unknown).choice,'decline');
  assert.equal(view(unknown).canObserve,false);valid(unknown.g);
  const abandoned=boot();const id=launch(abandoned,0,false);
  const legacy=clone(abandoned.g.s);legacy.version=22;delete legacy.survivor;
  delete legacy.field.survivorScavenge;
  const migrated=boot({'rl-reboot-session-v22':legacy},{now:id+10000});
  assert.equal(view(migrated).mode,'legacy');valid(migrated.g);
  go(migrated,'abandon');migrated.g.ack();assert.equal(view(migrated).mode,'empty');
  migrated.g.start();assert.equal(view(migrated).mode,'field');valid(migrated.g);
  console.log('PASS actual carried water, 6,000 CR once, assistance/decline/reunion, two trace types, true schedule in all three starting regions, three-stop pursuit, clocks/JSON, malformed or stale states, legacy and expiry.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
