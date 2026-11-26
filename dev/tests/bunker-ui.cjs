// Screen regressions using the same career, facility database and game logic as the terminal.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {boot,clone,epoch,extract,stamp}=require('./game-fixture.cjs');
const db=JSON.parse(fs.readFileSync('Rustline_Database_v10.json','utf8'));
const uiSource=['field','gear-instances','gear-service','injuries','injuries-ui','stash','hideout','ward-trial','bunker-ui','survivor','survivor-ui','objective','objective-ui','weather','postal'].map(n=>fs.readFileSync('src/'+n+'.js','utf8')).join('\n');
const ctx=vm.createContext({document:{activeElement:null},ITEM_META:{},LANDMARKS:clone(boot().g.places),lastSummary:null,campaignBunkerCard:()=>'',menuIcon:()=>'',assert,writer:true,commandIcon:()=>'',GOODS:Object.fromEntries(Object.entries(db.items).map(([k,item])=>[k,[item.name]])),
  FACILITIES:db.hideout.facilities,FACILITY_PRODUCTION:db.hideout.production,boxKey:(zone,index)=>zone+'-'+index,
  artURL:key=>{assert.ok(fs.existsSync('src/assets/ui/'+key+'.webp'),key);return key+'.webp'},
  itemArt:id=>'<img alt="" src="'+id+'">',esc:String, money:n=>n+' CR',formatRaid:n=>String(n),
  FIELD_ZONES:[{name:'벙커 외곽'},{name:'폐쇄 검문소'},{name:'군수 창고'}]});
