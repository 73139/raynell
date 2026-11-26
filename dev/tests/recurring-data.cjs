// Offline audit of offers, their rotating schedules and the reward table against shipped goods.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const goods = JSON.parse(fs.readFileSync(path.join(root, 'Rustline_Database_v10.json'), 'utf8')).items;
const data = fs.readFileSync(path.join(root, 'src/recurring-data.js'), 'utf8');
const market = fs.readFileSync(path.join(root, 'src/market.js'), 'utf8');
const script = data + '\n' + market + '\n;({offers:recurringOffersFor,roll:recurringLootFor,pools:RECURRING_POOL,weights:RECURRING_WEIGHTS,rewards:RECURRING_REWARDS,traders:MARKET_TRADERS})';
const {offers,roll,pools,weights,rewards,traders} = vm.runInNewContext(script);
const ids = new Set(), titles = new Set();
const allowedItems = new Set([...traders].flatMap(t => [...t.stock]));
const crBounds = {common:[0,5000],useful:[5000,60000],rare:[100000,280000],jackpot:[300000,1200000]};
const expectedWeights = {
  daily:{standard:[60,28,10,2],supply:[48,30,18,4]},
  weekly:{standard:[35,38,22,5],supply:[24,39,28,9]}
};
assert.deepEqual(JSON.parse(JSON.stringify(weights)),expectedWeights);
assert.equal(Object.keys(pools).length,16);
for (const trader of traders) {
  const tierItems = Object.values(rewards[trader.id]).flat();
  assert.equal(new Set(tierItems).size, tierItems.length);
  for (const [tier,list] of Object.entries(rewards[trader.id])) {
    assert.ok(list.length >= 3);
    for (const id of list) {
      const item = goods[id], [low,high] = crBounds[tier];
      assert.ok(item && item.valueCR >= low && item.valueCR <= high, trader.id + ' ' + tier + ' ' + id);
      if (tier === 'rare') assert.equal(item.rarity, '희귀');
      if (tier === 'jackpot') assert.equal(item.rarity, '극희귀');
    }
  }
  for (const cadence of ['daily','weekly']) {
    const probabilities = weights[cadence][trader.id === 'supply' ? 'supply' : 'standard'];
    assert.equal(probabilities.reduce((a,b)=>a+b,0),100);
    const shift = cadence === 'weekly' ? 7 : 1;
    const observed = new Set();
    for (let i = 0; i < 4; i++) {
      const key = 21004+i*shift;
      const board = offers(cadence,key,trader.id);
      assert.deepEqual(Array.from(board,q=>q.type),['kill','delivery']);
      assert.deepEqual(Array.from(board,q=>q.id),Array.from(offers(cadence,key,trader.id),q=>q.id));
      const next = offers(cadence,key+shift,trader.id);
      for (const [index,q] of board.entries()) {
        assert.notEqual(q.id,next[index].id);
        assert.equal(q.trader,trader.id);
        assert.equal(q.cadence,cadence);
        assert.ok(/^[a-z0-9-]+$/.test(q.id));
        assert.ok(!ids.has(q.id) && !titles.has(q.title));
        ids.add(q.id);titles.add(q.title);observed.add(q.id);
        assert.ok(q.brief.length>=16);
        assert.ok(Number.isSafeInteger(q.cr) && q.cr > 0);
        assert.ok(Number.isSafeInteger(q.xp) && q.xp >= (cadence === 'weekly' ? 100 : 20));
        assert.ok(q.goals.length > 0 && q.goals.length <= 2);
        const identities = new Set();
        for (const goal of q.goals) {
          assert.equal(goal.type,q.type);
          assert.ok(Number.isSafeInteger(goal.target)&&goal.target>0);
          if (q.type === 'delivery') {
            assert.ok(allowedItems.has(goal.item) && goods[goal.item],q.id+' '+goal.item);
            assert.ok(!identities.has(goal.item));identities.add(goal.item);
          } else {
            assert.ok(goal.zone === undefined || (Number.isInteger(goal.zone)&&goal.zone>=0&&goal.zone<3));
            assert.ok(!identities.has(goal.zone));identities.add(goal.zone);
            if (q.goals.length>1) assert.notEqual(goal.zone,undefined);
          }
        }
      }
    }
    assert.equal(observed.size,8);
    // Deterministic sample validates receipt shape, duplicate-slot independence and grade reachability.
    const grades = ['common','useful','rare','jackpot'];
    const counts = Array(4).fill(0), rolledItems = new Set();
    const draws = cadence === 'weekly' ? 2 : 1, seeds = 8000;
    let differentSlotGrades = false;
    for (let i = 0; i < seeds; i++) {
      const reward = roll(cadence,trader.id,'receipt-'+i);
      assert.equal(reward.length,draws);
      if (i < 12) assert.deepEqual(JSON.stringify(reward),JSON.stringify(roll(cadence,trader.id,'receipt-'+i)));
      if (reward.length===2 && reward[0].tier!==reward[1].tier) differentSlotGrades = true;
      for (const item of reward) {
        const index = grades.indexOf(item.tier);
        assert.ok(index >= 0 && rewards[trader.id][item.tier].includes(item.id));
        assert.equal(item.qty,1);
        counts[index]++;rolledItems.add(item.id);
      }
    }
    for (let i=0;i<grades.length;i++) {
      assert.ok(Math.abs(100*counts[i]/(seeds*draws)-probabilities[i])<2.1);
      for (const id of rewards[trader.id][grades[i]]) assert.ok(rolledItems.has(id));
    }
    if (cadence==='weekly') assert.ok(differentSlotGrades);
  }
}
assert.equal(ids.size,64);
assert.equal(titles.size,64);
assert.equal(offers('monthly',0,'supply').length,0);
assert.equal(roll('weekly','invalid','salt').length,0);
assert.equal(offers('daily',NaN,'medic').length,0);
console.log('PASS 64 unique rotating templates / 16 pools, direct-delivery goods and kill zones, exact weights, grade-value bands, fixed per-player outcomes and both weekly slots (96,000 checked item draws).');
