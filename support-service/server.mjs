/** Tarkov Field Guide community support API — optional self-hosted service.
 * Node.js 20+, no dependencies. Configure HTTPS reverse proxy and allowlisted Origins for public use.
 * Anonymous posts are public: do not submit passwords, logs with private paths or personal info.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {prepareOCR} from '../scripts/build-ocr.mjs';
import {restoreBuiltMaps} from '../scripts/restore-built-maps.mjs';

const PORT = Number(process.env.TFG_SUPPORT_PORT || process.env.PORT || 43910);
const HOST = process.env.TFG_SUPPORT_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const STORE = path.resolve(process.env.TFG_SUPPORT_DB || './support-service-data/threads.json');
const SITE_DIR = path.resolve(new URL('../website/', import.meta.url).pathname);
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8'};
const ADMIN_TOKEN = process.env.TFG_SUPPORT_ADMIN_TOKEN || '';
const allowed = new Set((process.env.TFG_SUPPORT_ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean));
const clients = new Set();
const hits = new Map();
const categories = new Set(['bug','question','suggestion']);
const statuses = new Set(['open','working','solved']);
let db = {version:1,seq:0,threads:[]};
let writer = Promise.resolve();

function fail(res,code,message){json(res,code,{error:message});}
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function inRange(text,max,min=1){return typeof text==='string' && [...text.trim()].length>=min && [...text.trim()].length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);}
function ipOf(req){return req.socket.remoteAddress||'unknown';}
function rateOk(req,mutating){const ip=ipOf(req),now=Date.now(),windowMs=60000,max=mutating?8:100;const key=ip+':'+(mutating?'write':'read');const v=hits.get(key)||[];const next=v.filter(t=>now-t<windowMs);if(next.length>=max)return false;next.push(now);hits.set(key,next);return true;}
function cors(req,res){const origin=req.headers.origin;
  let sameOrigin=false;
  try{sameOrigin=!!origin && new URL(origin).host.toLowerCase()===(req.headers.host||'').toLowerCase();}catch{}
  if(origin && !sameOrigin && !allowed.has(origin) && !['http://127.0.0.1:43910','http://localhost:43910'].includes(origin))return false;
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  return true;
}
async function readBody(req){const blocks=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>12_000)throw new Error('본문 최대 12KB');blocks.push(part);}try{return JSON.parse(Buffer.concat(blocks).toString('utf8')||'{}');}catch{throw new Error('잘못된 JSON');}}
async function persist(){const serialized=JSON.stringify(db,null,2);const tmp=STORE+'.tmp';writer=writer.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(STORE),{recursive:true,mode:0o700});await fs.writeFile(tmp,serialized,{mode:0o600});await fs.rename(tmp,STORE);});await writer;}
function broadcast(){const data='event: updated\ndata: '+JSON.stringify({seq:db.seq})+'\n\n';for(const client of clients){try{client.write(data);}catch{clients.delete(client);}}}
function list(){return db.threads.map(t=>({...t,replyCount:t.replies.length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,500);}
function safeAdmin(req){if(!ADMIN_TOKEN)return false;const supplied=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const a=Buffer.from(supplied),b=Buffer.from(ADMIN_TOKEN);return a.length===b.length&&timingSafeEqual(a,b);}
function finish(res,error){if(error)fail(res,400,error.message||String(error));}
function publicSummary(){return {mode:'shared',online:true,seq:db.seq,updatedAt:new Date().toISOString(),total:db.threads.length};}
function headersForSSE(res){res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});}

await prepareOCR({installDependencies:true});
// OCR preparation installs the pinned production packages on this existing
// service (its build command is node --version). Load image tooling afterwards.
const {prepareMaps}=await import('../scripts/build-maps.mjs');
await restoreBuiltMaps();
await prepareMaps();
try{const raw=JSON.parse(await fs.readFile(STORE,'utf8'));if(raw.version===1 && Array.isArray(raw.threads)){db=raw;}}catch{}
const srv=http.createServer(async(req,res)=>{
  if(!cors(req,res)){fail(res,403,'허용되지 않은 웹사이트 Origin');return;}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(!rateOk(req,req.method!=='GET')){res.setHeader('Retry-After','60');fail(res,429,'요청이 너무 많습니다. 잠시 후 다시 시도하세요.');return;}
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  try{
    // Free Render trial: public frontend and support API share the same HTTPS origin.
    // Only static website files are served; no server code, logs, data or dotfiles.
    if((req.method==='GET'||req.method==='HEAD') && !u.pathname.startsWith('/api/')){
      const rawName=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));
      const segments=rawName.split('/');
      if(!segments.length || segments.some(segment=>segment==='.'||segment==='..'||segment.startsWith('.')||!segment)){
        fail(res,404,'찾을 수 없는 파일');return;
      }
      const target=path.resolve(SITE_DIR,...segments);
      if(!target.startsWith(SITE_DIR+path.sep)){
        fail(res,404,'찾을 수 없는 파일');return;
      }
      try{
        const real=await fs.realpath(target);
        if(!real.startsWith(SITE_DIR+path.sep))throw new Error('file outside website');
        const stat=await fs.stat(real);
        if(!stat.isFile())throw new Error('not a file');
        const mime=MIME[path.extname(real).toLowerCase()]||'application/octet-stream';
        res.writeHead(200,{'Content-Type':mime,'Content-Length':stat.size,'Cache-Control':path.extname(real)==='.html'?'no-cache':'public, max-age=60','X-Content-Type-Options':'nosniff'});
        if(req.method==='HEAD'){res.end();return;}
        res.end(await fs.readFile(real));return;
      }catch {fail(res,404,'찾을 수 없는 파일');return;}
    }
    if(req.method==='GET'&&u.pathname==='/api/support/health'){json(res,200,publicSummary());return;}
    if(req.method==='GET'&&u.pathname==='/api/support/threads'){json(res,200,{...publicSummary(),threads:list()});return;}
    if(req.method==='GET'&&u.pathname==='/api/support/stream'){
      headersForSSE(res);res.write('event: connected\ndata: '+JSON.stringify({seq:db.seq})+'\n\n');clients.add(res);
      req.on('close',()=>clients.delete(res));return;
    }
    if(req.method==='POST'&&u.pathname==='/api/support/threads'){
      if(req.headers['content-type']?.split(';')[0]!=='application/json'){fail(res,415,'JSON만 지원합니다');return;}
      const body=await readBody(req);
      if(!inRange(body.author,24,2)||!inRange(body.title,120,4)||!inRange(body.body,2000,10)||!categories.has(body.category)){fail(res,400,'닉네임(2~24), 제목(4~120), 내용(10~2000)과 분류를 확인하세요.');return;}
      const t={id:randomUUID(),category:body.category,title:body.title.trim(),body:body.body.trim(),author:body.author.trim(),status:'open',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),replies:[]};
      db.threads.unshift(t);db.threads=db.threads.slice(0,2000);db.seq++;await persist();broadcast();json(res,201,{thread:t});return;
    }
    const m=/^\/api\/support\/threads\/([0-9a-f-]{36})\/(replies|status)$/.exec(u.pathname);
    if(m && req.method==='POST' && m[2]==='replies'){
      if(req.headers['content-type']?.split(';')[0]!=='application/json'){fail(res,415,'JSON만 지원합니다');return;}
      const t=db.threads.find(x=>x.id===m[1]);if(!t){fail(res,404,'게시글을 찾지 못했습니다');return;}
      if(t.replies.length>=300){fail(res,400,'이 게시글에는 댓글을 더 추가할 수 없습니다');return;}
      const body=await readBody(req);
      if(!inRange(body.author,24,2)||!inRange(body.body,1000,2)){fail(res,400,'닉네임과 댓글(2~1000자)을 확인하세요');return;}
      const reply={id:randomUUID(),author:body.author.trim(),body:body.body.trim(),parentId:t.replies.some(r=>r.id===body.parentId)?body.parentId:null,createdAt:new Date().toISOString()};
      t.replies.push(reply);t.updatedAt=reply.createdAt;db.seq++;await persist();broadcast();json(res,201,{reply});return;
    }
    const removeThread=/^\/api\/support\/threads\/([0-9a-f-]{36})$/.exec(u.pathname);
    if(removeThread && req.method==='DELETE'){
      if(!safeAdmin(req)){fail(res,403,'관리자 권한이 필요합니다');return;}
      const idx=db.threads.findIndex(t=>t.id===removeThread[1]);
      if(idx<0){fail(res,404,'게시글을 찾지 못했습니다');return;}
      db.threads.splice(idx,1);db.seq++;await persist();broadcast();json(res,200,{deleted:true});return;
    }
    if(m && req.method==='PATCH' && m[2]==='status'){
      if(!safeAdmin(req)){fail(res,403,'관리자 권한이 필요합니다');return;}
      const t=db.threads.find(x=>x.id===m[1]);if(!t){fail(res,404,'게시글을 찾지 못했습니다');return;}
      const body=await readBody(req);if(!statuses.has(body.status)){fail(res,400,'허용되지 않은 상태');return;}
      t.status=body.status;t.updatedAt=new Date().toISOString();db.seq++;await persist();broadcast();json(res,200,{thread:t});return;
    }
    fail(res,404,'해당 API 경로가 없습니다');
  }catch(e){finish(res,e);}
});
srv.listen(PORT,HOST,()=>console.log(`TFG Support API: http://${HOST}:${PORT} (allowed browser origins: ${[...allowed].join(', ')||'localhost only'})`));
const heartbeat=setInterval(()=>{for(const r of clients){try{r.write(': ping\n\n');}catch{clients.delete(r);}}},20000);
heartbeat.unref();
