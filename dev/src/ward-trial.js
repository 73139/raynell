// A clinic commission does not occupy a trader's standing-quest slot.
const WARD_TRIAL_CR=10000,WARD_TRIAL_XP=25;
let wardTrialMessage='';

function validWardTrialRecord(record,registered,level){
  if(record==null)return true;
  if(!registered||!(level>=1)||!presetRecord(record)||Object.keys(record).length!==2||
    !Number.isSafeInteger(record.acceptedAt)||record.acceptedAt<=0)return false;
  const paid=record.paid;
  if(paid===null)return true;
  return presetRecord(paid)&&Object.keys(paid).length===4&&typeof paid.uid==='string'&&/^[a-z0-9_-]{1,100}$/i.test(paid.uid)&&
    Number.isSafeInteger(paid.at)&&paid.at>=record.acceptedAt&&
    cartMoney(paid.beforeCR)&&cartMoney(paid.beforeXP)&&
    cartMoney(paid.beforeCR+WARD_TRIAL_CR)&&cartMoney(paid.beforeXP+WARD_TRIAL_XP);
}
function validWardTrialBackup(s){
  const trial=s.hideout?.wardTrial;
  if(!validWardTrialRecord(trial,s.hideout?.wardManual?.registered,s.hideout?.levels?.med))return false;
  if(!trial?.paid)return true;
  const {uid,beforeXP}=trial.paid;
  if(!cartMoney(s.career?.xp)||s.career.xp<beforeXP+WARD_TRIAL_XP)return false;
  if(!Array.isArray(s.stashSlots)||!Array.isArray(s.equipment?.bag)||!Array.isArray(s.field?.bag))return false;
  const live=[...s.stashSlots,...s.equipment.bag,...s.field.bag];
  return !live.some(unit=>unit?.uid===uid||(Array.isArray(unit?.contents)&&unit.contents.some(child=>child?.uid===uid)));
}
function wardTrialView(){
  if(!hideout.wardManual.registered||hideoutLevel('med')<1)return null;
  const trial=hideout.wardTrial;
  const stage=trial?.paid?'paid':trial?'active':'available';
  const copies=stage==='active'?stashSlots.filter(u=>u.g===WARD_TRIAL_ITEM).sort((a,b)=>a.y-b.y||a.x-b.x):[];
  let reason='';
  if(stage!=='paid'&&(raid||!writer))reason=raid?'벙커로 귀환한 뒤 납품하세요.':'플레이 중인 탭에서 의뢰를 진행하세요.';
  else if(stage==='active'&&(!cashCanCredit(WARD_TRIAL_CR)||!Number.isSafeInteger(career.xp+WARD_TRIAL_XP)))reason='보상 지급 후 보유 한도를 초과합니다.';
  return {stage,copies,reason,paid:trial?.paid||null};
}
function wardTrialAction(action,uid){
  reconcile();
  const view=wardTrialView();
  const failed=message=>({ok:false,message});
  if(!view||view.reason)return failed(view?.reason||'의무실 의뢰를 다시 확인하세요.');
  if(view.stage==='paid')return failed('이미 윤서진에게 납품하고 보상을 받았습니다.');
  const owner=hideout,previous=owner.wardTrial,priorSlots=stashSlots.slice(),stock=stash,quantity=stashCount(WARD_TRIAL_ITEM);
  const beforeCR=wallet,beforeXP=career.xp;
  if(action==='accept'&&view.stage==='available'){
    owner.wardTrial={acceptedAt:Math.max(1,Date.now()),paid:null};
  }else if(action==='deliver'&&view.stage==='active'){
    const matching=view.copies.filter(unit=>unit.uid===uid);
    if(matching.length!==1||!takeStashGoods(WARD_TRIAL_ITEM,1,uid))return failed('선택한 처치포가 창고 격자에서 이동했습니다.');
    wallet+=WARD_TRIAL_CR;career.xp+=WARD_TRIAL_XP;
    owner.wardTrial={...previous,paid:{uid,at:Math.max(Date.now(),previous.acceptedAt),beforeCR,beforeXP}};
  }else return failed('현재 의뢰 단계를 확인하세요.');
  if(writeSession())return {ok:true,message:action==='accept'?'윤서진의 의뢰를 수락했습니다.':'처치포 한 개를 납품했습니다.'};
  if(hideout!==owner)return failed('다른 탭의 최신 납품 기록을 불러왔습니다.');
  owner.wardTrial=previous;wallet=beforeCR;career.xp=beforeXP;stashSlots=priorSlots;
  if(quantity)stock[WARD_TRIAL_ITEM]=quantity;else delete stock[WARD_TRIAL_ITEM];
  return failed('저장하지 못했습니다. 창고와 보상을 복원했습니다.');
}
function wardTrialWardLink(){
  const view=wardTrialView();
  if(!view)return '';
  return '<section class="facility-operations" data-ward-referral><h3>윤서진의 의뢰</h3><p>현장 의료 시범 납품 · '+
    (view.stage==='paid'?'보상 지급 완료':view.stage==='active'?'진행 중':'수락 가능')+'</p><button type="button" data-hideout="ward-referral" data-id="med">의뢰 보기</button></section>';
}
function wardTrialPanel(){
  const view=wardTrialView();
  if(!view)return '';
  let body='';
  if(view.stage==='available'){
    body='<p>윤서진이 접이식 야전 처치포 한 개를 요청했습니다. 의무실에서 접은 처치포를 창고 격자에서 골라 건네세요.</p>'+
      '<button type="button" data-contract="ward-trial" data-step="accept"'+(view.reason?' disabled':'')+'>의뢰 수락</button>';
  }else if(view.stage==='paid'){
    body='<p data-ward-trial-receipt>처치포 1개 납품 완료 · 실물 '+money(WARD_TRIAL_CR)+' 입금 · +'+WARD_TRIAL_XP+' XP</p>'+
      '<p>납품 직후 잔액 '+money(view.paid.beforeCR+WARD_TRIAL_CR)+' · 누적 '+(view.paid.beforeXP+WARD_TRIAL_XP).toLocaleString('ko-KR')+' XP</p><button type="button" data-contract="ward-trial" data-step="followup">회수 포장 대조 '+(career.done.includes(WARD_FIELD_ID)?'기록':'의뢰')+' 보기</button>';
  }else{
    const rows=view.copies.map(u=>'<li><span>'+esc(kitName(WARD_TRIAL_ITEM))+'<small>창고 '+(u.y+1)+'행 '+(u.x+1)+'열</small></span>'+
      '<button type="button" data-contract="ward-trial" data-step="deliver" data-uid="'+esc(u.uid)+'" aria-label="창고 '+(u.y+1)+'행 '+(u.x+1)+'열의 처치포 한 개 납품"'+
      (view.reason?' disabled':'')+'>이 물품 납품</button></li>').join('');
    body='<p>필요 1개 · 창고 격자 '+view.copies.length+'개</p>'+
      (rows?'<ul>'+rows+'</ul>':'<p>가방·보관함의 처치포를 창고에 꺼내거나 의무실에서 제작하세요. 입고 대기 중인 처치포는 창고 격자에 배치하세요.</p>')+
      '<button type="button" data-bui="facility" data-id="med">의무실 제작 보기</button>';
  }
  return '<section class="cq-clinic" data-ward-trial="'+view.stage+'" tabindex="-1"><div><small>윤서진 · 의무실 의뢰</small><h2>현장 의료 시범 납품</h2></div>'+
    (view.stage!=='paid'?'<p>1회 보상 · '+money(WARD_TRIAL_CR)+' · +'+WARD_TRIAL_XP+' XP</p>':'')+body+
    ((wardTrialMessage||view.reason)?'<p role="status">'+esc(view.reason||wardTrialMessage)+'</p>':'')+'</section>';
}
function openWardTrial(){
  if(!wardTrialView()||page!=='facility'||facilitySelected!=='med')return;
  wardTrialMessage='';marketSelectTrader('medic');setTraderQuestMode('standing');navigatePage('traderQuests');
  const panel=$('[data-ward-trial]');panel?.focus({preventScroll:true});panel?.scrollIntoView({block:'nearest'});
}
function handleWardTrial(d){
  if(page!=='traderQuests'||marketUI.trader!=='medic'||contractPanel.mode!=='standing')return;
  if(d.step==='followup'){
    if(!paidWardDelivery(hideout))return;
    bunkerOrderSelected=WARD_FIELD_ID;bunkerOrderFilter='all';navigatePage('orders');
    const heading=$('.bu-order-title h2');heading?.setAttribute?.('tabindex','-1');heading?.focus?.({preventScroll:true});return;
  }
  wardTrialMessage=wardTrialAction(d.step,d.uid).message;
  renderKeep();
  const panel=$('[data-ward-trial]');panel?.focus({preventScroll:true});panel?.scrollIntoView({block:'nearest'});
}
