// Keep the latest completed grid sale for each merchant. Its prices and labels are snapshots.
let saleReceipts={};

function makeSaleReceipt(trader,quote,units){
  const byUid=new Map(units.map(unit=>[unit.uid,unit]));
  const groups=new Map();
  for(const row of quote.lines){
    const alias=byUid.get(row.uid).alias||'';
    const key=JSON.stringify([row.item,alias,row.unit]);
    if(!groups.has(key))groups.set(key,{item:row.item,unit:row.unit,uids:[],...(alias?{alias}:{})});
    groups.get(key).uids.push(row.uid);
  }
  return {trader,at:Date.now(),before:quote.balance,total:quote.total,balance:quote.after,lines:[...groups.values()]};
}

function validSaleReceipts(receipts){
  if(receipts===undefined)return true;
  if(!presetRecord(receipts))return false;
  const maximum=TRADE_TRAY_SIZE[0]*TRADE_TRAY_SIZE[1];
  return Object.entries(receipts).every(([trader,r])=>{
    if(!findMarketTrader(trader)||!presetRecord(r)||r.trader!==trader||
      !cartMoney(r.at)||r.at>8640000000000000||!cartMoney(r.before)||!cartMoney(r.total)||!cartMoney(r.balance)||
      r.before+r.total!==r.balance||!Array.isArray(r.lines)||!r.lines.length||r.lines.length>maximum)return false;
    const seen=new Set(),groups=new Set();
    let total=0;
    for(const row of r.lines){
      if(!presetRecord(row)||!marketBuys(trader,row.item)||!cartMoney(row.unit)||row.unit<1||
        !Array.isArray(row.uids)||!row.uids.length||seen.size+row.uids.length>maximum)return false;
      if(row.alias!==undefined&&(!Object.hasOwn(STORAGE_CASES,row.item)||!row.alias||caseAliasValue(row.alias)!==row.alias))return false;
      const key=JSON.stringify([row.item,row.alias||'',row.unit]);
      if(groups.has(key))return false;
      groups.add(key);
      for(const uid of row.uids){
        if(typeof uid!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(uid)||seen.has(uid))return false;
        seen.add(uid);
      }
      total+=row.unit*row.uids.length;
      if(!cartMoney(total))return false;
    }
    return total===r.total;
  });
}

function saleReceiptMarkup(trader,open){
  const receipt=saleReceipts[trader.id];
  if(!receipt)return '';
  const count=receipt.lines.reduce((n,line)=>n+line.uids.length,0);
  const date=new Date(receipt.at).toLocaleString('ko-KR',{dateStyle:'short',timeStyle:'short'});
  const rows=receipt.lines.map(line=>{
    const qty=line.uids.length,name=kitName(line.item),label=line.alias?line.alias+' · '+name:name;
    return '<li data-sale-receipt-line="'+esc(line.item)+'"><span><b>'+esc(label)+'</b><small>단가 '+money(line.unit)+' × '+qty+'개</small></span>'+
      '<strong>'+money(line.unit*qty)+'</strong></li>';
  }).join('');
  return '<details class="mc-history" data-sale-history'+(open?' open':'')+'><summary>최근 판매 영수증</summary>'+
    '<div data-sale-receipt aria-label="'+esc(trader.name)+' 판매 영수증"><h3>'+esc(trader.name)+' · 판매 '+count+'개</h3>'+
    '<p>'+esc(date)+'</p><ul class="mc-receipt-lines">'+rows+'</ul><dl class="mc-sums"><div><dt>판매 전 잔액</dt><dd>'+money(receipt.before)+'</dd></div>'+
    '<div><dt>입금액</dt><dd data-sale-receipt-total>'+money(receipt.total)+'</dd></div><div><dt>입금 후 잔액</dt><dd data-sale-receipt-balance>'+
    money(receipt.balance)+'</dd></div></dl></div></details>';
}
