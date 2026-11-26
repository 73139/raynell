(()=>{'use strict';const $=s=>document.querySelector(s),world=$('#world'),phone=$('#phone'),inside=$('#inside'),layer=$('#power-layer'),hits=$('#main-hits'),fade=$('#fade');const pages=['home','map','prep','presets','campaign','survivors','lootplan','barterhunt','maintenance','raid','inventory','health','journal','orders','bunker','facility','settings','catalog','stash','trade','traderQuests','messages','more'];
const zones=[['벙커 외곽','위험도 I'],['폐쇄 검문소','위험도 II'],['군수 보급 창고','위험도 III']];const items=[['응급 파우치','의료 보급품'],['물통','생활 보급품'],['통신 모듈','전자 장비'],['기록 카드','정보 물품']];let power='on',page='home',view='photo',busy=false,zone=0,item=0,large=false,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,bootTimer=0,lastButton=null;
try{const saved=JSON.parse(localStorage.getItem('rl-reboot-tc01-v03')||'{}');if(pages.some(p=>p===saved.page))page=saved.page;if(Number.isInteger(saved.zone)&&saved.zone>=0&&saved.zone<zones.length)zone=saved.zone;if(Number.isInteger(saved.item)&&saved.item>=0&&saved.item<items.length)item=saved.item;large=saved.large===true;if(typeof saved.reduce==='boolean')reduce=saved.reduce}catch{}function save(){if(updateRequired)return;try{localStorage.setItem('rl-reboot-tc01-v03',JSON.stringify({page,zone,item,large,reduce}))}catch{}}


// v0.7 field search / spatial inventory
const RAID_DURATION_MS=30*60*1000, RAID_KEY='rl-reboot-raid-v04', FIELD_KEY='rl-reboot-field-v06';
const FIELD_ZONES=[{name:'벙커 외곽',risk:'I',desc:'낡은 보급소와 폐기된 자재가 남아 있다.',boxes:[['외곽 보급 상자','crate','military'],['정비 사물함','locker','locker'],['방치된 배낭','bag','bag']]},{name:'폐쇄 검문소',risk:'II',desc:'경비 초소의 불이 꺼져 있다. 철제 보관함이 보인다.',boxes:[['경비 책상','desk','desk'],['탄약 보관함','crate','ammo'],['응급 케이스','med','med']]},{name:'군수 보급 창고',risk:'III',desc:'철제 선반 사이에 보급 상자와 장비가 쌓여 있다.',boxes:[['군용 보급 상자','crate','military'],['철제 사물함','locker','locker'],['버려진 배낭','bag','bag']]}];
[[["공구 상자","tool","toolbox"],["식량 보급 상자","crate","food"],["버려진 재킷","bag","jacket"]],[["경비실 금고","locker","safe"],["경비실 컴퓨터","radio","pc"],["문서 서랍","desk","drawer"]],[["산업용 자재 상자","crate","industrial"],["지하 은닉함","crate","cache"],["여행 가방","bag","suitcase"]]].forEach((xs,i)=>FIELD_ZONES[i].boxes.push(...xs));
const UI_ART=__DATA_UI_ART__;
const GOODS=__DATA_GOODS__;
const LOOT_TABLES=__DATA_LOOT_TABLES__;
const ITEM_META=__DATA_ITEM_META__;
const FACILITIES=__DATA_FACILITIES__;
const FACILITY_PRODUCTION=__DATA_PRODUCTION__;
const ICONS={search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',crate:'<rect x="2" y="5" width="20" height="15" rx="1"/><path d="M2 9h20M6 5v15m12-15v15M2 20l20-11"/>',locker:'<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M12 2v20M8 6h2m4 0h2m-7 5v3m6-3v3"/>',bag:'<rect x="5" y="5" width="14" height="17" rx="3"/><path d="M9 5V2h6v3M5 13h14M9 15v4h6v-4"/>',desk:'<path d="M2 8h20v4H2zM4 12v10m16-10v10M14 12v6h6M14 15h6"/>',med:'<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M9 6V3h6v3m-3 4v7m-4-3.5h8"/>',water:'<path d="M9 2h6v4l3 3v12H6V9l3-3zM6 12h12M6 17h12"/>',bandage:'<rect x="3" y="7" width="18" height="10" rx="4"/><path d="M9 7v10m6-10v10m-3-7v4"/>',food:'<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 4 14 4 14 0V5M5 10h14m-14 7h14"/>',tool:'<path d="M3 3l6 5-2 4-4-2 1 4 5 2 8 6 4-4-8-8 1-5-4-3-1 5-4-4z"/>',tape:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',radio:'<rect x="5" y="7" width="14" height="15" rx="2"/><path d="M8 7V2m0 9h8v4H8zM8 18h8"/>',card:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M12 10h6m-6 4h6M5 16h6"/>',ammo:'<rect x="2" y="6" width="20" height="12" rx="1"/><path d="M6 6v12m12-12v12M9 10h6m-6 4h6"/>'};
const ico=(name,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.crate}</svg>`;
let raid=null,field=null,raidStorageOK=true,lastRaidPhase='',picked=null,dragged=null,notice='';
const BOX_SIZE=[5,4];
const SAVE09='rl-reboot-session-v09';
let stash={},wallet=30000,lastSummary=null,exitNotice='',exitSig='';
const EXITS=[{id:'b04',name:'B-04 지하 벙커',zone:0,sec:10,rule:'free',desc:'상시 개방 · 별도 조건 없음'},{id:'truck',name:'군용 수송 차량',zone:1,sec:60,rule:'pay',desc:'15,000 CR 필요 · 성공 시 차감'},{id:'tunnel',name:'비상 정비 통로',zone:0,sec:15,rule:'empty',desc:'배낭 미착용 · 주머니와 착용 장비는 반출 가능'},{id:'security',name:'지하 보안 출입구',zone:2,sec:20,rule:'card',desc:'통제구역 키카드 소지 필요'},{id:'train',name:'군수 수송 열차',zone:2,sec:30,rule:'train',desc:'레이드마다 정해진 시간에 개방'},{id:'rescue',name:'긴급 구조 지점',zone:1,sec:30,rule:'radio',desc:'무전기 소지 필요'}];
const exitBy=id=>EXITS.find(e=>e.id===id);
function trainWindow(){const start=raid.startedAt+(10+Math.floor(raid.startedAt/1000)%5)*60000;return [start,start+5*60000]}
function exitCondition(e,now=Date.now()){return pointStatus(e,now,true)}
function finishRaid(result,at,exit=null){reconcileEnd(result,at,exit)}
function exitAvailability(exit, now) {
  const active = field.action;
  if (active?.type === 'extract' && active.exit === exit.id) {
    return pointStatus(exit, active.end, false);
  }
  return exitCondition(exit, now);
}
function exitForecast(exit, now) {
  const action = field.action;
  if (raid.zone !== exit.zone || exitAvailability(exit, now) ||
      (action && (action.type !== 'extract' || action.exit !== exit.id))) return '';
  const completion = action ? action.end : now + actionDuration('extract', exit.sec * 1000, now);
  const searched = Object.values(field.boxes).filter(box => box.complete).length;
  const elapsed=completion-raid.startedAt, victories=field.victories||0;
  const normal=qualifiesNormalExtraction(elapsed,searched,victories);
  const summary=normal?'예상 정산 · 정상 탈출 · 전리품 회수':'예상 정산 · 조기 탈출 · 전리품 회수 · 기본 25 XP';
  if(!career.order)return summary;
  const fare=exit.rule==='pay'?VEHICLE_EXIT_FEE:0;
  const award=bunkerOrderAward(normal,(wallet-fare)+cashSum(field.bag));
  if(!award)return summary;
  const {order,progress}=award;
  const reward=' · '+order.title+' · 의뢰 보상 ';
  if(award.payable)return summary+reward+money(order.cr)+' / '+order.xp+' XP';
  let detail='';
  if(progress<order.target)detail+=' · 목표 미달 · '+order.goal+' '+progress+'/'+order.target;
  else if(!normal)detail+=' · 의뢰 목표 충족 '+progress+'/'+order.target;
  if(!normal){
    detail+=' · 정상 탈출까지 (대기 종료 기준) 생존 '+formatRaid(NORMAL_EXTRACTION.elapsedMs-elapsed)+
      ' 추가 또는 컨테이너 '+(NORMAL_EXTRACTION.searched-searched)+'개 추가 수색 완료 또는 교전 '+
      (NORMAL_EXTRACTION.victories-victories)+'회 승리';
  }
  if(!award.fits)detail+=' · 보상 수령 후 잔액 한도 초과';
  return summary+reward+'0 CR / 0 XP'+detail;
}
function refreshExitForecasts() {
  if (view !== 'inside' || page !== 'raid' || !raid || field.result || field.open) return;
  const now = Date.now();
  for (const label of document.querySelectorAll('[data-exit-forecast]')) {
    const next = exitForecast(exitBy(label.dataset.exitForecast), now);
    if (label.textContent !== next) {
      label.textContent = next;
      label.hidden = !next;
    }
  }
}
function exitPanel() {
  const now = Date.now();
  const cards = EXITS.filter(exit => field.exits.includes(exit.id)).map(exit => {
    const here = raid.zone === exit.zone;
    const reason = exitAvailability(exit, now);
    const waiting = field.action?.type === 'extract' && field.action.exit === exit.id;
    const window = exit.rule === 'train' ? trainWindow().map(t => formatRaid(raid.endsAt - t)).join(' → ') : '';
    const forecast = here ? exitForecast(exit, now) : '';
    let fare = '';
    if (exit.rule === 'pay') {
      const carried = cashSum(field.bag);
      const balance = vehicleFareBalance(carried);
      const total = balance < 0 ? money(-balance) + ' 부족' : '요금 차감 후 ' + money(balance) + ' (의뢰 보상 전)';
      fare = '<p data-exit-fare>벙커 ' + money(wallet) + ' · 휴대 ' + money(carried) + '<br>' + total + '</p>';
    }
    const data = here ? 'data-field="extract" data-exit="' + exit.id + '"' : 'data-field="move" data-index="' + exit.zone + '"';
    return `<div class="exit-card"><div><span class="mono">EXIT / ${exit.id.toUpperCase()}</span><h3>${exit.name}</h3><p>${FIELD_ZONES[exit.zone].name} · ${exit.sec}초</p><p>${exit.desc}${window ? ' · 남은 레이드 시간 ' + window : ''}</p><b class="${reason ? 'exit-warn' : 'exit-ok'}">${reason || (waiting ? '탈출 대기 중' : '이용 가능')}</b>${fare}${here ? '<p data-exit-forecast="' + exit.id + '"' + (forecast ? '' : ' hidden') + '>' + esc(forecast) + '</p>' : ''}</div><button ${data} ${field.action || (here && reason) ? 'disabled' : ''}>${here ? (waiting ? '탈출 대기 중' : '탈출 시작') : '지역 이동 · ' + routeTimeLabel(raid.zone, exit.zone)}</button></div>`;
  }).join('');
  return `<section class="field-section"><h2>탈출구 <small>${field.exits.length}곳 배정</small></h2><p class="mini-field">탈출 위치로 이동한 뒤 대기 시간이 끝나야 귀환합니다. 탈출 비용은 성공 시 정산합니다.</p><div class="exit-list">${cards}</div>${exitNotice ? '<p class="exit-warn" role="status">' + exitNotice + '</p>' : ''}<button data-field="abandon" ${field.action ? 'disabled' : ''}>레이드 포기</button></section>`;
}
function summaryPage(){return resultPage()}
function stashPage(){return storagePage()}

function raidPhase(now=Date.now()){return !raid?'idle':field?.result||now>=raid.endsAt?'expired':'active'}
function raidRemaining(now=Date.now()){return raid&&!field?.result?Math.max(0,Math.min(RAID_DURATION_MS,raid.endsAt-now)):0}
function formatRaid(ms){const seconds=Math.ceil(Math.max(0,ms)/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
function getJSON(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch{raidStorageOK=false;return null}}
function putJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{raidStorageOK=false}}
function freshField(){return {raidId:raid?.startedAt||0,found:[[],[],[]],boxes:{},bag:[],modules:{},log:['작전 구역에 진입했다. 주변을 탐색하십시오.'],action:null,open:null,energy:100,water:100,result:null,visited:raid?[raid.zone]:[]}}
function loadRaid(){readSession()}
function persist(){
  const receipt=settlementNeedsCommit, before=field, saved=writeSession();
  if (receipt && !saved && field===before) {
    readSession();
    saveMessage=before.result?'정산 기록을 저장할 수 없어 마지막 저장 지점으로 돌아갔습니다.':'현장 행동을 저장할 수 없어 직전 상태로 돌아갔습니다.';
    notice=saveMessage;
  }
  settlementNeedsCommit=false;
  return saved;
}
function logField(s){field.log.unshift(s);field.log=field.log.slice(0,30)}
function boxKey(z,i){return `${z}-${i}`}
function weightedChoice(rows){let n=Math.random()*rows.reduce((a,b)=>a+b.relativeProbability,0);for(const r of rows){n-=r.relativeProbability;if(n<0)return r}return rows[rows.length-1]}
function makeBox(z,i){const key=boxKey(z,i),def=FIELD_ZONES[z].boxes[i],t=LOOT_TABLES[def[2]],size=t.size,slots=[];const count=weightedChoice(t.itemcountDistribution).count;for(let n=0;n<count;n++){const candidates=t.itemDistribution.map(r=>{const a=GOODS[r.tpl];let w=a[1],h=a[2],p=firstFit(slots,size,w,h);if(!p){[w,h]=[h,w];p=firstFit(slots,size,w,h)}return {...r,p,w,h}}).filter(r=>r.p);if(!candidates.length)break;const r=weightedChoice(candidates);slots.push({uid:`${key}-${n}`,g:r.tpl,w:r.w,h:r.h,...r.p,revealed:false,...(r.tpl==='rl_bp_dressing'?{sheetUid:newStashUid()}:{})})}return {key,size,items:slots,complete:false}}
function seedContainers(){if(!raid)return;FIELD_ZONES.forEach((z,zi)=>z.boxes.forEach((_,i)=>{const k=boxKey(zi,i);if(!field.boxes[k])field.boxes[k]=makeBox(zi,i)}))}
function fits(items,size,x,y,w,h,ignore){return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x+w<=size[0]&&y+h<=size[1]&&!items.some(o=>o.uid!==ignore&&x<o.x+o.w&&x+w>o.x&&y<o.y+o.h&&y+h>o.y)}
function firstFit(items,size,w,h,ignore){for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++)if(fits(items,size,x,y,w,h,ignore))return {x,y};return null}
function openBox(){
  if(!field.open || !raid)return null;
  const [z,i]=field.open.split('-').map(Number);
  return z===raid.zone && !lootBoxIsLocked(z,i) ? field.boxes[field.open] : null;
}
function isActive(){return raidPhase()==='active'}
function beginAction(type,ms,extra={}){
  const start=Date.now();
  if(raidPhase(start)!=='active'||field.action)return;
  field.action={type,start,end:start+actionDuration(type,ms,start),...extra};
  if(type==='scan')settlementNeedsCommit=true;
  persist();renderKeep();
}
function finishAction(a){
if(a.type==='treat'){completeInjuryTreatment(a);return}
if(a.type==='travel-step'){finishJourneyStep(a);return}
if(a.type==='engage'||a.type==='evade'){resolveEncounter(a);return}
if(a.type==='extract'){
  const e=exitBy(a.exit);
  if(e && raid.zone===e.zone && !pointStatus(e,a.end,false)) finishRaid('success',a.end,e);
  else{field.action=null;logField('탈출 조건이 변경되어 대기를 종료했습니다.')}
  return;
}
if(a.type==='scan'){wearSensors('scan');settlementNeedsCommit=true;}
if(a.type==='scan'){const z=raid.zone,arr=field.found[z],i=nextLandmarkBox(z);if(i>=0){arr.push(i);if(!field.boxes[boxKey(z,i)])field.boxes[boxKey(z,i)]=makeBox(z,i);logField(`${FIELD_ZONES[z].boxes[i][0]} 발견.`)}else logField('이 랜드마크의 수색 대상을 모두 발견했습니다.');field.energy=Math.max(0,field.energy-2);field.water=Math.max(0,field.water-1)}else if(a.type==='move'){raid.zone=a.zone;zone=a.zone;if(!field.visited.includes(a.zone))field.visited.push(a.zone);field.open=null;picked=null;logField(`${FIELD_ZONES[a.zone].name} 도착.`);field.energy=Math.max(0,field.energy-3)}else if(a.type==='search'){const b=a.key===field.open?openBox():null,i=b?.items.find(x=>x.uid===a.uid);if(i&&!i.revealed){wearSensors('search');i.revealed=true;logField(`${GOODS[i.g][0]} 확인.`)}if(b){const next=b.items.find(x=>!x.revealed);if(next&&a.single){field.action=null;return}if(next){field.action={type:'search',key:a.key,uid:next.uid,start:a.end,end:a.end+actionDuration('search',1800)};return}b.complete=true;logField('컨테이너 수색 완료. 물품을 획득할 수 있습니다.')}}field.action=null;encounterAfter(a)}
function reconcile(now=Date.now()){
  if(!writer)return false;
  const periodChanged=advanceRecurring(now);
  let changed=advanceHideout(now)||periodChanged;
  if(raid){
    while(!field.result && field.action && field.action.end<=now && field.action.end<raid.endsAt){
      advanceSurvivorScavenge(field.action.end-1);
      finishAction(field.action);
      changed=true;
    }
    if(advanceSurvivorScavenge(Math.min(now,raid.endsAt)))changed=true;
    if(now>=raid.endsAt && !field.result){finishRaid('expired',raid.endsAt);changed=true}
  }
  if(changed)persist();
  return changed;
}
function fieldControls(){let phase=raidPhase();return `<section id="raid-controls" aria-label="출격 관리">${phase==='active'?'<p>레이드 진행 중</p><button class="primary" data-page="raid">현장으로 복귀 ›</button>':phase==='expired'?'<p class="expired-text">레이드 종료 · 결과 확인</p><button data-page="raid">결과 확인</button>':'<p>출격 지역 · '+FIELD_ZONES[zone].name+' · 제한 시간 30분</p>'+equipmentDeployInfo()+'<p>7분 생존, 컨테이너 수색 2회, 교전 승리 1회 중 하나를 채우고 귀환하면 정상 탈출입니다.</p><button class="primary" data-raid="start">출격 시작</button>'}${raidStorageOK?'':'<p class="expired-text">브라우저 저장소 사용 불가 · 새로고침 후 복원 불가</p>'}</section>`}
let lastObjectiveTimeMilestone = 0;
function objectiveTimeMilestone(now) {
  // Only this survival condition can change a tracked field goal without an action.
  return objectivePin && raid && !field.result && qualifiesNormalExtraction(now-raid.startedAt,0,0) ? raid.startedAt : 0;
}
function updateRaidClock(){
  if(!field||updateRequired)return;
  updateHideoutClock();tickRecurringQuestUI();
  const changed=reconcile(),now=Date.now(),phase=raidPhase(now),bar=$('#raid-status');
  const milestone=objectiveTimeMilestone(now),objectiveTimeChanged=milestone!==lastObjectiveTimeMilestone;
  lastObjectiveTimeMilestone=milestone;
  const idle=phase==='idle',remaining=raidRemaining(now);
  inside.classList.toggle('raid-visible',!idle);
  if(bar.hidden!==idle)bar.hidden=idle;
  bar.classList.toggle('urgent',phase==='active'&&remaining<=300000);
  bar.classList.toggle('expired',phase==='expired'&&field.result!=='success');
  bar.classList.toggle('extracted',phase==='expired'&&field.result==='success');
  if(!idle){
    const clock=$('#raid-clock'),label=$('#raid-label'),zoneLabel=$('#raid-zone');
    const clockText=phase==='expired'&&field.result==='success'?'CLEAR':formatRaid(remaining);
    const labelText=phase==='expired'?(field.result==='success'?(lastSummary?.rating==='quick'?'조기 탈출':'탈출 성공'):
      field.result==='abandoned'?'레이드 포기':field.result==='kia'?'전투 불능':'시간 초과 · 레이드 종료'):'레이드 진행 중';
    const zoneText=field.journey?FIELD_ZONES[field.journey.to].name+' 방면':FIELD_ZONES[raid.zone].name;
    if(clock.textContent!==clockText)clock.textContent=clockText;
    if(label.textContent!==labelText)label.textContent=labelText;
    if(zoneLabel.textContent!==zoneText)zoneLabel.textContent=zoneText;
  }
  const a=field.action;
  if(a){
    const p=Math.min(100,Math.max(0,(now-a.start)/(a.end-a.start)*100));
    const el=$('#field-progress');if(el)el.style.width=p+'%';
    const tile=$('#tile-progress-fill');if(tile)tile.style.width=p+'%';
    const t=$('#field-seconds');if(t)t.textContent=(Math.max(0,a.end-now)/1000).toFixed(1)+'초';
  }
  const sig=phase==='active'?field.exits.map(id=>exitAvailability(exitBy(id),now)).join('|'):'';
  const statusChanged=exitSig!==sig;exitSig=sig;
  if((changed||objectiveTimeChanged||phase!==lastRaidPhase||(statusChanged&&page==='raid'&&!field.open))&&page!=='settings'&&!rendering){
    lastRaidPhase=phase;renderKeep();
  }else lastRaidPhase=phase;
  updateRouteDeadlineWarnings();refreshExitForecasts();tickSurvivorUI();tickWeatherUI();
}
function handleRaidAction(action,data={}){
  if(!writer)return;
  const selectedRaid=raid;
  reconcile();
  const phase=raidPhase(), launchingFinale=action==='start' && phase==='idle' && finaleState.armed;
  if(action==='ack'||action==='sale'){
    if(!selectedRaid)return;
    const openSale=action==='sale';
    if(openSale&&(page!=='raid'||Number(data.returnId)!==raid?.startedAt||
      !returnMarketOffers().some(offer=>offer.id===data.id&&offer.buyers.some(trader=>trader.id===data.trader))))return;
    let returned=false;
    raidAckFeedback='';
    if(selectedRaid.startedAt!==raid?.startedAt){
      raidAckFeedback='다른 탭의 최신 출격 기록을 불러왔습니다.';
    }else if(phase==='expired'&&field.result){
      const previousRaid=raid,previousField=field;
      raid=null;field=freshField();
      const clearedField=field;
      if(!writeSession()){
        if(field===clearedField){
          raid=previousRaid;field=previousField;
          raidAckFeedback='복귀 기록을 저장하지 못했습니다. 다시 시도하세요.';
        }else raidAckFeedback='다른 탭의 최신 출격 기록을 불러왔습니다.';
      }else returned=true;
      picked=null;
    }else if(phase==='expired'){
      raidAckFeedback='정산 기록을 저장한 뒤 다시 시도하세요.';
    }else return;
    page=raid?'raid':'bunker';
    if(openSale&&returned){
      marketSelectTrader(data.trader);marketUI.mode='sell';
      page='trade';
    }
    save();renderKeep();return;
  }
  if(action==='start'&&phase==='idle'){
    raidAckFeedback='';
    let now=Date.now();
    const priorIds=new Set([lastSummary?.raidId,survivorState.last?.raidId,campaignState.returnId,finaleState.reply?.raidId,...campaignState.claimed]);
    while(priorIds.has(now)) now++;
    raid={startedAt:now,endsAt:now+RAID_DURATION_MS,zone};
    field=freshField();startInjuries();startLootLocks(raid.startedAt);prepareLandmarks();
    field.landmarkByZone[raid.zone]=sortieSpawnLandmark(raid.zone);
    prepareSortie();startEquipmentRaid();startFinaleRaid(raid.startedAt);startSurvivorRaid(raid.startedAt,raid.zone);seedContainers();
    picked=null;notice='';gearNotice='';page='raid';
  }else return;
  const startedField=field;
  if(!persist() && action==='start' && phase==='idle'){
    if(field===startedField)readSession();
    page=raid?'raid':launchingFinale?'campaign':'prep';
    notice='출격을 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 출격하세요.';
    if(launchingFinale)campaignFeedback={ok:false,message:notice};
    else gearNotice=notice;
  }
  save();renderKeep();
}
function gridMarkup(items,size,side){
  const source=side==='loot', objective=source?resolveObjective():null;
  const placing=!source&&Boolean(picked&&selectedItem());
  const manual=placing&&picked.placing===true;
  let cells='';
  for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++){
    const pos=`class="slot" data-cell="${side}" data-x="${x}" data-y="${y}" style="grid-column:${x+1};grid-row:${y+1}"`;
    cells+=placing?`<button type="button" tabindex="-1" ${pos} aria-label="가방 ${x+1}열 ${y+1}행에 배치"></button>`:
      `<span ${pos} aria-hidden="true"></span>`;
  }
  const tiles=items.map(o=>{
    const g=GOODS[o.g],hidden=source&&!o.revealed,searching=hidden&&field.action?.uid===o.uid;
    const selected=picked?.uid===o.uid&&picked?.side===side;
    const hint=source&&!hidden?objectiveLootHint(o,objective):'';
    const pos=`data-tile-x="${o.x}" data-tile-y="${o.y}"`;
    const action=manual?'tabindex="-1"':hidden?(field.action?'disabled':'data-field="search"'):`draggable="true" data-pick="${esc(o.uid)}" data-side="${side}" aria-pressed="${Boolean(selected)}"`;
    const tracking=source&&!hidden&&lootPlan==='item/'+o.g?' · 도감 탐색 목표':'';
    const label=hidden?(searching?'수색 중':'미확인 물품 수색'):esc(g[0]+hint+tracking);
    const art=hidden?ico('search','search-symbol')+(searching?'<span class="tile-progress" aria-hidden="true"><i id="tile-progress-fill"></i></span>':''):
      `${itemArt(o.g,'item-symbol')}<span>${o.g==='cr_notes'?money(o.amount):g[0]}</span><small>${o.w}×${o.h}</small>${source?objectiveLootBadge(hint)+huntBadge(o):''}`;
    return `<button type="button" class="loot-tile ${hidden?'unknown':''} ${searching?'searching':''} ${selected?'chosen':''}" style="grid-column:${o.x+1}/span ${o.w};grid-row:${o.y+1}/span ${o.h}" ${pos} ${action} aria-label="${label}" ${hint?'title="'+label+'"':''}>${art}</button>`;
  }).join('');
  return `<div class="spatial-grid" data-grid="${side}" ${manual?'data-field-placing="true"':''} style="--cols:${size[0]};--rows:${size[1]}">${cells}${tiles}</div>`;
}
function fieldTileSelection(tile){
  const {pick:uid,side}=tile.dataset;
  const sameTile=picked?.uid===uid && picked.side===side;
  return {uid,side,rot:sameTile && picked.rot};
}
function selectedItem(){if(!picked)return null;return (picked.side==='bag'?field.bag:openBox()?.items||[]).find(x=>x.uid===picked.uid&&x.revealed)||null}
// Shared geometry for the selection preview, automatic pickup and explicit cell placement.
function transferPlacement(unit,fromBox,rot,x,y){
  const w=rot?unit.h:unit.w,h=rot?unit.w:unit.h,size=raidBagSize();
  const ignore=fromBox?undefined:unit.uid;
  const pos=x===undefined?firstFit(field.bag,size,w,h,ignore):{x,y};
  return {w,h,pos:pos&&fits(field.bag,size,pos.x,pos.y,w,h,ignore)?pos:null};
}
function lootPickupMarkup(unit){
  const current=transferPlacement(unit,true,picked.rot),alternate=transferPlacement(unit,true,!picked.rot);
  const blocked=!writer||!isActive()||field.contact||field.journey||field.action?.type==='extract'||
    field.bag.some(o=>o.uid===unit.uid)||(unit.g==='rl_bp_dressing'&&(!wardUid(unit.sheetUid)||field.bag.some(o=>o.uid===unit.sheetUid)));
  const ok=!blocked&&Boolean(current.pos),other=!blocked&&Boolean(alternate.pos);
  const detail=blocked?'현재 회수할 수 없습니다.':ok?'배치 가능 · '+(current.pos.y+1)+'행 '+(current.pos.x+1)+'열':other?'현재 방향은 공간 부족 · 회전 후 배치 가능':'회전해도 배치 불가 · 가방 공간을 정리하세요.';
  return '<span data-pickup-fit="'+ok+'" data-pickup-alternate="'+other+'">'+esc(detail)+'</span><button class="primary" data-field="take"'+(ok?'':' disabled')+'>가방에 넣기</button>';
}
function transfer(x,y){
  reconcile();
  if(!writer || !isActive() || field.contact || (field.journey && picked?.side!=='bag') || field.action?.type==='extract')return;
  const unit=selectedItem();
  if(!unit)return;
  const fromBox=picked.side==='loot', box=fromBox?openBox():null;
  if(fromBox && (!box || field.bag.some(item=>item.uid===unit.uid)))return;
  const {w,h,pos}=transferPlacement(unit,fromBox,picked.rot,x,y);
  if(!pos){
    notice='공간이 부족하거나 다른 물품과 겹칩니다.';renderKeep();return;
  }
  const beforeField=field, beforeBag=field.bag, beforeItems=box?.items, beforeLog=field.log.slice();
  const moved={...unit,...pos,w,h};
  if(fromBox){
    if(unit.g==='rl_bp_dressing'){
      if(!wardUid(unit.sheetUid) || field.bag.some(other=>other.uid===unit.sheetUid))return;
      moved.uid=unit.sheetUid;
      delete moved.sheetUid;
    }
    gearEnsureUnit(moved);
    box.items=box.items.filter(item=>item!==unit);
    field.bag=[...beforeBag,moved];
    logField(GOODS[unit.g][0]+' 가방에 넣음.');
  }else{
    field.bag=beforeBag.map(item=>item===unit?moved:item);
  }
  if(writeSession()){
    picked=null;notice='';
  }else if(field===beforeField){
    field.bag=beforeBag;
    if(box)box.items=beforeItems;
    field.log=beforeLog;
    notice='이동을 저장하지 못해 물품을 원래 칸에 두었습니다. 다시 시도하세요.';
  }else{
    picked=null;notice='다른 탭에서 갱신한 재고를 불러왔습니다.';
  }
  renderKeep();
}
function actionMarkup(){const a=field.action;if(!a)return '';return `<div class="field-progress"><div>${ico('search','search-symbol')} <b>${a.type==='scan'?'주변 탐색':(a.type==='move'||a.type==='travel-step')?'지역 이동':a.type==='extract'?'탈출 대기':a.type==='engage'?'교전':a.type==='evade'?'도주':a.type==='treat'?'부위 치료':'내용물 확인'} 중</b><span id="field-seconds"></span></div><div class="progress-track"><i id="field-progress"></i></div>${field.contact||field.journey?'':'<button data-field="cancel">취소</button>'}</div>`}
function bagPanel(){return `<section class="loot-panel"><div class="field-label"><span>PERSONAL INVENTORY</span><span data-bag-mass>${packMassLabel(field.bag)}</span></div><h2>${hasRaidBackpack()?"내 가방":"주머니"} <small>${raidBagSize().join(" × ")}</small></h2>${gridMarkup(field.bag,raidBagSize(),'bag')}<p class="mini-field">물품 선택 → 빈 칸 터치 / PC 드래그</p></section>`}
function fieldAppraisal(unit) {
  if (isCashUnit(unit)) return '액면 금액 '+money(unit.amount);
  if (unit.g===POSTAL_ITEM) return '의뢰 전용 화물 · 통행증 발급소에 인계';
  if (!MARKET_TRADERS.some(trader=>marketBuys(trader.id,unit.g))) return '벙커 상인 매입처 없음';
  const price=stashSalePrice(unit.g);
  if (unit.gear?.module) return '모듈 분리 후 본체 매입가 '+money(price);
  if (unit.contents?.length) return '보관함을 비운 후 본체 매입가 '+money(price);
  const slots=unit.w*unit.h;
  const perSlot=price/slots;
  const comparison=slots>1?' · 칸당 '+(Number.isInteger(perSlot)?'':'약 ')+money(Math.round(perSlot)):'';
  return '귀환 후 상인 매입가 '+money(price)+comparison;
}
function selectionPanel(){const o=selectedItem();return `<div class="selection-panel" role="status">${o?`<b>${GOODS[o.g][0]}</b><span>${picked.rot?o.h:o.w}×${picked.rot?o.w:o.h} · ${selectedMassMarkup(o)} · ${GOODS[o.g][5]} · <span data-field-appraisal>${fieldAppraisal(o)}</span></span><button data-field="rotate" aria-pressed="${picked.rot}">↻ 회전</button>${picked.side==='loot'?lootPickupMarkup(o):''}${page==='raid'&&openBox()?'<button data-field="place">가방에서 칸 지정</button>':''}${picked.side==="bag"?equipmentSelectionActions(o):''}<button data-db="lookup" data-id="${o.g}">도감</button><button data-field="unselect">선택 해제</button>`:'<span>물품을 선택하여 이동하십시오.</span>'}${notice?`<p class="expired-text">${notice}</p>`:''}</div>`}
function raidPage(){if(!raid)return head('FIELD / STANDBY','레이드 대기','작전 지도에서 출격하십시오.')+`<button class="primary" data-page="map">출격 준비</button>`;if(!isActive())return summaryPage();if(field.contact)return contactPage();if(field.journey)return journeyPage();const z=FIELD_ZONES[raid.zone],b=openBox(),a=field.action;const base=`<div class="field-metrics"><div>체력 <b>${field.hp}</b></div><div>기력 <b>${field.energy}</b></div><div>수분 <b>${field.water}</b></div><div>위험도 <b>${z.risk}</b></div></div>`;if(b)return lootView(b);
return `<div class="field-heading"><div><span class="mono">FIELD / SECTOR 0${raid.zone+1}</span><h1>${z.name}</h1></div><div class="field-links"><button data-page="map">작전 지도</button><button data-page="inventory">가방 ${field.bag.length}개</button></div></div>${base}${weatherBrief('field',raid.zone)}${injuryFieldBrief()}${gearReadinessMarkup(field, true)}${actionMarkup()}${landmarkPanel()}${routeChoicesPanel()}${exitPanel()}<section class="field-section"><h2>현장 기록</h2><div class="field-log">${field.log.slice(0,6).map((l,i)=>`<p><span>›</span> ${esc(l)}</p>`).join('')}</div></section>`}
function inventoryPage(){return equipmentPage()}
function handleField(d){reconcile();if(!isActive()){renderKeep();return}const a=field.action;
if(field.contact){
  if(!a && d.field==='engage')return beginGearEngage(d.slot);
  if(!a && d.field==='evade')beginAction('evade',2000,{escaped:Math.random()<ESCAPE_CHANCE});
  return;
}
if(field.journey&&!(picked?.side==='bag'&&['rotate','unselect'].includes(d.field)))return handleJourneyField(d);
if(d.field==='postal-pickup'||d.field==='postal-stamp')return handlePostal(d);
if(d.field==='survey-observe')return handleWeatherObservation(d);
if(d.field==='gauge-read'||d.field==='gauge-report')return handlePumpGauge(d);
switch(d.field){case 'landmark':return selectLandmark(Number(d.index));case 'extract':{const e=exitBy(d.exit);if(!e||a||raid.zone!==e.zone)return;const reason=exitCondition(e);if(reason){exitNotice=reason;renderKeep();return}field.open=null;picked=null;logField(`${e.name} 탈출 대기 시작.`);beginAction('extract',e.sec*1000,{exit:e.id});return}case 'abandon':if(!a&&confirm('레이드를 포기하면 현재 소지 물품을 모두 잃습니다. 계속합니까?')){finishRaid('abandoned',Date.now());persist();renderKeep()}return;case 'scan':if(nextLandmarkBox(raid.zone)<0)return;beginAction('scan',4000);return;case 'move':{const dest=Number(d.index);if(!a&&routeDistance(raid.zone,dest)){page='raid';save();startJourney(dest)}return}case 'open':{let i=Number(d.index);if(!a&&!field.open&&!lootBoxIsLocked(raid.zone,i)&&currentLandmark().boxes.includes(i)&&field.found[raid.zone].includes(i)){field.open=boxKey(raid.zone,i);loMobilePanel.loot=2;picked=null;notice=''}break}case 'close':if(a?.type==='search')field.action=null;field.open=null;picked=null;notice='';break;case 'search':{const b=openBox(),position=d.tileX!==undefined&&d.tileY!==undefined;
const o=b?.items.find(o=>!o.revealed&&(!d.uid||d.uid===o.uid)&&(!position||o.x===Number(d.tileX)&&o.y===Number(d.tileY)));
if((d.uid||position)&&!o)return;if(o&&!a){beginAction('search',1800,{key:b.key,uid:o.uid,...(d.uid||position?{single:true}:{})});return}if(b&&!a&&!o){b.complete=true;logField('컨테이너에 남은 물품이 없습니다.')}break}case 'cancel':if(a?.type==='treat'){const result=cancelInjuryTreatment();notice=result.message;renderKeep();return;}field.action=null;logField('행동 취소.');break;case 'place':return startFieldPlacement();case 'take':if(picked?.side==='loot')transfer();return;case 'rotate':if(picked)picked.rot=!picked.rot;break;case 'unselect':picked=null;notice='';break;}persist();renderKeep()}
/* @gameplay-modules */
let rendering=false, lastContentView='';
function contentView(){
  if(page!=='raid'||!raid)return page;
  if(field.result)return 'result';
  if(field.contact)return 'contact';
  if(field.journey)return 'journey-'+(field.journey.event||'moving');
  return field.open||'sector-'+raid.zone;
}
function renderKeep(){
  const c=$('.content'),scroll=c.scrollTop,previous=lastContentView;
  render();
  if(lastContentView===previous)c.scrollTop=scroll;
}



// Item catalog and selected facility.
let catalogQuery='',catalogCategory='',catalogOffset=0,catalogSelected=null,facilitySelected='power',facilityTier=1;
let craftCatalogOrigin=null;
let activeTerminalLink=null,pendingTerminalLink=false;
const terminalReturnViews=new WeakMap();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n.toLocaleString('ko-KR')+' CR';
function itemSources(id){return ITEM_META[id].lootSources.map(t=>LOOT_TABLES[t].name).join(' · ')}
function catalogRows(){return Object.entries(GOODS).filter(([id,g])=>(!catalogCategory||g[5]===catalogCategory)&&(!catalogQuery||[id,g[0],g[5],ITEM_META[id].usage,itemSources(id)].join(' ').toLowerCase().includes(catalogQuery.toLowerCase()))).sort((a,b)=>a[1][0].localeCompare(b[1][0],'ko'))}
function catalogResults(){const rows=catalogRows(),max=Math.max(0,Math.floor((rows.length-1)/24)*24);catalogOffset=Math.min(catalogOffset,max);return `<div class="db-summary"><span>${rows.length}종 · ${rows.length?catalogOffset+1:0}–${Math.min(catalogOffset+24,rows.length)}</span><button data-db="prev" ${catalogOffset===0?'disabled':''}>이전</button><button data-db="next" ${catalogOffset+24>=rows.length?'disabled':''}>다음</button></div><div class="db-list">${rows.slice(catalogOffset,catalogOffset+24).map(([id,g])=>`<button data-db="item" data-id="${id}" aria-pressed="${catalogSelected===id}">${ico(g[4])}<span><b>${g[0]}</b><small>${g[5]} · ${g[1]}×${g[2]} · ${g[3]} kg</small></span><span>${money(g[6])}</span></button>`).join('')||'<p>검색 결과가 없습니다.</p>'}</div>`}
function catalogDetail(){if(!catalogSelected||!GOODS[catalogSelected])return '<p>물품을 선택하면 루팅 장소와 시설 사용처가 표시됩니다.</p>';const id=catalogSelected,g=GOODS[id],m=ITEM_META[id];return `${craftCatalogOrigin?`<button type="button" data-db="craft-return">‹ ${facilityRecipe(craftCatalogOrigin.facility,craftCatalogOrigin.recipe).name} 작업으로</button>`:''}<div class="db-detail-title">${ico(g[4])}<div><h2>${g[0]}</h2><p>${g[5]} · ${m.rarity} (임시 밸런스)</p></div></div><p>${g[1]}×${g[2]} 칸 · ${g[3]} kg · ${exchangeRestricted(id)?'회수 평가액 ':''}${money(g[6])}</p><h3>사용처</h3><p>${m.usage}</p><h3>루팅 가능한 컨테이너</h3><p>${itemSources(id)||(id==='rl_craft_dressing'?'의무실 제작 전용':BARTER_RECIPES.some(r=>r.item===id)?'상인 물물교환으로 획득':'등록된 루팅 장소가 없습니다.')}</p>${catalogFieldDisclosure(id)}<h3>시설 건설에 쓰이는 단계</h3>${m.hideoutUses.length?m.hideoutUses.map(u=>`<button class="db-link" data-db="facility" data-id="${u.facility}" data-tier="${u.level}">${FACILITIES[u.facility].name} Lv.${u.level} · ${u.quantity}개 ›</button>`).join(''):'<p>이 물품을 요구하는 건설 단계가 없습니다.</p>'}<p class="mono">${id}</p>${supplyPanel(id)}`}
function catalogPage(){const cats=[...new Set(Object.values(GOODS).map(g=>g[5]))].sort((a,b)=>a.localeCompare(b,'ko'));return head('06 / ITEM DATABASE','물품 도감',Object.keys(GOODS).length+'종 물품 · 루팅 출처 및 시설 요구 재료 확인')+`${craftCatalogOrigin?'':'<button data-page="bunker">‹ 하이드아웃</button>'}<div class="db-layout"><section class="panel"><div class="db-filters"><label>이름 · 용도 · 컨테이너<input id="db-query" type="search" value="${esc(catalogQuery)}" placeholder="예: 정수 필터" autocomplete="off"></label><label>분류<select id="db-category"><option value="">전체 분류</option>${cats.map(c=>`<option ${catalogCategory===c?'selected':''}>${c}</option>`).join('')}</select></label></div><div id="db-results">${catalogResults()}</div></section><section class="panel" id="db-detail">${catalogDetail()}</section></div>`}
function facilityDetail(){return bunkerFacilityDetail()}
function bunkerPage(){return bunkerHubPage()}
function handleDB(d){
  if(d.db==='prev'||d.db==='next'){
    catalogOffset=Math.max(0,catalogOffset+(d.db==='next'?24:-24));$('#db-results').innerHTML=catalogResults();return;
  }
  if(d.db==='item'&&GOODS[d.id]){
    procurementNote='';catalogSelected=d.id;$('#db-detail').innerHTML=catalogDetail();$('#db-results').innerHTML=catalogResults();
    if(innerWidth<=700)$('#db-detail').scrollIntoView({block:'start'});return;
  }
  if(d.db==='craft-return'){
    if(page!=='catalog'||!craftCatalogOrigin)return;
    const {facility,tier,recipe,item}=craftCatalogOrigin;
    openBunkerFacility(facility,tier);
    const input=$(`[data-production-recipe="${recipe}"] [data-craft-input="${item}"]`);
    if(input){input.focus({preventScroll:true});input.scrollIntoView({block:'nearest'});}
    return;
  }
  if((d.db==='lookup'||d.db==='craft-ingredient')&&Object.hasOwn(GOODS,d.id)){
    if(d.db==='craft-ingredient'){
      const recipe=d.recipe===WARD_RECIPE?WARD_RECIPE:Number(d.recipe);
      if(page!=='facility'||d.facility!==facilitySelected||!facilityRecipeAvailable(d.facility,recipe))return;
      const inputs=facilityRecipe(d.facility,recipe).inputs;
      if(!Object.hasOwn(inputs,d.id)||stashUnfittedCount(d.id)>=inputs[d.id])return;
      craftCatalogOrigin={facility:d.facility,tier:facilityTier,recipe,item:d.id};
    }else craftCatalogOrigin=null;
    procurementNote='';catalogSelected=d.id;catalogQuery=GOODS[d.id][0];catalogCategory='';catalogOffset=0;
    page='catalog';save();render();
    if(craftCatalogOrigin){
      const back=$('[data-db="craft-return"]');back.focus({preventScroll:true});back.scrollIntoView({block:'start'});
    }else $('.content').scrollTop=0;
    return;
  }
  if(d.db==='facility'&&FACILITIES[d.id])return openBunkerFacility(d.id,Number(d.tier));
  if(d.db==='tier')return handleBunkerUI({bui:'tier',tier:d.tier});
}
inside.addEventListener('toggle',e=>{
  const details=e.target,id=details.dataset?.catalogSources;
  if(!id || !details.open || page!=='catalog' || catalogSelected!==id)return;
  const sites=details.querySelector('[data-catalog-sites]');
  if(!sites.hasChildNodes())sites.innerHTML=catalogFieldMarkup(id,huntRegions(id));
},true);
inside.addEventListener('input',e=>{if(e.target.id==='db-query'){catalogQuery=e.target.value;catalogOffset=0;$('#db-results').innerHTML=catalogResults()}});
inside.addEventListener('change',e=>{if(e.target.id==='db-category'){catalogCategory=e.target.value;catalogOffset=0;$('#db-results').innerHTML=catalogResults()}});

function head(code,title,desc){return `<div class="head"><span class="mono">${code}</span><h1>${title}</h1><p>${desc}</p></div>`}
function render(){
  if (updateRequired || deferPossessionRender() || deferPresetRender()) return;
  rendering=true;
  try{
    reconcile();
    inside.classList.toggle('large',large);
    document.documentElement.classList.toggle('reduce-motion',reduce);
    if(activeTerminalLink && !terminalLinkMatches())releaseTerminalLink();
    rememberTerminalView();
    if(page!=='catalog')craftCatalogOrigin=null;
    if(page!=='orders')fundingDossier=null;
    inside.dataset.page=page;
    const content=$('.content'),current=contentView();
    const scrollAreas=current===lastContentView&&(page==='inventory'||page==='stash'||page==='trade')?captureStashScroll():null;
    content.dataset.view=page;
    shellNavRender();
    const possessionEditor=capturePossessionEditor();
    const guideFocus=captureOnboardingFocus();
    const presetFocus=capturePresetFocus();
    const campaignFocus=captureCampaignFocus();
    const survivorFocus=captureSurvivorFocus();
    const injuryFocus=captureInjuryFocus();
    const maintenanceFocus=captureMaintenanceFocus();
    const lootFocus=captureLootPlanFocus();
    const fieldFocus=captureFieldLootFocus();
    const cartFocus=marketCartFocusSelector();
    const weatherFocus=weatherFocusSelector();
    const routeFocus=document.activeElement?.matches?.('[data-route-compare], [data-route-status]');
    const returnStatus=raidAckFeedback&&(page==='bunker'||(page==='raid'&&isActive()))?
      '<p role="status">'+esc(raidAckFeedback)+'</p>':'';
    content.innerHTML=onboardingPanel(page)+returnStatus+(page==='raid' && raid && !field.result ? finaleFieldPanel()+survivorFieldPanel() : '')+(screenViews[page]||commandHome)();
    if(scrollAreas?.size)restoreStashScroll(scrollAreas);
    restorePossessionEditor(possessionEditor);
    restoreOnboardingFocus(guideFocus);
    restorePresetFocus(presetFocus);
    restoreCampaignFocus(campaignFocus);
    restoreSurvivorFocus(survivorFocus);
    restoreLootPlanFocus(lootFocus);
    restoreFieldLootFocus(fieldFocus);
    restoreMaintenanceFocus(maintenanceFocus);
    restoreInjuryFocus(injuryFocus);
    if(cartFocus)(content.querySelector?.(cartFocus)||content.querySelector?.('[data-cart-panel]'))?.focus?.({preventScroll:true});
    if(weatherFocus)content.querySelector?.(weatherFocus)?.focus?.({preventScroll:true});
    if(routeFocus)content.querySelector?.('[data-route-compare], [data-route-status]')?.focus?.({preventScroll:true});
    if(current!==lastContentView){content.scrollTop=0;lastContentView=current}
    updateRaidClock();
  }finally{rendering=false}
}

function layout(){const w=innerWidth,h=innerHeight;const s=Math.min(w/864,h/1536);return {s,x:(w-864*s)/2,y:(h-1536*s)/2}}function transform(g){return `translate(${g.x}px,${g.y}px) scale(${g.s})`}function place(){if(!busy)phone.style.transform=transform(layout())}function zoom(){const g=layout(),s=Math.max(innerWidth/640,innerHeight/1312,g.s*1.35);return {s,x:innerWidth/2-433*s,y:innerHeight/2-735*s}}function motion(el,frames,ms){return el.animate(frames,{duration:reduce?0:ms,easing:'cubic-bezier(.3,.65,.2,1)',fill:'forwards'})}async function travel(direction,to=page){if(busy||power!=='on')return;busy=true;world.setAttribute('aria-busy','true');const entering=direction==='in';hits.inert=true;if(entering){lastButton=document.activeElement;page=to;save();render();const a=motion(phone,[{transform:transform(layout())},{transform:transform(zoom())}],760);const f=motion(fade,[{opacity:0,offset:0},{opacity:0,offset:.45},{opacity:1,offset:1}],760);await a.finished;inside.hidden=false;world.hidden=true;a.cancel();f.cancel();view='inside';const v=motion(inside,[{opacity:0},{opacity:1}],180);await v.finished;v.cancel();$('.content').focus({preventScroll:true});}else{inside.hidden=true;world.hidden=false;const a=motion(phone,[{transform:transform(zoom())},{transform:transform(layout())}],660);const f=motion(fade,[{opacity:1},{opacity:0}],500);await a.finished;a.cancel();f.cancel();view='photo';releaseTerminalLink();phone.style.transform=transform(layout());(lastButton&&lastButton.isConnected?lastButton:$('#start')).focus({preventScroll:true});}busy=false;hits.inert=false;world.removeAttribute('aria-busy');place();if(pendingTerminalLink){pendingTerminalLink=false;openTerminalLink()}else rememberTerminalView()}
function setPower(){document.documentElement.classList.toggle('reduce-motion',reduce);hits.hidden=power!=='on';layer.hidden=power==='on';if(power==='off'){layer.innerHTML='';$('#sidekey').setAttribute('aria-label','측면 전원 켜기')}else if(power==='boot'){layer.innerHTML='<div><p>RL-TC01 / SYSTEM BOOT</p><h1>RUSTLINE</h1><div class="boot-line"><i></i></div><p>단말기 초기화 중</p></div>'}else{$('#sidekey').setAttribute('aria-label','측면 전원 버튼');$('#start').focus({preventScroll:true})}$('#announce').textContent=power==='on'?'단말기 켜짐':power==='off'?'단말기 꺼짐':'단말기 부팅 중'}function powerToggle(){if(busy)return;clearTimeout(bootTimer);save();if(power==='on'||power==='boot'){power='off';setPower()}else{power='boot';setPower();bootTimer=setTimeout(()=>{power='on';setPower()},reduce?0:850)}}
world.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||busy)return;if(b.id==='sidekey'||b.hasAttribute('data-wake')||b.dataset.launch==='power')return powerToggle();const key=b.dataset.launch;if(key==='start')travel('in','home');else if(key==='bunker')travel('in','bunker');else if(key==='continue')travel('in',page);else if(key==='settings')travel('in','settings')});inside.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||busy)return;const d=b.dataset;if(d.injury)return handleInjuryUI(d);if(d.maintenance)return handleMaintenanceUI(d);if(d.lootplan)return handleLootPlanUI(d);if(d.survivor)return handleSurvivorUI(d);if(d.finale)return handleFinaleUI(d);if(d.campaign)return handleCampaignUI(d);if(d.preset)return handlePresetUI(d);if(d.guide)return handleOnboardingUI(d);if(d.pos)return handlePossessionsUI(d);if(d.objective)return handleObjectiveUI(d);if(d.contract)return handleContractUI(d);if(d.bh)return handleBarterHuntUI(d);if(d.tg)return handleTradeGridUI(d);if(d.cart)return handleMarketCartUI(d);if(d.market)return handleMarketUI(d);if(d.loadout)return handleLoadoutUI(d);if(d.bui)return handleBunkerUI(d);if(d.cui)return handleCommandUI(d);if(d.gear)return handleEquipment(d);if(d.order)return changeOrder(d.order);if(d.hideout)return handleHideout(d);if(d.supply)return buyMaterial(d.supply);if(d.backup==='export')return exportSave();if(d.backup==='import')return $('#restore-file').click();if(d.db)return handleDB(d);if(d.raid)return handleRaidAction(d.raid,d);if(d.field)return handleField(d);if(d.pick){if(!isActive())return;if(picked?.uid===d.pick&&picked.side===d.side)return;picked={uid:d.pick,side:d.side,rot:false};notice='';renderKeep();return}if(d.cell==='bag'&&picked){transfer(Number(d.x),Number(d.y));return}if(d.action==='shutdown'){save();inside.hidden=true;world.hidden=false;view='photo';place();powerToggle();return}if(d.action==='return')return travel('out');if(d.action==='lock'){setLock(true);return}if(d.action==='unlock'){setLock(false);return}if(d.page&&pages.includes(d.page))return navigatePage(d.page);if(d.zone!==undefined&&!raid&&Number.isInteger(Number(d.zone))&&FIELD_ZONES[Number(d.zone)]){zone=Number(d.zone);save();render();$(`[data-zone="${zone}"]`).focus()}if(d.item!==undefined){item=Number(d.item);save();render();$(`[data-item="${item}"]`).focus()}if(d.setting){if(d.setting==='large')large=!large;else reduce=!reduce;save();render();$(`[data-setting="${d.setting}"]`).focus()}});inside.addEventListener('dblclick',e=>{const b=e.target.closest('[data-pick][data-side=loot]');if(b&&isActive()&&!field.contact){picked=fieldTileSelection(b);transfer()}});inside.addEventListener('dragstart',e=>{const b=e.target.closest('[data-pick]');if(!b||!isActive())return;dragged=fieldTileSelection(b);e.dataTransfer.setData('text/plain',b.dataset.pick);e.dataTransfer.effectAllowed='move'});inside.addEventListener('dragover',e=>{if(dragged&&e.target.closest('[data-grid=bag]')){e.preventDefault();e.dataTransfer.dropEffect='move'}});inside.addEventListener('drop',e=>{const g=e.target.closest('[data-grid=bag]');if(!g||!dragged)return;e.preventDefault();const r=g.getBoundingClientRect(),x=Math.floor((e.clientX-r.left-1)/(g.clientWidth/raidBagSize()[0])),y=Math.floor((e.clientY-r.top-1)/(g.clientHeight/raidBagSize()[1]));picked=dragged;dragged=null;transfer(x,y)});inside.addEventListener('dragend',()=>{dragged=null});function setLock(on){$('#lock').hidden=!on;for(const sel of ['.topbar','.body','.foot'])$(sel).inert=on;if(on)$('#lock button').focus();else $('.content').focus()}document.addEventListener('keydown',e=>{if(e.key==='Escape'&&view==='inside'&&!busy){if(!$('#lock').hidden){setLock(false)}else travel('out')}});setInterval(updateRaidClock,250);document.addEventListener('visibilitychange',updateRaidClock);window.addEventListener('focus',updateRaidClock);window.addEventListener('storage',e=>{if(e.key===SAVE_KEY||(!writer&&revision===0&&PREVIOUS_SAVE_KEYS.includes(e.key))||e.key===null){loadRaid();picked=null;updateRaidClock();if(view==='inside')renderKeep()}});startSession();
function terminalLinkTarget(hash){
  if(hash==='#guide')return onboardingView().mode==='active'?(raid?'raid':'home'):'settings';
  return {'#clinic':'facility','#health':'health','#maintenance':'maintenance','#lootplan':'lootplan','#barterhunt':'barterhunt',
    '#survivors':'survivors','#campaign':'campaign','#presets':'presets','#map':'map','#routes':'map','#weather':'map',
    '#shop':'trade','#cart':'trade','#quests':'traderQuests','#stash':'stash','#daily':'traderQuests','#weekly':'traderQuests'}[hash];
}
function terminalLinkMatches(){
  const {hash,target}=activeTerminalLink;
  if(page!==target)return false;
  if(hash==='#clinic')return facilitySelected==='med';
  if(hash==='#guide')return target===terminalLinkTarget(hash);
  if(hash==='#cart')return marketUI.mode==='buy'&&marketUI.trader===marketCartSeller();
  if(target==='traderQuests')return contractPanel.mode===(hash==='#quests'?'standing':hash.slice(1));
  return true;
}
function replaceTerminalFragment(hash){
  const {history,location}=window;
  if(!history?.replaceState || !location)return;
  try{
    if(location.hash!==hash)history.replaceState(history.state,'',location.href.split('#')[0]+hash);
    activeTerminalLink=hash?{hash,target:terminalLinkTarget(hash)}:null;
  }catch{/* Embedded terminals may have restricted access to browser history. */}
}
// The address can leave a shared destination without losing how this browser entry was opened.
const terminalReloadKey='rl-terminal-reload-v1';
function terminalReloadLink(remember=''){
  const {history,location,navigation,performance}=window;
  if(!performance?.getEntriesByType)return '';
  const key=navigation?.currentEntry?.key;
  if(key){
    try{
      const name=terminalReloadKey+':'+key+':'+location.href;
      if(remember){window.sessionStorage.setItem(name,remember);return remember;}
      const saved=window.sessionStorage.getItem(name);
      if(saved)return saved;
    }catch{/* A storage-restricted tab can still use its own History entry. */}
  }
  try{
    const state=history.state;
    if(!remember)return state?.[terminalReloadKey]?.url===location.href?state[terminalReloadKey].hash:'';
    if(state===null||Object.getPrototypeOf(state)===Object.prototype){
      history.replaceState({...state,[terminalReloadKey]:{url:location.href,hash:remember}},'',location.href);
    }
  }catch{/* Restricted frames can continue using explicit links. */}
  return '';
}
function restoreTerminalReloadLink(){
  const kind=window.navigation?.activation?.navigationType||window.performance?.getEntriesByType?.('navigation')[0]?.type;
  if(updateRequired||window.location?.hash||kind!=='reload')return;
  const hash=terminalReloadLink();
  if(typeof hash==='string'&&hash.startsWith('#')&&terminalLinkTarget(hash))replaceTerminalFragment(hash);
}
function releaseTerminalLink(){
  const previous=activeTerminalLink;
  activeTerminalLink=null;
  if(previous && window.location?.hash===previous.hash){
    replaceTerminalFragment('');
    if(!window.location.hash)terminalReloadLink(previous.hash);
  }
}
function markMapSection(hash){
  if(page==='map' && activeTerminalLink?.target==='map' && activeTerminalLink.hash!==hash)replaceTerminalFragment(hash);
}
// Native entries identify a hashless return destination without changing host history.state.
function rememberTerminalView(){
  const entry=window.navigation?.currentEntry;
  if(!entry||window.location?.hash!=='')return;
  terminalReturnViews.set(entry,{view,page,facility:facilitySelected,tier:facilityTier,questMode:contractPanel.mode});
}
function openTerminalLink(){
  if(updateRequired)return;
  if(busy){pendingTerminalLink=true;return;}
  const hash=window.location?.hash,entry=window.navigation?.currentEntry;
  const previous=!hash&&entry?terminalReturnViews.get(entry):null;
  const target=previous?.page||terminalLinkTarget(hash);
  if(!target)return;
  activeTerminalLink=previous?null:{hash,target};
  if(previous?.view==='photo'){
    if(view==='inside')travel('out');
    return;
  }
  if(view==='photo'){
    world.hidden=true;inside.hidden=false;view='inside';
  }
  if(previous){
    if(target==='facility'){openBunkerFacility(previous.facility,previous.tier);return;}
    if(target==='traderQuests')setTraderQuestMode(previous.questMode);
    navigatePage(target);
    return;
  }
  if(hash==='#clinic'){
    openBunkerFacility('med');$('.content').focus({preventScroll:true});return;
  }
  if(target==='traderQuests')setTraderQuestMode(hash==='#daily'?'daily':hash==='#weekly'?'weekly':'standing');
  if(hash==='#cart')openMarketCartLink();
  navigatePage(target);
  if(hash==='#cart')marketCartFocus($('[data-cart-panel]'));
  if(hash==='#routes')focusRouteOverview();
  if(hash==='#weather')focusWeatherBoard();
}
window.addEventListener('hashchange',openTerminalLink);
restoreTerminalReloadLink();
openTerminalLink();
updateRaidClock();window.addEventListener('resize',place);document.documentElement.classList.toggle('reduce-motion',reduce);place();})();
