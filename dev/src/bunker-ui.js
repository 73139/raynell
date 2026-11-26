// The same career, orders and facilities are used by the raid settlement and the terminal.
let bunkerOrderSelected = 'scout';
let bunkerOrderFilter = 'all';
let bunkerHistoryRow = -1;
let bunkerHistoryLimit = 5;
const BUNKER_ROOMS = ['power','stash','workshop','rest'];
const BUNKER_GLYPHS = {
  power:'ϟ', light:'☼', vent:'≋', water:'◈', workshop:'⚒', stash:'▤',
  med:'✚', rest:'▱', kitchen:'♨', comms:'⌁', intel:'◉', security:'⬡',
  heat:'♨', hygiene:'◌', farm:'♧', repair:'⚒', server:'▥', recycle:'⟲'
};
function bunkerHeading(number,title,note){
  return `<header class="bu-head"><h1><span>${number}</span> ${title}</h1><p>${note}</p></header>`;
}
function bunkerPicture(stem,alt,cls=''){
  return `<img class="bu-picture ${cls}" src="${artURL(stem)}" alt="${alt}" draggable="false">`;
}
function bunkerProgress(value,max,label){
  const ratio=Math.min(100,max>0?Math.round(value/max*100):0);
  return `<div class="bu-progress" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.min(value,max)}"><i style="width:${ratio}%"></i></div>`;
}
function bunkerHistoryDate(value){
  if(!Number.isSafeInteger(value)||value<=0)return '—';
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return '—';
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function bunkerHistoryCash(value){
  if(!Number.isSafeInteger(value))return '—';
  return (value>0?'+':'')+money(value);
}
function bunkerHistoryDetail(row){
  const stat=n=>Number.isSafeInteger(n)?n:'—';
  const items=new Map();
  let cashDetail='';
  if(Number.isSafeInteger(row.carriedCash)){
    const returned=row.rating==='quick'||row.rating==='success';
    cashDetail=`<p><b>정산 시 지갑 변동</b> ${bunkerHistoryCash(row.cash)} · 휴대 지폐 ${returned?'회수':'손실'} ${money(row.carriedCash)} · 의뢰 보상 ${money(row.commission)} · 탈출 비용 ${money(row.cost)}</p>`;
  }else if(Number.isSafeInteger(row.cash)){
    cashDetail=`<p><b>이전 정산 기록</b> ${bunkerHistoryCash(row.cash)} · 당시 기록에는 휴대 지폐 금액이 없습니다.</p>`;
  }
  for(const id of Array.isArray(row.goods)?row.goods:[]){
    if(Object.hasOwn(GOODS,id))items.set(id,(items.get(id)||0)+1);
  }
  return `<div class="bu-log-detail"><dl><div><dt>탈출구</dt><dd>${esc(row.exit||'—')}</dd></div><div><dt>방문 지역</dt><dd>${stat(row.visited)}</dd></div><div><dt>수색 완료</dt><dd>${stat(row.searched)}</dd></div><div><dt>교전 승리</dt><dd>${stat(row.victories)}</dd></div></dl>
    ${cashDetail}
    ${Array.isArray(row.goods)?`<p><b>회수 물품</b> ${[...items].map(([id,n])=>esc(GOODS[id][0])+' ×'+n).join(' · ')||'없음'}</p>`:'<p>이전 버전에서 저장된 기록입니다. 당시 저장된 항목만 표시됩니다.</p>'}
    ${row.orderName?`<p><b>의뢰 완료</b> ${esc(row.orderName)} · ${bunkerHistoryCash(row.commission)} · +${Number(row.missionXp)} XP</p>`:''}</div>`;
}
function recordsView(){
  const level=playerLevel(), ceiling=150*level*level, start=150*(level-1)*(level-1);
  const xp=career.xp, percent=Math.floor((xp-start)/(ceiling-start)*100), history=career.history;
  const rows=history.slice(0,bunkerHistoryLimit).map((row,i)=>{
    const rating=Object.hasOwn(ENDINGS,row.rating)?row.rating:'expired';
    return `<tr><td>${bunkerHistoryDate(row.at)}</td><td>${Number.isInteger(row.zone)&&FIELD_ZONES[row.zone]?esc(FIELD_ZONES[row.zone].name):'—'}</td><td><span class="bu-result ${rating}">${ENDINGS[rating][1]}</span></td><td>${formatRaid(row.elapsed)}</td><td>${Number.isSafeInteger(row.carriedCash)?bunkerHistoryCash(row.cash):'이전 기록'}</td><td>+${Number(row.xp)||0} XP</td><td><button class="bu-row-open" data-bui="history" data-index="${i}" aria-expanded="${bunkerHistoryRow===i}" aria-label="출격 기록 ${i+1} 상세">${bunkerHistoryRow===i?'−':'≡'}</button></td></tr>${bunkerHistoryRow===i?`<tr><td colspan="7">${bunkerHistoryDetail(row)}</td></tr>`:''}`;
  }).join('');
  return `<div class="bu-screen">${bunkerHeading('07','대원 기록','B-04 벙커 대원 파일')}
    <div class="bu-record-layout"><figure class="bu-portrait">${bunkerPicture('bunker-operator','B-04 현장 대원')}<figcaption>대원 Lv. ${level}</figcaption></figure>
    <div class="bu-record-main bu-box"><h2>기본 정보</h2><dl class="bu-profile"><div><dt>호출명</dt><dd>RL-3174</dd></div><div><dt>소속</dt><dd>B-04 벙커</dd></div><div><dt>역할</dt><dd>현장 조사</dd></div><div><dt>상태</dt><dd>${raid?(field.result?'귀환 대기':'작전 중'):'작전 가능'}</dd></div></dl>
    <section class="bu-xp"><div><b>대원 경험치</b><span>${xp.toLocaleString('ko-KR')} / ${ceiling.toLocaleString('ko-KR')} XP</span></div>${bunkerProgress(xp-start,ceiling-start,'현재 레벨 경험치')}<small>Lv. ${level} 진행률 ${percent}%</small></section>
    <h2>작전 기록 <small>전체</small></h2><div class="bu-stats">
    ${[['출격',career.sorties,'↗'],['귀환',career.returns,'⇥'],['교전 승리',career.victories||0,'⌖']].map(([title,n,icon])=>`<div><b aria-hidden="true">${icon}</b><span>${title}</span><strong>${n} <small>회</small></strong></div>`).join('')}</div>
    ${career.victoriesFrom?'<p class="bu-minor">교전 승리는 '+(career.victoriesFrom+1)+'번째 출격부터 집계됩니다.</p>':''}
    ${survivorNavLink()}${injurySummaryMarkup(lastSummary,'최근 출격 부상·치료 기록')}<h2>최근 출격 기록 <small>${history.length}회</small></h2>${rows?`<div class="bu-table-wrap"><table><thead><tr>${['일시','지역','작전 결과','경과 시간','정산 시 지갑 변동','획득 XP','상세'].map(s=>'<th scope="col">'+s+'</th>').join('')}</tr></thead><tbody>${rows}</tbody></table></div>${history.length>5?`<button class="bu-more" data-bui="history-limit">${bunkerHistoryLimit===5?'이전 기록 보기':'최근 5회만 보기'}</button>`:''}`:'<div class="bu-empty">첫 출격을 마치면 작전 결과가 이곳에 기록됩니다.</div>'}</div></div></div>`;
}
function bunkerOrderState(q){
  return career.done.includes(q.id)?'done':career.order===q.id?'active':'new';
}
function bunkerOrderGoals(q){
  const state=bunkerOrderState(q);
  const active=state==='active'&&raid&&!field.result;
  if(q.id==='weather-survey'){
    const rows=active?surveyObservations():[];
    return [['맑음 기록',Number(state==='done'||rows.some(row=>row.condition==='clear')),1],
      ['안개 기록',Number(state==='done'||rows.some(row=>row.condition==='fog')),1],['정상 탈출',Number(state==='done'),1]];
  }
  if(q.sample){
    const snapshot=sampleInspection(q,active?field:null,active?field.bag:!raid?equipmentState.bag:[]);
    const done=state==='done';
    return [['배수반 공구함 규격표 확인',Number(done||snapshot.site.complete),1],
      ['PVC 배관 가방에 휴대',Number(done||snapshot.carried),1],['정상 탈출',Number(done),1]];
  }
  const count=state==='done'?q.target:active?Math.min(q.target,q.progress(q)):0;
  return [[q.goal,count,q.target],['정상 탈출',state==='done'?1:0,1]];
}
function ordersView(){
  const states={new:'신규',active:'진행 중',done:'완료'};
  const visible=ORDERS.filter(q=>orderUnlocked(q) && (bunkerOrderFilter==='all'||bunkerOrderState(q)===bunkerOrderFilter));
  const q=visible.find(v=>v.id===bunkerOrderSelected)||visible[0];
  let detail='<div class="bu-empty">이 상태의 의뢰가 없습니다.</div>';
  if(q){
    const state=bunkerOrderState(q),disabled=!writer||state==='done'||!!raid||(!!career.order&&state!=='active');
    const action=state==='done'?'보상 지급 완료':raid?'귀환 후 변경 가능':state==='active'?'수락 취소':career.order?'다른 의뢰 진행 중':'의뢰 수락';
    detail=`<header class="bu-order-title"><h2>${q.title}</h2><small>B-04 / ${String(ORDERS.indexOf(q)+1).padStart(3,'0')}</small></header>
    ${bunkerPicture(q.image,q.title+' 현장','bu-order-image')}
    <div class="bu-order-columns"><section><h3>의뢰 내용</h3><p>${q.text}</p><small>${q.issuer}</small></section><section><h3>목표</h3>${bunkerOrderGoals(q).map(([label,n,max])=>`<div class="bu-goal ${n===max?'ready':''}"><i aria-hidden="true">${n===max?'✓':''}</i>${label} <span>${n} / ${max}</span></div>`).join('')}</section></div>
    <h3>보상</h3><div class="bu-reward"><strong>${money(q.cr)}</strong><strong>+${q.xp} XP</strong><button class="bu-cta" data-order="${q.id}" ${disabled?'disabled':''}>${action}</button></div>
    ${q.id==='weather-survey'&&state!=='done'?'<div class="shell-actions"><button data-cui="forecast">세 권역 예보 비교</button></div>':''}
    ${q.sample&&state!=='done'&&!raid?'<div class="shell-actions"><button data-db="lookup" data-id="'+esc(q.sample.item)+'">PVC 배관 도감 · 수급처와 주문</button><button data-page="stash">창고에서 출격 가방에 담기</button></div>':''}
    ${state==='active'?objectiveControl({kind:'order',id:q.id}):''}
    <p class="bu-minor">목표를 달성하고 정상 탈출하면 정산 시 보상을 받습니다.</p>`;
  }
  return `<div class="bu-screen">${bunkerHeading('08','벙커 의뢰','의뢰를 선택해 목표와 보상을 확인하세요.')}<div class="bu-orders"><section class="bu-box bu-order-list"><h2>의뢰 목록 <small>${visible.length}</small></h2><div class="bu-filter" role="group" aria-label="의뢰 상태">${Object.entries({all:'전체',...states}).map(([id,s])=>`<button data-bui="order-filter" data-id="${id}" aria-pressed="${bunkerOrderFilter===id}">${s}</button>`).join('')}</div>${visible.map(v=>`<button class="bu-order-choice" data-bui="order" data-id="${v.id}" aria-pressed="${v.id===q?.id}"><i>▤</i><span><b>${v.title}</b><small>${v.issuer}</small></span><em>${states[bunkerOrderState(v)]}</em></button>`).join('')||'<p class="bu-minor">표시할 의뢰 없음</p>'}</section><article class="bu-box bu-order-panel">${orderStatus()}${detail}</article></div></div>`;
}
function bunkerFacilityState(id){
  const job=hideout.builds[id]||hideout.production[id];
  if(job)return hideout.builds[id]?'건설 중':'생산 중';
  return hideoutLevel(id)?'Lv. '+hideoutLevel(id):'미건설';
}
function bunkerRoomButton(id,css=''){
  return `<button class="${css}" data-bui="facility" data-id="${id}" aria-label="${FACILITIES[id].name} 상세"><i aria-hidden="true">${BUNKER_GLYPHS[id]}</i><b>${FACILITIES[id].name}</b></button>`;
}
function bunkerOverviewView(){
  const ids=Object.keys(FACILITIES),running=ids.filter(id=>hideoutLevel(id)>0).length;
  const working=ids.filter(id=>hideout.builds[id]||hideout.production[id]);
  return `<div class="bu-screen">${bunkerHeading('09','하이드아웃','B-04 벙커 내부 시설을 관리하고 확장합니다.')}
  ${campaignBunkerCard()}
  ${!raid?'<div class="shell-actions"><button type="button" data-page="maintenance">장비 정비 · 수리와 탄약 보충</button></div>':''}
  <section class="bu-deck" aria-label="벙커 시설 배치도">${bunkerPicture('bunker-deck','B-04 벙커 내부 배치도')}
    <div class="bu-deck-meter"><b>가동 시설 <strong>${running} / ${ids.length}</strong></b>${bunkerProgress(running,ids.length,'가동 중인 시설')}</div>
    ${BUNKER_ROOMS.map(id=>bunkerRoomButton(id,'bu-beacon bu-'+id)).join('')}</section>
    <div class="bu-room-strip">${BUNKER_ROOMS.map(id=>bunkerRoomButton(id)).join('')}</div>
    <section class="bu-box bu-directory"><h2>전체 시설 <small>${ids.length}곳</small></h2><div class="bu-facilities">${ids.map(id=>`<button class="bu-facility-tile" data-bui="facility" data-id="${id}"><i>${BUNKER_GLYPHS[id]}</i><span>${FACILITIES[id].name}</span><small>${bunkerFacilityState(id)}</small></button>`).join('')}</div></section>
    ${working.length?`<section class="bu-box bu-jobs"><h2>진행 중인 작업</h2>${working.map(id=>`<button data-bui="facility" data-id="${id}"><b>${FACILITIES[id].name}</b><span>${bunkerFacilityState(id)}</span>${facilityTimer((hideout.builds[id]||hideout.production[id]).end)}</button>`).join('')}</section>`:''}
    ${hideout.history.length?`<section class="bu-box bu-receipts"><h2>최근 작업</h2>${hideout.history.map(s=>`<p>${esc(s)}</p>`).join('')}</section>`:''}</div>`;
}
function facilityConstructionSteps(id, tier) {
  const steps = [];
  const seen = new Set();
  function include(room, level) {
    if (level <= hideoutLevel(room)) return;
    const key = room + '-' + level;
    if (seen.has(key)) return;
    seen.add(key);
    const step = FACILITIES[room].levels[level - 1];
    include(room, level - 1);
    for (const required of step.requires) include(required.facility, required.level);
    steps.push({room, level, cost:step.costCR, paid:hideout.builds[room]?.tier === level});
  }
  include(id, tier);
  return steps;
}
function bunkerConstructionPlan(id, tier) {
  const steps = facilityConstructionSteps(id, tier);
  if (steps.length < 2) return '';
  const unpaid = steps.reduce((total, step) => total + (step.paid ? 0 : step.cost), 0);
  const shortfall = Math.max(0, unpaid - wallet);
  const rows = steps.map(step => {
    const title = esc(FACILITIES[step.room].name) + ' Lv.' + step.level;
    return '<li data-plan-room="' + step.room + '" data-plan-tier="' + step.level + '"><span>' + title +
      '</span> <span>' + (step.paid ? '공사 중 · 지불 완료 · ' + facilityTimer(hideout.builds[step.room].end) + ' 남음' : money(step.cost)) + '</span></li>';
  }).join('');
  return '<details class="bu-construction-plan" data-build-plan><summary>선행 공사 포함 ' + steps.length +
    '단계 · 남은 건설비 ' + money(unpaid) + '</summary><ol>' + rows + '</ol><p>' +
    (shortfall ? '현재 지갑 기준 ' + money(shortfall) + ' 부족' : '현재 지갑으로 남은 건설비 충당 가능') +
    ' · 자재 구입비 별도</p></details>';
}
function bunkerDetailView(){
  const id=Object.hasOwn(FACILITIES,facilitySelected)?facilitySelected:'power',f=FACILITIES[id],level=hideoutLevel(id);
  const tier=Math.min(f.levels.length,Math.max(1,facilityTier||1)),step=f.levels[tier-1],status=facilityBuildStatus(id,tier),job=hideout.builds[id];
  return `<div class="bu-screen">${bunkerHeading('10','시설 상세','B-04 벙커 · '+f.name)}<div class="bu-f-detail">
  <div class="bu-f-left"><div class="bu-room-image">${bunkerPicture('bunker-'+id,f.name+' 내부')}<button class="bu-back" data-page="bunker">‹ 벙커 전경</button></div>
  <div class="bu-room-strip">${BUNKER_ROOMS.map(key=>bunkerRoomButton(key,key===id?'selected':'')).join('')}</div></div>
  <article class="bu-box bu-f-spec"><header><i aria-hidden="true">${BUNKER_GLYPHS[id]}</i><div><h2>${f.name}</h2><p>${f.purpose}</p></div><b>Lv. ${level}</b></header>
  <div class="bu-upgrade-level"><strong>시설 단계</strong><div>${f.levels.map(s=>`<button data-bui="tier" data-tier="${s.level}" aria-pressed="${tier===s.level}">Lv.${s.level}</button>`).join('')}</div></div>
  <div class="bu-next-effect"><b>Lv.${tier} 효과</b> ${facilityEffect(id,tier)}</div>
  ${tier===level+1&&!job?objectiveControl({kind:'facility',id,tier}):''}
  <h3>필요 자재 <small>창고 보유 / 필요</small></h3><div class="bu-materials">${Object.entries(step.materials).map(([g,qty])=>{
    const n=stashCount(g),ok=n>=qty;
    return `<button data-db="lookup" data-id="${g}" aria-label="${GOODS[g][0]} 수급처, 보유 ${n}개, 필요 ${qty}개"><span class="bu-mat-image"><i class="${ok?'ready':'short'}">${ok?'✓':'×'}</i>${itemArt(g)}</span><b>${GOODS[g][0]}</b><small class="${ok?'ready':'short'}">${n} / ${qty}</small></button>`;
  }).join('')}</div>
  <div class="bu-needs"><b>선행 시설</b><div>${step.requires.map(r=>`<button data-bui="facility" data-id="${r.facility}" data-tier="${r.level}">${hideoutLevel(r.facility)>=r.level?'✓':'□'} ${FACILITIES[r.facility].name} Lv.${r.level}</button>`).join('')||'없음'}</div></div>
  ${bunkerConstructionPlan(id,tier)}
  <dl class="bu-cost"><div><dt>건설비</dt><dd>${money(step.costCR)}</dd></div><div><dt>작업 시간</dt><dd>${step.durationMinutes}분</dd></div></dl>
  ${job?`<p class="bu-work-state">Lv.${job.tier} 건설 중 · ${facilityTimer(job.end)}</p>`:''}
  <div class="bu-build-action"><p role="status">${esc(hideoutMessage||status||'건설 가능')}</p><button class="bu-cta" data-hideout="build" data-id="${id}" data-tier="${tier}" ${status?'disabled':''}>${level>=tier?'건설 완료':level?'업그레이드':'건설'}</button></div>
  ${['power','water','med'].includes(id)?'<button type="button" data-page="campaign">복구 캠페인으로</button>':''}
  ${facilityProductionPanel(id)}</article></div></div>`;
}
function openBunkerFacility(id,tier){
  if(!Object.hasOwn(FACILITIES,id))return;
  const max=FACILITIES[id].levels.length;
  facilityTier=Number.isInteger(tier)&&tier>=1&&tier<=max?tier:hideout.builds[id]?.tier||Math.min(hideoutLevel(id)+1,max);
  if(page!=='facility'||facilitySelected!==id)hideoutMessage='';
  facilitySelected=id;page='facility';save();renderKeep();
  const content=$('.content');if(content)content.scrollTop=0;
}
function handleBunkerUI(d){
  if(d.bui==='order-followup'){
    const follow=nextBunkerOrder(lastSummary);
    if(!writer||page!=='raid'||!follow||follow.id!==d.id||String(raid.startedAt)!==d.returnId)return;
    handleRaidAction('ack');
    if(!raid && orderUnlocked(follow) && !career.done.includes(follow.id)){
      bunkerOrderSelected=follow.id;bunkerOrderFilter='all';navigatePage('orders');
    }
    return;
  }
  if(d.bui==='facility')return openBunkerFacility(d.id,Number(d.tier));
  if(d.bui==='tier'){
    const tier=Number(d.tier);if(!Number.isInteger(tier)||!FACILITIES[facilitySelected]?.levels[tier-1])return;
    facilityTier=tier;hideoutMessage='';
  }else if(d.bui==='history'){
    const i=Number(d.index);if(!Number.isInteger(i)||!career.history[i])return;
    bunkerHistoryRow=bunkerHistoryRow===i?-1:i;
  }else if(d.bui==='history-limit'){
    bunkerHistoryLimit=bunkerHistoryLimit===5?12:5;if(bunkerHistoryRow>=bunkerHistoryLimit)bunkerHistoryRow=-1;
  }else if(d.bui==='order-filter'){
    if(!['all','new','active','done'].includes(d.id))return;bunkerOrderFilter=d.id;
  }else if(d.bui==='order'){
    if(!ORDERS.some(q=>q.id===d.id && orderUnlocked(q)))return;bunkerOrderSelected=d.id;
  }else return;
  renderKeep();
}
