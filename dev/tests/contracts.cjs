// Execute the shipped HTML's closures. The campaign sweep seeds supplies and
// encounter outcomes, then uses the real settlement, wallet and warehouse paths.
const {assert, boot, clone, extract, finish, go, move, valid, v12, epoch} = require('./game-fixture.cjs');
const base = boot();
const {g: catalogue} = base;
const ids = new Set();
const allowed = ['delivery','returns','normal','searches','visits','victories','regions','dock-cycle'];
for (const trader of catalogue.traders) {
  const entries = catalogue.quests.filter(q => q.trader === trader.id);
  assert.deepEqual([1,2,3,4].map(t => entries.filter(q => q.tier === t).length), trader.id==='quarter'?[6,3,4,4]:[6,3,4,3]);
  assert.equal(new Set(entries.map(q => q.title)).size, entries.length);
  for (const q of entries) {
    assert.ok(!ids.has(q.id)); ids.add(q.id);
    assert.ok(q.title && q.brief && q.goals.length && q.cr > 0 && q.xp > 0 && q.rep > 0);
    assert.equal(q.rep, q.tier === 1 ? 10 : 25);
    for (const goal of q.goals) {
      assert.ok(allowed.includes(goal.type), goal.type);
      assert.ok(Number.isSafeInteger(goal.target) && goal.target > 0);
      if (goal.type === 'delivery') assert.ok(catalogue.goods[goal.item]);
      if (goal.zone !== undefined) assert.ok(catalogue.areas[goal.zone]);
      if (goal.landmark !== undefined) assert.ok(catalogue.places[goal.zone][goal.landmark]);
      if (goal.type === 'regions') assert.ok(goal.target <= 3);
      assert.ok(catalogue.goalLabel(goal));
    }
  }
}
assert.equal(ids.size,65);
const sorted = [...catalogue.quests].sort((a,b) => a.tier-b.tier);
const singleDelivery = sorted.find(q => q.tier === 1 && q.goals.length === 1 && q.goals[0].type === 'delivery');
assert.ok(singleDelivery, 'beginner hand-in');
const seed = clone(base.g.s);
delete seed.contracts;
seed.wallet = 30000;
seed.stash = {};
seed.stashSlots = [];
for (const q of sorted) for (const goal of q.goals) {
  if (goal.type === 'delivery') seed.stash[goal.item] = (seed.stash[goal.item] || 0) + goal.target;
}
const campaign = boot({[v12]:seed}), g = campaign.g;
valid(g);
assert.ok(g.status(sorted.find(q=>q.tier===2).id).status === 'locked');
let rewardCr = 0, rewardXp = 0;
for (const quest of sorted.filter(q=>q.id!=='quarter-dock-chain')) {
  const standing = clone(g.standing(quest.trader));
  const others = Object.fromEntries(g.traders.filter(t => t.id !== quest.trader).map(t => [t.id, g.standing(t.id).points]));
  assert.equal(g.status(quest.id).status, 'available', quest.id);
  assert.ok(g.contract(quest.id, 'accept').ok);
  assert.equal(g.contract(quest.id,'accept').ok,false);
  let attempts = 0;
  while (g.status(quest.id).status !== 'ready') {
    assert.ok(++attempts<=12, 'one active objective never reached: '+quest.id);
    campaign.clock.now += 100;
    g.start();
    const f = g.s.field;
    f.visited = [0,1,2]; f.victories = 4;
    for (const box of Object.values(f.boxes)) box.complete = true;
    extract(campaign);
    assert.ok(g.s.lastSummary.contractUpdates.some(u=>u.id===quest.id));
    assert.match(g.readField(),/상인 퀘스트 진척/);
    assert.equal(g.contract(quest.id, 'claim').ok,false);
    g.ack();
  }
  const pre = clone(g.s);
  assert.ok(g.contract(quest.id,'claim').ok, quest.id);
  assert.equal(g.s.wallet-pre.wallet,quest.cr); assert.equal(g.s.career.xp-pre.career.xp,quest.xp);
  for (const goal of quest.goals) if (goal.type==='delivery') assert.equal(pre.stash[goal.item]-g.stock(goal.item),goal.target);
  const earned = g.standing(quest.trader);
  assert.equal(earned.points,standing.points+quest.rep);
  assert.equal(earned.tier,[0,60,135,235].filter(x=>earned.points>=x).length);
  for(const [id,points] of Object.entries(others)) assert.equal(g.standing(id).points, points);
  assert.equal(g.status(quest.id).status,'claimed');
  assert.ok(!g.contract(quest.id,'claim').ok);
  assert.ok(!g.contract(quest.id,'accept').ok);
  rewardCr+=quest.cr;rewardXp+=quest.xp;
}
assert.ok(rewardCr>0 && rewardXp>0);
valid(g);
const restored=boot(new Map(campaign.storage));
assert.deepEqual(clone(restored.g.s.contracts),clone(g.s.contracts));
assert.ok(restored.g.quests.filter(q=>q.id!=='quarter-dock-chain').every(q=>restored.g.status(q.id).status==='claimed'));
for (const t of g.traders) assert.equal(g.standing(t.id).tier,4);

