// Exercise the actual dossier/catalog buttons, guards and transaction functions on an earned finale.
const {assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rustline-relief-sources-')),file=path.join(dir,'ended.json');
let seed;
try{
  execFileSync(process.execPath,['tests/external-relief.cjs'],{env:{...process.env,RUSTLINE_EXPORT_RELIEF_FIXTURE:file}});
  seed=JSON.parse(fs.readFileSync(file)).session;
}finally{fs.rmSync(dir,{recursive:true,force:true});}
const now={now:1800004000000};
const b=boot({[v12]:seed},now),g=b.g,click=d=>b.click(d);
const open=(kind,id)=>click({db:'relief-material',kind,id});
const back=()=>click({db:'relief-return'});
click({page:'orders'});open('power','battery');assert.doesNotMatch(b.content(),/data-db="relief-return"/);
click({bui:'order-filter',id:'new'});click({bui:'order',id:'external-relief'});
assert.equal((b.content().match(/data-db="relief-material"/g)||[]).length,4);
const before=clone(g.s);
for(const invalid of [['power','food'],['meals','wire'],['unknown','water']]){
  open(...invalid);assert.doesNotMatch(b.content(),/data-db="relief-return"/);
}
for(const [kind,id] of [['meals','food'],['meals','water'],['power','battery'],['power','rl_03_25']]){
  open(kind,id);assert.match(b.content(),new RegExp('data-catalog-sources="'+id+'" open'));
  assert.match(b.content(),/data-db="relief-return"/);
  if(id==='battery')assert.match(b.content(),/임도현 · 우호도 2단계에 판매 · 현재 1단계 \(10점\)/);
  if(id==='food')assert.match(b.content(),/한미정 · 상점가 6,000 CR/);
  if(id==='rl_03_25')assert.match(b.content(),/1개 주문 · 13,000 CR/);
  back();assert.match(b.content(),/data-bui="order-filter" data-id="new" aria-pressed="true"/);
  assert.match(b.content(),/data-bui="order" data-id="external-relief" aria-pressed="true"/);
}
assert.deepEqual(clone(g.s),before);
open('power','rl_03_25');g.supply('rl_03_25');assert.equal(g.fee,before.wallet-13000);
assert.equal(g.stock('rl_03_25'),before.stash.rl_03_25+1);assert.equal(g.s.career.order,null);
click({page:'stash'});click({page:'catalog'});assert.doesNotMatch(b.content(),/data-db="relief-return"/);
const newGame=boot(),fresh=clone(newGame.g.s);newGame.click({page:'orders'});
newGame.click({db:'relief-material',kind:'power',id:'battery'});assert.doesNotMatch(newGame.content(),/data-db="relief-material"|data-db="relief-return"/);assert.deepEqual(clone(newGame.g.s),fresh);
valid(g);console.log('PASS four genuine order inputs, invalid/stale source guards, actual trader standing, catalog-only order, filter preservation, read-only previews and hidden pre-ending order.');
