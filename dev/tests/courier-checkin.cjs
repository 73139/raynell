const {assert,boot,clone,extract,go,move,stamp,valid,v12}=require('./game-fixture.cjs');
const ID='courier-checkin';
const fresh=boot(),base=clone(fresh.g.s);base.career.done=['handover-ledgers','sealed-mail'];
function launch(src=base){const b=boot({[v12]:clone(src)});b.g.order(ID);assert.equal(b.g.s.career.order,ID);b.g.pin({kind:'order',id:ID});b.g.moveNow(0);b.g.start();return b;}
function act(b,action,token){return b.g.survivorAction(action,b.g.s.raid.startedAt,token);}
function talk(b){const zone=b.g.s.raid.zone;assert.ok(act(b,'observe',String(zone)).ok);const record=b.g.survivorView();const bootprint=record.clues.find(c=>c.kind==='boots'&&c.zone===zone);assert.ok(bootprint);assert.ok(act(b,'follow',bootprint.id).ok);const token=b.g.survivorView().encounter.token;assert.ok(act(b,'meet',token).ok);assert.ok(!act(b,'meet',token).ok);}
function both(b){const start=b.g.s.raid.startedAt;talk(b);assert.equal(b.g.objective().goals[0].projected,1);stamp(b,start+90000);assert.ok(act(b,'observe','0').ok);const cloth=b.g.survivorView().clues.find(c=>c.kind==='cloth');assert.equal(cloth.to,1);assert.ok(act(b,'follow',cloth.id).ok);move(b,cloth.to);stamp(b,start+105500);assert.ok(act(b,'meet',b.g.survivorView().encounter.token).ok);assert.equal(b.g.objective().goals[0].projected,2);assert.equal(b.g.s.wallet,30000);}
for(const done of [[],['handover-ledgers'],['sealed-mail']]){const s=clone(base);s.career.done=done;const x=boot({[v12]:s});x.g.order(ID);assert.equal(x.g.s.career.order,null);}
for(const result of ['normal','quick','abandoned','expired','one-talk']){
 let b=launch();const start=b.g.s.raid.startedAt;
 if(result==='one-talk')talk(b);else both(b);
 const state=clone(b.g.s);valid(b.g);const rebuilt=boot({[v12]:state},b.clock);assert.equal(rebuilt.g.objective().goals[0].projected,result==='one-talk'?1:2);b=rebuilt;
 if(result==='abandoned')go(b,'abandon');
 else if(result==='expired')stamp(b,start+1800000);
 else{if(b.g.s.raid.zone!==0)move(b,0);if(result!=='quick')stamp(b,start+420000);extract(b);}
 const rec=b.g.s.lastSummary,success=result==='normal';assert.equal(rec.commission,success?38000:0);assert.equal(rec.missionXp,success?135:0);assert.equal(b.g.s.wallet,success?68000:30000);assert.equal(b.g.s.career.done.filter(id=>id===ID).length,Number(success));
 b.g.ack();valid(b.g);const resumed=boot({[v12]:clone(b.g.s)},b.clock);assert.equal(resumed.g.s.wallet,b.g.s.wallet);
 if(!success){assert.equal(resumed.g.s.career.order,ID);stamp(resumed,b.clock.now+5);resumed.g.start();assert.equal(resumed.g.objective().goals[0].projected??0,0);}
}
const validStart=launch();const original=clone(validStart.g.s);for(const done of [['handover-ledgers'],['sealed-mail'],['handover-ledgers','sealed-mail',ID]]){const bad=clone(original);bad.career.done=done;assert.equal(validStart.g.check({format:'rustline-tc01',session:bad}),false);}
console.log('PASS three-order prerequisite chain, two distinct observed conversations, separate raids do not add, no water required, archive/reload, normal 38,000 CR/135 XP once, quick/one-talk/MIA/abandon zero.');
