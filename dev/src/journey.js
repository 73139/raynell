// Movement, previews and supply candidates share one record per directed route.
const TRAVEL_ENERGY_PER_STEP = 3;
function defineRoute(from, to, name, distance, stepMs, clear, supply, contact, weights) {
  const items = Object.entries(weights).map(([tpl, relativeProbability]) => ({tpl, relativeProbability}));
  return {from, to, name, distance, stepMs, clear, supply, contact, items};
}
const ROUTES = [
  defineRoute(0,1,'배수로 옆길',1,8000,65,25,10,{water:50,bandage:30,food:20}),
  defineRoute(0,2,'폐철도 화물선',3,10000,38,27,35,{battery:45,wire:35,tape:20}),
  defineRoute(1,0,'검문소 후문길',1,7000,72,20,8,{bandage:50,water:35,medkit:15}),
  defineRoute(1,2,'화물차 대기선',2,9000,46,34,20,{food:45,tape:35,battery:20}),
  defineRoute(2,0,'방벽 정비로',3,8000,55,30,15,{wire:50,tape:30,bandage:20}),
  defineRoute(2,1,'적재장 연결로',2,7000,40,32,28,{medkit:25,bandage:40,battery:35})
];
// Before v0.20 every road used eight seconds per cell and the same event and supply tables.
const LEGACY_ROAD = defineRoute(null,null,'이전 버전 이동 경로',0,8000,55,25,20,
  {water:27,bandage:23,food:17,wire:13,battery:9,tape:7,medkit:4});

function routeProfile(from,to) {
  return ROUTES.find(route=>route.from===from && route.to===to) || null;
}
function routeDistance(from,to) {
  return routeProfile(from,to)?.distance || 0;
}
function routeStepDuration(profile) {
  return actionDuration('move',profile.stepMs);
}
function routeTimeLabel(from,to) {
  const road=routeProfile(from,to);
  if (!road) return '0칸 · 0초';
  const seconds=road.distance*routeStepDuration(road)/1000;
  return road.distance+'칸 · '+seconds.toLocaleString('ko-KR')+'초';
}

function rollTravelLeg(profile, random) {
  const roll=random();
  if (roll<profile.clear/100) return {outcome:'clear',supply:null};
  if (roll>=(profile.clear+profile.supply)/100) return {outcome:'contact',supply:null};
  const total=profile.items.reduce((sum,row)=>sum+row.relativeProbability,0);
  let pick=random()*total;
  for (const row of profile.items) {
    if (pick<row.relativeProbability) return {outcome:'supply',supply:row.tpl};
    pick-=row.relativeProbability;
  }
  return {outcome:'supply',supply:profile.items[profile.items.length-1].tpl};
}

function migrateJourneySchedule(version) {
  const j=field?.journey;
  if (!raid || (!j && field.action?.type!=='travel-step')) return;
  // A partial or edited browser-store entry must not leave a travel timer running without a route.
  if (!validJourneyBackup({version,field,raid})) {
    field.journey=null;field.action=null;field.contact=null;field.open=null;
    logField('이동 기록을 복원할 수 없어 현재 권역에 머물렀습니다.');
    return;
  }
  if (version>=20) return;
  const route=routeProfile(j.from,j.to);
  // The old save contains only the current roll. Never reroll it. For hitherto undecided
  // cells derive a stable seed so importing that same pre-v20 file again has the same future.
  const modulus=2147483647;
  let seed=(raid.startedAt%modulus+(j.from*3+j.to)*1009+j.done*91)%(modulus-1)+1;
  function random() {
    seed=seed*48271%modulus;
    return (seed-1)/(modulus-1);
  }
  const action=field.action, moving=j.event===null && action?.type==='travel-step';
  const legs=Array.from({length:route.distance},(_,index)=>{
    if (moving && index===j.done) return {outcome:action.outcome,supply:action.supply};
    if (j.event && index===j.done-1) return {outcome:j.event,supply:j.supply};
    return index<j.done ? null : rollTravelLeg(LEGACY_ROAD,random);
  });
  j.schedule={rules:'legacy',stepMs:moving?action.end-action.start:routeStepDuration(LEGACY_ROAD),legs};
}

function journeyTiming(j=field.journey,now=Date.now()) {
  if (!j) return null;
  const route=routeProfile(j.from,j.to);
  if (!route || !j.schedule) return null;
  const {stepMs,rules}=j.schedule, paused=!!j.event;
  const remainingCells=route.distance-j.done;
  const arrivalAt=paused?null:field.action.end+(remainingCells-1)*stepMs;
  return {name:rules==='legacy'?LEGACY_ROAD.name:route.name,baseStepMs:rules==='legacy'?LEGACY_ROAD.stepMs:route.stepMs,stepMs,total:route.distance,done:j.done,
    paused,legacy:rules==='legacy',arrivalAt,remainingMs:paused?remainingCells*stepMs:Math.max(0,arrivalAt-now)};
}

