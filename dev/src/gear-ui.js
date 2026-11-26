// The selected UID is presentation state. Every operation rechecks the physical item.
let maintenanceUid=null, maintenanceNotice=null, maintenanceStart=0;
const MAINTENANCE_PAGE_SIZE=5;
const MAINTENANCE_ORDER=['primary','secondary','armor','head','eyes','light','comms'];
function resetMaintenanceUI(){maintenanceUid=null;maintenanceNotice=null;maintenanceStart=0;}
function gearSerial(uid){return String(uid).slice(-8);}
function maintenanceLocation(entry){
  if(entry.location==='worn')return '착용 중 · '+(KIT_SLOTS[entry.slot]?.label||'장비');
  const position=entry.unit&&Number.isInteger(entry.unit.y)&&Number.isInteger(entry.unit.x)?' · '+(entry.unit.y+1)+'행 '+(entry.unit.x+1)+'열':'';
  if(entry.location==='bag')return '준비 가방'+position;
  if(entry.location==='case')return (entry.box?.alias||kitName(entry.box?.g))+position;
  if(entry.location==='overflow')return '창고 입고 대기';
  return '벙커 창고'+position;
}
function maintenanceStateLine(gear){
  const spec=gearSpec(gear.g);
  return (spec.capacity?'탄약 '+gear.ammo+'/'+spec.capacity+'발 · ':'')+'내구도 '+gear.durability+'/'+spec.maxDurability;
}
function maintenanceRows(){
  const rows=gearOwned();
  const priority=row=>row.location==='worn'?Math.max(1,MAINTENANCE_ORDER.indexOf(row.slot)+1):100;
  return rows.sort((a,b)=>priority(a)-priority(b));
}
function gearReadinessMarkup(kit,fieldMode=false){
  const stats=Object.keys(kit.worn||{}).sort((a,b)=>MAINTENANCE_ORDER.indexOf(a)-MAINTENANCE_ORDER.indexOf(b))
    .map(slot=>({slot,gear:gearWorn(kit,slot)})).filter(r=>r.gear);
  return '<section class="gm-readiness" data-gear-readiness><div class="gm-readiness-head"><h2>착용 장비 상태</h2>'+
    (fieldMode?(page==='inventory'?'':'<button type="button" data-page="inventory">현장 장비 보기</button>'):'<button type="button" data-page="maintenance">장비 정비</button>')+'</div>'+
    (stats.length?'<ul>'+stats.map(({slot,gear})=>'<li data-gear-ready-slot="'+esc(slot)+'" data-uid="'+esc(gear.uid)+'"><b>'+esc(kitName(gear.g))+'</b><span>'+
      esc(maintenanceStateLine(gear))+(!fieldMode&&gear.durability<gearSpec(gear.g).maxDurability?' · 수리 '+money(gearServiceQuote(gear.uid,'repair').cost):'')+'</span></li>').join('')+'</ul>':'<p>탄약·내구도를 기록하는 착용 장비가 없습니다.</p>')+'</section>';
}
function maintenancePicker(rows,selected){
  const maxStart=Math.max(0,(Math.ceil(rows.length/MAINTENANCE_PAGE_SIZE)-1)*MAINTENANCE_PAGE_SIZE);
  maintenanceStart=Math.min(maintenanceStart,maxStart);
  const windowRows=rows.slice(maintenanceStart,maintenanceStart+MAINTENANCE_PAGE_SIZE);
  const serialCounts=new Map();
  for(const row of rows){
    const serial=gearSerial(row.gear.uid);
    serialCounts.set(serial,(serialCounts.get(serial)||0)+1);
  }
  return '<section class="gm-list" aria-label="보유 장비 선택"><header><h2>보유 장비</h2><span>'+rows.length+'점</span></header>'+
    '<div class="gm-choices">'+windowRows.map(entry=>{
      const item=entry.gear, serial=gearSerial(item.uid);
      return '<button type="button" data-maintenance="select" data-uid="'+esc(item.uid)+'" data-item="'+esc(item.g)+'" data-location="'+esc(entry.location)+
        '" aria-pressed="'+(item.uid===selected.gear.uid)+'"><span class="gm-choice-top"><b>'+esc(kitName(item.g))+'</b><span class="gm-serial">#'+
        esc(serialCounts.get(serial)===1?serial:item.uid)+'</span></span><small>'+esc(maintenanceLocation(entry))+'</small><span class="gm-choice-stats">'+esc(maintenanceStateLine(item))+'</span></button>';
    }).join('')+'</div>'+(rows.length>MAINTENANCE_PAGE_SIZE?'<div class="gm-pager"><button type="button" data-maintenance="prev"'+
      (!maintenanceStart?' disabled':'')+'>이전</button><span>'+(maintenanceStart+1)+'–'+Math.min(rows.length,maintenanceStart+MAINTENANCE_PAGE_SIZE)+
      ' / '+rows.length+'</span><button type="button" data-maintenance="next"'+(maintenanceStart>=maxStart?' disabled':'')+'>다음</button></div>':'')+'</section>';
}
function maintenanceMeter(label,tag,value,maximum,suffix){
  return '<div class="gm-meter" data-gear-'+tag+'="'+value+'" data-max="'+maximum+'"><div><span>'+label+'</span><strong>'+value+' <small>/ '+maximum+
    suffix+'</small></strong></div><progress value="'+value+'" max="'+maximum+'" aria-label="'+label+'"></progress></div>';
}
function maintenanceService(gear,kind){
  const q=gearServiceQuote(gear.uid,kind);
  if(!q)return '';
  const repair=kind==='repair',name=repair?'수리':'탄약 보충',unit=repair?'':'발',full=q.qty===0;
  return '<article class="gm-quote" data-service-quote="'+kind+'" data-cost="'+q.cost+'"><div><h3>'+name+'</h3><p>'+
    (full?(repair?'최대 내구도':'탄약 가득 참'):(repair?'내구도 ':'탄약 ')+q.before+unit+' → '+q.after+unit)+'</p></div>'+
    '<div class="gm-quote-action"><strong>'+money(q.cost)+'</strong><button type="button" data-maintenance="'+kind+'" data-uid="'+esc(gear.uid)+
    '" data-before="'+q.before+'"'+(q.reason||full||!writer?' disabled':'')+'>'+name+' 확정</button></div>'+
    (q.reason&&!full?'<p class="gm-reason">'+esc(q.reason)+'</p>':'')+'</article>';
}
function maintenanceDetail(entry){
  const gear=entry.gear,spec=gearSpec(gear.g),worn=entry.location==='worn';
  return '<section class="gm-sheet" data-maintenance-selected data-uid="'+esc(gear.uid)+'" data-item="'+esc(gear.g)+'" aria-label="선택 장비">'+
    '<div class="gm-identity"><div class="gm-item-art">'+itemArt(gear.g)+'</div><div><p class="gm-location">'+esc(maintenanceLocation(entry))+'</p>'+
    '<h2 tabindex="-1" data-maintenance-heading>'+esc(kitName(gear.g))+'</h2><p class="gm-full-id">실물 ID <span>'+esc(gear.uid)+'</span></p></div></div>'+
    '<div class="gm-condition">'+(spec.capacity?maintenanceMeter('탄약','ammo',gear.ammo,spec.capacity,'발'):'')+
    maintenanceMeter('내구도','durability',gear.durability,spec.maxDurability,'')+'</div>'+
    '<div class="gm-attachment"><span>장착 부품</span><b data-gear-module="'+esc(gear.module||'')+'">'+(gear.module?esc(kitName(gear.module)):'없음')+'</b></div>'+
    (!worn?'<button class="gm-equip" type="button" data-maintenance="equip" data-uid="'+esc(gear.uid)+'"'+(!writer?' disabled':'')+'>'+
      esc(KIT_SLOTS[kitSlot(gear.g)]?.label||'장비')+' 슬롯에 장착</button>':'')+
    '<div class="gm-service-head"><h2>벙커 정비 견적</h2><span>잔액 <strong data-maintenance-wallet="'+wallet+'">'+money(wallet)+'</strong></span></div>'+
    '<div class="gm-quotes">'+maintenanceService(gear,'repair')+(spec.capacity?maintenanceService(gear,'reload'):'')+
    (spec.capacity?Object.entries(EXCHANGE_AMMO).filter(([id])=>stashSlots.some(u=>u.g===id)).map(([id,rounds])=>
      '<article class="gm-quote"><div><h3>'+esc(kitName(id))+'</h3><p>실물 1개로 최대 '+rounds+'발 보충</p></div><button type="button" data-maintenance="pack" data-uid="'+esc(gear.uid)+'" data-item="'+id+'" data-before="'+gear.ammo+'"'+(!writer||gear.ammo>=spec.capacity?' disabled':'')+'>탄약팩 사용</button></article>').join(''):'')+'</div>'+
    '<p class="gm-notice" role="status" tabindex="-1" data-maintenance-status>'+
      (maintenanceNotice?esc(maintenanceNotice.message):'')+'</p></section>';
}
function maintenancePage(){
  const heading='<header class="gm-header"><div><h1>장비 정비</h1><p>보유 장비를 선택해 탄약·내구도와 수리 견적을 확인하세요.</p></div>'+
    '<button type="button" data-page="'+(raid?'raid':'prep')+'">'+(raid?'작전으로 복귀':'출격 준비')+'</button></header>';
  if(raid)return '<article class="gm-page" data-maintenance-page>'+heading+'<section class="gm-empty"><p>출격 정산을 마치면 벙커에서 장비를 수리하고 탄약을 보충할 수 있습니다.</p></section></article>';
  const rows=maintenanceRows();
  if(!rows.length)return '<article class="gm-page" data-maintenance-page>'+heading+'<section class="gm-empty"><p>정비할 수 있는 보유 장비가 없습니다.</p><button type="button" data-page="trade">벙커 상점</button></section></article>';
  const selected=rows.find(e=>e.gear.uid===maintenanceUid)||rows[0];maintenanceUid=selected.gear.uid;
  return '<article class="gm-page" data-maintenance-page>'+heading+'<div class="gm-layout">'+maintenancePicker(rows,selected)+maintenanceDetail(selected)+'</div></article>';
}
function handleMaintenanceUI(d){
  if(page!=='maintenance'||raid||!writer)return;
  if(d.maintenance==='prev'||d.maintenance==='next'){
    const step=d.maintenance==='prev'?-MAINTENANCE_PAGE_SIZE:MAINTENANCE_PAGE_SIZE;
    maintenanceStart=Math.max(0,maintenanceStart+step);renderKeep();
    $('[data-maintenance="select"]')?.focus?.({preventScroll:true});return;
  }
  if(d.maintenance==='select'){
    if(!gearLookup(d.uid))return;
    maintenanceUid=d.uid;maintenanceNotice=null;renderKeep();
    const heading=$('[data-maintenance-heading]');heading?.focus?.({preventScroll:true});
    heading?.scrollIntoView?.({block:'nearest'});return;
  }
  if(maintenanceUid!==d.uid)return;
  if(d.maintenance==='equip'){
    maintenanceNotice=wearStoredGear(d.uid);
    if(maintenanceNotice.ok)maintenanceStart=0;
  }
  else if(d.maintenance==='pack')maintenanceNotice=exchangeReload(d.uid,Number(d.before),d.item);
  else if(d.maintenance==='repair'||d.maintenance==='reload')maintenanceNotice=performGearService(d.uid,d.maintenance,Number(d.before));
  else return;
  maintenanceUid=d.uid;
  renderKeep();$('[data-maintenance-status]')?.focus?.({preventScroll:true});
}
function captureMaintenanceFocus(){
  if(page!=='maintenance')return null;
  const el=document.activeElement;
  if(!el?.closest?.('[data-maintenance-page]'))return null;
  return el.dataset.maintenance?{action:el.dataset.maintenance,uid:el.dataset.uid}:
    el.hasAttribute?.('data-maintenance-status')?{status:true}:el.hasAttribute?.('data-maintenance-heading')?{heading:true}:null;
}
function restoreMaintenanceFocus(state){
  if(!state||page!=='maintenance')return;
  const el=state.status?$('[data-maintenance-status]'):state.heading?$('[data-maintenance-heading]'):
    [...document.querySelectorAll('[data-maintenance]')].find(b=>b.dataset.maintenance===state.action&&b.dataset.uid===state.uid&&!b.disabled);
  el?.focus?.({preventScroll:true});
}
