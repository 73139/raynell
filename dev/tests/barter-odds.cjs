// Compare a state-compressed forecast with independent enumeration (no masks, grouping or caching)
// and the actual stochastic container generator from the built release.
const {assert,boot,clone}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const b=boot(),g=b.g;
const count=(n,weight)=>({count:n,relativeProbability:weight});
const loot=(tpl,weight)=>({tpl,relativeProbability:weight});
function close(a,b,description){
  assert.ok(Math.abs(a-b)<1e-12,description+' '+a+' vs '+b);
}
function enumerate(table,target,goods){
  const [cols,rows]=table.size,counts=table.itemcountDistribution;
  const countTotal=counts.reduce((n,r)=>n+r.relativeProbability,0);
  let first=0,whole=0;
  function visit(filled,left,pathWeight,firstDraw){
    if(!left)return;
    const choices=[];
    for(const row of table.itemDistribution){
      const [,w,h]=goods[row.tpl];
      let chosen=null;
      for(const [width,height] of [[w,h],[h,w]]){
        for(let y=0;!chosen&&y<=rows-height;y++){
          for(let x=0;!chosen&&x<=cols-width;x++){
            const cells=[];
            for(let j=y;j<y+height;j++)for(let i=x;i<x+width;i++)cells.push(j*cols+i);
            if(cells.every(cell=>!filled.includes(cell)))chosen=cells;
          }
        }
        if(chosen)break;
      }
      if(chosen)choices.push({row,cells:chosen});
    }
    const weight=choices.reduce((n,c)=>n+c.row.relativeProbability,0);
    for(const {row,cells} of choices){
      const next=pathWeight*row.relativeProbability/weight;
      if(row.tpl===target){whole+=next;if(firstDraw)first+=next;}
      else visit([...filled,...cells],left-1,next,false);
    }
  }
  for(const r of counts)visit([],r.count,r.relativeProbability/countTotal,true);
  return {first,whole};
}
const items={bar:['bar',2,1],upright:['upright',1,2],chip:['chip',1,1],square:['square',2,2],wide:['wide',3,2]};
function synthetic(size,counts,itemsTable,target,firstExpected,wholeExpected){
  const t={size,itemcountDistribution:counts,itemDistribution:itemsTable};
  const actual=g.huntCalculateOdds(t,target,items),oracle=enumerate(t,target,items);
  close(actual.first,oracle.first,'enumerated first');close(actual.whole,oracle.whole,'enumerated full box');
  if(firstExpected!=null)close(actual.first,firstExpected,'hand-calculated first');
  if(wholeExpected!=null)close(actual.whole,wholeExpected,'hand-calculated full box');
}
synthetic([2,1],[count(0,1),count(2,3)],[loot('bar',1),loot('chip',1)],'bar',.375,.375);
synthetic([2,2],[count(2,1)],[loot('bar',1),loot('upright',1)],'bar',.5,.75);
synthetic([3,1],[count(0,1),count(3,3)],[loot('bar',1),loot('chip',3)],'chip');
synthetic([2,3],[count(0,2),count(2,3),count(5,4)],
  [loot('wide',2),loot('bar',3),loot('upright',1),loot('square',2),loot('chip',4),loot('bar',1)],'bar');
synthetic([1,1],[count(2,4)],[loot('bar',2)],'bar',0,0);
synthetic([2,1],[count(0,1)],[loot('chip',1)],'chip',0,0);
synthetic([3,2],[count(2,1)],[loot('chip',1)],'wide',0,0);
console.log('PASS hand calculations and independent row-by-row enumeration with empty counts, blocked placements, mandatory rotation, shape aliases, orientation priority, duplicate weights and mixed draw counts.');

const targets=new Set(['rl_x_fabric','rl_x_mesh','rl_x_circuit','rl_x_core','cloth']);
const pairs=[];
for(const [key,table] of Object.entries(db.containers)){
  const included=[...new Set(table.itemDistribution.filter(r=>targets.has(r.tpl)).map(r=>r.tpl))];
  if(included.length)pairs.push({key,table,targets:included});
}
const started=performance.now(),moments=[];
for(const {key,table,targets:ids} of pairs){
  for(const item of ids){
    const began=performance.now(),odds=g.huntContainerOdds(key,item);
    moments.push(performance.now()-began);
    assert.equal(odds,g.huntContainerOdds(key,item),'same material and table reuses the cached result');
    assert.ok(odds.whole>=odds.first && odds.whole<=1);
    const [cols,rows]=table.size;
    const eligible=table.itemDistribution.filter(r=>{
      const m=db.items[r.tpl];
      return m.width<=cols&&m.height<=rows || m.height<=cols&&m.width<=rows;
    });
    const weight=rs=>rs.reduce((n,r)=>n+r.relativeProbability,0);
    const first=weight(table.itemcountDistribution.filter(r=>r.count>0))/weight(table.itemcountDistribution)*
      weight(eligible.filter(r=>r.tpl===item))/weight(eligible);
    close(odds.first,first,'previous map definition preserved '+key+'/'+item);
  }
}
console.log('PERF 15 released table/item combinations, one cold forecast each. Total '+(performance.now()-started).toFixed(2)+' ms, slowest '+Math.max(...moments).toFixed(2)+' ms.');
const before=JSON.stringify(g.s);
const trials=6000;
let tests=0;
for(const {key,targets:ids} of pairs){
  const mapped=g.areas.map((z,zi)=>[zi,z.boxes.findIndex(def=>def[2]===key)]).find(coord=>coord[1]>=0);
  assert.ok(mapped,'real reachable box for '+key);
  const sampled=Object.fromEntries(ids.map(id=>[id,{first:0,whole:0}]));
  for(let i=0;i<trials;i++){
    const items=g.makeBox(...mapped).items;
    for(const target of ids){
      if(items[0]?.g===target)sampled[target].first++;
      if(items.some(u=>u.g===target))sampled[target].whole++;
    }
  }
  for(const id of ids){
    const expected=g.huntContainerOdds(key,id);
    for(const field of ['first','whole']){
      const p=expected[field],observed=sampled[id][field]/trials;
      const tolerance=5*Math.sqrt(p*(1-p)/trials)+1/trials;
      assert.ok(Math.abs(p-observed)<=tolerance,key+'/'+id+'/'+field+' forecast '+p+' sample '+observed);
      tests++;
    }
  }
}
assert.equal(JSON.stringify(g.s),before,'random QA samples and catalog forecasts must not mutate player inventory, raid or save');
console.log('PASS '+trials*pairs.length+' independently generated production boxes, '+pairs.length+' real tables, '+tests+' first/whole comparisons within 5 binomial standard errors. Stateless run preserved the player snapshot.');
