// Facility levels, building sites, and production jobs share the raid save.
let hideout;
let hideoutMessage = '';
const WARD_SHEET='rl_bp_dressing', WARD_RECIPE='folded-dressing';
const WARD_DRESSING={name:'야전 처치포 접기',minutes:2,inputs:{gauze:1,bandage:1},outputs:{rl_craft_dressing:1}};
function wardUid(uid){
  return typeof uid==='string' && /^s-[a-z0-9-]{1,72}$/.test(uid);
}
function wardRecord(record){
  return record!==null && typeof record==='object' && typeof record.registered==='boolean' &&
    Array.isArray(record.waiting) && record.waiting.every(wardUid) && new Set(record.waiting).size===record.waiting.length;
}
// Numbered legacy jobs keep their indices. Earned recipes always store a name.
function facilityRecipeKey(value){
  return typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
}
function facilityRecipe(id,key){
  if(id==='kitchen'&&isSurveyRecipe(key))return SURVEY_RECIPES[key];
  return id==='med' && key===WARD_RECIPE ? WARD_DRESSING : FACILITY_PRODUCTION[id]?.[key];
}
function facilityRecipeAvailable(id,key){
  if(isSurveyRecipe(key))return id==='kitchen'&&surveyKitchenUnlocked(career.done,hideoutLevel('kitchen'));
  if(key===WARD_RECIPE)return id==='med' && hideout.wardManual.registered && hideoutLevel('med')>=1;
  return Number.isInteger(key) && key>=0 && key<hideoutLevel(id) && Boolean(facilityRecipe(id,key));
}
function validWardBackup(s){
  const book=s.hideout?.wardManual;
  if(book!==undefined && !wardRecord(book))return false;
  if(!validWardTrialBackup(s))return false;
  for(const [id,job] of Object.entries(s.hideout?.production||{})){
    if(job?.recipe===WARD_RECIPE && (id!=='med' || !book?.registered || !(s.hideout.levels?.med>=1) ||
      !Number.isSafeInteger(job.end) || job.end<=0))return false;
  }
  const reserved=new Set(book?.waiting||[]),other=new Set((s.cash?.pocket||[]).map(u=>u?.uid));
  function track(unit,box=false){
    if(!unit)return false;
    if(unit.g!==WARD_SHEET){other.add(unit.uid);return unit.sheetUid===undefined;}
    const uid=box?unit.sheetUid:unit.uid;
    if(!wardUid(uid) || reserved.has(uid) || (!box && unit.sheetUid!==undefined) || unit.w!==1 || unit.h!==1)return false;
    reserved.add(uid);return true;
  }
  const slots=s.stashSlots;
  if(!Array.isArray(slots) || slots.filter(unit=>unit?.g===WARD_SHEET).length!==(s.stash?.[WARD_SHEET]||0))return false;
  for(const unit of slots){
    if(unit?.g===WARD_SHEET && slots.some(u=>u && u!==unit && unit.x<u.x+u.w && unit.x+1>u.x && unit.y<u.y+u.h && unit.y+1>u.y))return false;
    if(!track(unit) || !Array.isArray(unit.contents||[]) || !(unit.contents||[]).every(u=>track(u)))return false;
  }
  const units=[s.equipment?.bag,s.field?.bag,...(Array.isArray(s.field?.gearGround)?s.field.gearGround:[])];
  if(units.some(list=>!Array.isArray(list) || !list.every(u=>track(u))))return false;
  for(const [key,box] of Object.entries(s.field?.boxes||{})){
    if(!Array.isArray(box?.items))return false;
    const [z,i]=key.split('-').map(Number),source=FIELD_ZONES[z]?.boxes[i]?.[2];
    if(!box.items.every(u=>track(u,true) && (u.g!==WARD_SHEET || ['med','desk'].includes(source))))return false;
  }
  return [...reserved].every(uid=>!other.has(uid));
}
function receiveWardSheet(uid){
  if(!wardUid(uid) || hideout.wardManual.waiting.includes(uid) || stashSlots.some(u=>u.uid===uid))return false;
  if(!addStashGoods(WARD_SHEET,1,null,uid))hideout.wardManual.waiting.push(uid);
  return true;
}
function updateWardManual(action,uid){
  if(!writer || raid || !wardUid(uid))return '벙커에서 보관 중인 원본을 다시 선택하세요.';
  const owner=hideout,book=owner.wardManual;
  const pending=book.waiting.includes(uid),loose=stashSlots.some(u=>u.g===WARD_SHEET && u.uid===uid);
  if(!pending && !loose)return '작업지침이 이동했습니다. 원본의 위치를 확인하세요.';
  if(action==='manual-register' && book.registered)return '이미 등록한 작업지침입니다.';
  if(action==='manual-receive' && !pending)return '인계칸에서 옮길 원본을 선택하세요.';
  if(action!=='manual-register' && action!=='manual-receive')return '';
  const beforeStock={...stash},beforeSlots=stashSlots.slice();
  const register=action==='manual-register';
  if(register && loose && !takeStashGoods(WARD_SHEET,1,uid))return '작업지침을 다시 선택하세요.';
  if(!register && !addStashGoods(WARD_SHEET,1,null,uid))return '창고에 1×1 빈 칸을 마련하세요.';
  owner.wardManual={registered:register||book.registered,waiting:book.waiting.filter(id=>id!==uid)};
  if(writeSession())return register?'원본 1장을 등록했습니다. 의무실 Lv.1부터 야전 처치포를 만들 수 있습니다.':'원본을 창고에 입고했습니다.';
  if(owner!==hideout)return '다른 탭의 최신 기록을 불러왔습니다. 원본의 위치를 확인하세요.';
  owner.wardManual=book;stash=beforeStock;stashSlots=beforeSlots;
  return '저장할 수 없어 원본과 등록 상태를 복원했습니다.';
}
function wardSaleNote(quantity, context){
  if(!quantity || raid || hideout.wardManual.registered)return '';
  let owned=0;
  for(const row of physicalPossessionLocations()){
    if(row.id===WARD_SHEET)owned+=row.quantity;
  }
  if(quantity>owned)return '';
  const remainder=owned-quantity;
  const sale=context==='preview'?'선택한 원본 포함 ':context==='tray'?'판매대 원본 ':'원본 ';
  return '<p class="mini-field ward-sale-note" id="ward-sale-'+context+'"><strong>의무실 등록 가능</strong> · '+
    '원본 1장을 등록하면 의무실 Lv.1부터 야전 처치포를 만들 수 있습니다.<br>'+
    sale+quantity+'장 판매 시 '+(remainder?'보유 원본 '+remainder+'장 남음':'마지막 보유 원본까지 판매')+'</p>';
}
function wardManualPanel(){
  const book=hideout.wardManual;
  const room=book.waiting.length>0 && Boolean(firstFit(stashSlots,stashSize(),1,1));
  const loose=stashSlots.filter(u=>u.g===WARD_SHEET);
  const entries=[...loose.map(u=>({uid:u.uid,place:'창고 '+(u.y+1)+'행 '+(u.x+1)+'열'})),
    ...book.waiting.map(uid=>({uid,place:'의무실 인계칸',pending:true}))];
  const action=(name,uid,label,disabled=false)=>`<button type="button" data-hideout="${name}" data-id="med" data-uid="${esc(uid)}" ${disabled?'disabled':''}>${label}</button>`;
  const seen=book.registered||entries.length;
  return `<section class="facility-operations" data-manual-panel><h3>${seen?'야전 처치포 작업지침':'의무실 작업지침'}</h3>
    <p class="mini-field" data-manual-state>${book.registered?'제조법 등록 완료 · 의무실 Lv.1에서 제작 가능. 여분 원본은 보관하거나 강태식에게 판매할 수 있습니다.':seen?'원본 1장을 소비해 제조법을 영구 등록합니다. 의무실 Lv.1부터 제작할 수 있습니다.':'벙커 외곽의 임시 진료소, 폐쇄 검문소의 경비 초소와 검역 천막에서 작업지침을 찾을 수 있습니다. 발견한 원본을 가방에 넣고 탈출하세요. 보관함·출격 가방에 보관한 원본은 창고로 꺼내 등록하세요.'}</p>
    ${entries.map(e=>`<div class="facility-recipe" data-manual-copy="${esc(e.uid)}" tabindex="-1"><div><b>작업지침 1장</b><small>${e.place}${e.pending?(room?' · 창고 입고 가능':' · 창고 빈 칸 필요'):''}</small></div>
    <div>${!book.registered?action('manual-register',e.uid,'원본 1장 등록',Boolean(raid)):''}${e.pending?action('manual-receive',e.uid,'창고로 옮기기',Boolean(raid)||!room):''}</div></div>`).join('')}</section>`;
}

