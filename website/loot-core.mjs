/* Screenshot item-name matching and read-only valuation. An icon or a tiny
   unreadable label is NOT treated as a verified item identification. */
export const normalizeLootText=(text='')=>String(text??'').toLocaleLowerCase('ko-KR').normalize('NFKC').replace(/[“”‘’'"`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const words=s=>new Set(normalizeLootText(s).split(' ').filter(Boolean));
const stop=new Set(['inventory','stash','overall','character','loot','gear','skills','tasks','search','inspected','inspector','weapon','item','items','show','value','price','trader','scav','pmc','durability','condition','back','escape','filter','sort','weight','find','퀘스트','임무','아이템','인벤토리','검색','보관함','장비','상인','가격','판매','수량','정렬','취소','확인','전체','탐색','보험','장비품','아이템 종류']);
const normalizedAliases=item=>[item.name,item.nameEn,item.shortName,item.shortNameEn,item.normalizedName].filter(Boolean).map(normalizeLootText).filter(a=>a.length>=4&&!stop.has(a));
function levenshtein(a,b){if(Math.abs(a.length-b.length)>4)return 999;const prev=Array.from({length:b.length+1},(_,j)=>j);for(let i=1;i<=a.length;i++){let old=prev[0];prev[0]=i;for(let j=1;j<=b.length;j++){const temp=prev[j];prev[j]=Math.min(prev[j]+1,prev[j-1]+1,old+(a[i-1]===b[j-1]?0:1));old=temp;}}return prev[b.length];}
export function matchLootLine(line,items){
  const source=String(line??'').trim().slice(0,200),name=normalizeLootText(source.replace(/(?:\b[x×]\s*\d{1,3}\b|\b\d{1,3}\s*[x×]\b)$/i,''));
  if(name.length<4||stop.has(name)||/^\d+$/.test(name))return null;
  const options=[];
  for(const item of items){let best=0,reason='';for(const alias of normalizedAliases(item)){
    if(name===alias){best=1;reason='exact';break;}
    if(alias.length>=6&&name.includes(alias)&& (name.length-alias.length<=18)) {if(best<.95){best=.95;reason='substring';}}
    else if(name.length>=6 && alias.length>=6 && Math.abs(name.length-alias.length)<=3){const d=levenshtein(name,alias);const score=1-d/Math.max(name.length,alias.length);if(score>=.88 && score>best){best=score;reason='fuzzy';}}
  }if(best>=.88)options.push({item,score:best,reason});}
  options.sort((a,b)=>b.score-a.score||String(a.item.name).localeCompare(String(b.item.name),'ko'));
  if(!options.length)return null;
  // The same readable text sometimes names more than one variant. Do not guess.
  if(options.length>1&&options[0].score-options[1].score<.04)return {status:'ambiguous',source,candidates:options.slice(0,5).map(r=>({id:r.item.id,name:r.item.name}))};
  const q=source.match(/(?:\b[x×]\s*(\d{1,3})\b|\b(\d{1,3})\s*[x×]\b)$/i);
  return {status:'matched',source,itemId:options[0].item.id,confidence:options[0].score,quantity:q?Math.min(999,Math.max(1,Number(q[1]||q[2]))):1};
}
export function scanLootText(input,catalog){
  const items=Array.isArray(catalog)?catalog:catalog?.items||[];const found=new Map(),uncertain=[];
  for(const line of String(input||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,160)){
    const m=matchLootLine(line,items);if(!m)continue;
    if(m.status==='ambiguous'){uncertain.push(m);continue;}
    const existing=found.get(m.itemId);if(existing){existing.quantity+=m.quantity;existing.sources.push(line);}else found.set(m.itemId,{id:m.itemId,quantity:m.quantity,sources:[line],confidence:m.confidence});
  }
  return {found:[...found.values()],uncertain,processedLines:String(input||'').split(/\r?\n/).filter(x=>x.trim()).length};
}
export function valuation(rows,catalog){
  const index=new Map((catalog?.items||[]).map(item=>[item.id,item]));
  let flea=0,trader=0,best=0,unpricedFlea=0,unpricedTrader=0,unpricedBest=0;
  let pricedFlea=0,pricedTrader=0,pricedBest=0;
  const finiteRoubles=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
  const detailed=rows.map(row=>{
    const item=index.get(row.id);
    const quantity=Math.min(9999,Math.max(1,Math.round(Number(row.quantity)||1)));
    // Only observed RUB offers count. A trader's purchase price is NOT the
    // price at which a player can sell that item.
    const fleaPrice=item?.flea?.priceStatus==='observed'&&item.flea.currency==='RUB'
      ?finiteRoubles(item.flea.currentPrice):null;
    const offer=item?.bestTraderSell;
    const traderPrice=finiteRoubles(offer?.priceRUB??(offer?.currency==='RUB'?offer?.price:null));
    const bestPrice=fleaPrice!==null&&traderPrice!==null?Math.max(fleaPrice,traderPrice):fleaPrice??traderPrice;
    const fleaSubtotal=fleaPrice===null?null:fleaPrice*quantity;
    const traderSubtotal=traderPrice===null?null:traderPrice*quantity;
    const bestSubtotal=bestPrice===null?null:bestPrice*quantity;
    if(fleaSubtotal===null)unpricedFlea++;else {flea+=fleaSubtotal;pricedFlea++;}
    if(traderSubtotal===null)unpricedTrader++;else {trader+=traderSubtotal;pricedTrader++;}
    if(bestSubtotal===null)unpricedBest++;else {best+=bestSubtotal;pricedBest++;}
    return {...row,quantity,item,fleaPrice,traderPrice,bestPrice,
      fleaSubtotal,traderSubtotal,bestSubtotal,subtotal:fleaSubtotal};
  });
  return {rows:detailed,flea,trader,best,unpricedFlea,unpricedTrader,unpricedBest,
    pricedFlea,pricedTrader,pricedBest};
}