// Input-level journey/survival: accepting a quest never consumes earlier returns.
const fieldQuest = sorted.find(q => q.tier === 1 && q.goals.length === 1 &&
  ['returns','searches','visits'].includes(q.goals[0].type));
assert.ok(fieldQuest);
const walk = boot(), w=walk.g;
w.start(); extract(walk); w.ack();
assert.ok(w.contract(fieldQuest.id, 'accept').ok);
assert.equal(w.status(fieldQuest.id).goals[0].value,0);
w.start(); assert.ok(!w.contract(fieldQuest.id,'cancel').ok); go(walk,'abandon'); w.ack();
assert.equal(w.status(fieldQuest.id).goals[0].value,0);
w.start();
const target=fieldQuest.goals[0];
if(target.zone) move(walk,target.zone);
if(target.landmark!==undefined) go(walk,'landmark',{index:target.landmark});
if(target.type==='searches'){
  go(walk,'scan');finish(walk);
  const boxIndex=w.s.field.found[w.s.raid.zone][0];
  go(walk,'open',{index:boxIndex});
  if(!w.s.field.boxes[w.s.field.open].complete){
    if(!w.s.field.action)go(walk,'search');
    while(w.s.field.action)finish(walk);
  }
  go(walk,'close');
}
if(w.s.raid.zone!==0) move(walk,0);
extract(walk);
assert.equal(w.status(fieldQuest.id).goals[0].value,1);
const settled=boot(new Map(walk.storage),walk.clock);
assert.equal(settled.g.status(fieldQuest.id).goals[0].value,1);
assert.ok(w.readField().includes(fieldQuest.title));
w.ack();
assert.equal(w.contract(fieldQuest.id,'cancel').ok,true);
assert.ok(w.contract(fieldQuest.id,'accept').ok);
assert.equal(w.status(fieldQuest.id).goals[0].value,0);

