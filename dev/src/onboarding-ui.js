// The guidance describes and invokes normal game actions. Screen visits never award progress.
const GUIDE_SCREENS = ['home','map','prep','traderQuests','raid','bunker','inventory','stash'];
const GUIDE_STEPS = {accept:1,busy:1,deploy:2,search:3,extract:4,debrief:4,claim:5};
let guideNotice = '';

function guideInstruction(title, text, action, label, value) {
  return {title, text, action, label, value};
}

function guideSelectedQuest(id) {
  return page === 'traderQuests' && marketUI.trader === 'supply' && contractPanel.mode === 'standing' &&
    contractPanel.quest === id && !contractPanel.confirmCancel;
}

function guideDeployment(v, retry) {
  const area = FIELD_ZONES[v.goal.zone].name;
  if (page === 'prep' && zone === v.goal.zone) {
    return guideInstruction(retry?'장비를 확인하고 다시 출격하세요':'장비를 확인하고 첫 출격을 시작하세요',
      area+'에서 배급소 식당을 수색합니다. 착용 장비와 가방 속 물품을 가져갑니다.',
      'deploy',retry?'재출격 시작':'첫 출격 시작');
  }
  if (page === 'map' || page === 'inventory' || page === 'prep') {
    return guideInstruction(retry?'남은 장비로 재출격을 준비하세요':'배급소 식당으로 갈 준비를 하세요',
      retry?'창고 장비를 꺼내 착용하거나, 주머니만으로도 출격할 수 있습니다.':
        '배급소 식당은 '+area+'에 있습니다. 출격 지역을 확인하고 장비를 점검하세요.',
      'prep',area+' 출격 준비');
  }
  if (retry) return guideInstruction('벙커에 남은 장비를 확인하세요',
    '출격 가방은 비었습니다. 창고 물품으로 다시 준비하거나 지급 배낭을 받을 수 있습니다.',
    'kit','장비·창고 열기');
  return guideInstruction('작전 지도에서 배급소 식당을 찾으세요',
    '한미정의 의뢰를 수락했습니다. '+area+'에서 상자 한 곳을 끝까지 수색하고 생환하세요.',
    'map',area+' 지도 열기');
}

function guideFieldInstruction(v) {
  const exit = exitBy('b04'), zoneId = v.goal.zone, landmark = LANDMARKS[zoneId][v.goal.landmark];
  const extract = v.step === 'extract' || v.step === 'unassigned';
  if (page !== 'raid') return guideInstruction(extract?'탈출구로 복귀하세요':'배급소 식당을 수색하세요',
    '진행 중인 작전의 현장 화면에서 계속할 수 있습니다.','field','현장으로 복귀');
  if (field.action) {
    const type = field.action.type;
    const waiting = {scan:'주변에서 수색 대상을 찾고 있습니다.',search:'상자 안의 물품을 확인하고 있습니다.',
      extract:exitBy(field.action.exit)?.name+'에서 탈출 대기 중입니다.',engage:'교전 결과를 기다리고 있습니다.',
      evade:'도주 결과를 기다리고 있습니다.','travel-step':'다음 이동 지점으로 가고 있습니다.',move:'선택한 권역으로 이동 중입니다.'};
    return guideInstruction(waiting[type]||'현장 행동을 진행 중입니다.','행동이 끝나면 다음 안내가 표시됩니다.');
  }
  if (field.contact) return guideInstruction('조우 상황을 해결하세요',
    '상대와 교전하거나 도주하면 현장 안내를 이어갈 수 있습니다.','contact','대응 선택 보기');
  if (field.journey) {
    return field.journey.event ? guideInstruction('이동 중 발견한 보급품을 확인하세요',
      '가방에 담거나 두고 이동할 수 있습니다.','supply','보급품 선택 보기') :
      guideInstruction('권역 사이를 이동 중입니다.','도착 후 현장 안내를 이어갑니다.');
  }
  if (extract) {
    const title = v.step === 'unassigned' ? '벙커에서 첫 의뢰를 수락하세요' : '수색을 마쳤습니다. 생환하세요';
    const note = v.step === 'unassigned' ? '첫 의뢰는 벙커에서 수락할 수 있습니다.' :
      '조기 탈출도 이 의뢰에 인정됩니다. 생환하면 수색 기록이 확정됩니다.';
    if (field.open) return guideInstruction(title,note,'close','상자 닫고 탈출 준비');
    if (raid.zone !== exit.zone) return guideInstruction(title,note,'move','벙커 외곽으로 이동',exit.zone);
    const reason = exitCondition(exit);
    return guideInstruction(title,reason?exit.name+' · '+reason:note,reason?null:'extract',
      exit.name+' 탈출 · '+exit.sec+'초',exit.id);
  }
  if (raid.zone !== zoneId) {
    if (field.open) return guideInstruction('배급소 식당으로 이동하세요','현재 열린 상자를 닫고 벙커 외곽으로 이동하세요.','close','상자 닫기');
    return guideInstruction('목표 권역으로 이동하세요','배급소 식당은 '+FIELD_ZONES[zoneId].name+'에 있습니다.','move','벙커 외곽으로 이동',zoneId);
  }
  if (field.open) {
    if (!contractBoxMatches(v.goal,field.open)) return guideInstruction('배급소 식당의 상자를 찾으세요',
      '현재 상자는 다른 장소에 있습니다. 식당에 있는 수색 대상을 열어야 합니다.','close','상자 닫기');
    return guideInstruction('상자 안의 물품을 모두 확인하세요',
      '내용물 수색이 끝날 때까지 기다리세요. 의뢰에는 전리품을 챙길 필요가 없습니다.','search','내용물 수색');
  }
  if (currentLandmark() !== landmark) return guideInstruction('배급소 식당으로 이동하세요',
    '같은 권역의 장소를 바꿉니다. 식당에 도착한 뒤 주변을 탐색하세요.','landmark','배급소 식당 선택',v.goal.landmark);
  const found = landmark.boxes.find(i=>field.found[zoneId].includes(i)&&!field.boxes[boxKey(zoneId,i)]?.complete);
  if (found !== undefined) return guideInstruction('발견한 수색 대상을 여세요','식당 안의 상자 한 곳을 끝까지 확인하세요.',
    'open',FIELD_ZONES[zoneId].boxes[found][0]+' 열기',found);
  return guideInstruction('식당 주변을 탐색하세요','주변 탐색을 마치면 이곳에서 열 수 있는 수색 대상이 나타납니다.','scan','주변 탐색');
}

