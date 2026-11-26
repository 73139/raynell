// Exercise the pinned objective against the built game and its usual game actions.
const {setTestCash,assert,boot,clone,extract,finish,go,stamp,valid,v12} = require('./game-fixture.cjs');
const pantry = {kind:'contract',id:'supply-pantry'};
const flask = {kind:'contract',id:'supply-spare-flask'};
const power = {kind:'facility',id:'power',tier:1};
const material = (game,id) => game.objective().materials.find(item=>item.id===id);
function quantities(game,id) {
  const {required,owned,usable,field,missing} = material(game,id);
  return [required,owned,usable,field,missing];
}
function pinButton(player, pin) {
  player.click({objective:'pin',...pin});
  assert.equal(player.g.objective()?.source.id,pin.id);
}
function visit(player,page,panel,title){
  player.click({page});
  assert.ok(player.content().includes('data-objective-panel="'+panel+'"'),panel);
  assert.ok(player.content().includes(title),page);
}
function visibleQuantities(player,id,expected){
  const rows=[...player.content().matchAll(/<li\b[^>]*data-objective-material="([^"]+)"[^>]*>/g)]
    .filter(match=>match[1]===id);
  assert.ok(rows.length,id+' is visible');
  for(const [tag] of rows) {
    const counters=['required','owned','usable','field','missing'].map(key=>{
      const value=tag.match(new RegExp('data-'+key+'="(\\d+)"'));
      assert.ok(value,key+' missing in visible markup');
      return Number(value[1]);
    });
    assert.deepEqual(counters,expected);
  }
}
function pantrySearch(player) {
  go(player,'landmark',{index:3});go(player,'scan');finish(player);
  const boxIndex=player.g.places[0][3].boxes[0];
  go(player,'open',{index:boxIndex});
  if (!player.g.s.field.boxes['0-'+boxIndex].complete) {
    go(player,'search');while(player.g.s.field.action)finish(player);
  }
  go(player,'close');
}
async function contractJourney(){
  const b=boot({},undefined,{},'#quests'),g=b.g;
  const future=g.quests.find(q=>q.id==='supply-bus-rations');
  assert.equal(g.objective(),null);
  assert.equal(g.pin({kind:'contract',id:future.id}),false);
  assert.equal(g.pin(pantry),false,'only accepted contracts may be tracked');
  b.click({contract:'open',id:pantry.id});b.click({contract:'accept',id:pantry.id});
  assert.ok(b.content().includes('data-objective="pin"'));
  pinButton(b,pantry);
  assert.ok(g.objective().locations.some(l=>l.zone===0&&l.landmark===3&&!l.possible));
  visit(b,'prep','prep','배급소 찬장');visit(b,'map','map','배급소 식당');
  assert.ok(!b.content().includes(future.title));
  const transfer=boot();
  await transfer.g.importFile(new Blob([JSON.stringify(await b.exportData())]));
  assert.equal(transfer.g.objective().source.id,pantry.id);
  g.start();visit(b,'raid','field','배급소 찬장');pantrySearch(b);
  assert.equal(g.objective().goals[0].value,0,'survival is still required');
  assert.equal(g.objective().goals[0].projected,1);
  go(b,'abandon');
  assert.equal(g.objective().goals[0].value,0,'failed sortie must not award the field goal');
  g.ack();g.start();pantrySearch(b);extract(b);
  assert.equal(g.objective().goals[0].value,1);
  visit(b,'raid','result','배급소 찬장');
  b.click({objective:'open'});assert.equal(g.s.raid,null);
  assert.ok(b.content().includes('data-contract="claim" data-id="'+pantry.id+'"'));
  b.click({contract:'claim',id:pantry.id});assert.equal(g.status(pantry.id).status,'claimed');
  assert.equal(g.objective(),null);assert.equal(g.s.objectivePin,null);
  assert.equal(boot(b.storage).g.objective(),null);
  valid(g);
}
function inventoryAccounting(){
  const seed=clone(boot().g.s);
  setTestCash(seed,500000); seed.stash={water:3,wire:3,fuel:1,bolt:2,rs_case_food:1,rs_case_junk:1};
  delete seed.stashSlots;
  const b=boot({[v12]:seed}),g=b.g;
  const caseFor=id=>g.s.stashSlots.find(u=>u.g===id);
  assert.ok(g.caseMove(caseFor('rs_case_food').uid,'put','water').ok);
  assert.ok(g.caseMove(caseFor('rs_case_junk').uid,'put','wire').ok);
  g.gear({gear:'pack',id:'water'}); g.gear({gear:'pack',id:'wire'});
  assert.ok(g.contract(flask.id,'accept').ok);assert.ok(g.pin(flask));
  assert.deepEqual(quantities(g,'water'),[1,3,3,0,0],'NPC can use ready bag, case and loose stock');
  b.click({bui:'facility',id:'power',tier:'1'});pinButton(b,power);
  assert.deepEqual(quantities(g,'wire'),[2,3,1,0,1]);
  visit(b,'prep','prep','발전 시설');visibleQuantities(b,'wire',[2,3,1,0,1]);
  visit(b,'map','map','발전 시설');visibleQuantities(b,'wire',[2,3,1,0,1]);
  g.start();
  assert.deepEqual(quantities(g,'wire'),[2,2,1,1,1],'deployed unit is at risk');
  extract(b);
  assert.deepEqual(quantities(g,'wire'),[2,3,2,0,0],'returned unit is now in the warehouse');
  g.ack();g.build({hideout:'build',id:'power',tier:1});
  assert.ok(g.s.hideout.builds.power);assert.equal(g.objective(),null);
  assert.equal(g.s.objectivePin,null);
  assert.ok(g.pin(flask));assert.ok(g.contract(flask.id,'claim').ok);
  assert.equal(g.objective(),null);valid(g);
}
function discoveryAndLoss(){
  const b=boot(),g=b.g;
  assert.ok(g.contract(flask.id,'accept').ok);assert.ok(g.pin(flask));g.start();
  assert.deepEqual(quantities(g,'water'),[1,0,0,0,1]);
  assert.ok(g.objective().locations.some(location=>location.possible));
  go(b,'scan');finish(b);
  const index=g.places[0][0].boxes[0],box=g.s.field.boxes['0-'+index];
  const sample={...g.unit('water'),revealed:false};
  box.items=[sample];box.complete=false;
  go(b,'open',{index});
  assert.ok(b.content().includes('data-objective-panel="loot"'));
  assert.ok(!b.content().includes('data-objective-item="water"'),'no match leaked for an unidentified tile');
  assert.ok(!b.content().includes('class="obj-tile-mark"'),'unidentified loot cannot have a match badge');
  assert.deepEqual(quantities(g,'water'),[1,0,0,0,1]);
  go(b,'search',{uid:sample.uid});finish(b);b.click({pick:sample.uid,side:'loot'});
  assert.ok(b.content().includes('data-objective-item="water"'));
  visibleQuantities(b,'water',[1,0,0,0,1]);
  assert.deepEqual(quantities(g,'water'),[1,0,0,0,1],'finding a tile does not acquire it');
  go(b,'take');assert.deepEqual(quantities(g,'water'),[1,0,0,1,1]);
  visibleQuantities(b,'water',[1,0,0,1,1]);
  go(b,'close');go(b,'abandon');
  assert.deepEqual(quantities(g,'water'),[1,0,0,0,1]);
  g.ack();assert.ok(g.contract(flask.id,'cancel').ok);
  assert.equal(g.objective(),null);assert.equal(g.s.objectivePin,null);
}
function sevenMinuteThreshold(){
  const b=boot({},undefined,{},'#quests'),g=b.g;
  g.order('stores');assert.ok(g.pin({kind:'order',id:'stores'}));g.start();
  visit(b,'map','map','보급품 위치 확인');
  const sevenMinutes=g.s.raid.startedAt+7*60000;
  stamp(b,sevenMinutes-1);
  assert.equal(g.objective().goals[1].projected,undefined);
  assert.ok(!b.content().includes('생환 시 1 / 1'));
  stamp(b,sevenMinutes);
  assert.equal(g.objective().goals[1].value,0);
  assert.equal(g.objective().goals[1].projected,1);
  assert.ok(b.content().includes('생환 시 1 / 1'),'idle map renders the normal-exit projection without a page click');
}
function equippedAndRestored(){
  const b=boot(),seed=clone(b.g.s);
  const quest=b.g.quests.find(q=>q.id==='quarter-faceshields');
  seed.contracts.quarter.done=b.g.quests.filter(q=>q.trader==='quarter'&&q.tier<quest.tier)
    .sort((a,b)=>a.tier-b.tier).map(q=>q.id);
  seed.equipment.worn.head='rl12_helmet';seed.stash={rl12_helmet:1};delete seed.stashSlots;
  const eligible=boot({[v12]:seed}),g=eligible.g;
  assert.ok(g.contract(quest.id,'accept').ok);assert.ok(g.pin({kind:'contract',id:quest.id}));
  assert.equal(material(g,'rl12_helmet').owned,2);assert.equal(material(g,'rl12_helmet').usable,1);
  assert.equal(material(g,'rl12_helmet').worn,1);
  const beginner=clone(b.g.s);
  beginner.objectivePin=clone(g.s.objectivePin);
  const restored=boot({[v12]:beginner},undefined,{},'#quests');assert.equal(restored.g.objective(),null);
  assert.ok(!restored.content().includes(quest.title));assert.equal(restored.g.s.objectivePin,null);
}
function periodsAndBunker(){
  for(const kind of ['daily','weekly']){
    const b=boot(),g=b.g;const board=g.board('medic',kind);
    const q=board.entries.find(e=>e.quest.type==='delivery').quest;
    const pin={kind,id:q.id,trader:'medic',key:board.key};
    assert.equal(g.pin(pin),false);
    assert.ok(g.cycleWork('medic',kind,board.key,q.id,'accept').ok);
    assert.ok(g.pin(pin));assert.equal(g.objective().materials.length,q.goals.length);
    assert.equal(g.pin({...pin,key:board.key-1}),false);
    stamp(b,board.endsAt);assert.equal(g.objective(),null);
    assert.equal(boot(b.storage,b.clock).g.objective(),null);
  }
  const b=boot(),g=b.g;
  g.order('stores');assert.ok(g.pin({kind:'order',id:'stores'}));
  assert.equal(g.pin({kind:'order',id:'signals'}),false);
  g.start();
  // Two searched sample containers are sufficient to test the integrated payout/receipt.
  Object.values(g.s.field.boxes).slice(0,2).forEach(box=>{box.complete=true});
  extract(b);
  assert.equal(g.s.objectivePin,null);
  assert.equal(g.s.lastSummary.completedObjectiveOrder,'stores');
  visit(b,'raid','result','보급품 위치 확인');assert.match(b.content(),/보상 지급/);g.ack();
  assert.ok(g.pin(power));assert.equal(g.objective().source.id,'power');
  assert.ok(g.pin(null));assert.equal(g.objective(),null);
}
async function oldSavesAndFailures(){
  const reference=boot(),old=clone(reference.g.s);
  old.version=16;delete old.objectivePin;
  const original=JSON.stringify(old);
  const b=boot({'rl-reboot-session-v16':old});
  assert.equal(b.g.objective(),null);assert.equal(b.storage.get('rl-reboot-session-v16'),original);
  b.g.contract(pantry.id,'accept');assert.ok(b.g.pin(pantry));
  await b.g.importFile(new Blob([JSON.stringify({format:'rustline-tc01',session:old})]));
  assert.equal(b.g.objective(),null,'an old save has no dangling pin');
  assert.equal(b.g.s.wallet,old.wallet);
  assert.ok(b.g.pin(power));
  const before=JSON.stringify(b.g.s);
  b.storage.set=()=>{throw Error('simulated storage quota')};
  assert.equal(b.g.pin(null),false);assert.equal(JSON.stringify(b.g.s),before);
  const two=boot();
  two.g.order('stores');
  const stale=boot(two.storage);
  two.g.persist(); // reconcile the v17 writer to the new tab's boot revision, then save its change.
  assert.ok(two.g.pin({kind:'order',id:'stores'}));
  assert.equal(stale.g.pin(power),false);
  assert.equal(stale.g.objective().source.id,'stores');
}
(async()=>{
  await contractJourney();inventoryAccounting();discoveryAndLoss();
  sevenMinuteThreshold();equippedAndRestored();periodsAndBunker();await oldSavesAndFailures();
  console.log('PASS pinned objective: all five types, selected routes, inventory sources, reveal, suspended raid credit, loss/return, expiry, builds, old saves, quota errors and stale tabs.');
})().catch(error=>{console.error(error);process.exitCode=1;});
