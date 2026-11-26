// Purchases stay in the normal merchant checkout. This panel only changes pending quantities.
let procurementExpanded='',procurementNotice=null;

function procurementKey(source,trader=''){
  return [source.kind,source.id,source.key??'',source.tier??'',source.trader??'',trader].join('|');
}

function procurementLine(line){
  const name=GOODS[line.item][0];
  const counts=[['필요',line.required],['보유',line.owned],['부족',line.missing],['장바구니',line.inCart]];
  const usable=line.usable!==line.owned?'<small>목표에 사용 가능 '+line.usable+'개</small>':'';
  return '<li class="op-line" data-procurement-item="'+esc(line.item)+'"><div><strong>'+esc(name)+'</strong>'+usable+
    '<span>'+counts.map(([label,value])=>'<span>'+label+' <b>'+value+'</b></span>').join('')+'</span></div>'+
    '<div class="op-addend"><b>추가 '+line.add+'개</b><small>'+money(line.subtotal)+'</small></div></li>';
}

function procurementGroup(group,quote){
  const name=findMarketTrader(group.trader).name;
  const hasCart=group.lines.some(row=>row.inCart>0);
  const cartLink=hasCart?'<button type="button" data-objective="procurement-cart" data-trader="'+group.trader+'">'+
    esc(name)+' 장바구니 열기</button>':'';
  const add=group.quantity>0?'<button type="button" class="op-primary" data-objective="procurement-add" data-trader="'+
    group.trader+'" data-token="'+esc(quote.token)+'" '+(!quote.ok?'disabled':'')+'>'+
    esc(name)+' 장바구니에 '+group.quantity+'개 담기</button>':'';
  return '<section class="op-group" data-procurement-trader="'+group.trader+'"><div class="op-group-head"><h4>'+esc(name)+'</h4>'+
    '<span>추가 예정 <b>'+money(group.total)+'</b></span></div><ul>'+group.lines.map(procurementLine).join('')+'</ul>'+
    '<div class="op-buttons">'+add+cartLink+'</div></section>';
}

function facilityFundingMarkup(plan){
  if(!plan)return '';
  const after=plan.remaining>0?'아직 '+money(plan.remaining)+' 부족':plan.remaining<0?'충당 후 '+money(-plan.remaining)+' 남음':'부족액 전액 충당';
  const lines=plan.orders.map(id=>{
    const order=ORDERS.find(row=>row.id===id);
    const status=id===career.order?'진행 중':career.order?'진행 의뢰 완료 후':writer?'수락 가능':'플레이 탭에서 수락';
    return '<li><button type="button" data-objective="procurement-order" data-id="'+esc(id)+'" aria-label="'+esc(order.title+' 의뢰 서류 보기')+'">'+esc(order.title)+' ›</button>'+
      '<span>'+esc(status)+' · '+money(order.cr)+'</span></li>';
  }).join('');
  return '<details class="op-funding" data-order-funding><summary>의뢰로 자금 마련</summary>'+
    '<p>준비 물품 없이 수행할 수 있습니다. 의뢰마다 별도로 수락·출격해 목표를 마치고 정상 탈출하면 한 번 지급됩니다.</p>'+
    '<ul class="op-catalog-orders">'+lines+'</ul><strong data-funding-reward>예상 수당 '+money(plan.reward)+'</strong> · <span data-funding-balance>'+after+'</span></details>';
}

