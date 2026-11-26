// Aggregate stock includes every item in the grid and in the incoming-goods queue.
let stashSlots = [];
let stashPositionPins=new Set();
function stashPinSnapshot(slots){
  if(!stashPositionPins.size)return {};
  const pins=slots.filter(unit=>stashPositionPins.has(unit.uid)).map(unit=>unit.uid);
  return pins.length?{stashPositionPins:pins}:{};
}
function validStashPins(pins,slots){
  if(pins===undefined)return true;
  if(!Array.isArray(pins)||pins.length>slots.length||new Set(pins).size!==pins.length)return false;
  const owned=new Set(slots.map(unit=>unit.uid));
  return pins.every(uid=>typeof uid==='string'&&owned.has(uid));
}
function stashPinButton(unit){
  if(!unit||unit.uid==='overflow'||raid)return '';
  const pinned=stashPositionPins.has(unit.uid);
  return '<button type="button" data-loadout="pin-position" data-uid="'+esc(unit.uid)+'" aria-pressed="'+pinned+'"'+(writer?'':' disabled')+'>정리 위치 고정</button>';
}
function toggleStashPin(uid){
  if(raid||!writer||!stashSlots.some(unit=>unit.uid===uid)||
     (stashSelection?.uid!==uid&&cashSelected!==uid))return;
  const before=stashPositionPins,updated=new Set(before);
  if(updated.has(uid))updated.delete(uid);else updated.add(uid);
  stashPositionPins=updated;
  if(!writeSession()){
    if(stashPositionPins===updated)stashPositionPins=before;
    stashNotice='위치 고정을 저장하지 못했습니다. 창고의 현재 상태를 확인하세요.';
  }else stashNotice=updated.has(uid)?'크기순 정리 때 이 물품의 칸과 방향을 유지합니다.':'이 물품의 위치 고정을 해제했습니다.';
  renderKeep();
  const toggle=[...document.querySelectorAll('[data-loadout="pin-position"]')].find(button=>button.dataset.uid===uid && button.getClientRects().length);
  toggle?.focus?.({preventScroll:true});
}
let stashSelection = null;
let stashDrag = null;
let stashNotice = '';
let stashUidSequence = 0;

const CASE_ACCESS_CARDS = ['keycard','rl_16_21','rl_16_22','rl_16_23','rl_16_24','rl_16_25','rl_16_26'];
const CASE_WEAPON_ITEMS = ['rl10_carbine','rl12_sidearm','rl_05_15','optic','rl_x_carbine','rl_x_optic'];
const STORAGE_CASES = {
  rs_case_med: {size:[7,7], accepts:'의료 물품', categories:['의료']},
  rs_case_food: {size:[8,8], accepts:'식량 · 음료 · 물통', categories:['식량','음료'], extras:['water']},
  rs_case_junk: {size:[14,14], accepts:'재료 · 전자 · 공구 · 연료 · 천 조각', categories:['재료','전자','공구','연료'], extras:['cloth']},
  rs_case_weapon: {size:[5,10], accepts:'무기 · 탄약 · 광학 모듈', categories:['탄약'], extras:CASE_WEAPON_ITEMS},
  rs_case_weapon_large: {size:[6,15], accepts:'무기 · 탄약 · 광학 모듈', categories:['탄약'], extras:CASE_WEAPON_ITEMS},
  rs_case_pistol: {size:[4,3], accepts:'권총 · 탄약', categories:['탄약'], extras:['rl12_sidearm']},
  rs_case_ammo: {size:[7,7], accepts:'탄약', categories:['탄약']},
  rs_case_docs: {size:[4,4], accepts:'문서 · 정보 · 열쇠 · 출입증 · SSD', categories:['정보','열쇠'], extras:['ssd','rl_04_06']},
  rs_case_keys: {size:[4,4], accepts:'금속 열쇠', categories:['열쇠'], exclude:CASE_ACCESS_CARDS},
  rs_case_cards: {size:[3,3], accepts:'키카드 · 구역 출입증', extras:CASE_ACCESS_CARDS},
  rs_case_injector: {size:[3,3], accepts:'주사기 팩', extras:['rl_11_29']},
  rs_case_items: {size:[8,8], accepts:'일반 물품 전반 · 보관함 중첩 불가', general:true}
};

const CASE_ALIAS_MAX = 24;

function caseAliasValue(raw) {
  if (typeof raw !== 'string' || /[\x00-\x1f\x7f-\x9f\u2028-\u202e\u2066-\u2069]/u.test(raw)) return null;
  const value = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return Array.from(value).length <= CASE_ALIAS_MAX ? value : null;
}

function caseDisplayName(unit) {
  return unit.alias || GOODS[unit.g][0];
}

