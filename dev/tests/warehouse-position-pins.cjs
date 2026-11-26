// Positions belong to physical warehouse UIDs, independent of item, rarity and sale value.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const base=boot(),state=clone(base.g.s);
function tile(g,uid,x,y,w,h,extra={}){return {uid,g,x,y,w,h,...extra}}
const food=tile('food','s-food-fixed',5,25,1,1),deposit=tile('cr_notes','s-note-fixed',2,28,1,1,{revealed:true,amount:5000});
const water=tile('water','s-water-moving',1,18,1,2),spare=tile('food','s-food-free',0,22,1,1);
state.cash.pocket[0].amount-=5000;state.stash={food:2,water:1,cr_notes:1};state.stashSlots=[food,water,spare,deposit];
const b=boot({[v12]:state});valid(b.g);
const position=(a,id)=>{const {x,y,w,h}=a.g.s.stashSlots.find(u=>u.uid===id);return [x,y,w,h]};
const pin=(a,u)=>{a.g.stashAction({stash:'select',uid:u.uid,id:u.g});a.g.loadout({loadout:'pin-position',uid:u.uid})};
const sort=a=>a.g.loadout({loadout:'sort'});
async function run(){
  assert.equal(b.g.s.stashPositionPins,undefined);pin(b,food);assert.deepEqual(clone(b.g.s.stashPositionPins),[food.uid]);
  // The same physical money UID is selected from the cash compartment's warehouse tile in UI tests.
  const s=clone(b.g.s);s.stashPositionPins.push(deposit.uid);const a=boot({[v12]:s});const balance=a.g.s.wallet;
  const template=clone(a.g.s),pinned=position(a,food.uid),note=position(a,deposit.uid);
  sort(a);assert.deepEqual(position(a,food.uid),pinned);assert.deepEqual(position(a,deposit.uid),note);
  assert.deepEqual(position(a,water.uid),[0,0,1,2]);assert.deepEqual(position(a,spare.uid),[1,0,1,1]);
  assert.equal(a.g.s.wallet,balance);assert.deepEqual(clone(a.g.s.stash),template.stash);valid(a.g);
  const exportFile=await a.exportData();const restored=boot({},a.clock);await restored.g.importFile(new Blob([JSON.stringify(exportFile)]));
  assert.deepEqual(clone(restored.g.s.stashPositionPins),[food.uid,deposit.uid]);assert.deepEqual(position(restored,food.uid),pinned);
  for(const pins of [[food.uid,food.uid],['s-absent'],[false],'s-food-fixed']){const bad=clone(exportFile);bad.session.stashPositionPins=pins;assert.equal(restored.g.check(bad),false)}
  // Move an anchored tile deliberately. Only the next automatic sorting operation respects its new position.
  restored.g.stashAction({stash:'select',id:food.g,uid:food.uid});restored.g.stashAction({stash:'place',x:4,y:23});sort(restored);assert.deepEqual(position(restored,food.uid),[4,23,1,1]);
  pin(restored,food);assert.ok(!restored.g.s.stashPositionPins.includes(food.uid));sort(restored);assert.notDeepEqual(position(restored,food.uid),[4,23,1,1]);
  // A sold tile cannot leave a stale pin on another item of the same type.
  pin(restored,spare);restored.g.sell(spare.g,spare.uid);assert.ok(!restored.g.s.stashPositionPins.includes(spare.uid));
  assert.ok(restored.g.s.stashSlots.some(u=>u.uid===food.uid));valid(restored.g);
  // Refused storage writes restore both the visible anchor and the last durable layout.
  const failed=boot({[v12]:state}),key=failed.storage.get(v12),original=failed.storage.set;
  failed.storage.set=()=>{throw Error('quota')};pin(failed,food);assert.equal(failed.g.s.stashPositionPins,undefined);assert.equal(failed.storage.get(v12),key);
  sort(failed);assert.deepEqual(position(failed,water.uid),[1,18,1,2]);failed.storage.set=original;
  // A second open view never overwrites a pin saved by the first view.
  const shared=boot({[v12]:state}),older=boot({[v12]:state},shared.clock);pin(shared,food);
  assert.deepEqual(clone(shared.g.s.stashPositionPins),[food.uid]);
  older.storage.set(v12,shared.storage.get(v12));pin(older,spare);
  assert.deepEqual(clone(older.g.s.stashPositionPins),[food.uid]);valid(older.g);
  console.log('PASS manual placement and pinned orientation, unchanged physical money and quantities, sort and native backup, stale UID cleanup, failed write rollback, and concurrent-tab handoff.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
