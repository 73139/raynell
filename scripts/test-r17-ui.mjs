import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><head></head><body><div class="tactical-tools-panel"></div><button id="open-ops"></button><button id="open-recommended-routes"></button><button id="open-intel-list"></button></body></html>',{url:'https://example.org/'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.navigator=dom.window.navigator;
globalThis.fetch=async()=>({ok:true,json:async()=>({routes:[]})});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {initializeR17}=await import('../website/r17-ui.mjs');
let opened=null;
const api=initializeR17({
 getMap:()=>({key:'customs',name:'세관'}),
 getConfig:()=>({}),
 getPlayer:()=>null,
 getCapture:()=>null,
 getAutoMap:()=>true,
 getExits:()=>[],
 getPoints:()=>[],
 getCatalog:()=>({items:[]}),
 getLogStatus:()=>null,
 openOperations:tab=>{opened=tab;},
 showMap:()=>{opened='map';},
 refreshData:()=>{opened='data';}
});
assert.ok(document.querySelector('#open-r17'));
document.querySelector('#open-r17').click();
assert.ok(document.querySelector('#r17-dialog').open);
assert.match(document.querySelector('#r17-content').textContent,/마지막 촬영 위치/);
const clickTab=tab=>{document.querySelector('[data-r17-tab="'+tab+'"]').click();return document.querySelector('#r17-content').textContent;};
assert.match(clickTab('routes'),/탈출구 후보/);
assert.match(clickTab('economy'),/플리/);
document.querySelector('#r17-trader').value='10000';
document.querySelector('#r17-flea').value='14000';
document.querySelector('#r17-fee').value='2000';
document.querySelector('[data-r17-action="compare-price"]').click();
assert.match(document.querySelector('#r17-sale-result').textContent,/플리마켓/);
assert.match(clickTab('hideout'),/은신처/);
document.querySelector('[data-r17-action="open-hideout"]').click();
assert.equal(opened,'hideout');
api.open();
assert.match(clickTab('farming'),/파밍/);
assert.match(clickTab('diagnostics'),/자동 진단/);
console.log('PASS R17 panel tabs, economy inputs and navigation');
