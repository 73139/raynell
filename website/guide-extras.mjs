import {buildKappaLine,validRoutePoints} from './guide-core.mjs';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusName={todo:'미완료',active:'진행 중',done:'완료'};
export function initializeGuideExtras({getTasks,getStatus,getMap,getMapName,onOpenQuest,onComplete,onRoute}){
 let routes=[],routeError='',activeRoute=null;
 const kappa=$('kappa-dialog'),routeDialog=$('routes-dialog');
 function renderKappa(){
  const tasks=getTasks(),line=buildKappaLine(tasks,getStatus),query=$('kappa-search').value.trim().toLowerCase();
  $('kappa-progress').textContent=tasks.length?`필수 ${line.done} / ${line.required} 완료 · 선행 포함 ${line.rows.length}개`:'퀘스트 데이터 연결 대기';
  const rows=line.rows.filter(r=>!query||[r.task.name,r.task.nameEn,r.task.traderName].join(' ').toLowerCase().includes(query));
  $('kappa-flow-list').innerHTML=rows.map((r,i)=>`<article class="kappa-flow-row ${r.status==='done'?'is-done':''}"><span class="kappa-step">${i+1}</span><div><button class="kappa-quest-link" data-kappa-quest="${esc(r.task.id)}">${r.task.kappaRequired?'<b class="kappa-inline">K</b>':'<small>선행</small>'} ${esc(r.task.name)}</button><small>${esc(r.task.traderName)} · ${esc(statusName[r.status])}${r.blocked?' · 선행 확인 필요':''}</small><div class="kappa-prereqs">${r.prerequisites.map(p=>`<button class="${p.status==='done'?'done':''}" data-kappa-quest="${esc(p.id)}">${p.status==='done'?'✓':'↳'} ${esc(p.name)}</button>`).join('')||'<span>등록된 선행 임무 없음</span>'}</div></div><button class="btn btn-small" data-kappa-complete="${esc(r.task.id)}">${r.status==='done'?'완료 취소':'완료로 표시'}</button></article>`).join('')||'<p>조건에 맞는 카파 임무가 없습니다. 퀘스트 데이터 연결과 검색어를 확인하세요.</p>';
 }
 function renderRoutes(){
  $('routes-map-name').textContent=getMapName();
  const current=routes.filter(r=>r.map===getMap());
  $('recommended-route-list').innerHTML=current.map(r=>`<article class="recommended-route-card"><div class="route-card-heading"><h3>${esc(r.name)}</h3><span>위험 ${esc(r.risk)}</span></div><p>${esc(r.why)}</p><ol>${validRoutePoints(r).map(p=>`<li>${esc(p.label)}${p.floor?' · '+esc(p.floor):''}</li>`).join('')}</ol><p class="route-caution">${esc(r.note)}</p><small>${esc(r.keys)}</small><div class="route-card-actions"><button class="btn btn-primary" data-apply-route="${esc(r.id)}">지도에 경로 표시</button>${(r.sources||[]).map(s=>{let url='';try{const u=new URL(s.url);if(u.protocol==='https:')url=u.href;}catch{}return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">공략 원문 ↗</a>`:'';}).join('')}<small>좌표 확인 ${esc(r.verifiedOn)}</small></div></article>`).join('')||`<p>${routeError||'이 지도에는 아직 검증된 추천 경로가 없습니다. 지도 마커와 탈출구를 먼저 확인해 주세요.'}</p>`;
 }
 function clear(){activeRoute=null;$('active-route-note').hidden=true;onRoute(null);}
 $('open-kappa-line').addEventListener('click',()=>{renderKappa();kappa.showModal();});
 $('close-kappa-line').addEventListener('click',()=>kappa.close());
 $('kappa-search').addEventListener('input',renderKappa);
 $('kappa-flow-list').addEventListener('click',event=>{
  const open=event.target.closest('[data-kappa-quest]');
  if(open){kappa.close();onOpenQuest(open.dataset.kappaQuest);return;}
  const done=event.target.closest('[data-kappa-complete]');
  if(done){onComplete(done.dataset.kappaComplete,getStatus(done.dataset.kappaComplete)==='done'?'todo':'done');renderKappa();}
 });
 $('open-intel-list').addEventListener('click',()=>$('intel-marker-toggle').click());
 $('open-recommended-routes').addEventListener('click',()=>{renderRoutes();routeDialog.showModal();});
 $('close-recommended-routes').addEventListener('click',()=>routeDialog.close());
 $('clear-recommended-route').addEventListener('click',clear);
 $('recommended-route-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-apply-route]');if(!button)return;
  const route=routes.find(r=>r.id===button.dataset.applyRoute&&r.map===getMap());if(!route||validRoutePoints(route).length<2)return;
  activeRoute=route;onRoute(route);$('active-route-note').hidden=false;
  $('active-route-text').textContent=`${route.name} · ${route.points.map((p,i)=>`${i+1}. ${p.label}${p.floor?'('+p.floor+')':''}`).join(' → ')} · 방문 순서 안내선`;
  routeDialog.close();
 });
 fetch('./recommended-routes.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{routes=Array.isArray(data.routes)?data.routes:[];if(routeDialog.open)renderRoutes();}).catch(()=>{routeError='추천 경로를 불러오지 못했습니다. 인터넷 연결 후 다시 열어 주세요.';if(routeDialog.open)renderRoutes();});
 return {refresh(){if(activeRoute&&activeRoute.map!==getMap())clear();if(kappa.open)renderKappa();if(routeDialog.open)renderRoutes();}};
}
