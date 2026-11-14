/** R17 conservative planning helpers. Pure functions; never claim live game visibility. */
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = n => Math.max(0,Math.min(1,n));
const validPoint = p => p && finite(p.x) && finite(p.z);
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);

/** Prefer agreement; never switch maps on a weak, conflicting or stale observation. */
export function decideMapSwitch({currentMap=null, observations=[], minimum=0.8, now=Date.now(), maxAgeMs=120000}={}) {
  const valid = observations.filter(o => o && typeof o.map === 'string' && o.map &&
    finite(o.confidence) && o.confidence >= 0 && o.confidence <= 1 &&
    finite(o.timestamp) && o.timestamp <= now && now-o.timestamp <= maxAgeMs);
  const grouped = new Map();
  for (const o of valid) {
    const existing = grouped.get(o.map) || {map:o.map,confidence:0,sources:new Set(),count:0};
    existing.confidence = 1-(1-existing.confidence)*(1-o.confidence);
    existing.sources.add(o.source || 'unknown');
    existing.count++;
    grouped.set(o.map,existing);
  }
  const ordered = [...grouped.values()].sort((a,b)=>b.confidence-a.confidence);
  const winner=ordered[0], runner=ordered[1];
  if (!winner) return {switch:false,map:currentMap,reason:'no-fresh-evidence',confidence:0};
  const contradictory = runner && runner.confidence >= winner.confidence-0.15;
  const enough = winner.confidence >= minimum && !contradictory;
  // Multiple reports from one source do not establish independent corroboration.
  const reliable = winner.sources.size >= 2 || (winner.count===1 && valid.some(o=>o.map===winner.map && o.confidence>=0.95));
  if (!enough || !reliable) return {switch:false,map:currentMap,reason:contradictory?'conflicting-evidence':'insufficient-evidence',confidence:clamp(winner.confidence),candidate:winner.map};
  return {switch:winner.map!==currentMap,map:winner.map,reason:winner.map===currentMap?'already-selected':'confirmed',confidence:clamp(winner.confidence)};
}

/** Unknown and expired fixes are explicitly unusable rather than silently placed. */
export function locationReliability({position, sourceConfidence, ageMs=0, accuracyMeters=null, maxAgeMs=30000, maxAccuracyMeters=100}={}) {
  if (!validPoint(position) || !finite(sourceConfidence) || sourceConfidence<0 || sourceConfidence>1) return {usable:false,confidence:0,reason:'missing-position'};
  if (!finite(ageMs) || ageMs<0 || ageMs>maxAgeMs) return {usable:false,confidence:0,reason:'stale-position'};
  if (!finite(accuracyMeters) || accuracyMeters<0) return {usable:false,confidence:0,reason:'unknown-accuracy'};
  const confidence = clamp(sourceConfidence*(1-ageMs/(maxAgeMs*1.5))*Math.max(0,1-accuracyMeters/(maxAccuracyMeters*2)));
  return {usable:confidence>=0.6 && accuracyMeters<=maxAccuracyMeters, confidence, accuracyMeters,reason:confidence>=0.6&&accuracyMeters<=maxAccuracyMeters?'verified-input':'low-confidence'};
}

