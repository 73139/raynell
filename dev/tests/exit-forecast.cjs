const { assert, boot, clone, epoch, extract, finish, go, stamp, v9, v12, valid } = require('./game-fixture.cjs');

function localExit(game, id) {
  const card = game.readField().split('<div class="exit-card">').find(part =>
    part.startsWith('<div><span class="mono">EXIT / ' + id.toUpperCase() + '<'));
  assert.ok(card, 'Exit card is rendered: ' + id);
  return card.split('</button></div>')[0];
}
function forecast(game, id) {
  return localExit(game, id).match(/<p data-exit-forecast="[^"]+"(?: hidden)?>([^<]*)<\/p>/)?.[1] || '';
}

const timed = boot();
timed.g.start();
const start = timed.g.s.raid.startedAt;
stamp(timed, start + 410000 - 1);
assert.match(forecast(timed.g, 'b04'), /조기 탈출.*25 XP/);
stamp(timed, start + 410000);
assert.match(forecast(timed.g, 'b04'), /정상 탈출/);
go(timed, 'extract', {exit:'b04'});
const resumed = boot(timed.storage, timed.clock);
assert.match(forecast(resumed.g, 'b04'), /정상 탈출/);
finish(resumed);
assert.equal(resumed.g.s.lastSummary.rating, 'success');
assert.equal(resumed.g.s.lastSummary.elapsed, 420000);
const early = boot();
early.g.start();
assert.match(forecast(early.g, 'b04'), /조기 탈출/);
extract(early);
assert.equal(early.g.s.lastSummary.rating, 'quick');
assert.equal(early.g.s.lastSummary.earned, 25);

const qualifying = boot();
qualifying.g.start();
for (const box of Object.values(qualifying.g.s.field.boxes).slice(0,2)) box.complete = true;
assert.match(forecast(qualifying.g, 'b04'), /정상 탈출/);
const victory = boot();
victory.g.start();
victory.g.s.field.victories = 1;
assert.match(forecast(victory.g, 'b04'), /정상 탈출/);

const deadline = boot();
deadline.g.start();
const end = deadline.g.s.raid.endsAt;
stamp(deadline, end - 10001);
go(deadline, 'extract', {exit:'b04'});
stamp(deadline, end - 5000);
assert.match(localExit(deadline.g, 'b04'), /탈출 대기 중/);
assert.doesNotMatch(localExit(deadline.g, 'b04'), /시간 부족/);
finish(deadline);
assert.equal(deadline.g.s.lastSummary.result, 'success');
const late = boot();
late.g.start();
stamp(late, late.g.s.raid.endsAt - 10000);
assert.equal(forecast(late.g, 'b04'), '');
assert.match(localExit(late.g, 'b04'), /시간 부족/);

function truck(wallet, cash) {
  const began = epoch - 60000;
  const old = {[v9]:{raid:{zone:1,startedAt:began,endsAt:began+1800000},
    field:{raidId:began,bag:[],found:[[],[],[]],boxes:{},visited:[1],open:null,action:null,result:null,log:[],energy:100,water:100},
    wallet,stash:{},lastSummary:null}};
  const first = boot(old);
  const state = clone(first.g.s);
  if (cash) state.field.bag.push({uid:'s-cash-fare',g:'cr_notes',amount:cash,x:0,y:0,w:1,h:1,revealed:true});
  return boot({[v12]:state},first.clock);
}
const funded = truck(0,16000);
assert.match(localExit(funded.g, 'truck'), /벙커 0 CR · 휴대 16,000 CR<br>요금 차감 후 1,000 CR/);
assert.equal(forecast(funded.g, 'b04'), '');
go(funded,'extract',{exit:'truck'});
go(funded,'cancel');
assert.equal(funded.g.s.wallet,0);
extract(funded,'truck');
assert.equal(funded.g.s.wallet,1000);
assert.equal(funded.g.s.lastSummary.cost,15000);
assert.equal(boot(funded.storage,funded.clock).g.s.wallet,1000);
const exact = truck(5000,10000);
assert.match(localExit(exact.g,'truck'), /요금 차감 후 0 CR/);
extract(exact,'truck');
assert.equal(exact.g.s.wallet,0);
assert.equal(exact.g.s.career.history[0].cash,-5000);
const paidWithNotes=truck(0,20000);
const beforeSettlement=paidWithNotes.g.s.wallet;
extract(paidWithNotes,'truck');
const receipt=clone(paidWithNotes.g.s.career.history[0]);
assert.equal(receipt.cash,5000);
assert.equal(receipt.cash,paidWithNotes.g.s.wallet-beforeSettlement);
assert.equal(receipt.cost,15000);
assert.equal(receipt.carriedCash,20000);
assert.deepEqual(clone(boot(paidWithNotes.storage,paidWithNotes.clock).g.s.career.history[0]),receipt);
valid(paidWithNotes.g);
const invalid=clone(paidWithNotes.g.s);
invalid.career.history[0].cash=-15000;
assert.equal(paidWithNotes.g.check({format:'rustline-tc01',session:invalid}),false);
delete invalid.career.history[0].carriedCash;
assert.equal(paidWithNotes.g.check({format:'rustline-tc01',session:invalid}),true);
const short = truck(6000,8999);
assert.match(localExit(short.g,'truck'), /1 CR 부족/);
assert.equal(forecast(short.g,'truck'), '');
go(short,'extract',{exit:'truck'});
assert.equal(short.g.s.field.action,null);
valid(short.g);
console.log('PASS: projected quick/normal reward matches settlement, seven-minute boundary and reload, two searches, one victory, deadline and waiting, remote exit, mixed-cash fare and one-CR shortage.');
