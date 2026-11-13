import { createQuestOcr } from './quest-ocr.mjs';
import { matchQuestText } from './quest-match.mjs';
import { scanLootText, valuation, normalizeLootText } from './loot-core.mjs';
import { firRequirements, keyRequirements } from './field-kit-core.mjs';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=new Intl.NumberFormat('ko-KR');
const money=v=>typeof v==='number'&&Number.isFinite(v)?fmt.format(v)+' ₽':'가격 없음';
const STORAGE_BASE='tfg-r13-';
const ROUTE_PLAN_PREFIX='tfg-r13-route-plan-';
const DIFF_PREFIX='tfg-r13-quest-diff-';
const OFFLINE_PREFIX='tfg-r13-offline-pack-';
function get(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function normalizeName(text=''){return normalizeLootText(text||'').replace(/\s+/g,' ').trim();}
function pickBestClassification({quests,loot,extracts,coords}){
  const scores={quest:(quests.matches?.length||0)*5+(quests.candidates?.length||0)*2,loot:(loot.found?.length||0)*4+(loot.uncertain?.length||0),extract:(extracts.length||0)*4,location:coords?3:0};
  const best=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0];
  if(!best||best[1]<=0)return 'unknown';
  return best[0];
}
function linesFrom(text=''){return String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,250);}
function routePlanKey(mode){return ROUTE_PLAN_PREFIX+mode;}
function diffKey(mode){return DIFF_PREFIX+mode;}
function offlineKey(mode){return OFFLINE_PREFIX+mode;}
function downloadJson(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);}
function scoreAdvisor(items,neededMap,catalog){
  const index=new Map((catalog?.items||[]).map(i=>[i.id,i]));
  return items.map(row=>{
    const need=neededMap.get(row.id);
    const item=index.get(row.id);
    let decision='sell',reason='현재 확인된 FIR 퀘스트/열쇠 요구와 직접 연결되지 않음';
    if(need?.type==='key'){decision='keep';reason='미완료 퀘스트에 필요한 열쇠';}
    else if(need?.remaining>0){decision='keep';reason=`미완료 FIR 퀘스트에 ${need.remaining}개 더 필요`;}
    else if(need?.locked){decision='keep';reason='사용자가 보관 잠금으로 지정함';}
    else if((item?.flea?.currentPrice||0)>0 && item?.grid?.width && item?.grid?.height){
      const per=(item.flea.currentPrice)/(item.grid.width*item.grid.height);
      if(per>=50000){decision='sell-priority';reason=`칸당 가치가 높음 (${fmt.format(Math.round(per))} ₽/칸)`;}
    }
    return {...row,item,decision,reason};
  });
}
export function initializeR13({getMode=()=> 'regular',getMap=()=> '',getMapName=()=> '',getTasks=()=>[],getCatalog=()=>null,getRoutes=()=>[],getStatus=()=> 'todo',getExits=()=>[],getDataState=()=>({}),notify=()=>{},refreshData=async()=>{},refreshMarket=async()=>{},onApplyQuests=()=>{},onOpenQuest=()=>{},onOpenMarket=()=>{}}={}){
  const dialog=$('r13-dialog'),body=$('r13-content');
  if(!dialog||!body)return {open(){},close(){},render(){}};
  let tab='smart';
  let ocr=createQuestOcr({onProgress:s=>{const el=$('r13-smart-status'); if(el) el.textContent=s?.message||'분석 중'; const el2=$('r13-diff-status'); if(el2&&diffBusy) el2.textContent=s?.message||'분석 중'; const el3=$('r13-advice-status'); if(el3&&adviceBusy) el3.textContent=s?.message||'분석 중';}});
  let smartFile=null,smartText='',smartBusy=false,smartResult=null;
  let diffBase=get(diffKey(getMode()),null),diffBusy=false,diffCurrent=null;
  let adviceFile=null,adviceRows=[],adviceBusy=false,adviceText='';
  let profitQuery='',profitRoute='';
  let importPackResult='';

  function mode(){return getMode();}
  function tasks(){return getTasks()||[];}
  function catalog(){return getCatalog()||{items:[]};}
  function exits(){return getExits()||[];}
  function routePlans(){return get(routePlanKey(mode()),{});}
  function saveRoutePlans(v){save(routePlanKey(mode()),v);}
  function routeById(id){return (getRoutes()||[]).find(r=>r.id===id);}
  function currentNeeded(){
    const fir=firRequirements(tasks(),getStatus);
    const keyReq=keyRequirements(tasks(),getStatus);
    const locked=get(`tfg-r11-fir-${mode()}`,{});
    const needed=new Map();
    for(const row of fir){const have=Math.max(0,Number(locked[row.id]?.have)||0);needed.set(row.id,{type:'fir',required:row.required,have,remaining:Math.max(0,row.required-have),locked:!!locked[row.id]?.locked,name:row.name,tasks:row.tasks});}
    for(const row of keyReq){const prev=needed.get(row.id)||{type:'key',remaining:1,required:1,have:0,locked:false,name:row.name||row.id,tasks:[]};prev.type='key';prev.tasks=[...new Set([...(prev.tasks||[]),...row.tasks.map(t=>t.name)])];needed.set(row.id,prev);}
    return needed;
  }
  function classifyText(text){
    const q=matchQuestText(text,tasks(),{ocrConfidence:95,lineConfidences:[]});
    const l=scanLootText(text,catalog());
    const names=linesFrom(text).map(normalizeName);
    const x=exits().filter(e=>names.some(line=> line && (normalizeName(e.name||'')===line || line.includes(normalizeName(e.name||'')))));
    return {classification:pickBestClassification({quests:q,loot:l,extracts:x,coords:null}),quests:q,loot:l,extracts:x,text};
  }
  async function analyzeSmart(file){
    if(!file)return;smartBusy=true;smartResult=null;render();
    try{
      const rec=await ocr.recognize(file,{language:$('r13-smart-lang')?.value||'eng'});
      smartText=rec.text||'';$('r13-smart-text').value=smartText;
      smartResult=classifyText(smartText);
    }catch(e){notify('통합 분석 실패: '+(e.message||e),true);}finally{smartBusy=false;render();}
  }
  function routePlanRows(){
    const plans=routePlans();
    return (getRoutes()||[]).map(r=>{const entries=plans[r.id]?.items||[];const rows=entries.map(entry=>{
      const item=(catalog().items||[]).find(i=>i.id===entry.id);const qty=Math.max(1,Number(entry.quantity)||1);const flea=item?.flea?.priceStatus==='observed'&&Number(item?.flea?.currentPrice)>0?item.flea.currentPrice:null;const trader=item?.bestTraderSell?.priceRUB??(item?.bestTraderSell?.currency==='RUB'?item.bestTraderSell?.price:null);return {item,qty,flea,trader};
    });
    const fleaTotal=rows.reduce((s,r)=>s+(r.flea||0)*r.qty,0),traderTotal=rows.reduce((s,r)=>s+(r.trader||0)*r.qty,0);
    return {route:r,entryCount:entries.length,fleaTotal,traderTotal,rows};
    }).sort((a,b)=>b.fleaTotal-a.fleaTotal||a.route.name.localeCompare(b.route.name,'ko'));
  }
  function applyQuestMatches(){
    const ids=[...(smartResult?.quests?.matches||[]).map(x=>x.taskId)];
    if(!ids.length)return notify('표시할 퀘스트가 없어요.',true);
    onApplyQuests(ids);
    notify(`퀘스트 ${ids.length}개를 현재 목록/지도에 반영했어.`);
  }
  function renderSmart(){
    const result=smartResult;
    const clsLabel={quest:'퀘스트 화면',loot:'인벤토리/아이템 가치',extract:'탈출구 목록',location:'일반 위치 스크린샷',unknown:'판별 보류'}[result?.classification||'unknown'];
    const lootVal=result?valuation(result.loot.found,catalog()):null;
    body.innerHTML=`<div class="r13-panel"><h3>통합 스크린샷 AI 분석</h3><p class="r13-hint">이미지를 올리면 OCR로 글자를 읽고 <b>퀘스트 / 인벤토리 / 탈출구</b> 후보를 자동 분류합니다. 불확실하면 원문 텍스트를 그대로 보여주며, 최종 확인은 직접 해야 합니다.</p><div class="r13-grid2"><div><label class="loot-drop" for="r13-smart-file"><strong>분석할 스크린샷 선택</strong><span>PNG · JPG · WEBP</span><input id="r13-smart-file" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden></label><label>OCR 언어 <select id="r13-smart-lang"><option value="eng">영어</option><option value="kor+eng">한국어 + 영어</option></select></label><div class="r13-row"><button id="r13-smart-run" class="btn btn-primary" ${smartBusy||!smartFile?'disabled':''}>${smartBusy?'분석 중…':'자동 분석 시작'}</button><button id="r13-smart-apply" class="btn" ${!(result?.quests?.matches?.length)?'disabled':''}>퀘스트 지도에 반영</button><button id="r13-smart-remember" class="btn" ${!(result?.classification==='quest')?'disabled':''}>이 결과를 비교 기준으로 저장</button></div><p id="r13-smart-status" class="r13-hint">${smartBusy?'OCR 실행 중…':smartFile?(result?`자동 분류: ${clsLabel}`:'분석 준비 완료'):'먼저 파일을 선택하세요.'}</p><details><summary>인식한 텍스트 보기/수정</summary><textarea id="r13-smart-text" rows="8" placeholder="OCR 텍스트">${esc(smartText)}</textarea><button id="r13-smart-rematch" class="btn btn-small">이 텍스트로 다시 판별</button></details></div><div><div class="r13-stats"><span>분류 ${esc(clsLabel)}</span><span>퀘스트 일치 ${(result?.quests?.matches?.length||0)}개</span><span>아이템 일치 ${(result?.loot?.found?.length||0)}종</span><span>탈출구 일치 ${(result?.extracts?.length||0)}개</span></div>${!result?'<p class="r13-hint">분석 후 결과가 여기에 나타납니다.</p>':result.classification==='quest'?`<h4>일치한 퀘스트</h4><div class="r13-cards">${result.quests.matches.slice(0,12).map(r=>`<article class="r13-row"><strong>${esc(tasks().find(t=>t.id===r.taskId)?.name||r.taskId)}</strong><small>${esc(r.evidence)}</small></article>`).join('')||'<p>확정 일치 없음</p>'}${result.quests.candidates.slice(0,8).map(r=>`<article class="r13-row"><span>${esc(tasks().find(t=>t.id===r.taskId)?.name||r.taskId)}</span><small>확인 필요 · ${esc(r.evidence)}</small></article>`).join('')}</div>`:result.classification==='loot'?`<h4>가치 분석 요약</h4><p>플리마켓 합계 <b>${money(lootVal?.flea)}</b> · 상인 판매 합계 <b>${money(lootVal?.trader)}</b></p><div class="r13-cards">${(lootVal?.rows||[]).slice(0,12).map(r=>`<article class="r13-row"><span>${esc(r.item?.name||r.id)} × ${r.quantity}</span><small>${money(r.fleaPrice)} / ${money(r.traderPrice)}</small></article>`).join('')||'<p>읽힌 아이템 없음</p>'}</div>`:result.classification==='extract'?`<h4>현재 맵과 일치한 탈출구</h4><div class="r13-cards">${result.extracts.map(x=>`<article class="r13-row"><strong>${esc(x.name)}</strong><small>캡처에 이름 표시 · 실제 이용 가능 여부는 직접 확인</small></article>`).join('')}</div>`:`<p class="r13-hint">자동 분류 확신이 낮아서 텍스트만 보여 줍니다. 직접 확인해 주세요.</p>`}</div></div></div>`;
    $('r13-smart-file').onchange=e=>{smartFile=e.target.files?.[0]||null;render(); if(smartFile) analyzeSmart(smartFile);};
    $('r13-smart-run').onclick=()=>analyzeSmart(smartFile);
    $('r13-smart-rematch').onclick=()=>{smartText=$('r13-smart-text').value;smartResult=classifyText(smartText);render();};
    $('r13-smart-apply').onclick=applyQuestMatches;
    $('r13-smart-remember').onclick=()=>{diffBase={savedAt:new Date().toISOString(),text:smartText,questIds:[...(smartResult?.quests?.matches||[]).map(x=>x.taskId)]};save(diffKey(mode()),diffBase);notify('현재 퀘스트 OCR 결과를 비교 기준으로 저장했어.');render();};
  }
  async function analyzeDiff(file){
    diffBusy=true;render();
    try{const rec=await ocr.recognize(file,{language:$('r13-diff-lang')?.value||'eng'});const text=rec.text||'';const match=matchQuestText(text,tasks(),{ocrConfidence:95,lineConfidences:[]});diffCurrent={savedAt:new Date().toISOString(),text,questIds:[...new Set(match.matches.map(x=>x.taskId))],match};}
    catch(e){notify('비교용 OCR 실패: '+(e.message||e),true);}finally{diffBusy=false;render();}
  }
  function diffSummary(){
    if(!diffBase||!diffCurrent)return null;
    const prev=new Set(diffBase.questIds||[]),curr=new Set(diffCurrent.questIds||[]);
    const added=[...curr].filter(id=>!prev.has(id));
    const removed=[...prev].filter(id=>!curr.has(id));
    const prevLines=new Set(linesFrom(diffBase.text).map(normalizeName)),currLines=new Set(linesFrom(diffCurrent.text).map(normalizeName));
    const newLines=[...currLines].filter(x=>x&&!prevLines.has(x)).slice(0,30);
    const goneLines=[...prevLines].filter(x=>x&&!currLines.has(x)).slice(0,30);
    return {added,removed,newLines,goneLines};
  }
  function renderDiff(){
    const summary=diffSummary();
    body.innerHTML=`<div class="r13-panel"><h3>퀘스트 진행 변화 감지</h3><p class="r13-hint">퀘스트 목록 OCR 결과를 저장해 두고 새 캡처와 비교합니다. <b>가시 화면 기준 변화</b>이므로 실제 서버 진행률을 확정하지는 않습니다.</p><div class="r13-grid2"><div><div class="r13-card"><h4>기준 캡처</h4><p>${diffBase?`저장 시각: ${new Date(diffBase.savedAt).toLocaleString('ko-KR')} · 퀘스트 ${diffBase.questIds?.length||0}개`:'아직 저장된 기준이 없습니다. 통합 분석 탭에서 저장하거나 아래에서 직접 만들 수 있어요.'}</p><label class="loot-drop" for="r13-diff-base-file"><strong>기준 이미지로 저장</strong><span>새 기준 만들기</span><input id="r13-diff-base-file" type="file" accept="image/*" hidden></label></div><div class="r13-card"><h4>비교할 새 캡처</h4><label class="loot-drop" for="r13-diff-file"><strong>새 퀘스트 캡처 선택</strong><span>OCR 후 기준과 비교</span><input id="r13-diff-file" type="file" accept="image/*" hidden></label><label>OCR 언어 <select id="r13-diff-lang"><option value="eng">영어</option><option value="kor+eng">한국어 + 영어</option></select></label><div class="r13-row"><button id="r13-diff-run" class="btn btn-primary" ${diffBusy||!$('r13-diff-file')?.files?.[0]?'disabled':''}>${diffBusy?'비교 중…':'비교 실행'}</button><button id="r13-diff-promote" class="btn" ${!diffCurrent?'disabled':''}>현재 결과를 새 기준으로</button></div><p id="r13-diff-status" class="r13-hint">${diffBusy?'OCR 실행 중…':diffCurrent?`새 캡처 퀘스트 ${diffCurrent.questIds.length}개 인식`:'새 이미지 대기'}</p></div></div><div>${!summary?'<p class="r13-hint">기준과 새 캡처가 모두 있어야 비교합니다.</p>':`<div class="r13-stats"><span>새로 보인 퀘스트 ${summary.added.length}</span><span>사라진 퀘스트 ${summary.removed.length}</span><span>새 텍스트 줄 ${summary.newLines.length}</span><span>사라진 텍스트 줄 ${summary.goneLines.length}</span></div><h4>퀘스트 변화</h4><div class="r13-cards">${summary.added.map(id=>`<article class="r13-row"><strong>추가</strong><span>${esc(tasks().find(t=>t.id===id)?.name||id)}</span></article>`).join('')}${summary.removed.map(id=>`<article class="r13-row"><strong>제거</strong><span>${esc(tasks().find(t=>t.id===id)?.name||id)}</span></article>`).join('')||'<p>퀘스트 목록 변화 없음</p>'}</div><h4>인식 텍스트 변화</h4><div class="r13-grid2"><div><b>새로 읽힌 줄</b><ul>${summary.newLines.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>없음</li>'}</ul></div><div><b>사라진 줄</b><ul>${summary.goneLines.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>없음</li>'}</ul></div></div>`}</div></div></div>`;
    $('r13-diff-base-file').onchange=async e=>{const f=e.target.files?.[0]; if(!f)return; diffBusy=true; render(); try{const rec=await ocr.recognize(f,{language:$('r13-diff-lang')?.value||'eng'}); const text=rec.text||''; const match=matchQuestText(text,tasks(),{ocrConfidence:95,lineConfidences:[]}); diffBase={savedAt:new Date().toISOString(),text,questIds:[...new Set(match.matches.map(x=>x.taskId))]}; save(diffKey(mode()),diffBase); notify('새 기준 캡처를 저장했어.'); } catch(err){ notify('기준 OCR 실패: '+(err.message||err),true);} finally{diffBusy=false; render();}};
    $('r13-diff-file').onchange=()=>render();
    $('r13-diff-run').onclick=()=>analyzeDiff($('r13-diff-file').files?.[0]);
    $('r13-diff-promote').onclick=()=>{if(!diffCurrent)return; diffBase={savedAt:diffCurrent.savedAt,text:diffCurrent.text,questIds:diffCurrent.questIds}; save(diffKey(mode()),diffBase); notify('현재 비교 결과를 새 기준으로 저장했어.'); render();};
  }
  function renderProfit(){
    const plans=routePlans(); const rows=routePlanRows(); const selected=profitRoute||rows[0]?.route.id||''; if(!profitRoute&&selected) profitRoute=selected; const active=rows.find(r=>r.route.id===selected);
    const q=profitQuery.trim().toLocaleLowerCase('ko');
    const options=(catalog().items||[]).filter(i=>q&&[i.name,i.nameEn,i.shortName].some(n=>String(n||'').toLocaleLowerCase('ko').includes(q))).slice(0,40);
    body.innerHTML=`<div class="r13-panel"><h3>파밍 수익 예측</h3><p class="r13-hint">개인 파밍 루트에 <b>예상 획득 아이템</b>을 직접 지정해서 플리/상인 기준 예상 수익을 계산합니다. 드롭 확률과 실제 스폰 여부는 자동 추정하지 않습니다.</p><div class="r13-grid2"><div><div class="r13-card"><label>루트 선택 <select id="r13-profit-route">${rows.map(r=>`<option value="${esc(r.route.id)}" ${r.route.id===selected?'selected':''}>${esc(r.route.name)} (${money(r.fleaTotal)})</option>`).join('')}</select></label><div class="r13-row"><input id="r13-profit-search" placeholder="아이템 검색" value="${esc(profitQuery)}"><select id="r13-profit-item"><option value="">아이템 선택</option>${options.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}${i.nameEn&&i.nameEn!==i.name?' · '+esc(i.nameEn):''}</option>`).join('')}</select><input id="r13-profit-qty" type="number" min="1" max="999" value="1" style="width:90px"><button id="r13-profit-add" class="btn btn-small">추가</button></div><p class="r13-hint">루트별 예상 아이템은 이 PC에만 저장됩니다.</p></div>${!active?'<p>저장된 파밍 루트가 없습니다.</p>':`<div class="r13-card"><h4>${esc(active.route.name)}</h4><div class="r13-stats"><span>플리 예상 ${money(active.fleaTotal)}</span><span>상인 예상 ${money(active.traderTotal)}</span><span>항목 ${active.rows.length}종</span><span>경유지 ${active.route.points.length}곳</span></div><div class="r13-cards">${active.rows.map((r,idx)=>`<article class="r13-row"><span>${esc(r.item?.name||'미등록')} × ${r.qty}</span><small>${money(r.flea)} / ${money(r.trader)}</small><button class="btn btn-small" data-r13-remove-plan="${idx}">삭제</button></article>`).join('')||'<p>아직 예측 항목이 없습니다.</p>'}</div></div>`}</div><div><h4>루트 비교</h4><div class="r13-cards">${rows.map(r=>`<article class="r13-row ${r.route.id===selected?'active':''}"><strong>${esc(r.route.name)}</strong><small>플리 ${money(r.fleaTotal)} · 상인 ${money(r.traderTotal)} · ${r.entryCount}종</small></article>`).join('')||'<p>루트 없음</p>'}</div></div></div></div>`;
    $('r13-profit-route').onchange=e=>{profitRoute=e.target.value; render();};
    $('r13-profit-search').oninput=e=>{profitQuery=e.target.value; render();};
    $('r13-profit-add').onclick=()=>{const rid=$('r13-profit-route').value, itemId=$('r13-profit-item').value, qty=Math.max(1,Number($('r13-profit-qty').value)||1); if(!rid||!itemId)return; const next=routePlans(); const bucket=next[rid]||{items:[]}; const existing=bucket.items.find(x=>x.id===itemId); if(existing) existing.quantity+=qty; else bucket.items.push({id:itemId,quantity:qty}); next[rid]=bucket; saveRoutePlans(next); notify('예상 파밍 아이템을 추가했어.'); render();};
    body.querySelectorAll('[data-r13-remove-plan]').forEach(btn=>btn.onclick=()=>{const rid=$('r13-profit-route').value; const idx=Number(btn.dataset.r13RemovePlan); const next=routePlans(); if(next[rid]?.items){ next[rid].items.splice(idx,1); saveRoutePlans(next); render();}});
  }
  async function analyzeAdvice(file){
    if(!file)return;adviceBusy=true;render();
    try{const rec=await ocr.recognize(file,{language:$('r13-advice-lang')?.value||'eng'}); adviceText=rec.text||''; $('r13-advice-text').value=adviceText; adviceRows=scanLootText(adviceText,catalog()).found; }
    catch(e){notify('보관/판매 분석 실패: '+(e.message||e),true);} finally{adviceBusy=false; render();}
  }
  function renderAdvice(){
    const needed=currentNeeded(); const decisions=scoreAdvisor(adviceRows,needed,catalog());
    body.innerHTML=`<div class="r13-panel"><h3>아이템 보관·판매 자동 추천</h3><p class="r13-hint">스크린샷에서 읽힌 아이템 이름을 기준으로 <b>보관 / 판매 추천</b>을 보여줍니다. 현재 버전은 <b>미완료 FIR 퀘스트와 열쇠 요구, 사용자가 잠근 보관 항목</b>을 우선 반영합니다.</p><div class="r13-grid2"><div><label class="loot-drop" for="r13-advice-file"><strong>인벤토리/가방 사진 선택</strong><span>이름이 읽히는 사진일수록 정확해요.</span><input id="r13-advice-file" type="file" accept="image/*" hidden></label><label>OCR 언어 <select id="r13-advice-lang"><option value="eng">영어</option><option value="kor+eng">한국어 + 영어</option></select></label><div class="r13-row"><button id="r13-advice-run" class="btn btn-primary" ${adviceBusy||!adviceFile?'disabled':''}>${adviceBusy?'분석 중…':'추천 분석 시작'}</button><button id="r13-advice-rematch" class="btn">텍스트로 다시 판정</button></div><p id="r13-advice-status" class="r13-hint">${adviceBusy?'OCR 실행 중…':adviceRows.length?`${adviceRows.length}종 판독`:'파일을 넣으면 보관/판매 추천을 계산합니다.'}</p><details><summary>OCR 텍스트 보기/수정</summary><textarea id="r13-advice-text" rows="7">${esc(adviceText)}</textarea></details></div><div><div class="r13-stats"><span>보관 ${(decisions.filter(x=>x.decision==='keep').length)}</span><span>판매 우선 ${(decisions.filter(x=>x.decision==='sell-priority').length)}</span><span>일반 판매 ${(decisions.filter(x=>x.decision==='sell').length)}</span></div><div class="r13-cards">${decisions.map(r=>`<article class="r13-row"><strong>${esc(r.item?.name||r.id)} × ${r.quantity||1}</strong><small>${r.decision==='keep'?'보관':'판매'} · ${esc(r.reason)}</small></article>`).join('')||'<p>아직 판독된 아이템이 없습니다.</p>'}</div><p class="r13-warning">주의: 아이콘만 보이는 물품은 자동 식별하지 않으며, 은신처 전체 필요 수량까지는 아직 합산하지 않습니다.</p></div></div></div>`;
    $('r13-advice-file').onchange=e=>{adviceFile=e.target.files?.[0]||null; render(); if(adviceFile) analyzeAdvice(adviceFile);};
    $('r13-advice-run').onclick=()=>analyzeAdvice(adviceFile);
    $('r13-advice-rematch').onclick=()=>{adviceText=$('r13-advice-text').value; adviceRows=scanLootText(adviceText,catalog()).found; render();};
  }
  function buildOfflinePack(){
    const data=getDataState()||{}; const pack={product:'tarkov-field-guide',schema:13,createdAt:new Date().toISOString(),mode:mode(),meta:{map:getMap(),mapName:getMapName()},datasets:{tasks:tasks(),items:catalog().items||[],maps:data.maps||[],fetchedAt:data.fetchedAt||null},local:{routes:getRoutes()||[],routePlans:routePlans(),questDiffBase:diffBase,settings:{mode:mode(),map:getMap()}}};
    return pack;
  }
  function renderOffline(){
    const savedPack=get(offlineKey(mode()),null); const live=buildOfflinePack();
    body.innerHTML=`<div class="r13-panel"><h3>오프라인 데이터 팩</h3><p class="r13-hint">현재 로드된 퀘스트·지도·아이템 목록과 개인 파밍 루트/예측 데이터를 묶어 JSON 파일로 저장하거나 다시 불러옵니다. 서비스 워커가 캐시한 UI와 함께 사용하면 네트워크가 불안정할 때도 기본 기능을 유지할 수 있습니다.</p><div class="r13-grid2"><div class="r13-card"><div class="r13-stats"><span>현재 퀘스트 ${(live.datasets.tasks||[]).length}개</span><span>현재 아이템 ${(live.datasets.items||[]).length}개</span><span>현재 맵 ${(live.datasets.maps||[]).length}개</span><span>루트 ${(live.local.routes||[]).length}개</span></div><div class="r13-row"><button id="r13-offline-refresh" class="btn">데이터 새로고침</button><button id="r13-offline-save-local" class="btn">브라우저에 오프라인 팩 저장</button><button id="r13-offline-download" class="btn btn-primary">JSON 다운로드</button></div><p class="r13-hint">저장한 팩은 이 PC에서 수동 복원할 수 있습니다. 시세는 마지막 저장 시점의 스냅샷입니다.</p></div><div class="r13-card"><h4>복원 / 상태</h4><p>${savedPack?`브라우저 저장 팩: ${new Date(savedPack.createdAt).toLocaleString('ko-KR')} · 퀘스트 ${(savedPack.datasets.tasks||[]).length}개`:'브라우저에 저장된 오프라인 팩이 없습니다.'}</p><div class="r13-row"><input id="r13-offline-file" type="file" accept="application/json"><button id="r13-offline-import" class="btn">JSON 불러오기</button><button id="r13-offline-apply" class="btn" ${!savedPack?'disabled':''}>저장 팩 다시 적용</button></div><p class="r13-hint">${esc(importPackResult||'가져온 팩은 localStorage에 저장되고, 이 화면에서 수동으로 적용합니다.')}</p><p class="r13-warning">주의: 현재 버전은 앱 코드 자체(EXE 포함)를 오프라인으로 업데이트하지 않습니다. 데이터 팩은 퀘스트/아이템/루트 스냅샷만 다룹니다.</p></div></div></div>`;
    $('r13-offline-refresh').onclick=async()=>{await Promise.allSettled([refreshData(),refreshMarket()]); notify('공개 데이터 새로고침을 요청했어.'); render();};
    $('r13-offline-save-local').onclick=()=>{const pack=buildOfflinePack(); save(offlineKey(mode()),pack); notify('현재 상태를 브라우저 오프라인 팩으로 저장했어.'); render();};
    $('r13-offline-download').onclick=()=>downloadJson(buildOfflinePack(),`tarkov-field-guide-offline-${mode()}.json`);
    $('r13-offline-import').onclick=async()=>{const file=$('r13-offline-file').files?.[0]; if(!file)return; try{const text=await file.text(); const pack=JSON.parse(text); if(pack?.product!=='tarkov-field-guide' || !pack?.datasets) throw new Error('지원하지 않는 파일 형식'); save(offlineKey(mode()),pack); importPackResult=`가져오기 성공 · 퀘스트 ${(pack.datasets.tasks||[]).length}개 / 아이템 ${(pack.datasets.items||[]).length}개`; notify('오프라인 팩을 브라우저에 저장했어.'); render();}catch(e){importPackResult='가져오기 실패: '+e.message; render();}};
    $('r13-offline-apply').onclick=()=>{const pack=get(offlineKey(mode()),null); if(!pack)return; importPackResult=`저장 팩 확인 완료 · ${new Date(pack.createdAt).toLocaleString('ko-KR')}`; notify('저장된 오프라인 팩을 확인했어. 현재 버전은 브라우저 저장용으로 유지하며, 필요한 경우 JSON으로 내보낼 수 있어.'); render();};
  }
  function render(){ if(!dialog.open)return; document.querySelectorAll('[data-r13-tab]').forEach(btn=>{btn.classList.toggle('active',btn.dataset.r13Tab===tab); btn.setAttribute('aria-selected',String(btn.dataset.r13Tab===tab));}); if(tab==='smart') renderSmart(); else if(tab==='diff') renderDiff(); else if(tab==='profit') renderProfit(); else if(tab==='advice') renderAdvice(); else renderOffline(); }
  function open(t='smart'){tab=t; if(!dialog.open) dialog.showModal(); render();}
  function close(){dialog.close();}
  $('open-r13').onclick=()=>open(); $('r13-close').onclick=close; dialog.addEventListener('click',e=>{if(e.target===dialog) close();}); document.querySelectorAll('[data-r13-tab]').forEach(btn=>btn.onclick=()=>{tab=btn.dataset.r13Tab; render();});
  return {open,close,render};
}