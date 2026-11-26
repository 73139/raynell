const {setTestCash,assert,boot,clone,epoch,extract,finish,go,move,stamp,v9,v12,valid}=require('./game-fixture.cjs');
function quickQuest(){
 const b=boot(),{g}=b;valid(g);assert.equal(g.w,true);
 const variants=new Set(),counts=new Set();
 for(let i=0;i<140;i++){
   const exits=g.shuffle();assert.equal(exits[0],'b04');assert.equal(new Set(exits).size,exits.length);
   assert.ok(exits.length>=2 && exits.length<=4);counts.add(exits.length);exits.forEach(e=>variants.add(e));
 }
 assert.equal(variants.size,6);assert.equal(counts.size,3);
 g.order('scout');g.start();valid(g);const s=g.s,assigned=clone(s.field.exits);
 assert.ok(assigned.includes('b04'));assert.equal(Object.keys(s.field.boxes).length,46);
 // The one seeded loot tile controls what is revealed, while field/loot input follows normal actions.
 s.field.boxes['0-0'].items=[{uid:'test-water',g:'water',w:1,h:2,x:0,y:0,revealed:false}];
 go(b,'scan');finish(b);go(b,'open',{index:0});assert.equal(g.s.field.open,'0-0');
 go(b,'search');assert.equal(g.s.field.action.type,'search');finish(b);
 g.selectLoot('test-water');assert.equal(g.s.field.bag[0].g,'water');
 go(b,'close');go(b,'extract',{exit:'b04'});const scheduled=g.s.field.action.end;
 stamp(b,scheduled-4000);go(b,'cancel');assert.equal(g.s.field.action,null);stamp(b,scheduled);
 assert.equal(g.s.field.result,null);assert.equal(g.stock('water'),0);valid(g);
 const r=boot(b.storage,b.clock);assert.deepEqual(clone(r.g.s.field.exits),assigned);
 assert.equal(r.g.s.field.bag.length,1);go(r,'extract',{exit:'b04'});const deadline=r.g.s.field.action.end;
 const offline=boot(b.storage,{now:deadline+30000}); // Browser was closed while the extraction matured.
 assert.equal(offline.g.s.lastSummary.rating,'quick');assert.equal(offline.g.s.lastSummary.earned,25);
 assert.equal(offline.g.s.career.order,'scout');assert.equal(offline.g.stock('water'),1);
 assert.equal(offline.g.s.equipment.worn.back,'issued_pack');assert.equal(offline.g.s.career.sorties,1);valid(offline.g);
 const baseline=JSON.stringify(offline.g.s.career);for(let i=0;i<10;i++)offline.g.tick();
 assert.equal(JSON.stringify(offline.g.s.career),baseline);assert.equal(offline.g.stock('water'),1);
 offline.g.ack();offline.clock.now++;offline.g.start();
 move(offline,1);move(offline,0);stamp(offline,offline.g.s.raid.startedAt+7*60000);extract(offline);
 assert.equal(offline.g.s.lastSummary.rating,'success');assert.equal(offline.g.s.lastSummary.commission,20000);
 assert.equal(offline.g.s.lastSummary.missionXp,80);assert.equal(offline.g.s.career.returns,2);
 assert.equal(offline.g.s.career.order,null);assert.equal(offline.g.s.career.done.join(),'scout');
 assert.equal(offline.g.s.wallet,50000);assert.equal(offline.g.s.career.xp,225);assert.equal(offline.g.level(),2);
 const restored=boot(offline.storage,offline.clock);assert.equal(restored.g.s.wallet,50000);
 restored.g.ack();restored.g.order('scout');assert.equal(restored.g.s.career.order,null);
 console.log('PASS: 2–4 assigned exits, all 6 variants, 46 seeded containers, interaction/search/loot, cancelled extraction, active reload, offline quick extraction, settlement once, full extraction, mission, XP and level.');
}
function otherMissions(){
 const b=boot(),{g}=b;g.order('stores');g.start();
 for(const index of [0,1]){
   go(b,'scan');finish(b);go(b,'open',{index});go(b,'search');
   while(g.s.field.action)finish(b);
   assert.ok(g.s.field.boxes['0-'+index].complete);go(b,'close');
 }
 extract(b);assert.equal(g.s.lastSummary.rating,'success');
 assert.equal(g.s.lastSummary.searched,2);assert.equal(g.s.lastSummary.commission,32000);
 assert.equal(g.s.lastSummary.missionXp,120);assert.ok(g.s.lastSummary.elapsed<7*60000);
 g.ack();g.order('signals');b.clock.now++;g.start();
 for(let i=0;i<5&&!g.s.field.contact;i++){
   if(i%2===0)go(b,'landmark',{index:i/2});
   go(b,'scan');finish(b);
 }
 assert.ok(g.s.field.contact);for(let i=0;i<5&&g.s.field.contact;i++){go(b,'engage');finish(b);}
 assert.equal(g.s.field.victories,1);extract(b);assert.equal(g.s.lastSummary.rating,'success');
 assert.equal(g.s.lastSummary.commission,42000);assert.equal(g.s.lastSummary.missionXp,150);
 assert.ok(g.s.career.done.includes('signals'));assert.ok(g.s.lastSummary.elapsed<7*60000);
 valid(g);console.log('PASS: both alternate full-extraction criteria before seven minutes, two containers and combat victory via normal actions, each mission fee and XP paid.');
}
function legacy(ctx={}){
 const bag=ctx.bag||[],zone=ctx.zone||0,origin=epoch-60000;
 const r={zone,startedAt:origin,endsAt:origin+1800000};
 return {[v9]:{raid:r,field:{raidId:origin,bag,found:[[],[],[]],boxes:{},action:ctx.action||null,open:null,
  log:[],result:ctx.result||null,energy:100,water:100,visited:[zone]},stash:{bolt:3},wallet:ctx.wallet??30000,lastSummary:null}};
}
function exitRules(){
 let b=boot(legacy({zone:1}));const source=b.storage.get(v9);
 assert.equal(b.g.s.field.exits.length,6);valid(b.g);assert.ok(b.g.s.field.worn.back);
 assert.equal(b.g.s.wallet,30000);go(b,'extract',{exit:'truck'});
 assert.equal(b.g.s.wallet,30000);go(b,'cancel');assert.equal(b.g.s.wallet,30000);extract(b,'truck');
 assert.equal(b.g.s.wallet,15000);assert.equal(b.g.s.lastSummary.cost,15000);assert.equal(b.storage.get(v9),source);
 b=boot(legacy({zone:1,wallet:0}));go(b,'extract',{exit:'truck'});assert.equal(b.g.s.field.action,null);
 b=boot(legacy({zone:2}));assert.match(b.g.condition('security'),/키카드/);
 assert.match(b.g.condition('rescue'),/무전기/);b.g.s.field.worn.access='keycard';assert.equal(b.g.condition('security'),'');
 b.g.s.field.worn.comms='radio';assert.equal(b.g.condition('rescue'),'');valid(b.g);
 const [opens,closes]=b.g.window();assert.match(b.g.condition('train'),/대기/);
 stamp(b,closes-30000);assert.match(b.g.condition('train'),/마감/);stamp(b,opens);extract(b,'train');
 assert.equal(b.g.s.lastSummary.exit,'군수 수송 열차');
 b=boot(legacy());assert.match(b.g.condition('tunnel'),/배낭/);
 b.g.gear({gear:'ground-worn',slot:'back'});assert.equal(b.g.condition('tunnel'),'');valid(b.g);extract(b,'tunnel');
 b=boot(legacy());stamp(b,b.g.s.raid.endsAt-10000);assert.match(b.g.condition('b04'),/부족/);
 go(b,'extract',{exit:'b04'});assert.equal(b.g.s.field.action,null);stamp(b,b.g.s.raid.endsAt);
 assert.equal(b.g.s.lastSummary.result,'expired');assert.equal(b.g.s.career.returns,0);valid(b.g);
 b=boot(legacy());stamp(b,b.g.s.raid.endsAt-10001);extract(b);assert.equal(b.g.s.lastSummary.result,'success');
 b=boot(legacy());b.g.start();b.g.s.field.exits=['b04'];assert.match(b.g.condition('truck'),/미배정/);
 const legacyTimed=legacy();const deadline=legacyTimed[v9].raid.endsAt;
 legacyTimed[v9].field.action={type:'extract',exit:'b04',start:deadline-10000,end:deadline};
 b=boot(legacyTimed,{now:deadline+1});assert.equal(b.g.s.lastSummary.result,'expired');
 console.log('PASS: active v0.9 save migration, all legacy exits and spatial bag, source retention, truck fee/cancel/insufficient funds, backpack tunnel, card/radio, train opening and last-second boundaries, raid deadline tie/MIA and one millisecond before deadline.');
}
async function economyAndFailure(){
 let b=boot(),g=b.g;const backup=await b.exportData();assert.ok(g.check(backup));
 const price=g.price('rl10_vest');const x=g.fee;
 g.gear({gear:'buy',id:'rl10_vest'});assert.equal(g.stock('rl10_vest'),price<=x?1:0);
 if(price>x){assert.equal(g.fee,x);b=boot({[v9]:{wallet:999999,stash:{},raid:null}});g=b.g;g.gear({gear:'buy',id:'rl10_vest'});}
 const slot=g.s.stashSlots.find(u=>u.g==='rl10_vest');
 const before=g.fee;g.sell('rl10_vest',slot.uid);assert.equal(g.fee,before+Math.floor(price/2));assert.equal(g.stock('rl10_vest'),0);
 const cash=g.fee;g.gear({gear:'buy',id:'rl10_vest'});assert.equal(g.fee,cash-price);
 const item=g.s.stashSlots.find(u=>u.g==='rl10_vest');g.gear({gear:'wear-stash',id:item.g,unit:item.uid});
 assert.equal(g.s.equipment.worn.armor,'rl10_vest');g.start();const active=await b.exportData();assert.ok(g.check(active));
 assert.equal(g.s.field.worn.armor,'rl10_vest');g.s.field.hp=1;
 // Trigger a genuine encounter one turn early to test the loss edge.
 g.s.field.nextContact=1;go(b,'scan');finish(b);assert.ok(g.s.field.contact);
 go(b,'move',{index:1});assert.equal(g.s.field.action,null);b.setRandom(.9);go(b,'evade');finish(b);b.setRandom(null);
 assert.equal(g.s.lastSummary.result,'kia');assert.equal(g.s.equipment.worn.armor,undefined);
 assert.equal(g.s.career.xp,0);assert.equal(g.s.career.sorties,1);assert.ok(!g.s.field.bag.length);valid(g);
 g.ack();await g.importFile(new Blob([JSON.stringify(active)]));assert.ok(g.s.raid);
 assert.equal(g.s.field.worn.armor,'rl10_vest');valid(g);
 go(b,'abandon');assert.equal(g.s.lastSummary.result,'abandoned');assert.equal(g.s.career.sorties,1);
 g.ack();await g.importFile(new Blob([JSON.stringify(backup)]));assert.equal(g.s.raid,null);assert.equal(g.fee,30000);
 const bad=clone(backup);bad.session.field.found='broken';assert.equal(g.check(bad),false);
 console.log('PASS: store buy, resale, equipment, real encounter and KIA, equipment loss, abandoned, active/idle snapshot export/import, corrupt backup rejection.');
}
function procureBuild(){
 const b=boot({[v9]:{wallet:130000,stash:{},raid:null}}),g=b.g;
 const requirements={fuel:1,wire:2,bolt:2};let balance=130000;
 g.supply('fuel');assert.equal(g.stock('fuel'),0); // Only the selected facility material can be ordered.
 for(const [id,qty] of Object.entries(requirements)){
  g.lookup(id);
  for(let i=0;i<qty;i++){g.supply(id);balance-=g.price(id);}
  assert.equal(g.stock(id),qty);assert.equal(g.fee,balance);
 }
 g.build({hideout:'build',id:'power',tier:'1'});assert.equal(g.fee,balance-20000);
 assert.ok(g.s.hideout.builds.power);g.start();g.lookup('wire');g.supply('wire');assert.equal(g.stock('wire'),0);
 const poor=boot({[v9]:{wallet:0,stash:{},raid:null}});poor.g.lookup('wire');poor.g.supply('wire');assert.equal(poor.g.stock('wire'),0);
 const candidate=boot(), low=clone(candidate.g.s);
 setTestCash(low,300000);
 const buyer=boot({[v12]:low}), bb=buyer.g;
 for(const [id,item] of Object.entries(bb.goods)){
  if(!['귀중품','골동품'].includes(item[5]))continue;
  bb.lookup(id);
  assert.ok(!buyer.content().includes('data-supply="'+id+'"'));
  bb.supply(id);bb.gear({gear:'buy',id});
  assert.equal(bb.fee,low.wallet);assert.equal(bb.stock(id),0);
 }
 bb.lookup('cable');bb.supply('cable');
 assert.match(buyer.content(),/임도현의 우호도를 올리면 주문할 수 있습니다/);
 assert.equal(bb.fee,low.wallet);assert.equal(bb.stock('cable'),0);
 bb.lookup('rl_07_03');bb.supply('rl_07_03');
 assert.equal(bb.stock('rl_07_03'),1);assert.equal(bb.fee,low.wallet-bb.price('rl_07_03'));
 const beforeFailedOrder=clone(bb.s);
 buyer.storage.set=()=>{throw Error('simulated quota')};
 bb.supply('rl_07_03');
 assert.deepEqual(clone(bb.s),beforeFailedOrder);
 const high=clone(low);
 high.contracts.repair.done=candidate.g.quests.filter(q=>q.trader==='repair'&&q.tier===1).map(q=>q.id);
 const unlocked=boot({[v12]:high}).g;
 unlocked.lookup('cable');unlocked.supply('cable');
 assert.equal(unlocked.stock('cable'),1);assert.equal(unlocked.fee,high.wallet-unlocked.price('cable'));
 const advancedGear=clone(low);
 advancedGear.contracts.quarter.done=candidate.g.quests.filter(q=>q.trader==='quarter'&&q.tier===1).map(q=>q.id);
 const gearBuyer=boot({[v12]:advancedGear});
 gearBuyer.click({page:'inventory'});gearBuyer.click({loadout:'slot',slot:'head'});
 assert.ok(gearBuyer.content().includes('data-gear="buy" data-id="rl12_helmet"'));
 gearBuyer.click({gear:'buy',id:'rl12_helmet'});
 assert.equal(gearBuyer.g.stock('rl12_helmet'),1);assert.equal(gearBuyer.g.fee,advancedGear.wallet-gearBuyer.g.price('rl12_helmet'));
 console.log('PASS: all generator ingredients bought through selected catalog material, stock/price matched, generator build committed, purchases blocked in raid or without funds.');
}
function buildDuringRaid(){
 const b=boot({[v9]:{wallet:30000,stash:{fuel:1,wire:2,bolt:2},raid:null}}),g=b.g;
 g.build({hideout:'build',id:'power',tier:'1'});assert.equal(g.s.wallet,10000);assert.equal(g.stock('fuel'),0);
 const deadline=g.s.hideout.builds.power.end;valid(g);g.start();stamp(b,deadline-1);
 assert.equal(g.s.hideout.levels.power,0);const r=boot(b.storage,{now:deadline});
 assert.equal(r.g.s.hideout.levels.power,1);assert.equal(r.g.s.wallet,10000);assert.ok(r.g.s.raid);valid(r.g);
 console.log('PASS: real legacy inventory consumed for building, forced reload on deadline while a raid is active, persistent one-time completion.');
}
(async()=>{quickQuest();otherMissions();exitRules();await economyAndFailure();procureBuild();buildDuringRaid()})().catch(e=>{console.error(e);process.exitCode=1;});
{
  const countdown={type:'extract',exit:'tunnel',start:epoch-14000,end:epoch+1000};
  const b=boot(legacy({action:countdown}));
  assert.equal(b.g.s.field.worn.back,undefined);
  assert.ok(b.g.s.field.gearGround[0].some(item=>item.g==='issued_pack'));
  valid(b.g);stamp(b,countdown.end);assert.equal(b.g.s.lastSummary.exit,'비상 정비 통로');
  console.log('PASS: an eligible v0.9 tunnel countdown still completes after migration.');
}
