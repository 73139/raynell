/** r12 local tactical tools. Strictly evidence-led: unknown data stays unknown. */
const arr=x=>Array.isArray(x)?x:[];
const recs=x=>Array.isArray(x)?x:x&&typeof x==='object'?Object.entries(x).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>v&&typeof v==='object'?{...v,id:v.id||k}:v):[];
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const txt=x=>typeof x==='string'?x.trim():'';
const id=x=>typeof x==='string'?x:obj(x)?txt(x.id||x._id||x.itemId):'';
const key=x=>txt(x).normalize('NFKC').toLocaleLowerCase('ko').replace(/[^\p{L}\p{N}]/gu,'');
export const R12_VERSION='2026.11.13-r12';
export const safeCount=x=>Math.max(1,Math.min(50,Math.floor(Number(x)||1)));
export function extractBossIntel(map={}){
 return recs(map.bosses).map((r,i)=>{
   const mob=obj(r.boss)?r.boss:{};
   const locations=arr(r.spawnLocations).map((l,j)=>({id:id(l)||String(j),name:txt(l.name||l.spawnKey)||'위치 이름 미등록',position:point(l.position),sourceChance:num(l.chance)}));
   return {id:id(mob)||id(r)||`boss-${i}`,name:txt(mob.name||r.name||mob.normalizedName||r.normalizedName)||'보스 이름 미등록',sourceChance:num(r.spawnChance),spawnTrigger:txt(r.spawnTrigger),spawnTime:num(r.spawnTime),locations,position:point(r.position),escorts:arr(r.escorts).map(e=>({name:txt(e?.boss?.name||e?.name)||'호위 NPC',amount:arr(e.amount).map(q=>q.count).filter(v=>num(v)!==null)}))};
 });
}
export function point(p){if(!obj(p))return null;const x=num(p.x),y=num(p.y),z=num(p.z);return x===null||y===null||z===null?null:{x,y,z};}
export function extractHazards(map={}){
 return recs(map.hazards).map((h,i)=>({id:id(h)||`hazard-${i}`,name:txt(h.name)||txt(h.hazardType)||'위험 구역',kind:txt(h.hazardType)||'unknown',position:point(h.position),outline:arr(h.outline).map(point).filter(Boolean),top:num(h.top),bottom:num(h.bottom)}));
}
export function extractSpawns(map={}){
 return recs(map.spawns).map((s,i)=>({id:id(s)||`spawn-${i}`,name:txt(s.zoneName)||'스폰 구역',position:point(s.position),sides:arr(s.sides).map(txt),categories:arr(s.categories).map(txt)}));
}
export function bossChanceLabel(chance){return num(chance)===null?'공개 확률 미등록':`제공처 출현값 ${chance} (단위·이벤트 조건 확인 필요)`;}
export function weaponData(raw={}){
 const p=raw.propertiesWeapon||raw.properties?.weapon||raw.properties||{};
 const slots=recs(raw.slots?.length?raw.slots:p.slots).map((s,i)=>({name:txt(s.name)||`슬롯 ${i+1}`,id:id(s)||String(i),allowed:[...new Set([...recs(s.allowedItems),...recs(s.filters?.allowedItems),...recs(s.items)].map(id).filter(Boolean))]}));
 return {baseRecoil:num(p.recoilVertical??p.recoil??raw.recoilVertical),baseErgo:num(p.ergonomics??raw.ergonomics),recoilModifier:num(raw.recoilModifier),ergonomicsModifier:num(raw.ergonomicsModifier),slots};
}
export function modCompatibility(weapon,mod){
 const slots=arr(weapon?.weapon?.slots),modId=id(mod);
 if(!slots.length||!modId)return {status:'unknown',slot:''};
 const match=slots.find(s=>arr(s.allowed).includes(modId));
 return match?{status:'confirmed',slot:match.name}:{status:'unverified',slot:''};
}
export function buildEstimate(weapon,mods=[],priceOf=()=>null){
 const all=[weapon,...mods].filter(Boolean),amounts=all.map(priceOf);
 const priced=amounts.every(n=>num(n)!==null&&n>=0);
 const validity=mods.map(m=>modCompatibility(weapon,m));
 const compatible=mods.length>0&&validity.every(v=>v.status==='confirmed');
 const recoil=weapon?.weapon?.baseRecoil,ergo=weapon?.weapon?.baseErgo;
 return {totalPrice:priced?amounts.reduce((a,b)=>a+b,0):null,compatibility:mods.length?compatible?'confirmed':'unverified':'base',slots:validity,
 // Even confirmed individual slot eligibility does not prove cross-mod coexistence.
 recoil:mods.length?null:recoil??null,ergonomics:mods.length?null:ergo??null};
}
export function packGrid(items,columns=10,rows=15,{rotate=true}={}){
 const w=Math.floor(Number(columns)),h=Math.floor(Number(rows));if(w<2||w>24||h<2||h>30)return {error:'가로 2~24, 세로 2~30 칸만 지원',placed:[],unplaced:[]};
 const matrix=Array.from({length:h},()=>Array(w).fill(false)),placed=[],unplaced=[];
 const entries=arr(items).flatMap((entry,idx)=>{
   const x=entry?.item?.grid?.width??entry?.width,y=entry?.item?.grid?.height??entry?.height;
   const count=Math.min(40,Math.max(1,Math.floor(Number(entry?.quantity)||1)));
   return Array.from({length:count},(_,n)=>({id:id(entry?.item)||txt(entry?.id)||String(idx),name:txt(entry?.item?.name||entry?.name)||'이름 미등록',width:Number(x),height:Number(y),entryIndex:idx,serial:n}));
 }).slice(0,250).sort((a,b)=>b.width*b.height-a.width*a.height);
 for(const e of entries){if(!Number.isInteger(e.width)||!Number.isInteger(e.height)||e.width<=0||e.height<=0||e.width>50||e.height>50){unplaced.push({...e,reason:'아이템 크기 미등록'});continue;}
 let pos=null;for(const [cw,ch,flipped] of [[e.width,e.height,false],...(rotate&&e.width!==e.height?[[e.height,e.width,true]]:[])]){
  for(let y=0;y<=h-ch&&!pos;y++)for(let x=0;x<=w-cw&&!pos;x++){
   if(Array.from({length:ch}).every((_,dy)=>matrix[y+dy].slice(x,x+cw).every(v=>!v)))pos={x,y,w:cw,h:ch,rotated:flipped};
  }if(pos)break;
 }
 if(!pos){unplaced.push({...e,reason:'빈 공간 부족'});continue;}
 for(let y=pos.y;y<pos.y+pos.h;y++)for(let x=pos.x;x<pos.x+pos.w;x++)matrix[y][x]=true;
 placed.push({...e,...pos});}
 return {columns:w,rows:h,placed,unplaced,used:placed.reduce((s,p)=>s+p.w*p.h,0),capacity:w*h};
}
export function matchExtractOCR(ocrText,exits=[]){
 const input=key(ocrText);if(!input)return [];
 return arr(exits).filter(x=>[x.name,x.nameEn].map(key).some(n=>n.length>=4&&input.includes(n))).map(x=>({...x,confidence:'name-only',available:null}));
}
export function compareRoutes(routes=[],map){return arr(routes).filter(r=>r.map===map).map(r=>{const points=arr(r.points);let length=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if([a.u,a.v,b.u,b.v].every(Number.isFinite))length+=Math.hypot(b.u-a.u,b.v-a.v);}return {id:r.id,name:r.name,points:points.length,imageDistance:length};}).sort((a,b)=>a.imageDistance-b.imageDistance);}
export function appendQuestWaypoints(route,locations=[]){if(!route)return null;const seen=new Set(arr(route.points).map(p=>`${p.u.toFixed(5)}:${p.v.toFixed(5)}`));const added=[];for(const p of arr(locations)){if(!Number.isFinite(p.u)||!Number.isFinite(p.v)||p.u<0||p.u>1||p.v<0||p.v>1)continue;const k=`${p.u.toFixed(5)}:${p.v.toFixed(5)}`;if(seen.has(k)||arr(route.points).length+added.length>=100)continue;seen.add(k);added.push({id:`quest-${Date.now()}-${added.length}`,u:p.u,v:p.v,label:txt(p.name).slice(0,90)||'퀘스트 경유지',category:'quest',floor:txt(p.floor),note:'공개 퀘스트 목표 좌표'});}return {...route,points:[...arr(route.points),...added]};}
export function dataSignature({maps=[],tasks=[],items=[],fetchedAt}={}){
 const fingerprints=xs=>{let h=2166136261;const ids=arr(xs).map(x=>txt(x?.id)).filter(Boolean).sort();for(const id of ids){for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619);}h^=31;h=Math.imul(h,16777619);}return (h>>>0).toString(16);};
 return {maps:maps.length,tasks:tasks.length,items:items.length,ids:{maps:fingerprints(maps),tasks:fingerprints(tasks),items:fingerprints(items)},checkedAt:typeof fetchedAt==='string'?fetchedAt:null};
}
export function safeDiagnostic(snapshot={}){
 const logs=snapshot?.logs||{};
 // Treat all raw messages/status as potentially sensitive; export only structured, local-only metadata.
 const safeStatus=txt(snapshot?.status);const scan=txt(snapshot?.lastScanAt);
 return {version:R12_VERSION,createdAt:new Date().toISOString(),localConnection:!!snapshot?.localConnection,watching:!!snapshot?.running,hasFolder:!!snapshot?.folder,captureRecognized:!!snapshot?.latest,statusKnown:!!safeStatus,lastScanAt:/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(scan)?scan:null,hasLogFolder:!!logs.folder,lastLogRevision:Number.isInteger(logs.revision)?logs.revision:null,errorCount:[snapshot?.error?.message,logs.error?.message].filter(Boolean).length};
}