function facilityProcurementBudget(q){
  const budget=q.budget;
  if(!budget)return '';
  const partial=budget.total===null;
  const row=(name,id,text)=>`<div><dt>${name}</dt><dd data-budget-${id}>${text}</dd></div>`;
  const result=partial?'<p data-budget-unavailable>견적에서 제외한 자재 · '+
    budget.unavailable.map(line=>esc(GOODS[line.item][0])+' '+line.missing+'개'+
      (line.reason?' ('+esc(line.reason)+')':' (현금 구매 경로 없음)')+
      (ITEM_META[line.item]?.lootSources.length?' <button type="button" data-objective="procurement-field-source" data-id="'+esc(line.item)+'" aria-label="'+esc(GOODS[line.item][0]+' 현장 수급처')+'">현장 수급처</button>':'')).join(' · ')+'</p>':
    '<p data-budget-balance>'+ (budget.balance<0?'지갑에서 '+money(-budget.balance)+' 부족':
      budget.balance>0?'구매·착공 후 '+money(budget.balance)+' 남음':'구매·착공 후 잔액 0 CR')+'</p>';
  const orders=budget.catalog.length?'<ul class="op-catalog-orders" aria-label="도감에서 직접 주문할 자재">'+
    budget.catalog.map(line=>'<li data-budget-catalog-item="'+esc(line.item)+'"><button type="button" data-objective="procurement-catalog" data-id="'+esc(line.item)+'">'+
      esc(GOODS[line.item][0])+' 도감 열기</button><span>'+line.missing+'개 × '+money(line.unit)+' · '+money(line.subtotal)+'</span></li>').join('')+'</ul>':'';
  return '<section class="op-budget" data-facility-budget="'+(partial?'partial':'complete')+'"><h4>'+esc(q.title)+
    ' 착공 예산</h4><dl>'+row(partial?'견적 가능한 자재비':'목표 자재 구매비','materials',money(budget.materials))+
    (orders?row('상인 진열','retail',money(budget.retail))+row('도감 직접 주문','direct',money(budget.direct)):'')+
    row('착공비','build',money(budget.build))+(partial?row('확인된 자재비 + 착공비','known',money(budget.materials+budget.build)):
      row('구매·착공 합계','total',money(budget.total)))+row('현재 지갑','wallet',money(budget.wallet))+
    '</dl>'+orders+result+'<small>전체 상인 진열과 도감 직접 주문의 단가로 창고 부족분만 계산합니다. '+
    (budget.inCart?'담아 둔 목표 자재 '+money(budget.inCart)+' 포함. ':'')+
    '초과 수량·다른 주문·선행 공사비 제외.</small>'+facilityFundingMarkup(budget.funding)+'</section>';
}

function procurementPanel(trader=''){
  const q=objectiveCartView();
  if(!q.source||!q.lines.length||raid)return '';
  const groups=trader?q.groups.filter(group=>group.trader===trader):q.groups;
  const key=procurementKey(q.source,trader), open=key===procurementExpanded;
  const quantity=trader?(groups[0]?.quantity||0):q.quantity;
  const total=trader?(groups[0]?.total||0):q.total;
  const inCart=groups.some(group=>group.lines.some(row=>row.inCart>0));
  const catalogLabel=!trader && q.budget?.catalog.length?'도감 주문 '+q.budget.catalog.length+'종 · '+money(q.budget.direct):'';
  const cartLabel=quantity?quantity+'개 · '+money(total):inCart?'담은 물품 확인':'';
  const short=catalogLabel&&cartLabel?'상인 장바구니 '+cartLabel+' / '+catalogLabel:cartLabel||catalogLabel||'추가할 물품 없음';
  const summary='<button type="button" class="op-summary" data-objective="procurement-toggle" data-trader="'+trader+
    '" aria-controls="op-detail" aria-expanded="'+open+'"><span>'+commandIcon('pin')+
    (trader?'고정 목표 부족품':'부족품 조달')+'</span><strong>'+short+'</strong><i aria-hidden="true">'+(open?'▴':'▾')+'</i></button>';
  let body='<div id="op-detail" hidden></div>';
  if(open){
    const inactive=trader||q.budget?[]:q.lines.filter(row=>!row.trader&&row.missing>0);
    const unavailable=inactive.length?'<div class="op-unavailable"><b>현재 CR 구매 불가</b><span>'+
      inactive.map(row=>esc(GOODS[row.item][0])+' '+row.missing+'개 부족').join(' · ')+'</span></div>':'';
    let actions='';
    if(!trader&&groups.filter(group=>group.quantity>0).length>1){
      actions='<button type="button" class="op-primary" data-objective="procurement-add" data-trader="" data-token="'+
        esc(q.token)+'" '+(!q.ok?'disabled':'')+'>모든 상인 장바구니에 '+quantity+'개 담기</button>';
    }
    if(trader)actions+='<button type="button" data-objective="procurement-review">전체 상인 조달표</button>';
    const empty=!groups.length&&!inactive.length&&!catalogLabel?'<p class="op-empty">'+
      (trader?'이 상인의 장바구니에 추가할 목표 물품이 없습니다.':'현재 장바구니에 추가할 목표 물품이 없습니다.')+'</p>':'';
    const notice=procurementNotice?.key===key&&procurementNotice.revision===revision&&procurementNotice.token===q.token?procurementNotice.text:'';
    const reason=!q.ok&&quantity>0?q.reason:'';
    body='<div id="op-detail" class="op-detail"><p class="op-title">'+esc(q.title)+'</p>'+
      facilityProcurementBudget(q)+groups.map(group=>procurementGroup(group,q)).join('')+unavailable+empty+
      (actions?'<div class="op-buttons op-all">'+actions+'</div>':'')+
      (quantity?'<p class="op-settlement">결제는 각 상인의 장바구니에서 확정합니다.</p>':'')+
      '<p role="status" class="op-notice" data-procurement-status>'+esc(notice||reason||'')+'</p></div>';
  }
  return '<section class="op-panel" data-procurement="'+(trader?'shop':'objective')+'" aria-label="고정 목표 물품 조달">'+summary+body+'</section>';
}

