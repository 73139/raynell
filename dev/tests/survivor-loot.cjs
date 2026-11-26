const {assert,boot,clone,extract,finish,go,stamp,v12,valid}=require('./game-fixture.cjs');

function stock(g){
  return Object.values(g.s.field.boxes).flatMap(box=>box.items.map(item=>item.uid)).sort();
}
async function run(){
  const b=boot(),g=b.g;
  g.start();const raidId=g.s.raid.startedAt;
  const original=stock(g);
  b.setRandom(.01);
  go(b,'scan');finish(b);const discovered=g.s.field.found[0][0];
  go(b,'open',{index:discovered});
  const observedBox=g.s.field.open, kept=clone(g.s.field.boxes[observedBox].items);
  const before=b.storage.get(v12), save=b.storage.set;
  b.storage.set=()=>{throw Error('disk full')};
  stamp(b,raidId+90000);
  assert.equal(b.storage.get(v12),before);
  assert.deepEqual(stock(g),original);assert.equal(g.s.field.survivorScavenge,undefined);
  b.storage.set=save;
  stamp(b,raidId+90000);
  const event=g.s.field.survivorScavenge;
  assert.ok(event.box && event.uid);
  assert.notEqual(event.box,observedBox);
  assert.deepEqual(clone(g.s.field.boxes[observedBox].items),kept);
  const after=stock(g);
  assert.deepEqual(after,original.filter(uid=>uid!==event.uid));assert.equal(after.length,original.length-1);
  assert.equal(g.survivorView().clues.length,0);
  const copy=await b.exportData(), other=boot({},b.clock);
  assert.ok(g.check(copy));
  await other.g.importFile(new Blob([JSON.stringify(copy)]));
  assert.deepEqual(stock(other.g),after);
  for(const delay of [90001,105000,405000]){stamp(other,raidId+delay);assert.deepEqual(stock(other.g),after);}
  valid(other.g);
  const invalid=clone(copy);invalid.session.field.survivorScavenge.box=observedBox;
  assert.equal(g.check(invalid),false);
  go(other,'close');
  const target=Number(event.box.split('-')[1]);
  const point=other.g.places[0].findIndex(place=>place.boxes.includes(target));
  go(other,'landmark',{index:point});other.setRandom(.01);
  while(!other.g.s.field.found[0].includes(target)){go(other,'scan');finish(other);}
  other.click({page:'raid'});
  assert.match(other.content(),/뒤진 흔적/);
  go(other,'open',{index:target});
  assert.match(other.content(),/먼지 위로 물건을 꺼낸 자국/);
  assert.ok(!other.g.s.field.boxes[event.box].items.some(item=>item.uid===event.uid));
  go(other,'close');extract(other);valid(other.g);other.g.ack();valid(other.g);
  const fresh=boot();fresh.g.start();const started=fresh.g.s.raid.startedAt;
  go(fresh,'extract',{exit:'b04'});stamp(fresh,started+150000);
  assert.equal(fresh.g.s.field.result,'success');
  assert.equal(fresh.g.s.field.survivorScavenge,undefined);
  console.log('PASS timed scavenging removes one actual small item from an undiscovered container; opened box protected, earlier extraction respected, no undiscovered marker, quota rollback, fresh-profile JSON and repeated clock ticks preserve exact stock.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
