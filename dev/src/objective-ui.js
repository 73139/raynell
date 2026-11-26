// All displayed quantities come from the same objective model, including fog-of-war-safe map hints.
function sameObjective(a,b){
  return Boolean(a && b && a.kind===b.kind && a.id===b.id && a.key===b.key && a.tier===b.tier);
}

function objectiveControl(pin,selected=sameObjective(objectivePin,pin)){
  const extra=pin.key===undefined?'':' data-key="'+pin.key+'" data-trader="'+esc(pin.trader)+'"';
  const review=selected&&!raid&&!['prep','map'].includes(page)&&resolveObjective()?.materials.length
    ? '<button type="button" class="obj-pin" data-objective="procurement-review">부족품 조달표</button>' : '';
  return '<button type="button" class="obj-pin" data-objective="'+(selected?'clear':'pin')+'" data-kind="'+esc(pin.kind)+
    '" data-id="'+esc(pin.id)+'"'+extra+(pin.tier===undefined?'':' data-tier="'+pin.tier+'"')+
    ' aria-pressed="'+selected+'" '+(writer?'':'disabled')+'>'+commandIcon('pin')+
    (selected?'목표 고정 해제':objectivePin?'이 목표로 교체':'출격 목표로 고정')+'</button>'+review;
}

function objectiveLocationLabel(locations,zone,landmark){
  const matches=locations.filter(loc=>loc.zone===zone && (landmark===undefined||loc.landmark===landmark));
  return matches.length?(matches.some(loc=>!loc.possible)?'목표 지역':'수급 후보'):'';
}

function objectivePlaceName(loc){
  const area=FIELD_ZONES[loc.zone].name;
  return Number.isInteger(loc.landmark)?area+' · '+LANDMARKS[loc.zone][loc.landmark].name:area;
}

function recoveryPreparationPanel(source){
  const sites=recoveryPreparation(source);
  if(!sites.length)return '';
  const rows=sites.map(site=>{
    const {zone,landmark,index,lock,stored,status}=site;
    let detail='열쇠 없이 개방 가능',action='';
    if(lock){
      const held={equipped:'열쇠 고리 장착 · 개방 가능',bag:'출격 가방에 휴대 · 개방 가능'};
      detail=lock.keyName+' · '+(held[status]||'미보유');
      if(stored){
        const where=stored.kind==='case'?stored.caseName:stored.kind==='overflow'?'창고 입고 대기':'창고';
        detail=lock.keyName+' · '+where+' 보관 중 · 출격 장비로 옮겨야 개방 가능';
        action='<button type="button" data-pos="locate" data-key="'+esc(stored.key)+'">보관 위치 열기</button>';
      }else if(status==='missing'&&marketIsUnlocked(lock.traderId,lock.keyId)){
        action='<button type="button" data-lootplan="shop" data-id="'+esc(lock.keyId)+'"'+(writer?'':' disabled')+'>'+esc(lock.keySource)+'의 열쇠 보기</button>';
      }
    }
    return '<li data-ready-site="'+zone+'-'+landmark+'" data-key-state="'+status+'"><span>'+esc(objectivePlaceName(site))+
      ' · '+esc(FIELD_ZONES[zone].boxes[index][0])+'</span><div><b>'+esc(detail)+'</b>'+action+'</div></li>';
  }).join('');
  return '<section data-order-readiness><p class="obj-label">의뢰 수색지 개방 조건</p><ul class="obj-goals">'+rows+'</ul></section>';
}

