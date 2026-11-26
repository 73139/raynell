// Physical condition belongs to a host, independent of the tile used by a particular grid.
const GEAR_CAPACITY = {rl_x_carbine:36,rl_x_armor:0,rl10_carbine:30,rl12_sidearm:12,rl10_vest:0,rl12_helmet:0,
  flash:0,rl_13_05:0,rl_13_07:0,rl_13_08:0,radio:0};
let gearOverflow = [];
function gearSpec(id) {
  return Object.hasOwn(GEAR_CAPACITY,id) ? {capacity:GEAR_CAPACITY[id],maxDurability:100} : null;
}
function gearCreate(id,uid=null,module=null) {
  const spec=gearSpec(id);
  return spec ? {uid:uid||newStashUid(),g:id,ammo:spec.capacity,durability:spec.maxDurability,module} : null;
}
function gearEnsureUnit(unit) {
  if (!unit || !gearSpec(unit.g)) return null;
  if (!unit.gear || unit.gear.g!==unit.g) unit.gear=gearCreate(unit.g);
  return unit.gear;
}
function gearWorn(kit,slot) {
  const id=kit?.worn?.[slot];
  if (!gearSpec(id)) return null;
  kit.instances ||= {};
  if (kit.instances[slot]?.g!==id) kit.instances[slot]=gearCreate(id,null,kit.modules?.[slot]||null);
  return kit.instances[slot];
}
function gearMount(kit,slot,id,gear) {
  kit.worn[slot]=id;
  kit.instances ||= {};
  if (gear) kit.instances[slot]=gear; else delete kit.instances[slot];
  kit.modules ||= {};
  if (gear?.module) kit.modules[slot]=gear.module; else delete kit.modules[slot];
}
function gearLoadKit(kit,stored,tag) {
  kit.instances={};
  for (const [slot,id] of Object.entries(kit.worn||{})) {
    if (!gearSpec(id)) continue;
    const record=stored?.[slot];
    kit.instances[slot]=record?.g===id ? record : gearCreate(id,tag?'legacy-'+tag+'-'+slot:null,kit.modules?.[slot]||null);
  }
  for (const unit of [...(kit.bag||[]),...(kit.gearGround||[]).flat()]) {
    if (gearSpec(unit.g)&&!unit.gear) unit.gear=gearCreate(unit.g,'legacy-'+tag+'-'+unit.uid);
  }
}
function loadGearOverflow(raw) { gearOverflow=Array.isArray(raw)?raw.slice():[]; }
// All newly acquired overflow has identity. A huge bulk of identical, unused stock is stored
// as a serial range. Only its next selectable unit is exposed until it leaves the queue.
function gearQueueNew(id,amount) {
  if(!gearSpec(id)||amount<=0) return;
  if(amount<=128) {
    for(let n=0;n<amount;n++) gearOverflow.push(gearCreate(id));
    return;
  }
  const prefix=newStashUid(), record=gearCreate(id,prefix+'-1');
  record.batch={prefix,start:1,count:amount};
  gearOverflow.push(record);
}
function gearQueuePhysical(record) {
  if(!record?.batch) return record;
  const {batch,...physical}=record;
  return physical;
}
function gearQueueRemove(list,id,amount,skipFitted=false) {
  for(let i=0;amount>0&&i<list.length;) {
    const record=list[i];
    if(record.g!==id || (skipFitted && record.module)){i++;continue;}
    const count=record.batch?.count||1;
    if(count<=amount){list.splice(i,1);amount-=count;continue;}
    const {prefix,start}=record.batch, next=start+amount;
    list[i]={...record,uid:prefix+'-'+next,batch:{prefix,start:next,count:count-amount}};
    amount=0;
  }
}
function gearOwned() {
  const rows=[];
  function add(gear,location,slot=null,unit=null,box=null) {
    if (gear) rows.push({gear,location,slot,unit,box});
  }
  for(const unit of stashSlots) {
    add(gearEnsureUnit(unit),'stash',null,unit);
    for(const item of unit.contents||[]) add(gearEnsureUnit(item),'case',null,item,unit);
  }
  for(const gear of gearOverflow) add(gear,'overflow');
  for(const [slot] of Object.entries(equipmentState.worn)) add(gearWorn(equipmentState,slot),'worn',slot);
  for(const unit of equipmentState.bag) add(gearEnsureUnit(unit),'bag',null,unit);
  return rows;
}
function gearLookup(uid) {
  if (raid) return null;
  return gearOwned().find(row=>row.gear.uid===uid)?.gear||null;
}
function gearValid(record,id) {
  const spec=gearSpec(id);
  return Boolean(spec && record && !Array.isArray(record) && record.g===id &&
    typeof record.uid==='string' && /^[a-z0-9_-]{1,140}$/i.test(record.uid) &&
    Number.isInteger(record.durability)&&record.durability>=0&&record.durability<=spec.maxDurability &&
    Number.isInteger(record.ammo)&&record.ammo>=0&&record.ammo<=spec.capacity &&
    (record.module===null||PRESET_MODULES[id]?.includes(record.module)));
}
function validGearBackup(s) {
  const ids=new Set(), counts={}, ranges=new Map();
  function accept(id,gear) {
    if (!gearSpec(id)) return gear===undefined;
    if (!gearValid(gear,id)||ids.has(gear.uid)) return false;
    ids.add(gear.uid);return true;
  }
  function kitValid(kit) {
    if (!kit||typeof kit.worn!=='object'||!kit.worn||!Array.isArray(kit.bag)) return false;
    const worn=kit.worn, hosts=kit.instances;
    if (!hosts||typeof hosts!=='object'||Array.isArray(hosts)||
        Object.keys(hosts).some(slot=>!gearSpec(worn[slot]))) return false;
    return Object.entries(worn).every(([slot,id])=>accept(id,hosts[slot])&&
      (!hosts[slot]||hosts[slot].module===(kit.modules?.[slot]||null))) &&
      kit.bag.every(u=>u&&accept(u.g,u.gear));
  }
  if (!Array.isArray(s.gearOverflow)||!kitValid(s.equipment)) return false;
  if(s.dockCache && (!s.dockCache.unit || !accept(s.dockCache.unit.g,s.dockCache.unit.gear)))return false;
  if (s.raid&&!s.field.result) {
    if (!kitValid(s.field)||!Array.isArray(s.field.gearGround)||!s.field.gearGround.every(list=>Array.isArray(list)&&list.every(u=>u&&accept(u.g,u.gear)))) return false;
    for (const box of Object.values(s.field.boxes||{})) {
      if (!Array.isArray(box?.items)||!box.items.every(u=>u&&(u.gear===undefined||accept(u.g,u.gear)))) return false;
    }
  }
  for (const unit of s.stashSlots) {
    counts[unit.g]=(counts[unit.g]||0)+1;
    if (!unit||!accept(unit.g,unit.gear)||(unit.contents!==undefined&&(!Array.isArray(unit.contents)||!unit.contents.every(u=>u&&accept(u.g,u.gear))))) return false;
  }
  for (const gear of s.gearOverflow) {
    if (!gear||!accept(gear.g,gear)) return false;
    const batch=gear.batch;
    if(batch!==undefined) {
      if(!batch || typeof batch.prefix!=='string' || !/^s-[a-z0-9-]{1,72}$/.test(batch.prefix) ||
          !Number.isSafeInteger(batch.count)||batch.count<1||!Number.isSafeInteger(batch.start)||batch.start<1 ||
          !Number.isSafeInteger(batch.start+ (batch.count-1))||ranges.has(batch.prefix) ||
          gear.uid!==batch.prefix+'-'+batch.start || gear.ammo!==gearSpec(gear.g).capacity ||
          gear.durability!==100||gear.module!==null) return false;
      ranges.set(batch.prefix,batch);
    }
    counts[gear.g]=(counts[gear.g]||0)+(batch?.count||1);
  }
  for(const uid of ids){
    const pos=uid.lastIndexOf('-'),batch=ranges.get(uid.slice(0,pos));
    if(batch){
      const n=Number(uid.slice(pos+1));
      if(Number.isSafeInteger(n)&&n>batch.start&&n-batch.start<batch.count) return false;
    }
  }
  return Object.entries(counts).every(([id,n])=>n<=(s.stash[id]||0));
}
// Queued pristine stock can be represented by its existing aggregate, even in very large old saves.
// Once a physical unit has left pristine stock, its record follows it into a full warehouse.
function gearStashChoice(id,uid) {
  if (!gearSpec(id)||!stashCount(id)) return null;
  if (uid && uid!=='overflow') return gearEnsureUnit(stashSlots.find(u=>u.g===id&&u.uid===uid));
  if (stashOverflowCount(id)>0) return gearQueuePhysical(gearOverflow.find(g=>g.g===id))||gearCreate(id);
  if (uid==='overflow') return null;
  return gearEnsureUnit(stashSlots.findLast(u=>u.g===id));
}
function gearUnitFor(id,gear) {
  const u=kitUnit(id);
  if (gear) u.gear=gear;
  return u;
}
function saveInventoryMove() {
  if (typeof writeSession!=='function') {persist();return true;}
  const previous=stash;
  if (writeSession()) return true;
  if(stash===previous) readSession();
  stashNotice='변경을 저장하지 못해 저장된 창고와 장비를 다시 불러왔습니다.';
  gearNotice=stashNotice;
  return false;
}
function wearStoredGear(uid) {
  const fail=message=>({ok:false,message});
  if (!writer||raid) return fail('벙커에 귀환한 뒤 플레이 중인 탭에서 장비를 바꿀 수 있습니다.');
  const row=gearOwned().find(r=>r.gear.uid===uid);
  if (!row||row.location==='worn') return fail('교환할 보관 장비를 다시 선택하세요.');
  const before=equipmentState, id=row.gear.g, slot=kitSlot(id);
  if(!canReturnKit(before,slot)) return fail(gearNotice);
  if(row.location==='bag') kitWearBag(row.unit.uid);
  else if(row.location==='case') {
    row.box.contents=row.box.contents.filter(x=>x!==row.unit);
    kitWearPhysical(slot,id,row.gear);
  } else {
    if(row.location==='overflow') gearOverflow=[row.gear,...gearOverflow.filter(g=>g!==row.gear)];
    kitWearStash(id,row.unit?.uid||'overflow');
  }
  if(gearWorn(before,slot)?.uid!==uid||!writeSession()) {
    if(equipmentState===before) readSession();
    return fail('장비 교환을 저장하지 못해 저장된 장비를 다시 불러왔습니다.');
  }
  return {ok:true,message:kitName(id)+' 장착.'};
}
