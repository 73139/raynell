// Array order is part of the save format. Each claimed entry is the unique raid that completed that chapter's return.
const CAMPAIGN_STAGES = [
  {id:'power',title:'전력 복구',item:'food',quantity:2,cr:5000,xp:35,
    description:'발전 시설을 복구하는 작업조에 식량을 보내세요. 현장에서 생환하고 발전 시설을 가동하면 첫 구역의 전력이 돌아옵니다.',
    change:'발전 시설 가동 · 벙커 동시 공사 한도 증가'},
  {id:'water',title:'식수 확보',item:'water',quantity:2,cr:6500,xp:45,
    description:'정수 시설이 가동될 때까지 대원들이 마실 물을 납품하세요. 이번 단계에서 한 번 생환한 뒤 정수 시설의 가동을 확인하세요.',
    change:'정수 시설 가동 · 음료 사용 시 수분 회복량 증가'},
  {id:'med',title:'의무실 가동',item:'bandage',quantity:2,cr:8000,xp:60,
    description:'의무실에서 사용할 응급 물자를 납품하세요. 이번 단계에서 한 번 생환하고 의무실을 가동하면 B-04의 기본 복구가 끝납니다.',
    change:'의무실 가동 · 의료품 사용 시 체력 회복량 증가'}
];
let campaignState={claimed:[],delivered:0,returnId:null};

function validCampaignState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !Array.isArray(state.claimed) || state.claimed.length > CAMPAIGN_STAGES.length ||
      !Number.isSafeInteger(state.delivered) || state.delivered < 0) return false;
  const validRaid = id => Number.isSafeInteger(id) && id > 0;
  if (!state.claimed.every(validRaid) || new Set(state.claimed).size !== state.claimed.length) return false;
  if (state.returnId !== null && (!validRaid(state.returnId) || state.claimed.includes(state.returnId))) return false;
  const stage = CAMPAIGN_STAGES[state.claimed.length];
  return stage ? state.delivered <= stage.quantity : state.delivered === 0 && state.returnId === null;
}
function validCampaignBackup(s) {
  const state = s.campaign;
  if (!validCampaignState(state)) return false;
  // Awards are earmarked for chapters whose actual facilities have already come online. Facilities cannot regress.
  if (state.claimed.some((_,i) => {
    const id = CAMPAIGN_STAGES[i].id, level = s.hideout?.levels?.[id];
    return !Number.isInteger(level) || level < 1 || level > FACILITIES[id].levels.length;
  })) return false;
  const settled = state.returnId === null ? state.claimed : [...state.claimed,state.returnId];
  if (settled.length && (!Number.isSafeInteger(s.career?.returns) || s.career.returns < settled.length)) return false;
  if (s.raid && settled.includes(s.raid.startedAt) && s.field?.result !== 'success') return false;
  const summary = s.lastSummary;
  if (summary) {
    const chapter = settled.indexOf(summary.raidId);
    if (chapter >= 0 && summary.result !== 'success') return false;
    if (summary.campaignStage !== undefined &&
        (chapter < 0 || summary.campaignStage !== CAMPAIGN_STAGES[chapter].id)) return false;
  }
  return true;
}
function loadCampaign(raw) {
  campaignState = validCampaignState(raw)
    ? {claimed:[...raw.claimed],delivered:raw.delivered,returnId:raw.returnId}
    : {claimed:[],delivered:0,returnId:null};
}
function campaignView() {
  const {claimed,delivered,returnId} = campaignState;
  const index = claimed.length, active = CAMPAIGN_STAGES[index] || null;
  const built = Boolean(active && hideoutLevel(active.id) >= 1);
  const build = active && !built ? hideout.builds[active.id] : null;
  const returned = returnId !== null;
  const remaining = active ? active.quantity - delivered : 0;
  return {index,completed:!active,active,done:index,delivered,remaining,available:active ? contractDeliveryCount(active.item) : 0,
    returned,returnId,built,buildEnd:build?.end ?? null,ready:Boolean(active && built && returned && remaining === 0)};
}
// Settlement is the sole event source. Import and render never infer a new return from historical receipts.
function settleCampaignReturn(rating,raidId) {
  const stage = CAMPAIGN_STAGES[campaignState.claimed.length];
  if (!stage || campaignState.returnId !== null || (rating !== 'success' && rating !== 'quick') ||
      !raid || raid.startedAt !== raidId || !Number.isSafeInteger(raidId) || raidId <= 0 ||
      campaignState.claimed.includes(raidId)) return null;
  campaignState = {...campaignState,returnId:raidId};
  return stage.id;
}