function inspectionRouteMarkup(plan){
  const names=plan.path.map(z=>FIELD_ZONES[z].name).join(' → ');
  const chance=plan.contactChance.toLocaleString('ko-KR',{style:'percent',maximumFractionDigits:1});
  return '<section data-inspection-route data-origin="'+plan.origin+'" data-start-landmark="'+plan.start+'" data-path="'+plan.path.join(',')+
    '" data-legs="'+plan.legs+'" data-cells="'+plan.cells+'" data-walk-ms="'+plan.walkMs+'"><p class="obj-label">B-04 귀환 경로 예시</p>'+
    '<p class="obj-place"><b>투입 지점</b> '+esc(FIELD_ZONES[plan.origin].name)+' · '+esc(LANDMARKS[plan.origin][plan.start].name)+
    '<br>'+esc(names)+' · B-04 탈출구</p><p class="obj-place">권역 이동 '+plan.legs+'회 · '+plan.cells+'칸 · 순수 이동 '+routeSeconds(plan.walkMs)+
    ' · 이동 중 한 번 이상 조우할 확률 '+chance+'</p><p class="obj-rule">현재 장비·시설 기준입니다. 수색, 보급 선택, 교전 및 탈출 대기 시간은 제외합니다.</p></section>';
}
function inspectionChecklist(sites,context,plan=null){
  const rows=(plan?plan.ordered:sites).map((site,i)=>{
    const name=FIELD_ZONES[site.zone].boxes[site.index][0];
    const label=site.complete?'수색 완료':'미확인';
    return '<li data-inspection-box="'+site.zone+'-'+site.index+'" data-complete="'+site.complete+'"><span>'+
      (plan?(i+1)+'. ':'')+esc(objectivePlaceName(site))+' · '+esc(name)+'</span><b>'+label+'</b></li>';
  }).join('');
  let next='';
  if(context==='result')next='<p class="obj-place">다음 출격에서 두 서랍을 다시 확인하세요.</p>';
  else if(sites.every(site=>site.complete))next='<p class="obj-place">두 서랍을 확인했습니다. 이용 가능한 탈출구로 귀환하세요.</p>';
  return (plan?inspectionRouteMarkup(plan):'')+'<ul class="obj-goals" aria-label="'+(plan?'두 서랍 수색 순서':'인계표 수색 기록')+'">'+rows+'</ul>'+next;
}

function recoverySiteStatus(state,itemName){
  if(state==='available')return '수색 완료 · '+itemName+' 남음';
  if(state==='empty')return '수색 완료 · 남은 '+itemName+' 없음';
  return {searching:'수색 중',partial:'일부 확인',unsearched:'미수색'}[state];
}

function recoverySearchPanel(objective){
  const search=objective.search;
  if(!search)return '';
  const itemName=GOODS[objective.recovery.item][0],{sites,groundZones}=search;
  const rows=sites.map(site=>'<li data-recovery-site="'+site.zone+'-'+site.landmark+'" data-recovery-state="'+site.state+'"><span>'+
    esc(FIELD_ZONES[site.zone].boxes[site.index][0])+'</span><b>'+esc(recoverySiteStatus(site.state,itemName))+'</b></li>').join('');
  const available=sites.find(site=>site.state==='available'),remaining=sites.filter(site=>site.state!=='empty');
  let advice='',kind='';
  if(groundZones.length){
    kind='ground';advice=groundZones.map(z=>FIELD_ZONES[z].name).join(' / ')+'에 내려놓은 '+itemName+'를 장비의 현장 보관에서 회수하세요.';
  }else if(available){
    kind='collect';advice=FIELD_ZONES[available.zone].boxes[available.index][0]+'에서 확인한 '+itemName+'를 가방에 넣으세요.';
  }else if(!remaining.length){
    kind='retry';advice='이번 출격의 두 응급함에 남은 '+itemName+'가 없습니다. 다음 출격에서 다시 수색하세요.';
  }else if(remaining.length===1){
    const site=remaining[0],lock=lootLockView(site.zone,site.index);
    kind='alternate';advice=objectivePlaceName(site)+'의 '+FIELD_ZONES[site.zone].boxes[site.index][0]+' 수색을 이어가세요.'+
      (lock&&!lock.unlocked?' '+lock.keyName+' 필요.':'');
  }
  return '<ul class="obj-goals" aria-label="의뢰 수색 현황">'+rows+'</ul>'+
    (advice?'<p class="obj-place" data-recovery-advice="'+kind+'">'+esc(advice)+'</p>':'');
}

