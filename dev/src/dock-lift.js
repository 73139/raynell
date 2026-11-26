// The permanent notebook earns an extra exit on future departures; the assigned list belongs to the sortie.
const DOCK_SURVEYS=['2-3','2-4','2-8'];
const DOCK_LIFT_LIMIT=4000;
function dockAccess(keys){return Array.isArray(keys)&&DOCK_SURVEYS.every(key=>keys.includes(key));}
function dockWeight(grams){return (grams/1000).toFixed(3)+' kg';}
function dockLocation(){return FIELD_ZONES[2].name+' '+LANDMARKS[2][1].name;}
function dockAtPlatform(sortie=field,current=raid){return current?.zone===2&&sortie.landmarkByZone?.[2]===1;}
function dockStatus(){
  if(!writer)return '플레이 중인 탭에서 탑승하세요';
  if(!dockAtPlatform())return dockLocation()+'에서 탑승';
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
    (eligible&&!raid?'<p data-dock-kit>출격 준비 가방 '+dockCapacityText(kitBagGrams(equipmentState.bag))+'</p>':'')+dockCacheBrief()+'</details>';
}
function dockLoadPanel(){
  const mass=kitBagGrams(field.bag);
  let option='남은 화물 여유 '+dockWeight(DOCK_LIFT_LIMIT-mass);
  if(mass>DOCK_LIFT_LIMIT){
    const canStore=dockAtPlatform()&&!dockCache&&field.bag.some(dockCanStore);
    option=dockWeight(mass-DOCK_LIFT_LIMIT)+' 초과 · '+(canStore?
      '아래 도크 인수함에 장비 1개를 맡기거나 가방 물품을 바닥에 내려놓으세요.':
      '가방 물품을 이 지역 바닥에 내려놓거나 다른 배정 탈출구를 이용하세요.');
  }
  return '<p data-dock-load>현재 가방 '+dockWeight(mass)+' / '+dockWeight(DOCK_LIFT_LIMIT)+' · '+option+'</p>'+
    (mass>DOCK_LIFT_LIMIT?'<button type="button" data-page="inventory">가방 열기</button>':'')+dockCachePanel();
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

// A dock booking carries one physical item across exactly one departure.
const DOCK_CACHE_ITEMS=['rl10_vest','flash','radio'];
let dockCache=null,dockCacheFeedback='';
function startDockCacheSortie(){
  dockCacheFeedback='';
  if(dockCache?.stage==='ready')dockCache={...dockCache,stage:'claimable',claimRaidId:raid.startedAt};
}
function settleDockCache(liftReturn){
  if(!dockCache)return null;
  const pending=dockCache.stage==='pending'&&dockCache.depositRaidId===raid.startedAt;
  const booked=pending&&liftReturn;
  const outcome=booked?'booked':pending?'forfeited':'expired';
  dockCache=booked?{...dockCache,stage:'ready'}:null;
  dockCacheFeedback='';
  return outcome;
}
function dockCacheReceipt(row){
  const labels={booked:'보관 확정 · 다음 출격에서 '+esc(dockLocation())+'를 찾아 장비를 받으세요.',forfeited:'리프트로 귀환하지 않아 맡긴 장비를 잃었습니다.',expired:'이번 출격에서 찾지 않아 보관 기한이 끝났습니다.'};
  return Object.hasOwn(labels,row?.dockCacheOutcome)?'<p data-dock-cache-receipt><b>도크 인수함</b> · '+labels[row.dockCacheOutcome]+'</p>':'';
}
function dockCacheBrief(){
  if(!dockCache||!['ready','claimable'].includes(dockCache.stage))return '';
  return '<p data-dock-cache-brief>도크 인수함 · '+esc(kitName(dockCache.unit.g))+
    (dockCache.stage==='ready'?' · 다음 출격 한 번 동안':' · 이번 출격이 끝나기 전까지')+' '+esc(dockLocation())+'에서 찾으세요.</p>';
}
function dockGearLabel(gear){
  return maintenanceStateLine(gear)+' · '+(gear.module?kitName(gear.module)+' 장착':'부품 없음')+' · #'+gearSerial(gear.uid);
}
function dockCacheButton(action,label,unit,disabled){
  return '<button type="button" data-field="dock-'+action+'" data-raid-id="'+raid.startedAt+'" data-uid="'+esc(unit.uid)+
    '" data-gear-uid="'+esc(unit.gear.uid)+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
}
function dockCanStore(unit){return DOCK_CACHE_ITEMS.includes(unit.g)&&gearValid(unit.gear,unit.g);}
function dockCachePanel(){
  if(!dockAtPlatform()||!field.exits.includes('lift')||!dockAccess(career.surveyedBoxes))return dockCacheBrief();
  const locked=!writer||Boolean(field.action||field.open||field.contact||field.journey);
  let body;
  if(!dockCache){
    const options=field.bag.filter(dockCanStore);
    body='<p>가방 속 방호 조끼·손전등·무전기 중 1개를 맡길 수 있습니다. 이번에 리프트로 귀환하면 다음 출격에서 한 번 찾을 수 있습니다.</p>'+
      (options.length?options.map(u=>dockCacheButton('deposit',dockPackLabel(u)+' · '+dockGearLabel(u.gear)+' · 맡기기',u,locked)).join(''):'<p>가방에 맡길 장비가 없습니다.</p>');
  }else{
    const u=dockCache.unit,claim=dockCache.stage==='claimable',space=Boolean(kitFit(field.bag,raidBagSize(),u));
    body='<p>'+esc(kitName(u.g))+' · '+esc(dockGearLabel(u.gear))+'</p><p>'+
      (claim?'이번 출격이 끝나기 전에 찾아 가방에 넣으세요.':'보관 대기 중입니다. 리프트로 귀환해야 다음 출격에 남습니다. 다른 곳으로 탈출하거나 실종되면 잃습니다.')+'</p>'+
      dockCacheButton(claim?'claim':'cancel',claim?'장비 찾기':'맡기기 취소 · 가방으로',u,locked||!space)+
      (space?'':'<p>이 장비가 들어갈 빈 칸을 가방에 마련하세요.</p>');
  }
  return '<section data-dock-cache="'+(dockCache?.stage||'empty')+'"><h4>도크 인수함</h4><p role="status" tabindex="-1">'+esc(dockCacheFeedback)+'</p>'+body+'</section>';
}
function handleDockCache(d){
  if(!writer||!isActive()||String(raid.startedAt)!==d.raidId||!dockAtPlatform()||!field.exits.includes('lift')||
      !dockAccess(career.surveyedBoxes)||field.action||field.contact||field.journey||field.open)return;
  const owner=field,oldBag=field.bag,oldCache=dockCache;
  let feedback;
  if(d.field==='dock-deposit'){
    const u=oldBag.find(item=>item.uid===d.uid);
    if(dockCache||!u||!dockCanStore(u)||u.gear.uid!==d.gearUid)return;
    const {uid,g,x,y,w,h,gear}=u;
    // Loot-grid keys repeat across sorties. Give such cargo a permanent tile key as soon as it is set aside.
    const cacheUid=/^[0-2]-\d+-\d+$/.test(uid)?newStashUid():uid;
    dockCache={stage:'pending',depositRaidId:raid.startedAt,claimRaidId:null,unit:{uid:cacheUid,g,x,y,w,h,revealed:true,gear}};
    field.bag=oldBag.filter(item=>item!==u);
    feedback=kitName(u.g)+' 보관 대기 · 가방에서 옮겼습니다.';
  }else{
    const claim=d.field==='dock-claim';
    if(claim?dockCache?.stage!=='claimable'||dockCache.claimRaidId!==raid.startedAt:
      d.field!=='dock-cancel'||dockCache?.stage!=='pending'||dockCache.depositRaidId!==raid.startedAt)return;
    const u=dockCache.unit;
    if(u.uid!==d.uid||u.gear.uid!==d.gearUid)return;
    const fit=kitFit(oldBag,raidBagSize(),u);
    if(!fit)return;
    // Container tile IDs can be reused in a later sortie. The equipment serial is permanent.
    if(claim||oldBag.some(item=>item.uid===fit.uid)||field.gearGround.some(items=>items.some(item=>item.uid===fit.uid)))fit.uid=newStashUid();
    if(oldBag.some(item=>item.uid===fit.uid))return;
    field.bag=[...oldBag,fit];dockCache=null;
    feedback=kitName(u.g)+' · 가방에 넣었습니다.';
  }
  if(writeSession()){
    dockCacheFeedback=feedback;picked=null;dragged=null;
  }else if(field===owner){
    field.bag=oldBag;dockCache=oldCache;dockCacheFeedback='저장하지 못했습니다. 장비는 옮기기 전 위치에 있습니다.';
  }else dockCacheFeedback='다른 탭의 최신 기록을 불러왔습니다. 장비 위치를 확인하세요.';
  renderKeep();
  inside.querySelector?.('[data-dock-cache] [role="status"]')?.focus({preventScroll:true});
}
function validDockCache(s){
  const c=s.dockCache,report=s.lastSummary,receipt=report?.dockCacheOutcome;
  const stored=Array.isArray(report?.gearReport)?report.gearReport.filter(row=>row?.disposition==='stored'):[];
  if(receipt!==undefined&&!['booked','forfeited','expired'].includes(receipt))return false;
  if(receipt==='booked'){
    if(report.exit!==exitBy('lift').name||report.result!=='success'||stored.length!==1||
        !DOCK_CACHE_ITEMS.includes(stored[0].g)||
        (report.dockCacheModule!==undefined&&!PRESET_MODULES[stored[0].g]?.includes(report.dockCacheModule)))return false;
    if((!s.raid||s.raid.startedAt===report.raidId)&&c?.stage!=='ready')return false;
  }else if(stored.length||report?.dockCacheModule!==undefined)return false;
  if(c===undefined||c===null)return true;
  const u=c.unit;
  if(s.version<36||!dockAccess(s.career?.surveyedBoxes)||!Number.isSafeInteger(c.depositRaidId)||c.depositRaidId<=0||
      !u||!DOCK_CACHE_ITEMS.includes(u.g)||!gearValid(u.gear,u.g)||u.revealed!==true||
      Object.keys(u).some(k=>!['uid','g','x','y','w','h','revealed','gear'].includes(k))||
      Object.keys(u.gear).some(k=>!['uid','g','ammo','durability','module'].includes(k))||
      typeof u.uid!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(u.uid)||
      !Number.isInteger(u.x)||u.x<0||u.x>40||!Number.isInteger(u.y)||u.y<0||u.y>40)return false;
  const [,w,h]=GOODS[u.g];
  if(!((u.w===w&&u.h===h)||(u.w===h&&u.h===w)))return false;
  const r=s.raid,f=s.field;
  if(c.stage==='pending')return c.claimRaidId===null&&r?.startedAt===c.depositRaidId&&!f.result&&f.exits.includes('lift')&&
    !f.bag.some(item=>item.uid===u.uid)&&!f.gearGround.some(items=>items.some(item=>item.uid===u.uid))&&
    !Object.values(f.boxes).some(box=>box.items.some(item=>item.uid===u.uid));
  const record=report?.gearReport?.find(row=>row.disposition==='stored'&&row.uid===u.gear.uid&&row.g===u.g);
  if(receipt!=='booked'||(report?.dockCacheModule??null)!==u.gear.module||report?.raidId!==c.depositRaidId||report.exit!==exitBy('lift').name||!record||
     record.durabilityBefore-record.wear!==u.gear.durability||record.ammoBefore-record.ammoUsed!==u.gear.ammo)return false;
  if(c.stage==='ready')return c.claimRaidId===null&&(!r||r.startedAt===c.depositRaidId&&f.result==='success');
  return c.stage==='claimable'&&r?.startedAt===c.claimRaidId&&Number.isSafeInteger(c.claimRaidId)&&
    c.claimRaidId>0&&c.claimRaidId!==c.depositRaidId&&!f.result&&f.exits.includes('lift');
}
