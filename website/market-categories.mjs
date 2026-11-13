// Categories are derived from the actual public item catalog. We do not claim an
// item belongs to a category not present in its provider metadata.
const typeLabels={ammo:'탄약',ammoBox:'탄약 상자',gun:'총기',weapon:'무기',mod:'무기 부품',gear:'장비',armor:'방어구',helmet:'헬멧',headwear:'머리 장비',faceCover:'얼굴 보호구',glasses:'보안경',backpack:'배낭',rig:'전술 조끼',container:'보관함',key:'열쇠·키카드',medical:'의약품',meds:'의약품',food:'식품',drink:'음료',provisions:'식량',barter:'교환 아이템',electronics:'전자 부품',tools:'공구',fuel:'연료',valuable:'귀중품',info:'정보·문서',money:'화폐',map:'지도',special:'특수 장비',grenade:'수류탄',knife:'근접 무기',melee:'근접 무기',magazine:'탄창',sight:'조준경',suppressor:'소음기',scope:'광학 장비',stimulant:'주사제'};
export function getCategoryKeys(item){
  const types=(item?.types||[]).map(x=>String(x).trim()).filter(Boolean);
  const labels=(item?.categoryLabels||[]).map(x=>String(x).trim()).filter(Boolean);
  const main=types[0] || labels[0] || 'uncategorized';
  const sub=labels.find(x=>x!==main)||types.find(x=>x!==main)||null;
  return {main,sub};
}
export function filterByGroups(item,main='all',sub='all'){
  const group=getCategoryKeys(item);return (main==='all'||main===group.main)&&(sub==='all'||sub===group.sub);
}
export function catalogGroups(items){
  const map=new Map();
  for(const item of items){
    const {main,sub}=getCategoryKeys(item);if(!map.has(main))map.set(main,{key:main,name:typeLabels[main]||main,count:0,childrenMap:new Map()});
    const row=map.get(main);row.count++;if(sub){const previous=row.childrenMap.get(sub)||{key:sub,name:typeLabels[sub]||sub,count:0};previous.count++;row.childrenMap.set(sub,previous);}
  }
  return [...map.values()].map(g=>({key:g.key,name:g.name,count:g.count,children:[...g.childrenMap.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ko'))})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ko'));
}