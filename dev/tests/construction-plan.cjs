const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const facilities = JSON.parse(fs.readFileSync('Rustline_Database_v10.json', 'utf8')).hideout.facilities;
const levels = {}, builds = {};
const context = vm.createContext({
  FACILITIES: facilities, hideout: {levels, builds}, hideoutLevel: room => levels[room] || 0,
  facilityTimer: end => '<time>' + end + '</time>', wallet: 30000, esc: String, money: amount => amount.toLocaleString('ko-KR') + ' CR'
});
vm.runInContext(fs.readFileSync('src/bunker-ui.js', 'utf8'), context);

function neededLevels(target, tier) {
  const goal = {...levels, [target]: Math.max(tier, levels[target] || 0)};
  let changed;
  do {
    changed = false;
    for (const [room, end] of Object.entries(goal)) {
      for (let level = (levels[room] || 0) + 1; level <= end; level++) {
        for (const req of facilities[room].levels[level - 1].requires) {
          if ((goal[req.facility] || 0) >= req.level) continue;
          goal[req.facility] = req.level;
          changed = true;
        }
      }
    }
  } while (changed);
  return goal;
}
function checkTargets() {
  for (const [id, facility] of Object.entries(facilities)) {
    for (const step of facility.levels) {
      const target = step.level;
      const goal = neededLevels(id, target);
      const staged = {...levels};
      const steps = context.facilityConstructionSteps(id, target);
      for (const row of steps) {
        assert.equal(row.level, (staged[row.room] || 0) + 1);
        const data = facilities[row.room].levels[row.level - 1];
        assert.equal(row.cost, data.costCR);
        assert.equal(row.paid, builds[row.room]?.tier === row.level);
        for (const req of data.requires) assert.ok(staged[req.facility] >= req.level);
        staged[row.room] = row.level;
      }
      for (const name of Object.keys(facilities)) assert.equal(staged[name] || 0, goal[name] || 0);
      const before = JSON.stringify(context.hideout);
      const panel = context.bunkerConstructionPlan(id, target);
      assert.equal(panel.includes('data-build-plan'), steps.length >= 2);
      assert.equal(JSON.stringify(context.hideout), before);
    }
  }
}
checkTargets();
assert.equal(context.bunkerConstructionPlan('power', 1), '');
const clinic = () => context.bunkerConstructionPlan('med', 1);
assert.ok(clinic().includes('Lv.1</span> <span>20,000 CR'));
assert.ok(clinic().includes('60,000 CR') && clinic().includes('30,000 CR 부족'));
builds.power = {tier:1, end:12345678};
assert.ok(clinic().includes('40,000 CR') && clinic().includes('10,000 CR 부족') && clinic().includes('공사 중 · 지불 완료'));
checkTargets();
levels.power = 1;
delete builds.power;
assert.ok(!clinic().includes('data-plan-room="power"') && clinic().includes('40,000 CR'));
levels.water = 1;
assert.equal(clinic(), '');
levels.med = 1;
builds.water = {tier:2, end:12345678};
context.wallet = 300000;
checkTargets();
assert.equal(clinic(), '');
console.log('PASS: all 54 facility targets and shared prerequisites across three progress states, paid jobs, remaining cost, read-only planning and completed goals.');
