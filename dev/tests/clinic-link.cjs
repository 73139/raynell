const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const base='https://rustline.example/game/index.html?source=clinic%23share&lang=ko';
const title=(b,name)=>assert.ok(b.content().includes(`<h2>${name}</h2>`));
function browser(profile={},initial='#clinic'){
  const location=new URL(base+initial),state={scroll:15};const replacements=[];
  const history={state,replaceState(nextState,unused,url){
    assert.equal(nextState,state);replacements.push(url);location.href=new URL(url,location).href;
  }};
  const b=boot(profile,undefined,{},initial,{location,history});
  function link(hash){
    if(location.hash===hash)return false;
    location.hash=hash;b.element('window').dispatch('hashchange',{});return true;
  }
  return {b,location,link,replacements};
}
{
  const {b,location,link,replacements}=browser();const original=clone(b.g.s);
  title(b,'의무실');assert.equal(location.hash,'#clinic');assert.deepEqual(replacements,[]);
  b.click({bui:'tier',tier:'2'});b.g.draw();assert.equal(location.hash,'#clinic');
  b.click({bui:'facility',id:'med'});assert.equal(location.hash,'#clinic');
  b.click({bui:'facility',id:'power'});assert.equal(location.href,base);assert.deepEqual(replacements,[base]);
  assert.ok(link('#clinic'));title(b,'의무실');assert.equal(location.hash,'#clinic');
  b.click({page:'bunker'});assert.equal(location.href,base);assert.ok(link('#clinic'));title(b,'의무실');
  b.click({db:'lookup',id:'gauze'});assert.equal(location.href,base);assert.equal(b.element('.content').dataset.view,'catalog');
  assert.ok(link('#clinic'));title(b,'의무실');
  for(const [hash,page] of [['#shop','trade'],['#map','map']]){
    assert.ok(link(hash));assert.equal(b.element('.content').dataset.view,page);assert.equal(location.href,base+hash);
    b.click({page:'home'});assert.equal(location.href,base);assert.ok(link('#clinic'));title(b,'의무실');
  }
  assert.deepEqual(replacements,[base,base,base,base,base]);assert.deepEqual(clone(b.g.s),original);valid(b.g);
}
{
  const seed=boot();seed.g.start();const live=clone(seed.g.s);
  const {b,location,link}=browser({[v12]:live});const before=clone(b.g.s);
  title(b,'의무실');b.click({bui:'facility',id:'water'});assert.equal(location.href,base);
  assert.ok(link('#clinic'));title(b,'의무실');assert.deepEqual(clone(b.g.s),before);valid(b.g);
}
{
  const location=new URL(base+'#clinic');const restricted=boot({},undefined,{},'#clinic',{location,history:{replaceState(){throw Error('restricted frame');}}});
  title(restricted,'의무실');restricted.click({page:'map'});assert.equal(restricted.element('.content').dataset.view,'map');
}
console.log('PASS: cold clinic deep link, same URL revisit after leaving, tier continuity, query/history metadata, existing map/shop, active raid and restricted history.');
