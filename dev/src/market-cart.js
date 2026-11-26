// A cart belongs to one merchant. Replacing its token invalidates all earlier checkout buttons.
let marketCarts = {lastTrader:null,traders:{}};
const emptyMarketCart = () => ({token:'',items:[],receipt:null});
const cartFailure = reason => ({ok:false,reason});
const cartMoney = amount => Number.isSafeInteger(amount) && amount >= 0;

// Coordinates describe order lines. Duplicate quantities share a tile and are expanded into
// individual warehouse instances only after the complete order passes placement validation.
const TRADE_TRAY_SIZE=[6,128];
function tradeTrayLayout(lines) {
  const placed=[];
  for (const line of lines) {
    if (line.x===undefined && line.y===undefined) continue;
    const {x,y,w,h,uid}=line;
    if (!fits(placed,TRADE_TRAY_SIZE,x,y,w,h)) return null;
    placed.push({x,y,w,h,uid});
  }
  for (const line of lines) {
    if (line.x!==undefined || line.y!==undefined) continue;
    const {uid,w,h}=line, spot=firstFit(placed,TRADE_TRAY_SIZE,w,h);
    if (!spot) return null;
    placed.push({...spot,w,h,uid});
  }
  return placed;
}
function marketCartTiles(items) {
  return tradeTrayLayout(items.map(({item,x,y})=>({uid:item,x,y,w:GOODS[item][1],h:GOODS[item][2]})));
}

function validMarketCarts(raw, contracts=traderContracts) {
  if (!presetRecord(raw) || !presetRecord(raw.traders)) return false;
  const entries=Object.entries(raw.traders);
  if (entries.length>MARKET_TRADERS.length || (raw.lastTrader!==null && (typeof raw.lastTrader!=='string' || !findMarketTrader(raw.lastTrader) || !Object.hasOwn(raw.traders,raw.lastTrader)))) return false;
  const tokens=new Set();
  function uniqueToken(value) {
    if (typeof value!=='string' || !/^s-[a-z0-9-]{1,72}$/.test(value) || tokens.has(value)) return false;
    tokens.add(value);return true;
  }
  return entries.every(([id,cart]) => {
    const trader=findMarketTrader(id);
    if (!trader || !presetRecord(cart)) return false;
    const done=contracts?.[id]?.done ?? [];
    if (!Array.isArray(done) || !done.every(quest => CONTRACT_BY_ID.get(quest)?.trader===id)) return false;
    const stock=trader.stockTiers.slice(0,standingFromDone(done).tier).flat();
    function totals(lines, receipt) {
      if (!Array.isArray(lines) || lines.length>stock.length) return null;
      let quantity=0,total=0;
      const distinct=new Set();
      for (const row of lines) {
        if (!presetRecord(row) || !stock.includes(row.item) || !marketRetailItem(row.item) || distinct.has(row.item) ||
            !Number.isSafeInteger(row.quantity) || row.quantity<1) return null;
        distinct.add(row.item);
        const unit=GOODS[row.item][6],cost=row.quantity*unit;
        if (receipt && (unit!==row.unit || cost!==row.total)) return null;
        total+=cost;quantity+=row.quantity;
        if (!cartMoney(total) || !cartMoney(quantity)) return null;
      }
      return {quantity,total};
    }
    const draft=totals(cart.items,false);
    if (!draft || !marketCartTiles(cart.items) || (draft.quantity ? !uniqueToken(cart.token) : cart.token!=='')) return false;
    const r=cart.receipt;
    if (r===null) return true;
    if (!presetRecord(r) || r.trader!==id || !uniqueToken(r.token) || !cartMoney(r.at)) return false;
    const sum=totals(r.lines,true);
    return Boolean(sum && sum.quantity>0 && sum.quantity===r.quantity && sum.total===r.total &&
      cartMoney(r.before) && cartMoney(r.balance) && r.before-r.total===r.balance);
  });
}
function loadMarketCarts(raw) {
  marketCarts=validMarketCarts(raw) ? raw : {lastTrader:null,traders:{}};
}
function marketCartSeller(preferred=null) {
  const ids=[preferred,marketCarts.lastTrader,...Object.keys(marketCarts.traders)].filter(id=>findMarketTrader(id));
  return ids.find(id=>marketCarts.traders[id]?.items.length) ||
    ids.find(id=>marketCarts.traders[id]?.receipt) || ids[0] || MARKET_TRADERS[0].id;
}

