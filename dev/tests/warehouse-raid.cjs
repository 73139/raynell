const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const htmlPath=process.argv[2]||'index.html';
const html=fs.readFileSync(htmlPath,'utf8');
const js=html.match(/<script>([\s\S]+?)<\/script>/)[1];
const noop=()=>{};
function mockTarget() {
  const listeners={},attributes=new Map();
  return {innerHTML:'',style:{},dataset:{},scrollTop:0,hidden:false,isConnected:true,
    addEventListener(n,fn){(listeners[n]??=[]).push(fn);},
    dispatch(n,event){for(const cb of listeners[n]||[])cb(event);},
    classList:{toggle:noop,add:noop,remove:noop},focus:noop,scrollIntoView:noop,
    animate:()=>({finished:Promise.resolve(),cancel:noop}),
    setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),hasAttribute:k=>attributes.has(k)};
}
const store=new Map(), now=1780000000000;let time=now;
class Clock extends Date { static now(){return time;} }
function browser(){
 const page=new Map(),window=mockTarget(),document=mockTarget(),clock=[];
 const by=sel=>{if(!page.has(sel))page.set(sel,mockTarget());return page.get(sel);};
 document.documentElement=mockTarget();document.querySelector=by;document.querySelectorAll=()=>[];document.activeElement=mockTarget();
 const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 vm.runInNewContext(js,{Date:Clock,window,document,localStorage,navigator:{},Object,URL,Blob,confirm:()=>true,
  crypto:require('node:crypto').webcrypto,innerWidth:390,innerHeight:844,matchMedia:()=>({matches:true}),
  setTimeout:noop,clearTimeout:noop,setInterval:f=>clock.push(f),console});
 const click=(el,dataset)=>{
   const element={...mockTarget(),dataset,closest:(selector)=>selector==='button' || selector==='button[data-stash]' && dataset.stash ? element:null};
   by(el).dispatch('click',{target:element});
 };
 async function launch(key='bunker'){click('#world',{launch:key});await new Promise(setImmediate);}
 function route(){return by('.content').innerHTML;}
 return {launch,rendered:route,click:(d)=>click('#inside',d),tick:()=>clock.forEach(f=>f())};
}
const save=()=>JSON.parse(store.get('rl-reboot-session-v36'));
(async()=>{
 const legacy={raid:null,field:null,stash:{water:1,wire:270,radio:1},wallet:30000,lastSummary:null};
 store.set('rl-reboot-session-v09',JSON.stringify(legacy));let b=browser();await b.launch();b.click({page:'stash'});
 assert.match(b.rendered(),/입고 대기/);let s=save();
 assert.deepEqual(s.stash,legacy.stash);assert.ok(s.stashSlots.length<272);
 const pickUnit=id=>{const uid=save().stashSlots.find(x=>x.g===id).uid;b.click({stash:'select',id,uid});return uid;};
 let uid=pickUnit('water');b.click({gear:'pack',id:'water',unit:uid});
 uid=pickUnit('radio');b.click({gear:'wear-stash',id:'radio',unit:uid});assert.equal(save().equipment.worn.comms,'radio');
 uid=pickUnit('wire');b.click({stash:'sell'});b.click({stash:'sell'});
 s=save();assert.equal(s.wallet,32500);assert.deepEqual(s.stash,{wire:269});
 b.click({stash:'select',id:'wire',uid:'overflow'});b.click({stash:'place',x:'0',y:'0'});assert.deepEqual(save().stash,{wire:269});
 const slots=JSON.stringify(s.stashSlots);b=browser();await b.launch();b.click({page:'stash'});
 assert.match(b.rendered(),/269개/);b.click({page:'inventory'});assert.match(b.rendered(),/무전기/);
 b.click({page:'map'});b.click({raid:'start'});s=save();assert.equal(s.field.worn.comms,'radio');assert.equal(s.field.bag[0].g,'water');
 b=browser();await b.launch('continue');assert.match(b.rendered(),/B-04 지하 벙커/);
 b.click({field:'extract',exit:'b04'});assert.equal(save().field.action.type,'extract');
 time+=10001;b.tick();s=save();assert.deepEqual(s.stash,{wire:269,water:1});assert.equal(s.lastSummary.rating,'quick');assert.equal(s.equipment.worn.comms,'radio');
 b.tick();b=browser();await b.launch('continue');b.click({raid:'ack'});b.click({page:'stash'});assert.deepEqual(save().stash,{wire:269,water:1});assert.match(b.rendered(),/벙커 창고/);
 console.log('PASS full v0.11 IIFE with simulated DOM/clock/localStorage: launcher click, legacy source untouched, full-warehouse reserve, sale single debit, packing and radio equipment, current raid reload, actual extraction action and settlement, ack and unique final stash.');
 assert.equal(JSON.stringify(legacy),store.get('rl-reboot-session-v09'));
})().catch(e=>{console.error(e);process.exitCode=1});
