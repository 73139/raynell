// Exercise the production generator, merchant, equipment, field input, storage, and backup paths.
const {assert,boot,clone,finish,go,valid,v12,extract}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const doors=[
  {z:0,i:8,key:'rl_16_14',trader:'supply'},
  {z:1,i:2,key:'rl_16_19',trader:'medic'},
  {z:2,i:6,key:'rl_16_01',trader:'quarter'}
];
const rowsAt=(g,d)=>g.s.field.boxes[d.z+'-'+d.i].items;
function compareForecast(){
  const b=boot(),g=b.g;
  assert.equal(g.lootGoalView().selected,null);
  const goals=clone(g.lootGoalView().goals);
  assert.deepEqual(goals.map(x=>x.id),['provisions','medical','industry','electronics','fuel']);
  let read=0;
  for(const goal of goals){
    assert.ok(g.setLootGoal(goal.id).ok);
    const regions=g.lootGoalView().regions;
    assert.equal(regions.length,3);
    if(goal.id==='provisions'){
      const pantry=regions[0].landmarks.find(point=>point.name==='배급소 식당');
      assert.ok(pantry.boxes.every(box=>box.examples.includes('water')));
    }
    for(const [zi,region] of regions.entries()){
      const ranked=new Map(region.landmarks.map(r=>[r.index,r]));
      for(const [index,landmark] of g.places[zi].entries()){
        let miss=1;
        for(const box of landmark.boxes){
          const table=db.containers[g.areas[zi].boxes[box][2]];
          const candidates=table.itemDistribution.filter(r=>{
            const item=db.items[r.tpl],w=item.width,h=item.height,[cols,rows]=table.size;
            return (w<=cols && h<=rows)||(h<=cols && w<=rows);
          });
          const wanted=candidates.filter(x=>goal.categories.includes(db.items[x.tpl].category) || (goal.id==='provisions' && x.tpl==='water'));
          const sum=rows=>rows.reduce((s,r)=>s+r.relativeProbability,0);
          const empty=sum(table.itemcountDistribution.filter(row=>row.count===0))/sum(table.itemcountDistribution);
          const score=(1-empty)*sum(wanted)/sum(candidates);
          const shown=ranked.get(index)?.boxes.find(boxRow=>boxRow.index===box);
          assert.ok(Math.abs((shown?.score||0)-score)<1e-12);
          if(shown){
            assert.ok(shown.examples.length && shown.examples.every(id=>wanted.some(x=>x.tpl===id)));
            assert.equal(shown.tableName,table.name);
          }
          miss*=1-score;
          read++;
        }
        assert.ok(Math.abs((ranked.get(index)?.score||0)-(1-miss))<1e-12);
      }
      assert.ok(region.landmarks.every((row,i)=>!i||region.landmarks[i-1].score>=row.score));
    }
  }
  const point=g.lootGoalView().regions[0].landmarks[0];
  assert.ok(g.selectLootDestination(0,point.index).ok);
  const destination={goal:'fuel',zone:0,index:point.index};
  assert.deepEqual(clone(g.lootGoalView().destination),destination);
  assert.ok(!g.selectLootDestination(5,3).ok);
  assert.ok(g.setLootGoal('fuel').ok);assert.deepEqual(clone(g.s.lootDestination),destination);
  const original=JSON.stringify(g.lootGoalView());
  b.setRandom(.45);g.start();
  go(b,'scan');finish(b);
  assert.equal(JSON.stringify(g.lootGoalView()),original,'map must not reveal seeded inventory');
  assert.ok(!g.setLootGoal('bogus').ok);
  const set=b.storage.set;b.storage.set=()=>{throw Error('quota')};
  assert.ok(!g.setLootGoal('provisions').ok);assert.deepEqual(clone(g.s.lootDestination),destination);
  assert.ok(!g.selectLootDestination(1,g.lootGoalView().regions[1].landmarks[0].index).ok);
  assert.deepEqual(clone(g.s.lootDestination),destination);
  assert.equal(g.lootGoalView().selected,'fuel');b.storage.set=set;
  const restored=boot(b.storage,b.clock).g;
  assert.equal(restored.lootGoalView().selected,'fuel');assert.deepEqual(clone(restored.s.lootDestination),destination);
  assert.ok(restored.setLootGoal('electronics').ok);assert.equal(restored.s.lootDestination,null);
  assert.ok(!g.setLootGoal('fuel').ok,'stale tab must adopt the other selection');
  assert.equal(g.s.lootGoal,'electronics');assert.equal(g.s.lootDestination,null);
  valid(g);
  console.log('PASS all '+read+' category/table comparisons across 23 landmarks, empty-count and fit-aware first draws, factual examples, stable rankings, opaque seeded contents and persisted goal rollback.');
}
function startVisit(d,purchase,carry){
  const b=boot(),g=b.g;
  if(purchase){
    assert.ok(g.trade(purchase.trader,'buy',purchase.key,1).ok);
    assert.equal(g.s.wallet,2000);
    if(carry)g.gear({gear:carry,id:purchase.key});
  }
  g.moveNow(d.z);b.setRandom(.55);g.start();b.setRandom(.1);
  const id=g.s.raid.startedAt,key=d.z+'-'+d.i;
  assert.equal(g.lootBoxIsLocked(d.z,d.i),true);
  assert.ok(!g.unlockLootBox(id,d.z,d.i).ok,'undiscovered');
  const point=g.places[d.z].findIndex(p=>p.boxes.includes(d.i));
  go(b,'landmark',{index:point});
  while(!g.s.field.found[d.z].includes(d.i)){go(b,'scan');finish(b);}
  go(b,'open',{index:d.i});
  assert.equal(g.s.field.open,null,'ordinary open cannot bypass lock');
  return {b,g,id,key,point};
}
async function locks(){
  for(const modes of [[null,null],[doors[1],'wear-stash'],[doors[0],null]]){
    const d=doors[0],{b,g,id}=startVisit(d,...modes),before=clone(rowsAt(g,d));
    assert.equal(g.unlockLootBox(id,d.z,d.i).ok,false);
    assert.deepEqual(clone(rowsAt(g,d)),before);assert.equal(g.s.field.open,null);
    go(b,'search');assert.ok(!g.s.field.action);
    assert.equal(g.s.field.lootLocks.unlocked.length,0);valid(g);
  }
  for(const [n,d] of doors.entries()){
    const {b,g,id,key,point}=startVisit(d,d,n===1?'pack':'wear-stash');
    const before=clone(rowsAt(g,d));assert.ok(before.length>=2);
    assert.ok(!g.unlockLootBox(id+1,d.z,d.i).ok);
    const wrongPoint=point===0?1:0;go(b,'landmark',{index:wrongPoint});
    assert.ok(!g.unlockLootBox(id,d.z,d.i).ok);
    go(b,'landmark',{index:point});
    const set=b.storage.set;b.storage.set=()=>{throw Error('quota')};
    assert.ok(!g.unlockLootBox(id,d.z,d.i).ok);assert.equal(g.s.field.open,null);
    assert.ok(g.lootBoxIsLocked(d.z,d.i));assert.deepEqual(clone(rowsAt(g,d)),before);
    b.storage.set=set;
    assert.ok(g.unlockLootBox(id,d.z,d.i).ok);
    assert.equal(g.s.field.open,key);
    assert.deepEqual(clone(rowsAt(g,d)),before);
    assert.equal(g.lootLockView(d.z,d.i).carried,true);
    assert.ok(!g.unlockLootBox(id,d.z,d.i).ok);
    go(b,'search',{uid:before[0].uid});finish(b);
    b.storage.set=()=>{throw Error('transfer quota')};
    g.selectLoot(before[0].uid);
    assert.ok(rowsAt(g,d).some(u=>u.uid===before[0].uid));assert.ok(!g.s.field.bag.some(u=>u.uid===before[0].uid));
    b.storage.set=set;
    g.selectLoot(before[0].uid);
    assert.ok(g.s.field.bag.some(u=>u.uid===before[0].uid),'one actual tile transferred');
    const remaining=clone(rowsAt(g,d));
    assert.deepEqual(remaining,before.slice(1),'unchanged coordinates, UIDs and hidden flags');
    go(b,'close');go(b,'open',{index:d.i});assert.equal(g.s.field.open,key);
    valid(g);
    const fresh=boot({},b.clock),save=await b.exportData();
    await fresh.g.importFile(new Blob([JSON.stringify(save)]));
    assert.deepEqual(clone(rowsAt(fresh.g,d)),remaining);assert.equal(fresh.g.s.field.open,key);
    assert.deepEqual(clone(fresh.g.s.field.lootLocks.unlocked),[key]);
    for(const mutate of [s=>s.field.lootLocks.unlocked.push(key),s=>s.field.lootLocks.raidId++,s=>s.field.lootLocks.unlocked=[],
      s=>s.field.boxes[key].items.push({...s.field.boxes[key].items[0]}),s=>{s.field.boxes[key].items[0].x=90},
      s=>{s.field.bag[0].uid=s.field.boxes[key].items[0].uid},s=>{s.raid.zone=(d.z+1)%3},
      s=>{s.field.landmarkByZone[d.z]=wrongPoint},s=>{s.field.open=null;s.field.action={type:'search',key,uid:remaining[0].uid,start:id,end:id+1000}},
      s=>{s.lootDestination={goal:'other',zone:0,index:0}}]){
      const bad=clone(save);mutate(bad.session);assert.ok(!fresh.g.check(bad));
    }
    go(fresh,'close');go(fresh,'abandon');fresh.g.ack();fresh.g.start();
    assert.ok(fresh.g.lootBoxIsLocked(d.z,d.i),'new sortie locks again');
  }
  const raceDoor=doors[0], pending=startVisit(raceDoor,raceDoor,'pack');
  const other=boot(pending.b.storage,pending.b.clock);
  assert.ok(other.g.unlockLootBox(pending.id,0,8).ok);
  assert.ok(!pending.g.unlockLootBox(pending.id,0,8).ok);
  assert.deepEqual(clone(pending.g.s.field.lootLocks.unlocked),['0-8']);
  assert.equal(pending.g.s.wallet,2000);assert.equal(pending.g.s.field.bag.filter(i=>i.g===raceDoor.key).length,1);
  valid(pending.g);
  const legacy=require('./fixtures/loot-goals-v23-search.json'),b=boot({}, {now:legacy.session.field.action.start});
  await b.g.importFile(new Blob([JSON.stringify(legacy)]));
  const key=legacy.session.field.open,prior=clone(legacy.session.field.boxes[key]);
  assert.equal(key,'0-8');assert.deepEqual(clone(b.g.s.field.boxes[key]),prior);
  assert.equal(b.g.lootBoxIsLocked(0,8),false);assert.equal(b.g.s.field.action.end,legacy.session.field.action.end);
  valid(b.g);finish(b);go(b,'close');extract(b);b.g.ack();b.g.start();
  assert.equal(b.g.lootBoxIsLocked(0,8),true);
  console.log('PASS no/wrong/stashed key blocked; three tier-one purchases, two access slots/one field bag, atomic unlock rollback, single tile transfer and exact grid after independent JSON, historic in-flight search and fresh-raid relock.');
}
function generatorSamples(){
  for(const roll of [0,.09,.45,.85,.999]){
    const b=boot(),g=b.g;b.setRandom(roll);g.start();
    for(const [zone,area] of g.areas.entries()){
      for(const [ix,def] of area.boxes.entries()){
        const t=db.containers[def[2]], choose=(rows)=>{
          let remaining=roll*rows.reduce((total,r)=>total+r.relativeProbability,0);
          for(const row of rows){remaining-=row.relativeProbability;if(remaining<0)return row;}
          return rows[rows.length-1];
        };
        const count=choose(t.itemcountDistribution).count, first=g.s.field.boxes[zone+'-'+ix].items[0];
        if(!count){assert.equal(first,undefined);continue;}
        const eligible=t.itemDistribution.filter(({tpl})=>{
          const {width:w,height:h}=db.items[tpl],[x,y]=t.size;
          return w<=x&&h<=y || h<=x&&w<=y;
        });
        assert.equal(first.g,choose(eligible).tpl);
      }
    }
  }
  console.log('PASS 230 actual seeded first-slot/empty outcomes follow the exact table linked to each mapped container.');
}
generatorSamples();
compareForecast();
locks().catch(e=>{console.error(e);process.exitCode=1});
