const {assert,boot,clone,epoch,extract,stamp,v12,valid}=require('./game-fixture.cjs');
const ITEM='rl_09_10',QUEST='supply-warm-pot';
function setup(count=2,energy=98,pinned=true){
  const first=boot(),data=clone(first.g.s);
  data.contracts.supply.done=first.g.quests.filter(q=>q.trader==='supply'&&q.tier===1).map(q=>q.id);
  data.equipment.worn.back='issued_pack';
  delete data.stash[ITEM];
  data.stashSlots=data.stashSlots.filter(u=>u.g!==ITEM);
  data.equipment.bag=Array.from({length:count},(_,i)=>{
    const unit=first.g.unit(ITEM);unit.x=i*2;unit.y=0;return unit;
  });
  const ready=boot({[v12]:data},{now:epoch});
  assert.equal(ready.g.standing('supply').tier,2);
  assert.ok(ready.g.contract(QUEST,'accept').ok);
  if(pinned)assert.ok(ready.g.pin({kind:'contract',id:QUEST}));
  ready.g.start();
  assert.equal(ready.g.s.field.bag.filter(u=>u.g===ITEM).length,count);
  const active=clone(ready.g.s);active.field.energy=energy;
  const run=boot({[v12]:active},{now:epoch});valid(run.g);
  return run;
}
function preview(run){
  const unit=run.g.s.field.bag.find(u=>u.g===ITEM);
  run.click({page:'inventory'});run.click({pick:unit.uid,side:'bag'});
  return {unit,html:run.content()};
}
function test(){
  for(const [count,energy,pinned,before,after] of [[1,98,true,1,2],[2,98,true,0,1],[3,98,true,0,0],[2,100,true,0,0],[2,98,false,null,null]]){
    const b=setup(count,energy,pinned),initial=clone(b.g.s);
    const {unit,html}=preview(b);
    assert.deepEqual(clone(b.g.s.field.bag),initial.field.bag);
    assert.equal(b.g.s.wallet,initial.wallet);
    assert.match(html,/data-ration-preview=/);
    if(pinned)assert.ok(html.includes('data-ration-delivery="'+unit.uid+'" data-before="'+before+'" data-after="'+after+'"'));
    else assert.doesNotMatch(html,/data-ration-delivery=/);
    if(energy===100)assert.match(html,/회복량 0 · 소모 없음/);
    const reloaded=boot(new Map(b.storage),b.clock);
    if(pinned)assert.ok(preview(reloaded).html.includes('data-after="'+after+'"'));
    b.g.gear({gear:'consume',unit:unit.uid});
    assert.equal(b.g.s.field.bag.filter(u=>u.g===ITEM).length,count-Number(energy<100));
    assert.equal(b.g.s.field.energy,100);
    if(pinned){
      const m=b.g.objective().materials.find(m=>m.id===ITEM);
      assert.equal(Math.max(0,m.required-m.usable-m.fieldUsable),after);
    }
    b.g.gear({gear:'consume',unit:unit.uid});
    assert.equal(b.g.s.field.bag.filter(u=>u.g===ITEM).length,count-Number(energy<100));
    valid(b.g);
  }
  const b=setup(3);const unit=preview(b).unit;
  b.g.gear({gear:'consume',unit:unit.uid});
  stamp(b,b.g.s.raid.startedAt+420000);extract(b);b.g.ack();
  const balance=b.g.fee,xp=b.g.s.career.xp;
  assert.ok(b.g.contract(QUEST,'claim').ok);
  assert.equal(b.g.fee,balance+17000);
  assert.equal(b.g.s.career.xp,xp+75);
  assert.equal(b.g.stock(ITEM),0);
  const restored=boot(new Map(b.storage),b.clock);
  assert.equal(restored.g.contract(QUEST,'claim').ok,false);
  assert.equal(restored.g.fee,balance+17000);valid(restored.g);
  console.log('PASS ration delivery preview: exact unit, already short, threshold, surplus, max stat, no pin, reload, actual consumption, normal return and one contract receipt.');
}
if(process.argv.includes('--seed')){
  const b=setup(Number(process.env.RATION_COUNT||2),Number(process.env.RATION_ENERGY||98),process.env.RATION_PIN!=='0');
  console.log(JSON.stringify(clone(b.g.s)));
}else test();
