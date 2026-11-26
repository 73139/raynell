// A single carried dressing is marked after the player finishes searching one designated case.
const WARD_FIELD_ID='ward-packing';
const WARD_FIELD_SITES=[
  {zone:0,landmark:7,boxOrdinal:0,mark:'이중선'},
  {zone:1,landmark:1,boxOrdinal:0,mark:'교차선'}
];
function paidWardDelivery(h){
  return Boolean(h?.wardTrial?.paid && validWardTrialRecord(h.wardTrial,h.wardManual?.registered,h.levels?.med));
}
// Old preparation bags used generic kit identifiers. Assign their warehouse-compatible ID
// before this sortie's first comparison so it remains stable from the case to the return grid.
function prepareWardPacking(){
  if(career.order!==WARD_FIELD_ID)return;
  for(const unit of field.bag)if(unit.g===WARD_TRIAL_ITEM&&!wardUid(unit.uid))unit.uid=newStashUid();
}
function wardPackingDossier(){
  const record=career.wardCheckReceipt;
  if(!record)return raid?'':'<div class="shell-actions"><button data-bui="facility" data-id="med">의무실 제작 보기</button><button data-page="stash">창고에서 출격 가방 준비</button></div>';
  const site=WARD_FIELD_SITES[record.site];
  return '<p data-ward-packing-receipt>'+esc(LANDMARKS[site.zone][site.landmark].name)+' · '+site.mark+' 표식 대조 · 귀환 확인 #'+esc(gearSerial(record.uid))+'</p>';
}
function wardInspectionSites(f){
  return orderInspectionSites({inspections:WARD_FIELD_SITES},f);
}
function wardCheckRecord(r,paid){
  return Boolean(r && typeof r==='object' && !Array.isArray(r) && Object.keys(r).length===4 &&
    Number.isInteger(r.site) && Boolean(WARD_FIELD_SITES[r.site]) && Number.isSafeInteger(r.raidId) &&
    Number.isSafeInteger(r.raidId+RAID_DURATION_MS) && paid && r.raidId>=paid.at &&
    Number.isSafeInteger(r.at) && r.at>=r.raidId && r.at<r.raidId+RAID_DURATION_MS && r.at<=Date.now() &&
    typeof r.uid==='string' && /^[a-z0-9_-]{1,100}$/i.test(r.uid) && r.uid!==paid.uid);
}
function validWardFieldBackup(s){
  const active=s.career?.order===WARD_FIELD_ID,done=s.career?.done?.includes?.(WARD_FIELD_ID);
  const entry=s.field?.wardCheck,receipt=s.career?.wardCheckReceipt;
  if(!active && !done && entry===undefined && receipt===undefined)return true;
  if(!paidWardDelivery(s.hideout)||Boolean(done)!==(receipt!==undefined)||(done&&active))return false;
  const paid=s.hideout.wardTrial.paid;
  if(done){
    if(!wardCheckRecord(receipt,paid))return false;
    const summary=s.lastSummary,job=ORDERS.find(q=>q.id===WARD_FIELD_ID);
    if(summary?.raidId===receipt.raidId && (summary.rating!=='success'||summary.orderName!==job.title||
       summary.commission!==job.cr||summary.missionXp!==job.xp))return false;
  }
  if(entry===undefined)return true;
  if(!active||!wardCheckRecord(entry,paid)||entry.raidId!==s.raid?.startedAt||s.field.result)return false;
  const site=WARD_FIELD_SITES[entry.site];
  const index=LANDMARKS[site.zone][site.landmark].boxes[site.boxOrdinal],key=boxKey(site.zone,index);
  const box=s.field.boxes?.[key];
  if(!Array.isArray(s.field.visited)||!s.field.visited.includes(site.zone)||!Array.isArray(s.field.found?.[site.zone])||
    !Array.isArray(box?.items)||box.items.some(u=>!u)||!orderInspectionSites({inspections:[site]},s.field)[0].complete)return false;
  if(LOOT_LOCKS.some(lock=>lock.zone===site.zone&&lock.index===index)&&!s.field.lootLocks?.legacy&&
    !s.field.lootLocks?.unlocked?.includes?.(key))return false;
  // It may have been used after comparison. A different item or a bunker copy cannot own its field UID.
  if(!Array.isArray(s.field.bag)||!Array.isArray(s.field.gearGround)||!s.field.gearGround.every(Array.isArray))return false;
  const found=[...s.field.bag,...s.field.gearGround.flat()].filter(u=>u?.uid===entry.uid);
  return found.length<=1 && found.every(u=>u.g===WARD_TRIAL_ITEM) &&
    !s.stashSlots?.some?.(u=>u?.uid===entry.uid||u?.contents?.some?.(i=>i?.uid===entry.uid));
}
function wardCheckCarried(){
  const record=field.wardCheck;
  return Boolean(raid&&!field.result&&record?.raidId===raid.startedAt&&field.bag.some(u=>u.g===WARD_TRIAL_ITEM&&u.uid===record.uid));
}
function wardCheckLocations(){
  if(!isActive()||!field.wardCheck)return WARD_FIELD_SITES;
  if(wardCheckCarried())return [];
  const zone=field.gearGround.findIndex(list=>list.some(u=>u.uid===field.wardCheck.uid&&u.g===WARD_TRIAL_ITEM));
  return zone<0?[]:[{zone}];
}
function wardFieldPanel(){
  if(career.order!==WARD_FIELD_ID||!isActive())return '';
  const entry=field.wardCheck;
  if(entry){
    const zone=wardCheckLocations()[0]?.zone;
    const hint=wardCheckCarried()?'대조한 처치포를 가방에 넣었습니다. 정상 탈출하세요.':
      Number.isInteger(zone)?FIELD_ZONES[zone].name+' 바닥에 둔 대조품을 회수하세요.':'대조품을 소모했습니다. 다음 출격에서 새로 대조하세요.';
    return '<section class="pump-gauge" data-ward-check="marked"><h3 tabindex="-1">포장 대조 완료 · #'+esc(gearSerial(entry.uid))+'</h3><p>'+esc(hint)+'</p></section>';
  }
  const index=WARD_FIELD_SITES.findIndex(s=>raid.zone===s.zone && field.landmarkByZone[raid.zone]===s.landmark);
  if(index<0)return '';
  const site=wardInspectionSites(field)[index],name=FIELD_ZONES[site.zone].boxes[site.index][0];
  if(!site.complete)return '<section class="pump-gauge" data-ward-check="search"><h3>회수 포장 대조</h3><p>'+esc(name)+' 안을 끝까지 수색해 안쪽의 포장 표식을 확인하세요.</p></section>';
  const copies=field.bag.filter(u=>u.g===WARD_TRIAL_ITEM);
  return '<section class="pump-gauge" data-ward-check="select"><h3>'+esc(name)+' · '+WARD_FIELD_SITES[index].mark+' 표식</h3><p>'+
    (copies.length?'대조할 처치포 하나를 고르세요. 이 물품을 가방에 보관한 채 정상 탈출해야 합니다.':'대조할 접이식 야전 처치포가 가방에 없습니다.')+'</p>'+
    copies.map(u=>'<button type="button" data-field="ward-compare" data-raid-id="'+raid.startedAt+'" data-uid="'+esc(u.uid)+'"'+
      (field.action||field.contact||field.journey||field.open||!writer?' disabled':'')+'>가방 '+(u.y+1)+'행 '+(u.x+1)+'열 · #'+esc(gearSerial(u.uid))+' 대조</button>').join(' ')+'</section>';
}
function compareWardPacking(d){
  if(!writer||!isActive()||Date.now()>=raid.endsAt||!paidWardDelivery(hideout)||career.order!==WARD_FIELD_ID||
     d.raidId!==String(raid.startedAt)||field.wardCheck||field.action||field.contact||field.journey||field.open)return;
  const site=wardInspectionSites(field).findIndex(s=>s.complete&&s.zone===raid.zone&&field.landmarkByZone[s.zone]===s.landmark&&!lootBoxIsLocked(s.zone,s.index));
  if(site<0||!field.bag.some(u=>u.g===WARD_TRIAL_ITEM&&u.uid===d.uid))return;
  const owner=field;
  field.wardCheck={raidId:raid.startedAt,at:Date.now(),uid:d.uid,site};
  if(!writeSession()&&owner===field)delete field.wardCheck;
  renderKeep();$('[data-ward-check="marked"] h3')?.focus?.({preventScroll:true});
}