function guideDirection(v) {
  const q = v.quest;
  switch (v.step) {
    case 'accept':
      return guideSelectedQuest(q.id)
        ? guideInstruction('한미정의 의뢰를 수락하세요','배급소 식당의 상자 한 곳을 끝까지 수색하고 살아 돌아오는 의뢰입니다.','accept',objectivePin?'배급소 찬장 수락':'의뢰 수락하고 목표 고정')
        : guideInstruction('첫 의뢰를 확인하세요','보급 담당 한미정이 배급소 식당의 찬장을 조사해 달라고 합니다.','quest','한미정의 의뢰 열기',q.id);
    case 'busy': {
      const active = traderContracts[q.trader].active?.id, current = CONTRACT_BY_ID.get(active);
      const note = '한미정의 진행 중인 의뢰를 마치면 첫 출격 안내를 이어갈 수 있습니다.';
      if (guideSelectedQuest(active)) return guideInstruction(current.title+' 진행 중',note);
      return guideInstruction('진행 중인 의뢰를 확인하세요',note,'quest',current.title+' 열기',active);
    }
    case 'deploy': return guideDeployment(v,false);
    case 'search': case 'extract': case 'unassigned': return guideFieldInstruction(v);
    case 'debrief':
      if (v.questStatus==='ready') return guideInstruction('생환했습니다. 한미정에게 보고하세요',
        '식당 수색 기록이 반영됐습니다. 벙커에서 의뢰 보상을 받을 수 있습니다.','ack-quest','벙커 복귀 · 한미정에게 보고');
      return guideInstruction('생환 기록을 확인하세요',v.questStatus==='active'?
        '배급소 식당의 수색 완료 기록이 없습니다. 다음 출격에서 식당 상자 하나를 끝까지 확인하세요.':
        '이번 출격을 정산했습니다. 벙커에 돌아가 첫 의뢰 안내를 이어가세요.','ack','벙커로 복귀');
    case 'claim':
      return guideSelectedQuest(q.id) ? guideInstruction('의뢰 보상을 받으세요',
        '배급소 찬장의 수색 보고가 준비됐습니다. 한미정에게 보상을 받으면 첫 출격 안내가 완료됩니다.','claim','한미정에게 보상 받기') :
        guideInstruction('한미정에게 수색 결과를 보고하세요','첫 의뢰의 생환 조건을 달성했습니다.','quest','보상 받을 의뢰 열기',q.id);
    case 'failed': return guideInstruction('남은 물품으로 다음 출격을 준비하세요',
      '벙커에 두었던 물품은 보존됐습니다. 아래에서 손실과 남은 물품을 확인하세요.','ack-kit','벙커 복귀 · 장비 확인');
    case 'retry': return guideDeployment(v,true);
    case 'done': return guideInstruction('첫 출격 안내 완료',
      '한미정의 배급소 찬장 보상을 받았습니다. 다음 의뢰를 선택하거나 자유롭게 출격할 수 있습니다.');
  }
}

