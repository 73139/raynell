/* Only public wiki Guide content is read. Remote HTML is never mounted in the app. */
const clean=value=>String(value||'').replace(/\[\s*edit\s*\]|\[\]/gi,'').replace(/\s+/g,' ').trim();
export function wikiPage(url){
 try{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='escapefromtarkov.fandom.com'||u.username||u.password||!u.pathname.startsWith('/wiki/'))return null;
  const page=decodeURIComponent(u.pathname.slice(6)).replace(/_/g,' ').trim();return page&&!/^(?:File|Special|User|Talk|Category):/i.test(page)&&!['constructor','prototype'].includes(page.toLowerCase())?page:null;
 }catch{return null;}
}
export function wikiSource(page){return 'https://escapefromtarkov.fandom.com/wiki/'+encodeURIComponent(page.replace(/ /g,'_'));}
export function wikiImage(url,width=1000){
 try{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='static.wikia.nocookie.net'||u.username||u.password||!u.pathname.startsWith('/escapefromtarkov_gamepedia/images/')||!/\.(?:png|jpe?g|webp)(?:\/|$)/i.test(u.pathname))return '';
  const original=u.pathname.split('/revision/')[0];u.pathname=original+'/revision/latest/scale-to-width-down/'+width;u.searchParams.delete('format');return u.href;
 }catch{return '';}
}
export const photoKey=url=>{try{return decodeURIComponent(new URL(url).pathname.split('/revision/')[0]);}catch{return '';}};
const PREVIEW_BASE='https://raw.githubusercontent.com/narnesss/tarkov-help/427dd29293e758264db592a24692786410e99821/public/assets/media-previews/';
export function guideImageURL(photo,mirrors={},width=1000){
 const source=wikiImage(photo?.src,width),file=mirrors[photoKey(source)];
 return source&&typeof file==='string'&&/^[a-f0-9]{24}\.webp$/.test(file)?PREVIEW_BASE+file:source;
}
const mapTerms={'customs':/\bcustoms\b/i,'factory':/\bfactory\b/i,'woods':/\bwoods\b/i,'shoreline':/\bshoreline\b/i,'interchange':/\binterchange\b/i,'lighthouse':/\blighthouse\b/i,'reserve':/\breserve\b/i,'streets-of-tarkov':/\bstreets(?: of tarkov)?\b/i,'ground-zero':/\bground zero\b/i,'the-lab':/\b(?:the lab|laboratory)\b/i,'terminal':/\bterminal\b/i,'labyrinth':/\blabyrinth\b/i};
const mapsIn=text=>Object.keys(mapTerms).filter(key=>mapTerms[key].test(text));
export function extractWikiGuide(html,{pageTitle,sourceURL,fetchedAt=new Date().toISOString()}={},doc=document){
 const page=wikiPage(sourceURL);if(!page)throw new Error('지원하지 않는 위키 주소입니다.');
 const template=doc.createElement('template');template.innerHTML=String(html||'').slice(0,2000000);
 const root=template.content,anchor=root.querySelector('#Guide'),heading=anchor?.closest('h2');
 const photos=[],seen=new Set();let section='',sectionText='',currentMaps=[],node=heading?.closest('.mw-heading')||heading;
 while(node&&(node=node.nextElementSibling)){
  const h=node.matches('h2,h3,h4,h5')?node:node.querySelector(':scope > h2,:scope > h3,:scope > h4,:scope > h5');
  if(h?.tagName==='H2')break;
  if(h){section=clean(h.textContent);sectionText='';const maps=mapsIn(section);if(maps.length)currentMaps=maps;}
  if(node.matches('p')){sectionText=clean(node.textContent).slice(0,1800);const maps=mapsIn(section+' '+sectionText);if(maps.length)currentMaps=maps;}
  if(node.matches('table.navbox,.navbox,script,style'))continue;
  for(const image of node.matches('img')?[node]:node.querySelectorAll('img')){
   const width=Number(image.getAttribute('width')),height=Number(image.getAttribute('height'));
   if(width>0&&height>0&&Math.max(width,height)<150)continue;
   const raw=image.getAttribute('data-src')||image.getAttribute('src'),src=wikiImage(raw),key=photoKey(src);
   if(!src||seen.has(key))continue;
   const caption=clean(image.getAttribute('alt')||image.closest('.gallerybox,figure,.thumb')?.querySelector('.gallerytext,figcaption,.thumbcaption')?.textContent);
   if(/\bicon\b|logo|quest banner/i.test(caption))continue;
   seen.add(key);photos.push({src,thumb:wikiImage(raw,180),caption:caption||'위키 공략 사진',section,description:sectionText,mapKeys:[...currentMaps],sourceURL:wikiSource(page)});
   if(photos.length>=60)break;
  }
  if(photos.length>=60)break;
 }
 return {pageTitle:clean(pageTitle||page),sourceURL:wikiSource(page),fetchedAt,photos};
}
export function orderedPhotos(guide,mapKey){
 const photos=(Array.isArray(guide?.photos)?guide.photos:[]).filter(p=>p&&wikiImage(p.src));
 const matching=photos.filter(p=>p.mapKeys?.includes(mapKey)),rest=photos.filter(p=>!p.mapKeys?.includes(mapKey));
 const rows=matching.length?[...matching,...rest]:photos;
 const preferred=rows.findIndex(p=>(!matching.length||p.mapKeys?.includes(mapKey))&&!/\bmap\b|marked on|overview/i.test(p.caption));
 return {photos:rows,index:Math.max(0,preferred),mismatch:!!photos.length&&!matching.length&&photos.every(p=>p.mapKeys?.length)};
}