/** Weighted shortest path on an explicitly supplied navigable graph; never straight-line through walls. */
export function safePath(graph, start, destination, {riskWeight=1}={}) {
  const nodes=new Map((graph?.nodes||[]).filter(n=>n&&typeof n.id==='string'&&validPoint(n)).map(n=>[n.id,n]));
  if (!nodes.has(start)||!nodes.has(destination)) return {ok:false,reason:'unknown-endpoint'};
  if (!finite(riskWeight)||riskWeight<0) return {ok:false,reason:'invalid-risk-weight'};
  const adjacency=new Map([...nodes.keys()].map(id=>[id,[]]));
  for (const e of graph?.edges||[]) {
    if (!nodes.has(e.from)||!nodes.has(e.to)||e.blocked===true) continue;
    const length=finite(e.meters)&&e.meters>0?e.meters:distance(nodes.get(e.from),nodes.get(e.to));
    const risk=finite(e.risk)&&e.risk>=0&&e.risk<=1?e.risk:null;
    if (!(length>0)||risk===null) continue;
    adjacency.get(e.from).push({to:e.to,cost:length*(1+riskWeight*risk),meters:length,risk});
    if (e.oneWay!==true) adjacency.get(e.to).push({to:e.from,cost:length*(1+riskWeight*risk),meters:length,risk});
  }
  const costs=new Map([[start,0]]),prev=new Map(),queue=new Set(nodes.keys());
  while(queue.size) {
    const id=[...queue].sort((a,b)=>(costs.get(a)??Infinity)-(costs.get(b)??Infinity))[0];
    if (!finite(costs.get(id))) break;
    queue.delete(id);if(id===destination)break;
    for(const edge of adjacency.get(id)) {
      if(!queue.has(edge.to))continue;
      const next=costs.get(id)+edge.cost;
      if(next<(costs.get(edge.to)??Infinity)){costs.set(edge.to,next);prev.set(edge.to,{id,edge});}
    }
  }
  if (!costs.has(destination)) return {ok:false,reason:'no-verified-path'};
  const path=[destination];let meters=0;
  while(path[0]!==start) {const info=prev.get(path[0]);if(!info)return {ok:false,reason:'no-verified-path'};meters+=info.edge.meters;path.unshift(info.id);}
  return {ok:true,path,meters:Math.round(meters),weightedCost:Math.round(costs.get(destination)),graphOnly:true};
}

/** Do not suggest unknown, unavailable or conditionally locked extractions. */
export function usableExits(exits,{faction,keys=[],switches=[]}={}) {
  return (Array.isArray(exits)?exits:[]).filter(e=>e&&e.active===true&&e.verified===true&&
    (e.faction===undefined||e.faction===faction)&&
    (e.key===undefined||keys.includes(e.key))&&
    (e.switch===undefined||switches.includes(e.switch)));
}

/** Explicitly distinguish estimated gross sale from fee-adjusted net profit. */
export function compareSaleOptions({traderPrice,fleaPrice,feeRoubles}={}) {
  const valid = x=>finite(x)&&x>=0;
  const trader=valid(traderPrice)?traderPrice:null;
  const flea=valid(fleaPrice)&&valid(feeRoubles)?Math.max(0,fleaPrice-feeRoubles):null;
  const best=trader===null&&flea===null?null:flea!==null&&(trader===null||flea>trader)?'flea':'trader';
  return {best,traderNet:trader,fleaNet:flea,feeVerified:valid(feeRoubles),reason:best?'known-net-values':'missing-fee-or-prices'};
}

/** Ranked route candidates only when price and risk are both known. */
export function rankFarmingRoutes(routes,{riskPenalty=0.5}={}) {
  if (!finite(riskPenalty)||riskPenalty<0||riskPenalty>1) return [];
  return (routes||[]).filter(r=>r&&finite(r.expectedValue)&&r.expectedValue>=0&&finite(r.risk)&&r.risk>=0&&r.risk<=1&&finite(r.minutes)&&r.minutes>0)
    .map(r=>({...r,estimatedValuePerMinute:r.expectedValue*(1-riskPenalty*r.risk)/r.minutes}))
    .sort((a,b)=>b.estimatedValuePerMinute-a.estimatedValuePerMinute);
}

/** Diagnostic results are actionable, but never claim repairs were performed. */
export function diagnose({screenshotReadable,logPathReadable,dataAgeMs,offlineCacheAvailable}={}) {
  const issues=[];
  if(screenshotReadable===false)issues.push({code:'SCREENSHOT',action:'스크린샷 폴더 권한과 파일 형식을 확인하세요'});
  if(logPathReadable===false)issues.push({code:'LOG_PATH',action:'게임 로그 경로를 다시 선택하세요'});
  if(!finite(dataAgeMs)||dataAgeMs<0||dataAgeMs>86400000)issues.push({code:'DATA_STALE',action:'연결이 가능하면 게임 데이터를 갱신하세요'});
  if(offlineCacheAvailable!==true)issues.push({code:'CACHE',action:'오프라인 지도와 데이터 캐시 설치 상태를 확인하세요'});
  return {healthy:issues.length===0,issues,autoRepaired:false};
}
