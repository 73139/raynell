// Map geometry follows the three roads on the B-04 survey sheet.
const COMMAND_ZONES = [
  { short:'외곽', art:'zone-outer', icon:'outpost', x:156, y:103 },
  { short:'검문소', art:'zone-checkpoint', icon:'barrier', x:607, y:117 },
  { short:'군수 창고', art:'zone-depot', icon:'depot', x:375, y:405 }
];
const COMMAND_ROADS = [
  {from:0,to:1,road:'M156 103 C245 100 279 125 385 118 S513 119 607 117',cells:[[385,118]]},
  {from:1,to:2,road:'M607 117 C578 172 562 196 538 226 S514 257 493 288 L375 405',cells:[[538,226],[493,288]]},
  {from:0,to:2,road:'M156 103 C170 135 188 163 202 186 S232 230 246 250 L290 312 L375 405',cells:[[202,186],[246,250],[290,312]]}
];
let commandInspection = null;

function commandIcon(name){
  const shapes={
    forward:'<path d="m4 5 8 7-8 7m9-14 8 7-8 7"/>',
    trade:menuIcons.trade,
    gear:'<path d="M4 13a8 8 0 0 1 16 0v2h-3l-1 4H8l-1-4H4zM5 13h14"/>',
    home:'<path d="m2 11 10-8 10 8M5 10v11h5v-7h4v7h5V10"/>',
    settings:'<path d="m9 3 1-1h4l1 3 3 1 3 1 1 4-2 2 1 3-2 3h-3l-2 3h-4l-2-3H5l-2-3 1-3-2-2 1-4 3-1 3-1z"/><circle cx="12" cy="12" r="3"/>',
    outpost:'<path d="m2 11 10-8 10 8-2 1v9h-6v-7h-4v7H4v-9z"/><path d="M17 5h2v4"/>',
    barrier:'<path d="M3 7h18v7H3zM4 14v7m16-7v7M4 12l4-4m1 5 5-5m0 5 5-5"/>',
    depot:'<path d="m2 7 10-5 10 5v11l-10 5-10-5zM2 7l10 5 10-5M12 12v11M5 6l10 5m-6-7 10 5M4 11l6 3m-6 0 6 3m4-3 6-3m-6 6 6-3"/>',
    pin:'<path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
    diamond:'<path d="m12 3 9 9-9 9-9-9z"/>'
  };
  return '<svg viewBox="0 0 24 24" class="cmd-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">'+shapes[name]+'</svg>';
}

function commandHome(){
  const phase=raidPhase();
  const deploy=phase==='idle'?['map','레이드 출격']:['raid',phase==='active'?'현장으로 복귀':'작전 결과 확인'];
  const menu=[[...deploy,'forward'],['inventory','대원 장비','gear'],['trade','벙커 상점','trade'],['bunker','하이드아웃','home'],['settings','설정','settings']];
  return `<section class="command-home" aria-label="작전 단말" style="--cmd-room:url('${artURL('command-room')}')">
    <div class="command-console"><h1 class="command-brand" lang="en"><span>RUSTLINE</span><small>PROTOCOL</small></h1>
      <div class="command-menu">${menu.map(([target,label,icon],i)=>`<button type="button" class="command-nav${i===0?' command-nav-main':''}" data-page="${target}">${commandIcon(icon)}<span>${label}</span></button>`).join('')}</div>
    </div>
    <div class="command-status"><span>작전 단말</span><span>B-04 연결됨</span><button type="button" class="rc-home-link" data-page="campaign">벙커 복구 캠페인</button><span class="command-signal"><i aria-hidden="true"></i>B-04 벙커망</span></div>
  </section>`;
}

function commandZoneSelection(){
  if(!raid)return zone;
  if(commandInspection?.raidId===raid.startedAt && commandInspection.origin===raid.zone)return commandInspection.index;
  return field?.journey?.to??raid.zone;
}

