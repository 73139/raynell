// Inventory and worn gear use separate ownership. A field kit belongs to the
// raid until settlement, even when the browser is closed.
const ISSUE_PACK = 'issued_pack';
const KIT_SLOTS = {
  head: {label:'머리 보호구',icon:'eqarmor',empty:'방호 헬멧 장착'},
  face: {label:'얼굴',icon:'eqeyes',empty:'안면 장비 장착'},
  breathing: {label:'호흡 장비',icon:'eqeyes',empty:'방독면 장착'},
  ears: {label:'헤드셋',icon:'radio',empty:'헤드셋·이어피스 장착'},
  support: {label:'보조 파우치',icon:'bag',empty:'보조 수납 장비 장착'},
  secondary: {label:'보조무기',icon:'eqprimary',empty:'보조 권총 장착'},
  melee: {label:'근접 도구',icon:'tool',empty:'커터칼 장착'},
  insignia: {label:'완장 표식',icon:'card',empty:'군용 표식 부착'},
  primary: {label:'주무기', icon:'eqprimary', empty:'카빈 장착'},
  armor: {label:'방호복', icon:'eqarmor', empty:'방호 조끼 장착'},
  eyes: {label:'보안경', icon:'eqeyes', empty:'보호·방진 고글 장착'},
  light: {label:'조명', icon:'eqlight', empty:'휴대용 조명·야전 랜턴'},
  comms: {label:'통신기', icon:'radio', empty:'무전기 장착'},
  access: {label:'열쇠 고리', icon:'key', empty:'열쇠·키카드 1개'},
  back: {label:'배낭', icon:'bag', empty:'주머니 3 × 2칸'}
};
Object.assign(ICONS,{
  eqprimary:'<path d="m3 15 5-5 4 1 3-3h5l1 2-4 4h-5l-2 3-3 1-1-3-2 2z"/>',
  eqarmor:'<path d="M8 3 5 4 3 10l3 2v8l6 2 6-2v-8l3-2-2-6-3-1c0 5-8 5-8 0Z"/><path d="M8 12h8m-8 3h8"/>',
  eqeyes:'<path d="m2 10 2-3h16l2 3-2 6h-5l-3-3-3 3H4z"/>',
  eqlight:'<path d="m4 19 7-7 3 3-7 7zM10 11l3-5 6-2 2 2-2 6-5 3z"/>'
});
const KIT_START_PRIMARY='rl10_carbine', KIT_ARMOR='rl10_vest', KIT_LARGE_PACK='rl10_pack';
const KIT_SHELF=[KIT_START_PRIMARY,KIT_ARMOR,KIT_LARGE_PACK,'water','bandage','food','rl12_helmet','rl12_sidearm','rl12_respirator','rl_11_09','rl_13_01','rl_13_16','rl_05_15','patch','rl_13_07','radio','flash','key'];
let equipmentState={worn:{},bag:[]}, gearNotice='', gearPick=null;

function kitShelfUnlocked(id){
  const trader=marketOfferingTrader(id);
  return Boolean(trader&&marketIsUnlocked(trader.id,id));
}
function kitBunkerOnly(id){return GOODS[id]?.[5]==='보관함';}

const KIT_EXTRA_SLOT={rl_x_armor:'armor',rl_x_carbine:'primary',rl_x_pack:'back',rl_x_field_pack:'back',rl12_helmet:'head',rl12_sidearm:'secondary',rl12_respirator:'breathing',
  rl_11_09:'face',rl_13_01:'ears',rl_13_03:'ears',rl_13_16:'support',rl_05_15:'melee',patch:'insignia'};
