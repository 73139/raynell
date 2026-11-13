// Prepare open-source, pinned OCR engine assets for the web UI.
// The Render free service runs `node support-service/server.mjs` directly,
// so prepare them at startup if the deployment lacks binary assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dest=path.join(ROOT,'website/vendor/ocr');
const specs=[
 ['tesseract.js/dist/tesseract.min.js','tesseract.min.js','000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e'],
 ['tesseract.js/dist/worker.min.js','worker.min.js','576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d'],
 ['tesseract.js-core/tesseract-core-lstm.wasm.js','tesseract-core-lstm.wasm.js','eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680'],
 ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js','c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38'],
 ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js','tesseract-core-relaxedsimd-lstm.wasm.js','861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3'],
];
const model=['eng.traineddata','7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function verified(p,sha){try{return hash(await fs.readFile(p))===sha;}catch{return false;}}
export async function prepareOCR(){
 await fs.mkdir(dest,{recursive:true});
 const missing=[];
 for(const [source,target,sha] of specs)if(!await verified(path.join(dest,target),sha))missing.push([source,target,sha]);
 if(missing.length){
  console.log('TFG OCR: preparing pinned Tesseract.js v7 assets');
  await execFileAsync('npm',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:ROOT,timeout:180000,maxBuffer:1024*1024});
  for(const [source,target,sha] of missing){
   const from=path.join(ROOT,'node_modules',source),into=path.join(dest,target),bytes=await fs.readFile(from);
   if(hash(bytes)!==sha)throw new Error('OCR integrity mismatch: '+target);
   await fs.writeFile(into,bytes);
  }
 }
 if(!await verified(path.join(dest,model[0]),model[1])){
  const ctrl=new AbortController(),deadline=setTimeout(()=>ctrl.abort(),90000);
  try{
   console.log('TFG OCR: fetching public English OCR language data');
   const response=await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata',{signal:ctrl.signal});
   if(!response.ok)throw new Error('OCR language HTTP '+response.status);
   const bytes=Buffer.from(await response.arrayBuffer());
   if(hash(bytes)!==model[1])throw new Error('OCR language data integrity mismatch');
   await fs.writeFile(path.join(dest,model[0]),bytes);
  }finally{clearTimeout(deadline);}
 }
 console.log('TFG OCR: verified local OCR assets ready');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareOCR();