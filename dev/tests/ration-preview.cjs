const {assert,boot,clone,valid,go,finish,v12}=require('./game-fixture.cjs');
function stock(kitchen=0,water=0,pocket=false){
  const s=clone(boot().g.s);s.hideout.levels.kitchen=kitchen;s.hideout.levels.water=water;
  s.stash={food:2,water:2};delete s.stashSlots;
  const b=boot({[v12]:s});if(pocket)b.g.gear({gear:'unwear',slot:'back'});
  for(const id of ['water','food','water','food'])b.g.gear({gear:'pack',id});
  b.g.start();b.setRandom(.1);return b;
}
function select(b,u){
  b.click({page:'inventory'});b.click({side:'bag',pick:u.uid});return b.content();
}
for(const [item,stat,label] of [['food','energy','기력'],['water','water','수분']]){
  for(const level of [0,3]){
    const src=stock(level,level,level===3);
    for(const value of [0,73,98,99,100]){
      const s=clone(src.g.s);s.field[stat]=value;
      const b=boot({[v12]:s},src.clock),g=b.g,copies=g.s.field.bag.filter(u=>u.g===item);
      const unit=copies[1],effect=g.kitSupply(item),gain=Math.min(100-value,effect.gain),waste=effect.gain-gain;
      const line=select(b,unit);
      assert.ok(line.includes('data-ration-preview="'+unit.uid+'"'));
      const where=(level===3?'주머니':'가방')+' '+(unit.y+1)+'행 '+(unit.x+1)+'열';
      assert.ok(line.includes(where));assert.ok(line.includes(value===100?'최대 · 소모 없음':label+' '+value+' → '+(value+gain)+' · 실효 +'+gain));
      if(waste&&value<100)assert.ok(line.includes('초과 '+waste));
      const before=clone(g.s.field.bag);
      if(value===99){
        const write=b.storage.set;b.storage.set=()=>{throw Error('quota')};
        g.gear({gear:'consume',unit:unit.uid});b.storage.set=write;
        assert.deepEqual(clone(g.s.field.bag),before);assert.equal(g.s.field[stat],value);
      }
      g.gear({gear:'consume',unit:unit.uid});assert.equal(g.s.field[stat],value+gain);
      assert.deepEqual(clone(g.s.field.bag),gain?before.filter(u=>u.uid!==unit.uid):before);
      g.gear({gear:'consume',unit:unit.uid});assert.equal(g.s.field[stat],value+gain);valid(g);
    }
  }
}
const b=stock(),g=b.g;const water=g.s.field.bag.find(u=>u.g==='water');
go(b,'scan');g.gear({gear:'consume',unit:water.uid});assert.equal(g.s.field.bag.length,4);finish(b);
b.click({page:'health'});b.click({loadout:'medical',id:'water'});assert.ok(b.content().includes('수분 99 → 100 · 실효 +1 · 초과 24'));
const first=g.s.field.bag.find(u=>u.g==='water'),second=g.s.field.bag.filter(u=>u.g==='water')[1];
g.loadout({loadout:'assign',id:'water'});g.loadout({loadout:'quick',index:'0'});
assert.ok(b.content().includes('aria-description="가방 '+(first.y+1)+'행 '+(first.x+1)+'열 · 수분 99 → 100'));
g.loadout({loadout:'quick',index:'0'});assert.equal(g.s.field.water,100);
assert.ok(!g.s.field.bag.some(u=>u.uid===first.uid)&&g.s.field.bag.some(u=>u.uid===second.uid));
const contact=clone(g.s);contact.field.contact={zone:0,hp:36};contact.field.water=95;
const pause=boot({[v12]:contact},b.clock);pause.g.gear({gear:'consume',unit:second.uid});assert.equal(pause.g.s.field.water,100);
assert.ok(pause.g.s.field.contact&&!pause.g.s.field.bag.some(u=>u.uid===second.uid));valid(pause.g);
console.log('PASS: two real copies, chosen UID and coordinates, all 0/73/98/99/100 boundaries, water/kitchen bonuses 0/3, pocket vs pack, rollback, search lock, active health.');
