// Route time is measured from deployment. The save contains observations and decisions,
// while public views expose only evidence the player discovered on the ground.
const SURVIVOR_STOPS = [
  {arrive:0, depart:90000},
  {arrive:105000, depart:405000},
  {arrive:425000, depart:1680000}
];
const SURVIVOR_ROUTES = [[0,1,2],[1,2,0],[2,0,1]];
const SURVIVOR_NAME = '기록 운반원 은서';
const SURVIVOR_AID = {item:'water', reward:6000};
let survivorState = {active:null,last:null};

function survivorClueSpec(record,step,kind) {
  const route=SURVIVOR_ROUTES[record.origin], stop=SURVIVOR_STOPS[step];
  const zone=route[step], to=kind==='cloth' ? route[step+1] ?? null : null;
  const boots=kind==='boots';
  const text=boots ? '굽 한쪽이 닳은 발자국이 이 권역 대기소 안쪽으로 이어진다.'
    : to===null ? '마지막 천 매듭이 권역 밖으로 난 길에 걸려 있다.'
    : '뜯긴 푸른 천이 '+FIELD_ZONES[to].name+' 방면의 길목에 묶여 있다.';
  return {id:kind+'-'+step,kind,title:boots?'닳은 장화 자국':'푸른 천 매듭',zone,to,
    at:record.raidId+(boots?stop.arrive:stop.depart),text};
}
function survivorClueSpecs(record) {
  return SURVIVOR_STOPS.flatMap((_,step)=>['boots','cloth'].map(kind=>survivorClueSpec(record,step,kind)));
}
function survivorLocalLead(record,step,time) {
  return record.clues.some(c => (c.id==='boots-'+step || (step>0 && c.id==='cloth-'+(step-1))) &&
    c.decision==='follow' && c.chosenAt<=time);
}
function validSurvivorRecord(record) {
  const object=o=>o && typeof o==='object' && !Array.isArray(o);
  if (!object(record) || !Number.isSafeInteger(record.raidId) || record.raidId<=0 ||
      !Number.isSafeInteger(record.raidId+RAID_DURATION_MS) ||
      !Number.isInteger(record.origin) || !SURVIVOR_ROUTES[record.origin] ||
      !Array.isArray(record.clues) || record.clues.length>6 ||
      !Array.isArray(record.meetings) || record.meetings.length>SURVIVOR_STOPS.length) return false;
  const inRaid=t=>Number.isSafeInteger(t) && t>=record.raidId && t<record.raidId+RAID_DURATION_MS;
  const specs=survivorClueSpecs(record), keys=new Set();
  let prior=record.raidId;
  for(const c of record.clues) {
    if (!object(c) || keys.has(c.id) || !inRaid(c.at) || c.at<prior) return false;
    const spec=specs.find(row=>row.id===c.id);
    if (!spec || c.at<spec.at) return false;
    if (![null,'follow','pass'].includes(c.decision)) return false;
    if (c.decision===null ? (c.chosenAt!==null || c.firstFollow!==null) :
        (!inRaid(c.chosenAt) || c.chosenAt<c.at)) return false;
    if (c.firstFollow!==null && (!inRaid(c.firstFollow) || c.firstFollow<c.at || c.firstFollow>c.chosenAt)) return false;
    if (c.decision==='follow' && c.firstFollow===null) return false;
    prior=c.at;keys.add(c.id);
  }
  let lastStep=-1;
  for(const meeting of record.meetings) {
    if (!object(meeting) || !Number.isInteger(meeting.step) || !SURVIVOR_STOPS[meeting.step] ||
        meeting.step<=lastStep || !inRaid(meeting.at)) return false;
    const step=meeting.step, stop=SURVIVOR_STOPS[step], elapsed=meeting.at-record.raidId;
    if (elapsed<stop.arrive || elapsed>=stop.depart) return false;
    if (!record.clues.some(c=>(c.id==='boots-'+step || (step>0 && c.id==='cloth-'+(step-1))) &&
        c.firstFollow!==null && c.firstFollow<=meeting.at &&
        (c.decision!=='pass' || c.chosenAt>=meeting.at))) return false;
    lastStep=step;
  }
  const d=record.choice;
  if (d===null) return true;
  if (!object(d) || !['help','decline'].includes(d.kind) || !inRaid(d.at)) return false;
  const m=record.meetings.find(row=>row.step===d.step);
  return Boolean(m && d.at>=m.at && d.at<record.raidId+SURVIVOR_STOPS[m.step].depart);
}
function survivorLastAction(record) {
  return Math.max(record.raidId,record.choice?.at ?? 0,...record.meetings.map(m=>m.at),
    ...record.clues.map(c=>Math.max(c.at,c.chosenAt ?? 0)));
}
function validSurvivorBackup(s) {
  const state=s?.survivor;
  if (!state || typeof state!=='object' || Array.isArray(state)) return false;
  const {active,last}=state;
  if ((active!==null && !validSurvivorRecord(active)) || (last!==null && !validSurvivorRecord(last))) return false;
  if (active) {
    if (!s.raid || active.raidId!==s.raid.startedAt || s.field?.result ||
        !Array.isArray(s.field?.visited) || active.origin!==s.field.visited[0] ||
        active.raidId===s.lastSummary?.raidId || active.raidId===last?.raidId) return false;
    const route=SURVIVOR_ROUTES[active.origin], specs=survivorClueSpecs(active);
    if (active.meetings.some(m=>!s.field.visited.includes(route[m.step])) ||
        active.clues.some(c=>!s.field.visited.includes(specs.find(row=>row.id===c.id).zone))) return false;
  }
  if (last) {
    const report=s.lastSummary;
    if (!report || last.raidId!==report.raidId || !Number.isSafeInteger(report.elapsed) ||
        survivorLastAction(last)>report.raidId+report.elapsed || (s.raid?.startedAt===last.raidId && !s.field?.result)) return false;
    const visited=new Set([last.origin]);
    for(const c of last.clues)visited.add(survivorClueSpecs(last).find(row=>row.id===c.id).zone);
    for(const m of last.meetings)visited.add(SURVIVOR_ROUTES[last.origin][m.step]);
    if (!Number.isInteger(report.visited) || visited.size>report.visited) return false;
  }
  return true;
}
function loadSurvivor(raw) {
  const copy=r=>r && validSurvivorRecord(r) ? {raidId:r.raidId,origin:r.origin,
    clues:r.clues.map(c=>({...c})),meetings:r.meetings.map(m=>({...m})),choice:r.choice && {...r.choice}} : null;
  survivorState={active:copy(raw?.active),last:copy(raw?.last)};
}
function startSurvivorRaid(raidId,originZone) {
  survivorState={...survivorState,active:{raidId,origin:originZone,clues:[],meetings:[],choice:null}};
}
function finishSurvivorRaid(raidId) {
  if (survivorState.active?.raidId!==raidId) return;
  survivorState={active:null,last:survivorState.active};
}
function survivorDialogue(record,step) {
  const first=record.meetings[0];
  if (!first || first.step===step) return '“은서입니다. 기록을 다른 구역으로 옮기는 중이에요. 물통 하나만 나눠 주실 수 있나요?”';
  if (record.choice && record.choice.step<step) return record.choice.kind==='help'
    ? '“아까 건네주신 물, 잘 마셨어요. 덕분에 이 기록을 여기까지 가져왔습니다.”'
    : '“다시 만났군요. 아까 물을 아껴야 한다고 했죠. 저는 잠시 쉬었다 갈게요.”';
  return '“조금 전 대기소에서 만났죠? 물을 구하고 있어요. 물통 하나면 충분합니다.”';
}
function survivorView(now=Date.now()) {
  const live=Boolean(raid && !field.result), rec=live?survivorState.active:survivorState.last;
  const mode=live ? (rec && rec.raidId===raid.startedAt?'field':'legacy') : (rec?'archive':'empty');
  let blocked='';
  if(mode!=='field')blocked=mode==='legacy'?'다음 출격에서 현장 흔적을 조사할 수 있습니다.':'출격 중에 현장 흔적을 조사할 수 있습니다.';
  else if(!writer)blocked='플레이 중인 탭에서 진행하세요.';
  else if(now>=raid.endsAt)blocked='출격 시간이 끝났습니다.';
  else if(now<survivorLastAction(rec))blocked='현장 기록의 마지막 시각을 확인하고 있습니다.';
  else if(field.contact)blocked='조우에 대응한 뒤 조사하세요.';
  else if(field.journey || field.action)blocked='현재 이동이나 행동을 마친 뒤 조사하세요.';
  else if(field.open)blocked='열어 둔 상자를 닫고 조사하세요.';
  const view={mode,raidId:rec?.raidId ?? null,zone:live?raid.zone:null,blocked,
    canObserve:!blocked,clues:[],encounter:null,meetings:[],choice:rec?.choice?.kind ?? null,
    reward:rec?.choice?.kind==='help'?SURVIVOR_AID.reward:0};
  if (!rec || mode==='legacy') return view;
  const specs=survivorClueSpecs(rec),route=SURVIVOR_ROUTES[rec.origin];
  view.clues=rec.clues.map(c=>({...specs.find(row=>row.id===c.id),foundAt:c.at,decision:c.decision,chosenAt:c.chosenAt,
    canFollow:!blocked && c.decision!=='follow',canPass:!blocked && c.decision!=='pass'}));
  view.meetings=rec.meetings.map(m=>({id:rec.raidId+'-'+m.step,name:SURVIVOR_NAME,zone:route[m.step],
    at:m.at,text:survivorDialogue(rec,m.step)}));
  if (mode!=='field') return view;
  const step=route.indexOf(raid.zone),stop=SURVIVOR_STOPS[step], elapsed=now-rec.raidId;
  if (!stop || elapsed<stop.arrive || elapsed>=stop.depart) return view;
  const met=rec.meetings.some(m=>m.step===step);
  if(!met && !survivorLocalLead(rec,step,now))return view;
  const hasWater=field.bag.some(u=>u.g===SURVIVOR_AID.item);
  let dialogue=met?survivorDialogue(rec,step):'따라온 흔적이 대기소 안으로 이어진다. 인기척이 들린다.';
  if(met && rec.choice?.step===step)dialogue=rec.choice.kind==='help'
    ? '“고마워요. 물값은 지금 송금했어요. 다음 구역에서 또 만날지 모르겠네요.”'
    : '“알겠습니다. 남은 물은 챙겨 두세요. 저도 조금 더 찾아볼게요.”';
  view.encounter={token:rec.raidId+'-'+step,name:rec.meetings.length?SURVIVOR_NAME:'흔적의 주인',
    zone:raid.zone,text:dialogue,met,canMeet:!blocked && !met,canHelp:!blocked && met && !rec.choice && hasWater,
    canDecline:!blocked && met && !rec.choice,hasWater,decision:rec.choice?.kind ?? null,
    departAt:met ? rec.raidId+stop.depart : null};
  return view;
}
function survivorAction(action,expectedRaidId,token) {
  const failed=message=>({ok:false,message});
  if(!writer)return failed('플레이 중인 탭에서 진행하세요.');
  const previous=survivorState;
  reconcile();
  if(previous!==survivorState)return failed('현장 기록이 갱신되었습니다. 다시 확인하세요.');
  const now=Date.now(), v=survivorView(now), rec=previous.active;
  if(v.mode!=='field' || expectedRaidId!==rec.raidId)return failed('현재 출격의 현장 기록을 확인하세요.');
  if(v.blocked)return failed(v.blocked);
  let next={...rec},message,donated=null;
  if(action==='observe') {
    if(token!==String(raid.zone))return failed('현재 권역에서 다시 조사하세요.');
    const already=new Set(rec.clues.map(c=>c.id));
    const visible=survivorClueSpecs(rec).filter(c=>c.zone===raid.zone && c.at<=now && !already.has(c.id));
    if(!visible.length)return failed('현재 위치에서 새로 발견한 흔적이 없습니다.');
    next.clues=rec.clues.concat(visible.map(c=>({id:c.id,at:now,decision:null,chosenAt:null,firstFollow:null})));
    message=visible.map(c=>c.title).join(' · ')+' 발견. 흔적을 따라가거나 지나칠 수 있습니다.';
  }else if(action==='follow' || action==='pass') {
    const clue=rec.clues.find(c=>c.id===token);
    if(!clue || clue.decision===action)return failed('이미 처리했거나 발견하지 않은 흔적입니다.');
    next.clues=rec.clues.map(c=>c===clue?{...c,decision:action,chosenAt:now,
      firstFollow:action==='follow'?(c.firstFollow ?? now):c.firstFollow}:c);
    message=action==='follow'?'흔적의 방향을 기록했습니다. 현장에서 이어지는 단서를 확인하세요.':'흔적을 지나쳤습니다. 기록에서 다시 따라갈 수 있습니다.';
  }else{
    const e=v.encounter;
    if(!e || token!==e.token)return failed('지금 이곳에서 확인한 흔적을 따라가세요.');
    const step=SURVIVOR_ROUTES[rec.origin].indexOf(raid.zone);
    if(action==='meet' && e.canMeet) {
      next.meetings=rec.meetings.concat({step,at:now});
      message=SURVIVOR_NAME+'와 대화했습니다.';
    }else if(action==='help' && e.canHelp) {
      if(!cashCanCredit(SURVIVOR_AID.reward))return failed('보상 수령 후 보유 한도를 초과합니다.');
      donated=field.bag.find(u=>u.g===SURVIVOR_AID.item);
      next.choice={kind:'help',step,at:now};
      message='물통 1개를 건네고 '+money(SURVIVOR_AID.reward)+'을 받았습니다.';
    }else if(action==='decline' && e.canDecline) {
      next.choice={kind:'decline',step,at:now};message='이번에는 물통을 건네지 않았습니다.';
    }else return failed(action==='help' && !e.hasWater && !e.decision?'휴대 가방에 물통 1개가 필요합니다.':'현재 상태에서 처리할 수 없는 요청입니다.');
  }
  const originalBag=field.bag, originalWallet=wallet;
  if(donated){field.bag=field.bag.filter(u=>u!==donated);wallet+=SURVIVOR_AID.reward;}
  const proposed={...previous,active:next};survivorState=proposed;
  if(writeSession()) {
    if(donated){
      if(picked?.uid===donated.uid)picked=null;
      if(dragged?.uid===donated.uid)dragged=null;
      if(gearPick?.uid===donated.uid)gearPick=null;
    }
    return {ok:true,message};
  }
  if(survivorState!==proposed)return failed('다른 탭의 최신 현장 기록을 불러왔습니다.');
  field.bag=originalBag;wallet=originalWallet;survivorState=previous;
  return failed('현장 기록을 저장할 수 없어 직전 상태로 복원했습니다. 다시 시도하세요.');
}
