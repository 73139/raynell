const {assert,boot,clone,go,finish,stamp,v12,valid} = require('./game-fixture.cjs');
const DAY = 86400000;
const clock = {now:Date.parse('2026-11-26T05:00:00Z')}; // Thursday in Korea
const initial = boot({},clock);
const groups = ['daily','weekly'];
const byKind = (g,trader,period,type) => g.board(trader,period).entries.find(entry=>entry.quest.type===type);
const act = (g,q,action) => g.cycleWork(q.trader,q.cadence,g.board(q.trader,q.cadence).key,q.id,action);
function allOffers(g){
  return groups.flatMap(cadence=>g.traders.flatMap(t=>g.board(t.id,cadence).entries.map(e=>e.quest)));
}
const offers = allOffers(initial.g);
assert.equal(offers.length,16);
assert.equal(new Set(offers.map(q=>q.id)).size,16);
const seedSave = clone(initial.g.s);
for(const q of offers){
  for(const goal of q.goals){
    assert.ok(goal.type==='kill'||goal.type==='delivery');
    if(goal.type==='delivery') seedSave.stash[goal.item]=(seedSave.stash[goal.item]||0)+goal.target;
  }
}
const run = boot({[v12]:seedSave},clock),g=run.g;
// Multiple traders, both cadences, and both types can be accepted at the same time.
for(const q of offers){
  assert.ok(act(g,q,'accept').ok);
  assert.ok(!act(g,q,'accept').ok);
  assert.ok(!g.cycleWork(q.trader==='supply'?'medic':'supply',q.cadence,g.board(q.trader,q.cadence).key,q.id,'claim').ok);
}
valid(g);
const sample=offers.find(q=>q.cadence==='weekly'&&q.type==='delivery');
const pending=clone(g.s);
const baseFunds=g.s.wallet,baseXP=g.s.career.xp;
const killQuests=offers.filter(q=>q.type==='kill');
function defeat(b,zone){
  b.g.s.raid.zone=zone;
  b.g.s.field.contact={zone,hp:1};
  go(b,'engage');finish(b);
  assert.equal(b.g.s.field.contact,null);
}
// This many targets across three regions exceeds one starter magazine. Use the
// existing unarmed action after returning the starter carbine to bunker stock.
g.gear({gear:'unwear',slot:'primary'});
assert.equal(g.s.equipment.worn.primary,undefined);
g.start();
const maxTarget=Math.max(...killQuests.flatMap(q=>q.goals.map(goal=>goal.target)));
for(const zone of [0,1,2]){
  for(let i=0;i<maxTarget;i++)defeat(run,zone);
}
for(const q of killQuests){
  assert.equal(byKind(g,q.trader,q.cadence,'kill').status,'ready');
  assert.ok(!act(g,q,'claim').ok,'must report at bunker');
}
go(run,'abandon');g.ack();
assert.equal(g.s.lastSummary.result,'abandoned');
let totalCR=0,totalXP=0;
for(const q of offers){
  const stockBefore={...g.s.stash};
  const result=act(g,q,'claim');
  assert.ok(result.ok,q.id);
  const receipt = result.receipt;
  assert.equal(receipt.loot.length,q.cadence==='daily'?1:2);
  assert.equal(receipt.cr,q.cr);assert.equal(receipt.xp,q.xp);
  const expected={...stockBefore};
  for(const goal of q.goals)if(goal.type==='delivery')expected[goal.item]-=goal.target;
  for(const row of receipt.loot){
    assert.ok(Object.hasOwn(g.goods,row.id));
    assert.equal(row.qty,1);
    expected[row.id]=(expected[row.id]||0)+row.qty;
  }
  for(const id of Object.keys(expected))assert.equal(g.stock(id),expected[id],q.id+' '+id);
  assert.equal(byKind(g,q.trader,q.cadence,q.type).status,'claimed');
  assert.ok(!act(g,q,'claim').ok);
  assert.equal(g.standing(q.trader).points,0);
  totalCR+=q.cr;totalXP+=q.xp;
}
assert.equal(g.s.wallet,baseFunds+totalCR);
assert.equal(g.s.career.xp,baseXP+totalXP);
valid(g);
const again=boot(new Map(run.storage),clock);
assert.deepEqual(clone(again.g.s.periodic),clone(g.s.periodic));

// Retrying from a backup created before receipt, a quota failure, or a competing
// writer cannot change the roll, lose a required item, or trade a second time.
const expected=clone(byKind(g,sample.trader,sample.cadence,'delivery').receipt);
const f=boot({[v12]:pending},clock),baseline=clone(f.g.s);
const originalSet=f.storage.set.bind(f.storage);
f.storage.set=()=>{throw new Error('quota')};
assert.ok(!act(f.g,sample,'claim').ok);
assert.deepEqual(clone(f.g.s),baseline);
f.storage.set=originalSet;
assert.deepEqual(clone(act(f.g,sample,'claim').receipt),expected);
const backup=clone(f.g.s);
const broken=clone(backup);
broken.periodic.weekly.records[sample.id].receipt.loot[0].id='not-in-game';
assert.equal(f.g.check({format:'rustline-tc01',session:broken}),false);
const rival=boot({[v12]:pending},clock);
const winner=boot(rival.storage,clock);
assert.ok(act(winner.g,sample,'claim').ok);
assert.ok(!act(rival.g,sample,'claim').ok);
assert.deepEqual(clone(rival.g.s),clone(winner.g.s));
const legacy=clone(seedSave);
delete legacy.periodic;
const migrated=boot({[v12]:legacy},clock);
assert.ok(migrated.g.check({format:'rustline-tc01',session:legacy}));
assert.equal(migrated.g.s.wallet,legacy.wallet);
assert.equal(migrated.g.board('supply','daily').entries.length,2);

