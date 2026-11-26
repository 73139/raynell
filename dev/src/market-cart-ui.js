// A button carries the identity of the draft that produced its displayed quote.
let marketCartFeedback=null;

function marketCartAddButton(trader,item,quantity) {
  return '<button type="button" class="mc-add" data-cart="add" data-trader="'+trader+
    '" data-id="'+item+'" data-qty="'+quantity+'" '+(writer&&!raid?'':'disabled')+'>장바구니 담기</button>';
}

function marketCartJump(trader,cart) {
  return '<button type="button" data-cart="open" data-trader="'+trader+'" aria-controls="market-cart-panel">장바구니 <b>'+cart.quantity+'개</b></button>';
}

function marketCartLine(row,trader,token) {
  const name=esc(GOODS[row.item][0]);
  const args=' data-trader="'+trader+'" data-id="'+row.item+'" data-token="'+esc(token)+'" data-qty="'+row.quantity+'"';
  const locked=!writer||Boolean(raid);
  const control=(action,label,caption,disabled=false)=>'<button type="button" data-cart="'+action+'"'+args+
    ' aria-label="'+name+' '+label+'"'+(disabled||locked?' disabled':'')+'>'+caption+'</button>';
  return '<li class="mc-line" data-cart-line="'+row.item+'"><div class="mc-item"><span class="mc-art" aria-hidden="true">'+itemArt(row.item)+'</span>'+
    '<div><h3>'+name+'</h3><small>단가 <span data-cart-unit>'+money(row.unit)+'</span></small></div></div>'+
    '<div class="mc-row-edit"><div class="mc-counter" aria-label="'+name+' 수량">'+control('dec','수량 줄이기','−',row.quantity<=1)+
    '<b data-cart-qty>'+row.quantity+'</b>'+control('inc','수량 늘리기','+')+'</div>'+control('remove','장바구니에서 삭제','삭제')+'</div>'+
    '<div class="mc-line-total"><small>소계</small> <b data-cart-subtotal>'+money(row.total)+'</b></div></li>';
}

function marketCartReceiptMarkup(receipt,trader,open) {
  if(!receipt)return '';
  const rows=receipt.lines.map(row=>'<li data-cart-receipt-line="'+row.item+'"><span><b>'+esc(GOODS[row.item][0])+'</b>'+
    '<small>단가 '+money(row.unit)+' × '+row.quantity+'개</small></span><strong>'+money(row.total)+'</strong></li>').join('');
  return '<details class="mc-history" data-cart-history'+(open?' open':'')+'><summary>최근 일괄 구매 영수증</summary>'+
    '<div data-cart-receipt tabindex="-1" aria-label="'+esc(trader.name)+' 일괄 구매 영수증"><h3>일괄 구매 완료</h3>'+
    '<p>'+esc(trader.name)+' · 창고 입고 '+receipt.lines.length+'종 '+receipt.quantity+'개</p>'+
    '<ul class="mc-receipt-lines">'+rows+'</ul><dl class="mc-sums"><div><dt>결제 전 잔액</dt><dd>'+money(receipt.before)+'</dd></div>'+
    '<div><dt>결제 금액</dt><dd data-cart-receipt-total>'+money(receipt.total)+'</dd></div>'+
    '<div><dt>결제 후 잔액</dt><dd data-cart-receipt-balance>'+money(receipt.balance)+'</dd></div></dl>'+
    '<button type="button" data-page="stash" class="mc-stash">구매한 물품 창고에서 보기</button></div></details>';
}

function marketCartPanel(trader,cart) {
  const hasOrder=cart.lines.length>0;
  const feedback=marketCartFeedback?.trader===trader.id&&marketCartFeedback.token===cart.token?marketCartFeedback:null;
  const warning=feedback?.error || (hasOrder&&!cart.ok?cart.reason:'');
  const recent=marketCartReceiptMarkup(cart.receipt,trader,!hasOrder);
  const notice='<p class="mc-notice" data-cart-notice role="status">'+esc(feedback?.message||'')+'</p>';
  const issue='<p class="mc-warning" id="mc-order-reason" data-cart-warning role="status"'+(warning?'':' hidden')+'>'+esc(warning)+'</p>';
  const browse='<button type="button" class="mc-browse" data-cart="shelf">진열대에서 고르기</button>';
  let body;
  if(hasOrder){
    const order=cart.lines.map(row=>marketCartLine(row,trader.id,cart.token)).join('');
    const balance=cart.after<0?'부족 '+money(-cart.after):money(cart.after);
    body='<div class="mc-body"><ul class="mc-lines">'+order+'</ul><section class="mc-payment" aria-label="일괄 구매 견적">'+
      '<dl class="mc-sums"><div><dt>보유 잔액</dt><dd>'+money(cart.balance)+'</dd></div>'+
      '<div class="mc-grand"><dt>주문 합계</dt><dd data-cart-total>'+money(cart.total)+'</dd></div>'+
      '<div><dt>결제 후 잔액</dt><dd data-cart-balance>'+balance+'</dd></div></dl>'+issue+
      '<button type="button" class="mc-pay" data-cart="checkout" data-trader="'+trader.id+'" data-token="'+esc(cart.token)+'"'+
      (cart.ok?'':' disabled aria-describedby="mc-order-reason"')+'>일괄 구매하기</button></section></div>';
  }else{
    body=(cart.receipt?'':'<p class="mc-empty">진열대에서 물품과 수량을 고른 뒤 장바구니에 담으세요.</p>')+issue;
  }
  return '<section id="market-cart-panel" class="mc-panel tg-transaction" data-trade-pane="order" data-cart-panel data-trader="'+trader.id+'" tabindex="-1" aria-labelledby="mc-title">'+
    '<header class="mc-head"><div><h2 id="mc-title">'+esc(trader.name)+' 장바구니</h2><span data-cart-count>'+
    cart.lines.length+'종 · '+cart.quantity+'개</span></div>'+browse+'</header>'+tradeCartGrid(trader.id,cart)+notice+body+recent+'</section>';
}