function renameStorageCase(uid, raw) {
  if (!writer || raid) return {ok:false, message:'벙커의 플레이 중인 탭에서 별칭을 변경하세요.'};
  const index = stashSlots.findIndex(unit => unit.uid === uid && Object.hasOwn(STORAGE_CASES, unit.g));
  if (index < 0) return {ok:false, message:'창고에 배치된 보관함을 다시 선택하세요.'};
  const alias = caseAliasValue(raw);
  if (alias === null) return {ok:false, message:'별칭은 줄바꿈 없이 24자까지 입력할 수 있습니다.'};

  // Edit a single instance. If another tab has won, writeSession restores that tab's snapshot.
  const original = stashSlots[index], inventory = stash;
  const updated = {...original};
  if (alias) updated.alias = alias;
  else delete updated.alias;
  stashSlots[index] = updated;
  if (!writeSession()) {
    if (stash !== inventory) return {ok:false, message:'다른 탭의 변경 사항을 불러왔습니다. 보관함을 다시 확인하세요.'};
    stashSlots[index] = original;
    return {ok:false, message:'별칭을 저장하지 못했습니다. 다시 시도하세요.'};
  }
  return {ok:true, message:alias ? '보관함 별칭을 저장했습니다.' : '보관함 별칭을 지웠습니다.'};
}

function caseAccepts(caseId, itemId) {
  if (!Object.hasOwn(STORAGE_CASES,caseId) || !Object.hasOwn(GOODS,itemId)) return false;
  const rule=STORAGE_CASES[caseId], category=GOODS[itemId][5];
  if (itemId==='cr_notes' || category==='보관함' || rule.exclude?.includes(itemId)) return false;
  return Boolean(rule.general || rule.categories?.includes(category) || rule.extras?.includes(itemId));
}

function validCaseContents(caseId, contents) {
  if (contents === undefined) return true;
  if (!Object.hasOwn(STORAGE_CASES,caseId) || !Array.isArray(contents)) return false;
  const size = STORAGE_CASES[caseId].size;
  if (contents.length > size[0]*size[1]) return false;
  const placed = [], uids = new Set();
  for (const unit of contents) {
    if (!unit || !caseAccepts(caseId,unit.g) || typeof unit.uid !== 'string' ||
        !/^s-[a-z0-9-]{1,72}$/.test(unit.uid) || uids.has(unit.uid) || unit.contents !== undefined || unit.alias !== undefined) return false;
    const [,w,h] = GOODS[unit.g];
    if (!((unit.w === w && unit.h === h) || (unit.w === h && unit.h === w)) ||
        !fits(placed,size,unit.x,unit.y,unit.w,unit.h)) return false;
    uids.add(unit.uid);
    placed.push(unit);
  }
  return true;
}

// Before importing a populated case, ensure the outer layout can restore that exact physical item.
function validCaseBackup(s) {
  const slots = s.stashSlots;
  if (!slots.every(unit=>validCaseContents(unit.g,unit.contents))) return false;
  if (!slots.every(unit => unit.alias === undefined || (
    Object.hasOwn(STORAGE_CASES,unit.g) && typeof unit.alias === 'string' &&
    unit.alias.length > 0 && caseAliasValue(unit.alias) === unit.alias))) return false;
  if (slots.some(unit=>unit.contents?.length || unit.alias)) {
    const level = s.hideout?.levels?.stash ?? 0;
    if (!Number.isInteger(level) || level<0 || level>FACILITIES.stash.levels.length) return false;
    const seen = new Set(), placed = [], counts = {};
    for (const unit of slots) {
      const [,w,h] = GOODS[unit.g];
      const n = (counts[unit.g] || 0) + 1;
      if (n > (s.stash[unit.g] || 0) || seen.has(unit.uid) || !/^s-[a-z0-9-]{1,72}$/.test(unit.uid) ||
          !((unit.w===w&&unit.h===h)||(unit.w===h&&unit.h===w)) ||
          !fits(placed,stashSize(level),unit.x,unit.y,unit.w,unit.h)) return false;
      seen.add(unit.uid);
      placed.push(unit);
      counts[unit.g] = n;
    }
  }
  // Cases are bunker-only; loose kit/field units never carry an inventory of their own.
  const foreignUnits = [s.equipment?.bag, s.field?.bag, ...(Array.isArray(s.field?.gearGround)?s.field.gearGround:[])];
  if (s.field?.boxes && typeof s.field.boxes === 'object') {
    for (const box of Object.values(s.field.boxes)) foreignUnits.push(box?.items);
  }
  return foreignUnits.every(list=>!Array.isArray(list)||list.every(unit=>unit && !Object.hasOwn(STORAGE_CASES,unit.g) && unit.contents===undefined && unit.alias===undefined));
}

