// A recipe stores item types. Only equipment, loose warehouse stock and case contents own items.
const PRESET_MODULES = {
  rl10_carbine:['optic','rl_x_optic'],rl12_sidearm:['optic','rl_x_optic'],rl_x_carbine:['optic','rl_x_optic'],
  rl_13_07:['optic'], rl_13_08:['optic'],
  flash:['battery'], rl_13_05:['battery'],
  radio:['battery','rl_13_02']
};
let presetBook = [null,null];

function presetNameValue(raw) {
  return caseAliasValue(raw) || null;
}
function presetRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function validPresetModules(worn, modules) {
  return presetRecord(worn) && presetRecord(modules) && Object.entries(modules).every(([slot, part]) =>
    Object.hasOwn(worn,slot) && Object.hasOwn(KIT_SLOTS,slot) &&
    Object.hasOwn(PRESET_MODULES,worn[slot]) && PRESET_MODULES[worn[slot]].includes(part));
}
function validPresetTarget(target) {
  return presetRecord(target) && presetRecord(target.worn) &&
    Object.entries(target.worn).every(([slot,id]) => Object.hasOwn(KIT_SLOTS,slot) &&
      typeof id === 'string' && (id === ISSUE_PACK || Object.hasOwn(GOODS,id)) && kitSlot(id) === slot) &&
    validPresetModules(target.worn,target.modules);
}
function validPresetBook(book) {
  return Array.isArray(book) && book.length === 2 && [0,1].every(index => {
    const recipe = book[index];
    return recipe === null || (validPresetTarget(recipe) &&
      typeof recipe.name === 'string' && presetNameValue(recipe.name) === recipe.name);
  });
}
function loadPresetBook(raw) {
  presetBook = validPresetBook(raw) ? raw.map(entry => entry &&
    ({name:entry.name,worn:{...entry.worn},modules:{...entry.modules}})) : [null,null];
}
function validPresetBackup(s) {
  if (!validPresetBook(s.presets) || !validPresetModules(s.equipment?.worn,s.equipment?.modules)) return false;
  if (s.raid && !s.field?.result) return validPresetModules(s.field.worn,s.field.modules);
  return s.field?.modules === undefined || (presetRecord(s.field.modules) && !Object.keys(s.field.modules).length);
}
function presetCurrent() {
  const kit = raid && !field.result ? field : equipmentState;
  return {worn:{...kit.worn},modules:{...kit.modules}};
}
function savePreset(index, name, target = presetCurrent()) {
  const label = presetNameValue(name);
  if (!writer || raid) return {ok:false,message:'벙커로 귀환한 뒤 플레이 중인 탭에서 저장하세요.'};
  if (!Number.isInteger(index) || index < 0 || index >= presetBook.length || !label)
    return {ok:false,message:'프리셋 이름을 줄바꿈 없이 1~24자로 입력하세요.'};
  if (!validPresetTarget(target)) return {ok:false,message:'장비와 모듈의 호환성을 확인하세요.'};
  const before = presetBook, next = before.slice();
  next[index] = {name:label,worn:{...target.worn},modules:{...target.modules}};
  presetBook = next;
  if (writeSession()) return {ok:true,message:label+' 프리셋을 저장했습니다.'};
  if (presetBook === next) {
    presetBook = before;
    return {ok:false,message:'프리셋을 저장하지 못했습니다. 저장 공간을 확인하세요.'};
  }
  return {ok:false,message:'다른 탭의 최신 기록을 불러왔습니다. 프리셋을 다시 확인하세요.'};
}

function presetStock(id) {
  const kit = raid && !field.result ? field : equipmentState;
  const count = units => units.reduce((total,u) => total + Number(u.g === id),0);
  return stashCount(id) + count(kit.bag) +
    Object.values(kit.worn).filter(g => g === id).length +
    Object.values(kit.modules || {}).filter(g => g === id).length +
    gearOwned().filter(r=>r.location!=='worn' && r.gear.module===id).length +
    stashSlots.reduce((total,box) => total + (box.contents ? count(box.contents) : 0),0);
}
function presetItemCounts(target) {
  const counts = new Map();
  for (const id of [...Object.values(target.worn),...Object.values(target.modules)]) {
    counts.set(id,(counts.get(id) || 0) + 1);
  }
  return counts;
}
function presetDelta(left, right) {
  const rows = [];
  for (const [id,count] of left) {
    const quantity = count - (right.get(id) || 0);
    if (quantity > 0) rows.push({id,quantity});
  }
  return rows;
}

