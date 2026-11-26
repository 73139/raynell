// The records describe the first physical specimen independently carried out of a discovered container.
const ARCHIVE_SERIES=[
  {name:'마지막 정비 당번',art:'bunker-workshop',alt:'정비반의 작업대 삽화',items:{
    wire:'묶음 한쪽에 종이 꼬리표가 감겨 있다. 전력반은 같은 색 전선도 행선지를 적어 구분했다.',
    wrench:'손잡이의 홈에는 흰 분필이 남아 있다. 공구를 제자리에 돌려놓기 위해 윤곽을 그리던 흔적이다.',
    driver:'끝이 닳은 자루에는 작은 나사 세 개가 붙어 있다. 다음 교대조가 바로 일을 이을 수 있게 챙겨 둔 것이다.'
  },complete:'세 공구의 표식을 겹쳐 보니 작업 순서가 읽힌다. 단선을 잇고, 덮개를 고정하고, 다음 사람이 찾을 자리에 공구를 놓았다.'},
  {name:'인계 창구',art:'bunker-intel',alt:'자료실의 문서 단말 삽화',items:{
    card:'모서리에 교대조 번호가 펀칭되어 있다. 기록 단말이 멎은 뒤에도 구멍의 위치는 읽을 수 있다.',
    paper:'봉투 안쪽에 수령인 서명 칸이 한 번 더 인쇄되어 있다. 종이가 모자라면 뒤집어 재사용하던 양식이다.',
    mapnote:'접힌 자리에 낡은 창구 도장이 걸쳐 있다. 지도를 완전히 펼쳐야 마지막 획이 맞는다.'
  },complete:'카드의 교대조 번호와 봉투의 서명 칸, 지도 뒷면의 도장이 맞았다. 마지막 인계가 이루어진 날에도 창구는 평소 순서대로 문을 닫았다.'},
  {name:'교대원의 사물함',art:'bunker-rest',alt:'교대원 숙소 삽화',items:{
    lighter:'몸통에 세로 흠집 다섯 개가 나 있다. 그 위로 짧은 가로줄 하나가 긋다 만 채 남았다.',
    coin:'가장자리가 한쪽만 유난히 닳았다. 셈을 할 때마다 같은 쪽을 엄지로 밀었던 모양이다.',
    rl_14_34:'뒤표지 안쪽에 이름 대신 세탁표 번호가 적혀 있다. 작은 물건이 주인을 찾는 데 쓰이던 번호다.'
  },complete:'물건 세 점에는 이름이 없다. 번호와 손때, 손으로 그은 표시만으로도 이곳에 누군가의 자리가 있었다는 것은 알 수 있다.'}
];
let archiveCatalogOrigin=null;
const ARCHIVE_ITEMS=new Set(ARCHIVE_SERIES.flatMap(series=>Object.keys(series.items)));
function archiveSite(item,key){
  const site=surveySite(key);
  if(!site||!ARCHIVE_ITEMS.has(item))return null;
  const table=FIELD_ZONES[site.zone].boxes[site.index][2];
  return ITEM_META[item].lootSources.includes(table)?site:null;
}
function validArchiveRecord(row){
  return row&&typeof row==='object'&&!Array.isArray(row)&&archiveSite(row.item,row.source)&&
    Number.isSafeInteger(row.raidId)&&row.raidId>0&&Number.isSafeInteger(row.returnedAt)&&
    row.returnedAt>=row.raidId&&row.returnedAt-row.raidId<RAID_DURATION_MS;
}
function validArchiveRows(rows){
  return Array.isArray(rows)&&rows.length<=ARCHIVE_ITEMS.size&&rows.every(validArchiveRecord)&&
    new Set(rows.map(row=>row.item)).size===rows.length;
}
function validRecoveryArchive(s){
  const rows=s.career?.archive,added=s.lastSummary?.archiveItems;
  if(rows!==undefined&&!validArchiveRows(rows))return false;
  if(added===undefined)return true;
  const result=s.lastSummary;
  return ['success','quick'].includes(result.rating)&&result.result==='success'&&Array.isArray(added)&&
    added.length>0&&added.length<=ARCHIVE_ITEMS.size&&new Set(added).size===added.length&&
    added.every(id=>result.goods?.includes(id)&&rows?.some(r=>r.item===id&&r.raidId===result.raidId&&r.returnedAt===result.raidId+result.elapsed));
}
function recordArchiveReturn(bag,returnedAt){
  const known=new Set((career.archive||[]).map(row=>row.item)),added=[];
  for(const unit of bag){
    if(!unit.revealed||!ARCHIVE_ITEMS.has(unit.g)||known.has(unit.g))continue;
    const source=/^([0-2]-(?:0|[1-9]\d*))-(?:0|[1-9]\d*)$/.exec(unit.uid)?.[1];
    const site=archiveSite(unit.g,source);
    if(!site||!field.found[site.zone]?.includes(site.index)||!field.boxes[source])continue;
    added.push({item:unit.g,source,raidId:raid.startedAt,returnedAt});
    known.add(unit.g);
  }
  if(added.length)career.archive=[...(career.archive||[]),...added];
  return added.map(row=>row.item);
}
function archiveReturnNote(summary){
  if(!summary?.archiveItems?.length)return '';
  const labels=summary.archiveItems.map(id=>esc(kitName(id))).join(', ');
  return '<p class="archive-return" data-archive-return>회수품 기록실에 첫 표본 등록 · '+labels+'</p>';
}
function recoveryArchivePanel(){
  const catalog=new Map((career.archive||[]).map(row=>[row.item,row]));
  const series=ARCHIVE_SERIES.map(set=>{
    const ids=Object.keys(set.items),count=ids.filter(id=>catalog.has(id)).length;
    const entries=ids.map(id=>{
      const record=catalog.get(id),site=record&&surveySite(record.source);
      const sources=ITEM_META[id]?.lootSources?.map(table=>LOOT_TABLES[table]?.name).filter(Boolean);
      const meta=site?esc(FIELD_ZONES[site.zone].name)+' · '+esc(site.name):'미등록'+(sources?.length?' · '+esc(sources.join(', ')):'');
      return '<li data-archive-item="'+id+'" data-recorded="'+Boolean(site)+'"><div><b>'+esc(kitName(id))+'</b><small>'+meta+'</small></div>'+
        (site?'<p>'+esc(set.items[id])+'</p>':'<button type="button" data-db="archive-item" data-id="'+id+'" aria-label="'+esc(kitName(id))+' 수색처 보기">수색처 보기</button>')+'</li>';
    }).join('');
    return '<details class="archive-series"><summary>'+esc(set.name)+' · '+count+' / '+ids.length+'점</summary><ul>'+entries+'</ul>'+
      (count===ids.length?'<figure class="archive-plate">'+bunkerPicture(set.art,set.alt)+
        '<figcaption class="archive-caption" data-archive-caption>'+esc(set.complete)+'</figcaption></figure>':'')+'</details>';
  }).join('');
  const linked=typeof activeTerminalLink!=='undefined'&&activeTerminalLink?.hash==='#archive';
  return '<details class="bu-box recovery-archive" data-recovery-archive'+(linked?' open':'')+'><summary>회수품 기록실 · '+catalog.size+' / '+ARCHIVE_ITEMS.size+'점</summary>'+
    '<p>현장의 보관함에서 직접 찾아 가방에 담고 생환하면 첫 발견 장소와 해설이 남습니다. 등록한 원본은 창고에서 계속 사용할 수 있습니다.</p>'+series+'</details>';
}

