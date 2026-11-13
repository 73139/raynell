/* Presentation for the map, quests and user-selected bag photos. */
export function initializeSimpleUI(){
  const frame=document.querySelector('.map-frame');
  if(!frame||document.getElementById('map-options'))return;
  const options=document.createElement('details');
  options.id='map-options';
  options.className='simple-map-options';
  const summary=document.createElement('summary');
  summary.textContent='지도 표시 설정 · 마커와 탈출구';
  options.append(summary);
  for(const id of ['intel-layer-toolbar','exit-layer-toolbar']){
    const toolbar=document.getElementById(id);
    if(toolbar)options.append(toolbar);
  }
  frame.after(options);
}