function loadHideout(saved) {
  hideout = {levels:{}, builds:{}, production:{}, history:[],
    wardManual:wardRecord(saved?.wardManual)?{registered:saved.wardManual.registered,waiting:[...saved.wardManual.waiting]}:{registered:false,waiting:[]}};
  for (const [id, facility] of Object.entries(FACILITIES)) {
    const max = facility.levels.length;
    const level = saved?.levels?.[id];
    hideout.levels[id] = Number.isInteger(level) && level >= 0 && level <= max ? level : 0;
    const build = saved?.builds?.[id];
    if (build?.tier === hideout.levels[id] + 1 && build.tier <= max && Number.isSafeInteger(build.end) && build.end > 0) {
      hideout.builds[id] = {tier:build.tier, end:build.end};
    }
    const order = saved?.production?.[id];
    if (order && facilityRecipeAvailable(id,order.recipe) && Number.isSafeInteger(order.end) && order.end > 0) {
      hideout.production[id] = {recipe:order.recipe, end:order.end};
    }
  }
  hideout.wardTrial=validWardTrialRecord(saved?.wardTrial,hideout.wardManual.registered,hideoutLevel('med'))?saved?.wardTrial??null:null;
  wardTrialMessage='';
  if (Array.isArray(saved?.history)) hideout.history = saved.history.filter(s => typeof s === 'string').slice(0, 5);
}
function hideoutLevel(id) { return hideout?.levels?.[id] || 0; }
function hideoutRecoveryBonus(stat) { return hideoutLevel({hp:'med',energy:'kitchen',water:'water'}[stat]) * 3; }
function adjustHideoutActionMs(type, ms, level) {
  const percent = type === 'scan' ? (level ?? hideoutLevel('light')) * 8 : type === 'move' ? (level ?? hideoutLevel('rest')) * 5 : 0;
  return Math.round(ms * (100 - percent) / 100);
}
function productionMs(recipe) {
  return Math.round(recipe.minutes * 60000 * (100 - hideoutLevel('vent') * 5) / 100);
}
function facilityEffect(id, level) {
  if (id === 'stash') {
    const [cols,rows] = stashSize(level);
    return `격자 창고 ${cols} × ${rows} · 총 ${cols*rows}칸`;
  }
  const passives = {
    power:`동시 건설 가능 시설 ${level + 1}곳`,
    light:`레이드 주변 탐색 시간 ${level * 8}% 단축`,
    vent:`새로 시작하는 생산·의뢰 소요 시간 ${level * 5}% 단축`,
    rest:`레이드 지역 이동 시간 ${level * 5}% 단축`
  };
  if (passives[id]) return passives[id];
  const bonus = {med:'의료품 체력 회복',water:'음료 수분 회복',kitchen:'식량 기력 회복'}[id];
  return `${FACILITY_PRODUCTION[id][level - 1].name} 이용 가능${bonus ? ' · ' + bonus + ' +' + level * 3 : ''}`;
}
function facilityReceipt(s) {
  hideoutMessage = '';
  hideout.history.unshift(s);
  hideout.history.length = Math.min(5, hideout.history.length);
}
function advanceHideout(now = Date.now()) {
  if (!hideout) return false;
  let changed = false;
  for (const [id, job] of Object.entries(hideout.builds)) {
    if (now < job.end) continue;
    hideout.levels[id] = job.tier;
    delete hideout.builds[id];
    if (id === 'stash') refreshStashLayout();
    facilityReceipt(`${FACILITIES[id].name} Lv.${job.tier} 건설 완료`);
    settlementNeedsCommit=true;
    changed = true;
  }
  for (const [id, job] of Object.entries(hideout.production)) {
    if (now < job.end) continue;
    const recipe = facilityRecipe(id,job.recipe);
    // Preflight every output before consuming the outstanding job.
    if(Object.entries(recipe.outputs||{}).some(([item,qty])=>!Number.isSafeInteger(stashCount(item)+qty)))continue;
    if(recipe.reward && typeof cashCanCredit==='function' && !cashCanCredit(recipe.reward))continue;
    for (const [item, qty] of Object.entries(recipe.outputs || {})) addStashGoods(item, qty);
    if (recipe.reward) wallet += recipe.reward;
    settlementNeedsCommit=true;
    delete hideout.production[id];
    facilityReceipt(`${recipe.name} 완료 · ${productionResult(recipe)} 지급`);
    changed = true;
  }
  return changed;
}
function missingMaterials(inputs) {
  return Object.entries(inputs).some(([id,qty]) => stashUnfittedCount(id) < qty);
}
function facilityBuildStatus(id, tier) {
  const f = FACILITIES[id];
  const step = f?.levels[tier - 1];
  if (!step) return '잘못된 시설 단계';
  if (hideoutLevel(id) >= tier) return '건설 완료';
  if (hideout.builds[id]) return '공사 진행 중';
  if (hideout.production[id]) return '시설 작업 진행 중';
  if (tier !== hideoutLevel(id) + 1) return '이전 단계 건설 필요';
  if (step.requires.some(r => hideoutLevel(r.facility) < r.level)) return '선행 시설 필요';
  if (raid) return '귀환 후 건설 가능';
  if (Object.keys(hideout.builds).length >= hideoutLevel('power') + 1) return '동시 건설 한도 도달';
  if (wallet < step.costCR) return '건설 자금 부족';
  if (missingMaterials(step.materials)) return '창고 재료 부족';
  return '';
}
function productionStatus(id,index) {
  if (!facilityRecipeAvailable(id,index)) return '시설 단계 부족';
  if (hideout.builds[id]) return '건설 진행 중';
  if (hideout.production[id]) return '작업 진행 중';
  if (raid) return '귀환 후 작업 가능';
  return missingMaterials(facilityRecipe(id,index).inputs) ? '재료 부족' : '';
}
function productionResult(recipe) {
  const goods = Object.entries(recipe.outputs || {}).map(([id,n]) => `${GOODS[id][0]} ×${n}`);
  if (recipe.reward) goods.push(recipe.reward.toLocaleString('ko-KR') + ' CR');
  return goods.join(' · ');
}
function handleHideout(d) {
  const id = d.id;
  if (!Object.hasOwn(FACILITIES,id)) return;
  reconcile();
  if(d.hideout==='ward-referral'){openWardTrial();return;}
  if(d.hideout==='manual-register' || d.hideout==='manual-receive'){
    if(id==='med'){hideoutMessage=updateWardManual(d.hideout,d.uid);renderKeep();}
    return;
  }
  const building = d.hideout === 'build';
  if (!building && d.hideout !== 'produce') return;
  const tier = Number(d.tier), index = facilityRecipeKey(d.recipe);
  if (!building && !Number.isInteger(index) && index!==WARD_RECIPE && !isSurveyRecipe(index))return;
  if (!building && !writer){hideoutMessage='플레이 중인 탭에서 제작하세요.';renderKeep();return;}
  const reason = building ? facilityBuildStatus(id,tier) : productionStatus(id,index);
  if (reason) {hideoutMessage=reason;renderKeep();return;}
  const job = building ? FACILITIES[id].levels[tier-1] : facilityRecipe(id,index);
  const before = {owner:hideout,stock:{...stash},slots:stashSlots.slice(),overflow:gearOverflow.slice(),wallet};
  if (!stashConsume(building ? job.materials : job.inputs)) {
    hideoutMessage='창고 재료가 부족합니다.';renderKeep();return;
  }
  const jobs = building ? hideout.builds : hideout.production;
  if (building) {
    wallet -= job.costCR;
    jobs[id] = {tier,end:Date.now()+job.durationMinutes*60000};
    hideoutMessage=FACILITIES[id].name+' Lv.'+tier+' 공사를 시작했습니다.';
  } else {
    jobs[id] = {recipe:index,end:Date.now()+productionMs(job)};
    hideoutMessage=job.name+' 작업을 시작했습니다.';
  }
  if (persist() === false) {
    if (hideout === before.owner) {
      stash=before.stock;stashSlots=before.slots;gearOverflow=before.overflow;wallet=before.wallet;delete jobs[id];
      hideoutMessage='저장할 수 없어 작업을 취소했습니다. 재료와 자금을 복원했습니다.';
    } else hideoutMessage='다른 탭의 최신 기록을 불러왔습니다. 시설 상태를 확인하세요.';
  }
  renderKeep();
}
function hideoutTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms/1000));
  const min = Math.floor(seconds/60);
  return (min ? min + '분 ' : '') + (seconds % 60) + '초';
}
function facilityTimer(end) {
  return `<time class="facility-clock" data-facility-end="${end}">${hideoutTime(end-Date.now())}</time>`;
}
function updateHideoutClock() {
  if (page !== 'bunker' && page !== 'facility' && page !== 'campaign') return;
  for (const el of document.querySelectorAll('[data-facility-end]')) {
    const time = hideoutTime(Number(el.dataset.facilityEnd) - Date.now());
    if (el.textContent !== time) el.textContent = time;
  }
}
function facilityFittedNote(id, available = stashUnfittedCount(id)) {
  const fitted = stashRemovableCount(id) - available;
  return fitted ? ' · 모듈 장착 '+fitted+'개 제외' : '';
}

