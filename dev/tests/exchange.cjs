const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const allGoods=boot().g.goods;
function add(s,id,qty=1) {
  const [,w,h]=allGoods[id];
  for(let n=0;n<qty;n++){
    let position=null;
    for(let y=0;!position&&y<=32-h;y++)for(let x=0;!position&&x<=6-w;x++){
      if(s.stashSlots.every(u=>x+w<=u.x||u.x+u.w<=x||y+h<=u.y||u.y+u.h<=y))position={x,y};
    }
    assert.ok(position,'fixture must have room');
    s.stashSlots.push({uid:'s-exchange-'+id.replaceAll('_','-')+'-'+s.stashSlots.length,g:id,w,h,...position});
    s.stash[id]=(s.stash[id]||0)+1;
  }
}
const starter=boot(), base=clone(starter.g.s);
function seed(fn){
  const s=clone(base);fn(s);return boot({[v12]:s});
}
function promote(s){
  for(const id of ['quarter','repair','medic','supply']){
    s.contracts[id].done=starter.g.quests.filter(q=>q.trader===id&&q.tier<=3).map(q=>q.id);
  }
}
function quota(b,fn){const original=b.storage.set;b.storage.set=()=>{throw Error('quota');};try{return fn();}finally{b.storage.set=original;}}
const receipt=(g,trader,id)=>g.barterOffers(trader).find(r=>r.id===id);
const checkEconomy=g=>JSON.stringify({w:g.fee,p:g.s.cash,ss:g.s.stashSlots,st:g.s.stash,eq:g.s.equipment,rev:g.s.revision});

{
  const b=seed(s=>{
    add(s,'bandage',3);add(s,'rs_case_food');
    s.stashSlots.at(-1).contents=[{uid:'s-food-child',g:'food',x:0,y:0,w:1,h:1}];
    add(s,'flash');s.stashSlots.at(-1).gear={g:'flash',uid:'s-fitted-lamp',ammo:0,durability:47,module:'battery'};
  }),g=b.g,group=g.s.stashSlots.filter(u=>u.g==='bandage').map(u=>u.uid);
  const selected=group.slice(1),q=g.saleQuote('medic',selected);assert.ok(q.ok);assert.equal(q.total,g.price('bandage'));
  assert.ok(!g.saleQuote('supply',selected).ok);assert.ok(!g.saleQuote('medic',[group[0],group[0]]).ok);
  assert.match(g.saleQuote('supply',[g.s.stashSlots.find(u=>u.g==='rs_case_food').uid]).reason,/비운/);
  assert.match(g.saleQuote('quarter',[g.s.stashSlots.find(u=>u.g==='flash').uid]).reason,/분리/);
  const before=checkEconomy(g);assert.ok(!quota(b,()=>g.saleCommit('medic',selected,q.token)).ok);
  assert.equal(checkEconomy(g),before);
  assert.ok(g.saleCommit('medic',selected,q.token).ok);
  assert.deepEqual(clone(g.s.stashSlots.filter(u=>u.g==='bandage').map(u=>u.uid)),[group[0]]);
  assert.equal(g.cashBalance(),q.after);assert.equal(g.s.cash.pocket[0].amount,q.after);
  assert.ok(!g.saleCommit('medic',selected,q.token).ok);valid(g);
  const reloaded=boot(b.storage,b.clock).g;assert.equal(reloaded.stock('bandage'),1);assert.equal(reloaded.cashBalance(),q.after);valid(reloaded);
  const stale=g.saleQuote('medic',[group[0]]);assert.ok(stale.ok);
  assert.ok(reloaded.marketCartAdd('medic','bandage',1).ok);
  assert.ok(!g.saleCommit('medic',[group[0]],stale.token).ok);assert.equal(g.stock('bandage'),1);
  console.log('PASS selected warehouse UIDs, filtered merchants, protected contents/modules, exact physical payment, duplicate and conflicting sales, quota rollback, reload.');
}

