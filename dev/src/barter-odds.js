// Model a fresh container using catalog probabilities. The generator tries each footprint in
// row-major order, then retries with the rotated footprint only when its original orientation fails.
function huntFootprintMasks(cols,rows,width,height){
  if(width>cols || height>rows)return [];
  const strip=(1n<<BigInt(width))-1n;
  let rectangle=0n;
  for(let y=0;y<height;y++)rectangle|=strip<<BigInt(y*cols);
  const masks=[];
  for(let y=0;y<=rows-height;y++){
    for(let x=0;x<=cols-width;x++)masks.push(rectangle<<BigInt(y*cols+x));
  }
  return masks;
}

function huntCalculateOdds(table,item,goods=GOODS){
  const [cols,rows]=table.size,groups=new Map();
  if(!table.itemDistribution.some(r=>r.tpl===item && r.relativeProbability>0))return {first:0,whole:0};
  for(const row of table.itemDistribution){
    const [,w,h]=goods[row.tpl],key=w+'x'+h;
    if(!groups.has(key)){
      const placements=huntFootprintMasks(cols,rows,w,h);
      if(w!==h)placements.push(...huntFootprintMasks(cols,rows,h,w));
      groups.set(key,{placements,hit:0,miss:0});
    }
    const group=groups.get(key);
    if(row.tpl===item)group.hit+=row.relativeProbability;
    else group.miss+=row.relativeProbability;
  }
  // Group only identical ordered footprints. They have identical placement and future occupancy.
  const memo=new Map();
  function oneOrMore(occupied,remaining){
    if(!remaining)return 0;
    if(!memo.has(remaining))memo.set(remaining,new Map());
    const level=memo.get(remaining);
    if(level.has(occupied))return level.get(occupied);
    let weight=0,hitWeight=0;
    for(const group of groups.values()){
      const placement=group.placements.find(mask=>(mask&occupied)===0n);
      if(placement===undefined)continue;
      weight+=group.hit+group.miss;
      hitWeight+=group.hit;
      if(remaining>1 && group.miss)hitWeight+=group.miss*oneOrMore(occupied|placement,remaining-1);
    }
    const answer=weight?hitWeight/weight:0;
    level.set(occupied,answer);
    return answer;
  }
  let countWeight=0,nonemptyWeight=0,wholeWeight=0;
  for(const {count,relativeProbability} of table.itemcountDistribution){
    countWeight+=relativeProbability;
    if(count>0)nonemptyWeight+=relativeProbability;
    wholeWeight+=relativeProbability*oneOrMore(0n,count);
  }
  return {first:countWeight?nonemptyWeight/countWeight*oneOrMore(0n,1):0,whole:countWeight?wholeWeight/countWeight:0};
}

// Only read the immutable catalog when a player opens this ingredient's candidate list.
const huntOddsCache=new Map();
function huntContainerOdds(tableId,item){
  const key=tableId+'/'+item;
  if(!huntOddsCache.has(key))huntOddsCache.set(key,huntCalculateOdds(LOOT_TABLES[tableId],item));
  return huntOddsCache.get(key);
}

function huntOddsPercent(probability){
  if(probability>0 && probability<0.00005)return '0.01% 미만';
  return probability.toLocaleString('ko-KR',{style:'percent',maximumFractionDigits:2});
}
