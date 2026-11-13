import {wikiPage,wikiSource,wikiImage,photoKey,guideImageURL,extractWikiGuide,orderedPhotos} from './quest-photo-core.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CACHE='tfg-public-quest-guides-v1',TTL=24*60*60*1000;
export function initializeQuestPhotos({getMap,getMapName}={}){
 const panel=document.createElement('section');panel.id='quest-location-card';panel.className='quest-location-card';panel.hidden=true;
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','quest-location-title');
 panel.innerHTML=`<header><div><small>퀘스트 위치 사진</small><h2 id="quest-location-title"></h2></div><button id="quest-location-close" class="btn btn-small" aria-label="퀘스트 위치 사진 닫기">닫기 ✕</button></header><div class="quest-location-body"><p id="quest-location-objective"></p><p id="quest-location-state" role="status"></p><div id="quest-location-gallery" hidden><div class="quest-location-image-wrap"><img id="quest-location-image" alt="" referrerpolicy="no-referrer"></div><div class="quest-location-photo-tools"><button id="quest-location-prev" class="btn btn-small" aria-label="이전 위치 사진">←</button><span id="quest-location-counter"></span><button id="quest-location-next" class="btn btn-small" aria-label="다음 위치 사진">→</button><button id="quest-location-expand" class="btn btn-small" aria-expanded="false">크게 보기</button></div><strong id="quest-location-caption"></strong><div id="quest-location-thumbnails" class="quest-location-thumbnails"></div><p id="quest-location-description" class="quest-location-description"></p></div><p id="quest-location-note" class="quest-location-note"></p><div class="quest-location-sources"><a id="quest-location-wiki" target="_blank" rel="noopener noreferrer">위키 공략 원문 ↗</a><a id="quest-location-original" target="_blank" rel="noopener noreferrer" hidden>사진 따로 보기 ↗</a></div><small class="quest-location-credit">사진·설명 출처: Escape from Tarkov Wiki / Fandom · 게임 이미지: Battlestate Games · <a href="./QUEST_PHOTO_SOURCES.txt" target="_blank" rel="noopener noreferrer">사진 출처·이용 조건</a></small></div>`;
 document.body.append(panel);const $=id=>panel.querySelector('#'+id);
 let pages={};try{const saved=JSON.parse(localStorage.getItem(CACHE)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))pages=saved;}catch{}
 let seeds={},mirrors={},sequence=0,controller=null,photos=[],index=0,focusBefore=null,selectedMap='';
 const seedsReady=Promise.allSettled([
  fetch('./quest-guide-fallbacks.json').then(r=>r.ok?r.json():{}).then(data=>{seeds=data.pages||{};}),
  fetch('./quest-photo-mirrors.json').then(r=>r.ok?r.json():{}).then(data=>{mirrors=data.images||{};}),
 ]);
 function merge(guide,seed){
  const translations=new Map((seed?.photos||[]).map(p=>[photoKey(p.src),p]));
  return {...guide,photos:(guide.photos||[]).map(p=>({...p,captionKo:translations.get(photoKey(p.src))?.captionKo||p.captionKo}))};
 }
 function display(guide){
  const ordered=orderedPhotos(guide,selectedMap);photos=ordered.photos;index=ordered.index;
  $('quest-location-gallery').hidden=!photos.length;
  $('quest-location-note').textContent=ordered.mismatch?`위키 사진의 지역과 목표 지도(${getMapName(selectedMap)})가 다릅니다. 사진 설명과 원문에서 지역을 확인하세요.`:'사진은 이 퀘스트의 위키 공략 자료입니다. 목표별로 여러 사진을 넘겨 볼 수 있습니다.';
  $('quest-location-state').textContent=photos.length?'':'위키 공략에 등록된 위치 사진이 없습니다. 원문에서 설명을 확인해 주세요.';
  if(photos.length)showPhoto(index);
 }
 function showPhoto(next){
  if(!photos.length)return;index=(next+photos.length)%photos.length;const photo=photos[index],src=guideImageURL(photo,mirrors);
  const image=$('quest-location-image');image.hidden=false;image.alt=photo.captionKo||photo.caption;image.src=src;
  $('quest-location-caption').textContent=[...(photo.mapKeys||[]).map(key=>getMapName(key)),photo.section,photo.captionKo||photo.caption].filter(Boolean).join(' · ');
  $('quest-location-counter').textContent=`${index+1} / ${photos.length}`;
  $('quest-location-prev').disabled=$('quest-location-next').disabled=photos.length<2;
  $('quest-location-description').textContent=photo.description||'';
  $('quest-location-original').href=src;$('quest-location-original').hidden=false;
  $('quest-location-thumbnails').innerHTML=photos.map((p,i)=>`<button type="button" data-quest-photo-index="${i}" class="${i===index?'selected':''}" aria-label="${esc(p.captionKo||p.caption)}" aria-pressed="${i===index}"><img src="${esc(guideImageURL(p,mirrors,180))}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('');
  $('quest-location-state').textContent='';
 }
 function close(){const wasOpen=!panel.hidden;sequence++;controller?.abort();controller=null;panel.hidden=true;panel.classList.remove('is-expanded');$('quest-location-expand').setAttribute('aria-expanded','false');$('quest-location-expand').textContent='크게 보기';if(wasOpen&&focusBefore?.isConnected&&!panel.contains(focusBefore))focusBefore.focus({preventScroll:true});focusBefore=null;}
 async function open({task,objective,mapKey}={}){
  if(!task)return;controller?.abort();const ticket=++sequence;controller=new AbortController();const signal=controller.signal;
  focusBefore=document.activeElement;selectedMap=mapKey||getMap();photos=[];index=0;panel.hidden=false;panel.classList.remove('is-expanded');$('quest-location-expand').setAttribute('aria-expanded','false');$('quest-location-expand').textContent='크게 보기';
  $('quest-location-title').textContent=task.name||task.nameEn||'퀘스트';
  $('quest-location-objective').textContent=objective?.description||objective?.descriptionEn||'목표 위치와 현장 사진을 확인하세요.';
  $('quest-location-gallery').hidden=true;$('quest-location-original').hidden=true;$('quest-location-note').textContent='';
  $('quest-location-state').textContent='위키 위치 사진을 불러오는 중…';$('quest-location-close').focus({preventScroll:true});
  const page=wikiPage(task.wikiLink);const source=page?wikiSource(page):'https://tarkov.dev/task/'+encodeURIComponent(task.normalizedName||task.id);
  $('quest-location-wiki').href=source;
  if(!page){$('quest-location-state').textContent='이 퀘스트의 위키 사진 주소가 아직 등록되지 않았습니다. 공략 원문을 확인해 주세요.';return;}
  await seedsReady;if(ticket!==sequence)return;
  const seed=Object.hasOwn(seeds,page)?seeds[page]:null,cached=Object.hasOwn(pages,page)&&Array.isArray(pages[page]?.photos)?pages[page]:null,initial=cached||seed;
  if(initial)display(merge(initial,seed));
  if(cached&&Date.now()-Date.parse(cached.fetchedAt)<TTL)return;
  const requestController=controller,timer=setTimeout(()=>requestController.abort(),15000);
  try{
   const url=new URL('https://escapefromtarkov.fandom.com/api.php');
   for(const [key,value] of Object.entries({action:'parse',page,prop:'text',format:'json',origin:'*'}))url.searchParams.set(key,value);
   const response=await fetch(url,{credentials:'omit',cache:'no-cache',signal});if(!response.ok)throw new Error('위키 연결 실패');
   const data=await response.json();if(data.error||!data.parse?.text?.['*'])throw new Error('위키 자료 없음');
   const guide=merge(extractWikiGuide(data.parse.text['*'],{pageTitle:data.parse.title,sourceURL:source}),seed);
   if(ticket!==sequence)return;
   pages[page]=guide;
   pages=Object.fromEntries(Object.entries(pages).filter(([,v])=>v&&Array.isArray(v.photos)).sort((a,b)=>Date.parse(b[1].fetchedAt)-Date.parse(a[1].fetchedAt)).slice(0,12));
   try{localStorage.setItem(CACHE,JSON.stringify(pages));}catch{}
   display(guide);
  }catch{
   if(ticket!==sequence)return;
   $('quest-location-state').textContent=initial?'위키 연결이 늦어 저장된 공략 자료를 표시합니다.':'사진을 불러오지 못했습니다. 인터넷 연결을 확인하거나 위키 공략 원문을 열어 주세요.';
  }finally{clearTimeout(timer);}
 }
 $('quest-location-close').addEventListener('click',close);
 $('quest-location-prev').addEventListener('click',()=>showPhoto(index-1));$('quest-location-next').addEventListener('click',()=>showPhoto(index+1));
 $('quest-location-expand').addEventListener('click',()=>{const expanded=panel.classList.toggle('is-expanded');$('quest-location-expand').setAttribute('aria-expanded',String(expanded));$('quest-location-expand').textContent=expanded?'작게 보기':'크게 보기';});
 $('quest-location-thumbnails').addEventListener('click',event=>{const button=event.target.closest('[data-quest-photo-index]');if(button)showPhoto(Number(button.dataset.questPhotoIndex));});
 $('quest-location-image').addEventListener('error',()=>{$('quest-location-image').hidden=true;$('quest-location-state').textContent='이 사진을 불러오지 못했습니다. 다른 미리보기를 선택하거나 사진 원본을 열어 주세요.';});
 document.addEventListener('keydown',event=>{if(panel.hidden)return;if(event.key==='Escape'){event.preventDefault();close();}else if(panel.contains(document.activeElement)&&!event.target.matches('input,textarea,select')){if(event.key==='ArrowRight'){event.preventDefault();showPhoto(index+1);}if(event.key==='ArrowLeft'){event.preventDefault();showPhoto(index-1);}}});
 return {open,close};
}
