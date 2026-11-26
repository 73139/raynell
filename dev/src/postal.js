// Issued cargo is a real bag tile. It cannot enter a merchant shelf, a container roll, or the warehouse.
const POSTAL_ITEM='rl_sealed_mail',POSTAL_ORDER='sealed-mail';
const POSTAL_PICKUP={zone:2,landmark:4},POSTAL_RELAY={zone:1,landmark:4};
Object.defineProperty(GOODS,POSTAL_ITEM,{value:['봉인 우편낭',2,1,0.8,'bag','의뢰 화물',0]});
Object.defineProperty(ITEM_META,POSTAL_ITEM,{value:{usage:'반송 화물실에서 인수해 통행증 발급소에 인계하는 출격 전용 우편낭',rarity:'의뢰품',lootSources:[],hideoutUses:[]}});
let postalNotice='';
function postalGroundZone(sortie){
  return (Array.isArray(sortie?.gearGround)?sortie.gearGround:[]).findIndex(list=>Array.isArray(list)&&list.some(unit=>unit?.g===POSTAL_ITEM));
}
function validPostalCargo(r,f,order){
  const record=f?.postal;
  const units=[...(Array.isArray(f?.bag)?f.bag:[]),...(Array.isArray(f?.gearGround)?f.gearGround.flat():[])].filter(unit=>unit?.g===POSTAL_ITEM);
  if(record===undefined)return !units.length;
  if(!r || !f || f.result || order!==POSTAL_ORDER || !record || typeof record!=='object' || Array.isArray(record) ||
     Object.keys(record).length!==3 || f.raidId!==r.startedAt || record.raidId!==r.startedAt ||
     !Array.isArray(f.visited) || !f.visited.includes(POSTAL_PICKUP.zone))return false;
  const validTime=at=>Number.isSafeInteger(at)&&at>=r.startedAt&&at<r.endsAt&&at<=Date.now();
  if(!validTime(record.issuedAt))return false;
  if(record.stampedAt===null){
    const ground=postalGroundZone(f);
    return (ground<0||f.visited.includes(ground)) && units.length===1 && units[0].uid==='post-'+r.startedAt && units[0].revealed===true;
  }
  return !units.length && validTime(record.stampedAt) && record.stampedAt>record.issuedAt && f.visited.includes(POSTAL_RELAY.zone);
}
function validPostalBackup(s){
  const cargo=unit=>unit?.g===POSTAL_ITEM;
  const done=s.career?.done;
  if((s.career?.order===POSTAL_ORDER || done?.includes?.(POSTAL_ORDER)) &&
     (!Array.isArray(done) || !done.includes('handover-ledgers') || (s.career.order===POSTAL_ORDER && done.includes(POSTAL_ORDER))))return false;
  if(s.stash?.[POSTAL_ITEM] || s.equipment?.bag?.some(cargo) ||
     s.stashSlots?.some(unit=>cargo(unit)||unit.contents?.some?.(cargo)) ||
     s.lastSummary?.goods?.includes?.(POSTAL_ITEM) || s.career?.history?.some?.(row=>row?.goods?.includes?.(POSTAL_ITEM)) ||
     Object.values(s.field?.boxes||{}).some(box=>box?.items?.some?.(cargo)))return false;
  return validPostalCargo(s.raid,s.field,s.career?.order);
}
function postalProgress(){
  if(!field.postal || !validPostalCargo(raid,field,career.order))return 0;
  return field.postal.stampedAt===null?1:2;
}
function postalLocations(){
  if(!isActive())return [POSTAL_PICKUP,POSTAL_RELAY];
  const stage=postalProgress();
  if(!stage)return [POSTAL_PICKUP];
  if(stage===2)return [];
  const ground=postalGroundZone(field);
  return ground<0?[POSTAL_RELAY]:[{zone:ground}];
}
function postalAt(site){return raid?.zone===site.zone && field.landmarkByZone?.[site.zone]===site.landmark;}
function postalPlacement(){
  return kitFit(field.bag,raidBagSize(),{g:POSTAL_ITEM,uid:'post-'+raid.startedAt,x:0,y:0,w:2,h:1,revealed:true});
}
function postalPanel(){
  if(career.order!==POSTAL_ORDER || !isActive())return '';
  const stage=postalProgress(),ground=postalGroundZone(field),pickup=postalAt(POSTAL_PICKUP),relay=postalAt(POSTAL_RELAY);
  let status,action='',label='',blocked=!writer||Boolean(field.action||field.contact||field.journey||field.open);
  if(!stage){
    status='군수 보급 창고 · 반송 화물실에서 인수하세요. 가방에 붙어 있는 두 칸이 필요합니다.';
    if(pickup){action='postal-pickup';label='우편낭 인수 · 2칸';if(!postalPlacement()){status='가방 공간이 부족합니다. 붙어 있는 두 칸을 비워 주세요.';blocked=true;}}
  }else if(stage===2){status='접수 도장을 받았습니다. 정상 탈출하면 운송 수당을 받습니다.';}
  else if(ground>=0){status=FIELD_ZONES[ground].name+' 바닥에 우편낭이 있습니다. 해당 권역의 ‘이 지역에 내려놓은 물품’에서 회수하세요.';}
  else{status='우편낭 휴대 중 · 폐쇄 검문소 통행증 발급소에 인계하세요.';if(relay){action='postal-stamp';label='우편낭 인계 · 접수 도장 받기';}}
  return '<section class="pump-gauge" data-postal-stage="'+(stage===2?'stamped':ground>=0?'ground':stage?'carried':'waiting')+'"><h3>봉인 우편낭 회송</h3><p tabindex="-1" role="status">'+esc(status)+(postalNotice?' '+esc(postalNotice):'')+'</p>'+
    (action?'<button type="button" data-field="'+action+'" data-raid-id="'+raid.startedAt+'" '+(blocked?'disabled':'')+'>'+label+'</button>':'')+
    '</section>';
}
function handlePostal(d){
  if(!writer||!isActive()||career.order!==POSTAL_ORDER||String(raid.startedAt)!==d.raidId||Date.now()>=raid.endsAt||
     field.action||field.contact||field.journey||field.open||!validPostalCargo(raid,field,career.order))return;
  const owner=field,previous=field.postal,bag=field.bag;
  if(d.field==='postal-pickup'){
    if(previous||!postalAt(POSTAL_PICKUP))return;
    const unit=postalPlacement();if(!unit)return;
    field.bag=[...bag,unit];field.postal={raidId:raid.startedAt,issuedAt:Date.now(),stampedAt:null};
  }else{
    if(!previous||previous.stampedAt!==null||!postalAt(POSTAL_RELAY)||!bag.some(u=>u.g===POSTAL_ITEM))return;
    field.bag=bag.filter(u=>u.g!==POSTAL_ITEM);field.postal={...previous,stampedAt:Date.now()};
  }
  postalNotice='';
  if(!writeSession() && owner===field){
    field.bag=bag;if(previous)field.postal=previous;else delete field.postal;
    postalNotice='운송 기록을 저장할 수 없습니다. 다시 시도하세요.';
  }
  renderKeep();$('[data-postal-stage] [role="status"]')?.focus?.({preventScroll:true});
}
