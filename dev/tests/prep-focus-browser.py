"""Use real keyboard events to reach the existing departure button without starting a raid."""
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_bytes()
KEY = re.search(rb"const SAVE_KEY\s*=\s*['\"]([^'\"]+)", HTML)[1].decode()
LIVE = os.getenv('RUSTLINE_URL')
URL = LIVE or 'https://prep-shortcut.test/'
SHORTCUT = '[data-loadout="focus-deploy"]'
START = '.lo-prep [data-raid="start"]'


def tab_to(page, selector, limit):
    for count in range(limit + 1):
        if page.locator(selector).evaluate('element => element === document.activeElement'):
            return count
        page.keyboard.press('Tab')
    raise AssertionError(f'Could not reach {selector} in {limit} Tab presses')


def check(browser, width):
    mobile = width <= 390
    with browser.new_context(viewport={'width': width, 'height': 844}, has_touch=mobile,
                             is_mobile=mobile and browser.browser_type.name!='firefox', reduced_motion='reduce',
                             ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as context:
        if not LIVE:
            context.route(URL + '**', lambda route: route.fulfill(body=HTML, content_type='text/html;charset=utf-8'))
        page = context.new_page()
        response = page.goto(URL + '#map', wait_until='domcontentloaded', timeout=90000)
        assert response and response.ok and response.body() == HTML
        expect(page.locator('#inside')).to_have_attribute('data-page','map')
        tab_to(page, '.command-station[data-index="1"]', 14)
        page.keyboard.press('Enter')
        tab_to(page, '.command-deploy[data-page="prep"]', 12)
        page.keyboard.press('Enter')

        def save():
            return page.evaluate('key => JSON.parse(localStorage.getItem(key))', KEY)

        def reach_departure():
            taps = tab_to(page, SHORTCUT, 6)
            jump = page.get_by_role('button', name='출격 시작 버튼으로 이동', exact=True)
            expect(jump).to_be_focused()
            assert jump.evaluate("""n=>{const r=n.getBoundingClientRect();
                return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}""")
            state, address = save(), page.url
            page.keyboard.press('Enter')
            expect(page.locator(START)).to_be_focused()
            assert page.url == address and save() == state
            assert page.locator(START).evaluate("""n=>{const r=n.getBoundingClientRect();
                return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}""")
            return taps

        # Bypass leaves the inventory and the selected region unchanged.
        tabs = reach_departure()
        # The normal forward and reverse sequence after landing is still usable.
        page.keyboard.press('Tab')
        expect(page.locator('.lo-actions [data-page="map"]')).to_be_focused()
        page.keyboard.press('Shift+Tab')
        expect(page.locator(START)).to_be_focused()
        if mobile:
            page.locator('[data-loadout="mobile-tab"][data-screen="prep"][data-index="1"]').tap()
            expect(page.locator(START)).to_be_hidden()
            page.locator('.nav [data-page="map"]').tap()
            page.locator('.command-deploy').tap()
            expect(page.locator(START)).to_be_hidden()
            reach_departure()
            expect(page.locator('[data-screen="prep"][data-index="2"]')).to_have_attribute('aria-pressed','true')
        # Only a second Enter on the existing real departure button commits a raid.
        page.keyboard.press('Enter')
        expect(page.locator('#inside')).to_have_attribute('data-page','raid')
        state=save()
        assert state['raid']['zone']==1 and state['wallet']==30000
        expect(page.locator(SHORTCUT)).to_have_count(0)
        print(f'PASS {width}px: {tabs} Tab presses to shortcut, one Enter moves focus with exact save and URL unchanged, separate Enter starts original selected checkpoint raid.',flush=True)


if __name__=='__main__':
    proxy=os.getenv('RUSTLINE_PROXY')
    with sync_playwright() as playwright, playwright.chromium.launch(
            executable_path=os.getenv('RUSTLINE_CHROMIUM') or None,
            proxy={'server':proxy} if proxy else None) as browser:
        for size in (390,1280):
            check(browser,size)
