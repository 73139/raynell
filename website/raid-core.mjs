/* Public reference facts and user-aligned timers; never current-raid telemetry. */
const DAY=86400000;
const modulo=(value,base)=>((value%base)+base)%base;
export function gameClocks(now=Date.now(),offset=0){
 const first=modulo(modulo(now,DAY)*7+10800000+(Number.isFinite(offset)?offset:0),DAY);
 return [first,modulo(first+DAY/2,DAY)].map(ms=>({milliseconds:ms,hour:Math.floor(ms/3600000),minute:Math.floor(ms/60000)%60,second:Math.floor(ms/1000)%60,text:[Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')}));
}
export const cultistWindow=hour=>Number.isFinite(hour)&&(hour>=22||hour<7);
export function clockOffset(input,side=0,now=Date.now()){
 const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(input||''));
 if(!match)return null;const hour=Number(match[1]),minute=Number(match[2]),second=Number(match[3]||0);
 if(hour>23||minute>59||second>59||![0,1].includes(Number(side)))return null;
 const target=(hour*3600+minute*60+second)*1000,current=gameClocks(now)[Number(side)].milliseconds;
 return modulo(target-current+DAY/2,DAY)-DAY/2;
}
export function durationText(seconds){if(!Number.isFinite(seconds))return '미등록';if(seconds<0)return '종료 이후';const n=Math.floor(seconds);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
export function remainingRaid(anchor,now=Date.now()){return anchor&&Number.isFinite(anchor.remaining)&&Number.isFinite(anchor.at)?Math.max(0,anchor.remaining-(now-anchor.at)/1000):null;}
export function visitStatus(visit,remaining){
 if(!Number.isFinite(visit?.arrivalRemainingSeconds))return {kind:'unknown',text:'시각 미등록'};
 if(!Number.isFinite(remaining))return {kind:'unset',text:'남은 시간 맞춤 필요'};
 if(remaining>visit.arrivalRemainingSeconds)return {kind:'future',seconds:remaining-visit.arrivalRemainingSeconds,text:'약 '+durationText(remaining-visit.arrivalRemainingSeconds)+' 후'};
 if(remaining>=Math.max(0,visit.departureRemainingSeconds??visit.arrivalRemainingSeconds))return {kind:'stop',text:'참고 정차 구간'};
 return {kind:'past',text:'참고 시각 지남'};
}
export function isCultist(boss){return /sectant|cultist|광신|컬티스트/i.test([boss?.mobId,boss?.id,boss?.name].join(' '));}
const bossNames={bossBully:'르샬라',bossKilla:'킬라',bossTagilla:'타길라',bossKojaniy:'슈트르만',bossGluhar:'글루하르',bossSanitar:'세니타',bossKnight:'나이트',bossBoar:'카반',bossKolontay:'콜론타이',bossPartisan:'파르티잔',sectantPriest:'컬티스트 사제',bossZryachiy:'즈리야치'};
export function bossName(boss){return bossNames[boss?.mobId||boss?.id]||boss?.name||'이름 미등록 보스';}
export function bossChance(chance){return Number.isFinite(chance)&&chance>=0&&chance<=1?Math.round(chance*100)+'%':Number.isFinite(chance)?'제공값 '+chance:'미등록';}
export function bossSpawnTime(boss){
 if(isCultist(boss))return '게임 시간 22:00–07:00 · 야간 조건';
 if(boss?.spawnTimeRandom)return '무작위 출현 시점 · 고정 시각 없음';
 return Number.isFinite(boss?.spawnTime)&&boss.spawnTime>=0?'레이드 경과 '+durationText(boss.spawnTime)+' · 공개 설정':'고정 출현 시각 미등록';
}
export function btrSpawns(map){
 const groups=[];for(const route of map?.routes||[]){const p=route.path?.[0];if(!p||![p.x,p.z].every(Number.isFinite))continue;
  const found=groups.find(g=>Math.hypot(g.position.x-p.x,g.position.z-p.z)<2);
  if(found)found.routes.push(route);else groups.push({position:{x:p.x,z:p.z},routes:[route]});
 }return groups;
}
