"""Earn the scouting prerequisite and measure two different supplies at actual landmarks."""
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

HTML = (Path(__file__).resolve().parents[1] / 'index.html').read_bytes()
LIVE = os.getenv('RUSTLINE_URL')
URL = LIVE or 'https://rustline-expedition-ration.test/'
KEY = 'rl-reboot-session-v36'
NATURAL = os.getenv('RUSTLINE_RATION_NATURAL') == '1'

def play(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={'width': width, 'height': 860}, has_touch=mobile, is_mobile=mobile,
                             ignore_https_errors=bool(LIVE), service_workers='block', accept_downloads=False) as ctx:
        errors = []
        def serve(route):
            if route.request.method != 'GET' or urlsplit(route.request.url).netloc != urlsplit(URL).netloc:
                errors.append(route.request.url)
                return route.abort()
            if LIVE:
                return route.continue_()
            route.fulfill(body=HTML, content_type='text/html; charset=utf-8')
        ctx.route('**/*', serve)
        page = ctx.new_page()
        page.set_default_timeout(8000)
        page.set_default_navigation_timeout(60000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        if not NATURAL:
            page.clock.install()
            ctx.add_init_script('Math.random = () => 0.13')
        response = page.goto(URL + '#map', wait_until='domcontentloaded')
        assert response and response.ok and response.body() == HTML
        def saved():
            return page.evaluate('k => JSON.parse(localStorage.getItem(k))', KEY)
        def press(selector):
            loc = page.locator(selector + ':visible').first
            loc.tap() if mobile else loc.click()
        def settle():
            for _ in range(100):
                f = saved()['field']
                if f.get('result'):
                    return
                if f.get('action'):
                    if NATURAL:
                        page.wait_for_function('k => !JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,timeout=60000)
                    else:
                        remaining = f['action']['end'] - page.evaluate('Date.now()')
                        page.clock.fast_forward(max(400, remaining + 500))
                elif f.get('contact'):
                    press('[data-field=evade]')
                elif f.get('journey'):
                    if f['journey'].get('event') == 'supply':
                        press('[data-field=journey-pass]')
                    elif NATURAL:
                        page.wait_for_timeout(200)
                    else:
                        page.clock.fast_forward(500)
                else:
                    return
            raise AssertionError('field activity did not settle')
        def move(zone):
            if saved()['raid']['zone'] != zone:
                press(f'[data-route-card][data-to="{zone}"] [data-field=move]')
                settle()
            assert saved()['raid']['zone'] == zone

        def nav(target):page.goto(URL+'#'+target,wait_until='domcontentloaded')
        def accept(job):
            nav('quests');press('[data-page=orders]');press(f'[data-bui=order][data-id="{job}"]');press(f'[data-order="{job}"]');press(f'[data-objective=pin][data-id="{job}"]')
        def start():
            nav('map');press('.command-station[data-index="0"]');press('.command-deploy[data-page=prep]');press('.lo-deploy[data-raid=start]')
        def site(index):
            if saved()['field']['landmarkByZone'][saved()['raid']['zone']]==index:return
            if not page.locator('.landmark-picker').evaluate('e=>e.open'):press('.landmark-picker summary')
            press(f'[data-field=landmark][data-index="{index}"]')
        def search(index):
            sel=f'[data-field=open][data-index="{index}"]'
            while not page.locator(sel+':visible').count():press('[data-field=scan]');settle()
            press(sel);tab='[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
            if page.locator(tab+':visible').count():press(tab)
            if page.locator('.lo-search').is_enabled():press('.lo-search');settle()
            assert saved()['field']['boxes'][f'0-{index}']['complete']
            press('[data-field=close]');settle()
        def normal():
            move(0);press('[data-field=extract][data-exit=b04]');settle();s=saved()
            assert s['lastSummary']['rating']=='success';return s['lastSummary']
        def inventory():
            nav('map');press('.nav [data-page=inventory]')
            tab='[data-loadout=mobile-tab][data-screen=gear][data-index="1"]'
            if page.locator(tab+':visible').count():press(tab)
        def field(z):
            nav('map');press(f'.command-station[data-index="{z}"]');press('.command-deploy[data-page=raid]')
        def use(id):
            s=saved();unit=next(u for u in s['field']['bag'] if u['g']==id)
            inventory();press(f'[data-pick="{unit["uid"]}"][data-side=bag]')
            expect(page.locator(f'[data-ration-preview="{unit["uid"]}"]')).to_contain_text('급양표에 기록 가능')
            press(f'[data-gear=consume][data-unit="{unit["uid"]}"]')
            assert not any(u['uid']==unit['uid'] for u in saved()['field']['bag'])
            field(s['raid']['zone'])
        accept('scout');start();search(0);search(1);move(1);one=normal()
        assert one['commission']==20000;press('[data-raid=ack]');accept('ration-survey')
        nav('shop');press('[data-market=trader][data-id=supply]')
        for id in ('water','food'):
            press(f'[data-market=item][data-id="{id}"]');press(f'[data-cart=add][data-id="{id}"]')
        press('[data-cart=checkout]');assert saved()['wallet']==39000
        nav('stash')
        for id in ('water','food'):
            press(f'[data-stash=select][data-id="{id}"]');press(f'[data-gear=pack][data-id="{id}"]')
        start();search(0);search(1)
        for point in [1,1,2]:
            site(point);press('[data-field=scan]');settle()
        assert saved()['field']['water']==95
        use('water');assert saved()['field']['rationUses'][0]['after']==100
        move(2);use('food');rows=saved()['field']['rationUses']
        assert len(rows)==2 and sorted(row['zone'] for row in rows)==[0,2]
        page.reload(wait_until='domcontentloaded');assert saved()['field']['rationUses']==rows
        field(2);two=normal();assert two['commission']==36000 and two['missionXp']==125 and two['rationUses']
        expect(page.locator('[data-ration-receipt] summary')).to_be_visible()
        press('[data-ration-receipt] summary');expect(page.locator('[data-ration-receipt]')).to_contain_text('서로 다른 권역 합계')
        press('[data-raid=ack]');page.reload(wait_until='domcontentloaded')
        assert saved()['wallet']==75000 and saved()['career']['done'].count('ration-survey')==1 and not errors
        values=[r['after']-r['before'] for r in rows]
        print(f'PASS {width}px real={NATURAL}: earned scout in {one["elapsed"]}ms, ration sortie {two["elapsed"]}ms. '
              f'Effective water/food {values}, 50,000−11,000+36,000=75,000 CR and +125 XP once.',flush=True)
if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('widths',nargs='*',type=int);a=ap.parse_args()
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
        for width in a.widths or [390,1280]:play(browser,width)