// Existing warehouse tiles (including named and filled cases) are fixed obstacles.
// The same planner is used to quote and commit; it never allocates physical IDs.
function marketCartPlacement(lines, slots=stashSlots) {
  const [width,height]=stashSize(), occupied=Array(height).fill(0);
  for (const u of slots) {
    const mask=((1<<u.w)-1)<<u.x;
    for (let y=u.y;y<u.y+u.h;y++) occupied[y]|=mask;
  }
  const free=width*height-slots.reduce((sum,u)=>sum+u.w*u.h,0);
  let remaining=free;
  const shapes=new Map(), singles=[];
  for (const {item,quantity} of lines) {
    const [,w,h]=GOODS[item];
    if (quantity>Math.floor(remaining/(w*h))) return cartFailure('창고 빈칸이 부족합니다. 물품을 정리하거나 주문 수량을 줄이세요.');
    remaining-=quantity*w*h;
    if (w*h===1) {for (let i=0;i<quantity;i++) singles.push(item);continue;}
    const key=Math.min(w,h)+'x'+Math.max(w,h);
    if (!shapes.has(key)) shapes.set(key,{w,h,items:[],choices:[]});
    const group=shapes.get(key);
    for (let i=0;i<quantity;i++) group.items.push(item);
  }
  const groups=[...shapes.values()];
  function fitsRows(y,h,mask) {
    for (let j=y;j<y+h;j++) if (occupied[j]&mask) return false;
    return true;
  }
  for (const group of groups) {
    const sizes=[[group.w,group.h]];
    if (group.w!==group.h) sizes.push([group.h,group.w]);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) for (const [w,h] of sizes) {
      const mask=((1<<w)-1)<<x;
      if (x+w<=width && y+h<=height && fitsRows(y,h,mask)) group.choices.push({x,y,w,h,mask});
    }
    if (group.items.length>group.choices.length) return cartFailure('모든 주문 물품이 들어갈 연속된 창고 공간이 부족합니다.');
  }
  // Try the most constrained shapes first. Identical shapes use increasing candidate
  // indices, so they cannot generate permutations of the same physical solution.
  groups.sort((a,b)=>a.choices.length/a.items.length-b.choices.length/b.items.length || b.w*b.h-a.w*a.h);
  const result=[];
  let budget=12000;
  function arrange(groupIndex,index,from) {
    if (groupIndex===groups.length) return true;
    const group=groups[groupIndex];
    if (index===group.items.length) return arrange(groupIndex+1,0,0);
    const last=group.choices.length-(group.items.length-index);
    for (let n=from;n<=last;n++) {
      const {x,y,w,h,mask}=group.choices[n];
      if (!fitsRows(y,h,mask)) continue;
      if (--budget<0) return false;
      for(let j=y;j<y+h;j++) occupied[j]|=mask;
      result.push({g:group.items[index],x,y,w,h});
      if (arrange(groupIndex,index+1,n+1)) return true;
      result.pop();
      for(let j=y;j<y+h;j++) occupied[j]^=mask;
      if (budget<0) return false;
    }
    return false;
  }
  if (!arrange(0,0,0)) return cartFailure(budget<0?'현재 창고에서 일괄 배치를 찾지 못했습니다. 빈칸을 모은 뒤 다시 결제하세요.':'모든 주문 물품이 들어갈 연속된 창고 공간이 부족합니다.');
  let n=0;
  for (let y=0;n<singles.length && y<height;y++) for(let x=0;n<singles.length && x<width;x++) {
    if (!(occupied[y]&(1<<x))) result.push({g:singles[n++],x,y,w:1,h:1});
  }
  return {ok:true,positions:result};
}

function marketCartQuote(id) {
  const cart=marketCarts.traders[id]||emptyMarketCart();
  const quote={token:cart.token,lines:[],quantity:0,total:0,balance:wallet,after:wallet,reason:'',ok:false,receipt:cart.receipt};
  for (const {item,quantity} of cart.items) {
    const line=marketQuote(id,'buy',item,quantity);
    quote.lines.push({item,quantity,unit:line.unit,total:line.total});
    quote.quantity+=quantity;quote.total+=line.total;
    if (!line.ok && !quote.reason) quote.reason=line.reason;
  }
  quote.after=wallet-quote.total;
  if (!cart.items.length) quote.reason='장바구니에 구매할 물품을 담으세요.';
  else if (quote.after<0 && writer && !raid) quote.reason='보유 CR이 부족합니다.';
  if (quote.reason) return {quote,positions:[]};
  const placement=marketCartPlacement(quote.lines,cashProjection(quote.after).stashSlots);
  quote.ok=placement.ok;quote.reason=placement.reason||'';
  return {quote,positions:placement.positions||[]};
}
function marketCartView(id) {
  if (!findMarketTrader(id)) return {...emptyMarketCart(),lines:[],quantity:0,total:0,balance:wallet,after:wallet,...cartFailure('상인을 선택하세요.')};
  return marketCartQuote(id).quote;
}

