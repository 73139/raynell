/** A/S 게시판 — Arca-like compact discussion layout without copying third-party assets. */
const $=id=>document.getElementById(id);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel=s=>{const d=new Date(s);return Number.isNaN(d.valueOf())?'시간 미확인':d.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});};
const CATS={bug:'오류 제보',question:'사용 문의',suggestion:'개선 건의'};
const STATES={open:'접수',working:'확인 중',solved:'처리 완료'};
const CACHE='tfg-support-board-local-v1';
const NICK='tfg-support-nickname';
const getLocal=()=>{try{const v=JSON.parse(localStorage.getItem(CACHE)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
const writeLocal=v=>{try{localStorage.setItem(CACHE,JSON.stringify(v.slice(0,300)));return true;}catch{return false;}};
const safeStatus=s=>Object.hasOwn(STATES,s)?s:'open';
const safeCategory=s=>Object.hasOwn(CATS,s)?s:'question';
const validate=(author,title,body,isReply=false)=>{
 if(author.trim().length<2||author.trim().length>24)return '닉네임은 2~24자로 입력해 주세요.';
 if(!isReply&&(title.trim().length<4||title.trim().length>120))return '제목은 4~120자로 입력해 주세요.';
 if(body.trim().length<(isReply?2:10)||body.trim().length>(isReply?1000:2000))return `내용은 ${isReply?2:10}~${isReply?1000:2000}자로 입력해 주세요.`;
 return '';
};
function sanitizeRow(t){if(!t||typeof t!=='object'||!String(t.id||'').trim())return null;
 return {...t,id:String(t.id).slice(0,100),title:String(t.title||'').slice(0,120),author:String(t.author||'').slice(0,24),body:String(t.body||'').slice(0,2000),category:safeCategory(t.category),status:safeStatus(t.status),replies:Array.isArray(t.replies)?t.replies.slice(0,300).map(r=>({...r,author:String(r.author||'').slice(0,24),body:String(r.body||'').slice(0,1000)})):[]};
}
export function initializeSupportBoard(){
 const root=$('support-board');if(!root)return;
 let threads=[],filter='all',keyword='',view='list',activeId='',replyTarget='',replyMode=false,working=false,connected=false,backend='',apiError='',source=null,seq=0,sort='latest',moderatorToken='';
 let nick='';try{nick=localStorage.getItem(NICK)||'';}catch{}
 let localMode=true,lastConnectedAt='',closed=false;
 const config=String(window.TFG_SUPPORT_API_BASE||'').trim().replace(/\/$/,'');
 backend=config||location.origin;
 const notice=$('support-mode'),items=$('support-list'),detail=$('support-detail'),form=$('support-post-form');
 const setHint=(msg,error=false)=>{const el=$('support-hint');if(el){el.textContent=msg||'';el.classList.toggle('support-error',error);}};
 const keepNick=v=>{nick=v;try{localStorage.setItem(NICK,v);}catch{}};
 const modeLabel=()=>connected?'공유 서버 연결 · 새 글 실시간 갱신':'로컬 기록 · 다른 사용자에게 공유되지 않음';
 const markStatus=()=>{notice.textContent=modeLabel();notice.className='support-mode '+(connected?'is-live':'is-local');$('support-refresh').disabled=working;};
 function renderSummary(){const total=threads.length,open=threads.filter(x=>x.status!=='solved').length; $('support-stat').textContent=`전체 ${total} · 미처리 ${open}`;markStatus();}
 const sorted=()=>threads.filter(t=>filter==='all'||t.category===filter).filter(t=>!keyword||`${t.title} ${t.author} ${t.body}`.toLocaleLowerCase('ko').includes(keyword)).sort((a,b)=>sort==='oldest'?String(a.createdAt).localeCompare(String(b.createdAt)):String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
 function renderList(){renderSummary();const rows=sorted(); $('support-result-count').textContent=rows.length+'건';
  items.innerHTML=rows.length?rows.map(t=>`<button type="button" class="support-list-row" data-support-open="${safe(t.id)}"><span class="support-cat cat-${t.category}">${safe(CATS[t.category])}</span><span class="support-title">${safe(t.title)} <em>[${t.replies.length}]</em></span><span class="support-author">${safe(t.author)}</span><span class="support-date">${safe(dateLabel(t.updatedAt||t.createdAt))}</span><span class="support-status status-${t.status}">${safe(STATES[t.status])}</span></button>`).join(''):`<div class="support-empty">${threads.length?'조건에 맞는 접수글이 없어요.':'아직 접수된 글이 없어요. 첫 번째 문의를 남겨 주세요.'}</div>`;
  items.querySelectorAll('[data-support-open]').forEach(el=>el.onclick=()=>openThread(el.dataset.supportOpen));
 }
 function openThread(id){activeId=id;view='detail';replyTarget='';replyMode=false;render();}
 function renderDetail(){const t=threads.find(x=>x.id===activeId);if(!t){view='list';render();return;}
  const oldAuthor=$('support-reply-author')?.value||nick;
  const oldBody=$('support-reply-body')?.value||'';
  const oldAdmin=$('support-admin-token')?.value||'';
  const oldStatus=$('support-set-status')?.value||'';
  detail.innerHTML=`<div class="support-thread-head"><button id="support-back" class="btn btn-small">← 목록으로</button><span class="support-cat cat-${t.category}">${safe(CATS[t.category])}</span><span class="support-status status-${t.status}">${safe(STATES[t.status])}</span></div><h3 class="support-thread-title">${safe(t.title)}</h3><div class="support-thread-meta">작성자 ${safe(t.author)} · ${safe(dateLabel(t.createdAt))} · 댓글 ${t.replies.length}개</div><div class="support-post-body">${safe(t.body)}</div><div class="support-comments-title">댓글 <strong>${t.replies.length}</strong></div><div class="support-comments">${t.replies.map(r=>`<article class="support-comment ${r.parentId?'nested':''}" id="support-comment-${safe(r.id)}"><div class="support-comment-top"><strong>${safe(r.author)}</strong><span>${safe(dateLabel(r.createdAt))}</span><button type="button" class="support-reply-to" data-reply-id="${safe(r.id)}">답글</button></div><p>${safe(r.body)}</p></article>`).join('')||'<div class="support-empty">아직 댓글이 없어요.</div>'}</div><form id="support-reply-form" class="support-write-form"><h4 id="support-reply-title">댓글 작성</h4><div class="support-write-fields"><label>닉네임<input id="support-reply-author" maxlength="24" value="${safe(nick)}" required placeholder="닉네임 (2~24자)"></label><label class="support-write-body">내용<textarea id="support-reply-body" maxlength="1000" rows="3" required placeholder="도움이 되는 내용이나 오류 재현 방법을 남겨주세요. 개인정보는 입력하지 마세요."></textarea></label></div><div class="support-form-actions"><span id="support-reply-target">모든 댓글은 ${connected?'이 게시판을 보는 사용자에게 공개돼요.':'현재 PC에만 저장돼요.'}</span><button class="btn btn-primary" type="submit">댓글 등록</button></div></form><details class="support-moderation"><summary>관리자 · 처리 상태 변경</summary><p>서버를 관리하는 사람만 사용해 주세요. 관리자 키는 저장하지 않습니다.</p><label>관리자 키 <input type="password" id="support-admin-token" autocomplete="off" placeholder="서버 관리자 토큰"></label><label>처리 상태 <select id="support-set-status"><option value="open">접수</option><option value="working">확인 중</option><option value="solved">처리 완료</option></select></label><button id="support-update-status" class="btn btn-small">상태 저장</button><button id="support-delete-thread" class="btn btn-small btn-danger">게시글 삭제</button></details>`;
  $('support-reply-author').value=oldAuthor;
  $('support-reply-body').value=oldBody;
  $('support-admin-token').value=oldAdmin;
  if(oldStatus)$('support-set-status').value=oldStatus;
  if(replyTarget){$('support-reply-title').textContent='답글 작성';$('support-reply-target').textContent='선택한 댓글에 답글을 답니다.';}
  $('support-back').onclick=()=>{view='list';render();};
  detail.querySelectorAll('[data-reply-id]').forEach(b=>b.onclick=()=>{replyTarget=b.dataset.replyId;$('support-reply-title').textContent='답글 작성';$('support-reply-target').textContent='선택한 댓글에 답글을 답니다.';$('support-reply-body').focus();});
  $('support-reply-form').onsubmit=async e=>{e.preventDefault();const author=$('support-reply-author').value,body=$('support-reply-body').value;const err=validate(author,'',body,true);if(err){setHint(err,true);return;}keepNick(author);await postReply(t.id,{author:author.trim(),body:body.trim(),parentId:replyTarget||null});};
  $('support-update-status').onclick=async()=>{const token=$('support-admin-token').value.trim(),status=$('support-set-status').value;if(!token){setHint('관리자 키가 필요합니다.',true);return;}await changeStatus(t.id,status,token);};
  $('support-delete-thread').onclick=async()=>{const token=$('support-admin-token').value.trim();if(!token){setHint('관리자 키가 필요합니다.',true);return;}if(!confirm('이 게시글과 모든 댓글을 영구 삭제하시겠습니까?'))return;await deleteThread(t.id,token);};
 }
 function render(){root.classList.toggle('support-detail-open',view==='detail');$('support-browse').hidden=view!=='list';detail.hidden=view!=='detail';form.hidden=view!=='compose';$('support-new-post').hidden=view==='compose';$('support-new-post').disabled=working;
  if(view==='list')renderList();else if(view==='detail')renderDetail();else {renderSummary();$('support-compose-author').value=nick;}
 }
 function setThreads(list){threads=(Array.isArray(list)?list:[]).map(sanitizeRow).filter(Boolean);render();}
 async function fetchServer(){
  const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),5000);
  try{const r=await fetch(backend+'/api/support/threads',{signal:ctrl.signal,cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();if(!Array.isArray(data.threads))throw new Error('서버 응답 형식 오류');
    const wasConnected=connected, changed=(data.seq||0)!==seq;
    connected=true;localMode=false;apiError='';lastConnectedAt=data.updatedAt||new Date().toISOString();
    seq=data.seq||0;
    if(!wasConnected||changed){setThreads(data.threads);}else{markStatus();}
    if(!wasConnected)setHint('온라인 A/S 게시판에 연결되었습니다. 글과 댓글은 다른 사용자에게도 공개됩니다.');return true;
  }catch(e){apiError=e.message||String(e);return false;}finally{clearTimeout(t);}
 }
 function startStream(){if(source){source.close();source=null;}if(!connected)return;try{source=new EventSource(backend+'/api/support/stream');source.addEventListener('updated',ev=>{try{const data=JSON.parse(ev.data);if(data.seq!==seq)void fetchServer();}catch{}});source.addEventListener('error',()=>{if(source){source.close();source=null;}setHint('실시간 연결이 끊겨 15초 주기로 서버를 확인합니다.',true);});}catch{} }
 async function initialize(){const found=await fetchServer();if(found){startStream();return;}connected=false;localMode=true;setThreads(getLocal());setHint('공유 게시판 서버가 연결되지 않아 이 PC에서만 저장됩니다. 다른 사람과 실시간 공유하려면 서버를 연결해야 합니다.',true);}
 async function sync(){if(working)return;working=true;markStatus();if(connected){const ok=await fetchServer();if(!ok){connected=false;source?.close();source=null;setThreads(getLocal());setHint('공유 서버가 응답하지 않아 로컬 기록만 표시합니다. 온라인 글은 서버 재연결 시 다시 나타납니다.',true);}}else{const ok=await fetchServer();if(ok)startStream();else setThreads(getLocal());}working=false;markStatus();}
 async function postThread(values){
  if(working)return;working=true;markStatus();
  try{
   if(connected){const r=await fetch(backend+'/api/support/threads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const d=await r.json();if(!r.ok)throw new Error(d.error||'접수 실패');await fetchServer();openThread(d.thread.id);setHint('문의가 접수되어 다른 사용자에게도 표시됩니다.');}
   else{const now=new Date().toISOString();const t={...values,id:'local-'+crypto.randomUUID(),createdAt:now,updatedAt:now,replies:[],status:'open'};const list=[t,...getLocal()];if(!writeLocal(list))throw new Error('로컬 저장 공간 부족');setThreads(list);openThread(t.id);setHint('현재 PC에만 저장되었습니다. 다른 사용자에게는 보이지 않습니다.',true);}
  }catch(e){setHint('작성 실패: '+(e.message||e),true);}finally{working=false;markStatus();}
 }
 async function postReply(id,values){
  if(working)return;working=true;markStatus();try{
   if(connected){const r=await fetch(backend+'/api/support/threads/'+encodeURIComponent(id)+'/replies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const d=await r.json();if(!r.ok)throw new Error(d.error||'댓글 등록 실패');await fetchServer();setHint('댓글이 등록되었습니다.');}
   else{const list=getLocal();const t=list.find(x=>x.id===id);if(!t)throw new Error('글을 찾지 못함');const now=new Date().toISOString();t.replies.push({...values,id:crypto.randomUUID(),createdAt:now});t.updatedAt=now;if(!writeLocal(list))throw new Error('로컬 저장 공간 부족');setThreads(list);setHint('댓글이 현재 PC에만 저장되었습니다.',true);}
  }catch(e){setHint('댓글 실패: '+(e.message||e),true);}finally{working=false;markStatus();}
 }
 async function changeStatus(id,status,token){if(!connected){setHint('로컬 테스트 모드에서는 관리자 상태 변경을 지원하지 않습니다.',true);return;}try{const r=await fetch(backend+'/api/support/threads/'+encodeURIComponent(id)+'/status',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error||'변경 실패');await fetchServer();setHint('처리 상태 변경 완료');}catch(e){setHint('상태 변경 실패: '+(e.message||e),true);}}
 async function deleteThread(id,token){if(!connected){setHint('공유 서버 연결이 필요합니다.',true);return;}try{const r=await fetch(backend+'/api/support/threads/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok)throw new Error(d.error||'삭제 실패');view='list';activeId='';await fetchServer();setHint('게시글을 삭제했습니다.');}catch(e){setHint('삭제 실패: '+(e.message||e),true);}}
 $('support-refresh').onclick=sync;
 $('support-new-post').onclick=()=>{view='compose';render();};
 $('support-cancel-compose').onclick=()=>{view='list';render();};
 $('support-compose-form').onsubmit=async e=>{e.preventDefault();const author=$('support-compose-author').value,title=$('support-compose-title').value,bodyText=$('support-compose-body').value,category=$('support-compose-category').value;const err=validate(author,title,bodyText);if(err){setHint(err,true);return;}if(!Object.hasOwn(CATS,category)){setHint('카테고리를 선택하세요.',true);return;}keepNick(author);await postThread({author:author.trim(),title:title.trim(),body:bodyText.trim(),category});};
 $('support-search').oninput=e=>{keyword=e.target.value.trim();renderList();};
 $('support-category').onchange=e=>{filter=e.target.value;renderList();};
 $('support-sort').onchange=e=>{sort=e.target.value;renderList();};
 window.addEventListener('storage',e=>{if(e.key===CACHE&&!connected){setThreads(getLocal());}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
 setInterval(()=>{if(!document.hidden)void sync();},15000);
 void initialize();render();
 return {refresh:sync,close(){closed=true;source?.close();}};
}

// The support board runs independently from the map/data app.
initializeSupportBoard();