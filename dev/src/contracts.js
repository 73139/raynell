// Reputation can always be reconstructed from the trader's paid, one-time contracts.
const CONTRACT_TIERS = [0, 60, 135, 235];
const CONTRACT_BY_ID = new Map(TRADER_CONTRACTS.map(quest => [quest.id, quest]));
let traderContracts = {};

function standingFromDone(done) {
  const points = done.reduce((sum, id) => sum + CONTRACT_BY_ID.get(id).rep, 0);
  const tier = CONTRACT_TIERS.filter(threshold => points >= threshold).length;
  return {points, tier, threshold: CONTRACT_TIERS[tier - 1], next: CONTRACT_TIERS[tier] ?? null};
}

function traderStanding(traderId) {
  return standingFromDone(traderContracts[traderId]?.done || []);
}

function validTraderRecord(traderId, record) {
  if (!record || !Array.isArray(record.done) || new Set(record.done).size !== record.done.length) return false;
  let points = 0;
  for (const id of record.done) {
    const quest = CONTRACT_BY_ID.get(id);
    if (quest?.trader !== traderId || points < CONTRACT_TIERS[quest.tier - 1]) return false;
    points += quest.rep;
  }
  if (record.active === null) return true;
  const active = record.active, quest = CONTRACT_BY_ID.get(active?.id);
  const locations = active?.locations ?? [];
  if (quest?.trader !== traderId || !Array.isArray(locations) || new Set(locations).size !== locations.length) return false;
  if (!locations.every(key => typeof key === 'string' && /^[0-2]-(0|[1-9]\d*)$/.test(key) &&
      quest.goals.some(goal => contractBoxMatches(goal, key)))) return false;
  if (!validDockContractProof(quest, active)) return false;
  return !record.done.includes(quest.id) &&
    points >= CONTRACT_TIERS[quest.tier - 1] && Array.isArray(active.progress) &&
    active.progress.length === quest.goals.length && active.progress.every((value, i) =>
      Number.isSafeInteger(value) && value >= 0 && value <= quest.goals[i].target &&
      (quest.goals[i].type !== 'delivery' || value === 0) &&
      (quest.goals[i].type !== 'searches' || value === Math.min(quest.goals[i].target,
        locations.filter(key => contractBoxMatches(quest.goals[i], key)).length)));
}

// The receipt follows the equipment serial, not a reusable container tile identifier.
function validDockContractProof(quest, active) {
  const i=quest.goals.findIndex(g=>g.type==='dock-cycle');
  const proof=active.dockProof;
  if(i<0)return proof===undefined;
  const n=active.progress?.[i];
  if(n===0)return proof===undefined;
  if((n!==1&&n!==2)||!proof||Array.isArray(proof)||!DOCK_CACHE_ITEMS.includes(proof.g)||
    typeof proof.uid!=='string'||!/^[a-z0-9_-]{1,140}$/i.test(proof.uid)||
    !Number.isSafeInteger(proof.raidId)||proof.raidId<=0||
    Object.keys(proof).some(k=>!['raidId','g','uid','returnedRaidId'].includes(k)))return false;
  return n===1?proof.returnedRaidId===undefined:
    Number.isSafeInteger(proof.returnedRaidId)&&proof.returnedRaidId>0&&proof.returnedRaidId!==proof.raidId;
}
function validContractsBackup(raw, summary) {
  if (raw === undefined) return true; // Compatible with pre-trader saves.
  return raw && typeof raw === 'object' && !Array.isArray(raw) &&
    Object.keys(raw).length === MARKET_TRADERS.length &&
    MARKET_TRADERS.every(trader => {
      const record=raw[trader.id];
      if(!validTraderRecord(trader.id,record))return false;
      const proof=record.active?.dockProof;
      if(!proof||proof.returnedRaidId!==undefined)return true;
      return summary?.raidId===proof.raidId&&summary.dockCacheOutcome==='booked'&&
        Array.isArray(summary.gearReport)&&summary.gearReport.some(row=>row.disposition==='stored'&&row.uid===proof.uid&&row.g===proof.g);
    });
}

function loadTraderContracts(raw) {
  traderContracts = Object.fromEntries(MARKET_TRADERS.map(({id}) => [
    id, validTraderRecord(id, raw?.[id]) ? raw[id] : {done: [], active: null}
  ]));
}

