// Complete the original pump job with a new character, then exercise the follow-up on copies.
const {assert,boot,clone,extract,finish,go,stamp,valid}=require('./game-fixture.cjs');
const first='pump-gauge',order='pump-pipe',pipe='rl_08_15';
const base=boot();
base.g.order(order);
assert.equal(base.g.s.career.order,null);
base.g.order(first);
base.g.start();
go(base,'landmark',{index:6});
const raidId=String(base.g.s.raid.startedAt);
go(base,'gauge-read',{raidId});
const n=base.g.s.field.pumpGauge.reading;
go(base,'gauge-report',{raidId,answer:n<4?'below':n>4?'above':'level'});
stamp(base,base.g.s.raid.startedAt+420000);
extract(base);
assert.equal(base.g.s.lastSummary.commission,12000);
assert.match(base.g.readField(),/data-bui="order-followup"/);
base.g.ack();
base.g.order(order);
assert.equal(base.g.s.career.order,order);
assert.ok(base.g.pin({kind:'order',id:order}));
base.g.lookup(pipe);
base.g.supply(pipe);
assert.equal(base.g.s.wallet,26000);
assert.equal(base.g.stock(pipe),1);
function start(packed=true,roll=.001){
  const b=boot(new Map(base.storage),{now:base.clock.now+1000});
  if(packed)b.g.gear({gear:'pack',id:pipe});
  b.g.moveNow(0);
  b.setRandom(roll);
  b.g.start();
  go(b,'landmark',{index:6});
  assert.equal(b.g.s.field.bag.some(u=>u.g===pipe),packed);
  assert.deepEqual(clone(b.g.objective().locations).map(l=>[l.zone,l.landmark]),[[0,6]]);
  return b;
}
function open(b,i){
  while(!b.g.s.field.found[0].includes(i)){go(b,'scan');finish(b);}
  assert.equal(b.g.lootBoxIsLocked(0,i),false);
  go(b,'open',{index:i});
  return b.g.s.field.boxes['0-'+i];
}
function search(b){
  go(b,'search');
  while(b.g.s.field.action)finish(b);
  go(b,'close');
}
function settle(b,normal){
  if(normal)stamp(b,b.g.s.raid.startedAt+420000);
  extract(b);
  assert.equal(b.g.s.lastSummary.rating,normal?'success':'quick');
  valid(b.g);
  return b.g.s.lastSummary;
}
for(const condition of ['neighbor','missing','partial','quick','abandon','expire','success']){
  let b=start(condition!=='missing',condition==='partial'?.8:.001);
  const i=condition==='neighbor'?13:12;
  const box=open(b,i);
  assert.equal(b.g.objective().sample.site.complete,false);
  if(condition==='partial'){
    assert.ok(box.items.length>1);
    go(b,'search',{uid:box.items[0].uid});finish(b);go(b,'close');
  }else{
    assert.equal(box.items.length,0);
    search(b);
  }
  const matched=!['neighbor','partial'].includes(condition);
  assert.equal(b.g.objective().sample.site.complete,matched);
  assert.equal(b.g.objective().sample.carried,condition!=='missing');
  const raidId=b.g.s.raid.startedAt;
  b=boot(b.storage,b.clock);
  assert.equal(b.g.s.raid.startedAt,raidId);
  assert.equal(b.g.objective().sample.site.complete,matched);
  if(condition==='expire')stamp(b,b.g.s.raid.endsAt);
  else if(condition==='abandon')go(b,'abandon');
  else settle(b,condition!=='quick');
  const win=condition==='success',lost=['expire','abandon'].includes(condition);
  assert.equal(b.g.s.lastSummary.commission,win?18000:0);
  assert.equal(b.g.s.lastSummary.missionXp,win?65:0);
  assert.equal(b.g.s.wallet,win?44000:26000);
  assert.equal(b.g.stock(pipe),Number(!lost));
  assert.deepEqual(clone(b.g.s.career.done),win?[first,order]:[first]);
  assert.doesNotMatch(b.g.readField(),/data-bui="order-followup"/);
  b.g.ack();b.g.ack();b=boot(b.storage,b.clock);
  if(win){
    b.g.order(order);
    assert.equal(b.g.s.career.order,null);
    assert.equal(b.g.stock(pipe),1);
    assert.equal(b.g.s.wallet,44000);
  }else{
    assert.equal(b.g.s.career.order,order);
    b.g.start();assert.equal(b.g.objective().sample.site.complete,false);
  }
  valid(b.g);
}
// The locker beside the toolbox can roll the pipe. Use the actual loot table, search and transfer UI actions.
{
  const db=require('../Rustline_Database_v10.json');
  const locker=db.containers.locker, [w,h]=locker.size;
  const candidates=locker.itemDistribution.filter(({tpl})=>{
    const item=db.items[tpl];
    return (item.width<=w && item.height<=h)||(item.height<=w && item.width<=h);
  });
  const weight=rows=>rows.reduce((sum,row)=>sum+row.relativeProbability,0);
  const index=candidates.findIndex(row=>row.tpl===pipe);
  assert.ok(index>=0);
  const draw=(weight(candidates.slice(0,index))+candidates[index].relativeProbability/2)/weight(candidates);
  const b=start(false,draw);
  open(b,12);search(b);
  const lockerBox=open(b,13);
  go(b,'search');while(b.g.s.field.action)finish(b);
  const found=lockerBox.items.find(u=>u.g===pipe);
  assert.ok(found?.revealed);
  b.g.selectLoot(found.uid);go(b,'close');
  assert.equal(b.g.objective().sample.carried,true);
  b.g.gear({gear:'drop',unit:found.uid});assert.equal(b.g.objective().sample.carried,false);
  b.g.gear({gear:'recover',unit:found.uid});assert.equal(b.g.objective().sample.carried,true);
  assert.equal(settle(b,true).commission,18000);
  assert.equal(b.g.stock(pipe),2); // Unpacked purchase plus the actual newly recovered pipe.
}
console.log('PASS pump follow-up: actual prerequisite and catalog purchase, wrong box, no pipe, partial and empty toolbox, quick, expired, abandoned, retry, physical pipe retained and single normal-return settlement.');
