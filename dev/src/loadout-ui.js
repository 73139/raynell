// The equipment, warehouse and field engines own quantities and coordinates.
const LOADOUT_ART={
  rl_bp_dressing:'ward-manual',rl_craft_dressing:'folded-dressing',
  soap:'soap',rl_11_01:'plasters',rl_14_07:'wipes',rl_14_09:'swabs',rl_16_19:'ward-key',
  rl_x_ammo:'box',rl_x_field_ammo:'packet',rl_x_pack:'bag',rl_x_field_pack:'bag',rl_x_optic:'tube',rl_x_armor:'plate',rl_x_carbine:'rifle',
  rl_x_fabric:'insignia',rl_x_mesh:'textile',rl_x_circuit:'usb',rl_x_core:'meter',
  food:'tinned-ration',biscuit:'field-biscuit',matches:'matchbox',salt:'salt-packet',rl_16_14:'warehouse-key',rl_16_01:'warehouse-key',
  operator_body:'body',rl12_helmet:'helmet',rl12_sidearm:'sidearm',rl12_respirator:'respirator',rl_13_01:'headset',rl_13_16:'pouch',patch:'insignia',issued_pack:'bag',rl10_carbine:'rifle',rl10_vest:'plate',rl10_pack:'bag',
  water:'water',bandage:'bandage',gauze:'bandage',tape:'tape',medkit:'medical',radio:'radio',
  cable:'cable',wire:'wire',meter:'meter',battpack:'cells',battery:'cells',seal:'packet',cloth:'textile',
  bolt:'parts',nut:'parts',ssd:'usb',flash:'tube',saline:'vial',pain:'pills',
  rl_13_07:'glasses',rl_13_08:'glasses',rl_13_05:'tube',ration:'packet',splint:'tube',ammo:'box'
};
function artKeyForItem(id){
  if(id==='cr_notes')return 'item-cr';
  if(Object.hasOwn(STORAGE_CASES,id))return 'item-'+id;
  let key=LOADOUT_ART[id];
  if(!key&&GOODS[id]){
    const n=GOODS[id][0];
    if(/붕대|거즈/.test(n))key='bandage';
    else if(/테이프/.test(n))key='tape';
    else if(/배선|전선/.test(n))key='wire';
    else if(/케이블/.test(n))key='cable';
    else if(/로프|밧줄/.test(n))key='rope';
    else if(/볼트|너트|연결쇠|경첩/.test(n))key='parts';
    else if(/배터리|전지|퓨즈/.test(n))key='cells';
    else if(/측정기|측정 장치|테스터/.test(n))key='meter';
    else if(/직물|천 조각|섬유|수건|담요/.test(n))key='textile';
    else if(/USB|메모리 스틱|저장 장치/i.test(n))key='usb';
    else if(/약병|식염수|소독액/.test(n))key='vial';
    else if(/정제|진통제|항생제/.test(n))key='pills';
    else if(/파우치|구급함/.test(n))key='medical';
    else if(/보급함|공구함|장비함/.test(n))key='case';
    else if(/전투식량|식량 팩/.test(n))key='packet';
  }
  return key?'item-'+key:null;
}
const LO_GROUPS={'전체':()=>true,'소모품':id=>Boolean(kitSupply(id)),'의료':id=>GOODS[id][5]==='의료',
  '자재':id=>['재료','전자','공구','연료'].includes(GOODS[id][5]),'장비':id=>Boolean(kitSlot(id)),
  '기타':id=>!kitSlot(id)&&!kitSupply(id)&&!['의료','재료','전자','공구','연료'].includes(GOODS[id][5])};
