// Refresh the bundled index with npm run build:loot-icons. Its input pictures
// come exclusively from the public item API. No user photos enter this build.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join} from 'node:path';
import sharp from 'sharp';
import {sampleIcon} from '../website/loot-vision.mjs';

const catalogFile = process.argv[2], cacheDir = process.argv[3];
const itemURL = 'https://json.tarkov.dev/regular/items';
const output = new URL('../website/loot-icons/', import.meta.url);
const placeholder = '18d34590955714248932812d82cd4494b9647e1c476f532253ed7046f68e33e2';
async function download(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw Error('HTTP ' + response.status + ' ' + url);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500*(attempt+1)));
    }
  }
}
const catalog = JSON.parse(catalogFile ? await readFile(catalogFile,'utf8') : await download(itemURL));
const items = Object.values(catalog.data.items).sort((a,b)=>a.id.localeCompare(b.id,'en'));
const records = new Array(items.length);
let position = 0, missingArtwork = 0;
async function build() {
  while (position < items.length) {
    const i = position++, item = items[i];
    const url = new URL(item.gridImageLink);
    if (url.origin !== 'https://assets.tarkov.dev' || !/^[a-z0-9_-]{1,100}$/i.test(item.id)) throw Error('Unexpected asset for '+item.id);
    const bytes = cacheDir ? await readFile(join(cacheDir,item.id+'.webp')) : await download(url);
    if (createHash('sha256').update(bytes).digest('hex') === placeholder) {missingArtwork++; continue;}
    const {data,info} = await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const w = Math.max(1,Math.round(info.width/63)), h = Math.max(1,Math.round(info.height/63));
    const rgb = sampleIcon({data,width:info.width,height:info.height},{x:0,y:0,w:info.width,h:info.height});
    const name = Buffer.from(item.normalizedName.replaceAll('-',' '));
    if (name.length>255 || w>20 || h>20) throw Error('Unexpected icon dimensions or name '+item.id);
    const id = Buffer.from(item.id);
    records[i] = Buffer.concat([Buffer.from([id.length]),id,Buffer.from([w,h,name.length]),name,rgb]);
  }
}
await Promise.all(Array.from({length:8},build));
const included = records.filter(Boolean), header = Buffer.alloc(8);
header.write('TFI1');header.writeUInt32LE(included.length,4);
const atlas = gzipSync(Buffer.concat([header,...included]),{level:9});
await mkdir(output,{recursive:true});
await writeFile(new URL('inventory-v1.gz',output),atlas);
console.log(JSON.stringify({items:items.length,indexed:included.length,missingArtwork,bytes:atlas.length,sha256:createHash('sha256').update(atlas).digest('hex')}));
