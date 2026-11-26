// The bunker reply is a single receipt. Relay confirmations belong only to one live sortie.
const FINAL_STATIONS = [
  {zone:0,title:'외곽 전력 중계기',facility:'power',description:'복구된 발전 시설의 전력 신호를 중계합니다.'},
  {zone:1,title:'검문소 정수 신호기',facility:'water',description:'가동 중인 정수 시설의 식수 보급 신호를 중계합니다.'},
  {zone:2,title:'군수 창고 의무 신호기',facility:'med',description:'가동 중인 의무실의 구조 접수 신호를 중계합니다.'}
];
const FINALE_REPLY_TEXT = 'B-04, 여기는 외부 벙커입니다. 세 권역에서 보낸 신호를 모두 수신했습니다. 전력·식수·의료 지원이 가능하다는 소식을 생존자들에게 전달하겠습니다. 다음 교신 때 다시 만납시다.';
let finaleState = {armed:false,attempt:null,reply:null};

function validFinaleZones(zones) {
  return Array.isArray(zones) && zones.length <= FINAL_STATIONS.length &&
    zones.every((zone,i) => Number.isInteger(zone) && zone>=0 && zone<FINAL_STATIONS.length && (!i || zones[i-1] < zone));
}
function validFinaleState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.armed !== 'boolean') return false;
  const validId = value => value && typeof value === 'object' && !Array.isArray(value) &&
    Number.isSafeInteger(value.raidId) && value.raidId > 0;
  if (state.attempt !== null && (!validId(state.attempt) || !validFinaleZones(state.attempt.confirmed))) return false;
  if (state.reply !== null && !validId(state.reply)) return false;
  return Number(state.armed) + Number(state.attempt !== null) + Number(state.reply !== null) <= 1;
}
function validFinaleBackup(s) {
  const state = s.finale;
  if (!validFinaleState(state)) return false;
  const summary=s.lastSummary, report=summary?.finaleAttempt;
  if (report !== undefined && (!report || Array.isArray(report) || !validFinaleZones(report.zones) ||
      !Number.isSafeInteger(summary.raidId) || summary.raidId<=0 || !Number.isInteger(summary.visited) ||
      report.zones.length>summary.visited)) return false;
  if (state.armed || state.attempt || state.reply || report) {
    if (s.campaign?.claimed?.length !== CAMPAIGN_STAGES.length ||
        !FINAL_STATIONS.every(station => s.hideout?.levels?.[station.facility] >= 1) ||
        !MARKET_TRADERS.every(trader => s.contracts?.[trader.id]?.done?.length > 0)) return false;
  }
  if (state.armed && s.raid) return false;
  if (state.attempt && (!s.raid || state.attempt.raidId !== s.raid.startedAt || s.field?.result ||
      s.campaign.claimed.includes(state.attempt.raidId) || state.attempt.raidId===summary?.raidId ||
      !Array.isArray(s.field?.visited) || !state.attempt.confirmed.every(z => s.field.visited.includes(z)))) return false;
  if (state.reply && (!summary || s.campaign.claimed.includes(state.reply.raidId) ||
      !Number.isSafeInteger(s.career?.returns) || s.career.returns <= CAMPAIGN_STAGES.length ||
      (s.raid?.startedAt===state.reply.raidId && s.field?.result!=='success'))) return false;
  if (state.reply && Array.isArray(s.career?.history)) {
    // A receipt can outlive the twelve-report history. When the corresponding report is present, it must agree.
    const past = s.career.history.find(row=>row && row.at-row.elapsed===state.reply.raidId);
    if (past && (!['success','quick'].includes(past.rating) || past.visited!==FINAL_STATIONS.length)) return false;
  }
  if (summary?.finaleReply !== undefined && summary.finaleReply !== true) return false;
  const ending=Boolean(state.reply && summary?.raidId===state.reply.raidId);
  if (Boolean(summary?.finaleReply) !== ending) return false;
  if (report && summary.result==='success' && report.zones.length===FINAL_STATIONS.length && !ending) return false;
  return !ending || (summary.result==='success' && report?.zones.length===FINAL_STATIONS.length);
}
function loadFinale(raw) {
  finaleState = validFinaleState(raw) ? {
    armed:raw.armed,
    attempt:raw.attempt && {raidId:raw.attempt.raidId,confirmed:[...raw.attempt.confirmed]},
    reply:raw.reply && {raidId:raw.reply.raidId}
  } : {armed:false,attempt:null,reply:null};
}
function finaleView() {
  const {armed,attempt,reply}=finaleState;
  const chapterReady=campaignState.claimed.length===CAMPAIGN_STAGES.length;
  const facilities=FINAL_STATIONS.map(({facility:id})=>({id,name:FACILITIES[id].name,built:hideoutLevel(id)>=1}));
  const traders=MARKET_TRADERS.map(({id,name})=>({id,name,done:Boolean(traderContracts[id]?.done.length)}));
  const unlocked=chapterReady && facilities.every(f=>f.built) && traders.every(t=>t.done);
  const active=Boolean(attempt && raid?.startedAt===attempt.raidId && !field.result);
  const complete=Boolean(reply);
  let status='locked';
  if (complete) status='complete';
  else if (active) status='active';
  else if (armed) status='armed';
  else if (unlocked) status='available';
  const stations=FINAL_STATIONS.map(s=>({...s,confirmed:complete || Boolean(active && attempt.confirmed.includes(s.zone))}));
  let blockReason='';
  if (!active) blockReason='벙커에서 최종 작전을 준비하고 출격하세요.';
  else if (field.contact) blockReason='조우에 대응한 뒤 신호를 보내세요.';
  else if (field.journey || field.action) blockReason='진행 중인 이동이나 행동이 끝나면 신호를 보낼 수 있습니다.';
  else if (field.open) blockReason='열어 둔 수색 대상을 닫고 신호를 보내세요.';
  else if (attempt.confirmed.includes(raid.zone)) blockReason='이 권역의 신호를 이미 보냈습니다.';
  return {status,unlocked,armed,active,complete,chapterReady,facilities,traders,stations,
    canSignal:!blockReason,blockReason,raidId:active?attempt.raidId:null,reply};
}
function startFinaleRaid(raidId) {
  if (!finaleState.armed || !raid || raid.startedAt!==raidId) return false;
  finaleState={armed:false,attempt:{raidId,confirmed:[]},reply:null};
  return true;
}
function settleFinaleReturn(rating,raidId) {
  const attempt=finaleState.attempt;
  if (!attempt || attempt.raidId!==raidId || !raid || raid.startedAt!==raidId) return false;
  const received=(rating==='success' || rating==='quick') && attempt.confirmed.length===FINAL_STATIONS.length &&
    FINAL_STATIONS.every(({zone})=>field.visited?.includes(zone));
  finaleState={armed:false,attempt:null,reply:received?{raidId}:null};
  return received;
}
function finaleAction(action,expectedZone,expectedRaidId) {
  const fail=message=>({ok:false,message});
  if (!writer) return fail('플레이 중인 탭에서 진행하세요.');
  const original=finaleState;
  reconcile();
  if (original!==finaleState) return fail('작전 기록이 갱신되었습니다. 현재 상태를 확인하세요.');
  const state=finaleView();
  let next,message;
  if (action==='arm') {
    if (raid || state.status!=='available') return fail('벙커에서 복구 단계와 네 상인의 협력 상태를 확인하세요.');
    next={...original,armed:true};message='최종 작전을 준비했습니다. 다음 출격에서 세 권역의 신호를 보내세요.';
  } else if (action==='cancel') {
    if (raid || !state.armed) return fail('출격 대기 중인 최종 작전이 없습니다.');
    next={...original,armed:false};message='최종 작전 출격 준비를 해제했습니다.';
  } else if (action==='signal') {
    if (!state.active || expectedRaidId!==state.raidId || expectedZone!==raid.zone)
      return fail('현재 출격과 권역의 중계기를 확인하세요.');
    if (!state.canSignal) return fail(state.blockReason);
    const confirmed=[...original.attempt.confirmed,expectedZone].sort((a,b)=>a-b);
    next={...original,attempt:{raidId:state.raidId,confirmed}};
    message=FINAL_STATIONS[expectedZone].title+' 송신 완료 · '+confirmed.length+' / '+FINAL_STATIONS.length+'권역';
  } else return fail('등록되지 않은 작전 명령입니다.');
  finaleState=next;
  if (writeSession()) return {ok:true,message};
  if (finaleState!==next) return fail('다른 탭의 최신 작전 기록을 불러왔습니다.');
  finaleState=original;
  return fail('작전을 저장할 수 없어 직전 상태로 복원했습니다.');
}