function kitSlot(id) {
  if(Object.hasOwn(KIT_EXTRA_SLOT,id))return KIT_EXTRA_SLOT[id];
  if (id===KIT_START_PRIMARY) return 'primary';
  if (id===KIT_ARMOR) return 'armor';
  if (id===KIT_LARGE_PACK || id===ISSUE_PACK) return 'back';
  if (id==='rl_13_07'||id==='rl_13_08') return 'eyes';
  if (id==='flash'||id==='rl_13_05') return 'light';
  if (id==='radio') return 'comms';
  if (GOODS[id]?.[5]==='열쇠') return 'access';
  return null;
}
function kitName(id) {return id===ISSUE_PACK?'지급 배낭':GOODS[id]?.[0]||'미장착';}
function kitIcon(id,slot) {return id===ISSUE_PACK?'bag':GOODS[id]?.[4]||KIT_SLOTS[slot].icon;}
function kitCapacity(worn) {
  const size=worn.back==='rl_x_pack'?[6,9]:worn.back==='rl_x_field_pack'?[6,7]:worn.back===KIT_LARGE_PACK?[6,8]:worn.back===ISSUE_PACK?[6,6]:[3,2];
  if(worn.support)size[1]++;
  return size;
}
function kitEffects(slot,id) {
  switch(slot) {
    case 'head':return '조우 피해 2 경감';
    case 'secondary':return '주무기 미착용 시 조우 대응력 +2';
    case 'melee':return '주·보조무기 미착용 시 조우 대응력 +1';
    case 'support':return '휴대 격자 1행 추가';
    case 'ears':return '주변 탐색 시간 10% 단축';
    case 'face':return '얼굴 장비 슬롯에 착용';
    case 'breathing':return '호흡 장비 슬롯에 착용';
    case 'insignia':return '작전원 식별 표식';
    case 'primary': return '조우 대응력 +'+(id==='rl_x_carbine'?6:4);
    case 'armor': return '조우 피해 '+(id==='rl_x_armor'?6:4)+' 경감';
    case 'eyes': return '조우 피해 1 경감';
    case 'light': return '주변 탐색 시간 20% 단축';
    case 'comms': return '긴급 구조 지점 이용 가능';
    case 'access': return id==='keycard'?'보안 출입구 이용 가능':'가방 공간을 쓰지 않고 휴대';
    case 'back': return kitCapacity({back:id}).join(' × ')+'칸 수납';
  }
}
function kitWorn(input) {
  const out={};
  for(const key of Object.keys(KIT_SLOTS)){
    const id=input?.[key];
    if(typeof id==='string' && kitSlot(id)===key)out[key]=id;
  }
  return out;
}
function kitUnit(id) {
  const uid=globalThis.crypto?.randomUUID?.()||'k'+Date.now().toString(36)+Math.random().toString(36).slice(2);
  const g=GOODS[id];
  const unit={uid,g:id,x:0,y:0,w:g?.[1]||1,h:g?.[2]||1,revealed:true};
  gearEnsureUnit(unit);return unit;
}
// Catalog masses are expressed to the nearest gram. A fitted module travels with its host.
function kitUnitGrams(unit){
  const module=unit.gear?.module;
  return Math.round(GOODS[unit.g][3]*1000)+(module?Math.round(GOODS[module][3]*1000):0);
}
function kitUnitMassText(unit){
  const module=unit.gear?.module;
  return kitUnitGrams(unit)/1000+' kg'+(module?' ('+kitName(module)+' 포함)':'');
}
function selectedMassMarkup(unit){
  return '<span data-selected-mass>'+esc(kitUnitMassText(unit))+'</span>';
}
function kitBagGrams(bag){return bag.reduce((grams,unit)=>grams+kitUnitGrams(unit),0);}
function packMassLabel(bag){
  return kitBagGrams(bag)/1000+' kg';
}
// Keep existing orientation and coordinates whenever possible.
function kitFit(list,size,item) {
  if(fits(list,size,item.x,item.y,item.w,item.h))return {...item};
  const pos=firstFit(list,size,item.w,item.h);
  if(pos)return {...item,...pos};
  if(item.w===item.h)return null;
  const next=firstFit(list,size,item.h,item.w);
  return next?{...item,...next,w:item.h,h:item.w}:null;
}
function kitSorted(items) {return items.slice().sort((a,b)=>b.w*b.h-a.w*a.h);}
function kitArrange(items,size,fixed=[]) {
  const placed=fixed.slice(),left=[];
  for(const item of kitSorted(items)){
    const fit=kitFit(placed,size,item);
    if(fit)placed.push(fit);else left.push(item);
  }
  return {placed,left};
}
function validKitBag(items) {
  if(!Array.isArray(items))return [];
  return items.filter(o=>o && GOODS[o.g] && typeof o.uid==='string' && Number.isInteger(o.w) && Number.isInteger(o.h));
}
// A module occupies one socket on a worn host. Detaching returns one physical part.
const KIT_MODULE_TIMERS = {
  primary:{rl_x_optic:'scan'},secondary:{rl_x_optic:'scan'},
  light:{battery:'scan'},
  eyes:{optic:'search'},
  comms:{battery:'search',rl_13_02:'scan'}
};
function kitModuleEffectText(slot,id) {
  const action = KIT_MODULE_TIMERS[slot]?.[id];
  return action ? (action === 'scan' ? '주변 탐색' : '상자 수색') + ' 시간 10% 단축' : '';
}
function kitModuleTimeFactor(type,kit=field) {
  if (type !== 'scan' && type !== 'search') return 1;
  let factor = 1;
  for (const [slot,id] of Object.entries(kit?.modules || {})) {
    if (gearWorn(kit,slot)?.durability!==0 && KIT_MODULE_TIMERS[slot]?.[id] === type) factor *= 0.9;
  }
  return factor;
}
function loadEquipment(saved, version = 0) {
  const wearing={back:ISSUE_PACK};
  if(!raid||field.result)wearing.primary=KIT_START_PRIMARY;
  equipmentState=saved&&typeof saved==='object'?
    {worn:kitWorn(saved.worn),bag:validKitBag(saved.bag)}:
    {worn:raid&&!field.result?{}:wearing,bag:[]};
  equipmentState.modules = version >= 21 && validPresetModules(equipmentState.worn,saved?.modules) ? {...saved.modules} : {};
  field.modules = version >= 21 && raid && !field.result && validPresetModules(field.worn,field.modules) ? {...field.modules} : {};
  equipmentState.quickslots=Array.from({length:10},(_,i)=>{
    const id=saved?.quickslots?.[i];
    return typeof id==='string' && Object.hasOwn(GOODS,id) && kitSupply(id)?id:null;
  });
  if(raid && !field.result){
    field.worn=field.worn?kitWorn(field.worn):{back:ISSUE_PACK};
    if(!Array.isArray(field.gearGround))field.gearGround=FIELD_ZONES.map(()=>[]);
  }
  gearLoadKit(equipmentState,version>=25?saved?.instances:null,saved?'kit':null);
  if (raid&&!field.result) gearLoadKit(field,version>=25?field.instances:null,'raid-'+raid.startedAt);
  gearPick=null;gearNotice='';
}
function startEquipmentRaid() {
  field.worn=equipmentState.worn;field.instances=equipmentState.instances;
  field.modules=equipmentState.modules;
  field.bag=equipmentState.bag;
  field.gearGround=FIELD_ZONES.map(()=>[]);
  equipmentState={worn:{},modules:{},instances:{},bag:[],quickslots:equipmentState.quickslots};
  gearPick=null;gearNotice='';
}
function finishEquipmentRaid(success) {
  const worn=kitWorn(field.worn);
  const modules = field.modules || {};
  const report=Object.keys(worn).map(slot=>modules[slot] ? {slot,id:worn[slot],module:modules[slot]} : {slot,id:worn[slot]});
  equipmentState={worn:success?worn:{},modules:success?modules:{},instances:success?field.instances:{},bag:[],quickslots:equipmentState.quickslots};
  field.worn={};field.modules={};field.instances={};field.gearGround=[];
  gearPick=null;gearNotice='';
  return report;
}
function raidBagSize(){return kitCapacity(raid?field?.worn||{back:ISSUE_PACK}:equipmentState.worn);}
function hasRaidBackpack(){return Boolean(field?.worn?.back);}
function raidHasItem(id){return field?.bag?.some(o=>o.g===id)||Object.values(field?.worn||{}).includes(id);}
function gearAttackBonus(){
  const worn=field?.worn||{};
  return worn.primary==='rl_x_carbine'?6:worn.primary===KIT_START_PRIMARY?4:worn.secondary?2:worn.melee?1:0;
}
function gearDefenseBonus(){return (gearWorn(field,'armor')?.durability>0?(field.worn.armor==='rl_x_armor'?6:4):0)+(gearWorn(field,'eyes')?.durability>0?1:0)+(gearWorn(field,'head')?.durability>0?2:0);}
function gearScanFactor(kit=field){return (gearWorn(kit,'light')?.durability>0?0.8:1)*(kit?.worn?.ears?0.9:1);}
function medicalBaseGain(id){return id==='medkit'?40:id==='rl_craft_dressing'?28:18;}
function kitSupply(id){
  let stat='',gain=0;
  if(id==='water'||GOODS[id]?.[5]==='음료'){stat='water';gain=25;}
  else if(['food','ration','biscuit'].includes(id)||/^rl_09_(0[1-9]|10|11|1[7-9]|2[0-5])$/.test(id)){stat='energy';gain=20;}
  else if(['rl_craft_dressing','bandage','medkit','gauze','rl_11_01','rl_11_03','rl_11_04','rl_11_13','rl_11_14','rl_11_26','rl_11_27'].includes(id)){stat='hp';gain=medicalBaseGain(id);}
  if(!stat)return null;
  if(typeof hideoutRecoveryBonus==='function')gain+=hideoutRecoveryBonus(stat);
  return {stat,gain,label:{hp:'체력',water:'수분',energy:'기력'}[stat]};
}
function currentKit(){return raid?field:equipmentState;}
function kitGround(){
  if(!field.gearGround)field.gearGround=FIELD_ZONES.map(()=>[]);
  return field.gearGround[raid.zone]||(field.gearGround[raid.zone]=[]);
}
function gearButton(action,text,props={},disabled=false){
  return '<button data-gear="'+action+'" '+Object.entries(props).map(([k,v])=>'data-'+k+'="'+esc(v)+'"').join(' ')+(disabled?' disabled':'')+'>'+text+'</button>';
}
function equipmentStashActions(id,uid) {
  if(raid||!GOODS[id]||kitBunkerOnly(id))return '';
  const args={id,unit:uid||''};
  return (kitSlot(id)?gearButton('wear-stash',KIT_SLOTS[kitSlot(id)].label+' 장착',args):'')+gearButton('pack','출격 가방에 넣기',args);
}
function equipmentSelectionActions(o){
  if(!o||picked?.side!=='bag'||!raid||field.result)return '';
  const slot=kitSlot(o.g),effect=kitSupply(o.g),busy=Boolean(field.action),disabled=busy||Boolean(field.contact||field.journey);
  return (slot?gearButton('wear-bag',KIT_SLOTS[slot].label+' 장착',{unit:o.uid},disabled):'')+
    (effect?gearButton('consume',effect.label+' +'+effect.gain+' 사용',{unit:o.uid},busy||((field[effect.stat]??100)>=100 && !(effect.stat==='hp' && hasInjury()))):'')+
    gearButton('drop','바닥에 놓기',{unit:o.uid},disabled);
}
function equipmentSummary(r) {
  if(!Array.isArray(r?.worn))return '';
  const list=r.worn.map(({slot,id,module})=>KIT_SLOTS[slot]&&kitSlot(id)===slot?
    '<li><span>'+KIT_SLOTS[slot].label+'</span><b>'+esc(kitName(id))+(module?' · '+esc(kitName(module)):'')+'</b></li>':'').join('');
  return '<section class="kit-report"><h2>착용 장비 '+(r.result==='success'?'귀환':'손실')+'</h2>'+(list?'<ul>'+list+'</ul>':'<p>착용 장비 없음</p>')+'</section>';
}
function equipmentDeployInfo() {
  if(raid)return '';
  const k=equipmentState,slots=Object.values(k.worn).length;
  return '<div class="kit-deploy"><span>출격 장비 <b>'+slots+'점</b> · 반입 물품 <b>'+k.bag.length+'개</b></span><button data-page="inventory">장비 준비</button></div>';
}
function kitGroundPanel(){
  if(!raid||field.result||field.journey)return '';
  const ground=field.gearGround?.[raid.zone];
  if(!ground?.length)return '';
  const counts=new Map(),seen=new Map();
  const names=ground.map(unit=>{
    const suffix=unit.gear?' #'+gearSerial(unit.gear.uid):isCashUnit(unit)?' · '+money(unit.amount):'';
    const name=kitName(unit.g)+suffix;
    counts.set(name,(counts.get(name)||0)+1);
    return name;
  });
  const rows=ground.map((unit,i)=>{
    const gear=unit.gear,name=names[i],total=counts.get(name);
    let label=name,details='';
    if(total>1){
      if(gear)label=kitName(unit.g)+' #'+gear.uid;
      else{
        const ordinal=(seen.get(name)||0)+1;
        seen.set(name,ordinal);label=name+' ('+ordinal+'/'+total+')';
      }
    }
    if(gear){
      const spec=gearSpec(gear.g),state=[kitUnitMassText(unit)];
      if(gear.durability<spec.maxDurability)state.push('내구도 '+gear.durability+'/'+spec.maxDurability);
      if(gear.ammo<spec.capacity)state.push('탄약 '+gear.ammo+'/'+spec.capacity+'발');
      details='<small>'+esc(state.join(' · '))+'</small>';
    }
    const ref='ground-unit-'+i,button='ground-recover-'+i,action=unit.g===ISSUE_PACK?'다시 메기':'회수';
    return '<div><span id="'+ref+'">'+esc(label)+details+'</span><button type="button" id="'+button+
      '" aria-labelledby="'+ref+' '+button+'" data-gear="recover" data-unit="'+esc(unit.uid)+'"'+
      (field.action||field.contact?' disabled':'')+'>'+action+'</button></div>';
  });
  return '<section class="panel kit-ground"><h2>이 지역에 내려놓은 물품</h2><p>'+esc(FIELD_ZONES[raid.zone].name)+
    ' · 떠나기 전에 회수할 수 있습니다.</p><div class="kit-rows">'+rows.join('')+'</div></section>';
}
function kitSlotPanel(kit) {
  const active=Boolean(raid),blocked=Boolean(active&&(field.action||field.contact||field.journey));
  return '<section class="panel kit-wear"><div class="kit-heading"><h2>착용 장비</h2><span>'+Object.keys(kit.worn).length+' / '+Object.keys(KIT_SLOTS).length+'</span></div><div class="kit-slots">'+
    Object.entries(KIT_SLOTS).map(([slot,def])=>{
      const id=kit.worn[slot],small=id?kitEffects(slot,id):def.empty;
      const action=id?(active?'ground-worn':'unwear'):(!active&&slot==='back'?'issue':null);
      const label=id?(active?'내려놓기':id===ISSUE_PACK?'반납':'창고로'):'기본 배낭 받기';
      return '<article class="kit-slot '+(id?'occupied':'')+'"><div class="kit-slot-head">'+ico(kitIcon(id,slot))+'<span>'+def.label+'</span></div><b>'+esc(kitName(id))+'</b><small>'+esc(small)+'</small>'+(action?gearButton(action,label,{slot},blocked):'')+'</article>';
    }).join('')+'</div></section>';
}
function kitPrepGrid(kit){
  const size=kitCapacity(kit.worn),selected=kit.bag.find(o=>o.uid===gearPick?.uid);
  let cells='';
  for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++)cells+='<button class="slot" data-gear="cell" data-x="'+x+'" data-y="'+y+'" aria-label="가방 '+(x+1)+'열 '+(y+1)+'행" style="grid-column:'+(x+1)+';grid-row:'+(y+1)+'"></button>';
  const tiles=kit.bag.map(o=>o.g==='cr_notes'?cashTile(o,'bag'):'<button class="loot-tile '+(selected===o?'chosen':'')+'" data-gear="select" draggable="true" data-unit="'+esc(o.uid)+'" aria-label="'+esc(kitName(o.g))+'" style="grid-column:'+(o.x+1)+'/span '+o.w+';grid-row:'+(o.y+1)+'/span '+o.h+'">'+(typeof itemArt==='function'?itemArt(o.g,'item-symbol'):ico(GOODS[o.g][4],'item-symbol'))+'<span>'+esc(kitName(o.g))+'</span></button>').join('');
  return '<div class="spatial-grid" data-kit-grid style="--cols:'+size[0]+';--rows:'+size[1]+'">'+cells+tiles+'</div><p class="mini-field">물품을 선택한 후 빈 칸을 눌러 배치하세요.</p>'+
    (selected?'<div class="kit-actions"><b>'+esc(kitName(selected.g))+'</b>'+selectedMassMarkup(selected)+gearButton('prep-rotate',gearPick.rot?'회전 취소':'회전 후 배치')+gearButton('unpack','창고로')+(kitSlot(selected.g)?gearButton('wear-bag','착용',{unit:selected.uid}):'')+'</div>':'');
}
function kitPrepBag(kit){
  const size=kitCapacity(kit.worn);
  return '<section class="loot-panel kit-bag"><div class="field-label"><span>출격 시 반입</span><span>'+packMassLabel(kit.bag)+'</span></div><h2>'+(kit.worn.back?'출격 가방':'주머니')+' <small>'+size.join(' × ')+'</small></h2>'+kitPrepGrid(kit)+'</section>';
}
function kitStorePanel(){
  const rows=Object.entries(stash).filter(([id,n])=>GOODS[id]&&n>0&&(kitSlot(id)||kitSupply(id))).sort((a,b)=>kitName(a[0]).localeCompare(kitName(b[0]),'ko'));
  const shelf=KIT_SHELF.filter(kitShelfUnlocked);
  return '<section class="panel kit-shelf"><div class="kit-heading"><h2>창고에서 준비</h2><button data-page="stash">창고 열기</button></div>'+
    (rows.length?'<div class="kit-rows">'+rows.map(([id,n])=>'<div><span><b>'+esc(kitName(id))+'</b> ×'+n+'</span><span class="kit-actions">'+(kitSlot(id)?gearButton('wear-stash','착용',{id}):'')+gearButton('pack','가방에 넣기',{id})+'</span></div>').join('')+'</div>':'<p>창고에 장비와 소모품이 없습니다. 레이드에서 가져오거나 아래에서 장비를 구입할 수 있습니다.</p>')+
    '<details><summary>벙커 장비 보급소</summary><p>구입한 장비는 창고에 보관됩니다. 잔액 '+money(wallet)+'</p><div class="kit-rows">'+shelf.map(id=>'<div><span><b>'+esc(kitName(id))+'</b><small>'+(kitSlot(id)?kitEffects(kitSlot(id),id):kitSupply(id).label+' +'+kitSupply(id).gain)+'</small></span>'+gearButton('buy',money(GOODS[id][6])+' 구입',{id},wallet<GOODS[id][6])+'</div>').join('')+'</div></details></section>';
}
function equipmentPage() {
  if(raid&&field.result)return head('FIELD / LOADOUT','장비 정산','현장 보고서를 확인하고 벙커로 복귀하세요.')+'<button data-page="raid">결과 확인</button>';
  const kit=currentKit(),active=Boolean(raid);
  return head('02 / PERSONAL EQUIPMENT',active?'현장 장비':'출격 장비',active?'가방에서 의료품·식량·음료를 선택한 뒤 사용 버튼을 누르세요.':'출격할 때 착용 장비와 가방을 가져갑니다. 탈출에 실패하면 둘 다 잃습니다.')+
    '<div class="kit-toolbar"><button data-page="'+(active?'raid':'map')+'">'+(active?'현장으로 복귀':'작전 지도')+'</button>'+(active?'':'<button data-page="bunker">하이드아웃</button>')+'</div>'+
    (gearNotice?'<p class="kit-notice" role="status">'+esc(gearNotice)+'</p>':'')+
    (active?'<div class="kit-vitals"><span>체력 <b>'+(field.hp??100)+'</b></span><span>기력 <b>'+field.energy+'</b></span><span>수분 <b>'+field.water+'</b></span></div>':'')+
    '<div class="kit-layout'+(active?' on-raid':'')+'">'+kitSlotPanel(kit)+(active?'<div><div class="loot-layout single">'+bagPanel()+'</div>'+selectionPanel()+'</div>':kitPrepBag(kit))+'</div>'+(active?kitGroundPanel():kitStorePanel());
}
function canReturnKit(kit,slot,overflow=[]) {
  const incoming = new Map();
  const items = [kit.worn[slot],...overflow.map(unit=>unit.g)];
  for (const id of items) {
    if (!id || id === ISSUE_PACK) continue;
    const amount = (incoming.get(id) || 0)+1;
    if (!Number.isSafeInteger(stashCount(id)+amount)) {
      gearNotice=kitName(id)+'의 창고 보유 한도에 도달했습니다.';
      return false;
    }
    incoming.set(id,amount);
  }
  return true;
}
function kitWearPhysical(slot,id,gear) {
  const k=currentKit(),old=k.worn[slot],previous=gearWorn(k,slot);
  if(old && old!==ISSUE_PACK){
    if(raid) kitGround().push(gearUnitFor(old,previous));
    else addStashGoods(old,1,previous);
  } else if (raid && old===ISSUE_PACK) kitGround().push(kitUnit(old));
  gearMount(k,slot,id,gear);
  gearNotice=kitName(id)+' 장착.'+(old&&raid?' 이전 장비는 이 지역에 두었습니다.':'');
}
function kitWearStash(id,uid) {
  const slot=kitSlot(id);
  if(!slot||raid)return;
  const k=equipmentState;
  if(k.worn[slot]===id&&!gearSpec(id)){gearNotice='이미 같은 장비를 착용하고 있습니다.';return;}
  if (!canReturnKit(k,slot)) return;
  const gear=gearStashChoice(id,uid);
  if(!takeStashGoods(id,1,uid||null)){gearNotice='창고 물품을 다시 확인하세요.';return;}
  kitWearPhysical(slot,id,gear);
}
function kitPackFromStash(id,uid) {
  if(raid||!GOODS[id])return;
  if(kitBunkerOnly(id)){gearNotice='보관함은 벙커 안에서만 사용할 수 있습니다.';return;}
  const k=equipmentState,fit=kitFit(k.bag,kitCapacity(k.worn),gearUnitFor(id,gearStashChoice(id,uid)));
  if(!fit){gearNotice='가방에 물품이 들어갈 공간이 없습니다.';return;}
  fit.uid=wardPackUid(id,uid)||fit.uid;
  if(!takeStashGoods(id,1,uid||null)){gearNotice='창고 물품을 다시 확인하세요.';return;}
  k.bag.push(fit);gearNotice=kitName(id)+' 출격 준비 완료.';
}
function removeWorn(slot,ground) {
  const k=currentKit(),id=k.worn[slot];if(!id)return;
  const nextWorn={...k.worn};
  delete nextWorn[slot];
  const moved = (slot==='back'||slot==='support') ? kitArrange(k.bag,kitCapacity(nextWorn)) : null;
  if (!ground && !canReturnKit(k,slot,moved?.left)) return;
  const physical=gearWorn(k,slot);
  delete k.worn[slot];delete k.modules[slot];delete k.instances[slot];
  if(moved){
    k.bag=moved.placed;
    if(ground)kitGround().push(...moved.left);
    else for(const unit of moved.left){if(unit.g==='cr_notes')wallet+=unit.amount;else if(unit.g==='rl_bp_dressing')receiveWardSheet(unit.uid);else addStashGoods(unit.g,1,unit.gear,unit.uid);}
    gearNotice=moved.left.length?'휴대 공간을 넘긴 '+moved.left.length+'개를 '+(ground?'바닥에 두었습니다.':'창고로 옮겼습니다.'):slot==='back'?'주머니로 전환했습니다.':'보조 파우치를 해제했습니다.';
  }else gearNotice=kitName(id)+(ground?' 내려놓음.':' 창고 보관.');
  if(ground)kitGround().push(gearUnitFor(id,physical));
  else if(id!==ISSUE_PACK)addStashGoods(id,1,physical);
  gearPick=null;picked=null;
}
function kitWearBag(unit) {
  const k=currentKit(),index=k.bag.findIndex(o=>o.uid===unit);
  if(index<0)return;
  const item=k.bag[index],slot=kitSlot(item.g);if(!slot)return;
  if(k.worn[slot]===item.g&&!gearSpec(item.g)){gearNotice='이미 같은 장비를 착용하고 있습니다.';return;}
  if (!raid && !canReturnKit(k,slot)) return;
  k.bag.splice(index,1);
  kitWearPhysical(slot,item.g,gearEnsureUnit(item));
  gearPick=null;picked=null;
}
function kitPrepMove(x,y) {
  const k=equipmentState,item=k.bag.find(o=>o.uid===gearPick?.uid);if(!item)return;
  const w=gearPick.rot?item.h:item.w,h=gearPick.rot?item.w:item.h;
  if(!fits(k.bag,kitCapacity(k.worn),x,y,w,h,item.uid)){gearNotice='다른 물품과 겹치거나 가방 범위를 벗어납니다.';return;}
  Object.assign(item,{x,y,w,h});gearPick=null;gearNotice='배치했습니다.';
}
function handleEquipment(d) {
  reconcile();
  const active=Boolean(raid),k=currentKit(),a=d.gear;
  let groundFocusIndex=-1;
  if(active&&(field.result||field.action||((field.contact||field.journey)&&a!=='consume'))){gearNotice=field.action?'진행 중인 행동이 끝나면 장비를 변경할 수 있습니다.':'이동·교전 중에는 가방에 있는 소모품만 사용할 수 있습니다.';renderKeep();return;}
  switch(a){
    case 'issue':
      if(!active&&!k.worn.back){k.worn.back=ISSUE_PACK;gearNotice='지급 배낭을 착용했습니다.';}
      break;
    case 'wear-instance': {const result=wearStoredGear(d.unit);gearNotice=result.message;renderKeep();return;}
    case 'wear-stash': kitWearStash(d.id,d.unit);break;
    case 'pack': kitPackFromStash(d.id,d.unit);break;
    case 'wear-bag': kitWearBag(d.unit);break;
    case 'unwear': if(!active)removeWorn(d.slot,false);break;
    case 'ground-worn': if(active)removeWorn(d.slot,true);break;
    case 'buy':{
      const id=d.id,trader=marketOfferingTrader(id);
      if(active||!KIT_SHELF.includes(id)||!trader)return;
      gearNotice=marketIsUnlocked(trader.id,id)?marketTrade(trader.id,'buy',id,1).message:
        trader.name+'의 우호도를 올리면 구매할 수 있습니다.';
      notice=gearNotice;
      renderKeep();
      return;
    }
    case 'drop':
    case 'consume': {
      if(!active)return;
      const index=k.bag.findIndex(o=>o.uid===d.unit);if(index<0)return;
      const item=k.bag[index];
      if(a==='consume'){
        const effect=kitSupply(item.g);if(!effect)return;
        if(effect.stat==='hp' && hasInjury()){openInjuryTreatment(item.uid);return;}
        const value=k[effect.stat]??100;
        if(value>=100){gearNotice=effect.label+'이 이미 최대입니다.';break;}
        k[effect.stat]=Math.min(100,value+effect.gain);
        gearNotice=kitName(item.g)+' 사용 · '+effect.label+' +'+(k[effect.stat]-value);
      }else{
        kitGround().push(item);gearNotice=kitName(item.g)+' · 이 지역에 내려놓았습니다.';
      }
      k.bag.splice(index,1);picked=null;logField(gearNotice);break;
    }
    case 'recover':{
      if(!active)return;
      const ground=kitGround(),i=ground.findIndex(o=>o.uid===d.unit);
      if(i<0)return;
      const origin=globalThis.document?.activeElement;
      if(origin?.dataset?.gear==='recover'&&origin.dataset.unit===d.unit&&origin.matches(':focus-visible'))groundFocusIndex=i;
      const o=ground[i];
      if(o.g===ISSUE_PACK){
        if(k.worn.back){gearNotice='현재 배낭을 먼저 내려놓으세요.';break;}
        k.worn.back=ISSUE_PACK;
      }else if(kitSlot(o.g)==='back'&&!k.worn.back){
        k.worn.back=o.g;
      }else{
        const fit=kitFit(k.bag,kitCapacity(k.worn),o);
        if(!fit){gearNotice='가방에 공간이 부족합니다.';break;}
        k.bag.push(fit);
      }
      ground.splice(i,1);gearNotice=kitName(o.g)+' 회수.';break;
    }
    case 'select':
      if(!active&&k.bag.some(o=>o.uid===d.unit)){gearPick={uid:d.unit,rot:false};stashSelection=null;gearNotice='';}
      break;
    case 'prep-rotate': if(!active&&gearPick)gearPick.rot=!gearPick.rot;break;
    case 'cell':
      if(!active && !gearPick && selectedStashUnit() && typeof moveStashToBagCell==='function')moveStashToBagCell(Number(d.x),Number(d.y));
      else if(!active)kitPrepMove(Number(d.x),Number(d.y));
      break;
    case 'unpack': {
      if(active)return;
      const i=k.bag.findIndex(o=>o.uid===gearPick?.uid);
      if(i>=0&&k.bag[i].g==='cr_notes'){cashAction(k.bag[i].uid,'pocket');gearPick=null;renderKeep();return;}
      if(i>=0){const id=k.bag[i].g;if(addStashGoods(id,1,k.bag[i].gear,k.bag[i].uid)){k.bag.splice(i,1);gearPick=null;gearNotice=kitName(id)+' 창고 보관.';}else gearNotice='창고에 물품을 배치할 빈 칸이 필요합니다.';}
      break;
    }
    default:return;
  }
  if (typeof writeSession==='function' && !writeSession()) {
    if(currentKit()===k) readSession();
    gearNotice='변경을 저장하지 못해 저장된 장비와 재고를 다시 불러왔습니다.';
  } else if (typeof writeSession!=='function') persist();
  notice=gearNotice;if(typeof page!=='undefined'&&page==='stash')stashNotice=gearNotice;renderKeep();
  if(groundFocusIndex>=0){
    const buttons=document.querySelectorAll('.kit-ground [data-gear="recover"]');
    const previous=Array.from(buttons).find(button=>button.dataset.unit===d.unit);
    const next=previous||buttons[Math.min(groundFocusIndex,buttons.length-1)]||document.querySelector('[data-ground-empty]');
    next?.focus();
  }
}
// Moving focus to the next object must not collect it while the same Enter key is held.
inside.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&event.repeat&&event.target.closest?.('.kit-ground [data-gear="recover"]'))event.preventDefault();
});
let kitDragged=null;
inside.addEventListener('dragstart',event=>{
  const tile=event.target.closest('[data-gear="select"]');if(!tile||raid)return;
  kitDragged=tile.dataset.unit;
  event.dataTransfer.setData('text/plain',kitDragged);event.dataTransfer.effectAllowed='move';
});
inside.addEventListener('dragover',event=>{if(kitDragged&&event.target.closest('[data-kit-grid]'))event.preventDefault();});
inside.addEventListener('drop',event=>{
  const grid=event.target.closest('[data-kit-grid]');if(!grid||!kitDragged||raid)return;
  event.preventDefault();
  const rect=grid.getBoundingClientRect(),size=kitCapacity(equipmentState.worn);
  gearPick={uid:kitDragged,rot:gearPick?.uid===kitDragged&&gearPick.rot};kitDragged=null;
  handleEquipment({gear:'cell',x:Math.floor((event.clientX-rect.left-1)/(grid.clientWidth/size[0])),y:Math.floor((event.clientY-rect.top-1)/(grid.clientHeight/size[1]))});
});
inside.addEventListener('dragend',()=>{kitDragged=null;});