function stashRemovableCount(id) {
  const total = stashCount(id);
  if (!Object.hasOwn(STORAGE_CASES,id)) return total;
  return total - stashSlots.filter(unit=>unit.g===id && unit.contents?.length).length;
}

function caseTransfer(uid, action, item, sourceUid = null) {
  const fail = message => ({ok:false,message});
  if (!writer || raid) return fail('벙커로 귀환한 뒤 플레이 중인 탭에서 옮기세요.');
  if (action!=='put' && action!=='take') return fail('물품 이동을 다시 선택하세요.');
  const index = stashSlots.findIndex(unit=>unit.uid===uid && Object.hasOwn(STORAGE_CASES,unit.g));
  if (index<0) return fail('창고에 배치한 보관함을 선택하세요.');
  const box=stashSlots[index], contents=box.contents||[];
  const oldStock=stash, oldSlots=stashSlots.slice(), oldOverflow=gearOverflow.slice();
  let id, updated, queued=false;
  if (action==='put') {
    id=item;
    if (!caseAccepts(box.g,id)) return fail('이 보관함에 넣을 수 없는 종류입니다.');
    const [,w,h]=GOODS[id];
    const slot=sourceUid?stashSlots.find(unit=>unit.g===id&&unit.uid===sourceUid):
      stashOverflowCount(id)>0?null:stashSlots.findLast(unit=>unit.g===id);
    if(sourceUid&&!slot)return fail('선택한 창고 물품을 다시 확인하세요.');
    const physical=slot?.uid||newStashUid();
    const choice=slot?.uid||'overflow';
    const fit=kitFit(contents,STORAGE_CASES[box.g].size,{uid:physical,g:id,x:0,y:0,w,h});
    if (!fit) return fail('보관함에 물품이 들어갈 공간이 없습니다.');
    const gear=gearStashChoice(id,choice); if (gear) fit.gear=gear;
    if (!takeStashGoods(id,1,choice)) return fail('창고에 해당 물품이 없습니다.');
    updated=[...contents,fit];
  } else {
    const unit=contents.find(u=>u.uid===item);
    if (!unit) return fail('꺼낼 물품을 다시 선택하세요.');
    id=unit.g;
    const oldStockCount=stashOverflowCount(id);
    if (!addStashGoods(id,1,unit.gear,unit.uid)) return fail('창고에 빈 칸이나 보유 한도가 부족합니다.');
    queued=stashOverflowCount(id)>oldStockCount;
    updated=contents.filter(u=>u.uid!==item);
  }
  // Removing a loose unit can shift the position of the case in the array.
  stashSlots[stashSlots.indexOf(box)]={...box,contents:updated};
  if (!writeSession()) {
    if (stash !== oldStock) return fail('다른 탭의 최신 기록을 불러왔습니다.');
    const beforeCount=stashCount(id)+(action==='put'?1:-1);
    if (beforeCount) stash[id]=beforeCount; else delete stash[id];
    stashSlots=oldSlots;gearOverflow=oldOverflow;
    return fail('이동을 저장하지 못했습니다. 다시 시도하세요.');
  }
  const destination=action==='put'?'보관함에 넣었습니다.':queued?'입고 대기로 옮겼습니다.':'창고로 꺼냈습니다.';
  return {ok:true,message:GOODS[id][0]+' 1개를 '+destination};
}

function stashSize(level = hideoutLevel('stash')) {
  return [6, 32 + 8 * level];
}

function stashCount(id) {
  return Object.hasOwn(GOODS, id) && Number.isSafeInteger(stash[id]) && stash[id] > 0 ? stash[id] : 0;
}

function stashOverflowCount(id) {
  return stashCount(id) - stashSlots.filter(unit => unit.g === id).length;
}

function stashSalePrice(id) {
  return Object.hasOwn(GOODS, id) ? Math.max(1, Math.floor(GOODS[id][6] / 2)) : 0;
}

function newStashUid() {
  const suffix = globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + '-' + (++stashUidSequence).toString(36));
  return 's-' + suffix;
}

