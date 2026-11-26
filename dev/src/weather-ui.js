// Map, departure and field read the same regional window as a newly started scan.
const weatherTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone:'Asia/Seoul', hourCycle:'h23', hour:'2-digit', minute:'2-digit', second:'2-digit'
});
const weatherIcons = {
  clear:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  fog:'<path d="M3 7h13m3 0h2M6 12h15M2 17h4m3 0h10"/>',
  rain:'<path d="M6 14a4 4 0 0 1 .3-8 5.4 5.4 0 0 1 10.5.3A3.8 3.8 0 1 1 18 14H6ZM8 17l-1.5 3m6-3-1.5 3m6-3-1.5 3"/>'
};
function weatherTime(at,clock=false){
  return '<time datetime="'+new Date(at).toISOString()+'"'+(clock?' data-weather-clock':'')+'>'+weatherTimeFormat.format(at)+'</time>';
}
function weatherZoneAttributes(f){
  return 'data-weather-zone="'+f.zone+'" data-condition="'+f.id+'" data-starts-at="'+f.startsAt+'" data-next-at="'+f.endsAt+
    '" data-scan-ms="'+f.scanMs+'" data-next-condition="'+f.nextId+'" data-next-scan-ms="'+f.nextScanMs+'"';
}
function weatherIcon(id){
  return '<svg class="wx-icon" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round">'+weatherIcons[id]+'</svg>';
}
function weatherReadout(f){
  return '<div class="wx-now">'+weatherIcon(f.id)+
    '<strong data-weather-current>'+esc(f.label)+'</strong><span>주변 탐색 <b data-weather-duration>'+routeSeconds(f.scanMs)+'</b></span></div>'+
    '<dl class="wx-times"><div><dt>적용 시간</dt><dd>'+weatherTime(f.startsAt)+' – '+weatherTime(f.endsAt)+'</dd></div>'+
    '<div><dt>다음 예보</dt><dd><b data-weather-next>'+esc(f.nextLabel)+'</b> · 탐색 '+routeSeconds(f.nextScanMs)+'</dd></div></dl>';
}
function weatherZoneButton(z,selected){
  const chosen=z===selected;
  return '<button type="button" class="wx-choose" data-cui="weather-select" data-index="'+z+'" aria-pressed="'+chosen+
    '" aria-label="'+esc(FIELD_ZONES[z].name)+' 권역 선택">'+(chosen?'선택한 권역':'권역 선택')+'</button>';
}
function weatherBoard(selected){
  const now=Date.now();
  const cards=FIELD_ZONES.map((zoneDef,z)=>{
    const f=weatherForecast(z,now);
    return '<article class="wx-card" '+weatherZoneAttributes(f)+'><h3>'+esc(zoneDef.name)+'</h3>'+
      '<div data-weather-readout>'+weatherReadout(f)+'</div>'+surveyCardHint(z,f)+weatherZoneButton(z,selected)+'</article>';
  }).join('');
  return '<section class="wx-board" data-weather-board tabindex="-1" aria-label="권역별 기상 예보"><header>'+
    '<h2>권역별 기상 예보</h2><span class="wx-clock">작전 시각 (KST) '+weatherTime(now,true)+'</span></header>'+
    '<p>장비·시설·부상 보정을 포함한 주변 탐색 시간입니다. 날씨는 2분마다 바뀝니다.</p>'+
    '<div class="wx-grid">'+cards+'</div>'+
    (!raid?'<button type="button" class="wx-deploy" data-page="prep" data-weather-deploy>'+esc(FIELD_ZONES[selected].name)+' 출격 준비</button>':'')+
    '<span class="sr" role="status" data-weather-notice></span></section>';
}
function weatherBrief(mode,z){
  const now=Date.now(),f=weatherForecast(z,now);
  const fieldMode=mode==='field';
  const context=fieldMode?(field.journey?'출발지 기상':'현장 기상'):'투입지 예보';
  const a=fieldMode&&field.action?.type==='scan'?field.action:null;
  const pending=a?'<p class="wx-action" data-weather-action data-start="'+a.start+'" data-end="'+a.end+
    '">진행 중 탐색 <b>'+routeSeconds(a.end-a.start)+'</b> · '+weatherTime(a.end)+' 완료 예정</p>':'';
  return '<section class="wx-brief" data-weather-'+mode+' '+weatherZoneAttributes(f)+' aria-label="'+context+'"><header>'+
    '<h2>'+context+' · '+esc(FIELD_ZONES[z].name)+'</h2><span class="wx-clock">작전 시각 (KST) '+weatherTime(now,true)+'</span></header>'+
    '<div data-weather-readout>'+weatherReadout(f)+'</div>'+pending+
    '<button type="button" class="wx-map-link" data-cui="forecast">세 권역 예보 비교</button>'+
    '<span class="sr" role="status" data-weather-notice></span></section>';
}
function focusWeatherBoard(){
  if(page!=='map')navigatePage('map');
  const board=$('[data-weather-board]');
  board?.focus?.({preventScroll:true});
  const content=$('.content');
  if(board?.getBoundingClientRect&&content?.getBoundingClientRect){
    content.scrollTop+=board.getBoundingClientRect().top-content.getBoundingClientRect().top-8;
  }
}
let weatherPaintSecond=null;
function tickWeatherUI(){
  if(rendering||view!=='inside'||!['prep','map','raid'].includes(page))return;
  const now=Date.now(),second=Math.floor(now/1000);
  if(second===weatherPaintSecond)return;
  weatherPaintSecond=second;
  for(const clock of document.querySelectorAll('[data-weather-clock]')){
    clock.dateTime=new Date(now).toISOString();
    clock.textContent=weatherTimeFormat.format(now);
  }
  for(const card of document.querySelectorAll('[data-weather-zone]')){
    if(now>=Number(card.dataset.startsAt)&&now<Number(card.dataset.nextAt))continue;
    const f=weatherForecast(Number(card.dataset.weatherZone),now);
    Object.assign(card.dataset,{condition:f.id,startsAt:f.startsAt,nextAt:f.endsAt,scanMs:f.scanMs,nextCondition:f.nextId,nextScanMs:f.nextScanMs});
    card.querySelector('[data-weather-readout]').innerHTML=weatherReadout(f);
    const board=card.closest('[data-weather-board]');
    const surveySite=card.querySelector('[data-survey-site]');
    if(surveySite)surveySite.outerHTML=surveyCardHint(f.zone,f);
    if(!board||card.querySelector('[aria-pressed="true"]')){
      const live=(board||card).querySelector('[data-weather-notice]');
      if(live)live.textContent=FIELD_ZONES[f.zone].name+' 기상 변경 · '+f.label+' · 주변 탐색 '+routeSeconds(f.scanMs);
    }
    if(card.hasAttribute('data-weather-field')){
      refreshSurveyStation(f);
      const label=document.querySelector('[data-field="scan"] small');
      if(label)label.textContent=routeSeconds(f.scanMs);
    }
  }
}
function weatherFocusSelector(){
  const node=document.activeElement;
  if(node?.matches?.('[data-weather-board]'))return '[data-weather-board]';
  if(node?.matches?.('[data-weather-deploy]'))return '[data-weather-deploy]';
  if(node?.matches?.('[data-cui="weather-select"]')&&FIELD_ZONES[Number(node.dataset.index)]){
    return '[data-cui="weather-select"][data-index="'+Number(node.dataset.index)+'"]';
  }
  if(node?.matches?.('[data-cui="forecast"]')){
    const area=node.closest('[data-weather-prep], [data-weather-field], .command-brief');
    if(area)return (area.matches('.command-brief')?'.command-brief':area.hasAttribute('data-weather-prep')?'[data-weather-prep]':'[data-weather-field]')+' [data-cui="forecast"]';
  }
  return null;
}

