const legacyGearShape = require('./legacy-gear-shape.js');
const fs=require('node:fs');
const {assert,boot,clone,epoch,extract,finish,go,stamp,v10,v12,valid}=require('./game-fixture.cjs');

function sortie(from=0){
  const b=boot();
  b.g.moveNow(from);
  b.g.start();
  return b;
}
function travel(b,to,rng){
  if(Array.isArray(rng))b.setRolls(rng);else b.setRandom(rng);go(b,'move',{index:to});
  assert.equal(b.g.s.field.action?.type,'travel-step');
}
function directions(){
  const matrix=[[0,1,3],[1,0,2],[3,2,0]];
  for(let from=0;from<3;from++){
    for(let to=0;to<3;to++){
      const b=sortie(from),g=b.g;
      assert.equal(g.route(from,to),matrix[from][to]);
      if(from===to){
        go(b,'move',{index:to});
        assert.equal(g.s.field.action,null);
        continue;
      }
      travel(b,to,.2);
      const start=b.clock.now,n=matrix[from][to],ms=g.routeProfile(from,to).stepMs;
      for(let i=0;i<n;i++){
        const a=g.s.field.action;
        assert.equal(a.type,'travel-step');
        assert.equal(a.start,start+i*ms);
        assert.equal(a.end,start+(i+1)*ms);
        assert.equal(g.s.raid.zone,from);
        assert.deepEqual(clone(g.s.field.visited),[from]);
        valid(g);
        stamp(b,a.end-1);
        assert.equal(g.s.field.journey.done,i);
        finish(b);
      }
      assert.equal(g.s.field.action,null);
      assert.ok(!g.s.field.journey);
      assert.equal(g.s.raid.zone,to);
      assert.deepEqual(clone(g.s.field.visited),[from,to]);
      assert.equal(b.clock.now,start+n*ms);
      valid(g);
    }
  }
  console.log('PASS: all six directed routes and self-moves; per-direction exact advertised timer; unique destination arrival and visit.');
}
function outcomesAndRest(){
  const cases=[[0,'clear'],[.64999,'clear'],[.65,'supply'],[.89999,'supply'],[.9,'contact'],[.99999,'contact']];
  for(const [roll,expected] of cases){
    const b=sortie();travel(b,1,roll);
    assert.equal(b.g.s.field.action.outcome,expected);
    b.setRandom(expected==='clear'?.9:.1);
    finish(b);
    if(expected==='clear')assert.equal(b.g.s.raid.zone,1);
    else {assert.equal(b.g.s.field.journey.event,expected);assert.equal(b.g.s.raid.zone,0);}
  }
  const b=sortie(),g=b.g;g.s.hideout.levels.rest=2;
  assert.match(g.readField(),/3칸 · 27초/);
  travel(b,2,.2);
  for(let i=0;i<3;i++){
    const a=g.s.field.action;assert.equal(a.end-a.start,9000);finish(b);
  }
  assert.equal(b.clock.now,epoch+27000);assert.equal(g.s.raid.zone,2);
  console.log('PASS: both event roll boundaries, fixed outcomes during countdown, hideout modifier in map label and every movement cell.');
}
function reloadAndDeadlines(){
  const b=sortie(),g=b.g;travel(b,2,.10);
  const start=b.clock.now, a=clone(g.s.field.action);
  for(const action of ['scan','open','landmark','extract','cancel','move','journey-pass','journey-take']){
    go(b,action,{index:1,exit:'b04'});
  }
  assert.deepEqual(clone(g.s.field.action),a);
  assert.ok(g.condition('b04'),'origin exit locked while travelling');
  go(b,'close');assert.equal(g.s.field.action.type,'travel-step');
  const rerun=boot(b.storage,{now:start+3000});
  rerun.setRandom(.1);
  assert.deepEqual(clone(rerun.g.s.field.action),a);
  stamp(rerun,start+29999);assert.equal(rerun.g.s.raid.zone,0);
  assert.equal(rerun.g.s.field.journey.done,2);
  stamp(rerun,start+30000);assert.equal(rerun.g.s.raid.zone,2);
  const check=JSON.stringify(rerun.g.s.field.visited);
  stamp(rerun,start+30100);assert.equal(JSON.stringify(rerun.g.s.field.visited),check);
  for(const extra of [0,1]){
    const end=sortie();stamp(end,end.g.s.raid.endsAt-8000-extra);
    travel(end,1,.2);stamp(end,end.g.s.raid.endsAt);
    assert.equal(end.g.s.field.result,'expired');
    assert.equal(end.g.s.raid.zone,extra?1:0);
    assert.equal(end.g.s.lastSummary.visited,extra?2:1);
    assert.ok(!end.g.s.field.journey);
  }
  console.log('PASS: restore scheduled outcome, catch up multiple elapsed cells, block origin actions, expiry at exact cell deadline and one millisecond after arrival.');
}
function supplies(){
  const b=sortie();travel(b,2,[.60,.1,.1,.1]);finish(b);
  const pending=b.g.s.field.journey;
  assert.equal(pending.done,1);assert.equal(pending.event,'supply');
  const item=pending.supply;assert.ok(item);
  assert.equal(b.g.s.field.action,null);valid(b.g);
  const r=boot(b.storage,{now:b.clock.now+60000}),g=r.g;
  assert.equal(g.s.field.journey.supply,item);
  assert.equal(g.s.field.journey.done,1);assert.equal(g.s.raid.zone,0);
  assert.ok(g.readField().includes('data-field="journey-take"'));
  const originalCount=g.s.field.bag.length;
  r.setRandom(.1);go(r,'journey-take');
  assert.equal(g.s.field.bag.length,originalCount+1);assert.equal(g.s.field.bag.at(-1).g,item);
  assert.equal(g.s.field.action.start,r.clock.now);assert.equal(g.s.field.action.end,r.clock.now+10000);
  go(r,'journey-take');assert.equal(g.s.field.bag.length,originalCount+1);
  const resume=boot(r.storage,r.clock);resume.setRandom(.2);
  valid(resume.g);finish(resume);finish(resume);assert.equal(resume.g.s.raid.zone,2);
  assert.equal(resume.g.s.field.bag.length,originalCount+1);
  // Recover the donated item using the normal return path.
  travel(resume,0,.2);stamp(resume,resume.clock.now+24000);extract(resume);
  assert.equal(resume.g.stock(item),1);valid(resume.g);
  const full=sortie();full.g.s.field.bag.length=0;
  // Fill the issued 6 × 6 pack with one-cell items before accepting road supplies.
  for(let y=0;y<6;y++)for(let x=0;x<6;x++){
    const u=full.g.unit('bandage');u.x=x;u.y=y;full.g.s.field.bag.push(u);
  }
  travel(full,1,[.75,.1]);finish(full);const fullEvent=clone(full.g.s.field.journey);
  go(full,'journey-take');assert.deepEqual(clone(full.g.s.field.journey),fullEvent);
  assert.equal(full.g.s.field.bag.length,36);
  const resupply=boot(new Map(full.storage),{now:full.clock.now});
  const rs=resupply.g.s.field, ground=clone(rs.gearGround);
  const first=rs.bag[0].uid;rs.hp=50;
  resupply.g.gear({gear:'drop',unit:first});
  assert.deepEqual(clone(rs.gearGround),ground);assert.equal(rs.bag.length,36);
  // A player can make space through normal consumable actions. The selected supply
  // has at most two cells, so release two adjacent cells in the same column.
  for(const tile of [rs.bag[0],rs.bag[6]])resupply.g.gear({gear:'consume',unit:tile.uid});
  assert.equal(rs.bag.length,34);assert.ok(rs.hp>50);
  go(resupply,'journey-take');
  assert.equal(rs.bag.at(-1).g,fullEvent.supply);
  assert.equal(resupply.g.s.raid.zone,1);assert.ok(!rs.journey);valid(resupply.g);
  go(full,'journey-pass');assert.ok(!full.g.s.field.journey);assert.equal(full.g.s.raid.zone,1);
  assert.equal(full.g.s.field.bag.length,36);valid(full.g);
  // Expiry while deciding discards the offer, never deposits it into the bunker.
  const late=sortie();travel(late,1,.75);finish(late);stamp(late,late.g.s.raid.endsAt);
  assert.equal(late.g.s.field.result,'expired');assert.ok(!late.g.s.field.journey);
  console.log('PASS: supply choice waits, no reroll on reload, one normal bag item, duplicate clicks blocked, final-cell supply, free slots exhausted, pass, expiry and extraction.');
}
function evasion(){
  const b=sortie(),g=b.g;travel(b,2,[.95,.1,.1]);finish(b);
  assert.equal(g.s.field.journey.done,1);assert.equal(g.s.field.journey.event,'contact');
  assert.ok(g.s.field.contact);const hp=g.s.field.hp,enemyHP=g.s.field.contact.hp;
  for(let i=0;i<2;i++){
    b.setRandom(.65);go(b,'evade');assert.equal(g.s.field.action.type,'evade');
    b.setRandom(.3);finish(b);
    assert.ok(g.s.field.contact);assert.equal(g.s.field.contact.hp,enemyHP);assert.equal(g.s.raid.zone,0);
    assert.equal(g.s.field.journey.done,1);assert.ok(g.s.field.hp<hp);valid(g);
  }
  b.setRandom(.6499);go(b,'evade');
  const count=g.s.field.journey.done, retainedHp=g.s.field.hp;
  const r=boot(b.storage,{now:g.s.field.action.end-10});
  r.setRandom(.10);finish(r);
  assert.ok(!r.g.s.field.contact);assert.equal(r.g.s.field.hp,retainedHp);
  assert.equal(r.g.s.field.journey.done,count);
  assert.equal(r.g.s.field.action.type,'travel-step');assert.equal(r.g.s.field.victories,0);
  finish(r);finish(r);assert.equal(r.g.s.raid.zone,2);
  const fight=sortie(1);travel(fight,0,.95);finish(fight);fight.setRandom(.2);
  for(let i=0;i<8&&fight.g.s.field.contact;i++){go(fight,'engage');finish(fight);}
  assert.equal(fight.g.s.field.victories,1);assert.equal(fight.g.s.raid.zone,0);assert.ok(!fight.g.s.field.journey);
  const lost=sortie();travel(lost,1,.95);finish(lost);lost.g.s.field.hp=1;lost.setRandom(.9);
  go(lost,'evade');finish(lost);assert.equal(lost.g.s.lastSummary.result,'kia');assert.ok(!lost.g.s.field.journey);
  const late=sortie();travel(late,1,.95);finish(late);late.setRandom(.1);
  stamp(late,late.g.s.raid.endsAt-2000);go(late,'evade');finish(late);
  assert.equal(late.g.s.field.result,'expired');assert.equal(late.g.s.raid.zone,0);
  assert.equal(late.g.s.lastSummary.visited,1);assert.ok(!late.g.s.field.journey);
  console.log('PASS: failed flight at 65% threshold, repeated failures, saved flight success at 64.99%, resumption, final-cell victory and KIA.');
}
function landmarks(){
  for(let z=0;z<3;z++){
    const b=boot(),g=b.g,places=g.places[z],count=[10,8,5][z];
    const [trader,keyId]=[['supply','rl_16_14'],['medic','rl_16_19'],['quarter','rl_16_01']][z];
    assert.ok(g.trade(trader,'buy',keyId).ok);
    g.gear({gear:'wear-stash',id:keyId});g.moveNow(z);g.start();b.setRandom(.1);
    assert.equal(places.length,count);assert.equal(new Set(places.map(q=>q.name)).size,count);
    const unique=places.flatMap(q=>q.boxes);assert.equal(unique.length,count*2);
    assert.equal(new Set(unique).size,unique.length);assert.deepEqual(unique.slice().sort((a,b)=>a-b).join(),Array.from({length:count*2},(_,i)=>i).join());
    for(let i=0;i<count;i++){
      go(b,'landmark',{index:i});
      assert.equal(g.s.field.landmarkByZone[z],i);
      for(const index of places[i].boxes){
        // Separate zone scanning from its existing combat schedule in this test.
        g.s.field.nextContact=999;
        go(b,'scan');assert.equal(g.s.field.action.type,'scan');finish(b);
        assert.ok(g.s.field.found[z].includes(index));
        if(g.lootBoxIsLocked(z,index))assert.ok(g.unlockLootBox(g.s.raid.startedAt,z,index).ok);
        else go(b,'open',{index});
        assert.equal(g.s.field.open,z+'-'+index);
        go(b,'search');while(g.s.field.action)finish(b);
        assert.equal(g.s.field.boxes[z+'-'+index].complete,true);go(b,'close');
      }
      go(b,'scan');assert.ok(!g.s.field.action);
      if(i>0){go(b,'open',{index:places[0].boxes[0]});assert.equal(g.s.field.open,null);}
    }
    assert.equal(g.s.field.found[z].length,count*2);valid(g);
    const r=boot(b.storage,b.clock);assert.equal(r.g.s.field.landmarkByZone[z],count-1);
    const loot=JSON.stringify(r.g.s.field.boxes);
    go(r,'landmark',{index:0});go(r,'open',{index:places[0].boxes[0]});go(r,'close');
    assert.equal(JSON.stringify(r.g.s.field.boxes),loot);
  }
  console.log('PASS: 10/8/5 unique selectable landmarks, all 46 distinct containers scanned/searched, wrong-landmark access blocked, revisit and restore retain loot.');
}
async function migrate(){
  // This is an actual v0.10 export snapshot taken after acquiring an item and starting an 8-second move.
  const old=JSON.parse(fs.readFileSync('tests/fixtures/active-v10.json','utf8'));
  let grant;
  const wait=boot({[v10]:old},{now:old.field.action.end-1},{locks:{request:(key,callback)=>{
    assert.equal(key,v10);grant=callback;return new Promise(()=>{});
  }}});
  assert.equal(wait.g.w,false);assert.equal(wait.storage.has(v12),false);
  stamp(wait,old.field.action.end+1);assert.equal(wait.g.s.raid.zone,0);
  grant();assert.equal(wait.g.w,true);assert.equal(wait.g.s.raid.zone,2);
  assert.equal(wait.storage.get(v10),JSON.stringify(old));assert.ok(wait.storage.has(v12));
  const b=boot({[v10]:old},{now:old.field.action.end-1}),g=b.g;
  assert.ok(b.storage.has(v12));assert.equal(b.storage.get(v10),JSON.stringify(old));
  assert.equal(g.check({format:'rustline-tc01',session:clone(old)}),true);
  for(const [key,box] of Object.entries(old.field.boxes))assert.deepEqual(clone(g.s.field.boxes[key]),box);
  assert.equal(g.s.wallet,old.wallet);assert.deepEqual(legacyGearShape(g.s.field.bag),old.field.bag);
  assert.equal(g.s.field.action.type,'move');assert.equal(g.s.raid.zone,0);
  stamp(b,old.field.action.end);assert.equal(g.s.raid.zone,2);assert.ok(!g.s.field.journey);valid(g);
  const restored=boot({}, {now:old.field.action.end-100});
  await restored.g.importFile(new Blob([JSON.stringify({format:'rustline-tc01',session:old})]));
  assert.equal(restored.g.s.field.action.type,'move');
  finish(restored);assert.equal(restored.g.s.raid.zone,2);valid(restored.g);
  const opened=clone(old);opened.field.action=null;opened.field.open='0-5';opened.field.found[0]=[0,1,2,3,4,5];
  const c=boot({[v10]:opened},{now:old.raid.startedAt+21000});
  const owner=c.g.places[0].findIndex(p=>p.boxes.includes(5));
  assert.equal(c.g.s.field.landmarkByZone[0],owner);assert.equal(c.g.s.field.open,'0-5');
  const scanning=clone(old);scanning.field.open=null;scanning.field.found[0]=[0,1,2,3,4];scanning.field.action={type:'scan',start:epoch+10000,end:epoch+14000};
  const scan=boot({[v10]:scanning},{now:epoch+11000});finish(scan);
  assert.ok(scan.g.s.field.found[0].includes(5));assert.equal(scan.g.s.field.landmarkByZone[0],owner);valid(scan.g);
  console.log('PASS: actual v0.10 snapshot migration and import, original key untouched, old bag/boxes/funds and in-flight move, migrated open box/scan matched to the correct landmark.');
}
async function routeBackups(){
  const b=sortie();travel(b,2,.6);
  const outgoing=await b.exportData();
  const badEdits=[
    f=>{f.journey.from=1},f=>{f.journey.to=0},f=>{f.journey.done=4},
    f=>{f.journey=null},f=>{f.journey.supply='water'},f=>{f.action.outcome='unknown'},
    f=>{f.action.supply='unknown'},f=>{f.landmarkByZone[2]=5}
  ];
  for(const edit of badEdits){
    const corrupted=clone(outgoing);edit(corrupted.session.field);
    assert.equal(b.g.check(corrupted),false);
    await b.g.importFile(new Blob([JSON.stringify(corrupted)]));
    assert.deepEqual(clone(b.g.s.field.journey),outgoing.session.field.journey);
  }
  const transfer=boot({}, {now:b.clock.now});await transfer.g.importFile(new Blob([JSON.stringify(outgoing)]));
  assert.deepEqual(clone(transfer.g.s.field.action),outgoing.session.field.action);
  finish(transfer);assert.equal(transfer.g.s.field.journey.event,'supply');
  const atSupply=await transfer.exportData();
  for(const event of ['supply','contact']){
    const edited=clone(atSupply);edited.session.field.journey.event=event;
    edited.session.field.journey.supply=event==='supply'?'unknown':null;
    assert.equal(transfer.g.check(edited),false);
  }
  console.log('PASS: export/import in transit, v0.10 tab migration lock, invalid landmark/distance/cell/event data rejected with active raid preserved.');
}
(async()=>{
  directions();outcomesAndRest();reloadAndDeadlines();supplies();evasion();landmarks();await migrate();await routeBackups();
})().catch(e=>{console.error(e);process.exitCode=1;});
