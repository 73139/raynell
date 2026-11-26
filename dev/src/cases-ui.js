// A case opens in the same detail pane as its physical warehouse item.
let openedCaseUid=null;

function otherCasesFor(unit,sourceUid) {
  return stashSlots.filter(box=>box.uid!==sourceUid && caseAccepts(box.g,unit.g));
}
function caseDestinationButtons(unit,boxes,sourceUid) {
  return boxes.map(box=>{
    const fits=kitFit(box.contents||[],STORAGE_CASES[box.g].size,unit);
    const label=esc(caseDisplayName(box))+' · '+(box.y+1)+'행 '+(box.x+1)+'열';
    const action=sourceUid?'case-relocate':'case-pack-selected';
    const source=sourceUid?' data-from="'+esc(sourceUid)+'"':'';
    return '<button type="button" class="sc-stock" data-stash="'+action+'" data-box="'+esc(box.uid)+'" data-unit="'+esc(unit.uid)+'"'+source+
      (fits?'':' disabled')+'><span>'+label+'</span><b>'+(fits?(sourceUid?'옮기기':'넣기'):'공간 부족')+'</b></button>';
  }).join('');
}
function caseDestinations(unit){
  if(!writer||raid||unit.uid==='overflow'||unit.g==='cr_notes')return '';
  const boxes=otherCasesFor(unit,null);
  if(!boxes.length)return '';
  return '<details class="sc-targets" data-case-destinations><summary>보관함에 넣기 · '+esc(kitName(unit.g))+'</summary>'+
    caseDestinationButtons(unit,boxes,null)+'</details>';
}
function caseRelocationPanel(box) {
  const items=(box.contents||[]).filter(unit=>otherCasesFor(unit,box.uid).length);
  if(!items.length)return '';
  const options=items.map(unit=>'<option value="'+esc(unit.uid)+'">'+esc(kitName(unit.g))+' · '+(unit.y+1)+'행 '+(unit.x+1)+'열</option>').join('');
  return '<details class="sc-targets"><summary>다른 보관함으로 옮기기</summary><label class="sc-source">옮길 물품'+
    '<select data-case-source="'+esc(box.uid)+'">'+options+'</select></label><div class="sc-target-list" data-case-receivers>'+
    caseDestinationButtons(items[0],otherCasesFor(items[0],box.uid),box.uid)+'</div></details>';
}
function refreshCaseReceivers(select) {
  const box=selectedStashUnit();
  if(!box||!writer||raid||box.uid!==select.dataset.caseSource||openedCaseUid!==box.uid)return;
  const item=box.contents?.find(unit=>unit.uid===select.value);
  select.closest('details').querySelector('[data-case-receivers]').innerHTML=item
    ?caseDestinationButtons(item,otherCasesFor(item,box.uid),box.uid)
    :'<p role="status">선택한 물품을 옮길 수 없습니다. 물품을 다시 선택하세요.</p>';
}
inside.addEventListener('change',event=>{
  if(event.target.dataset.caseSource)refreshCaseReceivers(event.target);
});

