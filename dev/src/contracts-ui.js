// The selected trader is shared with the trading counter.
const contractPanel={trader:null,tier:1,quest:null,message:'',confirmCancel:false,mode:'standing'};
const contractLabels={available:'수락 가능',busy:'수락 대기',active:'진행 중',ready:'보상 대기',claimed:'완료',locked:'잠김'};
const contractScenery={supply:'bunker-kitchen',medic:'bunker-med',quarter:'bunker-stash',repair:'bunker-workshop'};

function contractBoardEntries(traderId,tier){
  return TRADER_CONTRACTS.filter(q=>q.trader===traderId&&q.tier<=tier).map(quest=>({quest,...contractStatus(quest.id)}));
}
function contractCurrent(entries){
  return entries.find(entry=>entry.status==='active'||entry.status==='ready');
}
function contractSelectTier(tier,entries){
  const group=entries.filter(entry=>entry.quest.tier===tier);
  const pick=contractCurrent(group)||group.find(entry=>entry.status==='available')||group[0];
  contractPanel.tier=tier;
  contractPanel.quest=pick?.quest.id||null;
  contractPanel.confirmCancel=false;
  contractPanel.message='';
}
function contractStandingPanel(trader,standing,entries){
  const {tier,points,next,threshold}=standing;
  const done=entries.filter(e=>e.status==='claimed').length;
  const active=contractCurrent(entries);
  const progress=next===null?100:Math.min(100,Math.max(0,100*(points-threshold)/(next-threshold)));
  const progressText=next===null?'최고 단계':(next-points)+'점 더 모으면 '+(tier+1)+'단계';
  return '<section class="cq-standing" aria-label="'+esc(trader.name)+' 우호도"><div class="cq-person"><div class="cq-avatar">'+marketPortrait(trader)+'</div><div>'+
    '<p>'+esc(trader.role)+'</p><h2>'+esc(trader.name)+'</h2></div></div>'+
    '<div class="cq-standing-data"><div class="cq-line"><h3>우호도 <b>'+tier+'단계</b></h3><strong>'+points+'점'+(next===null?'':' <small>/ '+next+'점</small>')+'</strong></div>'+
    '<div class="cq-meter" role="progressbar" aria-label="상인 우호도" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(progress)+
    '" aria-valuetext="'+esc(tier+'단계 · '+points+'점 · '+progressText)+'"><span style="width:'+progress+'%"></span></div>'+
    '<div class="cq-meter-meta"><span>'+progressText+'</span><span>완료 '+done+' / '+entries.length+'</span></div></div>'+
    (active&&active.quest.id!==contractPanel.quest?'<button class="cq-tracked" data-contract="open" data-id="'+active.quest.id+'"><small>'+contractLabels[active.status]+'</small><b>'+esc(active.quest.title)+' ›</b></button>':'')+'</section>';
}
function contractTierStrip(standing){
  return '<nav class="cq-tiers" aria-label="우호도별 퀘스트">'+CONTRACT_TIERS.slice(0,standing.tier).map((points,i)=>{
    const tier=i+1;
    return '<button type="button" data-contract="tier" data-tier="'+tier+'" aria-pressed="'+(contractPanel.tier===tier)+'" aria-label="'+
      tier+'단계 퀘스트"><strong>'+tier+'단계</strong><small>'+points+'점</small></button>';
  }).join('')+'</nav>';
}
function standingUnlockItems(trader,tier){
  if(tier<2||tier>traderStanding(trader.id).tier)return '';
  const items=marketTierGoods(trader.id,tier);
  if(!items.length)return '';
  return '<section data-standing-unlocks="'+tier+'"><header class="mk-pane-head"><h3>'+tier+'단계 개방 상품</h3><span>'+items.length+'종</span></header>'+
    '<div class="cq-rows">'+items.map(id=>'<button type="button" class="cq-row" data-contract="unlock-item" data-trader="'+trader.id+
      '" data-tier="'+tier+'" data-id="'+id+'"><strong>'+esc(kitName(id))+'</strong><span>'+money(GOODS[id][6])+' ›</span></button>').join('')+'</div></section>';
}
function contractList(entries,trader){
  const done=entries.filter(entry=>entry.status==='claimed').length;
  return '<section class="cq-list" tabindex="-1" aria-label="단계별 의뢰 목록"><header class="mk-pane-head"><h2>'+contractPanel.tier+'단계 의뢰</h2><span>완료 '+done+' / '+entries.length+'</span></header>'+
    '<div class="cq-rows">'+entries.map(({quest,status})=>
      '<button type="button" class="cq-row" data-contract="open" data-id="'+quest.id+'" aria-pressed="'+(contractPanel.quest===quest.id)+
      '"><strong>'+esc(quest.title)+'</strong><span class="cq-state" data-state="'+status+'">'+contractLabels[status]+'</span></button>').join('')+'</div>'+
    standingUnlockItems(trader,contractPanel.tier)+'</section>';
}
function contractGoalList(entry){
  const preview=['available','busy'].includes(entry.status),complete=entry.status==='claimed';
  return '<section class="cq-objectives"><h3>작전 목표</h3><ul>'+entry.quest.goals.map((goal,i)=>{
    const count=Math.min(goal.target,entry.goals[i]?.value||0);
    const value=complete?goal.target:count;
    const fulfilled=complete||(!preview&&value>=goal.target);
    return '<li data-fulfilled="'+fulfilled+'"><span class="cq-check" aria-hidden="true">'+(fulfilled?'✓':'')+'</span><span>'+esc(goal.type==='delivery'?GOODS[goal.item][0]+' · '+findMarketTrader(entry.quest.trader).name+'에게 전달':contractGoalLabel(goal))+'</span>'+
      '<b>'+(preview?(goal.type==='delivery'?'보유 '+value+' / '+goal.target:'목표 '+goal.target):value+' / '+goal.target)+'</b></li>';
  }).join('')+'</ul></section>';
}
function contractReward(q){
  return '<section class="cq-reward"><h3>완료 보상</h3><dl><div><dt>우호도</dt><dd>+'+q.rep+'점</dd></div><div><dt>크레딧</dt><dd>'+money(q.cr)+'</dd></div>'+
    '<div><dt>경험치</dt><dd>+'+q.xp+' XP</dd></div></dl></section>';
}
function contractFooter(entry){
  const {quest:q,status}=entry;
  const withDelivery=q.goals.some(goal=>goal.type==='delivery');
  const recipient=esc(findMarketTrader(q.trader).name);
  let actions='',hint='';
  if(raid)hint='벙커에 복귀한 후 의뢰를 수락하고 보상을 받을 수 있습니다.';
  else if(!writer)hint='저장 권한이 있는 탭에서 의뢰를 관리할 수 있습니다.';
  else if(status==='busy')hint='이 상인에게 수락한 의뢰를 마치면 수락할 수 있습니다.';
  else if(status==='claimed')hint='상인에게 보고하고 보상을 받았습니다.';
  else if(status==='available')actions='<button class="cq-action" data-contract="accept" data-id="'+q.id+'">퀘스트 수락</button>';
  else if(status==='ready'||status==='active'){
    if(contractPanel.confirmCancel){
      hint='의뢰를 포기하면 이 의뢰의 진행도가 초기화됩니다. 다시 수락할 수 있습니다.';
      actions='<button data-contract="keep" data-id="'+q.id+'">계속 진행</button><button data-contract="cancel" data-id="'+q.id+'">포기 확정</button>';
    }else{
      actions='<button data-contract="askCancel" data-id="'+q.id+'">의뢰 포기</button>'+
        '<button class="cq-action" data-contract="claim" data-id="'+q.id+'" '+(status==='ready'?'':'disabled')+'>'+(withDelivery?recipient+'에게 납품':'보상 받기')+'</button>';
      hint=withDelivery?'휴대품과 보관품에서 요구 물품을 '+recipient+'에게 건네면 보상을 받습니다.':(status==='active'?'수락 후 수행한 현장 목표는 생환 시 반영됩니다.':'목표를 모두 달성했습니다.');
    }
  }
  if((status==='active'||status==='ready')&&!contractPanel.confirmCancel)actions+=objectiveControl({kind:'contract',id:q.id});
  return '<footer class="cq-footer">'+(hint?'<p>'+esc(hint)+'</p>':'')+(actions?'<div class="cq-actions">'+actions+'</div>':'')+'</footer>';
}
function contractDetail(trader,entry){
  const q=entry.quest,art=artURL(contractScenery[trader.id]);
  return '<section class="cq-detail" tabindex="-1" aria-label="선택한 퀘스트"><header class="cq-detail-hero">'+
    (art?'<img aria-hidden="true" alt="" src="'+esc(art)+'">':'')+'<div><p>'+esc(trader.name)+' 의뢰 · 우호도 '+q.tier+'단계</p>'+
    '<h2>'+esc(q.title)+'</h2></div><span class="cq-state" data-state="'+entry.status+'">'+contractLabels[entry.status]+'</span></header>'+
    '<div class="cq-detail-body">'+(contractPanel.message?'<p class="cq-feedback" tabindex="-1" role="status">'+esc(contractPanel.message)+'</p>':'')+
    '<blockquote>'+esc(q.brief)+'</blockquote>'+contractGoalList(entry)+contractReward(q)+'</div>'+contractFooter(entry)+'</section>';
}
function standingQuestsView(trader){
  const standing=traderStanding(trader.id),entries=contractBoardEntries(trader.id,standing.tier);
  if(contractPanel.trader!==trader.id||!entries.some(entry=>entry.quest.id===contractPanel.quest&&entry.quest.tier===contractPanel.tier)){
    contractPanel.trader=trader.id;
    contractSelectTier(contractCurrent(entries)?.quest.tier||standing.tier,entries);
  }
  const group=entries.filter(entry=>entry.quest.tier===contractPanel.tier);
  const entry=group.find(entry=>entry.quest.id===contractPanel.quest)||group[0];
  return contractStandingPanel(trader,standing,entries)+(trader.id==='medic'?wardTrialPanel():'')+contractTierStrip(standing)+
    '<div class="cq-layout">'+contractList(group,trader)+(entry?contractDetail(trader,entry):'')+'</div>';
}
const questModes={standing:'우호도 퀘스트',daily:'일일 퀘스트',weekly:'주간 퀘스트'};
function setTraderQuestMode(mode){
  if(!Object.hasOwn(questModes,mode))return;
  contractPanel.mode=mode;
  contractPanel.confirmCancel=false;
  contractPanel.message='';
  clearRecurringFeedback();
}
function traderQuestsView(){
  const trader=findMarketTrader(marketUI.trader)||MARKET_TRADERS[0],mode=contractPanel.mode;
  const tabs='<nav class="cq-modes" aria-label="퀘스트 종류">'+Object.entries(questModes).map(([key,label])=>
    '<button type="button" data-contract="board" data-mode="'+key+'" aria-pressed="'+(mode===key)+'">'+label+'</button>').join('')+'</nav>';
  return '<div class="mk-screen cq-screen"><header class="mk-head"><h1>상인 퀘스트</h1><button data-page="orders">벙커 의뢰 <span aria-hidden="true">↗</span></button></header>'+
    marketWorkspaceTabs(true)+tabs+marketTraderList('data-contract')+
    (mode==='standing'?standingQuestsView(trader):recurringQuestsView(trader,mode))+'</div>';
}
function handleContractUI(d){
  if(page!=='traderQuests')return;
  if(d.contract==='ward-trial'){handleWardTrial(d);return;}
  const keyboard=document.activeElement?.matches?.(':focus-visible');
  let focusDetail=false,promoted=false;
  if(d.contract==='board'){
    if(!Object.hasOwn(questModes,d.mode))return;
    setTraderQuestMode(d.mode);
    const hash=d.mode==='standing'?'#quests':'#'+d.mode;
    replaceTerminalFragment(hash);
  }else if(d.contract==='trader'){
    if(!marketSelectTrader(d.id))return;
    clearRecurringFeedback();
  }else if(contractPanel.mode!=='standing'){
    if(!handleRecurringUI(d))return;
  }else{
    const traderId=marketUI.trader,standing=traderStanding(traderId);
    const entries=contractBoardEntries(traderId,standing.tier);
    if(d.contract==='unlock-item'){
      const tier=Number(d.tier);
      if(d.trader!==traderId||tier!==contractPanel.tier||tier<2||tier>standing.tier||
        !marketTierGoods(traderId,tier).includes(d.id))return;
      marketSelectTrader(traderId);marketUI.mode='buy';marketUI.item=d.id;
      navigatePage('trade');
      marketCartFocus($('.mk-checkout'));
      return;
    }
    if(d.contract==='tier'){
      const tier=Number(d.tier);
      if(!Number.isInteger(tier)||tier<1||tier>standing.tier)return;
      contractSelectTier(tier,entries);
    }else{
      const entry=entries.find(entry=>entry.quest.id===d.id);
      if(!entry)return;
      if(d.contract==='open'){
        contractPanel.tier=entry.quest.tier;contractPanel.quest=d.id;contractPanel.confirmCancel=false;contractPanel.message='';focusDetail=true;
      }else{
        if(contractPanel.quest!==d.id)return;
        if(d.contract==='askCancel'||d.contract==='keep')contractPanel.confirmCancel=d.contract==='askCancel';
        else if(['accept','claim','cancel'].includes(d.contract)){
          if(d.contract==='cancel'&&!contractPanel.confirmCancel)return;
          const result=contractAction(d.id,d.contract,d.pinIfEmpty===true);
          contractPanel.message=result.message;
          if(result.ok&&d.contract==='claim'){
            const tier=traderStanding(traderId).tier;
            if(tier>standing.tier){
              const opened=contractBoardEntries(traderId,tier).filter(e=>e.quest.tier===tier);
              contractSelectTier(tier,opened);
              contractPanel.message=result.message+' 새 의뢰 '+opened.length+'건과 상점 상품 '+marketTierGoods(traderId,tier).length+'종이 열렸습니다.';
              promoted=true;
            }
          }
          contractPanel.confirmCancel=false;
        }else return;
      }
    }
  }
  renderKeep();
  if(promoted){
    const feedback=document.querySelector('.cq-detail .cq-feedback');
    feedback?.scrollIntoView({block:'nearest'});
    if(keyboard)feedback?.focus({preventScroll:true});
    return;
  }
  if(focusDetail&&innerWidth<=700)document.querySelector('.cq-detail')?.scrollIntoView({block:'start'});
  if(keyboard){
    const matching=Array.from(document.querySelectorAll('.cq-screen [data-contract]')).find(button=>
      !button.disabled&&Object.entries(d).every(([key,value])=>button.dataset[key]===value));
    const card=d.id&&Array.from(document.querySelectorAll('.rc-card')).find(el=>el.dataset.offer===d.id);
    const target=focusDetail?document.querySelector('.cq-detail'):matching||card||document.querySelector('.cq-footer button:not(:disabled)')||document.querySelector('.cq-detail');
    target?.focus?.({preventScroll:true});
  }
}
