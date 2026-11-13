import {normalizeHideout,normalizeRecipes,materialsCost,evaluateRecipe,planRaid,profitEstimate,priceAlerts,priceOf} from './ops-core.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n===null||n===undefined||!Number.isFinite(n)?'가격 미확인':Math.round(n).toLocaleString('ko-KR')+' ₽';
const API='https://json.tarkov.dev';
const store=(key,fallback)=>{try{const x=JSON.parse(localStorage.getItem(key)||'null');return x&&typeof x==='object'&&!Array.isArray(x)?x:fallback;}catch{return fallback;}};
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
async function getDocument(mode,endpoint,signal){
 const response=await fetch(`${API}/${mode}/${endpoint}`,{signal,headers:{Accept:'application/json'},credentials:'omit',cache:'no-cache'});
 if(!response.ok)throw new Error(`${endpoint} HTTP ${response.status}`);
 return response.json();
}
export function initializeOperations({getMode,getMap,getPoints,getExits,getPlayer,getCatalog,getQuestItems=()=>new Set(),showRoute,openLoot,refreshMarket,onMarketOpen=()=>{},onMarketClose=()=>{},getLogStatus=()=>null,onLogFolder=()=>{},notify}){
 const dialog=$('ops-dialog');let tab='raid',mode=getMode(),current=null,controller=null,revision=0,loading=false,error='',hideout=[],crafts=[],barters=[];
 let stationId='',stationLevel=0,recipeFilter='barter',recipeQuery='',fee=10,alerts=store('tfg-alerts-r10-'+mode,{}),owned=store('tfg-owned-r10-'+mode,{}),alerted=new Set(),routeExit='none',route=[];
 const content=$('ops-content');
 const catalog=()=>getCatalog();
 const getItem=id=>(catalog()?.items||[]).find(item=>item.id===id);
 const itemName=id=>getItem(id)?.name||getItem(id)?.nameEn||`ID ${id.slice(0,12)}`;
 function switchTab(next){tab=next;document.querySelectorAll('[data-ops-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.opsTab===tab);b.setAttribute('aria-selected',String(b.dataset.opsTab===tab));});render();if(tab!=='raid')void loadEconomy();}
 function open(next='raid'){mode=getMode();alerts=store('tfg-alerts-r10-'+mode,{});owned=store('tfg-owned-r10-'+mode,{});if(!dialog.open)dialog.showModal();onMarketOpen();switchTab(next);}
 function close(){dialog.close();onMarketClose();}
 function currentRoute(){const map=getMap(),exits=getExits();const end=exits.find(e=>e.key===routeExit&&e.position)?.position||null;return planRaid({points:getPoints(),start:getPlayer()?.mapKey===map.key?getPlayer():null,exit:end});}
 function renderRaid(){const map=getMap(),points=getPoints(),exits=getExits().filter(e=>e.canPin&&e.position);
 const itinerary=currentRoute();route=itinerary.steps;
 content.innerHTML=`<div class="ops-panel"><h3>레이드 동선 · ${esc(map.name)}</h3><p class="ops-muted">지도에 표시한 퀘스트 목표 ${points.length}곳의 <b>직선거리 기준 방문 순서</b>를 계산합니다. 실제 도로·지하 통로·잠긴 문·위험 지역은 반영하지 않습니다.</p>
 <div class="ops-bar"><label>마지막 탈출구 <select id="ops-exit"><option value="none">선택 안 함</option>${exits.map(e=>`<option value="${esc(e.key)}" ${routeExit===e.key?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><button class="btn btn-primary" id="ops-route-show">지도에 동선 표시</button><button class="btn" id="ops-route-clear">동선 해제</button></div>
 <p class="ops-muted">계산 가능한 방문 목표: ${itinerary.steps.length}개 · 연결된 구간의 직선거리 합: ${itinerary.totals.knownMeters.toLocaleString()}m</p>
 <ol class="ops-route-list">${itinerary.steps.map(s=>`<li><b>${esc(s.taskName||s.name||'퀘스트 목표')}</b><small>${esc(s.objective||'목표 위치')} · ${s.fromPreviousMeters===null?'시작 위치 미확인':s.fromPreviousMeters+'m'}</small></li>`).join('')||'<li>지도에 표시할 퀘스트를 먼저 선택해 주세요.</li>'}</ol>
 <p class="ops-muted">필요 열쇠·마커·장비는 오른쪽 퀘스트 상세의 준비 조건을 함께 확인해 주세요. 경로는 게임 내 내비게이션이 아닙니다.</p>
 <h3>게임 로그에서 맵 자동 감지</h3><p class="ops-muted">${getLogStatus()?.folder?`연결된 폴더: ${esc(getLogStatus().folder)} · ${esc(getLogStatus().latest?.mapKey||'새 레이드 대기')}`:'로그 폴더가 자동 검색되지 않았거나 로컬 자동 추적기가 실행 중이지 않습니다.'}</p>
 <div class="ops-bar"><input id="ops-log-folder" placeholder="EFT 설치 폴더의 Logs 전체 경로" value="${esc(getLogStatus()?.folder||'')}"><button id="ops-log-connect" class="btn">로그 감시 폴더 연결</button></div>
 <p class="ops-muted">예: C:\Battlestate Games\Escape from Tarkov\Logs · 맵은 새 레이드의 씬 로딩 기록이 생길 때 전환됩니다.</p></div>`;
 $('ops-exit').addEventListener('change',e=>{routeExit=e.target.value;renderRaid();});
 $('ops-route-show').addEventListener('click',()=>{const exit=exits.find(e=>e.key===routeExit);showRoute(itinerary.steps,exit?.position||null);close();notify(`${itinerary.steps.length}개 목표의 직선 경로를 지도에 표시했어요.`);});
 $('ops-route-clear').addEventListener('click',()=>{showRoute([],null);route=[];notify('동선 표시를 해제했어요.');});
 $('ops-log-connect').addEventListener('click',()=>{const folder=$('ops-log-folder').value.trim();if(!folder)return notify('게임 Logs 폴더 전체 경로를 입력해 주세요.');onLogFolder(folder);});
 }
 async function loadEconomy(){if(loading||current===mode&&hideout.length+crafts.length+barters.length)return;
  const seq=++revision;controller?.abort();controller=new AbortController();loading=true;error='';render();
  try{const names=['hideout','crafts','barters'];const settled=await Promise.allSettled(names.map(n=>getDocument(mode,n,controller.signal)));
   if(seq!==revision)return;
   const [h,c,b]=settled;hideout=h.status==='fulfilled'?normalizeHideout(h.value):[];
   crafts=c.status==='fulfilled'?normalizeRecipes(c.value,'craft'):[];barters=b.status==='fulfilled'?normalizeRecipes(b.value,'barter'):[];
   const missing=settled.flatMap((r,i)=>r.status==='rejected'?[names[i]+': '+(r.reason?.message||'연결 오류')]:[]);
   error=missing.join(' / ');current=mode;
  }finally{if(seq===revision){loading=false;render();}}
 }
 function requirementsTable(required){const rows=materialsCost(required,catalog(),owned);return `<div class="ops-price-summary">알려진 부족 재료 비용: <strong>${money(rows.knownTotal)}</strong>${rows.unknown?' · 가격 없는 항목 '+rows.unknown+'개 (합계 제외)':''}</div><table class="ops-table"><thead><tr><th>아이템</th><th>필요</th><th>보유</th><th>부족</th><th>예상 비용</th></tr></thead><tbody>${rows.rows.map(r=>`<tr><td>${esc(r.item?.name||itemName(r.itemId))}${getQuestItems().has(r.itemId)?'<small class="ops-quest-warning"> · 미완료 퀘스트 필요 아이템</small>':''}</td><td>${r.quantity}</td><td><input type="number" min="0" max="99999" data-owned="${esc(r.itemId)}" value="${Math.max(0,Number(owned[r.itemId])||0)}"></td><td>${r.missing}</td><td>${r.missing?money(r.cost):'0 ₽'}</td></tr>`).join('')}</tbody></table>`;}
 function renderHideout(){
 const selected=hideout.find(s=>s.id===stationId)||hideout[0];if(selected&&!stationId)stationId=selected.id;
 const level=selected?.levels.find(l=>l.level===stationLevel)||selected?.levels[0];if(level)stationLevel=level.level;
 content.innerHTML=`<div class="ops-panel"><h3>은신처 업그레이드 계산</h3><p class="ops-muted">보유량은 이 브라우저에 직접 저장하며 게임 창고를 자동으로 읽지 않습니다. 가격이 없는 항목은 합계에서 제외해요.</p>
 ${error?`<p class="ops-error">${esc(error)}</p>`:''}${loading?'<p>시설 데이터 불러오는 중…</p>':''}
 <div class="ops-bar"><label>시설 <select id="ops-station">${hideout.map(s=>`<option value="${esc(s.id)}" ${selected?.id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>목표 레벨 <select id="ops-level">${(selected?.levels||[]).map(l=>`<option value="${l.level}" ${stationLevel===l.level?'selected':''}>레벨 ${l.level}</option>`).join('')}</select></label><button id="ops-reload" class="btn">데이터 다시 받기</button></div>
 ${level?requirementsTable(level.required):'<p class="ops-muted">시설 정보가 없어요. 데이터를 다시 받아주세요.</p>'}
 ${level?.traderRequirements?.length||level?.stationRequirements?.length||level?.skillRequirements?.length?'<p class="ops-muted">주의: 이 업그레이드에는 추가 상인·시설·스킬 조건도 있을 수 있어요. 비용은 재료만 계산했습니다.</p>':''}</div>`;
 $('ops-station').addEventListener('change',e=>{stationId=e.target.value;stationLevel=0;renderHideout();});$('ops-level').addEventListener('change',e=>{stationLevel=Number(e.target.value);renderHideout();});
 $('ops-reload').addEventListener('click',()=>{current=null;void loadEconomy();});
 content.querySelectorAll('[data-owned]').forEach(el=>el.addEventListener('change',()=>{owned[el.dataset.owned]=Math.max(0,Math.floor(Number(el.value)||0));save('tfg-owned-r10-'+mode,owned);renderHideout();}));
 }
 function renderRecipes(){const source=recipeFilter==='craft'?crafts:barters;const q=recipeQuery.trim().toLowerCase();
 const priced=source.map(recipe=>evaluateRecipe(recipe,catalog())).filter(r=>!q||r.reward.some(x=>itemName(x.itemId).toLowerCase().includes(q))||r.required.some(x=>itemName(x.itemId).toLowerCase().includes(q))||r.traderName.toLowerCase().includes(q));
 priced.sort((a,b)=>(b.net??-Infinity)-(a.net??-Infinity));
 content.innerHTML=`<div class="ops-panel"><h3>물물교환 · 제작 수익 비교</h3><p class="ops-muted">공개 데이터의 재료 비용과 보상 가격 비교. <b>수수료·판매 제한·거래 가능 수량·상인 충성도</b>는 계산에서 제외하므로 실제 확정 수익이 아닙니다.</p>
 ${error?`<p class="ops-error">${esc(error)}</p>`:''}
 <div class="ops-bar"><label>종류 <select id="ops-recipe-type"><option value="barter" ${recipeFilter==='barter'?'selected':''}>상인 물물교환</option><option value="craft" ${recipeFilter==='craft'?'selected':''}>은신처 제작</option></select></label><input id="ops-recipe-search" placeholder="아이템 이름 검색" value="${esc(recipeQuery)}" aria-label="제작 또는 거래 아이템 검색"></div>
 <div class="ops-recipe-list">${priced.slice(0,65).map(r=>`<article><div><b>${esc(r.reward.map(x=>itemName(x.itemId)+' ×'+x.quantity).join(' + '))}</b><small>${esc(r.traderName||r.station||'시설 / 제공자 확인 필요')} · 요구 Lv.${r.level??'미등록'}</small><small>필요: ${esc(r.required.map(x=>itemName(x.itemId)+' ×'+x.quantity).join(' + '))}</small></div><div><strong class="${r.net!==null&&r.net>=0?'ops-good':'ops-dim'}">${r.net===null?'비교 불가':money(r.net)}</strong><small>재료: ${money(r.cost)} / 보상: ${money(r.rewardValue)}</small>${r.net===null?'<small>가격 미등록 항목 포함</small>':''}</div></article>`).join('')||'<p>해당 레시피가 없습니다. 데이터 연결과 필터를 확인하세요.</p>'}</div></div>`;
 $('ops-recipe-type').addEventListener('change',e=>{recipeFilter=e.target.value;renderRecipes();});
 $('ops-recipe-search').addEventListener('change',e=>{recipeQuery=e.target.value;renderRecipes();});
 }
 function renderMarket(){const available=catalog()?.items||[],q=(document.getElementById('ops-alert-search')?.value||'').trim().toLowerCase();
 content.innerHTML=`<div class="ops-panel"><h3>시세 알림 · 예상 수익</h3><p class="ops-muted">이 프로그램의 마켓 화면이 열려 있는 동안 새 데이터를 확인할 때만 알림을 표시해요. 게임 가격을 직접 실시간으로 읽거나 백그라운드 알림을 보내는 기능은 아닙니다.</p>
 <div class="ops-bar"><input id="ops-alert-search" type="search" placeholder="알림 등록할 아이템 검색" value="${esc(q)}"><select id="ops-alert-item"><option value="">아이템 선택</option></select><select id="ops-alert-dir"><option value="below">가격 이하</option><option value="above">가격 이상</option></select><input id="ops-alert-price" type="number" min="1" placeholder="목표가 ₽"><button id="ops-alert-add" class="btn btn-primary">등록</button></div>
 <table class="ops-table"><thead><tr><th>아이템</th><th>조건</th><th>최근 관측 가격</th><th></th></tr></thead><tbody>${Object.entries(alerts).map(([id,a])=>`<tr><td>${esc(itemName(id))}</td><td>${a.direction==='below'?'≤':'≥'} ${money(Number(a.price))}</td><td>${money(priceOf(getItem(id),'flea'))}</td><td><button class="btn btn-small" data-alert-delete="${esc(id)}">삭제</button></td></tr>`).join('')||'<tr><td colspan="4">등록한 가격 알림이 없어요.</td></tr>'}</tbody></table>
 <h3>가격 기록 확인</h3><div class="ops-bar"><button id="ops-history" class="btn">위에서 선택한 아이템의 가격 기록</button></div><div id="ops-history-status" class="ops-muted">아이템을 검색해 선택하고 가격 기록 버튼을 누르세요. 제공처에 기록이 없는 품목은 그래프를 그리지 않습니다.</div><div id="ops-history-chart"></div><h3>사용자 지정 수수료로 순수익 계산</h3><div class="ops-bar"><label>판매가 ₽ <input id="ops-profit-sell" type="number" min="1" value="100000"></label><label>매입 원가 ₽ <input id="ops-profit-buy" type="number" min="0" value="50000"></label><label>수량 <input id="ops-profit-qty" type="number" min="1" max="9999" value="1"></label><label>가정 수수료 % <input id="ops-profit-fee" type="number" min="0" max="99" value="${fee}"></label></div><div id="ops-profit-result" class="ops-price-summary"></div>
 <p class="ops-muted">수수료율은 직접 입력하는 <b>가정 값</b>입니다. 실제 플리마켓 수수료 공식과는 다를 수 있어요.</p></div>`;
 function fillItems(){const query=$('ops-alert-search').value.trim().toLowerCase();const filtered=available.filter(i=>query&&[i.name,i.nameEn,i.shortName].some(x=>String(x||'').toLowerCase().includes(query))).slice(0,75);$('ops-alert-item').innerHTML='<option value="">아이템 선택</option>'+filtered.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');}
 $('ops-alert-search').addEventListener('input',fillItems);fillItems();
 $('ops-history').addEventListener('click',async()=>{const id=$('ops-alert-item').value;if(!id)return $('ops-history-status').textContent='먼저 아이템을 검색해 선택하세요.';
 $('ops-history-status').textContent='공개 가격 기록 확인 중…';$('ops-history-chart').innerHTML='';
 try{const response=await fetch(`${API}/${mode}/prices/${encodeURIComponent(id)}`,{cache:'no-cache',credentials:'omit'});if(!response.ok)throw new Error(`가격 기록 서버 HTTP ${response.status}`);
  const json=await response.json();const raw=Array.isArray(json)?json:Array.isArray(json?.prices)?json.prices:Array.isArray(json?.data?.prices)?json.data.prices:[];
  const points=raw.map(p=>({time:Date.parse(p.timestamp||p.time||p.date||''),value:Number(p.price??p.priceMin??p.value)})).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value)&&p.value>0).sort((a,b)=>a.time-b.time).slice(-90);
  if(points.length<2)throw new Error('유효한 시간별 가격 기록이 2개 미만입니다.');const min=Math.min(...points.map(p=>p.value)),max=Math.max(...points.map(p=>p.value));const start=points[0].time,end=points.at(-1).time;
  const coords=points.map(p=>{const x=15+(p.time-start)/Math.max(1,end-start)*670;const y=125-(p.value-min)/Math.max(1,max-min)*110;return `${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 700 150');svg.setAttribute('role','img');svg.setAttribute('aria-label','제공처 가격 기록 추이');const poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');poly.setAttribute('points',coords);poly.setAttribute('stroke','#c7d17e');poly.setAttribute('stroke-width','3');poly.setAttribute('fill','none');svg.append(poly);$('ops-history-chart').append(svg);
  $('ops-history-status').textContent=`${points.length}개 관측 기록 · ${new Date(start).toLocaleString('ko-KR')} ~ ${new Date(end).toLocaleString('ko-KR')} · 최저 ${money(min)} / 최고 ${money(max)}`;
 }catch(e){$('ops-history-status').textContent='가격 기록 없음 또는 조회 실패: '+e.message;}});
 $('ops-alert-add').addEventListener('click',()=>{const item=$('ops-alert-item').value,price=Number($('ops-alert-price').value);if(!item||!(price>0))return notify('아이템과 목표 가격을 선택하세요.');alerts[item]={price,direction:$('ops-alert-dir').value};save('tfg-alerts-r10-'+mode,alerts);renderMarket();});
 content.querySelectorAll('[data-alert-delete]').forEach(b=>b.addEventListener('click',()=>{delete alerts[b.dataset.alertDelete];save('tfg-alerts-r10-'+mode,alerts);renderMarket();}));
 function recalc(){fee=Number($('ops-profit-fee').value);const p=profitEstimate({sell:Number($('ops-profit-sell').value),acquisition:Number($('ops-profit-buy').value),count:Number($('ops-profit-qty').value),feePercent:fee});$('ops-profit-result').textContent=p.net===null?p.reason:`예상 매출 ${money(p.gross)} − 가정 수수료 ${money(p.feeAmount)} − 매입원가 ${money(p.cost)} = 예상 순수익 ${money(p.net)}`;}
 for(const element of content.querySelectorAll('#ops-profit-sell,#ops-profit-buy,#ops-profit-qty,#ops-profit-fee'))element.addEventListener('input',recalc);recalc();
 }
 function renderIcon(){content.innerHTML=`<div class="ops-panel"><h3>인벤토리 아이템 아이콘 비교 · 시험 기능</h3><p class="ops-muted">게임 인벤토리의 아이콘은 같은 모양이 여러 개라 <b>전체 자동 식별을 보장하지 않습니다.</b> 기존 OCR과 수동 이름 검색은 계속 지원해요. 사진에서 물품 아이콘 부분을 직접 잘라 넣으면 공개 카탈로그 아이콘과 비교해 후보만 보여줍니다.</p>
 <div class="ops-bar"><input type="file" id="ops-icon-file" accept="image/png,image/jpeg,image/webp"><input id="ops-icon-query" placeholder="후보 이름 / 종류로 범위를 줄이기"><button id="ops-icon-scan" class="btn btn-primary">유사 아이콘 찾기</button><button id="ops-open-loot" class="btn">기존 사진 가격표</button></div><p class="ops-muted">사진에서 아이콘을 드래그해 영역을 선택하세요. 전체 화면을 업로드한 경우 선택 영역만 비교합니다.</p><canvas id="ops-icon-preview" style="display:none;width:100%;max-height:340px;object-fit:contain;background:#101612;border:1px solid #4b6140;cursor:crosshair;touch-action:none" aria-label="이미지 위에서 드래그해 아이콘 영역 선택"></canvas><p id="ops-icon-status" role="status"></p><div id="ops-icon-matches" class="ops-icon-matches"></div></div>`;
 let crop=null,bitmap=null,selection=null,dragStart=null;
 const canvas=$('ops-icon-preview');
 $('ops-icon-file').addEventListener('change',async e=>{
  if(bitmap)bitmap.close();bitmap=null;crop=null;selection=null;const file=e.target.files?.[0];if(!file)return;
  try{bitmap=await createImageBitmap(file);const scale=Math.min(1,780/bitmap.width,340/bitmap.height);
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.style.display='block';canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    $('ops-icon-status').textContent=`${bitmap.width}×${bitmap.height} 이미지 선택 · ${bitmap.width>512||bitmap.height>512?'아이콘 하나를 드래그해 영역 선택 필수':'전체 아이콘을 바로 비교할 수 있어요.'}`;
    if(bitmap.width<=512&&bitmap.height<=512)crop=canvas;
  }catch(error){$('ops-icon-status').textContent='이미지를 열지 못했습니다: '+error.message;}
 });
 const localPoint=e=>{const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};};
 canvas.addEventListener('pointerdown',e=>{if(!bitmap)return;dragStart=localPoint(e);canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener('pointerup',e=>{if(!dragStart||!bitmap)return;const end=localPoint(e);const x=Math.floor(Math.min(dragStart.x,end.x)),y=Math.floor(Math.min(dragStart.y,end.y)),w=Math.floor(Math.abs(end.x-dragStart.x)),h=Math.floor(Math.abs(end.y-dragStart.y));dragStart=null;
    if(w<8||h<8)return $('ops-icon-status').textContent='아이콘 영역을 조금 더 크게 드래그해 주세요.';
    const cropped=document.createElement('canvas');cropped.width=w;cropped.height=h;cropped.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);
    crop=cropped;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);ctx.strokeStyle='#e8d06c';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);
    $('ops-icon-status').textContent=`선택 아이콘 영역 ${w}×${h} · 유사 아이콘 찾기를 눌러 주세요.`;
 });
 $('ops-open-loot').addEventListener('click',()=>{close();openLoot();});$('ops-icon-scan').addEventListener('click',async()=>{
 const file=$('ops-icon-file').files?.[0];if(!file||!crop)return $('ops-icon-status').textContent='아이콘 이미지 또는 드래그한 영역을 먼저 선택해 주세요.';
 if(file.size>8*1024*1024)return $('ops-icon-status').textContent='8MB 이하 이미지만 비교할 수 있어요.';
 const query=$('ops-icon-query').value.trim().toLowerCase();const items=(catalog()?.items||[]).filter(x=>x.iconLink&&(!query||[x.name,x.nameEn,x.shortName,...(x.categoryLabels||[])].some(n=>String(n).toLowerCase().includes(query)))).slice(0,120);
 if(!items.length)return $('ops-icon-status').textContent='카탈로그를 먼저 불러오거나 후보 범위를 변경해 주세요.';
 $('ops-icon-status').textContent=`${items.length}개 공개 아이콘과 비교 중 · 이미지 접근 허용 여부에 따라 실패할 수 있어요.`;
 try{const hash=hashBitmap(crop);const evaluated=[];let inaccessible=0;
 const workers=Array.from({length:Math.min(8,items.length)},async(_,worker)=>{for(let i=worker;i<items.length;i+=8){const item=items[i];try{const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';image.src=item.iconLink;await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),1300))]);const diff=similarity(hash,hashBitmap(image));evaluated.push({item,diff});}catch{inaccessible++;}}});await Promise.all(workers);
 evaluated.sort((a,b)=>a.diff-b.diff);$('ops-icon-matches').innerHTML=evaluated.slice(0,10).map(x=>`<article><img src="${esc(x.item.iconLink)}" width="40" height="40"><span>${esc(x.item.name)}<small>유사도 추정 ${Math.max(0,Math.round((1-x.diff)*100))}% · 자동 확정 아님</small></span><b>${money(priceOf(x.item))}</b></article>`).join('')||'<p>아이콘 비교가 차단됐어요. 이름 검색을 이용해 주세요.</p>';
 $('ops-icon-status').textContent=`${evaluated.length}개 비교 · 접근 불가 ${inaccessible}개 · 색·모양 유사도이며 정확도 보장 안 됨`;
 }catch(e){$('ops-icon-status').textContent='아이콘 비교 실패: '+e.message;}
 });}
 function hashBitmap(image){const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,16,16);const d=ctx.getImageData(0,0,16,16).data;const result=[];for(let i=0;i<d.length;i+=4){const a=d[i+3]/255;result.push((d[i]*.299+d[i+1]*.587+d[i+2]*.114)*a+35*(1-a));}return result;}
 function similarity(a,b){let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(a[i]-b[i]);return error/(255*a.length);}
 function render(){if(!dialog.open)return;const active=getMode();if(mode!==active){mode=active;current=null;hideout=[];crafts=[];barters=[];owned=store('tfg-owned-r10-'+mode,{});alerts=store('tfg-alerts-r10-'+mode,{});}
 if(tab==='raid')renderRaid();else if(tab==='hideout')renderHideout();else if(tab==='recipes')renderRecipes();else if(tab==='market')renderMarket();else renderIcon();}
 document.querySelectorAll('[data-ops-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.opsTab)));
 $('open-ops').addEventListener('click',()=>open());$('ops-close').addEventListener('click',close);
 document.addEventListener('tfg-market-loaded',ev=>{if(ev.detail?.mode!==mode)return;const catalogNow=catalog();const found=priceAlerts(catalogNow,alerts);for(const result of found){const key=`${mode}:${result.item.id}:${result.direction}:${result.target}`;if(alerted.has(key))continue;alerted.add(key);notify(`시세 알림: ${result.item.name} ${money(result.actual)} (${result.direction==='below'?'목표 이하':'목표 이상'})`);}if(dialog.open&&['market','recipes','hideout'].includes(tab))render();});
 return {open,refresh:()=>{if(dialog.open)render();},get route(){return route;}};
}