let loSlot=null,loFilter='전체',loHealthId=null,loAssign=null,loShopOpen=false,loClearBind=false;
const LO_MOBILE={prep:['작전원','가방','체크리스트'],gear:['작전원','가방','창고'],loot:['작전원','가방','상자'],health:['신체','가방','소모품']};
const loMobilePanel={prep:2,gear:0,loot:2,health:0};
function loMobileNav(screen){
  return '<div class="lo-mobile-tabs" aria-label="화면 패널">'+LO_MOBILE[screen].map((label,n)=>
    '<button data-loadout="mobile-tab" data-screen="'+screen+'" data-index="'+n+'" aria-pressed="'+(loMobilePanel[screen]===n)+'">'+(screen==='gear'&&n===2&&raid?'주변 물품':label)+'</button>').join('')+'</div>';
}
function loLayout(screen){return loMobileNav(screen)+'<div class="lo-layout" data-panel="'+loMobilePanel[screen]+'">';}
function loHead(n,title,sub,action=''){
  return '<header class="lo-head"><div><span>'+n+'</span><h1>'+title+'</h1></div><p>'+esc(sub)+'</p>'+action+'</header>';
}
function loTitle(text,meta='',icon=''){
  return '<div class="lo-pane-title"><h2>'+(icon?ico(icon):'')+text+'</h2>'+(meta?'<small>'+esc(meta)+'</small>':'')+'</div>';
}
function loMsg(){
  return gearNotice?'<p role="status" class="lo-msg">'+esc(gearNotice)+'</p>':'';
}
function loCellsUsed(items){return items.reduce((used,o)=>used+o.w*o.h,0);}
function loBindings(){return equipmentState.quickslots||(equipmentState.quickslots=Array(10).fill(null));}
function loLock(){return Boolean(raid&&(field.result||field.action||field.contact||field.journey));}
function loWearPanel(kit){
  const worn=kit.worn,slot=loSlot&&KIT_SLOTS[loSlot]?loSlot:null;
  const equipped=slot?worn[slot]:null,blocked=loLock();
  const slots=['breathing','head','face','ears','armor','eyes','back','support','insignia','primary','secondary','melee','comms','light','access'];
  const sample={head:'rl12_helmet',face:'rl_11_09',breathing:'rl12_respirator',ears:'rl_13_01',support:'rl_13_16',secondary:'rl12_sidearm',melee:'rl_05_15',
    insignia:'patch',armor:KIT_ARMOR,eyes:'rl_13_07',back:ISSUE_PACK,primary:KIT_START_PRIMARY,comms:'radio',light:'flash',access:'key'};
  const slotTiles=slots.map(key=>{
    const id=worn[key],def=KIT_SLOTS[key];
    return '<button type="button" class="lo-wear-tile '+(id?'has-item ':'')+(key==='primary'?'wide':'')+'" data-loadout="slot" data-slot="'+key+'" aria-pressed="'+(slot===key)+'" aria-label="'+def.label+' · '+esc(kitName(id))+'"><small>'+def.label+'</small>'+
      '<span class="lo-wear-image">'+(id?itemArt(id):itemArt(sample[key]))+'</span><b>'+esc(kitName(id))+'</b></button>';
  }).join('');
  let details='';
  if(slot){
    const part=equipped?kit.modules?.[slot]:null;
    const stashMatches=raid?[]:Object.keys(stash).filter(id=>stashCount(id)>0&&kitSlot(id)===slot);
    const bagMatches=kit.bag.filter(u=>kitSlot(u.g)===slot);
    const trackedStock=stashMatches.filter(id=>gearSpec(id));
    const stockButtons=stashMatches.filter(id=>!gearSpec(id)).map(id=>gearButton('wear-stash',esc(kitName(id))+' 장착',{id},blocked));
    if(trackedStock.length){
      for(const unit of stashSlots.filter(u=>trackedStock.includes(u.g)).slice(0,3)){
        const copy=gearEnsureUnit(unit);
        stockButtons.push(gearButton('wear-stash',esc(kitName(unit.g))+' #'+esc(gearSerial(copy.uid))+' 장착',{id:unit.g,unit:unit.uid},blocked));
      }
      stockButtons.push('<button type="button" data-page="maintenance">보유 장비 상태 비교</button>');
    }
    details='<div class="lo-slot-detail"><strong>'+KIT_SLOTS[slot].label+' · '+esc(kitName(equipped))+'</strong><p>'+esc(equipped?kitEffects(slot,equipped):KIT_SLOTS[slot].empty)+'</p>'+
      (gearSpec(equipped)?'<p class="lo-module-detail">'+esc(maintenanceStateLine(gearWorn(kit,slot)))+'</p>':'')+
      (part?'<p class="lo-module-detail" data-equipped-module="'+esc(part)+'">장착 모듈 · '+esc(kitName(part))+' · '+esc(kitModuleEffectText(slot,part))+'</p>':'')+'<div class="lo-actions">'+
      (equipped?gearButton(raid?'ground-worn':'unwear',raid?'바닥에 놓기':equipped===ISSUE_PACK?'지급품 반납':'창고로 보내기',{slot},blocked):slot==='back'&&!raid?gearButton('issue','지급 배낭 받기'):'')+
      stockButtons.join('')+bagMatches.map(o=>{
        const copy=gearEnsureUnit(o);
        return gearButton('wear-bag',esc(kitName(o.g))+(copy?' #'+esc(gearSerial(copy.uid)):'')+' 장착',{unit:o.uid},blocked);
      }).join('')+
      (!raid&&!equipped&&!stashMatches.length&&!bagMatches.length&&KIT_SHELF.includes(sample[slot])&&kitShelfUnlocked(sample[slot])?gearButton('buy',esc(kitName(sample[slot]))+' 구입 · '+money(GOODS[sample[slot]][6]),{id:sample[slot]},wallet<GOODS[sample[slot]][6]):'')+'</div></div>';
  }
  return '<section class="lo-pane lo-wear">'+loTitle('작전원 장비',Object.keys(worn).length+' / '+slots.length,'user')+
    '<div class="lo-figure"><span class="lo-dummy">'+itemArt('operator_body')+'</span><div class="lo-wear-grid">'+slotTiles+'</div></div>'+details+'</section>';
}
function loBindButton(id){
  if(!kitSupply(id))return '';
  return '<button data-loadout="assign" data-id="'+id+'">빠른 사용 지정</button>';
}
function loBag(kit,active){
  const size=kitCapacity(kit.worn),sel=active?(picked?.side==='bag'?selectedItem():null):kit.bag.find(o=>o.uid===gearPick?.uid);
  const title=kit.worn.back?'내 가방':'주머니',used=loCellsUsed(kit.bag),cap=size[0]*size[1];
  const grid=active?gridMarkup(kit.bag,size,'bag'):kitPrepGrid(kit);
  return '<section class="lo-pane lo-bag">'+loTitle(title,used+' / '+cap+' 칸','bag')+
    '<div class="lo-pane-body">'+(active&&page==='raid'&&openBox()&&picked?'<p class="mini-field" data-field-placement-help id="field-placement-help">방향키로 칸 선택 · Enter로 배치</p>':'')+grid+
    (active&&page==='raid'&&openBox()&&picked?.placing?'<button data-field="unselect">배치 취소</button>':'')+
    (active&&page==='raid'&&openBox()&&picked?.side==='loot'&&notice?'<p role="status">'+esc(notice)+'</p>':'')+
    (active&&sel?selectionPanel():'')+(sel?loBindButton(sel.g):'')+
    '<div class="lo-spec"><span>'+size.join(' × ')+' 격자</span><span data-bag-mass>'+packMassLabel(kit.bag)+'</span></div></div></section>';
}
function loDepot(){
  const [cols,rows]=stashSize(), used=loCellsUsed(stashSlots);
  const overflow=Object.keys(stash).filter(id=>stashOverflowCount(id)>0&&LO_GROUPS[loFilter](id));
  const count=Object.keys(stash).reduce((n,id)=>n+stashCount(id),0);
  return '<section class="lo-pane lo-depot">'+loTitle('벙커 창고',used+' / '+(cols*rows)+' 칸','crate')+
    '<div class="lo-pane-body"><div class="lo-filters">'+Object.keys(LO_GROUPS).map(key=>'<button data-loadout="filter" data-id="'+key+'" aria-pressed="'+(loFilter===key)+'">'+key+'</button>').join('')+
    '</div>'+cashCompartmentMarkup()+stashViewport(LO_GROUPS[loFilter])+'<div class="lo-spec"><span>보관 '+count+'개</span><button data-loadout="sort">크기순 정리</button></div>'+
    (selectedStashUnit()?'<div class="lo-detail">'+stashSelectionMarkup()+'</div>':'')+(stashNotice?'<p role="status">'+esc(stashNotice)+'</p>':'')+
    (overflow.length?'<details><summary>입고 대기 '+overflow.reduce((n,id)=>n+stashOverflowCount(id),0)+'개</summary>'+overflow.map(id=>'<button data-stash="select" data-uid="overflow" data-id="'+id+'">'+esc(kitName(id))+' ×'+stashOverflowCount(id)+'</button>').join('')+'</details>':'')+
    '</div></section>';
}
function loArmory(){
  const unlocked=KIT_SHELF.filter(kitShelfUnlocked);
  return '<section class="lo-pane lo-shop">'+loTitle('벙커 보급소',money(wallet),'crate')+'<div class="lo-shop-items">'+
    (loShopOpen?unlocked:unlocked.slice(0,6)).map(id=>'<div><span>'+itemArt(id)+'</span><section><b>'+esc(kitName(id))+'</b><small>'+money(GOODS[id][6])+'</small></section>'+gearButton('buy','구입',{id},wallet<GOODS[id][6])+(stashCount(id)?gearButton(kitSlot(id)?'wear-stash':'pack',kitSlot(id)?'장착':'가방에 넣기',{id}):'')+'</div>').join('')+'</div>'+(unlocked.length>6?'<button class="lo-shop-more" data-loadout="shop" aria-expanded="'+loShopOpen+'">'+(loShopOpen?'기본 보급품만 보기':'장비 보급 목록 전체 보기')+'</button>':'')+'<button data-page="trade" class="lo-shop-more">벙커 상점 열기</button></section>';
}
function loQuickbar(kit){
  const data=loBindings(),available=id=>kit.bag.filter(u=>u.g===id).length;
  const assigning=Boolean(loAssign&&kit.bag.some(o=>o.g===loAssign));
  return '<section class="lo-quick"><div><strong>빠른 사용</strong><small>'+esc(assigning?kitName(loAssign)+' · 칸 선택':loClearBind?'해제할 칸 선택':'1 – 0')+'</small></div><div class="lo-keys">'+
    data.map((id,i)=>'<button data-loadout="quick" data-index="'+i+'" class="'+(id?'bound':'')+'" aria-label="'+((i+1)%10)+'번 · '+esc(assigning?kitName(loAssign)+' 지정':id?kitName(id):'빈 칸')+'"><kbd>'+((i+1)%10)+'</kbd>'+(id?itemArt(id)+'<small>×'+available(id)+'</small>':'')+'</button>').join('')+'</div>'+
    (assigning?'<button data-loadout="assign-cancel">지정 취소</button>':data.some(Boolean)?'<button data-loadout="unbind" aria-pressed="'+loClearBind+'">'+(loClearBind?'해제 취소':'지정 해제')+'</button>':'')+'</section>';
}
function loResultLink(){
  return loHead('B-04','작전 종료','작전 보고서에서 귀환 결과를 확인하세요.')+'<button data-page="raid">작전 보고서</button>';
}
// Advisory only: the actual deployment destination follows handleRaidAction's precedence.
function sortiePreflight(kit,zoneId){
  const hunt=barterHuntView(),destination=barterHunt?.destination??lootDestination;
  const exact=Boolean(barterHunt?.destination&&hunt),size=kitCapacity(kit.worn);
  const free=size[0]*size[1]-loCellsUsed(kit.bag);
  const rows=[];
  if(destination){
    const place=LANDMARKS[destination.zone][destination.index];
    const same=destination.zone===zoneId;
    rows.push({kind:'destination',ok:same,label:'고정 목적지',detail:FIELD_ZONES[destination.zone].name+' · '+place.name+(same?' · 이 지점에서 출격':' · 현재 투입 지역과 다름')});
    const point=exact?huntPoint(hunt.item,destination.zone,destination.index):lootGoalView().regions[destination.zone]?.landmarks.find(p=>p.index===destination.index);
    if(same&&point){
      for(const box of point.boxes.filter(b=>b.keyId)){
        const carried=kit.worn.access===box.keyId||kit.bag.some(u=>u.g===box.keyId);
        rows.push({kind:'key',ok:carried,label:box.name,detail:kitName(box.keyId)+(carried?' · 휴대 중':' · 미휴대 (창고 '+stashCount(box.keyId)+'개)')});
      }
    }
  }
  const soughtItems=new Set([hunt?.item,lootGoalDefinition(lootPlan)?.item].filter(Boolean));
  for(const item of soughtItems){
    const [,w,h]=GOODS[item];
    const fit=Boolean(firstFit(kit.bag,size,w,h)||firstFit(kit.bag,size,h,w));
    rows.push({kind:'fit',ok:fit,label:kitName(item)+' 회수 공간',detail:w+' × '+h+'칸 · '+(fit?'1개 배치 가능':'현재 배치 불가 (회전 포함)')});
  }
  return {free,capacity:size[0]*size[1],rows,plan:exact||(!destination&&hunt)?'barterhunt':'lootplan'};
}
function sortiePreflightMarkup(kit,zoneId){
  const v=sortiePreflight(kit,zoneId);
  return '<section class="gm-readiness" data-sortie-preflight><div class="gm-readiness-head"><h2>수색 준비 점검</h2><button type="button" data-page="'+v.plan+'">수색 계획</button></div>'+
    '<p data-preflight-free="'+v.free+'">가방 빈칸 '+v.free+' / '+v.capacity+'칸 · 실제 배치 가능 여부는 물품 크기에 따라 다릅니다.</p>'+
    (v.rows.length?'<ul>'+v.rows.map(r=>'<li data-preflight-kind="'+r.kind+'" data-ready="'+r.ok+'"><b>'+esc(r.label)+'</b><span>'+esc((r.ok?'확인 · ':'주의 · ')+r.detail)+'</span></li>').join('')+'</ul>':'<p>고정한 수색 목적지가 없습니다.</p>')+
    (v.rows.some(r=>!r.ok)?'<p>주의 사항은 출격을 막지 않습니다. 필요하면 장비·창고에서 준비한 뒤 출격하세요.</p><button type="button" data-page="inventory">장비·창고 확인</button>':'')+'</section>';
}
function prepView(){
  if(raid)return field.result?loResultLink():loHead('03','출격 준비','진행 중인 작전으로 복귀할 수 있습니다.')+'<button class="primary" data-page="raid">현장 복귀</button>'+objectivePanel('prep');
  const k=equipmentState,checks=[['주 장비',Boolean(k.worn.primary)],['방호복',Boolean(k.worn.armor)],['배낭',Boolean(k.worn.back)],['의료품',k.bag.some(u=>kitSupply(u.g)?.stat==='hp')],['수분 보급품',k.bag.some(u=>kitSupply(u.g)?.stat==='water')]];
  return '<div class="loadout-ui lo-prep">'+loHead('03','출격 준비','B-04 벙커 · '+FIELD_ZONES[zone].name,'<button data-page="presets">장비 프리셋·정비</button>')+loMsg()+
    weatherBrief('prep',zone)+lootPlanLink(zone)+gearReadinessMarkup(k)+sortiePreflightMarkup(k,zone)+objectivePanel('prep')+loLayout('prep')+loWearPanel(k)+loBag(k,false)+'<section class="lo-pane lo-check">'+loTitle('출격 체크리스트')+
    '<div class="lo-pane-body"><div class="lo-pair"><span>투입 지역</span><b>'+FIELD_ZONES[zone].name+'</b></div><div class="lo-pair"><span>작전 제한 시간</span><b>'+Math.round(RAID_DURATION_MS/60000)+'분</b></div>'+
    '<div class="lo-pair" data-prep-cash><span>반입 지폐</span><b>'+money(cashSum(k.bag))+'</b></div><h3>장비 상태</h3>'+
    '<ul>'+checks.map(([label,ok])=>'<li><span>'+label+'</span><b class="'+(ok?'ready':'')+'">'+(ok?'확보 ✓':'미휴대')+'</b></li>').join('')+'</ul><p>착용 장비와 가방을 현장에 반입합니다. 탈출 실패 시 반입품과 전리품을 잃습니다.</p>'+
    '<button class="primary lo-deploy" data-raid="start">▶ 출격 시작</button><div class="lo-actions"><button data-page="map">지역 변경</button><button data-page="inventory">장비·창고</button></div></div></section></div>'+
    survivorNavLink()+loQuickbar(k)+loArmory()+'</div>';
}
function gearView(){
  if(raid&&field.result)return loResultLink()+possessionsPanel();
  const k=currentKit(),active=Boolean(raid);
  return '<div class="loadout-ui lo-gear">'+loHead('04',active?'현장 장비':'장비·창고',active?FIELD_ZONES[raid.zone].name:'B-04 벙커',active?'<button data-page="raid">현장 복귀</button>':'<div class="lo-workshop-links"><button data-page="presets">장비 프리셋·정비</button><button data-page="prep">출격 준비</button></div>')+loMsg()+
    gearReadinessMarkup(k,active)+possessionsPanel()+loLayout('gear')+loWearPanel(k)+loBag(k,active)+(active?'<section class="lo-pane">'+loTitle('현장 보관')+'<div class="lo-pane-body">'+(kitGroundPanel()||'<p>이 지역에 내려놓은 물품이 없습니다.</p>')+'<button data-page="health">건강 상태</button></div></section>':loDepot())+'</div>'+loQuickbar(k)+(active?'':loArmory())+'</div>';
}
function lootView(b){
  const z=FIELD_ZONES[raid.zone],def=z.boxes[Number(b.key.split('-')[1])],size=b.size||BOX_SIZE,found=b.items.filter(o=>o.revealed).length;
  return '<div class="loadout-ui lo-loot" data-field-box="'+esc(b.key)+'">'+loHead('05','상자 수색',z.name+' · '+def[0],'<button data-field="close">현장 복귀</button>')+
    weatherBrief('field',raid.zone)+huntSummary('loot')+objectivePanel('loot')+loLayout('loot')+loWearPanel(field)+loBag(field,true)+'<section class="lo-pane lo-source">'+loTitle(def[0],b.complete?'수색 완료':'수색 대상','search')+
    '<div class="lo-pane-body">'+(field.survivorScavenge?.box===b.key?'<p class="lo-note" data-scavenge-trace>먼지 위로 물건을 꺼낸 자국이 나 있습니다. 누군가 먼저 이 상자를 뒤졌습니다.</p>':'')+gridMarkup(b.items,size,'loot')+'<div class="lo-spec" data-field-search-status tabindex="-1" role="status"><span>'+size.join(' × ')+' 격자</span><span>남은 물품 '+b.items.length+' · 확인 '+found+'</span></div>'+actionMarkup()+
    (picked?.side==='loot'?selectionPanel()+objectiveSelectedItem(selectedItem()):'')+
    (b.complete&&b.items.length===0?'<p>상자가 비었습니다.</p>':'')+
    '<button class="primary lo-search" data-field="search" '+(field.action||b.complete?'disabled':'')+'>'+ico('search')+' '+(b.complete?'수색 완료':field.action?'수색 중':'내용물 수색')+'</button></div></section></div>'+loQuickbar(field)+loMsg()+'</div>';
}
function healthView(){
  if(raid&&field.result)return loResultLink()+injurySummaryMarkup(lastSummary);
  const k=currentKit(),active=Boolean(raid);
  const supplies=k.bag.filter(u=>kitSupply(u.g)),ids=[...new Set(supplies.map(u=>u.g))];
  const selected=ids.includes(loHealthId)?loHealthId:ids[0];
  const unit=supplies.find(u=>u.g===selected),effect=unit?kitSupply(unit.g):null;
  const injury=injuryView(), wounded=injury.mode==='active'&&injury.parts.some(p=>p.status==='wounded');
  const targeted=wounded&&effect?.stat==='hp';
  const vitals=[['hp','체력'],['energy','기력'],['water','수분']];
  const low=active?vitals.filter(([v])=>(field[v]??100)<40).map(([,label])=>label+' 부족'):[];
  return '<div class="loadout-ui lo-health">'+loHead('06','건강 상태',active?FIELD_ZONES[raid.zone].name:'B-04 벙커 · 출격 전',active?'<button data-page="raid">현장 복귀</button>':'')+loMsg()+
    injuryHealthPanel()+(!active?injurySummaryMarkup(lastSummary,'최근 출격 부상·치료 기록'):'')+loLayout('health')+'<section class="lo-pane lo-condition">'+loTitle('생존 수치','','med')+'<div class="lo-health-body iw-vitals"><div class="lo-meters">'+
    vitals.map(([v,label])=>{const value=active?field[v]??100:100;return '<div class="lo-meter"><small>'+label+'</small><b>'+value+' <span>/ 100</span></b><progress value="'+value+'" max="100" aria-label="'+label+'"></progress></div>';}).join('')+
    '<div class="lo-status"><small>상태 요약</small><b>'+esc(low.join(' · ')||'수치 안정')+'</b></div></div></div></section>'+loBag(k,active)+
    '<section class="lo-pane lo-meds">'+loTitle('가방 내 소모품',supplies.length+'개')+'<div class="lo-pane-body">'+
    (ids.length?'<div class="lo-med-grid">'+ids.map(id=>'<button data-loadout="medical" data-id="'+id+'" aria-pressed="'+(id===selected)+'">'+itemArt(id)+'<b>'+esc(kitName(id))+'</b><small>×'+supplies.filter(o=>o.g===id).length+'</small></button>').join('')+'</div>':'<p>가방에 의료품·음료·식량이 없습니다.</p><button data-page="'+(active?'raid':'inventory')+'">'+(active?'현장 수색':'보급품 준비')+'</button>')+
    (unit?'<div class="lo-med-detail"><b>'+esc(kitName(selected))+'</b><p>'+effect.label+' +'+effect.gain+' · 사용 시 1개 소모</p>'+gearButton('consume',targeted?'치료할 부위 선택':'사용',{unit:unit.uid},!active||Boolean(field.action)||(!targeted&&(field[effect.stat]??100)>=100))+loBindButton(selected)+'</div>':'')+'</div></section></div>'+loQuickbar(k)+'</div>';
}
function loUseQuick(i,keyboard=false){
  const kit=currentKit(),bindings=loBindings(),id=bindings[i];
  if(!keyboard&&loClearBind){bindings[i]=null;loClearBind=false;gearNotice='빠른 사용 지정을 해제했습니다.';persist();renderKeep();return;}
  if(!keyboard&&loAssign&&kit.bag.some(o=>o.g===loAssign)){
    bindings[i]=loAssign;gearNotice=((i+1)%10)+'번에 '+kitName(loAssign)+' 지정.';loAssign=null;persist();renderKeep();return;
  }
  if(!id){if(!keyboard){gearNotice='가방에서 소모품을 선택하고 빠른 사용 지정을 누르세요.';renderKeep();}return;}
  const unit=kit.bag.find(u=>u.g===id);
  if(!unit){gearNotice=kitName(id)+'이 가방에 없습니다.';renderKeep();return;}
  if(!raid){
    if(keyboard)return;
    gearPick={uid:unit.uid,rot:false};loHealthId=id;
    gearNotice=kitName(id)+' 선택 · 출격 후 빠른 사용 가능.';renderKeep();return;
  }
  handleEquipment({gear:'consume',unit:unit.uid});
}
function handleLoadoutUI(d){
  if(d.loadout==='mobile-tab'&&Object.hasOwn(LO_MOBILE,d.screen)&&['0','1','2'].includes(d.index)){loMobilePanel[d.screen]=Number(d.index);}
  else if(d.loadout==='shop'){loShopOpen=!loShopOpen;}
  else if(d.loadout==='slot'){loSlot=loSlot===d.slot?null:d.slot;}
  else if(d.loadout==='filter'&&Object.hasOwn(LO_GROUPS,d.id)){loFilter=d.id;stashSelection=null;}
  else if(d.loadout==='medical'){loHealthId=d.id;}
  else if(d.loadout==='assign'&&kitSupply(d.id)&&currentKit().bag.some(u=>u.g===d.id)){
    loAssign=d.id;loClearBind=false;gearNotice=kitName(d.id)+'을 지정할 빠른 사용 칸을 선택하세요.';
  }else if(d.loadout==='unbind'){loClearBind=!loClearBind;loAssign=null;}
  else if(d.loadout==='assign-cancel'){loAssign=null;gearNotice='';}
  else if(d.loadout==='quick'){
    const i=Number(d.index);
    if(Number.isInteger(i)&&i>=0&&i<10&&(!raid||!field.result))loUseQuick(i);
    return;
  }else if(d.loadout==='sort'&&!raid){
    const original=stashSlots.slice(),packed=kitArrange(original.map(o=>({...o,x:0,y:0})),stashSize());
    if(packed.left.length){stashNotice='현재 배치를 유지했습니다. 큰 물품을 모두 정렬할 여유 공간이 없습니다.';}
    else{stashSlots=packed.placed;refreshStashLayout();stashSelection=null;stashNotice='물품을 크기순으로 정리했습니다.';persist();}
  }else return;
  renderKeep();
  if(d.loadout==='assign')document.querySelector('.lo-quick')?.scrollIntoView({block:'nearest'});
}
document.addEventListener('keydown',event=>{
  if(!writer||busy||view!=='inside'||!$('#lock')?.hidden||!raid||field.result||event.repeat||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog'))return;
  if(!/^[0-9]$/.test(event.key))return;
  const i=(Number(event.key)+9)%10;
  if(!loBindings()[i])return;
  event.preventDefault();reconcile();if(!field.result)loUseQuick(i,true);
});
// Touch and mouse transfers commit quantity and position together.
function moveStashToBagCell(x,y){
  if(raid)return false;
  const unit=selectedStashUnit();if(!unit)return false;
  if(kitBunkerOnly(unit.g)){gearNotice='보관함은 벙커 안에서만 사용할 수 있습니다.';return false;}
  const rot=stashSelection.rot,w=rot?unit.h:unit.w,h=rot?unit.w:unit.h;
  if(!fits(equipmentState.bag,kitCapacity(equipmentState.worn),x,y,w,h)){
    gearNotice='이 위치에 들어가지 않습니다. 빈 칸을 선택하세요.';return false;
  }
  const physical=gearStashChoice(unit.g,unit.uid);
  if(!takeStashGoods(unit.g,1,unit.uid))return false;
  equipmentState.bag.push({...gearUnitFor(unit.g,physical),...(unit.g==='rl_bp_dressing'?{uid:unit.uid}:{}),x,y,w,h});stashSelection=null;gearPick=null;stashNotice='';
  gearNotice=kitName(unit.g)+' · 가방에 넣었습니다.';return true;
}
function moveBagToStashCell(x,y){
  if(raid)return false;
  const bag=equipmentState.bag,index=bag.findIndex(o=>o.uid===gearPick?.uid);
  if(bag[index]?.g==='cr_notes')return cashAction(bag[index].uid,'stash',undefined,x,y).ok;
  if(index<0)return false;
  const unit=bag[index],rot=gearPick.rot,w=rot?unit.h:unit.w,h=rot?unit.w:unit.h;
  if(!fits(stashSlots,stashSize(),x,y,w,h)){
    gearNotice='선택한 창고 위치에 여유 공간이 없습니다.';return false;
  }
  const next=stashCount(unit.g)+1;if(!Number.isSafeInteger(next))return false;
  stash[unit.g]=next;stashSlots.push({uid:unit.g==='rl_bp_dressing'?unit.uid:newStashUid(),g:unit.g,x,y,w,h,...(unit.gear?{gear:unit.gear}:{})});
  bag.splice(index,1);gearPick=null;stashSelection=null;stashNotice='';gearNotice=kitName(unit.g)+' · 창고에 보관했습니다.';return true;
}
inside.addEventListener('dragover',e=>{
  if(raid)return;
  if(stashDrag&&e.target.closest('[data-kit-grid]')||kitDragged&&e.target.closest('[data-stash-grid]'))e.preventDefault();
});
inside.addEventListener('drop',e=>{
  if(raid)return;
  const toBag=stashDrag&&e.target.closest('[data-kit-grid]'),toDepot=kitDragged&&e.target.closest('[data-stash-grid]');
  const grid=toBag||toDepot;if(!grid)return;
  e.preventDefault();const rect=grid.getBoundingClientRect(),size=toBag?kitCapacity(equipmentState.worn):stashSize();
  const x=Math.floor((e.clientX-rect.left-grid.clientLeft)*size[0]/grid.clientWidth),y=Math.floor((e.clientY-rect.top-grid.clientTop)*size[1]/grid.clientHeight);
  if(toBag){
    stashSelection={id:stashDrag.id,uid:stashDrag.uid,rot:stashDrag.rot};
    moveStashToBagCell(x-stashDrag.offsetX,y-stashDrag.offsetY);stashDrag=null;
  }else{
    gearPick={uid:kitDragged,rot:gearPick?.uid===kitDragged&&gearPick.rot};moveBagToStashCell(x,y);kitDragged=null;
  }
  saveInventoryMove();renderKeep();
});

// The field panels are replaced when a search advances or a placement changes.
// Read the focused control before the replacement and restore it only for keyboard input.
function captureFieldLootFocus(){
  const control=document.activeElement;
  if(page!=='raid'||!control?.matches?.(':focus-visible'))return null;
  const screen=control.closest('[data-field-box]');
  if(!screen&&!control.matches('[data-field="open"]'))return null;
  return {button:{...control.dataset},box:screen?.dataset.fieldBox,selection:screen?.querySelector('.loot-tile.chosen')?.dataset.pick};
}
function focusFieldControl(...selectors){
  for(const selector of selectors){
    if(!selector)continue;
    const node=Array.from(document.querySelectorAll(selector)).find(el=>!el.disabled&&el.getClientRects().length);
    if(!node)continue;
    node.focus({preventScroll:true});node.scrollIntoView({block:'nearest',inline:'nearest'});
    return node;
  }
  return null;
}
function restoreFieldLootFocus(previous){
  if(!previous||page!=='raid'||!isActive()||field.contact||field.journey)return;
  const d=previous.button,close='[data-field="close"]',search='.lo-search:not(:disabled)',loot='[data-side="loot"][data-pick]';
  if(!openBox()){
    if(d.field==='close'&&previous.box)focusFieldControl('[data-field="open"][data-index="'+previous.box.split('-')[1]+'"]');
    return;
  }
  if(d.field==='open'){
    focusFieldControl(search,loot,close);return;
  }
  if(previous.box!==field.open)return;
  if(d.field==='search'||d.fieldSearchStatus!==undefined){
    if(field.action?.type==='search'){
      const status=focusFieldControl('[data-field-search-status]');
      if(status&&d.tileX!==undefined){status.dataset.tileX=d.tileX;status.dataset.tileY=d.tileY;}
    }else{
      const found=d.tileX!==undefined?loot+'[data-tile-x="'+d.tileX+'"][data-tile-y="'+d.tileY+'"]':null;
      focusFieldControl(found,loot,search,close);
    }
    return;
  }
  if(d.loadout==='mobile-tab'){
    focusFieldControl('[data-screen="loot"][data-index="'+d.index+'"]');return;
  }
  if(d.cell==='bag'){
    const cell='button[data-cell="bag"][data-x="'+d.x+'"][data-y="'+d.y+'"]';
    const moved=field.bag.find(u=>u.x===Number(d.x)&&u.y===Number(d.y));
    focusFieldControl(picked?cell:null,moved?'[data-side="bag"][data-pick="'+CSS.escape(moved.uid)+'"]':null,loot,close);return;
  }
  if(d.pick){
    const tile='[data-side="'+d.side+'"][data-pick="'+CSS.escape(d.pick)+'"]';
    focusFieldControl(picked?.uid===d.pick?'[data-field="rotate"]':null,tile,loot,close);return;
  }
  if(d.field==='take'){
    focusFieldControl(picked?'[data-field="take"]':null,loot,search,close);return;
  }
  if(['rotate','unselect','place'].includes(d.field)){
    const prior=previous.selection?'[data-pick="'+CSS.escape(previous.selection)+'"]':null;
    focusFieldControl(picked?'[data-field="'+d.field+'"]':null,prior,loot,search,close);
  }
}

function startFieldPlacement(){
  const unit=selectedItem();
  if(page!=='raid'||!openBox()||!unit||!isActive()||field.contact)return;
  picked.placing=true;
  loMobilePanel.loot=1;
  renderKeep();
  const pos=picked.side==='bag'?unit:transferPlacement(unit,true,picked.rot).pos;
  const cell=focusFieldControl('button[data-cell="bag"][data-x="'+(pos?.x??0)+'"][data-y="'+(pos?.y??0)+'"]');
  if(cell)cell.setAttribute('aria-describedby','field-placement-help');
}
inside.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||page!=='raid'||!field?.open||!picked)return;
  const offset={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  const cell=event.target.closest?.('button[data-cell="bag"]');
  if(!offset||!cell)return;
  event.preventDefault();
  const [cols,rows]=raidBagSize();
  const x=Math.min(cols-1,Math.max(0,Number(cell.dataset.x)+offset[0]));
  const y=Math.min(rows-1,Math.max(0,Number(cell.dataset.y)+offset[1]));
  focusFieldControl('button[data-cell="bag"][data-x="'+x+'"][data-y="'+y+'"]');
});
