import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {initializeMarket} from '../website/market-ui.mjs';
const dom=new JSDOM(fs.readFileSync(new URL('../website/index.html',import.meta.url),'utf8'),{pretendToBeVisual:true});
const original={document:globalThis.document,CustomEvent:globalThis.CustomEvent,fetch:globalThis.fetch,setInterval:globalThis.setInterval};
Object.assign(globalThis,{document:dom.window.document,CustomEvent:dom.window.CustomEvent});
const $=id=>document.getElementById(id),requests=[],intervals=[];
let mode='regular',price=10000;
globalThis.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
globalThis.fetch=async(url,options)=>{
 requests.push({url,cache:options.cache,credentials:options.credentials});
 const path=new URL(url).pathname,endpoint=path.split('/').at(-1),current=path.includes('/pve/')?22000:price;
 const docs={endpoints:{gameModes:['regular','pve']},
 items:{items:[{id:'gold',name:'Gold item',types:['barter'],lastLowPrice:current,avg24hPrice:9000,updated:'2026-11-13T10:00:00Z',sellFor:[{vendor:{name:'Prapor'},price:4000,priceRUB:4000,currency:'RUB'}]},
 {id:'ammo',name:'Ammo item',types:['ammo'],lastLowPrice:5000,updated:'2026-11-13T10:00:00Z'}]},
 items_ko:{'Gold item':'검증용 귀중품','Ammo item':'검증용 탄약'},items_en:{},traders:{traders:[]},traders_ko:{},traders_en:{}};
 assert.ok(Object.hasOwn(docs,endpoint),endpoint);
 return new Response(JSON.stringify(docs[endpoint]),{status:200});
};
async function waitFor(check){const until=Date.now()+3000;while(Date.now()<until){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Market did not settle: '+$('market-results').textContent);}
function event(id,name='change'){$(id).dispatchEvent(new dom.window.Event(name,{bubbles:true}));}
try{
 const market=initializeMarket({getMode:()=>mode});market.setActive(true);
 await waitFor(()=>$('market-results').textContent.includes('10,000'));
 assert.equal(document.querySelectorAll('#market-results tr').length,2);
 $('market-search').value='탄약';event('market-search','input');assert.equal(document.querySelectorAll('#market-results tr').length,1);assert.match($('market-results').textContent,/5,000/);
 $('market-search').value='';event('market-search','input');$('market-sort').value='price-desc';event('market-sort');assert.match(document.querySelector('#market-results tr').textContent,/10,000/);
 $('market-sort').value='price-asc';event('market-sort');assert.match(document.querySelector('#market-results tr').textContent,/5,000/);
 $('market-category').value='barter';event('market-category');assert.equal(document.querySelectorAll('#market-results tr').length,1);$('market-reset-categories').click();
 price=12000;$('refresh-market').click();await waitFor(()=>$('market-results').textContent.includes('12,000'));
 price=14000;for(const timer of intervals.filter(t=>t.ms===60000))timer.fn();await waitFor(()=>$('market-results').textContent.includes('14,000'));
 $('auto-market').checked=false;event('auto-market');const stopped=requests.length;for(const timer of intervals.filter(t=>t.ms===60000))timer.fn();assert.equal(requests.length,stopped);
 assert.match($('market-status').textContent,/수동 갱신/);
 price=16000;$('auto-market').checked=true;event('auto-market');await waitFor(()=>$('market-results').textContent.includes('16,000'));
 mode='pve';market.setMode();await waitFor(()=>$('market-results').textContent.includes('22,000'));assert.match($('market-status').textContent,/PvE/);assert.ok(!/16,000/.test($('market-results').textContent));
 market.setActive(false);const inactive=requests.length;for(const timer of intervals.filter(t=>t.ms===60000))timer.fn();assert.equal(requests.length,inactive);
 assert.ok(requests.filter(r=>r.url.endsWith('/items')).every(r=>r.cache==='no-cache'&&r.credentials==='omit'));
 console.log('PASS flea market: Korean search, category and price sorting, manual refresh, 60-second polling, pause/resume, PvE isolation and inactive polling stop');
}finally{Object.assign(globalThis,original);dom.window.close();}
