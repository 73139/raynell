// Banknotes are valued by the amount on a physical unit, never by its stock count.
// A dedicated cash drawer gives a full legacy warehouse a lossless migration path.
const CASH_ID = 'cr_notes';
const CASH_DRAWER = [6,2];
Object.defineProperty(GOODS,CASH_ID,{value:['CR 지폐',1,1,0.01,'crate','화폐',0]});
Object.defineProperty(ITEM_META,CASH_ID,{value:{usage:'상인 결제와 벙커 거래에 사용하는 실물 지폐',rarity:'일반',lootSources:[],hideoutUses:[]}});
let cashPocket = [], cashSelected = null, cashMessage = '';

function isCashUnit(unit){return unit?.g===CASH_ID;}
function validCashAmount(n){return Number.isSafeInteger(n)&&n>0;}
function cashSum(units){return units.reduce((sum,u)=>isCashUnit(u)?sum+u.amount:sum,0);}
function cashBalance(){return cashSum(cashPocket)+cashSum(stashSlots);}
function cashCarried(){
  return cashSum(equipmentState.bag)+(raid&&!field.result ? cashSum(field.bag)+(field.gearGround||[]).reduce((n,row)=>n+cashSum(row),0) : 0);
}
function cashCanCredit(amount){
  return Number.isSafeInteger(amount)&&amount>=0&&Number.isSafeInteger(wallet+amount+cashCarried());
}
function cashUnit(amount,x=0,y=0){return {uid:newStashUid(),g:CASH_ID,x,y,w:1,h:1,amount,revealed:true};}
function loadCash(s){
  cashSelected=null;cashMessage='';
  if(s?.version>=29 && Array.isArray(s.cash?.pocket)){
    cashPocket=s.cash.pocket.map(u=>({...u}));
    wallet=cashBalance();
  }else if(s?.version>=29){
    cashPocket=[];wallet=cashBalance();
  }else{
    cashPocket=wallet ? [cashUnit(wallet)] : [];
  }
}
function cashStockCount(stock,slots){
  const count=slots.reduce((n,u)=>n+Number(isCashUnit(u)),0);
  if(count)stock[CASH_ID]=count;
  else delete stock[CASH_ID];
}
function cashProjection(target){
  const held=cashBalance();
  if(!Number.isSafeInteger(target)||target<0||!Number.isSafeInteger(held)||!Number.isSafeInteger(target+cashCarried()))
    throw new RangeError('CR 잔액을 확인하세요.');
  if(target===held)return {cash:{pocket:cashPocket},stash,stashSlots};
  let remaining=held-target;
  let pocket=cashPocket, slots=stashSlots;
  if(remaining>0){
    function consume(list){
      const next=[];
      for(const u of list){
        if(!isCashUnit(u)||!remaining){next.push(u);continue;}
        const spent=Math.min(u.amount,remaining);
        remaining-=spent;
        if(u.amount>spent)next.push({...u,amount:u.amount-spent});
      }
      return next;
    }
    pocket=consume(pocket);
    if(remaining)slots=consume(slots);
  }else{
    const amount=-remaining;
    pocket=pocket.length?[{...pocket[0],amount:pocket[0].amount+amount},...pocket.slice(1)]:[cashUnit(amount)];
  }
  const stock={...stash};
  cashStockCount(stock,slots);
  return {cash:{pocket},stash:stock,stashSlots:slots};
}
function applyCashProjection(s){
  cashPocket=s.cash.pocket;
  stashSlots=s.stashSlots;
  cashStockCount(stash,stashSlots);
  if(cashSelected&&![cashPocket,stashSlots,equipmentState.bag].some(row=>row.some(u=>u.uid===cashSelected)))cashSelected=null;
}
function validCashBackup(s){
  const warehouse=s.stashSlots, drawer=s.cash?.pocket, bag=s.equipment?.bag, fieldBag=s.field?.bag;
  if(!Array.isArray(drawer)||!Array.isArray(bag)||!Array.isArray(fieldBag)||drawer.length>12||drawer.some(u=>!isCashUnit(u)))return false;
  const ground=s.field?.gearGround??[];
  if(!Array.isArray(ground)||!ground.every(Array.isArray))return false;
  if((!s.raid||s.field.result)&&(fieldBag.some(isCashUnit)||ground.some(row=>row.some(isCashUnit))))return false;
  if(warehouse.filter(isCashUnit).length!==(s.stash[CASH_ID]||0))return false;
  if(Object.values(s.field?.boxes||{}).some(b=>b?.items?.some?.(isCashUnit)))return false;
  let held=0,total=0;
  const cashIDs=new Set(), otherIDs=new Set();
  function check(list,where,size){
    const occupied=where==='drawer'||where==='warehouse'||where==='bag';
    for(const u of list){
      if(!u||typeof u!=='object')return false;
      if(!isCashUnit(u)){otherIDs.add(u.uid);if(Array.isArray(u.contents))for(const child of u.contents)otherIDs.add(child?.uid);continue;}
      if(!/^s-[a-z0-9-]{1,72}$/.test(u.uid)||cashIDs.has(u.uid)||!validCashAmount(u.amount)||
          u.w!==1||u.h!==1||u.contents!==undefined||u.gear!==undefined||u.alias!==undefined)return false;
      if(occupied&&(!fits([],size,u.x,u.y,1,1)||list.some(other=>other!==u&&u.x<other.x+other.w&&u.x+1>other.x&&u.y<other.y+other.h&&u.y+1>other.y)))return false;
      cashIDs.add(u.uid);total+=u.amount;
      if(where==='drawer'||where==='warehouse')held+=u.amount;
    }
    return true;
  }
  for(const box of Object.values(s.field?.boxes||{}))if(Array.isArray(box?.items))for(const unit of box.items)otherIDs.add(unit?.uid);
  return check(drawer,'drawer',CASH_DRAWER)&&check(warehouse,'warehouse',stashSize(s.hideout?.levels?.stash??0))&&
    check(bag,'bag',kitCapacity(s.equipment?.worn||{}))&&check(fieldBag,'bag',kitCapacity(s.field?.worn||{}))&&
    ground.every(row=>check(row,'ground',null))&&Array.from(cashIDs).every(id=>!otherIDs.has(id))&&
    held===s.wallet&&Number.isSafeInteger(total);
}

