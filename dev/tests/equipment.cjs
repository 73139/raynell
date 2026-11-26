const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const db=JSON.parse(fs.readFileSync('Rustline_Database_v10.json'));

const goods=Object.fromEntries(Object.entries(db.items).map(([id,g])=>[id,[g.name,g.width,g.height,g.weightKg,g.icon,g.category,g.valueCR]]));
const base=fs.readFileSync('index.html','utf8');
const gridMethods=base.split('\n').filter(s=>/^function (fits|firstFit)\(/.test(s)).join('\n');
const setup=`
const GOODS=${JSON.stringify(goods)};
const ICONS={},inside={addEventListener(){}},FIELD_ZONES=[{name:'A'},{name:'B'},{name:'C'}];
let raid=null,field={bag:[],log:[]},picked=null,notice='',wallet=30000,stash={};
function hideoutLevel(){return 0}function traderStanding(){return {tier:1}}function reconcile(){}function renderKeep(){}function persist(){}function esc(s){return s}function logField(s){field.log.unshift(s)}
function ico(){return '<svg></svg>'}function head(c,t){return t}function money(n){return String(n)}function bagPanel(){return ''}function selectionPanel(){return ''}`;
const stash=(fs.readFileSync('src/stash.js','utf8')+'\n'+fs.readFileSync('src/gear-instances.js','utf8')+'\n'+fs.readFileSync('src/injuries.js','utf8')),eq=fs.readFileSync('src/equipment.js','utf8');
const scenarios=[
 ['초기 지급 장비, 6×6 배낭 및 장비 준비 화면',`
   loadEquipment();assert.equal(equipmentState.worn.back,ISSUE_PACK);assert.equal(equipmentState.worn.primary,KIT_START_PRIMARY);
   assert.deepEqual(raidBagSize(),[6,6]);assert.match(equipmentPage(),/출격 장비/);assert.match(equipmentDeployInfo(),/반입 물품/);
 `],
 ['보유 장비의 착용·교체·보관 및 창고 재고 동기화',`
   addStashGoods(KIT_ARMOR);assert.equal(stashCount(KIT_ARMOR),1);
   handleEquipment({gear:'wear-stash',id:KIT_ARMOR});assert.equal(stashCount(KIT_ARMOR),0);assert.equal(equipmentState.worn.armor,KIT_ARMOR);
   addStashGoods('radio');addStashGoods('keycard');addStashGoods('flash');addStashGoods('rl_13_07');
   for(const id of ['radio','keycard','flash','rl_13_07'])handleEquipment({gear:'wear-stash',id});
   addStashGoods('bandage',3);addStashGoods('water');addStashGoods('food');
   for(const id of ['water','food','bandage'])handleEquipment({gear:'pack',id});
   assert.equal(stashCount('bandage'),2);assert.equal(equipmentState.bag.length,3);
   assert.ok(validateEquipmentBackup({equipment:equipmentState,field,raid:null}));
 `],
 ['반입·현장 수납 및 장착 보너스·탈출 조건',`
   raid={zone:0};field.log=[];startEquipmentRaid();
   assert.equal(equipmentState.bag.length,0);assert.equal(field.bag.length,3);
   assert.ok(raidHasItem('radio')&&raidHasItem('keycard')&&hasRaidBackpack());assert.equal(gearScanFactor(),0.8);
   assert.equal(gearAttackBonus(),4);assert.equal(gearDefenseBonus(),5);
   assert.ok(validateEquipmentBackup({equipment:equipmentState,field,raid}));
   field.hp=60;field.energy=75;field.water=90;
   field.contact={zone:0,hp:30};
   const first=field.bag[0];handleEquipment({gear:'drop',unit:first.uid});assert.equal(field.bag.length,3);
   field.action={type:'engage'};handleEquipment({gear:'consume',unit:first.uid});assert.equal(field.bag.length,3);
   field.action=null;
   for(const item of [...field.bag])handleEquipment({gear:'consume',unit:item.uid});
   field.contact=null;
   assert.equal(field.hp,78);assert.equal(field.energy,95);assert.equal(field.water,100);assert.equal(field.bag.length,0);
 `],
 ['배낭 내려놓기·주머니 전환·지역별 회수·새로고침',`
   const sample=Array.from({length:9},()=>kitUnit('bandage'));field.bag=kitArrange(sample,raidBagSize()).placed;
   handleEquipment({gear:'ground-worn',slot:'back'});assert.deepEqual(raidBagSize(),[3,2]);assert.equal(field.bag.length,6);assert.equal(kitGround().length,4);
   assert.ok(!hasRaidBackpack());assert.ok(validateEquipmentBackup({equipment:equipmentState,field,raid}));
   const saved=JSON.parse(JSON.stringify({equipment:equipmentState,field,raid}));field=saved.field;raid=saved.raid;loadEquipment(saved.equipment);
   raid.zone=1;assert.equal(kitGround().length,0);raid.zone=0;
   handleEquipment({gear:'recover',unit:kitGround().find(o=>o.g===ISSUE_PACK).uid});assert.ok(hasRaidBackpack());
   for(const left of [...kitGround()])handleEquipment({gear:'recover',unit:left.uid});
   assert.equal(field.bag.length,9);assert.equal(kitGround().length,0);
   const backup={equipment:equipmentState,field,raid};assert.ok(validateEquipmentBackup(backup));
   field.bag[1].x=field.bag[0].x;field.bag[1].y=field.bag[0].y;assert.ok(!validateEquipmentBackup(backup));
 `],
 ['성공 귀환과 실패 손실·지급 배낭 재수령',`
   const report=finishEquipmentRaid(true);assert.ok(report.some(o=>o.id==='radio'));assert.equal(equipmentState.worn.comms,'radio');
   raid=null;field={bag:[],log:[]};assert.match(equipmentSummary({worn:report,result:'success'}),/무전기/);
   raid={zone:0};startEquipmentRaid();const lost=finishEquipmentRaid(false);assert.ok(lost.length>0);assert.deepEqual(equipmentState.worn,{});
   raid=null;handleEquipment({gear:'issue'});assert.equal(equipmentState.worn.back,ISSUE_PACK);assert.equal(equipmentState.worn.primary,undefined);
 `],
 ['배낭 입수·격자 회전 및 반납·현장 판정',`
   addStashGoods(KIT_LARGE_PACK);handleEquipment({gear:'wear-stash',id:KIT_LARGE_PACK});assert.deepEqual(raidBagSize(),[6,8]);
   addStashGoods('water');handleEquipment({gear:'pack',id:'water'});const water=equipmentState.bag[0];
   handleEquipment({gear:'select',unit:water.uid});handleEquipment({gear:'prep-rotate'});handleEquipment({gear:'cell',x:2,y:3});
   assert.equal(water.w,2);assert.equal(water.h,1);handleEquipment({gear:'select',unit:water.uid});handleEquipment({gear:'unpack'});assert.equal(stashCount('water'),1);
   handleEquipment({gear:'unwear',slot:'back'});assert.deepEqual(raidBagSize(),[3,2]);assert.equal(stashCount(KIT_LARGE_PACK),1);
   raid={zone:0};field={bag:[],log:[]};loadEquipment(null);assert.ok(hasRaidBackpack());assert.deepEqual(raidBagSize(),[6,6]);assert.equal(gearAttackBonus(),0);
 `]
];
const context={assert,console};vm.createContext(context);
vm.runInContext(setup+gridMethods+stash+eq+fs.readFileSync('src/market.js','utf8')+fs.readFileSync('src/exchange.js','utf8'),context);
for(const [name,script] of scenarios){
 vm.runInContext(script,context);console.log('PASS '+name);
}
