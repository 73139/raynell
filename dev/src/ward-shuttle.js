// The depot books a route on normal return. A later sortie measures the journey between its two stops.
const SHUTTLE_ORDER='ward-shuttle',SHUTTLE_DEPOT={zone:1,landmark:6};
const SHUTTLE_ROUTES={
  local:{name:'외곽 순환선',from:{zone:0,landmark:1},to:{zone:0,landmark:7},seconds:45,cr:38000,xp:120},
  freight:{name:'창고 연결선',from:{zone:2,landmark:1},to:{zone:1,landmark:1},seconds:90,cr:50000,xp:155}
};
function shuttleName(point){return LANDMARKS[point.zone][point.landmark].name;}
function shuttleAt(point){return raid.zone===point.zone&&field.landmarkByZone?.[raid.zone]===point.landmark;}
function shuttleRate(){return SHUTTLE_ROUTES[field?.shuttle?.stage==='plan'?field.shuttle.route:career?.shuttle?.route]||SHUTTLE_ROUTES.local;}
function shuttleProgress(){return Number(Boolean(career.shuttle))+Number(Boolean(field.shuttle?.arrived));}
function shuttleGoals(){
  return [['배차판 노선 확정 후 1차 정상 귀환',Number(Boolean(career.shuttle)),1],
    ['다음 출격에서 제한시간 내 도착 응답',Number(Boolean(career.shuttle?.receipt||field.shuttle?.arrived)),1],
    ['시운전 후 정상 탈출',Number(Boolean(career.shuttle?.receipt)),1]];
}
function shuttleLocations(now=Date.now()){
  const entry=isActive()?field.shuttle:null;
  if(!career.shuttle||entry?.stage==='plan')return entry?[]:[SHUTTLE_DEPOT];
  if(entry?.arrived||career.shuttle.receipt)return [];
  const route=SHUTTLE_ROUTES[career.shuttle.route];
  return [entry && now<entry.at+route.seconds*1000 ? route.to : route.from];
}
function shuttleRoadBrief(route){
  if(route.from.zone===route.to.zone)return '같은 권역 · 정류장 사이 권역 이동 없음';
  const road=routeProfile(route.from.zone,route.to.zone);
  return esc(road.name)+' '+road.distance+'칸 · 기본 이동 '+routeSeconds(routeStepDuration(road)*road.distance)+
    ' · 도중 조우 확률 '+routeTripChance(road.contact,road.distance);
}
function shuttleDescription(route){
  return esc(route.name)+' · '+esc(shuttleName(route.from))+' → '+esc(shuttleName(route.to))+
    ' · '+route.seconds+'초 · '+money(route.cr)+' / '+route.xp+' XP<br><small>'+shuttleRoadBrief(route)+'</small>';
}
function shuttleDossier(){
  const plan=career.shuttle;
  const selected=plan&&SHUTTLE_ROUTES[plan.route];
  const line=plan?.receipt?'시운전 완료 · '+esc(selected.name)+' · 실제 '+((plan.receipt.arrived-plan.receipt.at)/1000).toFixed(1)+'초':
    plan?'1차 정상 귀환으로 확정 · '+esc(selected.name)+' · 다음 출격에서 '+esc(shuttleName(selected.from))+' 호출':
    '1차 정상 귀환은 배차만 확정합니다. 수당은 2차 시운전 후 정상 귀환할 때 지급합니다.';
  return '<section class="pump-gauge" data-shuttle-dossier><h3>의무반 배차표</h3><p>'+line+'</p><ul>'+
    Object.values(SHUTTLE_ROUTES).map(route=>'<li>'+shuttleDescription(route)+'</li>').join('')+'</ul>'+
    '<p>창고 연결선은 권역을 이동합니다. 호출 시간이 지나면 출발 정류장에서 다시 부를 수 있습니다. 배차 변경은 검문소 배차판을 조정한 뒤 정상 귀환해야 반영됩니다.</p></section>';
}
function shuttleButton(action,text,route){
  return '<button type="button" data-field="shuttle" data-step="'+action+'" data-raid-id="'+raid.startedAt+'"'+(route?' data-route="'+route+'"':'')+
    (!writer||field.action||field.open||field.contact||field.journey?' disabled':'')+'>'+esc(text)+'</button>';
}
function shuttleFieldPanel(now=Date.now()){
  if(career.order!==SHUTTLE_ORDER||!isActive())return '';
  const entry=field.shuttle,plan=career.shuttle,route=plan&&SHUTTLE_ROUTES[plan.route];
  let body='',state='';
  if(entry?.stage==='run'){
    const seconds=Math.ceil((entry.at+route.seconds*1000-now)/1000);
    if(entry.arrived){state='arrived';body='도착 응답 완료 · '+esc(route.name)+' · 정상 탈출하면 '+money(route.cr)+'와 '+route.xp+' XP를 받습니다.';}
    else if(seconds>0){
      state='timed';body=esc(shuttleName(route.to))+' 도착 응답까지 <strong data-shuttle-seconds>'+seconds+'</strong>초 남음.';
      if(shuttleAt(route.to))body+=' '+shuttleButton('arrive','도착 응답');
    }else{
      state='expired';body='호출 시간이 지났습니다. '+esc(shuttleName(route.from))+'에서 다시 호출하세요.';
      if(shuttleAt(route.from))body+=' '+shuttleButton('call','같은 노선 다시 호출');
    }
  }else if(shuttleAt(SHUTTLE_DEPOT)){
    state='depot';
    body=(entry?'선택한 노선 · '+esc(SHUTTLE_ROUTES[entry.route].name)+' · 정상 귀환 전까지 변경할 수 있습니다.':
      plan?'현재 확정 · '+esc(route.name)+' · 다른 노선으로 배차를 변경할 수 있습니다.':'시운전할 노선을 배차판에서 선택하세요.')+
      Object.entries(SHUTTLE_ROUTES).filter(([id])=>id!==(entry?.route||plan?.route)).map(([id,r])=>
        '<div>'+shuttleDescription(r)+' '+shuttleButton('plan',r.name+' 배차',id)+'</div>').join('');
  }else if(entry?.stage==='plan'){
    state='booked';body=esc(SHUTTLE_ROUTES[entry.route].name)+' 배차 대기 · 이번 출격에서 정상 탈출해 노선을 확정하세요.';
  }else if(route && shuttleAt(route.from)){
    state='ready';body=shuttleDescription(route)+' '+shuttleButton('call','호출하고 시운전 시작');
  }else return '';
  return '<section class="pump-gauge" data-shuttle="'+state+'"><h3 tabindex="-1">의무 셔틀 시운전</h3><div>'+body+'</div></section>';
}
let shownShuttleExpiry=0;
function tickShuttle(now){
  const record=field.shuttle;
  if(!record||record.stage!=='run'||record.arrived||!isActive())return;
  const deadline=record.at+SHUTTLE_ROUTES[record.route].seconds*1000;
  if(now>=deadline){
    if(deadline!==shownShuttleExpiry){
      shownShuttleExpiry=deadline;
      if(!rendering&&(page==='map'||page==='raid'))renderKeep();
    }
    return;
  }
  const timer=page==='raid'&&$('[data-shuttle-seconds]');
  const text=String(Math.ceil((deadline-now)/1000));
  if(timer&&timer.textContent!==text)timer.textContent=text;
}
function handleShuttle(d){
  const now=Date.now();
  if(!writer||!isActive()||career.order!==SHUTTLE_ORDER||d.raidId!==String(raid.startedAt)||now>=raid.endsAt||
     field.action||field.journey||field.open||field.contact)return;
  const owner=field,old=field.shuttle,plan=career.shuttle,route=plan&&SHUTTLE_ROUTES[plan.route];
  if(d.step==='plan'){
    if(!Object.hasOwn(SHUTTLE_ROUTES,d.route)||!shuttleAt(SHUTTLE_DEPOT)||old?.stage==='run'||d.route===(old?.route||plan?.route))return;
    field.shuttle={stage:'plan',route:d.route,raidId:raid.startedAt,at:now};
  }else{
    if(!plan||plan.receipt||raid.startedAt<plan.returnedAt||old?.stage==='plan')return;
    const deadline=old?old.at+route.seconds*1000:0;
    if(d.step==='call' && shuttleAt(route.from) && !old?.arrived && (!old||now>=deadline)){
      field.shuttle={stage:'run',route:plan.route,raidId:raid.startedAt,at:now};
    }else if(d.step==='arrive' && shuttleAt(route.to)&&old&&!old.arrived&&now<deadline){
      field.shuttle={...old,arrived:now};
    }else return;
  }
  if(!writeSession()&&owner===field){if(old)field.shuttle=old;else delete field.shuttle;}
  renderKeep();$('[data-shuttle] h3')?.focus?.({preventScroll:true});
}
function shuttleLegValid(r,prior,kind){
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['route','stage','raidId','at','arrived','returnedAt','receipt'].includes(k))||r.stage!==kind||!Object.hasOwn(SHUTTLE_ROUTES,r.route)||!Number.isSafeInteger(r.raidId)||r.raidId<prior||
    !Number.isSafeInteger(r.at)||r.at<r.raidId||r.at>=r.raidId+RAID_DURATION_MS||r.at>Date.now())return false;
  return r.arrived===undefined || (kind==='run'&&Number.isSafeInteger(r.arrived)&&r.arrived>=r.at&&
    r.arrived<Math.min(r.raidId+RAID_DURATION_MS,r.at+SHUTTLE_ROUTES[r.route].seconds*1000)&&r.arrived<=Date.now());
}
function shuttleReturned(r){
  return Number.isSafeInteger(r.returnedAt)&&r.returnedAt>=(r.arrived??r.at)&&r.returnedAt<r.raidId+RAID_DURATION_MS&&r.returnedAt<=Date.now();
}
function shuttlePlanValid(p,proof){
  if(!proof||!shuttleLegValid(p,proof.at,'plan')||p.raidId<=proof.raidId||!shuttleReturned(p))return false;
  const r=p.receipt;
  return r===undefined||(r.receipt===undefined&&shuttleLegValid(r,p.returnedAt,'run')&&r.raidId>p.raidId&&r.route===p.route&&r.arrived!==undefined&&shuttleReturned(r));
}
function validShuttleBackup(s){
  const c=s.career,f=s.field,p=c?.shuttle,entry=f?.shuttle;
  const done=Array.isArray(c?.done)&&c.done.includes(SHUTTLE_ORDER),active=c?.order===SHUTTLE_ORDER;
  if(!done&&!active&&p===undefined&&entry===undefined)return true;
  if(!Array.isArray(c.done)||!c.done.includes(WARD_FIELD_ID)||!wardCheckRecord(c.wardCheckReceipt,s.hideout?.wardTrial?.paid)||
    (p!==undefined&&!shuttlePlanValid(p,c.wardCheckReceipt))||done!==Boolean(p?.receipt)||(done&&active))return false;
  if(p){
    const rec=p.receipt||p,summary=s.lastSummary,rate=SHUTTLE_ROUTES[p.route];
    if(summary?.raidId===rec.raidId && (summary.rating!=='success'||summary.elapsed!==rec.returnedAt-rec.raidId||(p.receipt?
      summary.orderName!==ORDERS.find(order=>order.id===SHUTTLE_ORDER).title||summary.commission!==rate.cr||summary.missionXp!==rate.xp:summary.commission!==0)))return false;
  }
  if(entry===undefined)return true;
  if(!entry||typeof entry!=='object'||!s.raid||!active||f.result||entry.raidId!==s.raid.startedAt||entry.returnedAt!==undefined||entry.receipt!==undefined||!Array.isArray(f.visited))return false;
  if(entry.raidId<=c.wardCheckReceipt.raidId || (p && entry.raidId<=p.raidId))return false;
  if(entry.stage==='plan')return shuttleLegValid(entry,p?.returnedAt??c.wardCheckReceipt.at,'plan')&&f.visited.includes(SHUTTLE_DEPOT.zone);
  if(!p||p.receipt||entry.route!==p.route||!shuttleLegValid(entry,p.returnedAt,'run'))return false;
  const route=SHUTTLE_ROUTES[p.route];
  return f.visited.includes(route.from.zone)&&(!entry.arrived||f.visited.includes(route.to.zone));
}
