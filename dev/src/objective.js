// Persist only the identity of the selected objective. All counters come from live game state.
let objectivePin = null;

function normalizeObjectivePin(raw) {
  if (!raw || typeof raw.id !== 'string') return null;
  const {kind, id} = raw;
  switch (kind) {
    case 'contract': {
      const quest = CONTRACT_BY_ID.get(id);
      if (!quest || traderContracts[quest.trader]?.active?.id !== id ||
          quest.tier > traderStanding(quest.trader).tier) return null;
      return {kind, id};
    }
    case 'daily':
    case 'weekly': {
      const {trader, key} = raw;
      const period = periodicContracts?.[kind];
      if (!period || !Number.isSafeInteger(key) || key !== period.key ||
          key !== recurringPeriod(kind).key || !findMarketTrader(trader) ||
          !Object.hasOwn(period.records, id) || period.records[id].receipt) return null;
      return recurringOffersFor(kind, key, trader).some(quest => quest.id === id)
        ? {kind, id, trader, key} : null;
    }
    case 'finale':
      return id === 'relay' && campaignState.claimed.length === CAMPAIGN_STAGES.length && !finaleState.reply ? {kind,id} : null;
    case 'campaign':
      return CAMPAIGN_STAGES[campaignState.claimed.length]?.id === id ? {kind,id} : null;
    case 'order':
      return career?.order === id && !career.done.includes(id) && ORDERS.some(order => order.id === id)
        ? {kind, id} : null;
    case 'facility': {
      const {tier} = raw;
      if (!Object.hasOwn(FACILITIES, id) || tier !== hideoutLevel(id) + 1 ||
          !FACILITIES[id].levels[tier - 1] || hideout?.builds[id]) return null;
      return {kind, id, tier};
    }
    default:
      return null;
  }
}

function objectiveMaterial(id, required, forConstruction, outgoing=0) {
  const count = units => units.reduce((sum, unit) => sum + Number(unit.g === id), 0);
  const loose = stashCount(id) - outgoing; // Includes the incoming-goods queue exactly once.
  const bag = count(equipmentState.bag);
  const countWorn = kit => [...Object.values(kit.worn || {}),...Object.values(kit.modules || {})].filter(item => item === id).length;
  const worn = countWorn(equipmentState);
  const cases = stashSlots.reduce((sum, unit) => sum + (unit.contents ? count(unit.contents) : 0), 0);
  const carried = isActive() ? count(field.bag) : 0;
  const fieldUsable = isActive() ? field.bag.filter(unit => unit.g === id && !unit.gear?.module).length : 0;
  const fieldWorn = isActive() ? countWorn(field) : 0;
  const owned = loose + bag + cases + worn;
  const usable = (forConstruction ? stashUnfittedCount(id) : contractDeliveryCount(id)) - outgoing;
  return {id, required, loose, bag, worn, cases, owned, usable, field:carried, fieldUsable, fieldWorn, missing:Math.max(0, required - usable)};
}

function objectiveRaidRating(searched) {
  return qualifiesNormalExtraction(Date.now() - raid.startedAt, searched, field.victories)
    ? 'success' : 'quick';
}

function objectiveContractGoals(quest, record) {
  const onSite = isActive();
  const completed = onSite ? Object.keys(field.boxes).filter(key => field.boxes[key].complete) : [];
  const known = new Set(record.locations);
  const newlySearched = completed.filter(key => !known.has(key));
  const rating = onSite ? objectiveRaidRating(completed.length) : null;
  const rows = [];
  quest.goals.forEach((goal, index) => {
    if (goal.type === 'delivery') return;
    const value = record.progress[index];
    const row = {label:contractGoalLabel(goal), value, target:goal.target};
    if (onSite && value < goal.target) {
      const amount = contractRaidAmount(goal, rating, newlySearched);
      const projected = Math.min(goal.target, goal.type === 'regions' ? Math.max(value, amount) : value + amount);
      if (projected > value) row.projected = projected;
    }
    rows.push(row);
  });
  return rows;
}

