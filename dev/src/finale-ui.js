// Outside contact is an opt-in sortie. Vendor receipts, signals and the reply are read from the save.
let finaleFeedback=null;
const FINALE_ROLES={supply:'보급 지원',medic:'의료 지원',quarter:'출입 장비',repair:'중계기 지원'};

function finaleNotice() {
  const message=finaleFeedback?.page===page && finaleFeedback.raidId===(raid?.startedAt||0) ? finaleFeedback.message : '';
  return '<p class="rc-feedback" role="status" tabindex="-1" data-finale-notice>'+esc(message)+'</p>';
}

function finaleStations(v) {
  return '<ol class="rf-stations" aria-label="권역별 신호기">'+v.stations.map(s=>{
    const here=Boolean(v.active&&raid && !field.journey && raid.zone===s.zone);
    return '<li data-finale-station="'+s.zone+'" data-confirmed="'+s.confirmed+'"'+(here?' aria-current="location"':'')+'>'+
      '<i aria-hidden="true">'+(s.confirmed?'✓':'◇')+'</i><div><b>'+esc(s.title)+'</b><small>'+esc(FIELD_ZONES[s.zone].name)+'</small></div>'+
      '<span>'+(s.confirmed?'확인 완료':here?'현재 권역':'미확인')+'</span></li>';
  }).join('')+'</ol>';
}

function finaleRequirements(v) {
  return '<section class="rf-requirements"><h3>작전 협조 요청</h3><p>네 상인의 우호도 의뢰를 한 건씩 마치고 각 상인에게 보상을 수령하세요.</p>'+
    '<ul>'+v.traders.map(t=>'<li data-finale-trader="'+t.id+'" data-done="'+t.done+'"><div><b>'+esc(t.name)+'</b><small>'+
      esc(FINALE_ROLES[t.id])+' · '+(t.done?'협조 확보':'우호도 의뢰 보상 필요')+'</small></div>'+
      '<button type="button" data-finale="trader" data-id="'+t.id+'" aria-label="'+esc(t.name)+' 우호도 의뢰 열기">의뢰 열기</button></li>').join('')+'</ul>'+
    '<p class="rf-facilities">시설 가동 · '+v.facilities.map(f=>esc(f.name)+' '+(f.built?'✓':'필요')).join(' / ')+'</p></section>';
}

function finaleReply(v) {
  return '<article class="rf-reply" data-finale-reply><header><span>수신 완료</span><h3>외부 벙커의 회신</h3></header>'+
    '<blockquote>'+esc(FINALE_REPLY_TEXT)+'</blockquote><p>B-04의 교신 기록에 영구 보관했습니다. 벙커 관리와 출격을 계속할 수 있습니다.</p>'+
    '<div class="rc-actions"><button type="button" data-bui="external-relief">'+(career.reliefReceipt?'첫 보급 인계 기록':'첫 보급 요청 보기')+'</button><button type="button" data-page="'+(raid?'raid':'map')+'">'+(raid?(field.result?'작전 결과 보기':'현장 복귀'):'작전 지도 열기')+'</button>'+
    '<button type="button" data-page="bunker">벙커 전경</button></div></article>';
}

function finaleConsole() {
  const v=finaleView(),statusText={locked:'협조 대기',available:'출격 가능',armed:'다음 출격에 배정',active:'현장 작전 중',complete:'교신 성공'};
  const status=statusText[v.status];
  const top='<header><h2>종결 작전 · 외부 벙커 교신</h2><strong>'+status+'</strong></header>';
  let body;
  if(v.complete)body=finaleReply(v);
  else{
    const brief='<p class="rf-brief">한 번의 출격에서 외곽·검문소·군수 창고의 신호기를 확인하고 생환하면 외부 벙커에 연결됩니다. 방문 순서는 자유입니다.</p>';
    let action='';
    if(v.status==='locked'){
      action=finaleRequirements(v);
    }else if(v.armed){
      action='<p class="rf-ready">다음 출격에 종결 작전이 배정되었습니다.</p><div class="rc-actions"><button type="button" class="primary" data-page="prep">종결 작전 출격 준비</button>'+
        '<button type="button" data-finale="cancel">출격 배정 해제</button></div>';
    }else if(v.active){
      action=finaleStations(v)+'<div class="rc-actions"><button type="button" data-page="raid">현장으로 복귀</button></div>';
    }else{
      action='<p>전력·정수·의무실 가동과 네 상인의 협조를 확인했습니다.</p><div class="rc-actions">'+
        '<button type="button" class="primary" data-finale="arm"'+(raid||!writer?' disabled':'')+'>다음 출격에 종결 작전 배정</button>'+
        (raid?'<button type="button" data-page="raid">'+(field.result?'귀환 정산 열기':'현장 복귀')+'</button>':'')+'</div>';
    }
    body=brief+action+'<div class="rc-actions">'+objectiveControl({kind:'finale',id:'relay'})+'</div>';
  }
  return '<section class="rc-panel rf-console" data-finale-status="'+v.status+'">'+top+body+finaleNotice()+'</section>';
}