function guideInventoryLine(totals) {
  const list = [...totals].sort((a,b)=>kitName(a[0]).localeCompare(kitName(b[0]),'ko'));
  const count = list.reduce((sum,entry)=>sum+entry[1],0);
  const shown = list.slice(0,3).map(([id,n])=>kitName(id)+' ×'+n).join(', ');
  return count ? count.toLocaleString('ko-KR')+'개 · '+shown+(list.length>3?' 외 '+(list.length-3)+'종':'') : '0개';
}

function guideReviewingLoss(view) {
  return ['accept','busy','retry','deploy'].includes(view.step) && page==='inventory' && !raid && ['abandoned','expired','kia'].includes(lastSummary?.result);
}

function guideRecoveryInventory() {
  const kept = new Map(), lost = new Map(), add=(counts,id,n)=>counts.set(id,(counts.get(id)||0)+n);
  for (const row of possessionLocations()) if (row.scope==='bunker') add(kept,row.id,row.quantity);
  for (const id of lastSummary?.goods||[]) add(lost,id,1);
  for (const unit of lastSummary?.worn||[]) {
    add(lost,unit.id,1);
    if(unit.module) add(lost,unit.module,1);
  }
  return '<dl class="guide-stock"><div><dt>벙커 보유</dt><dd>'+esc(guideInventoryLine(kept))+'</dd></div>'+
    '<div><dt>지난 출격 손실</dt><dd>'+esc(guideInventoryLine(lost))+'</dd></div></dl>';
}

function guideButton(action, label, value) {
  return '<button type="button" data-guide="next" data-guide-action="'+esc(action)+'"'+
    (value==null?'':' data-guide-value="'+esc(value)+'"')+' '+(writer?'':'disabled')+'>'+esc(label)+'</button>';
}

function onboardingPanel(screen) {
  if (screen!=='settings' && !GUIDE_SCREENS.includes(screen)) return '';
  const v=onboardingView();
  if (screen==='settings') {
    const rewarded=v.step==='done';
    const note=rewarded?'배급소 찬장 의뢰 완료 · 보상 수령. 다음 의뢰를 선택하거나 자유롭게 출격할 수 있습니다.':
      v.mode==='active'?'안내를 끄면 일반 플레이를 계속할 수 있습니다. 언제든 여기에서 이어갈 수 있습니다.':
      v.mode==='skipped'?'저장된 의뢰와 현재 출격 상태에서 안내를 이어갈 수 있습니다.':'현재 의뢰와 장비를 유지한 채 첫 출격 안내를 시작할 수 있습니다.';
    return '<section class="sortie-guide guide-settings" data-guide-panel data-guide-step="'+v.step+'" aria-label="첫 출격 안내 설정" tabindex="-1">'+
      '<div class="guide-main"><h2>첫 출격 안내</h2><p>'+esc(note)+'</p></div><div class="guide-actions">'+
      (rewarded?'':v.mode==='active'?'<button type="button" data-guide="skip">안내 건너뛰기</button>':
        '<button type="button" data-guide="resume">'+(v.mode==='skipped'?'안내 이어하기':'첫 출격 안내 시작')+'</button>')+'</div>'+guideFeedback()+'</section>';
  }
  const receipt=v.mode==='completed' && guideSelectedQuest(v.quest.id);
  if (v.mode!=='active' && !receipt) return '';
  const d=guideDirection(v);
  if (!d) return '';
  const recovery=v.step==='failed'||v.step==='retry'||guideReviewingLoss(v), index=GUIDE_STEPS[v.step];
  const label='첫 출격 안내'+(recovery?' · 재출격':index?' · '+index+'/5':'');
  const issue=guideReviewingLoss(v)&&!equipmentState.worn.back;
  return '<section class="sortie-guide" data-guide-panel data-guide-step="'+esc(v.step)+'" aria-label="첫 출격 안내" tabindex="-1">'+
    '<div class="guide-main"><div class="guide-head"><span>'+esc(label)+'</span></div><h2>'+esc(d.title)+'</h2><p>'+esc(d.text)+'</p>'+
    (recovery?guideRecoveryInventory():'')+'</div><div class="guide-actions">'+
    (d.action?guideButton(d.action,d.label,d.value):'')+(issue?'<button type="button" data-guide="issue">지급 배낭 받기</button>':'')+
    (v.mode==='active'?'<button class="guide-skip" type="button" data-guide="skip" aria-label="첫 출격 안내 건너뛰기">안내 건너뛰기</button>':'')+'</div>'+guideFeedback()+'</section>';
}