function objectiveHuntLocations(goals, values, materials) {
  const locations = [];
  goals.forEach((goal, i) => {
    if (!Number.isInteger(goal.zone) || values[i] >= goal.target) return;
    if (locations.some(point => point.zone === goal.zone && point.landmark === goal.landmark)) return;
    const point = {zone:goal.zone};
    if (Number.isInteger(goal.landmark)) point.landmark = goal.landmark;
    locations.push(point);
  });
  // These are published item-source tables, never the hidden rolls of a particular raid.
  const needed = materials.filter(row => row.required > row.owned + row.field);
  if (needed.length) {
    LANDMARKS.forEach((places, zone) => places.forEach((place, landmark) => {
      if (locations.some(point => point.zone === zone && point.landmark === landmark)) return;
      const tables = place.boxes.map(index => FIELD_ZONES[zone].boxes[index][2]);
      const items = needed.filter(row => ITEM_META[row.id].lootSources.some(table => tables.includes(table)));
      if (items.length) locations.push({zone, landmark, possible:true, items:items.map(row => row.id)});
    }));
  }
  return locations;
}

function recoverySearchProgress(recovery){
  if(!recovery||recovery.carried>=recovery.required||recovery.sources.length<2)return null;
  const sites=recovery.sources.map(({zone,landmark,boxOrdinal})=>{
    const index=LANDMARKS[zone][landmark].boxes[boxOrdinal],key=boxKey(zone,index);
    const box=field.found[zone].includes(index)?field.boxes[key]:null;
    let state='unsearched';
    if(box?.complete){
      state=box.items.some(unit=>unit.revealed&&unit.g===recovery.item)?'available':'empty';
    }else if(field.action?.type==='search'&&field.action.key===key)state='searching';
    else if(box?.items.some(unit=>unit.revealed))state='partial';
    return {zone,landmark,index,state};
  });
  const groundZones=[];
  (field.gearGround||[]).forEach((units,zone)=>{
    if(units.some(unit=>matchesOrderRecovery(unit,recovery)))groundZones.push(zone);
  });
  return {sites,groundZones};
}

function recoveryDestinations(order,carried,search){
  if(!order.recovery||carried)return [];
  if(search?.groundZones.length)return search.groundZones.map(zone=>({zone}));
  const sites=search?search.sites.filter(site=>site.state!=='empty'):order.recovery.sources;
  return sites.map(({zone,landmark})=>({zone,landmark}));
}

function inspectionReturnRoute(origin,sites){
  const exit=exitBy('b04');
  function routeFor(ordered){
    const path=[origin],legs=[];
    for(const next of [...ordered.map(site=>site.zone),exit.zone]){
      const from=path[path.length-1];
      if(from===next)continue;
      const road=routeProfile(from,next);
      if(!road)return null;
      legs.push(road);path.push(next);
    }
    const cells=legs.reduce((total,road)=>total+road.distance,0);
    const walkMs=legs.reduce((total,road)=>total+routeStepDuration(road)*road.distance,0);
    const clearChance=legs.reduce((chance,road)=>chance*(1-road.contact/100)**road.distance,1);
    return {ordered,origin,start:sortieSpawnLandmark(origin),path,legs:legs.length,cells,walkMs,contactChance:1-clearChance};
  }
  if(!exit||sites.length!==2)return null;
  const routes=[routeFor(sites),routeFor([sites[1],sites[0]])].filter(Boolean);
  // Equal trips start with the local drawer when possible.
  routes.sort((a,b)=>a.cells-b.cells||a.walkMs-b.walkMs||Number(b.ordered[0].zone===origin)-Number(a.ordered[0].zone===origin));
  return routes[0]||null;
}

function recoveryPreparation(source){
  if(raid||source.kind!=='order')return [];
  const order=ORDERS.find(entry=>entry.id===source.id);
  if(!order?.recovery||order.recovery.sources.length<2)return [];
  return order.recovery.sources.map(({zone,landmark,boxOrdinal})=>{
    const index=LANDMARKS[zone][landmark].boxes[boxOrdinal],lock=lootLockView(zone,index);
    if(!lock)return {zone,landmark,index,status:'free'};
    if(lock.carried)return {zone,landmark,index,lock,status:equipmentState.worn.access===lock.keyId?'equipped':'bag'};
    let stored=null;
    for(const row of physicalPossessionLocations()){
      if(row.id!==lock.keyId||!['stash','case','overflow'].includes(row.kind))continue;
      if(!stored||row.kind!=='case')stored=row;
      if(row.kind==='stash')break;
    }
    return {zone,landmark,index,lock,stored,status:stored?'stored':'missing'};
  });
}

function recoveryMaterial(id,aid,construction,outgoing=0){
  const row=objectiveMaterial(id,aid+construction,false,outgoing);
  // Construction can use only loose warehouse stock. A unit reserved for construction
  // cannot also fill a relief delivery, even if both lines ask for the same kind.
  const assignedBuild=Math.min(construction,Math.max(0,stashUnfittedCount(id)-outgoing));
  const assignedAid=Math.min(aid,Math.max(0,row.usable-assignedBuild));
  return {...row,aid,construction,usable:assignedBuild+assignedAid,missing:row.required-assignedBuild-assignedAid};
}