function finaleFieldPanel() {
  if(!raid||field.result)return '';
  const v=finaleView();
  if(!v.active)return '';
  const here=v.stations.find(s=>s.zone===raid.zone),count=v.stations.filter(s=>s.confirmed).length;
  const tip=count===v.stations.length?'세 신호기 확인 완료 · 탈출구로 생환해 회신을 수신하세요.':
    here.confirmed?'이 권역의 신호를 확인했습니다. 작전 지도에서 미확인 권역을 선택하세요.':(v.canSignal?'현재 권역의 신호기를 확인하세요.':v.blockReason);
  const signal=count<v.stations.length&&!here.confirmed?'<button type="button" class="primary" data-finale="signal" data-zone="'+here.zone+
    '" data-raid-id="'+raid.startedAt+'"'+(!v.canSignal||!writer?' disabled':'')+'>'+esc(here.title)+' 확인</button>':'';
  return '<section class="rc-panel rf-field" data-finale-field data-finale-status="active"><header><h2 tabindex="-1">종결 작전 · 신호 중계</h2><strong>'+
    count+' / '+v.stations.length+'곳 확인</strong></header>'+finaleStations(v)+'<p>'+esc(tip)+'</p>'+
    '<div class="rc-actions">'+signal+'<button type="button" data-page="map">작전 지도</button></div>'+finaleNotice()+'</section>';
}

function finaleSettlementNote(report) {
  if(!report?.finaleAttempt)return '';
  const confirmed=report.finaleAttempt.zones?.length||0,reply=report.finaleReply===true;
  const title=reply?'종결 작전 완료 · 외부 벙커 교신':'종결 작전 · 재출격 가능';
  const text=reply?'세 신호기 확인과 생환을 기록했습니다. 외부 벙커에서 회신이 도착했습니다.':
    (report.result==='success'?'신호기 '+confirmed+' / 3곳을 확인하고 귀환했습니다.':'신호기 '+confirmed+' / 3곳을 확인했으나 생환하지 못했습니다.')+
      ' 다음 종결 작전에서는 세 신호기를 다시 확인하세요.';
  return '<section class="rc-settlement rf-report" data-finale-settlement="'+(reply?'complete':'retry')+'"><div><strong>'+title+
    '</strong><p>'+esc(text)+'</p></div><button type="button" data-page="campaign">'+(reply?'외부 회신 열기':'재출격 조건 보기')+'</button></section>';
}

function handleFinaleUI(d) {
  if(d.finale==='trader'){
    if(page!=='campaign'||!Object.hasOwn(FINALE_ROLES,d.id)||!marketSelectTrader(d.id))return;
    setTraderQuestMode('standing');navigatePage('traderQuests');return;
  }
  if(!writer)return;
  let receipt;
  if(d.finale==='signal'&&page==='raid')receipt=finaleAction('signal',Number(d.zone),Number(d.raidId));
  else if((d.finale==='arm'||d.finale==='cancel')&&page==='campaign')receipt=finaleAction(d.finale);
  else return;
  finaleFeedback={message:receipt.message,page,raidId:raid?.startedAt||0};
  renderKeep();
  $('[data-finale-notice]')?.focus?.({preventScroll:true});
}
