import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {PNG} from 'pngjs';
import {makeMapCatalog,tileRectangle} from './map-assets-core.mjs';
import {worldToMap} from '../website/geo-core.mjs';
import {buildFloorOptions} from '../website/floor-core.mjs';
const root=path.resolve(import.meta.dirname,'..'),read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const upstream=read('scripts/maps-upstream.json'),catalog=read('website/maps-source.json'),manifest=read('website/maps/latest/manifest.json');
assert.deepEqual(catalog,makeMapCatalog(upstream));assert.equal(catalog.maps.length,13);
assert.equal(manifest.maps.length,13);assert.equal(manifest.revision,catalog.revision);
const expected=['ground-zero','customs','woods','shoreline','interchange','reserve','lighthouse','streets-of-tarkov','factory','the-lab','the-labyrinth','icebreaker','terminal'].sort();
assert.deepEqual(catalog.maps.map(g=>g.normalizedName).sort(),expected);
assert.equal(catalog.maps.filter(g=>g.maps[0].floorAssets).length,10);
let floorCount=0;
for(const group of catalog.maps){
 const c=group.maps[0],original=upstream.find(g=>g.normalizedName===group.normalizedName).maps.find(c=>c.projection==='interactive');
 const floors=buildFloorOptions(c);floorCount+=floors.length;
 assert.ok(c.svgPath.startsWith('./maps/latest/'));assert.ok(c.assetRevision);
 if(c.floorAssets){
  assert.deepEqual(c.svgBounds,c.bounds);assert.deepEqual(c.transform,original.transform);
  const r=tileRectangle(c,c.bundleZoom),[width,height]=c.bundleSize;
  assert.ok(Math.abs(width-r.width)<1&&Math.abs(height-r.height)<1);
  const bitmap=PNG.sync.read(fs.readFileSync(path.join(root,'website',c.svgPath)));
  assert.equal(bitmap.width,width);assert.equal(bitmap.height,height);
  let visible=0;for(let i=3;i<bitmap.data.length;i+=4)if(bitmap.data[i])visible++;
  assert.ok(visible>width*height*.01,'Map cannot be an empty tile sheet: '+group.normalizedName);
  for(const floor of floors)assert.ok(fs.existsSync(path.join(root,'website',c.floorAssets[floor.id])),'Missing floor '+group.normalizedName+'/'+floor.id);
  // Independently apply the published Leaflet CRS and compare raster positions
  // with the same public world points used by quest/spawn/route overlays.
  for(const [u,v]of [[0,0],[1,0],[0,1],[1,1],[.27,.68]]){
   const x=c.bounds[0][0]*(1-u)+c.bounds[1][0]*u,z=c.bounds[0][1]*(1-v)+c.bounds[1][1]*v;
   const angle=c.coordinateRotation*Math.PI/180,rx=x*Math.cos(angle)-z*Math.sin(angle),rz=x*Math.sin(angle)+z*Math.cos(angle);
   const px=(c.transform[0]*rx+c.transform[1])*2**c.bundleZoom,py=(-c.transform[2]*rz+c.transform[3])*2**c.bundleZoom,p=worldToMap({x,z},c);
   assert.ok(Math.abs(p.u*width-(px-r.left))<1);assert.ok(Math.abs(p.v*height-(py-r.top))<1);
  }
 }
}
assert.equal(floorCount,55);assert.equal(buildFloorOptions(catalog.maps.find(g=>g.normalizedName==='icebreaker').maps[0]).length,16);
for(const [file,sha]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'website/maps/latest',file))).digest('hex'),sha,file);
const btr=read('website/raid-intel.json');let stops=0;
for(const [key,map]of Object.entries(btr.maps)){const c=catalog.maps.find(g=>g.normalizedName===key).maps[0];for(const stop of map.stops){assert.equal(worldToMap(stop.position,c).inBounds,true,key+'/'+stop.id);stops++;}}
console.log(`PASS all 13 bundled maps, ${floorCount} real floor planes, 10 detailed maps, ${Object.keys(manifest.files).length} image hashes, pixel-aligned CRS and ${stops} BTR stops inside current map bounds`);
