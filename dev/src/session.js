// The previous client can still own an open tab. Keep its checkpoint isolated.
const SAVE_VERSION=36;
const SAVE_KEY='rl-reboot-session-v36';
const SAVE35='rl-reboot-session-v35';
const WRITER_BUILD=__WRITER_BUILD__; // Derived from the release title by build.py.
const SAVE34='rl-reboot-session-v34';
const SAVE32='rl-reboot-session-v32';
const SAVE29='rl-reboot-session-v29';
const SAVE28='rl-reboot-session-v28';
const SAVE27='rl-reboot-session-v27';
const SAVE26='rl-reboot-session-v26';
const SAVE25='rl-reboot-session-v25';
const SAVE24='rl-reboot-session-v24';
const SAVE23='rl-reboot-session-v23';
const SAVE22='rl-reboot-session-v22';
const SAVE21='rl-reboot-session-v21';
const SAVE20='rl-reboot-session-v20';
const SAVE19='rl-reboot-session-v19';
const SAVE18='rl-reboot-session-v18';
const SAVE17='rl-reboot-session-v17';
const SAVE16='rl-reboot-session-v16';
const SAVE12='rl-reboot-session-v12';
const SAVE11='rl-reboot-session-v11';
const SAVE10='rl-reboot-session-v10';
// v0.33 also wrote schema 32. Earlier generations are sources, never write targets.
const PREVIOUS_SAVE_KEYS=[SAVE35,SAVE34,SAVE32,SAVE29,SAVE28,SAVE27,SAVE26,SAVE25,SAVE24,SAVE23,SAVE22,SAVE21,SAVE20,SAVE19,SAVE18,SAVE17,SAVE16,SAVE12,SAVE11,SAVE10];
function previousCheckpoint(){
  for(const key of PREVIOUS_SAVE_KEYS){
    const saved=getJSON(key);
    if(saved)return saved;
  }
  return null;
}
let writer=false, revision=0, saveMessage='', settlementNeedsCommit=false;
let lastCheckpointJSON=null;
let updateRequired=false, releaseWriterLock=null;

function newerCheckpoint(s){
  return Boolean(s && (s.version>SAVE_VERSION || s.writerBuild>WRITER_BUILD ||
    (s.version>=36 && (!Number.isSafeInteger(s.writerBuild)||s.writerBuild<1))));
}

