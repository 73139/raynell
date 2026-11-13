import {readIconAtlas, recognizeInventory} from './loot-vision.mjs';

let atlasPromise;
async function loadAtlas() {
  const response = await fetch('./loot-icons/inventory-v1.gz');
  if (!response.ok) throw Error('아이콘 도감을 불러오지 못했습니다. 다시 분석해 주세요.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Hosts may either serve the gzip file verbatim or decode it in transit.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return readIconAtlas(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return readIconAtlas(await new Response(stream).arrayBuffer());
}

self.onmessage = async ({data}) => {
  const {ticket, image, single} = data;
  try {
    if (!atlasPromise) atlasPromise = loadAtlas().catch(error => {atlasPromise=null; throw error;});
    const atlas = await atlasPromise;
    self.postMessage({ticket,progress:'가방 칸과 아이템 그림을 비교하고 있어요.'});
    const hits = recognizeInventory(image,atlas,{single});
    self.postMessage({ticket,hits});
  } catch (error) {
    self.postMessage({ticket,error:String(error.message||error)});
  }
};
