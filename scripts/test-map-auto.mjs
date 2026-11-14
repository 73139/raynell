import assert from 'node:assert/strict';
import {mapKeyForPreset,mapEventFromLogLine,createBrowserLogWatcher} from '../website/map-log-detector.mjs';
assert.equal(mapKeyForPreset('customs_preset'),'customs');
assert.equal(mapKeyForPreset('shoreline_preset'),'shoreline');
assert.equal(mapKeyForPreset('city_preset'),'streets-of-tarkov');
assert.equal(mapKeyForPreset('labyrinth_preset'),'the-labyrinth');
assert.equal(mapKeyForPreset('sandbox_high'),'ground-zero');
assert.equal(mapKeyForPreset('invented_map_preset'),null);
assert.equal(mapEventFromLogLine('2026-11-14|application|scene preset path:maps/factory4_night.bundle')?.mapKey,'factory');
assert.equal(mapEventFromLogLine('TRACE-NetworkGameCreate profileStatus Location: bigmap, Sid: xxx')?.mapKey,'customs');
assert.equal(mapEventFromLogLine('unrelated text with Location: bigmap'),null);
let now=1000;
const file=(content)=>{
  let text=content,updated=++now;
  return {
    append(s){text+=s;updated=++now;},
    handle:{name:'application_000.log',kind:'file',async getFile(){
      const snapshot=Buffer.from(text);
      return {size:snapshot.length,lastModified:updated,slice(start,end){
        const b=snapshot.subarray(start,end);
        return {async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
      }};
    }}
  };
};
const folder=(name,entries)=>({name,kind:'directory',async *values(){yield* entries}});
const file1=file('scene preset path:maps/customs_preset.bundle\n');
const session1=folder('log_2026.11.14_12-00-00',[file1.handle]);
const sessions=[session1];
const root=folder('Logs',sessions);
globalThis.window={showDirectoryPicker:async()=>root};
const events=[],statuses=[];
const watcher=createBrowserLogWatcher({onMap:e=>events.push(e.mapKey),onStatus:s=>statuses.push(s),intervalMs:60000});
await watcher.choose();
assert.equal(events.length,0,'Old log must not auto-switch on initial connect');
file1.append('scene preset path:maps/shoreline_pre');
await watcher.tick();
assert.equal(events.length,0,'Incomplete line must be held');
file1.append('set.bundle\n');
await watcher.tick();
assert.deepEqual(events,['shoreline']);
file1.append('scene preset path:maps/shoreline_preset.bundle\n');
await watcher.tick();
assert.deepEqual(events,['shoreline'],'Duplicate same map must not re-switch');
watcher.setEnabled(false);
file1.append('scene preset path:maps/woods_preset.bundle\n');
await watcher.tick();
assert.deepEqual(events,['shoreline'],'Disable must prevent auto scanning');
watcher.setEnabled(true);
await watcher.tick();
assert.deepEqual(events,['shoreline','woods']);
const file2=file('scene preset path:maps/factory4_day.bundle\n');
const session2=folder('log_2026.11.14_13-00-00',[file2.handle]);
sessions.unshift(session2);
await watcher.tick();
assert.deepEqual(events,['shoreline','woods','factory'],'New session must be detected');
watcher.close();
const empty=folder('Logs',[]);
globalThis.window.showDirectoryPicker=async()=>empty;
const freshEvents=[];
const fresh=createBrowserLogWatcher({onMap:e=>freshEvents.push(e.mapKey),intervalMs:60000});
await fresh.choose();
assert.equal(freshEvents.length,0);
const newFile=file('scene preset path:maps/city_preset.bundle\n');
empty.values=async function*(){yield folder('log_2026.11.14_14-00-00',[newFile.handle]);};
await fresh.tick();
assert.deepEqual(freshEvents,['streets-of-tarkov'],'New raid after initially empty Logs should switch');
fresh.close();
console.log('PASS browser opt-in log folder, preset aliases, initial historical protection, partial lines, new sessions, opt-out and first raid after empty folder');
