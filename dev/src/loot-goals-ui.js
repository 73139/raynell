// The planning page reads the loot table projection. Only the field's normal search reveals items.
let lootPlanRegion=null;
let lootPlanFeedback='';
let lootPlanFieldFeedback=null;

function clearLootPlanUI(){
  lootPlanRegion=null;
  lootPlanFeedback='';
  lootPlanFieldFeedback=null;
}

function lootPlanLink(zoneId){
  const v=lootGoalView(), selected=v.goals.find(goal=>goal.id===v.selected);
  const first=v.regions.find(region=>region.zone===zoneId)?.landmarks[0];
  const planned=v.destination;
  const point=planned?.zone===zoneId?LANDMARKS[zoneId]?.[planned.index]?.name:null;
  const detail=selected ? selected.label+(point?' · 지정한 지점 '+point:first?' · 추천 '+first.name:'') : '목표 물자와 수색 후보 선택';
  return huntSummary('plan')+'<div class="lp-nav"><button type="button" data-page="lootplan">'+commandIcon('pin')+
    '<span><b>물자 수색 계획</b><small>'+esc(detail)+'</small></span><i aria-hidden="true">›</i></button></div>';
}

function lootPlanPointButton(z,point,label){
  const busy=raid&&(field.result||(z===raid.zone&&(field.open||field.action||field.journey||field.contact)));
  return '<button type="button" data-lootplan="candidate" data-zone="'+z+'" data-landmark="'+point.index+
    '" aria-label="'+esc(point.name+' · '+label)+'" '+(busy?'disabled':'')+'>'+esc(label)+'</button>';
}

function lootPlanPercent(probability){
  const percent=probability*100;
  if(percent>0 && percent<.1)return '0.1% 미만';
  return Number(percent.toFixed(1)).toLocaleString('ko-KR')+'%';
}
function lootPlanBoxEvidence(z,box,item){
  const lock=box.keyId?lootLockView(z,box.index):null;
  const access=lock?(lock.legacy?'':lock.unlocked?' · 개방 완료':' · 열쇠 필요'):'';
  const chance=item?'상자 전체 1개 이상 '+huntOddsPercent(box.score):'첫 추첨 '+lootPlanPercent(box.score);
  return '<li><span>'+esc(box.name)+'</span><small>'+esc(box.tableName)+' · '+chance+access+'</small></li>';
}
function lootPlanPoint(point,destination,item){
  const z=point.zone;
  const chosen=destination?.zone===z&&destination.index===point.index;
  const buttonLabel=!raid?'이 지점으로 출격 준비':z===raid.zone?'이 랜드마크로 이동':'이 권역의 이동 경로';
  return '<article class="lp-point" data-lootplan-point data-zone="'+z+'" data-landmark="'+point.index+'" data-chosen="'+chosen+'">'+
    '<h3>'+esc(point.name)+(chosen?'<small>지정한 지점</small>':'')+'</h3><ul>'+point.boxes.map(box=>lootPlanBoxEvidence(z,box,item)).join('')+
    '</ul>'+lootPlanPointButton(z,point,buttonLabel)+'</article>';
}

function lootPlanKeyCard(z){
  const def=LOOT_LOCKS.find(lock=>lock.zone===z);
  if(!def)return '';
  const lock=lootLockView(z,def.index);
  if(!lock)return '';
  const point=LANDMARKS[z].find(p=>p.boxes.includes(def.index));
  const focus=raid&&!field.result?'현장 휴대':'출격 장비';
  const amount=lootPlanKeyCount(lock.keyId);
  const status=lock.legacy?'이전 출격 · 기존 개방 상태':lock.unlocked?'이번 출격에서 개방 완료':'잠긴 보관함';
  const canShop=!raid && marketIsUnlocked(lock.traderId,lock.keyId);
  return '<section class="lp-lock" data-lootplan-key="'+esc(lock.keyId)+'"><div class="lp-lock-heading">'+
    itemArt(lock.keyId,'lp-key-art')+'<div><p>'+esc(status)+'</p><h2 tabindex="-1">'+esc(FIELD_ZONES[z].boxes[def.index][0])+'</h2></div></div>'+
    '<p>'+esc(point.name)+' · '+esc(lock.keyName)+'</p><p><b>'+esc(focus)+' '+amount+'개</b> · '+esc(lock.keySource)+' · '+money(lock.price)+'</p>'+
    '<p>열쇠 고리나 가방에 넣어 가져가세요. 개방한 뒤에도 열쇠는 남습니다.</p>'+
    (canShop?'<button type="button" data-lootplan="shop" data-id="'+esc(lock.keyId)+'">열쇠 거래 보기</button>':'')+'</section>';
}

function lootPlanKeyCount(id){
  const kit=raid&&!field.result?field:equipmentState;
  return Number(kit.worn?.access===id)+(kit.bag||[]).filter(unit=>unit.g===id).length;
}

