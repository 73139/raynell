let cashDragging=null;
function cashTileArt(){
  const url=artURL('item-cr');
  return url ? '<img alt="" draggable="false" class="item-art cash-art" src="'+url+'">' : '<span class="cash-art cash-glyph" aria-hidden="true">CR</span>';
}
function cashAmountLabel(amount){return amount.toLocaleString('ko-KR');}
function cashTile(unit,area){
  const chosen=cashSelected===unit.uid, label=money(unit.amount)+' 지폐 · '+(unit.y+1)+'행 '+(unit.x+1)+'열';
  return '<button type="button" class="loot-tile cash-tile'+(chosen?' chosen':'')+'" data-cash="select" data-cash-area="'+area+'" data-uid="'+esc(unit.uid)+'" aria-label="'+label+'" title="'+label+'" draggable="'+(!raid&&writer)+'" aria-pressed="'+chosen+'" style="grid-column:'+(unit.x+1)+';grid-row:'+(unit.y+1)+'">'+cashTileArt()+'<b>'+cashAmountLabel(unit.amount)+'</b></button>';
}
function cashStashTile(unit){return cashTile(unit,'stash');}
function cashCompartmentMarkup(){
  const bag=equipmentState.bag, sources={pocket:cashPocket,stash:stashSlots,bag};
  const where=Object.keys(sources).find(key=>sources[key].some(u=>isCashUnit(u)&&u.uid===cashSelected));
  const unit=where?sources[where].find(u=>u.uid===cashSelected):null;
  let cells='';
  for(let y=0;y<CASH_DRAWER[1];y++)for(let x=0;x<CASH_DRAWER[0];x++)cells+='<button type="button" class="slot" data-cash="cell" data-cash-area="pocket" data-x="'+x+'" data-y="'+y+'" aria-label="지폐 보관칸 '+(y+1)+'행 '+(x+1)+'열" style="grid-column:'+(x+1)+';grid-row:'+(y+1)+'"></button>';
  const actions=unit&&!raid?'<div class="cash-controls"><label>옮길 금액 (CR)<input data-cash-amount type="number" min="1" max="'+unit.amount+'" step="1" value="'+unit.amount+'"></label><div><button type="button" data-cash="move" data-to="stash">창고로</button><button type="button" data-cash="move" data-to="pocket">'+(where==='pocket'?'빈 보관칸으로':'지폐 보관칸으로')+'</button><button type="button" data-cash="move" data-to="bag">출격 가방으로</button><button type="button" data-cash="cancel">선택 해제</button></div><small>일부 금액을 입력하면 분할됩니다. 다른 지폐 묶음을 누르면 합쳐집니다.</small></div>':'';
  return '<section class="cash-compartment" aria-label="CR 지폐 보관칸"><div class="cash-heading"><h3>지폐 보관칸</h3><span>결제 가능 <b>'+money(wallet)+'</b></span></div><div class="cash-layout"><div class="spatial-grid cash-grid" style="--cols:6;--rows:2">'+cells+cashPocket.map(u=>cashTile(u,'pocket')).join('')+'</div>'+actions+'</div><p class="cash-help">'+(cashSum(bag)?'출격 가방 '+money(cashSum(bag))+' · ':'')+'보관칸과 창고의 지폐는 결제에 사용됩니다. 가방에 넣은 지폐는 탈출 시 회수됩니다.</p>'+(cashMessage?'<p class="cash-status" role="status">'+esc(cashMessage)+'</p>':'')+'</section>';
}
function cashAmountInput(){const input=inside.querySelector?.('[data-cash-amount]');return input?Number(input.value):undefined;}
function cashDestination(el){
  const button=el.closest?.('[data-cash="cell"], [data-cash="select"], [data-cash-stash-x], [data-stash="place"], [data-gear="cell"]');
  if(!button)return null;
  const d=button.dataset;
  if(d.cash==='select')return {area:d.cashArea,uid:d.uid};
  if(d.cashStashX!==undefined)return {area:'stash',x:Number(d.cashStashX),y:Number(d.cashStashY)};
  return {area:d.cashArea||(d.gear?'bag':'stash'),x:Number(d.x),y:Number(d.y)};
}
function cashMoveUI(uid,target,amount){
  const reply=cashAction(uid,target.area,amount,target.x,target.y,target.uid);
  cashMessage=reply.message;
  renderKeep();
}
inside.addEventListener('click',event=>{
  if(raid||busy)return;
  const el=event.target.closest('button')||event.target.closest('[data-cash-stash-x]');
  if(!el)return;
  const d=el.dataset,dest=cashDestination(el);
  if(!d.cash&&!(cashSelected&&dest)) {
    if(d.stash==='select'||d.gear==='select')cashSelected=null;
    return;
  }
  event.preventDefault?.();event.stopImmediatePropagation?.();
  if(d.cash==='cancel'){cashSelected=null;cashMessage='';renderKeep();return;}
  if(d.cash==='select'&&(!cashSelected||cashSelected===d.uid)){
    cashSelected=cashSelected===d.uid?null:d.uid;cashMessage='';stashSelection=null;gearPick=null;renderKeep();return;
  }
  if(!cashSelected)return;
  if(d.cash==='move')cashMoveUI(cashSelected,{area:d.to},cashAmountInput());
  else if(dest)cashMoveUI(cashSelected,dest,cashAmountInput());
},true);
inside.addEventListener('dragstart',event=>{
  const el=event.target.closest('[data-cash="select"]');if(!el||raid||!writer)return;
  cashDragging=el.dataset.uid;
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-rustline-cash',cashDragging);
  event.stopImmediatePropagation();
},true);
inside.addEventListener('dragover',event=>{
  if(cashDragging&&cashDestination(event.target)){event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='move';}
},true);
inside.addEventListener('drop',event=>{
  if(!cashDragging)return;
  const dest=cashDestination(event.target),uid=cashDragging;cashDragging=null;
  event.preventDefault();event.stopImmediatePropagation();
  if(dest&&dest.uid!==uid)cashMoveUI(uid,dest,uid===cashSelected?cashAmountInput():undefined);
},true);
inside.addEventListener('dragend',()=>{cashDragging=null;});