function guideFeedback() {
  return guideNotice?'<p class="guide-notice" role="status">'+esc(guideNotice)+'</p>':'';
}

function guideOpenQuest(id) {
  const q=CONTRACT_BY_ID.get(id);
  if (!q || !marketSelectTrader(q.trader)) return;
  setTraderQuestMode('standing');
  contractPanel.trader=q.trader;contractPanel.quest=q.id;contractPanel.tier=q.tier;
  contractPanel.confirmCancel=false;contractPanel.message='';
  navigatePage('traderQuests');
}

function guideRevealChoices(selector) {
  const element=document.querySelector(selector);
  element?.scrollIntoView?.({block:'center',inline:'nearest'});
  element?.querySelector('button:not(:disabled)')?.focus?.({preventScroll:true});
}

function guideActivate(d, v) {
  const destination=v.goal.zone;
  switch (d.action) {
    case 'quest': return guideOpenQuest(d.value);
    case 'accept':
      return handleContractUI({contract:'accept',id:v.quest.id,pinIfEmpty:!objectivePin});
    case 'claim':
      return handleContractUI({contract:d.action,id:v.quest.id});
    case 'map': case 'prep':
      zone=destination;commandInspection=null;
      return navigatePage(d.action);
    case 'deploy': return handleRaidAction('start');
    case 'kit': return navigatePage('inventory');
    case 'field': return navigatePage('raid');
    case 'contact': return guideRevealChoices('.contact-buttons');
    case 'supply': return guideRevealChoices('.contact-buttons');
    case 'ack': return handleRaidAction('ack');
    case 'ack-kit': case 'ack-quest':
      handleRaidAction('ack');
      if (!raid) {
        if (d.action==='ack-kit') navigatePage('inventory');
        else guideOpenQuest(v.quest.id);
      }
      return;
    case 'landmark': case 'move': case 'open':
      return handleField({field:d.action,index:String(d.value)});
    case 'extract': return handleField({field:d.action,exit:d.value});
    case 'scan': case 'search': case 'close': return handleField({field:d.action});
  }
}

function captureOnboardingFocus() {
  const active=document.activeElement;
  if (!active?.closest?.('[data-guide-panel]')) return null;
  return active.dataset?.guide||'next';
}

function restoreOnboardingFocus(previous, reveal=false) {
  if (!previous) return;
  const panel=$('[data-guide-panel]');
  if (!panel) return;
  const target=Array.from(panel.querySelectorAll('button:not(:disabled)')).find(button=>button.dataset.guide===previous);
  (target||panel).focus?.({preventScroll:true});
  if (reveal) panel.scrollIntoView?.({block:'nearest',inline:'nearest'});
}

function handleOnboardingUI(data) {
  if (!writer) return;
  guideNotice='';
  if (data.guide==='skip'||data.guide==='resume') {
    const resume=data.guide==='resume';
    if(onboardingView().step==='done') return;
    if (!setOnboardingMode(resume?'active':'skipped')) guideNotice='안내 설정을 저장하지 못했습니다. 최신 기록을 확인하세요.';
    if (!guideNotice&&resume) {navigatePage(raid?'raid':'home');return;}
    renderKeep();
    const status=$('#announce');
    if (status) status.textContent=guideNotice||'안내를 건너뛰었습니다. 단말 설정에서 다시 시작할 수 있습니다.';
    ($('[data-guide-panel]')||$('.content'))?.focus?.({preventScroll:true});
    return;
  }
  const v=onboardingView();
  if (v.mode!=='active') return;
  if (data.guide==='issue') {
    if(guideReviewingLoss(v)&&!equipmentState.worn.back) handleEquipment({gear:'issue'});
    return;
  }
  if (data.guide!=='next') return;
  const next=guideDirection(v);
  if (!next?.action||data.guideAction!==next.action||String(data.guideValue??'')!==String(next.value??'')) {renderKeep();return;}
  guideActivate(next,v);
  if (next.action!=='contact'&&next.action!=='supply') restoreOnboardingFocus('next',true);
}

// A double-click or held key is one activation even when the first action replaces the button.
inside.addEventListener('click',event=>{
  if (event.detail>1 && event.target.closest?.('button[data-guide]')) {
    event.preventDefault();event.stopImmediatePropagation();
  }
},true);
inside.addEventListener('keydown',event=>{
  if (event.repeat && (event.key==='Enter'||event.key===' ') && event.target.closest?.('button[data-guide]')) {
    event.preventDefault();event.stopImmediatePropagation();
  }
});
