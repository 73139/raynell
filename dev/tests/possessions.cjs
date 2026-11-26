// Use the final game script, its normal inventory actions, and the JSON save importer.
const {assert,boot,clone,go,valid} = require('./game-fixture.cjs');
const ID = 'rs_case_food', A = 's-rations', B = 's-drinks', oldKey = 'rl-reboot-session-v17';
const fromCase = (g, id, uid) => g.searchOwned(g.goods[id][0]).find(row => row.caseUid === uid && row.id === id);
const quantity = rows => rows.reduce((sum,row)=>sum+row.quantity,0);
function legacy() {
  const initial=boot(), {g}=initial;
  assert.ok(g.contract('supply-pantry','accept').ok);
  assert.ok(g.pin({kind:'contract',id:'supply-pantry'}));
  const s=clone(g.s);
  const tile=(id,uid,x,y)=>({g:id,uid,x,y,w:g.goods[id][1],h:g.goods[id][2]});
  s.version=17;
  s.stash={[ID]:2, water:3, matches:1};
  s.stashSlots=[
    {...tile(ID,A,0,1),contents:[tile('food','s-can',6,7),tile('water','s-water-a',3,1)]},
    {...tile(ID,B,3,15),contents:[tile('tea','s-tea',6,3),tile('water','s-water-b',2,5)]},
    tile('water','s-loose-water',0,10),tile('matches','s-loose-matches',5,0)
  ];
  s.equipment.bag=[{...tile('water','kit-water',0,0),revealed:true}];
  return s;
}
function checkCoordinates(g) {
  const canned=fromCase(g,'food',A), tea=fromCase(g,'tea',B);
  assert.ok(canned && tea);
  assert.deepEqual([canned.row,canned.col,canned.caseRow,canned.caseCol],[8,7,2,1]);
  assert.deepEqual([tea.row,tea.col],[4,7]);
}
function checkCounts(g) {
  const water=Array.from(g.searchOwned('물통'));
  assert.equal(quantity(water),6,'1 placed + 2 in overflow + 2 inside cases + 1 in bag');
  assert.deepEqual(water.map(x=>x.kind).sort(),['bag','case','case','overflow','stash']);
  assert.equal(water.find(x=>x.kind==='overflow').quantity,2);
  assert.equal(g.searchOwned('  ').length,0);
  assert.equal(g.searchOwned('무소유-검증용').length,0);
  assert.equal(g.searchOwned('물 통').length,water.length);
  assert.equal(quantity(g.searchOwned('지급 배낭')),1);
  assert.ok(g.searchOwned('rl-01')[0].id==='rl10_carbine');
}
async function warehouseAndMigration(){
  const original=legacy(), b=boot({[oldKey]:original}),{g}=b;
  valid(g);assert.equal(g.s.version,35);
  assert.deepEqual(clone(g.s.objectivePin),{kind:'contract',id:'supply-pantry'});
  assert.equal(b.storage.get(oldKey),JSON.stringify(original));
  assert.equal(g.searchOwned('식량 보관함').length,2);
  checkCoordinates(g);checkCounts(g);
  const special='야간 <물자> & "A"';
  assert.ok(g.renameCase(A,special).ok);
  assert.ok(g.renameCase(B,'  비상   음료  ').ok);
  assert.equal(g.searchOwned('비상음료'.normalize('NFD'))[0].uid,B);
  assert.equal(g.searchOwned('야간')[0].uid,A);
  assert.equal(g.renameCase('overflow','대기').ok,false);
  assert.equal(g.renameCase('s-loose-water','잘못된 이름').ok,false);
  assert.equal(g.renameCase(A,'가'.repeat(25)).ok,false);
  assert.equal(g.locateOwned(g.searchOwned('야간')[0].key).alias,special);
  const teaKey=fromCase(g,'tea',B).key, canKey=fromCase(g,'food',A).key;
  b.click({page:'stash'});b.click({stash:'select',id:ID,uid:B});
  b.click({stash:'place',x:'2',y:'27'});
  assert.deepEqual([g.locateOwned(teaKey).caseRow,g.locateOwned(teaKey).caseCol],[28,3]);
  assert.deepEqual([g.locateOwned(canKey).caseRow,g.locateOwned(canKey).caseCol],[2,1]);
  const snapshot=await b.exportData();assert.ok(g.check(snapshot));
  const restored=boot();
  await restored.g.importFile(new Blob([JSON.stringify(snapshot)]));
  assert.equal(restored.g.locateOwned(teaKey).caseRow,28);
  assert.equal(restored.g.locateOwned(canKey).caseName,special);
  checkCounts(restored.g);valid(restored.g);
  const reloaded=boot(new Map(b.storage)); const r=reloaded.g;
  assert.equal(r.locateOwned(teaKey).caseName,'비상 음료');
  assert.equal(r.locateOwned(teaKey).caseRow,28);
  reloaded.click({page:'inventory'}); reloaded.click({loadout:'sort'});
  assert.equal(r.locateOwned(teaKey).caseName,'비상 음료');
  assert.equal(r.locateOwned(canKey).caseName,special);
  assert.equal(quantity(r.searchOwned('물통')),6);
  assert.ok(r.caseMove(B,'take','s-tea').ok);assert.equal(r.locateOwned(teaKey),null);
  assert.equal(quantity(r.searchOwned('차 음료')),1);
  const item=r.searchOwned('차 음료')[0];
  assert.equal(item.kind,'stash');r.sell('tea',item.uid);
  assert.equal(r.searchOwned('차 음료').length,0);
  assert.equal(r.locateOwned(item.key),null);
  assert.ok(r.renameCase(A,'').ok);
  assert.equal(r.searchOwned('야간').length,0);
  assert.equal(r.locateOwned(canKey).caseName,r.goods[ID][0]);
  const invalid=clone(snapshot);invalid.session.stashSlots.find(unit=>unit.uid==='s-loose-water').alias=special;
  assert.equal(g.check(invalid),false,'aliases belong only to individual storage cases');
}
function sameInstanceIdsInSeparateCases() {
  // The backup format requires child IDs to be unique inside each box, not across every box.
  const s=legacy();
  for (const box of s.stashSlots.filter(unit=>unit.g===ID)) {
    box.contents.find(unit=>unit.g==='water').uid='s-common';
  }
  const {g}=boot({[oldKey]:s});
  valid(g);
  const waters=Array.from(g.searchOwned('물통')).filter(row=>row.caseUid);
  assert.equal(waters.length,2);
  assert.notEqual(waters[0].key,waters[1].key);
  for (const row of waters) {
    const found=g.locateOwned(row.key);
    assert.equal(found.caseUid,row.caseUid);
    assert.equal(found.uid,'s-common');
  }
  const a=waters.find(row=>row.caseUid===A), b=waters.find(row=>row.caseUid===B);
  assert.ok(g.caseMove(A,'take','s-common').ok);
  assert.equal(g.locateOwned(a.key),null);
  assert.equal(g.locateOwned(b.key).caseUid,B);
}
function raidScopeAndSaves() {
  const b=boot({[oldKey]:legacy()}),g=b.g;
  const retained=g.searchOwned('지급 배낭')[0];
  assert.equal(retained.kind,'worn');assert.equal(retained.scope,'bunker');
  g.start();
  assert.equal(g.searchOwned('지급 배낭').length,1);assert.equal(g.searchOwned('지급 배낭')[0].scope,'raid');
  assert.equal(g.searchOwned('물통').find(row=>row.kind==='bag').scope,'raid');
  checkCounts(g);
  const sample=g.s.field.boxes['0-0'];
  sample.items=[{uid:'hidden-diamond',g:'diamond',x:0,y:0,w:1,h:1,revealed:false}];
  g.s.field.gearGround[0].push({uid:'dropped-diamond',g:'diamond',x:0,y:0,w:1,h:1,revealed:true});
  assert.equal(g.searchOwned(g.goods.diamond[0]).length,0,'unowned map contents must never be indexed');
  assert.equal(g.renameCase(B,'현장 수정').ok,false);
  go(b,'abandon');g.ack();
  assert.equal(quantity(g.searchOwned('물통')),5,'only the field bag was lost');
  const stable=boot(new Map(b.storage)), twin=boot(stable.storage);
  assert.ok(twin.g.renameCase(B,'먼저 저장').ok);
  assert.equal(stable.g.renameCase(B,'충돌').ok,false);
  assert.equal(stable.g.searchOwned('먼저 저장')[0].uid,B);
  const before=clone(stable.g.s);
  stable.storage.set=()=>{throw Error('simulated quota failure')};
  assert.equal(stable.g.renameCase(B,'저장 실패').ok,false);
  assert.deepEqual(clone(stable.g.s),before);
}
warehouseAndMigration().then(()=>{
  sameInstanceIdsInSeparateCases();raidScopeAndSaves();
  console.log('PASS owned search, exact case and inner coordinates, queues and equipped locations, Unicode aliases, movement/sort/export/reload, legacy pin, lost inventory, stale keys and storage conflicts.');
}).catch(e=>{console.error(e);process.exitCode=1});
