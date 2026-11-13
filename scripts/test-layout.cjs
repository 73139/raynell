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
      assert.deepEqual(await page.locator('.top-nav button:visible').allTextContents().then(a=>a.map(x=>x.trim())),['지도','퀘스트','경매장','가방 가격']);
      const geometry=await page.locator('#map-viewport').evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return {width:rect.width,height:rect.height,top:rect.top,bottom:rect.bottom};
      });
      assert.ok(geometry.height>=420,'Map must retain a useful height: '+JSON.stringify(geometry));
      if(viewport.width>=1000)assert.ok(geometry.width>=viewport.width-400,'Map must use the freed right panel');
      if(viewport.width>=1000)assert.ok(geometry.top<=290,'Tracking and filters must not push the map below the fold: '+geometry.top);
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
      assert.equal(await page.locator('#map-quick-layers').isVisible(),true);
      await page.locator('#open-market-top').click();
      await page.locator('#market-status').filter({hasText:'시세 연결 실패'}).waitFor();
      assert.equal(await page.locator('#market-view').isVisible(),true);
      assert.equal(await page.locator('#market-search').isVisible(),true);
      assert.equal(await page.locator('#auto-market').isChecked(),true);
      const marketWidth=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.ok(marketWidth.content<=marketWidth.viewport+1,'Market page must not overflow horizontally');
      await page.locator('.top-nav [data-view="map"]').click();
      await page.locator('#open-loot-top').click();
      assert.equal(await page.locator('#loot-dialog').isVisible(),true);
      assert.equal(await page.locator('body').getAttribute('data-view'),'map');
      assert.equal(await page.locator('#loot-file').getAttribute('accept'),'image/png,image/jpeg,image/webp,image/bmp');
      await page.locator('#loot-close').click();
      assert.deepEqual(errors,[]);
      console.log('PASS layout '+viewport.width+'x'+viewport.height+': map '+Math.round(geometry.width)+'x'+Math.round(geometry.height)+', wheel scroll, reachable bottom, four actions, bag dialog');
      await page.close();
    }
    // A generated label image verifies OCR and valuation without game captures.
    const photo=await browser.newPage({viewport:{width:1280,height:800}});
    await photo.route('https://**/*',route=>route.abort());
    const localMaps=JSON.parse(fs.readFileSync(path.join(site,'maps-source.json'),'utf8')).maps;
    const template=localMaps.find(m=>m.normalizedName==='customs').maps.find(m=>m.projection==='interactive');
    const mapFixtures=['customs','woods','lighthouse','streets-of-tarkov'].map(key=>({normalizedName:key,maps:[{...template,key,bounds:[[-1500,-1500],[1500,1500]],svgBounds:[[-1500,-1500],[1500,1500]],svgPath:'https://assets.tarkov.dev/maps/svg/'+key+'.svg'}]}));
    await photo.route('https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mapFixtures)}));
    await photo.route('https://json.tarkov.dev/**',route=>{
      const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
      const item={id:'fixture-gp-coin',name:'GP coin',normalizedName:'gp-coin',
        lastLowPrice:10000,updated:'2026-11-13T09:00:00Z',
        sellFor:[{vendor:{name:'Prapor',normalizedName:'prapor'},currency:'RUB',price:4000,priceRUB:4000}]};
      const docs={endpoints:{gameModes:['regular','pve']},items:{data:{items:[item]}},
        traders:{data:{traders:[{id:'fixture-prapor',name:'Prapor',normalizedName:'prapor'}]}},
        maps:{data:{maps:[{id:'fixture-customs',name:'Customs',normalizedName:'customs',bosses:[{mob:'bossBully',spawnLocations:[{name:'ZoneScavBase',positions:[{x:125,y:1,z:-146},{x:103,y:1,z:-114}]}]}],spawns:[{position:{x:100,y:0,z:0},sides:['pmc'],categories:['player']},{position:{x:200,y:0,z:50},sides:['scav'],categories:['bot']}]}],mobs:{bossBully:{id:'bossBully',name:'Reshala'}}}},tasks:{data:{tasks:[{id:'fixture-kappa',name:'Demo Kappa quest',normalizedName:'demo-kappa',wikiLink:'https://escapefromtarkov.fandom.com/wiki/Fixture_Guide',map:'fixture-customs',kappaRequired:true,objectives:[{id:'fixture-photo-objective',type:'visit',description:'Find the office',possibleLocations:[{map:'fixture-customs',positions:[{x:-202,y:7,z:-102}]}]}]}]}}};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(docs[endpoint]||{})});
    });
    await photo.route('https://assets.tarkov.dev/maps/svg/Customs.svg',route=>route.fulfill({status:200,contentType:'image/svg+xml',headers:{'Access-Control-Allow-Origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700"><g id="Ground"><rect width="1000" height="700" fill="#253827"/></g></svg>'}));
    await photo.route('https://assets.tarkov.dev/maps/svg/*.svg',route=>route.fulfill({status:200,contentType:'image/svg+xml',headers:{'Access-Control-Allow-Origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700"><g id="Ground"><rect width="1000" height="700" fill="#253827"/></g></svg>'}));
    await photo.route('https://escapefromtarkov.fandom.com/api.php*',route=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({parse:{title:'Fixture Guide',text:{'*':'<h2 id="Guide">Guide</h2><p>Find the office on Customs.</p><div><img width="300" height="169" src="https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/a/ab/Office.png" alt="The office door"><img width="300" height="169" data-src="https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/a/ab/Desk.png" alt="The desk"></div>'}}})}));
    await photo.route('https://static.wikia.nocookie.net/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#456b49"/><text x="60" y="100" fill="white" font-size="40">Guide photo fixture</text></svg>'}));
    await photo.goto('http://127.0.0.1:'+server.address().port+'/?view=market',{waitUntil:'networkidle'});
    await photo.waitForFunction(()=>document.getElementById('market-results').textContent.includes('10,000'));
    assert.equal(await photo.locator('#market-view').isVisible(),true);
    await photo.locator('.top-nav [data-view="map"]').click();
    await photo.waitForFunction(()=>document.getElementById('map-image').naturalWidth>0);
    await photo.locator('.kappa-card-mark').waitFor();
    assert.equal(await photo.locator('.kappa-card-mark').textContent(),'K');
    assert.equal(await photo.locator('.kappa-card-mark').evaluate(el=>getComputedStyle(el).color),'rgb(255, 57, 54)');
    assert.ok(await photo.locator('#map-markers .intel-boss').count()>=2);
    assert.equal(await photo.locator('#map-markers .intel-pmc').count(),1);
    assert.equal(await photo.locator('#map-markers .intel-scav').count(),1);
    await photo.locator('#map-markers .intel-boss').last().click();
    assert.equal(await photo.locator('#boss-detail-card').isVisible(),true);
    assert.equal(await photo.locator('#boss-detail-card h2').textContent(),'르샬라');
    await photo.locator('#close-boss-card').click();
    const clocks=await photo.locator('[data-raid-clock]').allTextContents();
    const clockSeconds=value=>value.split(':').reduce((n,v)=>n*60+Number(v),0);
    assert.equal((clockSeconds(clocks[1])-clockSeconds(clocks[0])+86400)%86400,43200);
    await photo.locator('#open-recommended-routes').click();
    await photo.locator('[data-apply-route="customs-center"]').click();
    assert.equal(await photo.locator('#map-markers .guide-waypoint').count(),3);
    assert.equal(await photo.locator('.recommended-route-line path').count(),1);
    await photo.locator('#clear-recommended-route').click();
    assert.equal(await photo.locator('#map-markers .guide-waypoint').count(),0);
    await photo.locator('#open-kappa-line').click();
    assert.equal(await photo.locator('.kappa-flow-row').count(),1);
    await photo.locator('#close-kappa-line').click();
    console.log('PASS visible boss and PMC/Scav spawns, red K badges, Kappa line and three verified route waypoints on a rendered SVG');
    await photo.locator('.quest-pin').click();
    await photo.locator('#map-markers .pin-marker').click();
    await photo.waitForFunction(()=>document.getElementById('quest-location-image').naturalWidth>0);
    assert.equal(await photo.locator('#quest-location-card').isVisible(),true);
    assert.equal(await photo.locator('#quest-location-thumbnails button').count(),2);
    assert.match(await photo.locator('#quest-location-caption').textContent(),/office door/);
    await photo.locator('#quest-location-next').click();
    assert.equal(await photo.locator('#quest-location-counter').textContent(),'2 / 2');
    await photo.locator('#quest-location-expand').click();
    assert.equal(await photo.locator('#quest-location-expand').getAttribute('aria-expanded'),'true');
    await photo.setViewportSize({width:390,height:844});
    const card=await photo.locator('#quest-location-card').boundingBox();
    assert.ok(card.x>=0&&card.x+card.width<=390&&card.y>=0&&card.y+card.height<=844,'Photo card must fit the mobile screen: '+JSON.stringify(card));
    await photo.locator('#quest-location-close').click();
    await photo.locator('[data-quest-photo-task][data-quest-photo-objective]').click();
    assert.equal(await photo.locator('#quest-location-card').isVisible(),true);
    await photo.locator('#quest-location-close').click();
    await photo.setViewportSize({width:1280,height:800});
    console.log('PASS quest target click and objective button open location photos: real image element, thumbnails, next image, enlarge, close and mobile bounds');
    await photo.locator('#open-cultist-info').click();
    assert.equal(await photo.locator('[data-cultist-map]').count(),5);
    await photo.locator('[data-raid-close="cultist-dialog"]').click();
    await photo.locator('#open-btr-timetable').click();
    await photo.waitForFunction(()=>document.getElementById('btr-route').options.length===5);
    await photo.locator('#btr-map').selectOption('lighthouse');
    assert.equal(await photo.locator('#btr-route option').count(),4);
    await photo.locator('#btr-route').selectOption('route4');
    assert.match(await photo.locator('#btr-spawn-time').textContent(),/미등록/);
    await photo.locator('#btr-map').selectOption('woods');
    await photo.locator('#btr-minutes').fill('30');await photo.locator('#btr-seconds').fill('0');await photo.locator('#align-btr-timer').click();
    assert.match(await photo.locator('#btr-current-time').textContent(),/남은 시간/);
    await photo.locator('#show-btr-route').click();
    await photo.waitForFunction(()=>document.querySelectorAll('.btr-map-marker:not(.btr-spawn)').length===8);
    assert.equal(await photo.locator('.btr-spawn').count(),2);
    assert.equal(await photo.locator('.btr-route-overlay polyline').count(),1);
    await photo.locator('#map-switcher').selectOption('customs');
    await photo.waitForFunction(()=>document.getElementById('map-image').style.visibility==='visible');
    await photo.locator('#open-personal-routes').click();await photo.locator('#fk-new-route').click();
    await photo.locator('#fk-route-name').fill('내 검증 루트');await photo.locator('#fk-route-name').press('Tab');
    await photo.locator('#fk-route-pick').click();
    const imageBox=await photo.locator('#map-image').boundingBox();
    for(const [u,v] of [[.25,.5],[.5,.62],[.7,.35]])await photo.mouse.click(imageBox.x+imageBox.width*u,imageBox.y+imageBox.height*v);
    await photo.locator('#undo-personal-point').click();await photo.locator('#finish-personal-route').click();
    assert.equal(await photo.locator('.fk-waypoints>li').count(),2);
    await photo.locator('[data-point-up]').nth(1).click();
    assert.equal(await photo.locator('[data-point-name]').first().inputValue(),'파밍 지점 2');
    await photo.locator('#field-kit-close').click();assert.equal(await photo.locator('.personal-route-line path').count(),1);
    await photo.locator('#open-recommended-routes').click();await photo.locator('[data-copy-route="customs-center"]').click();
    assert.equal(await photo.locator('.fk-waypoints>li').count(),3);
    const saved=await photo.evaluate(()=>JSON.parse(localStorage.getItem('tfg-r11-routes-regular')));
    assert.equal(saved.length,2);assert.equal(saved[0].name,'내 검증 루트');assert.equal(saved[0].points.length,2);
    await photo.locator('#field-kit-close').click();
    console.log('PASS boss identity, dual game clocks, cultist areas, BTR tables and stop/spawn overlays, personal route drawing/undo/reorder/persistence and recommendation copying');
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
