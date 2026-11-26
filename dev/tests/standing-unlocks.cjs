const {assert,boot,clone,v12,valid}=require('./game-fixture.cjs');
const starter=boot(), base=clone(starter.g.s);
function profile(trader,tier){
  const s=clone(base);
  s.contracts[trader].done=Array.from(starter.g.quests).filter(q=>q.trader===trader&&q.tier<tier)
    .sort((a,b)=>a.tier-b.tier).map(q=>q.id);
  return s;
}
function ranked(trader,tier){
  const b=boot({[v12]:profile(trader,tier)},undefined,{},'#quests');
  b.click({contract:'trader',id:trader});
  return b;
}
function assertRows(b,trader,tier){
  const html=b.content(),shopLinks=Array.from(html.matchAll(/data-contract="unlock-item" data-trader="([^"]+)" data-tier="(\d)" data-id="([^"]+)"/g),m=>[m[1],Number(m[2]),m[3]]);
  const merchant=b.g.traders.find(t=>t.id===trader);
  const goods=tier>1?Array.from(merchant.stockTiers[tier-1]).filter(id=>b.g.listed(trader,'buy').includes(id)):[];
  assert.deepEqual(shopLinks,goods.map(id=>[trader,tier,id]));
  const ids=Array.from(html.matchAll(/class="cq-row" data-contract="open" data-id="([^"]+)"/g),m=>m[1]);
  assert.deepEqual(ids,Array.from(b.g.quests).filter(q=>q.trader===trader&&q.tier===tier).map(q=>q.id));
  for(const id of goods)assert.ok(!['귀중품','골동품'].includes(b.g.goods[id][5]));
  for(const q of b.g.quests.filter(q=>q.trader===trader&&q.tier>b.g.standing(trader).tier))assert.ok(!html.includes(q.title));
  return goods;
}
function allShelves(){
  for(const merchant of starter.g.traders){
    for(const current of [1,2,3,4]){
      const b=ranked(merchant.id,current),g=b.g,baseline=clone(g.s);
      assert.equal(g.standing(merchant.id).tier,current);
      for(let tier=1;tier<=current;tier++){
        b.click({contract:'tier',tier:String(tier)});
        const goods=assertRows(b,merchant.id,tier);
        if(!goods.length)continue;
        const id=goods.at(-1);
        b.click({contract:'unlock-item',id,tier:String(tier),trader:merchant.id});
        assert.match(b.content(),/data-mode="buy"/);
        assert.ok(b.content().includes('data-market="trade" data-id="'+id+'" data-mode="buy" data-trader="'+merchant.id+'"'));
        assert.deepEqual(clone(g.s),baseline);
        b.click({market:'unlocks',trader:merchant.id});
        assertRows(b,merchant.id,current);
      }
      valid(g);
    }
  }
}
async function staleAndModes(){
  const b=ranked('medic',2),g=b.g;
  const link={contract:'unlock-item',tier:'2',trader:'medic',id:'splint'};
  for(const bad of [{id:'suture'},{id:'diamond'},{id:'rl_x_optic'},{tier:'4'},{trader:'repair'}]){
    b.click({...link,...bad});assert.match(b.content(),/data-standing-unlocks="2"/);
  }
  b.click({contract:'trader',id:'repair'});b.click(link);
  assert.doesNotMatch(b.content(),/data-standing-unlocks|data-market="trade"/);
  b.click({contract:'trader',id:'medic'});
  for(const mode of ['daily','weekly']){
    b.click({contract:'board',mode});b.click(link);
    assert.doesNotMatch(b.content(),/data-standing-unlocks|data-market="trade"/);
  }
  b.click({page:'trade'});b.click({market:'unlocks',trader:'medic'});
  assertRows(b,'medic',2);
  await g.importFile(new Blob([JSON.stringify({format:'rustline-tc01',session:base})]));
  b.click(link);
  assert.equal(g.standing('medic').tier,1);
  assertRows(b,'medic',1);
  b.click({page:'trade'});b.click({market:'unlocks',trader:'medic'});
  assert.match(b.content(),/data-mode="buy"/);
  assert.doesNotMatch(b.content(),/data-market="unlocks"/);
}
(async()=>{allShelves();await staleAndModes();console.log('PASS all earned trader tiers/quest rows/exact retail stock, no future listings, role separation, daily/weekly navigation guard, price preview without acquisition or cart mutation, and lower save restoration.');})().catch(error=>{console.error(error);process.exitCode=1;});
