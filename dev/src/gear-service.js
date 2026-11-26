// Prices and consumption are game balance units for the B-04 equipment service.
const GEAR_FEES={repair:90,reload:40};
const ENGAGEMENT_LOAD={primary:{rounds:3,wear:2},secondary:{rounds:2,wear:1}};

function gearServiceQuote(uid,kind){
  const entry=!raid && gearOwned().find(row=>row.gear.uid===uid);
  const q={uid,id:entry?.gear.g||null,kind,before:0,after:0,qty:0,cost:0,reason:''};
  if(!entry || !Object.hasOwn(GEAR_FEES,kind)){
    q.reason=raid?'벙커 귀환 후 정비할 수 있습니다.':'정비할 실물 장비를 다시 선택하세요.';
    return q;
  }
  const gear=entry.gear, spec=gearSpec(gear.g);
  q.before=kind==='repair'?gear.durability:gear.ammo;
  q.after=kind==='repair'?spec.maxDurability:spec.capacity;
  q.qty=q.after-q.before;
  q.cost=q.qty*GEAR_FEES[kind];
  if(kind==='reload'&&!spec.capacity)q.reason='탄약을 사용하지 않는 장비입니다.';
  else if(!q.qty)q.reason=kind==='repair'?'내구도가 최대입니다.':'탄약이 가득 찼습니다.';
  else if(wallet<q.cost)q.reason='잔액 부족 · '+money(q.cost-wallet)+' 더 필요';
  return q;
}

function performGearService(uid,kind,expectedBefore){
  if(!writer)return {ok:false,message:'저장 가능한 창에서 정비하세요.'};
  const q=gearServiceQuote(uid,kind);
  if(q.reason)return {ok:false,message:q.reason};
  if(q.before!==expectedBefore)return {ok:false,message:'장비 상태가 달라졌습니다. 현재 견적을 확인하세요.'};
  const kit=equipmentState, gear=gearLookup(uid), oldWallet=wallet;
  const stat=kind==='repair'?'durability':'ammo';
  gear[stat]=q.after;
  wallet-=q.cost;
  if(!writeSession()){
    if(equipmentState===kit){gear[stat]=q.before;wallet=oldWallet;}
    return {ok:false,message:'정비를 저장하지 못했습니다. 최신 장비 상태를 확인하고 다시 시도하세요.'};
  }
  return {ok:true,message:kitName(q.id)+' '+(kind==='repair'?'수리':'탄약 보충')+' 완료 · '+q.before+' → '+q.after+' · '+money(q.cost)+' 차감'};
}

function gearStrikeQuote(slot){
  const gear=gearWorn(field,slot), price=ENGAGEMENT_LOAD[slot];
  if(!gear || !price)return null;
  const shortages=[];
  if(gear.ammo<price.rounds)shortages.push('탄약 '+price.rounds+'발 필요 · 보유 '+gear.ammo+'발');
  if(gear.durability<price.wear)shortages.push('내구도 '+price.wear+' 필요 · 현재 '+gear.durability);
  return {gear,price,reason:shortages.join(' / ')};
}

function initializeGearLedger(version){
  const action=field?.action;
  // A countdown already paid for by an older game's rules keeps its original deadline and result.
  if(version>=25)return;
  delete field.gearUsage;
  delete field.legacyEngagement;
  if(lastSummary)delete lastSummary.gearReport;
  if(action?.type==='engage'){
    delete action.strike;
    action.legacyGear=true;
    field.legacyEngagement={raidId:raid.startedAt,start:action.start,end:action.end};
  }
}

function beginGearEngage(requested){
  if(!writer || !isActive() || !field.contact || field.action)return;
  const slot=requested || (field.worn.primary?'primary':field.worn.secondary?'secondary':'none');
  if(!['primary','secondary','none'].includes(slot))return;
  const q=gearStrikeQuote(slot);
  if(slot==='none'?(field.worn.primary || field.worn.secondary):(!q || q.reason))return;
  const start=Date.now(), end=start+actionDuration('engage',3000), current=field;
  field.action={type:'engage',start,end,strike:{slot,uid:q?.gear.uid||null,
    attackRoll:Math.floor(Math.random()*7),defenseRoll:Math.floor(Math.random()*5)}};
  if(!writeSession() && field===current){
    field.action=null;
    notice='교전을 저장하지 못했습니다. 다시 시도하세요.';
  }else notice='';
  renderKeep();
}

function recordGearUse(gear,rounds,wear){
  if(!gear || (!rounds&&!wear))return;
  const ledger=field.gearUsage??=[];
  let row=ledger.find(item=>item.uid===gear.uid);
  if(!row){
    row={uid:gear.uid,g:gear.g,ammoBefore:gear.ammo,durabilityBefore:gear.durability,ammoUsed:0,wear:0};
    ledger.push(row);
  }
  gear.ammo-=rounds;gear.durability-=wear;
  row.ammoUsed+=rounds;row.wear+=wear;
  // A failed timer write must restore the pending action AND the entire previous player state.
  settlementNeedsCommit=true;
}

