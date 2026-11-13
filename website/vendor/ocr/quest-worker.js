/* Language-only redirect. Screenshot pixels stay inside this same-origin worker. */
'use strict';
const koreanModelURL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@1.0.0/4.0.0_best_int/kor.traineddata.gz';
const localKoreanURL = new URL('./kor.traineddata', self.location.href).href;
const originalFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const requested = typeof input === 'string' ? new URL(input, self.location.href).href : input.url;
  if (requested !== localKoreanURL) return originalFetch(input, init);
  try {
    const cached = await caches.open('tfg-ocr-models-v1').then(cache => cache.match(koreanModelURL));
    if (cached) return cached;
  } catch {}
  const response = await originalFetch(koreanModelURL, {
    method:'GET', credentials:'omit', referrerPolicy:'no-referrer',
    signal:AbortSignal.timeout(35000),
  });
  if (response.ok) {
    try { await caches.open('tfg-ocr-models-v1').then(cache => cache.put(koreanModelURL,response.clone())); } catch {}
  }
  return response;
};
importScripts('./worker.min.js');