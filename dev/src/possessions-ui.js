// Search is derived from current ownership. Only the query, current page and UI selection are transient.
const POS_PAGE_SIZE = 8;
let posQuery = '', posOffset = 0, posLocated = null, posMessage = '';
let posAliasMessage = null, posComposing = null, posDeferred = false;

function possessionPath(item) {
  if (item.ownerId) return possessionPath({...item,ownerId:null})+' › '+kitName(item.ownerId)+' › 장착 모듈';
  const cell = (row, col) => row + '행 ' + col + '열';
  switch (item.kind) {
    case 'case':
      return '창고 ' + cell(item.caseRow, item.caseCol) + ' › ' + item.caseName + ' › 내부 ' + cell(item.row, item.col);
    case 'manual':return '의무실 › 인계칸 · 입고 보류';
    case 'cash':
      return '지폐 보관칸 ' + cell(item.row,item.col);
    case 'stash':
      return '창고 ' + cell(item.row, item.col);
    case 'overflow':
      return '창고 › 입고 대기 · 미배치';
    case 'bag': {
      const kit = item.scope === 'raid' ? field : equipmentState;
      const bag = kit.worn.back ? '가방' : '주머니';
      return (item.scope === 'raid' ? '작전 중 ' : '출격 준비 ') + bag + ' ' + cell(item.row, item.col);
    }
    case 'module':
      return (item.scope === 'raid' ? '작전 중 착용' : '출격 준비 착용') + ' › ' + kitName(item.host) + ' › 장착 모듈';
    case 'worn':
      return (item.scope === 'raid' ? '작전 중 착용' : '출격 준비 착용') + ' › ' + KIT_SLOTS[item.slot].label;
  }
}

// Physical quantities, stack denominations and the spendable subtotal have different units.
function possessionSummary(rows) {
  if (posMessage) return esc(posMessage);
  if (!rows.length) return '일치하는 소유품이 없습니다.';
  let items=0n,stacks=0,available=0,carried=0;
  for (const row of rows) {
    if (row.id!==CASH_ID) {items+=BigInt(row.quantity);continue;}
    stacks+=row.quantity;
    if (row.kind==='bag') carried+=row.cashAmount;
    else available+=row.cashAmount;
  }
  if (!stacks) return '보유 '+items.toLocaleString('ko-KR')+'개 · 위치 '+rows.length.toLocaleString('ko-KR')+'곳';
  const goods=items?'일반 물품 '+items.toLocaleString('ko-KR')+'개 · ':'';
  const carrying=raid&&!field.result?'현장 휴대액':'출격 준비 휴대액';
  return goods+'지폐 '+stacks.toLocaleString('ko-KR')+'묶음 · 액면 합계 '+money(available+carried)+
    '<span class="pos-cash-breakdown"><span>벙커 결제 가능 '+money(available)+'</span> <span>'+carrying+' '+money(carried)+'</span></span>';
}

function possessionsResults() {
  if (!posQuery.trim()) return '';
  const rows = searchPossessions(posQuery);
  const last = Math.max(0, Math.floor((rows.length - 1) / POS_PAGE_SIZE) * POS_PAGE_SIZE);
  posOffset = Math.min(posOffset, last);
  const buttons = rows.slice(posOffset, posOffset + POS_PAGE_SIZE).map(row => {
    const name = row.alias ? row.alias + ' · ' + row.name : row.name;
    const quantity=row.id===CASH_ID?'1묶음 · '+money(row.cashAmount):'×'+row.quantity.toLocaleString('ko-KR');
    const settled = raid && field.result && (['bag','worn','module'].includes(row.kind));
    const action = settled ? '정산 확인 후 열기' : '위치 보기';
    return '<button type="button" class="pos-result" data-pos="locate" data-key="' + esc(row.key) +
      '" data-kind="' + row.kind + '" data-case-uid="' + esc(row.caseUid || (row.isCase ? row.uid : '') || '') + '"' +
      (settled ? ' disabled' : '') + '><span class="pos-item"><b>' + esc(name) + '</b> <small' + (row.id===CASH_ID?' class="pos-note-value"':'') + '>' +
      quantity + '</small></span><span class="pos-path">' + esc(possessionPath(row)) +
      '</span><span class="pos-open">' + action + ' <span aria-hidden="true">›</span></span></button>';
  }).join('');
  const pages = rows.length > POS_PAGE_SIZE ? '<div class="pos-pages"><button type="button" data-pos="prev"' +
    (posOffset === 0 ? ' disabled' : '') + '>이전</button><span>' + (1 + posOffset / POS_PAGE_SIZE) + ' / ' +
    (1 + last / POS_PAGE_SIZE) + '</span><button type="button" data-pos="next"' + (posOffset === last ? ' disabled' : '') +
    '>다음</button></div>' : '';
  return '<p class="pos-status" role="status" aria-live="polite" tabindex="-1">' + possessionSummary(rows) + '</p>' + buttons + pages;
}

