// The event log belongs to one sortie. Replaying it supplies both live state and the extraction receipt.
const INJURY_PARTS = [
  {id:'arm',label:'팔',penalty:'내용물 수색 시간 +25%'},
  {id:'leg',label:'다리',penalty:'도주 시간 +1초'},
  {id:'torso',label:'몸통',penalty:'주변 탐색 시간 +25%'}
];
const TREATMENT_MS = 3000;
let injuryState = null;

function loadInjuries(raw,version) {
  if (!raid || field.result) injuryState=null;
  else if (version>=26 && raw?.raidId===raid.startedAt) injuryState=raw;
  else injuryState={raidId:raid.startedAt,legacy:true,events:[]};
  if (version<26 && lastSummary) delete lastSummary.injuries;
}
function startInjuries() {
  injuryState={raidId:raid.startedAt,legacy:false,events:[]};
}
function injuryView(state=injuryState) {
  const parts=INJURY_PARTS.map(part=>({...part,status:'normal',hits:0,treatments:0}));
  const events=state?.events||[];
  let hits=0,treatments=0;
  for (const event of events) {
    const part=parts.find(p=>p.id===event.part);
    if(event.kind==='hit'){part.status='wounded';part.hits++;hits++;}
    else {part.status='recovered';part.treatments++;treatments++;}
  }
  return {mode:!state?'idle':state.legacy?'legacy':'active',parts,hits,treatments,events};
}
function hasInjury(part=null) {
  if(!injuryState || injuryState.legacy)return false;
  return injuryView().parts.some(p=>(!part||p.id===part) && p.status==='wounded');
}
function injuryDuration(type,ms) {
  if(type==='search' && hasInjury('arm') || type==='scan' && hasInjury('torso'))return Math.round(ms*1.25);
  if(type==='evade' && hasInjury('leg'))return ms+1000;
  return ms;
}
function recordContactInjury(at,damage) {
  if(!injuryState || injuryState.legacy || damage<=0)return;
  const part=INJURY_PARTS[injuryView().hits % INJURY_PARTS.length];
  // A restored device clock may be behind the last action that already committed.
  at=Math.max(at,injuryState.raidId,injuryState.events.at(-1)?.at||0);
  injuryState.events.push({kind:'hit',part:part.id,at,damage});
  settlementNeedsCommit=true;
  logField(part.label+' 부상 · '+part.penalty+'.');
}
function injuryItem(id) {
  return kitSupply(id)?.stat==='hp';
}
function treatmentEligibility(part,uid) {
  if(!writer || !raid || field.result || !isActive() || !injuryState || injuryState.legacy)return '부위 치료는 출격 중에 진행합니다.';
  if(field.action || field.journey && !field.journey.event)return '진행 중인 행동이 끝나면 치료할 수 있습니다.';
  if(!hasInjury(part) || !INJURY_PARTS.some(p=>p.id===part))return '치료할 부상 부위를 선택하세요.';
  const unit=field.bag.find(u=>u.uid===uid);
  if(!unit || !injuryItem(unit.g))return '가방에서 사용할 의료품을 선택하세요.';
  if(Date.now()+TREATMENT_MS>=raid.endsAt)return '치료를 끝낼 출격 시간이 부족합니다.';
  return '';
}
function beginInjuryTreatment(part,uid) {
  if(!writer)return {ok:false,message:'기록을 작성할 수 있는 탭에서 치료하세요.'};
  reconcile();
  const reason=treatmentEligibility(part,uid);
  if(reason)return {ok:false,message:reason};
  const current=field,unit=field.bag.find(u=>u.uid===uid);
  const start=Math.max(Date.now(),raid.startedAt,injuryState.events.at(-1)?.at||0);
  if(start+TREATMENT_MS>=raid.endsAt)return {ok:false,message:'치료를 끝낼 출격 시간이 부족합니다.'};
  field.action={type:'treat',part,uid,item:unit.g,start,end:start+TREATMENT_MS};
  if(!writeSession()){
    if(field===current)field.action=null;
    return {ok:false,message:'치료 시작을 저장하지 못했습니다. 부위와 물품을 확인하세요.'};
  }
  return {ok:true,message:'치료를 시작했습니다. 완료 시 의료품 1개를 사용합니다.'};
}
function cancelInjuryTreatment() {
  if(!writer)return {ok:false,message:'기록을 작성할 수 있는 탭에서 치료를 취소하세요.'};
  reconcile();
  const current=field,previous=current?.action;
  if(!previous || previous.type!=='treat')return {ok:false,message:'진행 중인 치료가 없습니다.'};
  field.action=null;
  if(!writeSession()){
    if(field===current)field.action=previous;
    return {ok:false,message:'취소를 저장하지 못했습니다. 현재 치료를 확인하세요.'};
  }
  return {ok:true,message:'치료를 취소했습니다. 의료품은 가방에 남아 있습니다.'};
}
function completeInjuryTreatment(action) {
  field.action=null;
  settlementNeedsCommit=true;
  const index=field.bag.findIndex(u=>u.uid===action.uid && u.g===action.item);
  const effect=kitSupply(action.item);
  if(index<0 || effect?.stat!=='hp' || !hasInjury(action.part)){
    logField('치료 대상이나 물품이 달라져 치료를 종료했습니다.');return;
  }
  const gain=Math.min(100-field.hp,effect.gain);
  field.bag.splice(index,1);
  field.hp+=gain;
  injuryState.events.push({kind:'treat',part:action.part,at:action.end,uid:action.uid,item:action.item,gain});
  if(picked?.side==='bag' && picked.uid===action.uid)picked=null;
  const label=INJURY_PARTS.find(p=>p.id===action.part).label;
  logField(label+' 치료 완료 · '+kitName(action.item)+' 1개 사용 · 체력 +'+gain+'.');
}
function settleInjuries(summary) {
  if(injuryState && !injuryState.legacy){summary.injuries=injuryState;settlementNeedsCommit=true;}
  injuryState=null;
}