// A carried, successfully returned pack can hand over goods without a stash detour.
const bagQuest=offers.find(q=>q.type==='delivery'&&q.cadence==='daily'&&q.goals.length===1&&q.goals[0].target<=3);
assert.ok(bagQuest);
const bagGoal=bagQuest.goals[0];
const pack=boot({[v12]:seedSave},clock);
const bag=pack.g;
for(let i=0;i<bagGoal.target;i++)bag.gear({gear:'pack',id:bagGoal.item});
assert.ok(bag.s.equipment.bag.filter(x=>x.g===bagGoal.item).length>=bagGoal.target);
const bagBefore=bag.s.equipment.bag.length;
assert.ok(act(bag,bagQuest,'accept').ok);
let carriedStock=bag.stock(bagGoal.item);
const hand=act(bag,bagQuest,'claim');
assert.ok(hand.ok);
assert.equal(bag.s.equipment.bag.length,bagBefore-bagGoal.target);
assert.equal(bag.stock(bagGoal.item),carriedStock+hand.receipt.loot.filter(row=>row.id===bagGoal.item).length);

// Only the assigned zone and an actual defeat count. Escaping is never a kill.
const combat=boot({[v12]:seedSave},{now:Date.parse('2026-11-26T05:00:00Z')});
const zoned=allOffers(combat.g).find(q=>q.type==='kill'&&q.goals[0].zone!==undefined);
const zGoal=zoned.goals[0],zBoard=()=>byKind(combat.g,zoned.trader,zoned.cadence,'kill');
assert.ok(act(combat.g,zoned,'accept').ok);
combat.g.start();
defeat(combat,(zGoal.zone+1)%3);
assert.equal(zBoard().values[0],0);
combat.setRandom(0.1);combat.g.s.field.contact={zone:zGoal.zone,hp:1};go(combat,'evade');finish(combat);
assert.equal(zBoard().values[0],0);
defeat(combat,zGoal.zone);
assert.equal(zBoard().values[0],1);
const restoredCombat=boot(new Map(combat.storage),combat.clock);
assert.equal(byKind(restoredCombat.g,zoned.trader,zoned.cadence,'kill').values[0],1);
restoredCombat.g.tick();assert.equal(byKind(restoredCombat.g,zoned.trader,zoned.cadence,'kill').values[0],1);

// A fight started on Thursday and completed on Friday cannot credit Thursday.
// The running weekly offer can still receive the event even when the app wakes later.
const midnight=Date.parse('2026-11-26T15:00:00Z');
const late=boot({[v12]:seedSave},{now:midnight-2000});
const wk=byKind(late.g,'supply','weekly','kill').quest;
const day=byKind(late.g,'supply','daily','kill').quest;
assert.ok(act(late.g,wk,'accept').ok);assert.ok(act(late.g,day,'accept').ok);
late.g.start();
late.g.s.field.contact={zone:wk.goals[0].zone??0,hp:1};
go(late,'engage');
assert.ok(late.g.s.field.action.end>=midnight);
stamp(late,midnight+5000);
assert.equal(byKind(late.g,'supply','weekly','kill').values[0],1);
assert.equal(byKind(late.g,'supply','daily','kill').status,'available');
assert.ok(!late.g.s.periodic.daily.records[day.id]);
valid(late.g);

// Thursday midnight in Korea rotates only the daily board; Sunday→Monday rotates both.
const thuKstEnd=Date.parse('2026-11-26T15:00:00Z');
const clocks=boot({[v12]:pending},{now:thuKstEnd-1});
const daily=clocks.g.board('supply','daily'),weekly=clocks.g.board('supply','weekly');
assert.equal(daily.endsAt,thuKstEnd);
assert.equal(weekly.endsAt,Date.parse('2026-11-29T15:00:00Z'));
stamp(clocks,thuKstEnd);
const tomorrow=clocks.g.board('supply','daily');
assert.equal(tomorrow.key,daily.key+1);
assert.ok(tomorrow.entries.every(e=>e.status==='available'));
assert.ok(!clocks.g.cycleWork('supply','daily',daily.key,daily.entries[0].quest.id,'accept').ok);
assert.equal(clocks.g.board('supply','weekly').key,weekly.key);
assert.ok(clocks.g.board('supply','weekly').entries.every(e=>e.status!=='available'));
stamp(clocks,weekly.endsAt);
assert.equal(clocks.g.board('supply','weekly').key,weekly.key+7);
assert.ok(clocks.g.board('supply','weekly').entries.every(e=>e.status==='available'));
stamp(clocks,thuKstEnd-1);
assert.ok(clocks.g.board('supply','daily').key>daily.key);
assert.ok(!clocks.g.cycleWork('supply','daily',daily.key,daily.entries[0].quest.id,'accept').ok);
valid(clocks.g);
(async () => {
 const exporting=boot({[v12]:pending},clock);
 const exported=await exporting.exportData();
 const imported=boot({},clock);
 await imported.g.importFile(new Blob([JSON.stringify(exported)]));
 assert.deepEqual(clone(act(imported.g,sample,'claim').receipt),expected);
 valid(imported.g);
})().catch(error=>{console.error(error);process.exitCode=1});
console.log('PASS 16 independent offers, direct kill resolution through failed raid, NPC hand-in, stable random rewards including weekly double drop, reload, stale/duplicate claims and storage rollback, Korean day/Monday rotation and rollback clock.');
