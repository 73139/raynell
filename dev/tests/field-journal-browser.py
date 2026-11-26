"""Explore the public-facing map as a new player, without importing any save."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

HTML = (Path(__file__).resolve().parents[1] / 'index.html').read_bytes()
LIVE = os.getenv('RUSTLINE_URL')
URL = LIVE or 'https://rustline-survey.test/'
KEY = 'rl-reboot-session-v36'
NATURAL = os.getenv('RUSTLINE_JOURNAL_NATURAL') == '1'

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
        def journal(zone, total, recorded):
            page.goto(URL + '#map', wait_until='domcontentloaded')
            press(f'.command-station[data-index="{zone}"]')
            panel = page.locator(f'[data-survey-journal="{zone}"]')
            expect(panel.locator('summary')).to_contain_text(f'{len(recorded)} / {total}개')
            if not panel.evaluate('e => e.open'):
                summary = panel.locator('summary')
                if mobile:
                    summary.tap()
                else:
                    summary.focus()
                    page.keyboard.press('Enter')
            expect(panel.locator('[data-survey-box]')).to_have_count(total)
            expect(panel.locator('[data-recorded=true]')).to_have_count(len(recorded))
            expect(panel.locator('.survey-access')).to_have_count(1)
            expect(panel.locator('.survey-access')).to_contain_text('필요')
            for key in recorded:
                expect(panel.locator(f'[data-survey-box="{key}"]')).to_contain_text('기록 완료')
            assert panel.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        def start(zone):
            page.goto(URL + '#map', wait_until='domcontentloaded')
            press(f'.command-station[data-index="{zone}"]')
            press('.command-deploy[data-page=prep]')
            press('.lo-deploy[data-raid=start]')
        def search(zone, index):
            move(zone)
            assert saved()['field']['landmarkByZone'][zone] == 0
            selector = f'[data-field=open][data-index="{index}"]'
            for _ in range(6):
                if page.locator(selector + ':visible').count():
                    break
                press('[data-field=scan]')
                settle()
            press(selector)
            tab = '[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
            if page.locator(tab + ':visible').count():
                press(tab)
            press('.lo-search[data-field=search]')
            settle()
            assert saved()['field']['boxes'][f'{zone}-{index}']['complete']
            press('[data-field=close]')
        def extract():
            move(0)
            press('[data-field=extract][data-exit=b04]')
            settle()
            return saved()['lastSummary']
        journal(0, 20, [])
        journal(1, 16, [])
        journal(2, 10, [])
        start(0)
        search(0, 0)
        assert not saved()['career'].get('surveyedBoxes')
        one = extract()
        assert one['rating'] == 'quick' and one['newSurveyBoxes'] == ['0-0']
        expect(page.locator('[data-survey-return] summary')).to_contain_text('1개')
        press('[data-raid=ack]')
        start(1)
        search(1, 0)
        search(0, 0)
        two = extract()
        assert two['rating'] == 'success' and two['newSurveyBoxes'] == ['1-0']
        press('[data-raid=ack]')
        page.reload(wait_until='domcontentloaded')
        assert saved()['career']['surveyedBoxes'] == ['0-0', '1-0']
        journal(0, 20, ['0-0'])
        journal(1, 16, ['1-0'])
        folder = os.getenv('RUSTLINE_JOURNAL_SHOTS')
        if folder:
            Path(folder).mkdir(exist_ok=True, parents=True)
            page.locator('[data-survey-journal="1"]').screenshot(path=str(Path(folder) / f'checkpoint-{width}.png'))
        journal(2, 10, [])
        assert not errors, errors
        print('PASS',json.dumps({'width':width,'realClock':NATURAL,'host':urlsplit(URL).netloc,'elapsedMs':[one['elapsed'],two['elapsed']],
              'locations':saved()['career']['surveyedBoxes'],'sha256':hashlib.sha256(HTML).hexdigest()},ensure_ascii=False),flush=True)

if __name__ == '__main__':
    proxy = {'server':os.environ['HTTPS_PROXY']} if LIVE and 'HTTPS_PROXY' in os.environ else None
    with sync_playwright() as pw, pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in (390,1280):
            play(browser,width)
