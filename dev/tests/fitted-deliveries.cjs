// Actual standing, daily and weekly hand-ins share the same physical inventory rules.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const clock={now:Date.parse('2027-02-04T08:00:00Z')}; // Both live rotations request a lamp.
const questId='repair-bunker-net';
const base=boot({},clock).g;
const quest=base.quests.find(q=>q.id===questId);
function gear(id,label,module=null){
  return {g:id,uid:'s-serial-'+label,ammo:0,durability:module?81:94,module};
}
function tile(id,label,module,x,y=0){
  return {g:id,uid:'s-tile-'+label,x,y,w:1,h:2,gear:gear(id,label,module)};
}
function prepared(){
  const s=clone(base.s);
  s.contracts.repair={done:base.quests.filter(q=>q.trader==='repair'&&q.tier<4).map(q=>q.id),
    active:{id:questId,progress:[2,2,0],locations:quest.goals.filter(q=>q.type==='searches')
      .flatMap(q=>base.places[q.zone][q.landmark].boxes.map(n=>q.zone+'-'+n))}};
  s.stash={rs_case_items:1,radio:2,flash:1,patch:2};
  s.stashSlots=[tile('radio','grid','rl_13_02',0),tile('flash','lamp','battery',1),
    {g:'rs_case_items',uid:'s-case-personal',x:2,y:0,w:4,h:4,contents:[tile('radio','case','battery',0)]}];
  s.gearOverflow=[gear('radio','queue','battery')];
  s.equipment.bag=[{...tile('radio','bag','rl_13_02',0),revealed:true}];
  s.equipment.worn.comms='radio';s.equipment.instances.comms=gear('radio','worn');
  return s;
}
const open=s=>{const b=boot({[v12]:s},clock);valid(b.g);return b;};
const protectedSerials=g=>clone(g.gearOwned().map(row=>row.gear).filter(u=>u.module).sort((a,b)=>a.uid.localeCompare(b.uid)));
const give=(g,q,mode,action)=>g.cycleWork('quarter',mode,g.board('quarter',mode).key,q,action);
const act=g=>g.contract(questId,'claim');
function verify(){
  const s=prepared(),{g}=open(s),protectedBefore=protectedSerials(g);
  assert.equal(g.status(questId).status,'active');
  assert.ok(g.pin({kind:'contract',id:questId}));
  const row=g.objective().materials[0];
  assert.deepEqual([row.owned,row.usable,row.missing],[5,0,1]);
  const frozen=clone(g.s);assert.equal(act(g).ok,false);assert.deepEqual(clone(g.s),frozen);
  g.gear({gear:'unwear',slot:'comms'});
  assert.equal(g.status(questId).status,'ready');
  const ready=clone(g.s);const {g:r,storage}=open(ready);
  const exact=clone(r.s),set=storage.set.bind(storage);
  storage.set=()=>{throw Error('quota')};
  assert.equal(act(r).ok,false);assert.deepEqual(clone(r.s),exact);
  storage.set=set;
  assert.ok(act(r).ok);assert.equal(r.fee,92000);assert.equal(r.s.career.xp,205);
  assert.deepEqual(protectedSerials(r),protectedBefore);
  assert.equal(act(r).ok,false);
  const reload=boot(new Map(storage),clock).g;
  assert.deepEqual(protectedSerials(reload),protectedBefore);assert.equal(reload.status(questId).status,'claimed');
  valid(reload);
  for(const where of ['bag','queue','grid','case']){
    const s=prepared(),extras=['first','second'].map((k,i)=>tile('radio',where+'-'+k,null,i+1,2));
    if(where==='bag')s.equipment.bag.push(...extras.map(x=>({...x,revealed:true})));
    if(where==='queue'){s.gearOverflow.push(...extras.map(x=>x.gear));s.stash.radio+=2;}
    if(where==='grid'){s.stashSlots.push(...extras.map((x,i)=>({...x,x:i,y:5})));s.stash.radio+=2;}
    if(where==='case')s.stashSlots[2].contents.push(...extras);
    const {g}=open(s);assert.ok(act(g).ok,where);
    const ids=g.gearOwned().map(o=>o.gear.uid);
    assert.ok(!ids.includes(extras[0].gear.uid)&&ids.includes(extras[1].gear.uid),where+' consumes the oldest bare serial');
    assert.deepEqual(protectedSerials(g),protectedBefore);valid(g);
  }
  for(const mode of ['daily','weekly']){
    const s=prepared(),g=open(s).g;
    const read=g=>g.board('quarter',mode).entries.find(row=>row.quest.goals.some(k=>k.item==='flash'));
    const q=read(g).quest,needed=q.goals[0].target;
    assert.ok(give(g,q.id,mode,'accept').ok);
    assert.equal(read(g).status,'active');
    assert.ok(!give(g,q.id,mode,'claim').ok);
    const next=clone(g.s);
    next.stash.flash+=needed;
    if(mode==='daily'){ // Anonymous stock from older saves is eligible alongside fitted queue records.
      next.gearOverflow.push(gear('flash','queued-lamp','battery'));next.stash.flash++;
    }else{ // Two individual queue records and a compressed pristine range.
      const prefix='s-batch-lamp';
      next.gearOverflow.push(gear('flash','queued-lamp','battery'),{...gear('flash','individual')},
        {...gear('flash','batch'),uid:prefix+'-1',durability:100,batch:{prefix,start:1,count:4}});
      next.stash.flash+=3;
    }
    const b=open(next),r=b.g,prior=protectedSerials(r),saved=clone(r.s),put=b.storage.set.bind(b.storage);
    assert.equal(read(r).status,'ready');
    b.storage.set=()=>{throw Error('quota')};
    assert.ok(!give(r,q.id,mode,'claim').ok);assert.deepEqual(clone(r.s),saved);
    b.storage.set=put;
    const {ok,receipt}=give(r,q.id,mode,'claim');
    assert.ok(ok);assert.deepEqual([receipt.cr,receipt.xp],[q.cr,q.xp]);
    assert.deepEqual(protectedSerials(r),prior);assert.ok(!give(r,q.id,mode,'claim').ok);
    if(mode==='weekly')assert.deepEqual(clone(r.s.gearOverflow.find(o=>o.batch).batch),{prefix:'s-batch-lamp',start:3,count:2});
    const back=boot(new Map(b.storage),clock).g;
    assert.deepEqual(clone(read(back).receipt),clone(receipt));assert.ok(!give(back,q.id,mode,'claim').ok);valid(back);
  }
}
if(require.main===module){verify();console.log('PASS ordinary + daily/weekly, fitted gear at 4 locations and worn exclusion, bare serial FIFO, anonymous/batched queue, exact rollback/claim/reload.');}
module.exports={prepared};
