import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const base=path.join(process.cwd(),'manual-overlay');
const data=JSON.parse(await fs.readFile(path.join(base,'maps.json'),'utf8'));
assert.equal(data.mode,'manual-only');
assert.ok(data.maps.length>=10);
const seen=new Set();
for(const map of data.maps){
 assert.match(map.key,/^[a-z0-9-]+$/);
 assert.ok(!seen.has(map.key));seen.add(map.key);
 assert.ok(map.floors.length);
 for(const floor of map.floors){
  assert.match(floor.file,/^assets\/[a-z0-9-]+\/[0-9]+\.png$/);
  const file=path.join(base,floor.file);
  const meta=await sharp(file).metadata();
  assert.equal(meta.format,'png');
  assert.ok(meta.width>0&&meta.height>0&&meta.width<=1400&&meta.height<=1400);
 }
}
const source=await fs.readFile(path.join(base,'ManualMapOverlay.ps1'),'utf8');
for(const prohibited of ['ReadProcessMemory','WriteProcessMemory','GetAsyncKeyState','SetWindowsHookEx','SendInput','DllImport','Get-Process','Get-ChildItem','Invoke-WebRequest','Invoke-RestMethod','Start-Process','application_000.log','Screenshots\\','keybd_event','mouse_event']){
 assert.equal(source.toLowerCase().includes(prohibited.toLowerCase()),false,'Unexpected game-access API: '+prohibited);
}
assert.match(source,/FormBorderStyle/);
assert.match(source,/TopMost/);
assert.match(source,/SelectedIndexChanged/);
assert.match(source,/Opacity/);
console.log('PASS manual overlay: '+data.maps.length+' maps, offline PNGs and static no-game-access policy');
