// Map forecasts use catalog weights only. Live container contents are consulted exclusively in the field.
const LOOT_GOALS=[
  {id:'provisions',label:'식량·음료',categories:['식량','음료'],items:['water']},
  {id:'medical',label:'의료품',categories:['의료']},
  {id:'industry',label:'공업 자재',categories:['재료','공구']},
  {id:'electronics',label:'전자 부품',categories:['전자']},
  {id:'fuel',label:'연료',categories:['연료']}
];
const LOOT_LOCKS=[
  {zone:0,index:8,keyId:'rl_16_14',traderId:'supply'},
  {zone:1,index:2,keyId:'rl_16_19',traderId:'medic'},
  {zone:2,index:6,keyId:'rl_16_01',traderId:'quarter'}
];
const lootForecasts=new Map();
let lootPlan=null,lootDestination=null;

function validLootGoal(id){
  return id===null || LOOT_GOALS.some(goal=>goal.id===id);
}
function validLootDestination(value,goalId){
  if(value===null)return true;
  if(!value || typeof value!=='object' || value.goal!==goalId || !Number.isInteger(value.zone) || !Number.isInteger(value.index))return false;
  const goal=LOOT_GOALS.find(row=>row.id===goalId);
  return Boolean(goal && lootRegionsFor(goal)[value.zone]?.landmarks.some(point=>point.index===value.index));
}
function loadLootGoal(id,destination){
  lootPlan=validLootGoal(id)?id:null;
  lootDestination=destination && validLootDestination(destination,lootPlan) ?
    {goal:destination.goal,zone:destination.zone,index:destination.index} : null;
}
function setLootGoal(id){
  if(!writer)return {ok:false,message:'플레이 중인 탭에서 탐색 목표를 선택하세요.'};
  if(!validLootGoal(id))return {ok:false,message:'목록의 물자 분류를 선택하세요.'};
  const original=lootPlan,previousDestination=lootDestination,before=field;
  if(id!==lootPlan)lootDestination=null;
  lootPlan=id;
  if(!writeSession()){
    if(field===before){lootPlan=original;lootDestination=previousDestination;}
    return {ok:false,message:field===before?'탐색 목표를 저장하지 못했습니다. 다시 시도하세요.':'다른 탭의 최신 탐색 목표를 불러왔습니다.'};
  }
  return {ok:true,message:id?'탐색 목표를 저장했습니다.':'탐색 목표를 해제했습니다.'};
}

function selectLootDestination(zone,index){
  if(!writer)return {ok:false,message:'플레이 중인 탭에서 목적지를 선택하세요.'};
  const destination={goal:lootPlan,zone,index};
  if(!validLootDestination(destination,lootPlan))return {ok:false,message:'현재 탐색 목표의 랜드마크를 선택하세요.'};
  const original=lootDestination,oldHunt=barterHunt,before=field;
  if(barterHunt?.destination)barterHunt={...barterHunt,destination:null};
  lootDestination=destination;
  if(writeSession())return {ok:true,message:LANDMARKS[zone][index].name+'을 탐색 목적지로 저장했습니다.'};
  if(field===before){lootDestination=original;barterHunt=oldHunt;}
  return {ok:false,message:field===before?'탐색 목적지를 저장하지 못했습니다. 다시 시도하세요.':'다른 탭의 최신 목적지를 불러왔습니다.'};
}

