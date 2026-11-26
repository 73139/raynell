// Real field generator, search, transfer, settlement, facility and consumable entry points.
const {assert,boot,clone,epoch,extract,finish,go,stamp,v12,valid}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const sheet='rl_bp_dressing',dressing='rl_craft_dressing',recipe='folded-dressing';
function quota(b,op){const set=b.storage.set;b.storage.set=()=>{throw Error('quota');};try{op();}finally{b.storage.set=set;}}
const register=(g,uid)=>g.build({id:'med',hideout:'manual-register',uid});
const craft=g=>g.build({id:'med',hideout:'produce',recipe});
const sheets=g=>g.s.stashSlots.filter(u=>u.g===sheet);
const state=g=>JSON.stringify({stash:g.s.stash,slots:g.s.stashSlots,manual:g.s.hideout.wardManual,jobs:g.s.hideout.production,cash:g.s.cash});
function base(){
 const s=clone(boot().g.s);delete s.hideout.wardManual;s.hideout.levels.power=1;s.hideout.levels.water=1;s.hideout.levels.med=1;
 const b=boot({[v12]:s});
 assert.ok(b.g.trade('medic','buy','gauze',1).ok && b.g.trade('medic','buy','bandage',1).ok);
 assert.equal(b.g.fee,21500);valid(b.g);return b;
}
function carried(n=1){
 const b=base(),g=b.g;b.setRandom(.999999);g.start();b.setRandom(.1);
 go(b,'landmark',{index:7});go(b,'scan');finish(b);go(b,'open',{index:14});
 const box=g.s.field.boxes['0-14'],items=clone(box.items.slice(0,n));
 assert.equal(items.length,n);assert.ok(items.every(u=>u.g===sheet && !u.revealed && u.sheetUid.startsWith('s-')));
 assert.doesNotMatch(g.readField(),/작업지침|rl_bp_dressing|ward-manual/);
 g.selectLoot(items[0].uid);assert.equal(g.s.field.bag.length,0);
 assert.equal(g.searchOwned('작업지침').length,0);
 for(const tile of items){
   go(b,'search',{uid:tile.uid});finish(b);
   assert.match(g.readField(),/야전 처치포 작업지침/);
   g.selectLoot(tile.uid);
   assert.ok(g.s.field.bag.some(u=>u.g===sheet && u.uid===tile.sheetUid));
   assert.ok(!g.s.field.boxes['0-14'].items.some(u=>u.uid===tile.uid));
 }
 valid(g);go(b,'close');
 return {b,g,ids:items.map(u=>u.sheetUid)};
}
{
 const b=base(),g=b.g;
 const available=Object.entries(db.containers).filter(([,box])=>box.itemDistribution.some(row=>row.tpl===sheet)).map(([id])=>id).sort();
 assert.deepEqual(available,['desk','med']);
 for(const type of available){
   const index=g.areas.map((area,z)=>[z,area.boxes.findIndex(box=>box[2]===type)]).find(([,i])=>i>=0);
   const rows=db.containers[type].itemDistribution,summed=rows.reduce((v,r)=>v+r.relativeProbability,0);
   const win=rows.find(r=>r.tpl===sheet).relativeProbability/summed;
   b.setRolls([.5,1-win/2]);assert.equal(g.makeBox(...index).items[0].g,sheet);
   b.setRolls([.5,Math.max(0,1-win-.001)]);assert.notEqual(g.makeBox(...index).items[0].g,sheet);
   console.log('PASS reachable '+type+' drop boundary '+(100*win).toFixed(2)+'% for first fitting draw.');
 }
 assert.ok(Object.values(db.containers).every(box=>box.itemDistribution.every(row=>row.tpl!==dressing)));
 assert.ok(!g.facilityProductionPanel('med').includes('data-recipe="'+recipe+'"'));
 craft(g);assert.ok(!g.s.hideout.production.med);
 for(const id of [sheet,dressing]){
   assert.ok(g.traders.every(t=>!g.trade(t.id,'buy',id,1).ok && !g.marketCartAdd(t.id,id,1).ok));
   assert.ok(g.traders.every(t=>!g.barterOffers(t.id).some(row=>row.item===id)));
 }
}
{
 const {b,g,ids}=carried(2);
 go(b,'extract',{exit:'b04'});const end=g.s.field.action.end;
 quota(b,()=>stamp(b,end));
 assert.equal(g.s.field.result,null);assert.equal(g.s.field.bag.filter(u=>u.g===sheet).length,2);assert.equal(g.stock(sheet),0);
 g.tick();assert.equal(g.s.field.result,'success');assert.deepEqual(clone(sheets(g).map(u=>u.uid)),ids);
 assert.equal(g.searchOwned('작업지침').filter(r=>r.kind==='stash').length,2);
 register(g,ids[0]);assert.equal(g.s.hideout.wardManual.registered,false);
 g.ack();const before=state(g);quota(b,()=>register(g,ids[1]));assert.equal(state(g),before);
 // Move the same printed sheet through the existing preparation bag.
 g.gear({gear:'pack',id:sheet,unit:ids[0]});assert.equal(g.s.equipment.bag[0].uid,ids[0]);
 g.gear({gear:'select',unit:ids[0]});g.gear({gear:'unpack'});assert.ok(sheets(g).some(u=>u.uid===ids[0]));
 const boxSave=clone(g.s),caseId='rs_case_docs',[,cw,ch]=g.goods[caseId];
 boxSave.stash[caseId]=1;boxSave.stashSlots.push({uid:'s-sheet-case',g:caseId,w:cw,h:ch,x:0,y:12});
 const c=boot({[v12]:boxSave},b.clock),chosen=sheets(c.g).at(-1).uid;
 assert.ok(c.g.caseMove('s-sheet-case','put',sheet).ok);
 assert.equal(c.g.searchOwned('작업지침').find(row=>row.kind==='case').uid,chosen);
 register(c.g,chosen);assert.ok(!c.g.s.hideout.wardManual.registered,'shelved copy must be taken out before registration');
 assert.ok(c.g.caseMove('s-sheet-case','take',chosen).ok);
 assert.ok(sheets(c.g).some(u=>u.uid===chosen));valid(c.g);
 const rival=boot(b.storage,b.clock);
 register(g,ids[1]);assert.equal(g.s.hideout.wardManual.registered,false,'stale registration must restore winning session');
 register(rival.g,ids[1]);assert.equal(rival.g.s.hideout.wardManual.registered,true);
 assert.deepEqual(clone(sheets(rival.g).map(u=>u.uid)),[ids[0]]);
 const same=state(rival.g);register(rival.g,ids[0]);assert.equal(state(rival.g),same);
 const sell=rival.g.saleQuote('quarter',[ids[0]]);assert.equal(sell.total,600);
 assert.ok(rival.g.saleCommit('quarter',[ids[0]],sell.token).ok);
 const r=boot(b.storage,b.clock),prior=state(r.g);quota(r,()=>craft(r.g));assert.equal(state(r.g),prior);
 assert.match(r.g.facilityProductionPanel('med'),/체력 \+31/);craft(r.g);
 assert.equal(r.g.stock('bandage')+r.g.stock('gauze'),0);assert.equal(r.g.s.hideout.production.med.recipe,recipe);
 const deadline=r.g.s.hideout.production.med.end;assert.equal(deadline,r.clock.now+120000);craft(r.g);
 const conflict=boot(b.storage,b.clock);assert.equal(conflict.g.s.hideout.production.med.end,deadline);
 stamp(r,deadline-1);assert.equal(r.g.stock(dressing),0);
 r.clock.now=deadline;r.g.prepare();assert.equal(r.g.stock(dressing),0,'stale worker must not replace winning tab');
 quota(conflict,()=>conflict.g.prepare());assert.equal(conflict.g.stock(dressing),0);assert.equal(conflict.g.s.hideout.production.med.end,deadline);
 conflict.g.tick();assert.equal(conflict.g.stock(dressing),1);assert.ok(!conflict.g.s.hideout.production.med);const w=conflict.g.fee;
 const capped=clone(conflict.g.s);
 capped.stash[dressing]=Number.MAX_SAFE_INTEGER;capped.hideout.production.med={recipe,end:deadline};
 const maxed=boot({[v12]:capped},b.clock);assert.equal(maxed.g.s.hideout.production.med.end,deadline);
 assert.equal(maxed.g.stock(dressing),Number.MAX_SAFE_INTEGER,'a saturated stock must preserve the outstanding job');
 const after=boot(b.storage,b.clock);after.g.tick();assert.equal(after.g.stock(dressing),1);assert.equal(after.g.fee,w);
 assert.deepEqual(clone(after.g.kitSupply(dressing)),{stat:'hp',gain:31,label:'체력'});valid(after.g);
 // The new product is useful on an actual sortie, and a second use cannot consume another charge.
 after.g.gear({gear:'pack',id:dressing});after.g.start();
 const injured=clone(after.g.s);injured.field.hp=42;
 const tested=boot({[v12]:injured},after.clock),uid=tested.g.s.field.bag.find(u=>u.g===dressing).uid;
 tested.g.gear({gear:'consume',unit:uid});assert.equal(tested.g.s.field.hp,73);tested.g.gear({gear:'consume',unit:uid});assert.equal(tested.g.s.field.hp,73);
 assert.ok(!tested.g.s.field.bag.some(u=>u.g===dressing));valid(tested.g);
 console.log('PASS hidden original, exact warehouse UID, copy-specific registration and resale, concurrency/quota across return/registration/start/completion, 120 s clock, single award and one real +31 HP field use.');
}
{
 const {b,g,ids}=carried();go(b,'abandon');assert.equal(g.s.field.result,'abandoned');assert.equal(g.stock(sheet),0);
 assert.ok(!g.searchOwned('작업지침').length);assert.deepEqual(clone(g.s.hideout.wardManual),{registered:false,waiting:[]});
 register(g,ids[0]);valid(g);
 const other=carried(),s=clone(other.g.s);
 s.stash={cloth:192};s.stashSlots=Array.from({length:192},(_,i)=>({uid:'s-wrap-'+i,g:'cloth',x:i%6,y:Math.floor(i/6),w:1,h:1}));
 const full=boot({[v12]:s},other.b.clock),uid=other.ids[0];valid(full.g);extract(full);full.g.ack();valid(full.g);
 assert.equal(full.g.stock(sheet),0);assert.deepEqual(clone(full.g.s.hideout.wardManual.waiting),[uid]);
 assert.deepEqual(clone(full.g.searchOwned('작업지침').map(r=>[r.kind,r.uid])),[['manual',uid]]);
 const reload=boot(full.storage,full.clock);const rs=state(reload.g);
 reload.g.build({id:'med',hideout:'manual-receive',uid});assert.equal(state(reload.g),rs);
 const pending=clone(reload.g.s);
 const direct=boot({[v12]:pending},full.clock);register(direct.g,uid);assert.ok(direct.g.s.hideout.wardManual.registered && !direct.g.s.hideout.wardManual.waiting.length);
 const sale=reload.g.saleQuote('supply',['s-wrap-0']);assert.ok(reload.g.saleCommit('supply',['s-wrap-0'],sale.token).ok);
 reload.g.build({id:'med',hideout:'manual-receive',uid});assert.equal(reload.g.stock(sheet),1);
 assert.deepEqual(clone(sheets(reload.g)[0]),{uid,g:sheet,x:0,y:0,w:1,h:1});
 assert.equal(reload.g.s.hideout.wardManual.waiting.length,0);valid(reload.g);
 const inv=clone(reload.g.s);inv.hideout.wardManual.waiting.push(uid);
 assert.equal(reload.g.check({format:'rustline-tc01',session:inv}),false);
 inv.hideout.wardManual.waiting=[];inv.hideout.production.med={recipe,end:epoch+120000};assert.equal(reload.g.check({format:'rustline-tc01',session:inv}),false);
 console.log('PASS abandon/loss and zero unlock, full 192-cell warehouse waits without duplication, direct register or exact-UID transfer to a freed cell, malformed save rejection.');
}
