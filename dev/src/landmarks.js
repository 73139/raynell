// Existing numeric box references preserve all v0.10 container keys and their contents.
// New boxes are appended in this stable order; each container belongs to exactly one landmark.
const LANDMARK_LAYOUT = [
  [
    ['외곽 보급소','보급반이 남긴 상자와 정비 사물함이 출입구 안쪽에 있다.',0,1],
    ['폐버스 정류장','마지막 버스가 멈춰 있다. 좌석과 운전석 옆을 살필 수 있다.',2,['기사의 문서함','desk','drawer']],
    ['차량 정비막사','반쯤 열린 셔터 아래로 작업대와 외투 걸이가 보인다.',3,['정비공 작업복','bag','jacket']],
    ['배급소 식당','배식 창구 뒤편에 보급 상자와 찬장이 남아 있다.',4,['식당 찬장','food','food']],
    ['교대원 숙소','접힌 침상 끝에 옷가지와 개인 짐이 놓여 있다.',5,['침상 밑 여행 가방','bag','suitcase']],
    ['송전탑 점검소','탑 아래 점검소에는 전력반의 장비가 그대로 있다.',['전력반 자재 상자','crate','industrial'],['점검실 컴퓨터','radio','pc']],
    ['빗물 펌프장','배수로 위 철제 발판이 창고 문으로 이어진다.',['배수반 공구함','tool','toolbox'],['작업자 사물함','locker','locker']],
    ['임시 진료소','접이식 진료대 두 개와 운반용 가방이 놓여 있다.',['진료대 응급함','med','med'],['왕진 가방','bag','bag']],
    ['폐선 승강장','화물표 발행 창구 아래에 짐이 쌓여 있다.',['승객의 짐가방','bag','suitcase'],['화물표 서랍','desk','drawer']],
    ['경계 울타리','철망 안쪽에 오래된 표식과 흙을 덮은 흔적이 있다.',['울타리 은닉함','crate','cache'],['보초의 방한복','bag','jacket']]
  ],
  [
    ['경비 초소','차단기 옆 초소에서 기록을 남기던 책상과 보관함이 보인다.',0,1],
    ['검역 천막','천막 안에 접이식 침상과 접수대가 남아 있다.',2,['검역 접수 서랍','desk','drawer']],
    ['감찰 사무실','장부가 사라진 자리에 금고와 서류함이 남았다.',3,['감찰 기록함','desk','drawer']],
    ['감시 통제실','벽면 모니터 아래 본체와 정비함을 확인할 수 있다.',4,['감시장비 정비함','tool','toolbox']],
    ['통행증 발급소','깨진 안내 유리 너머로 서류와 개인 짐이 보인다.',5,['창구 직원 가방','bag','bag']],
    ['세관 검사대','검사 중이던 짐이 컨베이어 위에 남아 있다.',['검사용 화물 상자','crate','military'],['압류 수하물','bag','suitcase']],
    ['대기 차량 행렬','도로 가장자리에 주인 없는 차량이 줄지어 있다.',['뒷좌석 식량 상자','food','food'],['운전자의 재킷','bag','jacket']],
    ['도로통제 창고','이동식 차단벽 사이 통로 끝에 물자 선반이 있다.',['차단벽 자재함','crate','industrial'],['통제반 사물함','locker','locker']]
  ],
  [
    ['중앙 보급동','적재 구역의 보급 상자 옆에 붙박이 사물함이 있다.',0,1],
    ['하역 도크','비어 있는 운반대 사이로 자재와 개인 짐이 보인다.',2,3],
    ['지하 적재실','낮은 선반 뒤편에 눈에 띄지 않는 보관 공간이 있다.',4,['지하 장비함','crate','military']],
    ['배차 사무동','납품 기사들이 대기하던 소파 옆에 짐이 남았다.',5,['배차 기록용 컴퓨터','radio','pc']],
    ['반송 화물실','반송표가 붙은 선적물과 봉인된 보관함이 있다.',['반송 공구 상자','tool','toolbox'],['귀중품 보관 금고','locker','safe']]
  ]
];
const LANDMARKS = LANDMARK_LAYOUT.map((points,z)=>points.map(([name,description,...entries])=>({
  name, description, boxes:entries.map(entry=>typeof entry==='number'?entry:FIELD_ZONES[z].boxes.push(entry)-1)
})));

function validLandmarkSelection(f) {
  return f.landmarkByZone == null || (Array.isArray(f.landmarkByZone) && f.landmarkByZone.length === LANDMARKS.length &&
    f.landmarkByZone.every((index,z)=>Number.isInteger(index) && index>=0 && index<LANDMARKS[z].length));
}