// Exercise a named landmark's actual scan/open/search buttons on independent raids.
// A different landmark and a repeat of its first container must not finish the pair.
const locationSeed=clone(base.g.s);
locationSeed.contracts.medic.done=openingIds('medic');
locationSeed.contracts.supply.done=openingIds('supply');
function openingIds(trader){return sorted.filter(q=>q.tier===1&&q.trader===trader).map(q=>q.id)}
let survey=boot({[v12]:locationSeed});
assert.ok(survey.g.contract('medic-patient-route','accept').ok);
assert.ok(survey.g.contract('supply-warm-pot','accept').ok);
function fieldSurvey(b,landmark,containerNumber) {
  const t=b.g;
  b.clock.now+=100;
  t.start();
  go(b,'landmark',{index:landmark});
  for(let i=0;i<=containerNumber;i++){go(b,'scan');finish(b)}
  const box=t.places[0][landmark].boxes[containerNumber];
  go(b,'open',{index:box});
  go(b,'search');
  while(t.s.field.action)finish(b);
  assert.equal(t.s.field.boxes['0-'+box].complete,true);
  go(b,'close');extract(b);t.ack();
}
fieldSurvey(survey,0,0);
assert.equal(survey.g.status('medic-patient-route').goals[1].value,0);
assert.equal(survey.g.status('supply-warm-pot').goals[1].value,0);
fieldSurvey(survey,7,0);
assert.equal(survey.g.status('medic-patient-route').goals[1].value,1);
valid(survey.g);
survey=boot(new Map(survey.storage),survey.clock);
fieldSurvey(survey,7,0);
assert.equal(survey.g.status('medic-patient-route').goals[1].value,1);
fieldSurvey(survey,7,1);
assert.equal(survey.g.status('medic-patient-route').goals[1].value,2);
assert.equal(survey.g.status('medic-patient-route').goals[0].value,1);
survey.g.start();
survey.clock.now+=7*60*1000;
extract(survey);
assert.equal(survey.g.status('supply-warm-pot').goals[1].value,1);
assert.equal(survey.g.status('medic-patient-route').goals[0].value,1);

// One accepted contract per trader. Refuse a competing record or unsafe save
// without consuming staged materials, awarding CR/XP or corrupting grid positions.
const flow=boot({[v12]:seed}),f=flow.g,opening=f.quests.filter(q=>q.tier===1);
for(const trader of f.traders){
  const first=trader.id===singleDelivery.trader?singleDelivery:opening.find(q=>q.trader===trader.id);
  assert.ok(f.contract(first.id,'accept').ok);
  const blocked=opening.find(q=>q.trader===trader.id&&q.id!==first.id);
  assert.equal(f.status(blocked.id).status,'busy');
  assert.equal(f.contract(blocked.id,'accept').ok,false);
}
const activeBackup=clone(f.s);
assert.ok(f.check({format:'rustline-tc01',session:activeBackup}));
const invalid=clone(activeBackup);
invalid.contracts[singleDelivery.trader].active.progress=[999];
assert.equal(f.check({format:'rustline-tc01',session:invalid}),false);
const forged=clone(activeBackup);
forged.contracts[singleDelivery.trader].done=[sorted.find(q=>q.tier===4&&q.trader===singleDelivery.trader).id];
assert.equal(f.check({format:'rustline-tc01',session:forged}),false);
const empty=clone(activeBackup);
empty.stash={};empty.stashSlots=[];
const missing=boot({[v12]:empty}).g;
assert.equal(missing.status(singleDelivery.id).status,'active');
assert.ok(!missing.contract(singleDelivery.id,'claim').ok);
const frozen=clone(f.s);
flow.storage.set=()=>{throw Error('simulated quota')};
assert.equal(f.contract(singleDelivery.id,'claim').ok,false);
assert.deepEqual(clone(f.s),frozen);
const shared=boot({[v12]:activeBackup}),other=boot(shared.storage,shared.clock);
assert.ok(other.g.contract(singleDelivery.id,'claim').ok);
assert.ok(!shared.g.contract(singleDelivery.id,'claim').ok);
assert.deepEqual(clone(shared.g.s),clone(other.g.s));
const noWriter=boot({}, {now:epoch},{locks:{request(){return new Promise(()=>{})}}}).g;
assert.equal(noWriter.contract(singleDelivery.id,'accept').ok,false);