// Move or split one exact stack. Passing a target UID merges only into that unit.
function cashAction(uid,to,amount,x,y,targetUID){
  const fail=message=>({ok:false,message});
  if(!writer||raid)return fail('벙커에서 지폐를 옮길 수 있습니다.');
  const src={pocket:cashPocket,stash:stashSlots,bag:equipmentState.bag};
  const from=Object.keys(src).find(key=>src[key].some(u=>isCashUnit(u)&&u.uid===uid));
  if(!from||!Object.hasOwn(src,to))return fail('지폐 묶음을 다시 선택하세요.');
  const original=src[from].find(u=>u.uid===uid);
  amount=amount??original.amount;
  if(!validCashAmount(amount)||amount>original.amount)return fail('옮길 금액은 1 CR부터 보유 금액까지 입력하세요.');
  const next={pocket:src.pocket.slice(),stash:src.stash.slice(),bag:src.bag.slice()};
  const index=next[from].indexOf(original);
  if(amount===original.amount)next[from].splice(index,1);
  else next[from][index]={...original,amount:original.amount-amount};
  if(targetUID){
    const target=next[to].findIndex(u=>isCashUnit(u)&&u.uid===targetUID&&u.uid!==uid);
    if(target<0||!Number.isSafeInteger(next[to][target].amount+amount))return fail('합칠 지폐 묶음을 다시 선택하세요.');
    next[to][target]={...next[to][target],amount:next[to][target].amount+amount};
  }else{
    const size=to==='pocket'?CASH_DRAWER:to==='stash'?stashSize():kitCapacity(equipmentState.worn);
    const pos=x===undefined&&y===undefined?firstFit(next[to],size,1,1):fits(next[to],size,x,y,1,1)?{x,y}:null;
    if(!pos)return fail('지폐를 놓을 빈 한 칸이 필요합니다.');
    next[to].push({...original,...pos,amount,uid:amount===original.amount?uid:newStashUid()});
  }
  const inventory=stash, before=wallet;
  cashPocket=next.pocket;stashSlots=next.stash;equipmentState.bag=next.bag;
  cashStockCount(stash,stashSlots);wallet=cashBalance();
  if(!writeSession()){
    if(stash===inventory){cashPocket=src.pocket;stashSlots=src.stash;equipmentState.bag=src.bag;cashStockCount(stash,stashSlots);wallet=before;}
    return fail('지폐 이동을 저장하지 못했습니다. 잔액을 확인하세요.');
  }
  cashSelected=null;
  return {ok:true,message:money(amount)+(targetUID?' 합쳤습니다.':to==='bag'?' 출격 가방에 넣었습니다.':to==='pocket'?' 지폐 보관칸에 넣었습니다.':' 창고에 배치했습니다.')};
}
