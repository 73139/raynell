// Chapter progress belongs to the campaign ledger. The terminal only renders its current view.
let campaignFeedback = null;

function campaignRoomStrip(done) {
  return '<ol class="rc-rooms" aria-label="벙커 복구 단계">'+CAMPAIGN_STAGES.map((stage,index)=>{
    const state = index < done ? 'done' : index === done ? 'current' : 'future';
    const label = state === 'done' ? '복구 완료' : state === 'current' ? '진행 중' : '대기';
    return '<li class="rc-room '+state+'" data-campaign-room="'+stage.id+'" data-state="'+state+'"'+
      (state==='current'?' aria-current="step"':'')+'>'+
      '<img src="'+artURL('bunker-'+stage.id)+'" alt="" draggable="false">'+
      '<div><span>'+label+'</span><b>'+esc(stage.title)+'</b></div></li>';
  }).join('')+'</ol>';
}

function campaignBunkerCard() {
  const view=campaignView(),latest=CAMPAIGN_STAGES[view.done-1];
  let status=latest?.change || '비상 전원으로 운영 중입니다. 발전 시설부터 복구하세요.';
  if(view.completed){
    const operation=finaleView();
    status=operation.complete?'외부 벙커 교신 성공 · 보관한 회신을 읽을 수 있습니다.':
      operation.active?'종결 작전 진행 중 · 현장 신호를 중계하세요.':
      operation.armed?'다음 출격에 종결 작전이 배정되었습니다.':'생활 기반 복구 완료 · 외부 벙커 교신 준비';
  }
  if(view.active && view.built)status=FACILITIES[view.active.id].name+ ' 가동 중 · '+campaignNextAction(view);
  else if(view.active && view.buildEnd)status=FACILITIES[view.active.id].name+' 공사 중 · '+campaignNextAction(view);
  return '<section class="rc-bunker" aria-label="벙커 복구 현황" data-campaign-bunker="'+view.done+'">'+
    '<div class="rc-bunker-head"><div><h2>벙커 복구 캠페인</h2><p>'+
    esc(status)+
    '</p></div><button type="button" data-page="campaign">'+(view.active?'복구 현황 열기':'종결 작전 열기')+'</button></div>'+
    campaignRoomStrip(view.done)+'</section>';
}

function campaignSettlementNote(report) {
  const stage=CAMPAIGN_STAGES.find(s=>s.id===report?.campaignStage);
  if(!stage)return '';
  return '<section class="rc-settlement" data-campaign-summary="'+stage.id+'"><div><strong>벙커 복구 · '+
    esc(stage.title)+'</strong><p>이 단계에 필요한 생환 1회를 기록했습니다.</p></div>'+
    '<button type="button" data-page="campaign">복구 현황 열기</button></section>';
}

function campaignNextAction(v) {
  if(raid)return field.result?'정산을 마치고 벙커에서 복구 작업을 이어가세요.':'지정된 탈출구로 생환해 벙커로 돌아오세요.';
  if(v.ready)return '단계 완료 보상을 수령하세요.';
  if(v.remaining && v.available)return '확보한 '+kitName(v.active.item)+'을 복구반에 납품하세요.';
  if(!v.built && !v.buildEnd && !facilityBuildStatus(v.active.id,1))return FACILITIES[v.active.id].name+' Lv.1 공사를 시작하세요.';
  if(!v.returned)return '작전 지도에서 출격해 한 번 생환하세요.';
  if(v.remaining)return kitName(v.active.item)+' '+v.remaining+'개를 확보해 복구반에 납품하세요.';
  if(v.buildEnd)return FACILITIES[v.active.id].name+'의 공사가 끝나면 보상을 수령하세요.';
  return FACILITIES[v.active.id].name+' Lv.1의 건설 조건을 확인하세요.';
}

