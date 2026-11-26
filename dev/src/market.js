// Each row joins this trader's purchasable stock when the corresponding tier is earned.
const MARKET_TRADERS = [
  {
    id: 'supply', name: '한미정', role: '전직 급식소 운영자', specialty: '식수 · 식량 · 생활용품',
    quote: '밥부터 챙겨요. 외곽 장터로 보낼 귀중품도 여기서 값 쳐줘요.',
    categories: ['식량', '음료', '생활', '귀중품', '골동품'],
    stockTiers: [
      ['water', 'food', 'biscuit', 'cloth', 'matches', 'salt', 'rl_16_14'],
      ['tea', 'juice', 'rl_09_10', 'rl_09_01', 'lighter', 'rs_case_food'],
      ['coffee', 'rl_09_18', 'rl_09_19', 'rl_09_21', 'rl_10_05', 'rl_15_06', 'rs_case_docs'],
      ['ration', 'rl_15_07', 'rl_15_08', 'rl_15_11', 'rl_15_12', 'rl_10_12', 'rs_case_items']
    ]
  },
  {
    id: 'medic', name: '윤서진', role: '응급의료소 간호사', specialty: '의약품 · 위생용품',
    quote: '붕대는 가방 안쪽보다 손 닿는 데 두세요. 의무실에서 쓸 물자도 받아요.',
    categories: ['의료'],
    stockTiers: [
      ['bandage', 'gauze', 'soap', 'rl_11_01', 'rl_14_07', 'rl_14_09', 'rl_16_19'],
      ['splint', 'rl_11_03', 'rl_11_04', 'saline', 'rl_11_09', 'rs_case_med'],
      ['medkit', 'pain', 'rl_11_10', 'rl_11_13', 'rl_11_22', 'rl_11_24', 'rs_case_injector'],
      ['suture', 'rl_11_26', 'rl_12_01', 'rl_12_02', 'rl_12_04', 'rl_12_12']
    ]
  },
  {
    id: 'quarter', name: '강태식', role: '보급창고 관리인', specialty: '현장 장비 · 의류',
    quote: '배낭 멜 자리부터 봅시다. 회수한 장비나 구역 출입증은 여기 두면 됩니다.',
    categories: ['군용', '개인 장비', '탄약', '열쇠', '정보'],
    stockTiers: [
      ['rl10_pack', 'rl10_vest', 'rl10_carbine', 'rl_14_12', 'patch', 'rl_14_11', 'rl_16_01'],
      ['rl12_sidearm', 'rl12_helmet', 'flash', 'rl_05_15', 'rl_13_07', 'rl_13_11', 'rs_case_pistol', 'rs_case_ammo'],
      ['rl_13_01', 'rl_13_16', 'rl12_respirator', 'rl_13_05', 'rl_13_12', 'rl_13_20', 'rs_case_weapon'],
      ['key', 'rl_13_15', 'rl_13_14', 'rl_13_06', 'battpack', 'optic', 'rs_case_weapon_large', 'rs_case_cards']
    ]
  },
  {
    id: 'repair', name: '임도현', role: '전파사 기사', specialty: '전자 부품 · 공구 · 벙커 자재',
    quote: '발전기 손볼 거면 전선이랑 볼트부터 챙겨요. 남은 부품도 가져오고요.',
    categories: ['전자', '공구', '재료', '연료'],
    stockTiers: [
      ['wire', 'bolt', 'tape', 'nut', 'fuel', 'driver'],
      ['fan', 'pliers', 'wrench', 'cable', 'battery', 'seal', 'rs_case_keys'],
      ['rs_case_junk', 'board', 'filter', 'lube', 'tool', 'rl_05_23'],
      ['radio', 'drill', 'rl_06_01', 'rl_04_03', 'rl_06_07', 'rl_18_10']
    ]
  }
].map(trader => ({...trader, stock: trader.stockTiers.flat()}));

function findMarketTrader(id) {
  return MARKET_TRADERS.find(trader => trader.id === id);
}

function marketIsValuable(itemId) {
  return ['귀중품', '골동품'].includes(GOODS[itemId]?.[5]);
}

function marketRetailItem(id) {
  return Object.hasOwn(GOODS, id) && !marketIsValuable(id) && !exchangeRestricted(id);
}

function marketTierGoods(traderId, tier) {
  const trader = findMarketTrader(traderId);
  if (!trader || !Number.isInteger(tier) || tier < 1 || tier > trader.stockTiers.length) return [];
  return trader.stockTiers[tier - 1].filter(marketRetailItem);
}

function marketOfferingTrader(itemId) {
  return MARKET_TRADERS.find(trader => trader.stock.includes(itemId));
}

function marketIsUnlocked(traderId, itemId) {
  return marketGoods(traderId, 'buy').includes(itemId);
}

