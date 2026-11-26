const fs=require('node:fs');
const {assert,boot,clone,finish,go,valid}=require('./game-fixture.cjs');
function scan(b){go(b,'scan');finish(b);}
function head(g){return g.readField().split('</p></div>')[0];}
function start(pinned=true){
  const b=boot();
  if(pinned){b.g.order('handover-ledgers');b.g.pin({kind:'order',id:'handover-ledgers'});}
  b.setRandom(.1);b.g.start();
  return b;
}
function atStation(discovered,pinned=true){
  const b=start(pinned);
  // Third genuine scan triggers the first encounter. The amount of previous work at
  // the station determines whether the freight drawer has been found.
  scan(b);
  if(!discovered)scan(b);
  go(b,'landmark',{index:8});scan(b);
  if(discovered)scan(b);
  const g=b.g,n=discovered?2:1,state=clone(g.s);
  assert.ok(g.s.field.contact);
  assert.match(head(g),/data-contact-context="landmark".*벙커 외곽 · 폐선 승강장/);
  assert.ok(head(g).includes('data-contact-found="'+n+'"'));
  assert.equal(head(g).includes('data-contact-target'),discovered&&pinned);
  assert.equal(head(g).includes('화물표 서랍'),discovered&&pinned);
  assert.ok(!head(g).includes('검역 접수 서랍'));
  assert.deepEqual(clone(g.s),state);
  return b;
}
function siteResume(){
  atStation(false);atStation(true,false);
  const b=atStation(true),g=b.g;
  b.setRandom(.9);go(b,'evade');finish(b);
  assert.ok(g.s.field.contact);assert.match(head(g),/data-contact-target/);
  const reopened=boot(b.storage,b.clock);reopened.setRandom(.1);
  go(reopened,'evade');finish(reopened);
  const field=reopened.g.s.field;
  assert.equal(field.contact,null);assert.equal(field.open,null);assert.equal(field.action,null);
  assert.equal(field.landmarkByZone[0],8);
  assert.deepEqual(clone(field.found),clone(g.s.field.found));
  assert.equal(field.boxes['0-17'].complete,false);
  go(reopened,'open',{index:17});
  assert.equal(field.open,'0-17');
  valid(reopened.g);
}
function roadResume(){
  const b=start(),g=b.g;
  b.setRolls([.99,.01,.01]);go(b,'move',{index:2});finish(b);
  const road=g.readField();
  assert.match(head(g),/data-contact-context="road"/);
  assert.ok(!road.includes('data-contact-found')&&!road.includes('data-contact-target'));
  assert.match(road,/data-route-status[^>]+data-from="0" data-to="2"/);
  assert.match(road,/대응이 끝나면 남은 이동/);
  b.setRandom(.1);go(b,'evade');finish(b);
  assert.equal(g.s.field.action.type,'travel-step');assert.equal(g.s.field.journey.done,1);
  finish(b);finish(b);assert.equal(g.s.raid.zone,2);
  const last=start();last.setRolls([.99]);go(last,'move',{index:1});finish(last);
  assert.match(last.g.readField(),/대응이 끝나면 목적지에 도착/);
  last.setRandom(.1);
  for(let i=0;i<8&&last.g.s.field.contact;i++){go(last,'engage');finish(last);}
  assert.equal(last.g.s.field.contact,null);assert.equal(last.g.s.raid.zone,1);
  assert.equal(last.g.s.field.journey,null);valid(last.g);
}
function oldContact(){
  const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/routes-v19.json','utf8'));
  const cp=fixtures.checkpoints.find(item=>item.scenario==='waiting-contact');
  const old={...clone(fixtures.base),...clone(cp.other),field:{...clone(fixtures.base.field),...clone(cp.field)}};
  const b=boot({'rl-reboot-session-v19':old},{now:cp.now});
  assert.match(head(b.g),/data-contact-context="road"/);
  assert.match(b.g.readField(),/이전 버전 이동 경로/);
  valid(b.g);
}
function unidentifiedMedical(){
  const hints=[.1,.2].map(roll=>{
    const b=boot();b.g.order('med-supply');b.g.pin({kind:'order',id:'med-supply'});
    b.setRandom(roll);b.g.start();
    scan(b);scan(b);go(b,'landmark',{index:7});scan(b);
    const note=head(b.g);
    assert.match(note,/data-contact-target>의뢰 수색 대상 진료대 응급함/);
    assert.doesNotMatch(note,/구급 붕대|응급 케이스/);
    const box=b.g.places[0][7].boxes[0];
    return {note,contents:b.g.s.field.boxes['0-'+box].items.map(u=>u.g).join(',')};
  });
  assert.notEqual(hints[0].contents,hints[1].contents);
  assert.equal(hints[0].note,hints[1].note);
}
siteResume();roadResume();oldContact();unidentifiedMedical();
console.log('PASS real third-scan contacts, same-site discovery and no hidden target names, no autoscan, failed/successful evasion, reload, road continuation/final-cell victory and v19 paused contact.');
