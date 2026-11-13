import {valuation} from './loot-core.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
const rub = n => Number.isFinite(n) ? number.format(n)+' ₽' : '가격 없음';
const csvCell = value => '"'+String(value??'').replaceAll('"','""')+'"';
const sameIcon = (a,b) => {
  const intersection = Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  return intersection/(a.w*a.h+b.w*b.h-intersection)>.48;
};

export function initializeLootScan({getCatalog,onOpenMarket=()=>{}}) {
  const dialog=$('loot-dialog'), preview=$('loot-preview'), surface=$('loot-photo'), progress=$('loot-progress');
  let rows=[], hits=[], file=null, photoURL='', bitmap=null, worker=null, ticket=0, busy=false;
  let selectedArea=null, pickMode='', drag=null, autoEnabled=false;
  const names=new Map();
  function open(){onOpenMarket(); if(!dialog.open) dialog.showModal(); update();}
  function add(id,quantity,source) {
    const row=rows.find(r=>r.id===id);
    if(row) row.quantity=Math.min(9999,row.quantity+quantity);
    else rows.push({id,quantity,source});
  }
  function subtract(id) {
    const row=rows.find(r=>r.id===id);
    if(row && --row.quantity<=0) rows=rows.filter(r=>r!==row);
  }
  function resetAnalysis() {
    ticket++;
    if(busy && worker){worker.terminate();worker=null;}
    busy=false;
    return ticket;
  }
  function label(id,catalog) {return catalog?.items.find(i=>i.id===id)?.name||names.get(id)||id;}
  function renderMarks() {
    const layer=$('loot-marks');
    layer.replaceChildren();
    if(!bitmap)return;
    const mark=(box,css,text)=>{
      const el=document.createElement('span');
      el.className=css;
      el.style.left=100*box.x/bitmap.width+'%';el.style.top=100*box.y/bitmap.height+'%';
      el.style.width=100*box.w/bitmap.width+'%';el.style.height=100*box.h/bitmap.height+'%';
      if(text){const badge=document.createElement('b');badge.textContent=text;el.append(badge);}
      layer.append(el);
    };
    hits.forEach((hit,i)=>mark(hit.box,'loot-mark '+(hit.id?'priced':'review'),String(i+1)));
    if(drag?.box||selectedArea)mark(drag?.box||selectedArea,'loot-selection','');
  }
  function cropPreview(box) {
    const canvas=document.createElement('canvas');
    canvas.width=80;canvas.height=80;
    const scale=Math.min(80/box.w,80/box.h),w=box.w*scale,h=box.h*scale;
    canvas.getContext('2d').drawImage(bitmap,box.x,box.y,box.w,box.h,(80-w)/2,(80-h)/2,w,h);
    return canvas.toDataURL();
  }
  function candidatePreview(rgb) {
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
    const context=canvas.getContext('2d'),image=context.createImageData(16,16);
    for(let i=0;i<256;i++){image.data.set(rgb.subarray(i*3,i*3+3),i*4);image.data[i*4+3]=255;}
    context.putImageData(image,0,0);return canvas.toDataURL();
  }
  function update() {
    const catalog=getCatalog(), result=valuation(rows,catalog);
    $('loot-total-flea').textContent=rub(result.flea)+(result.unpricedFlea?' · '+result.unpricedFlea+'종 미포함':'');
    $('loot-total-trader').textContent=rub(result.trader)+(result.unpricedTrader?' · '+result.unpricedTrader+'종 미포함':'');
    $('loot-total-count').textContent=number.format(rows.length)+'종 / '+number.format(rows.reduce((n,r)=>n+r.quantity,0))+'개';
    $('loot-price-time').textContent=catalog?.fetchedAt?'공개 시세 확인 '+new Date(catalog.fetchedAt).toLocaleString('ko-KR'):'시세 데이터 대기';
    $('loot-warning').textContent=catalog?'그림 한 개를 수량 1로 셉니다. 탄약·현금 등 겹친 물품은 수량을 수정하세요. 플리 합계는 관측된 등록가 기준이며 수수료를 포함하지 않습니다.':'아이콘 인식 후 시세가 연결되면 가격이 표시됩니다.';
    $('loot-results').innerHTML=result.rows.length?result.rows.map((r,i)=>{
      const name=r.item?.name||names.get(r.id)||r.id;
      const image=r.item?.iconLink?'<img src="'+esc(r.item.iconLink)+'" width="34" height="34" loading="lazy" alt="">':'';
      return '<tr><td data-label="아이템"><div class="loot-identified">'+image+'<div><strong>'+esc(name)+'</strong><small>'+esc(r.source)+'</small></div></div></td>'+
        '<td data-label="수량"><input type="number" min="1" max="9999" value="'+r.quantity+'" data-loot-qty="'+i+'" aria-label="'+esc(name)+' 수량"></td>'+
        '<td data-label="플리 1개">'+rub(r.fleaPrice)+'</td><td data-label="상인 1개">'+rub(r.traderPrice)+'</td><td data-label="플리 합계">'+rub(r.subtotal)+'</td>'+
        '<td><button type="button" class="btn btn-small" data-loot-delete="'+i+'" aria-label="'+esc(name)+' 삭제">×</button></td></tr>';
    }).join(''):'<tr><td colspan="6">확인된 아이템이 여기에 표시됩니다.</td></tr>';
    const pending=hits.map((hit,i)=>({hit,i})).filter(({hit})=>!hit.id);
    $('loot-review').hidden=!pending.length;
    $('loot-review-count').textContent='그림 후보 확인 · '+pending.length+'칸';
    $('loot-review-list').innerHTML=pending.map(({hit,i})=>{
      const buttons=hit.candidates.map(c=>'<button type="button" class="loot-choice" data-hit="'+i+'" data-id="'+esc(c.id)+'"><img loading="lazy" alt="" referrerpolicy="no-referrer" style="background-image:url('+c.swatch+')" src="https://assets.tarkov.dev/'+encodeURIComponent(c.id)+'-icon.webp"><span>'+esc(label(c.id,catalog))+'</span></button>').join('');
      return '<div class="loot-review-item"><div class="loot-sample">'+(hit.thumb?'<img src="'+hit.thumb+'" alt="사진에서 잘라낸 아이콘">':'')+'<b>'+(i+1)+'번</b></div><div class="loot-choices">'+buttons+'<button type="button" class="btn btn-small" data-dismiss="'+i+'">제외</button></div></div>';
    }).join('');
    $('loot-analyze').disabled=busy||!bitmap;
    $('loot-tools').hidden=!bitmap;
    $('loot-full').disabled=!selectedArea;
    for(const button of surface.parentElement.querySelectorAll('[data-loot-pick]'))button.setAttribute('aria-pressed',String(button.dataset.lootPick===pickMode));
    surface.classList.toggle('selecting',!!pickMode);
    renderMarks();
  }
  function acceptHits(found,region,single) {
    const converted=found.map(hit=>{
      const box={...hit.box,x:hit.box.x+region.x,y:hit.box.y+region.y};
      for(const c of hit.candidates){
        names.set(c.id,c.name);
        if(c.picture){c.swatch=candidatePreview(c.picture);delete c.picture;}
      }
      const id=hit.confirmed?hit.candidates[0].id:null;
      return {...hit,box,id,thumb:id?'':cropPreview(box)};
    });
    if(!single){hits=[];rows=[];}
    else if(converted.length){
      hits=hits.filter(hit=>{
        if(!sameIcon(hit.box,converted[0].box))return true;
        if(hit.id)subtract(hit.id);
        return false;
      });
    }
    for(const hit of converted){hits.push(hit);if(hit.id)add(hit.id,1,'그림 일치');}
    if(!converted.length)progress.textContent=single?'이 영역에서 일치하는 그림을 찾지 못했어요. 아이템 한 칸의 테두리에 맞춰 다시 선택해 주세요.':'아이콘을 찾지 못했어요. ‘가방 영역 지정’으로 가방만 선택하거나 ‘아이템 한 개 지정’으로 그림을 가까이 지정해 주세요.';
    else {
      const priced=converted.filter(hit=>hit.id).length;
      progress.textContent=(single?'선택한 아이템':'사진 분석 완료')+' · 그림 일치 '+priced+'칸 · 후보 확인 '+(converted.length-priced)+'칸';
    }
    update();
  }
  function analyze(region=null,single=false) {
    if(!bitmap)return;
    const task=resetAnalysis();
    busy=true;pickMode='';
    const area=region||selectedArea||{x:0,y:0,w:bitmap.width,h:bitmap.height};
    progress.textContent='아이콘 도감을 준비하고 있어요.';
    update();
    try {
      const canvas=document.createElement('canvas');
      canvas.width=area.w;canvas.height=area.h;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(bitmap,area.x,area.y,area.w,area.h,0,0,area.w,area.h);
      const image=context.getImageData(0,0,area.w,area.h);
      if(!worker)worker=new Worker('./loot-worker.mjs',{type:'module'});
      worker.onmessage=({data})=>{
        if(data.ticket!==ticket)return;
        if(data.progress){progress.textContent=data.progress;return;}
        busy=false;
        if(data.error){progress.textContent=data.error;update();return;}
        acceptHits(data.hits,area,single);
      };
      worker.onerror=()=>{if(task===ticket){worker?.terminate();worker=null;busy=false;progress.textContent='아이콘 분석을 시작할 수 없어요. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.';update();}};
      worker.postMessage({ticket:task,image,single},[image.data.buffer]);
    } catch(error){busy=false;progress.textContent='그림 분석 실패 · '+String(error.message||error);update();}
  }
  async function ingest(newFile) {
    if(!dialog.open)open();
    if(!newFile?.type?.startsWith('image/')){progress.textContent='사진 파일을 선택해 주세요.';return;}
    const task=resetAnalysis();
    bitmap?.close();bitmap=null;file=newFile;rows=[];hits=[];selectedArea=null;pickMode='';drag=null;
    if(photoURL)URL.revokeObjectURL(photoURL);
    photoURL=URL.createObjectURL(file);preview.src=photoURL;surface.hidden=true;
    progress.textContent='사진을 여는 중입니다.';update();
    try {
      let decoded=await createImageBitmap(file);
      if(task!==ticket){decoded.close();return;}
      const scale=Math.min(1,2560/Math.max(decoded.width,decoded.height));
      if(scale<1){
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(decoded.width*scale));canvas.height=Math.max(1,Math.round(decoded.height*scale));
        canvas.getContext('2d').drawImage(decoded,0,0,canvas.width,canvas.height);decoded.close();
        decoded=await createImageBitmap(canvas);
      }
      if(task!==ticket){decoded.close();return;}
      bitmap=decoded;surface.hidden=false;analyze();
    } catch(error){if(task===ticket){progress.textContent='사진을 열 수 없어요. PNG, JPG, WEBP 또는 BMP 파일을 선택해 주세요.';update();}}
  }
  function point(event){
    const r=surface.getBoundingClientRect();
    return {x:Math.round(Math.max(0,Math.min(1,(event.clientX-r.left)/r.width))*bitmap.width),y:Math.round(Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))*bitmap.height)};
  }
  surface.addEventListener('pointerdown',event=>{
    if(!pickMode||!bitmap||event.button!==0)return;
    event.preventDefault();surface.setPointerCapture(event.pointerId);drag={start:point(event),pointer:event.pointerId,box:null};
  });
  surface.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    const end=point(event),start=drag.start;
    drag.box={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};
    renderMarks();
  });
  surface.addEventListener('pointerup',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    const start=drag.start,end=point(event);
    const area={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};
    drag=null;
    if(area.w<12||area.h<12){progress.textContent='그림의 양쪽 모서리를 잇도록 드래그해 주세요.';renderMarks();return;}
    const single=pickMode==='single';
    if(!single)selectedArea=area;
    analyze(area,single);
  });
  surface.addEventListener('pointercancel',()=>{drag=null;renderMarks();});
  $('loot-tools').addEventListener('click',event=>{
    const button=event.target.closest('[data-loot-pick]');
    if(!button)return;
    pickMode=pickMode===button.dataset.lootPick?'':button.dataset.lootPick;
    if(pickMode)progress.textContent=pickMode==='single'?'사진에서 한 아이템의 네모난 칸 전체를 드래그해 주세요.':'사진에서 가격을 볼 가방의 칸 전체를 드래그해 주세요.';
    update();
  });
  $('loot-full').onclick=()=>{selectedArea=null;analyze();};
  $('loot-analyze').onclick=()=>analyze();
  $('loot-auto').onchange=event=>{autoEnabled=event.target.checked;};
  $('open-loot-scan').onclick=open;$('open-loot-top').onclick=open;$('loot-close').onclick=()=>dialog.close();
  $('loot-file').onchange=event=>{void ingest(event.target.files[0]);event.target.value='';};
  $('loot-drop').ondragover=event=>{event.preventDefault();event.stopPropagation();};
  $('loot-drop').ondrop=event=>{event.preventDefault();event.stopPropagation();void ingest(event.dataTransfer.files[0]);};
  document.addEventListener('paste',event=>{
    if(!dialog.open)return;
    const photo=[...(event.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));
    if(photo){event.preventDefault();void ingest(photo);}
  });
  dialog.addEventListener('change',event=>{
    const i=event.target.dataset.lootQty;
    if(i===undefined||!rows[i])return;
    rows[i].quantity=Math.max(1,Math.min(9999,Math.round(Number(event.target.value)||1)));update();
  });
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    const {hit,id,dismiss,lootDelete}=button.dataset;
    if(hit!==undefined&&hits[hit]&&!hits[hit].id&&hits[hit].candidates.some(c=>c.id===id)){
      hits[hit].id=id;add(id,1,'그림 후보 선택');update();
    } else if(dismiss!==undefined){hits.splice(Number(dismiss),1);update();}
    else if(lootDelete!==undefined){const [row]=rows.splice(Number(lootDelete),1);if(row)hits=hits.filter(h=>h.id!==row.id);update();}
  });
  let searchTimer;
  $('loot-add-name').oninput=()=>{
    clearTimeout(searchTimer);searchTimer=setTimeout(()=>{
      const query=$('loot-add-name').value.trim().toLocaleLowerCase('ko');
      const matches=(getCatalog()?.items||[]).filter(i=>query&&[i.name,i.nameEn,i.shortName,i.normalizedName].some(n=>String(n||'').toLocaleLowerCase('ko').includes(query))).slice(0,35);
      $('loot-add-select').innerHTML='<option value="">아이템 선택</option>'+matches.map(i=>'<option value="'+esc(i.id)+'">'+esc(i.name)+'</option>').join('');
    },80);
  };
  $('loot-add').onclick=()=>{const id=$('loot-add-select').value;if(id){add(id,1,'직접 추가');update();}};
  $('loot-clear').onclick=()=>{
    resetAnalysis();rows=[];hits=[];selectedArea=null;pickMode='';drag=null;
    progress.textContent=bitmap?'가격표를 비웠습니다. 사진을 다시 분석할 수 있어요.':'사진을 선택하세요.';update();
  };
  $('loot-csv').onclick=()=>{
    const priced=valuation(rows,getCatalog()).rows;
    const table=[['아이템','영어명','수량','플리 개당 (₽)','상인 개당 (₽)','플리 소계 (₽)','시세 기록 시간'],...priced.map(r=>[r.item?.name||names.get(r.id)||r.id,r.item?.nameEn||'',r.quantity,r.fleaPrice??'',r.traderPrice??'',r.subtotal??'',r.item?.flea?.updatedAt||''])];
    const link=document.createElement('a');
    link.href=URL.createObjectURL(new Blob(['\ufeff'+table.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    link.download='Tarkov_Loot_Valuation.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),2500);
  };
  document.addEventListener('tfg-market-loaded',update);
  update();return {open,ingest,update,get autoEnabled(){return autoEnabled;}};
}