// Count-only overflow has no UID until a physical copy is placed or packed.
const WARD_TRIAL_ITEM='rl_craft_dressing';
function wardPackUid(id,uid){
  if(id!=='rl_bp_dressing'&&id!==WARD_TRIAL_ITEM)return null;
  if(uid==='overflow'||(!uid&&stashOverflowCount(id)>0))return newStashUid();
  return uid||stashSlots.findLast(unit=>unit.g===id)?.uid;
}
function placeIncomingGoods(id, amount, incoming = null, newStock = false, sourceUid = null, layout = stashSlots) {
  const [, w, h] = GOODS[id];
  const size = stashSize();
  let placed=0;
  for (; placed < amount; placed++) {
    let width = w, height = h;
    let pos = firstFit(layout, size, width, height);
    if (!pos && w !== h) {
      width = h;
      height = w;
      pos = firstFit(layout, size, width, height);
    }
    if (!pos) break;
    const unit={uid:placed===0&&sourceUid?sourceUid:newStashUid(),g:id,...pos,w:width,h:height};
    const offset=gearOverflow.findIndex(gear=>gear.g===id);
    if (incoming) {unit.gear=incoming; incoming=null;}
    else if (!newStock && offset>=0) {unit.gear=gearQueuePhysical(gearOverflow[offset]);gearQueueRemove(gearOverflow,id,1);}
    gearEnsureUnit(unit);
    stashSlots.push(unit);
    if (layout !== stashSlots) layout.push(unit);
  }
  if (incoming) {gearOverflow.push(incoming);placed++;}
  if (newStock) gearQueueNew(id,amount-placed);
}

function refreshStashLayout() {
  for (const id of Object.keys(stash)) {
    const count = stashOverflowCount(id);
    if (count > 0) placeIncomingGoods(id, count);
  }
}

function loadStashLayout(savedSlots, expandLegacy = false) {
  stashSlots = [];
  stashSelection = stashDrag = null;
  stashNotice = '';
  if (!Array.isArray(savedSlots)) {
    const ids = Object.keys(stash).filter(id => stashCount(id));
    ids.sort((a, b) => GOODS[b][1] * GOODS[b][2] - GOODS[a][1] * GOODS[a][2]);
    for (const id of ids) placeIncomingGoods(id, stashCount(id));
    return;
  }
  const size = stashSize(), seen = new Set();
  for (const s of savedSlots) {
    if (!s || !stashCount(s.g) || stashOverflowCount(s.g) <= 0) continue;
    const [, w, h] = GOODS[s.g];
    if (!((s.w === w && s.h === h) || (s.w === h && s.h === w))) continue;
    if (!fits(stashSlots, size, s.x, s.y, s.w, s.h)) continue;
    const uid = typeof s.uid === 'string' && /^s-[a-z0-9-]{1,72}$/.test(s.uid) && !seen.has(s.uid) ? s.uid : newStashUid();
    const unit = { uid, g: s.g, x: s.x, y: s.y, w: s.w, h: s.h };
    if (s.g==='cr_notes'){if(!Number.isSafeInteger(s.amount)||s.amount<=0)continue;unit.amount=s.amount;unit.revealed=true;}
    if (gearSpec(s.g)) unit.gear=s.gear||gearCreate(s.g,'legacy-stash-'+uid);
    if (s.contents?.length && validCaseContents(s.g,s.contents)) {
      unit.contents=s.contents;
      for (const item of unit.contents) if (gearSpec(item.g)&&!item.gear) item.gear=gearCreate(item.g,'legacy-case-'+uid+'-'+item.x+'-'+item.y);
    }
    if (s.alias !== undefined && Object.hasOwn(STORAGE_CASES, s.g)) {
      const alias = caseAliasValue(s.alias);
      if (alias) unit.alias = alias;
    }
    stashSlots.push(unit);
    seen.add(uid);
  }
  if (expandLegacy) refreshStashLayout();
}

function addStashGoods(id, amount = 1, gear = null, sourceUid = null, layout = stashSlots) {
  if(id==='cr_notes')return false;
  if (!Object.hasOwn(GOODS, id) || !Number.isSafeInteger(amount) || amount < 1) return false;
  const next = stashCount(id) + amount;
  if (!Number.isSafeInteger(next)) return false;
  if(id==='rl_bp_dressing'){
    const uid=sourceUid??newStashUid(),pos=firstFit(layout,stashSize(),1,1);
    if(amount!==1 || !wardUid(uid) || !pos || stashSlots.some(unit=>unit.uid===uid))return false;
    stash[id]=next;
    stashSlots.push({uid,g:id,...pos,w:1,h:1});
    return true;
  }
  stash[id] = next;
  const preserve=amount===1 && typeof sourceUid==='string' && /^s-[a-z0-9-]{1,72}$/.test(sourceUid) && !stashSlots.some(u=>u.uid===sourceUid);
  placeIncomingGoods(id, amount, gear, true, preserve?sourceUid:null, layout);
  return true;
}

// Banknotes spent from the grid free cells in the same transaction that receives the goods.
// Retain the original cash units until writeSession commits the projected payment.
function addPurchasedGoods(id, amount, total) {
  const layout = cashProjection(wallet - total).stashSlots;
  return addStashGoods(id, amount, null, null, layout);
}

