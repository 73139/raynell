const {assert,boot,clone,finish,valid,v12}=require('./game-fixture.cjs');

function offer(from,to,rolls){
  const b=boot();
  b.g.moveNow(from);
  b.g.start();
  b.setRolls(rolls);
  b.click({field:'move',index:String(to)});
  finish(b);
  assert.equal(b.g.s.field.journey.event,'supply');
  return b;
}
function useOffer(b){b.click({field:'journey-consume'});}

function foodOnFrozenRoute(){
  const b=offer(1,2,[.6,.1,.99]), g=b.g, f=g.s.field;
  assert.equal(f.journey.supply,'food');
  const plan=clone(f.journey.schedule);
  f.bag.length=0;
  for(let y=0;y<6;y++)for(let x=0;x<6;x++)f.bag.push({...g.unit('bandage'),x,y});
  const packed=clone(f.bag);
  f.energy=41;
  g.s.hideout.levels.kitchen=2;
  g.persist();
  assert.match(g.readField(),/data-field="journey-take" disabled/);
  assert.match(g.readField(),/먹고 이동 · 기력 \+26/);
  b.setRandom(0);
  useOffer(b);
  assert.equal(f.energy,67);
  assert.deepEqual(clone(f.bag),packed);
  assert.deepEqual(clone(f.journey.schedule),plan);
  assert.equal(f.action.outcome,'contact');
  assert.equal(f.action.start,b.clock.now);
  assert.equal(f.action.end,b.clock.now+plan.stepMs);
  assert.match(f.log[0],/기력 \+26/);
  useOffer(b);
  assert.equal(f.energy,67);
  const reloaded=boot(b.storage,b.clock);
  assert.equal(reloaded.g.s.field.energy,67);
  assert.deepEqual(clone(reloaded.g.s.field.bag),packed);
  finish(reloaded);
  assert.equal(reloaded.g.s.field.journey.event,'contact');
  valid(reloaded.g);
}

function boundedWater(){
  const b=offer(0,1,[.75,.1]), g=b.g, f=g.s.field;
  assert.equal(f.journey.supply,'water');
  g.s.hideout.levels.water=2;
  assert.match(g.readField(),/data-field="journey-consume" disabled>마시고 이동 · 수분 최대/);
  const before=clone(g.s);
  useOffer(b);
  assert.deepEqual(clone(g.s),before);
  f.water=94;
  const bag=clone(f.bag);
  assert.match(g.readField(),/마시고 이동 · 수분 \+6/);
  useOffer(b);
  assert.equal(f.water,100);
  assert.deepEqual(clone(f.bag),bag);
  assert.equal(g.s.raid.zone,1);
  assert.equal(f.journey,null);
  assert.ok(f.log.some(line=>line.includes('수분 +6')));
  valid(g);
}

function nonFoodAndDeadline(){
  for(const rolls of [[.8,.6],[.8,.9]]){
    const b=offer(1,0,rolls),g=b.g;
    assert.ok(['water','medkit'].includes(g.s.field.journey.supply));
    if(g.s.field.journey.supply==='medkit'){
      g.s.field.hp=35;
      assert.doesNotMatch(g.readField(),/data-field="journey-consume"/);
      const before=clone(g.s);
      useOffer(b);
      assert.deepEqual(clone(g.s),before);
    }else{
      g.s.field.water=24;
      b.clock.now=g.s.raid.endsAt;
      useOffer(b);
      assert.equal(g.s.field.result,'expired');
      assert.equal(g.s.field.water,24);
      assert.equal(g.s.raid.zone,1);
      assert.equal(g.s.field.journey,null);
    }
  }
}

function failedAndCompetingWrites(){
  const b=offer(0,1,[.75,.1]), g=b.g;
  g.s.field.water=48;
  g.persist();
  const fieldBefore=clone(g.s.field), disk=b.storage.get(v12);
  const set=b.storage.set;
  b.storage.set=()=>{throw Error('simulated quota error');};
  useOffer(b);
  assert.deepEqual(clone(g.s.field),fieldBefore);
  assert.equal(g.s.raid.zone,0);
  assert.equal(b.storage.get(v12),disk);
  b.storage.set=set;
  useOffer(b);
  assert.equal(g.s.field.water,73);
  assert.equal(g.s.raid.zone,1);
  valid(g);

  const stale=offer(0,1,[.75,.1]);
  stale.g.s.field.water=48;
  stale.g.persist();
  const current=boot(stale.storage,stale.clock);
  useOffer(current);
  const winner=stale.storage.get(v12);
  useOffer(stale);
  assert.equal(stale.storage.get(v12),winner);
  assert.deepEqual(clone(stale.g.s.field),clone(current.g.s.field));
  assert.equal(stale.g.s.field.water,73);

  const lost=offer(1,2,[.6,.1,0]);
  lost.g.s.field.energy=44;
  lost.g.persist();
  const authoritative=boot(lost.storage,lost.clock);
  authoritative.click({field:'journey-pass'});
  useOffer(lost);
  assert.equal(lost.g.s.field.energy,44);
  assert.deepEqual(clone(lost.g.s.field),clone(authoritative.g.s.field));
}

foodOnFrozenRoute();
boundedWater();
nonFoodAndDeadline();
failedAndCompetingWrites();
console.log('PASS road supply consumption, full bag, hideout bonus, capped gain, frozen legs, duplicate input, reload, expiry, write failure and conflicting tabs.');