function campaignAction(id,action,quantity=1,expectedDelivered) {
  const fail = message => ({ok:false,message});
  if (!writer) return fail('플레이 중인 탭에서 진행하세요.');
  const original = campaignState;
  reconcile();
  if (original !== campaignState) return fail('복구 기록이 바뀌었습니다. 현재 단계를 다시 확인하세요.');
  if (raid) return fail('귀환 정산을 마치고 벙커에서 진행하세요.');
  const progress = campaignView(), stage = progress.active;
  if (!stage || stage.id !== id) return fail('이미 완료했거나 아직 열리지 않은 복구 단계입니다.');
  const previous = {wallet,xp:career.xp,pin:objectivePin};
  let next, inventory, message;
  if (action === 'deliver') {
    if (expectedDelivered !== undefined && expectedDelivered !== progress.delivered)
      return fail('납품 기록이 바뀌었습니다. 현재 남은 수량을 확인하세요.');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > progress.remaining)
      return fail('이번 단계의 남은 납품 수량을 확인하세요.');
    if (progress.available < quantity) return fail('납품할 '+GOODS[stage.item][0]+' 수량이 부족합니다.');
    inventory = npcInventorySnapshot();
    const reserveLoose = progress.built || progress.buildEnd ? {} : FACILITIES[stage.id].levels[0].materials;
    if (!consumeNPCDelivery({[stage.item]:quantity},reserveLoose)) {
      restoreNPCInventory(inventory);
      return fail('재고가 바뀌었습니다. 납품할 물품을 확인하세요.');
    }
    next = {...original,delivered:original.delivered+quantity};
    message = GOODS[stage.item][0]+' '+quantity+'개 납품 · '+next.delivered+' / '+stage.quantity+'개';
  } else if (action === 'claim') {
    if (!progress.ready) return fail('생환·납품·시설 가동 조건을 모두 충족해야 합니다.');
    if (!cashCanCredit(stage.cr) || !Number.isSafeInteger(career.xp+stage.xp))
      return fail('보상 수령 후 보유 한도를 초과합니다.');
    next = {claimed:[...original.claimed,original.returnId],delivered:0,returnId:null};
    wallet += stage.cr;
    career.xp += stage.xp;
    if (objectivePin?.kind === 'campaign' && objectivePin.id === stage.id) {
      const upcoming = CAMPAIGN_STAGES[next.claimed.length];
      objectivePin = upcoming ? {kind:'campaign',id:upcoming.id} : null;
    }
    message = stage.title+' 완료 · '+money(stage.cr)+' · +'+stage.xp+' XP';
  } else return fail('등록되지 않은 복구 작업입니다.');

  campaignState = next;
  if (!writeSession()) {
    // A revision conflict replaced the entire live game. Roll back only the transaction that is still ours.
    if (campaignState !== next) return fail('다른 탭의 최신 기록을 불러왔습니다. 복구 단계를 다시 확인하세요.');
    campaignState = original;
    wallet = previous.wallet;
    career.xp = previous.xp;
    objectivePin = previous.pin;
    if (inventory) restoreNPCInventory(inventory);
    return fail('복구 작업을 저장하지 못해 이전 상태로 복원했습니다.');
  }
  if (inventory) clearNPCDeliverySelection();
  return {ok:true,message};
}
