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

// A catalog lookup uses the same immutable candidates as a barter hunt, without selecting a destination.
function catalogFieldMarkup(id,regions){
  const available=regions.filter(region=>region.landmarks.length);
  if(!available.length)return '<p>현재 배정된 현장 보관함이 없습니다.</p>';
  const needsKey=available.every(region=>region.landmarks.every(point=>point.boxes.every(box=>box.keyId)));
  const selected=lootPlan==='item/'+id;
  return '<button type="button" data-lootplan="catalog-item" data-id="'+esc(id)+'"'+(writer?'':' disabled')+'>'+
    (selected?'이 물품의 수색 계획 열기':'이 물품을 탐색 목표로 설정')+'</button><span role="status" data-track-status></span>'+
    '<p>새 보관함 하나에 이 물품이 1개 이상 들어 있을 확률입니다. 빈 보관함도 포함합니다. 다른 생존자가 먼저 수색하면 남은 물품은 달라질 수 있습니다.</p>'+
    (needsKey?'<p><strong>모든 후보에 열쇠가 필요합니다.</strong></p>':'')+
    available.map(region=>'<section data-catalog-region="'+region.zone+'"><h4>'+esc(region.name)+'</h4><ul>'+
      region.landmarks.map(point=>'<li><b>'+esc(point.name)+'</b>'+point.boxes.map(box=>{
        const chance=huntContainerOdds(box.table,id).whole;
        return '<div data-catalog-box="'+region.zone+'-'+box.index+'"><span>'+esc(box.name)+' · '+
          (box.keyId?esc(kitName(box.keyId))+' 필요':'열쇠 불필요')+'</span><strong>'+huntOddsPercent(chance)+'</strong></div>';
      }).join('')+'</li>').join('')+'</ul></section>').join('');
}
function catalogFieldDisclosure(id){
  return ITEM_META[id]?.lootSources.length?'<details class="db-field-sources" data-catalog-sources="'+esc(id)+'">'+
    '<summary>현장 수급처 · 보관함별 확률</summary><div data-catalog-sites></div></details>':'';
}
