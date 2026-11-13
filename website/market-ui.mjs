import { fetchMarketCatalog } from './market-core.mjs';
import { catalogGroups, filterByGroups } from './market-categories.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=(value='')=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:'';}catch{return '';}};
const money=(value,currency='RUB')=>typeof value==='number'&&Number.isFinite(value)?`${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(value)} ${currency==='RUB'?'₽':currency==='USD'?'$':currency==='EUR'?'€':currency}`:'시세 없음';
const formatTime=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Seoul'})+' KST':'가격 시각 미등록';};
const modeNames={regular:'PvP',pve:'PvE','pvp-season':'시즌'};

/** Visible-view polling of public snapshots. No trading or account connection. */
export function initializeMarket({getMode=()=> 'regular',readCache=async()=>null,writeCache=async()=>{}}={}){
  const ui={active:false,mode:getMode(),catalog:null,query:'',sort:'name',group:'all',subgroup:'all',limit:70,busy:false,sequence:0,controller:null,error:'',fromCache:false};
  function filtered(){
    const needle=ui.query.trim().toLocaleLowerCase('ko');
    const rows=(ui.catalog?.items||[]).filter(item=>filterByGroups(item,ui.group,ui.subgroup)).filter(item=>!needle||`${item.name} ${item.nameEn} ${item.shortName||''} ${item.normalizedName||''}`.toLocaleLowerCase('ko').includes(needle));
    rows.sort((a,b)=>{
      const av=a.flea?.currentPrice,bv=b.flea?.currentPrice;
      if(ui.sort!=='name'){
        const aValid=typeof av==='number'&&Number.isFinite(av),bValid=typeof bv==='number'&&Number.isFinite(bv);
        if(aValid!==bValid)return aValid?-1:1;
        if(aValid&&av!==bv)return ui.sort==='price-desc'?bv-av:av-bv;
      }
      return String(a.name||a.nameEn||'').localeCompare(String(b.name||b.nameEn||''),'ko');
    });return rows;
  }
  function updateCategories(){
    const groupSelect=$('market-category'),sub=$('market-subcategory');if(!groupSelect||!sub)return;
    const groups=catalogGroups(ui.catalog?.items||[]);
    groupSelect.innerHTML='<option value="all">전체 아이템 ('+ (ui.catalog?.items?.length||0)+')</option>'+groups.map(g=>`<option value="${escapeHTML(g.key)}">${escapeHTML(g.name)} (${g.count})</option>`).join('');
    if(!groups.some(g=>g.key===ui.group))ui.group='all';groupSelect.value=ui.group;
    const chosen=groups.find(g=>g.key===ui.group),subs=chosen?.children||[];
    sub.innerHTML='<option value="all">전체 세부 종류</option>'+subs.map(g=>`<option value="${escapeHTML(g.key)}">${escapeHTML(g.name)} (${g.count})</option>`).join('');
    if(!subs.some(g=>g.key===ui.subgroup))ui.subgroup='all';sub.value=ui.subgroup;sub.disabled=ui.group==='all'||!subs.length;
  }
  function render(){
    if(!$('market-results'))return;
    updateCategories();
    const rows=filtered(),total=ui.catalog?.items?.length||0;
    $('market-result-count').textContent=total?`${new Intl.NumberFormat('ko-KR').format(rows.length)} / ${new Intl.NumberFormat('ko-KR').format(total)}개`:'—';
    $('refresh-market').disabled=ui.busy;
    $('market-status').textContent=ui.busy?`${modeNames[ui.mode]||ui.mode} 시세를 불러오는 중`:ui.error?(total?'연결 실패 · 저장된 시세 표시':'시세 연결 실패'):`${modeNames[ui.mode]||ui.mode} · ${ui.fromCache?'저장된 시세':$('auto-market')?.checked?'60초 자동 갱신':'수동 갱신'}`;
    $('market-status').classList.toggle('is-error',!!ui.error);
    $('market-status').title=ui.error||(ui.catalog?.partialWarnings||[]).join('\n');
    if(!ui.busy&&!ui.error&&ui.catalog?.priceCoverage?.observed===0)$('market-status').textContent+=' · 관측 가격 없음';
    const cadence=ui.catalog?.refreshInfo?.providerCadenceText;
    $('market-updated').textContent=ui.catalog?`데이터 확인: ${formatTime(ui.catalog.fetchedAt)}${cadence?' · '+cadence:''}`:'마켓을 열면 공개 시세를 불러옵니다.';
    if(rows.length){
      $('market-results').innerHTML=rows.slice(0,ui.limit).map(item=>{
        const icon=safeLink(item.iconLink),wiki=safeLink(item.wikiLink),flea=item.flea||{},trader=item.bestTraderSell;
        const name=escapeHTML(item.name||item.nameEn||'이름 미등록');
        const priceLabel=flea.priceStatus==='restricted'?'플리 거래 제한':money(flea.currentPrice,flea.currency||'RUB');
        const updated=typeof flea.updatedAt==='string'||typeof flea.updatedAt==='number'?formatTime(flea.updatedAt):'가격 시각 미등록';
        return `<tr><td data-label="아이템"><div class="market-item">${icon?`<img src="${escapeHTML(icon)}" alt="" loading="lazy" width="44" height="44" referrerpolicy="no-referrer">`:'<span class="market-item-placeholder" aria-hidden="true">◇</span>'}<span>${wiki?`<a href="${escapeHTML(wiki)}" target="_blank" rel="noopener noreferrer">${name} ↗</a>`:`<strong>${name}</strong>`}${item.nameEn&&item.nameEn!==item.name?`<small>${escapeHTML(item.nameEn)}</small>`:''}</span></div></td><td data-label="최저 등록가" class="market-current">${escapeHTML(priceLabel)}${flea.priceStatus==='restricted'?'<small>거래 가능한 등록가로 해석하지 마세요.</small>':flea.currentPrice===0?'<small>0값 제공 · 가격 확인 필요</small>':flea.currentPrice===null||flea.currentPrice===undefined?'<small>거래 제한·등록 없음·자료 누락 가능</small>':''}</td><td data-label="24시간 평균">${escapeHTML(money(flea.average24h,flea.currency||'RUB'))}</td><td data-label="상인 판매가">${trader?escapeHTML(money(trader.price,trader.currency||'RUB')):'정보 없음'}${trader?.traderName?`<small>${escapeHTML(trader.traderName)}</small>`:''}</td><td data-label="가격 시각" class="market-price-time">${escapeHTML(updated)}</td></tr>`;
      }).join('');
    }else{
      const message=ui.busy?'공개 아이템 시세를 불러오고 있어요.':ui.error?'시세를 불러오지 못했어요. 새로고침으로 다시 시도해 주세요.':total?'검색어와 일치하는 아이템이 없어요.':'가격 데이터가 아직 없어요.';
      $('market-results').innerHTML=`<tr><td colspan="5" class="market-empty">${escapeHTML(message)}${ui.error?`<small>${escapeHTML(ui.error)}</small>`:''}</td></tr>`;
    }
    if($('market-load-more')){$('market-load-more').hidden=rows.length<=ui.limit;$('market-load-more').textContent=`더 보기 (${Math.min(ui.limit,rows.length)} / ${rows.length})`;}
  }
  async function refresh({cached=false}={}){
    if(ui.busy)return;
    const mode=getMode();if(mode!==ui.mode)resetMode(mode);
    const sequence=++ui.sequence;ui.busy=true;ui.error='';ui.controller=new AbortController();render();
    if(cached&&!ui.catalog){
      const prior=await readCache('market:'+mode);
      if(sequence!==ui.sequence)return;
      if(prior?.mode===mode&&prior.items?.length){ui.catalog=prior;ui.fromCache=true;render();}
    }
    try{
      const catalog=await fetchMarketCatalog(mode,{signal:ui.controller.signal});
      if(sequence!==ui.sequence)return;
      if(!catalog?.items?.length)throw new Error('공개 시세에 등록된 아이템을 찾지 못했어요.');
      ui.catalog=catalog;ui.fromCache=false;ui.error='';
      await writeCache('market:'+mode,catalog);
    }catch(error){if(sequence!==ui.sequence||error.name==='AbortError')return;ui.error=error.message||'공개 가격 서버에 연결하지 못했어요.';if(ui.catalog)ui.fromCache=true;}
    finally{if(sequence===ui.sequence){ui.busy=false;render();document.dispatchEvent(new CustomEvent('tfg-market-loaded',{detail:{mode:ui.mode,items:ui.catalog?.items||[],fetchedAt:ui.catalog?.fetchedAt}}));}}
  }
  function resetMode(mode){ui.controller?.abort();ui.sequence++;ui.mode=mode;ui.catalog=null;ui.busy=false;ui.fromCache=false;ui.error='';ui.limit=70;render();}
  $('market-category')?.addEventListener('change',event=>{ui.group=event.target.value;ui.subgroup='all';ui.limit=70;render();});
  $('market-subcategory')?.addEventListener('change',event=>{ui.subgroup=event.target.value;ui.limit=70;render();});
  $('market-reset-categories')?.addEventListener('click',()=>{ui.group='all';ui.subgroup='all';ui.limit=70;render();});
  $('market-search')?.addEventListener('input',event=>{ui.query=event.target.value;ui.limit=70;render();});
  $('market-sort')?.addEventListener('change',event=>{ui.sort=event.target.value;ui.limit=70;render();});
  $('refresh-market')?.addEventListener('click',()=>refresh());
  $('auto-market')?.addEventListener('change',()=>{render();if(ui.active&&$('auto-market').checked)refresh();});
  $('market-load-more')?.addEventListener('click',()=>{ui.limit+=70;render();});
  setInterval(()=>{if(ui.active&&!document.hidden&&$('auto-market')?.checked)refresh();},60000);
  document.addEventListener('visibilitychange',()=>{if(ui.active&&!document.hidden&&$('auto-market')?.checked&&(!ui.catalog||Date.now()-Date.parse(ui.catalog.fetchedAt)>60000))refresh();});
  render();
  return {
    setActive(active){ui.active=active;if(active){if(getMode()!==ui.mode)resetMode(getMode());if(!ui.catalog||Date.now()-Date.parse(ui.catalog.fetchedAt)>60000)refresh({cached:true});}},
    setMode(){if(getMode()===ui.mode)return;resetMode(getMode());if(ui.active)refresh({cached:true});},
    refresh,
    getCatalog:()=>ui.catalog,
  };
}