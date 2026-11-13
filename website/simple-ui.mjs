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
  const layers=document.createElement('div');
  layers.className='map-quick-layers';layers.id='map-quick-layers';
  layers.innerHTML='<span>위치 표시</span><label><input type="checkbox" data-intel-toggle="boss" checked>보스</label><label><input type="checkbox" data-intel-toggle="cultist" checked>컬티스트</label><label><input type="checkbox" data-intel-toggle="pmc" checked>PMC</label><label><input type="checkbox" data-intel-toggle="scav" checked>Scav</label><label><input type="checkbox" data-intel-toggle="other" checked>기타 스폰</label><label><input id="show-btr-markers" type="checkbox" checked>BTR</label><button type="button" id="open-intel-list" class="btn btn-small">위치 목록</button><button type="button" id="open-cultist-info" class="btn btn-small">컬티스트 시간</button><button type="button" id="open-btr-timetable" class="btn btn-small">BTR 시간표</button><button type="button" id="open-recommended-routes" class="btn btn-small">추천 파밍 루트</button><button type="button" id="open-personal-routes" class="btn btn-small">내 파밍 루트</button>';
  frame.before(layers);
  const drawing=document.createElement('div');drawing.id='personal-route-toolbar';drawing.className='personal-route-toolbar';drawing.hidden=true;drawing.innerHTML='<strong>지도에서 파밍 지점을 눌러 추가하세요</strong><button id="undo-personal-point" type="button" class="btn btn-small">마지막 지점 취소</button><button id="finish-personal-route" type="button" class="btn btn-primary btn-small">입력 끝내기·편집</button>';frame.before(drawing);
  const active=document.createElement('div');active.id='active-route-note';active.className='active-route-note';active.hidden=true;
  active.innerHTML='<span id="active-route-text"></span><button type="button" id="clear-recommended-route" class="btn btn-small">경로 지우기</button>';
  frame.after(active);
  const questTools=document.createElement('div');questTools.className='quest-scope-tools';
  questTools.innerHTML='<label><input id="kappa-only" type="checkbox"><b class="kappa-inline">K</b> 카파만</label><button id="open-kappa-line" class="btn btn-small" type="button">카파 퀘스트 라인</button>';
  document.querySelector('.quest-filters').before(questTools);
  document.body.insertAdjacentHTML('beforeend',`<dialog id="kappa-dialog" class="guide-dialog" aria-labelledby="kappa-title"><header><div><h2 id="kappa-title"><b class="kappa-inline">K</b> 카파 퀘스트 라인</h2><p id="kappa-progress"></p></div><button type="button" id="close-kappa-line" class="btn">닫기</button></header><div class="guide-dialog-body"><p class="guide-note">현재 모드의 공개 카파 필수 목록과 선행 임무입니다. 선행 관계 순서이며 분기별로 병행할 수 있습니다.</p><input id="kappa-search" type="search" placeholder="퀘스트·상인 검색" aria-label="카파 퀘스트 검색"><div id="kappa-flow-list" class="kappa-flow-list"></div></div></dialog><dialog id="routes-dialog" class="guide-dialog" aria-labelledby="routes-title"><header><div><h2 id="routes-title">추천 파밍 루트</h2><p id="routes-map-name"></p></div><button type="button" id="close-recommended-routes" class="btn">닫기</button></header><div class="guide-dialog-body"><p class="guide-note">공개 공략을 종합한 방문 순서입니다. 안내선은 실제 통행로나 안전 경로가 아닙니다. 스폰 방향·층·열쇠·게임 내 탈출 조건에 맞춰 이용하세요.</p><div id="recommended-route-list" class="recommended-route-list"></div></div></dialog>`);
}
