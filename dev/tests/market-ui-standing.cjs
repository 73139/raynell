// Exercise the game's rendered counter, purchase form and backup import at different standings.
const {setTestCash,assert,boot,clone,v12}=require('./game-fixture.cjs');

async function verify(){
  const base=boot();
  const starter=clone(base.g.s);
  setTestCash(starter,2500000);
  starter.stash={diamond:1};
  starter.stashSlots=[{uid:'s-standing-diamond',g:'diamond',x:0,y:0,w:base.g.goods.diamond[1],h:base.g.goods.diamond[2],revealed:true}];
  for(let tier=1;tier<=4;tier++){
    const ranked=clone(starter);
    for(const trader of base.g.traders){
      ranked.contracts[trader.id].done=base.g.quests.filter(q=>q.trader===trader.id&&q.tier<tier)
        .sort((a,b)=>a.tier-b.tier).map(q=>q.id);
    }
    const current=boot({[v12]:ranked},undefined,{},'#shop');
    for(const trader of current.g.traders){
      current.click({market:'trader',id:trader.id});
      const unlocked=trader.stockTiers.slice(0,tier).flat();
      assert.ok(current.content().includes('구매 가능 '+unlocked.length+'종'));
      assert.deepEqual([...current.content().matchAll(/data-market="item" data-id="([^"]+)"/g)].map(match=>match[1]),Array.from(unlocked));
      if(tier<4)assert.ok(current.content().includes('상품 '+trader.stockTiers[tier].length+'종 추가'));
      else assert.match(current.content(),/모든 상품 개방/);
      for(const item of trader.stockTiers.slice(tier).flat()){
        assert.ok(!current.content().includes('data-market="item" data-id="'+item+'"'));
      }
    }
  }
  const promoted=clone(starter);
  promoted.contracts.supply.done=base.g.quests.filter(q=>q.trader==='supply'&&q.tier<4)
    .sort((a,b)=>a.tier-b.tier).map(q=>q.id);
  const game=boot({[v12]:promoted},undefined,{},'#shop');
  const allOffers=Array.from(game.g.listed('supply','buy'));
  assert.ok(game.content().includes('구매 가능 '+allOffers.length+'종'));
  assert.match(game.content(),/모든 상품 개방/);
  assert.doesNotMatch(game.content(),/data-market="item" data-id="diamond"/);
  game.click({market:'mode',mode:'sell'});
  assert.match(game.content(),/data-tg="stash-select"[^>]*data-trade-item="diamond"[^>]*data-uid="s-standing-diamond"/);
  game.click({tg:'stash-select',uid:'s-standing-diamond'});
  game.click({tg:'sell-add',uid:'s-standing-diamond'});
  assert.match(game.content(),/data-tg="sale-select"[^>]*data-uid="s-standing-diamond"/);
  assert.ok(game.g.saleQuote('supply',['s-standing-diamond']).ok);
  game.click({market:'mode',mode:'buy'});

  // One person's promotion must not upgrade a different merchant's shelf.
  game.click({market:'trader',id:'medic'});
  assert.equal(game.g.standing('medic').tier,1);
  assert.match(game.content(),/우호도 2단계<\/strong><span>상품 \d+종 추가/);
  assert.doesNotMatch(game.content(),/모든 상품 개방/);
  game.click({market:'trader',id:'supply'});
  const basic=Array.from(base.g.listed('supply','buy'));
  const exclusive=allOffers.findLast(id=>!basic.includes(id));
  assert.ok(exclusive);
  game.click({market:'item',id:exclusive});
  const order={market:'trade',trader:'supply',mode:'buy',id:exclusive,qty:'1'};
  assert.ok(game.content().includes('data-market="trade" data-id="'+exclusive+'"'));
  game.click(order);
  assert.match(game.content(),/구매 완료/);

  // An import may lower a trader's level while a checkout or receipt is still open.
  const restored=new Blob([JSON.stringify({format:'rustline-tc01',session:starter})]);
  await game.g.importFile(restored);
  assert.equal(game.g.standing('supply').tier,1);
  assert.ok(game.content().includes('구매 가능 '+basic.length+'종'));
  assert.doesNotMatch(game.content(),/구매 완료/);
  assert.ok(!game.content().includes('data-id="'+exclusive+'"'));
  assert.ok(!game.content().includes(game.g.goods[exclusive][0]));
  assert.match(game.content(),/승급까지 60점/);
  const balance=game.g.s.wallet;
  game.click(order);
  assert.equal(game.g.s.wallet,balance);
  assert.equal(game.g.stock(exclusive),0);
}
verify().then(()=>console.log('PASS: promotion shelf counters, independent traders, valuables sell-back, complete continuous shelves, lower-standing restore and stale checkout.')).catch(e=>{console.error(e);process.exitCode=1});
