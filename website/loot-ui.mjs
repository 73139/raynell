import {createQuestOcr} from './quest-ocr.mjs';
import {scanLootText,valuation} from './loot-core.mjs';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(n)+' ₽':'가격 없음';
const num=n=>new Intl.NumberFormat('ko-KR').format(n);
function csvCell(x){return '"'+String(x??'').replace(/"/g,'""')+'"';}
export function initializeLootScan({getCatalog,getMode,onOpenMarket=()=>{}}){
  let file=null,previewUrl='',rawText='',rows=[],uncertain=[],pending=false,busy=false,lastMode=getMode(),autoEnabled=false;
  const ocr=createQuestOcr({onProgress:s=>{$('loot-progress').textContent=s?.message||'사진 분석 중';}});
  const dialog=$('loot-dialog');
  function open(){onOpenMarket();if(!dialog.open)dialog.showModal();update();}
  function close(){if(dialog.open)dialog.close();}
  function update(){
    const catalog=getCatalog();const result=valuation(rows,catalog),max=rows.length;
    $('loot-total-flea').textContent=rub(result.flea)+(result.unpricedFlea?` · ${result.unpricedFlea}종 미포함`:'');
    $('loot-total-trader').textContent=rub(result.trader)+(result.unpricedTrader?` · ${result.unpricedTrader}종 미포함`:'');
    $('loot-total-count').textContent=num(max)+'종 / '+num(rows.reduce((sum,r)=>sum+(+r.quantity||1),0))+'개';
    $('loot-price-time').textContent=catalog?.fetchedAt?`공개 시세 확인: ${new Date(catalog.fetchedAt).toLocaleString('ko-KR')} · 실제 거래가 아님`:'마켓 가격 데이터 대기';
    $('loot-warning').textContent=!catalog?'아이템 시세 데이터를 불러오는 중입니다. 가격이 없는 아이템은 계산하지 않습니다.':pending?'사진의 글자를 읽었지만 시세 연결을 기다리고 있어요.':'참고: 플리마켓 가격은 관측된 최저 등록가입니다. 판매 가능 여부·수수료는 반영하지 않으며 미확인 품목은 합계에서 제외됩니다.';
    if(uncertain.length)$('loot-warning').textContent+=` · 후보가 비슷해서 자동 판별하지 않은 항목 ${uncertain.length}개`;
    $('loot-results').innerHTML=result.rows.length?result.rows.map((r,i)=>{
      const item=r.item,missing=!item;
      return `<tr><td data-label="아이템"><div class="loot-identified">${item?.iconLink?`<img src="${esc(item.iconLink)}" width="34" height="34" loading="lazy" referrerpolicy="no-referrer" alt="">`:''}<div><strong>${esc(item?.name||r.id)}</strong><small>${esc(item?.nameEn||'')} · ${r.confidence===1?'이름 일치':r.manual?'직접 추가':'유사 이름 확인'}</small></div></div></td><td data-label="수량"><input type="number" min="1" max="9999" value="${r.quantity}" data-loot-qty="${i}" aria-label="${esc(item?.name||r.id)} 수량"></td><td data-label="플리 1개">${rub(r.fleaPrice)}</td><td data-label="상인 1개">${rub(r.traderPrice)}${item?.bestTraderSell?.traderName?`<small>${esc(item.bestTraderSell.traderName)}</small>`:''}</td><td data-label="플리 합계" class="loot-line-total">${rub(r.subtotal)}</td><td><button type="button" class="btn btn-small" data-loot-delete="${i}" aria-label="${esc(item?.name||r.id)} 삭제">×</button></td></tr>`;
    }).join(''):'<tr><td colspan="6">아직 인식된 항목이 없어요. 이미지에서 이름이 보이지 않으면 아래의 검색창으로 하나씩 추가할 수 있어요.</td></tr>';
    $('loot-analyze').disabled=busy||!file;
  }
  function add(id,quantity=1,manual=true,confidence=1){const catalog=getCatalog();if(!catalog?.items?.some(i=>i.id===id))return;const existing=rows.find(r=>r.id===id);if(existing)existing.quantity+=quantity;else rows.push({id,quantity,manual,confidence});update();}
  function rematch(){const catalog=getCatalog();rawText=$('loot-ocr-text').value;if(!catalog?.items?.length){pending=true;update();return;}
    pending=false;const scan=scanLootText(rawText,catalog);rows=scan.found.map(x=>({...x,manual:false}));uncertain=scan.uncertain;
    $('loot-progress').textContent=rows.length?`이름으로 ${rows.length}종을 찾았습니다. 사진에 이름이 없는 아이콘은 자동 식별하지 못합니다.`:'인식 가능한 아이템 이름을 찾지 못했어요. 아이콘만 보이는 사진이라면 아래 검색으로 추가해 주세요.';
    update();
  }
  async function analyze(){if(!file||busy)return;busy=true;$('loot-analyze').disabled=true;$('loot-progress').textContent='사진 속 글자 읽는 중';
    try{const recognized=await ocr.recognize(file,{language:$('loot-language').value});rawText=recognized.text||'';$('loot-ocr-text').value=rawText;rematch();}
    catch(e){$('loot-progress').textContent='분석 실패: '+(e.message||e);}
    finally{busy=false;update();}
  }
  function ingest(newFile){if(!dialog.open)open();if(!newFile||!newFile.type.startsWith('image/')){$('loot-progress').textContent='PNG 또는 JPG 사진을 선택해 주세요.';return;}
    file=newFile;rows=[];uncertain=[];rawText='';$('loot-ocr-text').value='';if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);$('loot-preview').src=previewUrl;$('loot-preview').hidden=false;$('loot-progress').textContent=`${newFile.name||'클립보드 이미지'} 선택 완료 · 분석할 수 있어요.`;update();void analyze();}
  $('loot-auto').addEventListener('change',e=>{autoEnabled=e.target.checked;});
  $('open-loot-scan').addEventListener('click',open);$('open-loot-top').addEventListener('click',open);$('loot-close').addEventListener('click',close);
  $('loot-file').addEventListener('change',e=>{ingest(e.target.files[0]);e.target.value='';});
  $('loot-analyze').addEventListener('click',analyze);$('loot-rematch').addEventListener('click',rematch);
  $('loot-drop').addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();});
  $('loot-drop').addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();ingest(e.dataTransfer.files[0]);});
  document.addEventListener('paste',e=>{if(!dialog.open)return;const file=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();ingest(file);}});
  document.addEventListener('change',e=>{if(e.target.dataset.lootQty){const row=rows[Number(e.target.dataset.lootQty)];if(row){row.quantity=Math.max(1,Math.min(9999,Number(e.target.value)||1));update();}}});
  document.addEventListener('click',e=>{const del=e.target.closest('[data-loot-delete]');if(del){rows.splice(Number(del.dataset.lootDelete),1);update();}});
  let candidateTimer;
  $('loot-add-name').addEventListener('input',()=>{clearTimeout(candidateTimer);candidateTimer=setTimeout(()=>{const q=$('loot-add-name').value.trim().toLocaleLowerCase('ko');const opts=(getCatalog()?.items||[]).filter(i=>q&&[i.name,i.nameEn,i.shortName,i.normalizedName].some(n=>String(n||'').toLocaleLowerCase('ko').includes(q))).slice(0,35);$('loot-add-select').innerHTML='<option value="">아이템 선택</option>'+opts.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}${i.nameEn!==i.name?' · '+esc(i.nameEn):''}</option>`).join('');},80);});
  $('loot-add').addEventListener('click',()=>{if($('loot-add-select').value)add($('loot-add-select').value);});
  $('loot-clear').addEventListener('click',()=>{rows=[];uncertain=[];rawText='';$('loot-ocr-text').value='';update();});
  $('loot-csv').addEventListener('click',()=>{const {rows:priced}=valuation(rows,getCatalog());const list=[['아이템','영어명','수량','플리 개당 (₽)','상인 개당 (₽)','플리 소계 (₽)','시세 기록 시간'],...priced.map(r=>[r.item?.name||'',r.item?.nameEn||'',r.quantity,r.fleaPrice??'',r.traderPrice??'',r.subtotal??'',r.item?.flea?.updatedAt||''])];const blob=new Blob(['\ufeff'+list.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='Tarkov_Loot_Valuation.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),2500);});
  document.addEventListener('tfg-market-loaded',e=>{if(e.detail.mode!==lastMode){lastMode=e.detail.mode;rows=[];}if(pending)rematch();else update();});
  update();return {open,ingest,update,get autoEnabled(){return autoEnabled;}};
}