// Work on copies. The aggregate stock already includes its placed units and its incoming queue.
function presetTake(next, id, amount, warehouseFirst) {
  function fromBag() {
    for (let i = next.bag.length - 1; amount && i >= 0; i--) {
      if (next.bag[i].g !== id) continue;
      presetDonor(next,next.bag[i]);
      next.bag.splice(i,1);
      amount--;
    }
  }
  function fromWarehouse() {
    const count = next.stock[id] || 0;
    const take = Math.min(count,amount);
    if (!take) return;
    // Pull placed units first. The vacated rectangles can receive the equipment being returned.
    let placed = take;
    for (let i = next.slots.length - 1; placed && i >= 0; i--) {
      if (next.slots[i].g !== id) continue;
      presetDonor(next,next.slots[i]);
      next.slots.splice(i,1);
      placed--;
    }
    for (let n=0;gearSpec(id)&&n<placed;n++){
      const i=next.overflow.findIndex(g=>g.g===id);
      const gear=i<0?gearCreate(id):gearQueuePhysical(next.overflow[i]);
      if(i>=0) gearQueueRemove(next.overflow,id,1);
      presetDonor(next,{g:id,gear});
    }
    if (count === take) delete next.stock[id];
    else next.stock[id] = count - take;
    amount -= take;
  }
  if (warehouseFirst) { fromWarehouse(); fromBag(); }
  else { fromBag(); fromWarehouse(); }
  for (let i = 0; amount && i < next.slots.length; i++) {
    const box = next.slots[i];
    if (!box.contents?.some(u => u.g === id)) continue;
    const contents = box.contents.filter(unit => {
      if (!amount || unit.g !== id) return true;
      presetDonor(next,unit);
      amount--;
      return false;
    });
    next.slots[i] = {...box,contents};
  }
  return amount === 0;
}