function possessionsPanel() {
  return '<section class="pos-panel" role="search" aria-label="소유품 통합 검색"><label for="pos-query">' +
    ico('search') + '소유품 통합 검색</label><div class="pos-field"><input id="pos-query" type="search" autocomplete="off"' +
    ' placeholder="물품 이름 또는 보관함 별칭" aria-controls="pos-results" value="' + esc(posQuery) +
    '"><button type="button" data-pos="clear"' + (posQuery ? '' : ' disabled') +
    '>검색어 지우기</button></div><div id="pos-results">' + possessionsResults() + '</div></section>';
}

function possessionAliasEditor(unit) {
  if (unit.uid === 'overflow' || raid || !writer) return '';
  const uid = esc(unit.uid);
  const message = posAliasMessage?.uid === unit.uid ? posAliasMessage.text : '';
  return '<div class="pos-alias"><label for="pos-alias-input">보관함 별칭 <small>최대 ' + CASE_ALIAS_MAX +
    '자</small></label><div class="pos-field"><input type="text" autocomplete="off" id="pos-alias-input" data-pos-alias data-box="' +
    uid + '" value="' + esc(unit.alias || '') + '" placeholder="예: 귀환용 식량" aria-describedby="pos-alias-status">' +
    '<button type="button" data-pos="rename" data-box="' + uid + '">저장</button><button type="button" data-pos="clear-alias" data-box="' +
    uid + '"' + (unit.alias ? '' : ' disabled') + '>별칭 지우기</button></div>' +
    '<p class="pos-alias-status" id="pos-alias-status" role="status">' + esc(message) + '</p></div>';
}

function refreshPossessionResults() {
  const results = $('#pos-results');
  if (results) results.innerHTML = possessionsResults();
  const clear = $('[data-pos="clear"]');
  if (clear) clear.disabled = !posQuery;
}

function clearPossessionHighlight() {
  posLocated = null;
  for (const node of document.querySelectorAll('.pos-found')) node.classList.remove('pos-found');
}

function updatePossessionQuery(value) {
  posQuery = value;
  posOffset = 0;
  posMessage = '';
  clearPossessionHighlight();
  refreshPossessionResults();
}

function possessionTarget(row) {
  const find = (selector, test) => Array.from(document.querySelectorAll(selector)).find(node => test(node.dataset));
  if(row.id==='cr_notes'&&row.scope!=='raid')return find('[data-cash="select"]', d=>d.uid===row.uid);
  switch (row.kind) {
    case 'case':
      return find('[data-stash="case-take"]', d => d.box === row.caseUid && d.unit === row.uid);
    case 'overflow':
    case 'stash':
      return find('[data-stash="select"]', d => d.uid === row.uid && d.id === (row.ownerId||row.id));
    case 'bag':
      return row.scope === 'raid'
        ? find('[data-side="bag"][data-pick]', d => d.pick === row.uid)
        : find('[data-gear="select"]', d => d.unit === row.uid);
    case 'module':
    case 'worn':
      return find('[data-loadout="slot"]', d => d.slot === row.slot);
  }
}

