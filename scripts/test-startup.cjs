/* Browserless regression of the shipped app module graph against the real HTML.
 * Run: node --experimental-vm-modules scripts/test-startup.cjs
 * All files and public-data fixtures are read locally. Network access is never used.
 * jsdom does not draw the SVG/image, execute OCR WebAssembly, enforce CSP or run a
 * service worker. Native HTTP/MIME/security and actual image/OCR behavior require
 * separate tests; this test checks startup, DOM state and the data/mode lifecycle.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL, fileURLToPath} = require('node:url');
const {JSDOM, VirtualConsole} = require('jsdom');

const site = path.resolve(__dirname, '../website');
const origin = 'http://127.0.0.1:43873';
const bootstrap = {token: 'a'.repeat(64), instanceId: 'b'.repeat(24)};
const scenarios = new Map();
let activeScenario;

function publicFixture(url) {
  if (url.pathname === '/endpoints') return {gameModes: ['regular', 'pve', 'pvp-season']};
  const [, mode, endpoint] = url.pathname.split('/');
  assert.ok(['regular', 'pve', 'pvp-season'].includes(mode), `Unexpected fixture mode: ${mode}`);
  const koreanName = `회귀 검증 임무 ${mode === 'pve' ? 'PvE' : 'PvP'}`;
  const taskName = `fixture/${mode}/task`;
  const mapName = 'fixture/customs';
  const traderName = 'fixture/prapor';
  const objective = `fixture/${mode}/objective`;
  const fixture = {
    tasks: {tasks: [{id: `fixture-${mode}-task`, name: taskName,
      kappaRequired:true, normalizedName: `startup-${mode}-quest`, trader: '54cb50c76803fa8b248b4571',
      map: 'fixture-customs', minPlayerLevel: 1,
      objectives: [{id: `fixture-${mode}-objective`, type: 'visit',
        description: objective, maps: ['fixture-customs']}]}]},
    maps: {maps: [{id: 'fixture-customs', name: mapName, normalizedName: 'customs'},{id:'fixture-tutorial',name:'Tutorial',normalizedName:'ground-zero-tutorial'}]},
    traders: {traders: [{id: '54cb50c76803fa8b248b4571', name: traderName, normalizedName: 'prapor'}]},
    items: {items: [{id: 'fixture-item', name: 'fixture/item', normalizedName: 'startup-item', lastLowPrice: 10000, updated: '2026-11-13T09:00:00Z', sellFor: [{vendor:{name:'Prapor',normalizedName:'prapor'},price:4000,priceRUB:4000,currency:'RUB'}]}]},
    tasks_ko: {[taskName]: koreanName, [objective]: '세관을 확인하세요'},
    tasks_en: {[taskName]: `Startup regression ${mode}`, [objective]: 'Visit Customs'},
    maps_ko: {[mapName]: '세관'}, maps_en: {[mapName]: 'Customs'},
    traders_ko: {[traderName]: '프라퍼'}, traders_en: {[traderName]: 'Prapor'},
    items_ko: {'fixture/item': '검증용 물품'}, items_en: {'fixture/item': 'Fixture item'},
  };
  assert.ok(Object.hasOwn(fixture, endpoint), `Unexpected fixture endpoint: ${url.pathname}`);
  return fixture[endpoint];
}

async function waitFor(check, message) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
}

async function boot(label, offline) {
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8').replace('</head>',
    `<script type="application/json" id="tfg-companion-bootstrap">${JSON.stringify(bootstrap)}</script></head>`);
  const errors = [], requests = [];
  const result = {label, errors, requests};
  scenarios.set(label, result);
  activeScenario = result;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {errors.push(error); process.exitCode = 1;});
  const dom = new JSDOM(html, {url: origin + '/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole});
  const window = dom.window;
  result.window = window;
  // Only browser layout APIs missing from jsdom are shimmed. No image load or
  // canvas success event is fabricated, and indexedDB remains unavailable so the
  // app's own cache-failure handling is exercised on every clean startup.
  window.HTMLDialogElement.prototype.showModal = function(){this.open=true;};
  window.HTMLDialogElement.prototype.close = function(){this.open=false;};
  window.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}});
  window.URL.createObjectURL = () => 'blob:' + origin + '/fixture';
  window.URL.revokeObjectURL = () => {};
  window.AbortController = AbortController;
  window.AbortSignal = AbortSignal;
  window.Response = Response;
  window.Request = Request;
  window.Headers = Headers;
  window.fetch = async (input, options = {}) => {
    const url = new URL(String(input), origin);
    const call = {url: url.href, status: null};
    requests.push(call);
    if (url.origin === origin) {
      if (url.pathname === '/api/state') {
        const token = new Headers(options.headers).get('X-TFG-Token');
        call.status = token === bootstrap.token ? 200 : 403;
        return json(call.status === 200 ? {app: 'tarkov-field-guide-companion',
          version: 'test-fixture', instanceId: bootstrap.instanceId, folder: null,
          generation: 0, revision: 0, diagnosticRevision: 0, eventRevision: 0, imageRevision: 0,
          running: false, status: 'not-configured', latest: null, latestImage: null,
          latestRejected: null, imagePending: false, error: null, totalFiles: 0, imageFiles: 0,
          logs: {running: false, revision: 0, latest: null, folder: null},
          capabilities: {folderPicker: true, captureImage: true, maxCaptureImageBytes: 20 << 20},
        } : {error: 'Token missing'}, call.status);
      }
      assert.ok(!url.pathname.startsWith('/api/'), `Unexpected native mutation: ${url.pathname}`);
      const file = path.resolve(site, '.' + url.pathname);
      assert.ok(file.startsWith(site + path.sep), 'Static path must stay in website');
      call.status = 200;
      return new Response(fs.readFileSync(file));
    }
    if (offline) throw new TypeError('Offline fixture: public data unavailable');
    if (url.hostname === 'json.tarkov.dev') {
      call.status = 200;
      return json(publicFixture(url));
    }
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/maps.json')) {
      call.status = 200;
      return new Response(fs.readFileSync(path.join(site, 'maps-source.json')));
    }
    if (url.pathname.endsWith('.svg')) {
      call.status = 200;
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700"><g id="Ground"/></svg>',
        {headers: {'Content-Type': 'image/svg+xml'}});
    }
    assert.fail(`No external resource fixture: ${url.href}`);
  };
  const context = dom.getInternalVMContext();
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = new vm.SourceTextModule(fs.readFileSync(fileURLToPath(file), 'utf8'), {
      context, identifier: file, initializeImportMeta(meta) {meta.url = file;},
    });
    modules.set(file, module);
    return module;
  }
  const app = load(pathToFileURL(path.join(site, 'app.mjs')).href);
  await app.link((specifier, referrer) => load(new URL(specifier, referrer.identifier).href));
  await app.evaluate();
  result.moduleCount = modules.size;
  return result;
}

function assertNativeAndMap(result) {
  const document = result.window.document;
  assert.equal(document.getElementById('map-title').textContent.trim(), '세관', 'Map initialization must advance');
  assert.ok(document.querySelectorAll('#map-switcher option').length > 1, 'Map choices must populate');
  assert.equal(document.querySelectorAll('.quest-skeleton').length, 0, 'Quest skeletons must be replaced');
  assert.ok(result.requests.some(r => r.url.endsWith('/api/state') && r.status === 200),
    'Companion bootstrap must start an authenticated state request');
  assert.equal(document.getElementById('companion-controls').hidden, false, 'Native controls must be active');
  assert.equal(result.errors.length, 0, result.errors.map(e => e.stack || e.message).join('\n'));
}

process.on('unhandledRejection', error => {
  activeScenario?.errors.push(error);
  console.error('Unhandled startup error:', error.stack || error);
  process.exitCode = 1;
});
(async () => {
  try {
    const offline = await boot('offline', true);
    await waitFor(() => offline.window.document.getElementById('data-status').textContent === '데이터 연결 실패',
      'Offline startup must settle to a visible failure instead of remaining in the skeleton');
    assertNativeAndMap(offline);
    assert.match(offline.window.document.getElementById('quest-list').textContent, /퀘스트를 불러오지 못했어요/);
    assert.ok(offline.window.document.querySelector('[data-action="retry-data"]'), 'Offline failure must offer retry');
    console.log(`PASS offline startup: ${offline.moduleCount} modules, explicit retry, no skeletons, native connected`);
    offline.window.close();

    const online = await boot('fixtures', false);
    const document = online.window.document;
    const questName = () => document.querySelector('.quest-card .quest-title')?.textContent;
    await waitFor(() => questName() === '회귀 검증 임무 PvP', 'PvP fixture must render a real quest card');
    assertNativeAndMap(online);
    assert.equal(document.querySelectorAll('#map-switcher option').length,13,'Tutorial must share the calibrated Ground Zero map');
    assert.equal(document.querySelector('#map-switcher option[value="ground-zero-tutorial"]'),null);
    assert.equal(document.querySelectorAll('.quest-card').length, 1);
    assert.match(document.getElementById('data-status').textContent, /PvP · 1개/);
    assert.equal(document.querySelector('[data-task]').dataset.task, 'fixture-regular-task');
    console.log(`PASS PvP startup: ${online.moduleCount} modules, translated quest card and data status`);
    assert.deepEqual([...document.querySelectorAll('.top-nav button')].map(b=>b.textContent.trim()), ['지도','퀘스트','경매장','가방 가격']);
    assert.equal(document.getElementById('map-options').open, false);
    assert.equal(document.getElementById('map-options').previousElementSibling.id, 'active-route-note');
    assert.equal(document.querySelector('[data-intel-toggle="container"]').checked, false);
    const wheel=new online.window.WheelEvent('wheel',{deltaY:500,cancelable:true,bubbles:true});
    document.getElementById('map-viewport').dispatchEvent(wheel);
    assert.equal(wheel.defaultPrevented,false,'Ordinary wheel must scroll the document');
    const zoomWheel=new online.window.WheelEvent('wheel',{deltaY:-100,ctrlKey:true,cancelable:true,bubbles:true});
    document.getElementById('map-viewport').dispatchEvent(zoomWheel);
    assert.equal(zoomWheel.defaultPrevented,true,'Ctrl+wheel is reserved for map zoom');
    document.querySelector('.quest-open').click();
    assert.equal(document.getElementById('quest-detail').hidden,false);
    assert.equal(document.getElementById('quest-detail').closest('#quest-panel').id,'quest-panel');
    assert.equal(document.getElementById('quest-browser').hidden,true);
    document.getElementById('close-detail').click();
    assert.equal(document.getElementById('quest-browser').hidden,false);
    console.log('PASS simple navigation, scroll wheel, optional markers and in-panel quest details');
    assert.equal(document.querySelector('.kappa-card-mark').textContent,'K');
    assert.equal(document.querySelector('#map-quick-layers [data-intel-toggle="boss"]').checked,true);
    document.getElementById('open-kappa-line').click();
    assert.equal(document.getElementById('kappa-dialog').open,true);
    assert.ok(document.getElementById('kappa-progress').textContent.includes('필수 0 / 1'));
    document.querySelector('[data-kappa-complete]').click();
    assert.ok(document.getElementById('kappa-progress').textContent.includes('필수 1 / 1'));
    document.querySelector('[data-kappa-complete]').click();
    document.getElementById('close-kappa-line').click();
    document.getElementById('open-recommended-routes').click();
    await waitFor(()=>document.querySelectorAll('[data-apply-route]').length===4,'Customs recommended routes must load');
    document.querySelector('[data-apply-route]').click();
    assert.equal(document.getElementById('routes-dialog').open,false);
    assert.equal(document.getElementById('active-route-note').hidden,false);
    assert.match(document.getElementById('active-route-text').textContent,/Crackhouse/);
    document.getElementById('clear-recommended-route').click();
    assert.equal(document.getElementById('active-route-note').hidden,true);
    document.getElementById('open-market-top').click();
    assert.equal(document.body.dataset.view,'market');
    assert.equal(document.getElementById('market-view').hidden,false);
    document.querySelector('.top-nav [data-view="map"]').click();
    console.log('PASS red K badges, Kappa progress editing, sourced route selection and market navigation');
    document.getElementById('open-loot-top').click();
    assert.equal(document.body.dataset.view,'map','Bag prices must preserve the current map');
    assert.equal(document.getElementById('loot-dialog').open,true);
    await waitFor(()=>document.getElementById('loot-price-time').textContent.includes('시세 조회'),'Bag view must load the item price catalog');
    const search=document.getElementById('loot-add-name');
    search.value='검증용 물품';search.dispatchEvent(new online.window.Event('input'));
    await waitFor(()=>document.getElementById('loot-add-select').options.length>1,'Optional manual price lookup');
    document.getElementById('loot-add-select').value='fixture-item';document.getElementById('loot-add').click();
    const qty=document.querySelector('[data-loot-qty]');qty.value=2;qty.dispatchEvent(new online.window.Event('change',{bubbles:true}));
    assert.match(document.getElementById('loot-total-flea').textContent,/20,000/);
    assert.match(document.getElementById('loot-total-trader').textContent,/8,000/);
    assert.match(document.getElementById('loot-total-best').textContent,/20,000/);
    assert.equal(document.querySelectorAll('[data-loot-edit]').length,1);
    assert.equal(document.querySelectorAll('[data-loot-delete]').length,1);
    assert.match(document.getElementById('loot-total-confidence').textContent,/직접 1/);
    document.getElementById('loot-close').click();
    assert.equal(document.getElementById('loot-dialog').open,false);
    console.log('PASS optional manual bag price lookup and editable quantity, flea 20,000 and trader 8,000');


    document.getElementById('game-mode').value = 'pve';
    document.getElementById('game-mode').dispatchEvent(new online.window.Event('change', {bubbles: true}));
    await waitFor(() => questName() === '회귀 검증 임무 PvE', 'Changing to PvE must render that mode’s quest');
    assertNativeAndMap(online);
    assert.equal(document.querySelectorAll('.quest-card').length, 1);
    assert.equal(document.querySelector('[data-task]').dataset.task, 'fixture-pve-task');
    assert.match(document.getElementById('data-status').textContent, /PvE · 1개/);
    assert.ok(!document.getElementById('quest-list').textContent.includes('회귀 검증 임무 PvP'),
      'Mode switch must not preserve the previous mode’s quest');
    assert.ok(online.requests.some(r => r.url === 'https://json.tarkov.dev/pve/tasks'));
    console.log('PASS mode switch: PvE request and translated card replace the PvP result');
  } finally {
    for (const result of scenarios.values()) result.window?.close();
  }
})().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
