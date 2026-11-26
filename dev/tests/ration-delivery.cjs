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
function healthAndHotkeys(){
  for(const [count,energy,pinned,before,after] of [[1,98,true,1,2],[2,98,true,0,1],[3,98,true,0,0],[1,100,true,1,1],[2,98,false,null,null]]){
    const run=setup(count,energy,pinned);
    run.click({page:'health'});
    for(const index of ['0','9']){
      run.click({loadout:'assign',id:ITEM});
      assert.doesNotMatch(run.content(),/data-quick-risk=|data-quick-delivery=/);
      run.click({loadout:'quick',index});
    }
    const starting=clone(run.g.s.field.bag),unit=starting[0];
    const html=run.content();
    const detail=html.match(/<div class="lo-med-detail">([\s\S]*?)<\/div>/)[1];
    const button=html.match(/<button[^>]*data-loadout="quick" data-index="0"[^>]*>/)[0];
    if(pinned){
      const line='생환 시 부족 '+before+' → '+after+'개';
      assert.ok(detail.includes('data-ration-delivery="'+unit.uid+'"')&&detail.includes(line));
      const hints=[...button.matchAll(/(?:title|aria-description)="([^"]*)"/g)].map(m=>m[1]);
      assert.equal(hints.length,2);
      assert.ok(hints[0].includes(line)&&hints[0].includes('가방 1행 1열'));
      assert.equal(hints[0],hints[1]);
      assert.equal(html.split('data-quick-delivery="'+unit.uid+'"').length-1,2);
    }else{
      assert.doesNotMatch(detail,/data-ration-delivery=/);
      assert.doesNotMatch(button,/고정 의뢰/);
      assert.doesNotMatch(html,/data-quick-delivery=/);
    }
    assert.equal(html.split('data-quick-risk="'+ITEM+'"').length-1,Number(after>before));
    if(after>before)assert.ok(html.includes('1·0번')&&html.includes('사용 시 납품 부족 '+before+' → '+after+'개'));
    run.click({loadout:'unbind'});
    assert.doesNotMatch(run.content(),/data-quick-risk=|data-quick-delivery=/);
    run.click({loadout:'unbind'});
    run.click({loadout:'quick',index:'0'});
    assert.deepEqual(clone(run.g.s.field.bag),energy<100?starting.slice(1):starting);
    assert.equal(run.g.s.field.energy,100);
    if(pinned&&starting[1]&&energy<100){
      assert.ok(run.content().includes('data-quick-delivery="'+starting[1].uid+'"'));
      assert.doesNotMatch(run.content(),/data-quick-risk=/);
    }
    valid(run.g);
  }
}
function recurringDrink(){
  for(const kind of ['daily','weekly']){
    const base=boot(),board=base.g.board('supply',kind);
    const quest=board.entries.map(row=>row.quest).find(q=>q.goals.some(goal=>goal.type==='delivery'&&base.g.kitSupply(goal.item)?.stat==='water'));
    const {item,target}=quest.goals.find(goal=>base.g.kitSupply(goal.item)?.stat==='water');
    assert.ok(base.g.cycleWork('supply',kind,board.key,quest.id,'accept').ok);
    assert.ok(base.g.pin({kind,id:quest.id,trader:'supply',key:board.key}));
    const state=clone(base.g.s),unit=base.g.unit(item);
    state.equipment.bag=[unit];state.equipment.quickslots[0]=item;
    state.stash[item]=target;delete state.stashSlots;
    const ready=boot({[v12]:state});ready.g.start();
    const active=clone(ready.g.s);active.field.water=80;
    const run=boot({[v12]:active});run.click({page:'health'});
    const line=run.content().match(/<p[^>]*data-ration-delivery[^>]*>([^<]*)<\/p>/)[1];
    assert.ok(line.includes(quest.title)&&line.includes('벙커 납품 가능 '+target+'개')&&line.includes('생환 시 부족 0 → 0개'));
    assert.doesNotMatch(run.content(),/data-quick-risk=/);
    run.click({loadout:'quick',index:'0'});
    assert.equal(run.g.s.field.water,100);assert.equal(run.g.stock(item),target);valid(run.g);
  }
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
  healthAndHotkeys();
  recurringDrink();
  console.log('PASS ration delivery preview: physical bag/health/quick-use units, grouped touch warnings, keyboard descriptions, standing/daily/weekly delivery, max stat, reload, normal return and one contract receipt.');
}
if(process.argv.includes('--seed')){
  const b=setup(Number(process.env.RATION_COUNT||2),Number(process.env.RATION_ENERGY||98),process.env.RATION_PIN!=='0');
  console.log(JSON.stringify(clone(b.g.s)));
}else test();