function marketBuys(traderId, itemId) {
  const trader = findMarketTrader(traderId);
  return Boolean(trader && itemId !== 'cr_notes' && typeof itemId === 'string' && Object.hasOwn(GOODS, itemId) &&
    (trader.categories.includes(GOODS[itemId][5]) || trader.stock.includes(itemId)));
}

function marketGoods(traderId, mode) {
  const trader = findMarketTrader(traderId);
  if (!trader) return [];
  if (mode === 'buy') {
    const tier = traderStanding(traderId).tier;
    return trader.stockTiers.slice(0, tier).flat().filter(marketRetailItem);
  }
  if (mode !== 'sell') return [];
  return Object.keys(stash)
    .filter(id => stashUnfittedCount(id) > 0 && marketBuys(traderId, id))
    .sort((a, b) => GOODS[a][0].localeCompare(GOODS[b][0], 'ko'));
}

// max accounts for both sides of a trade, including safe integer limits after import.
function marketQuote(traderId, mode, itemId, qty = 1) {
  const trader = findMarketTrader(traderId);
  const quote = {ok: false, reason: '', unit: 0, total: 0, max: 0};
  if (!trader || typeof itemId !== 'string' || !Object.hasOwn(GOODS, itemId) ||
      !((mode === 'buy' && marketIsUnlocked(traderId, itemId)) ||
        (mode === 'sell' && marketBuys(traderId, itemId)))) {
    quote.reason = '이 상인이 취급하는 물품을 선택하세요.';
    return quote;
  }

  const buy = mode === 'buy';
  const count = stashCount(itemId);
  quote.unit = buy ? GOODS[itemId][6] : stashSalePrice(itemId);
  if (Number.isSafeInteger(qty) && qty > 0 && Number.isSafeInteger(qty * quote.unit)) {
    quote.total = qty * quote.unit;
  }
  if (raid) quote.reason = '벙커에 귀환한 뒤 거래할 수 있습니다.';
  else if (!writer) quote.reason = '플레이 중인 탭에서 거래하세요.';
  else {
    quote.max = buy
      ? Math.min(Math.floor(wallet / quote.unit), Number.MAX_SAFE_INTEGER - count)
      : Math.min(stashUnfittedCount(itemId), Math.floor((Number.MAX_SAFE_INTEGER - wallet - (typeof cashCarried==='function'?cashCarried():0)) / quote.unit));
    if (!quote.total) quote.reason = '수량을 양의 정수로 지정하세요.';
    else if (qty > quote.max) {
      if (buy && quote.total > wallet) quote.reason = '보유 CR이 부족합니다.';
      else if (!buy && qty > count) quote.reason = '창고에 판매할 수량이 부족합니다.';
      else if (!buy && qty > stashRemovableCount(itemId)) quote.reason = '보관함을 비운 뒤 판매하세요.';
      else if (!buy && qty > stashUnfittedCount(itemId)) quote.reason = '장착된 모듈을 분리한 뒤 판매하세요.';
      else quote.reason = '거래 후 보유 한도를 초과합니다.';
    }
  }
  quote.ok = quote.reason === '';
  return quote;
}

function marketTrade(traderId, mode, itemId, qty = 1) {
  reconcile();
  const quote = marketQuote(traderId, mode, itemId, qty);
  const fail = reason => ({...quote, ok: false, reason, message: reason});
  if (!quote.ok) return fail(quote.reason);

  // The whole economy lives in one session save. Keep the prior layout so a failed
  // storage write can be undone without losing grid coordinates or queued items.
  const before = {wallet, count: stashCount(itemId), slots: stashSlots.slice(), overflow:gearOverflow.slice(), revision};
  const stock = stash;
  const buy = mode === 'buy';
  const changed = buy ? addStashGoods(itemId, qty) : takeStashGoods(itemId, qty, null, 'sale');
  if (!changed) return fail('창고 수량이 바뀌었습니다. 다시 선택하세요.');
  wallet += buy ? -quote.total : quote.total;
  persist();

  // A revision conflict causes writeSession to load the winning tab's entire save.
  if (stash !== stock) return fail('다른 탭의 최신 기록을 불러왔습니다. 거래를 다시 확인하세요.');
  const saved = getJSON(SAVE_KEY);
  if (!saved || saved.revision !== revision || saved.wallet !== wallet ||
      (saved.stash[itemId] || 0) !== stashCount(itemId)) {
    if (saved && saved.revision > before.revision) {
      readSession();
    } else {
      if (before.count) stash[itemId] = before.count;
      else delete stash[itemId];
      stashSlots = before.slots;gearOverflow=before.overflow;
      wallet = before.wallet;
      revision = before.revision;
    }
    return fail('거래를 저장하지 못했습니다. 창고와 잔액을 확인하세요.');
  }
  if (stashSelection && !selectedStashUnit()) stashSelection = null;
  const message = GOODS[itemId][0] + ' ' + qty + '개 ' + (buy ? '구매 · 창고 입고' : '판매 · CR 수령');
  return {...quote, message};
}
