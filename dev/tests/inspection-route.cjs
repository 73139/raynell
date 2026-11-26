const {assert,boot,clone,extract,move,valid}=require('./game-fixture.cjs');
const jobs='handover-ledgers',cases=[
  {origin:0,path:'0,1,0',sequence:['0-17','1-6'],legs:2,cells:2,ms:15000,chance:'17.2%'},
  {origin:1,path:'1,0',sequence:['1-6','0-17'],legs:1,cells:1,ms:7000,chance:'8%'},
  {origin:2,path:'2,1,0',sequence:['1-6','0-17'],legs:2,cells:3,ms:21000,chance:'52.3%'}
];
function planning(order=jobs){
  const b=boot();b.g.order(order);b.g.pin({kind:'order',id:order});return b;
}
function itinerary(b,screen='prep'){
  b.click({page:screen});
  return b.content().match(/<section data-inspection-route[^>]*>[\s\S]*?<\/section>/)?.[0]||'';
}
function checkTravel(){
  for(const rest of [0,2])for(const row of cases){
    const b=planning(),g=b.g;
    g.s.hideout.levels.rest=rest;
    b.click({page:'map'});b.click({cui:'inspect',index:String(row.origin)});
    const state=clone(g.s);
    for(const screen of ['map','prep']){
      const panel=itinerary(b,screen);
      for(const [attr,value] of Object.entries({origin:row.origin,path:row.path,legs:row.legs,cells:row.cells,'walk-ms':row.ms*(1-.05*rest)})){
        assert.ok(panel.includes('data-'+attr+'="'+value+'"'),attr+': '+panel);
      }
      assert.ok(panel.includes(row.chance));
      assert.deepEqual(Array.from(b.content().matchAll(/data-inspection-box="([^"]+)"/g),m=>m[1]),row.sequence);
      assert.deepEqual(clone(g.s),state);
    }
    g.start();assert.equal(g.s.raid.zone,row.origin);
    assert.ok(g.s.field.exits.includes('b04'));
    assert.doesNotMatch(itinerary(b,'map'),/data-inspection-route/);
    const t=b.clock.now;
    for(const z of row.path.split(',').slice(1))move(b,Number(z));
    assert.equal(b.clock.now-t,row.ms*(1-.05*rest));
    extract(b);
    assert.doesNotMatch(itinerary(b,'map'),/data-inspection-route/);
    valid(g);
  }
}
function intendedSpawn(){
  for(const mode of ['loot','barter','away']){
    const b=planning(),g=b.g;
    assert.ok(g.setLootGoal('medical').ok);
    assert.ok(g.selectLootDestination(0,7).ok);
    let expected=7,zone=0;
    if(mode==='barter'){
      assert.ok(g.pinBarterHunt('quarter','rl_x_ammo','cloth').ok);
      const at=g.huntRegions('cloth')[0].landmarks.find(s=>s.index!==7&&s.index!==0);
      assert.ok(at);
      assert.ok(g.selectHuntDestination(0,at.index).ok);
      expected=at.index;
    }else if(mode==='away'){zone=1;expected=0;}
    b.click({page:'map'});b.click({cui:'inspect',index:String(zone)});
    const p=itinerary(b);
    assert.ok(p.includes('data-start-landmark="'+expected+'"'));
    g.start();
    assert.equal(g.s.raid.zone,zone);assert.equal(g.s.field.landmarkByZone[zone],expected);valid(g);
  }
}
checkTravel();intendedSpawn();
const other=planning('tower-wire');assert.equal(itinerary(other),'');
const unpinned=planning();unpinned.g.pin(null);assert.equal(itinerary(unpinned,'map'),'');
console.log('PASS 3 origins × 2 rest levels, ordered drawers, real elapsed movement, road-only contact probabilities, prep/map state, scoped visibility, loot and barter spawn precedence, no automatic actions.');
