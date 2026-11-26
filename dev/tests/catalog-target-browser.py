"""Track one catalog item through preparation, concealed loot, actual pickup and return."""
import os
from pathlib import Path
from urllib.parse import urldefrag
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
LIVE=os.getenv('RUSTLINE_URL')
URL=urldefrag(LIVE or 'https://rustline-catalog-target.test/').url
KEY='rl-reboot-session-v36'


def play(browser,width):
    mobile=width<600
    with browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,
                             reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as ctx:
        if not LIVE:ctx.route(URL+'**',lambda route:route.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        ctx.add_init_script('Math.random=()=>.10')
        p=ctx.new_page();p.set_default_timeout(8000);p.set_default_navigation_timeout(90000);p.clock.install()
        errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        def saved():return p.evaluate('k=>JSON.parse(localStorage[k])',KEY)
        def press(sel):
            node=p.locator(sel+':visible').first
            if mobile:node.tap()
            else:node.focus();p.keyboard.press('Enter')
        resp=p.goto(URL+'#clinic',wait_until='domcontentloaded');assert resp and resp.ok and resp.body()==HTML
        press('[data-db=lookup][data-id=bandage]')
        press('[data-catalog-sources=bandage] summary')
        before=saved();assert before['lootGoal'] is None
        press('[data-lootplan=catalog-item][data-id=bandage]')
        goal=p.locator('.lp-selector [aria-pressed=true]');expect(goal).to_have_text('구급 붕대');expect(goal).to_be_focused()
        expect(p.locator('[data-lootplan-page]')).to_contain_text('상자 전체 1개 이상')
        assert saved()['lootGoal']=='item/bandage' and saved()['wallet']==before['wallet'] and saved()['raid'] is None
        target='[data-lootplan=candidate][data-zone="0"][data-landmark="7"]'
        if not p.locator(target).is_visible():press('[data-lp-more] summary')
        press(target);expect(p.locator('[data-sortie-preflight]')).to_contain_text('구급 붕대 회수 공간')
        dest={'goal':'item/bandage','zone':0,'index':7};assert saved()['lootDestination']==dest
        p.reload(wait_until='domcontentloaded');assert saved()['lootDestination']==dest
        if not p.locator('.lo-deploy[data-raid=start]:visible').count():
            p.goto(URL+'#map');press('.command-deploy[data-page=prep]')
        press('.lo-deploy[data-raid=start]');assert saved()['field']['landmarkByZone'][0]==7
        press('[data-field=scan]');p.clock.fast_forward(10000);press('[data-field=open]')
        tab='[data-loadout=mobile-tab][data-index="2"][data-screen=loot]'
        if p.locator(tab+':visible').count():press(tab)
        expect(p.locator('[data-catalog-track-badge]')).to_have_count(0)
        press('.lo-search[data-field=search]');p.clock.fast_forward(10000)
        tile=p.locator('[data-side=loot][aria-label^="구급 붕대"]:visible').first
        expect(tile).to_have_attribute('aria-label','구급 붕대 · 도감 탐색 목표')
        expect(tile.locator('[data-catalog-track-badge]')).to_have_text('목표')
        press('[data-side=loot][aria-label^="구급 붕대"]');press('[data-field=take]');press('[data-field=close]')
        p.clock.fast_forward(7*60000);press('[data-field=extract][data-exit=b04]');p.clock.fast_forward(12000)
        state=saved();assert state['lastSummary']['rating']=='success' and state['lastSummary']['goods']==['bandage']
        assert state['stash']['bandage']==1 and state['lootDestination']==dest and state['wallet']==30000
        press('[data-raid=ack]');p.goto(URL+'#lootplan');press('[data-lootplan=clear]')
        assert saved()['lootGoal'] is None and saved()['lootDestination'] is None and saved()['stash']['bandage']==1
        assert not errors,errors
        print(f'PASS {width}px actual catalog → single-item route → selected landmark persisted → only revealed tile tagged → bandage recovered, no money change; clear kept inventory.',flush=True)

if __name__=='__main__':
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in (390,1280):play(browser,width)
