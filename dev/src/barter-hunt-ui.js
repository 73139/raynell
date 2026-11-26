let huntUiRegion=null,huntUiMessage='';
function huntAmounts(v){
  return '<dl class="bh-counts"><div><dt>교환에 필요</dt><dd>'+v.needed+'개</dd></div><div><dt>창고 격자</dt><dd>'+v.owned+'개</dd></div>'+
    '<div><dt>'+(v.inField?'현장 휴대':'출격 가방')+'</dt><dd>'+v.carried+'개</dd></div><div><dt>창고 부족</dt><dd>'+v.missing+'개</dd></div></dl>';
}
function huntSummary(where){
  const v=barterHuntView();if(!v)return '';
  const point=v.destination?LANDMARKS[v.destination.zone][v.destination.index].name:'';
  const last=where==='result'&&lastSummary? (lastSummary.goods||[]).filter(id=>id===v.item).length:0;
  const outcome=last?'<p data-hunt-outcome>이번 출격 '+(lastSummary.result==='success'?'회수':'손실')+' '+last+'개</p>':'';
  return '<section class="bh-summary" data-hunt-summary="'+where+'"><div class="bh-heading"><div><small>교환 재료 추적 · '+esc(kitName(v.recipe))+'</small>'+
    '<h2>'+esc(kitName(v.item))+'</h2></div><button type="button" data-page="barterhunt">수색처 보기</button></div>'+huntAmounts(v)+outcome+
    (v.inField&&v.carried?'<p>휴대분을 생환 후 창고에 보관하면 부족 '+v.toFind+'개</p>':'')+
    (point?'<p>출격 지점 · '+esc(point)+'</p>':'')+'</section>';
}
function huntBadge(unit){
  if(!unit.revealed||!barterHunt||unit.g!==barterHunt.item)return '';
  return '<b class="bh-badge" data-hunt-badge aria-label="추적 중인 교환 재료">교환</b>';
}
function huntTrackButton(trader,recipe,item){
  if(!huntRegions(item).some(region=>region.landmarks.length))return '';
  const selected=barterHunt?.trader===trader&&barterHunt.recipe===recipe&&barterHunt.item===item;
  return '<button type="button" class="bh-track" data-bh="track" data-trader="'+trader+'" data-recipe="'+recipe+'" data-item="'+item+
    '"'+(raid||!writer?' disabled':'')+' aria-label="'+esc(kitName(item))+' 수색처 보기">'+(selected?'추적 중 · 수색처 보기':'재료 수색처 보기')+'</button>'+huntCasesMarkup(trader,recipe,item,false);
}
function barterHuntPage(){
  const v=barterHuntView();
  if(!v)return '<section class="bh-page"><h1>교환 재료 수색</h1><p>상인 물물교환에서 재료 옆의 ‘재료 수색처 보기’를 선택하세요.</p><button data-page="trade">벙커 상점</button></section>';
  const regions=huntRegions(v.item),selected=huntUiRegion??v.destination?.zone??regions.find(r=>r.landmarks.length)?.zone??0;
  const region=regions[selected], [,width,height]=GOODS[v.item];
  const meta=ITEM_META[v.item];
  const footprint=width+' × '+height+'칸';
  const cards=region.landmarks.map(point=>{
    const selectedPoint=v.destination?.zone===selected&&v.destination.index===point.index;
    return '<article class="lp-point" data-hunt-point="'+point.index+'"><h3>'+esc(point.name)+(selectedPoint?' · 지정됨':'')+'</h3>'+
      '<ul>'+point.boxes.map(box=>{
        const odds=huntContainerOdds(box.table,v.item);
        return '<li data-hunt-odds="'+esc(box.table)+'"><span>'+esc(box.name)+(box.keyId?' · '+esc(kitName(box.keyId))+' 필요':'')+'</span>'+
          '<small><span>첫 추첨 <b data-hunt-first>'+huntOddsPercent(odds.first)+'</b></span> · <span>상자 전체 1개 이상 <b data-hunt-whole>'+huntOddsPercent(odds.whole)+'</b></span></small></li>';
      }).join('')+'</ul>'+
      '<button type="button" data-bh="candidate" data-zone="'+selected+'" data-index="'+point.index+'">'+
      (!raid?'이 지점으로 출격 준비':selected===raid.zone?'현장 지점 보기':'권역 이동 경로 보기')+'</button></article>';
  }).join('');
  return '<article class="bh-page" data-hunt-page="'+v.item+'"><div class="bh-heading"><div><small>'+esc(findMarketTrader(v.trader).name)+' · '+esc(kitName(v.recipe))+'</small>'+
    '<h1>'+esc(kitName(v.item))+' 수색</h1></div><button type="button" data-bh="clear"'+(!writer?' disabled':'')+'>재료 추적 해제</button></div>'+
    '<div class="bh-item">'+itemArt(v.item)+'<div><b>'+esc(kitName(v.item))+'</b><small data-hunt-footprint>'+esc([footprint,meta?.rarity,meta?.quality].filter(Boolean).join(' · '))+'</small></div></div>'+huntAmounts(v)+'<p>창고 격자에 꺼낸 재료로 교환합니다. 가방 속 재료는 생환 뒤 창고에 보관하세요.</p>'+
    huntCasesMarkup(v.trader,v.recipe,v.item,true)+'<div class="bh-nav"><button type="button" data-bh="offer">교환 명세 보기</button><button type="button" data-page="lootplan">분류별 수색 계획</button></div>'+
    (huntUiMessage?'<p role="status">'+esc(huntUiMessage)+'</p>':'')+
    '<section class="lp-region"><div class="lp-region-tabs" aria-label="수색 권역">'+regions.map(r=>'<button data-bh="region" data-zone="'+r.zone+'" aria-pressed="'+(selected===r.zone)+'">'+esc(r.name)+'</button>').join('')+
    '</div><div class="bh-points"><h2>'+esc(region.name)+'</h2><p>첫 추첨은 첫 물품이 이 재료일 확률입니다. 상자 전체는 새로 생성한 상자에 이 재료가 하나 이상 들어 있을 확률입니다. 두 수치 모두 빈 상자를 포함합니다. 지점은 첫 추첨 확률순입니다.</p>'+
    (cards||'<p>이 권역에는 해당 재료의 수색 후보가 없습니다.</p>')+'</div></section></article>';
}
function handleBarterHuntUI(d){
  const v=barterHuntView(),z=Number(d.zone),index=Number(d.index);
  if(d.bh==='case'||d.bh==='case-back'){handleHuntCase(d);return;}
  if(d.bh==='track'){
    if(page!=='trade'||marketUI.mode!=='barter'||marketUI.trader!==d.trader||tradeRecipe(d.trader,barterOffers(d.trader))?.id!==d.recipe)return;
    const result=pinBarterHunt(d.trader,d.recipe,d.item);
    if(!result.ok){tradeGridState.notice=result.message;renderKeep();return;}
    huntUiRegion=null;huntUiMessage='';navigatePage('barterhunt');return;
  }
  if(page!=='barterhunt'||!v)return;
  if(d.bh==='clear'){
    const result=writeBarterHunt(null);
    if(result.ok){huntUiRegion=null;huntUiMessage='';navigatePage('lootplan');return;}
    huntUiMessage=result.message;
  }else if(d.bh==='offer'){
    marketSelectTrader(v.trader);marketUI.mode='barter';tradeGridState.recipes.set(v.trader,v.recipe);navigatePage('trade');return;
  }else if(d.bh==='region'&&Number.isInteger(z)&&FIELD_ZONES[z]){huntUiRegion=z;huntUiMessage='';}
  else if(d.bh==='candidate'&&huntPoint(v.item,z,index)){
    if(!raid){
      const result=selectHuntDestination(z,index);
      if(result.ok){zone=z;commandInspection=null;navigatePage('prep');return;}
      huntUiMessage=result.message;
    }else if(field.result){huntUiMessage='벙커 복귀 뒤 다음 출격 지점을 선택하세요.';}
    else if(raid.zone!==z){commandInspection={raidId:raid.startedAt,origin:raid.zone,index:z};navigatePage('map');return;}
    else if(!field.open&&!field.journey&&!field.contact&&!field.action){navigatePage('raid');selectLandmark(index);return;}
    else{huntUiMessage='진행 중인 행동을 마치고 현장 지점을 선택하세요.';}
  }else return;
  renderKeep();
}

