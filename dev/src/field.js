// A raid carries its exit assignment, contact and timers until settlement.
const ESCAPE_CHANCE = 0.65;
const CONTACTS = [
  {name:'외곽 정찰 드론', hp:36, power:12},
  {name:'검문소 경비 기체', hp:52, power:17},
  {name:'창고 방호 기체', hp:68, power:23}
];
// A container item keeps its zone-box-slot UID while it is carried in the raid.
// Warehouse and loadout entries receive new UIDs, including after a successful return.
function matchesOrderRecovery(unit,{item,sources}){
  if(unit.g!==item)return false;
  const parts=/^(0|[1-9]\d*)-(0|[1-9]\d*)-(?:0|[1-9]\d*)$/.exec(unit.uid);
  if(!parts)return false;
  const zone=Number(parts[1]), box=Number(parts[2]);
  return sources.some(site=>{
    if(site.zone!==zone||!field.found[zone].includes(box))return false;
    const boxes=LANDMARKS[zone][site.landmark].boxes;
    return site.boxOrdinal===undefined?boxes.includes(box):boxes[site.boxOrdinal]===box;
  });
}
function countOrderRecovery(order){
  return field.bag.filter(unit=>matchesOrderRecovery(unit,order.recovery)).length;
}
function fullySearchedAt(sortie,zone,index){
  if(!sortie?.found?.[zone]?.includes(index))return false;
  const box=sortie.boxes?.[boxKey(zone,index)];
  return Boolean(box?.complete===true&&Array.isArray(box.items)&&box.items.every(unit=>unit?.revealed===true));
}
function orderInspectionSites(order,sortie=field){
  return order.inspections.map(({zone,landmark,boxOrdinal})=>{
    const index=LANDMARKS[zone][landmark].boxes[boxOrdinal];
    const complete=fullySearchedAt(sortie,zone,index);
    return {zone,landmark,index,complete};
  });
}
const PUMP_SITE={zone:0,landmark:6};
const PUMP_BASELINE=4;
const PUMP_ANSWERS={below:'기준 미만',level:'기준과 같음',above:'기준 초과'};
let pumpNotice=null;
// The gauge is fixed for the lifetime of the sortie and does not consume a loot or encounter roll.
function pumpReading(raidId){return 3+Math.floor(raidId/1000)%3;}
function pumpAnswer(reading){return reading<PUMP_BASELINE?'below':reading>PUMP_BASELINE?'above':'level';}
function validPumpGauge(raid,sortie,order){
  const record=sortie?.pumpGauge;
  if(record===undefined)return true;
  return Boolean(raid && !sortie.result && order==='pump-gauge' && Array.isArray(sortie.visited) && sortie.visited.includes(PUMP_SITE.zone) &&
    record && typeof record==='object' && !Array.isArray(record) && sortie.raidId===raid.startedAt && record.raidId===raid.startedAt &&
    Number.isSafeInteger(record.readAt) && record.readAt>=raid.startedAt && record.readAt<raid.endsAt &&
    record.readAt<=Date.now() && record.reading===pumpReading(raid.startedAt) &&
    (record.answer===null || record.answer===pumpAnswer(record.reading)));
}
function pumpGaugeProgress(){
  return Number(Boolean(field.pumpGauge?.answer && validPumpGauge(raid,field,career.order)));
}
function sampleInspection(order, sortie, bag) {
  const [site] = orderInspectionSites({inspections:[order.sample.site]}, sortie);
  const carried = (bag || []).some(unit => unit.g === order.sample.item);
  return {site, carried, count:Number(site.complete) + Number(carried)};
}
// Stable zone-and-container keys are already used by the outing's found and searched records.
function surveySite(key){
  if(typeof key!=='string'||!/^([0-2])-(0|[1-9]\d*)$/.test(key))return null;
  const [zone,index]=key.split('-').map(Number),site=FIELD_ZONES[zone]?.boxes?.[index];
  return site?{key,zone,index,name:site[0]}:null;
}
function validSurveyList(keys){
  return Array.isArray(keys)&&keys.length<=FIELD_ZONES.reduce((n,z)=>n+(z.boxes?.length||0),0)&&
    new Set(keys).size===keys.length&&keys.every(key=>Boolean(surveySite(key)));
}
function completedSurveyKeys(sortie){
  if(!Array.isArray(sortie?.found))return [];
  const visited=new Set();
  for(const [zone,indices] of sortie.found.entries()){
    if(!Array.isArray(indices))continue;
    for(const index of indices){
      const key=boxKey(zone,index);
      if(surveySite(key)&&fullySearchedAt(sortie,zone,index))visited.add(key);
    }
  }
  return [...visited];
}
function recordReturnedSurveys(sortie){
  const prior=new Set(career.surveyedBoxes||[]),fresh=completedSurveyKeys(sortie).filter(key=>!prior.has(key));
  if(fresh.length)career.surveyedBoxes=[...prior,...fresh];
  return fresh;
}
function validSurveyBackup(s){
  const keys=s.career?.surveyedBoxes,arrivals=s.lastSummary?.newSurveyBoxes;
  if(keys!==undefined&&!validSurveyList(keys))return false;
  if(arrivals===undefined)return true;
  return validSurveyList(arrivals)&&arrivals.length>0&&s.lastSummary.result==='success'&&['success','quick'].includes(s.lastSummary.rating)&&
    arrivals.length<=s.lastSummary.searched&&arrivals.every(key=>keys?.includes(key));
}
function surveySummaryMarkup(summary){
  const rows=summary?.newSurveyBoxes;
  if(!rows?.length||!validSurveyList(rows))return '';
  return '<details class="field-section survey-return" data-survey-return><summary>수색 수첩에 새로 기록한 상자 '+rows.length+'개</summary><ul>'+
    rows.map(key=>{const site=surveySite(key);return '<li>'+esc(FIELD_ZONES[site.zone].name)+' · '+esc(site.name)+'</li>'}).join('')+'</ul></details>';
}

