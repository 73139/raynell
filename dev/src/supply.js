// A catalog order is subject to its trader's current shelf when that trader carries it.
let procurementNote='';
function catalogMaterialListed(id){
  return Boolean(ITEM_META[id]?.hideoutUses.length && !marketIsValuable(id));
}
function supplyItemLock(id){
  if(id==='rl_bp_dressing')return '의료 상자·경비 책상에서 회수하는 작업지침입니다.';
  if(id==='rl_craft_dressing')return '작업지침을 등록한 의무실에서 제작하세요.';
  if(exchangeRestricted(id))return '레이드 또는 물물교환으로 획득하는 전용 물품입니다.';
  const trader=marketOfferingTrader(id);
  if(trader&&!marketIsUnlocked(trader.id,id))return trader.name+'의 우호도를 올리면 주문할 수 있습니다.';
  return '';
}
function supplyLock(id){
  const restriction=supplyItemLock(id);
  if(restriction)return restriction;
  if(raid)return '귀환 후 주문 가능';
  if(!writer)return '플레이 중인 탭에서 주문하세요.';
  if(wallet<GOODS[id][6])return '자금 부족';
  return '';
}
function supplyPanel(id){
  if(!catalogMaterialListed(id))return '';
  const locked=supplyLock(id);
  return '<section class="field-section"><h3>벙커 자재 조달</h3><p>창고 보유 '+stashCount(id)+'개 · 잔액 '+money(wallet)+'</p>'+
    '<button data-supply="'+id+'" '+(locked?'disabled':'')+'>'+
    (locked?esc(locked):'1개 주문 · '+money(GOODS[id][6]))+'</button>'+
    (procurementNote?'<p role="status">'+esc(procurementNote)+'</p>':'')+'</section>';
}
function buyMaterial(id){
  reconcile();
  if(page!=='catalog'||catalogSelected!==id||!catalogMaterialListed(id))return;
  procurementNote=supplyLock(id);
  if(procurementNote){renderKeep();return;}
  const trader=marketOfferingTrader(id);
  if(trader){
    procurementNote=marketTrade(trader.id,'buy',id,1).message;
    renderKeep();
    return;
  }
  const stock=stash, count=stashCount(id), slots=stashSlots.slice(), balance=wallet;
  if(!addStashGoods(id))return;
  wallet-=GOODS[id][6];
  if(writeSession()){
    procurementNote=GOODS[id][0]+' 1개를 창고에 받았습니다.';
  }else if(stock!==stash){
    procurementNote='다른 탭의 최신 창고를 불러왔습니다. 다시 확인하세요.';
  }else{
    if(count)stash[id]=count;else delete stash[id];
    stashSlots=slots;wallet=balance;
    procurementNote='주문을 저장하지 못했습니다. 다시 시도하세요.';
  }
  renderKeep();
}
