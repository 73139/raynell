// Browser-local OCR. Only engine/language files are fetched; images are never sent.
export const OCR_MAX_BYTES = 20 * 1024 * 1024;
export const KOREAN_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@1.0.0/4.0.0_best_int/kor.traineddata.gz';
const ASSETS = new URL('./vendor/ocr/', import.meta.url);
const MODEL_CACHE = 'tfg-ocr-models-v1';
let scriptPromise;

function abortError() { return new DOMException('분석을 취소했어요.','AbortError'); }
function checkSignal(signal) { if(signal?.aborted) throw abortError(); }
function loadEngine() {
  if(globalThis.Tesseract?.createWorker) return Promise.resolve(globalThis.Tesseract);
  if(scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = new URL('tesseract.min.js',ASSETS).href;
    script.async = true;
    script.onload = () => globalThis.Tesseract?.createWorker ? resolve(globalThis.Tesseract) : reject(new Error('글자 인식 엔진을 시작하지 못했어요.'));
    script.onerror = () => { script.remove(); reject(new Error('글자 인식 파일을 불러오지 못했어요. 페이지를 새로고침해 주세요.')); };
    document.head.append(script);
  }).catch(error => {scriptPromise=null;throw error;});
  return scriptPromise;
}

async function ensureKorean(signal,onProgress) {
  checkSignal(signal);
  let cache;
  try { cache=await caches.open(MODEL_CACHE);if(await cache.match(KOREAN_MODEL_URL))return; } catch {}
  onProgress({progress:0.03,message:'한글 인식 파일을 받는 중 · 첫 사용 시 인터넷이 필요해요'});
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,35000);
  try {
    const response=await fetch(KOREAN_MODEL_URL,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    // Complete the download before worker initialization so it can be cancelled.
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength<10000||bytes.byteLength>20*1024*1024)throw new Error('Invalid language data');
    const header=new Uint8Array(bytes,0,2);
    if(header[0]!==0x1f||header[1]!==0x8b)throw new Error('Invalid compressed language data');
    if(cache)try{await cache.put(KOREAN_MODEL_URL,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));}catch{}
    checkSignal(signal);
  } catch(error) {
    checkSignal(signal);
    throw new Error('한글 인식 파일을 받지 못했어요. 인터넷 연결을 확인하고 다시 분석하거나, 영어 화면이라면 인식 언어를 ‘영어’로 바꿔 주세요.');
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}

export function ocrCanvasSize(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('이미지 크기를 읽지 못했어요.');
  if(width*height>42000000)throw new Error('이미지가 너무 커요. 퀘스트 목록 부분만 잘라서 다시 넣어 주세요.');
  const scale=Math.min(width<2000?1.75:1,3840/width,3840/height,Math.sqrt(6000000/(width*height)));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

async function prepareImage(file,signal) {
  if(!(file instanceof Blob)||!file.size)throw new Error('이미지 파일을 선택해 주세요.');
  if(file.size>OCR_MAX_BYTES)throw new Error('20MB 이하 이미지를 선택해 주세요. 퀘스트 목록 부분만 잘라도 좋아요.');
  if(file.type&&!/^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/i.test(file.type))throw new Error('PNG·JPG·WEBP·BMP 이미지로 다시 넣어 주세요.');
  checkSignal(signal);
  let bitmap;
  try {bitmap=await createImageBitmap(file);}catch {throw new Error('이미지를 열지 못했어요. 저장이 끝난 PNG·JPG 파일로 다시 시도해 주세요.');}
  try {
    checkSignal(signal);
    const size=ocrCanvasSize(bitmap.width,bitmap.height);
    const canvas=document.createElement('canvas');Object.assign(canvas,size);
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('이 브라우저에서 이미지 처리를 시작하지 못했어요.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height);
    // Invert dark game menus into dark text on a light background; retain gray
    // edges, rather than thresholding away the small strokes in Korean letters.
    let luminance=0,count=0;
    for(let i=0;i<pixels.data.length;i+=128){luminance+=pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114;count++;}
    const invert=luminance/Math.max(count,1)<127;
    for(let i=0;i<pixels.data.length;i+=4){let v=Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114);if(invert)v=255-v;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;pixels.data[i+3]=255;}
    context.putImageData(pixels,0,0);
    return canvas;
  } finally {bitmap.close();}
}

function collectLines(data) {
  const lines=[];
  for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
    if(line.text?.trim())lines.push({text:line.text.trim(),confidence:Number.isFinite(line.confidence)?line.confidence:0});
  }
  return lines;
}

