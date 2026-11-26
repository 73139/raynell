// A fresh player's full campaign through public game actions. The fixture supplies a reproducible random stream
// and advances the clock to each scheduled deadline. No inventory, balances, loot rolls, facilities or saves are edited.
const {assert,boot,extract,finish,go,stamp,valid}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const b=boot(),g=b.g;
assert.equal(g.s.wallet,30000);
assert.deepEqual(Object.keys(g.s.stash),[]);
assert.equal(g.s.career.sorties,0);

const reserve=new Map(), stages=[
  {id:'power',item:'food'}, {id:'water',item:'water'}, {id:'med',item:'bandage'}
];
for(const stage of stages){
  stage.bill=db.hideout.facilities[stage.id].levels[0];
  for(const [id,n] of Object.entries(stage.bill.materials)) reserve.set(id,(reserve.get(id)||0)+n);
  reserve.set(stage.item,(reserve.get(stage.item)||0)+2);
}
const name=id=>g.goods[id][0];
let purchases=0,sales=0,sorties=0,discovered=0;

function scavenge(point){
  // Search the first real container at a publicly named landmark and choose among revealed goods only.
  go(b,'landmark',{index:point});go(b,'scan');finish(b);
  const index=g.places[0][point].boxes[0];
  assert.ok(g.s.field.found[0].includes(index));
  go(b,'open',{index});go(b,'search');
  while(g.s.field.action) finish(b);
  const box=g.s.field.boxes['0-'+index];
  assert.ok(box.complete);
  const rows=box.items.filter(unit=>unit.revealed);
  discovered+=rows.length;
  const wanted=id=>g.stock(id)+g.s.field.bag.filter(unit=>unit.g===id).length < (reserve.get(id)||0);
  rows.sort((a,c)=>Number(wanted(c.g))-Number(wanted(a.g)) || g.price(c.g)/(c.w*c.h)-g.price(a.g)/(a.w*a.h));
  for(const unit of rows) g.selectLoot(unit.uid);
  go(b,'close');
}
function returnWithSupplies(){
  b.clock.now+=1000;
  g.start();
  // Industrial materials and first-aid goods are publicly listed in the catalogue for these landmarks.
  scavenge(5);scavenge(7);
  extract(b);assert.equal(g.s.field.result,'success');g.ack();
  sorties++;
  for(const [id,n] of Object.entries(g.s.stash)){
    for(let i=n;i>(reserve.get(id)||0);i--){
      const available=g.s.stashSlots.find(unit=>unit.g===id);
      const money=g.s.wallet;
      g.sell(id,available?.uid||'overflow');
      assert.ok(g.s.wallet>money,'sale of '+name(id));sales++;
    }
  }
}
function procure(id,quantity,fundsForConstruction){
  const trader=g.traders.find(t=>t.stock.includes(id));
  while(g.stock(id)<quantity && g.s.wallet>=g.price(id)+fundsForConstruction){
    const before=g.stock(id);
    if(trader) {
      const result=g.trade(trader.id,'buy',id,1);
      if(!result.ok)break; // A locked trader listing requires its normal progression or a field find.
    }else{
      g.lookup(id);g.supply(id);
      if(g.stock(id)===before)break;
    }
    assert.equal(g.stock(id),before+1,'purchase of '+name(id));purchases++;
  }
}
for(const stage of stages){
  assert.equal(g.campaignView().active.id,stage.id);
  const chapterStart=sorties, bill=stage.bill;
  while(!g.campaignView().ready && sorties-chapterStart<60){
    returnWithSupplies();
    if(!g.campaignView().built){
      for(const [id,n] of Object.entries(bill.materials)) procure(id,n,bill.costCR);
      g.build({hideout:'build',id:stage.id,tier:1});
      const job=g.s.hideout.builds[stage.id];
      if(job){
        assert.equal(job.end-b.clock.now,bill.durationMinutes*60000);
        stamp(b,job.end);
        for(const [id,n] of Object.entries(bill.materials)) reserve.set(id,reserve.get(id)-n);
      }
    }
    let state=g.campaignView();
    if(state.remaining){
      const billNeeded=state.built?0:(bill.materials[stage.item]||0);
      procure(stage.item,state.remaining+billNeeded,state.built?0:bill.costCR);
      const actual=Math.min(state.remaining,Math.max(0,g.stock(stage.item)-billNeeded));
      if(actual){
        assert.ok(g.campaignAction(stage.id,'deliver',actual,state.delivered).ok);
        reserve.set(stage.item,reserve.get(stage.item)-actual);
      }
    }
  }
  assert.ok(g.campaignView().ready,stage.id+' chapter blocked after '+sorties+' sorties');
  const paid=g.s.campaign.returnId,before=g.s.wallet;
  assert.ok(g.campaignAction(stage.id,'claim').ok);
  assert.ok(g.s.campaign.claimed.includes(paid));
  assert.ok(g.s.wallet>before);valid(g);
  console.log('PASS fresh campaign '+stage.id+' — sorties: '+(sorties-chapterStart));
}
assert.equal(g.campaignView().completed,true);
assert.equal(new Set(g.s.campaign.claimed).size,3);
assert.ok(purchases>0 && sales>0 && discovered>0);
console.log('PASS fresh 30,000 CR profile completed three chapters in '+sorties+' successful sorties; '+discovered+' revealed units, '+sales+' sales, '+purchases+' real purchases; all three Lv.1 facilities constructed.');

