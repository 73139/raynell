// The newcomer's own pantry return must not change the guide title just before claiming.
const {assert, boot, clone, extract, finish, go} = require('./game-fixture.cjs');
const PANTRY = 'supply-pantry';

function settings(b, name, step) {
  b.click({page:'settings'});
  assert.ok(b.content().includes('aria-label="'+name+' 설정"'), name+' visible in Settings');
  assert.equal(b.g.onboarding().step, step);
}

for (const priorReturn of [false,true]) {
  const b=boot({},undefined,{},'#map'),g=b.g;
  if(priorReturn) {
    g.start();
    extract(b);
    g.ack();
  }
  const name=priorReturn?'한미정의 배급소 찬장 안내':'첫 출격 안내';
  settings(b,name,'accept');
  assert.ok(g.contract(PANTRY,'accept').ok);
  settings(b,name,'deploy');
  g.start();
  go(b,'landmark',{index:3});
  go(b,'scan');
  finish(b);
  const index=g.places[0][3].boxes[0];
  go(b,'open',{index});
  if(!g.s.field.boxes['0-'+index].complete) {
    go(b,'search');
    while(g.s.field.action) finish(b);
  }
  go(b,'close');
  extract(b);
  settings(b,name,'debrief');
  g.ack();
  settings(b,name,'claim');
  const unpaid=clone(g.s);
  assert.ok(g.contract(PANTRY,'claim').ok);
  settings(b,name,'done');
  assert.equal(g.fee,unpaid.wallet+4200);
  assert.equal(g.s.career.xp,unpaid.career.xp+25);
  assert.equal(g.contract(PANTRY,'claim').ok,false);
  settings(boot(b.storage,b.clock,{},'#map'),name,'done');
}
console.log('PASS prior unrelated return changes the guide name; the first pantry return alone keeps its name through receipt and reload.');
