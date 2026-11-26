// Route previews read public profile data. Only the current, resolved event is visible in transit.
function routeSeconds(ms) {
  return (ms / 1000).toLocaleString('ko-KR',{maximumFractionDigits:3})+'초';
}

function routeEnergyFacts(distance,mode) {
  const cost=TRAVEL_ENERGY_PER_STEP*distance;
  if (mode!=='live') return '<div><dt>이동 기력 소모</dt><dd data-route-energy>'+cost+'</dd></div>';

  // Project walking alone. Optional supplies, treatment and contact outcomes
  // depend on the player's next choices, so no upcoming rolls are inspected.
  let energy=field.energy, hp=field.hp, firstExhausted=0, fatalStep=0;
  for (let step=1;step<=distance;step++) {
    energy=Math.max(0,energy-TRAVEL_ENERGY_PER_STEP);
    const damage=exhaustionDamage(energy,field.water);
    if (damage && !firstExhausted) firstExhausted=step;
    hp=Math.max(0,hp-damage);
    if (!hp) {fatalStep=step;break;}
  }
  const energyRow='<div><dt>이동 기력</dt><dd data-route-energy>'+field.energy+' → '+energy+'</dd></div>';
  if (!firstExhausted) return energyRow;
  const effect=fatalStep?fatalStep+'칸째 전투 불능':firstExhausted+'칸째부터 체력 −'+(field.hp-hp)+' (합계)';
  return energyRow+'<div><dt>회복 없이 이동 시</dt><dd class="route-risk-high" data-route-exhaustion>'+effect+'</dd></div>';
}

function routeTripChance(perCellPercent, distance) {
  // Each leg gets its own roll at departure. These odds use only the public route profile.
  const none = (1 - perCellPercent / 100) ** distance;
  return (1 - none).toLocaleString('ko-KR', {style:'percent', maximumFractionDigits:1});
}

function routeDeadlineWarning(revealAt) {
  if (revealAt===null) return '';
  return '<p class="route-deadline" data-route-deadline="'+revealAt+'"'+
    (Date.now()<revealAt?' hidden':'')+'>작전 종료 전 도착할 수 없습니다.</p>';
}

function updateRouteDeadlineWarnings() {
  if (!raid || field.result || (page!=='map' && page!=='raid') || view!=='inside') return;
  const now=Date.now();
  for (const warning of document.querySelectorAll('[data-route-deadline]')) {
    const hidden=now<Number(warning.dataset.routeDeadline);
    if(warning.hidden!==hidden)warning.hidden=hidden;
  }
}

function routeObjectiveNote(objective,to) {
  if (!objective) return '';
  const matches = objective.locations.filter(loc=>loc.zone===to);
  const direct = matches.filter(loc=>!loc.possible);
  if (direct.length) {
    const landmarks = direct.filter(loc=>Number.isInteger(loc.landmark))
      .map(loc=>esc(LANDMARKS[to][loc.landmark].name)).join(' · ');
    return '<p class="route-pin" data-route-objective="target">'+commandIcon('pin')+
      '<span>도착지에 목표 지역'+(landmarks?' · '+landmarks:'')+'</span></p>';
  }
  if (!matches.length) return '';
  const names = [...new Set(matches.flatMap(loc=>loc.items||[]))].map(id=>esc(kitName(id)));
  return '<p class="route-pin" data-route-objective="candidate">'+commandIcon('pin')+
    '<span>도착지 수급 후보'+(names.length?' · '+names.join(', '):'')+'</span></p>';
}

function routeOption(profile,mode,objective) {
  const {from,to,name,distance,stepMs,clear,contact,supply,items}=profile;
  const adjusted=routeStepDuration(profile);
  const target=FIELD_ZONES[to].name;
  const needs=new Set((objective?.materials||[]).filter(m=>m.required>m.owned+m.field).map(m=>m.id));
  const candidateNames=items.map(({tpl})=>needs.has(tpl)
    ? '<span class="route-match">'+esc(kitName(tpl))+' <small>(목표 물품)</small></span>'
    : esc(kitName(tpl))).join(' · ');
  const riskClass=contact<=10?'low':contact<=20?'moderate':'high';
  const move=mode==='live'&&!field.journey&&!field.contact?
    '<button type="button" class="route-move" data-field="move" data-index="'+to+'" '+
      (field.action?'disabled ':'')+'aria-label="'+esc(name+' 경유 · '+target+'로 이동 시작')+'">'+target+'로 이동 <span aria-hidden="true">›</span></button>':'';
  return '<article class="route-card" data-route-card data-from="'+from+'" data-to="'+to+'">'+
    '<header><h3>'+esc(target)+'</h3><p>'+esc(name)+'</p></header>'+
    '<dl class="route-facts"><div><dt>이동</dt><dd data-route-time>'+routeTimeLabel(from,to)+'</dd></div>'+
    (adjusted===stepMs?'':'<div><dt>기본 시간</dt><dd>'+routeSeconds(stepMs*distance)+'</dd></div>')+
    '<div><dt>경로 전체 조우</dt><dd data-route-trip-risk>'+routeTripChance(contact,distance)+'</dd></div>'+
    '<div><dt>경로 전체 보급</dt><dd data-route-trip-supply>'+routeTripChance(supply,distance)+'</dd></div>'+
    '<div><dt>칸당 조우</dt><dd class="route-risk-'+riskClass+'" data-route-risk>'+contact+'%</dd></div>'+
    '<div><dt>칸당 보급</dt><dd data-route-supply>'+supply+'%</dd></div>'+
    '<div><dt>칸당 무사 통과</dt><dd data-route-clear>'+clear+'%</dd></div>'+routeEnergyFacts(distance,mode)+'</dl>'+
    '<div class="route-pool"><h4>길목 보급 후보</h4><p data-route-sources>'+candidateNames+'</p></div>'+
    routeObjectiveNote(objective,to)+routeDeadlineWarning(mode==='live'?raid.endsAt-adjusted*distance:null)+move+'</article>';
}

