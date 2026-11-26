const {assert,boot,clone,extract,finish,go,move,stamp,v12,valid}=require('./game-fixture.cjs');
const b=boot();
function start(game,roll){
  game.clock.now+=1200;game.g.moveNow(0);game.setRandom(roll);game.g.start();
}
function acquire(game,id){
  const state=game.g.s;
  while(!state.field.found[0].includes(1)){go(game,'scan');finish(game);}
  go(game,'open',{index:1});go(game,'search');
  while(game.g.s.field.action)finish(game);
  const unit=game.g.s.field.boxes['0-1'].items.find(row=>row.g===id);
  assert.ok(unit&&unit.revealed,id);
  game.g.selectLoot(unit.uid);go(game,'close');
  assert.ok(game.g.s.field.bag.some(x=>x.uid===unit.uid&&x.g===id));
}
async function run(){
  const g=b.g;
  start(b,.12);acquire(b,'wrench');assert.equal(g.s.career.archive,undefined);
  const inProgress=await b.exportData();
  for(const lost of ['abandoned','expired']){
    const c=boot({[v12]:clone(g.s)},{now:b.clock.now});
    if(lost==='abandoned')go(c,'abandon');else stamp(c,c.g.s.raid.endsAt);
    assert.equal(c.g.s.career.archive,undefined);assert.equal(c.g.s.lastSummary.archiveItems,undefined);
  }
  const cold=boot({},b.clock);
  await cold.g.importFile(new Blob([JSON.stringify(inProgress)]));
  const game=cold.g;
  extract(cold);
  assert.deepEqual(clone(game.s.lastSummary.archiveItems),['wrench']);assert.equal(game.stock('wrench'),1);
  assert.equal(game.s.career.archive[0].source,'0-1');const receipt=clone(game.s.career.archive[0]);valid(game);
  game.ack();start(cold,.12);acquire(cold,'wrench');extract(cold);
  assert.deepEqual(clone(game.s.career.archive),[receipt]);assert.equal(game.s.lastSummary.archiveItems,undefined);
  game.ack();start(cold,.174);acquire(cold,'driver');extract(cold);game.ack();
  start(cold,.35);acquire(cold,'wire');extract(cold);valid(game);
  const full=await cold.exportData();assert.deepEqual(clone(game.s.career.archive.map(x=>x.item)),['wrench','driver','wire']);
  for(const edit of [s=>s.career.archive.push(s.career.archive[0]),s=>s.career.archive[0].source='0-00',s=>s.career.archive[0].source='0-0',
    s=>s.career.archive[0].returnedAt=s.career.archive[0].raidId+1800000,s=>s.lastSummary.archiveItems=['wrench'],s=>s.lastSummary.archiveItems=['wire','wire']]){
    const copy=clone(full);edit(copy.session);assert.equal(game.check(copy),false);
  }
  const old=clone(full.session);delete old.career.archive;delete old.lastSummary.archiveItems;
  const legacy=boot({[v12]:old},cold.clock);assert.equal(legacy.g.s.career.archive,undefined);
  // A store purchase reintroduced into a sortie has no field-container provenance.
  const synthetic=boot();const merchant=synthetic.g.traders.find(t=>synthetic.g.listed(t.id,'buy').includes('wire'));assert.ok(synthetic.g.trade(merchant.id,'buy','wire').ok);synthetic.g.gear({gear:'pack',id:'wire',unit:synthetic.g.s.stashSlots.find(x=>x.g==='wire').uid});
  start(synthetic,.12);assert.ok(synthetic.g.s.field.bag.some(x=>x.g==='wire'));extract(synthetic);
  assert.equal(synthetic.g.s.career.archive,undefined);
  console.log('PASS physical pickup and native return, both loss paths, same item across raids, three originals, prior save, vendor exclusion and archival JSON validation.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