export function createQuestOcr({onProgress=()=>{}}={}) {
  let worker=null,workerLanguage='',active=null;
  const terminations=new WeakMap();
  function terminate(previous) {
    if(!previous)return Promise.resolve();
    if(!terminations.has(previous))terminations.set(previous,Promise.resolve().then(()=>previous.terminate()).catch(()=>{}));
    return terminations.get(previous);
  }
  function releaseWorker(previous) {
    if(worker===previous){worker=null;workerLanguage='';}
    return terminate(previous);
  }
  function releaseCanvas(run) {
    if(run.canvas){run.canvas.width=1;run.canvas.height=1;run.canvas=null;}
  }
  function current(run) {return active===run&&!run.controller.signal.aborted;}
  function checkRun(run) {if(!current(run))throw abortError();}
  function report(run,message) {if(current(run))onProgress(message);}
  function cancelRun(run) {
    if(run.controller.signal.aborted)return;
    run.controller.abort();
    if(active===run)active=null;
    run.rejectAbort(abortError());
    void releaseWorker(run.worker);
    releaseCanvas(run);
  }
  async function dispose() {
    const previous=worker;
    if(active)cancelRun(active);
    await releaseWorker(previous);
  }
  async function recognize(file,{language='kor+eng',signal}={}) {
    if(active)throw new Error('앞선 캡처를 분석하고 있어요. 잠시 기다려 주세요.');
    if(location.protocol==='file:')throw new Error('퀘스트 자동 인식은 웹 버전이나 Start_Auto_Tracker.cmd로 연 로컬 지도에서 사용해 주세요.');
    const selected=language==='eng'?'eng':'kor+eng';
    const run={controller:new AbortController(),worker:null,canvas:null,rejectAbort:null};
    const stopped=new Promise((_,reject)=>{run.rejectAbort=reject;});
    active=run;
    const cancelled=()=>cancelRun(run);
    signal?.addEventListener('abort',cancelled,{once:true});
    if(signal?.aborted)cancelled();
    const operation=(async()=>{
      try {
        checkRun(run);report(run,{progress:0.01,message:'캡처 이미지를 준비하고 있어요'});
        run.canvas=await prepareImage(file,run.controller.signal);
        checkRun(run);
        if(worker&&workerLanguage!==selected){await releaseWorker(worker);checkRun(run);}
        if(!worker){
          if(selected!=='eng')await ensureKorean(run.controller.signal,message=>report(run,message));
          checkRun(run);
          const Tesseract=await loadEngine();
          checkRun(run);
          report(run,{progress:0.08,message:'글자 인식 엔진을 준비하고 있어요 · 첫 실행은 조금 걸려요'});
          let initialized;
          initialized=await Tesseract.createWorker(selected,1,{
            workerPath:new URL('quest-worker.js',ASSETS).href,
            corePath:ASSETS.href,langPath:ASSETS.href.replace(/\/$/,''),
            workerBlobURL:false,gzip:false,cachePath:'tfg-ocr-v7',
            logger:message=>{
              // A cached worker reports to its current run. A late, cancelled
              // initialization must never report progress for its replacement.
              const target=initialized?(active?.worker===initialized?active:null):(active===run?run:null);
              if(!target)return;
              const recognizing=message.status==='recognizing text';
              report(target,{progress:recognizing ? 0.2+0.75*(message.progress||0) : 0.1,message:recognizing?'사진 속 퀘스트 이름을 읽고 있어요':'글자 인식 엔진을 준비하고 있어요'});
            },
            errorHandler:()=>{},
          });
          if(!current(run)){void terminate(initialized);throw abortError();}
          worker=initialized;workerLanguage=selected;run.worker=initialized;
          await initialized.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'144'});
          checkRun(run);
        }else run.worker=worker;
        checkRun(run);
        const result=await run.worker.recognize(run.canvas,{}, {text:true,blocks:true});
        checkRun(run);
        report(run,{progress:1,message:'글자를 읽었어요. 퀘스트 목록과 비교하고 있어요'});
        return {text:result.data.text||'',confidence:result.data.confidence||0,lineConfidences:collectLines(result.data),language:selected};
      } catch(error) {
        if(run.worker)void releaseWorker(run.worker);
        throw error;
      } finally {releaseCanvas(run);}
    })();
    try {
      // Race the complete lifecycle, including bitmap/script/model/worker
      // startup. These APIs may not settle when their underlying work stops.
      return await Promise.race([operation,stopped]);
    } finally {
      signal?.removeEventListener('abort',cancelled);
      if(active===run)active=null;
      releaseCanvas(run);
    }
  }
  return {recognize,dispose};
}