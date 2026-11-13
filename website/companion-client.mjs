// This module never probes localhost from the hosted Site. The local server
// explicitly injects a bootstrap into the UI it serves from its own origin.
export const MAX_CAPTURE_IMAGE_BYTES = 20 * 1024 * 1024;
const CAPTURE_IMAGE_TYPES = new Set(['image/png','image/jpeg','image/webp','image/bmp']);

export function readCompanionBootstrap(document, location) {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return null;
  const element = document.getElementById('tfg-companion-bootstrap');
  if (!element) return null;
  try {
    const value = JSON.parse(element.textContent);
    if (!/^[a-f0-9]{64}$/.test(value.token) || !/^[a-f0-9]{24}$/.test(value.instanceId)) return null;
    return value;
  } catch { return null; }
}

export function createCompanionClient({ bootstrap, onState, onError, fetchImpl = fetch, intervalMs = 1000 }) {
  let timer = null;
  let stopped = false;
  let polling = false;
  let latestRequest = 0;
  const imageControllers = new Set();
  async function request(route, body, timeoutMs = 6000) {
    const requestId = ++latestRequest;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
        headers: { 'X-TFG-Token': bootstrap.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      const state = await response.json();
      if (!response.ok) throw new Error(state.error || `연결 오류 (${response.status})`);
      if (state.app !== 'tarkov-field-guide-companion' || state.instanceId !== bootstrap.instanceId) throw new Error('자동 추적이 다시 시작됐어요. 이 화면을 새로고침해 주세요.');
      // A delayed old status request must not overwrite a newer control result.
      if (!stopped && requestId === latestRequest) onState(state);
      return state;
    } catch (error) {
      if (requestId !== latestRequest) error.tfgStale = true;
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function refresh() {
    if (stopped || polling) return;
    polling = true;
    try { await request('state'); }
    catch (error) { if (!stopped && !error.tfgStale) onError(error); }
    finally { polling = false; if (!stopped) { clearTimeout(timer); timer = setTimeout(refresh, intervalMs); } }
  }

  /** Read one authenticated, still-current local screenshot. Never posts pixels. */
  async function getCaptureImage(image, {signal,timeoutMs=15000}={}) {
    if (!image || !Number.isSafeInteger(image.generation) || image.generation<1 ||
        !Number.isSafeInteger(image.imageRevision) || image.imageRevision<1 ||
        !Number.isSafeInteger(image.size) || image.size<1 || image.size>MAX_CAPTURE_IMAGE_BYTES ||
        typeof image.fingerprint!=='string' || !image.fingerprint || image.fingerprint.length>500 ||
        !CAPTURE_IMAGE_TYPES.has(image.mimeType)) throw new TypeError('유효한 최신 스크린샷 정보가 필요해요.');
    if (!Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>60000) throw new TypeError('이미지 요청 제한 시간은 60초 이하여야 해요.');
    if (stopped || signal?.aborted) throw new DOMException('이미지 읽기가 취소되었습니다.','AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timeout = setTimeout(abort,timeoutMs);
    imageControllers.add(controller);
    try {
      // Independent of latestRequest: image reads cannot suppress a state poll
      // or publish a stale snapshot over a newer folder/control response.
      const response = await fetchImpl(`/api/capture-image?generation=${image.generation}&revision=${image.imageRevision}`,{
        method:'GET',cache:'no-store',redirect:'error',credentials:'same-origin',
        headers:{'X-TFG-Token':bootstrap.token,'Accept':image.mimeType},signal:controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(()=>({}));
        throw Object.assign(new Error(body.error||`이미지 연결 오류 (${response.status})`),{status:response.status,code:body.code||'IMAGE_REQUEST'});
      }
      const header = name => response.headers.get(name);
      if (header('X-TFG-Instance')!==bootstrap.instanceId ||
          header('X-TFG-Image-Generation')!==String(image.generation) ||
          header('X-TFG-Image-Revision')!==String(image.imageRevision) ||
          header('X-TFG-Image-Fingerprint')!==image.fingerprint) {
        throw Object.assign(new Error('자동 추적 또는 최신 스크린샷이 바뀌었어요. 다시 시도해 주세요.'),{code:'IMAGE_CHANGED',status:409});
      }
      const type = (header('Content-Type')||'').split(';')[0].trim().toLowerCase();
      if (!CAPTURE_IMAGE_TYPES.has(type) || type!==image.mimeType) throw Object.assign(new Error('이미지 응답 형식이 일치하지 않아요.'),{code:'IMAGE_FORMAT',status:415});
      const length = header('Content-Length');
      if (!/^\d+$/.test(length||'') || Number(length)!==image.size || Number(length)>MAX_CAPTURE_IMAGE_BYTES) {
        throw Object.assign(new Error('이미지 크기가 바뀌었거나 제한을 초과했어요.'),{code:'IMAGE_SIZE',status:413});
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('이미지 응답을 읽을 수 없어요.');
      const chunks = [];
      let received = 0;
      try {
        while (true) {
          const {done,value} = await reader.read();
          if (controller.signal.aborted) throw new DOMException('이미지 읽기가 취소되었습니다.','AbortError');
          if (done) break;
          received += value.byteLength;
          if (received>image.size || received>MAX_CAPTURE_IMAGE_BYTES) {
            throw Object.assign(new Error('이미지 응답이 허용한 크기를 초과했어요.'),{code:'IMAGE_SIZE',status:413});
          }
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(()=>{});
        throw error;
      } finally { reader.releaseLock(); }
      if (received!==image.size) throw Object.assign(new Error('이미지 읽기가 끝나기 전에 연결이 끊어졌어요.'),{code:'IMAGE_CHANGED',status:409});
      if (stopped || controller.signal.aborted) throw new DOMException('이미지 읽기가 취소되었습니다.','AbortError');
      return new Blob(chunks,{type});
    } finally {
      controller.abort();
      clearTimeout(timeout);
      signal?.removeEventListener('abort',abort);
      imageControllers.delete(controller);
    }
  }
  return { request, refresh, getCaptureImage, close() {
    stopped = true; clearTimeout(timer);
    for (const controller of imageControllers) controller.abort();
    imageControllers.clear();
  } };
}

// Cursor data stays in this tab. Changing maps requires a new capture, unless
// the user explicitly chooses to reapply the last capture to the selected map.
export function createCaptureCursor() {
  let source = '';
  let lastEvent = 0;
  return {
    next(snapshot, { replay = false } = {}) {
      const key = `${snapshot.instanceId}:${snapshot.generation}`;
      if (key !== source) { source = key; lastEvent = 0; }
      const candidates = [snapshot.latest && { kind: 'capture', ...snapshot.latest }, snapshot.latestRejected && { kind: 'rejected', ...snapshot.latestRejected }]
        .filter(Boolean).sort((a, b) => (a.eventRevision || 0) - (b.eventRevision || 0));
      const event = replay && snapshot.latest ? { kind: 'capture', ...snapshot.latest } : candidates.at(-1);
      if (!event || (!replay && event.eventRevision <= lastEvent)) return null;
      if (event.kind === 'rejected' && snapshot.latest?.eventRevision > lastEvent) event.validBeforeRejection = snapshot.latest;
      lastEvent = Math.max(lastEvent, snapshot.eventRevision || 0, event.eventRevision || 0);
      return event;
    },
    waitForNext(snapshot) {
      if (!snapshot) return;
      const key = `${snapshot.instanceId}:${snapshot.generation}`;
      if (key !== source) lastEvent = 0;
      source = key;
      lastEvent = Math.max(lastEvent, snapshot.eventRevision || 0, snapshot.latest?.eventRevision || 0, snapshot.latestRejected?.eventRevision || 0);
    }
  };
}