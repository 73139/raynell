// Shared command terminal. The region, wallet and carried space are read directly from the session.
const artCache=new Map();
function artURL(key){
  const data=UI_ART[key];
  if(!data)return '';
  if(typeof atob!=='function'||typeof URL.createObjectURL!=='function')return data;
  if(!artCache.has(key)){
    const bytes=Uint8Array.from(atob(data.slice(data.indexOf(',')+1)),c=>c.charCodeAt(0));
    artCache.set(key,URL.createObjectURL(new Blob([bytes],{type:'image/webp'})));
  }
  return artCache.get(key);
}
function itemArt(id,cls=''){
  const url=artURL(id==='cr_notes'?'item-cr':artKeyForItem(id));
  return url?'<img class="item-art '+esc(cls)+'" draggable="false" alt="" src="'+url+'">':ico(GOODS[id]?.[4]||'crate',cls);
}
const menuIcons={
  home:'<path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z"/>',
  sortie:'<path d="m12 3 9 17-9-5-9 5Z"/>',
  inventory:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18"/>',
  health:'<path d="M1 13h5l4-9 3 16 4-10 2 3h4"/>',
  journal:'<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
  bunker:'<path d="m2 10 10-7 10 7v10H2zM9 20v-7h6v7"/>',
  trade:'<path d="M3 10h18l-2-6H5l-2 6zm1 0v10h16V10M8 20v-6h5v6"/><path d="M3 10c1 3 4 3 5 0 1 3 4 3 5 0 1 3 4 3 5 0 1 2 2 2 3 0"/>',
  traderQuests:'<path d="M5 4h4l1-2h4l1 2h4v17H5zM8 10l2 2 4-5m-5 9h7"/>',
  more:'<circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="20" cy="12" r="1.8"/>'
};
function menuIcon(key){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+menuIcons[key]+'</svg>'}
function shellGroup(){
  if(page==='survivors')return 'journal';
  if(['prep','raid','map','lootplan','barterhunt'].includes(page))return 'sortie';
  if(page==='facility'||page==='campaign')return 'bunker';
  if(page==='stash'||page==='presets'||page==='maintenance')return 'inventory';
  if(['orders','settings','catalog','messages'].includes(page))return 'more';
  return page;
}
function shellNavRender(){
  const sortieTarget=raid?'raid':'map',active=shellGroup();
  const items=[['home','home','메인'],['sortie',sortieTarget,'출격'],['inventory','inventory','장비'],['health','health','건강'],['journal','journal','기록'],['bunker','bunker','벙커'],['trade','trade','상점'],['traderQuests','traderQuests','퀘스트'],['more','more','더보기']];
  const button=([group,target,text])=>'<button data-page="'+target+'"'+(active===group?' aria-current="page"':'')+'>'+menuIcon(group)+'<span>'+text+'</span></button>';
  $('.top-tabs').innerHTML=items.slice(1,-1).map(button).join('');
  $('.nav').innerHTML=items.map(button).join('');
  $('#shell-wallet').textContent='CR '+wallet.toLocaleString('ko-KR');
  const kit=raid&&!field.result?field:equipmentState,size=kitCapacity(kit.worn||{});
  $('#shell-pack').textContent='가방 '+kit.bag.reduce((n,o)=>n+o.w*o.h,0)+' / '+size[0]*size[1];
}
function navigatePage(target){
  if(!pages.includes(target))return;
  if(target==='maintenance'&&page!=='maintenance')resetMaintenanceUI();
  if(target==='presets'&&page!=='presets')resetPresetUI();
  if(target==='campaign'&&page!=='campaign')campaignFeedback=null;
  if(target==='lootplan'&&page!=='lootplan'){lootPlanRegion=page==='map'?commandZoneSelection():raid?raid.zone:zone;lootPlanFeedback=''}
  page=target;picked=null;notice='';save();render();
  $('.content').focus({preventScroll:true});
}
function shellSettings(){
  return head('RL-TC01','단말 설정','')+'<section class="panel shell-config">'+
  '<div class="setting"><b>글자 크기</b><button data-setting="large" aria-pressed="'+large+'">'+(large?'크게':'표준')+'</button></div>'+
  '<div class="setting"><b>화면 전환 효과 줄이기</b><button data-setting="reduce" aria-pressed="'+reduce+'">'+(reduce?'켜짐':'꺼짐')+'</button></div></section>'+backupPanel()+
  '<div class="shell-actions"><button data-action="return">스마트폰 화면</button><button data-action="lock">단말 잠금</button><button data-action="shutdown">전원 종료</button></div>';
}
const shortcuts=[['maintenance','장비 정비','실물 장비 · 수리 · 탄약 보충'],['lootplan','물자 수색 계획','목표 물자 · 잠긴 보관함'],['survivors','생존자 관측 수첩','현장 흔적 · 만남 기록'],['traderQuests','상인 퀘스트','상인 의뢰 · 우호도'],['journal','대원 기록','출격 · 귀환 기록'],['orders','벙커 의뢰','목표 확인 · 수락'],['stash','벙커 창고','격자 배치 · 판매'],['trade','벙커 상점','상인별 구매 · 전리품 판매'],['catalog','물품 도감','루팅 출처 · 시설 사용처'],['messages','수신 기록','의뢰와 현장 보고'],['settings','단말 설정','화면 · 백업 · 전원']];
function shellLinks(){return head('B-04','단말 메뉴','')+'<div class="shortcut-grid">'+shortcuts.map(([p,title,desc])=>'<button data-page="'+p+'"><b>'+title+'</b><small>'+desc+'</small><span aria-hidden="true">›</span></button>').join('')+'</div>'}
function shellMessages(){
  const order=ORDERS.find(q=>q.id===career.order), logs=raid?field.log:[],last=career.history[0];
  return head('B-04','수신 기록','')+'<section class="panel"><h2>벙커 관제실</h2><p>'+(order?'진행 중인 의뢰 · '+esc(order.title):'현재 수락한 의뢰가 없습니다.')+'</p><button data-page="orders">의뢰 확인</button></section>'+
    (logs.length?'<section class="panel"><h2>이번 출격</h2>'+logs.slice(0,12).map(l=>'<p>'+esc(l)+'</p>').join('')+'</section>':'')+
    '<section class="panel"><h2>최근 귀환 보고</h2><p>'+(last?esc(ENDINGS[last.rating][1])+' · '+formatRaid(last.elapsed)+' · '+Number(last.xp)+' XP':'첫 출격을 마치면 결과를 수신합니다.')+'</p><button data-page="journal">대원 기록 열기</button></section>';
}
const screenViews={maintenance:maintenancePage,home:commandHome,map:sectorMapPage,lootplan:lootPlanPage,barterhunt:barterHuntPage,prep:prepView,presets:presetsView,raid:raidPage,inventory:gearView,health:healthView,journal:recordsView,survivors:survivorJournalPage,orders:ordersView,bunker:bunkerOverviewView,campaign:campaignPage,facility:bunkerDetailView,stash:stashPage,catalog:catalogPage,settings:shellSettings,trade:marketView,traderQuests:traderQuestsView,messages:shellMessages,more:shellLinks};