function objectivePlaces(locations,context){
  const assigned=locations.filter(loc=>!loc.possible);
  const exact=assigned.length?'<p class="obj-place"><b>목표 지역</b> '+assigned.map(loc=>esc(objectivePlaceName(loc))).join(' / ')+'</p>':'';
  if(context!=='map')return exact;
  const zone=commandZoneSelection();
  const possible=locations.filter(loc=>loc.possible && loc.zone===zone);
  if(!possible.length)return exact;
  const byItem=new Map();
  for(const site of possible){
    const name=LANDMARKS[zone][site.landmark].name;
    for(const item of site.items||[]){
      if(!byItem.has(item))byItem.set(item,new Set());
      byItem.get(item).add(name);
    }
  }
  const rows=Array.from(byItem,([item,names])=>'<li><b>'+esc(GOODS[item][0])+'</b> '+Array.from(names,esc).join(' · ')+'</li>');
  return exact+'<details class="obj-sources"><summary>'+esc(FIELD_ZONES[zone].name)+' 수급 후보 '+possible.length+
    '곳</summary><ul>'+rows.join('')+'</ul></details>';
}

function objectiveMaterialRow(m,facility){
  const flags=' data-objective-material="'+esc(m.id)+'" data-required="'+m.required+'" data-owned="'+m.owned+
    '" data-usable="'+m.usable+'" data-field="'+m.field+'" data-missing="'+m.missing+'"';
  const inventory=[['창고·입고 대기',m.loose],['보관함',m.cases],['준비 가방',m.bag],['착용 중',m.worn]]
    .filter(([,qty])=>qty>0).map(([where,qty])=>where+' '+qty).join(' · ');
  const recovery=m.construction!==undefined;
  const fitted=facility?stashRemovableCount(m.id)-stashUnfittedCount(m.id):npcDeliveryStock(m.id).fitted;
  const protectedHosts=fitted?'<span class="obj-rule">모듈 장착 '+fitted+'개 · 장비 정비에서 모듈을 분리하면 '+(facility||m.construction?'자재로 사용할':'납품할')+' 수 있습니다.</span>':'';
  const allocation=recovery?'<small class="obj-inventory">'+[m.aid?'구호 납품 '+m.aid+'개':'',m.construction?'시설 건설 '+m.construction+'개':''].filter(Boolean).join(' · ')+'</small>':'';
  const atRisk=m.field>0?'<span class="obj-risk">현장 가방 '+m.field+'개 · 생환 후 부족 '+Math.max(0,m.missing-m.fieldUsable)+'개</span>':'';
  const relocate=(facility || m.construction) && m.missing>0 && (m.bag||m.cases)?'<span class="obj-rule">건설에 쓸 물품은 창고로 옮기세요.</span>':'';
  return '<li class="obj-material"'+flags+'><div class="obj-mat-heading"><strong>'+esc(GOODS[m.id][0])+'</strong>'+
    '<span class="'+(m.missing?'obj-short':'obj-ready')+'">'+(m.missing?'부족 '+m.missing:'부족 0 · 확보')+'</span></div>'+
    '<div class="obj-quantities"><span>필요 <b>'+m.required+'</b></span><span>보유 <b>'+m.owned+'</b></span>'+
    '<span>'+ (recovery?'지금 충당 가능':facility?'건설용 창고 재고':'납품용 보유량')+' <b>'+m.usable+'</b></span></div>'+
    allocation+protectedHosts+(inventory?'<small class="obj-inventory">'+inventory+'</small>':'')+atRisk+(m.fieldWorn?'<span class="obj-rule">현장 장착 '+m.fieldWorn+'개 · 생환 후 해제하여 사용</span>':'')+relocate+(m.worn&&m.missing?'<span class="obj-rule">착용 장비나 장착 모듈을 해제해 창고에 넣으세요.</span>':'')+'</li>';
}

function objectiveGoalRows(goals){
  if(!goals.length)return '';
  return '<ul class="obj-goals">'+goals.map(g=>{
    const preview=Number.isFinite(g.projected)&&g.projected>g.value?'<small>생환 시 '+g.projected+' / '+g.target+'</small>':'';
    return '<li><span>'+esc(g.label)+'</span><b>'+g.value.toLocaleString('ko-KR')+' / '+g.target.toLocaleString('ko-KR')+'</b>'+preview+'</li>';
  }).join('')+'</ul>';
}

