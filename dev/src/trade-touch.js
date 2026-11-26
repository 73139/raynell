// Keep the browser's normal tap and pan until a stationary long press claims one finger.
let tradeTouch=null;
const TRADE_HOLD_MS=360;
const TRADE_PAN_SLOP=9;

function clearTradeTouch(){
  if(!tradeTouch)return;
  const drag=tradeTouch;tradeTouch=null;
  clearTimeout(drag.timer);
  drag.observer?.disconnect();
  drag.drop?.remove();
  drag.tile.draggable=drag.wasDraggable;
  drag.tile.classList.remove('tg-touch-held');
  tradeClearHover();
}
function validTradeTouch(drag){
  return writer&&!raid&&page==='trade'&&drag.tile.isConnected&&drag.trader===marketUI.trader&&drag.mode===marketUI.mode;
}
function startTradeHold(drag){
  if(tradeTouch!==drag||!validTradeTouch(drag)){clearTradeTouch();return;}
  const drop=document.createElement('div');
  drop.className='tg-touch-drop';
  drop.dataset.touchDrop=drag.source==='stock'?'cart':'sale';
  drop.setAttribute('role','status');
  const name=document.createElement('small'),action=document.createElement('strong');
  name.textContent=GOODS[drag.item][0];
  action.textContent=drag.source==='stock'?'장바구니에 담기':'판매대에 올리기';
  drop.append(name,action);document.body.append(drop);
  drag.drop=drop;
  drag.tile.classList.add('tg-touch-held');
}
function tradeTouchDestination(drag,touch){
  const element=document.elementFromPoint(touch.clientX,touch.clientY);
  if(element?.closest('[data-touch-drop]')===drag.drop)return {spot:null};
  const board=element?.closest('[data-trade-grid="'+(drag.source==='stock'?'cart':'sale')+'"]');
  return board ? {board,spot:tradeDropPoint(board,touch)} : null;
}
function commitTradeTouch(drag,spot){
  if(drag.source==='stock'){
    const cart=marketCarts.traders[drag.trader]||emptyMarketCart();
    if(cart.token!==drag.token||!marketGoods(drag.trader,'buy').includes(drag.item))return;
    const result=marketCartAdd(drag.trader,drag.item,drag.quantity,spot);
    tradeCartResult(drag.trader,result,GOODS[drag.item][0]+' '+drag.quantity+'개를 담았습니다.');
  }else{
    if(tradeSaleDraft(drag.trader).some(row=>row.uid===drag.uid))return;
    const result=tradeStageSale(drag.trader,drag.uid,spot);
    tradeGridState.notice=result.message||result.reason;
  }
  renderKeep();
}
document.addEventListener('touchstart',event=>{
  if(event.touches.length!==1){clearTradeTouch();return;}
  if(tradeTouch)return;
  const tile=event.target.closest?.('[data-tg-drag="stock"],[data-tg-drag="stash"]');
  if(!tile||!writer||raid||page!=='trade')return;
  const touch=event.touches[0],item=tile.dataset.tradeItem;
  const drag={tile,item,uid:tile.dataset.uid,source:tile.dataset.tgDrag,trader:marketUI.trader,
    mode:marketUI.mode,token:marketCarts.traders[marketUI.trader]?.token||'',
    quantity:marketUI.item===item?marketUI.quantity:1,id:touch.identifier,x:touch.clientX,y:touch.clientY,
    moved:false,drop:null,wasDraggable:tile.draggable};
  tradeTouch=drag;
  // Otherwise a native HTML5 drag can steal the long press before touchend.
  tile.draggable=false;
  drag.timer=setTimeout(()=>startTradeHold(drag),TRADE_HOLD_MS);
  drag.observer=new MutationObserver(()=>{if(tradeTouch===drag&&!validTradeTouch(drag))clearTradeTouch();});
  drag.observer.observe(inside,{childList:true,subtree:true});
},{capture:true,passive:true});
document.addEventListener('touchmove',event=>{
  const drag=tradeTouch;
  if(!drag)return;
  const touch=event.touches[0];
  if(event.touches.length!==1||touch.identifier!==drag.id||!validTradeTouch(drag)){clearTradeTouch();return;}
  const distance=Math.hypot(touch.clientX-drag.x,touch.clientY-drag.y);
  if(!drag.drop){if(distance>TRADE_PAN_SLOP)clearTradeTouch();return;}
  event.preventDefault();
  if(distance<=TRADE_PAN_SLOP&&!drag.moved)return;
  drag.moved=true;
  const target=tradeTouchDestination(drag,touch);
  drag.drop.classList.toggle('tg-touch-ready',Boolean(target&&!target.board));
  tradeClearHover();
  if(target?.board){
    const board=target.board;board.classList.add('tg-hover');
    board.style.setProperty('--gx',target.spot.x);board.style.setProperty('--gy',target.spot.y);
    board.style.setProperty('--gw',drag.tile.dataset.w);board.style.setProperty('--gh',drag.tile.dataset.h);
  }
},{capture:true,passive:false});
document.addEventListener('touchend',event=>{
  const drag=tradeTouch;
  if(!drag)return;
  const touch=Array.from(event.changedTouches).find(t=>t.identifier===drag.id);
  if(!touch)return;
  const held=Boolean(drag.drop);
  const target=held&&drag.moved&&!event.touches.length&&validTradeTouch(drag)?tradeTouchDestination(drag,touch):null;
  if(held)event.preventDefault();
  clearTradeTouch();
  if(target)commitTradeTouch(drag,target.spot);
},{capture:true,passive:false});
document.addEventListener('contextmenu',event=>{if(tradeTouch&&tradeTouch.tile.contains(event.target))event.preventDefault();},true);
document.addEventListener('touchcancel',clearTradeTouch,true);
document.addEventListener('pointercancel',event=>{if(event.pointerType==='touch')clearTradeTouch();},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTradeTouch();});
window.addEventListener('pagehide',clearTradeTouch);
window.addEventListener('blur',clearTradeTouch);
