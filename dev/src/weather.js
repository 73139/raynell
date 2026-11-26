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