function archiveCatalogBack(){
  return archiveCatalogOrigin?'<button type="button" data-db="archive-return">‹ '+esc(kitName(archiveCatalogOrigin))+' 기록으로</button>':'';
}
function returnToArchiveItem(id){
  navigatePage('bunker');
  const row=$('[data-archive-item="'+id+'"]');
  if(!row)return;
  row.closest('[data-recovery-archive]').open=true;
  const series=row.closest('.archive-series');
  series.open=true;
  const target=row.querySelector('[data-db="archive-item"]')||series.querySelector('summary');
  target.focus({preventScroll:true});
  target.scrollIntoView({block:'nearest'});
}
function archiveDisclosures(){
  const panel=$('[data-recovery-archive]');
  return panel?.querySelectorAll?[panel,...panel.querySelectorAll('.archive-series')]:[];
}
function captureArchiveView(){
  const views=archiveDisclosures();
  if(!views.length)return null;
  const focus=document.activeElement;
  const item=focus?.dataset?.db==='archive-item'?focus.dataset.id:null;
  return {item,open:views.map(el=>el.open),focus:views.findIndex(el=>el.querySelector('summary')===document.activeElement)};
}
function restoreArchiveView(view){
  if(!view)return;
  const panels=archiveDisclosures();
  panels.forEach((el,i)=>{el.open=Boolean(view.open[i]);});
  const focus=view.item?$('[data-db="archive-item"][data-id="'+view.item+'"]'):panels[view.focus]?.querySelector('summary');
  focus?.focus({preventScroll:true});
}
