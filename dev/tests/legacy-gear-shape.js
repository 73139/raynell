// Compare every original field after validating the additive v25 host records.
const assert = require('node:assert/strict');
function legacyGearShape(value) {
  if (Array.isArray(value)) return Array.from(value, legacyGearShape);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  function check(host, id, module) {
    assert.equal(host.g, id);
    assert.ok(host.uid);
    assert.equal(host.durability, 100);
    assert.equal(host.ammo, ({rl10_carbine:30, rl12_sidearm:12})[id] || 0);
    assert.equal(host.module, module || null);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'gear') check(child, value.g, null);
    else if (key === 'instances') {
      for (const [slot, host] of Object.entries(child)) check(host, value.worn[slot], value.modules?.[slot]);
    } else result[key] = legacyGearShape(child);
  }
  return result;
}
module.exports = legacyGearShape;