// Restore four local services by completing their existing cooperation contracts. None is pre-awarded.
assert.equal(g.finaleView().status,'locked');
const jobs=['supply-first-shift','medic-field-clinic','quarter-rollcall','repair-power-post'];
for(const id of jobs) assert.ok(g.contract(id,'accept').ok,id);
returnWithSupplies();
for(const id of jobs) {
  assert.equal(g.status(id).status,'ready',id);
  assert.ok(g.contract(id,'claim').ok,id);
}
assert.equal(g.finaleView().status,'available');
assert.equal(g.finaleView().traders.filter(t=>t.done).length,4);
function dispatch(){
  assert.ok(g.finaleAction('arm').ok);
  b.clock.now+=1000;g.start();
  assert.equal(g.finaleView().status,'active');
  return g.s.raid.startedAt;
}
function signal(zone){
  const raidId=g.s.raid.startedAt;
  assert.ok(g.finaleAction('signal',zone,raidId).ok);
  assert.ok(!g.finaleAction('signal',zone,raidId).ok,'one transmission per region');
}
function travelTo(zone){
  go(b,'move',{index:zone});
  let decisions=0;
  while(g.s.field.journey && !g.s.field.result){
    assert.ok(decisions++<50);
    if(g.s.field.action)finish(b);
    else if(g.s.field.contact)go(b,'evade');
    else if(g.s.field.journey.event==='supply')go(b,'journey-pass');
    else assert.fail('A pending route must offer a timed action, contact or supply.');
  }
  assert.equal(g.s.raid.zone,zone);assert.ok(!g.s.field.result);
}
// Lose one incomplete operation and retry with the three rebuilt facilities and four partners still active.
dispatch();signal(0);go(b,'abandon');g.ack();
assert.equal(g.finaleView().status,'available');
assert.ok(!g.s.finale.reply);
const attempt=dispatch();
signal(0);
travelTo(1);signal(1);
travelTo(2);signal(2);
assert.equal(g.s.finale.reply,null,'outside reply is gated on extraction');
travelTo(0);extract(b);
assert.equal(g.s.lastSummary.finaleReply,true);
assert.deepEqual(Array.from(g.s.lastSummary.finaleAttempt.zones),[0,1,2]);
assert.equal(g.s.finale.reply.raidId,attempt);
g.ack();assert.equal(g.finaleView().status,'complete');
assert.ok(!g.finaleAction('arm').ok);valid(g);
console.log('PASS fresh profile concluded B-04: 4 existing trader contracts paid, one failed relay attempt, a new three-region sortie through natural route events, B-04 extraction and one outside reply. Total sorties '+g.s.career.sorties+', returns '+g.s.career.returns+'.');

// Reuse this earned, operating clinic in downstream end-to-end scenarios.
module.exports=b;
