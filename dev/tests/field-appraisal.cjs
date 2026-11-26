// The field guide shows what a buyer will pay after return. All values use the shop's pricing path.
const {assert,boot,clone}=require('./game-fixture.cjs');
const g=boot().g;
const before=clone(g.s);
let checked=0, multi=0, rounded=0, unlisted=0;
for(const [id,goods] of Object.entries(g.goods)){
  const unit={uid:'field',g:id,w:goods[1],h:goods[2],revealed:true};
  const buyers=g.traders.filter(trader=>g.accepts(trader.id,id));
  const label=g.fieldAppraisal(unit);
  if(!buyers.length){unlisted++;assert.equal(label,'벙커 상인 매입처 없음');continue;}
  const price=g.quote(buyers[0].id,'sell',id,1).unit;
  assert.ok(label.startsWith('귀환 후 상인 매입가 '+price.toLocaleString('ko-KR')+' CR'),id);
  if(unit.w*unit.h>1){
    multi++;
    const avg=price/(unit.w*unit.h);
    if(!Number.isInteger(avg))rounded++;
    assert.ok(label.endsWith('칸당 '+(Number.isInteger(avg)?'':'약 ')+Math.round(avg).toLocaleString('ko-KR')+' CR'),id);
    assert.equal(label,g.fieldAppraisal({...unit,w:unit.h,h:unit.w}));
  }
  checked++;
}
assert.ok(checked>400 && multi>10 && rounded>0);
assert.equal(g.fieldAppraisal({g:'cr_notes',amount:125,w:1,h:1}),'액면 금액 125 CR');
assert.match(g.fieldAppraisal({g:'rl_sealed_mail',w:2,h:1}),/의뢰 전용 화물/);
assert.ok(!g.fieldAppraisal({g:'rl_sealed_mail',w:2,h:1}).includes('CR'));
assert.equal(g.fieldAppraisal({g:'flash',gear:{module:'battery'},w:1,h:2}),'모듈 분리 후 본체 매입가 6,000 CR');
const box=Object.keys(g.cases).find(id=>g.traders.some(t=>g.accepts(t.id,id)));
assert.ok(box);
assert.match(g.fieldAppraisal({g:box,contents:[{g:'water'}],w:2,h:2}),/보관함을 비운 후 본체 매입가/);
assert.deepEqual(clone(g.s),before);
console.log('PASS',checked,'tradable items,',multi,'multi-cell,',rounded,'rounded per-cell prices,',unlisted,'without buyers; cash, loaded host, filled case, cargo and snapshot intact.');