function objectiveOpenLabel(pin,settle){
  if(pin.kind==='finale')return settle?'복귀 후 종결 작전 열기':'종결 작전 열기';
  if(pin.kind==='campaign')return settle?'복귀 후 복구 캠페인 열기':'복구 캠페인 열기';
  if(pin.kind==='facility')return settle?'복귀 후 시설 열기':'시설 열기';
  if(pin.kind==='order')return settle?'복귀 후 벙커 의뢰 열기':'벙커 의뢰 열기';
  const trader=findMarketTrader(pin.trader || CONTRACT_BY_ID.get(pin.id)?.trader);
  return (settle?'복귀 후 ':'')+(trader?trader.name+' 의뢰 열기':'상인 의뢰 열기');
}

let expandedFieldObjective=null;
inside.addEventListener('toggle',event=>{
  const details=event.target;
  if(details?.dataset?.objectiveDetails!=='field'||!details.isConnected)return;
  expandedFieldObjective=details.open?objectivePin:null;
},true);

function objectivePanel(context,objective=resolveObjective()){
  if(!objective){
    if(context!=='result'||!lastSummary?.completedObjectiveOrder)return '';
    const order=ORDERS.find(entry=>entry.id===lastSummary.completedObjectiveOrder && career.done.includes(entry.id));
    if(!order)return '';
    return '<section class="obj-panel" data-objective-panel="result" aria-label="고정 목표 결과">'+
      '<p class="obj-label">'+commandIcon('pin')+'고정 목표 정산</p><h2>'+esc(order.title)+'</h2><p class="obj-ready">완료 · 보상 지급</p></section>';
  }
  const o=objective,facility=o.source.kind==='facility';
  const materialList=o.materials.length?'<ul class="obj-materials" aria-label="필요 물품">'+o.materials.map(m=>objectiveMaterialRow(m,facility)).join('')+'</ul>':'';
  const showOpen=!raid||context==='result';
  const actions='<div class="obj-actions">'+(showOpen?'<button type="button" data-objective="open" '+(raid&&!writer?'disabled':'')+'>'+
    esc(objectiveOpenLabel(o.source,context==='result'))+'</button>':'')+
    (context==='prep'||context==='field'?'<button type="button" data-page="map">작전 지도</button>':'')+
    objectiveControl(o.source,true)+'</div>';
  const procurement=!raid&&o.materials.length&&['prep','map'].includes(context)?procurementPanel():'';
  const preparation=['prep','map'].includes(context)?recoveryPreparationPanel(o.source):'';
  const routePlan=!raid&&['prep','map'].includes(context)&&o.source.id==='handover-ledgers'?inspectionReturnRoute(zone,o.inspections):null;
  const places=o.inspections?inspectionChecklist(o.inspections,context,routePlan):preparation||objectivePlaces(o.locations,context);
  let body=places+recoverySearchPanel(o)+objectiveGoalRows(o.goals)+materialList+procurement+actions;
  if(facility&&(context==='field'||context==='loot')){
    const filled=o.materials.filter(m=>m.missing===0).length;
    body='<details class="obj-field-details" data-objective-details="field" '+(sameObjective(expandedFieldObjective,o.source)?'open':'')+
      '><summary>건설 자재 '+filled+' / '+o.materials.length+'종 확보 · 상세 보기</summary>'+body+'</details>';
  }
  return '<section class="obj-panel" data-objective-panel="'+context+'" aria-label="고정한 출격 목표">'+
    '<header><div><p class="obj-label">'+commandIcon('pin')+'고정한 출격 목표 · '+esc(o.kindLabel)+'</p><h2>'+esc(o.title)+'</h2></div>'+
    '<span class="obj-status">'+esc(o.status)+'</span></header>'+body+'</section>';
}

function recoveryLootHint(unit,objective){
  const recovery=objective.recovery;
  if(!recovery||recovery.carried>=recovery.required)return '';
  if(!matchesOrderRecovery(unit,recovery)||!openBox()?.items.includes(unit))return '';
  return '현장 가방 '+recovery.carried+'개 / 필요 '+recovery.required+'개 · 가방에 넣고 정상 탈출하면 의뢰에 반영됩니다.';
}