function facilityMaterials(inputs) {
  return `<div class="db-list facility-materials">${Object.entries(inputs).map(([id,qty]) => {
    const qtyHeld = stashUnfittedCount(id), g = GOODS[id];
    return `<button data-db="lookup" data-id="${id}">${ico(g[4])}<span><b>${g[0]}</b><small>${itemSources(id)}</small></span><span class="${qtyHeld < qty ? 'facility-deficit' : 'facility-ready'}">${qtyHeld} / ${qty}개${facilityFittedNote(id,qtyHeld)}</span></button>`;
  }).join('')}</div>`;
}
function productionIngredients(facility,recipe,inputs) {
  const rows=Object.entries(inputs).map(([item,need])=>{
    const held=stashUnfittedCount(item),shortage=Math.max(0,need-held);
    const info=`<span>${GOODS[item][0]} · ${held} / ${need}${facilityFittedNote(item,held)}</span>`;
    const attrs=`data-craft-input="${item}" data-shortage="${shortage}"`;
    if(!shortage)return `<span ${attrs} tabindex="-1">${info}<span>충족</span></span>`;
    return `<button type="button" ${attrs} data-db="craft-ingredient" data-id="${item}" data-facility="${facility}" data-recipe="${recipe}">${info}<span>${shortage}개 부족 · 수급처 ›</span></button>`;
  });
  const caption=hideout.production[facility]?.recipe===recipe?'다음 제작 · 창고 사용 가능 / 필요':'창고 사용 가능 / 필요';
  return rows.length?`<small>${caption}</small><div class="craft-inputs">${rows.join('')}</div>`:'<small>소모 재료 없음</small>';
}
function facilityProductionPanel(id) {
  const level = hideoutLevel(id);
  const list = FACILITY_PRODUCTION[id];
  const manual=id==='med'?wardManualPanel()+wardTrialWardLink():'';
  if (!level || !list) return manual;
  const available=list.slice(0,level).map((recipe,i)=>[recipe,i]);
  if(id==='med' && hideout.wardManual.registered)available.push([WARD_DRESSING,WARD_RECIPE]);
  if(id==='kitchen' && surveyKitchenUnlocked(career.done,level))available.push(...Object.entries(SURVEY_RECIPES).map(([key,recipe])=>[recipe,key]));
  const job = hideout.production[id];
  return manual+`<section class="facility-operations"><h3>시설 작업</h3>
    ${job ? `<p class="facility-current">${facilityRecipe(id,job.recipe).name} · ${facilityTimer(job.end)} 남음</p>` : ''}
    ${available.map(([r,i]) => {
      const status = productionStatus(id,i);
      return `<div class="facility-recipe" data-production-recipe="${i}"><div><b>${r.name}</b>${productionIngredients(id,i,r.inputs)}<small>지급 · ${productionResult(r)}</small>${i===WARD_RECIPE?'<small>사용 시 체력 +'+(28+hideoutRecoveryBonus('hp'))+' · 한 칸에 휴대</small>':isSurveyRecipe(i)?surveyRecipeEffect(i):''}</div><button data-hideout="produce" data-id="${id}" data-recipe="${i}" ${status ? 'disabled' : ''}>${status || '시작'}<small>${hideoutTime(productionMs(r))}</small></button></div>`;
    }).join('')}
    <p class="mini-field">완료된 물품과 대금은 창고와 지갑에 자동 지급됩니다.</p></section>`;
}
function bunkerFacilityDetail() {
  const id = facilitySelected, f = FACILITIES[id], tier = facilityTier, step = f.levels[tier - 1];
  const level = hideoutLevel(id), job = hideout.builds[id];
  const status = facilityBuildStatus(id,tier);
  return `<div class="db-detail-title">${ico('tool')}<div><h2>${f.name}</h2><p>${f.purpose} · ${level ? '가동 Lv.' + level : '미건설'}</p></div></div>
    <div class="level-tabs">${f.levels.map(s => `<button data-db="tier" data-tier="${s.level}" aria-pressed="${s.level === tier}">Lv.${s.level}</button>`).join('')}</div>
    <p class="facility-effect"><b>Lv.${tier} 효과</b> ${facilityEffect(id,tier)}</p>
    ${job ? `<p class="facility-current">Lv.${job.tier} 공사 중 · ${facilityTimer(job.end)} 남음</p>` : ''}
    <div class="facility-bill"><span>건설비 <b>${money(step.costCR)}</b></span><span>공사 기간 <b>${step.durationMinutes}분</b></span></div>
    <h3>선행 시설</h3><div class="db-prereq">${step.requires.map(r => `<button data-db="facility" data-id="${r.facility}" data-tier="${r.level}">${FACILITIES[r.facility].name} Lv.${r.level} · ${hideoutLevel(r.facility)>=r.level?'충족':'미충족'}</button>`).join('') || '없음'}</div>
    <h3>건설 재료 <small>창고 사용 가능 / 필요</small></h3>${facilityMaterials(step.materials)}
    <button class="primary facility-build" data-hideout="build" data-id="${id}" data-tier="${tier}" ${status?'disabled':''}>${status || '재료와 건설비를 지불하고 Lv.' + tier + ' 건설'}</button>
    ${facilityProductionPanel(id)}`;
}
function bunkerHubPage() {
  const levels = Object.values(hideout.levels);
  const buildJobs = Object.keys(hideout.builds);
  const orders = Object.keys(hideout.production);
  const jobs = [
    ...buildJobs.map(id => [id, `Lv.${hideout.builds[id].tier} 건설`, hideout.builds[id].end]),
    ...orders.map(id => [id, facilityRecipe(id,hideout.production[id].recipe).name, hideout.production[id].end])
  ];
  const jobOverview = jobs.length ? `<div class="facility-job-list"><h3>진행 중인 작업</h3>${jobs.map(([id,title,end])=>`<button data-db="facility" data-id="${id}" data-tier="${hideout.builds[id]?.tier || hideoutLevel(id)}"><b>${FACILITIES[id].name}</b><span>${title}</span>${facilityTimer(end)}</button>`).join('')}</div>` : '';
  return head('05 / BUNKER ACCESS','하이드아웃','창고 재료로 시설을 짓고 보급품을 생산합니다.') + `
    <div class="facility-account">
      <div><small>운영 자금</small><b>${money(wallet)}</b></div>
      <div><small>가동 시설</small><b>${levels.filter(n=>n>0).length} / ${levels.length}</b></div>
      <div><small>동시 건설</small><b>${buildJobs.length} / ${1 + hideoutLevel('power')}</b></div>
    </div>
    <div class="db-summary facility-links"><button data-page="stash">창고</button><button data-page="inventory">출격 장비</button><button data-page="catalog">물품 도감</button><button data-page="map">작전 지도</button></div>
    ${raid?'<p class="facility-current">레이드 종료 후 벙커로 복귀하면 건설과 생산을 시작할 수 있습니다.</p>':''}
    <div class="facility-feedback" role="status">${esc(hideoutMessage || hideout.history[0] || '')}</div>
    ${jobOverview}
    <div class="db-layout facility-layout"><section class="panel facility-directory"><h2>시설 목록</h2>
    <div class="db-list facilities">${Object.entries(FACILITIES).map(([id,f]) => {
      const level=hideoutLevel(id), tier=hideout.builds[id]?.tier || Math.min(level+1,3);
      const state = hideout.builds[id] ? '건설 중' : hideout.production[id] ? '작업 중' : level ? 'Lv.'+ level : '미건설';
      return `<button data-db="facility" data-id="${id}" data-tier="${tier}" aria-pressed="${id===facilitySelected}">${ico('tool')}<span><b>${f.name}</b><small>${f.purpose}</small></span><span>${state}</span></button>`;
    }).join('')}</div></section><section class="panel" id="facility-detail">${bunkerFacilityDetail()}</section></div>`;
}
