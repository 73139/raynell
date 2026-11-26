// The terminal and the field use the same game clock. A slot is [startsAt, endsAt).
const WEATHER_SLOT_MS = 120000;
const WEATHER_STATES = [
  {id:'clear',label:'맑음',scanFactor:1},
  {id:'fog',label:'안개',scanFactor:1.5},
  {id:'rain',label:'강우',scanFactor:1.25}
];

function regionalWeather(region, at) {
  const slot = Math.floor(at / WEATHER_SLOT_MS);
  const count = WEATHER_STATES.length;
  const index = ((slot + region) % count + count) % count;
  return WEATHER_STATES[index];
}

function weatherForecast(region, at=Date.now()) {
  const startsAt = Math.floor(at / WEATHER_SLOT_MS) * WEATHER_SLOT_MS;
  const endsAt = startsAt + WEATHER_SLOT_MS;
  const current = regionalWeather(region, at);
  const next = regionalWeather(region, endsAt);
  return {
    zone:region, id:current.id, label:current.label, scanFactor:current.scanFactor, startsAt, endsAt,
    nextId:next.id, nextLabel:next.label,
    scanMs:actionDuration('scan',4000,at,region),
    nextScanMs:actionDuration('scan',4000,endsAt,region)
  };
}

// The visibility survey uses the same regional clock that sets scouting times.
const WEATHER_SURVEY_ORDER='weather-survey';
const SURVEY_STATIONS=[{zone:0,landmark:9},{zone:1,landmark:6},{zone:2,landmark:1}];
const SURVEY_CONDITIONS=['clear','fog'];
let weatherSurveyNotice=null;
function validWeatherSurvey(raidState,sortie,order,now=Date.now()){
  const record=sortie?.weatherSurvey;
  if(record===undefined)return true;
  if(!record||!raidState||sortie.result||sortie.raidId!==raidState.startedAt||
      order!==WEATHER_SURVEY_ORDER||record.raidId!==raidState.startedAt||
      !Array.isArray(sortie.visited)||!Array.isArray(record.observations)||
      record.observations.length<1||record.observations.length>SURVEY_CONDITIONS.length)return false;
  const zones=new Set(),conditions=new Set();
  let lastAt=raidState.startedAt;
  for(const row of record.observations){
    if(!row||!Number.isInteger(row.zone)||!SURVEY_STATIONS[row.zone]||
        row.landmark!==SURVEY_STATIONS[row.zone].landmark||!sortie.visited.includes(row.zone)||
        !Number.isSafeInteger(row.at)||(row.at<lastAt||(zones.size>0&&row.at===lastAt))||row.at>=raidState.endsAt||row.at>now||
        !SURVEY_CONDITIONS.includes(row.condition)||regionalWeather(row.zone,row.at).id!==row.condition||
        zones.has(row.zone)||conditions.has(row.condition))return false;
    lastAt=row.at;zones.add(row.zone);conditions.add(row.condition);
  }
  return true;
}
function surveyObservations(){
  return field.weatherSurvey && validWeatherSurvey(raid,field,career.order)?field.weatherSurvey.observations:[];
}
function surveyEligibility(zone,forecast,records){
  if(records.length===SURVEY_CONDITIONS.length)return '두 관측을 마쳤습니다. 정상 탈출하면 관측 수당을 받습니다.';
  if(records.some(row=>row.zone===zone))return '이미 기록한 권역입니다. 다른 권역의 관측소를 선택하세요.';
  if(forecast.id==='rain')return '빗줄기가 거리 표식을 가려 안개의 영향을 가늠하기 어렵습니다. 맑음·안개가 예보된 다음 시각이나 다른 권역을 선택하세요.';
  if(records.some(row=>row.condition===forecast.id))return '이미 기록한 날씨입니다. 남은 날씨의 예보를 확인하세요.';
  return '';
}
function handleWeatherObservation(d){
  const at=Date.now();
  if(!writer||!isActive()||career.order!==WEATHER_SURVEY_ORDER||String(raid.startedAt)!==d.raidId||
      at<raid.startedAt||at>=raid.endsAt||field.action||field.journey||field.open||field.contact)return;
  const zone=raid.zone,station=SURVEY_STATIONS[zone];
  if(d.zone!==String(zone)||field.landmarkByZone?.[zone]!==station.landmark||!field.visited?.includes(zone))return;
  const forecast=weatherForecast(zone,at),observations=surveyObservations();
  if(observations.length && at<=observations.at(-1).at)return;
  const stale=d.window!==String(forecast.startsAt);
  const reason=stale?'예보가 바뀌었습니다. 현재 시정을 확인해 다시 기록하세요.':surveyEligibility(zone,forecast,observations);
  if(reason){weatherSurveyNotice={raidId:raid.startedAt,zone,window:forecast.startsAt,text:reason};renderKeep();return;}
  const owner=field,previous=field.weatherSurvey;
  const observation={zone,landmark:station.landmark,condition:forecast.id,at};
  field.weatherSurvey={raidId:raid.startedAt,observations:[...observations,observation]};
  weatherSurveyNotice=null;
  if(!writeSession()&&field===owner){
    if(previous)field.weatherSurvey=previous;else delete field.weatherSurvey;
    weatherSurveyNotice={raidId:raid.startedAt,zone,window:forecast.startsAt,text:'관측을 저장하지 못했습니다. 다시 기록하세요.'};
  }
  renderKeep();$('[data-survey-status]')?.focus?.({preventScroll:true});
}
