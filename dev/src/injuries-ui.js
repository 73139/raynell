// The selected body part and bag tile are view state. Resource use is committed by the injury model.
const INJURY_STATE_LABEL={normal:'정상',wounded:'부상',recovered:'회복'};
let injuryChoice={raidId:null,part:null,uid:null,message:''};

function injurySelection(){
  const id=raid?.startedAt??null;
  if(injuryChoice.raidId!==id)injuryChoice={raidId:id,part:null,uid:null,message:''};
  return injuryChoice;
}
function injuryMedicineUnits(){
  return (field?.bag||[]).filter(unit=>kitSupply(unit.g)?.stat==='hp');
}
function injuryPartName(view,id){
  return view.parts.find(part=>part.id===id)?.label||'부위';
}
function injuryFigure(parts){
  return '<div class="iw-figure" aria-hidden="true"><div>'+itemArt('operator_body')+
    parts.map(part=>'<i class="iw-point iw-'+part.id+'" data-state="'+part.status+'"></i>').join('')+'</div></div>';
}
function injuryPartRows(view,selectable,chosen){
  return '<ul class="iw-parts" aria-label="부위별 상태">'+view.parts.map(part=>{
    const state=part.status, text='<span class="iw-part-name">'+esc(part.label)+'</span><span class="iw-state">'+INJURY_STATE_LABEL[state]+'</span>'+
      (state==='wounded'?'<small>'+esc(part.penalty)+'</small>':'');
    if(selectable){
      return '<li><button type="button" data-injury="part" data-part="'+part.id+'" data-state="'+state+
        '" aria-pressed="'+(chosen===part.id)+'"'+(state!=='wounded'?' disabled':'')+'>'+text+'</button></li>';
    }
    return '<li><div data-part="'+part.id+'" data-state="'+state+'">'+text+'</div></li>';
  }).join('')+'</ul>';
}
function injuryEvents(view){
  if(!view.events?.length)return '';
  const recent=view.events.slice().reverse();
  return '<details class="iw-history"><summary>피해·치료 기록 ('+recent.length+')</summary><ol>'+recent.map(e=>{
    const label=esc(injuryPartName(view,e.part));
    const text=e.kind==='hit'?'<b>'+label+' 부상</b><span>체력 −'+e.damage+'</span>':
      '<b>'+label+' 치료 완료</b><span>'+esc(kitName(e.item))+' 1개 · 체력 +'+e.gain+'</span>';
    const time=new Date(e.at).toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return '<li data-injury-event="'+e.kind+'" data-part="'+e.part+'"><time>'+esc(time)+'</time><div>'+text+'</div></li>';
  }).join('')+'</ol></details>';
}
function injurySummaryMarkup(summary,heading='부상·치료 정산'){
  if(!summary?.injuries)return '';
  const view=injuryView(summary.injuries);
  if(view.mode==='legacy')return '';
  const left=view.parts.filter(part=>part.status==='wounded').length;
  return '<section class="iw-report" data-injury-report aria-label="'+esc(heading)+'"><header><h2>'+esc(heading)+'</h2>'+
    '<span>남은 부상 '+left+'곳</span></header><div class="iw-tally"><span>피해 '+view.hits+'회</span><span>치료 '+view.treatments+
    '회</span><span>보급품 '+view.treatments+'개 사용</span></div>'+injuryPartRows(view,false,null)+injuryEvents(view)+'</section>';
}
function injuryFieldBrief(){
  const view=injuryView();
  if(view.mode!=='active')return '';
  const wounded=view.parts.filter(part=>part.status==='wounded'),active=field?.action;
  if(!wounded.length&&active?.type!=='treat')return '';
  return '<section class="iw-brief" data-injury-brief><div><b>'+(active?.type==='treat'?esc(injuryPartName(view,active.part))+' 치료 중':'부상 '+wounded.length+'곳')+
    '</b><span>'+wounded.map(p=>esc(p.label)+' · '+esc(p.penalty)).join(' / ')+'</span></div><button type="button" data-page="health">'+
    (active?.type==='treat'?'치료 진행 보기':'부위별 치료')+'</button></section>';
}
function injuryPendingMarkup(view,action){
  const elapsed=Math.max(0,Math.min(100,(Date.now()-action.start)/(action.end-action.start)*100));
  const seconds=(Math.max(0,action.end-Date.now())/1000).toFixed(1);
  return '<section class="iw-care iw-pending" data-injury-pending data-part="'+action.part+'" data-unit="'+esc(action.uid)+
    '"><div class="iw-head"><h3>'+esc(injuryPartName(view,action.part))+' 치료 중</h3><span id="field-seconds">'+seconds+
    '초</span></div><p>'+esc(kitName(action.item))+' 1개 · 완료 시 소모</p><div class="progress-track"><i id="field-progress" style="width:'+elapsed+
    '%"></i></div><button type="button" data-injury="cancel">치료 취소</button></section>';
}
function injuryCareMarkup(view,choice){
  const parts=view.parts.filter(p=>p.status==='wounded');
  if(!parts.length)return '';
  const units=injuryMedicineUnits(),part=parts.find(p=>p.id===choice.part),unit=units.find(u=>u.uid===choice.uid);
  const scope=part?part.label+' 치료':'치료 시작';
  const moving=Boolean(field.action||(field.journey&&!field.journey.event));
  const blocked=moving||!writer||raidRemaining()<=TREATMENT_MS;
  let guidance='';
  if(!units.length)guidance='가방에 치료 가능한 보급품이 없습니다.';
  else if(moving)guidance='진행 중인 행동이 끝나면 치료할 수 있습니다.';
  else if(raidRemaining()<=TREATMENT_MS)guidance='출격 시간이 부족합니다.';
  else if(!part||!unit)guidance='부상 부위와 가방의 보급품 한 개를 선택하세요.';
  else guidance=kitName(unit.g)+' 1개 사용 · 체력 +'+Math.max(0,Math.min(kitSupply(unit.g).gain,100-field.hp));
  return '<section class="iw-care"><h3>가방의 치료 보급품 <small>'+units.length+'개</small></h3>'+
    (units.length?'<div class="iw-medicines">'+units.map(u=>'<button type="button" data-injury="item" data-unit="'+esc(u.uid)+'" data-id="'+esc(u.g)+
      '" aria-pressed="'+(u.uid===choice.uid)+'"'+(blocked?' disabled':'')+'>'+itemArt(u.g)+'<span><b>'+esc(kitName(u.g))+
      '</b><small>가방 '+(u.y+1)+'행 '+(u.x+1)+'열</small></span></button>').join('')+'</div>':'')+
    '<div class="iw-confirm"><p>'+esc(guidance)+'</p><button type="button" class="primary" data-injury="start" data-part="'+esc(part?.id||'')+
    '" data-unit="'+esc(unit?.uid||'')+'"'+(blocked||!part||!unit?' disabled':'')+'>'+esc(scope)+' · '+(TREATMENT_MS/1000)+'초'+'</button></div></section>';
}
function injuryHealthPanel(){
  const view=injuryView();
  if(view.mode==='legacy')return '<section class="iw-panel iw-legacy" data-injury-panel data-mode="legacy"><h2>부위별 상태</h2><p>이전 버전에서 시작한 출격입니다. 부위별 부상은 다음 출격부터 기록합니다.</p></section>';
  const active=view.mode==='active',parts=view.parts,choice=injurySelection();
  const wounded=parts.filter(p=>p.status==='wounded'),pending=active&&field?.action?.type==='treat'?field.action:null;
  if(!wounded.some(p=>p.id===choice.part))choice.part=null;
  if(active&&!injuryMedicineUnits().some(u=>u.uid===choice.uid))choice.uid=null;
  const last=view.events?.at(-1);
  const receipt=last?.kind==='treat'?injuryPartName(view,last.part)+' 치료 완료 · '+kitName(last.item)+' 1개 사용 · 체력 +'+last.gain:'';
  return '<section class="iw-panel" data-injury-panel data-mode="'+esc(view.mode)+'"><div class="iw-head"><h2>부위별 상태</h2><span>'+
    (active?(wounded.length?'부상 '+wounded.length+'곳':'현재 부상 없음'):'출격 전')+'</span></div><div class="iw-body">'+injuryFigure(parts)+
    injuryPartRows(view,active&&!pending,choice.part)+'</div>'+
    (pending?injuryPendingMarkup(view,pending):active?injuryCareMarkup(view,choice):'')+
    '<p class="iw-status" tabindex="-1" role="status" data-injury-status>'+esc(choice.message||receipt)+'</p>'+injuryEvents(view)+'</section>';
}
function openInjuryTreatment(uid){
  const view=injuryView(),unit=injuryMedicineUnits().find(u=>u.uid===uid);
  if(!writer||view.mode!=='active'||!unit||!view.parts.some(p=>p.status==='wounded'))return false;
  const choice=injurySelection();
  choice.uid=unit.uid;choice.message='';
  loHealthId=unit.g;loMobilePanel.health=0;page='health';save();renderKeep();
  const part=document.querySelector('[data-injury="part"]:enabled');
  part?.scrollIntoView?.({block:'nearest'});part?.focus?.({preventScroll:true});
  return true;
}
function handleInjuryUI(d){
  if(!writer||page!=='health'||!raid||field.result)return;
  const view=injuryView(),choice=injurySelection(),part=view.parts.find(p=>p.id===d.part);
  if(view.mode!=='active')return;
  if(d.injury==='part'&&part?.status==='wounded'&&field.action?.type!=='treat'){
    choice.part=d.part;choice.message='';
  }else if(d.injury==='item'&&injuryMedicineUnits().some(u=>u.uid===d.unit)&&!field.action){
    choice.uid=d.unit;choice.message='';
  }else if(d.injury==='start'&&choice.part===d.part&&choice.uid===d.unit){
    const result=beginInjuryTreatment(d.part,d.unit);
    choice.message=result.ok?'':result.message;
  }else if(d.injury==='cancel'){
    const result=cancelInjuryTreatment();choice.message=result.message;
  }else return;
  renderKeep();
  if(d.injury==='start'||d.injury==='cancel'){
    const el=d.injury==='start'&&field.action?.type==='treat'?$('[data-injury="cancel"]'):$('[data-injury-status]');
    el?.focus?.({preventScroll:true});
  }
}
function captureInjuryFocus(){
  if(page!=='health')return null;
  const el=document.activeElement;
  return el?.dataset?.injury?{action:el.dataset.injury,part:el.dataset.part,unit:el.dataset.unit}:null;
}
function restoreInjuryFocus(focus){
  if(!focus||page!=='health')return;
  const target=[...document.querySelectorAll('[data-injury]')].find(el=>el.dataset.injury===focus.action&&
    el.dataset.part===focus.part&&el.dataset.unit===focus.unit&&!el.disabled);
  (target||$('[data-injury-status]'))?.focus?.({preventScroll:true});
}
