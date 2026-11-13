import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractBossIntel} from '../website/r12-core.mjs';
import {normalizeDataset} from '../website/data.mjs';
import {collectMapIntel,describeBosses} from '../website/map-intel-core.mjs';
import {buildKappaLine,validRoutePoints} from '../website/guide-core.mjs';
const raw={id:'test-customs',normalizedName:'customs',name:'Customs',bosses:[{mob:'bossBully',spawnLocations:[
 {name:'ZoneScavBase',positions:[{x:125,y:1,z:-146},{x:103,y:1,z:-114}]},
 {name:'ZoneDormitory',positions:[]},
 {name:'UnknownZone',positions:[]},
]}],spawns:[{position:{x:1,y:0,z:2},sides:['pmc'],categories:['player']},{position:{x:3,y:0,z:4},sides:['scav'],categories:['bot']},{position:{x:5,y:0,z:6},sides:['all'],categories:['player']}]};
assert.equal(extractBossIntel(raw,{bossBully:{id:'bossBully',name:'bossBully'}})[0].locations[0].positions.length,2);
const normalized=normalizeDataset({mode:'regular',maps:{data:{maps:[raw],mobs:{bossBully:{id:'bossBully',name:'bossBully'}}}},mapsKo:{bossBully:'르샬라'},mapsEn:{bossBully:'Reshala'},tasks:{tasks:[]},traders:{traders:[]}});
const map=normalized.maps[0];assert.equal(map.bosses[0].name,'르샬라');
const rows=collectMapIntel(map,{key:'customs',labels:[{text:'Dorms',position:[200,150]}]});
const bosses=rows.filter(r=>r.type==='boss');assert.equal(bosses.length,3);
assert.ok(bosses.some(r=>r.position.x===125&&r.position.z===-146&&!r.area));
assert.ok(bosses.some(r=>r.area&&r.position.x===200&&r.position.z===150));
assert.ok(!bosses.some(r=>r.label.includes('UnknownZone')),'Never invent a pin for an unlocated zone');
assert.equal(describeBosses(map)[0].hasCoordinates,true);
for(const kind of ['pmc','scav','other'])assert.equal(rows.filter(r=>r.type===kind).length,1);
console.log('PASS real public boss schema: mob reference, translated name, positions array, area fallback and PMC/Scav/shared spawn classification');
const tasks=[{id:'a',name:'First',kappaRequired:true,requirements:[]},{id:'b',name:'Prerequisite',kappaRequired:false,requirements:[{taskId:'a'}]},{id:'c',name:'Last',kappaRequired:true,requirements:[{taskId:'b'}]}];
const line=buildKappaLine(tasks,id=>id==='a'?'done':'todo');
assert.deepEqual(line.rows.map(r=>r.task.id),['a','b','c']);assert.equal(line.required,2);assert.equal(line.done,1);assert.equal(line.rows[2].blocked,true);
assert.equal(buildKappaLine([{id:'a',kappaRequired:true,requirements:[{taskId:'a'}]}]).cycles.length,1);
console.log('PASS Kappa dependency order, unflagged prerequisites, completion count and cycle guard');
const data=JSON.parse(fs.readFileSync(new URL('../website/recommended-routes.json',import.meta.url)));
assert.equal(data.routes.length,11);assert.equal(new Set(data.routes.map(r=>r.map)).size,7);
for(const route of data.routes){assert.ok(validRoutePoints(route).length>=3);assert.ok(route.sources.every(s=>new URL(s.url).protocol==='https:'));}
console.log('PASS 11 sourced farming routes on 7 maps with finite landmark coordinates');