// This return link is navigation only. After a reload the persisted ingredient pin supplies the route.
let huntCaseOrigin=null;
function huntCasesMarkup(trader,recipe,item,expanded){
  const cases=huntMaterialCases(trader,recipe,item);
  if(!cases.length)return '';
  const total=cases.reduce((n,entry)=>n+entry.quantity,0);
  const entries=cases.map(c=>'<li><span><b>'+esc(c.name)+'</b><small>창고 '+c.row+'행 '+c.col+'열 · '+c.quantity+'개</small></span>'+
    '<button type="button" data-bh="case" data-trader="'+esc(trader)+'" data-recipe="'+esc(recipe)+'" data-item="'+esc(item)+
    '" data-key="'+esc(c.key)+'" data-case-uid="'+esc(c.caseUid)+'" aria-label="'+esc(c.name+'에서 '+kitName(item)+' 찾기')+'"'+
    (raid||!writer?' disabled':'')+'>위치 보기</button></li>').join('');
  return '<details class="bh-cases" data-material-cases="'+esc(item)+'"'+(expanded?' open':'')+'><summary>내 보관함에 '+total+'개 · '+cases.length+'곳</summary>'+
    '<p>'+(raid?'벙커로 귀환하면 보관함에서 꺼낼 수 있습니다.':'위치 보기로 보관함을 열고, 표시된 물품을 눌러 창고로 꺼내세요.')+'</p><ul>'+entries+'</ul></details>';
}

