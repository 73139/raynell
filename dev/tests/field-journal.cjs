// A survey entry is earned by searching a physical container and returning with that observation.
const {assert,boot,clone,extract,finish,go,move,stamp,v12,valid}=require('./game-fixture.cjs');
const sites=[[0,8,17],[1,1,6],[2,0,0]];
function start(b,zone=0){b.g.moveNow(zone);b.clock.now+=1200;b.setRandom(.12);b.g.start()}
function open(b,[zone,landmark,index]){
  if(b.g.s.raid.zone!==zone)move(b,zone);
  go(b,'landmark',{index:landmark});
  while(!b.g.s.field.found[zone].includes(index)){
    b.setRandom(.10);go(b,'scan');finish(b);
    while(b.g.s.field.contact){go(b,'evade');if(b.g.s.field.action)finish(b)}
  }
  go(b,'open',{index});assert.equal(b.g.s.field.open,`${zone}-${index}`);
}
function finishSearch(b){go(b,'search');while(b.g.s.field.action)finish(b);go(b,'close')}
function keys(b){return clone(b.g.s.career.surveyedBoxes||[])}
async function run(){
  const b=boot();start(b);open(b,sites[0]);assert.deepEqual(keys(b),[]);go(b,'close');extract(b);assert.deepEqual(keys(b),[]);b.g.ack();
  start(b);open(b,sites[0]);finishSearch(b);assert.deepEqual(keys(b),[]);extract(b);assert.equal(b.g.s.lastSummary.rating,'quick');assert.deepEqual(keys(b),['0-17']);assert.deepEqual(clone(b.g.s.lastSummary.newSurveyBoxes),['0-17']);valid(b.g);
  const legacy=clone(b.g.s);delete legacy.career.surveyedBoxes;delete legacy.lastSummary.newSurveyBoxes;const migrated=boot({[v12]:legacy},b.clock);assert.deepEqual(keys(migrated),['0-17']);
  const clean=clone(legacy);clean.raid=null;clean.field=clone(boot().g.s.field);const unknown=boot({[v12]:clean},b.clock);assert.deepEqual(keys(unknown),[]);
  b.g.ack();start(b);open(b,sites[0]);finishSearch(b);open(b,sites[1]);finishSearch(b);const active=await b.exportData();const d=boot({},b.clock);await d.g.importFile(new Blob([JSON.stringify(active)]));assert.deepEqual(keys(d),['0-17']);move(d,0);extract(d);
  assert.equal(d.g.s.lastSummary.rating,'success');assert.deepEqual(keys(d),['0-17','1-6']);assert.deepEqual(clone(d.g.s.lastSummary.newSurveyBoxes),['1-6']);const complete=await d.exportData();valid(d.g);
  for(const alter of [s=>s.career.surveyedBoxes.push('1-6'),s=>s.career.surveyedBoxes.push('3-0'),s=>{s.career.surveyedBoxes=['0-01']},s=>{s.lastSummary.newSurveyBoxes=['2-0']},s=>{s.lastSummary.newSurveyBoxes=['1-6','1-6']},s=>{s.lastSummary.searched=0}]){const f=clone(complete);alter(f.session);assert.equal(d.g.check(f),false)}
  d.g.ack();for(const end of ['abandoned','expired']){start(d,2);open(d,sites[2]);finishSearch(d);if(end==='abandoned')go(d,'abandon');else stamp(d,d.g.s.raid.endsAt);assert.deepEqual(keys(d),['0-17','1-6']);assert.equal(d.g.s.lastSummary.newSurveyBoxes,undefined);d.g.ack()}
  start(d);open(d,sites[0]);finishSearch(d);extract(d);assert.equal(d.g.s.lastSummary.newSurveyBoxes,undefined);assert.deepEqual(keys(d),['0-17','1-6']);valid(d.g);
  console.log('PASS inspected vs fully searched, quick and normal returns, repeated sites, both loss paths, native active file handoff, legacy open receipt vs missing history, bounded map keys.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