// Consumption protects assembled hosts. Untagged older overflow remains usable
// alongside pristine batches; only physical instances with an installed module are reserved.
function fittedQueueCount(id) {
  return gearOverflow.reduce((sum, gear) => sum + Number(gear.g === id && Boolean(gear.module)), 0);
}

function stashUnfittedCount(id) {
  const removable = stashRemovableCount(id);
  if (!removable || !gearSpec(id)) return removable;
  const fittedSlots = stashSlots.filter(unit => unit.g === id && unit.gear?.module).length;
  return removable - fittedSlots - fittedQueueCount(id);
}

function takeStashGoods(id, amount = 1, uid = null, purpose = 'move') {
  if(id==='cr_notes')return false;
  const count = stashCount(id);
  const skipFitted = purpose === 'facility' || purpose === 'delivery' || purpose === 'sale';
  const available = skipFitted ? stashUnfittedCount(id) : stashRemovableCount(id);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > available) return false;
  const unplaced = stashOverflowCount(id) - (skipFitted && gearSpec(id) ? fittedQueueCount(id) : 0);
  if (uid === 'overflow') {
    if (amount > unplaced) return false;
  } else if (uid !== null) {
    const index = stashSlots.findIndex(unit => unit.uid === uid && unit.g === id);
    if (amount !== 1 || index < 0 || stashSlots[index].contents?.length || (skipFitted && stashSlots[index].gear?.module)) return false;
    stashSlots.splice(index, 1);
  } else {
    let remove = Math.max(0, amount - unplaced);
    const eligible = unit => unit.g === id && !unit.contents?.length && !(skipFitted && unit.gear?.module);
    const ordered = purpose === 'delivery' ? stashSlots : stashSlots.slice().reverse();
    const removed = new Set();
    for (const unit of ordered) {
      if (!remove) break;
      if (!eligible(unit)) continue;
      removed.add(unit.uid);
      remove--;
    }
    if (remove) return false;
    if (removed.size) stashSlots = stashSlots.filter(unit => !removed.has(unit.uid));
  }
  const queued=uid===null?Math.min(unplaced,amount):uid==='overflow'?amount:0;
  if (queued && gearOverflow.length) gearQueueRemove(gearOverflow,id,queued,skipFitted);
  if (amount === count) delete stash[id];
  else stash[id] = count - amount;
  return true;
}

function stashConsume(materials) {
  if (!materials || typeof materials !== 'object' || Array.isArray(materials)) return false;
  const entries = Object.entries(materials);
  if (!entries.every(([id, n]) => id !== 'cr_notes' && Number.isSafeInteger(n) && n > 0 && stashUnfittedCount(id) >= n)) return false;
  for (const [id, n] of entries) takeStashGoods(id, n, null, 'facility');
  return true;
}

function selectedStashUnit() {
  if (!stashSelection) return null;
  const { id, uid } = stashSelection;
  if (uid === 'overflow') {
    if (!stashOverflowCount(id)) return null;
    return { uid, g: id, w: GOODS[id][1], h: GOODS[id][2] };
  }
  return stashSlots.find(s => s.uid === uid && s.g === id) || null;
}

function stashAtBunker() {
  return !raid || Boolean(field?.result);
}

function arrangeStashUnit(x, y, automatic = false) {
  const unit = selectedStashUnit();
  if (!unit || !stashAtBunker()) return false;
  const w = stashSelection.rot ? unit.h : unit.w;
  const h = stashSelection.rot ? unit.w : unit.h;
  const size = stashSize();
  const pos = automatic ? firstFit(stashSlots, size, w, h, unit.uid) : { x, y };
  if (!pos || !fits(stashSlots, size, pos.x, pos.y, w, h, unit.uid)) {
    stashNotice = '이 자리에 들어가지 않습니다. 다른 빈 칸을 고르거나 물품을 회전하세요.';
    return false;
  }
  if (unit.uid === 'overflow') {
    const placed={uid:newStashUid(),g:unit.g,...pos,w,h};
    if (gearSpec(unit.g)) {
      placed.gear=gearStashChoice(unit.g,'overflow');
      gearQueueRemove(gearOverflow,unit.g,1);
    }
    stashSlots.push(placed);
  } else {
    Object.assign(unit, pos, { w, h });
  }
  stashSelection = null;
  stashNotice = GOODS[unit.g][0] + ' 배치 완료';
  return true;
}

