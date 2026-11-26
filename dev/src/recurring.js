// A period key is the civil date in Korea, counted in days from 1970-01-01.
const RECURRING_DAY = 86400000;
const RECURRING_KST = 9 * 3600000;
const RECURRING_CADENCES = ['daily', 'weekly'];
let periodicContracts;

function recurringDayKey(now) {
  return Math.floor((now + RECURRING_KST) / RECURRING_DAY);
}
function recurringWeekKey(day) {
  // 1970-01-05 (day 4) was a Monday.
  return 4 + 7 * Math.floor((day - 4) / 7);
}
function recurringPeriod(cadence, now = Date.now()) {
  // Keep a previously crossed boundary closed if the local clock moves backwards.
  const day = Math.max(recurringDayKey(now), periodicContracts?.daily.key ?? -Infinity);
  const weekly = cadence === 'weekly';
  const key = weekly ? recurringWeekKey(day) : day;
  return {key, endsAt: (key + (weekly ? 7 : 1)) * RECURRING_DAY - RECURRING_KST};
}
function newPeriodSeed() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function emptyPeriod(key) {
  return {key, records: {}};
}
function validPeriodRecord(quest, record, key) {
  if (!record || !Number.isSafeInteger(record.acceptedAt) ||
      recurringDayKey(record.acceptedAt) < key ||
      recurringDayKey(record.acceptedAt) >= key + (quest.cadence === 'weekly' ? 7 : 1) ||
      !Array.isArray(record.progress) || record.progress.length !== quest.goals.length ||
      !record.progress.every((n,i) => Number.isSafeInteger(n) && n >= 0 && n <= quest.goals[i].target &&
        (quest.goals[i].type !== 'delivery' || n === 0))) return false;
  if (!record.receipt) return record.receipt === null;
  const {cr,xp,loot} = record.receipt;
  return cr === quest.cr && xp === quest.xp && Array.isArray(loot) &&
    loot.length === (quest.cadence === 'daily' ? 1 : 2) &&
    loot.every(row => row && Object.hasOwn(GOODS,row.id) &&
      Object.hasOwn(REC_LOOT_LABELS,row.tier) && row.qty === 1) &&
    quest.goals.every((goal,i) => goal.type === 'delivery' || record.progress[i] === goal.target);
}
function validRecurringSave(raw) {
  if (raw === undefined) return true;
  if (!raw || typeof raw.seed !== 'string' || !/^[0-9a-f]{32}$/.test(raw.seed) || !Number.isSafeInteger(raw.daily?.key) ||
      raw.daily.key < 0 || raw.daily.key > 100000000 || raw.weekly?.key !== recurringWeekKey(raw.daily.key)) return false;
  for (const cadence of RECURRING_CADENCES) {
    const {key,records} = raw[cadence];
    if (!records || typeof records !== 'object' || Array.isArray(records)) return false;
    const recordIds = Object.keys(records);
    if (recordIds.length > MARKET_TRADERS.length * 2) return false;
    if (!recordIds.length) continue;
    const offers = new Map(MARKET_TRADERS.flatMap(t => recurringOffersFor(cadence, key, t.id)).map(q => [q.id,q]));
    if (!recordIds.every(id => offers.has(id) && validPeriodRecord(offers.get(id),records[id],key))) return false;
  }
  return true;
}
function loadRecurring(raw) {
  const day = recurringDayKey(Date.now());
  periodicContracts = raw && validRecurringSave(raw) ? raw : {
    seed:newPeriodSeed(), daily:emptyPeriod(day), weekly:emptyPeriod(recurringWeekKey(day))
  };
}
function advanceRecurring(now = Date.now()) {
  if (!periodicContracts) return false;
  let changed = false;
  for (const cadence of RECURRING_CADENCES) {
    const {key} = recurringPeriod(cadence,now);
    if (key > periodicContracts[cadence].key) {
      periodicContracts[cadence] = emptyPeriod(key);
      changed = true;
    }
  }
  return changed;
}
function recurringBoard(traderId, cadence, now = Date.now()) {
  const {key,endsAt} = recurringPeriod(cadence,now);
  if (!RECURRING_CADENCES.includes(cadence) || !findMarketTrader(traderId)) return {key,endsAt,entries:[]};
  const period = periodicContracts[cadence];
  const entries = recurringOffersFor(cadence,key,traderId).map(quest => {
    const record = period.key === key ? period.records[quest.id] : null;
    const receipt = record?.receipt || null;
    const values = quest.goals.map((goal,i) => {
      if (receipt) return goal.target;
      if (goal.type === 'delivery') return Math.min(contractDeliveryCount(goal.item),goal.target);
      return record?.progress[i] || 0;
    });
    const ready = values.every((n,i) => n >= quest.goals[i].target);
    const status = receipt ? 'claimed' : !record ? 'available' : ready ? 'ready' : 'active';
    return {quest,values,status,receipt};
  });
  return {key,endsAt,entries};
}
// Combat resolution and this increment share the same saved action. A reload can only
// replay the unresolved save or read the resolved kill and its progress together.
function recordRecurringKill(zone, at) {
  if (!periodicContracts || !writer) return;
  const eventDay = recurringDayKey(at);
  for (const cadence of RECURRING_CADENCES) {
    const period = periodicContracts[cadence];
    if (period.key !== (cadence === 'daily' ? eventDay : recurringWeekKey(eventDay))) continue;
    for (const trader of MARKET_TRADERS) {
      const quests = recurringOffersFor(cadence,period.key,trader.id);
      for (const quest of quests) {
        const record = period.records[quest.id];
        if (quest.type !== 'kill' || !record || record.receipt || record.acceptedAt > at) continue;
        quest.goals.forEach((goal,i) => {
          if ((goal.zone === undefined || goal.zone === zone) && record.progress[i] < goal.target) {
            record.progress[i]++;
            logField(trader.name+' · '+quest.title+' ('+record.progress[i]+'/'+goal.target+')');
          }
        });
      }
    }
  }
}
function recurringAction(traderId, cadence, expectedKey, id, action) {
  const fail = message => ({ok:false,message});
  if (!writer) return fail('플레이 중인 탭에서 진행하세요.');
  if (!RECURRING_CADENCES.includes(cadence) || !findMarketTrader(traderId)) return fail('등록되지 않은 의뢰입니다.');
  const now = Date.now();
  reconcile(now);
  if (raid) return fail('벙커로 복귀한 뒤 상인을 만나세요.');
  const board = recurringBoard(traderId,cadence,now);
  if (board.key !== expectedKey || recurringDayKey(now) < periodicContracts.daily.key) {
    return fail('의뢰 기간이 바뀌었거나 기기 시간이 변경되었습니다. 현재 목록과 시간을 확인하세요.');
  }
  const entry = board.entries.find(e => e.quest.id === id);
  if (!entry) return fail('현재 이 상인의 의뢰가 아닙니다.');
  const {quest,status} = entry;
  const period = periodicContracts[cadence];
  const initial = period.records[id];
  let receipt = null, inventory;
  const oldWallet = wallet, oldXP = career.xp;
  if (action === 'accept' && status === 'available') {
    period.records[id] = {acceptedAt:now, progress:quest.goals.map(() => 0), receipt:null};
  } else if (action === 'claim' && status === 'ready') {
    const seed = [periodicContracts.seed,cadence,board.key,traderId,id].join('/');
    receipt = {cr:quest.cr, xp:quest.xp, loot:recurringLootFor(cadence,traderId,seed)};
    if (!cashCanCredit(receipt.cr) || !Number.isSafeInteger(career.xp+receipt.xp)) {
      return fail('보유 한도 때문에 보상을 받을 수 없습니다.');
    }
    inventory = npcInventorySnapshot();
    const materials = {};
    for (const goal of quest.goals) {
      if (goal.type === 'delivery') materials[goal.item] = (materials[goal.item] || 0) + goal.target;
    }
    if (!consumeNPCDelivery(materials)) {
      restoreNPCInventory(inventory);
      return fail('상인에게 건넬 물품이 부족합니다.');
    }
    for (const item of receipt.loot) {
      if (!addStashGoods(item.id,item.qty)) {
        restoreNPCInventory(inventory);
        return fail('보상 물품을 보관할 수 없습니다. 보유 수량을 확인하세요.');
      }
    }
    wallet += receipt.cr;
    career.xp += receipt.xp;
    period.records[id] = {...initial,receipt};
  } else {
    return fail(status === 'claimed' ? '이미 보상을 받았습니다.' : '현재 이 동작을 할 수 없습니다.');
  }

  if (!writeSession()) {
    // writeSession may have installed a newer tab's save on conflict.
    if (periodicContracts[cadence] !== period) return fail('다른 탭의 최신 기록을 불러왔습니다. 다시 확인하세요.');
    if (initial) period.records[id] = initial;
    else delete period.records[id];
    if (inventory) restoreNPCInventory(inventory);
    wallet = oldWallet;
    career.xp = oldXP;
    return fail('의뢰를 저장하지 못했습니다. 다시 시도하세요.');
  }
  if (receipt) clearNPCDeliverySelection();
  return {ok:true,message:receipt ? findMarketTrader(traderId).name+'에게 보상을 받았습니다.' : '의뢰를 수락했습니다.',receipt};
}
