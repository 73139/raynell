// Only the selected screen and button feedback are transient. The game owns the offers and receipts.
let recurringFeedback=null;
function clearRecurringFeedback(){recurringFeedback=null}
function recurringDeadlineLabel(timestamp){
  const kst=new Date(timestamp+9*3600000);
  const days=['일','월','화','수','목','금','토'];
  return (kst.getUTCMonth()+1)+'월 '+kst.getUTCDate()+'일 ('+days[kst.getUTCDay()]+') 00:00';
}
function recurringCountdown(endsAt,now){
  const seconds=Math.max(0,Math.ceil((endsAt-now)/1000));
  if(seconds<60)return seconds+'초';
  const minutes=Math.ceil(seconds/60),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
  if(days>0)return days+'일 '+(hours%24)+'시간';
  if(hours>0)return hours+'시간 '+(minutes%60)+'분';
  return minutes+'분';
}
function recurringGoalText(goal,trader){
  if(goal.type==='delivery')return GOODS[goal.item][0]+' · '+trader.name+'에게 전달';
  const area=Number.isInteger(goal.zone)?FIELD_ZONES[goal.zone].name:'모든 권역';
  return area+' · 적 기체 처치';
}
function recurringGoalRows(entry,trader){
  const q=entry.quest;
  return '<section class="cq-objectives rc-goals"><h3>목표</h3><ul>'+q.goals.map((goal,i)=>{
    const current=entry.status==='claimed'?goal.target:Math.min(goal.target,entry.values[i]);
    const done=current>=goal.target;
    const preview=goal.type==='delivery'&&entry.status==='available';
    return '<li data-fulfilled="'+done+'"><span class="cq-check" aria-hidden="true">'+(done?'✓':'')+'</span>'+
      '<span>'+esc(recurringGoalText(goal,trader))+(goal.type==='delivery'&&entry.status!=='claimed'?deliveryStockMarkup(goal.item):'')+'</span><b>'+(preview?'보유 ':'')+current+' / '+goal.target+'</b></li>';
  }).join('')+'</ul></section>';
}
function recurringReward(entry,period){
  if(entry.receipt){
    const received=entry.receipt;
    const items=received.loot.map(drop=>'<li data-grade="'+esc(drop.tier)+'"><span class="rc-item-art">'+itemArt(drop.id)+'</span><span><small>'+
      esc(REC_LOOT_LABELS[drop.tier])+'</small><b>'+esc(GOODS[drop.id][0])+'</b></span><strong>×'+drop.qty+'</strong></li>').join('');
    return '<section class="rc-receipt" aria-label="받은 보상"><header><h3>받은 보상</h3><span>'+money(received.cr)+' · +'+received.xp+' XP</span></header>'+
      '<ul>'+items+'</ul><p>지급품을 벙커 보관품에 추가했습니다.</p></section>';
  }
  const q=entry.quest,count=period==='daily'?1:2;
  return '<section class="cq-reward rc-reward"><h3>완료 보상</h3><dl><div><dt>경험치</dt><dd>+'+q.xp+' XP</dd></div>'+
    '<div><dt>크레딧</dt><dd>'+money(q.cr)+'</dd></div><div><dt>무작위 물품</dt><dd>'+count+'개</dd></div></dl></section>';
}
function recurringActionBar(entry,trader,board,period){
  const q=entry.quest,delivery=q.type==='delivery',accepted=entry.status!=='available';
  const hook=' data-id="'+esc(q.id)+'" data-trader="'+esc(trader.id)+'" data-mode="'+period+'" data-key="'+board.key+'"';
  let message='',action='';
  if(entry.status==='claimed')return '';
  if(raid)message='벙커로 복귀하면 '+trader.name+'에게 의뢰를 수락하거나 보고할 수 있습니다.';
  else if(!writer)message='플레이 중인 탭에서 의뢰를 관리하세요.';
  else{
    if(delivery)message='휴대품과 보관품에서 요구 물품을 '+trader.name+'에게 직접 건넵니다.';
    else message='수락한 뒤 쓰러뜨린 적 기체부터 집계합니다.';
    const label=accepted?(delivery?trader.name+'에게 납품':trader.name+'에게 보고'):'퀘스트 수락';
    action='<button class="cq-action" data-contract="'+(accepted?'periodClaim':'periodAccept')+'"'+hook+
      (accepted&&entry.status!=='ready'?' disabled':'')+'>'+esc(label)+'</button>';
  }
  if(accepted)action+=objectiveControl({kind:period,id:q.id,trader:trader.id,key:board.key});
  return '<footer class="cq-footer rc-actions"><p>'+esc(message)+'</p>'+(action?'<div class="cq-actions">'+action+'</div>':'')+'</footer>';
}
function recurringCard(entry,trader,board,period){
  const q=entry.quest,kill=q.type==='kill',state=entry.status;
  let illustration;
  if(kill){
    const area=q.goals.find(goal=>Number.isInteger(goal.zone))?.zone??0;
    illustration='<img class="rc-location" src="'+esc(artURL(COMMAND_ZONES[area].art))+'" alt="" draggable="false">';
  }else{
    const id=q.goals[0].item;
    illustration='<span class="rc-delivery-art">'+itemArt(id)+'</span>';
  }
  return '<section class="rc-card" data-kind="'+(kill?'kill':'delivery')+'" data-offer="'+esc(q.id)+'" aria-label="'+esc(q.title)+'" tabindex="-1">'+
    '<header class="rc-card-head">'+illustration+'<div class="rc-card-heading"><small>'+(kill?'처치 의뢰':'납품 의뢰')+'</small><h3>'+esc(q.title)+'</h3></div>'+
    '<span class="cq-state" data-state="'+state+'">'+contractLabels[state]+'</span></header>'+
    '<div class="rc-card-body"><blockquote>'+esc(q.brief)+'</blockquote>'+recurringGoalRows(entry,trader)+recurringReward(entry,period)+'</div>'+
    recurringActionBar(entry,trader,board,period)+'</section>';
}
function recurringQuestsView(trader,period){
  const now=Date.now(),board=recurringBoard(trader.id,period,now),daily=period==='daily';
  const completed=board.entries.filter(e=>e.status==='claimed').length;
  const note=recurringFeedback?'<p class="rc-feedback" role="status">'+esc(recurringFeedback)+'</p>':'';
  return '<section id="recurring-board" aria-label="'+esc(questModes[period])+'" data-period="'+period+'" data-key="'+board.key+'">'+
    '<header class="rc-watch"><div><h2>'+esc(trader.name)+'의 '+(daily?'일일':'주간')+' 의뢰</h2><p>완료 '+completed+' / '+board.entries.length+
    ' · '+(daily?'매일':'매주 월요일')+' 00:00 교체 · 한국 시간</p></div>'+
    '<div class="rc-clock" title="'+esc(recurringDeadlineLabel(board.endsAt))+'"><small>교체까지</small><strong id="rc-countdown">'+
    recurringCountdown(board.endsAt,now)+'</strong><time datetime="'+new Date(board.endsAt).toISOString()+'">'+recurringDeadlineLabel(board.endsAt)+'</time></div></header>'+
    '<div class="rc-notes"><p>기간 안에 보고하면 XP와 CR, 무작위 보급품 '+(daily?'1개':'2개')+'를 받습니다.</p>'+
    '<details><summary>보급품 등급</summary><p>'+esc(Object.values(REC_LOOT_LABELS).join(' · '))+' 중 하나로 뽑힙니다.'+
    (daily?'':' 주간 보급품은 각각 뽑습니다.')+'</p></details></div>'+note+
    '<div class="rc-grid">'+board.entries.map(entry=>recurringCard(entry,trader,board,period)).join('')+'</div></section>';
}
function handleRecurringUI(d){
  if(d.contract!=='periodAccept'&&d.contract!=='periodClaim')return false;
  if(d.trader!==marketUI.trader||d.mode!==contractPanel.mode)return false;
  const action=d.contract==='periodAccept'?'accept':'claim';
  const result=recurringAction(d.trader,d.mode,Number(d.key),d.id,action);
  recurringFeedback=result.message;
  return true;
}
function tickRecurringQuestUI(){
  if(rendering||view!=='inside'||page!=='traderQuests'||contractPanel.mode==='standing')return;
  const board=document.querySelector('#recurring-board'),mode=contractPanel.mode;
  if(board?.dataset?.period!==mode)return;
  const now=Date.now(),period=recurringPeriod(mode,now);
  if(Number(board.dataset.key)!==period.key){
    recurringFeedback='기간이 끝나 새 의뢰가 도착했습니다.';
    renderKeep();
    return;
  }
  const countdown=document.querySelector('#rc-countdown');
  const label=recurringCountdown(period.endsAt,now);
  if(countdown&&countdown.textContent!==label)countdown.textContent=label;
}