function objectiveLootHint(unit,objective){
  if(!unit?.revealed||!objective)return '';
  const recovery=recoveryLootHint(unit,objective);
  if(recovery)return ' · 의뢰 회수품 · '+recovery;
  const m=objective.materials.find(row=>row.id===unit.g);
  return m?' · 목표 물품 · 필요 '+m.required+' · 보유 '+m.owned+' · 부족 '+m.missing:'';
}

function objectiveLootBadge(hint){
  if(!hint)return '';
  return '<i class="obj-tile-mark" aria-hidden="true" title="목표 물품">'+commandIcon('pin')+'</i>';
}

function objectiveSelectedItem(unit,objective=resolveObjective()){
  if(!unit?.revealed||!objective)return '';
  const recovery=recoveryLootHint(unit,objective);
  if(recovery)return '<section class="obj-item" data-objective-item="'+esc(unit.g)+'"><h3>'+commandIcon('pin')+'의뢰 회수품 · '+esc(objective.title)+'</h3><p>'+esc(recovery)+'</p></section>';
  const material=objective.materials.find(m=>m.id===unit.g);
  if(!material)return '';
  return '<section class="obj-item" data-objective-item="'+esc(unit.g)+'"><h3>'+commandIcon('pin')+'목표 물품</h3>'+
    '<ul class="obj-materials">'+objectiveMaterialRow(material,objective.source.kind==='facility')+'</ul></section>';
}

function openObjectiveSource(){
  const active=resolveObjective();
  if(!active)return;
  const pin=active.source;
  if(raid){
    if(!field?.result||!writer)return;
    handleRaidAction('ack');
    if(raid)return;
  }
  if(pin.kind==='campaign'||pin.kind==='finale'){navigatePage('campaign');return;}
  if(pin.kind==='facility'){openBunkerFacility(pin.id,pin.tier);return;}
  if(pin.kind==='order'){
    bunkerOrderFilter='all';bunkerOrderSelected=pin.id;
    navigatePage('orders');return;
  }
  const trader=pin.trader || CONTRACT_BY_ID.get(pin.id)?.trader;
  if(!marketSelectTrader(trader))return;
  setTraderQuestMode(pin.kind==='contract'?'standing':pin.kind);
  if(pin.kind==='contract'){
    const q=CONTRACT_BY_ID.get(pin.id);
    contractPanel.trader=trader;contractPanel.quest=q.id;contractPanel.tier=q.tier;
  }
  navigatePage('traderQuests');
  const card=pin.kind==='contract'?document.querySelector('.cq-detail'):
    Array.from(document.querySelectorAll('.rc-card')).find(el=>el.dataset.offer===pin.id);
  card?.scrollIntoView?.({block:'nearest'});
  card?.focus?.({preventScroll:true});
}

function handleObjectiveUI(d){
  if(d.objective.startsWith('procurement-')){handleProcurementUI(d);return;}
  if(d.objective==='open'){openObjectiveSource();return;}
  if(!writer||!['pin','clear'].includes(d.objective))return;
  const pin={kind:d.kind,id:d.id};
  if(d.key!==undefined){pin.key=Number(d.key);pin.trader=d.trader;}
  if(d.tier!==undefined)pin.tier=Number(d.tier);
  const clear=d.objective==='clear';
  if(clear&&!sameObjective(objectivePin,pin))return;
  const keyboard=document.activeElement?.matches?.(':focus-visible');
  const saved=setObjectivePin(clear?null:pin);
  renderKeep();
  const announcer=$('#announce');
  if(announcer)announcer.textContent=saved?(clear?'출격 목표 고정을 해제했습니다.':'출격 목표를 고정했습니다.'):'목표를 저장하지 못했습니다. 현재 진행 상태를 확인하세요.';
  if(keyboard){
    const source=Array.from(document.querySelectorAll('button[data-objective]')).find(el=>el.dataset.id===pin.id&&el.dataset.kind===pin.kind);
    (source||$('.content'))?.focus?.({preventScroll:true});
  }
}