const raidOnly=['rl_x_fabric','rl_x_mesh','rl_x_circuit','rl_x_core','rl_x_field_pack','rl_x_field_ammo'];
const outputs=['rl_x_ammo','rl_x_pack','rl_x_optic','rl_x_armor','rl_x_carbine'];
{
  const b=boot(),g=b.g;
  for(const id of raidOnly){
    const m=db.items[id];assert.ok(m.lootSources.length);let witnessed=false;
    for(let z=0;z<g.areas.length&&!witnessed;z++)for(const [i,box] of g.areas[z].boxes.entries()){
      const table=db.containers[box[2]];
      if(!m.lootSources.includes(box[2]))continue;
      const [w,h]=table.size;
      const candidates=table.itemDistribution.filter(({tpl})=>{
        const v=db.items[tpl];return v.width<=w&&v.height<=h||v.width<=h&&v.height<=w;
      });
      const index=candidates.findIndex(row=>row.tpl===id);if(index===-1)continue;
      const weight=candidates[index].relativeProbability;assert.ok(weight>0);
      const sum=rows=>rows.reduce((n,r)=>n+r.relativeProbability,0);
      const counts=table.itemcountDistribution,nonempty=counts.findIndex(row=>row.count>0);
      const countRoll=(sum(counts.slice(0,nonempty))+counts[nonempty].relativeProbability/2)/sum(counts);
      b.setRolls([countRoll,(sum(candidates.slice(0,index))+weight/2)/sum(candidates)]);
      const generated=g.makeBox(z,i);
      assert.equal(generated.items[0].g,id);witnessed=true;break;
    }
    assert.ok(witnessed,id+' must drop in a field zone');
  }
  for(const id of outputs)assert.ok(Object.values(db.containers).every(t=>t.itemDistribution.every(e=>e.tpl!==id)));
  const early=g.barterOffers('quarter');assert.deepEqual(clone(early.map(r=>r.id)),['rl_x_ammo']);
  assert.equal(g.barterOffers('repair').length,0);assert.ok(!g.barterCommit('quarter','rl_x_carbine','test').ok);
  console.log('PASS six raid-only objects generated from reachable zone containers, all five barter outputs excluded from raid rolls and unreached proposals concealed.');
}