function lootTableForecast(goal,table){
  const [width,height]=table.size;
  const candidates=table.itemDistribution.filter(row=>{
    const goods=GOODS[row.tpl];
    if(!goods || row.relativeProbability<=0)return false;
    const [,w,h]=goods;
    return (w<=width && h<=height) || (h<=width && w<=height);
  });
  // The original catalog files the drinkable canteen under household goods.
  const wanted=candidates.filter(row=>goal.categories.includes(GOODS[row.tpl][5]) || goal.items?.includes(row.tpl));
  const weight=rows=>rows.reduce((total,row)=>total+row.relativeProbability,0);
  const countTotal=weight(table.itemcountDistribution),all=weight(candidates);
  const nonempty=weight(table.itemcountDistribution.filter(row=>row.count>0));
  const score=countTotal && all ? nonempty/countTotal*weight(wanted)/all : 0;
  const sorted=wanted.slice().sort((a,b)=>b.relativeProbability-a.relativeProbability);
  return {score,examples:Array.from(new Set(sorted.map(row=>row.tpl))).slice(0,3)};
}
function lootRegionsFor(goal){
  if(lootForecasts.has(goal.id))return lootForecasts.get(goal.id);
  const tables=Object.fromEntries(Object.entries(LOOT_TABLES).map(([id,table])=>[id,lootTableForecast(goal,table)]));
  const regions=LANDMARKS.map((points,zone)=>{
    const landmarks=points.map((point,index)=>{
      const boxes=point.boxes.map(boxIndex=>{
        const [name,,table]=FIELD_ZONES[zone].boxes[boxIndex];
        return {index:boxIndex,name,table,tableName:LOOT_TABLES[table].name,
          keyId:LOOT_LOCKS.find(lock=>lock.zone===zone && lock.index===boxIndex)?.keyId??null,...tables[table]};
      }).filter(box=>box.score>0).sort((a,b)=>b.score-a.score || a.index-b.index);
      // The generator rolls each container separately. Later draws can be affected by remaining grid space.
      const score=1-boxes.reduce((chance,box)=>chance*(1-box.score),1);
      return {zone,index,name:point.name,score,boxes};
    }).filter(point=>point.boxes.length).sort((a,b)=>b.score-a.score || a.index-b.index);
    return {zone,name:FIELD_ZONES[zone].name,landmarks};
  });
  lootForecasts.set(goal.id,regions);
  return regions;
}
function lootGoalView(){
  const goal=LOOT_GOALS.find(row=>row.id===lootPlan);
  return {selected:lootPlan,destination:lootDestination,goals:LOOT_GOALS,regions:goal?lootRegionsFor(goal):[]};
}

function startLootLocks(raidId){
  field.lootLocks={raidId,unlocked:[]};
}
function loadLootLockMode(savedVersion){
  if(!(savedVersion>=24)){
    if(raid)field.lootLocks={raidId:raid.startedAt,legacy:true,unlocked:[]};
    else delete field.lootLocks;
  }
}
function lootBoxIsLocked(zone,index){
  if(!raid || !LOOT_LOCKS.some(lock=>lock.zone===zone && lock.index===index))return false;
  const record=field.lootLocks;
  return !(record?.raidId===raid.startedAt && (record.legacy===true || record.unlocked?.includes(boxKey(zone,index))));
}
function lootLockView(zone,index){
  const lock=LOOT_LOCKS.find(row=>row.zone===zone && row.index===index);
  if(!lock)return null;
  const box=boxKey(zone,index),keyName=GOODS[lock.keyId][0];
  const live=Boolean(raid && !field.result && raidPhase()==='active');
  const equipment=live?field:equipmentState;
  const carried=equipment?.worn?.access===lock.keyId || Boolean(equipment?.bag?.some(item=>item.g===lock.keyId));
  const legacy=Boolean(raid && field.lootLocks?.legacy),unlocked=Boolean(raid && !lootBoxIsLocked(zone,index));
  let reason='';
  if(!live)reason='출격 후 해당 보관함을 발견하세요.';
  else if(!writer)reason='플레이 중인 탭에서 개방하세요.';
  else if(unlocked)reason=legacy?'이전 출격의 개방 상태입니다.':'이미 잠금을 해제했습니다.';
  else if(raid.zone!==zone || !currentLandmark().boxes.includes(index))reason='보관함이 있는 랜드마크로 이동하세요.';
  else if(!field.found[zone].includes(index))reason='주변 탐색으로 보관함을 먼저 발견하세요.';
  else if(field.contact || field.action || field.journey || field.open)reason='진행 중인 행동을 마치고 열린 상자를 닫으세요.';
  else if(!carried)reason=keyName+'를 열쇠 고리나 현장 가방에 휴대하세요.';
  return {...lock,box,keyName,keySource:findMarketTrader(lock.traderId).name,price:GOODS[lock.keyId][6],
    unlocked,legacy,carried,canUnlock:reason==='',reason};
}
function unlockLootBox(expectedRaidId,zone,index){
  const fail=message=>({ok:false,message});
  if(!writer)return fail('플레이 중인 탭에서 개방하세요.');
  reconcile();
  const record=field.lootLocks,previousField=field;
  if(!raid || raid.startedAt!==expectedRaidId || record?.raidId!==expectedRaidId)return fail('출격이 바뀌었습니다. 현장 기록을 확인하세요.');
  const target=lootLockView(zone,index);
  if(!target || !target.canUnlock)return fail(target?.reason || '현재 랜드마크에서 보관함을 확인하세요.');
  if(!field.boxes[target.box])return fail('발견한 보관함 기록을 확인하세요.');
  const proposed={...record,unlocked:[...record.unlocked,target.box]};
  const oldOpen=field.open;
  field.lootLocks=proposed;
  field.open=target.box;
  if(!writeSession()){
    if(field!==previousField)return fail('다른 탭의 최신 보관함 상태를 불러왔습니다.');
    field.lootLocks=record;
    field.open=oldOpen;
    return fail('잠금 해제를 저장할 수 없어 원래 상태로 복원했습니다. 다시 시도하세요.');
  }
  picked=null;notice='';
  return {ok:true,message:target.keyName+'로 잠금을 해제했습니다. 열쇠는 계속 휴대합니다.'};
}