function validInjuryBackup(s) {
  const integer=Number.isSafeInteger;
  const uid=id=>typeof id==='string' && /^[a-z0-9_-]{1,100}$/i.test(id);
  function readEvents(state,raidId,end) {
    if(!state || state.raidId!==raidId || !integer(raidId) || raidId<1 ||
       typeof state.legacy!=='boolean' || !Array.isArray(state.events) ||
       state.events.length>1800 || state.legacy && state.events.length)return null;
    const used=new Set(),wounded=new Set();
    let at=raidId,hits=0;
    for(const e of state.events){
      if(!e || !integer(e.at) || e.at<at || e.at>end || !INJURY_PARTS.some(p=>p.id===e.part))return null;
      at=e.at;
      if(e.kind==='hit'){
        if(e.part!==INJURY_PARTS[hits++%INJURY_PARTS.length].id || !integer(e.damage) || e.damage<1 || e.damage>100)return null;
        wounded.add(e.part);
      }else if(e.kind==='treat'){
        if(!wounded.delete(e.part)|| !uid(e.uid) || used.has(e.uid) || !injuryItem(e.item) ||
           !integer(e.gain) || e.gain<0 || e.gain>medicalBaseGain(e.item)+3*FACILITIES.med.levels.length)return null;
        used.add(e.uid);
      }else return null;
    }
    return {used,wounded,at};
  }
  const r=s.raid,f=s.field,state=s.injuryState,report=s.lastSummary?.injuries;
  if(report!==undefined && (report?.legacy!==false || !readEvents(report,s.lastSummary.raidId,s.lastSummary.raidId+s.lastSummary.elapsed)))return false;
  if(!r || f.result)return state===null && f.action?.type!=='treat';
  const parsed=readEvents(state,r.startedAt,r.endsAt-1);
  if(!parsed || !Array.isArray(f.bag) || f.bag.some(u=>!u || parsed.used.has(u.uid)))return false;
  const a=f.action;
  if(a?.type!=='treat')return true;
  return !state.legacy && parsed.wounded.has(a.part) && uid(a.uid) && !parsed.used.has(a.uid) && injuryItem(a.item) &&
    integer(a.start) && integer(a.end) && a.start>=parsed.at && a.end<r.endsAt && a.end-a.start===TREATMENT_MS &&
    f.bag.filter(u=>u.uid===a.uid && u.g===a.item).length===1 && (!f.journey || Boolean(f.journey.event));
}
