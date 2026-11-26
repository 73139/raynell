// Procurement uses the objective's eligible holdings and each merchant's live retail shelf.
// Queued quantities represent future deliveries and never count as owned goods.
// These site inspections can be completed without buying equipment or finding a particular item.
function facilityFundingPlan(balance){
  if(raid || !Number.isSafeInteger(balance) || balance>=0)return null;
  const deficit=-balance;
  const candidates=ORDERS.filter(order=>order.surveyFunding && orderUnlocked(order) && !career.done.includes(order.id))
    .sort((a,b)=>a.cr-b.cr);
  const active=candidates.find(order=>order.id===career.order);
  if(career.order && !active)return null;
  const plans=[];
  for(const [index,first] of candidates.entries()){
    if(active && first!==active)continue;
    plans.push({orders:[first],reward:first.cr});
    const others=active?candidates.filter(order=>order!==first):candidates.slice(index+1);
    for(const second of others)plans.push({orders:[first,second],reward:first.cr+second.cr});
  }
  // Minimize the uncovered amount, then required sorties, then excess. Keep the cheaper first job on ties.
  plans.sort((a,b)=>Math.max(0,deficit-a.reward)-Math.max(0,deficit-b.reward) ||
    a.orders.length-b.orders.length || a.reward-b.reward);
  const best=plans[0];
  return best?{orders:best.orders.map(order=>order.id),reward:best.reward,remaining:deficit-best.reward}:null;
}
function objectiveCartView(objective=resolveObjective()){
  const view={source:objective?.source||null,title:objective?.title||'',goals:objective?.goals||[],
    lines:[],groups:[],token:'',quantity:0,total:0,reason:'',ok:false,budget:null};
  if(!objective){view.reason='먼저 조달할 목표를 고정하세요.';return view;}
  const shelves=MARKET_TRADERS.map(({id})=>({
    trader:id,available:new Set(marketGoods(id,'buy')),draft:marketCarts.traders[id]?.items||[]
  }));
  for(const {id,required,owned,usable,missing} of objective.materials){
    const sellers=shelves.filter(shop=>shop.available.has(id));
    let inCart=0;
    let seller=sellers[0];
    for(const shop of sellers){
      const quantity=shop.draft.find(row=>row.item===id)?.quantity||0;
      if(quantity&&!inCart)seller=shop;
      inCart+=quantity;
    }
    const remainder=Math.max(0,missing-inCart);
    const add=seller?remainder:0;
    const unit=seller?GOODS[id][6]:0;
    const status=!missing?'ready':!remainder?'covered':seller?'available':'unavailable';
    view.lines.push({item:id,required,owned,usable,missing,inCart,add,unit,subtotal:unit*add,trader:seller?.trader||null,status});
  }
  if(view.source.kind==='facility'){
    const step=FACILITIES[view.source.id].levels[view.source.tier-1];
    const catalog=[],unavailable=[];
    for(const line of view.lines){
      if(!line.missing || line.trader)continue;
      const reason=supplyItemLock(line.item);
      if(catalogMaterialListed(line.item) && !reason){
        const unit=GOODS[line.item][6];
        catalog.push({item:line.item,missing:line.missing,unit,subtotal:unit*line.missing});
      }else unavailable.push({...line,reason});
    }
    // Cart quantities are still unpaid. A catalog-only unit never enters a merchant's cart.
    const retail=view.lines.reduce((sum,line)=>sum+line.missing*line.unit,0);
    const direct=catalog.reduce((sum,line)=>sum+line.subtotal,0);
    const materials=retail+direct;
    const inCart=view.lines.reduce((sum,line)=>sum+Math.min(line.missing,line.inCart)*line.unit,0);
    const total=unavailable.length?null:materials+step.costCR;
    view.budget={materials,retail,direct,catalog,inCart,build:step.costCR,wallet,total,balance:total===null?null:wallet-total,unavailable};
    view.budget.funding=facilityFundingPlan(view.budget.balance);
  }
  for(const shop of shelves){
    const lines=view.lines.filter(row=>row.trader===shop.trader&&row.missing>0);
    if(!lines.length)continue;
    const quantity=lines.reduce((sum,row)=>sum+row.add,0),total=lines.reduce((sum,row)=>sum+row.subtotal,0);
    view.groups.push({trader:shop.trader,lines,quantity,total});
    view.quantity+=quantity;view.total+=total;
  }
  if(!writer||raid)view.reason='벙커의 플레이 중인 탭에서 목표 물품을 담을 수 있습니다.';
  else if(!view.quantity)view.reason='지금 장바구니에 추가할 목표 물품이 없습니다.';
  else if(!cartMoney(view.quantity)||!cartMoney(view.total))view.reason='조달 수량이나 금액을 확인하세요.';
  view.ok=!view.reason;
  if(view.ok){
    view.token=JSON.stringify([revision,view.source,view.lines.map(row=>[row.item,row.missing,row.inCart,row.trader,row.unit])]);
  }
  return view;
}
function objectiveCartApply(token,traderId=null){
  if(!writer||raid)return cartFailure('벙커의 플레이 중인 탭에서 목표 물품을 담을 수 있습니다.');
  reconcile();
  const view=objectiveCartView();
  if(!view.ok)return cartFailure(view.reason);
  if(!token||view.token!==token)return cartFailure('목표나 보유 물품이 바뀌었습니다. 최신 조달 수량을 확인하세요.');
  const groups=view.groups.filter(group=>group.quantity>0&&(traderId===null||traderId===group.trader));
  if(!groups.length)return cartFailure('선택한 상인에게 더 담을 목표 물품이 없습니다.');
  const traders={...marketCarts.traders};
  let quantity=0,total=0;
  for(const group of groups){
    const cart=traders[group.trader]||emptyMarketCart();
    let items=cart.items;
    for(const line of group.lines){
      if(!line.add)continue;
      const current=items.find(row=>row.item===line.item)?.quantity||0;
      const amount=current+line.add;
      if(!cartMoney(amount))return cartFailure('안전하게 담을 수 있는 수량을 초과했습니다.');
      const change=marketCartEdit({items},line.item,amount);
      if(!change.ok)return change;
      items=change.items;
    }
    traders[group.trader]=marketCartWithItems(cart,items);
    quantity+=group.quantity;total+=group.total;
  }
  const saved=storeMarketCarts({lastTrader:groups[0].trader,traders});
  return saved.ok?{...saved,quantity,total}:saved;
}