function queueJourneyStep(at) {
  const {schedule,done}=field.journey;
  field.action={type:'travel-step',start:at,end:at+schedule.stepMs,...schedule.legs[done]};
}

let journeySaveNotice='', journeyNoticeField=null;
function journeyFailureMarkup() {
  return journeySaveNotice && journeyNoticeField===field ?'<p class="exit-warn" role="status">'+esc(journeySaveNotice)+'</p>':'';
}

function commitJourneyAction(change) {
  // Save the offer, bag, destination and selected tile together. The copy of the log
  // also restores its evicted last entry if writing fails at its length limit.
  const current=field, oldRaidZone=raid.zone, oldZone=zone;
  const oldSelection={picked,dragged,notice,exitNotice};
  const before={journey:field.journey && {...field.journey},action:field.action,open:field.open,energy:field.energy,water:field.water,
    bag:field.bag.slice(),visited:field.visited.slice(),log:field.log.slice()};
  journeySaveNotice='';
  change();
  if (!writeSession()) {
    if (field===current) {
      Object.assign(field,before);
      raid.zone=oldRaidZone;zone=oldZone;
      ({picked,dragged,notice,exitNotice}=oldSelection);
      journeySaveNotice='이동 정보를 저장하지 못했습니다. 다시 시도하세요.';
    } else {
      if (raid) zone=raid.zone;
      journeySaveNotice='다른 탭의 최신 이동 기록을 불러왔습니다.';
    }
    journeyNoticeField=field;
    const live=$('#announce');
    if (live) live.textContent=journeySaveNotice;
  }
  renderKeep();
}

function startJourney(to) {
  if (!writer || !isActive() || field.action || field.contact || field.journey) return;
  const profile=routeProfile(raid.zone,to);
  if (!profile) return;
  commitJourneyAction(()=>{
    const legs=Array.from({length:profile.distance},()=>rollTravelLeg(profile,Math.random));
    const schedule={rules:'v20',stepMs:routeStepDuration(profile),legs};
    field.journey={from:raid.zone,to,done:0,event:null,supply:null,schedule};
    field.open=null;picked=null;dragged=null;notice='';exitNotice='';
    logField(profile.name+' 출발 · '+FIELD_ZONES[to].name+' 방면 '+profile.distance+'칸.');
    queueJourneyStep(Date.now());
  });
}
function resumeJourney(at){
  const j=field.journey;
  if(!j)return;
  j.event=null;j.supply=null;
  if(j.done<routeDistance(j.from,j.to)){queueJourneyStep(at);return}
  raid.zone=j.to;zone=j.to;
  if(!field.visited.includes(j.to))field.visited.push(j.to);
  logField(FIELD_ZONES[j.to].name+' 도착.');
  field.journey=null;field.action=null;
}
function finishJourneyStep(action){
  const j=field.journey;
  field.action=null;
  if(!j)return;
  j.done++;
  field.energy=Math.max(0,field.energy-TRAVEL_ENERGY_PER_STEP);
  if(sufferExhaustion(action.end))return;
  if(action.outcome==='supply'){
    j.event='supply';j.supply=action.supply;
    logField(j.done+'칸째 보급 발견 · '+GOODS[j.supply][0]+'.');
  }else if(action.outcome==='contact'){
    j.event='contact';field.contact={zone:j.to,hp:CONTACTS[j.to].hp};
    logField(j.done+'칸째 '+CONTACTS[j.to].name+' 조우.');
  }else{
    logField(j.done+'칸째 무사 통과.');
    resumeJourney(action.end);
  }
}
function roadSupplyPlacement(id){
  const item=GOODS[id];
  return kitFit(field.bag,raidBagSize(),{g:id,x:0,y:0,w:item[1],h:item[2]});
}
function roadSupplyRecovery(id){
  const effect=kitSupply(id);
  if(!effect||!['energy','water'].includes(effect.stat))return null;
  return {...effect,gain:Math.min(effect.gain,Math.max(0,100-field[effect.stat]))};
}
function handleJourneyField(d){
  const j=field.journey;
  if(!writer||!isActive()||!j||j.event!=='supply'||field.action||field.contact)return;
  if(!['journey-take','journey-pass','journey-consume'].includes(d.field))return;
  const take=d.field==='journey-take', placement=take?roadSupplyPlacement(j.supply):null;
  if(take&&!placement)return;
  const recovery=d.field==='journey-consume'?roadSupplyRecovery(j.supply):null;
  if(d.field==='journey-consume'&&!recovery?.gain)return;
  commitJourneyAction(()=>{
    if(recovery) {
      field[recovery.stat]+=recovery.gain;
      logField(GOODS[j.supply][0]+' 현장 사용 · '+recovery.label+' +'+recovery.gain+'.');
    } else if(take) {
      field.bag.push({...kitUnit(j.supply),...placement});
      logField(GOODS[j.supply][0]+' 1개를 가방에 담았습니다.');
    } else logField('보급품을 두고 이동합니다 · '+GOODS[j.supply][0]+'.');
    resumeJourney(Date.now());
  });
}
function journeyProgress(){
  return routeStatusPanel();
}
function journeyPage(){
  const j=field.journey, supply=j.event==='supply'?GOODS[j.supply]:null;
  let eventPanel='';
  if(supply){
    const fitsInBag=Boolean(roadSupplyPlacement(j.supply));
    const recovery=roadSupplyRecovery(j.supply), busy=Boolean(field.action);
    const consumeButton=recovery?'<button data-field="journey-consume"'+(!recovery.gain||busy?' disabled':'')+'>'+
      (recovery.stat==='water'?'마시고 이동':'먹고 이동')+' · '+recovery.label+(recovery.gain?' +'+recovery.gain:' 최대')+'</button>':'';
    eventPanel='<section class="panel road-supply"><div class="kit-heading"><h2>길에서 발견한 보급품</h2>'+ico(supply[4])+'</div>'+
      '<p><strong>'+supply[0]+'</strong> · '+supply[1]+'×'+supply[2]+'칸 · '+supply[3]+' kg</p>'+
      objectiveSelectedItem({g:j.supply,revealed:true})+
      (!fitsInBag?'<p>이 보급품을 담을 가방 공간이 부족합니다.</p>':'')+
      '<div class="contact-buttons"><button class="primary" data-field="journey-take" '+(fitsInBag&&!busy?'':'disabled')+'>가방에 담고 진행</button>'+
      consumeButton+'<button data-field="journey-pass"'+(busy?' disabled':'')+'>두고 진행</button><button data-page="inventory">가방 확인</button></div></section>';
  }
  return head('FIELD / TRAVEL',FIELD_ZONES[j.to].name+' 방면',supply?'보급품을 어떻게 할지 선택하세요.':'다음 칸까지 이동하고 있습니다.')+
    weatherBrief('field',raid.zone)+journeyProgress()+actionMarkup()+eventPanel+objectivePanel('field')+
    '<section class="field-section"><h2>현장 기록</h2><div class="field-log">'+field.log.slice(0,4).map(l=>'<p>'+esc(l)+'</p>').join('')+'</div></section>';
}
function validTravelLeg(leg,profile) {
  if (!leg || typeof leg!=='object') return false;
  if (leg.outcome==='supply') return profile.items.some(row=>row.tpl===leg.supply);
  return (leg.outcome==='contact' || leg.outcome==='clear') && leg.supply===null;
}