function markPossessionTarget(reveal = false) {
  if (!posLocated || (page !== 'stash' && page !== 'inventory')) return;
  const row = resolvePossession(posLocated.key);
  if (!row) { clearPossessionHighlight(); return; }
  const target = possessionTarget(row);
  if (!target) return;
  target.classList.add('pos-found');
  const details = target.closest('details');
  if (details) details.open = true;
  if (!reveal) return target;
  if (row.kind === 'case') {
    const box = Array.from(document.querySelectorAll('[data-stash="select"]')).find(b => b.dataset.uid === row.caseUid);
    // Scroll the warehouse grid independently so returning to it reveals the selected case.
    const grid = box?.closest('[data-scroll-key="warehouse-grid"]');
    if (grid) {
      const bounds = grid.getBoundingClientRect(), tile = box.getBoundingClientRect();
      if (tile.top < bounds.top) grid.scrollTop += tile.top - bounds.top;
      else if (tile.bottom > bounds.bottom) grid.scrollTop += tile.bottom - bounds.bottom;
      if (tile.left < bounds.left) grid.scrollLeft += tile.left - bounds.left;
      else if (tile.right > bounds.right) grid.scrollLeft += tile.right - bounds.right;
    }
  }
  target.scrollIntoView({block:'nearest', inline:'nearest'});
  // The case tile itself withdraws goods when activated. Put keyboard focus on its read-only scroll region.
  let focus = row.kind === 'case' ? target.closest('.sc-scroll') : target;
  if (row.isCase && row.kind === 'stash') {
    const panel = $('.sc-case');
    if (panel) {
      panel.scrollIntoView({block:'nearest', inline:'nearest'});
      focus = panel;
    }
  }
  focus?.focus({preventScroll:true});
}

function locatePossession(key) {
  const row = resolvePossession(key);
  if (!row || (raid && field.result && (['bag','worn','module'].includes(row.kind)))) {
    clearPossessionHighlight();
    posMessage = row ? '귀환 정산을 확인한 뒤 장비를 열 수 있습니다.' : '보관 위치가 바뀌어 검색 결과를 갱신했습니다.';
    refreshPossessionResults();
    $('#pos-results .pos-status')?.focus({preventScroll:true});
    return;
  }
  clearPossessionHighlight();
  posMessage = '';
  posLocated = row;
  posAliasMessage = null;
  gearPick = null; picked = null; stashSelection = null; openedCaseUid = null;
  loAssign = null; loClearBind = false; gearNotice = ''; stashNotice = ''; notice = '';
  if(row.kind==='manual'){
    openBunkerFacility('med');
    const card=Array.from(document.querySelectorAll('[data-manual-copy]')).find(el=>el.dataset.manualCopy===row.uid);
    card?.scrollIntoView({block:'nearest'});card?.focus({preventScroll:true});return;
  }
  if (['bag','worn','module'].includes(row.kind)) {
    page = 'inventory';
    loMobilePanel.gear = row.kind === 'bag' ? 1 : 0;
    loSlot = row.kind === 'bag' ? null : row.slot;
    if (row.kind === 'bag') {
      if (row.scope === 'raid') picked = {uid:row.uid, side:'bag', rot:false};
      else gearPick = {uid:row.uid, rot:false};
    }
  } else {
    if (page !== 'inventory' || raid) page = 'stash';
    loFilter = '전체';
    loMobilePanel.gear = 2;
    const id = row.kind === 'case' ? stashSlots.find(unit => unit.uid === row.caseUid).g : (row.ownerId||row.id);
    stashSelection = {id, uid:row.caseUid || row.uid, rot:false};
    if (row.kind === 'case' || (row.kind === 'stash' && row.isCase)) openedCaseUid = row.caseUid || row.uid;
  }
  if(row.id==='cr_notes'&&row.scope!=='raid'){cashSelected=row.uid;gearPick=null;stashSelection=null;}
  save();
  renderKeep();
  markPossessionTarget(true);
}

