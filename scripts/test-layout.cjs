/* CI-only layout checks on repository files. No game input or screenshots. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const site=path.resolve(__dirname,'../website');
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(site,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(site+path.sep)){res.writeHead(404);res.end();return;}
    try{
      const bytes=fs.readFileSync(file);
      const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
      res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    for(const viewport of [{width:1920,height:980},{width:1366,height:650},{width:900,height:700},{width:390,height:844}]){
      const page=await browser.newPage({viewport});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://**/*',route=>route.abort());
      await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.getElementById('data-status').textContent==='데이터 연결 실패');
      assert.deepEqual(await page.locator('.top-nav button:visible').allTextContents().then(a=>a.map(x=>x.trim())),['지도','퀘스트','가방 가격']);
      const geometry=await page.locator('#map-viewport').evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return {width:rect.width,height:rect.height,top:rect.top,bottom:rect.bottom};
      });
      assert.ok(geometry.height>=420,'Map must retain a useful height: '+JSON.stringify(geometry));
      if(viewport.width>=1000)assert.ok(geometry.width>=viewport.width-400,'Map must use the freed right panel');
      if(viewport.width>=1000)assert.ok(geometry.top<=210,'Tracking and filters must not push the map below the fold: '+geometry.top);
      assert.equal(await page.locator('#companion-panel').isVisible(),false);
      assert.equal(await page.locator('#intel-panel').isVisible(),false);
      assert.equal(await page.locator('#intel-layer-toolbar').isVisible(),false);
      await page.locator('#map-viewport').hover();
      await page.mouse.wheel(0,650);
      await page.waitForFunction(()=>window.scrollY>0);
      await page.locator('#map-viewport').evaluate(el=>el.scrollIntoView({block:'end'}));
      const bottom=await page.locator('#map-viewport').evaluate(el=>el.getBoundingClientRect().bottom);
      assert.ok(bottom>=0&&bottom<=viewport.height+1,'Map bottom must be reachable with page scroll');
      const dimensions=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.ok(dimensions.content<=dimensions.viewport+1,'No horizontal page clipping');
      await page.locator('#map-options summary').click();
      assert.equal(await page.locator('#intel-layer-toolbar').isVisible(),true);
      await page.locator('#map-options summary').click();
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.locator('#open-loot-top').click();
      assert.equal(await page.locator('#loot-dialog').isVisible(),true);
      assert.equal(await page.locator('body').getAttribute('data-view'),'map');
      assert.equal(await page.locator('#loot-file').getAttribute('accept'),'image/png,image/jpeg,image/webp,image/bmp');
      await page.locator('#loot-close').click();
      assert.deepEqual(errors,[]);
      console.log('PASS layout '+viewport.width+'x'+viewport.height+': map '+Math.round(geometry.width)+'x'+Math.round(geometry.height)+', wheel scroll, reachable bottom, three actions, bag dialog');
      await page.close();
    }
    // A generated label image verifies OCR and valuation without game captures.
    const photo=await browser.newPage({viewport:{width:1280,height:800}});
    await photo.route('https://**/*',route=>route.abort());
    await photo.route('https://json.tarkov.dev/**',route=>{
      const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
      const item={id:'fixture-gp-coin',name:'GP coin',normalizedName:'gp-coin',
        lastLowPrice:10000,updated:'2026-11-13T09:00:00Z',
        sellFor:[{vendor:{name:'Prapor',normalizedName:'prapor'},currency:'RUB',price:4000,priceRUB:4000}]};
      const docs={endpoints:{gameModes:['regular','pve']},items:{data:{items:[item]}},
        traders:{data:{traders:[{id:'fixture-prapor',name:'Prapor',normalizedName:'prapor'}]}},
        maps:{data:{maps:[]}},tasks:{data:{tasks:[]}}};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(docs[endpoint]||{})});
    });
    await photo.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'networkidle'});
    await photo.locator('#open-loot-top').click();
    await photo.locator('#loot-language').selectOption('eng');
    const png=await photo.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=700;canvas.height=180;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,700,180);
      ctx.fillStyle='#000';ctx.font='64px Arial';ctx.fillText('GP coin x2',36,110);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await photo.locator('#loot-file').setInputFiles({name:'synthetic-item-label.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await photo.waitForFunction(()=>document.getElementById('loot-total-flea').textContent.includes('20,000'),{},{timeout:90000});
    assert.match(await photo.locator('#loot-total-trader').textContent(),/8,000/);
    assert.match(await photo.locator('#loot-ocr-text').inputValue(),/GP\s+coin/i);
    assert.equal(await photo.locator('body').getAttribute('data-view'),'map');
    console.log('PASS photo OCR and valuation: local English OCR reads a synthetic GP coin x2 image, flea 20,000 and trader 8,000');
    await photo.close();
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
