const {assert,boot,clone,epoch,extract,finish,go,move,stamp,v12,valid}=require('./game-fixture.cjs');

function fresh(items=['flash','rl10_vest']){
  const base=boot(),s=clone(base.g.s);
  s.career.surveyedBoxes=['2-3','2-4','2-8'];
  s.equipment.bag=items.map((g,i)=>{
    const u=base.g.unit(g);u.x=i*2;u.uid='kit-cache-'+i;
    if(g==='flash'){u.gear.durability=57;u.gear.module='battery';}
    return u;
  });
  const b=boot({[v12]:s},{now:epoch});
  launch(b);return b;
}
function launch(b,zone=2){
  if(b.g.s.raid)b.g.ack();
  b.g.moveNow(zone);b.clock.now+=1000;b.g.start();
  if(zone===2)go(b,'landmark',{index:1});
}
function ctl(b,field,u=b.g.s.dockCache?.unit){
  return {field:'dock-'+field,uid:u.uid,gearUid:u.gear.uid,raidId:String(b.g.s.raid.startedAt)};
}
function stored(b){return b.g.s.dockCache?.unit?.gear;}
function reserve(b,u=b.g.s.field.bag[0]){b.g.field(ctl(b,'deposit',u));assert.deepEqual(clone(stored(b)),clone(u.gear));}
function book(b){extract(b,'lift');assert.equal(b.g.s.dockCache.stage,'ready');valid(b.g);}
function quota(b,fn){
  const write=b.storage.set;b.storage.set=()=>{throw Error('quota');};
  try{fn();}finally{b.storage.set=write;}
}
function invalid(b,change){
  const s=clone(b.g.s);change(s);assert.equal(b.g.check({format:'rustline-tc01',session:s}),false);
}

