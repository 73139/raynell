// The first request from the external bunker has two mutually exclusive handover sites.
const RELIEF_ORDER='external-relief';
const RELIEF_REQUESTS={
  meals:{name:'급식 보급',zone:0,landmark:3,items:{food:2,water:2}},
  power:{name:'전원 부품',zone:1,landmark:3,items:{battery:1,rl_03_25:1}}
};
function validReliefRecord(record,reply){
  return Boolean(record&&typeof record==='object'&&!Array.isArray(record)&&Object.keys(record).length===3&&
    typeof record.kind==='string'&&Object.hasOwn(RELIEF_REQUESTS,record.kind)&&Number.isSafeInteger(reply?.raidId)&&Number.isSafeInteger(record.raidId)&&
    record.raidId>reply.raidId&&Number.isSafeInteger(record.raidId+RAID_DURATION_MS)&&Number.isSafeInteger(record.at)&&
    record.at<=Date.now()&&record.at>=record.raidId&&record.at<record.raidId+RAID_DURATION_MS);
}
function validReliefBackup(s){
  const job=s.career?.order===RELIEF_ORDER,complete=Array.isArray(s.career?.done)&&s.career.done.includes(RELIEF_ORDER);
  const delivery=s.field?.reliefDelivery,receipt=s.career?.reliefReceipt,reply=s.finale?.reply;
  if(!job&&!complete&&delivery===undefined&&receipt===undefined)return true;
  if(!reply||(job&&complete)||complete!==(receipt!==undefined))return false;
  if(delivery!==undefined){
    if(!job || !validReliefRecord(delivery,reply) || !s.raid || delivery.raidId!==s.raid.startedAt ||
       delivery.raidId!==s.field.raidId || s.field.result || !Array.isArray(s.field.visited) ||
       !s.field.visited.includes(RELIEF_REQUESTS[delivery.kind].zone))return false;
  }
  if(!complete)return true;
  if(!validReliefRecord(receipt,reply))return false;
  const recent=s.lastSummary;
  if(recent?.raidId===receipt.raidId&&(recent.rating!=='success'||recent.orderName!==reliefOrder().title||
     recent.commission!==reliefOrder().cr||recent.missionXp!==reliefOrder().xp))return false;
  return true;
}
function reliefOrder(){return ORDERS.find(q=>q.id===RELIEF_ORDER);}
function reliefAt(request){return isActive()&&raid.zone===request.zone&&field.landmarkByZone?.[raid.zone]===request.landmark;}
function reliefProgress(){return Number(Boolean(raid&&!field.result&&career.order===RELIEF_ORDER&&field.reliefDelivery?.raidId===raid.startedAt));}
function reliefMaterials(request,bag){
  return Object.entries(request.items).map(([id,need])=>({id,need,units:bag.filter(unit=>unit.g===id).slice(0,need)}));
}
function reliefDirections(){
  return field.reliefDelivery&&isActive()?[]:Object.values(RELIEF_REQUESTS).map(({zone,landmark})=>({zone,landmark}));
}
function reliefRequestMarkup(kind,fieldView){
  const request=RELIEF_REQUESTS[kind],bag=isActive()?field.bag:equipmentState.bag;
  const lines=reliefMaterials(request,bag),ready=lines.every(line=>line.units.length===line.need);
  const area=FIELD_ZONES[request.zone].name+' · '+LANDMARKS[request.zone][request.landmark].name;
  const items=lines.map(line=>esc(kitName(line.id))+' '+line.units.length+' / '+line.need).join(' · ');
  const blocked=!ready||!writer||field.action||field.contact||field.open||field.journey;
  return '<div data-relief-choice="'+kind+'"><h4>'+esc(request.name)+'</h4><p>'+esc(area)+'</p><p>가방에 준비한 수량 · '+items+'</p>'+
    (fieldView?'<button type="button" data-field="relief-deliver" data-kind="'+kind+'" data-raid-id="'+raid.startedAt+'"'+(blocked?' disabled':'')+'>'+esc(request.name)+' 인계</button>':'')+'</div>';
}
function reliefPanel(fieldView=false){
  const active=isActive()&&career.order===RELIEF_ORDER;
  if(fieldView&&!active)return '';
  const receipt=career.reliefReceipt||(active?field.reliefDelivery:null);
  if(receipt){
    const name=RELIEF_REQUESTS[receipt.kind].name;
    if(fieldView&&!reliefAt(RELIEF_REQUESTS[receipt.kind]))return '';
    return '<section class="pump-gauge" data-relief-stage="'+(career.reliefReceipt?'settled':'given')+'"><h3 tabindex="-1">'+esc(name)+' 인계 완료</h3><p>'+
      (career.reliefReceipt?'외부 벙커에서 첫 보급품을 수령했습니다.':'정상 탈출하면 수당을 받습니다.')+'</p></section>';
  }
  const choices=Object.keys(RELIEF_REQUESTS).filter(kind=>!fieldView||reliefAt(RELIEF_REQUESTS[kind]));
  if(!choices.length)return '';
  return '<section class="pump-gauge" data-relief-stage="ready"><h3>첫 보급 요청</h3><p>두 요청 중 하나를 고르세요. 인계한 물품은 가방에서 즉시 빠지며 정상 탈출할 때 보상이 지급됩니다.</p>'+
    choices.map(kind=>reliefRequestMarkup(kind,fieldView)).join('')+'</section>';
}
function handleReliefDelivery(d){
  if(!writer||!isActive()||career.order!==RELIEF_ORDER||!finaleState.reply||d.raidId!==String(raid.startedAt)||
     Date.now()>=raid.endsAt||field.reliefDelivery||field.contact||field.open||field.journey||field.action||!Object.hasOwn(RELIEF_REQUESTS,d.kind))return;
  const request=RELIEF_REQUESTS[d.kind];
  if(!reliefAt(request))return;
  const before=field.bag,lines=reliefMaterials(request,before);
  if(lines.some(line=>line.units.length!==line.need))return;
  const given=new Set(lines.flatMap(line=>line.units)),owner=field;
  field.bag=before.filter(unit=>!given.has(unit));field.reliefDelivery={kind:d.kind,raidId:raid.startedAt,at:Date.now()};
  if(!writeSession()){
    if(owner===field){field.bag=before;delete field.reliefDelivery;notice='보급 인계를 저장하지 못했습니다. 가방을 확인한 뒤 다시 시도하세요.';}
    renderKeep();return;
  }
  if(picked?.side==='bag' && lines.some(line=>line.units.some(unit=>unit.uid===picked.uid)))picked=null;
  renderKeep();$('[data-relief-stage="given"] h3')?.focus?.({preventScroll:true});
}
