# Local OCR assets

The browser processes screenshot pixels locally. No image or recognized text is
sent to an external OCR service. Quest data is loaded separately from tarkov.dev.

- `tesseract.min.js`, `worker.min.js`: Tesseract.js **7.0.0**, copied unchanged
  from the installed package. Source: https://github.com/naptha/tesseract.js
- Three `tesseract-core-*-lstm.wasm.js` builds: Tesseract.js-core **7.0.0**.
  These upstream browser builds embed WebAssembly. The engine picks scalar,
  SIMD or relaxed SIMD at runtime. Source: https://github.com/naptha/tesseract.js-core
- `eng.traineddata`: installed Tesseract English LSTM language data, copied from
  `/usr/share/tesseract-ocr/5/tessdata/eng.traineddata`. Distribution copyright
  metadata is preserved in `LICENSE-eng.txt`.
- `quest-worker.js`: application wrapper. It redirects **only** the exact local
  Korean model path to the versioned public model URL below, and uses a local
  browser cache when available. Every other fetch uses the unchanged upstream
  worker behavior with application-selected local engine/language paths.

The Korean model is deliberately not represented as bundled. It is downloaded
on the user's first Korean recognition and may be cached by that browser:

https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@1.0.0/4.0.0_best_int/kor.traineddata.gz

Model project: https://github.com/naptha/tessdata

The model request is a credential-free GET with no screenshot payload. Download
failure produces a visible Korean error. English-only recognition is an explicit
user choice and never silently substitutes for Korean recognition.

Licenses for the bundled libraries and language data are retained alongside the
assets. Keep the license files when sharing the downloadable application.