function validTravelDuration(profile,ms) {
  for (let level=0;level<=FACILITIES.rest.levels.length;level++) {
    if (ms===adjustHideoutActionMs('move',profile.stepMs,level)) return true;
  }
  return false;
}

function validJourneySchedule(j,action,route) {
  const schedule=j.schedule;
  if (!schedule || !['v20','legacy'].includes(schedule.rules)) return false;
  const profile=schedule.rules==='legacy'?LEGACY_ROAD:route;
  if (!validTravelDuration(profile,schedule.stepMs)) return false;
  if (!Array.isArray(schedule.legs) || schedule.legs.length!==route.distance) return false;
  const validLegs=schedule.legs.every((leg,i)=>{
    if (leg===null) return schedule.rules==='legacy' && i<j.done;
    return validTravelLeg(leg,profile);
  });
  if (!validLegs) return false;
  const current=j.event===null?schedule.legs[j.done]:schedule.legs[j.done-1];
  if (!current) return false;
  if (j.event!==null) return current.outcome===j.event && current.supply===j.supply;
  return action?.end-action?.start===schedule.stepMs && current.outcome===action.outcome && current.supply===action.supply;
}

function validJourneyBackup(snapshot){
  const f=snapshot.field,j=f.journey,a=f.action;
  if(a?.type==='evade'&&a.escaped!==undefined&&typeof a.escaped!=='boolean')return false;
  if(j==null)return a?.type!=='travel-step';
  if(!snapshot.raid||f.result||f.open!=null||typeof j!=='object'||j.from!==snapshot.raid.zone)return false;
  const route=routeProfile(j.from,j.to);
  if(!route||!Number.isInteger(j.done)||j.done<0||j.done>route.distance)return false;
  if (snapshot.version>=20) {
    if (!validJourneySchedule(j,a,route)) return false;
  } else if (j.schedule!==undefined) return false;
  const profile=j.schedule?.rules==='v20'?route:LEGACY_ROAD;
  if(j.event===null){
    return j.done<route.distance && j.supply===null && f.contact==null &&
      a?.type==='travel-step' && validTravelDuration(profile,a.end-a.start) && validTravelLeg(a,profile);
  }
  if(j.done===0)return false;
  const treating=snapshot.version>=26 && a?.type==='treat';
  if(j.event==='supply')return validTravelLeg({outcome:'supply',supply:j.supply},profile)&&(a==null||treating)&&f.contact==null;
  return j.event==='contact'&&j.supply===null&&f.contact?.zone===j.to&&(a==null||treating||['engage','evade'].includes(a.type));
}