function huntCaseBackButton(unit){
  const origin=huntCaseOrigin;
  if(!origin||raid||openedCaseUid!==unit.uid||origin.caseUid!==unit.uid||!huntRecipe(origin.trader,origin.recipe,origin.item))return '';
  return '<button type="button" class="bh-case-back" data-bh="case-back">'+
    (origin.page==='barterhunt'?'재료 수색처로 돌아가기':'교환 명세로 돌아가기')+'</button>';
}

function handleHuntCase(d){
  // A prior tab may have withdrawn or relocated the unit before its storage event arrived.
  const disk=getJSON(SAVE_KEY);
  if(disk&&disk.revision!==revision)readSession();
  if(d.bh==='case-back'){
    const src=huntCaseOrigin,unit=selectedStashUnit();
    if(!src||raid||!writer||!['stash','inventory'].includes(page)||unit?.uid!==src.caseUid||!huntRecipe(src.trader,src.recipe,src.item))return;
    huntCaseOrigin=null;
    if(src.page==='barterhunt'&&barterHunt?.trader===src.trader&&barterHunt?.recipe===src.recipe&&barterHunt?.item===src.item){navigatePage('barterhunt');return;}
    marketSelectTrader(src.trader);marketUI.mode='barter';tradeGridState.recipes.set(src.trader,src.recipe);navigatePage('trade');return;
  }
  const inHunt=page==='barterhunt'&&barterHunt?.trader===d.trader&&barterHunt?.recipe===d.recipe&&barterHunt?.item===d.item;
  const inOffer=page==='trade'&&marketUI.mode==='barter'&&marketUI.trader===d.trader&&tradeRecipe(d.trader,barterOffers(d.trader))?.id===d.recipe;
  const row=resolvePossession(d.key);
  if(raid||!writer||!(inHunt||inOffer)||!huntRecipe(d.trader,d.recipe,d.item)||row?.kind!=='case'||row.caseUid!==d.caseUid||row.id!==d.item||row.ownerId){
    const msg='현재 보관 위치와 교환 조건을 다시 확인하세요.';
    if(page==='barterhunt')huntUiMessage=msg;
    if(page==='trade')tradeGridState.notice=msg;
    renderKeep();return;
  }
  huntCaseOrigin={page,trader:d.trader,recipe:d.recipe,item:d.item,caseUid:row.caseUid};
  posQuery=kitName(row.id);posOffset=0;
  locatePossession(row.key);
}
