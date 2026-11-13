/* r14 presentation-only UI: never triggers a screenshot or sends a key to the game. */
export function initializeR14Shell(){
  const $=id=>document.getElementById(id);
  const menu=$('tactical-tools-menu');
  const chipbar=$('r14-market-chips');
  const category=$('market-category');
  const statusNodes=[['map-title','r14-region'],['floor-status','r14-level'],['location-status','r14-position']];
  const syncStatus=()=>{
    for(const [src,dst] of statusNodes){const from=$(src),to=$(dst);if(from&&to){const value=(from.textContent||'').trim();if(to.textContent!==value)to.textContent=value||'확인 중';}}
  };
  const observers=[];
  for(const [id] of statusNodes){const node=$(id);if(node){const ob=new MutationObserver(syncStatus);ob.observe(node,{childList:true,subtree:true,characterData:true});observers.push(ob);}}
  syncStatus();
  if(menu){
    menu.addEventListener('click',e=>{const button=e.target.closest('button');if(button)menu.open=false;});
    document.addEventListener('pointerdown',e=>{if(menu.open&&!menu.contains(e.target))menu.open=false;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;e.stopPropagation();}});
  }
  const safeCss=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let rendering=false;
  const chips=()=>{
    if(!chipbar||!category||rendering)return;
    rendering=true;
    const options=Array.from(category.options).filter(o=>o.value&&o.value!=='all').slice(0,8);
    const active=category.value||'all';
    chipbar.innerHTML='<span>QUICK FILTER</span><button class="r14-chip'+(active==='all'?' active':'')+'" data-market-chip="all" type="button">전체</button>'+
      options.map(o=>'<button type="button" class="r14-chip'+(active===o.value?' active':'')+'" data-market-chip="'+safeCss(o.value)+'">'+safeCss(o.textContent.replace(/\s*\(\d[\d,]*\)\s*$/,''))+'</button>').join('');
    rendering=false;
  };
  if(category&&chipbar){
    category.addEventListener('change',chips);
    chipbar.addEventListener('click',e=>{
      const b=e.target.closest('[data-market-chip]');if(!b)return;
      const value=b.dataset.marketChip;
      if(value!=='all'&&!Array.from(category.options).some(o=>o.value===value))return;
      category.value=value;
      category.dispatchEvent(new Event('change',{bubbles:true}));
      chips();
    });
    document.addEventListener('tfg-market-loaded',chips);
    const observer=new MutationObserver(chips);observer.observe(category,{childList:true});observers.push(observer);
    chips();
  }
  return {syncStatus,refreshChips:chips,dispose:()=>observers.forEach(o=>o.disconnect())};
}