function contractGoalLabel(goal) {
  let location = '';
  if (Number.isInteger(goal.zone)) {
    location = FIELD_ZONES[goal.zone].name;
    if (Number.isInteger(goal.landmark)) location += ' · ' + LANDMARKS[goal.zone][goal.landmark].name;
  }
  switch (goal.type) {
    case 'delivery': return GOODS[goal.item][0] + ' 전달';
    case 'returns': return '생환 횟수 (조기 탈출 포함)';
    case 'normal': return '정상 탈출 횟수';
    case 'searches': return (location ? location + '에서 ' : '') + (goal.target > 1 ? '서로 다른 상자를' : '상자를') + ' 끝까지 수색하고 생환';
    case 'visits': return location + ' 방문 후 생환';
    case 'victories': return '경비 기체를 무력화하고 생환';
    case 'regions': return '한 레이드에서 여러 권역을 방문하고 생환';
    case 'dock-cycle': return '도크 보관·리프트 귀환 → 다음 출격 동일 장비 회수·생환';
  }
}

function contractStatus(id) {
  const quest = CONTRACT_BY_ID.get(id);
  if (!quest) return {status: 'locked', goals: [], reason: '등록되지 않은 퀘스트입니다.'};
  const record = traderContracts[quest.trader], done = record.done.includes(id);
  const active = record.active?.id === id ? record.active : null;
  const goals = quest.goals.map((goal, i) => ({
    target: goal.target,
    value: done ? goal.target : goal.type === 'delivery' ? Math.min(contractDeliveryCount(goal.item), goal.target) :
      (active?.progress[i] || 0)
  }));
  if (done) return {status: 'claimed', goals, reason: '보상을 이미 받았습니다.'};
  if (quest.tier > traderStanding(quest.trader).tier) return {status: 'locked', goals, reason: '우호도 '+quest.tier+'단계에 열립니다.'};
  if (active) {
    const ready = goals.every(g => g.value >= g.target);
    return {status: ready ? 'ready' : 'active', goals, reason: ready ? '' : '목표를 모두 달성해야 보상을 받을 수 있습니다.'};
  }
  if (record.active) return {status: 'busy', goals, reason: '이 상인의 다른 퀘스트가 진행 중입니다.'};
  return {status: 'available', goals, reason: ''};
}

function contractBoxMatches(goal, key) {
  if (goal.type !== 'searches') return false;
  const [zone, box] = key.split('-').map(Number);
  if (!FIELD_ZONES[zone]?.boxes[box] || (goal.zone !== undefined && goal.zone !== zone)) return false;
  return goal.landmark === undefined || LANDMARKS[zone][goal.landmark].boxes.includes(box);
}

function contractRaidAmount(goal, rating, newLocations) {
  switch (goal.type) {
    case 'normal': return Number(rating === 'success');
    case 'returns': return 1;
    case 'visits': return Number(field.visited.includes(goal.zone));
    case 'regions': return new Set(field.visited).size;
    case 'victories': return field.victories || 0;
    case 'searches': return newLocations.filter(key => contractBoxMatches(goal, key)).length;
    default: return 0;
  }
}

