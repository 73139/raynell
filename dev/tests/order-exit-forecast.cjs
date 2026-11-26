const {assert,boot,clone,extract,finish,go,move,stamp,setTestCash,v12,valid}=require('./game-fixture.cjs');

function text(g,id='b04'){
  const row=g.readField().match(new RegExp('<p data-exit-forecast="'+id+'"(?: hidden)?>([^<]*)</p>'));
  return row?.[1]||'';
}
function medical(){
  const b=boot(),g=b.g;
  g.order('med-supply');
  b.setRandom(.1);
  g.start();
  go(b,'landmark',{index:7});go(b,'scan');finish(b);
  const box=g.places[0][7].boxes[0];
  go(b,'open',{index:box});go(b,'search');finish(b);
  const bandage=g.s.field.boxes['0-'+box].items.find(item=>item.g==='bandage');
  g.selectLoot(bandage.uid);go(b,'close');
  return {b,uid:bandage.uid};
}
function cases(){
  const {b,uid}=medical(),g=b.g,initial=clone(g.s);
  assert.equal(initial.objectivePin,null);
  assert.match(text(g),/조기 탈출.*기본 25 XP.*끊긴 의무품 보급선.*의뢰 보상 0 CR \/ 0 XP.*컨테이너 1개 추가 수색 완료.*교전 1회 승리/);
  assert.deepEqual(clone(g.s),initial);
  const t0=g.s.raid.startedAt,early=boot(new Map(b.storage),{now:t0+409999});
  assert.match(text(early.g),/생존 00:01 추가/);
  go(early,'extract',{exit:'b04'});
  stamp(early,t0+410001);
  assert.match(text(early.g),/조기 탈출.*의뢰 보상 0 CR.*생존 00:01 추가/);
  finish(early);
  assert.equal(early.g.s.lastSummary.commission,0);
  assert.equal(early.g.s.lastSummary.earned,25);
  assert.ok(early.g.s.lastSummary.goods.includes('bandage'));

  stamp(b,t0+410000);
  assert.match(text(g),/정상 탈출.*의뢰 보상 28,000 CR \/ 100 XP/);
  g.gear({gear:'drop',unit:uid});
  assert.match(text(g),/정상 탈출.*의뢰 보상 0 CR \/ 0 XP.*목표 미달.*0\/1/);
  g.gear({gear:'recover',unit:uid});
  go(b,'extract',{exit:'b04'});
  const reloaded=boot(b.storage,b.clock);
  assert.match(text(reloaded.g),/정상 탈출.*28,000 CR \/ 100 XP/);
  finish(reloaded);
  assert.equal(reloaded.g.s.lastSummary.commission,28000);
  assert.equal(reloaded.g.s.lastSummary.missionXp,100);
  valid(reloaded.g);
}
function conditionsAndFee(){
  for(const condition of ['searched','victory']){
    const {b}=medical(),g=b.g;
    if(condition==='searched'){
      go(b,'scan');finish(b);
      const second=g.places[0][7].boxes[1];
      go(b,'open',{index:second});go(b,'search');
      while(g.s.field.action)finish(b);
      go(b,'close');
    }else g.s.field.victories=1;
    assert.match(text(g),/정상 탈출.*28,000 CR \/ 100 XP/);
    extract(b);
    assert.equal(g.s.lastSummary.commission,28000);
    assert.ok(g.s.lastSummary.elapsed<7*60000);
  }
  const {b}=medical(),g=b.g;
  move(b,1);
  if(!g.s.field.exits.includes('truck'))g.s.field.exits.push('truck');
  stamp(b,g.s.raid.startedAt+7*60000);
  assert.equal(text(g),'');
  assert.match(text(g,'truck'),/의뢰 보상 28,000 CR \/ 100 XP/);
  const before=g.s.wallet;
  extract(b,'truck');
  assert.equal(g.s.wallet,before-15000+28000);
  assert.equal(g.s.lastSummary.missionXp,100);
}
function noOrderAndMissingGoal(){
  const b=boot();b.g.start();
  assert.doesNotMatch(text(b.g),/의뢰 보상/);
  const {b:missing,uid}=medical();
  missing.g.gear({gear:'drop',unit:uid});
  assert.match(text(missing.g),/조기 탈출.*목표 미달.*0\/1.*정상 탈출까지/);
  extract(missing);
  assert.equal(missing.g.s.lastSummary.commission,0);
  assert.equal(missing.g.s.career.order,'med-supply');
}
function safeBalance(){
  const {b}=medical(),snap=clone(b.g.s);
  setTestCash(snap,Number.MAX_SAFE_INTEGER-27999);
  const full=boot({[v12]:snap},{now:snap.raid.startedAt+7*60000});
  assert.match(text(full.g),/정상 탈출.*의뢰 보상 0 CR.*잔액 한도 초과/);
  extract(full);
  assert.equal(full.g.s.lastSummary.commission,0);
  assert.equal(full.g.s.wallet,snap.wallet);
  assert.equal(full.g.s.career.order,'med-supply');
}
cases();conditionsAndFee();noOrderAndMissingGoal();safeBalance();
console.log('PASS accepted order forecast, genuine sample, missing/dropped sample, payout after searches/victory/time, 1ms boundary, frozen countdown, eligible local-only exits, vehicle fare and reload.');
