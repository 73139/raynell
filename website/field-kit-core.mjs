/** Pure helpers for the personal, offline-first field kit. No guessed positions or item prices. */
const finite = x => typeof x==='number' && Number.isFinite(x);
const idOf = x => typeof x==='string'?x: x&&typeof x==='object'?(x.id||x._id||x.itemId||''):'';
const list = x => Array.isArray(x)?x:[];
const count = x => finite(x)&&x>0?x:typeof x==='string'&&x.trim()&&Number.isFinite(+x)&&+x>0?+x:1;
const name = x => typeof x==='string'?x.trim():'';
export const ROUTE_LIMIT=80;
export const POINT_LIMIT=100;
export function normalizeWaypoint(p){
 if(!p||!finite(p.u)||!finite(p.v)||p.u<0||p.u>1||p.v<0||p.v>1)return null;
 return {id:name(p.id).slice(0,64),u:+p.u,v:+p.v,label:name(p.label).slice(0,90)||'파밍 지점',note:name(p.note).slice(0,260),floor:name(p.floor).slice(0,48),category:['loot','quest','extract','risk','other'].includes(p.category)?p.category:'loot'};
}
export function normalizeRoute(r){
 if(!r||typeof r!=='object'||!name(r.id)||!name(r.map))return null;
 return {id:name(r.id).slice(0,100),map:name(r.map).slice(0,100),name:name(r.name).slice(0,100)||'개인 루트',note:name(r.note).slice(0,500),createdAt:name(r.createdAt),updatedAt:name(r.updatedAt),points:list(r.points).slice(0,POINT_LIMIT).map(normalizeWaypoint).filter(Boolean)};
}
export function normalizeRoutes(v){const seen=new Set();return list(v).slice(0,ROUTE_LIMIT).map(normalizeRoute).filter(r=>{if(!r||seen.has(r.id))return false;seen.add(r.id);return true;});}
export function routeAddPoint(r,p){const point=normalizeWaypoint(p);if(!point||!r||r.points.length>=POINT_LIMIT)return null;return {...r,points:[...r.points,point]};}
export function routeMovePoint(r,index,shift){if(!r||!Number.isInteger(index)||![-1,1].includes(shift)||index<0||index>=r.points.length||index+shift<0||index+shift>=r.points.length)return r;const points=[...r.points];[points[index],points[index+shift]]=[points[index+shift],points[index]];return {...r,points};}
export function routeLengthOnImage(r){const points=list(r?.points);let u=0;for(let i=1;i<points.length;i++)u+=Math.hypot(points[i].u-points[i-1].u,points[i].v-points[i-1].v);return u;}
export function questPreparedItems(tasks,map,statusOf=()=> 'todo'){
 const result=[];
 for(const task of list(tasks)){
  if(statusOf(task.id)==='done')continue;
  const associated=list(task.mapKeys).includes(map)||list(task.mapIds).includes(map)||list(task.objectives).some(o=>list(o.locations).some(loc=>loc.mapKey===map||loc.mapId===map));
  if(!associated)continue;
  const keys=list(task.neededKeys).map(k=>({id:idOf(k)||name(k),name:name(k?.name)||name(k?.nameEn)||'',quantity:count(k?.count||k?.quantity),kind:'key'}));
  const items=list(task.objectives).flatMap(o=>list(o.items).map(i=>({id:idOf(i),name:name(i.name)||name(i.nameEn)||'',quantity:count(i.count||o.count),kind:o.foundInRaid?'fir':'task'})));
  result.push({id:task.id,name:task.name||task.nameEn||task.id,trader:task.traderName||'',objectives:list(task.objectives).map(o=>({name:o.description||o.descriptionEn||'목표',optional:!!o.optional})),items:[...keys,...items].filter(i=>i.id)});
 }
 return result;
}
export function firRequirements(tasks,statusOf=()=> 'todo'){
 const result=new Map();
 for(const task of list(tasks)){
  if(statusOf(task.id)==='done')continue;
  for(const o of list(task.objectives)){
   if(!o.foundInRaid || o.optional)continue;
   for(const i of list(o.items)){
    const id=idOf(i);if(!id)continue;
    const existing=result.get(id)||{id,name:i.name||i.nameEn||id,required:0,tasks:[]};
    existing.required+=count(i.count||o.count);existing.tasks.push(task.name||task.id);result.set(id,existing);
   }
  }
 }
 return [...result.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
}
export function keyRequirements(tasks,statusOf=()=> 'todo'){
 const out=new Map();
 for(const task of list(tasks)){
  if(statusOf(task.id)==='done')continue;
  for(const k of list(task.neededKeys)){
   const key=idOf(k)||name(k);if(!key)continue;
   const prev=out.get(key)||{id:key,name:name(k.name)||name(k.nameEn)||'',tasks:[]};
   prev.tasks.push({id:task.id,name:task.name||task.id,mapIds:list(task.mapIds)});out.set(key,prev);
  }
 }
 return [...out.values()];
}
export function compareAmmo(items){return list(items).filter(i=>i.stats?.ammo && finite(i.stats.ammo.penetration)&&finite(i.stats.ammo.damage)).sort((a,b)=>b.stats.ammo.penetration-a.stats.ammo.penetration || b.stats.ammo.damage-a.stats.ammo.damage);}
export function compareArmor(items){return list(items).filter(i=>i.stats?.armor && finite(i.stats.armor.class)).sort((a,b)=>b.stats.armor.class-a.stats.armor.class);}
export function valuePerSlot(item,priceOf){const w=item?.grid?.width,h=item?.grid?.height,price=priceOf(item);if(!(finite(w)&&w>0&&finite(h)&&h>0&&finite(price)&&price>0))return null;return price/(w*h);}
export function kappaProgress(tasks,statusOf=()=> 'todo'){
 const included=list(tasks).filter(t=>t.kappaRequired===true),idMap=new Map(list(tasks).map(t=>[t.id,t]));
 return {required:included.length,done:included.filter(t=>statusOf(t.id)==='done').length,rows:included.map(t=>({task:t,status:statusOf(t.id),prerequisites:list(t.requirements).map(r=>({id:r.taskId,name:idMap.get(r.taskId)?.name||r.taskId,status:statusOf(r.taskId)})),blocked:list(t.requirements).some(r=>statusOf(r.taskId)!=='done')}))};
}
export function validateBackup(data){
 if(!data||data.product!=='tarkov-field-guide'||data.schema!==11||!data.payload||typeof data.payload!=='object'||Array.isArray(data.payload))return null;
 const allowed=['tarkov-field-guide-progress-v1',...['regular','pve','pvp-season'].flatMap(mode=>['tfg-owned-r10-','tfg-alerts-r10-','tfg-r11-routes-','tfg-r11-active-route-','tfg-r11-fir-','tfg-r11-key-','tfg-r11-pack-','tfg-r12-inventory-','tfg-r12-builds-','tfg-r12-layers-','tfg-r12-data-sig-'].map(p=>p+mode)),'tfg-mode','tfg-map',...['regular','pve','pvp-season'].flatMap(m=>['customs','woods','shoreline','interchange','reserve','lighthouse','streets-of-tarkov','factory','the-lab','ground-zero','terminal','labyrinth'].map(k=>`tfg-r12-exfil-${m}-${k}`))];
 const output={};for(const [key,value] of Object.entries(data.payload)){if(!allowed.includes(key)||typeof value!=='string'||value.length>600000)continue;if(key.includes('-routes-')){let parsed;try{parsed=JSON.parse(value);}catch{return null;}if(!Array.isArray(parsed)||normalizeRoutes(parsed).length!==parsed.length)return null;}output[key]=value;}
 return output;
}