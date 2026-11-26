// Trade drafts reserve references only. Actual warehouse units stay in place until settlement.
const tradeGridState={sales:new Map(),saleUid:null,cartItem:null,recipes:new Map(),notice:'',drag:null};
const TRADE_GRID_NAMES={stock:'상인 진열대',cart:'장바구니',stash:'내 창고',sale:'판매대',recipes:'교환 진열대'};

function resetTradeDraftUI() {
  tradeGridState.sales.clear();tradeGridState.recipes.clear();
  tradeGridState.saleUid=null;tradeGridState.cartItem=null;tradeGridState.drag=null;
  tradeGridState.notice='';marketCartFeedback=null;marketResetOrder();
}
function tradePaneHead(kind,title,detail='') {
  return '<header class="mk-pane-head tg-pane-head"><h2><span class="tg-pane-icon tg-icon-'+kind+'" aria-hidden="true"></span>'+esc(title)+'</h2><span>'+esc(detail)+'</span></header>';
}
function tradePaneLinks(mode) {
  const links=mode==='sell'?[['stash','내 창고'],['order','판매대'],['stock','매입 기준']]:
    [['stock',mode==='barter'?'교환품':'진열대'],['order',mode==='barter'?'교환 명세':'장바구니'],['stash','내 창고']];
  const touchTip=mode==='buy'?'진열대 물품을 길게 눌러 장바구니로 끌어 놓으세요.':mode==='sell'?'내 창고 물품을 길게 눌러 판매대로 끌어 놓으세요.':'';
  return (touchTip?'<p class="tg-touch-tip">'+touchTip+'</p>':'')+'<nav class="tg-shortcuts" aria-label="거래 영역으로 이동">'+links.map(([pane,name])=>
    '<button data-tg="jump" data-pane="'+pane+'">'+name+' ↓</button>').join('')+'</nav>';
}
function tradeGridRows(tiles,min=4,extend=false) {
  const extent=tiles.reduce((n,t)=>Math.max(n,t.y+t.h),0);
  return Math.max(min,Math.min(TRADE_TRAY_SIZE[1],extent+(extend?2:0)));
}
function tradeTile(tile,options) {
  const {item,x,y,w,h}=tile, name=options.name||GOODS[item][0], badge=options.badge||'';
  const label=name+' · '+w+'×'+h+'칸'+(options.description?' · '+options.description:'');
  const rarity=ITEM_META[item]?.rarity||'일반';
  return '<button type="button" class="tg-tile '+(options.cls||'')+'" '+options.action+
    ' data-trade-item="'+esc(item)+'" data-x="'+x+'" data-y="'+y+'" data-w="'+w+'" data-h="'+h+'"'+
    (options.uid?' data-uid="'+esc(options.uid)+'"':'')+' data-rarity="'+esc(rarity)+'"'+
    (options.drag?' data-tg-drag="'+options.drag+'" draggable="true"':'')+
    ' aria-pressed="'+Boolean(options.chosen)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'"'+
    ' style="grid-column:'+(x+1)+'/span '+w+';grid-row:'+(y+1)+'/span '+h+'">'+
    '<span class="tg-tile-art" aria-hidden="true">'+itemArt(item)+'</span><span class="tg-tile-name">'+esc(name)+'</span>'+
    (badge?'<small>'+esc(badge)+'</small>':'')+'</button>';
}
function tradeBoard(kind,html,cols,rows,hint='',cells='') {
  return '<div class="tg-board-wrap"><div class="tg-board-scroll tg-scroll-'+kind+'" data-scroll-key="trade-'+kind+(kind==='stash'?'':'-'+marketUI.trader)+'" tabindex="0" role="region" aria-label="'+TRADE_GRID_NAMES[kind]+' 격자 스크롤">'+
    '<div class="tg-board" data-trade-grid="'+kind+'" data-cols="'+cols+'" data-rows="'+rows+'" aria-label="'+TRADE_GRID_NAMES[kind]+'"'+
    ' style="--tg-cols:'+cols+';--tg-rows:'+rows+'">'+cells+html+
    (hint?'<div class="tg-grid-hint" aria-hidden="true"><i></i><span>'+esc(hint)+'</span></div>':'')+'</div></div></div>';
}
function tradeStockGrid(ids) {
  const tiles=marketCartTiles(ids.map(item=>({item})));
  const html=tiles.map(tile=>{
    const item=tile.uid,price=GOODS[item][6];
    return tradeTile({...tile,item},{action:'data-market="item" data-id="'+esc(item)+'"',cls:'mk-offer',drag:writer&&!raid?'stock':'',
      chosen:marketUI.item===item,badge:price.toLocaleString('ko-KR'),description:money(price)});
  }).join('');
  return tradeBoard('stock',html,6,tradeGridRows(tiles,3),ids.length?'':'진열된 물품이 없습니다.');
}
function tradeCartGrid(id,cart) {
  const tiles=marketCartTiles(marketCarts.traders[id]?.items||[]);
  const html=tiles.map(tile=>{
    const item=tile.uid,line=cart.lines.find(row=>row.item===item);
    return tradeTile({...tile,item},{action:'data-tg="cart-select" data-id="'+esc(item)+'"',drag:writer&&!raid?'cart':'',
      chosen:tradeGridState.cartItem===item,badge:'×'+line.quantity,description:'주문 '+line.quantity+'개 · '+money(line.total)});
  }).join('');
  return tradeBoard('cart',html,6,tradeGridRows(tiles,4,true),html?'':'상인 물품을 여기에 놓으세요')+
    (tradeGridState.cartItem&&cart.lines.some(row=>row.item===tradeGridState.cartItem)?
    '<p class="tg-help">선택한 물품을 놓을 빈칸을 누르거나 방향키로 이동하세요.</p>':'');
}
function tradeWarehouse(trader) {
  const [cols,rows]=stashSize(),draft=tradeGridState.sales.get(trader.id)||[];
  let cells='';
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++)
    cells+='<button type="button" tabindex="-1" class="tg-cell" aria-label="창고 '+(y+1)+'행 '+(x+1)+'열" data-cash-stash-x="'+x+'" data-cash-stash-y="'+y+'" style="grid-column:'+(x+1)+';grid-row:'+(y+1)+'"></button>';
  const tiles=stashSlots.map(unit=>{
    if(unit.g==='cr_notes')return cashStashTile(unit);
    const sell=marketUI.mode==='sell', staged=sell&&draft.some(row=>row.uid===unit.uid);
    const price=stashSalePrice(unit.g),accepted=marketBuys(trader.id,unit.g);
    return tradeTile({...unit,item:unit.g},{name:caseDisplayName(unit),uid:unit.uid,action:'data-tg="stash-select"',chosen:sell&&tradeGridState.saleUid===unit.uid,
      cls:(staged?'tg-staged ':'')+(sell&&!accepted?'tg-unaccepted':''),drag:sell&&writer&&!raid&&accepted&&!staged?'stash':'',
      badge:staged?'판매 대기':sell&&accepted?price.toLocaleString('ko-KR'):'',
      description:(unit.y+1)+'행 '+(unit.x+1)+'열'+(sell?' · '+(accepted?'매입가 '+money(price):'매입 대상 외'):'')});
  }).join('');
  const occupied=stashSlots.reduce((sum,unit)=>sum+unit.w*unit.h,0);
  return '<section class="tg-warehouse tg-pane" data-trade-pane="stash" tabindex="-1">'+tradePaneHead('stash','내 창고',cols+'열 × '+rows+'행')+
    '<div class="tg-subhead"><span>점유 '+occupied+' / '+cols*rows+'칸</span><b>'+money(wallet)+'</b></div>'+
    (marketUI.mode==='sell'&&tradeGridState.saleUid?tradeSelectedUnit(trader,true):'')+
    cashCompartmentMarkup()+tradeBoard('stash',tiles,cols,rows,'',cells)+'</section>';
}
function saleQuantityWithSelection(unit, traderId) {
  const selling = new Set(tradeSaleDraft(traderId).map(row => row.uid));
  selling.add(unit.uid);
  return stashSlots.filter(row => row.g === unit.g && selling.has(row.uid)).length;
}
function saleConstructionUses(unit, quote, traderId) {
  const uses = ITEM_META[unit.g]?.hideoutUses;
  if (!quote.ok || !uses?.length) return '';
  const quantity = saleQuantityWithSelection(unit,traderId);
  const owned = stashCount(unit.g);
  const rows = uses.map(({facility, level, quantity:required}) => {
    let status = '건설에 ' + required + '개 필요';
    if (hideoutLevel(facility) >= level) status = '건설 완료';
    else if (hideout.builds[facility]?.tier === level) status = '공사 중 · 자재 지급 완료';
    return '<li><span>' + esc(FACILITIES[facility].name) + ' Lv.' + level + '</span> <b>' + status + '</b></li>';
  }).join('');
  return '<details class="tg-construction-uses" data-sale-construction="' + esc(unit.g) + '"><summary>시설 건설 사용처</summary>' +
    '<p>1개 매입가 ' + money(quote.total) + '</p><p>창고 ' + owned + '개 · 이 물품 포함 판매 후 ' +
    (owned - quantity) + '개</p><ul>' + rows + '</ul></details>';
}
function tradeSelectedUnit(trader,compact=false) {
  const unit=stashSlots.find(row=>row.uid===tradeGridState.saleUid);
  if(!unit)return compact?'':'<p class="tg-help">내 창고에서 판매할 물품을 선택하세요.</p>';
  const quote=saleQuote(trader.id,[unit.uid]),staged=(tradeGridState.sales.get(trader.id)||[]).some(row=>row.uid===unit.uid);
  const manualNote=compact && quote.ok && unit.g===WARD_SHEET ? wardSaleNote(saleQuantityWithSelection(unit,trader.id),'preview') : '';
  return '<div class="tg-unit-detail'+(compact?' tg-unit-compact':'')+'">'+(compact?'':'<div class="tg-detail-art">'+itemArt(unit.g)+'</div>')+
    '<div><strong>'+esc(caseDisplayName(unit))+'</strong><small>창고 '+(unit.y+1)+'행 '+(unit.x+1)+'열 · '+unit.w+'×'+unit.h+'칸</small>'+
    (!compact?'<small>'+esc(GOODS[unit.g][5])+' · '+esc(ITEM_META[unit.g]?.rarity||'일반')+'</small>':'')+'</div>'+
    (compact?'<button class="tg-minor" data-tg="sell-add" data-uid="'+esc(unit.uid)+'"'+(manualNote?' aria-describedby="ward-sale-preview"':'')+(!quote.ok||staged?' disabled':'')+'>'+(staged?'판매 대기':'판매대에 올리기')+'</button>':
    '<div class="tg-unit-value">'+(quote.ok?'매입가 <b>'+money(quote.total)+'</b>':esc(quote.reason||'매입 대상 외'))+'</div>')+
    manualNote+(compact?saleConstructionUses(unit,quote,trader.id):'')+'</div>';
}
function tradeIntakePanel(trader) {
  const standing=traderStanding(trader.id);
  return '<section class="tg-intake tg-stock tg-pane" data-trade-pane="stock" tabindex="-1">'+tradePaneHead('stock','매입 기준',trader.name)+
    '<div class="tg-buyer"><div>'+marketPortrait(trader)+'</div><section><small>'+esc(trader.role)+'</small><h3>'+esc(trader.name)+'</h3><p>우호도 '+standing.tier+'단계</p></section></div>'+
    '<p class="tg-accept-head">매입 품목</p><div class="tg-categories">'+trader.categories.map(category=>'<span>'+esc(category)+'</span>').join('')+'</div>'+
    tradeSelectedUnit(trader)+'</section>';
}
function tradeSaleDraft(id) {
  const rows=tradeGridState.sales.get(id)||[];
  return rows.filter(row=>stashSlots.some(unit=>unit.uid===row.uid));
}
function saleObjectiveMarkup(quote) {
  const impact=saleObjectiveImpact(quote);
  if(!impact)return '';
  const rows=impact.lines.map(row=>'<li data-sale-impact-item="'+esc(row.item)+'"><strong>'+esc(kitName(row.item))+'</strong>'+
    '<span>부족 '+row.before+'개 → <b>'+row.after+'개</b></span></li>').join('');
  return '<section class="tg-objective-impact" data-sale-objective aria-label="판매 후 고정 목표 부족량">'+
    '<h3>판매 후 목표 부족량</h3><p>'+esc(impact.title)+'</p><ul>'+rows+'</ul></section>';
}
function tradeSalePanel(trader) {
  const draft=tradeSaleDraft(trader.id),uids=draft.map(row=>row.uid),quote=saleQuote(trader.id,uids);
  const manualNote=quote.ok ? wardSaleNote(quote.lines.filter(line=>line.item===WARD_SHEET).length,'tray') : '';
  const tiles=draft.map(row=>({...stashSlots.find(unit=>unit.uid===row.uid),x:row.x,y:row.y}));
  const board=tiles.map(tile=>tradeTile({...tile,item:tile.g},{name:caseDisplayName(tile),uid:tile.uid,action:'data-tg="sale-select"',
    chosen:tradeGridState.saleUid===tile.uid,badge:stashSalePrice(tile.g).toLocaleString('ko-KR'),drag:'sale',description:'판매 대기'})).join('');
  const lines=draft.map(row=>{
    const unit=stashSlots.find(item=>item.uid===row.uid);
    return '<li><span>'+esc(caseDisplayName(unit))+'<small>창고 '+(unit.y+1)+'행 '+(unit.x+1)+'열</small></span><b>'+money(stashSalePrice(unit.g))+'</b>'+
      '<button class="tg-minor" data-tg="sell-remove" data-uid="'+esc(unit.uid)+'" aria-label="'+esc(caseDisplayName(unit))+' 판매대에서 제외">제외</button></li>';
  }).join('');
  return '<section class="tg-transaction tg-pane" data-trade-pane="order" tabindex="-1">'+tradePaneHead('sale','판매대',draft.length+'개')+
    tradeBoard('sale',board,6,tradeGridRows(tiles,4,true),board?'':'내 창고 물품을 여기에 놓으세요')+
    (draft.length?'<ul class="tg-sale-lines">'+lines+'</ul>':'')+
    '<div class="tg-settle"><dl class="mc-sums"><div class="mc-grand"><dt>판매 합계</dt><dd data-sale-total>'+money(quote.total||0)+'</dd></div>'+
    '<div><dt>정산 후 잔액</dt><dd data-sale-balance>'+money(quote.after??wallet)+'</dd></div></dl>'+
    saleObjectiveMarkup(quote)+manualNote+
    '<button class="tg-primary" data-tg="sell-confirm" data-trader="'+trader.id+'" data-token="'+esc(quote.token||'')+'"'+(manualNote?' aria-describedby="ward-sale-tray"':'')+(!quote.ok?' disabled':'')+'>판매 확정</button>'+
    (!quote.ok&&draft.length?'<p class="tg-warning">'+esc(quote.reason||'')+'</p>':'')+
    '<p class="tg-status" role="status" data-sale-notice tabindex="-1">'+esc(tradeGridState.notice)+'</p></div>'+saleReceiptMarkup(trader,!draft.length)+'</section>';
}
function tradeBarterStock(trader) {
  const offers=barterOffers(trader.id),selected=tradeRecipe(trader.id,offers);
  const tiles=marketCartTiles(offers.map(o=>({item:o.item})));
  const html=tiles.map(tile=>{
    const offer=offers.find(row=>row.item===tile.uid);
    return tradeTile({...tile,item:offer.item},{action:'data-tg="recipe" data-id="'+esc(offer.id)+'"',chosen:offer.id===selected?.id,
      badge:offer.rarity,description:'물물교환 전용 · 우호도 '+offer.tier+'단계'});
  }).join('');
  const alternatives=offers.length?[]:MARKET_TRADERS.filter(other=>other.id!==trader.id&&barterOffers(other.id).length);
  const destinations=alternatives.map(other=>'<button class="tg-minor" data-tg="other-offers" data-id="'+esc(other.id)+'">'+esc(other.name)+' 교환품 보기 →</button>').join('');
  return '<section class="tg-stock tg-pane" data-trade-pane="stock" tabindex="-1">'+tradePaneHead('stock','교환 진열대','교환 전용 '+offers.length+'종')+
    tradeBoard('recipes',html,6,tradeGridRows(tiles,offers.length?4:2),html?'':'현재 개방된 교환품이 없습니다')+
    '<p class="tg-help">'+(offers.length?'교환품을 선택해 필요한 재료와 보유 수량을 확인하세요.':'상인마다 취급하는 교환품과 필요한 우호도 단계가 다릅니다.')+'</p>'+
    (destinations?'<nav class="tg-other-offers" aria-label="현재 교환품이 개방된 상인">'+destinations+'</nav>':'')+'</section>';
}
function tradeRecipe(id,offers) {
  return offers.find(row=>row.id===tradeGridState.recipes.get(id))||offers[0];
}
function tradeBarterOrder(trader) {
  const offer=tradeRecipe(trader.id,barterOffers(trader.id));
  const head=tradePaneHead('cart','물물교환',trader.name);
  if(!offer)return '<section class="tg-transaction tg-pane" data-trade-pane="order" tabindex="-1">'+head+'<p class="tg-help">진열대에 교환품이 열리면 재료를 확인할 수 있습니다.</p></section>';
  const parts=offer.requirements.map(req=>'<li data-barter-material="'+esc(req.item)+'"><div class="tg-req-art">'+itemArt(req.item)+'</div><span><strong>'+
    esc(GOODS[req.item][0])+'</strong><small>'+esc([req.rarity,req.quality].filter(Boolean).join(' · '))+'</small></span>'+
    '<b class="'+(req.owned>=req.quantity?'tg-enough':'tg-short')+'">'+req.owned+' / '+req.quantity+'</b>'+huntTrackButton(trader.id,offer.id,req.item)+'</li>').join('');
  return '<section class="tg-transaction tg-pane" data-trade-pane="order" tabindex="-1">'+head+
    '<div class="tg-barter-hero"><span>'+itemArt(offer.item)+'</span><div><small>우호도 '+offer.tier+'단계 · 교환 전용</small><h3>'+esc(GOODS[offer.item][0])+
    '</h3><p>'+esc(offer.rarity)+' · '+esc(offer.quality)+'</p></div></div>'+
    '<div class="tg-subhead"><b>필요 재료</b><span>보유 / 필요</span></div><ul class="tg-materials">'+parts+'</ul>'+
    '<div class="tg-settle"><button class="tg-primary" data-tg="barter-confirm" data-id="'+esc(offer.id)+'" data-trader="'+trader.id+'" data-token="'+esc(offer.token||'')+'"'+
    (!offer.ok?' disabled':'')+'>물물교환 확정</button>'+(!offer.ok?'<p class="tg-warning">'+esc(offer.reason||'')+'</p>':'')+
    '<p class="tg-status" role="status">'+esc(tradeGridState.notice)+'</p></div></section>';
}
function tradeStageSale(trader,uid,position=null) {
  const unit=stashSlots.find(row=>row.uid===uid),draft=tradeSaleDraft(trader);
  const quote=saleQuote(trader,[uid]);
  if(!unit||!quote.ok)return {ok:false,reason:quote.reason};
  const old=draft.find(row=>row.uid===uid);
  if(old&&!position)return {ok:true,message:'이미 판매대에 올린 물품입니다.'};
  const rest=draft.filter(row=>row.uid!==uid);
  const shapes=rest.map(row=>{
    const source=stashSlots.find(tile=>tile.uid===row.uid);
    return {...row,w:source.w,h:source.h};
  });
  const spot=position||firstFit(shapes,TRADE_TRAY_SIZE,unit.w,unit.h);
  if(!spot||!fits(shapes,TRADE_TRAY_SIZE,spot.x,spot.y,unit.w,unit.h))return {ok:false,reason:'판매대의 겹치지 않는 빈칸에 놓으세요.'};
  tradeGridState.sales.set(trader,[...rest,{uid,...spot}]);
  tradeGridState.saleUid=uid;
  return {ok:true,message:caseDisplayName(unit)+(old?' 위치를 옮겼습니다.':' 1개를 판매대에 올렸습니다.')};
}
function tradeCartResult(trader,result,message) {
  const current=marketCarts.traders[trader];
  marketCartFeedback={trader,token:current?.token||'',message:result.ok?message:'',error:result.ok?'':result.reason};
}
function handleTradeGridUI(d) {
  if(page!=='trade')return;
  const trader=marketUI.trader;
  const keyboard=document.activeElement?.dataset?.tg===d.tg&&document.activeElement.matches?.(':focus-visible');
  if(d.tg==='jump') {
    if(['stock','order','stash'].includes(d.pane))marketCartFocus($('[data-trade-pane="'+d.pane+'"]'));
    return;
  }
  if(d.tg==='stash-select'||d.tg==='sale-select') {
    const unit=stashSlots.find(u=>u.uid===d.uid);
    if(!unit||unit.g==='cr_notes')return;
    marketUI.mode='sell';marketResetOrder();
    tradeGridState.saleUid=d.uid;tradeGridState.notice='';cashSelected=null;
  }else if(d.tg==='sell-add'&&marketUI.mode==='sell'&&d.uid===tradeGridState.saleUid) {
    const result=tradeStageSale(trader,d.uid);
    tradeGridState.notice=result.message||result.reason;
  }else if(d.tg==='sell-remove'&&marketUI.mode==='sell') {
    tradeGridState.sales.set(trader,tradeSaleDraft(trader).filter(row=>row.uid!==d.uid));
    tradeGridState.notice='판매대에서 제외했습니다.';
  }else if(d.tg==='sell-confirm'&&marketUI.mode==='sell'&&d.trader===trader) {
    const result=saleCommit(trader,tradeSaleDraft(trader).map(row=>row.uid),d.token);
    tradeGridState.notice=result.message||result.reason;
    if(result.ok){tradeGridState.sales.delete(trader);tradeGridState.saleUid=null;}
  }else if(d.tg==='other-offers'&&marketUI.mode==='barter'&&!barterOffers(trader).length&&barterOffers(d.id).length) {
    if(!marketSelectTrader(d.id))return;
  }else if(d.tg==='recipe'&&marketUI.mode==='barter'&&barterOffers(trader).some(o=>o.id===d.id)) {
    tradeGridState.recipes.set(trader,d.id);tradeGridState.notice='';
  }else if(d.tg==='barter-confirm'&&marketUI.mode==='barter'&&d.trader===trader&&tradeRecipe(trader,barterOffers(trader))?.id===d.id) {
    const result=barterCommit(trader,d.id,d.token);
    tradeGridState.notice=result.message||result.reason;
  }else if(d.tg==='cart-select'&&marketUI.mode==='buy') {
    if(!marketCarts.traders[trader]?.items.some(row=>row.item===d.id))return;
    tradeGridState.cartItem=tradeGridState.cartItem===d.id?null:d.id;
  }else return;
  renderKeep();
  if(d.tg==='other-offers')marketCartFocus($('[data-tg="recipe"][aria-pressed="true"]'),innerWidth<=850);
  if(d.tg==='cart-select')$('[data-tg="cart-select"][data-id="'+d.id+'"]')?.focus?.({preventScroll:true});
  if(keyboard&&d.tg==='stash-select'){
    const stage=$('[data-tg="sell-add"]:not(:disabled)');
    if(stage?.dataset.uid===d.uid)marketCartFocus(stage);
  }
  if((d.tg==='recipe'&&innerWidth<=850)||(d.tg==='sell-add'&&(keyboard||innerWidth<=850)))
    marketCartFocus($('[data-trade-pane="order"]'));
  if(keyboard && d.tg==='sell-remove'){
    const next=$('[data-tg="sell-remove"]')||$('[data-trade-pane="order"]');
    marketCartFocus(next,false);
  }
  if(keyboard && d.tg==='sale-select'){
    const remove=[...document.querySelectorAll('[data-tg="sell-remove"]')].find(button=>button.dataset.uid===d.uid);
    marketCartFocus(remove||$('[data-trade-pane="order"]'),false);
  }
  if(keyboard&&d.tg==='sell-confirm')marketCartFocus($('[data-sale-notice]'));
}
function tradeDropPoint(board,e) {
  const rect=board.getBoundingClientRect();
  return {x:Math.floor((e.clientX-rect.left)/rect.width*Number(board.dataset.cols)),
    y:Math.floor((e.clientY-rect.top)/rect.height*Number(board.dataset.rows))};
}
function tradeCartMove(item,spot,token) {
  const id=marketUI.trader,row=marketCarts.traders[id]?.items.find(line=>line.item===item);
  if(!row)return;
  const result=marketCartSet(id,item,row.quantity,token,spot);
  tradeCartResult(id,result,'장바구니 배치를 저장했습니다.');
}
function tradeDragTarget(event) {
  const drag=tradeGridState.drag,board=event.target.closest('.tg-board');
  if(!drag||!board||page!=='trade'||drag.trader!==marketUI.trader||drag.mode!==marketUI.mode)return null;
  const target=board.dataset.tradeGrid;
  if((target==='cart'&&['stock','cart'].includes(drag.source))||
    (target==='sale'&&['stash','sale'].includes(drag.source))||
    (target==='stash'&&drag.source==='sale')||(target==='stock'&&drag.source==='cart'))return board;
  return null;
}
function tradeClearHover() {
  inside.querySelectorAll?.('.tg-hover').forEach(el=>el.classList.remove('tg-hover'));
}
inside.addEventListener('dragstart',event=>{
  const button=event.target.closest('[data-tg-drag]');
  if(!button||!writer||raid||page!=='trade')return;
  const d=button.dataset;
  tradeGridState.drag={source:d.tgDrag,trader:marketUI.trader,mode:marketUI.mode,item:d.tradeItem,uid:d.uid,w:Number(d.w),h:Number(d.h),token:marketCarts.traders[marketUI.trader]?.token||''};
  event.dataTransfer.setData('application/x-rustline-trade',d.tgDrag);
  event.dataTransfer.effectAllowed=d.tgDrag==='stock'?'copy':'move';
});
inside.addEventListener('dragover',event=>{
  const board=tradeDragTarget(event);
  if(!board)return;
  event.preventDefault();
  event.dataTransfer.dropEffect=tradeGridState.drag.source==='stock'?'copy':'move';
  if(!board.classList.contains('tg-hover')){tradeClearHover();board.classList.add('tg-hover');}
  const {x,y}=tradeDropPoint(board,event),{w,h}=tradeGridState.drag;
  board.style.setProperty('--gx',x);board.style.setProperty('--gy',y);board.style.setProperty('--gw',w);board.style.setProperty('--gh',h);
});
inside.addEventListener('dragleave',event=>{
  const board=event.target.closest('.tg-board');
  if(board&&(!event.relatedTarget||!board.contains(event.relatedTarget)))board.classList.remove('tg-hover');
});
inside.addEventListener('dragend',()=>{tradeGridState.drag=null;tradeClearHover();});
inside.addEventListener('drop',event=>{
  const board=tradeDragTarget(event),drag=tradeGridState.drag;
  tradeGridState.drag=null;tradeClearHover();
  if(!board||!writer||raid)return;
  event.preventDefault();
  const {trader,item,uid,source}=drag,target=board.dataset.tradeGrid,spot=tradeDropPoint(board,event);
  if(target==='cart'&&source==='stock'){
    const cart=marketCarts.traders[trader]||emptyMarketCart();
    if(cart.token!==drag.token||!marketGoods(trader,'buy').includes(item))return;
    const qty=marketUI.item===item?marketUI.quantity:1;
    const result=marketCartAdd(trader,item,qty,spot);
    tradeCartResult(trader,result,GOODS[item][0]+' '+qty+'개를 담았습니다.');
  }else if(target==='cart')tradeCartMove(item,spot,drag.token);
  else if(target==='sale'){
    const result=tradeStageSale(trader,uid,spot);
    tradeGridState.notice=result.message||result.reason;
  }else if(target==='stash'){
    tradeGridState.sales.set(trader,tradeSaleDraft(trader).filter(row=>row.uid!==uid));
    tradeGridState.notice='판매대에서 제외했습니다.';
  }else if(target==='stock'){
    const result=marketCartSet(trader,item,0,drag.token);
    tradeCartResult(trader,result,'장바구니에서 제외했습니다.');
  }
  renderKeep();
});
inside.addEventListener('click',event=>{
  if(page!=='trade'||marketUI.mode!=='buy'||!tradeGridState.cartItem)return;
  const target=event.target;
  if(target.closest('button'))return;
  const board=target.closest('[data-trade-grid="cart"]');
  if(!board)return;
  const trader=marketUI.trader,item=tradeGridState.cartItem;
  tradeCartMove(item,tradeDropPoint(board,event),marketCarts.traders[trader]?.token);
  renderKeep();
});
inside.addEventListener('keydown',event=>{
  const button=event.target.closest('[data-tg="cart-select"]');
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(!button||!delta||marketUI.mode!=='buy')return;
  event.preventDefault();
  const {id,x,y}=button.dataset;
  tradeCartMove(id,{x:Number(x)+delta[0],y:Number(y)+delta[1]},marketCarts.traders[marketUI.trader]?.token);
  renderKeep();$('[data-tg="cart-select"][data-id="'+id+'"]')?.focus?.({preventScroll:true});
});