function prepareLandmarks() {
  if(!raid || (field.landmarkByZone && validLandmarkSelection(field)))return;
  field.landmarkByZone=[0,0,0];
  const z=raid.zone;
  let box=-1;
  if(field.open)box=Number(field.open.split('-')[1]);
  else if(field.action?.type==='scan') {
    // v0.10 discovered containers in zone-wide order. Complete that search in its original location.
    box=FIELD_ZONES[z].boxes.findIndex((_,i)=>i<6 && !field.found[z].includes(i));
  }
  if(box>=0) {
    const point=LANDMARKS[z].findIndex(p=>p.boxes.includes(box));
    if(point>=0)field.landmarkByZone[z]=point;
  }
}

function currentLandmark(z=raid.zone) {
  return LANDMARKS[z][field.landmarkByZone?.[z]??0];
}

function sortieSpawnLandmark(zoneId){
  const destination=barterHunt?.destination??lootDestination;
  return destination?.zone===zoneId?destination.index:0;
}

function nextLandmarkBox(z=raid.zone) {
  return currentLandmark(z).boxes.find(i=>!field.found[z].includes(i))??-1;
}

function selectLandmark(index) {
  if(!isActive() || field.journey || field.action || field.contact || field.open ||
    !Number.isInteger(index) || !LANDMARKS[raid.zone][index])return;
  prepareLandmarks();
  field.landmarkByZone[raid.zone]=index;
  picked=null;notice='';
  persist();renderKeep();
  // The open picker disappears on render. Keep the new location in view and in keyboard order.
  const title=$('.landmark-header h2');
  title?.focus?.({preventScroll:true});
  title?.scrollIntoView?.({block:'center',inline:'nearest'});
}

function atPumpGauge(){
  return career.order==='pump-gauge' && raid?.zone===PUMP_SITE.zone &&
    field.landmarkByZone?.[PUMP_SITE.zone]===PUMP_SITE.landmark;
}
function pumpGaugePanel(){
  if(!atPumpGauge())return '';
  const record=field.pumpGauge,done=Boolean(record?.answer),state=done?'recorded':record?'read':'unread';
  const message=pumpNotice?.raidId===raid.startedAt?pumpNotice.text:'';
  const button=(action,label,answer='')=>`<button type="button" data-field="gauge-${action}" data-raid-id="${raid.startedAt}"${answer?' data-answer="'+answer+'"':''} ${field.action||!writer?'disabled':''}>${label}</button>`;
  const meter=record?`<p><b data-gauge-reading>현장 눈금 ${record.reading}칸</b> · 기준선 ${PUMP_BASELINE}칸</p>`:'<p>발판 옆 눈금자를 읽고 기준선과 높이를 비교하세요.</p>';
  const controls=done?'':record?Object.entries(PUMP_ANSWERS).map(([id,label])=>button('report',label,id)).join(''):button('read','수위계 읽기');
  return `<section class="pump-gauge" data-pump-gauge="${state}"><h3>배수반 수위계</h3>${meter}${controls?'<div class="pump-controls">'+controls+'</div>':''}
    <p tabindex="-1" role="status">${done?'판독 기록 완료 · '+PUMP_ANSWERS[record.answer]+'. 정상 탈출하면 수당이 지급됩니다.':esc(message)}</p></section>`;
}
function handlePumpGauge(d){
  if(!writer||!isActive()||String(raid.startedAt)!==d.raidId||!atPumpGauge()||
      field.action||field.open||field.contact||field.journey||Date.now()>=raid.endsAt)return;
  const owner=field,old=field.pumpGauge;
  if(d.field==='gauge-read'){
    if(old)return;
    field.pumpGauge={raidId:raid.startedAt,readAt:Date.now(),reading:pumpReading(raid.startedAt),answer:null};
  }else{
    if(!old || old.answer || !Object.hasOwn(PUMP_ANSWERS,d.answer) || !validPumpGauge(raid,field,career.order))return;
    if(pumpAnswer(old.reading)!==d.answer){
      pumpNotice={raidId:raid.startedAt,text:'눈금과 기준선의 높이를 다시 비교해 주세요.'};
      renderKeep();$(`[data-field="gauge-report"][data-answer="${d.answer}"]`)?.focus?.({preventScroll:true});return;
    }
    field.pumpGauge={...old,answer:d.answer};
  }
  pumpNotice=null;
  const saved=writeSession();
  if(!saved && field===owner){
    if(old)field.pumpGauge=old;else delete field.pumpGauge;
    pumpNotice={raidId:raid.startedAt,text:'판독을 저장할 수 없습니다. 다시 시도하세요.'};
  }
  renderKeep();
  const target=saved&&d.field==='gauge-read'?'[data-field="gauge-report"]':'[data-pump-gauge] [role="status"]';
  $(target)?.focus?.({preventScroll:true});
}

