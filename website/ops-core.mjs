/** TFG operations calculations. Pure and conservative: unknown prices stay unknown. */
const obj = x=>x&&typeof x==='object'&&!Array.isArray(x);
const arr = x=>Array.isArray(x)?x:obj(x)?Object.entries(x).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).map(([id,value])=>obj(value)?{...value,id:value.id||id}:value):[];
const text = x=>typeof x==='string'?x.trim():'';
const num = x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'&&x.trim()&&Number.isFinite(Number(x))?Number(x):null;
const positive = x=>{const n=num(x);return n!==null&&n>0?n:null;};
const id = x=>typeof x==='string'?x:obj(x)?x.id||x.itemId||x._id||null:null;
const data = x=>obj(x?.data)?x.data:x||{};
export function extractRecords(doc,key){return arr(data(doc)[key]).filter(obj);}
export function normalizeRequiredItems(raw){return arr(raw).map(row=>{
  const ref=row?.item??row?.itemId??row?.item_id??row?._tpl??row?.templateId??row?.id;
  const itemId=id(ref);
  const quantity=positive(row?.quantity)??positive(row?.count)??positive(row?.amount)??1;
  return itemId&&quantity?{itemId,quantity}:null;
}).filter(Boolean);}
export function normalizeHideout(doc){
 const root=data(doc);const primary=extractRecords(doc,'hideoutStations');const stations=primary.length?primary:extractRecords(doc,'stations').length?extractRecords(doc,'stations'):Array.isArray(root.hideout?.stations)?root.hideout.stations:extractRecords(doc,'hideout');
 return stations.map(s=>({id:id(s),name:text(s.name)||text(s.normalizedName)||'기지 시설',levels:arr(s.levels).filter(obj).map(l=>({id:id(l),level:(num(l.level)??num(l.id)??0),required:normalizeRequiredItems(l.itemRequirements??l.requirements?.items??l.requiredItems),constructionTime:num(l.constructionTime),traderRequirements:arr(l.traderRequirements),stationRequirements:arr(l.stationLevelRequirements),skillRequirements:arr(l.skillRequirements)})).filter(l=>l.level>0).sort((a,b)=>a.level-b.level)})).filter(s=>s.id&&s.levels.length);
}
export function normalizeRecipes(doc,type){const key=type==='barter'?'barters':'crafts';return extractRecords(doc,key).map(r=>({
 id:id(r),type,station:id(r.station)||id(r.stationLevel?.station)||null,traderId:id(r.trader)||id(r.vendor)||null,
 traderName:text(r.trader?.name)||text(r.vendor?.name)||'',level:num(r.level)??num(r.stationLevel?.level)??null,duration: num(r.duration),
 required:normalizeRequiredItems(r.requiredItems??r.requirements??r.costs),
 reward:normalizeRequiredItems(r.rewardItems??r.rewards??r.outputs??r.resultItems),
})).filter(r=>r.id&&r.required.length&&r.reward.length);}
export const priceOf = (item,prefer='low')=>{
 if(!item)return null;
 const flea=(item.flea?.priceStatus==='observed'&&positive(item.flea.currentPrice))||null;
 const vendor=item.bestTraderSell?.priceRUB??(item.bestTraderSell?.currency==='RUB'?item.bestTraderSell?.price:null);
 const trader=positive(vendor);
 return prefer==='trader'?trader:prefer==='flea'?flea:flea??trader;
};
export function materialsCost(required,catalog,owned={}){
 const index=new Map((catalog?.items||[]).map(i=>[i.id,i]));let total=0,unknown=0;
 const rows=required.map(req=>{const item=index.get(req.itemId)||null;const ownedQty=Math.max(0,Math.floor(num(owned[req.itemId])??0));const missing=Math.max(0,req.quantity-ownedQty);const unit=priceOf(item);const cost=unit===null?null:unit*missing;
 if(missing>0){if(cost===null)unknown++;else total+=cost;}
 return {...req,item,owned:ownedQty,missing,cost,unit};});
 return {rows,knownTotal:total,unknown,complete:unknown===0};
}
export function evaluateRecipe(recipe,catalog){
 const required=materialsCost(recipe.required,catalog);
 const reward=materialsCost(recipe.reward,catalog);
 let rewardValue=0,unknownReward=0;
 for(const row of reward.rows){const price=priceOf(row.item);if(price===null)unknownReward++;else rewardValue+=price*row.quantity;}
 return {...recipe,cost:required.knownTotal,rewardValue,unknownCost:required.unknown,unknownReward,
  net:required.unknown===0&&unknownReward===0?rewardValue-required.knownTotal:null};
}
export function profitEstimate({sell,acquisition=0,count=1,feePercent=null}={}){
 const price=positive(sell),buy=num(acquisition),quantity=Math.floor(num(count)||1),fee=num(feePercent);
 if(price===null||buy===null||buy<0||quantity<1||fee===null||fee<0||fee>99)return {net:null,reason:'필요한 가격 또는 수수료 정보 없음'};
 const gross=price*quantity,feeAmount=Math.round(gross*fee/100);
 return {gross,feeAmount,cost:buy*quantity,net:gross-feeAmount-buy*quantity};
}
export function planRaid({points=[],start=null,exit=null}={}){
 const unique=[];const seen=new Set();for(const p of points){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z))continue;const key=`${p.taskId||p.name}|${p.objectiveId||''}|${p.x}|${p.z}`;if(!seen.has(key)){seen.add(key);unique.push(p);}}
 const steps=[],pending=unique.slice();let cursor=(start&&Number.isFinite(start.x)&&Number.isFinite(start.z))?start:null;
 while(pending.length){let pick=0;if(cursor){let best=Infinity;for(let i=0;i<pending.length;i++){const d=Math.hypot(pending[i].x-cursor.x,pending[i].z-cursor.z);if(d<best){best=d;pick=i;}}}
  const next=pending.splice(pick,1)[0];steps.push({...next,fromPreviousMeters:cursor?Math.round(Math.hypot(next.x-cursor.x,next.z-cursor.z)):null});cursor=next;
 }
 const exitDistance=exit&&cursor&&Number.isFinite(exit.x)&&Number.isFinite(exit.z)?Math.round(Math.hypot(exit.x-cursor.x,exit.z-cursor.z)):null;
 return {steps,exitDistance,straightLineOnly:true,totals:{objectives:steps.length,knownMeters:steps.reduce((n,s)=>n+(s.fromPreviousMeters||0),0)+(exitDistance||0)}};
}
export function priceAlerts(catalog,alerts={}){const triggered=[];for(const item of catalog?.items||[]){const alert=alerts[item.id];if(!alert)continue;const actual=priceOf(item,'flea');const target=positive(alert.price);if(actual!==null&&target!==null&&((alert.direction==='below'&&actual<=target)||(alert.direction==='above'&&actual>=target)))triggered.push({item,actual,target,direction:alert.direction});}return triggered;}