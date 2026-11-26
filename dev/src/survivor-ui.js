// Only the knowledge projection is rendered. The patrol route and future stops stay in the simulation.
let survivorFeedback=null, survivorPaint='', survivorCheckedAt=-1;

function clearSurvivorFeedback(){
  survivorFeedback=null;
  survivorPaint='';
  survivorCheckedAt=-1;
}
function survivorZoneName(zoneId){return FIELD_ZONES[zoneId]?.name||'';}
function survivorNavLink(){
  return '<div class="sv-nav"><button type="button" data-page="survivors">'+menuIcon('journal')+
    '<span>생존자 관측 수첩</span><i aria-hidden="true">›</i></button></div>';
}
function survivorButton(action,label,token,v,disabled=false,primary=false){
  return '<button type="button" data-survivor="'+esc(action)+'" data-token="'+esc(token)+'" data-raid-id="'+v.raidId+
    '"'+(primary?' class="primary"':'')+(disabled||!writer?' disabled':'')+'>'+esc(label)+'</button>';
}
function survivorTime(at,v){
  const elapsedSeconds=Math.max(0,Math.floor((at-v.raidId)/1000));
  return '출격 +'+formatRaid(elapsedSeconds*1000);
}
function survivorClue(clue,v){
  const choice=clue.decision, current=v.mode==='field';
  const age=Math.max(0,Math.floor((clue.foundAt-clue.at)/1000));
  const info=[survivorZoneName(clue.zone),survivorTime(clue.foundAt,v)+' 발견',age<5?'방금 남긴 흔적':'발견 당시 약 '+(age<60?age+'초':Math.floor(age/60)+'분')+' 전 흔적'];
  if(Number.isInteger(clue.to))info.push(survivorZoneName(clue.to)+' 방면');
  if(choice&&Number.isSafeInteger(clue.chosenAt))info.push(survivorTime(clue.chosenAt,v)+(choice==='follow'?' 추적':' 지나침'));
  const buttons=current?'<div class="sv-actions">'+
    (choice!=='follow'?survivorButton('follow',choice==='pass'?'다시 추적':'흔적 추적',clue.id,v,!clue.canFollow,true):'')+
    (choice!=='pass'?survivorButton('pass',choice==='follow'?'추적 중단':'지나치기',clue.id,v,!clue.canPass):'')+'</div>':'';
  return '<li class="sv-clue" data-sv-clue data-kind="'+esc(clue.kind)+'" data-decision="'+esc(choice||'')+'">'+
    '<header><h3>'+esc(clue.title)+'</h3>'+(choice?'<span class="sv-mark">'+(choice==='follow'?'추적 선택':'지나침')+'</span>':'')+'</header>'+
    '<div class="sv-meta">'+info.filter(Boolean).map(x=>'<span>'+esc(x)+'</span>').join('')+'</div>'+
    '<p>'+esc(clue.text)+'</p>'+buttons+'</li>';
}
function survivorEncounter(v){
  const e=v.encounter;
  if(!e||v.mode!=='field')return '';
  if(!e.met)return '<section class="sv-contact" data-sv-encounter><h3>흔적 끝에서</h3><p>'+esc(e.text||'근처에서 사람의 기척이 들립니다.')+'</p><div class="sv-actions">'+
    survivorButton('meet','말 걸기',e.token,v,Boolean(v.blocked)||!e.canMeet,true)+'</div></section>';
  const request=e.canHelp||e.canDecline;
  const buttons=request?'<div class="sv-actions">'+survivorButton('help','물통 1개 건네기',e.token,v,Boolean(v.blocked)||!e.canHelp,true)+
    survivorButton('decline','도움 거절',e.token,v,Boolean(v.blocked)||!e.canDecline)+'</div>':'';
  const bill=request?'<p class="sv-terms"><b>물통 1개</b> · '+(e.hasWater?'휴대 중':'가방에 없음')+' · 사례금 '+money(SURVIVOR_AID.reward)+'</p>':'';
  return '<section class="sv-contact" data-sv-encounter><header><h3>'+esc(e.name)+'</h3><span>현장 대화</span></header>'+
    '<blockquote>'+esc(e.text)+'</blockquote>'+bill+buttons+
    (Number.isSafeInteger(e.departAt)?'<p class="sv-depart">출발 예정 · '+esc(survivorTime(e.departAt,v))+'<br>떠난 뒤 이 권역을 다시 조사하면 이어지는 단서를 찾을 수 있습니다.</p>':'')+'</section>';
}
function survivorMeeting(m,v){
  return '<li class="sv-meeting" data-sv-meeting><header><h3>'+esc(m.name)+'</h3><span>'+esc(survivorTime(m.at,v))+
    '</span></header><small>'+esc(survivorZoneName(m.zone))+'</small><p>'+esc(m.text)+'</p></li>';
}
function survivorOutcome(v){
  if(v.choice==='help')return '<p class="sv-receipt" data-sv-receipt="help">물통 1개 전달 · 사례금 '+money(v.reward)+' 수령</p>';
  if(v.choice==='decline')return '<p class="sv-receipt" data-sv-receipt="decline">도움 요청을 거절했습니다.</p>';
  return '';
}
function survivorNotice(v){
  const msg=survivorFeedback?.raidId===v.raidId&&survivorFeedback.page===page?survivorFeedback.message:'';
  return '<p class="sv-notice" role="status" tabindex="-1" data-sv-notice>'+esc(msg)+'</p>';
}
function survivorControls(v){
  if(v.mode!=='field')return '';
  return '<div class="sv-search"><div class="sv-actions">'+survivorButton('observe','현장 흔적 조사',String(v.zone),v,!v.canObserve,true)+
    '</div>'+(v.blocked?'<span>'+esc(v.blocked)+'</span>':'')+'</div>';
}
function survivorSnapshot(v){
  // Time-based changes matter only if they alter a control, a dialogue, or observable evidence.
  return JSON.stringify([page,v.mode,v.raidId,v.zone,v.blocked,v.canObserve,v.clues,v.encounter,v.meetings,v.choice,v.reward,writer]);
}
function survivorFieldBody(v){
  const newest=v.clues.at(-1);
  const header='<header class="sv-field-head"><h2 tabindex="-1">생존자 흔적</h2><button type="button" class="sv-text" data-page="survivors">관측 수첩 <i aria-hidden="true">›</i></button></header>';
  if(v.mode==='legacy')return header+'<p>이번 출격은 이전 버전에서 시작했습니다. 다음 출격부터 현장 흔적을 조사할 수 있습니다.</p>';
  if(v.mode!=='field')return '';
  // An open box or a route encounter must keep its own controls within reach.
  if(v.blocked && (field.contact||field.journey||field.open||field.action)){
    return header+'<p class="sv-quiet">'+esc(v.blocked)+'</p>';
  }
  const hint=!newest?'<p>주변을 살펴 생존자가 남긴 단서를 찾아보세요.</p>':'';
  return header+hint+survivorControls(v)+(newest?'<ul class="sv-list">'+survivorClue(newest,v)+'</ul>':'')+
    survivorEncounter(v)+survivorNotice(v);
}
function survivorFieldPanel(){
  if(!raid||field.result)return '';
  const v=survivorView();
  survivorPaint=survivorSnapshot(v);
  return '<section class="sv-ui sv-field" data-survivor-field data-sv-mode="'+esc(v.mode)+'">'+survivorFieldBody(v)+'</section>';
}
function survivorJournalBody(v){
  const active=v.mode==='field', legacy=v.mode==='legacy';
  const title=active?'이번 출격의 관측 기록':v.mode==='archive'?'지난 출격의 관측 기록':'생존자 관측 수첩';
  const desc=active?survivorZoneName(v.zone)+' · 현장 관측 중':legacy?'이 출격은 이전 버전에서 시작했습니다. 다음 출격에서 흔적을 찾아보세요.':
    v.mode==='archive'?'확인한 흔적과 대화를 다시 읽을 수 있습니다.':'현장에서 흔적을 조사하면 발견한 권역과 방향, 만난 사람의 말이 이 수첩에 기록됩니다.';
  const journalHead='<header class="sv-cover" style="--sv-art:url(\''+artURL('bunker-intel')+'\')"><div><h1 tabindex="-1">'+title+'</h1><p>'+esc(desc)+'</p></div></header>';
  const links='<div class="sv-actions sv-links"><button type="button" data-page="'+(raid?'raid':'prep')+'">'+(raid?(field.result?'귀환 정산':'현장으로 복귀'):'출격 준비')+
    '</button><button type="button" data-page="map">작전 지도</button></div>';
  if(v.mode==='empty'||legacy)return journalHead+links+'<section class="sv-sheet"><h2>첫 관측</h2><p>출격 후 현장 화면에서 <b>현장 흔적 조사</b>를 누르세요. 발견한 흔적은 추적하거나 지나칠 수 있습니다. 생존자가 먼저 살펴본 상자에는 뒤진 흔적이 남기도 합니다.</p></section>';
  const clues=v.clues.length?'<ul class="sv-list">'+[...v.clues].reverse().map(c=>survivorClue(c,v)).join('')+'</ul>':'<p>아직 조사해서 발견한 흔적이 없습니다.</p>';
  const meetings=v.meetings.length?'<ol class="sv-list">'+[...v.meetings].reverse().map(m=>survivorMeeting(m,v)).join('')+'</ol>':'<p>아직 만나서 대화를 나눈 사람이 없습니다.</p>';
  return journalHead+links+(active?survivorControls(v)+survivorEncounter(v)+survivorNotice(v):'')+
    '<div class="sv-columns"><section class="sv-sheet"><h2>발견한 흔적 <span>'+v.clues.length+'건</span></h2>'+clues+'</section>'+
    '<section class="sv-sheet"><h2>만남 기록 <span>'+v.meetings.length+'건</span></h2>'+survivorOutcome(v)+meetings+'</section></div>';
}
function survivorJournalPage(){
  const v=survivorView();
  survivorPaint=survivorSnapshot(v);
  return '<article class="sv-ui sv-journal" data-survivor-journal data-sv-mode="'+esc(v.mode)+'">'+survivorJournalBody(v)+'</article>';
}
function survivorRoot(){return page==='survivors'?'[data-survivor-journal]':page==='raid'?'[data-survivor-field]':null;}
function captureSurvivorFocus(){
  const el=document.activeElement,root=survivorRoot();
  if(!root||!el?.closest?.(root))return null;
  return {group:page,notice:el.hasAttribute('data-sv-notice'),dataset:{...el.dataset},tag:el.tagName};
}
function restoreSurvivorFocus(previous){
  const root=survivorRoot(),node=root&&$(root);
  if(!node?.querySelector||!previous||previous.group!==page)return;
  let target=null;
  if(previous.notice)target=node.querySelector('[data-sv-notice]:not(:empty)');
  if(previous.tag==='BUTTON')target=[...node.querySelectorAll('button:not(:disabled)')].find(b=>
    Object.entries(previous.dataset).every(([key,value])=>b.dataset[key]===value));
  (target||node.querySelector('[tabindex="-1"]'))?.focus({preventScroll:true});
}
function tickSurvivorUI(){
  if(rendering||view!=='inside'||!raid||field.result)return;
  const root=survivorRoot();
  if(!root)return;
  const now=Date.now(),second=Math.floor(now/1000);
  if(second===survivorCheckedAt)return;
  survivorCheckedAt=second;
  const node=$(root);
  if(!node)return;
  const v=survivorView(now),signature=survivorSnapshot(v);
  if(signature===survivorPaint)return;
  const focus=captureSurvivorFocus();
  survivorPaint=signature;
  node.dataset.svMode=v.mode;
  node.innerHTML=page==='survivors'?survivorJournalBody(v):survivorFieldBody(v);
  restoreSurvivorFocus(focus);
}
function handleSurvivorUI(d){
  if(!writer||!survivorRoot())return;
  const id=Number(d.raidId);
  const receipt=survivorAction(d.survivor,id,d.token);
  survivorFeedback={raidId:id,page,message:receipt.message};
  renderKeep();
  $(survivorRoot())?.querySelector?.('[data-sv-notice]:not(:empty)')?.focus({preventScroll:true});
}