function presetDonor(next,unit) {
  if (!gearSpec(unit.g)) return;
  // The preview is a pure inventory plan; never alter the gear still owned by its source.
  const gear=unit.gear||gearCreate(unit.g);
  next.donors[unit.g]=gear;
}
// When a recipe asks for a fitted host, prefer a matching physical copy even if a loose
// duplicate appears earlier in another inventory. The enclosing layout is still a dry run.
function presetTakeFitted(next,id,part,warehouseFirst) {
  if(!part) return false;
  const matches=u=>u?.g===id&&u.gear?.module===part;
  const bag=next.bag.findIndex(matches), grid=next.slots.findIndex(matches);
  if(bag>=0 && (!warehouseFirst||grid<0)) {presetDonor(next,next.bag.splice(bag,1)[0]);return true;}
  if(grid>=0){
    presetDonor(next,next.slots.splice(grid,1)[0]);
    if(--next.stock[id]===0)delete next.stock[id];
    return true;
  }
  for(let i=0;i<next.slots.length;i++){
    const box=next.slots[i],unit=box.contents?.find(matches);
    if(unit){next.slots[i]={...box,contents:box.contents.filter(u=>u!==unit)};presetDonor(next,unit);return true;}
  }
  const overflow=next.overflow.findIndex(g=>g.g===id && g.module===part);
  if(overflow<0)return false;
  const gear=next.overflow.splice(overflow,1)[0];presetDonor(next,{g:id,gear});
  if(--next.stock[id]===0) delete next.stock[id];
  return true;
}
function presetLayout(target, takes, returns, warehouseFirst, reserved = [], positions = null) {
  const next = {stock:{...stash},slots:stashSlots.slice(),bag:equipmentState.bag.slice(),
    donors:{},overflow:gearOverflow.slice()};
  const taken = new Map();
  if (reserved.length) {
    const selected = new Set(reserved);
    next.slots = next.slots.filter(unit => !selected.has(unit));
    for (const unit of selected) {
      presetDonor(next,unit);
      taken.set(unit.g,(taken.get(unit.g) || 0) + 1);
      if (--next.stock[unit.g] === 0) delete next.stock[unit.g];
    }
  }
  // First choose the actual host(s). An incoming host brings its fitted part with it.
  const parts=new Set(Object.values(PRESET_MODULES).flat());
  const balance=new Map();
  for(const {id,quantity} of returns) if(parts.has(id)) balance.set(id,-quantity);
  for (const {id,quantity} of takes) {
    if(parts.has(id)) balance.set(id,quantity);
    else if (gearSpec(id) && !taken.has(id) && presetTakeFitted(next,id,target.modules[kitSlot(id)],warehouseFirst)) continue;
    else if (!presetTake(next,id,quantity - (taken.get(id) || 0),warehouseFirst))
      return {issue:'확보할 수 있는 물품의 수량이 바뀌었습니다. 재고를 다시 확인하세요.'};
  }
  for(const gear of Object.values(next.donors)) {
    if(gear.module) balance.set(gear.module,(balance.get(gear.module)||0)-1);
  }
  const actualReturns=returns.filter(r=>!parts.has(r.id)),actualTakes=takes.filter(r=>!parts.has(r.id));
  for(const [id,delta] of balance) {
    const reservedCount=taken.get(id)||0;
    if(reservedCount>Math.max(0,delta)) return {issue:'예약된 부품 위치가 달라졌습니다.'};
    if(delta>0){
      if(!presetTake(next,id,delta-reservedCount,warehouseFirst))
        return {issue:kitName(id)+' 모듈이 부족합니다. 보관 장비에서 부품을 분리한 뒤 다시 시도하세요.'};
      actualTakes.push({id,quantity:delta});
    }
    if(delta<0) actualReturns.push({id,quantity:-delta});
  }
  next.actualReturns=actualReturns;next.actualTakes=actualTakes;
  const size = kitCapacity(target.worn);
  if (next.bag.some(u => u.x+u.w > size[0] || u.y+u.h > size[1])) {
    let packed = kitArrange(next.bag,size);
    // Try a compact layout when retaining old coordinates prevents other pieces from fitting.
    if (packed.left.length) packed = kitArrange(next.bag.map(u => ({...u,x:0,y:0})),size);
    if (packed.left.length) return {issue:'현재 휴대 격자에서 남은 물품의 배치를 찾지 못했습니다. 가방을 정리한 뒤 다시 시도하세요.'};
    next.bag = packed.placed;
  }
  const returnedUnits = [];
  for (const {id,quantity} of actualReturns) {
    const count = (next.stock[id] || 0) + quantity;
    if (!Number.isSafeInteger(count)) return {issue:kitName(id)+'의 창고 보유 한도를 초과합니다.'};
    next.stock[id] = count;
    const [,w,h] = GOODS[id];
    for (let i = 0; i < quantity; i++) {
      const old=gearWorn(equipmentState,kitSlot(id));
      returnedUnits.push({g:id,w,h,x:0,y:0,...(old&&old.g===id?{gear:{...old,module:null}}:{})});
    }
  }
  next.newUnits = [];
  for (const unit of kitSorted(returnedUnits)) {
    const pos = positions?.[next.newUnits.length];
    const fit = pos && (pos.w===unit.w&&pos.h===unit.h || pos.w===unit.h&&pos.h===unit.w) &&
      fits(next.slots,stashSize(),pos.x,pos.y,pos.w,pos.h) ? {...unit,x:pos.x,y:pos.y,w:pos.w,h:pos.h} : kitFit(next.slots,stashSize(),unit);
    if (!fit) return {issue:'회수할 장비와 모듈을 놓을 창고 격자 공간이 부족합니다.'};
    // Each transient tile needs a UID for the collision checker. Persistent UIDs are allocated at commit.
    fit.uid = 'pending-return-'+next.newUnits.length;
    next.slots.push(fit);
    next.newUnits.push(fit);
  }
  return {next};
}