{
  const b=seed(s=>{
    promote(s);
    for(const [id,n] of Object.entries({cloth:4,rl_x_fabric:4,rl_x_mesh:5,rl_x_circuit:6,rl_x_core:2,rl_x_field_ammo:2}))add(s,id,n);
    s.equipment.instances.primary.ammo=4;
  });
  const g=b.g,balance=g.fee,initialCash=clone(g.s.cash);
  assert.equal(g.standing('quarter').tier,4);assert.equal(g.standing('repair').tier,4);
  for(const id of [...raidOnly,...outputs]){
    for(const t of g.traders){assert.ok(!g.listed(t.id,'buy').includes(id));assert.ok(!g.trade(t.id,'buy',id).ok);assert.ok(!g.marketCartAdd(t.id,id,1).ok);}
    const before=g.stock(id);g.lookup(id);g.supply(id);g.gear({gear:'buy',id});assert.equal(g.stock(id),before);
  }
  assert.equal(g.fee,balance);
  const recipes=[...g.barterOffers('quarter'),...g.barterOffers('repair')];
  assert.equal(recipes.length,5);
  const grades=g.barterOffers('quarter').map(r=>[r.tier,r.quality,r.rarity]);
  assert.deepEqual(clone(grades.map(v=>v[2])),['일반','고급','희귀','극희귀']);
  assert.ok(grades.every((v,n)=>v[1].startsWith('Q'+(n+1))));
  for(const r of recipes){
    const trader=r.item==='rl_x_optic'?'repair':'quarter', fresh=receipt(g,trader,r.item);
    assert.ok(fresh.ok,fresh.reason);
    const before=checkEconomy(g);
    assert.ok(!quota(b,()=>g.barterCommit(trader,r.id,fresh.token)).ok);assert.equal(checkEconomy(g),before);
    const old=Object.fromEntries(fresh.requirements.map(row=>[row.item,g.stock(row.item)]));
    const result=g.barterCommit(trader,r.id,fresh.token);assert.ok(result.ok,result.message);
    for(const row of fresh.requirements)assert.equal(g.stock(row.item),old[row.item]-row.quantity);
    assert.ok(g.s.stashSlots.some(u=>u.uid===result.uid&&u.g===result.item));assert.ok(!g.barterCommit(trader,r.id,fresh.token).ok);
    assert.deepEqual(clone(g.s.cash),initialCash);valid(g);
  }
  const host=g.s.equipment.instances.primary,ammoBefore=g.stock('rl_x_ammo');
  let before=checkEconomy(g);assert.ok(!quota(b,()=>g.exchangeReload(host.uid,4,'rl_x_field_ammo')).ok);
  assert.equal(checkEconomy(g),before);
  assert.ok(g.exchangeReload(host.uid,4,'rl_x_field_ammo').ok);assert.equal(host.ammo,10);assert.equal(g.stock('rl_x_field_ammo'),1);
  assert.equal(g.stock('rl_x_ammo'),ammoBefore);assert.ok(!g.exchangeReload(host.uid,4,'rl_x_field_ammo').ok);
  assert.ok(g.exchangeReload(host.uid,10,'rl_x_ammo').ok);assert.equal(host.ammo,22);assert.equal(g.stock('rl_x_ammo'),0);
  assert.equal(g.stock('rl_x_field_ammo'),1);assert.equal(g.fee,balance);
  const unmoddedScan=g.actionDuration('scan',10000);
  let target=clone(g.presetCurrent());target.worn.primary='rl_x_carbine';target.worn.back='rl_x_pack';target.worn.armor='rl_x_armor';target.modules.primary='rl_x_optic';
  assert.ok(g.applyPreset(target).ok);
  assert.deepEqual(clone(g.kitCapacity(g.s.equipment.worn)),[6,9]);assert.equal(g.s.equipment.instances.primary.ammo,36);
  assert.equal(g.s.equipment.instances.primary.module,'rl_x_optic');assert.equal(g.stock('rl_x_optic'),0);
  assert.ok(Math.abs(g.actionDuration('scan',10000)-unmoddedScan*0.9)<=1);
  valid(g);
  g.start();assert.equal(g.s.field.worn.primary,'rl_x_carbine');assert.equal(g.s.field.modules.primary,'rl_x_optic');assert.equal(g.gearAttackBonus(),6);assert.equal(g.gearDefenseBonus(),6);valid(g);
  assert.ok(!g.exchangeReload(g.s.field.instances.primary.uid,36,'rl_x_field_ammo').ok);
  const back=boot(b.storage,b.clock).g;assert.equal(back.s.field.instances.primary.module,'rl_x_optic');valid(back);
  console.log('PASS all 5 real recipes and physical reward UIDs, tiered qualities, CR/cart/catalog/kit restrictions at top standing, exact inputs, quota rollback, attached module, larger back slot, armor and carbine bonuses, distinct 6-/12-round supplies.');
}
{
 const b=seed(s=>{
   promote(s);
   for(let y=0;y<32;y++)for(let x=0;x<6;x++){
     let g=y===0&&[0,2,4].includes(x)?'rl_x_circuit':y===2&&[0,2].includes(x)?'rl_x_core':'bolt';
     s.stashSlots.push({g,uid:'s-grid-'+x+'-'+y,x,y,w:1,h:1});s.stash[g]=(s.stash[g]||0)+1;
   }
 });
 const g=b.g,q=receipt(g,'quarter','rl_x_carbine'),old=checkEconomy(g);
 assert.match(q.reason,/빈칸/);assert.ok(!g.barterCommit('quarter',q.id,q.token).ok);assert.equal(checkEconomy(g),old);
 console.log('PASS full warehouse with isolated freed cells rejects a barter, preserving every ingredient and CR.');
}

{
  const b=seed(s=>{add(s,'rl_x_field_pack');}),g=b.g;
  g.gear({gear:'wear-stash',id:'rl_x_field_pack',unit:g.s.stashSlots[0].uid});
  assert.equal(g.stock('rl_x_field_pack'),0);assert.deepEqual(clone(g.kitCapacity(g.s.equipment.worn)),[6,7]);valid(g);
  assert.equal(g.caseAllowed('rs_case_weapon','rl_x_carbine'),true);assert.equal(g.caseAllowed('rs_case_weapon_large','rl_x_optic'),true);
  const full=seed(s=>{
    s.equipment.worn.back='rl_x_pack';s.equipment.worn.support='rl_13_16';
    for(let y=0;y<10;y++)for(let x=0;x<6;x++)
      s.equipment.bag.push({uid:'s-carried-'+x+'-'+y,g:'bandage',x,y,w:1,h:1,revealed:true});
  }).g;
  assert.equal(full.s.equipment.bag.length,60);valid(full);
  console.log('PASS recovered patrol pack equips with 42 cells, new weapons and modules fit existing weapon cases, a reinforced 60-cell loadout survives backup validation.');
}
