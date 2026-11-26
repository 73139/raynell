const {assert,boot,clone}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const b=boot(),g=b.g;
const before=JSON.stringify(g.s),start=performance.now();
let sourceItems=0,noSource=0,physicalRows=0,maxMs=0;
for(const [id,item] of Object.entries(db.items)){
  const regions=g.huntRegions(id);
  const expected=new Map();
  for(const [zone,places] of g.places.entries())for(const place of places)for(const index of place.boxes){
    const [name,,tableId]=g.areas[zone].boxes[index],table=db.containers[tableId];
    const fits=(item.width<=table.size[0]&&item.height<=table.size[1])||(item.height<=table.size[0]&&item.width<=table.size[1]);
    if(fits&&table.itemcountDistribution.some(x=>x.count>0&&x.relativeProbability>0)&&table.itemDistribution.some(x=>x.tpl===id&&x.relativeProbability>0))expected.set(zone+'-'+index,name);
  }
  assert.equal(Boolean(g.catalogFieldDisclosure(id)),expected.size>0,id+' availability');
  const now=performance.now(),html=g.catalogFieldMarkup(id,regions);
  maxMs=Math.max(maxMs,performance.now()-now);
  const found=Array.from(html.matchAll(/data-catalog-box="([\d-]+)"/g),m=>m[1]);
  assert.deepEqual(found.sort(),Array.from(expected.keys()).sort(),id+' must match only assigned positive-weight, fitting map cases');
  for(const name of expected.values())assert.ok(html.includes(name));
  if(expected.size){sourceItems++;physicalRows+=expected.size;}else noSource++;
}
const filter=g.catalogFieldMarkup('filter',g.huntRegions('filter'));
assert.equal((filter.match(/13\.66%/g)||[]).length,3);assert.equal((filter.match(/열쇠 불필요/g)||[]).length,3);
for(const name of ['송전탑 점검소','전력반 자재 상자','도로통제 창고','차단벽 자재함','하역 도크','산업용 자재 상자'])assert.ok(filter.includes(name));
const medic=g.huntRegions('bandage'),mixed=g.catalogFieldMarkup('bandage',medic);
assert.ok(mixed.includes('검역실 열쇠 필요'));assert.ok(!mixed.includes('모든 후보'));
const locked=clone(medic).map(region=>({...region,landmarks:region.landmarks.map(point=>({...point,boxes:point.boxes.filter(box=>box.keyId)})).filter(point=>point.boxes.length)}));
assert.ok(g.catalogFieldMarkup('bandage',locked).includes('모든 후보에 열쇠가 필요'));
assert.equal(g.catalogFieldDisclosure('rl_craft_dressing'),'');
assert.equal(g.catalogFieldDisclosure('cr_notes'),'');
assert.equal(JSON.stringify(g.s),before);
console.log(`PASS ${sourceItems} searchable + ${noSource} without sources, ${physicalRows} verified item/case pairs, keys (mixed and all-locked), filter and craft-only; full catalog incl. oracle ${(performance.now()-start).toFixed(0)} ms, slowest individual odds markup ${maxMs.toFixed(1)} ms.`);
