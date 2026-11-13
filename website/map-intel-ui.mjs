import {INTEL_KINDS,collectMapIntel,describeBosses,filterIntel,intelCounts} from './map-intel-core.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULT={landmark:true,container:true,loose:true,boss:true,pmc:true,scav:true,other:false};
const kindIcon={landmark:'◆',container:'▣',loose:'◇',boss:'B',pmc:'P',scav:'S',other:'?'};
export function initializeMapIntel({getMap,getMode,getConfig,getRecord,getFallbackLabels,project,getFloorState,getZoomRatio,centerOn,refreshMarkers,notify}={}){
 const folder=$('intel-marker-panel'),btn=$('intel-marker-toggle'),results=$('intel-marker-results'),search=$('intel-marker-search');
 const load=()=>{try{return {...DEFAULT,...JSON.parse(localStorage.getItem('tfg-r15-layer-'+getMode())||'{}')};}catch{return {...DEFAULT}};};
 let enabled=load(),term='',category='all',selection='',rows=[],bosses=[],mapKey='';
 function data(){const fallback=getFallbackLabels()?.[getMap()]||[];return collectMapIntel(getRecord()||{},getConfig()||{},fallback);}
 function update(){mapKey=getMap();rows=data();bosses=describeBosses(getRecord()||{});updateControls();renderPanel();}
 function updateControls(){for(const input of document.querySelectorAll('[data-intel-toggle]')){input.checked=enabled[input.dataset.intelToggle]!==false;}
  const counts=intelCounts(rows);const n=rows.filter(r=>enabled[r.type]!==false).length;
  $('intel-layer-status').textContent=`주요 지역 ${counts.landmark||0} · 파밍 ${(counts.container||0)+(counts.loose||0)} · PMC ${counts.pmc||0} · Scav ${counts.scav||0} · 보스 핀 ${counts.boss||0}`;
  $('intel-layer-status').title=`등록 위치 ${n}개 · 현재 맵 공개 데이터 기준이며 현재 레이드 스폰은 보장하지 않습니다.`;
 }
 function current(){return filterIntel(rows,{enabled,term,type:category});}
 function select(id){const row=rows.find(r=>r.id===id);if(!row)return;selection=id;folder.hidden=false;btn.setAttribute('aria-expanded','true');renderPanel();centerOn(row.position);}
 function renderPanel(){if(folder.hidden)return;
  const matches=current(),counts=intelCounts(rows);
  $('intel-marker-count').textContent=`${matches.length} / 전체 ${rows.length}`;
  $('intel-kind-select').value=category;
  if(search&&search.value!==term)search.value=term;
  const selected=rows.find(r=>r.id===selection);
  results.innerHTML=`${selected?`<div class="intel-focused"><div class="intel-focused-head"><b>${esc(selected.label)}</b><button type="button" id="intel-clear-detail" class="btn btn-small">닫기</button></div><small>${esc(INTEL_KINDS[selected.type])} · X ${selected.position.x.toFixed(1)}, Z ${selected.position.z.toFixed(1)}</small><p>${esc(selected.detail||'공개 지도 기준 등록 지점입니다. 현재 레이드에 항상 존재하는 것은 아닙니다.')}</p></div>`:''}
  <div class="intel-list-items">${matches.slice(0,240).map(r=>`<button type="button" class="intel-result-item ${r.id===selection?'selected':''}" data-intel-id="${esc(r.id)}"><b class="intel-result-type intel-${esc(r.type)}">${kindIcon[r.type]||'·'}</b><span><strong>${esc(r.label)}</strong><small>${esc(INTEL_KINDS[r.type])} · ${Number.isFinite(r.position.y)?'높이 '+r.position.y.toFixed(1):'층 미확인'}</small></span></button>`).join('')||'<p class="intel-layer-empty">조건에 맞는 마커가 없어요. 검색어 또는 필터를 바꿔보세요.</p>'}</div>
  ${matches.length>240?`<p class="intel-layer-empty">목록은 처음 240개만 표시돼요. 검색해서 원하는 마커를 찾아 주세요.</p>`:''}
  <div class="intel-boss-list"><h4>보스 출현 지역 정보</h4>${bosses.length?bosses.map(b=>`<div class="intel-boss-row"><strong>${esc(b.name)}</strong><small>${b.locations.length?esc(b.locations.join(' · ')):'출현 지역 이름 미등록'} · ${b.hasCoordinates?'지도 좌표 있음':'정확한 좌표 없음'}</small></div>`).join(''):'<p>공개된 보스 출현 정보가 없어요.</p>'}<p>보스 후보 지역과 출현 조건은 현재 레이드 출현을 보장하지 않습니다.</p></div>`;
  results.querySelector('#intel-clear-detail')?.addEventListener('click',()=>{selection='';renderPanel();});
  results.querySelectorAll('[data-intel-id]').forEach(el=>el.addEventListener('click',()=>select(el.dataset.intelId)));
 }
 function renderMarkers(fragment){
  if(mapKey!==getMap())update();
  let landmarkIndex=0;const byType={};const displayLimit={landmark:200,container:650,loose:650,boss:200,pmc:400,scav:400,other:250};
  for(const r of rows){if(enabled[r.type]===false)continue;const p=project(r.position);if(!p?.inBounds)continue;
   // Unknown altitude means show on the map with a tooltip, not a claimed floor.
   const altitude=Number.isFinite(r.position.y)?r.position.y:(Number.isFinite(r.minY)&&Number.isFinite(r.maxY)?(r.minY+r.maxY)/2:null);
   if(altitude!==null){const floor=getFloorState({...r.position,y:altitude});if(floor&&!floor.visible)continue;}
   byType[r.type]=(byType[r.type]||0)+1;if(byType[r.type]>(displayLimit[r.type]||300))continue;
   const el=document.createElement('button');el.type='button';el.className='intel-map-pin intel-'+r.type+(r.type==='landmark'?' intel-landmark-label':'');
   el.style.left=(p.u*100)+'%';el.style.top=(p.v*100)+'%';el.dataset.intelId=r.id;
   el.textContent=r.type==='landmark'?r.label:kindIcon[r.type]||'•';
   if(r.type==='landmark')el.dataset.intelRank=landmarkIndex++<16?'major':'secondary';
   el.title=`${r.label} · ${INTEL_KINDS[r.type]}\n${r.detail||'공개 데이터 기준 지점'}\n${Number.isFinite(r.position.y)?'높이 '+r.position.y.toFixed(1):'층 미확인'}`;
   el.setAttribute('aria-label',el.title);el.addEventListener('click',event=>{event.stopPropagation();select(r.id);});fragment.append(el);
  }
 }
 function setKind(kind,checked){enabled[kind]=!!checked;try{localStorage.setItem('tfg-r15-layer-'+getMode(),JSON.stringify(enabled));}catch{}
  updateControls();renderPanel();refreshMarkers();}
 document.querySelectorAll('[data-intel-toggle]').forEach(input=>input.addEventListener('change',event=>setKind(event.target.dataset.intelToggle,event.target.checked)));
 btn.addEventListener('click',()=>{folder.hidden=!folder.hidden;btn.setAttribute('aria-expanded',String(!folder.hidden));if(!folder.hidden){renderPanel();search?.focus();}});
 $('intel-panel-close').addEventListener('click',()=>{folder.hidden=true;btn.setAttribute('aria-expanded','false');});
 search.addEventListener('input',event=>{term=event.target.value;selection='';renderPanel();});
 $('intel-kind-select').addEventListener('change',event=>{category=event.target.value;selection='';renderPanel();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!folder.hidden&&document.activeElement?.closest?.('#intel-marker-panel')){folder.hidden=true;btn.setAttribute('aria-expanded','false');}});
 update();
 return {refresh:()=>{enabled=load();selection='';term='';update();refreshMarkers();},refreshMarkers:()=>{refreshMarkers();},renderMarkers,getCounts:()=>intelCounts(rows)};
}