import {locationReliability,compareSaleOptions,rankFarmingRoutes,diagnose,usableExits} from './r17-core.mjs';
import {classifyLocationFloor} from './floor-core.mjs';
import {planRaid,normalizeHideout,materialsCost} from './ops-core.mjs';
import {compareAmmo,compareArmor} from './field-kit-core.mjs';

const esc = v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = n=>Number.isFinite(n)?Math.round(n).toLocaleString('ko-KR'):'미확인';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const money=n=>finite(n)?fmt(n)+' ₽':'가격 미확인';
function safeNow(){return Date.now();}
function observedPosition(ctx){
 const p=ctx.getPlayer();
 if(!p||p.mapKey!==ctx.getMap().key||!finite(p.x)||!finite(p.z))return null;
 return p;
}
function playerReliability(ctx){
 const p=observedPosition(ctx);
 if(!p)return {usable:false,confidence:0,reason:'missing-position'};
 const stamp=Date.parse(p.receivedAt||'');
 // Screenshot filenames have exact coordinates, not a measured GPS error.
 // A conservative placeholder margin is visibly labeled "not measured".
 const age=finite(stamp)?Math.max(0,safeNow()-stamp):Infinity;
 const result=locationReliability({position:p,sourceConfidence:0.98,ageMs:age,accuracyMeters:5});
 return {...result,estimated:true,observedAgeMs:age};
}
const blocks=(title,body)=>'<section class="r17-section"><h3>'+esc(title)+'</h3>'+body+'</section>';
const note=t=>'<p class="r17-note">'+esc(t)+'</p>';
const entry=(a,b)=>'<div class="r17-item"><strong>'+esc(a)+'</strong><span>'+esc(b)+'</span></div>';
export function initializeR17(ctx){
 const dialog=document.createElement('dialog');
 dialog.id='r17-dialog';dialog.className='r17-dialog';
 dialog.innerHTML='<div class="r17-head"><div><small>TACTICAL FIELD UTILITIES / R17</small><h2>r17 작전 센터</h2></div><button type="button" id="r17-close" class="btn">닫기 ×</button></div><div class="r17-tabs" role="tablist">'+[
 ['tracking','위치·층'],['routes','탈출·퀘스트'],['economy','가격·장비'],['hideout','은신처'],['farming','파밍·위험'],['diagnostics','진단·오프라인']].map(([key,name])=>'<button type="button" data-r17-tab="'+key+'" role="tab">'+name+'</button>').join('')+'</div><div id="r17-content" class="r17-content" aria-live="polite"></div>';
 document.body.append(dialog);
 const trigger=document.createElement('button');
 trigger.type='button';trigger.id='open-r17';trigger.className='quest-capture-button';trigger.textContent='◎ r17 작전 센터';
 (document.querySelector('.tactical-tools-panel')||document.querySelector('.topbar-tools')||document.body).append(trigger);
 const style=document.createElement('style');
 style.textContent=`.r17-dialog{background:#161d1a;color:#e6e9dc;border:1px solid #53614b;border-radius:12px;max-width:min(960px,96vw);width:960px;max-height:90vh;padding:0;box-shadow:0 24px 70px #000b}.r17-dialog::backdrop{background:#000a}.r17-head{padding:17px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #405143}.r17-head small{font-size:10px;color:#92a28d;letter-spacing:.15em}.r17-head h2{margin:5px 0 0;font-size:22px}.r17-tabs{display:flex;gap:5px;flex-wrap:wrap;padding:11px 16px;background:#202923}.r17-tabs button{color:#c8d1c2;background:#28332c;border:1px solid #455445;border-radius:6px;padding:9px 11px;cursor:pointer}.r17-tabs button[aria-selected=true]{color:#fff;background:#455c3a;border-color:#99a86b}.r17-content{overflow:auto;max-height:65vh;padding:16px 20px 22px;display:grid;gap:12px}.r17-section{background:#1f2823;border:1px solid #3f4c42;border-radius:8px;padding:13px 15px}.r17-section h3{font-size:16px;margin:0 0 12px;color:#d7e6c4}.r17-note{color:#b0bdb1;font-size:13px;line-height:1.6;margin:8px 0}.r17-item{display:flex;gap:16px;justify-content:space-between;border-bottom:1px solid #374339;padding:7px 0;font-size:13px}.r17-item span{color:#b6c5b2;text-align:right}.r17-inline{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.r17-inline input,.r17-inline select{background:#111a16;color:#f2f4e8;border:1px solid #69765b;border-radius:5px;padding:8px;min-width:110px;max-width:200px}.r17-inline button{padding:8px 13px;background:#485e3d;color:#fff;border:0;border-radius:5px;cursor:pointer}.r17-warning{color:#f0c47d}.r17-status{padding:8px;background:#2b3a2f;border-radius:6px;font-size:13px}.r17-dialog a{color:#bdd49b}.r17-detail{font-size:13px;margin:10px 0;line-height:1.6}`;
 document.head.append(style);
 let tab='tracking',routeData=null;
 let routes=[];
 fetch('./recommended-routes.json').then(r=>r.ok?r.json():null).then(d=>{routes=d?.routes||[];if(dialog.open&&tab==='farming')render();}).catch(()=>{});
 const renderTracking=()=>{
  const p=observedPosition(ctx),fix=playerReliability(ctx),floor=p?classifyLocationFloor(p,ctx.getConfig()||{}):null;
  return blocks('마지막 촬영 위치 신뢰도',entry('맵',ctx.getMap().name)+entry('좌표',p?'X '+p.x.toFixed(2)+' / Y '+p.y.toFixed(2)+' / Z '+p.z.toFixed(2):'새 원본 스크린샷 필요')+
    entry('신뢰도 표시',fix.usable?'좌표 파싱 정상 · 촬영 후 '+Math.round(fix.observedAgeMs/1000)+'초':'사용 불가 · '+fix.reason)+
    entry('위치 오차','측정된 오차 범위 없음 (5m 가정값은 내부 유효성 검사 전용)')+
    note('좌표가 있는 원본 스크린샷 파일명에서만 위치를 읽습니다. 오래된 사진, 중복 사진 또는 범위 밖 좌표는 현재 위치로 확정하지 않습니다.'))+
    blocks('자동 맵·층수',entry('로그 자동 전환',ctx.getAutoMap()?'사용':'중지')+
    entry('층수 판별',!floor?'현재 위치 없음':floor.known&&!floor.ambiguous?floor.labels.join(', '):'불확실 · '+floor.reason)+
    note('맵은 기존 읽기 전용 게임 로그 감시를 사용합니다. 스크린샷의 XYZ는 층수 판단에 활용하지만 장면 이미지의 시각 인식은 아직 지원하지 않습니다.')+
    '<div class="r17-inline"><button data-r17-action="open-map">지도 및 로그 설정 보기</button></div>');
 };
 const renderRoutes=()=>{
  const p=observedPosition(ctx),exits=ctx.getExits().filter(e=>e.canPin&&e.position);
  const uncertain=usableExits(exits.map(e=>({...e,active:false,verified:false}))).length;
  const nearby=p?exits.map(e=>({...e,meters:Math.hypot(e.position.x-p.x,e.position.z-p.z)})).sort((a,b)=>a.meters-b.meters).slice(0,8):[];
  const points=ctx.getPoints(),itinerary=planRaid({points,start:p});
  return blocks('탈출구 후보 · 실제 이용 가능 여부 확인 필요',entry('지도에 등록된 탈출구',exits.length+'개')+
    (nearby.length?nearby.map(e=>entry(e.name,fmt(e.meters)+'m 직선거리 · 조건 미확인')).join(''):note('마지막 촬영 위치를 확인해야 거리순 목록을 볼 수 있습니다.'))+
    note('게임 레이드의 활성 탈출구 목록을 자동으로 알 수 없어 경로를 안전하다고 확정하지 않습니다. 도로·문·고저차를 반영한 통행 그래프가 없는 곳에서는 자동 최단 경로를 제공하지 않습니다.'))+
    blocks('핀 지정 퀘스트 동선 최적화',entry('현재 맵 목표',points.length+'개')+
    entry('직선거리 기준 방문 순서',itinerary.steps.length+'개')+
    (itinerary.steps.length?'<ol class="r17-detail">'+itinerary.steps.slice(0,25).map(s=>'<li>'+esc(s.taskName||s.name||'퀘스트 목표')+'</li>').join('')+'</ol>':note('퀘스트를 선택하고 지도에 목표 핀을 표시해 주세요.'))+
    note('이 경로는 가장 가까운 점을 차례로 찾는 휴리스틱이며 실제 최단 이동 시간, 전투 위험, 층간 이동을 보장하지 않습니다.')+
    '<div class="r17-inline"><button data-r17-action="open-ops">기존 작전 도구에서 지도 경로 표시</button></div>');
 };
 const renderEconomy=()=>{
  const items=ctx.getCatalog()?.items||[],ammo=compareAmmo(items).slice(0,6),armor=compareArmor(items).slice(0,6);
  const sales=items.filter(i=>finite(i.bestTraderSell?.priceRUB)&&finite(i.flea?.currentPrice)).slice(0,6);
  return blocks('아이템 판매가 · 플리 수수료를 확인해야 비교 가능',note('상인 매입 가격과 플리 가격을 표시합니다. 개별 아이템 실제 수수료 정보가 없으면 최적 판매처를 확정하지 않습니다.')+
   (sales.length?sales.map(i=>{const r=compareSaleOptions({traderPrice:i.bestTraderSell.priceRUB,fleaPrice:i.flea.currentPrice});return entry(i.name,'상인 '+money(r.traderNet)+' / 플리 '+money(i.flea.currentPrice)+' (수수료 미확인)');}).join(''):note('시세 데이터가 아직 로드되지 않았습니다.'))+
   '<div class="r17-inline"><label>상인 판매가 <input id="r17-trader" type="number" min="0" value="10000"></label><label>플리 판매가 <input id="r17-flea" type="number" min="0" value="13000"></label><label>실제 플리 수수료 <input id="r17-fee" type="number" min="0" value="1000"></label><button data-r17-action="compare-price">순수익 비교</button></div><p id="r17-sale-result" class="r17-status">값을 입력한 뒤 비교하세요.</p>')+
   blocks('탄약·방어구 비교',note('원본 아이템 통계를 정렬합니다. 관통·피해량은 탄종 선택 참고값이며 실제 명중 피해를 예측하지 않습니다.')+
   '<h4>관통력 상위 탄약</h4>'+(ammo.length?ammo.map(i=>entry(i.name,'관통 '+fmt(i.stats.ammo.penetration)+' / 피해 '+fmt(i.stats.ammo.damage))).join(''):note('탄약 스탯 미수신'))+
   '<h4>등급 상위 방어구</h4>'+(armor.length?armor.map(i=>entry(i.name,'등급 '+fmt(i.stats.armor.class))).join(''):note('방어구 스탯 미수신')));
 };
 const renderHideout=()=>blocks('은신처 업그레이드 계산',note('기존 작전 도구의 은신처 탭에서 현재 보유 수량을 입력하면 부족 수량과 확인된 재료비가 계산됩니다. 알려지지 않은 가격은 0원으로 간주하지 않습니다.')+
 '<div class="r17-inline"><button data-r17-action="open-hideout">은신처 계산기 열기</button></div>');
 const renderFarming=()=>{
   const available=routes.filter(r=>r.map===ctx.getMap().key);
   // Source routes have qualitative risk and no measured loot value/time: do not fabricate returns.
   return blocks('맵별 파밍 동선 · 검증된 수익률 아님',entry('추천 동선 자료',available.length+'개')+
   (available.length?available.map(r=>entry(r.name,'위험 '+(r.risk||'미확인')+' · '+(r.points||[]).length+'곳')).join(''):note('현재 맵의 추천 동선 정보가 없습니다.'))+
   note('수익/분 계산에는 예상 아이템 가치, 플레이 시간, 위험도 실측값이 필요합니다. 이 값이 없어 실제 수익률 순위를 생성하지 않습니다.')+
   '<div class="r17-inline"><button data-r17-action="open-routes">기존 파밍 루트 목록 열기</button></div>')+
   blocks('보스·교전 위험 알림',note('기존 지도 위험 구역과 보스 출현 후보를 표시합니다. 실시간 플레이어 탐지 기능이나 보스 실시간 출현 확인 기능이 아닙니다.')+
   '<div class="r17-inline"><button data-r17-action="open-intel">지도 위험 마커 보기</button></div>');
 };
 const renderDiagnostics=()=>{
   const c=ctx.getCapture(),log=ctx.getLogStatus();
   const report=diagnose({screenshotReadable:c?.ok===true?true:c?.ok===false?false:undefined,
     logPathReadable:log?.connected===true||!!log?.folder, dataAgeMs:ctx.getCatalog()?.fetchedAt?Date.now()-Date.parse(ctx.getCatalog().fetchedAt):null,
     offlineCacheAvailable:!!navigator.serviceWorker?.controller});
   return blocks('자동 진단 · 수동 복구',entry('스크린샷',c?.ok===true?'파싱 성공':c?.ok===false?'파싱 실패':'입력 대기')+
   entry('게임 로그',log?.folder?'폴더 등록됨':'폴더 상태 미확인')+
   entry('오프라인 앱 셸',navigator.serviceWorker?.controller?'서비스 워커 활성':'아직 활성화되지 않음')+
   (report.issues.length?report.issues.map(e=>entry(e.code,e.action)).join(''):note('입력된 정보 기준 추가 문제 없음'))+
   note('자동으로 게임 파일을 고치지 않습니다. 캐시 초기화는 오프라인 데이터가 사라질 수 있으므로 명시적으로 선택해야 합니다.')+
   '<div class="r17-inline"><button data-r17-action="retry-data">데이터 다시 불러오기</button><button data-r17-action="check-cache">캐시 상태 확인</button><button data-r17-action="download-diagnostics">진단 JSON 내보내기</button></div><p id="r17-diagnostics-result" class="r17-status">캐시에는 마지막 방문한 지도만 저장됐을 수 있습니다.</p>');
 };
 function render(){
   dialog.querySelectorAll('[data-r17-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.r17Tab===tab)));
   dialog.querySelector('#r17-content').innerHTML=({tracking:renderTracking,routes:renderRoutes,economy:renderEconomy,hideout:renderHideout,farming:renderFarming,diagnostics:renderDiagnostics}[tab]||renderTracking)();
 }
 trigger.addEventListener('click',()=>{render();dialog.showModal();});
 dialog.querySelector('#r17-close').addEventListener('click',()=>dialog.close());
 dialog.querySelectorAll('[data-r17-tab]').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.r17Tab;render();}));
 dialog.addEventListener('click',ev=>{
  const btn=ev.target.closest('[data-r17-action]');if(!btn)return;
  const act=btn.dataset.r17Action;
  if(act==='compare-price'){
   const n=id=>Number(dialog.querySelector('#'+id)?.value);
   const result=compareSaleOptions({traderPrice:n('r17-trader'),fleaPrice:n('r17-flea'),feeRoubles:n('r17-fee')});
   dialog.querySelector('#r17-sale-result').textContent=result.best?'추천 '+(result.best==='flea'?'플리마켓':'상인')+' · 상인 '+money(result.traderNet)+' / 플리 순수익 '+money(result.fleaNet):'가격과 수수료 입력을 확인하세요';
   return;
  }
  if(act==='retry-data'){dialog.close();ctx.refreshData();return;}
  if(act==='check-cache'){
   const out=dialog.querySelector('#r17-diagnostics-result');
   if(!('caches' in window)){out.textContent='Cache API를 지원하지 않는 환경입니다.';return;}
   caches.keys().then(keys=>{out.textContent=keys.length?'등록된 캐시: '+keys.join(', '):'저장된 캐시 없음';}).catch(e=>{out.textContent='캐시 확인 실패: '+e.message;});
   return;
  }
  if(act==='download-diagnostics'){
   const detail={product:'tarkov-field-guide',version:'r17-development',at:new Date().toISOString(),map:ctx.getMap().key,capture:ctx.getCapture()?.ok===true?'ok':ctx.getCapture()?.ok===false?'error':'unknown',offlineWorker:!!navigator.serviceWorker?.controller};
   const url=URL.createObjectURL(new Blob([JSON.stringify(detail,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='tfg-r17-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  dialog.close();
  if(act==='open-ops'||act==='open-hideout')ctx.openOperations(act==='open-hideout'?'hideout':'raid');
  else if(act==='open-map')ctx.showMap();
  else if(act==='open-routes')document.getElementById('open-recommended-routes')?.click();
  else if(act==='open-intel')document.getElementById('open-intel-list')?.click();
 });
 return {open:()=>{render();dialog.showModal();},refresh:()=>{if(dialog.open)render();}};
}