function updatePossessionAlias(data) {
  const unit = selectedStashUnit(), input = $('#pos-alias-input');
  if (!unit || unit.uid !== data.box || input?.dataset.box !== data.box) return;
  const draft = input.value;
  const invalid = data.pos === 'rename' && caseAliasValue(draft) === null;
  const result = renameStorageCase(data.box, data.pos === 'clear-alias' ? '' : draft);
  posAliasMessage = {uid:data.box, text:result.message};
  if (result.ok) input.value = selectedStashUnit()?.alias || '';
  renderKeep();
  const next = $('#pos-alias-input');
  if (next?.dataset.box === data.box) {
    if (!result.ok) next.value = draft;
    if (invalid) next.setAttribute('aria-invalid','true');
    next.focus({preventScroll:true});
  }
}

function handlePossessionsUI(data) {
  if(data.pos==='locate'&&!raid&&['map','prep'].includes(page))return locatePossession(data.key);
  if (page !== 'inventory' && page !== 'stash') return;
  switch (data.pos) {
    case 'clear':
      updatePossessionQuery('');
      if ($('#pos-query')) { $('#pos-query').value = ''; $('#pos-query').focus(); }
      break;
    case 'prev':
    case 'next':
      posOffset = Math.max(0, posOffset + (data.pos === 'prev' ? -POS_PAGE_SIZE : POS_PAGE_SIZE));
      refreshPossessionResults();
      $('#pos-results .pos-result')?.focus({preventScroll:true});
      break;
    case 'locate': locatePossession(data.key); break;
    case 'rename':
    case 'clear-alias': updatePossessionAlias(data); break;
  }
}

function possessionEditorType(node) {
  if (node?.id === 'pos-query') return 'query';
  if (node?.dataset && Object.hasOwn(node.dataset,'posAlias')) return 'alias';
  return null;
}

function capturePossessionEditor() {
  const node = document.activeElement, type = possessionEditorType(node);
  if (type) return {type, uid:node.dataset.box, value:node.value, start:node.selectionStart, end:node.selectionEnd,
    direction:node.selectionDirection};
  return posLocated && node?.matches?.('.pos-found') ? {type:'found', key:posLocated.key} : null;
}

function restorePossessionEditor(editor) {
  const found = markPossessionTarget();
  if (!editor) return;
  if (editor.type === 'found') {
    if (editor.key === posLocated?.key) found?.focus({preventScroll:true});
    return;
  }
  const node = editor.type === 'query' ? $('#pos-query') : $('#pos-alias-input');
  if (!node || (editor.type === 'alias' && node.dataset.box !== editor.uid)) return;
  node.value = editor.value;
  node.focus({preventScroll:true});
  if (node.setSelectionRange && editor.start !== null) node.setSelectionRange(editor.start, editor.end, editor.direction || 'none');
}

function deferPossessionRender() {
  if (!posComposing || !posComposing.isConnected || posComposing !== document.activeElement ||
      inside.dataset.page !== page) return false;
  posDeferred = true;
  return true;
}

inside.addEventListener('input', event => {
  if (event.target.id === 'pos-query' && !event.isComposing && event.target !== posComposing) updatePossessionQuery(event.target.value);
  if (possessionEditorType(event.target) === 'alias') {
    posAliasMessage = null;
    event.target.removeAttribute('aria-invalid');
    const status = $('#pos-alias-status');
    if (status) status.textContent = '';
  }
});
inside.addEventListener('compositionstart', event => {
  if (possessionEditorType(event.target)) posComposing = event.target;
});
inside.addEventListener('compositionend', event => {
  if (event.target !== posComposing) return;
  posComposing = null;
  if (event.target.id === 'pos-query') updatePossessionQuery(event.target.value);
  if (posDeferred) { posDeferred = false; renderKeep(); }
});
inside.addEventListener('keydown', event => {
  if (!possessionEditorType(event.target)) return;
  if (event.key === 'Escape') { event.stopPropagation(); return; }
  if (event.key === 'Enter' && !event.isComposing && !posComposing && event.keyCode !== 229 &&
      possessionEditorType(event.target) === 'alias') {
    event.preventDefault();
    updatePossessionAlias({pos:'rename', box:event.target.dataset.box});
  }
});
inside.addEventListener('click', event => {
  const button = event.target.closest?.('button');
  if (button && !button.dataset.pos) {
    if (posLocated) clearPossessionHighlight();
    posAliasMessage = null;
  }
});
