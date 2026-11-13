// Bundle the current public maps so Windows never depends on an old browser map cache.
// Image tiles keep the original CRS; each composed floor has the same world bounds.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {makeMapCatalog,tileRectangle} from './map-assets-core.mjs';
import {floorGroupVisibility} from '../website/floor-core.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEST=path.join(ROOT,'website/maps/latest');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const png=b=>b.length>24&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a';
const localPath=p=>path.join(ROOT,'website',p.replace(/^\.\//,''));
const lockPath=path.join(ROOT,'scripts/maps-assets-lock.json');
const refresh=process.argv.includes('--refresh');
const sourceCache=new Map();let lock={},observed={};
async function download(url,optional=false){
 if(sourceCache.has(url))return sourceCache.get(url);
 const promise=(async()=>{
  for(let attempt=0;attempt<3;attempt++){
   try{
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(optional&&response.status===404){observed[url]='404';if(!refresh&&lock[url]!=='404')throw Error('Map source changed: '+url);return null;}
    if(!response.ok)throw Error('Map HTTP '+response.status+' '+url);
    const bytes=Buffer.from(await response.arrayBuffer()),sha=digest(bytes);observed[url]=sha;
    if(!refresh&&lock[url]!==sha)throw Error('Map integrity mismatch or unlocked source: '+url);
    return bytes;
   }catch(error){if(attempt===2||/integrity|changed/.test(error.message))throw error;await new Promise(r=>setTimeout(r,250*(attempt+1)));}
  }
 })();sourceCache.set(url,promise);return promise;
}
const image=(width,height)=>({width,height,data:Buffer.alloc(width*height*4)});
function overlay(base,layer,opacity=1){
 const result=image(base.width,base.height);
 for(let i=0;i<base.data.length;i+=4){
  const a=layer.data[i+3]/255*opacity,b=base.data[i+3]/255*(1-a),alpha=a+b;
  for(let c=0;c<3;c++)result.data[i+c]=alpha?(layer.data[i+c]*a+base.data[i+c]*b)/alpha:0;
  result.data[i+3]=alpha*255;
 }return result;
}
async function mosaic(template,rectangle){
 const {left,top,width,height,size,zoom,x0,x1,y0,y1}=rectangle,result=image(Math.ceil(width),Math.ceil(height));
 const cells=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)cells.push({x,y});
 let content=0;
 // Limit network and decoded-image memory on the existing free Render instance.
 for(let start=0;start<cells.length;start+=6){
  const batch=await Promise.all(cells.slice(start,start+6).map(async({x,y})=>{
   const url=template.replace('{z}',zoom).replace('{x}',x).replace('{y}',y),bytes=await download(url,true);
   if(!bytes)return null;if(!png(bytes))throw Error('Not a PNG tile: '+url);
   return {x,y,tile:PNG.sync.read(bytes)};
  }));
  for(const entry of batch){if(!entry)continue;const {x,y,tile}=entry;
   const dx=x*size-left,dy=y*size-top;
   for(let ry=Math.max(0,Math.ceil(dy));ry<Math.min(result.height,Math.ceil(dy+size));ry++){
    const ty=Math.min(tile.height-1,Math.max(0,Math.floor((ry-dy)*tile.height/size)));
    for(let rx=Math.max(0,Math.ceil(dx));rx<Math.min(result.width,Math.ceil(dx+size));rx++){
     const tx=Math.min(tile.width-1,Math.max(0,Math.floor((rx-dx)*tile.width/size))),from=(ty*tile.width+tx)*4,to=(ry*result.width+rx)*4;
     tile.data.copy(result.data,to,from,from+4);if(tile.data[from+3])content++;
    }
   }
  }
 }
 sourceCache.clear();
 if(!content)throw Error('Map layer has no visible tiles: '+template);
 return result;
}
async function writePNG(file,bitmap){const bytes=PNG.sync.write(bitmap,{filterType:4});await fs.writeFile(file,bytes);return digest(bytes);}
function selectedSVG(source,config,selected,baseBytes){
 const doc=new DOMParser().parseFromString(source,'image/svg+xml'),visibility=floorGroupVisibility(config,selected,{context:true});
 if(baseBytes){
  const base=doc.getElementById(config.svgLayer);if(!base||base.getAttribute('transform'))throw Error('Unregistered vector base plane');
  const vb=doc.documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  while(base.firstChild)base.removeChild(base.firstChild);
  const bitmap=doc.createElementNS('http://www.w3.org/2000/svg','image');
  for(const[k,v]of Object.entries({x:vb[0],y:vb[1],width:vb[2],height:vb[3],preserveAspectRatio:'none',href:'data:image/png;base64,'+baseBytes.toString('base64')}))bitmap.setAttribute(k,String(v));
  base.appendChild(bitmap);
 }
 const groups=[...Array.from(doc.getElementsByTagName('g'))];
 for(const group of groups){const id=group.getAttribute('id'),ref=Object.hasOwn(visibility,id)?id:group.getAttribute('data-keep-with-group');if(!ref||!Object.hasOwn(visibility,ref))continue;
  const opacity=visibility[ref];group.setAttribute('style',(group.getAttribute('style')||'')+';display:'+(opacity?'inline':'none')+'!important;opacity:'+opacity+'!important');
  if(ref===selected&&group.parentNode===doc.documentElement)doc.documentElement.appendChild(group);
 }
 return new XMLSerializer().serializeToString(doc);
}
export async function prepareMaps(){
 const raw=JSON.parse(await fs.readFile(path.join(ROOT,'scripts/maps-upstream.json'),'utf8')),catalog=makeMapCatalog(raw);
 await fs.writeFile(path.join(ROOT,'website/maps-source.json'),JSON.stringify(catalog,null,2)+'\n');
 if(!refresh)lock=JSON.parse(await fs.readFile(lockPath,'utf8'));
 let previous;try{previous=JSON.parse(await fs.readFile(path.join(DEST,'manifest.json'),'utf8'));}catch{}
 if(!refresh&&previous?.revision===catalog.revision&&previous.lockSha===digest(Buffer.from(JSON.stringify(lock)))){
  let complete=true;for(const [file,sha]of Object.entries(previous.files)){try{if(digest(await fs.readFile(path.join(DEST,file)))!==sha)complete=false;}catch{complete=false;}}
  if(complete){console.log('TFG maps: verified '+catalog.maps.length+' bundled maps');return previous;}
 }
 await fs.mkdir(DEST,{recursive:true});const files={},mapStats=[];
 for(const group of catalog.maps){
  const c=group.maps[0],dir=path.join(DEST,group.normalizedName);await fs.mkdir(dir,{recursive:true});
  if(!c.tilePath){const bytes=await download(c.sourceSvg);if(!bytes.toString('utf8').includes('<svg'))throw Error('Invalid SVG '+c.sourceSvg);await fs.writeFile(path.join(dir,'main.svg'),bytes);files[group.normalizedName+'/main.svg']=digest(bytes);mapStats.push({key:group.normalizedName,kind:'vector',floors:1+(c.layers?.length||0)});}
  else{
   const rectangle=tileRectangle(c,c.bundleZoom),base=await mosaic(c.tilePath,rectangle);
   files[group.normalizedName+'/main.png']=await writePNG(path.join(dir,'main.png'),base);
   let combined=base;const seen=new Set([c.svgLayer]);
   for(const layer of c.layers){if(seen.has(layer.svgLayer))continue;seen.add(layer.svgLayer);
    const file=localPath(c.floorAssets[layer.svgLayer]);
    if(layer.tilePath){const layerMap=await mosaic(layer.tilePath,rectangle);combined=overlay(combined,layerMap,.7);files[path.relative(DEST,file).replaceAll('\\','/')]=await writePNG(file,overlay(base,layerMap));}
    else{const source=(await download(c.sourceSvg)).toString('utf8'),svg=selectedSVG(source,c,layer.svgLayer,await fs.readFile(path.join(dir,'main.png')));await fs.writeFile(file,svg);files[path.relative(DEST,file).replaceAll('\\','/')]=digest(Buffer.from(svg));}
   }
   if(c.floorAssets.__all__.endsWith('.svg')){
    const svg=selectedSVG((await download(c.sourceSvg)).toString('utf8'),c,'__all__',await fs.readFile(path.join(dir,'main.png'))),file=localPath(c.floorAssets.__all__);
    await fs.writeFile(file,svg);files[path.relative(DEST,file).replaceAll('\\','/')]=digest(Buffer.from(svg));
   }else files[group.normalizedName+'/all.png']=await writePNG(path.join(dir,'all.png'),combined);
   mapStats.push({key:group.normalizedName,kind:'detailed-raster',size:c.bundleSize,zoom:c.bundleZoom,floors:seen.size});
  }
  console.log('TFG maps: '+group.normalizedName+' ready');
  // Source bytes are hashed in the lock; release them between maps.
  sourceCache.clear();
 }
 if(refresh){lock=Object.fromEntries(Object.entries(observed).sort(([a],[b])=>a.localeCompare(b)));await fs.writeFile(lockPath,JSON.stringify(lock,null,2)+'\n');}
 for(const file of Object.keys(previous?.files||{}))if(!Object.hasOwn(files,file)){
  const target=path.resolve(DEST,file);if(!target.startsWith(DEST+path.sep))throw Error('Invalid generated map path');await fs.unlink(target).catch(()=>{});
 }
 const manifest={revision:catalog.revision,checkedAt:catalog.checkedAt,configCommit:catalog.configCommit,svgCommit:catalog.svgCommit,lockSha:digest(Buffer.from(JSON.stringify(lock))),files,maps:mapStats,sourceImages:Object.keys(lock).length};
 await fs.writeFile(path.join(DEST,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('TFG maps: '+mapStats.length+' complete maps, '+Object.keys(files).length+' bundled floor files, '+Object.keys(lock).length+' verified source images');return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareMaps();