function stashGridMarkup(filter = null) {
  const [cols, rows] = stashSize();
  const canPlace = stashAtBunker() && (selectedStashUnit() || (!raid && (gearPick || cashSelected)));
  let cells = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const attrs = ' class="slot" data-stash="place" data-x="' + x + '" data-y="' + y + '" style="grid-column:' + (x + 1) + ';grid-row:' + (y + 1) + '"';
      cells += canPlace
        ? '<button type="button" tabindex="-1"' + attrs + ' aria-label="창고 ' + (x + 1) + '열 ' + (y + 1) + '행에 배치"></button>'
        : '<span' + attrs + ' aria-hidden="true"></span>';
    }
  }
  const tiles = stashSlots.map(s => {
    if(s.g==='cr_notes')return cashStashTile(s);
    const g = GOODS[s.g], chosen = stashSelection?.uid === s.uid;
    const display = esc(caseDisplayName(s)), title = s.alias ? display + ' · ' + esc(g[0]) : display;
    const pinned=stashPositionPins.has(s.uid);
    return `<button class="loot-tile ${chosen ? 'chosen' : ''} ${filter && !filter(s.g) ? 'lo-muted-tile' : ''}" data-stash="select" data-id="${s.g}" data-uid="${s.uid}" ${pinned?'data-position-pinned="true"':''} draggable="${stashAtBunker()}" aria-pressed="${chosen}" aria-label="${title}${pinned?' · 정리 위치 고정':''} · ${s.w}×${s.h} · ${s.x + 1}열 ${s.y + 1}행" title="${title}" style="grid-column:${s.x + 1}/span ${s.w};grid-row:${s.y + 1}/span ${s.h}">${typeof itemArt==='function'?itemArt(s.g,'item-symbol'):ico(g[4], 'item-symbol')}<span>${display}</span></button>`;
  }).join('');
  return `<div class="spatial-grid stash-grid" data-stash-grid style="--cols:${cols};--rows:${rows}">${cells}${tiles}</div>`;
}

function stashViewport(filter) {
  const help = stashAtBunker() ? '<p id="stash-key-help" class="mini-field">Tab으로 물품 이동 · 선택 후 방향키로 칸 지정 · Enter로 배치</p>' : '';
  return help+'<div class="stash-scroll" data-scroll-key="warehouse-grid" role="region" tabindex="0" aria-label="창고 격자 스크롤"'+(help?' aria-describedby="stash-key-help"':'')+'>'+stashGridMarkup(filter)+'</div>';
}

// The viewport and owned items are Tab stops. Destination cells use arrow keys only while placing an item.
inside.addEventListener('keydown', event => {
  const direction = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[event.key];
  if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target, area = target.closest?.('[data-scroll-key="warehouse-grid"]');
  if (!area || !area.querySelector('button[data-stash="place"]')) return;
  const cell = target.matches('button[data-stash="place"]');
  const selected = target.matches('.loot-tile[aria-pressed="true"]');
  if (target !== area && !cell && !selected) return;

  let x = 0, y = 0;
  if (cell || selected) {
    const [cols, rows] = stashSize();
    const originX = cell ? Number(target.dataset.x) : Number(target.style.gridColumnStart)-1;
    const originY = cell ? Number(target.dataset.y) : Number(target.style.gridRowStart)-1;
    x = Math.max(0, Math.min(cols-1, originX+direction[0]));
    y = Math.max(0, Math.min(rows-1, originY+direction[1]));
  }
  event.preventDefault();
  const destination = area.querySelector('button[data-stash="place"][data-x="'+x+'"][data-y="'+y+'"]');
  destination.focus({preventScroll:true});
  destination.scrollIntoView({block:'nearest', inline:'nearest'});
});

// The shell replaces the contents of the active screen after a game action.
// A case and the surrounding warehouse each own their own scroll position.
function captureStashScroll() {
  const positions=new Map(),active=document.activeElement;
  const focused=active?.matches?.(':focus-visible')?active.closest('[data-scroll-key]'):null;
  for(const area of document.querySelectorAll('[data-scroll-key]')){
    const restoreFocus=area===focused;
    positions.set(area.dataset.scrollKey,{top:area.scrollTop,left:area.scrollLeft,restoreFocus,
      button:restoreFocus&&active.matches('button')?{...active.dataset}:null});
  }
  return positions;
}
function restoreStashScroll(positions) {
  for(const area of document.querySelectorAll('[data-scroll-key]')){
    const previous=positions.get(area.dataset.scrollKey);
    if(!previous)continue;
    area.scrollTop=previous.top;
    area.scrollLeft=previous.left;
    if(previous.restoreFocus){
      const data=previous.button;
      const button=data&&Array.from(area.querySelectorAll('button')).find(b=>
        !b.disabled&&Object.keys(data).every(key=>b.dataset[key]===data[key]));
      (button||area).focus({preventScroll:true});
    }
  }
}