function payEngagement(action){
  if(action.legacyGear)return true;
  const choice=action.strike;
  if(!choice)return false;
  if(choice.slot==='none')return !field.worn.primary && !field.worn.secondary;
  const q=gearStrikeQuote(choice.slot);
  if(!q || q.reason || q.gear.uid!==choice.uid)return false;
  recordGearUse(q.gear,q.price.rounds,q.price.wear);
  return true;
}

function wearEquipment(slot){
  const gear=gearWorn(field,slot);
  if(gear?.durability>0)recordGearUse(gear,0,1);
}

function workingRaidRadio(){
  const worn=gearWorn(field,'comms');
  return worn?.durability>0?worn:field.bag.find(unit=>unit.g==='radio' && unit.gear?.durability>0)?.gear;
}

function wearSensors(type){
  const modules=field.modules||{};
  for(const slot of ['light','eyes','comms']){
    if((slot==='light' && type==='scan') || (modules[slot] && KIT_MODULE_TIMERS[slot]?.[modules[slot]]===type))
      wearEquipment(slot);
  }
}

function gearEngageButtons(busy){
  const guns=['primary','secondary'].filter(slot=>field.worn[slot]);
  if(!guns.length)return '<button class="primary" data-field="engage" '+(busy?'disabled':'')+'>교전 · 3초</button>';
  return guns.map(slot=>{
    const q=gearStrikeQuote(slot);
    if(!q)return '';
    const label=KIT_SLOTS[slot].label+' 교전 · 3초';
    return '<div class="gear-engage-option"><button class="primary" data-field="engage" data-slot="'+slot+'" '+(busy||q.reason?'disabled':'')+'>'+label+'</button>'+
      '<small>'+esc(kitName(q.gear.g))+' · 탄약 '+q.gear.ammo+'발 / 내구도 '+q.gear.durability+'<br>'+
      (q.reason?esc(q.reason):'완료 시 탄약 −'+q.price.rounds+'발 · 내구도 −'+q.price.wear)+'</small></div>';
  }).join('');
}

function sortieGearReport(returned){
  const records=new Map((field.gearUsage||[]).map(row=>[row.uid,{...row,disposition:'left'}]));
  function add(gear,disposition){
    if(!gear)return;
    const row=records.get(gear.uid)||{uid:gear.uid,g:gear.g,ammoBefore:gear.ammo,durabilityBefore:gear.durability,ammoUsed:0,wear:0};
    row.disposition=disposition;
    records.set(row.uid,row);
  }
  for(const units of field.gearGround||[])for(const unit of units)add(unit.gear,'left');
  const disposition=returned?'returned':'lost';
  for(const unit of field.bag)add(unit.gear,disposition);
  for(const slot of Object.keys(field.worn||{}))add(gearWorn(field,slot),disposition);
  return [...records.values()];
}

function gearSettlementMarkup(summary){
  if(!summary.gearReport?.length)return '';
  const labels={returned:'회수',lost:'손실',left:'현장에 남김'};
  return '<h3>장비 사용 정산</h3><div class="gear-use-report">'+summary.gearReport.map(row=>{
    const spec=gearSpec(row.g), ammo=spec.capacity?'탄약 '+row.ammoBefore+' → '+(row.ammoBefore-row.ammoUsed)+'발 (사용 '+row.ammoUsed+'발) · ':'';
    return '<div><b>'+esc(kitName(row.g))+'</b> · '+labels[row.disposition]+' <small>'+esc(row.uid)+'</small><p>'+ammo+
      '내구도 '+row.durabilityBefore+' → '+(row.durabilityBefore-row.wear)+' (소모 '+row.wear+')</p></div>';
  }).join('')+'</div>';
}

