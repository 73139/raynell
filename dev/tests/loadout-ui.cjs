// Exercise the new protective gear, ten quick-use bindings and transfers on the built game.
const {assert,boot,clone,valid,v11,v12}=require('./game-fixture.cjs');
const old=clone(boot().g.s);
old.wallet=500000;
old.version=11;
delete old.equipment.quickslots;
old.stash={water:2,bandage:2,food:1,rl_13_01:1,rl_13_16:1,patch:1,rl_05_15:1,rl_11_09:1,rl12_helmet:1,rl12_sidearm:1,rl12_respirator:1};
delete old.stashSlots;
let b=boot({[v11]:old}),g=b.g;
const click=d=>b.click(d),show=p=>click({page:p});
const first=id=>g.s.stashSlots.find(u=>u.g===id);
const pickStore=id=>click({stash:'select',id,uid:first(id).uid});
show('inventory');
assert.equal((b.content().match(/data-loadout="slot"/g)||[]).length,15);
assert.deepEqual(clone(g.s.equipment.quickslots),Array(10).fill(null));
assert.deepEqual(clone(g.s.equipment.worn),old.equipment.worn);
assert.equal(b.storage.get(v11),JSON.stringify(old));
for(const [slot,id] of Object.entries({head:'rl12_helmet',secondary:'rl12_sidearm',breathing:'rl12_respirator',face:'rl_11_09',ears:'rl_13_01',support:'rl_13_16',melee:'rl_05_15',insignia:'patch'})){
  click({loadout:'slot',slot});
  if(id.startsWith('rl12_')){
    const balance=g.s.wallet;
    click({gear:'buy',id});
    assert.equal(g.s.wallet,balance);assert.equal(g.stock(id),1);
  }
  click({gear:'wear-stash',id});
  assert.equal(g.s.equipment.worn[slot],id);
}
valid(g);
pickStore('food');click({gear:'cell',x:2,y:2});
let unit=g.s.equipment.bag.find(u=>u.g==='food');
assert.ok(unit);assert.equal(unit.x,2);assert.equal(unit.y,2);assert.equal(g.stock('food'),0);
click({gear:'select',unit:unit.uid});click({stash:'place',x:4,y:7});
assert.equal(g.stock('food'),1);assert.equal(first('food').x,4);assert.equal(first('food').y,7);
assert.ok(!g.s.equipment.bag.some(u=>u.g==='food'));
pickStore('water');click({gear:'cell',x:0,y:0});pickStore('bandage');click({gear:'cell',x:0,y:0});
assert.equal(g.stock('bandage'),2);assert.equal(g.s.equipment.bag.length,1);
click({gear:'cell',x:1,y:0});assert.equal(g.stock('bandage'),1);assert.equal(g.s.equipment.bag.length,2);
click({loadout:'assign',id:'water'});click({loadout:'quick',index:'9'});
assert.equal(g.s.equipment.quickslots[9],'water');
click({loadout:'assign',id:'bandage'});click({loadout:'quick',index:'2'});
click({loadout:'unbind'});click({loadout:'quick',index:'2'});assert.equal(g.s.equipment.quickslots[2],null);
show('prep');click({raid:'start'});assert.equal(g.s.field.worn.support,'rl_13_16');valid(g);
const sortie=clone(g.s);sortie.field.water=45;b=boot({[v12]:sortie});g=b.g;
show('health');click({loadout:'quick',index:'9'});assert.equal(g.s.field.water,70);
click({loadout:'quick',index:'9'});assert.equal(g.s.field.water,70);assert.equal(g.s.field.bag.length,1);
valid(g);
const bad=clone(g.s);bad.equipment.quickslots[9]='__proto__';assert.equal(g.check({format:'rustline-tc01',session:bad}),false);

// A case that already belongs to the player stays in the bunker even when
// the equipment transfer is invoked directly or from a free bag grid cell.
const caseIds=['rs_case_med','rs_case_junk','rs_case_food'];
const stocks=clone(boot().g.s);
stocks.stash=Object.fromEntries(caseIds.map(id=>[id,1]));
delete stocks.stashSlots;
const caseUI=boot({[v12]:stocks});
caseUI.click({page:'inventory'});
for(const id of caseIds){
 const owned=caseUI.g.s.stashSlots.find(u=>u.g===id);
 caseUI.click({stash:'select',id,uid:owned.uid});
 assert.ok(!caseUI.content().includes('data-gear="pack" data-id="'+id+'"'));
 caseUI.click({gear:'pack',id,unit:owned.uid});
 caseUI.click({gear:'cell',x:0,y:0});
 assert.equal(caseUI.g.stock(id),1);
 assert.equal(caseUI.g.s.equipment.bag.length,0);
 const tampered=clone(caseUI.g.s);
 tampered.equipment.bag=[caseUI.g.unit(id)];
 assert.equal(caseUI.g.check({format:'rustline-tc01',session:tampered}),false);
}
valid(caseUI.g);
console.log('PASS 15 real slots, eight added wearable types, v11 migration, precise transfer both directions, occupied destination atomicity, quick bind/unbind/restore/use once, invalid bindings rejected.');