// A full warehouse may need a particular duplicate pulled, while a smaller pack needs a different
// duplicate pulled from the bag. Reserve the actual loose tiles under each proposed return first.
function presetSwapLayout(target, takes, returns) {
  if (!returns.length || !takes.length) return null;
  const [width,height] = stashSize(), count = width * height;
  const stock = new Array(count).fill(null), limits = new Map(takes.map(row => [row.id,row.quantity]));
  let free = count;
  for (const unit of stashSlots) {
    free -= unit.w*unit.h;
    for (let y = unit.y; y < unit.y+unit.h; y++) {
      for (let x = unit.x; x < unit.x+unit.w; x++) stock[y*width+x] = unit;
    }
  }
  const rectangles = kitSorted(returns.flatMap(({id,quantity}) =>
    Array.from({length:quantity},() => ({w:GOODS[id][1],h:GOODS[id][2]}))));
  const area = units => units.reduce((sum,u) => sum+u.w*u.h,0);
  const bounds = new Map();
  let freedAtMost = 0, packedAtLeast = area(equipmentState.bag);
  for (const {id,quantity} of takes) {
    const size = GOODS[id][1]*GOODS[id][2], bagCount = equipmentState.bag.filter(u => u.g === id).length;
    freedAtMost += Math.min(quantity,stashSlots.filter(u => u.g === id).length)*size;
    packedAtLeast -= Math.min(quantity,bagCount)*size;
    bounds.set(id,{size,bagCount});
  }
  const capacity = kitCapacity(target.worn).reduce((a,b) => a*b);
  if (area(rectangles) > free+freedAtMost || packedAtLeast > capacity) return null;
  const shapes = new Map();
  function positions(w,h) {
    const key = w+','+h;
    if (shapes.has(key)) return shapes.get(key);
    const choices = [];
    for (const [a,b] of w === h ? [[w,h]] : [[w,h],[h,w]]) {
      for (let y = 0; y <= height-b; y++) for (let x = 0; x <= width-a; x++) {
        const cells = [], donors = new Set();
        for (let i = y; i < y+b; i++) for (let j = x; j < x+a; j++) {
          const cell = i*width+j;
          cells.push(cell);
          if (stock[cell]) donors.add(stock[cell]);
        }
        const demand = new Map();
        for (const u of donors) demand.set(u.g,(demand.get(u.g) || 0)+1);
        if (Array.from(demand).some(([id,n]) => n > (limits.get(id) || 0))) continue;
        choices.push({x,y,w:a,h:b,cells,donors:[...donors]});
      }
    }
    choices.sort((a,b) => a.donors.length-b.donors.length);
    shapes.set(key,choices);
    return choices;
  }
  const choices = rectangles.map(r => positions(r.w,r.h));
  if (choices.some(list => !list.length)) return null;
  const occupied = new Uint8Array(count), selected = new Set(), used = new Map(), solution = [];
  let budget = 12000;
  function place(index, bagMinimum, first) {
    if (index === choices.length) {
      const layout = presetLayout(target,takes,returns,false,[...selected],solution);
      return layout.next ? layout : null;
    }
    const list = choices[index];
    for (let i = first; i < list.length && budget > 0; i++) {
      budget--;
      const pos = list[i];
      if (pos.cells.some(cell => occupied[cell])) continue;
      const added = pos.donors.filter(unit => !selected.has(unit));
      let possible = true, bagArea = bagMinimum;
      for (const u of added) {
        const n = (used.get(u.g) || 0)+1, available = limits.get(u.g), bound = bounds.get(u.g);
        used.set(u.g,n);
        if (n > available) possible = false;
        if (available-n < bound.bagCount) bagArea += bound.size;
      }
      if (possible && bagArea <= capacity) {
        for (const u of added) selected.add(u);
        for (const c of pos.cells) occupied[c] = 1;
        solution.push(pos);
        const placed = place(index+1,bagArea,choices[index+1] === list ? i+1 : 0);
        if (placed) return placed;
        solution.pop();
        for (const c of pos.cells) occupied[c] = 0;
        for (const u of added) selected.delete(u);
      }
      for (const u of added) used.set(u.g,used.get(u.g)-1);
    }
    return null;
  }
  const layout = place(0,packedAtLeast,0);
  if (!layout && budget === 0) return {issue:'현재 격자에서 교환 배치를 찾지 못했습니다. 가방이나 창고에 여유 공간을 만든 뒤 다시 시도하세요.'};
  return layout;
}

