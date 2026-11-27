// The shelf, the quote and the settlement use the same trader and item IDs.
const marketUI={trader:'supply',mode:'buy',item:null,quantity:1,receipt:null,error:''};
function marketSelection(){
  const trader=findMarketTrader(marketUI.trader)||MARKET_TRADERS[0];
  const ids=marketUI.mode==='buy'?marketGoods(trader.id,'buy'):[];
  if(marketUI.receipt?.mode==='buy'&&!ids.includes(marketUI.receipt.item))marketResetOrder();
  if(!ids.includes(marketUI.item)){
    marketUI.item=ids[0]||null;
    marketUI.quantity=1;
    marketUI.error='';
  }
  return {trader,ids};
}
function marketResetOrder(){
  marketUI.quantity=1;
  marketUI.error='';
  marketUI.receipt=null;
}
function marketPortrait(trader,thumbnail=false){
  const url=artURL('trader-'+trader.id);
  return url?'<img src="'+esc(url)+'" alt="'+(thumbnail?'':esc(trader.name)+' 초상')+'" draggable="false">':'';
}
function marketSelectTrader(id){
  if(!MARKET_TRADERS.some(trader=>trader.id===id))return false;
  marketCartFeedback=null;tradeGridState.notice='';tradeGridState.saleUid=null;tradeGridState.cartItem=null;
  marketUI.trader=id;marketUI.item=null;marketResetOrder();
  return true;
}
function marketWorkspaceTabs(isQuests){
  return '<nav class="cq-workspaces" aria-label="상인 메뉴">'+
    '<button data-page="trade" '+(!isQuests?'aria-current="page"':'')+'>'+menuIcon('trade')+'상점</button>'+
    '<button data-page="traderQuests" '+(isQuests?'aria-current="page"':'')+'>'+menuIcon('journal')+'퀘스트</button></nav>';
}
function marketTraderList(attribute='data-market'){
  return '<nav class="mk-traders" aria-label="상인 선택">'+MARKET_TRADERS.map(trader=>
    '<button type="button" '+attribute+'="trader" data-id="'+trader.id+'" aria-label="'+esc(trader.name+' · '+trader.role)+'" aria-pressed="'+(trader.id===marketUI.trader)+'">'+
    '<span class="mk-thumbnail">'+marketPortrait(trader,true)+'</span><span class="mk-trader-label"><strong>'+esc(trader.name)+'</strong><small>'+esc(trader.role)+'</small></span></button>'
  ).join('')+'</nav>';
}
function marketModeBar(){
  return '<div class="mk-modes" role="group" aria-label="거래 방식">'+
    [['buy','구매'],['sell','판매'],['barter','물물교환']].map(([mode,label])=>'<button data-market="mode" data-mode="'+mode+
    '" aria-pressed="'+(mode===marketUI.mode)+'">'+label+'</button>').join('')+'</div>';
}
function marketShelf(trader,ids){
  const standing=traderStanding(trader.id);
  const note=standing.next!==null
    ? '<p class="mk-unlock-note"><strong>우호도 '+(standing.tier+1)+'단계</strong><span>상품 '+marketTierGoods(trader.id,standing.tier+1).length+
      '종 추가</span><small>승급까지 '+(standing.next-standing.points)+'점</small></p>'
    : '<p class="mk-unlock-note"><strong>우호도 '+standing.tier+'단계</strong><span>모든 상품 개방</span></p>';
  const opened=standing.tier>=2?'<button type="button" data-market="unlocks" data-trader="'+trader.id+'">'+standing.tier+'단계 개방 상품·의뢰 보기</button>':'';
  return '<section class="mk-shelf tg-stock" data-trade-pane="stock" tabindex="-1">'+tradePaneHead('stock','상인 진열대','구매 가능 '+ids.length+'종')+
    tradeStockGrid(ids)+note+opened+'</section>';
}
function marketReceiptView(receipt){
  return '<section class="mk-checkout mk-receipt" aria-label="거래 결과"><div class="mk-pane-head"><h2>거래 내역</h2></div>'+
    '<div class="mk-receipt-body" role="status" tabindex="-1"><div class="mk-receipt-sign" aria-hidden="true">✓</div><h3>'+(receipt.mode==='buy'?'구매 완료':'판매 완료')+'</h3>'+
    '<p>'+esc(GOODS[receipt.item][0])+' <b>× '+receipt.quantity+'</b></p>'+
    '<dl class="mk-totals"><div><dt>'+(receipt.mode==='buy'?'지불 금액':'받은 금액')+'</dt><dd>'+money(receipt.total)+'</dd></div>'+
    '<div><dt>거래 후 잔액</dt><dd>'+money(receipt.balance)+'</dd></div></dl>'+
    '<p class="mk-delivery">'+(receipt.mode==='buy'?'구매한 물품을 벙커 창고에 받았습니다.'+(receipt.waiting?' 창고 입고 대기 '+receipt.waiting+'개.':''):'판매한 물품을 벙커 창고에서 넘겼습니다.')+'</p></div>'+
    '<div class="mk-receipt-actions"><button data-market="continue">계속 거래</button><button data-page="stash">창고 열기</button></div></section>';
}
function marketCheckout(trader){
  if(marketUI.receipt)return marketReceiptView(marketUI.receipt);
  const id=marketUI.item;
  if(!id)return '<section class="mk-checkout mk-order-empty"><div class="mk-pane-head"><h2>거래 명세</h2></div><p>선택된 물품이 없습니다.</p></section>';
  const good=GOODS[id],qty=marketUI.quantity,buy=marketUI.mode==='buy';
  const quote=marketQuote(trader.id,marketUI.mode,id,qty),note=marketUI.error||(!quote.ok?quote.reason:'');
  const supply=kitSupply(id);
  const usage=supply?supply.label+' +'+supply.gain:ITEM_META[id]?.usage;
  return '<section class="mk-checkout" tabindex="-1" aria-label="거래 명세"><div class="mk-pane-head"><h2>거래 명세</h2><span>'+esc(trader.name)+'</span></div>'+
    '<div class="mk-order-body"><div class="mk-selected"><div class="mk-large-art">'+itemArt(id)+'</div><div><small>'+esc(good[5])+'</small><h3>'+esc(good[0])+'</h3>'+
    '<p>'+good[1]+' × '+good[2]+'칸 · '+good[3]+' kg</p></div></div>'+(usage?'<p class="mk-usage">'+esc(usage)+'</p>':'')+
    '<dl class="mk-totals"><div><dt>개당 '+(buy?'구매가':'판매가')+'</dt><dd>'+money(quote.unit)+'</dd></div>'+
    '<div><dt>창고 보유</dt><dd>'+stashCount(id)+'개</dd></div></dl>'+
    '<div class="mk-quantity"><span>수량</span><div><button data-market="quantity" data-step="-1" aria-label="수량 줄이기" '+(qty<=1?'disabled':'')+'>−</button>'+
    '<b aria-label="거래 수량">'+qty+'</b><button data-market="quantity" data-step="1" aria-label="수량 늘리기" '+(qty>=quote.max?'disabled':'')+'>+</button></div></div>'+
    '<div class="mk-total"><span>'+(buy?'지불 금액':'받을 금액')+'</span><strong>'+money(quote.total)+'</strong></div>'+
    (note?'<p class="mk-warning" role="status">'+esc(note)+'</p>':'')+
    '<button type="button" class="mk-submit" data-market="trade" data-id="'+id+'" data-mode="'+marketUI.mode+'" data-trader="'+trader.id+'" data-qty="'+qty+'" '+(!quote.ok?'disabled':'')+'>'+
    (buy?'구매하기':'판매하기')+'</button>'+(buy?marketCartAddButton(trader.id,id,qty):'')+'</div></section>';
}
function marketView(){
  const {trader,ids}=marketSelection();
  const cart=marketCartView(trader.id);
  const lock=raid?'<div class="mk-raid" role="status"><div><b>벙커 귀환 후 거래할 수 있습니다.</b><span>상인과 취급 품목은 지금 살펴볼 수 있습니다.</span></div><button data-page="raid">'+(field?.result?'작전 결과 확인':'현장으로 복귀')+'</button></div>':'';
  const mode=marketUI.mode,standing=traderStanding(trader.id);
  const stock=mode==='sell'?tradeIntakePanel(trader):mode==='barter'?tradeBarterStock(trader):marketShelf(trader,ids);
  const transaction=mode==='sell'?tradeSalePanel(trader):mode==='barter'?tradeBarterOrder(trader):marketCartPanel(trader,cart);
  return '<div class="mk-screen tg-screen tg-counter" data-mode="'+mode+'"><header class="mk-head"><h1>벙커 상점</h1>'+marketWorkspaceTabs(false)+
    '<div class="mc-head-actions">'+marketCartJump(trader.id,cart)+'<button data-page="stash">벙커 창고 ↗</button></div></header>'+
    marketTraderList()+lock+'<div class="tg-toolbar">'+marketModeBar()+'<div class="tg-standing"><strong>'+esc(trader.name)+'</strong><span>우호도 '+standing.tier+'단계 · '+standing.points+'점</span></div></div>'+
    (mode==='buy'&&objectivePin&&!raid?procurementPanel(trader.id):'')+tradePaneLinks(mode)+'<div class="tg-workspace">'+stock+transaction+tradeWarehouse(trader)+'</div></div>';

}
function handleMarketUI(d){
  if(page!=='trade')return;
  const {trader,ids}=marketSelection();
  const active=document.activeElement;
  const restoreFocus=active?.dataset?.market===d.market&&active.matches?.(':focus-visible');
  switch(d.market){
    case 'unlocks':{
      const rank=traderStanding(trader.id).tier;
      if(d.trader!==trader.id||marketUI.mode!=='buy'||rank<2)return;
      setTraderQuestMode('standing');contractPanel.trader=trader.id;
      contractSelectTier(rank,contractBoardEntries(trader.id,rank));
      navigatePage('traderQuests');
      marketCartFocus($('.cq-list'));
      return;
    }
    case 'trader':
      if(!marketSelectTrader(d.id))return;
      break;
    case 'mode':
      if(!['buy','sell','barter'].includes(d.mode))return;
      tradeGridState.notice='';tradeGridState.saleUid=null;tradeGridState.cartItem=null;
      marketUI.mode=d.mode;marketUI.item=null;marketResetOrder();break;
    case 'item':
      if(marketUI.mode==='sell'&&marketGoods(trader.id,'buy').includes(d.id))marketUI.mode='buy';
      else if(!ids.includes(d.id))return;
      marketUI.item=d.id;marketResetOrder();break;
    case 'quantity':{
      if(!marketUI.item||marketUI.receipt||!['-1','1'].includes(String(d.step)))return;
      const limit=marketQuote(trader.id,marketUI.mode,marketUI.item,1).max;
      marketUI.quantity=Math.max(1,Math.min(limit,marketUI.quantity+Number(d.step)));marketUI.error='';break;
    }
    case 'trade':{
      if(marketUI.mode!=='buy'||marketUI.receipt||d.trader!==trader.id||d.mode!==marketUI.mode||d.id!==marketUI.item||Number(d.qty)!==marketUI.quantity)return;
      const queued=stashOverflowCount(marketUI.item);
      const result=marketTrade(trader.id,marketUI.mode,marketUI.item,marketUI.quantity);
      marketUI.error=result.ok?'':result.reason;
      if(result.ok)marketUI.receipt={mode:marketUI.mode,item:marketUI.item,quantity:marketUI.quantity,total:result.total,balance:wallet,waiting:Math.max(0,stashOverflowCount(marketUI.item)-queued)};
      break;
    }
    case 'continue':marketResetOrder();break;
    default:return;
  }
  renderKeep();
  if(restoreFocus){
    let target;
    if(d.market==='trade'&&marketUI.receipt)target=document.querySelector('.mk-receipt-body');
    else if(d.market==='item'&&innerWidth<=680)target=document.querySelector('.mk-checkout');
    else if(d.market==='continue')target=document.querySelector('.mk-checkout button:not(:disabled)')||document.querySelector('.mk-modes button[aria-pressed="true"]');
    else{
      const buttons=document.querySelectorAll('.mk-screen button[data-market]');
      target=Array.from(buttons).find(button=>!button.disabled&&Object.entries(d).every(([key,value])=>button.dataset[key]===value));
      if(!target&&d.market==='quantity')target=document.querySelector('.mk-quantity button:not(:disabled)');
    }
    target?.focus?.({preventScroll:true});
  }
  if(d.market==='item'&&innerWidth<=680)
    document.querySelector('.mk-checkout')?.scrollIntoView({block:'nearest'});
}