function campaignShipment(v) {
  const stage=v.active,name=kitName(stage.item);
  const max=Math.min(v.available,v.remaining),blocked=Boolean(raid)||!writer;
  const shared=FACILITIES[stage.id].levels[0].materials[stage.item] || 0;
  const buildDue=v.built||v.buildEnd ? 0 : shared;
  const both=shared?'<p class="rc-shared" data-campaign-shared="'+stage.item+'" data-total="'+(v.remaining+buildDue)+'">남은 '+esc(name)+' 합계 <b>'+(v.remaining+buildDue)+'개</b> · 복구반 '+v.remaining+'개 + 시설 공사 '+buildDue+'개</p>':'';
  const deliver=(qty,label)=>'<button type="button" data-campaign="deliver" data-id="'+stage.id+'" data-qty="'+qty+
    '" data-delivered="'+v.delivered+'"'+(blocked||max<qty?' disabled':'')+'>'+label+'</button>';
  let actions='';
  if(v.remaining){
    actions=deliver(1,'1개 납품');
    if(max>1)actions+=deliver(max,'가능한 '+max+'개 납품');
  }
  return '<section class="rc-panel" data-campaign-shipment data-item="'+stage.item+'" data-required="'+stage.quantity+
    '" data-delivered="'+v.delivered+'" data-available="'+v.available+'" data-remaining="'+v.remaining+'">'+
    '<header><h2>복구반 납품</h2><strong>'+v.delivered+' / '+stage.quantity+'개</strong></header>'+
    '<div class="rc-line"><span class="rc-item-art">'+itemArt(stage.item)+'</span><div><b>'+esc(name)+'</b>'+
    '<p>남은 납품 '+v.remaining+'개 · '+(raid?'귀환 후 납품 가능 ':'납품 가능 ')+v.available+'개</p></div></div>'+
    '<p>준비 가방, 창고, 보관함에서 납품합니다.</p>'+both+
    (actions?'<div class="rc-actions">'+actions+'<button type="button" data-db="lookup" data-id="'+stage.item+'">수급처 보기</button></div>':'<p class="rc-ok">납품 완료</p>')+
    '</section>';
}

function campaignFacility(v) {
  const id=v.active.id, facility=FACILITIES[id],step=facility.levels[0];
  let body;
  if(v.built)body='<p class="rc-ok">가동 중인 시설이 이 단계의 공사 조건을 충족했습니다.</p>';
  else if(v.buildEnd)body='<div class="rc-build-time"><strong>공사 중</strong>'+facilityTimer(v.buildEnd)+'</div>'+
      '<p>건설비와 자재를 지급했습니다. 공사가 끝나면 이 단계에 반영됩니다.</p>';
  else{
    const status=facilityBuildStatus(id,1);
    const req=step.requires.map(row=>FACILITIES[row.facility].name+' Lv.'+row.level+' · '+
      (hideoutLevel(row.facility)>=row.level?'충족':'필요')).join(', ')||'없음';
    body='<p>시설 공사에는 아래 창고 자재와 건설비가 필요합니다.</p>'+
      '<table><caption>건설 자재</caption><thead><tr><th scope="col">물품</th><th scope="col">필요</th><th scope="col">창고</th><th scope="col">부족</th></tr></thead><tbody>'+
      Object.entries(step.materials).map(([item,required])=>{
        const owned=stashUnfittedCount(item),missing=Math.max(0,required-owned);
        return '<tr data-campaign-material="'+item+'"><th scope="row">'+esc(kitName(item))+'</th><td>'+required+'</td><td>'+
          owned.toLocaleString('ko-KR')+'</td><td class="'+(missing?'rc-short':'rc-ok')+'">'+missing+'</td></tr>';
      }).join('')+'</tbody></table><dl class="rc-bill"><div><dt>건설비</dt><dd>'+money(step.costCR)+'</dd></div>'+
      '<div><dt>보유 자금</dt><dd>'+money(wallet)+'</dd></div><div><dt>부족 자금</dt><dd>'+money(Math.max(0,step.costCR-wallet))+'</dd></div>'+
      '<div><dt>공사 시간</dt><dd>'+step.durationMinutes+'분</dd></div><div><dt>선행 시설</dt><dd>'+esc(req)+'</dd></div></dl>'+
      (status?'<p class="rc-note">'+esc(status)+'</p>':'<p class="rc-ok">건설 가능</p>');
  }
  return '<section class="rc-panel rc-facility" data-campaign-facility="'+id+'" data-built="'+v.built+'"><header>'+
    '<h2>'+esc(facility.name)+' Lv.1</h2><strong>'+(v.built?'가동 중':v.buildEnd?'건설 중':'건설 대기')+'</strong></header>'+
    body+'<div class="rc-actions"><button type="button" data-bui="facility" data-id="'+id+'" data-tier="1">시설 상세 열기</button></div></section>';
}

function campaignSortie(v) {
  const action=raid?(field.result?'<button type="button" data-campaign="return">정산 마치고 벙커 복귀</button>':
    '<button type="button" data-page="raid">현장 복귀</button>'):v.returned?'':'<button type="button" data-page="map">작전 지도 열기</button>';
  const text=v.returned?'이번 단계의 생환 기록을 확인했습니다.':'이번 단계에 출격해 생환하세요. 조기 탈출도 인정됩니다.';
  return '<section class="rc-panel" data-campaign-sortie data-returned="'+v.returned+'"><header><h2>현장 생환</h2><strong>'+
    (v.returned?'1':'0')+' / 1회</strong></header><p>'+text+'</p>'+(action?'<div class="rc-actions">'+action+'</div>':'')+'</section>';
}

