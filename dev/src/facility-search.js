// Advisory for a pinned construction step. Only an explicitly opened map guide evaluates loot odds.
function facilitySearchInputs(objective,quote){
  if(raid || objective?.source.kind!=='facility' || !quote?.budget?.unavailable.length)return null;
  const blocked=new Set(quote.budget.unavailable.map(line=>line.item));
  const needed=new Map(objective.materials.filter(m=>m.required>m.owned)
    .map(m=>[m.id,{id:m.id,quantity:m.required-m.owned,blocked:blocked.has(m.id)}]));
  // A detached part need not be found again. Worn modules are already counted in objectiveMaterial.
  if(Object.values(PRESET_MODULES).some(parts=>parts.some(id=>needed.has(id)))){
    for(const row of possessionLocations()){
      const item=needed.get(row.id);
      if(item && row.ownerId){
        item.quantity-=row.quantity;
        if(item.quantity<=0)needed.delete(row.id);
      }
    }
  }
  const sites=objective.locations.filter(site=>site.possible && site.items.filter(id=>needed.has(id)).length>=2 &&
    site.items.some(id=>needed.get(id)?.blocked));
  return sites.length?{needed,sites}:null;
}

function facilitySearchPlan(inputs){
  const best=new Map(),excluded=[];
  for(const site of inputs.sites){
    const point=LANDMARKS[site.zone][site.landmark],lack=site.items.map(id=>inputs.needed.get(id)).filter(Boolean);
    const miss=new Map(lack.map(row=>[row.id,1])),boxes=[];
    for(const index of point.boxes){
      const [name,,table]=FIELD_ZONES[site.zone].boxes[index];
      if(!lack.some(row=>ITEM_META[row.id].lootSources.includes(table)))continue;
      const lock=lootLockView(site.zone,index);
      if(lock && !lock.carried){
        excluded.push({zone:site.zone,landmark:site.landmark,name,key:lock.keyName});
        continue;
      }
      let contributes=false;
      for(const row of lack){
        const probability=huntContainerOdds(table,row.id).whole;
        if(probability>0){
          // Separate physical containers roll independently. Within each container use whole-item odds.
          miss.set(row.id,miss.get(row.id)*(1-probability));
          contributes=true;
        }
      }
      if(contributes)boxes.push({name,key:lock?.keyName});
    }
    const items=lack.map(row=>({...row,chance:1-miss.get(row.id)})).filter(row=>row.chance>0);
    if(items.length<2||!items.some(row=>row.blocked))continue;
    const expected=items.reduce((sum,row)=>sum+row.chance,0);
    const entry={zone:site.zone,landmark:site.landmark,items,boxes,expected};
    if(!best.has(site.zone)||expected>best.get(site.zone).expected)best.set(site.zone,entry);
  }
  return {sites:[...best.values()].sort((a,b)=>b.expected-a.expected||a.zone-b.zone),excluded};
}

function facilitySearchMarkup(plan){
  const cards=plan.sites.map(site=>'<section data-material-site="'+site.zone+'-'+site.landmark+'"><h4>'+
    esc(objectivePlaceName(site))+' · 평균 '+site.expected.toLocaleString('ko-KR',{maximumFractionDigits:2})+'종</h4>'+
    '<p>'+site.boxes.map(box=>esc(box.name)+(box.key?' ('+esc(box.key)+' 휴대)':'')).join(' · ')+'</p><ul>'+
    site.items.map(row=>'<li data-material-site-item="'+esc(row.id)+'">'+esc(kitName(row.id))+' '+row.quantity+'개 부족 · '+
      huntOddsPercent(row.chance)+(row.blocked?' · 현재 CR 구매 불가':'')+'</li>').join('')+'</ul></section>').join('');
  const excluded=plan.excluded.map(box=>esc(objectivePlaceName(box))+' · '+esc(box.name)+' ('+esc(box.key)+' 필요)').join(' / ');
  return (cards?'<p>현재 CR로 살 수 없는 자재를 포함해 부족품 2종 이상을 찾을 수 있는 후보입니다. 권역마다 기대 종류 수가 가장 높은 한 곳을 표시합니다.</p>'+cards:
    '<p>현재 휴대 장비로 두 종류 이상을 찾을 수 있는 지점이 없습니다.</p>')+
    (excluded?'<p data-material-site-locked><b>열쇠 미휴대로 제외</b> '+excluded+'</p>':'')+
    (cards?'<p class="obj-rule">확률은 표시된 새 보관함 전체에서 해당 자재가 1개 이상 나올 확률입니다. 같은 자재는 여러 개여도 한 종류로 셉니다. 다른 생존자가 먼저 수색하면 남은 물품은 달라질 수 있습니다.</p>':'');
}

function facilitySearchDisclosure(objective,inputs){
  if(!inputs)return '';
  return '<details class="obj-sources obj-material-sites" data-facility-search="'+esc(objective.source.id)+'" data-tier="'+objective.source.tier+'">'+
    '<summary>자재를 찾을 지점 · 권역별 비교</summary><div data-material-sites></div></details>';
}

inside.addEventListener('toggle',event=>{
  const details=event.target;
  if(!details.dataset?.facilitySearch || !details.open || !details.isConnected || raid || page!=='map')return;
  const objective=resolveObjective();
  if(objective?.source.kind!=='facility'||objective.source.id!==details.dataset.facilitySearch||objective.source.tier!==Number(details.dataset.tier))return;
  const body=details.querySelector('[data-material-sites]');
  if(body.hasChildNodes())return;
  const inputs=facilitySearchInputs(objective,objectiveCartView(objective));
  if(inputs)body.innerHTML=facilitySearchMarkup(facilitySearchPlan(inputs));
},true);