function captureCaseRelocation() {
  const select=$('select[data-case-source]');
  if(!select?.dataset.caseSource)return null;
  const details=select.closest('details'),active=document.activeElement;
  return {source:select.dataset.caseSource,item:select.value,open:details.open,
    focus:details.contains(active)?(active.dataset.box||active.tagName):null};
}
function restoreCaseRelocation(view) {
  if(!view||view.source!==openedCaseUid||selectedStashUnit()?.uid!==view.source)return;
  const select=$('select[data-case-source]');
  if(select?.dataset.caseSource!==view.source){
    if(view.focus)$('[data-stash="case-close"][data-box="'+view.source+'"]')?.focus({preventScroll:true});
    return;
  }
  const details=select.closest('details');
  details.open=view.open;
  if(select.value!==view.item){
    select.value=view.item;
    if(!select.value){
      select.insertAdjacentHTML('afterbegin','<option disabled value="">물품을 다시 선택하세요</option>');
      select.value='';
    }
    refreshCaseReceivers(select);
  }
  if(view.focus){
    const target=view.focus==='SUMMARY'?details.querySelector('summary'):
      [...details.querySelectorAll('[data-stash="case-relocate"]:enabled')].find(button=>button.dataset.box===view.focus);
    (target||select).focus({preventScroll:true});
  }
}
function packSelectedCase(d,unit){
  if(!unit||unit.uid==='overflow'||unit.uid!==d.unit||!writer||raid)return;
  const box=stashSlots.find(slot=>slot.uid===d.box);
  if(!box||!caseAccepts(box.g,unit.g))return;
  const result=caseTransfer(box.uid,'put',unit.g,unit.uid);
  stashNotice=result.message;
  if(result.ok){
    stashSelection={id:box.g,uid:box.uid,rot:false};
    openedCaseUid=box.uid;
  }
  renderKeep();
  const target=result.ok?$('[data-stash="case-take"][data-box="'+box.uid+'"][data-unit="'+unit.uid+'"]'):$('[data-case-destinations]>summary');
  target?.focus?.({preventScroll:true});target?.scrollIntoView?.({block:'nearest'});
}
function casePanelMarkup(unit){
  const spec=unit&&STORAGE_CASES[unit.g];
  if(!spec)return '';
  const [cols,rows]=spec.size;
  const contents=unit.contents||[];
  const used=contents.reduce((sum,item)=>sum+item.w*item.h,0);
  const opened=unit.uid!=='overflow'&&openedCaseUid===unit.uid;
  const box=esc(unit.uid);
  const caseName=esc(caseDisplayName(unit));
  const heading='<header class="sc-head"><div><h3>'+caseName+' 내부 <span>'+cols+' × '+rows+'</span></h3><small>'+esc(spec.accepts)+'</small></div>'+
    '<span aria-label="내부 사용 칸">'+used+' / '+(cols*rows)+'칸</span></header>';
  let body='';
  if(unit.uid==='overflow'){
    body='<p>창고의 빈 공간에 배치하면 열 수 있습니다.</p>';
  }else{
    body=possessionAliasEditor(unit)+'<button class="sc-toggle" data-stash="case-'+(opened?'close':'open')+'" data-box="'+box+
      '" aria-expanded="'+opened+'">보관함 '+(opened?'닫기':'열기')+'</button>';
  }
  if(opened){
    const canMove=writer&&!raid;
    const located=posLocated?.kind==='case'&&posLocated.caseUid===unit.uid?
      contents.find(item=>item.uid===posLocated.uid&&item.g===posLocated.id):null;
    const gridLabel='보관함 내부 '+cols+'열 '+rows+'행'+
      (located?' · '+GOODS[located.g][0]+' 찾음 · '+(located.y+1)+'행 '+(located.x+1)+'열':'');
    const tiles=contents.map(item=>{
      const name=esc(GOODS[item.g][0]);
      return '<button class="sc-tile'+(located===item?' pos-found':'')+'" type="button" data-stash="case-take" data-box="'+box+'" data-unit="'+esc(item.uid)+
        '" aria-label="'+name+' 꺼내기" title="'+name+' 꺼내기" '+(canMove?'':'disabled ')+
        'style="grid-column:'+(item.x+1)+' / span '+item.w+';grid-row:'+(item.y+1)+' / span '+item.h+'">'+
        itemArt(item.g)+'<span>'+name+'</span></button>';
    }).join('');
    body+='<div class="sc-scroll" tabindex="0" role="region" aria-label="'+esc(gridLabel)+'" data-scroll-key="case-grid-'+box+'">'+
      '<div class="sc-grid" style="--sc-cols:'+cols+';--sc-rows:'+rows+'">'+tiles+'</div></div>';
    if(canMove){
      if(contents.length)body+='<p>내부 물품을 누르면 창고로 꺼냅니다.</p>'+caseRelocationPanel(unit);
      const ids=Object.keys(stash).filter(id=>stashCount(id)>0&&caseAccepts(unit.g,id));
      ids.sort((a,b)=>GOODS[a][0].localeCompare(GOODS[b][0],'ko'));
      const choices=ids.map(id=>{
        const [name,w,h]=GOODS[id];
        const fitsHere=firstFit(contents,spec.size,w,h)||(w!==h&&firstFit(contents,spec.size,h,w));
        return '<button type="button" class="sc-stock" data-stash="case-put" data-box="'+box+'" data-id="'+esc(id)+
          '" aria-label="'+esc(name)+' 1개 넣기, 창고 '+stashCount(id)+'개" '+(fitsHere?'':'disabled')+'><span>'+esc(name)+
          ' <small>×'+stashCount(id)+'</small></span><b>'+(fitsHere?'1개 넣기':'공간 부족')+'</b></button>';
      }).join('');
      body+='<h4>창고에서 넣기</h4>'+(choices?'<div class="sc-stock-list" data-scroll-key="case-stock-'+box+'">'+choices+'</div>':'<p>창고에 넣을 수 있는 물품이 없습니다.</p>');
    }else{
      body+='<p>'+(raid?'벙커로 귀환하면 물품을 옮길 수 있습니다.':'플레이 중인 탭에서 물품을 옮길 수 있습니다.')+'</p>';
    }
  }
  return '<section class="sc-case" data-case-uid="'+box+'" tabindex="-1" aria-label="'+caseName+' 내부 보관">'+heading+(opened?huntCaseBackButton(unit):'')+body+'</section>';
}