function marketCartFocus(target,scroll=true) {
  if(!target)return;
  target.focus?.({preventScroll:true});
  const viewport=$('.content');
  if(scroll&&target.getBoundingClientRect&&viewport?.getBoundingClientRect){
    const y=target.getBoundingClientRect().top-viewport.getBoundingClientRect().top;
    if(innerWidth>850&&target.matches?.('[data-cart-panel]')&&y>=0&&y<viewport.clientHeight-80)return;
    viewport.scrollTop+=y-(innerWidth<=850?42:8);
  }
}

function marketCartFocusSelector() {
  const node=document.activeElement;
  if(node?.matches?.('[data-cart-panel]'))return '[data-cart-panel]';
  if(node?.matches?.('[data-cart-receipt]'))return '[data-cart-receipt]';
  if(!node?.matches?.('button[data-cart]'))return '';
  const {cart,id,trader}=node.dataset;
  return '[data-cart="'+cart+'"]'+(id?'[data-id="'+id+'"]':'')+(trader?'[data-trader="'+trader+'"]':'')+':not(:disabled)';
}

function openMarketCartLink() {
  marketSelectTrader(marketCartSeller());
  marketUI.mode='buy';
}

function handleMarketCartUI(d) {
  if(page!=='trade')return;
  const trader=marketUI.trader;
  if(d.cart==='open'){
    if(marketUI.mode!=='buy'){marketUI.mode='buy';marketUI.item=null;marketResetOrder();renderKeep();}
    marketCartFocus($('[data-cart-panel]'));return;
  }
  if(d.cart==='shelf'){
    if(marketUI.mode!=='buy'){
      marketUI.mode='buy';marketUI.item=null;marketResetOrder();renderKeep();
    }
    marketCartFocus($('.mk-offer[aria-pressed="true"]')||$('.mk-shelf'));return;
  }
  if(d.trader!==trader)return;
  let result,message='';
  if(d.cart==='add'){
    if(marketUI.mode!=='buy'||marketUI.receipt||d.id!==marketUI.item||Number(d.qty)!==marketUI.quantity)return;
    result=marketCartAdd(trader,d.id,marketUI.quantity);
    message=GOODS[d.id][0]+' '+marketUI.quantity+'개를 담았습니다.';
  }else if(d.cart==='checkout'){
    result=marketCartCheckout(trader,d.token);
  }else if(['inc','dec','remove'].includes(d.cart)){
    const count=Number(d.qty);
    if(!Number.isSafeInteger(count)||count<1)return;
    const quantity=d.cart==='remove'?0:count+(d.cart==='inc'?1:-1);
    if(d.cart==='dec'&&quantity<1)return;
    result=marketCartSet(trader,d.id,quantity,d.token);
    if(result.ok)message=GOODS[d.id][0]+(quantity?' 수량 '+quantity+'개.':' 삭제됨.');
  }else return;
  const current=marketCartView(trader);
  marketCartFeedback={trader,token:current.token,message:result.ok?message:'',error:result.ok?'':result.reason};
  renderKeep();
  if(d.cart==='checkout'&&result.ok){
    const history=$('[data-cart-history]');
    if(history)history.open=true;
    marketCartFocus($('[data-cart-receipt]'));return;
  }
  if(d.cart==='inc'||d.cart==='dec'){
    const row='[data-cart-line="'+d.id+'"] ';
    const control=$(row+'[data-cart="'+d.cart+'"]:not(:disabled)')||$(row+'[data-cart="inc"]:not(:disabled)');
    if(control){marketCartFocus(control,false);return;}
  }
  marketCartFocus($('[data-cart-panel]'));
}
