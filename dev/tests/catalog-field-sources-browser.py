"""Open the catalog's real physical sources from a pinned water budget and ordinary item search."""
import json,os,re
from pathlib import Path
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
URL=urldefrag(os.getenv('RUSTLINE_URL') or 'https://field-catalog.test/').url
KEY='rl-reboot-session-v36'

def check(browser,width):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as c:
        if not os.getenv('RUSTLINE_URL'):c.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        c.add_init_script('window.catalogRolls=0;const nativeRoll=Math.random;Math.random=(...args)=>{window.catalogRolls++;return nativeRoll(...args)};')
        p=c.new_page();p.set_default_timeout(6500);p.set_default_navigation_timeout(60000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        def click(sel):
            b=p.locator(sel+':visible').first
            if mobile:b.tap()
            else:b.click()
        def snap():return p.evaluate('k=>localStorage.getItem(k)',KEY)
        def query(id):
            p.locator('#db-query').fill(id);click(f'[data-db=item][data-id="{id}"]')
        r=p.goto(URL+'#map');assert r.ok and r.body()==HTML
        click('.nav [data-page=bunker]');click('.bu-facility-tile[data-id=water]');click('[data-objective=pin][data-id=water][data-tier="1"]');click('.nav [data-page=map]');click('[data-objective=procurement-toggle]')
        panel=p.locator('[data-facility-budget]');expect(panel).to_have_attribute('data-facility-budget','partial');expect(panel.locator('[data-budget-known]')).to_have_text('70,000 CR');expect(panel.locator('[data-budget-unavailable]')).to_contain_text('정수 필터 2개');expect(panel.locator('[data-budget-total]')).to_have_count(0)
        button=p.get_by_role('button',name='정수 필터 현장 수급처');assert button.bounding_box()['height']>=44
        original=snap();rolls=p.evaluate('window.catalogRolls');button.click();details=p.locator('[data-catalog-sources="filter"]');summary=details.locator('summary');expect(summary).to_be_focused();expect(details.locator('[data-catalog-box]')).to_have_count(3)
        assert snap()==original and p.evaluate('window.catalogRolls')==rolls
        expect(details).to_contain_text('빈 보관함');expect(details).to_contain_text('다른 생존자가 먼저 수색하면 남은 물품은 달라질 수 있습니다.');expect(details.locator('li strong')).to_have_text(['13.66%']*3)
        expect(details.locator('li>b')).to_have_text(['송전탑 점검소','도로통제 창고','하역 도크']);assert details.inner_text().count('열쇠 불필요')==3
        assert details.evaluate('e=>e.scrollWidth<=e.clientWidth+1') and summary.bounding_box()['height']>=44
        if os.getenv('RUSTLINE_CATALOG_SHOTS'):
            out=Path(os.environ['RUSTLINE_CATALOG_SHOTS']);out.mkdir(parents=True,exist_ok=True);details.screenshot(path=str(out/f'field-{width}.png'),animations='disabled')
        p.keyboard.press('Space');expect(details.locator('[data-catalog-sites]')).not_to_be_visible();p.keyboard.press('Enter');expect(details.locator('[data-catalog-sites]')).to_be_visible()
        query('bandage');details=p.locator('[data-catalog-sources=bandage]');expect(details.locator('[data-catalog-box]')).to_have_count(0)
        # First expand is explicit; cached rendering and subsequent opens never sample the live raid.
        summary=details.locator('summary');summary.focus();p.keyboard.press('Enter');expect(details).to_contain_text('검역실 열쇠 필요');expect(details).to_contain_text('열쇠 불필요');assert snap()==original
        query('rl_craft_dressing');expect(p.locator('#db-detail')).to_contain_text('의무실 제작 전용');expect(p.locator('[data-catalog-sources]')).to_have_count(0)
        r=p.goto(URL+'#map');click('.command-station[data-index="0"]');click('.command-deploy[data-page=prep]');click('.lo-deploy[data-raid=start]');active=json.loads(snap());assert active['raid'] and active['field']['boxes']
        p.goto(URL+'#clinic');click('[data-db=lookup][data-id=bandage]');query('filter');details=p.locator('[data-catalog-sources=filter]');expect(details.locator('[data-catalog-box]')).to_have_count(0);before=snap();r=p.evaluate('window.catalogRolls');click('[data-catalog-sources=filter] summary');expect(details.locator('[data-catalog-box]')).to_have_count(3);assert snap()==before and p.evaluate('window.catalogRolls')==r
        assert not errors,errors
        print(f'PASS {width}px: water 2 filters from a partial budget, 3 unlocked 13.66% sites, keyboard/touch, mixed key requirements, craft-only omitted, identical uninspected field/server-local save and native RNG call count.',flush=True)

if __name__=='__main__':
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in [390,1280]:check(browser,width)