function recoveryObjective(source) {
  const progress=campaignView(), stage=progress.active, bill=FACILITIES[stage.id].levels[0];
  const needsBuild=!progress.built && !progress.buildEnd;
  const inputs=needsBuild ? bill.materials : {};
  const ids=new Set(Object.keys(inputs));
  if (progress.remaining) ids.add(stage.item);
  const materials=Array.from(ids,id=>{
    const aid=id===stage.item ? progress.remaining : 0, construction=inputs[id] || 0;
    return recoveryMaterial(id,aid,construction);
  });
  const goals=[
    {label:'이번 단계 생환',value:Number(progress.returned),target:1},
    {label:GOODS[stage.item][0]+' 구호 납품',value:progress.delivered,target:stage.quantity},
    {label:FACILITIES[stage.id].name+' 가동',value:Number(progress.built),target:1}
  ];
  if(isActive()&&!progress.returned)goals[0].projected=1;
  if(needsBuild)goals.push({label:'시설 건설비 (CR)',value:Math.min(wallet,bill.costCR),target:bill.costCR});
  const status=progress.ready?'단계 완료 보고 가능':progress.buildEnd?'시설 공사 중':'복구 진행 중';
  return {source, title:stage.title, kindLabel:'B-04 벙커 복구', status, goals, materials,
    locations:objectiveHuntLocations([],[],materials)};
}

