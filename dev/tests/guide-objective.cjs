// Opening a pinned objective is a view action. A previously rendered early-exit button is stale.
const {assert,boot,clone,go}=require('./game-fixture.cjs');
const order={kind:'order',id:'pump-gauge'};
const facility={kind:'facility',id:'power',tier:1};
const pantry={kind:'contract',id:'supply-pantry'};
const has=(b,action)=>b.content().includes('data-guide-action="'+action+'"');

function enter(pin,pantryActive=false) {
  const b=boot({},undefined,{},'#map');
  b.g.order(order.id);
  if(pantryActive) assert.ok(b.g.contract(pantry.id,'accept').ok);
  if(pin) assert.ok(b.g.pin(pin));
  b.g.start();
  b.click({page:'raid'});
  return b;
}

const noPin=enter(null);
assert.ok(has(noPin,'extract'),'an unpinned order leaves the original free-play route');
for(const pin of [order,facility]) {
  const b=enter(pin);
  assert.ok(b.content().includes('data-guide-step="unassigned"'));
  assert.ok(has(b,'objective')&&!has(b,'extract'));
  const before=clone(b.g.s);
  b.click({guide:'next',guideAction:'extract',guideValue:'b04'});
  assert.equal(b.g.s.field.action,null);
  for(const key of ['field','raid','wallet','contracts','career','equipment','objectivePin','onboarding'])
    assert.deepEqual(clone(b.g.s[key]),before[key],key);
  go(b,'scan');
  b.click({page:'raid'});
  assert.ok(!has(b,'objective'),'field actions retain their normal wait feedback');
}
for(const pin of [order,pantry]){
  const b=enter(pin,true);
  assert.ok(b.content().includes('data-guide-step="search"'));
  assert.ok(!has(b,'objective')&&!has(b,'extract'),'accepted pantry still points to its own unfinished search');
}
console.log('PASS unrelated pinned order or facility replaces the stale exit shortcut; unpinned work, active timers and accepted pantry keep their own guidance.');