function lootPlanRegionSection(v,z,goal){
  const region=v.regions.find(r=>r.zone===z);
  const candidates=region?.landmarks||[];
  const primary=candidates.slice(0,3).map(point=>lootPlanPoint(point,v.destination,goal?.item)).join('');
  const remainder=candidates.slice(3);
  const recommendation=goal?.item
    ? '<p>'+esc(goal.label)+' 하나 이상을 찾을 확률이 높은 지점부터 표시합니다. 각 지점의 새 상자를 모두 수색할 때의 순위이며, 잠긴 상자는 열쇠가 필요합니다.</p>'
    : goal
    ? '<p>이 권역에서 '+esc(goal.label)+' 후보입니다. 상자별 수치는 첫 물품이 이 분류일 확률이며 빈 상자 가능성도 포함합니다. 지점은 상자들의 첫 추첨 중 한 번 이상 목표에 맞을 확률순입니다.</p>'
    : '<p>위에서 목표 물자를 선택하면 해당 분류를 찾을 수 있는 랜드마크와 상자가 표시됩니다.</p>';
  return '<section class="lp-region" aria-label="권역별 수색 후보">'+
    '<div class="lp-region-tabs" role="group" aria-label="조회 권역">'+FIELD_ZONES.map((area,i)=>
      '<button type="button" data-lootplan="region" data-zone="'+i+'" aria-pressed="'+(i===z)+'">'+esc(area.name)+'</button>').join('')+'</div>'+
    '<div class="lp-region-body"><div class="lp-suggestions"><div class="lp-row"><h2>'+esc(FIELD_ZONES[z].name)+' · 수색 후보</h2>'+
    '<button class="lp-key-jump" type="button" data-lootplan="key">보관함 열쇠 보기</button></div>'+recommendation+
    (goal?(candidates.length?'<div class="lp-points">'+primary+'</div>':'<p>이 권역에는 해당 분류가 나오는 수색 대상이 없습니다.</p>'):'')+
    (remainder.length?'<details data-lp-more><summary>나머지 후보 '+remainder.length+'곳</summary><div class="lp-points">'+
      remainder.map(point=>lootPlanPoint(point,v.destination,goal?.item)).join('')+'</div></details>':'')+'</div>'+lootPlanKeyCard(z)+'</div></section>';
}

function lootPlanPage(){
  const v=lootGoalView(), goal=v.goals.find(g=>g.id===v.selected);
  const z=lootPlanRegion??(raid?raid.zone:zone);
  return '<article class="lp-page" data-lootplan-page data-region="'+z+'"><header class="lp-cover" style="--lp-art:url(\''+
    esc(artURL(COMMAND_ZONES[z].art))+'\')"><div><h1>물자 수색 계획</h1><p>필요한 물자를 선택하고 출격할 권역과 랜드마크를 정하세요.</p></div>'+
    '<button type="button" data-page="map">작전 지도</button></header>'+
    '<section class="lp-goals"><div class="lp-row"><h2>목표 물자</h2>'+
    (goal?'<button type="button" class="lp-clear" data-lootplan="clear">목표 해제</button>':'')+'</div>'+
    '<div class="lp-selector" role="group" aria-label="목표 물자">'+v.goals.map(g=>
       '<button type="button" data-lootplan="goal" data-id="'+esc(g.id)+'" aria-pressed="'+(g.id===v.selected)+'">'+esc(g.label)+'</button>').join('')+
    '</div><p class="lp-feedback" data-lp-status role="status">'+esc(lootPlanFeedback)+'</p></section>'+
    huntSummary('plan')+lootPlanRegionSection(v,z,goal)+'</article>';
}

function lootPlanLockedCard(z,i,busy){
  const lock=lootLockView(z,i);
  if(!lock||lock.unlocked)return '';
  const box=FIELD_ZONES[z].boxes[i];
  return '<div class="lp-field-lock" data-loot-lock="locked" data-index="'+i+'" data-zone="'+z+'"><header>'+ico(box[1])+
    '<div><b>'+esc(box[0])+'</b><small>잠긴 보관함</small></div></header>'+
    '<p>'+esc(lock.keyName)+' · 현장 휴대 '+lootPlanKeyCount(lock.keyId)+'개</p>'+
    (lock.reason?'<p class="lp-reason">'+esc(lock.reason)+'</p>':'')+
    (lootPlanFieldFeedback?.raidId===raid.startedAt&&lootPlanFieldFeedback.z===z&&lootPlanFieldFeedback.i===i?
      '<p role="status" class="lp-state-feedback">'+esc(lootPlanFieldFeedback.message)+'</p>':'')+
    '<button type="button" data-lootplan="unlock" data-index="'+i+'" data-zone="'+z+'" data-raid-id="'+raid.startedAt+
    '" '+(busy||!lock.canUnlock?'disabled':'')+'>'+esc(lock.keyName)+'로 개방</button></div>';
}