function landmarkPanel(){
  const zi=raid.zone, area=FIELD_ZONES[zi], point=currentLandmark(), busy=!!field.action;
  const visible=point.boxes.filter(i=>field.found[zi].includes(i));
  const objective=resolveObjective();
  const recovery=objective?.recovery;
  const source=recovery&&recovery.carried<recovery.required&&recovery.sources.find(site=>
    site.zone===zi&&LANDMARKS[zi][site.landmark]===point&&site.boxOrdinal!==undefined);
  const sites=objective?.inspections||[objective?.sample?.site].filter(Boolean);
  const inspection=sites.find(site=>!site.complete&&site.zone===zi&&LANDMARKS[zi][site.landmark]===point);
  const targetBox=source?point.boxes[source.boxOrdinal]:null;
  const lock=source?lootLockView(zi,targetBox):null;
  const searchSite=objective?.search?.sites.find(site=>site.zone===zi&&site.index===targetBox);
  const sourceHint=source?'<p class="obj-place" data-order-container><b>의뢰 수색 대상</b> '+
    esc(area.boxes[targetBox][0])+' · '+esc(searchSite&&['available','empty'].includes(searchSite.state)?
      recoverySiteStatus(searchSite.state,GOODS[recovery.item][0]):GOODS[recovery.item][0])+(lock&&!lock.unlocked?' · '+esc(lock.keyName)+' 필요':'')+'</p>':'';
  const options=LANDMARKS[zi].map((p,i)=>{
    const marker=objective?objectiveLocationLabel(objective.locations,zi,i):'';
    const completed=p.boxes.filter(k=>field.boxes[boxKey(zi,k)]?.complete).length;
    return `<button data-field="landmark" data-index="${i}" aria-pressed="${p===point}" ${busy?'disabled':''}><span>${p.name}${marker?'<em class="obj-landmark-match">'+marker+'</em>':''}</span><small>${completed} / ${p.boxes.length} 수색 완료</small></button>`;
  }).join('');
  const cards=visible.map(i=>{
    const [name,icon]=area.boxes[i], box=field.boxes[boxKey(zi,i)];
    const lock=lootLockView(zi,i);
    if(lock && !lock.unlocked)return lootPlanLockedCard(zi,i,busy);
    const label=box.complete?'수색 완료':box.items.some(x=>x.revealed)?'일부 확인':'미수색';
    return `<button class="container-card" ${lock&&!lock.legacy?'data-loot-lock="unlocked"':''} data-field="open" data-index="${i}" ${busy?'disabled':''}>${ico(icon)}<b>${name}</b><small>${inspection?.index===i?'의뢰 수색 대상 · ':''}${lock&&!lock.legacy?'잠금 해제 · ':''}${label}${box.key===field.survivorScavenge?.box?' · 뒤진 흔적':''}</small></button>`;
  }).join('');
  return `${huntSummary('field')}${objectivePanel('field',objective)}<section class="field-section landmark-site">
    <div class="landmark-header"><div><small>현재 랜드마크</small><h2 tabindex="-1">${point.name}</h2></div>
      <details class="landmark-picker"><summary>랜드마크 선택 · ${LANDMARKS[zi].length}곳</summary>
        <div class="landmark-list">${options}</div></details></div>
    <p class="landmark-description">${point.description}</p>${sourceHint}${pumpGaugePanel()}${surveyReadingPanel()}${postalPanel()}${reliefPanel(true)}${wardFieldPanel()}${shuttleFieldPanel()}
    <button class="primary search-button" data-field="scan" ${busy||nextLandmarkBox()<0?'disabled':''}>${ico('search')} 주변 탐색 <small>${durationLabel('scan',4000)}</small></button>
    <h3 class="landmark-box-title">발견한 수색 대상 <small>${visible.length} / ${point.boxes.length}</small></h3>
    <div class="container-list">${cards||'<p class="empty-field">주변을 탐색해 이곳의 수색 대상을 발견하세요.</p>'}</div>
  </section>`;
}

function routeChoicesPanel(){
  return routeComparison(raid.zone,'live',resolveObjective());
}
