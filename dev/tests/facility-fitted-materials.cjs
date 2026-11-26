// Verify physical host identities against real construction, crafting and procurement entry points.
const {assert,boot,clone,valid,v12,stamp}=require('./game-fixture.cjs');
const db=require('../Rustline_Database_v10.json');
const old=require('./fixtures/presets-v20.json').session;
const legacy=boot({'rl-reboot-session-v20':old}).g;
const preset=legacy.presetCurrent();
preset.worn.light='flash';
preset.modules.light='battery';
assert.ok(legacy.applyPreset(preset).ok);
legacy.gear({gear:'unwear',slot:'light'});
const fitted=clone(legacy.s.stashSlots.find(unit=>unit.g==='flash').gear);
assert.equal(fitted.module,'battery');

function host(item,serial,module=null) {
  return {...fitted,uid:'s-'+serial,g:item,module};
}
function seed(room,grid,queue,anonymous=0) {
  const s=clone(boot().g.s);
  const id=room==='light'?'flash':'radio';
  s.hideout.levels.power=1;
  s.stash={...db.hideout.facilities[room].levels[0].materials};
  s.stash[id]=grid.length+queue.reduce((sum,g)=>sum+(g.batch?.count||1),0)+anonymous;
  s.stashSlots=grid.map((gear,x)=>({uid:'s-grid-'+x,g:id,x,y:0,w:1,h:2,gear}));
  s.gearOverflow=queue;
  return s;
}
const build=(g,id)=>g.build({hideout:'build',id,tier:'1'});
const open=(s)=>{const b=boot({[v12]:s});valid(b.g);return b;};
const bare=host('flash','bare-light'),queued=host('flash','queued-light','battery');
const antenna=host('radio','radio-with-antenna','rl_13_02');

