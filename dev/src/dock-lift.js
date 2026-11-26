// The permanent notebook earns an extra exit on future departures; the assigned list belongs to the sortie.
const DOCK_SURVEYS=['2-3','2-4','2-8'];
const DOCK_LIFT_LIMIT=4000;
function dockAccess(keys){return Array.isArray(keys)&&DOCK_SURVEYS.every(key=>keys.includes(key));}
function dockWeight(grams){return (grams/1000).toFixed(3)+' kg';}
function dockAtPlatform(sortie=field,current=raid){return current?.zone===2&&sortie.landmarkByZone?.[2]===1;}
function dockStatus(){
  if(!writer)return '플레이 중인 탭에서 탑승하세요';
  if(!dockAtPlatform())return '군수 창고 하역 도크에서 탑승';
  const mass=kitBagGrams(field.bag);
  return mass>DOCK_LIFT_LIMIT?'화물 '+dockWeight(mass-DOCK_LIFT_LIMIT)+' 초과':'';
}
function dockPlan(zone){
  if(zone!==2)return '';
  const keys=career.surveyedBoxes||[],count=DOCK_SURVEYS.filter(key=>keys.includes(key)).length;
  const rows=DOCK_SURVEYS.map(key=>{
    const {index,name}=surveySite(key),site=LANDMARKS[2].find(place=>place.boxes.includes(index));
    return '<li data-dock-survey="'+key+'">'+esc(site.name)+' · '+esc(name)+' — '+(keys.includes(key)?'생환 기록 완료':'미기록')+'</li>';
  }).join('');
  const eligible=dockAccess(keys);
  const status=raid&&!field.result?(field.exits.includes('lift')?'이번 출격 배정':'이번 출격 미배정'):
    eligible?'다음 출격부터 상시 배정':'세 상자를 끝까지 수색하고 생환하면 다음 출격부터 배정';
  return '<details class="survey-map-journal" data-dock-plan><summary>하역 도크 화물 리프트 · 수색 기록 '+count+' / 3</summary>'+
    '<p data-dock-status>'+status+'</p><ul>'+rows+'</ul><p>'+esc(exitBy('lift').desc)+' · 대기 '+exitBy('lift').sec+'초</p></details>';
}
function dockLoadPanel(){
  const mass=kitBagGrams(field.bag);
  const option=mass>DOCK_LIFT_LIMIT?(dockAtPlatform()?'':dockWeight(mass-DOCK_LIFT_LIMIT)+' 초과 · ')+'가방 물품을 이 지역 바닥에 내려놓거나 다른 배정 탈출구를 이용하세요.':'남은 화물 여유 '+dockWeight(DOCK_LIFT_LIMIT-mass);
  return '<p data-dock-load>현재 가방 '+dockWeight(mass)+' / '+dockWeight(DOCK_LIFT_LIMIT)+' · '+option+'</p>'+
    (mass>DOCK_LIFT_LIMIT?'<button type="button" data-page="inventory">가방 열기</button>':'');
}
function dockReceipt(row){
  return Number.isSafeInteger(row?.liftGrams)?'<p data-dock-receipt><b>화물 리프트 인수 중량</b> '+dockWeight(row.liftGrams)+' · 가방 내용물</p>':'';
}
function validDockReceipt(row,rating){
  if(!row)return true;
  const lift=row.exit===exitBy('lift').name;
  if(!lift)return row.liftGrams===undefined;
  return ['quick','success'].includes(rating)&&Number.isSafeInteger(row.liftGrams)&&row.liftGrams>=0&&row.liftGrams<=DOCK_LIFT_LIMIT;
}
function validDockBackup(s){
  const r=s.raid,f=s.field,summary=s.lastSummary,store=s.career?.surveyedBoxes;
  const hasLift=Array.isArray(f?.exits)&&f.exits.includes('lift');
  const receipt=summary?.liftGrams!==undefined,active=f?.action?.type==='extract'&&f.action.exit==='lift';
  if(!validDockReceipt(summary,summary?.rating))return false;
  if(!hasLift&&!active&&!receipt)return true;
  if(!dockAccess(store))return false;
  if(hasLift&&(!r||f.exits.filter(id=>id==='lift').length!==1))return false;
  if(active){
    const a=f.action;
    if(!hasLift||!dockAtPlatform(f,r)||!Array.isArray(f.bag)||f.bag.some(u=>!u||!Object.hasOwn(GOODS,u.g)||
      (u.gear?.module&&!Object.hasOwn(GOODS,u.gear.module)))||kitBagGrams(f.bag)>DOCK_LIFT_LIMIT||
      f.result||f.contact||f.journey||a.end-a.start!==exitBy('lift').sec*1000||a.start<r.startedAt||a.end>=r.endsAt)return false;
  }
  if(r&&summary?.raidId===r.startedAt){
    if(hasLift&&summary.newSurveyBoxes?.some(key=>DOCK_SURVEYS.includes(key)))return false;
    if(receipt&&(!hasLift||!dockAtPlatform(f,r)||f.result!=='success'))return false;
  }
  return true;
}
