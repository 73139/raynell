// Reuse the exact successful Actions map build on the existing free web service.
// Fall back to the SHA-locked public sources when the release is unavailable.
import fs from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BASE='https://github.com/73139/raynell/releases/download/tfg-r16-windows/';
export function validateArchiveListing(names,details){
 const files=names.trim().split('\n').filter(Boolean);
 if(!files.length||files.length>150)throw Error('Invalid map archive file count');
 for(const name of files){if(!/^(?:maps\/latest\/[A-Za-z0-9_./-]*|MAP_SOURCES\.txt)$/.test(name)||name.split('/').some(p=>p==='..'||p==='.')||name.includes('\\'))throw Error('Invalid map archive path');}
 if(details.trim().split('\n').some(line=>!/^[-d]/.test(line)))throw Error('Map archive contains links or unsupported entries');
 if(!files.includes('maps/latest/manifest.json')||!files.includes('maps/latest/BUILD_COMMIT.txt'))throw Error('Map archive metadata missing');
 return files;
}
export async function restoreBuiltMaps(){
 const commit=process.env.RENDER_GIT_COMMIT;if(!/^[a-f0-9]{40}$/.test(commit||''))return false;
 const site=path.join(ROOT,'website'),marker=path.join(site,'maps/latest/BUILD_COMMIT.txt');
 try{if((await fs.readFile(marker,'utf8')).trim()===commit)return true;}catch{}
 const archive=path.join(os.tmpdir(),'tfg-maps-'+crypto.randomUUID()+'.tar.gz');
 try{
  const sums=await fetch(BASE+'SHA256SUMS.txt?commit='+commit,{signal:AbortSignal.timeout(30000)});if(!sums.ok)throw Error('Map checksum unavailable');
  const expected=(await sums.text()).split('\n').find(line=>/\sTarkovFieldGuide_Maps\.tar\.gz$/.test(line.trim()))?.trim().split(/\s+/)[0];
  if(!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Map bundle not published for this build');
  console.log('TFG maps: restoring verified Actions map bundle');
  const response=await fetch(BASE+'TarkovFieldGuide_Maps.tar.gz?commit='+commit,{signal:AbortSignal.timeout(180000)});if(!response.ok||!response.body)throw Error('Map bundle download failed');
  const bytes=Number(response.headers.get('content-length'));if(bytes>220000000)throw Error('Map bundle exceeds size limit');
  await pipeline(Readable.fromWeb(response.body),createWriteStream(archive,{flags:'wx'}));
  const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
  if(hash.digest('hex')!==expected)throw Error('Map bundle checksum mismatch');
  const options={maxBuffer:1048576,timeout:60000};
  const listing=await exec('tar',['-tzf',archive],options),details=await exec('tar',['-tvzf',archive],options);
  validateArchiveListing(listing.stdout,details.stdout);
  // Read the commit before extraction, so an unrelated release cannot replace maps.
  const built=await exec('tar',['-xOzf',archive,'maps/latest/BUILD_COMMIT.txt'],options);
  if(built.stdout.trim()!==commit)throw Error('Map bundle commit differs from deployment');
  await exec('tar',['-xzf',archive,'--no-same-owner','--no-same-permissions','-C',site],options);
  console.log('TFG maps: restored successful Actions build '+commit.slice(0,8));return true;
 }catch(error){console.log('TFG maps: '+error.message+'; composing verified public sources');return false;}
 finally{await fs.unlink(archive).catch(()=>{});}
}
