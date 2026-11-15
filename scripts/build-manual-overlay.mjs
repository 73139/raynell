/**
 * Build the independent, manual-only Windows map overlay image bundle.
 * No game process, logs, screenshots or input are accessed.
 * Reuses already verified public map assets from the existing build.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root=process.cwd();
const src=path.join(root,'website');
const output=path.join(root,'manual-overlay','assets');
const data=JSON.parse(await fs.readFile(path.join(src,'maps-source.json'),'utf8'));
const mapNames={'ground-zero':'그라운드 제로',customs:'세관',woods:'삼림',shoreline:'해안선',interchange:'인터체인지',reserve:'리저브',lighthouse:'등대','streets-of-tarkov':'타르코프 시내',factory:'공장','the-lab':'연구소','the-labyrinth':'미궁',icebreaker:'쇄빙선',terminal:'터미널'};
const safe=(p)=>{if(typeof p!=='string'||!p.startsWith('./maps/latest/'))throw Error('Map asset outside verified bundle: '+p);const abs=path.resolve(src,p);if(!abs.startsWith(path.join(src,'maps','latest')+path.sep))throw Error('Unsafe asset path');return abs;};
const result=[];
for(const entry of data.maps){
 const map=entry.maps.find(m=>m.projection==='interactive')||entry.maps[0];
 if(!map)continue;
 const key=entry.normalizedName;if(!/^[a-z0-9-]+$/.test(key))throw Error('Unsafe map key');
 const variants=[{id:'all',name:'전체 지도',asset:map.floorAssets?.__all__||map.svgPath}];
 const seen=new Set(['all']);
 for(const layer of map.layers||[]){
  const id=layer.svgLayer;
  if(!id||seen.has(id))continue;seen.add(id);
  const asset=map.floorAssets?.[id];
  if(asset)variants.push({id,name:layer.name||id,asset});
 }
 if(variants[0].asset===undefined)throw Error('Missing primary map '+key);
 const floors=[];
 for(let i=0;i<variants.length;i++){
  const layer=variants[i],source=safe(layer.asset);
  const file=key+'/'+i+'.png',target=path.join(output,file);
  await fs.mkdir(path.dirname(target),{recursive:true});
  // SVG and tiled PNG sources are BOTH rendered into ordinary offline PNG files.
  await sharp(source,{limitInputPixels:200000000}).resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).png({compressionLevel:8}).toFile(target);
  const meta=await sharp(target).metadata();
  if(!(meta.width>0&&meta.height>0))throw Error('Invalid generated map image '+file);
  floors.push({id:layer.id,name:layer.name,file:'assets/'+file,width:meta.width,height:meta.height});
 }
 result.push({key,name:mapNames[key]||key,floors});
 console.log('Manual overlay: '+key+' '+floors.length+' images');
}
if(result.length<10)throw Error('Missing maps');
await fs.writeFile(path.join(root,'manual-overlay','maps.json'),JSON.stringify({version:1,mode:'manual-only',maps:result},null,2));
console.log('Manual overlay ready: '+result.length+' maps');
