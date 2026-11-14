// Read only user-selected Escape from Tarkov application logs.
// Browser access is opt-in and the file contents never leave this device.
const presetAliases = Object.freeze({
  bigmap:'customs',customs:'customs',woods:'woods',shoreline:'shoreline',
  interchange:'interchange',rezervbase:'reserve',reserve:'reserve',
  lighthouse:'lighthouse',tarkovstreets:'streets-of-tarkov',
  city:'streets-of-tarkov',streets:'streets-of-tarkov',
  factory4_day:'factory',factory4_night:'factory',factory_day:'factory',
  factory_night:'factory',factory:'factory',
  sandbox:'ground-zero',sandbox_high:'ground-zero',
  groundzero:'ground-zero',laboratory:'the-lab',lab:'the-lab',
  labyrinth:'the-labyrinth',icebreaker:'icebreaker',terminal:'terminal'
});
const scenePattern=/scene\s+preset[^\r\n]*?maps[\\/]([a-z0-9_-]+)\.bundle/i;
const locationPattern=/\bLocation:\s*([a-z0-9_-]+)/i;
const networkLine=/(?:TRACE-NetworkGameCreate|GameStarting|GameStarted|profileStatus)/;
const applicationFile=/^application(?:_\d+)?\.log$/i;
export function mapKeyForPreset(preset){
  const raw=String(preset||'').trim().toLowerCase();
  return presetAliases[raw]||presetAliases[raw.replace(/_preset$/,'')]||null;
}
export function mapEventFromLogLine(line){
  let match=scenePattern.exec(line);
  if(match)return {mapKey:mapKeyForPreset(match[1]),preset:match[1].toLowerCase(),source:'scene-preset'};
  if(networkLine.test(line)&&(match=locationPattern.exec(line)))
    return {mapKey:mapKeyForPreset(match[1]),preset:match[1].toLowerCase(),source:'network-game'};
  return null;
}
async function newestApplication(root){
  const direct=[];
  async function readSession(folder){
    const candidates=[];
    for await(const item of folder.values()){
      if(item.kind==='file'&&applicationFile.test(item.name)){
        try {const file=await item.getFile();candidates.push({name:item.name,file,source:folder.name+'/'+item.name});}catch{}
      }
    }
    return candidates.sort((a,b)=>b.file.lastModified-a.file.lastModified)[0]||null;
  }
  const sessionFolders=[];
  for await(const item of root.values()){
    if(item.kind==='file'&&applicationFile.test(item.name)){
      try {const file=await item.getFile();direct.push({name:item.name,file,source:root.name+'/'+item.name});}catch{}
    }
    if(item.kind==='directory'&&/^log_/i.test(item.name))sessionFolders.push(item);
  }
  sessionFolders.sort((a,b)=>b.name.localeCompare(a.name));
  const candidates=[...direct];
  // Limit repeated traversals; sorted launch directory names are chronological.
  for(const folder of sessionFolders.slice(0,4)){
    const entry=await readSession(folder);
    if(entry)candidates.push(entry);
  }
  return candidates.sort((a,b)=>b.file.lastModified-a.file.lastModified)[0]||null;
}
export function createBrowserLogWatcher({onMap=()=>{},onStatus=()=>{},intervalMs=2500}={}){
  let root=null,source='',offset=0,tail='',timer=null,busy=false,closed=false;
  let first=true,enabled=true,lastMap=null;
  async function tick(){
    if(busy||!root||closed||!enabled)return;
    busy=true;
    try{
      const result=await newestApplication(root);
      if(!result){first=false;onStatus({connected:true,folder:root.name,error:'application_000.log가 아직 없습니다. 게임을 실행해 주세요.'});return;}
      const fresh=source!==result.source;
      if(fresh){source=result.source;offset=0;tail='';lastMap=null;}
      if(result.file.size<offset){offset=0;tail='';}
      if(result.file.size===offset){first=false;onStatus({connected:true,folder:root.name,source,lastMap});return;}
      let start=offset, truncated=false;
      if(result.file.size-start>128*1024){start=result.file.size-128*1024;tail='';truncated=true;}
      const bytes=await result.file.slice(start,Math.min(result.file.size,start+128*1024)).arrayBuffer();
      const contents=new TextDecoder().decode(bytes);
      offset=start+bytes.byteLength;
      let complete=tail+contents;
      if(truncated){const cut=complete.indexOf('\n');complete=cut<0?'':complete.slice(cut+1);}
      const lines=complete.split('\n');
      tail=lines.pop()||'';
      if(tail.length>8192)tail='';
      const initial=first;
      first=false;
      for(const line of lines){
        const event=mapEventFromLogLine(line);
        if(!event||!event.mapKey)continue;
        const changed=lastMap!==event.mapKey;
        lastMap=event.mapKey;
        // Never switch based on a previous raid at initial connection.
        if(!initial && changed)onMap({...event,source:'browser-'+event.source});
      }
      onStatus({connected:true,folder:root.name,source,lastMap,historical:initial});
    }catch(error){onStatus({connected:false,folder:root.name,error:String(error.message||error)})}
    finally{busy=false;}
  }
  async function choose(){
    if(typeof window.showDirectoryPicker!=='function')throw Error('Chrome/Edge에서만 Logs 폴더 연결을 지원해요.');
    const folder=await window.showDirectoryPicker({id:'tfg-eft-logs',mode:'read'});
    if(closed)return;
    root=folder;source='';offset=0;tail='';first=true;lastMap=null;
    if(timer)clearInterval(timer);
    await tick();
    timer=setInterval(tick,Math.max(1500,intervalMs));
    return folder.name;
  }
  function setEnabled(value){enabled=!!value;if(enabled&&root)return tick();return Promise.resolve();}
  function close(){closed=true;root=null;if(timer)clearInterval(timer);timer=null;}
  return {choose,setEnabled,close,tick,get connected(){return !!root},get folder(){return root?.name||''}};
}
