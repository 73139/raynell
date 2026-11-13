import { createQuestOcr } from './quest-ocr.mjs';
import { matchQuestText } from './quest-match.mjs';

const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initializeQuestOcr({getTasks,getMode,getTaskInfo,onApply,onBatchReady=()=>{},onOpen,onMap,onNotify=()=>{},onAutoChange=()=>{}}) {
  const $=id=>document.getElementById(id),dialog=$('quest-ocr-dialog');
  let lastFile=null,previewURL='',controller=null,busy=false,serial=0,pending=null;
  let lastRead=null,lastMode=getMode(),lastSource='',connection={connected:false,label:''};
  let result={matches:[],candidates:[]},applied=new Set(),waitingForData=false;
  const engine=createQuestOcr({onProgress:({progress,message})=>{if(!busy)return;$('quest-ocr-progress').value=progress;$('quest-ocr-status').textContent=message;}});

  function open(){if(!dialog.open)dialog.showModal();}
  function close(){dialog.close();}
  function status(message,error=false){$('quest-ocr-status').textContent=message;$('quest-ocr-status').classList.toggle('is-error',error);}
  function setBusy(value){
    busy=value;dialog.setAttribute('aria-busy',String(value));
    $('quest-ocr-progress').hidden=!value;$('quest-ocr-cancel').hidden=!value;
    $('quest-ocr-retry').hidden=value||!lastFile;
    $('quest-ocr-upload').disabled=value;$('quest-ocr-file').disabled=value;
    $('quest-ocr-language').disabled=value;$('quest-ocr-rematch').disabled=value;
  }
  function renderAuto(){
    const enabled=$('quest-ocr-auto').checked;
    $('quest-ocr-auto-status').textContent=!enabled?'켜면 연결된 폴더의 새 캡처를 자동으로 읽어요.':connection.connected?`${connection.label} · 켠 뒤 새로 저장되는 이미지부터 분석해요.`:'자동 인식 켜짐 · 지도 화면에서 스크린샷 폴더를 연결해 주세요.';
  }
  function renderResults(){
    const rows=[...result.matches,...result.candidates];
    $('quest-ocr-result-count').textContent=rows.length?`일치 ${result.matches.length} · 확인 필요 ${result.candidates.length}`:'인식 결과';
    $('quest-ocr-results').innerHTML=rows.length?rows.map(row=>{
      const task=getTasks().find(t=>t.id===row.taskId);if(!task)return '';
      const info=getTaskInfo(task.id),confirmed=applied.has(task.id),candidate=!row.automatic&&!confirmed;
      const maps=(info.maps||[]).map(map=>`<button type="button" class="text-button" data-ocr-map="${escapeHTML(map.key)}" data-ocr-task="${escapeHTML(task.id)}">${escapeHTML(map.name)}${map.targets?` · 목표 ${map.targets}`:''} ↗</button>`).join('');
      const badge=candidate?'확인 필요':info.totalTargets?'지도 고정':'퀘스트 찾음';
      const description=candidate?'비슷한 이름이에요. 퀘스트명과 부·편 번호를 확인해 주세요.':info.totalTargets?`등록된 목표 ${info.totalTargets}개${info.currentTargets?` · 현재 지도 ${info.currentTargets}개`:' · 아래에서 해당 지도를 선택하세요.'}`:'등록된 목표 좌표가 없어요. 상세 조건을 확인할 수 있어요.';
      return `<article class="ocr-result-card${candidate?' uncertain':''}"><div class="ocr-result-meta"><span>${escapeHTML(task.traderName||'상인 미등록')}</span><span class="ocr-match-badge">${badge}</span></div><h3 class="ocr-result-title">${escapeHTML(task.name)}</h3>${task.nameEn&&task.nameEn!==task.name?`<p class="ocr-result-note">${escapeHTML(task.nameEn)}</p>`:''}<p class="ocr-result-description">${description}</p><div class="ocr-result-actions">${candidate?`<button type="button" class="btn btn-small btn-primary" data-ocr-confirm="${escapeHTML(task.id)}">이 퀘스트 표시</button>`:''}<button type="button" class="btn btn-small" data-ocr-open="${escapeHTML(task.id)}">목표 보기</button>${maps}</div><p class="ocr-result-note">읽은 글자: ${escapeHTML(row.evidence)}${info.status==='done'?' · 기존 완료 기록 유지':''}</p></article>`;
    }).join(''):`<p class="ocr-result-note">${waitingForData?'퀘스트 데이터를 불러오면 읽은 글자로 자동으로 다시 찾아요.':lastRead?'일치하는 퀘스트를 찾지 못했어요. 퀘스트 이름이 크게 보이도록 목록 부분만 캡처하거나, 아래에서 읽은 글자를 수정해 주세요.':'퀘스트 이름이 보이는 목록이나 상세 화면을 캡처해 주세요.'}</p>`;
  }
  function match({manual=false,notify=true}={}){
    if(!lastRead)return;
    if(lastMode!==getMode()){resetForMode();return;}
    const tasks=getTasks();waitingForData=!tasks.length;
    result=matchQuestText(lastRead.text,tasks,{ocrConfidence:manual?100:lastRead.confidence,lineConfidences:manual?[]:lastRead.lineConfidences});
    const fresh=result.matches.filter(row=>!applied.has(row.taskId)).map(row=>row.taskId);
    if(fresh.length){onApply(fresh);for(const id of fresh)applied.add(id);}
    renderResults();
    if(waitingForData){status('글자는 읽었어요. 퀘스트 데이터 연결을 기다리고 있어요.');return;}
    const prefix=manual?'수정한 글자':lastSource==='자동 캡처'?'새 캡처':'캡처';
    status(result.matches.length?`${prefix}에서 퀘스트 ${result.matches.length}개를 찾았어요.${result.candidates.length?` 확인할 후보 ${result.candidates.length}개도 있어요.`:''}`:result.candidates.length?`비슷한 퀘스트 ${result.candidates.length}개를 찾았어요. 이름을 확인해 주세요.`:'인식한 글자와 일치하는 퀘스트가 없어요.');
    if(notify&&fresh.length){const pinned=fresh.filter(id=>getTaskInfo(id).totalTargets).length;onNotify(`캡처에서 퀘스트 ${fresh.length}개를 찾았어요.${pinned?` ${pinned}개 퀘스트의 목표를 지도에 고정했어요.`:' 좌표 없는 퀘스트의 상세 조건을 확인해 주세요.'}`);}
    if(!waitingForData&&fresh.length&&$('quest-ocr-return-map').checked){
      onBatchReady(result.matches.map(row=>row.taskId),result.candidates.length);
      if(dialog.open)close();
    }
  }
  async function ingest(file,{automatic=false,name=file?.name||'클립보드 캡처'}={}){
    if(!file)return;
    if(busy){if(automatic)pending={file,name};else onNotify('이전 캡처를 분석하고 있어요. 취소 후 다시 넣을 수 있어요.');return;}
    if(automatic&&!$('quest-ocr-auto').checked)return;
    const run=++serial;controller=new AbortController();lastFile=file;lastMode=getMode();lastSource=automatic?'자동 캡처':'파일 캡처';
    lastRead=null;result={matches:[],candidates:[]};applied.clear();waitingForData=false;
    if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(file);
    $('quest-ocr-preview').src=previewURL;$('quest-ocr-preview').hidden=false;
    $('quest-ocr-file-name').textContent=name;$('quest-ocr-text').value='';
    if(!automatic)open();status('캡처 이미지를 준비하고 있어요.');setBusy(true);renderResults();
    const language=$('quest-ocr-language').value;
    $('quest-ocr-engine-note').textContent=language==='eng'?'영어 인식 · 이미지의 글자는 이 브라우저에서 처리해요.':'한글·영어 인식 · 한글 인식 파일은 첫 사용 시 인터넷으로 받아요.';
    try{
      const read=await engine.recognize(file,{language,signal:controller.signal});
      if(run!==serial||lastMode!==getMode())return;
      lastRead=read;$('quest-ocr-text').value=read.text;
      match();
      if(!read.text.trim())status('글자를 찾지 못했어요. 퀘스트 이름이 선명하게 보이는 화면을 캡처해 주세요.');
    }catch(error){
      if(run!==serial)return;
      status(error.name==='AbortError'?'분석을 취소했어요.':error.message||'캡처를 분석하지 못했어요.',error.name!=='AbortError');
      if(automatic&&error.name!=='AbortError'){
        $('quest-ocr-auto').checked=false;renderAuto();onAutoChange(false);
        onNotify('퀘스트 자동 인식이 멈췄어요. ‘퀘스트 캡처’에서 오류를 확인해 주세요.',true);
      }
    }finally{
      if(run!==serial)return;
      setBusy(false);controller=null;
      const next=pending;pending=null;
      if(next&&$('quest-ocr-auto').checked)void ingest(next.file,{automatic:true,name:next.name});
    }
  }
  function resetForMode(){
    serial++;controller?.abort();controller=null;pending=null;
    lastRead=null;lastFile=null;setBusy(false);lastMode=getMode();applied.clear();
    result={matches:[],candidates:[]};waitingForData=false;
    if(previewURL){URL.revokeObjectURL(previewURL);previewURL='';}
    $('quest-ocr-preview').hidden=true;$('quest-ocr-preview').removeAttribute('src');$('quest-ocr-file-name').textContent='';$('quest-ocr-text').value='';
    status('게임 모드를 바꿨어요. 이 모드의 퀘스트 화면을 새로 캡처해 주세요.');renderResults();
  }
  function cancelAutomatic(){
    pending=null;
    if(lastSource!=='자동 캡처'||(!busy&&!waitingForData))return;
    serial++;controller?.abort();controller=null;setBusy(false);
    lastRead=null;waitingForData=false;result={matches:[],candidates:[]};
    status('자동 분석을 멈췄어요. 다시 켠 뒤 새 캡처부터 읽어요.');renderResults();
  }
  document.querySelectorAll('[data-open-quest-ocr]').forEach(button=>button.addEventListener('click',open));
  $('close-quest-ocr').addEventListener('click',close);
  dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
  $('quest-ocr-upload').addEventListener('click',()=>$('quest-ocr-file').click());
  $('quest-ocr-file').addEventListener('change',event=>{void ingest(event.target.files[0]);event.target.value='';});
  $('quest-ocr-retry').addEventListener('click',()=>{if(lastFile)void ingest(lastFile,{name:$('quest-ocr-file-name').textContent});});
  $('quest-ocr-cancel').addEventListener('click',()=>{pending=null;controller?.abort();});
  $('quest-ocr-rematch').addEventListener('click',()=>{
    const text=$('quest-ocr-text').value.trim();if(!text){status('퀘스트 이름을 한 줄에 하나씩 입력해 주세요.');return;}
    lastMode=getMode();lastRead={text,confidence:100,lineConfidences:[]};lastSource='입력한 글자';match({manual:true});
  });
  $('quest-ocr-auto').addEventListener('change',()=>{pending=null;renderAuto();onAutoChange($('quest-ocr-auto').checked);});
  $('quest-ocr-results').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.ocrConfirm){const id=button.dataset.ocrConfirm;onApply([id]);applied.add(id);renderResults();if($('quest-ocr-return-map').checked){onBatchReady([...result.matches.map(row=>row.taskId),id],Math.max(0,result.candidates.length-1));close();}}
    if(button.dataset.ocrOpen){close();onOpen(button.dataset.ocrOpen);}
    if(button.dataset.ocrMap){close();onMap(button.dataset.ocrMap,button.dataset.ocrTask);}
  });
  $('quest-import-zone').addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();});
  $('quest-import-zone').addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();document.body.classList.remove('file-dragging');void ingest(event.dataTransfer.files[0]);});
  $('quest-ocr-drop').addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();});
  $('quest-ocr-drop').addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();document.body.classList.remove('file-dragging');void ingest(event.dataTransfer.files[0]);});
  document.addEventListener('paste',event=>{
    if(event.target.matches('input,textarea,[contenteditable="true"]'))return;
    const item=[...(event.clipboardData?.items||[])].find(item=>item.type.startsWith('image/'));
    if(item){event.preventDefault();void ingest(item.getAsFile());}
  });
  window.addEventListener('beforeunload',()=>{controller?.abort();if(previewURL)URL.revokeObjectURL(previewURL);void engine.dispose();});
  renderAuto();renderResults();
  return {
    ingest,open,get autoEnabled(){return $('quest-ocr-auto').checked;},
    setConnection(value){connection=value;renderAuto();},
    dataReady(){if(lastRead&&waitingForData)match();},resetForMode,cancelAutomatic,
    reportError(message){status(message,true);onNotify(message,true);},
  };
}