// Called in the same settlement as the returned gear and before the raid is closed.
// All field objectives use completed, survived raids. Each raid is settled once.
function settleDockContract(active,index,rating,exit) {
  const previous=active.progress[index];
  if(previous===2)return;
  const survived=rating==='success'||rating==='quick';
  const proof=active.dockProof;
  if(previous===1){
    // Only the next outing can close a booking. A different item/model or a lost
    // original cannot satisfy this receipt, even when the player survives.
    if(survived&&proof&&lastSummary?.raidId===proof.raidId&&lastSummary.dockCacheOutcome==='booked'&&
       raid.startedAt!==proof.raidId&&field.bag.some(u=>u.g===proof.g&&u.gear?.uid===proof.uid)){
      active.progress[index]=2;
      active.dockProof={...proof,returnedRaidId:raid.startedAt};
      return;
    }
    active.progress[index]=0;
    delete active.dockProof;
  }
  if(survived&&exit?.rule==='cargo'&&dockCache?.stage==='pending'&&dockCache.depositRaidId===raid.startedAt){
    const gear=dockCache.unit.gear;
    active.progress[index]=1;
    active.dockProof={raidId:raid.startedAt,g:gear.g,uid:gear.uid};
  }
}
function settleTraderContracts(rating,exit) {
  const updates = [];
  const survived=rating==='success'||rating==='quick';
  for (const {active} of Object.values(traderContracts)) {
    if (!active) continue;
    const quest = CONTRACT_BY_ID.get(active.id);
    if(!survived){
      quest.goals.forEach((goal,i)=>{if(goal.type==='dock-cycle')settleDockContract(active,i,rating,exit);});
      continue;
    }
    const knownLocations = new Set(active.locations);
    const newLocations = Object.keys(field.boxes).filter(key => field.boxes[key].complete && !knownLocations.has(key) &&
      quest.goals.some(goal => contractBoxMatches(goal, key)));
    if (newLocations.length) active.locations = [...knownLocations, ...newLocations];
    const changes = [];
    quest.goals.forEach((goal, i) => {
      if (goal.type === 'delivery') return;
      if(goal.type==='dock-cycle'){
        const previous=active.progress[i];
        settleDockContract(active,i,rating,exit);
        if(active.progress[i]>previous)changes.push({i,added:active.progress[i]-previous});
        return;
      }
      const amount = contractRaidAmount(goal, rating, newLocations);
      const total = goal.type === 'regions' ? Math.max(active.progress[i], amount) : active.progress[i] + amount;
      const previous = active.progress[i];
      active.progress[i] = Math.min(goal.target, total);
      if (active.progress[i] > previous) changes.push({i, added:active.progress[i] - previous});
    });
    if (changes.length) updates.push({id:quest.id, changes});
  }
  return updates;
}

function contractResultPanel(updates) {
  if (!Array.isArray(updates) || !updates.length) return '';
  const rows = [];
  for (const update of updates) {
    const quest = CONTRACT_BY_ID.get(update?.id);
    if (!quest || quest.tier > traderStanding(quest.trader).tier || !Array.isArray(update.changes)) continue;
    const gains = update.changes.filter(change => Number.isInteger(change?.i) && quest.goals[change.i] &&
      Number.isSafeInteger(change.added) && change.added > 0 && change.added <= quest.goals[change.i].target);
    if (!gains.length) continue;
    rows.push('<p><strong>'+esc(findMarketTrader(quest.trader).name)+' · '+esc(quest.title)+'</strong><br>'+
      gains.map(change => esc(contractGoalLabel(quest.goals[change.i]))+' +'+change.added).join(' · ')+'</p>');
  }
  if (!rows.length) return '';
  return '<section class="field-section"><h3>상인 퀘스트 진척</h3>'+rows.join('')+
    '<button data-page="traderQuests">퀘스트 확인</button></section>';
}

function contractAction(id, action, pinIfEmpty = false) {
  const fail = message => ({ok: false, message});
  const quest = CONTRACT_BY_ID.get(id);
  if (!quest) return fail('등록되지 않은 퀘스트입니다.');
  if (!writer) return fail('플레이 중인 탭에서 진행하세요.');
  reconcile();
  if (raid) return fail('벙커에 복귀한 뒤 진행할 수 있습니다.');
  const info = contractStatus(id), record = traderContracts[quest.trader];
  const before = {active: record.active, done: record.done, wallet, xp: career.xp, pin: objectivePin};
  const repBefore = traderStanding(quest.trader);
  let message;

  if (action === 'accept' && info.status === 'available') {
    record.active = {id, progress: quest.goals.map(() => 0)};
    // The guided accept offers an empty pin slot and commits both choices in this revision.
    if (pinIfEmpty && !normalizeObjectivePin(objectivePin)) objectivePin = {kind:'contract', id};
    message = '퀘스트를 수락했습니다.';
  } else if (action === 'cancel' && record.active?.id === id) {
    record.active = null;
    message = '퀘스트를 취소했습니다. 다시 수락할 수 있습니다.';
  } else if (action === 'claim' && info.status === 'ready') {
    if (!cashCanCredit(quest.cr) || !Number.isSafeInteger(career.xp + quest.xp)) {
      return fail('보상 수령 후 보유 한도를 초과합니다.');
    }
    const materials = {};
    for (const goal of quest.goals) {
      if (goal.type === 'delivery') materials[goal.item] = (materials[goal.item] || 0) + goal.target;
    }
    if (Object.keys(materials).length) {
      before.inventory = npcInventorySnapshot();
      if (!consumeNPCDelivery(materials)) {
        restoreNPCInventory(before.inventory);
        return fail('상인에게 건넬 물품이 부족합니다.');
      }
    }
    record.done = [...record.done, id];
    record.active = null;
    wallet += quest.cr;
    career.xp += quest.xp;
    const repAfter = traderStanding(quest.trader);
    message = money(quest.cr) + ' · +' + quest.xp + ' XP · 우호도 +' + quest.rep;
    if (repAfter.tier > repBefore.tier) message += ' · 우호도 '+repAfter.tier+'단계로 승급했습니다.';
  } else {
    return fail(info.reason || '현재 이 동작을 할 수 없습니다.');
  }

  if (!writeSession()) {
    // A newer tab's revision causes writeSession to load the winner. Leave it intact.
    if (record !== traderContracts[quest.trader]) return fail('다른 탭의 최신 기록을 불러왔습니다. 다시 확인하세요.');
    record.active = before.active;
    record.done = before.done;
    wallet = before.wallet;
    career.xp = before.xp;
    objectivePin = before.pin;
    if (before.inventory) restoreNPCInventory(before.inventory);
    return fail('퀘스트 변경 사항을 저장하지 못했습니다. 다시 시도하세요.');
  }
  clearNPCDeliverySelection();
  return {ok: true, message};
}

