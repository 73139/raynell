// Offers describe actual inventory objects; a quote never reserves or transfers custody.
const BARTER_QUALITY=['Q1 야전형','Q2 선별형','Q3 정밀형','Q4 인증형'];
const BARTER_RECIPES=[
  {trader:'quarter',tier:1,item:'rl_x_ammo',cost:{rl_x_fabric:1,cloth:2}},
  {trader:'quarter',tier:2,item:'rl_x_pack',cost:{rl_x_mesh:2,rl_x_fabric:2}},
  {trader:'repair',tier:2,item:'rl_x_optic',cost:{rl_x_mesh:1,rl_x_circuit:1}},
  {trader:'quarter',tier:3,item:'rl_x_armor',cost:{rl_x_circuit:2,rl_x_mesh:2}},
  {trader:'quarter',tier:4,item:'rl_x_carbine',cost:{rl_x_core:2,rl_x_circuit:3}}
];
const RAID_GOODS_GRADE={rl_x_fabric:1,rl_x_mesh:2,rl_x_circuit:3,rl_x_core:4,rl_x_field_pack:3,rl_x_field_ammo:2};
function exchangeRestricted(id){
  return id==='cr_notes'||id==='rl_bp_dressing'||id==='rl_craft_dressing'||Object.hasOwn(RAID_GOODS_GRADE,id)||BARTER_RECIPES.some(r=>r.item===id);
}
function exchangeAccess(trader){
  if(!findMarketTrader(trader))return '거래할 상인을 선택하세요.';
  if(raid)return '벙커에 귀환한 뒤 거래하세요.';
  return writer?'':'플레이 중인 탭에서 거래하세요.';
}
function exchangeToken(kind,trader,selection){
  return [kind,trader,revision,...selection].join('|');
}
function saleQuote(trader,uids){
  const quote={ok:false,token:'',lines:[],total:0,balance:wallet,after:wallet,reason:exchangeAccess(trader)};
  if(quote.reason)return quote;
  if(!Array.isArray(uids)||!uids.length||uids.length>stashSlots.length||new Set(uids).size!==uids.length){
    quote.reason='창고에서 판매할 물품을 선택하세요.';return quote;
  }
  const inventory=new Map(stashSlots.map(unit=>[unit.uid,unit]));
  for(const uid of uids){
    const unit=inventory.get(uid);
    if(!unit){quote.reason='선택한 물품이 창고에서 이동했습니다.';return quote;}
    if(unit.g==='cr_notes'){quote.reason='CR 화폐 묶음은 판매할 수 없습니다.';return quote;}
    if(!marketBuys(trader,unit.g)){quote.reason=kitName(unit.g)+'은 이 상인의 매입 품목에 없습니다.';return quote;}
    if(unit.contents?.length){quote.reason='보관함을 비운 뒤 판매하세요.';return quote;}
    if(unit.gear?.module){quote.reason='장착된 부품을 분리한 뒤 판매하세요.';return quote;}
    const price=stashSalePrice(unit.g);
    quote.lines.push({uid,item:unit.g,unit:price,total:price,x:unit.x,y:unit.y,w:unit.w,h:unit.h});
    quote.total+=price;
  }
  if(!cashCanCredit(quote.total)){quote.reason='판매 후 보유 CR 한도를 초과합니다.';return quote;}
  quote.token=exchangeToken('sale',trader,[...uids].sort());
  quote.after=wallet+quote.total;
  quote.ok=true;return quote;
}
// Change one warehouse snapshot and its CR balance in the same revision. A concurrent
// winner is already restored by writeSession; a quota error restores our original objects.
function exchangeWrite(removed,received,after,ammo=null,receipt=null){
  const previous={stash,stashSlots,wallet,saleReceipts};
  const ids=new Set(removed.map(unit=>unit.uid));
  const stock={...stash};
  for(const unit of removed){
    if(!(stock[unit.g]>0))return false;
    if(--stock[unit.g]===0)delete stock[unit.g];
  }
  const nextSlots=stashSlots.filter(unit=>!ids.has(unit.uid));
  if(received){
    if(!Number.isSafeInteger((stock[received.g]||0)+1))return false;
    stock[received.g]=(stock[received.g]||0)+1;
    nextSlots.push(received);
  }
  stash=stock;stashSlots=nextSlots;wallet=after;
  if(receipt)saleReceipts={...saleReceipts,[receipt.trader]:receipt};
  if(ammo)ammo.gear.ammo=ammo.after;
  if(writeSession()){
    if(stashSelection&&!selectedStashUnit())stashSelection=null;
    return true;
  }
  if(stash===stock){
    stash=previous.stash;stashSlots=previous.stashSlots;wallet=previous.wallet;
    saleReceipts=previous.saleReceipts;
    if(ammo)ammo.gear.ammo=ammo.before;
  }
  return false;
}
function exchangeFailure(reason){return {ok:false,reason,message:reason};}
function saleCommit(trader,uids,token){
  reconcile();
  const quote=saleQuote(trader,uids);
  if(!quote.ok)return {...quote,message:quote.reason};
  if(quote.token!==token)return exchangeFailure('창고 상태가 바뀌었습니다. 최신 판매 견적을 확인하세요.');
  const selected=new Set(uids);
  const units=stashSlots.filter(u=>selected.has(u.uid));
  const receipt=makeSaleReceipt(trader,quote,units);
  if(!exchangeWrite(units,null,quote.after,null,receipt))return exchangeFailure('판매를 저장하지 못했습니다. 최신 창고와 잔액을 확인하세요.');
  return {...quote,message:quote.lines.length+'개 판매 완료 · '+money(quote.total)+' 수령'};
}
function barterPlan(recipe){
  const item=recipe.item;
  const offer={id:item,item,tier:recipe.tier,rarity:ITEM_META[item].rarity,quality:BARTER_QUALITY[recipe.tier-1],
    requirements:[],ok:false,token:'',reason:exchangeAccess(recipe.trader)};
  const removed=[];
  for(const [id,quantity] of Object.entries(recipe.cost)){
    const stock=stashSlots.filter(u=>u.g===id).sort((a,b)=>a.y-b.y||a.x-b.x);
    offer.requirements.push({item:id,quantity,owned:stock.length,rarity:ITEM_META[id].rarity,
      quality:BARTER_QUALITY[(RAID_GOODS_GRADE[id]||1)-1]});
    removed.push(...stock.slice(0,quantity));
    if(!offer.reason&&stock.length<quantity)offer.reason='필요한 재료를 창고 격자에 준비하세요.';
  }
  if(offer.reason)return {offer};
  if(stashCount(item)>=Number.MAX_SAFE_INTEGER){offer.reason='보유 수량 한도에 도달했습니다.';return {offer};}
  const used=new Set(removed.map(unit=>unit.uid));
  const [,w,h]=GOODS[item];
  const fit=kitFit(stashSlots.filter(u=>!used.has(u.uid)),stashSize(),{g:item,x:0,y:0,w,h});
  if(!fit){offer.reason='교환품이 들어갈 연속 빈칸이 부족합니다.';return {offer};}
  offer.token=exchangeToken('barter',recipe.trader,[item,...removed.map(u=>u.uid)]);
  offer.ok=true;return {offer,removed,fit};
}
function barterOffers(trader){
  if(!findMarketTrader(trader))return [];
  const tier=traderStanding(trader).tier;
  return BARTER_RECIPES.filter(r=>r.trader===trader&&r.tier<=tier).map(r=>barterPlan(r).offer);
}
function barterCommit(trader,id,token){
  reconcile();
  const recipe=BARTER_RECIPES.find(r=>r.trader===trader&&r.item===id&&r.tier<=traderStanding(trader).tier);
  if(!recipe)return exchangeFailure('현재 이용 가능한 교환 제안을 선택하세요.');
  const {offer,removed,fit}=barterPlan(recipe);
  if(offer.reason)return exchangeFailure(offer.reason);
  if(!token||token!==offer.token)return exchangeFailure('재료 또는 창고 상태가 바뀌었습니다. 교환 조건을 다시 확인하세요.');
  const unit={...fit,uid:newStashUid()};
  gearEnsureUnit(unit);
  if(!exchangeWrite(removed,unit,wallet))return exchangeFailure('교환을 저장하지 못했습니다. 최신 창고를 확인하세요.');
  return {ok:true,message:kitName(id)+' 1개 교환 완료 · 창고 입고',item:id,uid:unit.uid};
}
const EXCHANGE_AMMO={rl_x_ammo:12,rl_x_field_ammo:6};
function exchangeReload(uid,expectedBefore,packId='rl_x_ammo'){
  reconcile();
  if(!writer||raid)return exchangeFailure('벙커의 플레이 중인 탭에서 탄약을 보충하세요.');
  const gear=gearLookup(uid), capacity=gearSpec(gear?.g)?.capacity;
  const pack=Object.hasOwn(EXCHANGE_AMMO,packId)&&stashSlots.find(u=>u.g===packId);
  if(!capacity||!pack||gear.ammo>=capacity||gear.ammo!==expectedBefore)return exchangeFailure('탄약팩과 선택한 장비의 현재 탄약을 확인하세요.');
  const before=gear.ammo,after=Math.min(capacity,before+EXCHANGE_AMMO[packId]);
  if(!exchangeWrite([pack],null,wallet,{gear,before,after}))return exchangeFailure('탄약 보충을 저장하지 못했습니다.');
  return {ok:true,message:kitName(gear.g)+' 탄약 '+before+' → '+after+'발 · '+kitName(packId)+' 1개 사용'};
}