async function check(){
  const heavy=fresh(['rl10_vest','rl10_vest']);assert.match(heavy.g.readField(),/0.200 kg 초과 · 아래 도크 인수함/);
  go(heavy,'landmark',{index:0});assert.doesNotMatch(heavy.g.readField(),/아래 도크 인수함/);
  const b=fresh();const u=clone(b.g.s.field.bag[0]),initial=clone(b.g.s);
  assert.match(b.content(),/내구도 57\/100/);assert.ok(b.content().includes(u.gear.uid.slice(-8)));
  const deposit=ctl(b,'deposit',u);
  for(const wrong of [{gearUid:'wrong'},{raidId:'0'},{uid:'stale'}]){
    b.g.field({...deposit,...wrong});assert.deepEqual(clone(b.g.s),initial);
  }
  quota(b,()=>b.g.field(deposit));assert.deepEqual(clone(b.g.s),initial);
  reserve(b);b.g.field(deposit);assert.equal(b.g.s.field.bag.length,1);valid(b.g);
  const cancel=ctl(b,'cancel');quota(b,()=>b.g.field(cancel));assert.ok(stored(b));
  const current=clone(b.g.s);
  const modified=boot({[v12]:current},b.clock);
  modified.g.field(ctl(modified,'cancel'));assert.deepEqual(clone(modified.g.s.field.bag[1].gear),u.gear);
  modified.g.field(cancel);assert.equal(modified.g.s.field.bag.length,2);
  invalid(b,s=>s.field.bag.push({...s.dockCache.unit,x:0,y:0}));
  invalid(b,s=>s.dockCache.unit.contents=[s.field.bag[0]]);
  invalid(b,s=>{s.dockCache.unit.uid=s.field.boxes['0-0'].items[0].uid;});
  invalid(b,s=>s.dockCache.depositRaidId++);invalid(b,s=>s.dockCache.stage='ready');
  const observer=boot({[v12]:current},b.clock,{locks:{request:()=>Promise.resolve()}});
  observer.g.field(ctl(observer,'cancel'));assert.deepEqual(clone(observer.g.s.dockCache),current.dockCache);
  // One equipment serial may appear in a usage row as well as in its dock location.
  const used=clone(current);
  used.field.gearUsage=[{uid:u.gear.uid,g:u.g,ammoBefore:0,durabilityBefore:58,ammoUsed:0,wear:1}];
  const ledger=boot({[v12]:used},b.clock);valid(ledger.g);book(ledger);
  assert.equal(ledger.g.s.lastSummary.gearReport.find(r=>r.uid===u.gear.uid).durabilityBefore,58);

  go(b,'extract',{exit:'lift'});const due=b.g.s.field.action.end;
  quota(b,()=>stamp(b,due));assert.equal(b.g.s.dockCache.stage,'pending');assert.equal(b.g.s.field.result,null);
  stamp(b,due);assert.equal(b.g.s.dockCache.stage,'ready');valid(b.g);
  assert.equal(b.g.s.lastSummary.gearReport.find(r=>r.uid===u.gear.uid).disposition,'stored');
  assert.deepEqual(clone(b.g.s.lastSummary.goods),['rl10_vest']);assert.equal(b.g.s.lastSummary.dockCacheOutcome,'booked');
  invalid(b,s=>delete s.dockCache);
  invalid(b,s=>s.dockCache.unit.gear.durability++);
  invalid(b,s=>s.dockCache.unit.gear.module=null);
  b.g.ack();valid(b.g);assert.equal(b.g.s.dockCache.stage,'ready');
  const ready=clone(b.g.s);
  quota(b,()=>launch(b));assert.equal(b.g.s.dockCache.stage,'ready');assert.equal(b.g.s.raid,null);
  launch(b,0);const claim=ctl(b,'claim');b.g.field(claim);assert.ok(stored(b));
  move(b,2);go(b,'landmark',{index:1});valid(b.g);
  const claimable=clone(b.g.s);const cold=boot({},b.clock);
  await cold.g.importFile(new Blob([JSON.stringify(await b.exportData())]));
  assert.equal(cold.g.s.dockCache.claimRaidId,b.g.s.raid.startedAt);valid(cold.g);
  const retry=boot({[v12]:claimable},b.clock);quota(retry,()=>retry.g.field(ctl(retry,'claim')));
  assert.deepEqual(clone(stored(retry)),u.gear);assert.equal(retry.g.s.field.bag.length,0);
  // A newer writer wins even if the old tab tries to claim the same item.
  const rival=boot(b.storage,b.clock);rival.g.field(ctl(rival,'claim'));
  b.g.field(claim);assert.equal(b.g.s.dockCache,undefined);assert.equal(b.g.s.field.bag.length,1);
  b.g.field(claim);const recovered=b.g.s.field.bag[0];
  assert.notEqual(recovered.uid,u.uid);assert.deepEqual(clone(recovered.gear),u.gear);valid(b.g);
  extract(b,'lift');assert.equal(b.g.s.stash.flash,1);assert.equal(b.g.s.stashSlots.find(i=>i.g==='flash').gear.uid,u.gear.uid);
  assert.equal(b.g.s.career.sorties,2);valid(b.g);

  // Existing saves can have a formerly looted tile in the pack while its source slot is present again.
  const legacyTile=clone(initial);legacyTile.field.bag[0].uid=legacyTile.field.boxes['0-0'].items[0].uid;
  const older=boot({[v12]:legacyTile},b.clock);reserve(older);valid(older.g);
  assert.notEqual(older.g.s.dockCache.unit.uid,legacyTile.field.bag[0].uid);
  // A fresh local field container can reuse a previous sortie's tile ID, but never its serial.
  const collision=clone(claimable);collision.field.bag=[{...b.g.unit('water'),uid:u.uid,x:0,y:0}];
  const other=boot({[v12]:collision},b.clock);other.g.field(ctl(other,'claim'));valid(other.g);
  assert.equal(new Set(other.g.s.field.bag.map(i=>i.uid)).size,2);
  for(const outcome of ['alternative','expired','kia','abandoned','quick']){
    const q=boot({[v12]:current},{now:current.raid.startedAt+1000});
    if(outcome==='alternative'){move(q,0);extract(q);}
    if(outcome==='expired')stamp(q,q.g.s.raid.endsAt);
    if(outcome==='abandoned')go(q,'abandon');
    if(outcome==='kia'){
      const near=clone(q.g.s);near.field.hp=1;near.field.energy=0;near.field.nextContact=99;
      const dying=boot({[v12]:near},q.clock);go(dying,'scan');finish(dying);
      assert.equal(dying.g.s.lastSummary.rating,'kia');assert.equal(dying.g.s.dockCache,undefined);valid(dying.g);continue;
    }
    if(outcome==='quick'){book(q);assert.equal(q.g.s.lastSummary.rating,'quick');continue;}
    assert.equal(q.g.s.dockCache,undefined);assert.equal(q.g.s.lastSummary.dockCacheOutcome,'forfeited');valid(q.g);
  }
  const expire=boot({[v12]:ready},{now:due+1000});launch(expire,0);extract(expire);
  assert.equal(expire.g.s.dockCache,undefined);assert.equal(expire.g.s.lastSummary.dockCacheOutcome,'expired');
  launch(expire);assert.equal(expire.g.s.dockCache,undefined);valid(expire.g);
  const space=clone(claimable);space.field.worn={};space.field.instances={};space.field.modules={};
  space.field.bag=Array.from({length:6},(_,i)=>({...b.g.unit('bandage'),x:i%3,y:Math.floor(i/3)}));
  const full=boot({[v12]:space},b.clock);full.g.field(ctl(full,'claim'));assert.equal(full.g.s.dockCache.stage,'claimable');
  assert.ok(full.g.readField().includes('빈 칸을 가방에 마련하세요'));valid(full.g);
  console.log('PASS: two-sortie dock booking, physical serial/module/wear, profile and writer rejection, full bag, all outcomes, quota and retry, once-only receipt.');
}
check().catch(error=>{console.error(error);process.exitCode=1;});