function orderUnlocked(order, done=career.done, reply, clinic) {
  if(order.afterWard && !paidWardDelivery(clinic===undefined?hideout:clinic))return false;
  if(order.afterReply && !(reply===undefined?finaleState.reply:reply))return false;
  if(!order.after)return true;
  const prior=ORDERS.find(candidate=>candidate.id===order.after);
  return Boolean(prior&&done.includes(prior.id)&&orderUnlocked(prior,done,reply,clinic));
}
const ORDERS = [
  {id:'scout',surveyFunding:true, image:'bunker-tower', issuer:'벙커 관제실', title:'외곽 통신선 조사', text:'한 레이드에서 서로 다른 두 지역을 방문하고 정상 탈출하세요.', cr:20000, xp:80,
    goal:'서로 다른 지역 방문', target:2, progress:()=>new Set(field.visited||[raid.zone]).size},
  {id:'stores',surveyFunding:true, image:'bunker-stash', issuer:'보급 담당관', title:'보급품 위치 확인', text:'한 레이드에서 컨테이너 두 개를 끝까지 수색하고 정상 탈출하세요.', cr:32000, xp:120,
    goal:'컨테이너 수색 완료', target:2, progress:()=>Object.values(field.boxes).filter(box=>box.complete).length},
  {id:'signals', image:'bunker-security', issuer:'현장 정비반', title:'고장 난 경비망', text:'한 레이드에서 경비 기체 한 대를 무력화하고 정상 탈출하세요.', cr:42000, xp:150,
    goal:'경비 기체 무력화', target:1, progress:()=>field.victories||0},
  {id:'tower-wire', image:'bunker-tower', issuer:'벙커 전력반', title:'단선 구간 표본 회수',
    text:'송전탑 선로를 수리하려면 현장 전선의 규격이 필요합니다. 벙커 외곽의 송전탑 점검소에서 전력반 자재 상자 또는 점검실 컴퓨터를 수색하세요. 이번 출격에서 그곳에서 찾은 전선 묶음 한 개를 가방에 넣고 정상 탈출하면 검사비를 지급합니다. 검사한 전선은 창고에 보관됩니다.',
    cr:36000, xp:130, goal:'송전탑 점검소에서 찾은 전선 묶음 휴대', target:1,
    recovery:{item:'wire',sources:[{zone:0,landmark:5}]}, progress:countOrderRecovery},
  {id:'med-supply', image:'bunker-med', issuer:'벙커 의무반', title:'끊긴 의무품 보급선',
    text:'마지막 의무품 수송이 끊긴 뒤, 두 곳에 남은 구급 붕대의 포장 상태를 확인하고 있습니다. 벙커 외곽 임시 진료소의 진료대 응급함은 열쇠 없이 열 수 있습니다. 폐쇄 검문소로 간다면 검역실 열쇠를 챙겨 검역 천막의 응급 케이스를 여세요. 둘 중 한 곳에서 찾은 구급 붕대 한 개를 가방에 넣어 정상 탈출하면 검사비를 지급합니다. 붕대는 본인 창고에 보관됩니다.',
    cr:28000, xp:100, goal:'지정된 두 응급함 중 한 곳에서 찾은 구급 붕대 휴대', target:1,
    recovery:{item:'bandage',sources:[{zone:0,landmark:7,boxOrdinal:0},{zone:1,landmark:1,boxOrdinal:0}]}, progress:countOrderRecovery},
  {id:'handover-ledgers',surveyFunding:true,image:'bunker-stash',issuer:'벙커 배차반',title:'사라진 화물 인계표',
    text:'외곽 폐선 승강장을 떠난 화물이 검문소에서 인계됐는지 확인해 주세요. 한 출격에서 폐선 승강장의 화물표 서랍과 검역 천막의 검역 접수 서랍을 끝까지 수색한 뒤 정상 탈출하세요. 두 서랍 모두 열쇠 없이 열 수 있습니다. 어느 쪽을 먼저 가도 되고, 안이 비어 있어도 확인한 기록은 인정됩니다.',
    cr:34000,xp:115,goal:'지정 서랍 수색 완료',target:2,
    inspections:[{zone:0,landmark:8,boxOrdinal:1},{zone:1,landmark:1,boxOrdinal:1}],
    progress:order=>orderInspectionSites(order).filter(site=>site.complete).length},
  {id:'pump-gauge',surveyFunding:true,image:'bunker-water',issuer:'벙커 배수반',title:'빗물 펌프장 수위 판독',
    text:'외곽 빗물 펌프장 발판에 수위계가 남아 있습니다. 눈금을 직접 읽고 기준선과 비교해 이번 출격의 수위를 기록하세요. 장비나 물자는 필요 없습니다. 정상 탈출하면 배수반에서 판독 수당을 지급합니다. 조기 귀환하면 다음 출격에서 새로 판독해야 합니다.',
    cr:12000,xp:55,goal:'기준선과 비교한 수위 기록',target:1,progress:pumpGaugeProgress},
  {id:'pump-pipe',after:'pump-gauge',image:'bunker-water',issuer:'벙커 배수반',title:'배수관 규격 대조',
    text:'수위 판독을 받은 배수반에서 교체 배관의 규격을 확인합니다. 벙커 외곽 빗물 펌프장에서 배수반 공구함을 끝까지 수색해 뚜껑 안쪽의 규격표를 확인하세요. 같은 출격에서 PVC 배관 한 개를 가방에 넣고 정상 탈출하세요. 준비해 간 배관과 현장에서 찾은 배관 모두 인정하며 귀환한 배관은 창고에 보관됩니다.',
    cr:18000,xp:65,goal:'규격표 확인 및 PVC 배관 휴대',target:2,
    sample:{site:{zone:0,landmark:6,boxOrdinal:0},item:'rl_08_15'},
    progress:order=>sampleInspection(order,field,field.bag).count},
  {id:'sealed-mail',after:'handover-ledgers',image:'bunker-stash',issuer:'벙커 배차반',title:'봉인 우편낭 회송',
    text:'군수 보급 창고 반송 화물실에서 봉인 우편낭을 인수해 폐쇄 검문소 통행증 발급소에 인계하세요. 우편낭은 가방 두 칸을 차지합니다. 한 출격에서 접수 도장을 받은 뒤 정상 탈출하면 수당을 지급합니다. 출격이 끝나면 미인계 화물과 접수 기록은 회수됩니다.',
    cr:30000,xp:105,goal:'우편낭 인수 및 중계소 인계',target:2,progress:()=>postalProgress()},
  {id:'weather-survey',surveyFunding:true,image:'bunker-tower',issuer:'벙커 기상반',title:'두 권역의 시정 관측',
    text:'안개가 수송로의 거리 표식을 얼마나 가리는지 맑은 날과 비교합니다. 지도에서 세 권역의 예보를 보고 첫 관측지를 고르세요. 외곽 경계 울타리, 검문소 대기 차량 행렬, 군수 창고 하역 도크가 관측 지점입니다. 한 출격에서 서로 다른 두 권역의 맑음과 안개를 한 번씩 기록하고 정상 탈출하세요. 관측 버튼을 누른 시점의 현장 날씨가 기록됩니다. 두 날씨의 관측 순서는 자유입니다.',
    cr:26000,xp:95,goal:'다른 권역의 맑음과 안개 기록',target:2,progress:()=>surveyObservations().length},
  {id:'courier-checkin',after:'sealed-mail',image:'bunker-stash',issuer:'벙커 배차반',title:'배달 뒤의 소식',
    text:'회송한 우편낭이 수송망에 올랐습니다. 한 출격에서 서로 다른 두 권역에 정차한 기록 운반원 은서를 만나 소식을 확인하세요. 현장에서 흔적을 조사하고 따라간 뒤 말을 걸어야 만남이 기록됩니다. 물통 지원은 선택입니다. 정상 탈출하면 배차반이 수당을 지급합니다.',
    cr:38000,xp:135,goal:'서로 다른 권역에서 운반원과 대화',target:2,progress:()=>courierCheckins().length},
  {id:'external-relief',afterReply:true,image:'bunker-kitchen',issuer:'외부 벙커 연락반',title:'회신 뒤의 첫 보급',
    text:'외부 벙커에서 첫 보급을 요청했습니다. 외곽 배급소 식당의 급식 보급, 또는 폐쇄 검문소 감시 통제실의 전원 부품 중 하나를 선택해 현장 가방에서 인계하고 정상 탈출하세요.',
    cr:36000,xp:110,goal:'외부 벙커 보급 요청 한 건 인계',target:1,progress:()=>reliefProgress()},
  {id:'ward-packing',afterWard:true,image:'bunker-med',issuer:'윤서진 · 의무실',title:'회수 포장 대조',
    text:'초도 납품 뒤 회수 포장을 점검합니다. 접이식 야전 처치포를 출격 가방에 담고, 외곽 임시 진료소의 진료대 응급함 또는 검문소 검역 천막의 응급 케이스를 끝까지 수색하세요. 임시 진료소는 열쇠 없이 이용합니다. 검역 천막의 케이스에는 검역실 열쇠가 필요합니다. 포장 표식에 대조한 바로 그 처치포를 가지고 정상 탈출하세요. 처치포는 귀환 후 창고에 보관됩니다.',
    cr:18000,xp:75,goal:'포장을 대조한 처치포 원본 휴대',target:1,progress:()=>Number(wardCheckCarried())}
];
let career,orderFeedback='',raidAckFeedback='';
function readCareer(raw={},reply=null,clinic=null) {
  orderFeedback='';raidAckFeedback='';pumpNotice=null;
  const number = n => Number.isSafeInteger(n) && n>=0 ? n : 0;
  const completed = Array.isArray(raw?.done) ? raw.done : [];
  const done = ORDERS.filter(q=>completed.includes(q.id) && orderUnlocked(q,completed,reply,clinic) &&
    (q.id!==WARD_FIELD_ID || wardCheckRecord(raw.wardCheckReceipt,clinic?.wardTrial?.paid)) &&
    (q.id!==RELIEF_ORDER || validReliefRecord(raw.reliefReceipt,reply))).map(q=>q.id);
  career = {...(raw?.surveyedBoxes?.length&&validSurveyList(raw.surveyedBoxes)?{surveyedBoxes:[...raw.surveyedBoxes]}:{}),...(done.includes(WARD_FIELD_ID)?{wardCheckReceipt:{...raw.wardCheckReceipt}}:{}),...(done.includes(RELIEF_ORDER)?{reliefReceipt:{...raw.reliefReceipt}}:{}),xp:number(raw?.xp), sorties:number(raw?.sorties), returns:number(raw?.returns),
    victories:number(raw?.victories), victoriesFrom:Number.isSafeInteger(raw?.victoriesFrom)?number(raw.victoriesFrom):number(raw?.sorties),
    done, order:ORDERS.some(q=>q.id===raw?.order && !done.includes(q.id) && orderUnlocked(q,done,reply,clinic))?raw.order:null,
    history:Array.isArray(raw?.history)?raw.history.slice(0,12).map(row=>{
      if(!row || (validHistoryGear(row) && historyGearMatches(row,lastSummary)))return row;
      const {gearReport,gearOmitted,...rest}=row;
      return rest;
    }):[]};
}
function playerLevel(){return 1+Math.floor(Math.sqrt(career.xp/150))}
function shuffleExits(){
  const pool=EXITS.filter(e=>e.id!=='b04').map(e=>e.id);
  for(let i=pool.length-1;i>0;i--){const k=Math.floor(Math.random()*(i+1));[pool[i],pool[k]]=[pool[k],pool[i]]}
  return ['b04',...pool.slice(0,1+Math.floor(Math.random()*3))];
}
function prepareSortie(legacy=false){
  if(!raid)return;
  if(!Array.isArray(field.exits))field.exits=legacy?EXITS.map(e=>e.id):shuffleExits();
  if(!Number.isInteger(field.hp))field.hp=100;
  if(!Number.isInteger(field.steps))field.steps=0;
  if(!Number.isInteger(field.nextContact))field.nextContact=3+Math.floor(Math.random()*2);
  if(!Number.isInteger(field.victories))field.victories=0;
}
function actionDuration(type,ms,at=Date.now(),region=raid?.zone??zone){
  const kit=raid && !field.result ? field : equipmentState;
  const base=adjustHideoutActionMs(type,ms);
  const gearFactor=(type==='scan' ? gearScanFactor(kit) : 1) * kitModuleTimeFactor(type,kit);
  const duration=injuryDuration(type,Math.round(base*gearFactor));
  return type==='scan' ? Math.round(duration*regionalWeather(region,at).scanFactor) : duration;
}
function durationLabel(type,ms){return (actionDuration(type,ms)/1000).toLocaleString('ko-KR')+'초'}
const VEHICLE_EXIT_FEE = 15000;
function vehicleFareBalance(carried = cashSum(field.bag)) {
  return (wallet - VEHICLE_EXIT_FEE) + carried;
}
function pointStatus(e, time, starting){
  if(!raid||field.result||time>=raid.endsAt)return '레이드 종료';
  if(field.journey)return '이동 중';
  if(!field.exits?.includes(e.id))return '미배정 탈출구';
  if(e.rule==='pay'&&vehicleFareBalance()<0)return '15,000 CR 필요';
  if(e.rule==='empty'&&hasRaidBackpack())return '배낭을 벗어야 합니다';
  if(e.rule==='card'&&!raidHasItem('keycard'))return '통제구역 키카드 필요';
  if(e.rule==='radio'&&!raidHasItem('radio'))return '무전기 필요';
  if(e.rule==='radio'&&!workingRaidRadio())return '작동하는 무전기 필요';
  const end=starting?time+e.sec*1000:time;
  if(e.rule==='train'){
    const [opens,closes]=trainWindow();
    if(time<opens)return '열차 도착 대기';
    if(end>=closes)return '열차 탑승 마감';
  }
  return end>=raid.endsAt?'남은 레이드 시간 부족':'';
}
function exhaustionDamage(energy,water){
  return energy>0&&water>0?0:8;
}
function sufferExhaustion(at){
  const damage=exhaustionDamage(field.energy,field.water);
  if(!damage)return false;
  field.hp=Math.max(0,field.hp-damage);
  if(field.hp===0){finishRaid('kia',at);return true}
  logField('탈진으로 체력 '+damage+' 감소. 식량이나 물을 사용하세요.');
  return false;
}
function encounterAfter(a){
  if(field.result || !['scan','move'].includes(a.type))return;
  field.steps++;
  if(sufferExhaustion(a.end))return;
  if(field.steps<field.nextContact)return;
  const spec=CONTACTS[raid.zone];
  field.contact={zone:raid.zone,hp:spec.hp};
  field.nextContact=field.steps+3+Math.floor(Math.random()*3);
  field.open=null;
  picked=null;
  logField(spec.name+' 접근. 대응을 선택하세요.');
}
function resolveEncounter(a){
  const c=field.contact;
  field.action=null;
  if(!c)return;
  const spec=CONTACTS[c.zone];
  const strike=a.type==='engage';
  if(!strike&&(a.escaped??(Math.random()<ESCAPE_CHANCE))){
    field.contact=null;
    logField(spec.name+'에게서 도주 성공.');
    if(field.journey)resumeJourney(a.end);
    return;
  }
  if(strike){
    settlementNeedsCommit=true;
    if(a.legacyGear)delete field.legacyEngagement;
    if(!payEngagement(a)){logField('장비 상태가 달라져 교전을 중단했습니다.');return;}
    const bonus=a.strike?.slot==='secondary'?2:gearAttackBonus();
    const hit=14+Math.min(10,playerLevel()-1)+bonus+(a.strike?.attackRoll??Math.floor(Math.random()*7));
    c.hp=Math.max(0,c.hp-hit);
    if(!c.hp){
      field.contact=null;
      field.victories++;
      recordRecurringKill(c.zone,a.end);
      logField(spec.name+' 무력화.');
      if(field.journey)resumeJourney(a.end);
      return;
    }
    delete c.escapeDamage;
  }
  const damage=Math.max(1,(strike?spec.power:Math.ceil(spec.power*0.55))+(a.strike?.defenseRoll??Math.floor(Math.random()*5))-gearDefenseBonus());
  if(!a.legacyGear)for(const slot of ['armor','head','eyes'])wearEquipment(slot);
  if(!strike)c.escapeDamage=damage;
  const lost=Math.min(field.hp,damage);
  field.hp=Math.max(0,field.hp-damage);
  recordContactInjury(a.end,lost);
  logField((strike?'교전 지속':'도주 실패')+' · 체력 '+damage+' 감소.');
  if(!field.hp)finishRaid('kia',a.end);
}
function contactLocationNote(objective){
  if(field.journey)return '<span data-contact-context="road">이동 중 접촉했습니다. 도주하거나 교전하세요.</span>';
  const z=raid.zone,area=FIELD_ZONES[z],site=currentLandmark(z),known=field.found[z]||[];
  const found=site.boxes.filter(index=>known.includes(index));
  const recovery=objective?.recovery;
  const source=recovery&&recovery.carried<recovery.required&&recovery.sources.find(s=>s.zone===z&&LANDMARKS[z][s.landmark]===site);
  const targets=found.filter(index=>{
    if(objective?.inspections?.some(s=>s.zone===z&&s.index===index&&!s.complete))return true;
    if(!source||(source.boxOrdinal!==undefined&&site.boxes[source.boxOrdinal]!==index))return false;
    const box=field.boxes[boxKey(z,index)];
    return !box?.complete||box.items.some(unit=>unit.revealed&&unit.g===recovery.item);
  });
  const pinned=targets.length?' · <span data-contact-target>의뢰 수색 대상 '+targets.map(i=>esc(area.boxes[i][0])).join(', ')+'</span>':'';
  return '<span data-contact-context="landmark">'+esc(area.name)+' · '+esc(site.name)+
    ' · <span data-contact-found="'+found.length+'">발견한 보관함 '+found.length+'개</span>'+pinned+
    '. 도주 성공 또는 교전 승리 후 이곳에서 다음 행동을 선택하세요.</span>';
}
function contactPage(){
  const c=field.contact, spec=CONTACTS[c.zone], busy=!!field.action;
  const objective=resolveObjective();
  return head('FIELD / CONTACT',spec.name,contactLocationNote(objective))+
    weatherBrief('field',raid.zone)+journeyProgress()+injuryFieldBrief()+
    '<section class="panel combat"><div class="combat-vitals"><div>내 체력 <strong>'+field.hp+' / 100</strong></div><div>상대 내구도 <strong>'+c.hp+' / '+spec.hp+'</strong></div></div>'+
    '<p>도주에 성공하면 피해 없이 벗어납니다. 실패하면 피해를 받고, 다시 도주하거나 교전할 수 있습니다.</p>'+
    (c.escapeDamage?'<p class="evade-result" role="status">도주 실패 · 체력 '+Number(c.escapeDamage)+' 감소</p>':'')+
    (notice?'<p role="status">'+esc(notice)+'</p>':'')+actionMarkup()+'<div class="contact-buttons">'+gearEngageButtons(busy)+'<button data-field="evade" '+(busy?'disabled':'')+'>도주 · '+durationLabel('evade',2000)+' · 성공 '+Math.round(ESCAPE_CHANCE*100)+'%</button><button data-page="inventory">장비 · 응급 처치</button></div></section>'+
    objectivePanel('field',objective)+'<section class="field-section"><h2>현장 기록</h2>'+field.log.slice(0,4).map(l=>'<p>'+esc(l)+'</p>').join('')+'</section>';
}

