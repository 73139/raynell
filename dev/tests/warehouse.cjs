const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const db = JSON.parse(fs.readFileSync('Rustline_Database_v10.json','utf8'));
const html = fs.readFileSync('index.html','utf8').split('\n');
const fits = html.find(l=>l.startsWith('function fits('));
const firstFit=html.find(l=>l.startsWith('function firstFit('));
const goods=Object.fromEntries(Object.entries(db.items).map(([id,g])=>[id,[g.name,g.width,g.height,g.weight,'tool',g.category,g.valueCR||2000]]));
const ctx=vm.createContext({GOODS:goods,assert,console,inside:{addEventListener(){}},crypto:require('node:crypto').webcrypto});
vm.runInContext(`let stash={},raid=null,field=null,wallet=100,hidden=0,persisted=0,rendered=0;function hideoutLevel(){return hidden} function money(n){return n+' CR'}function persist(){persisted++}function renderKeep(){rendered++}\n`+fits+'\n'+firstFit+'\n'+(fs.readFileSync('src/stash.js','utf8')+'\n'+fs.readFileSync('src/gear-instances.js','utf8')),ctx);
vm.runInContext(`
function invariants() {
  assert.equal(new Set(stashSlots.map(s=>s.uid)).size,stashSlots.length);
  for(const s of stashSlots) {
    assert.ok(fits(stashSlots,stashSize(),s.x,s.y,s.w,s.h,s.uid));
    const [,w,h]=GOODS[s.g];
    assert.ok((w===s.w&&h===s.h)||(w===s.h&&h===s.w));
    assert.ok(stashCount(s.g)>0);
  }
  for(const id of Object.keys(stash)) assert.ok(stashOverflowCount(id)>=0);
}
stash={water:100000,wire:3,fuel:2};loadStashLayout(null);invariants();
assert.deepEqual(stash,{water:100000,wire:3,fuel:2});assert.ok(stashOverflowCount('water')>0);
const slots=JSON.stringify(stashSlots);loadStashLayout(JSON.parse(slots));assert.equal(JSON.stringify(stashSlots),slots);
let oldN=stashSlots.length;addStashGoods('water', 5);assert.equal(stash.water,100005);assert.equal(stashSlots.length,oldN);
let oldOverflow=stashOverflowCount('water');assert.ok(takeStashGoods('water',1,'overflow'));assert.equal(stashOverflowCount('water'),oldOverflow-1);
let chosen=stashSlots.find(s=>s.g==='water');assert.ok(takeStashGoods('water',1,chosen.uid));assert.ok(!takeStashGoods('water',1,chosen.uid));assert.equal(stashSlots.length,oldN-1);
assert.equal(stashConsume({water:1,fuel:500}),false);assert.equal(stash.water,100003);
assert.ok(stashConsume({fuel:2,wire:3}));assert.equal(stash.fuel,undefined);assert.equal(stash.wire,undefined);
stashSelection={id:'water',uid:'overflow',rot:false};assert.equal(arrangeStashUnit(-1,1),false);assert.equal(arrangeStashUnit(0,0,true),true);
let count=stash.water,shopCounter=wallet;let sale=stashSlots[0];stashSelection={id:sale.g,uid:sale.uid,rot:false};handleStash({stash:'sell'});handleStash({stash:'sell'});assert.equal(wallet,shopCounter+stashSalePrice(sale.g));assert.equal(stash.water,count-1);assert.equal(persisted,1);
raid={};field={result:null};sale=stashSlots[0];stashSelection={id:sale.g,uid:sale.uid,rot:false};handleStash({stash:'sell'});assert.equal(stash.water,count-1);assert.equal(persisted,1);raid=null;
let old=stashSlots.length;hidden=1;refreshStashLayout();assert.ok(stashSlots.length>old);invariants();
stash={water:3};let a=GOODS.water;loadStashLayout([{uid:'s-good',g:'water',x:0,y:0,w:a[1],h:a[2]},{uid:'s-dupe',g:'water',x:0,y:0,w:a[1],h:a[2]},{uid:'s-bad',g:'water',x:-1,y:-1,w:a[1],h:a[2]}]);assert.equal(stashSlots.length,1);assert.equal(stashOverflowCount('water'),2);invariants();
stash={};loadStashLayout();hidden=0;
const ids=Object.keys(GOODS);
let rng=42;const rand=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32);
for(let turn=0;turn<1200;turn++){
 let id=ids[Math.floor(rand()*ids.length)], n=1+Math.floor(rand()*3);
 let op=Math.floor(rand()*7);
 if(op<3) addStashGoods(id,n);
 else if(op===3) takeStashGoods(id,n);
 else if(op===4 && stashSlots.length){let u=stashSlots[Math.floor(rand()*stashSlots.length)];stashSelection={id:u.g,uid:u.uid,rot:rand()>.5};arrangeStashUnit(Math.floor(rand()*6),Math.floor(rand()*stashSize()[1]))}
 else if(op===5) stashConsume({[id]:n});
 else if(op===6) loadStashLayout(JSON.parse(JSON.stringify(stashSlots)));
 invariants();
}
console.log('PASS — stash migration including 100000 units, layout round trip, overflow/deposits, atomic consumption, UID checks, selling, double-click, raid restriction, expansion, overlap recovery, and 1200 randomized transactions.');
`,ctx);
