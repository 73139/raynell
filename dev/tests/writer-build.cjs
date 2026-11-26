// Older released clients that used v35 cannot touch v36. Clients sharing v36 also check the writing build.
const {assert,boot,clone,v12}=require('./game-fixture.cjs');
const fs=require('node:fs');
const originalActive=require('./fixtures/pump-pipe-active-v60.json');
const originalDone=require('./fixtures/pump-pipe-done-v60.json');
const previous='rl-reboot-session-v35';
const title=fs.readFileSync(process.argv[2]||'index.html','utf8').match(/<title>[^<]* v(\d+)\.(\d+)(?:\.(\d+))?<\/title>/);
const expectedBuild=Number(title[1])*1000000+Number(title[2])*1000+Number(title[3]||0);
const content=s=>{const {version,revision,writerBuild,...player}=clone(s);return player};
const wrapped=session=>({format:'rustline-tc01',session});
const file=data=>new Blob([JSON.stringify(data)]);

async function verify(){
  for(const source of [originalActive,originalDone]){
    const bytes=JSON.stringify(source.session),disk=new Map([[previous,bytes]]);
    const clock={now:source.session.career.history[0].at+1000};
    const read=boot(disk,clock);
    assert.equal(disk.get(previous),bytes);
    assert.equal(read.g.s.writerBuild,expectedBuild);
    assert.deepEqual(content(read.g.s),content(source.session));
    assert.ok(read.g.check(source));
    const checkpoint=JSON.parse(disk.get(v12));
    assert.equal(checkpoint.version,36);
    const imported=boot({},clock);
    await imported.g.importFile(file(source));
    assert.deepEqual(content(imported.g.s),content(source.session));
    assert.equal(JSON.parse(imported.storage.get(v12)).writerBuild,expectedBuild);
    const exported=await imported.exportData();
    assert.equal(exported.session.version,36);assert.equal(exported.session.writerBuild,expectedBuild);
    const later=boot({},clock);
    await later.g.importFile(file(exported));
    assert.deepEqual(content(later.g.s),content(source.session));
  }

  const local=boot(),original=local.storage.get(v12);
  const newer={...JSON.parse(original),writerBuild:expectedBuild+1,futureFlag:'keep-this'};
  assert.equal(local.g.check(wrapped(newer)),false);
  await local.g.importFile(file(wrapped(newer)));
  assert.equal(local.storage.get(v12),original);
  assert.ok(local.g.trade('supply','buy','water',1).ok,'rejecting a future file leaves normal play available');

  for(const header of [{writerBuild:expectedBuild+1},{writerBuild:null},{version:37}]){
    const stale=boot();
    const foreign={...JSON.parse(stale.storage.get(v12)),...header,futureFlag:'only-newer-clients-know-this'};
    const bytes=JSON.stringify(foreign);
    stale.storage.set(v12,bytes);
    // Revision deliberately matches this writer. The compatibility check must precede the revision gate.
    assert.equal(stale.g.pin(null),false);
    assert.equal(stale.storage.get(v12),bytes);
    await stale.g.importFile(file(originalDone));
    assert.equal(stale.storage.get(v12),bytes);
    boot(stale.storage);
    assert.equal(stale.storage.get(v12),bytes);
  }
  const direct=boot(),foreignBytes=JSON.stringify({...direct.g.s,writerBuild:expectedBuild+1});
  direct.storage.set(v12,foreignBytes);
  await direct.g.importFile(file(originalDone));
  assert.equal(direct.storage.get(v12),foreignBytes,'direct restore observes the current build on disk');
  console.log('PASS authentic v35 active and paid pump-pipe snapshots migrate and round-trip. Newer files, newer disk with identical revision, invalid build metadata and future schemas leave stored bytes untouched.');
}
verify().catch(error=>{console.error(error);process.exitCode=1});