function handleCommandUI(d){
  if(d.cui==='routes')return focusRouteOverview();
  if(d.cui==='forecast')return focusWeatherBoard();
  if(d.cui!=='inspect'&&d.cui!=='weather-select')return;
  const index=Number(d.index);
  if(!Number.isInteger(index)||!COMMAND_ZONES[index])return;
  if(raid)commandInspection={raidId:raid.startedAt,origin:raid.zone,index};
  else{commandInspection=null;zone=index;save()}
  renderKeep();
  const control=d.cui==='weather-select'?'[data-cui="weather-select"]':'.command-station';
  $(control+'[data-index="'+index+'"]')?.focus?.({preventScroll:true});
}

function commandRoads(){
  const journey=isActive()?field.journey:null;
  return COMMAND_ROADS.map(({from,to,road,cells})=>{
    const forward=journey?.from===from&&journey.to===to;
    const reverse=journey?.from===to&&journey.to===from;
    const active=forward||reverse;
    const pips=cells.map(([x,y],i)=>{
      const step=reverse?cells.length-i:i+1;
      const current=active&&step===(journey.event?journey.done:journey.done+1);
      const passed=active&&step<=journey.done;
      return `<circle class="cmd-pip${current?' current':''}${passed?' passed':''}" cx="${x}" cy="${y}" r="5.4"/>`;
    }).join('');
    return `<g class="command-road${active?' active':''}" data-distance="${cells.length}"><path d="${road}"/>${pips}</g>`;
  }).join('');
}

function commandPassage(){
  const plan=career.gateTest;
  if(career.order!==PASSAGE_ORDER||!plan||plan.receipt||raid&&!isActive())return null;
  const from=plan.from,to=1-from,open=Boolean(raid&&field.gateTest?.fix);
  return {open,label:COMMAND_ZONES[from].short+' → '+COMMAND_ZONES[to].short+(open?' 개통':' 차단'),
    legend:open?'직통 '+routeDistance(from,to)+'칸 통행 재개 · 정상 귀환 시 복구 수당 지급':
      '역방향 이용 가능 · 군수 창고 경유 '+(routeDistance(from,2)+routeDistance(2,to))+'칸 · '+passageSpot(PASSAGE_BOARDS[from])+'에서 차단 확인'};
}
function commandMapPlot(selected,objective,passage){
  const stations=COMMAND_ZONES.map(({short,icon,x,y},i)=>{
    const here=isActive()&&raid.zone===i&&!field.journey;
    const marker=objective?objectiveLocationLabel(objective.locations,i):'';
    return `<button type="button" class="command-station" data-cui="inspect" data-index="${i}" style="left:${x/774*100}%;top:${y/507*100}%" aria-label="${FIELD_ZONES[i].name}${here?' · 현재 위치':''}${marker?' · '+marker:''}" aria-pressed="${i===selected}" ${here?'aria-current="location"':''}>
      <span class="station-reticle">${commandIcon(icon)}</span><b>${short}</b>${marker?'<em class="obj-map-match">'+marker+'</em>':''}${here?'<small>현재 위치</small>':''}
    </button>`;
  }).join('');
  return `<div class="command-map-chart" style="background-image:url('${artURL('map-terrain')}')" role="group" aria-label="B-04 작전 지도 · 작은 원 하나는 이동 거리 1칸">
    <svg class="command-roads" viewBox="0 0 774 507" preserveAspectRatio="none" aria-hidden="true">${commandRoads()}</svg>${stations}
    ${passage?'<span class="command-passage" data-passage-map="'+(passage.open?'open':'closed')+'">'+esc(passage.label)+'</span>':''}
  </div>`;
}

function commandMapAction(selected){
  const phase=raidPhase();
  if(phase==='idle')return '<button class="command-deploy" data-page="prep">'+commandIcon('forward')+'출격 준비</button>';
  if(phase==='expired')return '<button class="command-deploy" data-page="raid">작전 결과 확인</button>';
  if(field.journey||field.contact||field.action||raid.zone===selected)return '<button class="command-deploy" data-page="raid">'+commandIcon('forward')+(field.contact?'조우 상황 보기':field.journey?'이동 상황 보기':'현장으로 복귀')+'</button>';
  if(passageClosed(raid.zone,selected))return '<button class="command-deploy" disabled>시험 차단 · 군수 창고 경유 가능</button>';
  return `<button class="command-deploy" data-field="move" data-index="${selected}">${commandIcon('forward')}이동 시작 · ${routeTimeLabel(raid.zone,selected)}</button>`;
}

