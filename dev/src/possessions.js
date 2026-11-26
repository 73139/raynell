// Rebuild locations from inventory ownership when the player searches or follows a result.
// Aggregate warehouse counts include the loose grid and its queue, never the contents of cases.
function possessionLocation(kind, id, key, properties) {
  return {
    kind, id, key, name:kitName(id), quantity:1, scope:'bunker', isCase:Object.hasOwn(STORAGE_CASES,id),
    uid:null, alias:'', caseUid:null, caseName:'', row:null, col:null,
    caseRow:null, caseCol:null, slot:null, ...properties
  };
}

function* physicalPossessionLocations() {
  const placed = new Map();
  const byPosition = (a,b) => a.y-b.y || a.x-b.x;
  for(const uid of hideout.wardManual.waiting){
    yield possessionLocation('manual','rl_bp_dressing','med-handoff:'+uid,{uid});
  }
  for(const u of cashPocket.slice().sort(byPosition)){
    yield possessionLocation('cash',u.g,'pocket:'+u.uid,{uid:u.uid,cashAmount:u.amount,row:u.y+1,col:u.x+1});
  }
  for (const unit of stashSlots.slice().sort(byPosition)) {
    const {uid, g:id} = unit;
    placed.set(id,(placed.get(id) || 0) + 1);
    yield possessionLocation('stash',id,'stash:'+uid+':'+id,{
      uid, ...(isCashUnit(unit)?{cashAmount:unit.amount}:{}), row:unit.y+1, col:unit.x+1, alias:unit.alias || '', attached:unit.gear?.module
    });
    if (!unit.contents?.length) continue;
    const caseName = caseDisplayName(unit);
    for (const item of unit.contents.slice().sort(byPosition)) {
      yield possessionLocation('case',item.g,'case:'+uid+':'+item.uid+':'+item.g,{
        uid:item.uid, attached:item.gear?.module,row:item.y+1, col:item.x+1, caseUid:uid, caseName,
        caseRow:unit.y+1, caseCol:unit.x+1
      });
    }
  }

  for (const id of Object.keys(stash)) {
    const quantity = stashCount(id) - (placed.get(id) || 0);
    if (quantity > 0) yield possessionLocation('overflow',id,'overflow:'+id,{uid:'overflow',quantity});
  }

  // Settlement transfers carried goods immediately; the still-open report is already in bunker custody.
  const live = Boolean(raid && !field.result);
  const kit = live ? field : equipmentState;
  const scope = live ? 'raid' : 'bunker';
  const context = live ? 'raid-'+raid.startedAt : 'bunker';
  for (const unit of kit.bag.slice().sort(byPosition)) {
    yield possessionLocation('bag',unit.g,context+':bag:'+unit.uid+':'+unit.g,{
      scope, uid:unit.uid, ...(isCashUnit(unit)?{cashAmount:unit.amount}:{}), attached:unit.gear?.module,row:unit.y+1, col:unit.x+1
    });
  }
  for (const [slot,id] of Object.entries(kit.worn)) {
    yield possessionLocation('worn',id,context+':worn:'+slot+':'+id,{scope,slot});
    const module=kit.modules?.[slot];
    if (module) yield possessionLocation('module',module,context+':module:'+slot+':'+module,{scope,slot,host:id});
  }
}

function* possessionLocations() {
  for (const host of physicalPossessionLocations()) {
    yield host;
    if (host.attached) yield {...host,host:host.id,ownerId:host.id,attached:null,id:host.attached,
      name:kitName(host.attached),alias:'',key:host.key+':module:'+host.attached};
    if (host.kind==='overflow') {
      for (const gear of gearOverflow) if(gear.g===host.id&&gear.module) yield {...host,host:host.id,
        ownerId:host.id,id:gear.module,quantity:1,name:kitName(gear.module),key:host.key+':module:'+gear.uid};
    }
  }
}

function possessionSearchText(text) {
  return text.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/gu,'');
}

function searchPossessions(query) {
  const term = possessionSearchText(String(query ?? ''));
  if (!term) return [];
  const results = [];
  for (const row of possessionLocations()) {
    if (possessionSearchText(row.name).includes(term) ||
        (row.alias && possessionSearchText(row.alias).includes(term))) results.push(row);
  }
  return results;
}

function resolvePossession(key) {
  for (const row of possessionLocations()) {
    if (row.key === key) return row;
  }
  return null;
}
