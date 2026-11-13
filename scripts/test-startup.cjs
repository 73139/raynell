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
      normalizedName: `startup-${mode}-quest`, trader: '54cb50c76803fa8b248b4571',
      map: 'fixture-customs', minPlayerLevel: 1,
      objectives: [{id: `fixture-${mode}-objective`, type: 'visit',
        description: objective, maps: ['fixture-customs']}]}]},
    maps: {maps: [{id: 'fixture-customs', name: mapName, normalizedName: 'customs'}]},
    traders: {traders: [{id: '54cb50c76803fa8b248b4571', name: traderName, normalizedName: 'prapor'}]},
    items: {items: [{id: 'fixture-item', name: 'fixture/item', normalizedName: 'startup-item'}]},
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
    assert.equal(document.querySelectorAll('.quest-card').length, 1);
    assert.match(document.getElementById('data-status').textContent, /PvP · 1개/);
    assert.equal(document.querySelector('[data-task]').dataset.task, 'fixture-regular-task');
    console.log(`PASS PvP startup: ${online.moduleCount} modules, translated quest card and data status`);

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
