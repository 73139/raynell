// Resolve the first departure against the same field inventory that the player searches.
function advanceSurvivorScavenge(now) {
  const route=survivorState.active;
  if(!route || !raid || field.result || field.survivorScavenge || route.raidId!==raid.startedAt)return false;
  const at=route.raidId+SURVIVOR_STOPS[0].depart;
  if(now<at)return false;
  const zone=route.origin, found=field.found[zone];
  const pendingScan=field.action?.type==='scan' && raid.zone===zone ? nextLandmarkBox(zone) : -1;
  const record={raidId:route.raidId,at,box:null,uid:null};
  for(const [index] of FIELD_ZONES[zone].boxes.entries()){
    if(found.includes(index) || index===pendingScan || lootBoxIsLocked(zone,index))continue;
    const box=field.boxes[boxKey(zone,index)];
    if(!box || box.complete || field.open===box.key)continue;
    const candidate=box.items.find(item=>!item.revealed && item.w*item.h<=2);
    if(!candidate)continue;
    box.items=box.items.filter(item=>item!==candidate);
    record.box=box.key;
    record.uid=candidate.uid;
    break;
  }
  // Also settle empty or previously explored sites, so revisiting cannot trigger another removal.
  field.survivorScavenge=record;
  settlementNeedsCommit=true;
  return true;
}

function validSurvivorScavenge(s) {
  const event=s.field.survivorScavenge;
  if(event===undefined)return true;
  const route=s.field.result?s.survivor.last:s.survivor.active;
  if(!event || typeof event!=='object' || Array.isArray(event) || Object.keys(event).length!==4 || !route || !s.raid ||
     event.raidId!==route.raidId || event.raidId!==s.raid.startedAt || event.at!==event.raidId+SURVIVOR_STOPS[0].depart)return false;
  if(s.field.result && (!s.lastSummary || s.lastSummary.elapsed<SURVIVOR_STOPS[0].depart))return false;
  if(event.box===null)return event.uid===null;
  if(typeof event.box!=='string' || !/^[0-2]-(0|[1-9]\d*)$/.test(event.box) || typeof event.uid!=='string')return false;
  const [zone,index]=event.box.split('-').map(Number);
  const box=s.field.boxes?.[event.box], suffix=event.uid.slice(event.box.length+1);
  return zone===route.origin && Boolean(FIELD_ZONES[zone]?.boxes[index]) && box?.key===event.box &&
    event.uid.startsWith(event.box+'-') && /^(0|[1-9]\d*)$/.test(suffix) && Array.isArray(box.items) &&
    !box.items.some(item=>item?.uid===event.uid) && Array.isArray(s.field.bag) && !s.field.bag.some(item=>item?.uid===event.uid);
}
