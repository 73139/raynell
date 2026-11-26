// Drafts belong to this screen. Only the model can commit a preset or move a part.
let workshopMode='book',workshopIndex=0,workshopDraft=null,workshopName='',workshopEditing=false;
let workshopNotice=null,workshopIME=null,workshopDeferred=false;
const WORKSHOP_SLOTS=['back','support','primary','secondary','melee','armor','head','face','breathing','ears','eyes','light','comms','access','insignia'];

function resetPresetUI(){
  workshopMode='book';workshopIndex=0;workshopDraft=null;workshopName='';workshopEditing=false;
  workshopNotice=null;workshopIME=null;workshopDeferred=false;
}
function workshopLoad(){
  const entry=workshopMode==='book'?presetBook[workshopIndex]:null;
  const target=entry||presetCurrent();
  workshopDraft={worn:{...target.worn},modules:{...target.modules}};
  workshopName=entry?.name||'';
  workshopEditing=false;
  workshopNotice=null;
}
function workshopRedraw(selector){
  renderKeep();
  const focus=selector&&$(selector);
  if(focus){
    focus.focus?.({preventScroll:true});
    if(selector==='[data-preset-notice]')focus.scrollIntoView?.({block:'nearest'});
  }
}
function workshopModes(){
  return '<div class="pw-modes" role="group" aria-label="정비 작업 선택">'+
    [['book','장비 프리셋'],['bench','모듈 정비']].map(([mode,label])=>
      '<button type="button" data-preset="mode" data-mode="'+mode+'" aria-pressed="'+(workshopMode===mode)+'">'+label+'</button>').join('')+'</div>';
}
function workshopSlots(){
  return '<div class="pw-book" role="group" aria-label="저장할 프리셋 선택">'+presetBook.map((entry,i)=>{
    const letter=i===0?'A':'B';
    return '<button type="button" data-preset="select" data-index="'+i+'" aria-pressed="'+(workshopIndex===i)+'"><span>프리셋 '+letter+
      '</span><strong>'+esc(entry?.name||'빈 프리셋')+'</strong></button>';
  }).join('')+'</div>';
}
function workshopNameField(){
  return '<div class="pw-name"><label for="preset-name">프리셋 이름</label><div><input type="text" autocomplete="off" id="preset-name" '+ 
    'value="'+esc(workshopName)+'" placeholder="예: 외곽 수색" aria-describedby="pw-name-limit"'+(workshopNotice?.invalid?' aria-invalid="true"':'')+
    '><button type="button" data-preset="save">'+(presetBook[workshopIndex]?'이 프리셋에 다시 저장':'이 프리셋에 저장')+
    '</button></div><small id="pw-name-limit">최대 24자 · 저장하면 장비와 모듈 조합을 기록합니다.</small></div>';
}
function workshopSlotEditor(worn){
  const gear=[ISSUE_PACK,...Object.keys(GOODS).filter(id=>kitSlot(id))];
  return '<div id="pw-slot-editor" class="pw-editor">'+WORKSHOP_SLOTS.map(slot=>{
    const choices=gear.filter(id=>kitSlot(id)===slot).sort((a,b)=>kitName(a).localeCompare(kitName(b),'ko'));
    return '<label>'+esc(KIT_SLOTS[slot].label)+'<select data-preset-slot="'+slot+'"><option value=""'+(!worn[slot]?' selected':'')+
      '>미장착</option>'+choices.map(id=>'<option value="'+esc(id)+'"'+(worn[slot]===id?' selected':'')+'>'+esc(kitName(id))+
      '</option>').join('')+'</select></label>';
  }).join('')+'</div>';
}
function workshopGear(draft){
  const chosen=WORKSHOP_SLOTS.filter(slot=>draft.worn[slot]);
  return '<section class="pw-pane"><header><h2>장비 조합</h2><button type="button" data-preset="edit" aria-expanded="'+workshopEditing+
    '" aria-controls="pw-slot-editor">'+(workshopEditing?'편집 접기':'장비 슬롯 편집')+'</button></header>'+
    (workshopEditing?workshopSlotEditor(draft.worn):'<div id="pw-slot-editor" class="pw-equipped">'+(chosen.length?chosen.map(slot=>
      '<div><span class="pw-art">'+itemArt(draft.worn[slot])+'</span><span><small>'+esc(KIT_SLOTS[slot].label)+'</small><b>'+
      esc(kitName(draft.worn[slot]))+'</b></span></div>').join(''):'<p>설정한 장비가 없습니다. 장비 슬롯을 편집해 조합을 만드세요.</p>')+'</div>')+'</section>';
}
function workshopModuleGuide(){
  const groups=new Map();
  for(const [host,parts] of Object.entries(PRESET_MODULES)){
    const key=parts.join('/');
    if(!groups.has(key))groups.set(key,{hosts:[],parts});
    groups.get(key).hosts.push(kitName(host));
  }
  return '<details class="pw-guide"><summary>호환 장비·부품 목록</summary><dl>'+
    [...groups.values()].map(({hosts,parts})=>'<div><dt>'+esc(hosts.join(' · '))+'</dt><dd>'+esc(parts.map(kitName).join(' / '))+'</dd></div>').join('')+'</dl></details>';
}
function workshopModules(draft){
  const hosts=WORKSHOP_SLOTS.filter(slot=>PRESET_MODULES[draft.worn[slot]]);
  return '<section class="pw-pane"><header><h2>모듈 정비</h2></header>'+
    (hosts.length?'<div class="pw-hosts">'+hosts.map(slot=>{
      const host=draft.worn[slot],parts=PRESET_MODULES[host],part=draft.modules[slot];
      return '<div class="pw-host"><span class="pw-art">'+itemArt(host)+'</span><div><label for="pw-mod-'+slot+'">'+esc(kitName(host))+
        ' <small>'+esc(KIT_SLOTS[slot].label)+'</small></label><select id="pw-mod-'+slot+'" data-preset-module="'+slot+'">'+
        '<option value=""'+(!part?' selected':'')+'>모듈 없음</option>'+parts.map(id=>
          '<option value="'+esc(id)+'"'+(id===part?' selected':'')+'>'+esc(kitName(id))+' · 보유 '+presetStock(id)+'개</option>').join('')+
        '</select>'+(part?'<p class="pw-effect">'+esc(kitModuleEffectText(slot,part))+'</p>':'')+'</div></div>';
    }).join('')+'</div>':'<p>'+ (workshopMode==='bench'?'보안경·조명·무전기 중 하나를 착용하면 호환 부품을 선택할 수 있습니다.':'보안경·조명·무전기를 조합에 넣으면 호환 부품을 선택할 수 있습니다.')+'</p>')+
    workshopModuleGuide()+(workshopMode==='bench'&&!hosts.length?'<button type="button" data-page="inventory">착용 장비 변경</button>':'')+'</section>';
}
function workshopMoves(label,rows,attr){
  return '<div class="pw-move"><h4>'+label+'</h4>'+
    (rows?.length?'<ul>'+rows.map(({id,quantity})=>'<li data-preset-'+attr+'="'+esc(id)+'">'+esc(kitName(id))+' ×'+quantity+'</li>').join('')+'</ul>':'<span>없음</span>')+'</div>';
}
function workshopPreview(draft){
  const plan=presetPreview(draft);
  return '<section class="pw-pane pw-preview" aria-label="적용 미리보기"><header><h2>적용 미리보기</h2><strong class="'+(plan.ok?'pw-ready':'pw-blocked')+'">'+
    (plan.ok?'적용 가능':'적용 보류')+'</strong></header><p>착용 장비와 부품, 준비 가방, 창고와 보관함의 재고를 합산합니다.</p>'+
    (plan.requirements?.length?'<table><caption class="pw-sr">물품별 필요량, 보유량, 부족량</caption><thead><tr><th scope="col">물품</th><th scope="col">필요</th>'+
      '<th scope="col">보유</th><th scope="col">부족</th></tr></thead><tbody>'+plan.requirements.map(({id,needed,owned,missing})=>
      '<tr data-preset-need="'+esc(id)+'" data-needed="'+needed+'" data-owned="'+owned+'" data-missing="'+missing+'"><th scope="row">'+
      esc(kitName(id))+'</th><td>'+needed+'</td><td>'+owned+'</td><td class="'+(missing?'pw-blocked':'')+'">'+missing+'</td></tr>').join('')+
      '</tbody></table>':'<p>이 조합에 필요한 장비와 부품이 없습니다.</p>')+
    '<div class="pw-moves">'+workshopMoves('재고에서 장착',plan.takes,'take')+workshopMoves('창고로 회수',plan.returns,'return')+'</div>'+
    (plan.issuedReturned?'<p>착용 중인 지급 배낭을 보급소에 반납합니다.</p>':'')+
    (!plan.ok?'<ul class="pw-issues">'+(plan.issues?.length?plan.issues:[plan.message]).filter(Boolean).map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':'')+
    '<button class="primary pw-apply" type="button" data-preset="apply"'+(!plan.ok||!writer?' disabled':'')+'>'+
    (workshopMode==='bench'?'정비 확정':'장비·모듈 적용')+'</button></section>';
}
function workshopStatus(){
  return '<p role="status" tabindex="-1" aria-live="polite" data-preset-notice class="pw-notice'+(workshopNotice&&!workshopNotice.ok?' pw-blocked':'')+
    '">'+(workshopNotice?esc(workshopNotice.message):'')+'</p>';
}
function presetsView(){
  const back='<button type="button" data-page="'+(raid?'raid':'prep')+'">'+(raid?(field.result?'정산 보고서':'현장 복귀'):'출격 준비')+'</button>';
  const heading='<header class="pw-head"><h1>장비 프리셋과 모듈 정비</h1>'+back+'</header>';
  if(raid)return '<div class="pw-workshop">'+heading+'<section class="pw-pane"><p>귀환 정산을 마치면 벙커에서 프리셋과 모듈을 정비할 수 있습니다.</p></section></div>';
  if(!workshopDraft)workshopLoad();
  const book=workshopMode==='book';
  return '<div class="pw-workshop">'+heading+workshopModes()+(book?workshopSlots():'')+workshopStatus()+
    '<div class="pw-layout"><div class="pw-work">'+(book?'<section class="pw-pane">'+workshopNameField()+'<button type="button" data-preset="current">현재 착용 조합 불러오기</button></section>'+
      workshopGear(workshopDraft):'')+workshopModules(workshopDraft)+'</div>'+workshopPreview(workshopDraft)+'</div></div>';
}
function handlePresetUI(d){
  if(page!=='presets'||raid||!writer)return;
  if(!workshopDraft)workshopLoad();
  const mode=workshopMode,indexBefore=workshopIndex;
  // A failed revision check reloads the whole session and clears transient input.
  function refreshAfterConflict(){
    if(workshopDraft)return false;
    workshopMode=mode;workshopIndex=indexBefore;workshopLoad();return true;
  }
  let focus=null;
  switch(d.preset){
    case 'mode':{
      if(!['book','bench'].includes(d.mode)||workshopMode===d.mode)return;
      workshopMode=d.mode;workshopLoad();focus='[data-preset="mode"][data-mode="'+workshopMode+'"]';break;
    }
    case 'select':{
      if(workshopMode!=='book'||!['0','1'].includes(d.index))return;
      const index=Number(d.index);
      if(index===workshopIndex)return;
      workshopIndex=index;workshopLoad();focus='[data-preset="select"][data-index="'+index+'"]';break;
    }
    case 'edit':
      if(workshopMode!=='book')return;
      workshopEditing=!workshopEditing;focus='[data-preset="edit"]';break;
    case 'current':
      if(workshopMode!=='book')return;
      workshopDraft=presetCurrent();workshopNotice={ok:true,message:'현재 착용 조합을 편집창에 불러왔습니다.'};focus='[data-preset="current"]';break;
    case 'save':{
      if(workshopMode!=='book')return;
      const name=$('#preset-name')?.value??workshopName,invalid=presetNameValue(name)===null;
      const result=savePreset(workshopIndex,name,workshopDraft);
      const conflict=refreshAfterConflict();
      if(!conflict)workshopName=result.ok?presetBook[workshopIndex].name:name;
      workshopNotice={...result,invalid};focus=invalid?'#preset-name':'[data-preset-notice]';break;
    }
    case 'apply':{
      const result=applyPreset(workshopDraft);
      refreshAfterConflict();
      if(result.ok&&workshopMode==='bench')workshopDraft=presetCurrent();
      workshopNotice=result;focus='[data-preset-notice]';break;
    }
    default:return;
  }
  workshopRedraw(focus);
}
function workshopChange(target){
  if(page!=='presets'||raid||!writer||!workshopDraft)return;
  const slot=target.dataset.presetSlot,partSlot=target.dataset.presetModule,value=target.value;
  let selector;
  if(slot&&workshopMode==='book'&&Object.hasOwn(KIT_SLOTS,slot)&&(!value||kitSlot(value)===slot)){
    if(value)workshopDraft.worn[slot]=value;
    else delete workshopDraft.worn[slot];
    if(!PRESET_MODULES[value]?.includes(workshopDraft.modules[slot]))delete workshopDraft.modules[slot];
    selector='[data-preset-slot="'+slot+'"]';
  }else if(partSlot&&Object.hasOwn(KIT_SLOTS,partSlot)){
    const options=PRESET_MODULES[workshopDraft.worn[partSlot]];
    if(!options||value&&!options.includes(value))return;
    if(value)workshopDraft.modules[partSlot]=value;
    else delete workshopDraft.modules[partSlot];
    selector='[data-preset-module="'+partSlot+'"]';
  }else return;
  workshopNotice=null;workshopRedraw(selector);
}
function capturePresetFocus(){
  const input=document.activeElement;
  if(page==='presets'&&input?.id==='preset-name')return {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection};
  return null;
}
function restorePresetFocus(focus){
  if(!focus)return;
  const input=$('#preset-name');if(!input)return;
  input.focus?.({preventScroll:true});
  if(input.setSelectionRange&&focus.start!==null)input.setSelectionRange(focus.start,focus.end,focus.direction||'none');
}
function deferPresetRender(){
  if(!workshopIME?.isConnected||workshopIME!==document.activeElement||page!=='presets')return false;
  workshopDeferred=true;return true;
}
inside.addEventListener('change',event=>workshopChange(event.target));
inside.addEventListener('input',event=>{
  if(event.target.id!=='preset-name')return;
  workshopName=event.target.value;
  if(workshopNotice){workshopNotice=null;const status=$('[data-preset-notice]');if(status)status.textContent='';}
  event.target.removeAttribute('aria-invalid');
});
inside.addEventListener('compositionstart',event=>{if(event.target.id==='preset-name')workshopIME=event.target;});
inside.addEventListener('compositionend',event=>{
  if(event.target!==workshopIME)return;
  workshopIME=null;workshopName=event.target.value;
  if(workshopDeferred){workshopDeferred=false;renderKeep();}
});
inside.addEventListener('keydown',event=>{
  if(page!=='presets'||event.target.id!=='preset-name')return;
  if(event.key==='Escape'){event.stopPropagation();return;}
  if(event.key==='Enter'&&!event.isComposing&&!workshopIME&&event.keyCode!==229){
    event.preventDefault();handlePresetUI({preset:'save'});
  }
});