function campaignClaimPanel(v) {
  const stage=v.active;
  return '<section class="rc-panel rc-claim"><header><h2>단계 보상</h2><strong>'+money(stage.cr)+' · '+stage.xp+' XP</strong></header>'+
    '<p>시설 가동 효과 · '+esc(facilityEffect(stage.id,1))+'</p><button type="button" class="primary" data-campaign="claim" data-id="'+stage.id+'"'+
    (!v.ready||raid||!writer?' disabled':'')+'>단계 완료 · 보상 수령</button></section>';
}

function campaignPage() {
  const v=campaignView(),stage=v.active;
  const feedback='<p class="rc-feedback" role="status" tabindex="-1" data-campaign-notice>'+
    (campaignFeedback?esc(campaignFeedback.message):'')+'</p>';
  const header='<header class="rc-heading"><h1 tabindex="-1">벙커 복구 캠페인</h1><button type="button" data-page="bunker">벙커 전경</button></header>';
  const rooms=campaignRoomStrip(v.done);
  if(!stage){
    return '<div class="rc-screen" data-campaign-complete>'+header+
      '<section class="rc-hero complete" style="--rc-cover:url('+artURL('bunker-med')+')"><div><span>B-04 · 복구 '+v.done+' / '+CAMPAIGN_STAGES.length+'단계</span>'+
      '<h2>벙커 복구 완료</h2><p>전력과 식수가 공급되고 의무실이 대원을 받습니다.</p></div></section>'+rooms+feedback+finaleConsole()+
      '<section class="rc-panel"><header><h2>복구 기록</h2></header><ul class="rc-history">'+CAMPAIGN_STAGES.map(s=>
        '<li><div><b>'+esc(s.title)+'</b><p>'+esc(s.change)+'</p></div><strong>'+money(s.cr)+' · '+s.xp+' XP 지급</strong></li>').join('')+
      '</ul><div class="rc-actions"><button type="button" data-page="bunker">가동 시설 보기</button></div></section></div>';
  }
  return '<div class="rc-screen" data-campaign-stage="'+stage.id+'">'+header+
    '<section class="rc-hero" style="--rc-cover:url('+artURL('bunker-'+stage.id)+')"><div><span>B-04 · 현재 '+(v.index+1)+' / '+CAMPAIGN_STAGES.length+'단계</span>'+
    '<h2>'+esc(stage.title)+'</h2><p>'+esc(stage.description)+'</p></div></section>'+rooms+feedback+
    '<div class="rc-next"><div><small>다음 행동</small><b>'+esc(campaignNextAction(v))+'</b></div>'+objectiveControl({kind:'campaign',id:stage.id})+'</div>'+
    '<div class="rc-tasks"><div>'+campaignSortie(v)+campaignShipment(v)+'</div>'+campaignFacility(v)+'</div>'+campaignClaimPanel(v)+'</div>';
}

function handleCampaignUI(d) {
  if(page!=='campaign'||!writer)return;
  if(d.campaign==='return'){
    if(raid&&field.result){handleRaidAction('ack');navigatePage('campaign');}
    return;
  }
  if(d.campaign!=='deliver' && d.campaign!=='claim')return;
  campaignFeedback=campaignAction(d.id,d.campaign,Number(d.qty),Number(d.delivered));
  renderKeep();
  $('[data-campaign-notice]')?.focus?.({preventScroll:true});
}

// Full redraws occur when construction finishes. A ticking timer updates its own text in place.
function captureCampaignFocus() {
  const el=document.activeElement;
  if(!el?.closest?.(page==='campaign'?'.rc-screen':page==='raid'?'.rf-field':'.rc-inactive'))return null;
  if(el.matches('[data-campaign-notice], [data-finale-notice]'))return {notice:el.matches('[data-finale-notice]')?'finale':'campaign'};
  return el.matches('button')?{dataset:{...el.dataset}}:null;
}
function restoreCampaignFocus(previous) {
  if(!previous||(page!=='campaign'&&page!=='raid'))return;
  const screen=$(page==='campaign'?'.rc-screen':'.rf-field');
  if(!screen?.querySelector)return;
  const target=previous.notice?screen.querySelector('[data-'+previous.notice+'-notice]:not(:empty)'):
    [...screen.querySelectorAll('button:not(:disabled)')].find(button=>
      Object.entries(previous.dataset).every(([key,value])=>button.dataset[key]===value));
  (target||screen.querySelector('[tabindex="-1"]'))?.focus({preventScroll:true});
}
inside.addEventListener('click',event=>{
  if(event.detail>1 && event.target.closest?.('button[data-campaign]')) {
    event.preventDefault();event.stopImmediatePropagation();
  }
},true);
inside.addEventListener('keydown',event=>{
  if(event.repeat && (event.key==='Enter'||event.key===' ') && event.target.closest?.('button[data-campaign]')) {
    event.preventDefault();event.stopImmediatePropagation();
  }
},true);
