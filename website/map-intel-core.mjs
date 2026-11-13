/* Read-only, coordinate-backed map intel. Unknown data is not fabricated.
 * Data: tarkov.dev JSON maps endpoint and the-hideout/tarkov-dev maps.json labels.
 */
const list=x=>Array.isArray(x)?x:[];
const name=x=>typeof x==='string'?x.trim():'';
const valid=p=>p&&typeof p.x==='number'&&Number.isFinite(p.x)&&typeof p.z==='number'&&Number.isFinite(p.z);
const toPoint=raw=>{
  if(Array.isArray(raw)&&raw.length>=2&&[raw[0],raw[1]].every(Number.isFinite))return {x:raw[0],z:raw[1]};
  if(valid(raw))return {x:raw.x,y:Number.isFinite(raw.y)?raw.y:null,z:raw.z};
  return null;
};
export const INTEL_KINDS={landmark:'주요 지역',container:'파밍 컨테이너',loose:'루즈 루트',boss:'보스 후보',pmc:'PMC 스폰 후보',scav:'Scav 스폰 후보',other:'기타 스폰'};
const slug=s=>name(s).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'');
export function normalizeMapLabels(config={},verifiedFallback=[]){
  const labels=list(config.labels).length?config.labels:verifiedFallback;
  const seen=new Set(),out=[];
  for(const l of labels){const position=toPoint(l?.position),text=name(l?.text||l?.name);if(!position||!text)continue;
    const key=slug(text)+':'+position.x.toFixed(2)+':'+position.z.toFixed(2);if(seen.has(key))continue;seen.add(key);
    out.push({id:'landmark-'+out.length,type:'landmark',label:text,position,minY:Number.isFinite(l?.bottom)?l.bottom:null,maxY:Number.isFinite(l?.top)?l.top:null,source:'tarkov-dev-map-label'});
  }
  return out;
}
export function classifySpawn(s){
  const fields=[...list(s?.sides),...list(s?.categories)].map(x=>String(x||'').toLowerCase());
  const pmc=fields.some(x=>/\bpmc\b|usec|bear|pmcbot/.test(x));
  const scav=fields.some(x=>/\bscav\b|savage|scavenger/.test(x));
  return {pmc,scav,unknown:!pmc&&!scav};
}
export function collectMapIntel(map={},config={},fallbackLabels=[]){
  const rows=normalizeMapLabels(config,fallbackLabels),seen=new Set();
  const push=(type,label,pos,extra={})=>{const position=toPoint(pos);if(!position)return;
    const safeName=name(label)||'이름 미등록';const signature=type+':'+safeName+':'+position.x.toFixed(3)+':'+position.z.toFixed(3);
    if(seen.has(signature))return;seen.add(signature);
    rows.push({id:`${type}-${rows.length}`,type,label:safeName,position,...extra});
  };
  for(const entry of list(map.lootContainers)){
    const place=entry?.lootContainer||entry?.container||{};
    const label=name(place.name)||name(entry?.name)||name(place.normalizedName)||'파밍 컨테이너';
    push('container',label,entry?.position||entry,{category:'container',source:'tarkov-dev-maps',detail:'컨테이너 출현 지점 · 현재 레이드 확정 아님'});
  }
  for(const entry of list(map.lootLoose)){
    const objects=list(entry.items).map(x=>name(x?.name||x?.nameEn||x?.normalizedName)).filter(Boolean);
    push('loose',objects.length?objects.slice(0,2).join(' / '):'루즈 루트',entry?.position||entry,{category:'loose',items:objects,source:'tarkov-dev-maps',detail:'루즈 루트 후보 · 현재 레이드 확정 아님'});
  }
  for(const s of list(map.spawns)){
    const classed=classifySpawn(s),label=name(s.name||s.zoneName)||'스폰 구역';
    if(classed.pmc)push('pmc',label,s.position,{source:'tarkov-dev-maps',detail:'PMC 출현 후보 · 실제 현재 레이드 위치 미확인'});
    if(classed.scav)push('scav',label,s.position,{source:'tarkov-dev-maps',detail:'Scav 출현 후보 · 현재 시점 등장 확정 아님'});
    if(classed.unknown)push('other',label,s.position,{source:'tarkov-dev-maps',detail:'진영 정보가 없는 스폰 후보'});
  }
  for(const b of list(map.bosses)){
    for(const loc of list(b.locations))push('boss',`${name(b.name)||'보스'} · ${name(loc.name)||'후보'}`,loc.position,{source:'tarkov-dev-maps',detail:'보스 출현 후보 · 출현 확정 아님'});
    if(b.position)push('boss',name(b.name)||'보스 출현 후보',b.position,{source:'tarkov-dev-maps',detail:'보스 출현 후보 · 출현 확정 아님'});
  }
  return rows;
}
export function describeBosses(map={}){
  return list(map.bosses).map(b=>({name:name(b.name)||'보스 정보 미등록',locations:list(b.locations).map(x=>name(x.name)).filter(Boolean),hasCoordinates:!!b.position||list(b.locations).some(x=>valid(x.position)),spawnTrigger:name(b.spawnTrigger)}));
}
export function filterIntel(rows=[],{enabled={},term='',type='all'}={}){
  const needle=String(term||'').normalize('NFKC').toLocaleLowerCase('ko');
  return list(rows).filter(row=>(enabled[row.type]!==false)&&(type==='all'||row.type===type)&&(!needle||String(row.label).normalize('NFKC').toLocaleLowerCase('ko').includes(needle)||list(row.items).some(x=>x.toLowerCase().includes(needle))));
}
export function intelCounts(rows=[]){const out={};for(const item of rows){out[item.type]=(out[item.type]||0)+1;}return out;}
export function hasAltitude(point){return Number.isFinite(point?.y);}
export function heightMatches(row,altitude){return !Number.isFinite(altitude)||(!Number.isFinite(row.minY)&&!Number.isFinite(row.maxY))||((!Number.isFinite(row.minY)||altitude>=row.minY)&&(!Number.isFinite(row.maxY)||altitude<=row.maxY));}