function planPreset(target) {
  const result = {ok:false,message:'',issues:[],requirements:[],takes:[],returns:[],issuedReturned:false};
  const fail = message => {
    result.issues.push(message);
    result.message = message;
    return {result};
  };
  if (raid) return fail('출격 장비 정비는 벙커에서 할 수 있습니다.');
  if (!validPresetTarget(target)) return fail('선택한 장비 슬롯과 모듈이 호환되지 않습니다.');
  const wanted = presetItemCounts(target), equipped = presetItemCounts(presetCurrent());
  for (const [id,needed] of wanted) {
    const owned = presetStock(id);
    result.requirements.push({id,needed,owned,missing:Math.max(0,needed-owned)});
  }
  result.takes = presetDelta(wanted,equipped);
  const released = presetDelta(equipped,wanted);
  result.returns = released.filter(row => row.id !== ISSUE_PACK);
  result.issuedReturned = released.some(row => row.id === ISSUE_PACK);
  const missing = result.requirements.filter(row => row.missing);
  if (missing.length) return fail('부족한 물품 · '+missing.map(row => kitName(row.id)+' '+row.missing+'개').join(', '));
  let layout = presetLayout(target,result.takes,result.returns,false);
  if (!layout.next && result.takes.some(row => stashCount(row.id) && equipmentState.bag.some(u => u.g === row.id))) {
    // With a full warehouse, drawing from a placed duplicate can make room for the returned kit.
    layout = presetLayout(target,result.takes,result.returns,true);
  }
  if (!layout.next) layout = presetSwapLayout(target,result.takes,result.returns) || layout;
  if (!layout.next) return fail(layout.issue);
  result.takes=layout.next.actualTakes;result.returns=layout.next.actualReturns;
  result.ok = true;
  result.message = '보유품으로 적용할 수 있습니다.';
  return {result,next:layout.next};
}
function presetPreview(target) {
  return planPreset(target).result;
}
function applyPreset(target) {
  if (!writer) return {ok:false,message:'플레이 중인 탭에서 정비를 확정하세요.'};
  const {result,next} = planPreset(target);
  if (!next) return result;
  const old = {stock:stash,slots:stashSlots,kit:equipmentState,overflow:gearOverflow};
  for (const unit of next.newUnits) unit.uid = newStashUid();
  const instances={};
  for(const [slot,id] of Object.entries(target.worn)) {
    if(!gearSpec(id)) continue;
    const gear=equipmentState.worn[slot]===id?gearWorn(equipmentState,slot):next.donors[id];
    if(!gear) return {ok:false,message:'선택한 장비 실물을 다시 확인하세요.'};
    instances[slot]={...gear,module:target.modules[slot]||null};
  }
  const kit = {...equipmentState,worn:{...target.worn},modules:{...target.modules},instances,bag:next.bag};
  gearOverflow=next.overflow;
  stash = next.stock;
  stashSlots = next.slots;
  equipmentState = kit;
  if (writeSession()) {
    gearPick = null;
    stashSelection = null;
    result.message = '장비와 모듈을 적용했습니다.';
    return result;
  }
  result.ok = false;
  if (equipmentState === kit) {
    gearOverflow=old.overflow;stash = old.stock;
    stashSlots = old.slots;
    equipmentState = old.kit;
    result.message = '저장할 수 없어 정비를 취소했습니다. 창고와 장비를 이전 상태로 복구했습니다.';
  } else {
    // writeSession loaded the newer on-disk revision. Never put the stale transaction back over it.
    result.message = '다른 탭의 최신 기록을 불러왔습니다. 재고와 장비를 다시 확인하세요.';
  }
  result.issues.push(result.message);
  return result;
}