// Open the shipped quest screen one report before each rank-up, then use the
// same buttons as the player. Each merchant advances independently.
for(const trader of catalogue.traders){
  const commissions=sorted.filter(q=>q.trader===trader.id);
  for(const tier of [1,2,3]){
    const unlocked=commissions.filter(q=>q.tier<=tier);
    const last=unlocked.find(q=>q.tier===tier&&q.goals.every(g=>g.type!=='searches'));
    const next=commissions.filter(q=>q.tier===tier+1);
    const data=clone(seed);
    data.contracts=clone(base.g.s.contracts);
    data.contracts[trader.id].done=unlocked.filter(q=>q!==last).map(q=>q.id);
    data.contracts[trader.id].active={id:last.id,locations:[],progress:last.goals.map(g=>g.type==='delivery'?0:g.target)};
    const board=boot({[v12]:data}, {now:epoch},{},'#quests');
    board.click({contract:'trader',id:trader.id});
    const hidden=commissions.filter(q=>q.tier>tier);
    const shelfBefore=board.g.listed(trader.id,'buy').length;
    assert.equal(board.g.standing(trader.id).tier,tier);
    assert.equal(board.g.status(last.id).status,'ready',last.id);
    for(const q of hidden){
      assert.ok(!board.content().includes('data-id="'+q.id+'"'));
      assert.ok(!board.content().includes(q.title));
    }
    assert.equal((board.content().match(/data-contract="tier"/g)||[]).length,tier);
    assert.ok(board.content().includes('완료 '+(unlocked.length-1)+' / '+unlocked.length));
    for(const d of [{contract:'tier',tier:String(tier+1)},{contract:'open',id:next[0].id},{contract:'accept',id:next[0].id}]){
      const previous=board.content();
      board.click(d);
      assert.equal(board.content(),previous);
    }
    board.click({contract:'claim',id:last.id});
    assert.equal(board.g.standing(trader.id).tier,tier+1);
    const addedGoods=board.g.listed(trader.id,'buy').length-shelfBefore;
    assert.ok(addedGoods>0);
    assert.ok(board.content().includes('새 의뢰 '+next.length+'건과 상점 상품 '+addedGoods+'종이 열렸습니다.'));
    assert.ok(board.content().includes('data-tier="'+(tier+1)+'" aria-pressed="true"'));
    for(const q of next)assert.ok(board.content().includes('data-id="'+q.id+'"'));
    board.click({contract:'tier',tier:String(tier)});
    assert.ok(board.content().includes('data-id="'+last.id+'"'));
    board.click({contract:'trader',id:trader.id==='supply'?'medic':'supply'});
    assert.equal((board.content().match(/data-contract="tier"/g)||[]).length,1);
    assert.ok(!board.content().includes(next[0].title));
  }
}
(async()=>{
  const origin=boot({[v12]:activeBackup});
  const backup=await origin.exportData();
  const copy=boot();
  await copy.g.importFile(new Blob([JSON.stringify(backup)]));
  assert.deepEqual(clone(copy.g.s.contracts),clone(origin.g.s.contracts));
  assert.equal(copy.g.status(singleDelivery.id).status,'ready');
  assert.ok(copy.g.contract(singleDelivery.id,'claim').ok);
  const legacy=clone(backup);delete legacy.session.contracts;
  await copy.g.importFile(new Blob([JSON.stringify(legacy)]));
  assert.equal(copy.g.standing(singleDelivery.trader).points,0);
  assert.equal(copy.g.status(singleDelivery.id).status,'available');
  const topRank=boot(new Map(campaign.storage),{now:epoch},{},'#quests');
  assert.ok(topRank.content().includes('data-tier="4" aria-pressed="true"'));
  await topRank.g.importFile(new Blob([JSON.stringify(legacy)]));
  assert.equal((topRank.content().match(/data-contract="tier"/g)||[]).length,1);
  assert.ok(topRank.content().includes('data-tier="1" aria-pressed="true"'));
  assert.ok(!topRank.content().includes('supply-bus-rations'));
  console.log('PASS: 64 quests, hidden future tiers and stale inputs, 12 rank-ups revealing quests + merchandise, lower-rank import, independent standings, XP/CR, hand-ins, raid paths, restore/validation, rollback and stale-session double claims.');
})().catch(err=>{console.error(err);process.exitCode=1});
