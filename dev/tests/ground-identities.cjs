const {assert,boot,clone,go,move,extract,v12,valid}=require('./game-fixture.cjs');
const base=boot().g,s=clone(base.s);
const items=['flash','flash','water','water'];
s.equipment.bag=items.map((id,i)=>({...base.unit(id),x:i,y:0}));
const [bare,fitted,one,two]=s.equipment.bag;
bare.gear.uid='s-original-abcdef12';fitted.gear.uid='s-fitted-abcdef12';fitted.gear.module='battery';fitted.gear.durability=82;
const b=boot({[v12]:s}),g=b.g;
const purse=g.s.cash.pocket[0].uid;
assert.ok(g.cashAction(purse,'bag',1200).ok);
assert.ok(g.cashAction(purse,'bag',3500).ok);
assert.equal(g.s.wallet,25300);valid(g);
g.start();
for(const u of [...g.s.field.bag])g.gear({gear:'drop',unit:u.uid});
function ground(){b.click({page:'inventory'});return b.content().match(/<section class="panel kit-ground">[\s\S]*?<\/section>/)?.[0]||'';}
const before=JSON.stringify(g.s);const html=ground();
assert.ok(html.includes('휴대용 조명 #'+fitted.gear.uid) && html.includes('휴대용 조명 #'+bare.gear.uid),'colliding short serials expose full physical identity');
assert.ok(html.includes('0.5 kg (배터리 포함) · 내구도 82/100'));
assert.match(html,/휴대용 조명 #s-original-abcdef12<small>0\.25 kg<\/small>/);
assert.ok(html.includes('1,200 CR')&&html.includes('3,500 CR'));
assert.ok(html.includes(g.goods.water[0]+' (1/2)')&&html.includes(g.goods.water[0]+' (2/2)'));
assert.equal(html.match(/aria-labelledby=/g).length,6);assert.equal(g.s.field.gearGround[0].length,6);
assert.equal(before,JSON.stringify(g.s),'reading the ground never adds inventory or changes the save');
move(b,1);assert.equal(ground(),'');g.gear({gear:'recover',unit:fitted.uid});assert.ok(!g.s.field.bag.length);
move(b,0);g.gear({gear:'recover',unit:fitted.uid});g.gear({gear:'recover',unit:fitted.uid});
assert.equal(g.s.field.bag.filter(u=>u.g==='flash').length,1);const returned=g.s.field.bag.find(u=>u.g==='flash');assert.equal(returned.gear.uid,fitted.gear.uid);
assert.equal(returned.gear.module,'battery');assert.equal(returned.gear.durability,82);assert.ok(ground().includes('휴대용 조명 #abcdef12'));
const cash=g.s.field.gearGround[0].find(u=>u.amount===3500);
g.gear({gear:'recover',unit:cash.uid});g.gear({gear:'recover',unit:cash.uid});
assert.deepEqual(clone(g.s.field.bag.filter(u=>u.g==='cr_notes').map(u=>u.amount)),[3500]);
g.gear({gear:'recover',unit:two.uid});assert.ok(ground().includes(g.goods.water[0]));assert.ok(!ground().includes(' (1/2)'));
// Wearable backpack recovery still re-equips the issued pack.
g.gear({gear:'ground-worn',slot:'back'});assert.match(ground(),/지급 배낭<\/span><button[^>]+>다시 메기<\/button>/);
const pack=g.s.field.gearGround[0].find(u=>u.g==='issued_pack');
g.gear({gear:'recover',unit:pack.uid});assert.equal(g.s.field.worn.back,'issued_pack');
valid(g);const reload=boot(new Map(b.storage),b.clock);assert.ok(reload.g.s.field.gearGround[0].some(u=>u.uid===bare.uid));valid(reload.g);
extract(b);assert.equal(g.s.wallet,28800);assert.equal(g.s.stashSlots.find(u=>u.gear?.uid===fitted.gear.uid).gear.module,'battery');
assert.ok(!g.s.stashSlots.some(u=>u.gear?.uid===bare.gear.uid));valid(g);
// Native older physical-gear records gain stable serials on load; no ground labels infer ownership.
const legacy=clone(s);legacy.version=24;delete legacy.writerBuild;legacy.equipment.bag=[{...bare}];delete legacy.equipment.bag[0].gear;
const old=boot({'rl-reboot-session-v24':legacy});old.g.start();const unit=old.g.s.field.bag[0];old.g.gear({gear:'drop',unit:unit.uid});old.click({page:'inventory'});assert.ok(old.content().includes('휴대용 조명 #'+unit.gear.uid.slice(-8)));valid(old.g);
{
  const starter=clone(base.s);starter.equipment.worn.back='rl10_pack';starter.career.done=['handover-ledgers'];
  const mail=boot({[v12]:starter}),game=mail.g;game.order('sealed-mail');game.moveNow(2);game.start();go(mail,'landmark',{index:4});
  go(mail,'postal-pickup',{raidId:String(game.s.raid.startedAt)});const post=game.s.field.bag.find(u=>u.g==='rl_sealed_mail');
  game.gear({gear:'drop',unit:post.uid});game.gear({gear:'ground-worn',slot:'back'});
  const physicalPack=game.s.field.gearGround[2].find(u=>u.g==='rl10_pack');
  mail.click({page:'inventory'});
  assert.match(mail.content(),/봉인 우편낭<\/span><button[^>]+>회수<\/button>/);
  assert.ok(mail.content().includes(game.goods.rl10_pack[0]));
  game.gear({gear:'recover',unit:physicalPack.uid});game.gear({gear:'recover',unit:physicalPack.uid});
  assert.equal(game.s.field.worn.back,'rl10_pack');assert.equal(game.s.field.bag.filter(u=>u.g==='rl10_pack').length,0);
  game.gear({gear:'recover',unit:post.uid});game.gear({gear:'recover',unit:post.uid});
  assert.equal(game.s.field.bag.filter(u=>u.uid===post.uid).length,1);valid(game);
}
console.log('PASS ground-specific identity, colliding serials, modules/condition, distinct cash amounts, ordinary duplicates, active zone, idempotent recovery, issued pack, migrated gear and successful settlement');
