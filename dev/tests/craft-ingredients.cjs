// Real facility and catalog button dispatch from the shipped single-file build.
const {assert,boot,clone,valid,v12}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const legacy=require('./fixtures/possessions-v17.json');
const ingredient=(id,recipe,facility='med')=>({db:'craft-ingredient',id,recipe:String(recipe),facility});
const back={db:'craft-return'};
const open=(b,id='med',tier='3')=>b.click({bui:'facility',id,tier});
function panel(b,recipe,facility='med'){
  return b.g.facilityProductionPanel(facility).split(`data-production-recipe="${recipe}"`)[1]?.split('<div class="facility-recipe"')[0]||'';
}
function count(b,recipe,item,held,need,facility='med'){
  const shortage=Math.max(0,need-held),row=panel(b,recipe,facility);
  assert.ok(row.includes(`data-craft-input="${item}" data-shortage="${shortage}"`),`${facility}/${recipe}/${item} shortage ${shortage}`);
  assert.ok(row.includes(`${db.items[item].name} · ${held} / ${need}`));
  assert.equal(row.includes(`data-db="craft-ingredient" data-id="${item}"`),Boolean(shortage));
}
function seed(){
  const s=clone(boot().g.s);Object.assign(s.hideout.levels,{power:2,water:2,med:2});
  delete s.hideout.wardManual;
  return s;
}
{
  const s=seed();s.stash={rs_case_med:1};s.stashSlots=[{uid:'s-craft-case',g:'rs_case_med',x:0,y:0,w:3,h:3}];
  const b=boot({[v12]:s}),{g}=b;open(b);
  count(b,1,'gauze',0,2);count(b,1,'bandage',0,1);assert.equal(panel(b,'folded-dressing'),'');
  assert.ok(g.trade('medic','buy','gauze',2).ok);assert.ok(g.trade('medic','buy','bandage',1).ok);
  assert.ok(g.caseMove('s-craft-case','put','gauze').ok);
  g.gear({gear:'pack',id:'bandage'});assert.equal(g.s.equipment.bag[0].g,'bandage');
  count(b,1,'gauze',1,2);count(b,1,'bandage',0,1);
  const before=clone(g.s);b.click(ingredient('cloth',1));b.click(ingredient('gauze',1,'water'));b.click(ingredient('gauze','folded-dressing'));
  assert.doesNotMatch(b.content(),/data-db="craft-return"/);assert.deepEqual(clone(g.s),before);
  const target=ingredient('gauze',1);b.click(target);assert.match(b.content(),/‹ 구급품 포장 작업으로/);
  assert.ok(b.content().includes('<h2>멸균 거즈</h2>'));assert.ok(b.content().includes('<p>'+db.containers.med.name+'</p>'));
  assert.deepEqual(clone(g.s),before);b.click(back);assert.deepEqual(clone(g.s),before);count(b,1,'gauze',1,2);
  assert.match(b.content(),/data-bui="tier" data-tier="3" aria-pressed="true"/);
  b.click(target);b.click({supply:'gauze'}); // Read-only origin survives an explicit catalog purchase.
  assert.equal(g.fee,before.wallet-g.price('gauze'));b.click(back);count(b,1,'gauze',2,2);
  b.click(target);assert.doesNotMatch(b.content(),/data-db="craft-return"/); // Obsolete shortage link.
  g.gear({gear:'select',unit:g.s.equipment.bag[0].uid});g.gear({gear:'unpack'});count(b,1,'bandage',1,1);
  const produce={hideout:'produce',id:'med',recipe:'1'};b.click(produce);const started=clone(g.s);
  assert.equal(started.hideout.production.med.recipe,1);assert.equal(g.stock('gauze')+g.stock('bandage'),0);
  assert.equal(started.stashSlots.find(u=>u.uid==='s-craft-case').contents[0].g,'gauze');assert.match(panel(b,1),/다음 제작 · 창고 사용 가능/);
  b.click(produce);b.click(ingredient('gauze',1));b.click(back);assert.deepEqual(clone(g.s),started);
  b.click(ingredient('gauze',1));b.click({page:'more'});b.click({page:'catalog'});assert.doesNotMatch(b.content(),/data-db="craft-return"/);
  open(b);b.click(ingredient('gauze',1));g.lookup('cloth');assert.doesNotMatch(b.content(),/data-db="craft-return"/);
  valid(g);
}
{
  const s=seed();s.hideout.wardManual={registered:true,waiting:[]};s.stash={cloth:192,gauze:1};
  s.stashSlots=Array.from({length:192},(_,i)=>({uid:`s-craft-cloth-${i}`,g:'cloth',x:i%6,y:Math.floor(i/6),w:1,h:1}));
  const b=boot({[v12]:s});open(b);assert.ok(b.g.s.stashSlots.every(u=>u.g!=='gauze'));
  assert.ok(b.g.trade('medic','buy','bandage',1).ok);count(b,'folded-dressing','gauze',1,1);count(b,'folded-dressing','bandage',1,1);
  b.click({hideout:'produce',id:'med',recipe:'folded-dressing'});assert.equal(b.g.s.hideout.production.med.recipe,'folded-dressing');
  assert.equal(b.g.stock('gauze')+b.g.stock('bandage'),0);assert.equal(b.g.stock('cloth'),192);
  const started=clone(b.g.s);b.click(ingredient('gauze','folded-dressing'));assert.match(b.content(),/‹ 야전 처치포 접기 작업으로/);b.click(back);
  assert.deepEqual(clone(b.g.s),started);assert.match(panel(b,0,'water'),/소모 재료 없음/);assert.doesNotMatch(panel(b,0,'water'),/data-craft-input/);valid(b.g);
}
{
  const b=boot(),s=clone(b.g.s);for(const facility of Object.keys(db.hideout.production))s.hideout.levels[facility]=3;
  const built=boot({[v12]:s});const materials=new Set();let recipes=0;
  for(const [facility,list] of Object.entries(db.hideout.production)){
    open(built,facility);
    for(const [recipe,r] of list.entries()){
      recipes++;
      for(const [item,need] of Object.entries(r.inputs)){
        materials.add(item);count(built,recipe,item,0,need,facility);built.click(ingredient(item,recipe,facility));
        assert.ok(built.content().includes('<h2>'+db.items[item].name+'</h2>'));
        const actual=Object.entries(db.containers).filter(([,box])=>box.itemDistribution.some(row=>row.tpl===item&&row.relativeProbability>0)).map(([key])=>key).sort();
        assert.deepEqual([...db.items[item].lootSources].sort(),actual);
        for(const key of actual)assert.ok(built.content().includes(db.containers[key].name));
        built.click(back);
      }
    }
  }
  assert.equal(recipes,39);assert.equal(materials.size,44);valid(built.g);
}
{
  const newClinic=boot({},undefined,{},'#clinic');assert.match(newClinic.content(),/<h2>의무실<\/h2>/);assert.equal(newClinic.g.s.hideout.levels.med,0);
  const existing=seed();const direct=boot({[v12]:existing},undefined,{},'#clinic');const manual=boot({[v12]:existing});open(manual,'med');
  assert.deepEqual(clone(direct.g.s),clone(manual.g.s));assert.match(direct.content(),/data-production-recipe="1"/);
  direct.g.start();const live=clone(direct.g.s);const regular=boot({[v12]:live},direct.clock);
  const linked=boot({[v12]:live},direct.clock,{},'#clinic');assert.deepEqual(clone(linked.g.s),clone(regular.g.s));assert.match(panel(linked,1),/귀환 후 작업 가능/);
  const before=clone(linked.g.s);linked.click(ingredient('gauze',1));linked.click({supply:'gauze'});linked.click(back);assert.deepEqual(clone(linked.g.s),before);valid(linked.g);
  const old=boot({['rl-reboot-session-v17']:legacy.session},undefined,{},'#clinic');
  assert.equal(old.g.stock('water'),legacy.session.stash.water);assert.equal(old.g.s.hideout.wardManual.registered,false);assert.match(old.content(),/<h2>의무실<\/h2>/);valid(old.g);
}
console.log('PASS: production stock and exact shortage across 39 facility recipes / 44 inputs, named manual and no-input recipe, catalog return/tier and stale actions, real purchase/case/pack/queue/craft, legacy profile and read-only clinic deep links.');
