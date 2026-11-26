// The previous client's storage key stays readable and cannot overwrite the new generation.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const source=require('./fixtures/objective-cart-active-v29.json').session;
const priorKey='rl-reboot-session-v29';
const persisted=new Map([[priorKey,JSON.stringify(source)]]);
const oldBytes=persisted.get(priorKey);
const clock={now:source.raid.startedAt+1000};
const current=boot(persisted,clock),first=clone(current.g.s);
assert.equal(first.version,36);
for(const key of ['wallet','stash','stashSlots','cash','marketCarts','objectivePin','raid']){
  assert.deepEqual(first[key],source[key],key+' survives first opening');
}
valid(current.g);
assert.equal(persisted.get(priorKey),oldBytes);
assert.ok(persisted.has(v12));
const olderTab=clone(source);olderTab.objectivePin=null;olderTab.revision+=10;
persisted.set(priorKey,JSON.stringify(olderTab));
const reopened=boot(persisted,clock);
assert.deepEqual(clone(reopened.g.s.objectivePin),source.objectivePin);
assert.deepEqual(clone(reopened.g.s.cash),source.cash);
assert.equal(JSON.parse(persisted.get(priorKey)).revision,olderTab.revision);
const failed=new Map([[priorKey,oldBytes]]);failed.set=()=>{throw Error('quota')};
boot(failed,clock);assert.equal(failed.get(priorKey),oldBytes);assert.equal(failed.has(v12),false);
delete failed.set;const retry=boot(failed,clock);valid(retry.g);assert.equal(retry.g.s.wallet,source.wallet);assert.ok(failed.has(v12));
console.log('PASS untouched previous save, real v29 raid migrated to v36, old-tab isolation, quota failure and clean retry.');

// The v0.33 release exported this schema-32 player checkpoint after commerce,
// a recovered and registered clinic sheet, two cash transfers and starting a job.
const {stamp}=require('./game-fixture.cjs');
const previous32='rl-reboot-session-v32';
const shipped33=require('./fixtures/ward-market-v33.json');
const s33=shipped33.session,bytes33=JSON.stringify(s33);
const job=s33.hideout.production.med;
const totalBanknotes=s=>[...s.cash.pocket,...s.stashSlots,...s.equipment.bag]
  .filter(u=>u.g==='cr_notes').reduce((total,u)=>total+u.amount,0);
const conserved=['wallet','cash','marketCarts','saleReceipts','stashSlots','stash','equipment','career','lastSummary','hideout'];
assert.equal(s33.version,32);
assert.equal(s33.marketCarts.traders.medic.receipt.total,13000);
assert.equal(s33.saleReceipts.medic.total,2250);
assert.equal(s33.marketCarts.traders.repair.items[0].item,'wire');
assert.ok(s33.hideout.wardManual.registered);
assert.equal(job.recipe,'folded-dressing');
assert.equal(s33.stashSlots.filter(u=>u.g==='rl_bp_dressing').length,1);
assert.equal(s33.wallet,18250);
assert.equal(totalBanknotes(s33),19250);
const mixed=new Map([[priorKey,oldBytes],[previous32,bytes33]]);
const during={now:job.end-119000};
const upgraded=boot(mixed,during);
assert.equal(upgraded.g.s.version,36);
assert.ok(upgraded.g.check(shipped33),'the original schema-32 backup remains importable');
for(const k of conserved){
  const expected=k==='hideout'?{...s33[k],wardTrial:null}:s33[k];
  assert.deepEqual(clone(upgraded.g.s[k]),expected,k+' survives the v33 checkpoint');
}
assert.equal(mixed.get(previous32),bytes33);
assert.equal(mixed.get(priorKey),oldBytes);
const note=upgraded.g.s.cash.pocket[0].uid;
assert.ok(upgraded.g.cashAction(note,'bag',250).ok);
stamp(upgraded,job.end);
const settled=clone(upgraded.g.s);
assert.equal(settled.stash.rl_craft_dressing,1);
assert.equal(settled.hideout.production.med,undefined);
assert.equal(settled.wallet,18000);assert.equal(totalBanknotes(settled),19250);
assert.ok(upgraded.g.marketCartCheckout('medic',s33.marketCarts.traders.medic.receipt.token).replayed);
const settledBytes=mixed.get(v12);
for(const [key,s] of [[priorKey,source],[previous32,s33]]){
  const stale=clone(s);stale.revision+=1000;
  mixed.set(key,JSON.stringify(stale));
}
assert.equal(mixed.get(v12),settledBytes);
const resumed=boot(mixed,during);
assert.equal(resumed.g.s.version,36);valid(resumed.g);
for(const k of conserved)assert.deepEqual(clone(resumed.g.s[k]),settled[k],k+' survives stale v32 and v29 writes');
assert.equal(resumed.g.s.stash.rl_craft_dressing,1);
const quota32=new Map([[priorKey,oldBytes],[previous32,bytes33]]);
quota32.set=()=>{throw Error('quota')};
boot(quota32,{now:job.end-119000});
assert.equal(quota32.get(priorKey),oldBytes);assert.equal(quota32.get(previous32),bytes33);assert.ok(!quota32.has(v12));
delete quota32.set;
const retried=boot(quota32,{now:job.end-119000});valid(retried.g);
assert.deepEqual(clone(retried.g.s.marketCarts),s33.marketCarts);
console.log('PASS genuine v33 schema 32 wins over v29; physical banknote UIDs, two merchant receipts, repair draft, registered manual and pending job survive v36 migration. Old writers cannot roll back cash or duplicate completion. Both source bytes survive quota and retry.');