function resolveObjective(pin = objectivePin) {
  const source = normalizeObjectivePin(pin);
  if (!source) return null;
  const {kind, id} = source;
  if (kind === 'finale') {
    const v=finaleView();
    const goals=v.traders.map(t=>({label:t.name+' 협력',value:Number(t.done),target:1}));
    goals.push({label:'이번 작전 중계 확인',value:v.stations.filter(s=>s.confirmed).length,target:v.stations.length});
    const labels={locked:'네 상인 우호도 의뢰 확인',available:'종결 작전 준비 가능',armed:'다음 출격 대기',active:'세 권역 신호 연결'};
    const status=v.active&&v.stations.every(s=>s.confirmed)?'세 신호 연결 · 생환 필요':labels[v.status];
    return {source,title:'B-04 외부 통신망 복구',kindLabel:'종결 작전',status,goals,materials:[],
      locations:v.stations.filter(s=>!s.confirmed).map(s=>({zone:s.zone}))};
  }
  if (kind === 'campaign') return recoveryObjective(source);
  if (kind === 'facility') {
    const step = FACILITIES[id].levels[source.tier - 1];
    const materials = Object.entries(step.materials).map(([item, quantity]) => objectiveMaterial(item, quantity, true));
    const goals = step.requires.map(requirement => ({
      label:FACILITIES[requirement.facility].name + ' 단계',
      value:Math.min(requirement.level, hideoutLevel(requirement.facility)), target:requirement.level
    }));
    goals.push({label:'건설비 (CR)', value:Math.min(wallet, step.costCR), target:step.costCR});
    return {source, title:FACILITIES[id].name + ' ' + source.tier + '단계', kindLabel:'시설 건설',
      status:facilityBuildStatus(id, source.tier) || '건설 가능', goals, materials,
      locations:objectiveHuntLocations([], [], materials)};
  }
  if (kind === 'order') {
    const order = ORDERS.find(entry => entry.id === id);
    const assigned = bunkerOrderGoals(order);
    const goals = assigned.map(([label, current, target],i) => ({label, value:(id===SHUTTLE_ORDER||id===PASSAGE_ORDER)&&i===0?current:0, target}));
    if (isActive()) {
      assigned.slice(0,-1).forEach((row,index)=>{if(row[1]>0)goals[index].projected=row[1];});
      if (objectiveRaidRating(Object.values(field.boxes).filter(box => box.complete).length) === 'success') {
        if(id===PASSAGE_ORDER&&field.gateTest?.stage==='plan')goals[0].projected=1;
        if(id===SHUTTLE_ORDER&&field.shuttle?.stage==='plan')goals[0].projected=1;
        if((id!==SHUTTLE_ORDER||field.shuttle?.arrived)&&(id!==PASSAGE_ORDER||field.gateTest?.fix))goals[goals.length-1].projected=1;
      }
    }
    const recovery=order.recovery&&isActive()
      ? {...order.recovery,carried:countOrderRecovery(order),required:order.target} : null;
    const carried=recovery&&recovery.carried>=recovery.required;
    const search=recoverySearchProgress(recovery);
    const inspections=order.inspections?orderInspectionSites(order,isActive()?field:null):null;
    const sample=order.sample?sampleInspection(order,isActive()?field:null,isActive()?field.bag:equipmentState.bag):null;
    if(sample && !raid && sample.carried)goals[1].value=1;
    const observations=order.id==='weather-survey'&&isActive()?surveyObservations():[];
    const locations=order.id===PASSAGE_ORDER?passageLocations():order.id===SHUTTLE_ORDER?shuttleLocations():order.id===WARD_FIELD_ID?wardCheckLocations():order.id===RELIEF_ORDER?reliefDirections():order.id==='sealed-mail'?postalLocations():order.id==='weather-survey'?(observations.length===2?[]:SURVEY_STATIONS.filter(site=>!observations.some(row=>row.zone===site.zone))):sample?(sample.site.complete?[]:[sample.site]):inspections
      ? inspections.filter(site=>!site.complete).map(({zone,landmark})=>({zone,landmark}))
      : order.id==='pump-gauge' && (!isActive()||!pumpGaugeProgress())?[PUMP_SITE]:recoveryDestinations(order,carried,search);
    return {source, title:order.title, kindLabel:'벙커 의뢰', status:id===PASSAGE_ORDER&&!career.gateTest?'1차 정상 귀환 시 차단 방향 확정':id===SHUTTLE_ORDER&&!career.shuttle?'1차 정상 귀환 시 배차 확정':'정상 탈출 시 정산',
      goals, materials:[], recovery, search, inspections, locations, sample};
  }

  const standingQuest = kind === 'contract';
  const quest = standingQuest ? CONTRACT_BY_ID.get(id) :
    recurringOffersFor(kind, source.key, source.trader).find(entry => entry.id === id);
  const record = standingQuest ? traderContracts[quest.trader].active : periodicContracts[kind].records[id];
  const trader = findMarketTrader(quest.trader);
  const requirements = new Map();
  for (const goal of quest.goals) {
    if (goal.type === 'delivery') requirements.set(goal.item, (requirements.get(goal.item) || 0) + goal.target);
  }
  const materials = Array.from(requirements, ([item, quantity]) => objectiveMaterial(item, quantity, false));
  const goals = standingQuest ? objectiveContractGoals(quest, record) :
    quest.goals.flatMap((goal, index) => goal.type === 'delivery' ? [] :
      [{label:recurringGoalText(goal, trader), value:record.progress[index], target:goal.target}]);

  const ready = materials.every(row => row.missing === 0) && goals.every(row => row.value >= row.target);
  const returnReady = isActive() && !ready && materials.every(row => row.usable + row.fieldUsable >= row.required) &&
    goals.every(row => (row.projected ?? row.value) >= row.target);
  let status = '진행 중';
  if (ready) status = (raid ? '귀환 후 ' : '') + trader.name + '에게 보고 가능';
  else if (returnReady) status = '생환하면 보고 가능';
  else if (goals.some(row => row.projected !== undefined)) status = '현장 진행 · 생환 시 반영';
  const kindLabel = {contract:'우호도 의뢰', daily:'일일 의뢰', weekly:'주간 의뢰'}[kind];
  return {source, title:quest.title, kindLabel:trader.name + ' · ' + kindLabel, status, goals, materials,
    locations:objectiveHuntLocations(quest.goals, record.progress, materials)};
}

// The sale tray contains verified, removable warehouse instances. Use the same
// material allocation as the objective screen to preview the post-sale shortfall.
function saleObjectiveImpact(quote) {
  if(!quote.ok||!objectivePin)return null;
  const goal=resolveObjective();
  if(!goal)return null;
  const sold=new Map();
  for(const {item} of quote.lines)sold.set(item,(sold.get(item)||0)+1);
  const lines=[];
  for(const row of goal.materials){
    const quantity=sold.get(row.id);
    if(!quantity)continue;
    const next=goal.source.kind==='campaign'
      ? recoveryMaterial(row.id,row.aid,row.construction,quantity)
      : objectiveMaterial(row.id,row.required,goal.source.kind==='facility',quantity);
    if(next.missing>row.missing)lines.push({item:row.id,quantity,before:row.missing,after:next.missing});
  }
  return lines.length?{title:goal.title,lines}:null;
}
