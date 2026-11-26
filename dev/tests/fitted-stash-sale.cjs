// The warehouse shortcut and the trader must conserve installed parts on the exact selected instance.
const {assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const old=require('./fixtures/presets-v20.json').session;
const prior='rl-reboot-session-v20';
const b=boot({[prior]:old}),g=b.g;
const target=g.presetCurrent();
target.worn.light='flash';target.modules.light='battery';
assert.ok(g.applyPreset(target).ok);
g.gear({gear:'unwear',slot:'light'});
const fitted=clone(g.s.stashSlots.find(u=>u.g==='flash'));
assert.equal(fitted.gear.module,'battery');
assert.equal(g.saleQuote('quarter',[fitted.uid]).ok,false);
const bytes=b.storage.get(v12);
g.sell('flash',fitted.uid);
assert.equal(b.storage.get(v12),bytes,'a stale or directly invoked sale cannot bypass the button');
valid(g);

// Same item ID, two real conditions. The plain host is independently sellable.
const sample=clone(g.s),plain=clone(fitted);
plain.uid='s-plain-light';plain.gear.uid='s-plain-lamp-serial';plain.gear.module=null;
plain.x=0;plain.y=29;
sample.stash.flash++;
sample.stashSlots.push(plain);
const pair=boot({[v12]:sample});valid(pair.g);
pair.g.sell('flash',plain.uid);
assert.equal(pair.g.fee,sample.wallet+6000);
assert.deepEqual(clone(pair.g.s.stashSlots.find(u=>u.g==='flash')),fitted);
pair.g.sell('flash',fitted.uid);
assert.equal(pair.g.fee,sample.wallet+6000);
assert.equal(pair.g.s.stash.flash,1);

// Incoming items are FIFO per item type; the queue can contain distinct installed parts.
const queue=clone(sample);
queue.stashSlots=queue.stashSlots.filter(u=>u.g!=='flash');
queue.gearOverflow=[plain.gear,fitted.gear];
const incoming=boot({[v12]:queue});valid(incoming.g);
incoming.g.sell('flash','overflow');
assert.equal(incoming.g.fee,queue.wallet+6000);
assert.equal(incoming.g.s.stash.flash,1);
assert.deepEqual(clone(incoming.g.s.gearOverflow),[fitted.gear]);
const queuedBytes=incoming.storage.get(v12);
incoming.g.sell('flash','overflow');
assert.equal(incoming.storage.get(v12),queuedBytes);
assert.deepEqual(clone(boot(incoming.storage).g.s.gearOverflow),[fitted.gear]);

// Removing the real module makes just the host available again.
g.gear({gear:'wear-stash',id:'flash',unit:fitted.uid});
const detach=g.presetCurrent();delete detach.modules.light;
assert.ok(g.applyPreset(detach).ok);
g.gear({gear:'unwear',slot:'light'});
const loose=g.s.stashSlots.find(u=>u.g==='flash');
assert.equal(loose.gear.uid,fitted.gear.uid);
assert.equal(loose.gear.module,null);assert.equal(g.s.stash.battery,1);
g.sell('flash',loose.uid);
assert.equal(g.fee,old.wallet+6000);
assert.equal(g.s.stash.flash,undefined);
assert.equal(g.s.stash.battery,1);
valid(g);
console.log('PASS v20 owned flashlight and battery; protected direct and merchant sale, independent plain twin, FIFO mixed overflow, detach and real 6,000 CR sale retain the original battery.');