// This exceeds the current 46 containers × 5 rolls, 60 bag cells and all 15 worn slots combined.
const HISTORY_GEAR_LIMIT=320;
const HISTORY_GEAR_FIELDS=['uid','g','ammoBefore','durabilityBefore','ammoUsed','wear','disposition'];
function archiveGearReport(report){
  if(report.length<=HISTORY_GEAR_LIMIT)return {gearReport:report};
  return {gearReport:report.slice(0,HISTORY_GEAR_LIMIT),gearOmitted:report.length-HISTORY_GEAR_LIMIT};
}
function validGearRows(rows,reported,exact=false){
  if(!Array.isArray(rows))return false;
  const integer=(n,limit)=>Number.isSafeInteger(n)&&n>=0&&n<=limit;
  const seen=new Set();
  return rows.every(row=>{
    if(!row || typeof row.g!=='string' || typeof row.uid!=='string'||!/^[a-z0-9_-]{1,140}$/i.test(row.uid)||seen.has(row.uid))return false;
    if(exact && Object.keys(row).length!==HISTORY_GEAR_FIELDS.length)return false;
    seen.add(row.uid);
    const spec=gearSpec(row.g);
    return Boolean(spec && integer(row.ammoBefore,spec.capacity)&&integer(row.durabilityBefore,spec.maxDurability)&&
      integer(row.ammoUsed,row.ammoBefore)&&integer(row.wear,row.durabilityBefore)&&
      (!reported || ['returned','lost','left'].includes(row.disposition)));
  });
}
function validHistoryGear(row){
  if(row.gearReport===undefined)return row.gearOmitted===undefined;
  const rows=row.gearReport;
  if(!Array.isArray(rows)||rows.length>HISTORY_GEAR_LIMIT||!validGearRows(rows,true,true))return false;
  if(row.gearOmitted!==undefined && !(rows.length===HISTORY_GEAR_LIMIT&&Number.isSafeInteger(row.gearOmitted)&&row.gearOmitted>0))return false;
  const returned=row.rating==='success'||row.rating==='quick';
  return rows.every(gear=>gear.disposition!==(returned?'lost':'returned'));
}
function historyGearMatches(row,summary){
  if(!row.gearReport || !Array.isArray(summary?.gearReport) || row.at-row.elapsed!==summary.raidId)return true;
  const actual=archiveGearReport(summary.gearReport);
  if(actual.gearReport.length!==row.gearReport.length || actual.gearOmitted!==row.gearOmitted)return false;
  const byUid=new Map(actual.gearReport.map(gear=>[gear.uid,gear]));
  return row.gearReport.every(gear=>HISTORY_GEAR_FIELDS.every(key=>gear[key]===byUid.get(gear.uid)?.[key]));
}
function historyGearMarkup(row){
  if(row.gearReport===undefined)return '<p class="bu-minor">이전 출격의 개별 장비 내역은 보관되지 않았습니다.</p>';
  if(!row.gearReport.length)return '<p>개별 정산 장비 없음</p>';
  return gearSettlementMarkup(row)+(row.gearOmitted?'<p>개별 기록 한도 '+HISTORY_GEAR_LIMIT+'개 · 추가 '+row.gearOmitted+'개 생략</p>':'');
}

function validGearLedger(s){
  const integer=(n,limit)=>Number.isSafeInteger(n)&&n>=0&&n<=limit;
  const f=s.field;
  if(f.gearUsage!==undefined && (!s.raid || f.result || !validGearRows(f.gearUsage,false)))return false;
  if(f.gearUsage?.length){
    const carried=[...Object.values(f.instances||{}),...f.bag.map(unit=>unit.gear),
      ...(f.gearGround||[]).flat().map(unit=>unit.gear)].filter(Boolean);
    const byId=new Map(carried.map(gear=>[gear.uid,gear]));
    for(const row of f.gearUsage){
      const gear=byId.get(row.uid);
      if(!gear || gear.g!==row.g || gear.ammo!==row.ammoBefore-row.ammoUsed ||
         gear.durability!==row.durabilityBefore-row.wear || (!row.ammoUsed&&!row.wear))return false;
    }
  }
  const report=s.lastSummary?.gearReport;
  if(report!==undefined && (!validGearRows(report,true) || report.some(row=>row.disposition===(s.lastSummary.result==='success'?'lost':'returned'))))return false;
  const a=f.action;
  const legacy=f.legacyEngagement;
  if(!a)return legacy===undefined;
  if(a.type!=='engage')return legacy===undefined && a.strike===undefined && a.legacyGear===undefined;
  if(!f.contact || !s.raid || f.result || a.start<s.raid.startedAt || a.start>=s.raid.endsAt || a.end!==a.start+3000)return false;
  if(a.legacyGear===true)return !a.strike && legacy?.raidId===s.raid.startedAt &&
    legacy.start===a.start && legacy.end===a.end && !f.gearUsage?.length;
  if(legacy!==undefined)return false;
  const p=a.strike;
  if(!p || a.legacyGear!==undefined || !integer(p.attackRoll,6)||!integer(p.defenseRoll,4))return false;
  if(p.slot==='none')return p.uid===null && !f.worn.primary && !f.worn.secondary;
  const gear=f.instances?.[p.slot], price=Object.hasOwn(ENGAGEMENT_LOAD,p.slot)?ENGAGEMENT_LOAD[p.slot]:null;
  return Boolean(price && gear && p.uid===gear.uid && gear.ammo>=price.rounds && gear.durability>=price.wear);
}