function validateEquipmentBackup(snapshot){
  const dict=value=>value && typeof value==='object'&&!Array.isArray(value);
  const validWorn=value=>dict(value)&&Object.entries(value).every(([slot,id])=>
    Object.hasOwn(KIT_SLOTS,slot)&&typeof id==='string'&&kitSlot(id)===slot);
  const validUnit=(u,ground=false)=>{
    if(!dict(u)||typeof u.g!=='string'||typeof u.uid!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(u.uid))return false;
    if(ground&&u.g===ISSUE_PACK)return u.w===1&&u.h===1;
    if(!Object.hasOwn(GOODS,u.g)||kitBunkerOnly(u.g))return false;
    const g=GOODS[u.g];
    return (u.w===g[1]&&u.h===g[2]||u.w===g[2]&&u.h===g[1])&&u.revealed===true;
  };
  const positionValid=(bag,worn)=>{
    const occupied=[],uids=new Set(),size=kitCapacity(worn);
    if(!Array.isArray(bag)||bag.length>size[0]*size[1])return false;
    for(const u of bag){
      if(!validUnit(u)||uids.has(u.uid)||!fits(occupied,size,u.x,u.y,u.w,u.h))return false;
      occupied.push(u);uids.add(u.uid);
    }
    return true;
  };
  const k=snapshot.equipment,f=snapshot.field;
  if(!dict(k)||!validWorn(k.worn)||!positionValid(k.bag,k.worn)||!dict(f))return false;
  if(k.quickslots!==undefined && (!Array.isArray(k.quickslots)||k.quickslots.length!==10||k.quickslots.some(id=>id!==null&&(typeof id!=='string'||!Object.hasOwn(GOODS,id)||!kitSupply(id)))))return false;
  if(snapshot.raid&&!f.result){
    if(!validWorn(f.worn)||!positionValid(f.bag,f.worn))return false;
    if(k.bag.length||Object.keys(k.worn).length)return false;
    if(!Array.isArray(f.gearGround)||f.gearGround.length!==FIELD_ZONES.length)return false;
    const ids=new Set(f.bag.map(x=>x.uid));
    for(const ground of f.gearGround){
      if(!Array.isArray(ground))return false;
      for(const u of ground){
        if(!validUnit(u,true)||ids.has(u.uid))return false;
        ids.add(u.uid);
      }
    }
  }
  return true;
}