function handleCaseUI(d){
  if(page!=='stash'&&page!=='inventory')return;
  const unit=selectedStashUnit();
  if(d.stash==='case-pack-selected')return packSelectedCase(d,unit);
  if(d.stash==='case-relocate'){
    if(!unit||unit.uid!==d.from||openedCaseUid!==d.from||!writer||raid||
      $('select[data-case-source]')?.value!==d.unit)return;
    const result=moveBetweenCases(d.from,d.box,d.unit);
    stashNotice=result.message;
    if(result.ok){
      const to=stashSlots.find(box=>box.uid===d.box);
      stashSelection={id:to.g,uid:to.uid,rot:false};
      openedCaseUid=to.uid;
    }
    renderKeep();
    const target=result.ok?$('[data-stash="case-take"][data-box="'+d.box+'"][data-unit="'+d.unit+'"]'):$('[data-case-uid="'+unit.uid+'"]');
    target?.focus?.({preventScroll:true});target?.scrollIntoView?.({block:'nearest'});
    return;
  }
  if(!unit||unit.uid==='overflow'||unit.uid!==d.box||!Object.hasOwn(STORAGE_CASES,unit.g))return;
  const keyboard=document.activeElement?.matches?.(':focus-visible');
  switch(d.stash){
    case 'case-open':openedCaseUid=unit.uid;stashNotice='';break;
    case 'case-close':openedCaseUid=null;stashNotice='';break;
    case 'case-put':
    case 'case-take':{
      if(openedCaseUid!==unit.uid||!writer||raid)return;
      const put=d.stash==='case-put';
      if(put?!caseAccepts(unit.g,d.id)||!stashCount(d.id):!unit.contents?.some(item=>item.uid===d.unit))return;
      const result=caseTransfer(unit.uid,put?'put':'take',put?d.id:d.unit);
      stashNotice=result.message;
      break;
    }
    default:return;
  }
  renderKeep();
  if(keyboard){
    const buttons=Array.from(document.querySelectorAll('.sc-case button:not(:disabled)'));
    const next=buttons.find(button=>button.dataset.stash===d.stash&&
      (d.stash==='case-put'?button.dataset.id===d.id:d.stash==='case-take'));
    (next||buttons[0])?.focus({preventScroll:true});
  }
}