function stashSaleRestriction(unit) {
  if (unit.contents?.length) return '보관함을 비운 뒤 판매하세요.';
  // An incoming stack sells its first physical instance, just as placing or equipping it does.
  const gear = unit.uid === 'overflow' ? gearOverflow.find(row => row.g === unit.g) : unit.gear;
  return gear?.module ? kitName(gear.module) + ' 장착 중 · 장비를 착용하고 모듈 정비에서 분리한 뒤 판매하세요.' : '';
}

function stashSelectionMarkup() {
  const s = selectedStashUnit();
  if (!s) return '<h2>선택한 물품</h2><p>창고나 입고 대기 목록에서 물품을 선택하세요.</p>';
  const g = GOODS[s.g], canEdit = stashAtBunker(), rot = stashSelection.rot;
  const w = rot ? s.h : s.w, h = rot ? s.w : s.h;
  const saleRestriction = canEdit ? stashSaleRestriction(s) : '';
  const manualNote = canEdit && s.g===WARD_SHEET && !saleRestriction ? wardSaleNote(1,'direct') : '';
  return `<div class="db-detail-title">${ico(g[4])}<div><h2>${esc(caseDisplayName(s))}</h2><p>${s.alias ? esc(g[0]) + ' · ' : ''}${g[5]} · ${w} × ${h}칸 · ${g[3]} kg</p></div></div>
    <div class="stash-tools">${canEdit ? `
      ${s.w !== s.h ? '<button data-stash="rotate" aria-pressed="' + rot + '">90° 회전</button>' : ''}
      ${rot && s.uid !== 'overflow' ? '<button data-stash="rotate-here">현재 위치에 적용</button>' : ''}
      ${s.uid === 'overflow' ? '<button data-stash="auto">빈 공간에 배치</button>' : ''}
      ${stashPinButton(s)}${equipmentStashActions(s.g, s.uid)}
      <button data-stash="sell" ${saleRestriction ? 'disabled aria-describedby="stash-sale-reason"' : manualNote ? 'aria-describedby="ward-sale-direct"' : ''}>1개 판매 · ${money(stashSalePrice(s.g))}</button>` : ''}
      <button data-db="lookup" data-id="${s.g}">도감 보기</button><button data-stash="clear">선택 해제</button>
    </div>${manualNote}${saleRestriction?'<p id="stash-sale-reason">'+esc(saleRestriction)+'</p>':''}${Object.hasOwn(STORAGE_CASES,s.g)?casePanelMarkup(s):caseDestinations(s)}${canEdit ? '<p>빈 칸을 누르면 그 칸을 왼쪽 위 모서리로 삼아 배치합니다.</p>' : ''}`;
}

function storagePage() {
  const [cols, rows] = stashSize(), capacity = cols * rows;
  const ids = Object.keys(stash).filter(id => stashCount(id));
  const total = ids.reduce((n, id) => n + stashCount(id), 0);
  const overflow = ids.map(id => [id, stashOverflowCount(id)]).filter(([, count]) => count > 0);
  const occupied = stashSlots.reduce((n, s) => n + s.w * s.h, 0);
  return head('B-04 / STORAGE', '벙커 창고', '귀환한 물품을 정리하고 다음 출격을 준비합니다.') + `
    <div class="db-summary stash-summary"><span>잔액 <b>${money(wallet)}</b> · 보관 ${total.toLocaleString('ko-KR')}개</span><button data-page="inventory">장비 관리</button><button data-page="bunker">하이드아웃</button></div>
    ${stashAtBunker() ? '' : '<p class="mini-field">작전 중입니다. 창고 정리와 판매는 귀환 후 이용할 수 있습니다.</p>'}
    ${cashCompartmentMarkup()}
    ${possessionsPanel()}
    <div class="stash-layout">
      <section class="loot-panel"><div class="field-label"><span>STORAGE</span><span>Lv.${hideoutLevel('stash')}</span></div><h2>보관 격자 <small>${cols} × ${rows} · ${occupied} / ${capacity}칸</small></h2>${!raid&&stashSlots.length>1?'<button type="button" data-loadout="sort"'+(writer?'':' disabled')+'>크기순 정리</button>':''}${total ? '' : '<p class="mini-field">창고가 비어 있습니다. 레이드에서 물품을 가방에 넣고 탈출하면 이곳에 보관됩니다.</p>'}${stashViewport()}</section>
      <div class="stash-sidebar">
        <section class="panel stash-detail">${stashSelectionMarkup()}<div class="stash-message" role="status">${stashNotice}</div></section>
        <section class="panel" data-scroll-key="warehouse-overflow" tabindex="-1" aria-label="입고 대기 목록"><h2>입고 대기 <small>${(total - stashSlots.length).toLocaleString('ko-KR')}개</small></h2>${overflow.length ? '<p>창고에 자리가 부족해 대기 중인 물품입니다. 물품을 선택해 배치하거나 사용할 수 있습니다.</p><div class="db-list stash-overflow">' + overflow.map(([id, n]) => `<button data-stash="select" data-uid="overflow" data-id="${id}" aria-pressed="${stashSelection?.uid === 'overflow' && stashSelection.id === id}">${ico(GOODS[id][4])}<span>${GOODS[id][0]}</span><b>×${n.toLocaleString('ko-KR')}</b></button>`).join('') + '</div>' : '<p>입고를 기다리는 물품이 없습니다.</p>'}</section>
      </div></div>`;
}

