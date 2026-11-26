// Only an actual inventory use at a known landmark qualifies; road supplies may still be consumed normally.
const RATION_ORDER='ration-survey',RATION_MIN=5,RATION_TOTAL=20;
function rationPair(rows=[]){
  let best=null;
  for(const meal of rows.filter(row=>row.stat==='energy')){
    for(const drink of rows.filter(row=>row.stat==='water'&&row.zone!==meal.zone)){
      const gain=(meal.after-meal.before)+(drink.after-drink.before);
      if(!best||gain>best.gain)best={meal,drink,gain};
    }
  }
  return best;
}
function rationLogUse(unit,q){
  if(career.order!==RATION_ORDER||field.journey||q.gain<RATION_MIN)return;
  const rows=field.rationUses||[],index=rows.findIndex(row=>row.zone===raid.zone&&row.stat===q.stat);
  if(index>=0&&rows[index].after-rows[index].before>=q.gain)return;
  const entry={uid:unit.uid,id:unit.g,stat:q.stat,before:q.before,after:q.after,nominal:q.nominal,zone:raid.zone,at:Date.now()};
  field.rationUses=index<0?[...rows,entry]:rows.map((r,i)=>i===index?entry:r);
}
function rationOrderGoals(){
  const done=career.done.includes(RATION_ORDER),rows=isActive()&&career.order===RATION_ORDER?field.rationUses||[]:[];
  const pair=rationPair(rows);
  return [['거점에서 식량으로 기력 +5 이상',Number(done||rows.some(r=>r.stat==='energy')),1],
    ['거점에서 음료로 수분 +5 이상',Number(done||rows.some(r=>r.stat==='water')),1],
    ['서로 다른 두 권역의 실효 회복 합계',done?RATION_TOTAL:Math.min(RATION_TOTAL,pair?.gain||0),RATION_TOTAL],
    ['정상 탈출',Number(done),1]];
}
function rationUseHint(q){
  if(career.order!==RATION_ORDER||!isActive())return '';
  if(field.journey)return ' · 길 위 사용은 급양표 측정에서 제외';
  if(q.gain<RATION_MIN)return ' · 급양표 기준까지 '+(RATION_MIN-q.gain)+' 부족';
  const rows=field.rationUses||[],record=rows.find(r=>r.stat===q.stat&&r.zone===raid.zone);
  return record&&record.after-record.before>=q.gain?' · 이 권역의 기존 기록 유지':' · '+FIELD_ZONES[raid.zone].name+' 급양표에 기록 가능';
}
function rationSheet(rows){
  if(!rows?.length)return '<p>현재 출격에 남긴 급양 기록이 없습니다.</p>';
  const pair=rationPair(rows);
  return '<ul>'+rows.map(r=>'<li>'+esc(FIELD_ZONES[r.zone].name)+' · '+esc(kitName(r.id))+' · '+(r.stat==='water'?'수분':'기력')+' +'+(r.after-r.before)+'</li>').join('')+
    '</ul><strong>'+(pair?'서로 다른 권역 합계 +'+pair.gain+' / '+RATION_TOTAL:'다른 권역에서 나머지 종류를 사용하세요.')+'</strong>';
}
function rationSurveyPanel(){
  if(career.order!==RATION_ORDER||!isActive())return '';
  return '<details class="pump-gauge" data-ration-survey><summary>이번 출격 급양표</summary>'+rationSheet(field.rationUses)+'</details>';
}
function rationReceipt(summary){
  return summary?.rationUses?'<details class="field-section" data-ration-receipt><summary>원정 급양표 · 정산에 쓰인 두 기록</summary>'+rationSheet(summary.rationUses)+'</details>':'';
}
function validRationRows(rows,start,end,visited,levels){
  if(!Array.isArray(rows)||rows.length<1||rows.length>6)return false;
  const units=new Set(),sites=new Set();
  return rows.every(r=>{
    if(!r||!Object.hasOwn(GOODS,r.id)||!['energy','water'].includes(r.stat)||kitSupply(r.id)?.stat!==r.stat||
      !Number.isInteger(r.zone)||!FIELD_ZONES[r.zone]||(visited&&!visited.includes(r.zone))||
      !Number.isSafeInteger(r.at)||r.at<start||r.at>end||r.at>=start+RAID_DURATION_MS||r.at>Date.now()||
      typeof r.uid!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(r.uid)||units.has(r.uid))return false;
    const base=r.stat==='water'?25:20,key=r.zone+'-'+r.stat;
    if(!Number.isInteger(r.before)||r.before<0||!Number.isInteger(r.nominal)||r.nominal<base||r.nominal>base+3*(levels?.[r.stat==='water'?'water':'kitchen']||0)||
      (r.nominal-base)%3||r.after!==Math.min(100,r.before+r.nominal)||r.after-r.before<RATION_MIN||sites.has(key))return false;
    units.add(r.uid);sites.add(key);return true;
  });
}
function validRationSurvey(s){
  const c=s.career,f=s.field,r=s.raid,a=s.lastSummary;
  const active=c?.order===RATION_ORDER,done=c?.done?.includes?.(RATION_ORDER);
  if(!active&&!done&&f?.rationUses===undefined&&a?.rationUses===undefined)return true;
  if(!Array.isArray(c?.done)||!c.done.includes('scout')||(active&&done))return false;
  if(f?.rationUses!==undefined){
    if(!r||f.result||!active||!Array.isArray(f.visited)||!Array.isArray(f.bag)||!Array.isArray(f.gearGround)||!f.gearGround.every(Array.isArray)||
      !validRationRows(f.rationUses,r.startedAt,r.endsAt-1,f.visited,s.hideout?.levels))return false;
    const consumed=new Set(f.rationUses.map(row=>row.uid));
    if([...f.bag,...f.gearGround.flat()].some(unit=>consumed.has(unit?.uid)))return false;
  }
  const order=ORDERS.find(q=>q.id===RATION_ORDER);
  if(a?.orderName!==order.title)return a?.rationUses===undefined;
  return Boolean(done&&a.rating==='success'&&a.commission===order.cr&&a.missionXp===order.xp&&
    a.rationUses?.length===2&&validRationRows(a.rationUses,a.raidId,a.raidId+a.elapsed,null,s.hideout?.levels)&&(rationPair(a.rationUses)?.gain||0)>=RATION_TOTAL);
}