function cartRecord(id,cart) {
  return {lastTrader:id,traders:{...marketCarts.traders,[id]:cart}};
}
// Prepare a line edit without mutating the active cart. Both manual and objective orders
// use the same geometry, quantity rules and safe price calculation before a single save.
function marketCartEdit(cart,item,quantity,position=null) {
  const old=cart.items.find(row=>row.item===item);
  if (!position && (old?.quantity||0)===quantity) return {ok:true,items:cart.items};
  const locations=marketCartTiles(cart.items);
  if (!locations) return cartFailure('기존 장바구니 배치를 확인하세요.');
  const items=cart.items.map(row=>{
    const {x,y}=locations.find(tile=>tile.uid===row.item);
    return {...row,x,y};
  });
  if (old && !quantity) items.splice(cart.items.indexOf(old),1);
  if (quantity) {
    const row=items.find(line=>line.item===item) || {item};
    row.quantity=quantity;
    if (position) {
      if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) return cartFailure('놓을 칸을 선택하세요.');
      row.x=position.x;row.y=position.y;
    }
    if (!old) items.push(row);
    const layout=marketCartTiles(items);
    if (!layout) return cartFailure('물품이 겹치거나 격자 경계를 벗어납니다.');
    const spot=layout.find(tile=>tile.uid===item);
    row.x=spot.x;row.y=spot.y;
  }
  const total=items.reduce((n,row)=>n+GOODS[row.item][6]*row.quantity,0);
  if (!cartMoney(total)) return cartFailure('안전하게 계산할 수 있는 주문 금액을 초과했습니다.');
  return {ok:true,items};
}
function marketCartWithItems(cart,items) {
  const token=items.length ? newStashUid()+'-'+revision.toString(36) : '';
  return {...cart,items,token};
}
function storeMarketCarts(next) {
  const previous=marketCarts;
  marketCarts=next;
  if (writeSession()) return {ok:true,reason:''};
  if (marketCarts!==next) return cartFailure('다른 탭에서 장바구니를 변경했습니다. 최신 주문을 확인하세요.');
  marketCarts=previous;return cartFailure('장바구니를 저장하지 못했습니다. 저장 공간을 확인하세요.');
}
function marketCartSet(id,item,quantity,token,position=null) {
  if (!writer || raid) return cartFailure('벙커의 플레이 중인 탭에서 장바구니를 편집하세요.');
  if (!findMarketTrader(id) || !marketIsUnlocked(id,item) || !cartMoney(quantity)) return cartFailure('상인의 판매 물품과 수량을 다시 확인하세요.');
  const cart=marketCarts.traders[id]||emptyMarketCart();
  if (cart.token!==token) return cartFailure('장바구니가 변경됐습니다. 최신 주문을 확인하세요.');
  const change=marketCartEdit(cart,item,quantity,position);
  if (!change.ok) return change;
  if (change.items===cart.items) return {ok:true,reason:''};
  return storeMarketCarts(cartRecord(id,marketCartWithItems(cart,change.items)));
}
function marketCartAdd(id,item,quantity,position=null) {
  if (!Number.isSafeInteger(quantity) || quantity<1 || !findMarketTrader(id)) return cartFailure('추가할 품목과 수량을 확인하세요.');
  const cart=marketCarts.traders[id]||emptyMarketCart();
  const existing=cart.items.find(row=>row.item===item)?.quantity||0;
  return marketCartSet(id,item,existing+quantity,cart.token,existing?null:position);
}
function marketCartCheckout(id,token) {
  if (!writer || raid || !findMarketTrader(id) || typeof token!=='string' || !token) return cartFailure('벙커의 플레이 중인 탭에서 주문을 확인하세요.');
  reconcile();
  const cart=marketCarts.traders[id]||emptyMarketCart();
  if (cart.receipt?.token===token) return {ok:true,reason:'',replayed:true,receipt:cart.receipt};
  if (cart.token!==token) return cartFailure('장바구니가 변경됐습니다. 최신 주문을 다시 확인하세요.');
  const {quote,positions}=marketCartQuote(id);
  if (!quote.ok) return cartFailure(quote.reason);
  const before={wallet,stock:stash,slots:stashSlots,carts:marketCarts};
  const receipt={token,trader:id,lines:quote.lines,quantity:quote.quantity,total:quote.total,before:wallet,balance:quote.after,at:Date.now()};
  const stock={...stash};
  for (const line of quote.lines) stock[line.item]=(stock[line.item]||0)+line.quantity;
  const incoming=positions.map(tile=>{
    const unit={...tile,uid:newStashUid()};
    gearEnsureUnit(unit);
    return unit;
  });
  const next=cartRecord(id,{token:'',items:[],receipt});
  stashSlots=[...stashSlots,...incoming];stash=stock;wallet=quote.after;marketCarts=next;
  if (writeSession()) return {ok:true,reason:'',receipt};
  if (marketCarts!==next) {
    const winner=marketCarts.traders[id]?.receipt;
    if (winner?.token===token) return {ok:true,reason:'',replayed:true,receipt:winner};
    return cartFailure('다른 탭의 최신 주문을 불러왔습니다. 결제 내용을 다시 확인하세요.');
  }
  stash=before.stock;stashSlots=before.slots;wallet=before.wallet;marketCarts=before.carts;
  return cartFailure('결제를 저장하지 못했습니다. 장바구니와 잔액을 보존했습니다.');
}
