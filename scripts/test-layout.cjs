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
      const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
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
      if(viewport.width===1920){
        // Reproduce the historical cache problem using real browser IndexedDB.
        await page.evaluate(async()=>{
          const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('tarkov-field-guide',1);req.onupgradeneeded=()=>req.result.createObjectStore('cache');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
          await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put({maps:[{normalizedName:'customs',svgPath:'https://example.invalid/old-map.svg',bounds:[[0,0],[1,1]]}]},'map-configs');tx.objectStore('cache').put('<svg xmlns="http://www.w3.org/2000/svg"><text>STALE MAP</text></svg>','svg:https://assets.tarkov.dev/maps/svg/Customs.svg');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
        });
        await page.reload({waitUntil:'networkidle'});
        assert.equal(await page.locator('#map-switcher option:not([disabled])').count(),13);
        const catalog=JSON.parse(fs.readFileSync(path.join(site,'maps-source.json'),'utf8'));
        let drawnFloors=0;
        for(const group of catalog.maps){
          const c=group.maps[0];await page.locator('#map-switcher').selectOption(group.normalizedName);
          await page.waitForFunction(()=>document.getElementById('map-image').style.visibility==='visible'&&document.getElementById('map-image').naturalWidth>0);
          assert.match(await page.locator('#map-image').getAttribute('src'),c.floorAssets?/maps\/latest\//:/^blob:/);
          const floors=await page.locator('#map-floor option:not([disabled])').evaluateAll(els=>els.map(el=>el.value));
          for(const floor of floors){await page.locator('#map-floor').selectOption(floor);await page.waitForFunction(()=>document.getElementById('map-image').style.visibility==='visible'&&document.getElementById('map-image').naturalWidth>0);if(floor!=='__all__')drawnFloors++;}
        }
        assert.equal(drawnFloors,55);
        console.log('PASS stale IndexedDB cache cannot replace bundled catalog; 13 actual map images and all 55 floor planes decode offline in Chromium');
      }
      assert.deepEqual(errors,[]);
      console.log('PASS layout '+viewport.width+'x'+viewport.height+': map '+Math.round(geometry.width)+'x'+Math.round(geometry.height)+', wheel scroll, reachable bottom, four actions, bag dialog');
      await page.close();
    }
    // Caption-free inventory fixtures exercise the real file/worker/canvas path.
    const photo=await browser.newPage({viewport:{width:1280,height:800}});
    const photoErrors=[];photo.on('pageerror',error=>photoErrors.push(error.message));
    await photo.route('https://**/*',route=>route.abort());
    await photo.route('https://json.tarkov.dev/**',route=>{
      const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);
      const item={id:'5d235b4d86f7742e017bc88a',name:'GP coin',normalizedName:'gp-coin',
        lastLowPrice:10000,updated:'2026-11-13T09:00:00Z',
        sellToTrader:[{trader:'fixture-prapor',currency:'RUB',price:4000,priceRUB:4000}],
        buyFromTrader:[{trader:'fixture-prapor',currency:'RUB',price:16000,priceRUB:16000}]};
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
    // This office fixture is upstairs. Ground-floor filtering must hide it;
    // selecting all floors makes its photo marker available on the real map.
    assert.equal(await photo.locator('#map-markers .pin-marker').count(),0);
    await photo.locator('#map-floor').selectOption('__all__');
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
    try{await photo.waitForFunction(()=>document.querySelectorAll('.btr-map-marker:not(.btr-spawn)').length===8);}catch(error){console.error('BTR map diagnostics',await photo.evaluate(()=>({map:document.getElementById('map-switcher').value,title:document.getElementById('map-title').textContent,loading:document.getElementById('map-loading').textContent,visible:document.getElementById('map-image').style.visibility,pins:document.querySelectorAll('.btr-map-marker').length,checked:document.getElementById('show-btr-markers').checked})),photoErrors);throw error;}
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
    const imageFiles=name=>path.join(__dirname,'fixtures/loot',name);
    await photo.locator('#loot-file').setInputFiles(imageFiles('icon-only-bag.png'));
    await photo.waitForFunction(()=>document.getElementById('loot-total-flea').textContent.includes('20,000'),{},{timeout:90000});
    assert.match(await photo.locator('#loot-total-trader').textContent(),/8,000/);
    assert.match(await photo.locator('#loot-total-best').textContent(),/20,000/);
    assert.equal(await photo.locator('.loot-mark.priced').count(),5);
    assert.equal(await photo.locator('[data-loot-edit]').count(),5);
    assert.equal(await photo.locator('#loot-total-count').innerText(),'5개 품목 / 5개');
    assert.equal(await photo.locator('#loot-ocr-text').count(),0);
    await photo.locator('[data-loot-pick="bag"]').click();
    const box=await photo.locator('#loot-photo').boundingBox();
    async function selectRegion(x1,y1,x2,y2) {
      await photo.mouse.move(box.x+box.width*x1/354,box.y+box.height*y1/232);
      await photo.mouse.down();
      await photo.mouse.move(box.x+box.width*x2/354,box.y+box.height*y2/232,{steps:6});
      await photo.mouse.up();
    }
    await selectRegion(12,17,147,88);
    await photo.waitForFunction(()=>document.getElementById('loot-total-count').textContent==='2개 품목 / 2개');
    await photo.locator('[data-loot-pick="single"]').click();
    await selectRegion(81,86,208,150);
    await photo.waitForFunction(()=>document.getElementById('loot-total-count').textContent==='3개 품목 / 3개');
    await photo.locator('#loot-full').click();
    await photo.waitForFunction(()=>document.getElementById('loot-total-count').textContent==='5개 품목 / 5개');
    await photo.locator('#loot-file').setInputFiles(imageFiles('similar-cases.png'));
    await photo.locator('#loot-review').waitFor();
    assert.equal(await photo.locator('#loot-total-count').textContent(),'0개 품목 / 0개');
    await photo.locator('[data-hit]').first().click();
    assert.equal(await photo.locator('#loot-total-count').textContent(),'1개 품목 / 1개');
    await photo.locator('[data-loot-qty]').fill('3');
    await photo.locator('[data-loot-qty]').press('Tab');
    assert.equal(await photo.locator('#loot-total-count').textContent(),'1개 품목 / 3개');
    assert.equal(await photo.locator('body').getAttribute('data-view'),'map');
    assert.deepEqual(photoErrors,[]);
    console.log('PASS offline picture matching in Chromium, 5 icons, two coins priced at 20,000/8,000, bag crop, one-item crop, identical-art confirmation and editable stack quantity');
    await photo.close();
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