function focusRouteOverview() {
  const panel=$('[data-route-compare], [data-route-status]');
  if (!panel) return;
  markMapSection('#routes');
  panel.focus?.({preventScroll:true});
  panel.scrollIntoView?.({block:'start',inline:'nearest'});
}

function routeComparison(from,mode,objective) {
  const cards=FIELD_ZONES.map((_,to)=>{
    const profile=routeProfile(from,to);
    return profile?routeOption(profile,mode,objective):'';
  }).join('');
  return '<section id="routes" class="route-compare" data-route-compare tabindex="-1" data-from="'+from+'" aria-label="이동 경로 비교">'+
    '<header><h2>이동 경로 비교</h2><span>'+esc(FIELD_ZONES[from].name)+' 출발</span></header>'+
    '<p class="route-caption">경로 전체 확률은 모든 칸을 이동할 때 조우나 보급이 각각 한 번 이상 발생할 확률입니다. 이동 시간은 교전과 보급 선택 대기를 제외합니다.</p>'+
    '<div class="route-grid">'+cards+'</div>'+journeyFailureMarkup()+'</section>';
}

function routeStatusPanel() {
  const j=field.journey, timing=j&&journeyTiming(j);
  if (!timing) return '';
  const marked=j.event?j.done:j.done+1;
  const dots=Array.from({length:timing.total},(_,i)=>{
    const step=i+1, state=step===marked?'current':step<marked?'passed':'ahead';
    return '<span class="journey-dot '+state+'" aria-hidden="true">'+step+'</span>';
  }).join('');
  const arrival=timing.arrivalAt==null?null:new Date(timing.arrivalAt);
  const eta=arrival?'<time data-route-eta="'+timing.arrivalAt+'" datetime="'+arrival.toISOString()+'">'+
    arrival.toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})+'</time>':
    '<span data-route-paused>재개 후 계산</span>';
  const base=timing.baseStepMs;
  const price=timing.stepMs===base?'':' <small>(기본 '+routeSeconds(base)+')</small>';
  // A queued arrival has a fixed time. At a decision the moving clock is paused;
  // a combat timer already in progress must finish before movement can resume.
  const threshold=raid.endsAt-timing.remainingMs;
  const revealAt=arrival ? (timing.arrivalAt>=raid.endsAt?0:null) :
    (field.action && field.action.end>=threshold?0:threshold);
  const situation=j.event==='contact'?'조우 대응 중':j.event==='supply'?'보급 선택 중':'이동 중';
  const waitNote=timing.remainingMs?'대응이 끝나면 남은 이동 '+routeSeconds(timing.remainingMs)+'를 이어갑니다.':'대응이 끝나면 목적지에 도착합니다.';
  return '<section id="routes" class="journey-track route-status" data-route-status tabindex="-1" data-from="'+j.from+'" data-to="'+j.to+
    '" aria-label="진행 중인 경로"><header><h2>'+esc(timing.name)+'</h2><span>'+situation+'</span></header>'+
    '<div class="journey-endpoints"><b>'+esc(FIELD_ZONES[j.from].name)+'</b><span class="journey-dots">'+dots+
    '</span><b>'+esc(FIELD_ZONES[j.to].name)+'</b></div>'+
    '<dl class="route-status-times"><div><dt>통과한 칸</dt><dd>'+j.done+' / '+timing.total+'</dd></div>'+
    '<div><dt>칸당 이동</dt><dd>'+routeSeconds(timing.stepMs)+price+'</dd></div>'+
    '<div><dt>도착 예상</dt><dd>'+eta+'</dd></div></dl>'+
    '<p class="route-caption">'+(timing.paused?waitNote:
    '조우·보급 대기가 생기면 도착 예상 시각이 늦어집니다.')+'</p>'+
    routeDeadlineWarning(revealAt)+(page==='map'?'':'<button type="button" data-page="map">작전 지도</button>')+journeyFailureMarkup()+'</section>';
}