const ENDINGS={
  success:['SURVIVED','탈출 성공'], quick:['RUN THROUGH','조기 탈출'], kia:['KIA','전투 불능'], expired:['MIA','시간 초과'],abandoned:['LEFT','레이드 포기']
};
const NORMAL_EXTRACTION={elapsedMs:7*60000,searched:2,victories:1};
function qualifiesNormalExtraction(elapsedMs, searched, victories) {
  return elapsedMs>=NORMAL_EXTRACTION.elapsedMs || searched>=NORMAL_EXTRACTION.searched || victories>=NORMAL_EXTRACTION.victories;
}
function bunkerOrderAward(normal,balanceAfterExit){
  const order=ORDERS.find(q=>q.id===career.order);
  if(!order || !orderUnlocked(order) || career.done.includes(order.id))return null;
  const progress=Math.min(order.target,order.progress(order));
  const fits=Number.isSafeInteger(balanceAfterExit+order.cr);
  return {order,progress,fits,payable:normal&&progress>=order.target&&fits};
}
function reconcileEnd(result,at,exit=null){
  if(!raid || field.result && (field.result!=='expired'||lastSummary?.raidId===raid.startedAt))return;
  if(injuryState?.raidId===raid.startedAt)at=Math.max(at,injuryState.events.at(-1)?.at||0);
  if(survivorState.active?.raidId===raid.startedAt){
    at=Math.max(at,survivorLastAction(survivorState.active),field.survivorScavenge?.at||0);
  }
  const recoveredBag=field.bag.filter(unit=>unit.g!==POSTAL_ITEM);
  const goods=recoveredBag.map(o=>o.g).filter(id=>id!=='cr_notes'&&Object.hasOwn(GOODS,id));
  const carriedCash=typeof cashSum==='function'?cashSum(field.bag):0;
  const returned=result==='success';
  const elapsed=Math.max(0,Math.min(RAID_DURATION_MS,at-raid.startedAt));
  const searched=Object.values(field.boxes).filter(b=>b.complete).length;
  const visited=(field.visited||[raid.zone]).length;
  const victories=field.victories||0;
  const quick=returned && !qualifiesNormalExtraction(elapsed,searched,victories);
  const rating=quick?'quick':result;
  const contractUpdates=settleTraderContracts(rating);
  const campaignStage=settleCampaignReturn(rating,raid.startedAt);
  const finaleAttempt=finaleState.attempt;
  const finaleReply=settleFinaleReturn(rating,raid.startedAt);
  const cost=returned&&exit?.rule==='pay'?VEHICLE_EXIT_FEE:0;
  const earned=returned?(quick?25:100+searched*25+Math.max(0,visited-1)*20+victories*50):0;
  let commission=0, missionXp=0, orderName='';
  const award=returned?bunkerOrderAward(!quick,(wallet-cost)+carriedCash):null;
  const order=award?.order;
  if(award?.payable){
    commission=order.cr;missionXp=order.xp;orderName=order.title;
    if(order.id===WARD_FIELD_ID)career.wardCheckReceipt={...field.wardCheck};
    if(order.id===RELIEF_ORDER)career.reliefReceipt={...field.reliefDelivery};
    career.done.push(order.id);career.order=null;
  }
  if(returned && exit?.rule==='radio')recordGearUse(workingRaidRadio(),0,1);
  const gearReport=sortieGearReport(returned);
  const walletBeforeSettlement=wallet;
  if(returned){
    for(const unit of recoveredBag){
      if(unit.g==='rl_bp_dressing')receiveWardSheet(unit.uid);
      else if(unit.g!=='cr_notes')addStashGoods(unit.g,1,unit.gear,unit.uid);
    }
    wallet=(wallet-cost)+carriedCash+commission;
    career.returns++;
  }
  const worn=finishEquipmentRaid(returned);
  career.sorties++;career.xp+=earned+missionXp;career.victories+=victories;
  const summary={raidId:raid.startedAt,result,rating,exit:exit?.name||null,elapsed,goods,cost,visited,searched,victories,
    worn,earned,commission,missionXp,orderName,contractUpdates,gearReport,...(carriedCash?{carriedCash}:{})};
  if(returned){
    const discoveries=recordReturnedSurveys(field);
    if(discoveries.length)summary.newSurveyBoxes=discoveries;
  }
  settleInjuries(summary);
  delete field.gearUsage;delete field.legacyEngagement;
  const survivorSortie=survivorState.active?.raidId===raid.startedAt;
  if(survivorSortie)finishSurvivorRaid(raid.startedAt);
  settlementNeedsCommit=true;
  if (campaignStage) summary.campaignStage=campaignStage;
  if (finaleAttempt?.raidId===raid.startedAt) summary.finaleAttempt={zones:[...finaleAttempt.confirmed]};
  if (finaleReply) summary.finaleReply=true;
  if (orderName && objectivePin?.kind === 'order' && objectivePin.id === order.id) {
    summary.completedObjectiveOrder = order.id;
  }
  lastSummary=summary;
  career.history.unshift({
    rating, elapsed, xp:earned+missionXp, exit:summary.exit, at, zone:raid.zone,
    visited, searched, victories, carriedCash, cash:wallet-walletBeforeSettlement, goods:returned?goods.slice():[],
    commission, missionXp, orderName, cost, ...archiveGearReport(gearReport)
  });
  career.history.length=Math.min(12,career.history.length);
  delete field.wardCheck;delete field.reliefDelivery;delete field.postal;delete field.weatherSurvey;delete field.pumpGauge;pumpNotice=null;
  field.result=result;field.journey=null;field.bag=[];field.action=null;field.contact=null;field.open=null;picked=null;dragged=null;exitNotice='';
  logField(ENDINGS[rating][1]+'. 정산 완료.');
}
function returnMarketOffers(){
  if(!raid||field.result!=='success'||lastSummary?.result!=='success'||
    lastSummary.raidId!==raid.startedAt||!['success','quick'].includes(lastSummary.rating)||!Array.isArray(lastSummary.goods))return [];
  // Receipts record item types. Their original field UIDs are not available after admission to storage.
  const loose=new Set(stashSlots.filter(unit=>!unit.contents?.length&&!unit.gear?.module).map(unit=>unit.g));
  const offers=[];
  for(const id of new Set(lastSummary.goods)){
    if(!Object.hasOwn(GOODS,id)||!loose.has(id)||exchangeRestricted(id)||kitSlot(id)||Object.hasOwn(STORAGE_CASES,id))continue;
    const unit=stashSalePrice(id);
    const buyers=MARKET_TRADERS.filter(trader=>marketBuys(trader.id,id));
    if(buyers.length&&cashCanCredit(unit))offers.push({id,unit,buyers});
  }
  return offers;
}
function returnMarketPanel(){
  const offers=returnMarketOffers();
  if(!offers.length)return '';
  const rows=offers.map(({id,unit,buyers})=>{
    const buttons=buyers.map(trader=>'<button type="button" data-raid="sale" data-trader="'+trader.id+'" data-id="'+esc(id)+
      '" data-return-id="'+raid.startedAt+'"'+(writer?'':' disabled')+'>'+esc(trader.name)+' 판매 화면</button>').join('');
    return '<li data-return-item="'+esc(id)+'"><span>'+esc(kitName(id))+'</span><b data-return-unit="'+unit+'">1개 '+money(unit)+
      '</b><div class="obj-actions">'+buttons+'</div></li>';
  }).join('');
  return '<details data-return-market><summary>매입처·단가 보기</summary><p>회수한 일반 물품 중 창고에 같은 품목이 있는 경우, 한 개의 매입가를 표시합니다. 상인을 누르면 벙커로 복귀한 뒤 판매할 물품을 직접 선택합니다.</p>'+
    '<ul class="obj-goals">'+rows+'</ul></details>';
}
function nextBunkerOrder(report) {
  if (!raid || field.result!=='success' || report?.rating!=='success' || report.raidId!==raid.startedAt) return null;
  const completed=ORDERS.find(order=>order.title===report.orderName && order.cr===report.commission && career.done.includes(order.id));
  return completed ? ORDERS.find(order=>order.after===completed.id && !career.done.includes(order.id)) : null;
}
function resultPage(){
  const r=field.result?lastSummary:null;
  const status=raidAckFeedback||(!writer?'다른 탭에서 플레이 중입니다. 해당 탭에서 벙커로 복귀하세요.':'');
  const ack=(status?'<p class="exit-warn" role="status">'+esc(status)+'</p>':'')+
    '<button class="primary" data-raid="ack"'+(writer?'':' disabled')+'>벙커로 복귀</button>';
  if(!r)return head('FIELD / ENDED','레이드 종료','정산 기록이 없습니다.')+ack;
  const returned=r.result==='success',rating=r.rating||r.result;
  const next=nextBunkerOrder(r);
  const [code,label]=ENDINGS[rating]||ENDINGS.expired;
  const counts={};
  for(const id of r.goods||[])if(Object.hasOwn(GOODS,id))counts[id]=(counts[id]||0)+1;
  return head('AFTER ACTION REPORT',label,returned?'휴대 물품을 벙커로 회수했습니다.':'이번 출격의 휴대 물품과 착용 장비를 잃었습니다.')+
    huntSummary('result')+objectivePanel('result')+campaignSettlementNote(r)+finaleSettlementNote(r)+surveySummaryMarkup(r)+'<section class="panel result-panel"><h2 class="'+(returned?'exit-ok':'exit-warn')+'">'+code+'</h2>'+
    (rating==='quick'?'<p>7분 전에 귀환했고 수색 완료 2회와 교전 승리 1회 중 어느 조건도 채우지 않아 조기 탈출로 기록됐습니다. 물품은 보존되며 기본 경험치 25를 받습니다.</p>':'')+
    '<div class="field-metrics"><div>경과 시간<b>'+formatRaid(r.elapsed)+'</b></div><div>방문 지역<b>'+r.visited+'</b></div><div>수색 완료<b>'+r.searched+'</b></div><div>교전 승리<b>'+(r.victories||0)+'</b></div></div>'+
    '<p>'+esc(r.exit||'탈출구 미도달')+' · 탈출 비용 '+money(r.cost||0)+' · 경험치 +'+((r.earned||0)+(r.missionXp||0))+'</p>'+
    (r.carriedCash?'<p>휴대 지폐 '+(returned?'회수':'손실')+' · '+money(r.carriedCash)+'</p>':'')+
    (returned && counts.rl_bp_dressing?'<p>작업지침을 회수했습니다. 의무실에서 원본을 등록하세요.'+(hideout.wardManual.waiting.length?' 창고 공간이 부족한 원본은 의무실 인계칸에 있습니다.':'')+'</p>':'')+
    (r.orderName?'<p class="exit-ok">'+esc(r.orderName)+' 의뢰 완료 · '+money(r.commission)+'</p>':'')+
    (next?'<button type="button" data-bui="order-followup" data-id="'+esc(next.id)+'" data-return-id="'+r.raidId+'" '+(writer?'':'disabled')+'>벙커 복귀 · 후속 의뢰 보기 · '+esc(next.title)+'</button>':'')+
    '<h3>'+(returned?'회수한 물품':'잃은 물품')+'</h3><div class="db-list">'+(Object.entries(counts).map(([id,n])=>'<div class="stash-row">'+ico(GOODS[id][4])+'<span>'+GOODS[id][0]+'</span><b>×'+n+'</b></div>').join('')||'<p>휴대 물품 없음</p>')+'</div>'+returnMarketPanel()+equipmentSummary(r)+gearSettlementMarkup(r)+injurySummaryMarkup(r)+contractResultPanel(r.contractUpdates)+
    ack+'</section>';
}
function journalPage(){
  const lv=playerLevel();
  return head('03 / FIELD JOURNAL','작전 기록','대원 성장과 벙커에서 수신한 의뢰')+
    '<section class="panel"><h2>대원 Lv.'+lv+'</h2><p>'+career.xp+' XP · 다음 레벨 '+(150*lv*lv)+' XP · 출격 '+career.sorties+'회 · 귀환 '+career.returns+'회</p><p>레벨마다 교전 피해가 1 증가합니다. 최대 보너스는 10입니다.</p></section>'+
    '<section class="field-section"><h2>벙커 의뢰</h2><p>출격 전에 한 건을 수락하세요. 정상 탈출 시 조건을 확인하고 보상을 지급합니다.</p>'+orderStatus()+'<div class="orders">'+ORDERS.filter(q=>orderUnlocked(q)).map(q=>{
      const done=career.done.includes(q.id),active=career.order===q.id;
      return '<article class="panel"><small>'+q.issuer+'</small><h3>'+q.title+'</h3><p>'+q.text+'</p><p>'+money(q.cr)+' · '+q.xp+' XP</p><button data-order="'+q.id+'" '+(!writer||done||raid||(!active&&career.order)?'disabled':'')+'>'+(done?'완료':active?'수락 취소':'의뢰 수락')+'</button></article>';
    }).join('')+'</div></section><section class="field-section"><h2>최근 출격</h2>'+
    (career.history.map(row=>'<div class="sortie-row"><b>'+esc((ENDINGS[row.rating]||ENDINGS.expired)[1])+'</b><span>'+esc(row.exit||'귀환 실패')+' · '+formatRaid(row.elapsed)+' · '+Number(row.xp)+' XP</span></div>').join('')||'<p>첫 출격을 마치면 이곳에 결과가 기록됩니다.</p>')+'</section>';
}
function orderStatus(){
  const status=orderFeedback||(!writer?'다른 탭에서 플레이 중입니다. 해당 탭에서 의뢰를 변경하세요.':'');
  return status?'<p role="status" class="bu-minor">'+esc(status)+'</p>':'';
}
function changeOrder(id){
  if(!writer)return;
  const owner=career;
  reconcile();
  if(owner!==career){
    orderFeedback='의뢰 기록을 다시 불러왔습니다. 현재 상태를 확인하세요.';
    renderKeep();return;
  }
  if(raid||!ORDERS.some(q=>q.id===id && orderUnlocked(q))||career.done.includes(id)||(career.order&&career.order!==id))return;
  const previous=career.order;
  career.order=previous===id?null:id;
  orderFeedback='';
  if(!writeSession()){
    if(career===owner){
      career.order=previous;
      orderFeedback='의뢰 변경을 저장하지 못했습니다. 다시 시도하세요.';
    }else orderFeedback='다른 탭의 최신 의뢰 기록을 불러왔습니다.';
  }
  renderKeep();
}
