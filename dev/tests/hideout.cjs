const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const db = JSON.parse(fs.readFileSync('Rustline_Database_v10.json','utf8'));
const html = fs.readFileSync('index.html','utf8').split('\n');
const goods = JSON.parse(html.find(l=>l.startsWith('const GOODS=')).replace(/^const GOODS=/,'').replace(/;$/,''));
const stashScript = (fs.readFileSync('src/stash.js','utf8')+'\n'+fs.readFileSync('src/gear-instances.js','utf8'));
const hideoutScript = ['hideout','ward-trial','ration-survey'].map(name=>fs.readFileSync('src/'+name+'.js','utf8')).join('\n');
const ctx = vm.createContext({console, assert, GOODS:goods, FACILITIES:db.hideout.facilities, FACILITY_PRODUCTION:db.hideout.production,
  inside:{addEventListener(){}}, career:{done:[]}, writer:true, crypto:require('node:crypto').webcrypto});
vm.runInContext(`let settlementNeedsCommit=false,stash={},raid=null,field={},wallet=0,now=10000;Date.now=()=>now;
  const money=n=>n+' CR',ico=()=>'',itemSources=()=>'',head=()=>'',esc=s=>s,renderKeep=()=>{},persist=()=>{};
  let facilitySelected='power',facilityTier=1;
  const reconcile=()=>advanceHideout(now);\n` +
  html.find(l=>l.startsWith('function fits('))+'\n'+html.find(l=>l.startsWith('function firstFit('))+'\n'+stashScript+'\n'+hideoutScript,ctx);
vm.runInContext(`
function clone(o){return JSON.parse(JSON.stringify(o))}
function reload(){
 const stock=clone(stash),slots=clone(stashSlots), h=clone(hideout);
 stash=stock;
 loadHideout(h); loadStashLayout(slots);
}
function endAt(deadline){now=deadline-1;assert.equal(advanceHideout(now),false);reload();now++;assert.equal(advanceHideout(now),true);assert.equal(advanceHideout(now),false);reload();assert.equal(advanceHideout(now),false)}
loadHideout(null);loadStashLayout(null);
assert.equal(Object.values(hideout.levels).filter(Boolean).length,0);
assert.equal(hideoutLevel('stash'),0);
assert.match(bunkerHubPage(),/미건설/);
assert.match(facilityBuildStatus('power',1),/자금/);
wallet=999999999;assert.match(facilityBuildStatus('power',1),/재료/);
assert.match(facilityBuildStatus('light',1),/선행/);
assert.match(facilityBuildStatus('power',2),/이전/);
raid={};assert.match(facilityBuildStatus('power',1),/귀환/);raid=null;
let built=0, produced=0;
for(let tier=1;tier<=3;tier++){
 for(const [id,f] of Object.entries(FACILITIES)){
  const step=f.levels[tier-1];
  for(const [id,qty] of Object.entries(step.materials))addStashGoods(id,qty);
  let expected=clone(stash);for(const [id,qty] of Object.entries(step.materials))expected[id]-=qty;
  const oldWallet=wallet,lv=hideoutLevel(id);
  facilitySelected=id;facilityTier=tier;
  assert.equal(facilityBuildStatus(id,tier),'',id);
  assert.ok(bunkerFacilityDetail().includes('건설비'));
  handleHideout({hideout:'build',id,tier});
  assert.equal(hideoutLevel(id),lv);
  for(const [id,count] of Object.entries(expected))assert.equal(stashCount(id),count);
  const end=hideout.builds[id].end;
  assert.equal(end,now+step.durationMinutes*60000);
  assert.equal(wallet,oldWallet-step.costCR);
  handleHideout({hideout:'build',id,tier});assert.equal(wallet,oldWallet-step.costCR);assert.equal(hideout.builds[id].end,end);
  if(id==='power'&&tier===1){assert.match(facilityBuildStatus('stash',1),/동시/);}
  endAt(end);
  assert.equal(hideoutLevel(id),tier);assert.match(facilityBuildStatus(id,tier),/완료/);
  built++;
 }
}
for(const [id,routes] of Object.entries(FACILITY_PRODUCTION)){
 assert.equal(routes.length,3);assert.equal(hideoutLevel(id),3);
 for(const [index,recipe] of routes.entries()){
  for(const [g,qty] of Object.entries(recipe.inputs)){assert.ok(GOODS[g]);addStashGoods(g,qty)}
  const expected=clone(stash),oldWallet=wallet;
  for(const [g,q] of Object.entries(recipe.inputs))expected[g]-=q;
  for(const [g,q] of Object.entries(recipe.outputs||{})){assert.ok(GOODS[g]);expected[g]=(expected[g]||0)+q;}
  raid={};assert.match(productionStatus(id,index),/귀환/);raid=null;
  handleHideout({hideout:'produce',id,recipe:index});
  const end=hideout.production[id].end;
  assert.equal(end,now+Math.round(recipe.minutes*60000*.85));
  handleHideout({hideout:'produce',id,recipe:index});
  assert.equal(hideout.production[id].end,end);
  endAt(end);
  for(const [g,quantity] of Object.entries(expected))assert.equal(stashCount(g),quantity);
  assert.equal(wallet,oldWallet+(recipe.reward||0));
  produced++;
 }
}
assert.equal(built,54);assert.equal(produced,39);
assert.equal(hideoutLevel('stash'),3);assert.equal(stashSize().join('x'),'6x56');
assert.equal(adjustHideoutActionMs('scan',4000),3040);assert.equal(adjustHideoutActionMs('move',8000),6800);
assert.equal(hideoutRecoveryBonus('hp'),9);assert.equal(hideoutRecoveryBonus('energy'),9);assert.equal(hideoutRecoveryBonus('water'),9);
assert.equal(hideout.history.length,5);
console.log('PASS: 54 construction tiers, 39 production orders, all material and credit transactions, prerequisites, timed completion, time boundaries, duplicate actions, save/reload, reserve inventory and facility perks.');
`,ctx);
