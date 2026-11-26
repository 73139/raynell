// A hunt pins one ingredient of one unlocked barter. The map consults static loot tables only.
let barterHunt=null;

function huntRecipe(trader,recipe,item,contracts=traderContracts){
  const spec=BARTER_RECIPES.find(r=>r.trader===trader && r.item===recipe && Object.hasOwn(r.cost,item));
  const record=contracts?.[trader];
  return spec && validTraderRecord(trader,record) && standingFromDone(record.done).tier>=spec.tier ? spec : null;
}
function huntRegions(item){
  // Item IDs have a separate cache namespace from the five category forecasts.
  return lootRegionsFor({id:'barter/'+item,items:[item],categories:[]});
}
function huntPoint(item,z,index){
  if(!Number.isInteger(z)||!Number.isInteger(index))return null;
  return huntRegions(item)[z]?.landmarks.find(p=>p.index===index)||null;
}
function validBarterHunt(pin,contracts){
  if(pin==null)return true;
  if(!presetRecord(pin)||Object.keys(pin).length!==4||
     ![pin.trader,pin.recipe,pin.item].every(x=>typeof x==='string')||
     !huntRecipe(pin.trader,pin.recipe,pin.item,contracts))return false;
  if(!huntRegions(pin.item).some(region=>region.landmarks.length))return false;
  const d=pin.destination;
  return d===null || (presetRecord(d)&&Object.keys(d).length===2&&Boolean(huntPoint(pin.item,d.zone,d.index)));
}
function writeBarterHunt(next){
  if(!writer)return {ok:false,message:'진행 중인 탭에서 추적 계획을 변경하세요.'};
  if(!validBarterHunt(next,traderContracts))return {ok:false,message:'개방된 교환의 수색 가능한 재료를 선택하세요.'};
  const before=barterHunt,previousField=field;
  barterHunt=next;
  if(writeSession())return {ok:true,message:''};
  if(field===previousField)barterHunt=before;
  return {ok:false,message:'계획을 저장하지 못했습니다. 현재 상태를 다시 확인하세요.'};
}
function pinBarterHunt(trader,recipe,item){
  reconcile();
  const pin={trader,recipe,item,destination:null};
  if(raid||!validBarterHunt(pin,traderContracts))return {ok:false,message:'벙커에서 개방된 교환 제안의 수색 가능한 재료를 선택하세요.'};
  if(barterHunt?.trader===trader&&barterHunt.recipe===recipe&&barterHunt.item===item)return {ok:true,message:''};
  return writeBarterHunt(pin);
}
function selectHuntDestination(z,index){
  if(raid||!barterHunt||!huntPoint(barterHunt.item,z,index))return {ok:false,message:'현재 재료를 찾을 수 있는 출격 지점을 선택하세요.'};
  return writeBarterHunt({...barterHunt,destination:{zone:z,index}});
}
function barterHuntView(){
  if(!barterHunt)return null;
  const {trader,recipe,item,destination}=barterHunt, spec=huntRecipe(trader,recipe,item);
  if(!spec)return null;
  const needed=spec.cost[item],owned=stashSlots.filter(u=>u.g===item).length;
  const inField=Boolean(raid&&!field.result);
  const bag=inField?field.bag:equipmentState.bag;
  const carried=bag.filter(u=>u.g===item&&u.revealed===true).length;
  return {trader,recipe,item,destination,needed,owned,carried,inField,missing:Math.max(0,needed-owned),toFind:Math.max(0,needed-owned-carried)};
}

// Case contents already belong to the bunker, but only loose warehouse units can pay a recipe.
function huntMaterialCases(trader,recipe,item){
  if(!huntRecipe(trader,recipe,item))return [];
  const cases=new Map();
  for(const row of physicalPossessionLocations()){
    if(row.kind!=='case'||row.id!==item)continue;
    const match=cases.get(row.caseUid);
    if(match){match.quantity+=row.quantity;continue;}
    cases.set(row.caseUid,{key:row.key,caseUid:row.caseUid,name:row.caseName,row:row.caseRow,col:row.caseCol,quantity:row.quantity});
  }
  return [...cases.values()];
}
