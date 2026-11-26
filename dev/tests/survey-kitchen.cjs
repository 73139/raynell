// A returned ration survey unlocks two timed recipes that share the same kitchen and stock.
const {assert,boot,clone,stamp,v12,valid}=require('./game-fixture.cjs');
const recipes=[
  {key:'oat-porridge',ingredient:'rl_09_16',product:'rl_09_10',minutes:3,stat:'energy',gain:23},
  {key:'salt-drink',ingredient:'salt',product:'rl_10_16',minutes:2,stat:'water',gain:31}
];
function seed(done=['scout','ration-survey'],level=1){
  const s=clone(boot().g.s);
  Object.assign(s.hideout.levels,{power:1,kitchen:level,water:2,vent:1});
  s.career.done=done;
  s.stash={water:1,rl_09_16:1,salt:1};
  return s;
}
function play(s){return boot({[v12]:s});}
const cook=(b,key,id='kitchen')=>b.click({hideout:'produce',id,recipe:key});
function noWrite(b,run){
  const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};
  try{run();}finally{b.storage.set=set;}
}
async function main(){
  for(const locked of [seed([],1),seed(['scout'],1),seed(undefined,0)]){
    const b=play(locked);
    for(const {key} of recipes){
      assert.ok(!b.g.facilityProductionPanel('kitchen').includes('data-recipe="'+key+'"'));
      cook(b,key);assert.ok(!b.g.s.hideout.production.kitchen);assert.equal(b.g.stock('water'),1);
    }
  }
  for(const r of recipes){
    const b=play(seed()),g=b.g;const other=recipes.find(recipe=>recipe!==r);
    const shape=()=>clone([g.s.stash,g.s.stashSlots,g.s.wallet,g.s.hideout.production]);
    const before=shape();
    assert.ok(g.facilityProductionPanel('kitchen').includes('data-recipe="'+r.key+'"'));
    cook(b,r.key,'med');assert.deepEqual(shape(),before);
    noWrite(b,()=>cook(b,r.key));assert.deepEqual(shape(),before,'rejected start restores stock');
    cook(b,r.key);const due=b.clock.now+r.minutes*60000*.95;
    assert.deepEqual(clone(g.s.hideout.production.kitchen),{recipe:r.key,end:due});
    assert.equal(g.stock('water')+g.stock(r.ingredient),0);assert.equal(g.stock(other.ingredient),1);
    cook(b,r.key);cook(b,other.key);assert.equal(g.s.hideout.production.kitchen.end,due);
    const backup=await b.exportData();
    for(const alter of [s=>s.career.done=['scout'],s=>s.hideout.levels.kitchen=0,s=>s.hideout.levels.kitchen=4,
        s=>s.hideout.production.kitchen.recipe=[r.key],
        s=>{s.hideout.production.med=s.hideout.production.kitchen;delete s.hideout.production.kitchen;},
        s=>s.hideout.production.kitchen.end=0]){
      const bad=clone(backup);alter(bad.session);assert.equal(g.check(bad),false);
    }
    const fresh=boot({},b.clock);await fresh.g.importFile(new Blob([JSON.stringify(backup)]));
    assert.deepEqual(clone(fresh.g.s.hideout.production.kitchen),{recipe:r.key,end:due});valid(fresh.g);
    const second=boot(fresh.storage,b.clock);
    stamp(fresh,due-1);assert.equal(fresh.g.stock(r.product),0);
    b.clock.now=due;fresh.g.prepare();assert.equal(fresh.g.stock(r.product),0,'stale tab loads winner');
    noWrite(second,()=>second.g.prepare());assert.equal(second.g.stock(r.product),0);assert.equal(second.g.s.hideout.production.kitchen.end,due);
    second.g.tick();assert.equal(second.g.stock(r.product),2);
    const cold=boot(second.storage,b.clock);cold.g.tick();assert.equal(cold.g.stock(r.product),2);
    assert.equal(cold.g.s.hideout.production.kitchen,undefined);assert.equal(cold.g.fee,before[2]);
    cold.g.gear({gear:'pack',id:r.product});cold.g.start();const s=clone(cold.g.s);
    s.field[r.stat]=45;const outing=boot({[v12]:s},b.clock);
    const uid=outing.g.s.field.bag.find(unit=>unit.g===r.product).uid;
    outing.g.gear({gear:'consume',unit:uid});outing.g.gear({gear:'consume',unit:uid});
    assert.equal(outing.g.s.field[r.stat],45+r.gain);assert.equal(outing.g.stock(r.product),1);valid(outing.g);
  }
  console.log('PASS: both kitchen unlocks, alternative batches, imported job deadlines, 6 invalid backups, quota and revision recovery, exactly two servings, one-time field use.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