const SURVEY_MARKS=['울타리 끝의 거리표','차량 행렬 끝의 정지 표지판','맞은편 하역장의 흰 경계선'];
function surveySight(zone,condition){
  const target=SURVEY_MARKS[zone];
  return condition==='clear'?target+'의 테두리가 뚜렷합니다.':condition==='fog'?target+'의 윤곽만 보입니다.':target+' 앞으로 빗줄기가 지나갑니다.';
}
function surveyStationName(zone){return LANDMARKS[zone][SURVEY_STATIONS[zone].landmark].name;}
function surveyCardHint(zone,forecast){
  if(career.order!==WEATHER_SURVEY_ORDER||field.result)return '';
  const rows=surveyObservations(),taken=rows.find(row=>row.zone===zone);
  const status=taken?regionalWeather(zone,taken.at).label+' 기록 완료':rows.length===2?'관측 완료':
    SURVEY_CONDITIONS.includes(forecast.id)&&!rows.some(row=>row.condition===forecast.id)?'지금 '+forecast.label+' 관측 가능':'다음 예보 확인';
  return '<p data-survey-site>시정 관측지 · '+esc(surveyStationName(zone))+' · '+esc(status)+'</p>';
}
function surveyReadingPanel(){
  if(career.order!==WEATHER_SURVEY_ORDER||!raid||field.result||field.landmarkByZone?.[raid.zone]!==SURVEY_STATIONS[raid.zone].landmark)return '';
  const z=raid.zone,f=weatherForecast(z),rows=surveyObservations(),reason=surveyEligibility(z,f,rows);
  const previous=rows.map(row=>esc(FIELD_ZONES[row.zone].name)+' · '+esc(regionalWeather(row.zone,row.at).label)+' · '+weatherTime(row.at)).join('<br>');
  const feedback=weatherSurveyNotice?.raidId===raid.startedAt&&weatherSurveyNotice.zone===z&&weatherSurveyNotice.window===f.startsAt?weatherSurveyNotice.text:'';
  return '<section class="pump-gauge" data-survey-station="'+z+'"><h3>시정 관측소 · '+esc(surveyStationName(z))+'</h3>'+
    '<p>현재 시정 <b data-survey-condition>'+esc(f.label)+'</b> · <span data-survey-sight>'+esc(surveySight(z,f.id))+'</span></p>'+
    (previous?'<p data-survey-log>'+previous+'</p>':'')+
    '<div class="pump-controls"><button data-field="survey-observe" data-zone="'+z+'" data-raid-id="'+raid.startedAt+'" data-window="'+f.startsAt+'" '+(reason||field.action||!writer?'disabled':'')+'>현재 시정 기록</button>'+
    '<button type="button" data-cui="forecast">다른 권역 예보 보기</button></div>'+
    '<p data-survey-status role="status" tabindex="-1">'+esc(feedback||reason)+'</p></section>';
}
function refreshSurveyStation(f){
  const panel=document.querySelector('[data-survey-station]');
  if(!panel||panel.dataset.surveyStation!==String(f.zone))return;
  const button=panel.querySelector('[data-field="survey-observe"]');
  const reason=surveyEligibility(f.zone,f,surveyObservations());
  panel.querySelector('[data-survey-condition]').textContent=f.label;
  panel.querySelector('[data-survey-sight]').textContent=surveySight(f.zone,f.id);
  panel.querySelector('[data-survey-status]').textContent=reason;
  button.dataset.window=String(f.startsAt);
  button.disabled=Boolean(reason||field.action||!writer);
}
