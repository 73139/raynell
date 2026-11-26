// Exercise only ordinary gameplay mutations. Controlled random draws make a rare first item reproducible.
const {assert,boot,clone,finish,go,extract,valid}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const fabric='rl_x_fabric',ammo='rl_x_ammo';
function materialRoll(tableId,id){
  const table=db.containers[tableId], [width,height]=table.size;
  const fits=table.itemDistribution.filter(row=>{
    const i=db.items[row.tpl];
    return i.width<=width&&i.height<=height || i.width<=height&&i.height<=width;
  });
  const sum=rows=>rows.reduce((n,row)=>n+row.relativeProbability,0);
  const i=fits.findIndex(row=>row.tpl===id);
  return (sum(fits.slice(0,i))+fits[i].relativeProbability/2)/sum(fits);
}
function forecasts(g,id){
  const actual=g.huntRegions(id);
  let seen=0;
  for(const [z,points] of g.places.entries())for(const [n,p] of points.entries()){
    const all=actual[z].landmarks.find(q=>q.index===n)?.boxes||[];
    for(const idx of p.boxes){
      const def=g.areas[z].boxes[idx],table=db.containers[def[2]],[w,h]=table.size;
      const pool=table.itemDistribution.filter(r=>{const v=db.items[r.tpl];return v.width<=w&&v.height<=h||v.width<=h&&v.height<=w;});
      const sum=arr=>arr.reduce((n,r)=>n+r.relativeProbability,0);
      const probability=sum(table.itemcountDistribution.filter(r=>r.count>0))/sum(table.itemcountDistribution)*
          sum(pool.filter(r=>r.tpl===id))/sum(pool);
      const shown=all.find(r=>r.index===idx);
      assert.ok(Math.abs((shown?.score||0)-probability)<1e-12,def[0]);
      if(shown){seen++;assert.deepEqual(clone(shown.examples),[id]);}
    }
  }
  assert.ok(seen>0);
}
async function run(){
  const b=boot(),g=b.g;
  assert.equal(g.barterHuntView(),null);
  assert.ok(!g.pinBarterHunt('quarter','rl_x_carbine','rl_x_core').ok);
  assert.ok(!g.pinBarterHunt('repair',ammo,fabric).ok);
  assert.ok(!g.pinBarterHunt('quarter',ammo,'water').ok);
  g.setLootGoal('fuel');
  const plan=g.lootGoalView().regions[0].landmarks[0];
  g.selectLootDestination(0,plan.index);
  const ordinary=clone(g.s.lootDestination);
  assert.ok(g.pinBarterHunt('quarter',ammo,'cloth').ok);
  assert.ok(g.pinBarterHunt('quarter',ammo,fabric).ok);
  for(const id of [fabric,'cloth','rl_x_mesh','rl_x_circuit','rl_x_core'])forecasts(g,id);
  assert.deepEqual(clone(g.s.lootDestination),ordinary);
  const point=g.huntRegions(fabric)[0].landmarks.find(q=>q.boxes.some(x=>x.table==='bag'&&!x.keyId));
  assert.ok(g.selectHuntDestination(0,point.index).ok);
  const marked=clone(g.s.barterHunt);
  assert.ok(g.selectLootDestination(0,plan.index).ok);
  assert.equal(g.s.barterHunt.destination,null);
  assert.ok(g.selectHuntDestination(0,point.index).ok);
  const old=g.s.revision,write=b.storage.set;b.storage.set=()=>{throw Error('quota')};
  assert.ok(!g.pinBarterHunt('quarter',ammo,'cloth').ok);assert.equal(g.s.revision,old);
  assert.deepEqual(clone(g.s.barterHunt),marked);b.storage.set=write;
  const before=await b.exportData(),copy=boot({},b.clock);
  await copy.g.importFile(new Blob([JSON.stringify(before)]));
  assert.deepEqual(clone(copy.g.s.barterHunt),marked);
  const empty=clone(before);delete empty.session.barterHunt;assert.ok(g.check(empty));
  for(const pin of [{...marked,destination:{zone:0,index:100}},{...marked,item:'water'},{...marked,recipe:'rl_x_carbine',item:'rl_x_core'}]){
    const wrong=clone(before);wrong.session.barterHunt=pin;assert.ok(!g.check(wrong));
  }
  const c=boot(new Map(b.storage),b.clock);
  assert.ok(c.g.writeBarterHunt(null).ok);
  assert.equal(c.g.s.lootGoal,'fuel');assert.deepEqual(clone(c.g.s.lootDestination),ordinary);
  const original=JSON.stringify(g.huntRegions(fabric));
  const box=point.boxes.find(x=>x.table==='bag'),key='0-'+box.index;
  b.setRandom(materialRoll(box.table,fabric));g.start();
  assert.equal(g.s.field.landmarkByZone[0],point.index);
  const unit=g.s.field.boxes[key].items[0];assert.equal(unit.g,fabric);
  assert.equal(JSON.stringify(g.huntRegions(fabric)),original);
  assert.equal(g.huntBadge(unit),'');assert.equal(g.barterHuntView().carried,0);
  b.setRandom(.1);
  while(!g.s.field.found[0].includes(box.index)){go(b,'scan');finish(b);}
  go(b,'open',{index:box.index});
  assert.equal(g.s.field.open,key);
  assert.ok(!g.readField().includes('data-hunt-badge'));
  go(b,'search',{uid:unit.uid});finish(b);
  assert.ok(g.readField().includes('data-hunt-badge'));assert.equal(g.barterHuntView().carried,0);
  g.selectLoot(unit.uid);assert.equal(g.barterHuntView().carried,1);assert.equal(g.barterHuntView().owned,0);assert.equal(g.barterHuntView().toFind,0);
  const retry=boot(new Map(b.storage),b.clock);go(retry,'close');go(retry,'abandon');
  assert.equal(retry.g.barterHuntView().owned,0);assert.equal(retry.g.barterHuntView().carried,0);
  assert.ok(retry.g.readField().includes('이번 출격 손실 1개'));
  go(b,'close');extract(b);
  assert.equal(g.barterHuntView().carried,0);assert.equal(g.barterHuntView().owned,1);assert.equal(g.barterHuntView().missing,0);
  assert.ok(g.readField().includes('이번 출격 회수 1개'));
  valid(g);
  assert.deepEqual(clone(g.s.barterHunt),marked);assert.deepEqual(clone(g.s.lootDestination),ordinary);
  console.log('PASS five exact item forecasts vs every actual landmark/container, rank/recipe checks, pin replacement and cancellation, concurrent independent hunt and category goals, exact deployment location, save failure rollback and legacy/invalid JSON.');
  console.log('PASS generated unopened physical material hidden, real search reveals only that UID, acquiring changes carried only, restored fork abandonment loses it and extraction deposits it. No rewards created by tracking.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
