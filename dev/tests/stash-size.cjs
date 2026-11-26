// Run the release's grid, persistence, import and case validation through the built game.
const {assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const previousKey='rl-reboot-session-v12';
const original=boot(),template=clone(original.g.s);
const item=(id,uid,x,y)=>({g:id,uid,x,y,w:original.g.goods[id][1],h:original.g.goods[id][2]});
const loose=item('matches','s-bottom-right',5,7);
const legacy=clone(template);
legacy.version=12;
legacy.stash={matches:250};
legacy.stashSlots=[loose];
const previousText=JSON.stringify(legacy);
const migrated=boot({[previousKey]:legacy});
assert.equal(migrated.storage.get(previousKey),previousText);
assert.deepEqual(clone(migrated.g.s.stashSlots.find(u=>u.uid===loose.uid)),loose);
assert.equal(migrated.g.s.stashSlots.length,192);assert.equal(migrated.g.stock('matches'),250);
assert.equal(boot(migrated.storage).g.s.stashSlots.length,192);
const current=clone(migrated.g.s);
current.stashSlots=[loose];
assert.equal(boot({[v12]:current}).g.s.stashSlots.length,1,'current saves preserve intentional gaps and overflow independently');

async function verify(){
 const copy=boot();
 await copy.g.importFile(new Blob([JSON.stringify({format:'rustline-tc01',session:legacy})]));
 assert.equal(copy.g.s.stashSlots.length,192,'old exported saves also absorb their overflow exactly once');
 assert.ok(copy.g.s.stashSlots.some(u=>u.uid===loose.uid&&u.x===5&&u.y===7));
 for(const [level,expected] of [192,240,288,336].entries()){
   const data=clone(template),rows=expected/6;
   data.hideout.levels.stash=level;
   const atEnd=item('matches','s-end',5,rows-1);
   const box=item('rs_case_med','s-box',0,0);
   box.y=rows-box.h;
   box.contents=[item('bandage','s-docs',0,0)];
   data.stash={rs_case_med:1,matches:1};
   data.stashSlots=[box,atEnd];
   const b=boot({[v12]:data});
   valid(b.g);
   b.click({page:'stash'});
   assert.equal((b.content().match(/data-stash="place"/g)||[]).length,expected);
   assert.ok(b.content().includes('data-scroll-key="warehouse-grid"'));
   assert.deepEqual(clone(b.g.s.stashSlots),data.stashSlots);
   b.click({stash:'select',id:'matches',uid:atEnd.uid});
   b.click({stash:'place',x:4,y:rows-1});
   assert.equal(b.g.s.stashSlots.find(u=>u.uid===atEnd.uid).y,rows-1);
   b.click({page:'inventory'});
   assert.ok(b.content().includes('data-scroll-key="warehouse-grid"'));
   assert.equal((b.content().match(/data-stash="place"/g)||[]).length,expected);
   const exported=await b.exportData();
   assert.ok(b.g.check(exported));
   const replay=boot();
   await replay.g.importFile(new Blob([JSON.stringify(exported)]));
   assert.deepEqual(clone(replay.g.s.stashSlots),clone(b.g.s.stashSlots));
   const invalid=clone(exported);invalid.session.stashSlots[0].y++;
   assert.equal(b.g.check(invalid),false);
 }
 console.log('PASS: 192/240/288/336 cells, main and loadout scroll regions, source retention, one-time legacy auto-placement, last-row selection, filled case and row 55 backup/import/invalid boundary.');
}
verify().catch(e=>{console.error(e);process.exitCode=1});