function matchesDeliveryUnit(unit,id) {
  return unit.g===id&&!unit.gear?.module;
}

// Worn gear, installed modules and nonempty cases stay with the player.
function npcDeliveryStock(id) {
  const loose = stashUnfittedCount(id);
  let bag = 0, cases = 0, fitted = stashRemovableCount(id) - loose;
  for (const unit of equipmentState.bag) {
    if (unit.g !== id) continue;
    if (unit.gear?.module) fitted++;
    else bag++;
  }
  for (const box of stashSlots) {
    for (const unit of box.contents || []) {
      if (unit.g !== id) continue;
      if (unit.gear?.module) fitted++;
      else cases++;
    }
  }
  return {loose, bag, cases, fitted, usable:loose + bag + cases};
}

function contractDeliveryCount(id) {
  return npcDeliveryStock(id).usable;
}

function npcInventorySnapshot() {
  return {counts:{...stash}, slots:stashSlots.slice(), bag:equipmentState.bag.slice(), overflow:gearOverflow.slice()};
}

function restoreNPCInventory(snapshot) {
  stash = snapshot.counts;
  stashSlots = snapshot.slots;gearOverflow=snapshot.overflow;
  equipmentState.bag = snapshot.bag;
}

function consumeNPCDelivery(materials,reserveLoose={}) {
  if (raid || !materials || typeof materials !== 'object' || Array.isArray(materials)) return false;
  const entries = Object.entries(materials);
  if (!entries.every(([id, n]) => Object.hasOwn(GOODS,id) && Number.isSafeInteger(n) && n > 0 && contractDeliveryCount(id) >= n)) return false;
  for (const [id, count] of entries) {
    let remaining = count;
    equipmentState.bag = equipmentState.bag.filter(unit => {
      if (!matchesDeliveryUnit(unit,id) || remaining === 0) return true;
      remaining--;
      return false;
    });
    const loose = Math.min(remaining,Math.max(0,stashUnfittedCount(id)-(reserveLoose[id] || 0)));
    if (loose && !takeStashGoods(id,loose,null,'delivery')) return false;
    remaining -= loose;
    for (let i=0; remaining && i<stashSlots.length; i++) {
      const box=stashSlots[i];
      if (!box.contents?.length) continue;
      const contents=box.contents.filter(unit=>{
        if (!matchesDeliveryUnit(unit,id) || !remaining) return true;
        remaining--;
        return false;
      });
      if (contents.length!==box.contents.length) stashSlots[i]={...box,contents};
    }
    // If cases and carried goods are exhausted, the player can still choose to donate loose construction stock.
    if (remaining && !takeStashGoods(id,remaining,null,'delivery')) return false;
  }
  return true;
}

function clearNPCDeliverySelection() {
  if (stashSelection && !selectedStashUnit()) stashSelection = null;
  if (gearPick && !equipmentState.bag.some(unit => unit.uid === gearPick.uid)) gearPick = null;
}