function handleProcurementUI(d){
  const q=objectiveCartView();
  if(!q.source||!q.lines.length||raid)return;
  if(d.objective==='procurement-funding-return'){
    const origin=fundingDossier;
    if(page!=='orders' || !origin || !sameObjective(q.source,origin.source))return;
    procurementExpanded=procurementKey(q.source,origin.page==='trade'?marketUI.trader:'');
    navigatePage(origin.page);
    const details=$('[data-order-funding]');
    if(details)details.open=true;
    marketCartFocus($('[data-objective="procurement-order"][data-id="'+origin.order+'"]') ||
      $('[data-order-funding] summary') || $('[data-procurement] .op-summary'));return;
  }
  if(d.objective==='procurement-order'){
    if(!['map','prep','trade'].includes(page) || !q.budget?.funding?.orders.includes(d.id))return;
    fundingDossier={page,source:q.source,order:d.id};
    bunkerOrderSelected=d.id;bunkerOrderFilter='all';navigatePage('orders');
    const heading=$('.bu-order-panel h2');
    if(heading){heading.setAttribute('tabindex','-1');marketCartFocus(heading);}
    return;
  }
  if(d.objective==='procurement-field-source'){
    if(!q.budget?.unavailable.some(line=>line.item===d.id) || !ITEM_META[d.id]?.lootSources.length)return;
    handleDB({db:'lookup',id:d.id});
    const details=$('[data-catalog-sources]');
    if(details){details.open=true;marketCartFocus(details.querySelector('summary'));}
    return;
  }
  if(d.objective==='procurement-catalog'){
    if(!q.budget?.catalog.some(line=>line.item===d.id))return;
    handleDB({db:'lookup',id:d.id});
    const heading=$('#db-detail h2');
    if(heading){heading.setAttribute('tabindex','-1');marketCartFocus(heading);}
    return;
  }
  if(d.objective==='procurement-review'){
    procurementExpanded=procurementKey(q.source);
    if(page==='prep')renderKeep();else navigatePage('prep');
    marketCartFocus($('[data-procurement] .op-summary'));return;
  }
  const trader=page==='trade'?marketUI.trader:'',key=procurementKey(q.source,trader);
  if(d.objective==='procurement-toggle'){
    procurementExpanded=procurementExpanded===key?'':key;
    renderKeep();marketCartFocus($('[data-procurement] .op-summary'),false);return;
  }
  const group=q.groups.find(group=>group.trader===d.trader);
  if(d.objective==='procurement-cart'){
    if(!group||!marketSelectTrader(group.trader))return;
    marketUI.mode='buy';navigatePage('trade');marketCartFocus($('[data-cart-panel]'));return;
  }
  if(d.objective!=='procurement-add'||(trader&&d.trader!==trader))return;
  const result=objectiveCartApply(d.token,d.trader||null);
  const text=result.ok?result.quantity+'개를 장바구니에 담았습니다.':result.reason;
  procurementNotice={key,revision,token:objectiveCartView().token,text};
  procurementExpanded=key;
  renderKeep();
  const panel=$('[data-procurement]');
  const next=panel?.querySelector?.('[data-objective="procurement-cart"]:not(:disabled)'+(d.trader?'[data-trader="'+d.trader+'"]':''))||
    panel?.querySelector?.('.op-summary');
  marketCartFocus(next,false);
  const announcer=$('#announce');if(announcer)announcer.textContent=text;
}
