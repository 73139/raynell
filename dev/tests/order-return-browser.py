"""Accept/cancel an order, recover a failed return and inspect the saved cash receipt in Chromium."""
import os
import re
import runpy
import shutil
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / 'tests/survivor-browser.py'))
URL = os.getenv('RUSTLINE_URL') or 'https://rustline-order.test/'
KEY = helpers['KEY']


def play(browser, width):
    touch = width < 600
    with browser.new_context(viewport={'width': width, 'height': 860}, has_touch=touch,
                             reduced_motion='reduce',
                             ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as ctx:
        if not os.getenv('RUSTLINE_URL'):
            ctx.route(URL+'**', lambda route: route.fulfill(
                body=(ROOT/'index.html').read_bytes(), content_type='text/html; charset=utf-8'))
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(10000)
        page.set_default_navigation_timeout(60000)
        page.clock.install()

        def click(selector, tab=page):
            item = tab.locator(selector + ':visible').first
            item.tap() if touch else item.click()

        def snapshot():
            return helpers['snapshot'](page)

        page.goto(URL+'#quests')
        click('[data-page=orders]')
        click('[data-bui=order][data-id=tower-wire]')
        order = '[data-order=tower-wire]'
        helpers['deny_next_write'](page)
        click(order)
        expect(page.locator(order)).to_have_text('의뢰 수락')
        expect(page.locator('.bu-screen [role=status]').last).to_contain_text('저장')
        assert snapshot()['career']['order'] is None
        click(order)
        click('[data-objective=pin][data-id=tower-wire]')
        pin = snapshot()['objectivePin']
        assert snapshot()['career']['order']=='tower-wire' and pin['id']=='tower-wire'
        helpers['deny_next_write'](page)
        click(order)
        expect(page.locator(order)).to_have_text('수락 취소')
        assert snapshot()['objectivePin']==pin

        observer = ctx.new_page()
        observer.on('pageerror', lambda error: errors.append(str(error)))
        observer.goto(URL+'#quests')
        expect(observer.locator('html')).to_have_class(re.compile(r'\bread-only\b'))
        before_observer=helpers['snapshot'](observer)
        click('[data-page=orders]', observer)
        # The second tab blocks all button input before navigation. The writer's
        # order and pin must still be intact after the observer tries to act.
        expect(observer.locator('.bu-order-list')).to_have_count(0)
        assert helpers['snapshot'](observer)==before_observer
        assert before_observer['career']['order']=='tower-wire' and before_observer['objectivePin']==pin
        click(order)
        expect(page.locator(order)).to_have_text('의뢰 수락')
        assert helpers['snapshot'](observer)['career']['order'] is None
        observer.close()
        assert snapshot()['career']['order'] is None and snapshot()['objectivePin'] is None

        # Start with the real wallet and move 1,000 CR to the pack using the game's controls.
        page.goto(URL+'#stash')
        click('[data-cash=select][data-cash-area=pocket]')
        page.locator('[data-cash-amount]').fill('1000')
        click('[data-cash=move][data-to=bag]')
        assert snapshot()['wallet']==29000
        page.goto(URL+'#map')
        click('.command-deploy[data-page=prep]')
        click('[data-raid=start]')
        click('[data-field=extract][data-exit=b04]')
        page.clock.fast_forward(12000)
        expect(page.locator('.result-panel')).to_contain_text('휴대 지폐 회수')
        paid = snapshot()
        assert paid['wallet']==30000 and paid['career']['history'][0]['cash']==1000
        helpers['deny_next_write'](page)
        click('[data-raid=ack]')
        expect(page.locator('.result-panel [role=status]')).to_contain_text('다시 시도')
        assert snapshot()==paid
        click('[data-raid=ack]')
        assert snapshot()['raid'] is None
        if not page.locator('[data-page=journal]:visible').count():
            click('[data-page=more]')
        click('[data-page=journal]')
        click('[data-bui=history][data-index="0"]')
        expect(page.locator('.bu-log-detail')).to_contain_text('정산 시 지갑 변동 +1,000 CR')
        expect(page.locator('.bu-log-detail')).to_contain_text('휴대 지폐 회수 1,000 CR')
        page.reload()
        restored = snapshot()
        assert restored['wallet']==30000 and restored['career']['sorties']==1
        assert restored['career']['history']==paid['career']['history']
        assert not errors, errors
        print(f'PASS {width}px {("touch" if touch else "mouse")}: acceptance, pinned cancellation, read-only tab, cash recovery, failed acknowledgement, retry, itemized receipt and reload', flush=True)


if __name__=='__main__':
    options = {'executable_path': os.getenv('RUSTLINE_CHROMIUM') or shutil.which('chromium'),
               'args':['--no-sandbox','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_PROXY'):
        options['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as api, api.chromium.launch(**options) as browser:
        for width in (390,1280):
            play(browser,width)