vm.runInContext(`let raid=null,field={},page='bunker',wallet=20000,facilitySelected='power',facilityTier=1;
  const equipmentState={bag:[]};
  const renderKeep=()=>{},save=()=>{},persist=()=>{},reconcile=()=>false,writeSession=()=>true,$=()=>({scrollTop:0}),inside={addEventListener(){}},stash={};
  ${uiSource}
  readCareer({sorties:5,returns:4,xp:177,history:[{rating:'quick',elapsed:1000,exit:'외곽',xp:25}]});
  assert.match(recordsView(),/6번째 출격부터 집계/);
  assert.match(recordsView(),/data-page="survivors"/);
  handleBunkerUI({bui:'history',index:0});assert.match(recordsView(),/이전 버전/);
  const previous={rating:'quick',elapsed:1000,xp:25,cash:-15000,cost:15000,commission:0};
  readCareer({history:[previous]});
  assert.ok(recordsView().includes('이전 정산 기록</b> -15000 CR'));
  assert.ok(!recordsView().includes('휴대 지폐 회수'));
  readCareer({history:[{...previous,carriedCash:20000,cash:5000}]});
  assert.ok(recordsView().includes('정산 시 지갑 변동</b> +5000 CR · 휴대 지폐 회수 20000 CR'));
  const mixed=[
    {rating:'success',carriedCash:10000,cost:0,commission:12000,cash:22000},
    {rating:'quick',carriedCash:5000,cost:15000,commission:0,cash:-10000},
    {rating:'expired',carriedCash:7000,cost:0,commission:0,cash:0},
    {rating:'kia',carriedCash:0,cost:0,commission:0,cash:0},
    previous
  ];
  const report=recentSettlementPanel(mixed);
  assert.ok(report.includes('최근 5회 정산 분석 · 귀환 3회'));
  assert.ok(report.includes('현금 내역이 남은 4 / 5회'));
  for(const [key,val] of Object.entries({net:12000,recovered:15000,orders:12000,fees:15000,lost:7000})){
    assert.ok(report.includes('data-records-amount="'+key+'">'+val+' CR'));
  }
  assert.ok(recentSettlementPanel([previous]).includes('이전 기록'));
  assert.ok(!recentSettlementPanel([previous]).includes('data-records-amount'));
  assert.equal(recentSettlementPanel([]),'');
  const enormous={rating:'success',carriedCash:Number.MAX_SAFE_INTEGER,cost:0,commission:0,cash:Number.MAX_SAFE_INTEGER};
  assert.ok(recentSettlementPanel([enormous,enormous]).includes('18014398509481982 CR'));
  readCareer({xp:325,sorties:2,returns:2,victories:3,victoriesFrom:0,history:[]});
  assert.match(recordsView(),/대원 Lv. 2/);assert.ok(!recordsView().includes('번째 출격부터'));
  loadHideout(null);
  assert.equal((bunkerOverviewView().match(/class="bu-facility-tile"/g)||[]).length,18);
  for(const [id,f] of Object.entries(FACILITIES)){
    openBunkerFacility(id);assert.equal(page,'facility');assert.equal(facilityTier,1);
    const detail=bunkerDetailView();assert.ok(detail.includes(f.name));assert.ok(detail.includes('data-db="lookup"'));
    for(const tier of [2,3]){
      handleBunkerUI({bui:'tier',tier});assert.match(bunkerDetailView(),new RegExp('Lv.'+tier+' 효과'));
    }
    handleBunkerUI({bui:'tier',tier:99});assert.equal(facilityTier,3);
  }
  const t=Date.now()+10000;hideout.builds.power={tier:1,end:t};
  assert.ok(bunkerOverviewView().includes('data-facility-end="'+t+'"'));openBunkerFacility('power');assert.ok(bunkerDetailView().includes('data-facility-end="'+t+'"'));
  advanceHideout(t);assert.equal(hideoutLevel('power'),1);
  for(const id of Object.keys(FACILITY_PRODUCTION)){hideout.levels[id]=3;openBunkerFacility(id);
    assert.equal((bunkerDetailView().match(/data-hideout="produce"/g)||[]).length,FACILITY_PRODUCTION[id].length)}
  for(const q of ORDERS){
    handleBunkerUI({bui:'order',id:q.id});assert.ok(ordersView().includes('data-order="'+q.id+'"'));
    changeOrder(q.id);assert.equal(bunkerOrderState(q),'active');assert.ok(ordersView().includes('수락 취소'));
    handleBunkerUI({bui:'order-filter',id:'active'});assert.equal((ordersView().match(/class="bu-order-choice"/g)||[]).length,1);
    const sourceBox=LANDMARKS[0][5].boxes[0];
    const clinicBox=LANDMARKS[0][7].boxes[0];
    const freightDrawer=boxKey(0,LANDMARKS[0][8].boxes[1]),quarantineDrawer=boxKey(1,LANDMARKS[1][1].boxes[1]);
    raid={zone:0};field={visited:[0,1],boxes:{[freightDrawer]:{complete:true,items:[]},[quarantineDrawer]:{complete:true,items:[]}},victories:1,
      found:[[sourceBox,clinicBox,LANDMARKS[0][8].boxes[1]],[LANDMARKS[1][1].boxes[1]],[]],bag:[{g:'wire',uid:'0-'+sourceBox+'-0'},{g:'bandage',uid:'0-'+clinicBox+'-0'}]};
    if(q.id==='pump-gauge'){
      raid.startedAt=Date.now()-2000;raid.endsAt=raid.startedAt+1800000;field.raidId=raid.startedAt;
      const reading=pumpReading(raid.startedAt);
      field.pumpGauge={raidId:raid.startedAt,readAt:raid.startedAt+1,reading,answer:pumpAnswer(reading)};
    }
    if(q.sample){
      const {zone,landmark,boxOrdinal}=q.sample.site;
      const index=LANDMARKS[zone][landmark].boxes[boxOrdinal];
      field.found[zone].push(index);
      field.boxes[boxKey(zone,index)]={complete:true,items:[]};
      field.bag.push({g:q.sample.item,uid:'p-pvc'});
    }
    if(q.id==='sealed-mail'){
      const at=Date.now()-2000;raid.startedAt=at;raid.endsAt=at+1800000;field.raidId=at;field.visited=[2,1];
      field.postal={raidId:at,issuedAt:at+1,stampedAt:at+1000};
    }
    if(q.id==='weather-survey'){
      const at=Math.floor((Date.now()-360000)/360000)*360000;
      raid.startedAt=at;raid.endsAt=at+1800000;field.raidId=at;
      field.weatherSurvey={raidId:at,observations:[{zone:0,landmark:9,at:at+1000,condition:'clear'},
        {zone:1,landmark:6,at:at+10000,condition:'fog'}]};
    }
    if(q.id==='courier-checkin'){
      const start=Date.now()-120000;raid.startedAt=start;field.raidId=start;
      survivorState.active={raidId:start,origin:0,clues:[],choice:null,meetings:[{step:0,at:start+1000},{step:1,at:start+110000}]};
    }
    const rows=bunkerOrderGoals(q);assert.ok(rows.slice(0,-1).every(([,n,max])=>n===max));assert.equal(rows.at(-1)[1],0);assert.ok(ordersView().includes('귀환 후 변경 가능'));
    changeOrder(q.id);assert.equal(career.order,q.id);raid=null;changeOrder(q.id);assert.equal(career.order,null);
    assert.match(ordersView(),/이 상태의 의뢰가 없습니다/);handleBunkerUI({bui:'order-filter',id:'all'});
    career.done.push(q.id);assert.ok(ordersView().includes('보상 지급 완료'));assert.ok(bunkerOrderGoals(q).every(([,n,max])=>n===max));
  }
`,ctx);
const b=boot(),{g}=b;
g.start();extract(b);
const row=clone(g.s.career.history[0]);
assert.equal(row.rating,'quick');assert.equal(row.zone,0);assert.ok(row.at>epoch);assert.equal(row.visited,1);
assert.equal(row.victories,0);assert.equal(row.cash,0);assert.deepEqual(row.goods,[]);
stamp(b,b.clock.now+4000);assert.equal(g.s.career.history.length,1);
const reloaded=boot(b.storage,b.clock);assert.deepEqual(clone(reloaded.g.s.career.history[0]),row);
console.log('PASS: 07–10 records, legacy rows, level progression, 18 illustrated facilities, all tier links, construction clocks, 39 production actions, all bunker orders with real-time goals and distinct states, and extract/reload history integrity.');