function handleLootPlanUI(d){
  if(d.lootplan==='catalog-item'){
    if(page!=='catalog'||catalogSelected!==d.id||!lootGoalDefinition('item/'+d.id)||!writer)return;
    const result=setLootGoal('item/'+d.id);
    if(!result.ok){$('#db-detail [data-track-status]').textContent=result.message;return;}
    const view=lootGoalView(),here=raid?raid.zone:zone;
    lootPlanRegion=view.regions[here]?.landmarks.length?here:view.regions.find(r=>r.landmarks.length)?.zone??here;
    lootPlanFeedback='';navigatePage('lootplan');
    $('.lp-selector [aria-pressed="true"]')?.focus?.({preventScroll:true});return;
  }
  if(d.lootplan==='unlock'){
    if(page!=='raid')return;
    const reply=unlockLootBox(Number(d.raidId),Number(d.zone),Number(d.index));
    lootPlanFieldFeedback=reply.ok?null:{raidId:Number(d.raidId),z:Number(d.zone),i:Number(d.index),message:reply.message};
    renderKeep();
    if(reply.ok){
      const heading=$('.lo-source h2');
      heading?.setAttribute?.('tabindex','-1');
      heading?.focus?.({preventScroll:true});
      heading?.scrollIntoView?.({block:'nearest'});
    }
    return;
  }
  if(d.lootplan==='shop'){
    if(raid||!writer||!['lootplan','map','prep'].includes(page))return;
    const spec=LOOT_LOCKS.find(lock=>lock.keyId===d.id);
    if(!spec||!marketIsUnlocked(spec.traderId,d.id))return;
    marketSelectTrader(spec.traderId);
    marketUI.mode='buy';
    marketUI.item=d.id;
    navigatePage('trade');
    $('.mk-offer[aria-pressed="true"]')?.scrollIntoView?.({block:'nearest'});
    return;
  }
  if(page!=='lootplan'||!writer)return;
  if(d.lootplan==='goal'||d.lootplan==='clear'){
    const result=setLootGoal(d.lootplan==='clear'?null:d.id);
    lootPlanFeedback=result.message;
    renderKeep();
    if(d.lootplan==='clear')$('.lp-selector button')?.focus?.({preventScroll:true});
    return;
  }
  if(d.lootplan==='key'){
    const heading=$('.lp-lock h2');
    heading?.focus?.({preventScroll:true});
    heading?.scrollIntoView?.({block:'center'});
    return;
  }

  const z=Number(d.zone);
  if(!Number.isInteger(z)||!FIELD_ZONES[z])return;
  if(d.lootplan==='region'){
    lootPlanRegion=z;
    lootPlanFeedback='';
    renderKeep();
    return;
  }
  if(d.lootplan!=='candidate')return;
  const point=Number(d.landmark), v=lootGoalView();
  const region=v.regions.find(r=>r.zone===z);
  if(!region?.landmarks.some(p=>p.index===point))return;
  if(!raid){
    const receipt=selectLootDestination(z,point);
    if(!receipt.ok){lootPlanFeedback=receipt.message;renderKeep();return}
    zone=z;
    commandInspection=null;
    navigatePage('prep');
  }else if(!field.result){
    if(raid.zone===z){
      if(field.open||field.journey||field.contact||field.action)return;
      navigatePage('raid');
      selectLandmark(point);
    }else{
      commandInspection={raidId:raid.startedAt,origin:raid.zone,index:z};
      navigatePage('map');
    }
  }
}

function captureLootPlanFocus(){
  if(page!=='lootplan')return null;
  const root=$('[data-lootplan-page]');
  if(!root?.querySelector)return null;
  const button=document.activeElement?.closest?.('[data-lootplan], [data-lp-more] summary');
  return {button:button&&root.contains(button)?{...button.dataset,tag:button.tagName}:null,open:Boolean(root.querySelector('[data-lp-more]')?.open),region:root.dataset.region};
}
function restoreLootPlanFocus(previous){
  if(!previous||page!=='lootplan')return;
  const root=$('[data-lootplan-page]');
  if(!root?.querySelector)return;
  const more=root.querySelector('[data-lp-more]');
  if(more&&previous.open&&previous.region===root.dataset.region)more.open=true;
  if(!previous.button)return;
  const {tag,...attrs}=previous.button;
  const target=tag==='SUMMARY'?more?.querySelector('summary'):[...root.querySelectorAll('button')].find(el=>
    Object.entries(attrs).every(([k,v])=>el.dataset[k]===v));
  if(target&&!target.disabled)target.focus({preventScroll:true});
}