// The genuine v0.55 export is a live sortie with the pump answer, the old
// clinic job, physical cash, and the market records restored through its UI.
const shipped55=require('./fixtures/pump-gauge-v55.json');
const previous34='rl-reboot-session-v34',s55=shipped55.session;
const v55Bytes=JSON.stringify(s55);
assert.equal(s55.version,34);
assert.equal(s55.career.order,'pump-gauge');
assert.equal(s55.objectivePin.id,'pump-gauge');
assert.ok(s55.field.pumpGauge.answer);
const sourceKeys=new Map([[previous34,v55Bytes],[previous32,bytes33],[priorKey,oldBytes]]);
const clock55={now:s55.field.pumpGauge.readAt+500};
const interrupted=new Map(sourceKeys);
const normalSet=interrupted.set.bind(interrupted);
interrupted.set=(key,value)=>{if(key===v12)throw Error('full disk');return normalSet(key,value);};
boot(interrupted,clock55);
assert.equal(interrupted.has(v12),false);
for(const [key,value] of sourceKeys)assert.equal(interrupted.get(key),value);
delete interrupted.set;
const recovered=boot(interrupted,clock55);
const changedOnlyHeader=s=>{const data=clone(s);delete data.version;delete data.revision;delete data.writerBuild;return data;};
assert.equal(recovered.g.s.version,36);
assert.deepEqual(changedOnlyHeader(recovered.g.s),changedOnlyHeader(s55));
assert.equal(recovered.g.check(shipped55),true);
valid(recovered.g);
const v36Bytes=interrupted.get(v12),stable34=interrupted.get(previous34);
const unrelated=clone(s55);unrelated.career.order=null;unrelated.objectivePin=null;
unrelated.revision+=50;interrupted.set(previous34,JSON.stringify(unrelated));
assert.equal(interrupted.get(v12),v36Bytes);

const retry35=boot(interrupted,clock55);
assert.deepEqual(changedOnlyHeader(retry35.g.s),changedOnlyHeader(s55));
const simultaneous=boot(interrupted,clock55); // Simulates a lock-less writer at a newer disk revision.
const winningBytes=interrupted.get(v12);
assert.equal(retry35.g.pin(null),false);
assert.equal(interrupted.get(v12),winningBytes);
assert.equal(retry35.g.s.objectivePin.id,'pump-gauge');
assert.equal(stable34,v55Bytes);
stamp(simultaneous,s55.hideout.production.med.end+50);
const paid=simultaneous.g.s;
assert.ok(!paid.hideout.production.med);
assert.equal(paid.stash.rl_craft_dressing,(s55.stash.rl_craft_dressing||0)+1);
assert.equal(paid.wallet,s55.wallet);
const next35=boot(interrupted,clock55);
assert.equal(next35.g.s.stash.rl_craft_dressing,paid.stash.rl_craft_dressing);
assert.equal(next35.g.s.field.pumpGauge.answer,s55.field.pumpGauge.answer);
console.log('PASS v0.55 source bytes preserved on failed and retried v36 migration; full live raid, answer/pin, wallet, receipt and production checkpoint preserved; legacy writer and same-generation revision conflict are isolated, due job credits once.');