function surveyMapJournal(zone){
  const logged=new Set(career.surveyedBoxes||[]),area=FIELD_ZONES[zone];
  const total=area.boxes.length,done=area.boxes.reduce((n,_,i)=>n+Number(logged.has(boxKey(zone,i))),0);
  const rows=LANDMARKS[zone].map(point=>{
    const boxes=point.boxes.map(index=>{
      const key=boxKey(zone,index),recorded=logged.has(key);
      const lock=lootLockView(zone,index);
      const access=!lock?'':lock.unlocked?'이번 출격 개방':esc(lock.keyName)+(lock.carried?' · 휴대 중':' 필요');
      return '<li data-survey-box="'+key+'" data-recorded="'+recorded+'"><span>'+esc(area.boxes[index][0])+
        (access?'<small class="survey-access">'+access+'</small>':'')+'</span><span>'+(recorded?'기록 완료':'미기록')+'</span></li>';
    }).join('');
    return '<li><h3>'+esc(point.name)+'</h3><ul>'+boxes+'</ul></li>';
  }).join('');
  return '<details class="survey-map-journal" data-survey-journal="'+zone+'"><summary>'+esc(area.name)+' 수색 수첩 · '+done+' / '+total+'개</summary>'+
    '<p>상자를 끝까지 수색하고 생환하면 기록됩니다. 같은 상자를 다시 조사해도 한 곳으로 셉니다.</p><ul class="survey-sites">'+rows+'</ul></details>';
}

function sectorMapPage(){
  const objective=resolveObjective();
  const selected=commandZoneSelection(),meta=COMMAND_ZONES[selected],area=FIELD_ZONES[selected];
  const journey=isActive()?field.journey:null;
  const origin=isActive()?raid.zone:selected;
  const passage=commandPassage();
  const legend=passage?esc(passage.legend):journey?'이동 중인 경로가 지도에 표시됩니다.':isActive()?'권역을 누르면 해당 지역의 정보를 볼 수 있습니다.':'지도에서 출격할 권역을 선택하세요.';
  const brief=raid&&!isActive()?'':'<button type="button" class="cmd-route-choice route-overview-link" data-cui="routes">'+
    commandIcon('diamond')+'<span>'+(journey?'경로 시간 보기':'이동 경로 비교')+'</span><b aria-hidden="true">↓</b></button>';
  const compare=journey?routeStatusPanel():(!raid||isActive()?routeComparison(origin,raid?'live':'preview',objective):'');
  return `<h1 class="command-page-title"><span>02</span> 작전 지도</h1><section class="command-map" aria-label="작전 지도">
    <div class="command-map-left">${commandMapPlot(selected,objective,passage)}<p class="command-key"><i aria-hidden="true"></i>${legend}</p></div>
    <section class="command-brief" aria-label="선택한 권역">
      <div class="command-postcard"><img src="${artURL(meta.art)}" alt="${area.name} 전경"></div>
      <h2>${commandIcon('forward')}${area.name}</h2>
      <div class="command-route-info"><div>${commandIcon('pin')}<span>랜드마크</span><b>${LANDMARKS[selected].length}곳</b></div><button type="button" class="cmd-route-choice route-overview-link" data-cui="forecast">${weatherIcon('clear')}<span>권역별 기상 예보</span><b aria-hidden="true">↓</b></button>${brief}</div>
      ${commandMapAction(selected)}
    </section>
  </section>${weatherBoard(selected)}${surveyMapJournal(selected)}${dockPlan(selected)}${lootPlanLink(selected)}${survivorNavLink()}${compare}${objectivePanel('map',objective)}`;
}
