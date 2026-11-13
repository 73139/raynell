import * as geo from './geo-core.mjs';
import {clampCamera,preserveCameraOnResize} from './map-camera.mjs';
import { fetchQuestDataset, fetchItemCatalog, applyItemCatalog } from './data.mjs';
import { scanScreenshotDirectory } from './capture-core.mjs';
import { readCompanionBootstrap, createCompanionClient, createCaptureCursor } from './companion-client.mjs';
import { ALL_FLOORS_ID, buildFloorOptions, classifyLocationFloor, floorMatches, floorGroupVisibility } from './floor-core.mjs';
import { exitsForMap } from './map-details.mjs';
import { initializeMarket } from './market-ui.mjs';
import { initializeLootScan } from './loot-ui.mjs';
import { initializeQuestOcr } from './quest-ocr-ui.mjs';
import { initializeOperations } from './ops-ui.mjs';
import { initializeFieldKit } from './field-kit-ui.mjs';
import { initializeR12 } from './r12-ui.mjs';
import { initializeR13 } from './r13-ui.mjs';
import { initializeR14Shell } from './r14-shell.mjs';
import { initializeMapIntel } from './map-intel-ui.mjs';

const $ = (id) => document.getElementById(id);
// Keep the quest browser visible on the left and move its detail view to the right.
$('intel-panel').appendChild($('quest-detail'));
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = (value) => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const fmt = new Intl.NumberFormat('ko-KR');
const time = (date) => new Date(date).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'});
const MAP_LABELS = {'ground-zero':'그라운드 제로','streets-of-tarkov':'타르코프 시내',customs:'세관',factory:'공장',woods:'삼림',shoreline:'해안선',interchange:'인터체인지',lighthouse:'등대',reserve:'리저브','the-lab':'연구소',labyrinth:'미궁',terminal:'터미널'};
const MAP_ORDER = ['ground-zero','customs','woods','shoreline','interchange','reserve','lighthouse','streets-of-tarkov','factory','the-lab','labyrinth','terminal'];
const MODE_LABELS = {regular:'PvP',pve:'PvE','pvp-season':'시즌'};
const STORAGE_KEY = 'tarkov-field-guide-progress-v1';
const STATUS_LABELS = {todo:'미완료',active:'진행 중',done:'완료'};
const state = {mode:'regular',mapKey:'customs',view:'map',dataset:null,configs:[],selected:null,progress:{},player:null,watchHandle:null,watchTimer:null,watchBusy:false,watchSeen:new Set(),watchStarted:0,mapSequence:0,dataSequence:0,mapDoc:null,mapURL:null,floor:'',imageReady:false,zoom:1,fitZoom:1,panX:0,panY:0,imageWidth:1000,imageHeight:700,search:'',trader:'all',status:'all',mapFilter:'current',renderLimit:70,watchSession:null,capture:null,mapDisplayMode:'loading',showPlayerMarker:true,showQuestMarkers:true,followPlayer:true,capturedQuestIds:[],capturedCandidateCount:0};
Object.assign(state,{companionMode:false,companion:null,companionConnected:false,companionBusy:false,companionError:'',companionWaiting:false,companionGate:null});
Object.assign(state,{mapDataset:null,mapDetailsStatus:'loading',floorOptions:[],floorImageSequence:0,followFloor:false,showOtherFloors:false,exitFilters:{pmc:true,scav:true,shared:true,unknown:true,transit:true},showExitLabels:true,exitSearch:'',selectedExit:null});
let opsRoute=[],opsExit=null,opsController=null,lastAutoMapRev=0;
let fieldKitController=null,r12Controller=null,r13Controller=null;
let mapIntelController=null,verifiedIntelLabels={};
let companionClient=null;
let questOcrController=null,ocrCompanionCursor='',ocrBrowserTimer=null,ocrBrowserTicket=0,ocrSourceEpoch=0;
const companionCursor=createCaptureCursor();
try { const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); if(saved&&typeof saved==='object') state.progress=saved; state.mode=localStorage.getItem('tfg-mode')||'regular'; state.mapKey=localStorage.getItem('tfg-map')||'customs'; } catch {}
if(!Object.hasOwn(MODE_LABELS,state.mode)) state.mode='regular';
let dbPromise;
function database(){ return dbPromise ??= new Promise((resolve,reject)=>{const req=indexedDB.open('tarkov-field-guide',1);req.onupgradeneeded=()=>req.result.createObjectStore('cache');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
async function cachedGet(key){try{const db=await database();return await new Promise((res,rej)=>{const r=db.transaction('cache').objectStore('cache').get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}catch{return null;}}
async function cachedPut(key,value){try{const db=await database();await new Promise((res,rej)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put(value,key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}catch{}}
function progress(){if(!state.progress[state.mode]||typeof state.progress[state.mode]!=='object')state.progress[state.mode]={};return state.progress[state.mode];}
function taskProgress(id){const p=progress()[id];return p&&typeof p==='object'?p:{status:'todo',pinned:false,objectives:{}};}
function statusOf(id){const v=taskProgress(id).status;return Object.hasOwn(STATUS_LABELS,v)?v:'todo';}
function saveProgress(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state.progress));}catch{toast('저장 공간에 접근할 수 없어요. 이용 안내에서 진행 상황을 내보내 주세요.',true);}}
function updateProgress(id,patch){progress()[id]={...taskProgress(id),...patch};saveProgress();renderSummary();renderQuests();renderMarkers();if(state.selected===id)renderDetail();}
let toastTimeout;
function toast(message,error=false){const el=$('toast');el.textContent=message;el.classList.toggle('is-error',error);el.hidden=false;el.classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>{el.classList.remove('visible');el.hidden=true;},6500);}
function text(id,value){if($(id))$(id).textContent=value;}
function baseMapKey(key){return ({'ground-zero-21':'ground-zero','night-factory':'factory','infected-factory':'factory','factory-day':'factory','factory-night':'factory','laboratory':'the-lab','the-laboratory':'the-lab','streets':'streets-of-tarkov'})[key]||key;}
function cfg(){return state.configs.find(c=>c.key===state.mapKey);}
function mapRecords(){return state.mapDataset?.mode===state.mode&&state.mapDataset.maps?.length?state.mapDataset.maps:state.dataset?.maps||[];}
function mapName(key){const m=mapRecords().find(m=>baseMapKey(m.normalizedName)===key);return MAP_LABELS[key]||m?.name||key;}
function mapById(id){return mapRecords().find(m=>m.id===id);}
function mapKeyFor(id){return baseMapKey(mapById(id)?.normalizedName||id);}
function matchesMap(task,key){return (task.mapIds||[]).some(id=>mapKeyFor(id)===key);}
function locationsFor(task,key=state.mapKey){return (task.objectives||[]).flatMap((o,index)=>(o.locations||[]).filter(l=>l.mapId&&mapKeyFor(l.mapId)===key&&Number.isFinite(l.x)&&Number.isFinite(l.z)).map((l,li)=>({...l,objective:o,objectiveIndex:index,locationIndex:li,task})));}
function pinCount(){return Object.entries(progress()).filter(([id,p])=>p?.pinned&&state.dataset?.tasks.some(t=>t.id===id)).length;}
function renderSummary(){const tasks=state.dataset?.tasks||[];text('total-count',tasks.length?fmt.format(tasks.length):'—');text('done-count',fmt.format(tasks.filter(t=>statusOf(t.id)==='done').length));text('pin-count',pinCount());}
function configEntries(input){const groups=Array.isArray(input)?input:Array.isArray(input?.maps)?input.maps:Object.values(input?.data||input||{});const out=[];for(const group of groups){if(!group||typeof group!=='object')continue;const c=Array.isArray(group.maps)?group.maps.find(v=>v.projection==='interactive'&&v.svgPath):group.svgPath?group:null;if(!c||!Array.isArray(c.svgBounds||c.bounds))continue;const key=baseMapKey(group.normalizedName||c.key);if(!key||out.some(x=>x.key===key))continue;out.push({...c,key,name:MAP_LABELS[key]||group.name||key,sourceGroup:group.normalizedName});}return out;}
async function fetchTimed(url,ms=22000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);try{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r;}finally{clearTimeout(timer);}}
async function loadMapConfigs(){
  const [fallback,cache]=await Promise.allSettled([fetch('./maps-source.json').then(r=>r.json()),cachedGet('map-configs')]);
  const local=fallback.status==='fulfilled'?configEntries(fallback.value):[];
  const prior=cache.status==='fulfilled'?configEntries(cache.value):[];
  state.configs=prior.length?prior:local;
  renderMapList();
  // An image fetch must not delay loading other maps or accepting a screenshot.
  // Preserve the user's selected map while its full configuration is pending.
  // Coordinates must never be reassigned to a different fallback map.
  if(cfg())selectMap(state.mapKey,false);
  else{text('map-title',mapName(state.mapKey));text('map-subtitle','선택한 지도 구성 대기');}
  renderLocation();
  try{
    const response=await fetchTimed(geo.DEFAULT_MAPS_SOURCE||'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json');
    const raw=await response.json(),full=configEntries(raw);
    if(!full.length||full.length<local.length)throw new Error('지도 구성 누락');
    const previous=JSON.stringify(cfg());state.configs=full;
    renderMapList();renderLocation();
    if(cfg()&&JSON.stringify(cfg())!==previous)selectMap(state.mapKey,false);
    await cachedPut('map-configs',raw);
  }catch{
    if(!state.configs.length)setMapLoading('지도 구성을 불러오지 못했어요. 스크린샷 좌표는 읽을 수 있어요.',true);
    renderLocation();
  }
}
function renderMapList(){
  const apiKeys=mapRecords().map(m=>baseMapKey(m.normalizedName)).filter(Boolean);
  const keys=[...new Set([...state.configs.map(c=>c.key),...apiKeys])].sort((a,b)=>(MAP_ORDER.indexOf(a)<0?99:MAP_ORDER.indexOf(a))-(MAP_ORDER.indexOf(b)<0?99:MAP_ORDER.indexOf(b)));
  $('map-switcher').innerHTML=keys.map(key=>`<option value="${esc(key)}" ${state.configs.some(c=>c.key===key)?'':'disabled'}>${esc(mapName(key))}</option>`).join('');$('map-switcher').value=state.mapKey;
  $('map-list').innerHTML=keys.map((key,i)=>{const enabled=state.configs.some(c=>c.key===key);const count=(state.dataset?.tasks||[]).filter(t=>matchesMap(t,key)).length;return `<button class="map-item ${state.mapKey===key?'active':''}" data-map="${esc(key)}" aria-pressed="${state.mapKey===key}" ${enabled?'':'disabled'} title="${enabled?'지도 선택':'보정된 지도 이미지 미등록'}"><span class="map-index">${String(i+1).padStart(2,'0')}</span><span class="map-item-text"><strong>${esc(mapName(key))}</strong><small>${esc(key.replaceAll('-',' ').toUpperCase())}</small></span><span class="map-item-count">${enabled?(count||'·'):'—'}</span></button>`;}).join('');
  const current=$('map-filter').value||state.mapFilter;
  $('map-filter').innerHTML='<option value="current">선택한 지도</option><option value="all">모든 지도</option><option value="captured">캡처에서 찾은 퀘스트</option>'+keys.map(key=>`<option value="${esc(key)}">${esc(mapName(key))}</option>`).join('');
  $('map-filter').value=current; if(!$('map-filter').value)$('map-filter').value='all';
}
function setMapLoading(message,error=false){const el=$('map-loading');el.hidden=false;el.classList.toggle('is-error',error);el.innerHTML=`<div class="${error?'':'loading-orbit'}"></div><strong>${esc(message)}</strong>${error?'<button class="btn btn-small" id="retry-map">지도 다시 불러오기</button>':''}`;}
async function selectMap(key,change=true){
  if(!state.configs.some(c=>c.key===key))return;
  const changed=state.mapKey!==key;state.mapKey=key;mapIntelController?.refresh();state.floor='';state.floorOptions=[];state.mapDoc=null;state.imageReady=false;state.selectedExit=null;const seq=++state.mapSequence;
  try{localStorage.setItem('tfg-map',key);}catch{}
  if(changed&&state.watchHandle)stopWatching('맵을 바꿨어요. 새 맵에서 찍은 스크린샷만 읽도록 폴더를 다시 연결해 주세요.');
  if(changed){state.player=null;state.capture=null;opsRoute=[];opsExit=null;if(state.companionMode)waitForCompanionCapture();}
  state.mapDisplayMode='loading';
  closeExitDetail();renderFloorControls();renderExitList();
  const config=cfg();renderMapList();text('map-title',mapName(key));text('map-subtitle',key.replaceAll('-',' ').toUpperCase()+' / TACTICAL MAP');renderQuests();renderLocation();
  $('map-image').style.visibility='hidden';$('map-markers').innerHTML='';setMapLoading('지도를 불러오고 있어요');
  const author=safeURL(config.authorLink);$('map-attribution').innerHTML=`지도 ${author?`<a href="${esc(author)}" target="_blank" rel="noopener noreferrer">${esc(config.author||'tarkov.dev')}</a>`:esc(config.author||'tarkov.dev')} · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a> · <a href="https://tarkov.dev/map/${esc(key)}" target="_blank" rel="noopener noreferrer">원본</a>`;
  $('map-floor').disabled=true;$('map-floor').innerHTML='<option>지상층</option>';
  try{
    let svg=await cachedGet('svg:'+config.svgPath);
    if(!svg){const r=await fetchTimed(config.svgPath,30000);svg=await r.text();}
    if(seq!==state.mapSequence)return;
    if(!/<svg[\s>]/i.test(svg))throw new Error('SVG 지도 형식 오류');
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml');if(doc.querySelector('parsererror'))throw new Error('지도 해석 실패');
    // Render through an <img>, keeping external SVG code out of the app's DOM.
    doc.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(el=>el.remove());
    for(const el of doc.querySelectorAll('*'))for(const a of [...el.attributes])if(/^on/i.test(a.name)||(/href$/i.test(a.name)&&/^\s*javascript:/i.test(a.value)))el.removeAttribute(a.name);
    state.mapDoc=doc;
    state.floorOptions=buildFloorOptions(config,new Set([...doc.querySelectorAll('[id]')].map(el=>el.id)));
    state.floor=state.floorOptions.find(l=>l.base&&l.available)?.id||state.floorOptions.find(l=>l.available)?.id||ALL_FLOORS_ID;
    followCapturedFloor(false);renderFloorControls();
    const vb=doc.documentElement.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);state.imageWidth=vb?.length===4?vb[2]:parseFloat(doc.documentElement.getAttribute('width'))||1000;state.imageHeight=vb?.length===4?vb[3]:parseFloat(doc.documentElement.getAttribute('height'))||700;
    if(!(state.imageWidth>0&&state.imageHeight>0))throw new Error('지도 크기를 읽을 수 없음');
    updateFloor(true);await cachedPut('svg:'+config.svgPath,svg);
  }catch(error){if(seq!==state.mapSequence)return;loadDirectMapImage(config,seq);}
}
function loadDirectMapImage(config,seq){
  // A public image can be displayed without reading its SVG text. This is also
  // useful when an image server does not allow cross-origin fetch().
  let source;
  try{const u=new URL(config.svgPath,location.href);if(u.protocol!=='https:'&&!(u.origin===location.origin&&u.protocol==='http:'))throw new Error();source=u.href;}
  catch{mapImageFailed(seq);return;}
  state.mapDoc=null;state.floor='';state.floorOptions=[];state.mapDisplayMode='loading';renderFloorControls();
  $('map-floor').disabled=true;$('map-floor').innerHTML='<option>전체 지도 · 층 분리 대기</option>';
  setMapLoading('원본 지도 이미지로 다시 연결하고 있어요');
  const img=$('map-image');
  img.onload=()=>{
    if(seq!==state.mapSequence)return;
    if(!img.naturalWidth||!img.naturalHeight){mapImageFailed(seq);return;}
    state.imageWidth=img.naturalWidth;state.imageHeight=img.naturalHeight;
    state.imageReady=true;state.mapDisplayMode='direct';img.style.visibility='visible';
    $('map-loading').hidden=true;
    $('map-floor').innerHTML='<option>전체 지도 · 층 분리 불가</option>';
    const stage=$('map-stage');stage.style.width=state.imageWidth+'px';stage.style.height=state.imageHeight+'px';
    img.style.width='100%';img.style.height='100%';fitMap();renderFloorControls();renderMarkers();renderLocation();renderExitList();
    if(state.followPlayer&&state.player)centerOn(state.player);
  };
  img.onerror=()=>mapImageFailed(seq);img.src=source;
}
function mapImageFailed(seq){
  if(seq!==state.mapSequence)return;
  state.imageReady=false;state.mapDisplayMode='error';
  setMapLoading('지도 연결 실패 · 읽은 좌표는 아래에 유지돼요',true);
  renderFloorControls();renderLocation();
}
function floorLabel(id){return state.floorOptions?.find(l=>l.id===id)?.label||(id===ALL_FLOORS_ID?'전체 층':'층 미확인');}
function floorDescription(point){const result=classifyLocationFloor(point,cfg()||{});return result.known?result.labels.join(' / ')+(result.ambiguous?' · 후보':''):result.unavailable?result.labels.join(' / ')+' · 도면 미지원':'층 미확인';}
function floorMarkerState(point){
  const match=floorMatches(point,cfg()||{},state.mapDisplayMode==='direct'?ALL_FLOORS_ID:state.floor);
  const options=state.floorOptions||[];
  if(match.classification.known&&options.length&&!match.classification.ids.some(id=>options.some(o=>o.id===id&&o.available))){match.visible=true;match.unknown=true;match.otherFloor=false;match.unavailable=true;}
  const labels=match.classification.ids.map(id=>options.find(o=>o.id===id)?.shortLabel||buildFloorOptions(cfg()).find(o=>o.id===id)?.shortLabel).filter(Boolean);
  match.badge=match.unknown?'?':labels.join('/')+(match.ambiguous?'?':'');
  match.label=floorDescription(point);return match;
}
function renderFloorControls(){
  const options=state.floorOptions||[],ready=!!state.mapDoc&&options.some(o=>o.available);
  const select=$('map-floor'),buttons=$('floor-buttons');
  if(select){select.disabled=!ready;select.innerHTML=ready?`<option value="${ALL_FLOORS_ID}">전체 층</option>`+options.map(o=>`<option value="${esc(o.id)}" ${o.available?'':'disabled'}>${esc(o.label)}${o.available?'':' · 도면 없음'}</option>`).join(''):`<option value="">${state.mapDisplayMode==='direct'?'전체 지도 · 층 분리 불가':state.mapDisplayMode==='error'?'지도 연결 필요':'층 정보 불러오는 중'}</option>`;if(ready)select.value=state.floor;}
  if(buttons)buttons.innerHTML=ready?`<button type="button" class="floor-button ${state.floor===ALL_FLOORS_ID?'active':''}" data-floor="${ALL_FLOORS_ID}" aria-pressed="${state.floor===ALL_FLOORS_ID}" title="등록된 모든 층 표시">전체</button>`+options.slice().reverse().map(o=>`<button type="button" class="floor-button ${state.floor===o.id?'active':''}" data-floor="${esc(o.id)}" aria-pressed="${state.floor===o.id}" ${o.available?'':'disabled'} title="${esc(o.label)}${o.available?'':' · 이 지도 이미지에는 도면이 없어요'}">${esc(o.label)}</button>`).join(''):'';
  text('floor-note',ready?'실제 도면이 있는 층만 선택할 수 있어요.':state.mapDisplayMode==='direct'?'원본 전체 지도 · 층 분리 연결을 다시 시도해 주세요.':'지도가 연결되면 층을 선택할 수 있어요.');
  if($('follow-floor'))$('follow-floor').disabled=!ready;
  renderFloorStatus();
}
function renderFloorStatus(){
  const current=state.floor?floorLabel(state.floor):state.mapDisplayMode==='direct'?'전체 지도':'층 정보 대기';
  const p=state.player?.mapKey===state.mapKey?state.player:null;
  text('floor-status',`보고 있는 층: ${current}${p?' · 촬영 위치: '+floorDescription(p):''}`);
}
function chooseFloor(id){
  if(!state.mapDoc||(id!==ALL_FLOORS_ID&&!state.floorOptions?.some(o=>o.id===id&&o.available)))return false;
  state.floor=id;renderFloorControls();updateFloor();return true;
}
function followCapturedFloor(redraw=true){
  if(!state.followFloor||!state.player||state.player.mapKey!==state.mapKey||!state.mapDoc)return false;
  const result=classifyLocationFloor(state.player,cfg()||{});
  if(!result.known||result.ambiguous||result.ids.length!==1||!state.floorOptions?.some(o=>o.id===result.ids[0]&&o.available)||state.floor===result.ids[0])return false;
  state.floor=result.ids[0];if(redraw){renderFloorControls();updateFloor();}return true;
}
function updateFloor(fit=false){
  if(!state.mapDoc)return;const config=cfg();const clone=state.mapDoc.cloneNode(true);const visibility=floorGroupVisibility(config,state.floor,{context:true});
  // Only declared floor planes and their companions are managed. Other SVG
  // groups (roads, legends, labels and definitions) retain their source styling.
  const foreground=[];
  for(const group of clone.querySelectorAll('g')){
    const reference=Object.hasOwn(visibility,group.id)?group.id:group.getAttribute('data-keep-with-group');
    if(!reference||!Object.hasOwn(visibility,reference))continue;
    const opacity=visibility[reference];group.style.setProperty('display',opacity?'inline':'none','important');
    if(opacity>0&&opacity<1)group.style.setProperty('opacity',String(opacity),'important');
    if(state.floor!==ALL_FLOORS_ID&&reference===state.floor&&group.parentElement===clone.documentElement)foreground.push(group);
  }
  for(const group of foreground)clone.documentElement.append(group);
  const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'});const next=URL.createObjectURL(blob);if(state.mapURL)URL.revokeObjectURL(state.mapURL);state.mapURL=next;
  const seq=state.mapSequence,revision=++state.floorImageSequence;const img=$('map-image');img.onload=()=>{if(seq!==state.mapSequence||revision!==state.floorImageSequence)return;state.imageReady=true;state.mapDisplayMode='layered';img.style.visibility='visible';$('map-loading').hidden=true;const stage=$('map-stage');stage.style.width=state.imageWidth+'px';stage.style.height=state.imageHeight+'px';img.style.width='100%';img.style.height='100%';if(fit)fitMap();renderFloorControls();renderMarkers();renderLocation();renderExitList();};img.onerror=()=>{if(revision===state.floorImageSequence)loadDirectMapImage(config,seq);};img.src=next;
}
function fitMap(){const el=$('map-viewport');if(!el.clientWidth||!el.clientHeight)return;state.fitZoom=Math.min(el.clientWidth/state.imageWidth,el.clientHeight/state.imageHeight)*0.95;state.zoom=state.fitZoom;state.panX=(el.clientWidth-state.imageWidth*state.zoom)/2;state.panY=(el.clientHeight-state.imageHeight*state.zoom)/2;applyTransform();}
function applyTransform(){const el=$('map-viewport');if(el.clientWidth&&el.clientHeight){const clamped=clampCamera({panX:state.panX,panY:state.panY,zoom:state.zoom,imageWidth:state.imageWidth,imageHeight:state.imageHeight,viewportWidth:el.clientWidth,viewportHeight:el.clientHeight});state.panX=clamped.panX;state.panY=clamped.panY;}$('map-stage').style.transform=`translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`;$('map-stage').style.setProperty('--marker-scale',1/state.zoom);$('map-stage').dataset.intelDetail=(state.fitZoom>0&&state.zoom/state.fitZoom>=1.75)?'full':'overview';}
function zoomAt(mult,x,y){if(!state.imageReady)return;const el=$('map-viewport');x??=el.clientWidth/2;y??=el.clientHeight/2;const old=state.zoom;const next=Math.max(state.fitZoom*0.7,Math.min(state.fitZoom*16,old*mult));state.panX=x-(x-state.panX)*(next/old);state.panY=y-(y-state.panY)*(next/old);state.zoom=next;applyTransform();}
function project(p){try{const result=geo.worldToMap(p,cfg());return result&&Number.isFinite(result.u)&&Number.isFinite(result.v)?result:null;}catch{return null;}}
function centerOn(p){if(!state.imageReady)return;const pos=project(p);if(!pos||!pos.inBounds)return;const el=$('map-viewport');state.zoom=Math.max(state.zoom,state.fitZoom*2);state.panX=el.clientWidth/2-pos.u*state.imageWidth*state.zoom;state.panY=el.clientHeight/2-pos.v*state.imageHeight*state.zoom;applyTransform();}
function renderMarkers(){
  const box=$('map-markers');box.innerHTML='';if(!cfg()||!state.imageReady){text('exit-count',state.mapDetailsStatus==='loading'?'연결 중':'지도 대기');return;}
  const tasks=state.showQuestMarkers?(state.dataset?.tasks||[]).filter(t=>taskProgress(t.id).pinned):[];
  let index=0;const fragment=document.createDocumentFragment();
  renderExitMarkers(fragment);
  for(const task of tasks){for(const l of locationsFor(task)){
    const pos=project(l),floor=floorMarkerState(l);if(!pos?.inBounds||(!floor.visible&&!state.showOtherFloors))continue;
    index++;const b=document.createElement('button');b.className='pin-marker'+(state.selected===task.id?' selected':'')+(floor.otherFloor?' other-floor':'');b.style.left=(pos.u*100)+'%';b.style.top=(pos.v*100)+'%';b.dataset.task=task.id;
    b.innerHTML=String(index)+(floor.badge?`<span class="marker-floor-badge ${floor.unknown?'unknown':''}">${esc(floor.badge)}</span>`:'');
    const distance=state.player?.mapKey===state.mapKey?` · 직선 ${Math.round(Math.hypot(l.x-state.player.x,l.z-state.player.z))}m`:'';
    b.title=`${task.name}\n${l.objective.description}\n${l.kind==='possible'?'등장 후보':l.kind==='zone'?'구역 기준점':l.label||'목표 위치'} · ${floor.label} · 높이 ${Number.isFinite(l.y)?l.y.toFixed(1):'미등록'}${distance}`;b.setAttribute('aria-label',b.title);fragment.append(b);
  }}
  if(state.showPlayerMarker&&state.player?.mapKey===state.mapKey){const p=project(state.player);if(p?.inBounds){const floor=floorMarkerState(state.player);const marker=document.createElement('div');marker.className='player-marker'+(floor.otherFloor?' other-floor':'');marker.style.left=p.u*100+'%';marker.style.top=p.v*100+'%';let heading;try{heading=geo.mapHeading?.(state.player.quaternion,cfg(),state.imageWidth,state.imageHeight);}catch{}marker.innerHTML=`<span class="player-pulse"></span><span class="player-arrow" style="transform:rotate(${Number.isFinite(heading)?heading:0}deg)">${Number.isFinite(heading)?'▲':'●'}</span><span class="player-label">촬영 위치 · ${esc(floor.label)}${floor.otherFloor?' · 다른 층':''}</span>`;marker.title=`${state.player.filename}\n${floor.label}${floor.otherFloor?' · 현재 보는 층과 달라요.':''}\n촬영 시점 위치이며 실시간 위치가 아닙니다.`;fragment.append(marker);}}
  // Informational straight-line objective order. Not a traversable path.
  if(typeof opsRoute!=='undefined'&&opsRoute.length){const targets=[...(state.player?.mapKey===state.mapKey?[state.player]:[]),...opsRoute,...(opsExit?[opsExit]:[])];const vertices=targets.map(project).filter(p=>p?.inBounds).map(p=>`${(p.u*1000).toFixed(2)},${(p.v*1000).toFixed(2)}`);if(vertices.length>1){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','ops-route-overlay');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',vertices.join(' '));svg.appendChild(line);box.append(svg);}}
  const favorite=typeof fieldKitController!=='undefined'?fieldKitController?.getActiveRoute():null;
  if(favorite?.points?.length){
    if(favorite.points.length>1){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','favorite-route-overlay');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',favorite.points.map(p=>`${(p.u*1000).toFixed(2)},${(p.v*1000).toFixed(2)}`).join(' '));svg.append(line);box.append(svg);}
    favorite.points.forEach((p,i)=>{const el=document.createElement('div');el.className='favorite-waypoint';el.style.left=(p.u*100)+'%';el.style.top=(p.v*100)+'%';el.title=`${favorite.name} · ${i+1}. ${p.label}${p.floor?' · '+p.floor:''}${p.note?' · '+p.note:''}`;el.innerHTML=`<span>${i+1}</span>`;el.setAttribute('aria-label',el.title);fragment.append(el);});
  }
  // r12 optional public intelligence layer. Absence of coordinates is never
  // rendered at a guessed map location. The other marker layers stay intact.
  if(r12Controller){for(const marker of r12Controller.getOverlays()){
    const p=project(marker.position);if(!p?.inBounds)continue;
    const floor=floorMarkerState(marker.position);if(!floor.visible&&!state.showOtherFloors)continue;
    const el=document.createElement('button');el.type='button';el.className='r12-intel-pin r12-'+marker.type+(floor.otherFloor?' other-floor':'');
    el.style.left=p.u*100+'%';el.style.top=p.v*100+'%';el.textContent=marker.type==='boss'?'B':marker.type==='hazard'?'!':'S';
    el.title=marker.label+' · '+floor.label+' · 공개 데이터상 후보 지점, 현재 레이드 확정 아님';
    el.setAttribute('aria-label',el.title);el.onclick=()=>r12Controller.open('threats');fragment.append(el);
    if(marker.type==='hazard'&&marker.outline?.length>2){const pts=marker.outline.map(project).filter(v=>v?.inBounds);if(pts.length>=3){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('class','r12-hazard-overlay');const poly=document.createElementNS('http://www.w3.org/2000/svg','polygon');poly.setAttribute('points',pts.map(v=>`${(v.u*1000).toFixed(2)},${(v.v*1000).toFixed(2)}`).join(' '));svg.append(poly);box.append(svg);}}
  }}
  mapIntelController?.renderMarkers(fragment);
  box.append(fragment);text('pin-count',pinCount());
}
function currentExits(){return exitsForMap(mapRecords(),state.mapKey,{items:state.dataset?.items||[]});}
function exitCategory(entry){return ({pmc:'PMC',scav:'Scav',shared:'공용',unknown:'진영 미확인',transit:'지도 이동'})[entry.category]||'진영 미확인';}
function exitColor(entry){return ['pmc','scav','transit'].includes(entry.category)?entry.category:'shared';}
function exitEnabled(entry){return state.exitFilters?.[entry.category]!==false;}
function exitIcon(entry){return entry.kind==='transit'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 3H4v18h5M11 12h10m-4-4 4 4-4 4M9 4h5v4m0 8v4H9"/></svg>';}
function renderExitMarkers(fragment){
  const entries=currentExits();let count=0;
  for(const entry of entries){
    if(!entry.canPin||!exitEnabled(entry))continue;
    const pos=project(entry.position),floor=floorMarkerState(entry.position);
    if(!pos?.inBounds||(!floor.visible&&!state.showOtherFloors))continue;
    count++;const button=document.createElement('button');
    button.className=`exit-marker exit-${exitColor(entry)}${floor.otherFloor?' other-floor':''}${state.selectedExit===entry.key?' selected':''}${pos.u>.72?' label-left':''}`;
    button.dataset.exit=entry.key;button.style.left=pos.u*100+'%';button.style.top=pos.v*100+'%';
    button.innerHTML=`<span class="exit-symbol">${exitIcon(entry)}</span>${state.showExitLabels!==false?`<span class="exit-label">${esc(entry.name)}</span>`:''}<span class="marker-floor-badge ${floor.unknown?'unknown':''}">${esc(floor.badge||'?')}</span>`;
    button.title=`${entry.name}\n${exitCategory(entry)} · ${floor.label}\n클릭하면 위치와 조건을 확인해요. 현재 레이드의 사용 가능 여부는 미확인입니다.`;
    button.setAttribute('aria-label',`${entry.name} · ${exitCategory(entry)} · ${floor.label}`);fragment.append(button);
  }
  text('exit-count',entries.length?`지도 ${count} / 전체 ${entries.length}`:state.mapDetailsStatus==='loading'?'연결 중':'—');
}
function renderExitList(){
  const entries=currentExits(),needle=(state.exitSearch||'').trim().toLocaleLowerCase('ko');
  const list=entries.filter(e=>exitEnabled(e)&&(!needle||`${e.name} ${e.nameEn} ${exitCategory(e)}`.toLocaleLowerCase('ko').includes(needle)));
  const status=state.mapDetailsStatus==='loading'?'탈출구 연결 중':state.mapDetailsStatus==='error'?'탈출구 데이터 연결 실패':state.mapDetailsStatus==='cached'?'저장된 탈출구 데이터':`${MODE_LABELS[state.mode]} · 탈출구·이동 ${entries.length}개`;
  text('exit-data-status',status);
  if($('exit-data-status'))$('exit-data-status').title='현재 레이드에서 활성화된 탈출구인지는 게임의 탈출 목록에서 확인해 주세요.';
  if(!$('exit-list'))return;
  $('exit-list').innerHTML=list.length?list.map(entry=>{
    const floor=entry.canPin?floorMarkerState(entry.position):null,pos=entry.canPin?project(entry.position):null;
    const distance=pos?.inBounds&&state.player?.mapKey===state.mapKey?`${Math.round(Math.hypot(entry.x-state.player.x,entry.z-state.player.z))}m`:'';
    return `<button type="button" class="exit-list-item exit-${exitColor(entry)}" data-exit="${esc(entry.key)}"><span class="exit-list-icon">${exitIcon(entry)}</span><span class="exit-list-copy"><strong class="exit-list-name">${esc(entry.name)}</strong><span class="exit-list-meta">${esc(exitCategory(entry))} · ${esc(floor?.label||'좌표 미등록')}${floor?.otherFloor?' · 다른 층':''}${entry.canPin&&!pos?.inBounds?' · 지도 범위 밖':''}</span></span>${distance?`<span class="exit-list-distance">직선<br>${distance}</span>`:''}</button>`;
  }).join(''):`<p class="small-note">${state.mapDetailsStatus==='loading'?'공개 탈출구 데이터를 불러오는 중이에요.':state.mapDetailsStatus==='error'?'연결에 실패했어요. 상단 새로고침으로 다시 시도해 주세요.':needle?'검색어와 일치하는 탈출구가 없어요.':entries.length?'표시 필터를 켜면 목록을 볼 수 있어요.':'이 모드·지도에 공개된 탈출구 기록이 없어요.'}</p>`;
  if(state.selectedExit)renderExitDetail();
}
function closeExitDetail(){state.selectedExit=null;if($('exit-detail'))$('exit-detail').hidden=true;}
function openExit(key){
  const entry=currentExits().find(e=>e.key===key);if(!entry)return;
  state.selectedExit=key;if($('exit-list-panel'))$('exit-list-panel').hidden=true;if($('toggle-exit-list'))$('toggle-exit-list').setAttribute('aria-expanded','false');
  if(entry.canPin){const floor=classifyLocationFloor(entry.position,cfg()||{});if(floor.known&&!floor.ambiguous&&floor.ids.length===1)chooseFloor(floor.ids[0]);centerOn(entry.position);}
  renderExitDetail();renderMarkers();
}
function renderExitDetail(){
  const entry=currentExits().find(e=>e.key===state.selectedExit);if(!entry){closeExitDetail();return;}
  const panel=$('exit-detail'),content=$('exit-detail-content');if(!panel||!content)return;panel.hidden=false;
  const floor=entry.canPin?floorDescription(entry.position):'좌표 미등록';
  const distance=entry.canPin&&state.player?.mapKey===state.mapKey?`${Math.round(Math.hypot(entry.x-state.player.x,entry.z-state.player.z))}m · 수평 직선거리`:'촬영 위치를 읽으면 표시해요';
  const source=safeURL(entry.sourceURL),wiki=safeURL(entry.wikiLink);
  content.innerHTML=`<h3 class="exit-detail-name">${esc(entry.name)}</h3>${entry.nameEn&&entry.nameEn!==entry.name?`<p class="exit-detail-en">${esc(entry.nameEn)}</p>`:''}<div class="exit-detail-badges"><span class="exit-${exitColor(entry)}">${esc(exitCategory(entry))}</span><span>${esc(floor)}</span></div><dl class="exit-facts"><div><dt>지도</dt><dd>${esc(entry.mapName||mapName(state.mapKey))}</dd></div><div><dt>촬영 위치에서</dt><dd>${esc(distance)}</dd></div><div><dt>현재 활성 여부</dt><dd>미확인 · 게임의 탈출 목록 확인</dd></div>${entry.destinationMapId?`<div><dt>도착 지도</dt><dd>${esc(entry.destinationName)}</dd></div>`:''}</dl><strong>${entry.kind==='transit'?'공개된 이동 조건':'공개된 조건 정보'}</strong>${entry.conditionNotes.length?`<ul class="exit-condition-list">${entry.conditionNotes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`:'<p class="exit-detail-note">조건 정보가 등록되지 않았어요. 조건 없이 사용할 수 있다는 뜻은 아니에요.</p>'}<p class="exit-detail-note">레이드의 탈출 목록과 현장 조건을 확인해 주세요. 거리에는 벽·층간 이동 경로가 반영되지 않아요.</p>${!entry.canPin?'<p class="exit-detail-note">완전한 XYZ 좌표가 없어 지도에 점을 찍지 않았어요.</p>':''}<div class="exit-detail-source">${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">데이터 원본 ↗</a>`:''}${wiki?` · <a href="${esc(wiki)}" target="_blank" rel="noopener noreferrer">지도 안내 ↗</a>`:''}${entry.fetchedAt?`<br>${esc(time(entry.fetchedAt))} 확인`:''}</div>`;
}
function renderCaptureStatus(){
  const session=state.watchSession,capture=state.capture,p=state.player;
  const native=state.companion;
  text('capture-source-status',state.companionMode?(state.companionConnected?(native?.running?'PC 자동 감시 연결됨':'PC 감시 일시정지'):'PC 연결 확인 중'):session?`브라우저 연결됨 · ${session.handle.name}`:!('showDirectoryPicker'in window)?'브라우저 폴더 연결 미지원 · Windows 자동 추적을 이용하세요':'Windows 자동 추적 또는 브라우저 폴더 연결을 선택하세요');
  text('capture-file-name',capture?.filename||'아직 받은 파일 없음');
  const currentResult=capture?.ok&&p&&cfg()?(project(p)?.inBounds?(state.imageReady?`${mapName(state.mapKey)}에 마지막 촬영 위치를 표시했어요.`:'XYZ를 읽었어요. 지도 이미지를 기다리고 있어요.'):'XYZ를 읽었지만 선택한 맵 범위 밖이에요. 현재 맵을 확인해 주세요.'):capture?.message;
  text('capture-result',currentResult||(state.companionWaiting?'맵을 바꿨어요. 이 맵에서 새로 촬영해 주세요.':state.companionMode?'게임에서 새 스크린샷을 찍으면 자동으로 표시해요.':'원본 스크린샷을 열거나 자동 추적을 연결해 주세요.'));
  const checked=native?.lastScanAt||session?.lastCheck||capture?.receivedAt;
  text('capture-last-check',checked?new Date(checked).toLocaleTimeString('ko-KR',{hour12:false,timeZone:'Asia/Seoul'}):'아직 확인하지 않음');
  text('capture-folder-stats',state.companionMode?(native?.folder?`파일 ${native.totalFiles}개 · 이미지 ${native.imageFiles}개${native.readErrors?.length?` · 다시 확인 중 ${native.readErrors.length}개`:''}`:'감시 폴더를 한 번 지정해 주세요.'):session?.stats?`파일 ${session.stats.totalFiles}개 · 이미지 ${session.stats.imageFiles}개 · 이번 새 파일 ${session.stats.newFiles}개`:'Screenshots 폴더를 선택해 주세요.');
  let mapState=!cfg()?'지도 구성 대기 · 좌표 읽기는 가능':state.imageReady?(state.mapDisplayMode==='direct'?'전체 지도 표시 · 층 분리 불가':'지도 표시 준비됨'):state.mapDisplayMode==='error'?'지도 연결 실패 · 아래 좌표는 유지됨':'지도 이미지를 불러오는 중';
  if(p&&cfg()&&!project(p)?.inBounds)mapState='선택한 맵 범위 밖 · 현재 맵을 확인하세요';
  text('capture-map-status',mapState);
  if($('check-folder-now'))$('check-folder-now').disabled=state.companionMode?(!state.companionConnected||!native?.folder||state.companionBusy):!session||session.busy;
  if($('capture-result'))$('capture-result').classList.toggle('is-error',capture?.ok===false);
}
function renderLocation(){
  renderFloorStatus();
  const p=state.player?.mapKey===state.mapKey?state.player:null;
  const pos=p&&cfg()?project(p):null;
  $('center-player').disabled=!p||!state.imageReady||!pos?.inBounds;
  if(!p){
    text('location-status',state.capture?.ok===false?'파일 확인 필요':'스크린샷 대기');
    $('location-status').classList.remove('connected');
    text('position-info',state.companionMode?(state.companionWaiting?'현재 맵에서 새로 촬영하면 위치가 표시돼요.':'PC 자동 감시 대기 · 게임에서 스크린샷을 찍어 주세요.'):'Windows 자동 추적을 실행하거나 원본 스크린샷을 열어 주세요.');
    renderCaptureStatus();return;
  }
  const label=!cfg()?'좌표 읽음 · 지도 구성 대기':!pos?.inBounds?'좌표 읽음 · 맵 확인 필요':!state.imageReady?'좌표 읽음 · 지도 대기':state.capture?.ok===false?'이전 촬영 위치 · 새 파일 확인 필요':'마지막 촬영 위치';
  text('location-status',label);$('location-status').classList.toggle('connected',!!pos?.inBounds&&state.imageReady&&state.capture?.ok!==false);
  text('position-info',`X ${p.x.toFixed(2)} · Y ${p.y.toFixed(2)} · Z ${p.z.toFixed(2)}  |  ${p.captureLabel||p.capturedAt||'시각 미등록'} 촬영`);
  $('position-info').title=p.filename;renderCaptureStatus();
}
function captureFailure(filename,message,source='직접 열기',notify=true){
  state.capture={filename:String(filename||'').split(/[\\/]/).pop(),message,source,ok:false,receivedAt:new Date().toISOString()};
  renderLocation();if(notify)toast(message,true);return false;
}
function ingestFilename(filename,notify=true,source='직접 열기'){
  let parsed;
  try{parsed=geo.parseScreenshotFilename(filename);}catch{}
  if(!parsed||![parsed.x,parsed.y,parsed.z].every(Number.isFinite))return captureFailure(filename,'좌표 없는 파일명이에요. 게임 자체의 스크린샷 키로 저장한 원본 PNG가 필요해요. Windows·Steam 캡처인지 확인해 주세요.',source,notify);
  state.player={...parsed,filename:parsed.filename,mapKey:state.mapKey,receivedAt:new Date().toISOString()};
  const pos=cfg()?project(parsed):null;
  const message=!cfg()?'XYZ를 읽었어요. 지도 구성이 준비되면 표시해요.':!pos?.inBounds?'XYZ를 읽었지만 선택한 맵 범위 밖이에요. 맵을 바꾼 뒤 같은 파일을 다시 열어 주세요.':!state.imageReady?'XYZ를 읽었어요. 지도 연결 상태를 확인해 주세요.':`${mapName(state.mapKey)}에 촬영 위치를 표시했어요. 실제 플레이 중인 맵인지 확인해 주세요.`;
  state.capture={filename:parsed.filename,source,ok:true,message,receivedAt:state.player.receivedAt};
  followCapturedFloor();renderLocation();renderMarkers();renderExitList();if(state.followPlayer)centerOn(parsed);if(state.selected)renderDetail();
  if(notify)toast(message,!!cfg()&&!pos?.inBounds);return true;
}
function handleFiles(files){
  const ordered=[...files].sort((a,b)=>b.lastModified-a.lastModified);
  if(!ordered.length)return;
  for(const file of ordered){if(geo.parseScreenshotFilename(file.name)){ingestFilename(file.name,true,'파일 선택');if(questOcrController?.autoEnabled)void questOcrController.ingest(file,{automatic:true});if(typeof lootController!=='undefined'&&lootController?.autoEnabled&&state.view==='market')lootController.ingest(file);return;}}
  captureFailure(ordered[0].name,'위치 좌표가 없는 이미지예요. 퀘스트 이름은 캡처 인식으로 확인할 수 있어요.','파일 선택',false);
  if(state.view==='market')lootController.ingest(ordered[0]);else void questOcrController?.ingest(ordered[0]);
}
function renderOcrConnection(){
  const connected=state.companionMode?state.companionConnected&&state.companion?.running&&!!state.companion?.folder:!!state.watchSession;
  questOcrController?.setConnection({connected:!!connected,label:state.companionMode?'PC 자동 감시':'브라우저 폴더 감시'});
}
function companionImageKey(snapshot){return snapshot?.latestImage?`${snapshot.instanceId}:${snapshot.generation}:${snapshot.latestImage.imageRevision}`:'';}
function resetQuestOcrSource(){
  ocrSourceEpoch++;cancelBrowserQuestImage();ocrCompanionCursor=companionImageKey(state.companion);
  questOcrController?.cancelAutomatic();
}
function consumeCompanionQuestImage(snapshot){
  const key=companionImageKey(snapshot),image=snapshot.latestImage;
  if(!key||key===ocrCompanionCursor)return;
  ocrCompanionCursor=key;
  if(!(questOcrController?.autoEnabled||typeof lootController!=='undefined'&&lootController?.autoEnabled&&state.view==='market')||!snapshot.running||image.initial||!companionClient)return;
  const epoch=ocrSourceEpoch,mode=state.mode;
  companionClient.getCaptureImage(image).then(blob=>{
    if(epoch===ocrSourceEpoch&&mode===state.mode&&key===ocrCompanionCursor&&state.companion?.running){if(questOcrController?.autoEnabled)void questOcrController.ingest(blob,{automatic:true,name:image.name});if(typeof lootController!=='undefined'&&lootController?.autoEnabled&&state.view==='market')lootController.ingest(new File([blob],image.name,{type:'image/png'}));}
  }).catch(error=>{
    if(epoch!==ocrSourceEpoch||mode!==state.mode||key!==ocrCompanionCursor||!questOcrController?.autoEnabled||error.status===409)return;
    questOcrController.reportError(error.message||'새 캡처 이미지를 읽지 못했어요.');
  });
}
function cancelBrowserQuestImage(){ocrBrowserTicket++;if(ocrBrowserTimer)clearTimeout(ocrBrowserTimer);ocrBrowserTimer=null;}
function queueBrowserQuestImage(image,session){
  cancelBrowserQuestImage();const ticket=ocrBrowserTicket,epoch=ocrSourceEpoch,mode=state.mode;
  const readStable=async(previous,attempt)=>{
    if(epoch!==ocrSourceEpoch||mode!==state.mode||ticket!==ocrBrowserTicket||state.watchSession!==session||!(questOcrController?.autoEnabled||typeof lootController!=='undefined'&&lootController?.autoEnabled&&state.view==='market'))return;
    try{
      const file=await image.handle.getFile();
      if(epoch!==ocrSourceEpoch||mode!==state.mode||ticket!==ocrBrowserTicket||state.watchSession!==session||!(questOcrController?.autoEnabled||typeof lootController!=='undefined'&&lootController?.autoEnabled&&state.view==='market'))return;
      if(file.size!==previous.size||file.lastModified!==previous.lastModified){
        if(attempt<4)ocrBrowserTimer=setTimeout(()=>readStable(file,attempt+1),1000);
        else questOcrController.reportError('캡처 파일이 아직 저장 중이에요. 저장이 끝난 뒤 직접 열어 주세요.');
        return;
      }
      if(questOcrController?.autoEnabled)void questOcrController.ingest(file,{automatic:true,name:image.name});if(typeof lootController!=='undefined'&&lootController?.autoEnabled&&state.view==='market')lootController.ingest(file);
    }catch{if(ticket===ocrBrowserTicket)questOcrController?.reportError('캡처 파일을 읽지 못했어요. 폴더 연결과 저장 상태를 확인해 주세요.');}
  };
  ocrBrowserTimer=setTimeout(()=>readStable(image,0),1000);
}
function questOcrTaskInfo(id){
  const task=state.dataset?.tasks.find(task=>task.id===id);
  if(!task)return {maps:[],totalTargets:0,currentTargets:0,status:'todo'};
  const points=task.objectives.flatMap(objective=>objective.locations||[]).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.z));
  const keys=[...new Set([...task.mapIds,...points.map(point=>point.mapId)].map(mapKeyFor).filter(Boolean))];
  return {maps:keys.map(key=>({key,name:mapName(key),targets:points.filter(point=>mapKeyFor(point.mapId)===key).length})),totalTargets:points.length,currentTargets:locationsFor(task).length,status:statusOf(id)};
}
function showRecognizedQuest(id){
  document.body.classList.remove('quests-collapsed','map-focus');
  $('toggle-quests').setAttribute('aria-expanded','true');$('toggle-quests').textContent='퀘스트 접기';
  $('focus-map').setAttribute('aria-pressed','false');$('focus-map').textContent='지도 집중';
  if(state.view==='market')setView('map');
  openTask(id);
}
function applyRecognizedQuests(ids){
  const tasks=ids.map(id=>state.dataset?.tasks.find(task=>task.id===id)).filter(Boolean);
  if(!tasks.length)return;
  for(const task of tasks)if(questOcrTaskInfo(task.id).totalTargets)progress()[task.id]={...taskProgress(task.id),pinned:true};
  saveProgress();state.showQuestMarkers=true;$('show-quests').checked=true;
  renderSummary();renderQuests();renderMarkers();
  if(!tasks.some(task=>questOcrTaskInfo(task.id).totalTargets))openTask(tasks[0].id);
}
function renderCapturedSummary(){
  const section=$('capture-summary'),count=state.capturedQuestIds.length;
  section.hidden=!count;$('intel-scan-count').textContent=String(count);
  text('capture-summary-count',`${count}개 퀘스트 인식`);
  text('capture-summary-text',state.capturedCandidateCount?`지도 목표 자동 표시 · 확인 필요 ${state.capturedCandidateCount}개`:'일치하는 퀘스트 전체 지도 표시 · 완료 상태 유지');
}
function showCapturedBatch(ids,candidateCount=0){
  const unique=[...new Set(ids)].filter(id=>state.dataset?.tasks.some(task=>task.id===id));
  if(!unique.length)return;
  state.capturedQuestIds=unique;state.capturedCandidateCount=candidateCount;
  state.search='';state.trader='all';state.status='all';state.mapFilter='captured';state.renderLimit=Math.max(70,unique.length);
  $('quest-search').value='';$('trader-filter').value='all';$('quest-state-filter').value='all';
  setView('map',{keepFilter:true});$('map-filter').value='captured';
  const selected=unique.map(id=>state.dataset.tasks.find(t=>t.id===id)).find(task=>locationsFor(task).length) || state.dataset.tasks.find(task=>task.id===unique[0]);
  if(selected)openTask(selected.id);renderCapturedSummary();
  const visible=selected&&locationsFor(selected)[0];if(visible)requestAnimationFrame(()=>centerOn(visible));
  const currentTargets=unique.map(id=>state.dataset.tasks.find(t=>t.id===id)).reduce((sum,task)=>sum+(task?locationsFor(task).length:0),0);
  toast(`퀘스트 ${unique.length}개 등록 완료 · 현재 지도 목표 ${currentTargets}곳${candidateCount?` · 이름 확인 필요 ${candidateCount}개`:''}`);
}

async function connectFolder(){
  if(!('showDirectoryPicker'in window)){
    text('watch-status','이 브라우저에서는 수동으로 불러와요. 자동 연결은 Chrome·Edge에서 시도해 주세요.');
    $('folder-fallback').click();toast('자동 연결 미지원 · 선택한 폴더의 최신 원본을 한 번 불러옵니다.');return;
  }
  $('connect-folder').disabled=true;
  try{
    const handle=await window.showDirectoryPicker({mode:'read',id:'tarkov-screenshots',startIn:'documents'});
    stopWatching('');
    const session={handle,seen:new Set(),busy:false,lastCheck:null,stats:null};
    state.watchSession=session;state.watchHandle=handle;
    $('disconnect-folder').hidden=false;$('connect-folder').textContent='자동 추적 연결됨';
    text('watch-status',`연결됨: ${handle.name} · 기존 최신 원본을 확인하고 있어요.`);renderCaptureStatus();
    // The first scan imports the latest existing original, then only new names.
    await pollFolder(session,true);
    if(state.watchSession===session)state.watchTimer=setInterval(()=>pollFolder(session),2000);
  }catch(error){
    if(error.name!=='AbortError'){
      const message='폴더 접근이 제한됐어요. Chrome·Edge에서 열거나 ‘스크린샷 열기’로 원본 PNG를 선택해 주세요.';
      text('watch-status',message);toast(message,true);
    }
  }finally{$('connect-folder').disabled=false;renderCaptureStatus();}
}
async function pollFolder(session=state.watchSession,initial=false){
  if(!session||session!==state.watchSession||session.busy)return;
  session.busy=true;renderCaptureStatus();
  try{
    const result=await scanScreenshotDirectory(session.handle,session.seen);
    if(session!==state.watchSession)return;
    session.seen=result.seen;session.lastCheck=result.observedAt;session.stats=result;
    if(!initial&&result.latestImage&&(questOcrController?.autoEnabled||typeof lootController!=='undefined'&&lootController?.autoEnabled&&state.view==='market'))queueBrowserQuestImage(result.latestImage,session);
    renderOcrConnection();
    if(result.latest){
      ingestFilename(result.latest.name,false,'폴더 자동');
      text('watch-status',`연결됨: ${session.handle.name} · ${initial?'기존 최신 원본 확인':'새 원본 반영'} · ${time(result.observedAt)}`);
    }else if(result.latestRejected){
      captureFailure(result.latestRejected.name,'새 이미지는 발견했지만 좌표가 없는 파일명이에요. Windows·Steam 캡처 대신 게임의 스크린샷 기능을 사용해 주세요.','폴더 자동',false);
      text('watch-status','이미지 발견 · 원본 좌표 없음');
    }else if(initial){
      text('watch-status',result.imageFiles?'좌표가 있는 원본을 찾지 못했어요. 선택한 폴더를 확인해 주세요.':'이 폴더에 이미지가 없어요. Documents 안의 Escape from Tarkov/Screenshots를 선택해 주세요.');
    }else if(result.readErrors.length===0){
      text('watch-status',`연결됨: ${session.handle.name} · 새 촬영 대기 · ${time(result.observedAt)} 확인`);
    }
    if(result.readErrors.length)text('watch-status',`${result.readErrors.length}개 파일을 아직 읽을 수 없어요. 기록 중일 수 있어 다음 검사에서 다시 확인해요.`);
  }catch(error){
    if(session===state.watchSession)stopWatching('폴더 권한 또는 연결을 확인해 주세요. 자동 추적 시작으로 다시 연결할 수 있어요.');
  }finally{
    session.busy=false;
    if(session===state.watchSession)renderCaptureStatus();
  }
}
function stopWatching(message='자동 추적을 해제했어요. 원본 파일은 직접 열 수 있어요.'){
  if(state.watchTimer)clearInterval(state.watchTimer);
  state.watchTimer=null;state.watchSession=null;state.watchHandle=null;
  resetQuestOcrSource();renderOcrConnection();
  $('disconnect-folder').hidden=true;$('connect-folder').textContent='브라우저에서 폴더 연결';
  if(message)text('watch-status',message);renderCaptureStatus();
}
function downloadDiagnostics(){
  const native=state.companion;
  const report={app:'tarkov-field-guide',revision:'2026.11.12-r5',createdAt:new Date().toISOString(),environment:{protocol:location.protocol,secureContext:window.isSecureContext,directoryPicker:'showDirectoryPicker'in window,pcCompanion:state.companionMode},map:{key:state.mapKey,hasConfig:!!cfg(),imageReady:state.imageReady,displayMode:state.mapDisplayMode},capture:state.capture,position:state.player?{x:state.player.x,y:state.player.y,z:state.player.z,captureLabel:state.player.captureLabel}:null,folder:state.watchSession?{name:state.watchSession.handle.name,lastCheck:state.watchSession.lastCheck,totalFiles:state.watchSession.stats?.totalFiles,imageFiles:state.watchSession.stats?.imageFiles,readErrors:state.watchSession.stats?.readErrors}:null,companion:native?{version:native.version,connected:state.companionConnected,running:native.running,status:native.status,lastScanAt:native.lastScanAt,totalFiles:native.totalFiles,imageFiles:native.imageFiles,readErrors:native.readErrors,error:native.error,connectionError:state.companionError}:null};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='tarkov-capture-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('진단 파일을 저장했어요. 원본 이미지나 전체 폴더 내용은 포함하지 않아요.');
}
function saveCompanionGate(){try{if(state.companionGate)sessionStorage.setItem('tfg-companion-map-gate',JSON.stringify(state.companionGate));else sessionStorage.removeItem('tfg-companion-map-gate');}catch{}}
function waitForCompanionCapture(){
  const s=state.companion;
  companionCursor.waitForNext(s);state.companionWaiting=true;
  state.companionGate={mapKey:state.mapKey,source:s?`${s.instanceId}:${s.generation}`:null,eventRevision:s?.eventRevision||0,pending:!s};
  saveCompanionGate();renderCompanionStatus();
}
function renderCompanionStatus(){
  if(!state.companionMode)return;
  const s=state.companion,connected=state.companionConnected;
  const failed=!!state.companionError||['folder-missing','folder-error'].includes(s?.status);
  const label=!connected?'PC 연결 끊김':!s?.folder?'감시 폴더 선택 필요':!s.running?'자동 추적 일시정지':failed?'폴더 확인 필요':state.companionWaiting?'이 맵의 새 촬영 대기':'PC 자동 감시 중';
  text('companion-status',label);text('watch-status',label);
  const badge=$('companion-status');badge.classList.toggle('is-connected',connected&&!!s?.folder&&s.running&&!failed);badge.classList.toggle('is-error',failed);badge.classList.toggle('is-paused',connected&&!s?.running);
  text('companion-folder',s?.folder||'스크린샷 폴더를 자동으로 찾지 못했어요. 감시 폴더를 한 번 선택해 주세요.');
  text('companion-detail',state.companionError||s?.error?.message||s?.configWarning||(s?.readErrors?.length?'저장 중인 파일을 다음 검사에서 다시 확인해요.':state.companionWaiting?'선택한 맵에서 새로 찍거나, ‘마지막 촬영 다시 표시’를 눌러 주세요.':!s?.folder?'‘감시 폴더 변경’으로 실제 Screenshots 폴더를 지정해 주세요.':!s.running?'추적을 재개하면 그동안 저장된 최신 스크린샷을 확인해요.':'게임에서 촬영하면 위치가 갱신돼요. 이 지도 화면을 다시 열어도 마지막 촬영을 받아요.'));
  $('companion-pause').textContent=s?.running?'추적 일시정지':'추적 재개';
  $('companion-pause').disabled=!connected||!s?.folder||state.companionBusy;
  $('companion-choose-folder').disabled=!connected||state.companionBusy||!!s?.pickerBusy;
  $('companion-set-folder').disabled=!connected||state.companionBusy||!!s?.pickerBusy;
  $('companion-latest').disabled=!connected||!s?.latest;
  if(s?.capabilities?.folderPicker===false)$('companion-choose-folder').hidden=true;
  renderCaptureStatus();
}
function acceptCompanionEvent(event){
  if(!event)return;
  if(event.kind==='capture'){
    ingestFilename(event.name,false,'PC 자동 감시');state.companionWaiting=false;state.companionGate=null;saveCompanionGate();
  }else{
    if(event.validBeforeRejection){ingestFilename(event.validBeforeRejection.name,false,'PC 자동 감시');state.companionWaiting=false;state.companionGate=null;saveCompanionGate();}
    captureFailure(event.name,'새 이미지를 감지했지만 원본 좌표가 없어요. 타르코프 게임 자체의 스크린샷 키로 촬영해 주세요.','PC 자동 감시',false);
  }
}
function applyCompanionSnapshot(snapshot){
  const previous=state.companion;
  state.companion=snapshot;state.companionConnected=true;state.companionError='';
  if(previous&&(previous.generation!==snapshot.generation||previous.instanceId!==snapshot.instanceId)){
    resetQuestOcrSource();
    state.player=null;state.capture=null;state.companionGate=null;state.companionWaiting=false;saveCompanionGate();renderMarkers();
  }
  if(previous?.running&&!snapshot.running)resetQuestOcrSource();
  const gate=state.companionGate;
  if(gate&&!previous&&gate.mapKey===state.mapKey){
    if(gate.pending)companionCursor.waitForNext(snapshot);
    else if(gate.source===`${snapshot.instanceId}:${snapshot.generation}`)companionCursor.waitForNext({...snapshot,eventRevision:gate.eventRevision,latest:null,latestRejected:null});
  }
  const log=snapshot.logs;
  if(log?.revision>(typeof lastAutoMapRev==='undefined'?0:lastAutoMapRev)){lastAutoMapRev=log.revision;
    if(!log.latest?.historical && log.latest?.mapKey && log.latest.mapKey!==state.mapKey && state.configs.some(c=>c.key===log.latest.mapKey)){
      const next=log.latest.mapKey;
      void selectMap(next).then(()=>{if(state.companion?.latest)acceptCompanionEvent(companionCursor.next(state.companion,{replay:true}));renderLocation();});
      toast(`게임 로그에서 ${mapName(next)} 진입 감지 · 맵 자동 전환`);
      renderCompanionStatus();return;
    }
  }
  acceptCompanionEvent(companionCursor.next(snapshot));
  consumeCompanionQuestImage(snapshot);renderOcrConnection();
  renderCompanionStatus();renderLocation();if(previous?.logs?.revision!==snapshot.logs?.revision&&typeof opsController!=='undefined')opsController?.refresh();
}
async function companionAction(route,body){
  if(!companionClient||state.companionBusy)return;
  state.companionBusy=true;renderCompanionStatus();
  try{
    const result=await companionClient.request(route,body,route==='choose-folder'?310000:10000);
    if(result.cancelled)toast('폴더 선택을 취소했어요.');
    await companionClient.refresh();
  }catch(error){toast(error.message||'자동 추적 설정을 바꾸지 못했어요.',true);}
  finally{state.companionBusy=false;renderCompanionStatus();}
}
function initializeCompanion(){
  const bootstrap=readCompanionBootstrap(document,location);
  if(!bootstrap)return;
  state.companionMode=true;
  document.body.classList.add('using-companion');$('capture-diagnostics').open=false;
  try{const gate=JSON.parse(sessionStorage.getItem('tfg-companion-map-gate')||'null');if(gate?.mapKey===state.mapKey){state.companionGate=gate;state.companionWaiting=true;}}catch{}
  $('companion-controls').hidden=false;$('companion-folder-entry').hidden=false;$('download-companion').hidden=true;
  $('connect-folder').hidden=true;$('disconnect-folder').hidden=true;
  text('companion-status','PC 연결 중');
  text('diagnostics-start-note','PC가 스크린샷 폴더를 감시');
  text('diagnostics-instructions','현재 맵을 선택하고 게임에서 촬영하세요. 폴더 감시는 실행 창을 열어 둔 동안 계속돼요.');
  $('companion-choose-folder').addEventListener('click',()=>companionAction('choose-folder',{}));
  $('companion-set-folder').addEventListener('click',()=>companionAction('folder',{folder:$('companion-folder-path').value.trim()}));
  $('companion-folder-path').addEventListener('keydown',e=>{if(e.key==='Enter')$('companion-set-folder').click();});
  $('companion-pause').addEventListener('click',()=>companionAction('running',{running:!state.companion?.running}));
  $('companion-latest').addEventListener('click',()=>{acceptCompanionEvent(companionCursor.next(state.companion,{replay:true}));renderCompanionStatus();});
  companionClient=createCompanionClient({bootstrap,onState:applyCompanionSnapshot,onError:error=>{state.companionConnected=false;state.companionError=error.message==='Failed to fetch'?'자동 추적 실행 창이 켜져 있는지 확인해 주세요. 다시 실행했다면 이 지도 화면을 새로고침해 주세요.':error.message;renderCompanionStatus();renderOcrConnection();}});
  companionClient.refresh();
}
function renderFilters(){
  const allTasks=state.dataset?.tasks||[];
  const known=state.dataset?.traders||[];
  const byId=new Map(known.map(t=>[t.id,{id:t.id,name:t.name,nameEn:t.nameEn,count:0}]));
  // Data providers may list a quest giver absent from the separate trader feed.
  for(const task of allTasks){
    if(!task.traderId)continue;
    if(!byId.has(task.traderId))byId.set(task.traderId,{id:task.traderId,name:task.traderName||'상인 확인 필요',nameEn:task.traderNameEn||'',count:0});
    byId.get(task.traderId).count++;
  }
  $('trader-filter').innerHTML='<option value="all">모든 상인</option>'+[...byId.values()]
    .sort((a,b)=>a.name.localeCompare(b.name,'ko'))
    .map(t=>`<option value="${esc(t.id)}">${esc(t.name)}${t.nameEn&&t.nameEn!==t.name?' ('+esc(t.nameEn)+')':''} · ${fmt.format(t.count)}개</option>`).join('');
  $('trader-filter').value=state.trader;
  if(!$('trader-filter').value){state.trader='all';$('trader-filter').value='all';}
  renderMapList();
}
function filteredTasks(){const query=state.search.toLocaleLowerCase().replace(/\s/g,'');const map=state.mapFilter==='current'?state.mapKey:state.mapFilter;return (state.dataset?.tasks||[]).filter(t=>(map!=='captured'||state.capturedQuestIds.includes(t.id))&&(!query||[t.name,t.nameEn,t.traderName,...t.objectives.map(o=>o.description)].join(' ').toLocaleLowerCase().replace(/\s/g,'').includes(query))&&(state.trader==='all'||t.traderId===state.trader)&&(state.status==='all'||statusOf(t.id)===state.status)&&(map==='all'||map==='captured'||matchesMap(t,map))).sort((a,b)=>(taskProgress(b.id).pinned?1:0)-(taskProgress(a.id).pinned?1:0)||(statusOf(a.id)==='active'?-1:0)-(statusOf(b.id)==='active'?-1:0)||(a.minPlayerLevel||0)-(b.minPlayerLevel||0)||a.name.localeCompare(b.name,'ko'));}
function renderQuests(){
  const list=$('quest-list');if(!state.dataset)return;
  const tasks=filteredTasks();text('quest-count',`${fmt.format(tasks.length)}개`);text('quest-panel-title',state.view==='quests'?'전체 퀘스트':'이번 레이드의 퀘스트');
  if(!tasks.length){list.innerHTML='<div class="empty-state"><span class="empty-symbol">⌕</span><strong>조건에 맞는 퀘스트가 없어요</strong><p>검색어를 줄이거나 지도·상인 필터를 바꿔 보세요.</p><button class="btn btn-small" data-action="reset-filters">필터 초기화</button></div>';return;}
  list.innerHTML=tasks.slice(0,state.renderLimit).map(task=>{const status=statusOf(task.id);const p=taskProgress(task.id);const points=locationsFor(task);const maps=[...new Set(task.mapIds.map(mapKeyFor))].map(mapName);return `<article class="quest-card ${state.selected===task.id?'selected':''} ${status==='done'?'is-complete':''}"><button class="quest-open" data-task="${esc(task.id)}"><div class="quest-meta"><span>${esc(task.traderName||'상인 확인 필요')}</span><span>요구 Lv.${Number(task.minPlayerLevel)||1}</span></div><h3 class="quest-title">${esc(task.name)}</h3>${task.nameEn&&task.nameEn!==task.name?`<p class="quest-name-en">${esc(task.nameEn)}</p>`:''}<div class="quest-card-bottom"><span class="badge status-${status}">${STATUS_LABELS[status]}</span>${task.kappaRequired?'<span class="badge badge-kappa">KAPPA</span>':''}<span class="quest-map-label">${esc(maps.slice(0,2).join(' · ')||'여러 지역 / 위치 미등록')}${maps.length>2?' 외':''}</span></div></button><button class="quest-pin ${p.pinned?'pinned':''}" data-pin="${esc(task.id)}" aria-label="${esc(task.name)} ${p.pinned?'지도 표시 해제':'지도 표시'}" title="${p.pinned?'지도 표시 해제':'지도에 목표 표시'}" aria-pressed="${!!p.pinned}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3h8l-1 7 4 4v2H5v-2l4-4-1-7zM12 16v6"/></svg></button></article>`;}).join('')+(tasks.length>state.renderLimit?`<button class="btn load-more" data-action="load-more">퀘스트 더 보기 (${fmt.format(tasks.length-state.renderLimit)}개)</button>`:'');
}
function openTask(id){const task=state.dataset?.tasks.find(t=>t.id===id);if(!task)return;state.selected=id;$('quest-detail').hidden=false;$('intel-blank').hidden=true;$('quest-panel').classList.add('has-detail');renderDetail();renderQuests();renderMarkers();}
function closeDetail(){state.selected=null;$('quest-detail').hidden=true;$('intel-blank').hidden=false;$('quest-browser').hidden=false;$('quest-panel').classList.remove('has-detail');renderQuests();renderMarkers();}
function notesHTML(notes){return notes?.length?`<ul class="condition-list">${notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`:'';}
function renderDetail(){
  const task=state.dataset?.tasks.find(t=>t.id===state.selected);if(!task)return;
  const p=taskProgress(task.id),locations=locationsFor(task);
  const allLocationCount=task.objectives.reduce((n,o)=>n+o.locations.length,0);
  const maps=[...new Set(task.mapIds.map(mapKeyFor))];
  const objectiveHTML=task.objectives.map(o=>{
    const done=!!p.objectives?.[o.id],pins=locations.filter(l=>l.objective.id===o.id);
    const count=Number.isFinite(o.count)?o.count:null;
    const choices=o.items?.length>1;
    return `<div class="objective-item ${done?'objective-done':''}">
      <label class="objective-label"><input type="checkbox" data-objective="${esc(o.id)}" ${done?'checked':''} ${o.id?'':'disabled'}><span>
      <strong>${esc(o.description||o.descriptionEn||'목표 설명 미등록')}</strong>
      <span class="objective-tags">${count!==null?`<span>수량 ${fmt.format(count)}</span>`:''}${o.foundInRaid?'<span>레이드 획득 필요</span>':''}${o.optional?'<span>선택 목표</span>':''}</span></span></label>
      ${o.items?.length?`<div class="objective-items">${choices?'<span class="small-note">허용 아이템 후보 · 수량과 조합은 목표 설명 기준</span>':''}${o.items.map(it=>`<span>${esc(it.name||'아이템 이름 미등록')}${!choices&&it.count?' × '+esc(it.count):''}</span>`).join('')}</div>`:''}
      ${notesHTML(o.conditionNotes)}
      ${pins.length?`<button class="objective-locate" data-focus-objective="${esc(o.id)}">${pins.some(l=>l.kind==='possible')?`등장 후보 ${pins.length}곳 보기`:pins.length>1?`구역 ${pins.length}곳 보기`:'지도에서 보기'} <span>↗</span></button>`:'<div class="objective-location-note">이 지도에 등록된 고정 좌표 없음</div>'}
    </div>`;
  }).join('');
  const reqs=(task.requirements||[]).map(r=>{
    const prerequisite=state.dataset.tasks.find(t=>t.id===r.taskId);if(!prerequisite)return '';
    const statuses=Array.isArray(r.status)?r.status:[];
    const met=(statuses.includes('complete')&&statusOf(r.taskId)==='done')||(statuses.includes('active')&&statusOf(r.taskId)==='active');
    return `<button class="requirement" data-task="${esc(prerequisite.id)}"><span class="requirement-check">${met?'✓':'○'}</span><span>${esc(prerequisite.name)}${statuses.length?` <small>(필요: ${esc(statuses.map(s=>({complete:'완료',active:'진행 중',failed:'실패'})[s]||s).join(' / '))})</small>`:''}</span><span>↗</span></button>`;
  }).join('');
  const wiki=safeURL(task.wikiLink);
  const detailURL='https://tarkov.dev/task/'+encodeURIComponent(task.normalizedName||task.raw?.normalizedName||task.id);
  const rewardSections=[['시작 보상',task.startRewards],['완료 보상',task.finishRewards],['실패 시 변화',task.failureOutcome]].filter(([,reward])=>reward?.notes?.length).map(([title,reward])=>`<section class="detail-section"><h3>${title}</h3>${notesHTML(reward.notes)}</section>`).join('');
  $('quest-detail-content').innerHTML=`
    <div class="detail-header"><div class="quest-meta"><span>${esc(task.traderName)}</span><span>요구 Lv.${Number(task.minPlayerLevel)||1} 이상</span></div><h2>${esc(task.name)}</h2>${task.nameEn!==task.name?`<p class="detail-en">${esc(task.nameEn)}</p>`:''}<div class="detail-badges">${task.kappaRequired?'<span class="badge badge-kappa">KAPPA 필수</span>':''}${task.lightkeeperRequired?'<span class="badge">등대지기 필수</span>':''}${task.experience?`<span class="badge">${fmt.format(task.experience)} XP</span>`:''}</div></div>
    <div class="task-actions"><label class="status-label">진행 상태<select id="detail-status" aria-label="퀘스트 진행 상태">${Object.entries(STATUS_LABELS).map(([key,name])=>`<option value="${key}" ${statusOf(task.id)===key?'selected':''}>${name}</option>`).join('')}</select></label><button class="btn ${p.pinned?'is-active':'btn-primary'}" data-pin="${esc(task.id)}">${p.pinned?'지도 표시 해제':'지도에 목표 표시'}</button></div>
    <div class="detail-map-chips">${maps.map(key=>`<button class="chip" data-map-jump="${esc(key)}">${esc(mapName(key))} ↗</button>`).join('')}</div>
    ${!state.dataset.allItemNamesLoaded?`<div class="item-names-note"><button class="btn btn-small" data-action="load-items" ${state.itemsLoading?'disabled':''}>${state.itemsLoading?'물품 이름 불러오는 중…':'아이템·열쇠 이름 불러오기'}</button><p class="small-note">${esc(state.itemError||'일반 아이템 이름은 추가 데이터를 불러오면 표시돼요.')}</p></div>`:''}
    ${task.requirementNotes?.length?`<section class="detail-section"><h3>추가 수락 조건</h3>${notesHTML(task.requirementNotes)}</section>`:''}
    <section class="detail-section"><div class="section-heading"><h3>수행 목표</h3><span>${task.objectives.filter(o=>p.objectives?.[o.id]).length} / ${task.objectives.length}</span></div>${objectiveHTML||'<p class="muted">공개 데이터에 목표 설명이 등록되지 않았어요.</p>'}</section>
    ${reqs?`<section class="detail-section"><h3>선행 퀘스트</h3>${reqs}<p class="small-note">수락 가능 여부는 게임 안의 레벨·평판·분기 조건도 확인하세요.</p></section>`:''}
    ${task.failureNotes?.length?`<section class="detail-section"><h3>실패 조건</h3>${notesHTML(task.failureNotes)}</section>`:''}
    ${rewardSections}
    <section class="detail-section"><h3>위치 정보</h3><p class="muted">${allLocationCount?`공개 데이터에 목표 위치 ${allLocationCount}곳이 등록되어 있어요. 선택한 지도에는 ${locations.length}곳이 있어요. 구역 표시는 구역의 기준점이고, 등장 후보는 가능한 위치예요.`:'고정 좌표가 등록되지 않은 퀘스트예요. 목표 설명과 원문 공략을 확인해 주세요.'}</p><p class="small-note">층은 직접 선택하세요. 표시는 평면 위치이며 다른 층의 목표가 겹칠 수 있어요.</p></section>
    <div class="detail-links"><a class="btn btn-small" href="${esc(detailURL)}" target="_blank" rel="noopener noreferrer">데이터 원문 ↗</a>${wiki?`<a class="btn btn-small" href="${esc(wiki)}" target="_blank" rel="noopener noreferrer">위키 공략 ↗</a>`:''}</div>`;
}
async function loadItemNames(force=false){
  if(!state.dataset||state.itemsLoading||state.dataset.allItemNamesLoaded&&!force)return;
  const mode=state.mode,seq=state.dataSequence;state.itemsLoading=true;state.itemError='';if(state.selected)renderDetail();
  try{
    let catalog=!force?await cachedGet('items:'+mode):null;
    if(!catalog?.items?.length||Date.now()-new Date(catalog.fetchedAt).getTime()>86400000)catalog=await fetchItemCatalog(mode,{signal:dataAbort?.signal});
    if(seq!==state.dataSequence||mode!==state.mode)return;
    state.dataset=applyItemCatalog(state.dataset,catalog);
    await cachedPut('items:'+mode,catalog);await cachedPut('quests:'+mode,state.dataset);
    if(force)toast('아이템·열쇠·무기·보상 이름을 불러왔어요.');
  }catch(error){if(error.name!=='AbortError'&&seq===state.dataSequence)state.itemError='물품 이름을 가져오지 못했어요. 목표 설명과 원문 공략을 확인하거나 다시 시도해 주세요.';}
  finally{if(seq===state.dataSequence){state.itemsLoading=false;if(state.selected)renderDetail();}}
}
function togglePin(id){const p=taskProgress(id);const task=state.dataset.tasks.find(t=>t.id===id);if(!p.pinned&&!task.objectives.some(o=>o.locations.length)){toast('이 퀘스트에는 등록된 좌표가 없어요. 상세 목표와 원문 공략을 확인해 주세요.',true);openTask(id);return;}updateProgress(id,{pinned:!p.pinned});if(!p.pinned&&!locationsFor(task).length)toast('목표를 지도에 고정했어요. 상세 화면에서 해당 맵을 선택해 주세요.');}
function setView(view,{keepFilter=false}={}){
  if(view==='quests'){
    document.body.classList.remove('map-focus','quests-collapsed');
    $('toggle-quests').setAttribute('aria-expanded','true');$('toggle-quests').textContent='퀘스트 목록 접기';
    $('focus-map').setAttribute('aria-pressed','false');$('focus-map').textContent='지도 크게 보기';
  }
  state.view=view;document.body.dataset.view=view;
  $('map-view').hidden=view!=='map';$('market-view').hidden=view!=='market';
  marketController.setActive(view==='market');
  const all=$('all-quests-view');if(all)all.hidden=view!=='quests';
  document.querySelectorAll('[data-view]').forEach(el=>{if(el!==document.body){el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}});
  if(!keepFilter){state.mapFilter=view==='quests'?'all':'current';$('map-filter').value=state.mapFilter;}
  $('quest-browser').hidden=false;
  renderQuests();if(view==='map')requestAnimationFrame(fitMap);
}

let dataAbort;
function acceptMapSnapshot(snapshot,fromCache=false){
  if(!snapshot||snapshot.mode!==state.mode)return;
  if(snapshot.maps?.length){state.mapDataset=snapshot;state.mapDetailsStatus=fromCache?'cached':'ready';if(!fromCache)cachedPut('map-details:'+state.mode,snapshot);}
  else state.mapDetailsStatus=state.mapDataset?.maps?.length?'cached':'error';
  renderMapList();renderExitList();mapIntelController?.refresh();renderMarkers();
}
async function loadData(force=false){
  const mode=state.mode,seq=++state.dataSequence;state.itemsLoading=false;state.itemError='';
  if(dataAbort)dataAbort.abort();dataAbort=new AbortController();
  $('refresh-data').disabled=true;text('data-status','퀘스트 데이터 연결 중');
  if(state.mapDataset?.mode!==mode){state.mapDataset=null;state.mapDetailsStatus='loading';closeExitDetail();renderExitList();renderMarkers();}
  if(!state.dataset||state.dataset.mode!==mode){
    state.dataset=null;closeDetail();
    $('quest-list').innerHTML='<div class="empty-state"><span class="loading-orbit"></span><strong>전체 퀘스트를 불러오는 중</strong><p>목표·한국어 이름·지도 정보를 함께 정리해요.</p></div>';renderSummary();
    const [cached,cachedMaps]=await Promise.all([cachedGet('quests:'+mode),cachedGet('map-details:'+mode)]);
    if(seq!==state.dataSequence)return;
    if(cachedMaps?.maps?.length)acceptMapSnapshot({...cachedMaps,mode},true);
    if(cached?.tasks?.length){
      state.dataset=cached;if(!state.mapDataset&&cached.maps?.length)acceptMapSnapshot({maps:cached.maps,mode,fetchedAt:cached.fetchedAt,source:cached.source},true);
      renderFilters();renderQuests();renderSummary();questOcrController?.dataReady();text('data-status',`${MODE_LABELS[mode]} · 저장된 ${fmt.format(cached.tasks.length)}개 · 업데이트 확인 중`);
    }
  }
  try{
    const data=await fetchQuestDataset(mode,{
      signal:dataAbort.signal,
      onProgress:message=>{if(seq===state.dataSequence)text('data-status',message);},
      onMaps:snapshot=>{if(seq===state.dataSequence)acceptMapSnapshot(snapshot);},
    });
    if(seq!==state.dataSequence)return;
    if(!data?.tasks?.length)throw new Error('등록된 퀘스트를 찾지 못했어요.');
    state.dataset={...data,mode};
    if(data.maps?.length)acceptMapSnapshot({maps:data.maps,mode,fetchedAt:data.fetchedAt,source:data.source,partialWarnings:data.partialWarnings});
    loadItemNames();await cachedPut('quests:'+mode,state.dataset);
    renderFilters();renderQuests();renderSummary();renderMarkers();renderExitList();if(state.selected)renderDetail();
    text('data-status',`${MODE_LABELS[mode]} · ${fmt.format(data.tasks.length)}개 · ${time(data.fetchedAt||Date.now())} 확인`);
    $('data-status').classList.remove('is-error');$('data-status').title=(data.partialWarnings||[]).join('\n')||'공개 데이터에 등록된 퀘스트 전체. 개인별 일일·주간 임무는 포함하지 않습니다.';
    if(data.partialWarnings?.length)toast(data.partialWarnings[0],true);else if(force)toast('공개 퀘스트 데이터를 새로 불러왔어요.');
  }catch(error){
    if(seq!==state.dataSequence||error.name==='AbortError')return;
    if(state.mapDetailsStatus==='loading'){state.mapDetailsStatus=state.mapDataset?.maps?.length?'cached':'error';renderExitList();}
    if(state.dataset?.tasks?.length){text('data-status',`오프라인 데이터 · ${fmt.format(state.dataset.tasks.length)}개 · ${time(state.dataset.fetchedAt)} 확인`);toast('최신 데이터에 연결하지 못해 이 브라우저에 저장된 퀘스트를 보여드려요.',true);}
    else{text('data-status','데이터 연결 실패');text('quest-count','연결 대기');$('data-status').classList.add('is-error');$('quest-list').innerHTML=`<div class="empty-state"><strong>퀘스트를 불러오지 못했어요</strong><p>인터넷 연결 또는 공개 데이터 서버 상태를 확인해 주세요. 실제 데이터를 가져오기 전에는 퀘스트 개수를 표시하지 않아요.</p><p class="small-note">${esc(error.message)}</p><button class="btn btn-primary" data-action="retry-data">다시 불러오기</button><a class="btn btn-small" href="https://tarkov.dev/tasks" target="_blank" rel="noopener noreferrer">원본 퀘스트 목록 ↗</a></div>`;}
  }finally{if(seq===state.dataSequence){$('refresh-data').disabled=false;questOcrController?.dataReady();}}
}

function exportProgress(){const payload={schemaVersion:1,app:'tarkov-field-guide',exportedAt:new Date().toISOString(),progress:state.progress};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tarkov-progress-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('진행 상황 백업 파일을 내보냈어요.');}
async function importProgress(file){if(!file)return;try{if(file.size>5*1024*1024)throw new Error('5MB 이하 파일을 선택해 주세요.');const data=JSON.parse(await file.text());if(data.app!=='tarkov-field-guide'||data.schemaVersion!==1||!data.progress||typeof data.progress!=='object')throw new Error('이 도구에서 내보낸 백업 파일이 아니에요.');const cleaned={};let count=0;for(const mode of Object.keys(MODE_LABELS)){const entries=data.progress[mode];if(!entries||typeof entries!=='object'||Array.isArray(entries))continue;cleaned[mode]={};for(const [id,p]of Object.entries(entries)){if(!/^[a-zA-Z0-9:_-]{1,80}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||!p||typeof p!=='object'||!Object.hasOwn(STATUS_LABELS,p.status))continue;const objectives={};for(const [oid,value]of Object.entries(p.objectives||{}))if(/^[a-zA-Z0-9:_-]{1,100}$/.test(oid)&&!['__proto__','constructor','prototype'].includes(oid)&&typeof value==='boolean')objectives[oid]=value;cleaned[mode][id]={status:p.status,pinned:!!p.pinned,objectives};count++;}}if(!count)throw new Error('복원할 진행 기록이 없어요.');for(const [mode,records]of Object.entries(cleaned))state.progress[mode]={...(state.progress[mode]||{}),...records};saveProgress();renderSummary();renderQuests();renderMarkers();if(state.selected)renderDetail();toast(`${fmt.format(count)}개 퀘스트 기록을 가져왔어요. 같은 퀘스트는 백업 값으로 갱신했어요.`);}catch(error){toast(error.message||'백업 파일을 읽지 못했어요.',true);}}

// UI events: screenshot content is never uploaded or read for location detection.
$('game-mode').value=state.mode;
$('game-mode').addEventListener('change',()=>{resetQuestOcrSource();state.mode=$('game-mode').value;try{localStorage.setItem('tfg-mode',state.mode);}catch{}state.selected=null;state.capturedQuestIds=[];state.capturedCandidateCount=0;renderCapturedSummary();state.trader='all';state.status='all';$('quest-state-filter').value='all';marketController.setMode();questOcrController?.resetForMode();loadData();});
$('refresh-data').addEventListener('click',()=>loadData(true));
$('map-switcher').addEventListener('change',event=>selectMap(event.target.value));
$('capture-summary-review').addEventListener('click',()=>questOcrController?.open());
$('capture-clear').addEventListener('click',()=>{state.capturedQuestIds=[];state.capturedCandidateCount=0;state.mapFilter='all';$('map-filter').value='all';renderCapturedSummary();renderQuests();});
$('quest-import-zone').addEventListener('click',()=>questOcrController?.open());
$('quest-import-zone').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();questOcrController?.open();}});
$('upload-shot').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',event=>{handleFiles(event.target.files);event.target.value='';});
$('folder-fallback').addEventListener('change',event=>{handleFiles(event.target.files);event.target.value='';});
$('connect-folder').addEventListener('click',connectFolder);
$('disconnect-folder').addEventListener('click',()=>stopWatching());
$('check-folder-now').addEventListener('click',()=>state.companionMode?companionAction('rescan',{}):pollFolder());
$('download-diagnostics').addEventListener('click',downloadDiagnostics);
$('show-player').addEventListener('change',e=>{state.showPlayerMarker=e.target.checked;renderMarkers();});
$('show-quests').addEventListener('change',e=>{state.showQuestMarkers=e.target.checked;renderMarkers();});
$('follow-player').addEventListener('change',e=>{state.followPlayer=e.target.checked;if(state.followPlayer&&state.player)centerOn(state.player);});
$('toggle-quests').addEventListener('click',()=>{
  const hidden=document.body.classList.toggle('quests-collapsed');
  $('toggle-quests').setAttribute('aria-expanded',String(!hidden));
  $('toggle-quests').textContent=hidden?'퀘스트 목록 열기':'퀘스트 목록 접기';requestAnimationFrame(fitMap);
});
$('focus-map').addEventListener('click',()=>{
  const focused=document.body.classList.toggle('map-focus');
  $('focus-map').setAttribute('aria-pressed',String(focused));
  $('focus-map').textContent=focused?'기본 화면':'지도 크게 보기';requestAnimationFrame(fitMap);
});
$('map-floor').addEventListener('change',()=>chooseFloor($('map-floor').value));
$('follow-floor').addEventListener('change',e=>{state.followFloor=e.target.checked;followCapturedFloor();renderFloorStatus();});
$('show-other-floors').addEventListener('change',e=>{state.showOtherFloors=e.target.checked;renderMarkers();});
for(const kind of ['pmc','scav','shared','transit'])$('show-exit-'+kind).addEventListener('change',e=>{state.exitFilters[kind]=e.target.checked;if(kind==='shared')state.exitFilters.unknown=e.target.checked;renderMarkers();renderExitList();});
$('show-exit-labels').addEventListener('change',e=>{state.showExitLabels=e.target.checked;renderMarkers();});
$('toggle-exit-list').addEventListener('click',()=>{const panel=$('exit-list-panel');panel.hidden=!panel.hidden;$('toggle-exit-list').setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){closeExitDetail();renderExitList();$('exit-search').focus();}renderMarkers();});
$('exit-search').addEventListener('input',e=>{state.exitSearch=e.target.value;renderExitList();});
$('close-exit-detail').addEventListener('click',()=>{closeExitDetail();renderMarkers();});
$('zoom-in').addEventListener('click',()=>zoomAt(1.4));$('zoom-out').addEventListener('click',()=>zoomAt(1/1.4));$('fit-map').addEventListener('click',fitMap);$('center-player').addEventListener('click',()=>state.player&&centerOn(state.player));
$('open-help').addEventListener('click',()=>$('help-dialog').showModal());$('close-help').addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',event=>{if(event.target===$('help-dialog'))$('help-dialog').close();});
$('parse-filename').addEventListener('click',()=>{if(ingestFilename($('filename-input').value.trim())){text('filename-status','');$('help-dialog').close();setView('map');}else{text('filename-status','좌표를 확인하지 못했어요. 게임 내 원본 파일명과 선택한 맵을 확인해 주세요.');}});
$('filename-input').addEventListener('keydown',event=>{if(event.key==='Enter')$('parse-filename').click();});
$('export-progress').addEventListener('click',exportProgress);$('import-progress').addEventListener('click',()=>$('progress-file').click());$('progress-file').addEventListener('change',e=>{importProgress(e.target.files[0]);e.target.value='';});
$('quest-search').addEventListener('input',()=>{state.search=$('quest-search').value;state.renderLimit=70;renderQuests();});
for(const [id,key]of [['trader-filter','trader'],['quest-state-filter','status'],['map-filter','mapFilter']])$(id).addEventListener('change',()=>{state[key]=$(id).value;state.renderLimit=70;renderQuests();});
$('close-detail').addEventListener('click',closeDetail);
document.addEventListener('click',event=>{
  const target=event.target.closest('button,a');if(!target)return;
  if(target.dataset.view)setView(target.dataset.view);
  if(target.dataset.map)selectMap(target.dataset.map);
  if(target.dataset.floor)chooseFloor(target.dataset.floor);
  if(target.dataset.exit)openExit(target.dataset.exit);
  if(target.dataset.task)openTask(target.dataset.task);
  if(target.dataset.pin)togglePin(target.dataset.pin);
  if(target.dataset.mapJump){const key=target.dataset.mapJump;if(state.configs.some(c=>c.key===key)){setView('map');selectMap(key);}else toast('이 지역은 보정된 지도 이미지가 아직 등록되지 않았어요.',true);}
  if(target.dataset.focusObjective){const task=state.dataset.tasks.find(t=>t.id===state.selected);const point=locationsFor(task).find(l=>l.objective.id===target.dataset.focusObjective);if(point){if(!taskProgress(task.id).pinned)updateProgress(task.id,{pinned:true});setView('map');centerOn(point);}}
  if(target.id==='retry-map')selectMap(state.mapKey,false);
  if(target.dataset.action==='retry-data')loadData(true);
  if(target.dataset.action==='load-items')loadItemNames(true);
  if(target.dataset.action==='load-more'){state.renderLimit+=100;renderQuests();}
  if(target.dataset.action==='reset-filters'){state.search='';state.trader='all';state.status='all';state.mapFilter='all';$('quest-search').value='';$('trader-filter').value='all';$('quest-state-filter').value='all';$('map-filter').value='all';renderQuests();}
});
document.addEventListener('change',event=>{const el=event.target;if(el.id==='detail-status'&&state.selected)updateProgress(state.selected,{status:el.value});if(el.dataset.objective&&state.selected){const p=taskProgress(state.selected);updateProgress(state.selected,{objectives:{...(p.objectives||{}),[el.dataset.objective]:el.checked}});}});
let dragDepth=0;
document.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
document.addEventListener('dragenter',event=>{if(event.dataTransfer.types.includes('Files')){dragDepth++;document.body.classList.add('file-dragging');}});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('file-dragging');}});
document.addEventListener('drop',event=>{if(event.dataTransfer.files.length){event.preventDefault();dragDepth=0;document.body.classList.remove('file-dragging');if($('loot-dialog').open||state.view==='market'||event.target.closest('.loot-entry')){lootController.ingest(event.dataTransfer.files[0]);}else if($('quest-ocr-dialog').open||event.target.closest('#quest-import-zone'))void questOcrController?.ingest(event.dataTransfer.files[0]);else handleFiles(event.dataTransfer.files);}});
const viewport=$('map-viewport');let routePickDown=null;let drag=null;const touches=new Map();let pinch=null;let viewportSize=null;
viewport.addEventListener('wheel',event=>{if(event.target.closest('.map-side-panels,.map-floor-wrap,.map-utility-rail'))return;event.preventDefault();const rect=viewport.getBoundingClientRect();zoomAt(event.deltaY<0?1.16:1/1.16,event.clientX-rect.left,event.clientY-rect.top);},{passive:false});
viewport.addEventListener('pointerdown',event=>{
 if(fieldKitController?.isPicking() && state.imageReady && !event.target.closest('button,select,a,input,label,summary,.map-side-panels,.map-floor-wrap,.map-utility-rail')){routePickDown={x:event.clientX,y:event.clientY};event.preventDefault();return;}
 if(!state.imageReady || (event.pointerType==='mouse'&&event.button!==0) || event.target.closest('button,select,a,input,label,summary,.map-side-panels,.map-floor-wrap,.map-utility-rail'))return;
 event.preventDefault();viewport.setPointerCapture(event.pointerId);touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
 if(touches.size===2){const [a,b]=[...touches.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);drag=null;}
 else if(touches.size===1){drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,panX:state.panX,panY:state.panY,moved:false};}
 viewport.classList.add('is-dragging');
});
viewport.addEventListener('pointermove',event=>{
 if(!touches.has(event.pointerId))return;event.preventDefault();touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
 if(touches.size===2){const [a,b]=[...touches.values()];const dist=Math.hypot(a.x-b.x,a.y-b.y);if(pinch&&dist>0){const rect=viewport.getBoundingClientRect();zoomAt(dist/pinch,(a.x+b.x)/2-rect.left,(a.y+b.y)/2-rect.top);}pinch=dist;}
 else if(drag&&drag.pointerId===event.pointerId){const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
   if(Math.hypot(dx,dy)>4&&!drag.moved){drag.moved=true;if(state.followPlayer){state.followPlayer=false;const control=$('follow-player');if(control)control.checked=false;}}
   state.panX=drag.panX+dx;state.panY=drag.panY+dy;applyTransform();}
});
function releasePointer(event){
 if(routePickDown){const rect=viewport.getBoundingClientRect();const distance=Math.hypot(routePickDown.x-event.clientX,routePickDown.y-event.clientY);routePickDown=null;if(distance<7){const u=(event.clientX-rect.left-state.panX)/(state.imageWidth*state.zoom),v=(event.clientY-rect.top-state.panY)/(state.imageHeight*state.zoom);if(u>=0&&u<=1&&v>=0&&v<=1){fieldKitController?.addMapPoint(u,v);renderMarkers();}else toast('지도의 실제 영역 안을 클릭해 주세요.',true);}return;}
 touches.delete(event.pointerId);if(touches.size===1){const [id,p]=[...touches.entries()][0];drag={pointerId:id,x:p.x,y:p.y,panX:state.panX,panY:state.panY,moved:false};}else drag=null;pinch=null;if(!touches.size)viewport.classList.remove('is-dragging');}
viewport.addEventListener('pointerup',releasePointer);viewport.addEventListener('pointercancel',releasePointer);
viewport.addEventListener('lostpointercapture',event=>{if(touches.has(event.pointerId))releasePointer(event);});
new ResizeObserver(()=>{const newWidth=viewport.clientWidth,newHeight=viewport.clientHeight;if(!newWidth||!newHeight)return;const old=viewportSize;viewportSize={width:newWidth,height:newHeight};if(!state.imageReady)return;
 if(!old){fitMap();return;}if(old.width===newWidth&&old.height===newHeight)return;
 const restored=preserveCameraOnResize({panX:state.panX,panY:state.panY,zoom:state.zoom,fitZoom:state.fitZoom,oldWidth:old.width,oldHeight:old.height,newWidth,newHeight,imageWidth:state.imageWidth,imageHeight:state.imageHeight});
 if(restored){Object.assign(state,restored);applyTransform();}else fitMap();
}).observe(viewport);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.watchHandle)pollFolder();if(companionClient)companionClient.refresh();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.selected&&!$('help-dialog').open&&!$('quest-ocr-dialog').open)closeDetail();if(event.key==='/'&&!event.target.matches('input,textarea,select')&&!$('help-dialog').open&&!$('quest-ocr-dialog').open){event.preventDefault();if(state.selected)closeDetail();$('quest-search').focus();}});
const marketController=initializeMarket({getMode:()=>state.mode,readCache:cachedGet,writeCache:cachedPut});
const lootController=initializeLootScan({getCatalog:()=>marketController.getCatalog(),getMode:()=>state.mode,onOpenMarket:()=>setView('market')});
opsController=initializeOperations({getMode:()=>state.mode,getMap:()=>({key:state.mapKey,name:mapName(state.mapKey)}),getPoints:()=> (state.dataset?.tasks||[]).filter(t=>taskProgress(t.id).pinned).flatMap(task=>locationsFor(task).map(l=>({...l,taskId:task.id,taskName:task.name,objectiveId:l.objective?.id,objective:l.objective?.description}))),getExits:currentExits,getPlayer:()=>state.player,getQuestItems:()=>new Set((state.dataset?.tasks||[]).filter(t=>statusOf(t.id)!=='done').flatMap(t=>t.objectives||[]).flatMap(o=>(o.items||[]).map(i=>i.id||i.item?.id).filter(Boolean))),getCatalog:()=>marketController.getCatalog(),showRoute:(points,exit)=>{opsRoute=points;opsExit=exit;setView('map');renderMarkers();},openLoot:()=>lootController.open(),refreshMarket:()=>marketController.refresh(),onMarketOpen:()=>marketController.setActive(true),onMarketClose:()=>marketController.setActive(state.view==='market'),getLogStatus:()=>state.companion?.logs,onLogFolder:folder=>companionAction('logs-folder',{folder}),notify:toast});
fieldKitController=initializeFieldKit({getMode:()=>state.mode,getMap:()=>state.mapKey,getMapName:()=>mapName(state.mapKey),getTasks:()=>state.dataset?.tasks||[],getCatalog:()=>marketController.getCatalog(),getStatus:statusOf,matchTaskMap:matchesMap,onPickRoute:active=>{viewport.classList.toggle('is-route-picking',active);},onDrawRoute:()=>{setView('map');renderMarkers();},onRouteUpdated:()=>renderMarkers(),onOpenQuest:id=>{setView('quests');openTask(id);},onRefreshCatalog:active=>marketController.setActive(active||state.view==='market'),notify:toast});
r12Controller=initializeR12({getMode:()=>state.mode,getMap:()=>state.mapKey,getMapName:()=>mapName(state.mapKey),
 getMapRecord:()=>mapRecords().find(m=>baseMapKey(m.normalizedName)===state.mapKey),getCatalog:()=>marketController.getCatalog(),getExits:currentExits,
 getCompanion:()=>({...state.companion,connected:state.companionConnected}),getTasks:()=>state.dataset?.tasks||[],getPlayer:()=>state.player,
 getRoutes:()=>fieldKitController?.getRoutes()||[],saveRoutes:r=>fieldKitController?.setRoutes(r),
 getQuestLocations:()=> (state.dataset?.tasks||[]).filter(t=>taskProgress(t.id).pinned).flatMap(t=>locationsFor(t).map(l=>({...l,taskName:t.name}))),
 project,getDataState:()=>({maps:mapRecords(),tasks:state.dataset?.tasks||[],items:marketController.getCatalog()?.items||[],fetchedAt:state.dataset?.fetchedAt}),
 refreshData:()=>loadData(true),refreshMarket:()=>marketController.refresh(),renderMap:()=>renderMarkers(),notify:toast,onRescan:()=>companionAction('rescan',{}),onChooseFolder:()=>companionAction('choose-folder',{})});
r13Controller=initializeR13({getMode:()=>state.mode,getMap:()=>state.mapKey,getMapName:()=>mapName(state.mapKey),getTasks:()=>state.dataset?.tasks||[],getCatalog:()=>marketController.getCatalog(),getStatus:statusOf,getRoutes:()=>fieldKitController?.getRoutes()||[],getExits:currentExits,getDataState:()=>({maps:mapRecords(),tasks:state.dataset?.tasks||[],items:marketController.getCatalog()?.items||[],fetchedAt:state.dataset?.fetchedAt}),refreshData:()=>loadData(true),refreshMarket:()=>marketController.refresh(),notify:toast,onApplyQuests:ids=>{applyRecognizedQuests(ids);showCapturedBatch(ids,0);},onOpenQuest:id=>{setView('quests');openTask(id);},onOpenMarket:()=>setView('market')});
questOcrController=initializeQuestOcr({getTasks:()=>state.dataset?.tasks||[],getMode:()=>state.mode,getTaskInfo:questOcrTaskInfo,onApply:applyRecognizedQuests,onBatchReady:showCapturedBatch,onOpen:showRecognizedQuest,onMap:async(key,id)=>{if(!state.configs.some(c=>c.key===key)){toast('이 지역은 보정된 지도 이미지가 아직 없어요.',true);return;}setView('map',{keepFilter:true});await selectMap(key);showRecognizedQuest(id);},onNotify:toast,onAutoChange:()=>{resetQuestOcrSource();renderOcrConnection();}});
mapIntelController=initializeMapIntel({getMap:()=>state.mapKey,getMode:()=>state.mode,getConfig:cfg,getRecord:()=>mapRecords().find(m=>baseMapKey(m.normalizedName)===state.mapKey),getFallbackLabels:()=>verifiedIntelLabels,project,getFloorState:point=>{const f=floorMarkerState(point);return {...f,visible:f.visible||state.showOtherFloors};},getZoomRatio:()=>state.fitZoom>0?state.zoom/state.fitZoom:1,centerOn,refreshMarkers:()=>renderMarkers(),notify:toast});
fetch('./verified-labels.json').then(r=>r.ok?r.json():null).then(data=>{if(data?.maps){verifiedIntelLabels=data.maps;mapIntelController?.refresh();}}).catch(()=>{});
initializeR14Shell();
initializeCompanion();renderSummary();renderLocation();renderFloorControls();renderExitList();
Promise.allSettled([loadMapConfigs(),loadData()]);

// Static shell and previously visited map images can be used without a network connection.
if('serviceWorker' in navigator && (location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