function handleStash(d) {
  if (d.stash?.startsWith('case-')) { handleCaseUI(d); return; }
  const unit = selectedStashUnit();
  if(d.stash==='place'&&!unit && !raid && typeof gearPick!=='undefined' && gearPick && typeof moveBagToStashCell==='function'){
    if(moveBagToStashCell(Number(d.x),Number(d.y))) saveInventoryMove();renderKeep();return;
  }
  if (d.stash === 'select') {
    if (!stashCount(d.id)) return;
    stashSelection = { id: d.id, uid: d.uid, rot: false };
    if(typeof gearPick!=='undefined')gearPick=null;
    stashNotice = '';
  } else if (d.stash === 'clear') {
    stashSelection = null;
    stashNotice = '';
  } else {
    if (!stashAtBunker() || !unit) return;
    let changed = false;
    if (d.stash === 'rotate') stashSelection.rot = !stashSelection.rot;
    if (d.stash === 'place') changed = arrangeStashUnit(Number(d.x), Number(d.y));
    if (d.stash === 'auto') changed = arrangeStashUnit(0, 0, true);
    if (d.stash === 'rotate-here') changed = arrangeStashUnit(unit.x, unit.y);
    if (d.stash === 'sell') {
      const restriction = stashSaleRestriction(unit);
      if (restriction) { stashNotice = restriction; renderKeep(); return; }
      const price = stashSalePrice(unit.g);
      if (!(typeof cashCanCredit==='function'?cashCanCredit(price):Number.isSafeInteger(wallet+price)) || !takeStashGoods(unit.g, 1, unit.uid)) return;
      wallet += price;
      stashNotice = `${GOODS[unit.g][0]} 1개 판매 · ${money(price)} 수령`;
      stashSelection = null;
      changed = true;
    }
    if (changed) saveInventoryMove();
  }
  renderKeep();
}

inside.addEventListener('click', event => {
  const button = event.target.closest('button[data-stash]');
  if (!busy && ['stash','inventory'].includes(page) && button) handleStash(button.dataset);
});
inside.addEventListener('dragstart', event => {
  const tile = event.target.closest('[data-stash="select"][draggable="true"]');
  if (!tile || !stashAtBunker()) return;
  const unit = stashSlots.find(s => s.uid === tile.dataset.uid);
  if (!unit) return;
  const r = tile.getBoundingClientRect();
  const rot = stashSelection?.uid === unit.uid && stashSelection.rot;
  stashDrag = { id: unit.g, uid: unit.uid, rot, offsetX: rot ? 0 : Math.floor((event.clientX - r.left) * unit.w / r.width), offsetY: rot ? 0 : Math.floor((event.clientY - r.top) * unit.h / r.height) };
  event.dataTransfer.setData('text/plain', unit.uid);
  event.dataTransfer.effectAllowed = 'move';
});
inside.addEventListener('dragover', event => {
  if (stashDrag && event.target.closest('[data-stash-grid]')) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }
});
inside.addEventListener('drop', event => {
  const grid = event.target.closest('[data-stash-grid]');
  if (!grid || !stashDrag || !stashAtBunker()) return;
  event.preventDefault();
  const rect = grid.getBoundingClientRect(), [cols, rows] = stashSize();
  const x = Math.floor((event.clientX - rect.left - grid.clientLeft) * cols / grid.clientWidth) - stashDrag.offsetX;
  const y = Math.floor((event.clientY - rect.top - grid.clientTop) * rows / grid.clientHeight) - stashDrag.offsetY;
  stashSelection = { id: stashDrag.id, uid: stashDrag.uid, rot: stashDrag.rot };
  stashDrag = null;
  if (arrangeStashUnit(x, y)) saveInventoryMove();
  renderKeep();
});
inside.addEventListener('dragend', () => { stashDrag = null; });
