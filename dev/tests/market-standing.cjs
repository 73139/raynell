// Drive the real market and restore checkpoints at each previously saved reputation tier.
const {setTestCash,assert, boot, clone, valid, v12} = require('./game-fixture.cjs');
const base = boot().g;
const traders = base.traders;
const allStock = traders.flatMap(t => Array.from(t.stock));
assert.equal(allStock.length,108);
assert.equal(new Set(allStock).size,108,'each item has a unique retail counter');
const tiers = {supply:[7,13,20,27], medic:[7,13,20,26], quarter:[7,15,22,30], repair:[6,13,19,25]};
const legacy = clone(base.s);
legacy.version = 12;
setTestCash(legacy,5000000);
const valuables = Object.keys(base.goods).filter(id => ['귀중품','골동품'].includes(base.goods[id][5]));
const jackpots = ['scanner','gpu','secure','secret','keycard','relay'];

for (let tier = 1; tier <= 4; tier++) {
  const save = clone(legacy);
  for (const trader of traders) {
    save.contracts[trader.id].done = base.quests.filter(q => q.trader === trader.id && q.tier < tier).map(q => q.id);
  }
  const b = boot({[v12]:save}), g = b.g;
  for (const trader of traders) {
    const unlocked = Array.from(g.listed(trader.id, 'buy'));
    const expected = Array.from(trader.stockTiers.slice(0,tier).flat());
    assert.deepEqual(unlocked, expected);
    assert.equal(unlocked.length, tiers[trader.id][tier-1]);
    for (const id of expected) {
      assert.ok(g.quote(trader.id, 'buy', id).ok, trader.name+' '+id);
    }
    for (const id of [...trader.stockTiers.slice(tier).flat(), ...valuables, ...jackpots]) {
      assert.ok(!unlocked.includes(id));
      assert.equal(g.quote(trader.id,'buy',id).ok, false);
      assert.equal(g.trade(trader.id,'buy',id).ok, false);
    }
  }
  assert.equal(g.fee,save.wallet);
  assert.deepEqual(clone(g.s.stash),save.stash);
  valid(g);
}

// The sixth hand-in opens the next shelf immediately, only for this NPC.
const promotion = clone(legacy);
promotion.contracts.supply.done = base.quests.filter(q => q.trader === 'supply' && q.tier === 1 && q.id !== 'supply-spare-flask').map(q => q.id);
promotion.stash = {water:1,diamond:1};
promotion.stashSlots = [];
const b = boot({[v12]:promotion}), g = b.g;
assert.equal(g.standing('supply').points,50);
assert.ok(g.contract('supply-spare-flask','accept').ok);
assert.equal(g.trade('supply','buy','rs_case_food').ok,false);
assert.ok(g.contract('supply-spare-flask','claim').ok);
assert.equal(g.standing('supply').points,60);
assert.equal(g.listed('supply','buy').length,13);
assert.ok(g.trade('supply','buy','rs_case_food').ok);
assert.equal(g.stock('rs_case_food'),1);
for (const trader of traders.filter(t=>t.id!=='supply')) assert.equal(g.listed(trader.id,'buy').length,tiers[trader.id][0]);
assert.ok(g.listed('supply','sell').includes('diamond'));
assert.ok(g.trade('supply','sell','diamond').ok);

// A second, empty unit of the same case can be sold without touching the filled unit.
assert.ok(g.trade('supply','buy','food').ok);
const caseId = 'rs_case_food';
const caseUid = g.s.stashSlots.find(tile=>tile.g===caseId).uid;
b.click({page:'stash'});
b.click({stash:'select',id:caseId,uid:caseUid});
b.click({stash:'case-open',box:caseUid});
b.click({stash:'case-put',box:caseUid,id:'food'});
assert.ok(!g.listed('supply','sell').includes(caseId));
assert.equal(g.quote('supply','sell',caseId).max,0);
assert.equal(g.trade('supply','sell',caseId).ok,false);
assert.ok(g.trade('supply','buy',caseId).ok);
assert.ok(g.listed('supply','sell').includes(caseId));
assert.equal(g.quote('supply','sell',caseId).max,1);
assert.equal(g.trade('supply','sell',caseId,2).ok,false);
assert.ok(g.trade('supply','sell',caseId).ok);
const restored = boot(new Map(b.storage),b.clock).g;
assert.ok(restored.listed('supply','buy').includes('rs_case_food'));
assert.equal(restored.stock('rs_case_food'),1);
assert.equal(restored.s.stashSlots.find(t=>t.uid===caseUid).contents[0].g,'food');
assert.equal(restored.stock('diamond'),0);
valid(restored);
console.log('PASS 108 tiered offers, all 4 shelves for all 4 traders, hidden and transaction-blocked future goods, valuable/antique and jackpot exclusion, selling player valuables, old saves, promotion and case purchase isolated per trader, persisted receipt balance and inventory.');