function requireCurrentClient(s){
  if(!newerCheckpoint(s))return !updateRequired;
  updateRequired=true;writer=false;
  document.documentElement.classList.add('read-only');
  world.inert=true;inside.inert=true;
  $('#save-upgrade').hidden=false;
  $('#save-refresh').focus();
  releaseWriterLock?.();
  return false;
}
function readSession(current){
  if(current===undefined){
    try{
      const raw=localStorage.getItem(SAVE_KEY);
      current=JSON.parse(raw);
      lastCheckpointJSON=raw;
    }catch{
      raidStorageOK=false;
      if(!lastCheckpointJSON && field)return false;
      current=lastCheckpointJSON?JSON.parse(lastCheckpointJSON):null;
    }
  }
  if(!requireCurrentClient(current))return false;
  settlementNeedsCommit=false;
  const previous=current?null:previousCheckpoint(), snap=current||previous||getJSON(SAVE09);
  revision=current?.revision||0;
  stash=Object.fromEntries(Object.entries(snap?.stash||{}).filter(([id,q])=>Object.hasOwn(GOODS,id)&&Number.isSafeInteger(q)&&q>0));
  wallet=Number.isSafeInteger(snap?.wallet)&&snap.wallet>=0?snap.wallet:30000;
  lastSummary=snap?.lastSummary||null;
  const r=snap?snap.raid:getJSON(RAID_KEY);
  raid=r&&Number.isSafeInteger(r.startedAt)&&Number.isSafeInteger(r.endsAt)&&r.endsAt-r.startedAt===RAID_DURATION_MS&&Number.isInteger(r.zone)&&FIELD_ZONES[r.zone]?r:null;
  const f=snap?snap.field:getJSON(FIELD_KEY);
  field=f&&f.raidId===(raid?.startedAt||0)&&Array.isArray(f.bag)&&Array.isArray(f.found)&&f.boxes&&Array.isArray(f.log)?f:freshField();
  if(!(snap?.version>=23))delete field.survivorScavenge;
  if(raid&&!Array.isArray(field.visited))field.visited=[raid.zone];
  if(raid)for(const box of Object.values(field.boxes)){
    if(!Array.isArray(box.size))box.size=BOX_SIZE.slice();
  }
  readCareer(snap?.career);
  postalNotice='';
  if(!validPostalCargo(raid,field,career.order)){
    delete field.postal;field.bag=field.bag.filter(u=>u.g!==POSTAL_ITEM);
    if(Array.isArray(field.gearGround))field.gearGround=field.gearGround.map(list=>Array.isArray(list)?list.filter(u=>u.g!==POSTAL_ITEM):[]);
  }
  if(!validPumpGauge(raid,field,career.order))delete field.pumpGauge;
  if(!validWeatherSurvey(raid,field,career.order))delete field.weatherSurvey;
  loadTraderContracts(snap?.contracts);
  loadMarketCarts(snap?.version>=28?snap.marketCarts:null);
  saleReceipts=validSaleReceipts(snap?.saleReceipts)?snap?.saleReceipts??{}:{};
  resetTradeDraftUI();
  loadRecurring(snap?.periodic);
  loadHideout(snap?.hideout);
  loadCampaign(snap?.version >= 22 ? snap.campaign : null);
  loadFinale(snap?.version >= 22 ? snap.finale : null);
  loadLootGoal(snap?.version>=24 ? snap.lootGoal : null, snap?.version>=24 ? snap.lootDestination : null);
  loadLootLockMode(snap?.version ?? 0);
  barterHunt=validBarterHunt(snap?.barterHunt,traderContracts) ? snap?.barterHunt??null : null;
  huntUiRegion=null;huntUiMessage='';
  clearLootPlanUI();
  loadSurvivor(snap?.version >= 23 ? snap.survivor : null);
  clearSurvivorFeedback();
  loadGearOverflow(snap?.version>=25 ? snap.gearOverflow : null);
  loadStashLayout(snap?.stashSlots,(snap?.version??0)<16);
  loadEquipment(snap?.equipment, snap?.version ?? 0);
  loadCash(snap);
  loadInjuries(snap?.injuryState,snap?.version ?? 0);
  initializeGearLedger(snap?.version ?? 0);
  loadPresetBook(snap?.version >= 21 ? snap.presets : null);
  resetPresetUI();
  campaignFeedback=null;
  finaleFeedback=null;
  // An empty pack already qualified a v0.9 tunnel countdown before gear slots existed.
  if(!current&&!previous&&raid&&!field.result&&field.action?.type==='extract'&&field.action.exit==='tunnel'&&!field.bag.length&&field.worn.back===ISSUE_PACK){
    delete field.worn.back;
    field.gearGround[raid.zone].push(kitUnit(ISSUE_PACK));
  }
  prepareLandmarks();
  prepareSortie(true);
  migrateJourneySchedule(snap?.version ?? 0);
  objectivePin = [17,18,19,20,21,22,23,24,25,26,27,28,29,32,34,35,SAVE_VERSION].includes(snap?.version) ? normalizeObjectivePin(snap.objectivePin) : null;
  loadOnboarding([19,20,21,22,23,24,25,26,27,28,29,32,34,35,SAVE_VERSION].includes(snap?.version) ? snap.onboarding : null, Boolean(snap || r || f));
}
function snapshot(){return {version:SAVE_VERSION,writerBuild:WRITER_BUILD,revision,marketCarts,saleReceipts,injuryState,gearOverflow,lootGoal:lootPlan,lootDestination,barterHunt,survivor:survivorState,campaign:campaignState,finale:finaleState,presets:presetBook,onboarding:onboardingCheckpoint(),objectivePin:normalizeObjectivePin(objectivePin),raid,field,...cashProjection(wallet),wallet,lastSummary,career,equipment:equipmentState,hideout,contracts:traderContracts,periodic:periodicContracts}}
function writeSession(){
  if(!writer)return false;
  const nextRevision = revision + 1;
  try {
    // A failed revision read is a failed transaction, even if writes still work.
    const raw=localStorage.getItem(SAVE_KEY),disk=JSON.parse(raw);
    lastCheckpointJSON=raw;
    if(!requireCurrentClient(disk))return false;
    if((disk?.revision||0)!==revision){
      readSession(disk);saveMessage='다른 탭에서 저장한 최신 기록을 불러왔습니다.';return false;
    }
    const next = {...snapshot(), revision:nextRevision};
    const serialized=JSON.stringify(next);
    localStorage.setItem(SAVE_KEY,serialized);
    lastCheckpointJSON=serialized;
    raidStorageOK=true;
    applyCashProjection(next);
    objectivePin = next.objectivePin;
    onboardingState = next.onboarding;
    revision = nextRevision;
    return true;
  } catch {
    raidStorageOK = false;
    return false;
  }
}
// Persist a pin with the same revision check as the inventory and contracts it describes.
function setObjectivePin(requested) {
  if (!writer) return false;
  reconcile();
  const desired = normalizeObjectivePin(requested);
  if (requested != null && !desired) return false;
  const previous = objectivePin, inventory = stash;
  objectivePin = desired;
  if (writeSession()) return true;
  // On a revision conflict writeSession already restored the newer session.
  if (stash === inventory) objectivePin = previous;
  return false;
}
function enableSession(){
  if(updateRequired)return;
  writer=true;readSession();
  if(updateRequired)return;
  document.documentElement.classList.remove('read-only');
  if(raid)seedContainers();
  if(raid&&field.result==='expired'&&lastSummary?.raidId!==raid.startedAt)finishRaid('expired',raid.endsAt);
  reconcile();persist();if(view==='inside')renderKeep();
}
function startSession(){
  readSession();
  if(updateRequired)return;
  let locks;
  try{locks=navigator.locks}catch{}
  if(!locks){enableSession();return}
  document.documentElement.classList.add('read-only');
  try{
    // Keep one writer across an open v0.10 tab and later migrations.
    locks.request(SAVE10,async()=>{
      enableSession();
      if(!writer)return;
      await new Promise(resolve=>{
        releaseWriterLock=resolve;
        window.addEventListener('pagehide',resolve,{once:true});
      });
      window.removeEventListener('pagehide',releaseWriterLock);
      releaseWriterLock=null;writer=false;
    }).catch(()=>{if(!writer)enableSession()});
  }catch{enableSession()}
}
function backupPanel(){
  return '<section class="panel save-panel"><h2>플레이 기록</h2><p>기록은 현재 브라우저에 저장됩니다. 다른 기기나 파일로 옮길 때 백업을 사용하세요.</p>'+
    '<button data-backup="export">백업 내려받기</button><button data-backup="import">백업 불러오기</button><input type="file" id="restore-file" accept=".json,application/json" hidden>'+
    '<p role="status">'+esc(saveMessage)+'</p></section>';
}
function exportSave(){
  if(!writer)return;
  reconcile();
  const session=snapshot();
  if(!raid)session.plannedDepartureZone=zone;
  const url=URL.createObjectURL(new Blob([JSON.stringify({format:'rustline-tc01',session})],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='Rustline_save_v'+SAVE_VERSION+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function validateBackup(raw){
  if(!raw||raw.format!=='rustline-tc01'||newerCheckpoint(raw.session))return false;
  const s=raw.session, dict=o=>o&&typeof o==='object'&&!Array.isArray(o);
  const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const id=x=>typeof x==='string'&&Object.hasOwn(GOODS,x);
  const sizedTile=(o,maxX,maxY)=>dict(o)&&id(o.g)&&typeof o.uid==='string'&&/^[a-z0-9_-]{1,100}$/i.test(o.uid)&&integer(o.x,0,maxX)&&integer(o.y,0,maxY)&&integer(o.w,1,20)&&integer(o.h,1,20);
  const tile=o=>sizedTile(o,40,40);
  if(!dict(s)||![10,11,12,16,17,18,19,20,21,22,23,24,25,26,27,28,29,32,34,35,SAVE_VERSION].includes(s.version)||!integer(s.wallet)||!dict(s.stash)||!Object.entries(s.stash).every(([k,n])=>id(k)&&integer(n,1))||!Array.isArray(s.stashSlots))return false;
  if ([19,20,21,22,23,24,25,26,27,28,29,32,34,35,SAVE_VERSION].includes(s.version) && (!validOnboardingCheckpoint(s.onboarding) ||
      (s.onboarding.mode === 'completed' && !(Array.isArray(s.contracts?.supply?.done) &&
        s.contracts.supply.done.includes(ONBOARDING_QUEST))))) return false;
  const level=s.hideout?.levels?.stash??0;
  if(!integer(level,0,FACILITIES.stash.levels.length))return false;
  const [cols,rows]=stashSize(level);
  if(!s.stashSlots.every(o=>sizedTile(o,cols-1,rows-1)&&o.x+o.w<=cols&&o.y+o.h<=rows))return false;
  if(!validSaleReceipts(s.saleReceipts))return false;
  const soldLabels=new Set(Object.values(s.saleReceipts??{}).flatMap(receipt=>receipt.lines));
  const placedUnits = new Set(s.stashSlots);
  const namedPresets = new Set(s.version >= 21 && Array.isArray(s.presets) ? s.presets : []);
  function plainProperty(parent, key, value, depth) {
    if (key === 'name' && namedPresets.has(parent)) {
      return typeof value === 'string' && value.length > 0 && presetNameValue(value) === value;
    }
    if (['__proto__','prototype','constructor'].includes(key) || !/^[\w-]+$/.test(key)) return false;
    if (key === 'alias' && soldLabels.has(parent)) return true; // The receipt validator checked the normalized case label.
    if (key === 'alias' && placedUnits.has(parent)) {
      return typeof value === 'string' && value.length > 0 && Object.hasOwn(STORAGE_CASES,parent.g) &&
        caseAliasValue(value) === value;
    }
    return plain(value, depth + 1);
  }
  function plain(v,depth=0){
    if(depth>12)return false;
    if(typeof v==='string')return v.length<2500&&!/[<>&"`]/.test(v);
    if(v===null||typeof v==='boolean')return true;
    if(typeof v==='number')return Number.isFinite(v);
    return typeof v==='object'&&Object.entries(v).every(([key,value])=>plainProperty(v,key,value,depth));
  }
  if(!plain(s)||!dict(s.field)||!dict(s.equipment)||!dict(s.hideout)||!dict(s.career))return false;
  if(s.version>=29&&!validCashBackup(s))return false;
  if(s.version<29&&(s.stash.cr_notes||s.equipment.bag?.some(isCashUnit)||s.field.bag?.some(isCashUnit)||Object.values(s.field.boxes||{}).some(box=>box?.items?.some?.(isCashUnit))||s.field.gearGround?.some(row=>row?.some?.(isCashUnit))))return false;
  if(s.version >= 25 && (!validGearBackup(s) || !validGearLedger(s)))return false;
  if(s.version >= 21 && !validPresetBackup(s))return false;
  if(s.version >= 22 && (!validCampaignBackup(s) || !validFinaleBackup(s)))return false;
  if(s.version >= 23 && (!validSurvivorBackup(s) || !validSurvivorScavenge(s)))return false;
  if(!validBarterHunt(s.barterHunt,s.contracts))return false;
  if(s.version>=24 && !validLootGoalBackup(s))return false;
  if(s.version>=24 && s.plannedDepartureZone!==undefined && (s.raid || (s.version<27 && !s.lootDestination) || !integer(s.plannedDepartureZone,0,FIELD_ZONES.length-1)))return false;
  if(!validWardBackup(s)||!validCaseBackup(s)||!validateEquipmentBackup(s)||!validContractsBackup(s.contracts)||!validRecurringSave(s.periodic))return false;
  const r=s.raid,f=s.field;
  if(!validPostalBackup(s)||!validPumpGauge(r,f,s.career?.order)||!validWeatherSurvey(r,f,s.career?.order))return false;
  if(r!==null&&(!dict(r)||!integer(r.startedAt,1)||r.endsAt-r.startedAt!==RAID_DURATION_MS||!integer(r.zone,0,2)))return false;
  if(f.raidId!==(r?.startedAt||0)||!Array.isArray(f.bag)||!f.bag.every(tile)||!Array.isArray(f.found)||f.found.length!==3||!f.found.every((a,z)=>Array.isArray(a)&&a.every(i=>integer(i,0,FIELD_ZONES[z].boxes.length-1))))return false;
  if(!Array.isArray(f.log)||!f.log.every(x=>typeof x==='string')||!dict(f.boxes))return false;
  function validBoxKey(key){
    if(!/^[0-2]-(0|[1-9]\d*)$/.test(key))return false;
    const [z,i]=key.split('-').map(Number);
    return i<FIELD_ZONES[z].boxes.length;
  }
  if(!validLandmarkSelection(f)||!validJourneyBackup(s))return false;
  if(!Object.entries(f.boxes).every(([k,b])=>validBoxKey(k)&&b?.key===k&&Array.isArray(b.items)&&b.items.every(tile)&&Array.isArray(b.size)&&b.size.length===2&&b.size.every(n=>integer(n,1,20))))return false;
  if(f.result!=null&&!Object.hasOwn(ENDINGS,f.result))return false;
  if(f.contact!=null&&(!integer(f.contact.zone,0,2)||!integer(f.contact.hp,1,100)))return false;
  if(r&&(!Array.isArray(f.visited)||!Array.isArray(f.exits)||!f.exits.every(k=>!!exitBy(k))))return false;
  if(f.open!=null&&!f.boxes[f.open])return false;
  const a=f.action;
  if(a!=null){
    const supportedAction=['travel-step','move','scan','search','engage','evade','extract'].includes(a.type) ||
      (s.version>=26 && a.type==='treat');
    if(!r||!dict(a)||!supportedAction||!integer(a.start)||!integer(a.end)||a.start>a.end)return false;
    if(a.type==='move'&&!integer(a.zone,0,2)||a.type==='search'&&!f.boxes[a.key]||a.type==='extract'&&!exitBy(a.exit))return false;
  }
  if(s.version>=28 && !validMarketCarts(s.marketCarts,s.contracts))return false;
  if(s.version>=26 && !validInjuryBackup(s))return false;
  const summary=s.lastSummary;
  if(summary&&(!dict(summary)||!Array.isArray(summary.goods)||!summary.goods.every(id)||!integer(summary.elapsed)||!integer(summary.cost)||!Object.hasOwn(ENDINGS,summary.result)))return false;
  if(summary?.worn&&(!Array.isArray(summary.worn)||!summary.worn.every(x=>dict(x)&&Object.hasOwn(KIT_SLOTS,x.slot)&&kitSlot(x.id)===x.slot && (x.module === undefined || PRESET_MODULES[x.id]?.includes(x.module)))))return false;
  function validHistoryRow(row,index){
    if(!dict(row)||!Object.hasOwn(ENDINGS,row.rating)||!integer(row.elapsed)||!integer(row.xp))return false;
    if(!validHistoryGear(row) || (row.gearReport!==undefined && (s.version<36 || index>=12 || !integer(row.at,1) || row.at<=row.elapsed || !historyGearMatches(row,summary))))return false;
    if(!Object.hasOwn(row,'carriedCash'))return true; // Older receipts omitted carried notes.
    if(!integer(row.carriedCash)||!integer(row.commission)||!integer(row.cost)||!Number.isSafeInteger(row.cash))return false;
    const returned=row.rating==='success'||row.rating==='quick';
    return returned ? row.cash===row.carriedCash-row.cost+row.commission : row.cash===0&&row.commission===0&&row.cost===0;
  }
  return Array.isArray(s.career.done)&&Array.isArray(s.career.history)&&s.career.history.every(validHistoryRow);
}
async function importSave(file){
  if(!file||!writer)return;
  const originalRevision = revision;
  let data;
  try{
    if(file.size>4000000)throw Error();
    data=JSON.parse(await file.text());
    if(data?.format==='rustline-tc01' && newerCheckpoint(data.session)){
      saveMessage='이 백업은 최신 버전의 게임에서 복원할 수 있습니다. 최신 게임을 열어 다시 선택하세요.';renderKeep();return;
    }
    if(!validateBackup(data))throw Error();
  }
  catch{saveMessage='읽을 수 없는 백업입니다. 러스트라인 게임에서 내보낸 호환 백업 파일을 선택하세요.';renderKeep();return}
  if(!writer)return;
  function readyToReplace(){
    const disk=JSON.parse(localStorage.getItem(SAVE_KEY));
    if(!requireCurrentClient(disk))return false;
    if(originalRevision===revision && (disk?.revision||0)===revision)return true;
    readSession();saveMessage='플레이 기록이 갱신되었습니다. 확인한 뒤 백업 파일을 다시 선택하세요.';renderKeep();return false;
  }
  try{
    if(!readyToReplace() || !confirm('현재 플레이 기록을 선택한 백업으로 교체할까요?') || !readyToReplace())return;
    localStorage.setItem(SAVE_KEY,JSON.stringify({...data.session,writerBuild:WRITER_BUILD,revision:revision+1}));
  }catch{saveMessage='브라우저가 저장을 허용하지 않았습니다.';renderKeep();return}
  readSession();
  if(raid)seedContainers();
  else if(data.session.version>=27 && Number.isInteger(data.session.plannedDepartureZone)){
    zone=data.session.plannedDepartureZone;save();
  }else if(lootDestination){zone=data.session.plannedDepartureZone??lootDestination.zone;save();}
  reconcile();persist();saveMessage='백업을 복원했습니다.';renderKeep();
}
document.addEventListener('click',e=>{
  if(writer)return;
  if(updateRequired && e.target.closest('#save-refresh')){location.reload();return;}
  if(e.target.closest('button,input,select')){e.stopImmediatePropagation();e.preventDefault()}
},true);
document.addEventListener('drop',e=>{if(!writer){e.preventDefault();e.stopImmediatePropagation()}},true);
inside.addEventListener('change',event=>{
  const input=event.target;
  if(input.id!=='restore-file')return;
  const file=input.files[0];
  // A canceled confirmation must allow choosing this same local file again.
  input.value='';
  importSave(file);
});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