function validLootGoalBackup(s){
  if(!validLootGoal(s.lootGoal) || !validLootDestination(s.lootDestination,s.lootGoal))return false;
  const f=s.field,record=f?.lootLocks;
  if(!s.raid)return record===undefined;
  if(!record || typeof record!=='object' || Array.isArray(record) || record.raidId!==s.raid.startedAt ||
      record.raidId!==f.raidId || !Number.isSafeInteger(record.raidId) || record.raidId<=0 ||
      !Array.isArray(record.unlocked) || record.unlocked.length>LOOT_LOCKS.length ||
      new Set(record.unlocked).size!==record.unlocked.length || (record.legacy!==undefined && record.legacy!==true))return false;
  if(record.legacy)return record.unlocked.length===0;
  if(!Array.isArray(f.visited) || !Array.isArray(f.bag))return false;
  const carriedIds=new Set(f.bag.map(u=>u?.uid));
  const codes=LOOT_LOCKS.map(row=>boxKey(row.zone,row.index));
  if(!record.unlocked.every(code=>codes.includes(code)))return false;
  for(const lock of LOOT_LOCKS){
    const key=boxKey(lock.zone,lock.index),box=f.boxes?.[key],open=record.unlocked.includes(key);
    if(!box || box.key!==key || !Array.isArray(box.items) || !Array.isArray(f.found?.[lock.zone]))return false;
    if(open){
      if(!f.found[lock.zone].includes(lock.index) || !f.visited.includes(lock.zone))return false;
      if(f.open===key){
        const point=LANDMARKS[lock.zone][f.landmarkByZone?.[lock.zone]??0];
        if(s.raid.zone!==lock.zone || !point?.boxes.includes(lock.index) || f.result || f.journey || f.contact)return false;
      }
      if(f.action?.type==='search' && f.action.key===key &&
        (f.open!==key || !box.items.some(u=>u?.uid===f.action.uid && u.revealed===false)))return false;
    }else if(f.open===key || f.action?.key===key || box.complete || box.items.some(u=>u?.revealed))return false;
    if(f.survivorScavenge?.box===key)return false;
    const table=LOOT_TABLES[FIELD_ZONES[lock.zone].boxes[lock.index][2]];
    if(!Array.isArray(box.size) || box.size.length!==2 || box.size[0]!==table.size[0] || box.size[1]!==table.size[1])return false;
    const seen=new Set(),tiles=[];
    for(const u of box.items){
      if(!u || typeof u.uid!=='string' || !u.uid.startsWith(key+'-') || !/^(0|[1-9]\d*)$/.test(u.uid.slice(key.length+1)) ||
         carriedIds.has(u.uid) || seen.has(u.uid) || !Number.isInteger(u.x) || !Number.isInteger(u.y) || !Number.isInteger(u.w) ||
         !Number.isInteger(u.h) || u.w<1 || u.h<1 || !fits(tiles,table.size,u.x,u.y,u.w,u.h))return false;
      const goods=GOODS[u.g];
      if(!goods || !table.itemDistribution.some(row=>row.tpl===u.g && row.relativeProbability>0) ||
        !((goods[1]===u.w && goods[2]===u.h) || (goods[1]===u.h && goods[2]===u.w)))return false;
      seen.add(u.uid);tiles.push(u);
    }
  }
  return true;
}
