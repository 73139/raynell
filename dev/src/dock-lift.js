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
    '<p data-dock-status>'+status+'</p><ul>'+rows+'</ul><p>'+esc(exitBy('lift').desc)+' · 대기 '+exitBy('lift').sec+'초</p>'+
    (eligible&&!raid?'<p data-dock-kit>출격 준비 가방 '+dockCapacityText(kitBagGrams(equipmentState.bag))+'</p>':'')+'</details>';
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

function dockCapacityText(grams){
  const delta=DOCK_LIFT_LIMIT-grams;
  return dockWeight(grams)+' / '+dockWeight(DOCK_LIFT_LIMIT)+' · '+dockWeight(Math.abs(delta))+(delta<0?' 초과':' 여유');
}
function dockPackLabel(unit){
  const name=unit.g==='cr_notes'?money(unit.amount)+' 지폐':kitName(unit.g);
  return name+' · 가방 '+(unit.y+1)+'행 '+(unit.x+1)+'열';
}
let dockManifestKit=null;
function dockPrepManifest(kit,zoneId){
  if(raid||zoneId!==2||!dockAccess(career.surveyedBoxes))return '';
  dockManifestKit=kit;
  const grams=kitBagGrams(kit.bag);
  const rows=kit.bag.slice().sort((a,b)=>kitUnitGrams(b)-kitUnitGrams(a)||a.y-b.y||a.x-b.x).map(unit=>{
    const label=esc(dockPackLabel(unit)),uid=esc(unit.uid);
    return '<li><label><input type="checkbox" data-dock-omit="'+uid+'"><span>'+label+'<small>'+esc(kitUnitMassText(unit))+'</small></span></label>'+
      '<button type="button" data-loadout="dock-review" data-uid="'+uid+'" aria-label="'+label+' 가방에서 보기">가방에서 보기</button></li>';
  }).join('');
  return '<details class="gm-readiness dock-manifest" data-dock-manifest><summary>출격 전 화물 리프트 · '+dockCapacityText(grams)+'</summary>'+
    (rows?'<p>벙커에 두고 갈 물품을 체크하면 예상 중량을 계산합니다. 착용한 장비는 계량에서 제외합니다.</p><ul>'+rows+
      '</ul><output aria-live="polite" data-dock-preview>예상 가방 '+dockCapacityText(grams)+'</output>':'<p>현재 가방이 비어 있습니다. 현장에서 더 담은 물품은 탑승 시 합산합니다.</p>')+'</details>';
}
function previewDockCargo(box){
  if(page!=='prep'||raid||zone!==2||!dockAccess(career.surveyedBoxes))return;
  const panel=box.closest('[data-dock-manifest]');
  if(!panel)return;
  const omitted=new Set(Array.from(panel.querySelectorAll('[data-dock-omit]:checked'),c=>c.dataset.dockOmit));
  const remaining=equipmentState.bag.filter(u=>!omitted.has(u.uid));
  panel.querySelector('[data-dock-preview]').textContent='예상 가방 '+dockCapacityText(kitBagGrams(remaining));
}
function captureDockManifest(){
  if(raid||zone!==2||dockManifestKit!==equipmentState)return null;
  const panel=inside.querySelector?.('[data-dock-manifest]');
  if(!panel)return null;
  const active=document.activeElement;
  return {open:panel.open, omitted:new Set(Array.from(panel.querySelectorAll('[data-dock-omit]:checked'),box=>box.dataset.dockOmit)),
    focus:panel.contains(active)?active.dataset:null};
}
function restoreDockManifest(view){
  if(!view)return;
  const panel=inside.querySelector('[data-dock-manifest]');
  if(!panel)return;
  panel.open=view.open;
  const boxes=Array.from(panel.querySelectorAll('[data-dock-omit]'));
  for(const box of boxes)box.checked=view.omitted.has(box.dataset.dockOmit);
  if(boxes.length&&view.omitted.size)previewDockCargo(boxes[0]);
  if(!view.focus)return;
  let target;
  if(view.focus.dockOmit)target=boxes.find(box=>box.dataset.dockOmit===view.focus.dockOmit);
  if(view.focus.loadout==='dock-review')target=Array.from(panel.querySelectorAll('[data-loadout="dock-review"]')).find(button=>button.dataset.uid===view.focus.uid);
  (target||panel.querySelector('summary')).focus({preventScroll:true});
}
function reviewDockUnit(uid){
  if(page!=='prep'||raid||zone!==2||!dockAccess(career.surveyedBoxes))return;
  const unit=equipmentState.bag.find(item=>item.uid===uid);
  if(!unit)return;
  loMobilePanel.prep=1;
  gearPick={uid,rot:false};
  cashSelected=unit.g==='cr_notes'?uid:null;
  renderKeep();
  const tile=Array.from(document.querySelectorAll('[data-kit-grid] button')).find(b=>
    b.dataset.gear==='select'&&b.dataset.unit===uid||b.dataset.cash==='select'&&b.dataset.uid===uid);
  tile?.focus({preventScroll:true});tile?.scrollIntoView({block:'nearest'});
}
