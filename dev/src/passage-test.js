// A voluntary one-way closure is booked on return. Its reverse and both warehouse roads remain open.
const PASSAGE_ORDER='passage-test';
const PASSAGE_BOARDS=[{zone:0,landmark:9},{zone:1,landmark:0}];
const PASSAGE_SERVICE={zone:2,landmark:3};
const PASSAGE_FIX={local:{name:'현장 비상 해제',cr:28000,xp:90},service:{name:'배차실 정식 복구',cr:46000,xp:145}};
function passageRoute(from){return routeProfile(from,1-from);}
function passageSpot(site){return LANDMARKS[site.zone][site.landmark].name;}
function passageHere(site){return raid.zone===site.zone&&field.landmarkByZone?.[site.zone]===site.landmark;}
function passageRate(){return PASSAGE_FIX[field?.gateTest?.fix||career?.gateTest?.receipt?.fix]||PASSAGE_FIX.local;}
function passageClosed(from,to){
  const plan=career?.gateTest;
  return Boolean(career?.order===PASSAGE_ORDER&&plan&&!plan.receipt&&from===plan.from&&to===1-from&&
    (!raid||(!field.result&&raid.startedAt>plan.raidId&&!field.gateTest?.fix)));
}
function passageGoals(){
  const p=career.gateTest,entry=raid&&!field.result?field.gateTest:null;
  return [['차단 방향 지정 후 첫 정상 귀환',Number(Boolean(p)),1],
    ['차단 현장 확인 및 통행 복구',Number(Boolean(p?.receipt||entry?.fix)),1],
    ['복구 후 정상 탈출',Number(Boolean(p?.receipt)),1]];
}
function passageLocations(){
  const p=career.gateTest,entry=isActive()?field.gateTest:null;
  if(!p)return [PASSAGE_BOARDS[0]];
  if(p.receipt||entry?.fix)return [];
  return entry?.stage==='inspect'?[PASSAGE_BOARDS[p.from],PASSAGE_SERVICE]:[PASSAGE_BOARDS[p.from]];
}
function passageLabel(from){
  return FIELD_ZONES[from].name+' → '+FIELD_ZONES[1-from].name+' · '+passageRoute(from).name;
}
function passageDossier(){
  const p=career.gateTest,entry=isActive()?field.gateTest:null;
  const current=p?.receipt?'시험 완료 · '+PASSAGE_FIX[p.receipt.fix].name:p?'차단 방향 확정 · '+passageLabel(p.from)+' · 현장 확인 지점 '+passageSpot(PASSAGE_BOARDS[p.from]):
    entry?.stage==='plan'?'이번 출격에서 지정 · '+passageLabel(entry.from):'첫 출격 · 경계 울타리의 차단판에서 한 방향을 지정하세요.';
  return '<section class="pump-gauge" data-passage-dossier><h3>통행 시험표</h3><p>'+esc(current)+'</p>'+
    '<p>첫 정상 귀환은 방향만 확정합니다. 이후 출격에서 선택한 길의 출발 지점으로 가서 차단 상태를 확인하세요. 반대 방향과 군수 창고를 지나는 도로는 계속 열려 있습니다. 벙커에서 의뢰를 취소하면 시험을 중지하고, 다시 수락하면 같은 방향으로 재개합니다.</p>'+
    Object.values(PASSAGE_FIX).map(r=>'<p>'+r.name+' · '+money(r.cr)+' / '+r.xp+' XP</p>').join('')+
    '<p>정식 복구는 차단 현장을 확인한 뒤 군수 보급 창고 배차 사무동에서 진행합니다. 통행은 누르는 즉시 열리고, 복구 수당은 정상 귀환 때 한 번 지급됩니다. 조기 귀환이나 실종 뒤에는 다음 출격에서 다시 복구하세요.</p></section>';
}
function passageButton(step,text,from){
  return '<button type="button" data-field="passage" data-step="'+step+'" data-raid-id="'+raid.startedAt+'"'+
    (from===undefined?'':' data-from="'+from+'"')+(!writer||field.action||field.contact||field.journey||field.open?' disabled':'')+'>'+esc(text)+'</button>';
}
function passagePanel(){
  if(career.order!==PASSAGE_ORDER||!isActive())return '';
  const p=career.gateTest,e=field.gateTest;
  let html='';
  if(!p){
    if(!passageHere(PASSAGE_BOARDS[0]))return '';
    html='<p>'+(e?'지정 · '+esc(passageLabel(e.from))+' · 정상 귀환 전 변경 가능':'다음 출격에 차단할 방향을 선택하세요.')+'</p>'+
      [0,1].filter(z=>z!==e?.from).map(z=>passageButton('plan',passageLabel(z)+' 지정',z)).join(' ');
  }else if(e?.fix){
    html='<p>'+esc(PASSAGE_FIX[e.fix].name)+' 완료 · 통행 재개 · 정상 귀환 시 '+money(PASSAGE_FIX[e.fix].cr)+'</p>';
  }else if(passageHere(PASSAGE_BOARDS[p.from])){
    html='<p>'+esc(passageLabel(p.from))+' 통행 차단</p>'+(e?
      passageButton('local','현장 비상 해제 · '+money(PASSAGE_FIX.local.cr))+'<p>정식 복구는 군수 보급 창고의 '+passageSpot(PASSAGE_SERVICE)+'에서 진행합니다 · '+money(PASSAGE_FIX.service.cr)+'</p>':
      passageButton('inspect','차단 상태 확인'));
  }else if(passageHere(PASSAGE_SERVICE)&&e?.stage==='inspect'){
    html=passageButton('service','배차실에서 정식 복구 · '+money(PASSAGE_FIX.service.cr));
  }else return '';
  return '<section class="pump-gauge" data-passage-panel><h3 tabindex="-1">생활권 통행 차단 시험</h3>'+html+'</section>';
}
function handlePassage(d){
  const now=Date.now();
  if(!writer||!isActive()||career.order!==PASSAGE_ORDER||d.raidId!==String(raid.startedAt)||now>=raid.endsAt||
     field.action||field.journey||field.open||field.contact)return;
  const owner=field,old=field.gateTest,plan=career.gateTest;
  if(d.step==='plan'){
    if(plan||!passageHere(PASSAGE_BOARDS[0])||!['0','1'].includes(d.from)||old?.from===Number(d.from))return;
    field.gateTest={stage:'plan',from:Number(d.from),raidId:raid.startedAt,at:now};
  }else{
    if(!plan||plan.receipt||raid.startedAt<=plan.raidId||raid.startedAt<plan.returnedAt||old?.fix)return;
    if(d.step==='inspect'&&!old&&passageHere(PASSAGE_BOARDS[plan.from])){
      field.gateTest={stage:'inspect',from:plan.from,raidId:raid.startedAt,at:now};
    }else if(old?.stage==='inspect'&&Object.hasOwn(PASSAGE_FIX,d.step)&&passageHere(d.step==='local'?PASSAGE_BOARDS[plan.from]:PASSAGE_SERVICE)){
      field.gateTest={...old,fix:d.step,fixedAt:now};
    }else return;
  }
  if(!writeSession()&&owner===field){if(old)field.gateTest=old;else delete field.gateTest;}
  renderKeep();$('[data-passage-panel] h3')?.focus?.({preventScroll:true});
}
function passageEventValid(e,stage,settled){
  if(!e||typeof e!=='object'||Array.isArray(e)||e.stage!==stage||![0,1].includes(e.from)||!Number.isSafeInteger(e.raidId)||e.raidId<=0)return false;
  const time=t=>Number.isSafeInteger(t)&&t>=e.raidId&&t<e.raidId+RAID_DURATION_MS&&t<=Date.now();
  if(!time(e.at)||Object.keys(e).some(k=>!['stage','from','raidId','at','fix','fixedAt','returnedAt','receipt'].includes(k)))return false;
  if(e.fix!==undefined||e.fixedAt!==undefined){
    if(stage!=='inspect'||!Object.hasOwn(PASSAGE_FIX,e.fix)||!time(e.fixedAt)||e.fixedAt<e.at)return false;
  }
  return settled?time(e.returnedAt)&&e.returnedAt>=(e.fixedAt??e.at):e.returnedAt===undefined&&e.receipt===undefined;
}
function passagePlanValid(p){
  if(!passageEventValid(p,'plan',true))return false;
  const r=p.receipt;
  return r===undefined||(passageEventValid(r,'inspect',true)&&r.fix!==undefined&&r.receipt===undefined&&r.from===p.from&&r.raidId>p.raidId&&r.raidId>=p.returnedAt);
}
function validPassageBackup(s){
  const c=s.career,p=c?.gateTest,f=s.field,e=f?.gateTest,active=c?.order===PASSAGE_ORDER,done=c?.done?.includes(PASSAGE_ORDER);
  if(p===undefined&&e===undefined&&!active&&!done)return true;
  if(!Array.isArray(c?.done)||!c.done.includes('stores')||(p!==undefined&&!passagePlanValid(p))||Boolean(done)!==Boolean(p?.receipt)||(done&&active))return false;
  if(p){
    const last=p.receipt||p,su=s.lastSummary;
    if(su?.raidId===last.raidId&&(su.rating!=='success'||su.elapsed!==last.returnedAt-last.raidId||
      (p.receipt?su.commission!==PASSAGE_FIX[last.fix].cr||su.missionXp!==PASSAGE_FIX[last.fix].xp||su.orderName!==ORDERS.find(o=>o.id===PASSAGE_ORDER).title:su.commission!==0)))return false;
  }
  if(active&&p&&!p.receipt&&!f?.result&&!e?.fix&&f?.journey?.from===p.from&&f.journey.to===1-p.from)return false;
  if(e===undefined)return true;
  if(!active||!s.raid||f.result||!e||e.raidId!==s.raid.startedAt||!Array.isArray(f.visited))return false;
  if(!p)return passageEventValid(e,'plan',false)&&f.visited.includes(0);
  return !p.receipt&&passageEventValid(e,'inspect',false)&&e.from===p.from&&e.raidId>p.raidId&&e.raidId>=p.returnedAt&&
    f.visited.includes(p.from)&&(e.fix!=='service'||f.visited.includes(PASSAGE_SERVICE.zone));
}
