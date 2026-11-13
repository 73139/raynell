import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import sharp from 'sharp';
import {readIconAtlas,recognizeInventory} from '../website/loot-vision.mjs';
import {normalizeMarketCatalog} from '../website/market-core.mjs';
import {valuation} from '../website/loot-core.mjs';

const atlas=readIconAtlas(gunzipSync(await readFile(new URL('../website/loot-icons/inventory-v1.gz',import.meta.url))));
assert.ok(atlas.names.size>=5300);
const fixture=name=>readFile(new URL('./fixtures/loot/'+name,import.meta.url));
async function scan(image,options){
  const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return recognizeInventory({data,width:info.width,height:info.height},atlas,options);
}
const bag=await fixture('icon-only-bag.png');
const expected=['gp coin','gp coin','graphics card','bolts','salewa first aid kit'].sort();
for(const photo of [sharp(bag), sharp(await sharp(bag).resize(444,291,{fit:'fill'}).jpeg({quality:77}).toBuffer())]){
  const hits=await scan(photo);
  assert.equal(hits.length,5);
  assert.deepEqual(hits.filter(h=>h.confirmed).map(h=>h.candidates[0].name).sort(),expected);
}
const one=await scan(sharp(bag).extract({left:81,top:86,width:127,height:64}),{single:true});
assert.equal(one[0].candidates[0].name,'salewa first aid kit');assert.ok(one[0].confirmed);
const cases=await scan(sharp(await fixture('similar-cases.png')),{single:true});
assert.equal(cases.length,1);assert.equal(cases[0].confirmed,false);
assert.ok(cases[0].candidates.length>1&&cases[0].candidates.every(c=>c.name.startsWith('sealed weapon case')));
const blank=sharp({create:{width:290,height:185,channels:3,background:'#161819'}});
assert.deepEqual(await scan(blank),[]);
const vendor='54cb57776803fa99248b456e',kit='544fb45d4bdc2dee738b4568';
const market=normalizeMarketCatalog({
  items:{data:{items:{[kit]:{id:kit,name:'Salewa',lastLowPrice:20000,
    sellToTrader:[{trader:vendor,price:7695,priceRUB:7695,currency:'RUB'}],
    buyFromTrader:[{trader:vendor,price:37126,priceRUB:37126,currency:'RUB'}]}}}},
  traders:{data:{[vendor]:{id:vendor,name:vendor+' Nickname',normalizedName:'therapist'}}},
  tradersKo:{data:{[vendor+' Nickname']:'테라피스트'}}
});
const valued=valuation([{id:one[0].candidates[0].id,quantity:2}],market);
assert.equal(valued.flea,40000);assert.equal(valued.trader,15390);
assert.equal(market.items[0].bestTraderSell.traderName,'테라피스트');
console.log('PASS '+atlas.names.size+' visual references, no-caption multi-item photo, repeated icons, rotated medicine, JPEG scaling, manual crop, identical-art review and empty photo');