{
  const b=open(seed('light',[bare,fitted],[])),g=b.g;
  assert.ok(g.pin({kind:'facility',id:'light',tier:1}));
  const row=g.objective().materials.find(item=>item.id==='flash');
  assert.deepEqual([row.owned,row.usable,row.missing],[2,1,1]);
  const line=g.objectiveCartView().lines.find(item=>item.item==='flash');
  assert.deepEqual([line.required,line.owned,line.usable,line.missing],[2,2,1,1]);
  b.click({bui:'facility',id:'light',tier:'1'});
  assert.match(b.content(),/사용 가능 1개, 필요 2개 · 모듈 장착 1개 제외/);
  const before=clone(g.s);
  build(g,'light');
  assert.deepEqual(clone(g.s),before,'blocked build charges no CR, stock or job');
  g.gear({gear:'wear-stash',id:'flash',unit:'s-grid-1'});
  assert.equal(g.s.equipment.instances.light.uid,fitted.uid);
  assert.equal(g.s.equipment.modules.light,'battery');
  const detach=g.presetCurrent();
  delete detach.modules.light;
  assert.ok(g.applyPreset(detach).ok);
  g.gear({gear:'unwear',slot:'light'});
  assert.ok(g.s.stashSlots.some(u=>u.gear?.uid===fitted.uid&&u.gear.module===null));
  assert.equal(g.s.stash.battery,1);
  build(g,'light');
  assert.ok(g.s.hideout.builds.light);
  assert.equal(g.s.stash.battery,1,'a detached battery stays in the warehouse');
  valid(g);
}
{
  const s=seed('light',[bare,fitted],[]);
  const trader=boot().g;
  s.contracts.quarter.done=trader.quests.filter(q=>q.trader==='quarter'&&q.tier===1).map(q=>q.id);
  const {g}=open(s);
  assert.ok(g.standing('quarter').tier>=2);
  g.pin({kind:'facility',id:'light',tier:1});
  const view=g.objectiveCartView(),line=view.lines.find(row=>row.item==='flash');
  assert.deepEqual([line.owned,line.usable,line.missing,line.unit,line.subtotal],[2,1,1,12000,12000]);
  assert.deepEqual([view.budget.materials,view.budget.build,view.budget.total,view.budget.balance],[12000,20000,32000,-2000]);
}
{
  // FIFO does not let a fitted head hide bare queued stock; the second bare host comes from the grid.
  const s=seed('light',[bare,fitted],[queued,host('flash','queue-bare')]);
  const b=open(s),g=b.g;
  const before=clone(g.s);
  b.storage.set=()=>{throw Error('simulated quota');};
  build(g,'light');
  assert.deepEqual(clone(g.s),before,'failed save rolls back both storage representations and cost');
  delete b.storage.set;
  build(g,'light');
  const after=clone(g.s);
  assert.equal(after.wallet,10000);
  assert.ok(after.hideout.builds.light);
  assert.equal(after.stash.flash,2);
  assert.deepEqual(after.stashSlots.filter(u=>u.g==='flash').map(u=>u.gear),[fitted]);
  assert.deepEqual(after.gearOverflow,[queued]);
  assert.equal(after.stash.wire,undefined);
  assert.equal(after.stash.rl_03_25,undefined);
  build(g,'light');
  assert.deepEqual(clone(g.s),after);
  assert.deepEqual(clone(boot(b.storage).g.s.stashSlots),after.stashSlots);
  valid(g);
}
{
  const batch={...host('flash','bulk-20'),uid:'s-bulk-20',batch:{prefix:'s-bulk',start:20,count:100000}};
  const b=open(seed('light',[],[queued,batch])),g=b.g;
  build(g,'light');
  const [first,rest]=clone(g.s.gearOverflow);
  assert.deepEqual(first,queued);
  assert.deepEqual(rest.batch,{prefix:'s-bulk',start:22,count:99998});
  assert.equal(rest.uid,'s-bulk-22');assert.equal(g.s.stash.flash,99999);valid(g);
}
{
  // A pre-identity save may contain untracked pristine overflow alongside real, protected hosts.
  const b=open(seed('light',[fitted],[queued],2)),g=b.g;
  build(g,'light');
  assert.equal(g.s.stash.flash,2);
  assert.deepEqual(clone(g.s.gearOverflow),[queued]);
  assert.deepEqual(clone(g.s.stashSlots[0].gear),fitted);valid(g);
}
{
  const b=open(seed('comms',[],[antenna])),g=b.g;
  const before=clone(g.s);build(g,'comms');assert.deepEqual(clone(g.s),before);
  const good=open(seed('comms',[host('radio','plain-radio')],[antenna]));
  build(good.g,'comms');
  assert.ok(good.g.s.hideout.builds.comms);
  assert.deepEqual(clone(good.g.s.gearOverflow),[antenna]);
  assert.equal(good.g.s.stash.rl_13_02,undefined,'only the separate installation antenna was consumed');
  valid(good.g);
}
{
  const s=seed('comms',[antenna],[]);s.hideout.levels.comms=3;
  const b=open(s),g=b.g;
  const produce={hideout:'produce',id:'comms',recipe:'2'};
  assert.match(g.facilityProductionPanel('comms'),/data-craft-input="radio" data-shortage="1"/);
  const before=clone(g.s);g.build(produce);assert.deepEqual(clone(g.s),before);
  b.click({bui:'facility',id:'comms',tier:'3'});
  b.click({db:'craft-ingredient',id:'radio',facility:'comms',recipe:'2'});
  assert.match(b.content(),/data-db="craft-return"/);
  const equipped=s.stashSlots[0].gear;
  s.stash.radio++;s.gearOverflow.push(host('radio','craft-bare'));
  const pass=open(s);pass.g.build(produce);
  const job=pass.g.s.hideout.production.comms;
  assert.equal(job.recipe,2);assert.equal(pass.g.s.stash.radio,1);
  assert.equal(pass.g.s.stash.cable,1);assert.deepEqual(clone(pass.g.s.stashSlots[0].gear),equipped);
  stamp(pass,job.end);assert.equal(pass.g.fee,105000);stamp(pass,job.end+1);assert.equal(pass.g.fee,105000);valid(pass.g);
}
console.log('PASS fitted flashlight/radio protection across build and production, physical fit and removal, grid/queue/legacy/batch, quotes, stale action, save rollback and reload.');
