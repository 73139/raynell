"""Check warehouse keyboard navigation through real shopping, placement and persistence.

Run after build.py. RUSTLINE_URL, RUSTLINE_CHROMIUM, RUSTLINE_PROXY and
RUSTLINE_IGNORE_HTTPS_ERRORS are optional. All browser profiles are disposable.
"""
import argparse
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

helpers = runpy.run_path(str(Path(__file__).with_name('survivor-browser.py')))
snapshot = helpers['snapshot']
area = '[data-scroll-key="warehouse-grid"]'


def tab_to(page, selector):
    for _ in range(70):
        page.keyboard.press('Tab')
        if page.evaluate('s => document.activeElement.matches(s)', selector):
            return
    raise AssertionError(f'Could not reach {selector} with Tab')


def slot(page, x, y):
    return page.locator(f'[data-stash="place"][data-x="{x}"][data-y="{y}"]')


def stock(page):
    state = snapshot(page)
    return state['wallet'], state['stash'], state['stashSlots']


def exercise(browser, width):
    ctx = browser.new_context(viewport={'width':width,'height':844}, has_touch=width<=500,
                              reduced_motion='reduce', ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        helpers['at'](page, 'shop')
        page.locator('[data-market="item"][data-id="water"]:visible').click()
        page.locator('[data-market="quantity"][data-step="1"]:visible').click()
        page.locator('[data-market="trade"][data-id="water"][data-qty="2"]:visible').click()
        page.locator('.mk-receipt-actions [data-page="stash"]').click()
        wallet, counts, units = stock(page)
        assert wallet == 20000 and counts['water'] == 2
        first, second = units
        assert first['g'] == second['g'] == 'water' and first['y'] == second['y'] == 0
        tile = page.locator(f'[data-stash="select"][data-uid="{first["uid"]}"]')
        before = stock(page)
        tab_to(page, area)
        page.keyboard.press('Tab')
        expect(tile).to_be_focused(timeout=1200)
        page.keyboard.press('Enter')
        expect(tile).to_be_focused()
        expect(tile).to_have_attribute('aria-pressed', 'true')

        # Aim at an occupied location. Arrow keys just move focus, even over an item.
        for _ in range(second['x'] - first['x']):
            page.keyboard.press('ArrowRight')
        dest = slot(page, second['x'], second['y'])
        expect(dest).to_be_focused()
        assert stock(page) == before
        page.keyboard.press('Enter')
        expect(page.locator('.stash-message')).to_contain_text('들어가지 않습니다')
        expect(dest).to_be_focused()
        assert stock(page) == before

        for _ in range(9):
            page.keyboard.press('ArrowDown')
        dest = slot(page, second['x'], 9)
        expect(dest).to_be_focused()
        # The destination is inside the scroll viewport after traversing it.
        assert dest.evaluate("""el=>{
          const r=el.getBoundingClientRect(), v=el.closest('.stash-scroll').getBoundingClientRect();
          return r.top>=v.top-1 && r.bottom<=v.bottom+1;
        }""")
        assert stock(page) == before
        page.keyboard.press('Enter')
        expect(page.locator('.stash-message')).to_contain_text('배치 완료')
        expect(page.locator(area)).to_be_focused()
        result = stock(page)
        moved = dict(first, x=second['x'], y=9)
        assert result == (wallet, counts, [moved, second])
        page.reload()
        page.locator('.mc-head-actions [data-page="stash"]').click()
        expect(page.locator('[data-stash-grid]')).to_be_visible()
        assert stock(page) == result

        # Regular clicks still select and place a physical instance on the same board.
        if width<=500:
            tile.tap()
            slot(page, 4, 12).tap()
        else:
            tile.click()
            slot(page, 4, 12).click()
        assert stock(page) == (wallet, counts, [dict(first, x=4, y=12), second])

        # External selections such as a split cash stack can enter the board at its origin.
        cash = page.locator('[data-cash="select"][data-cash-area="pocket"]').first
        cash.click()
        page.locator('[data-cash-amount]').fill('125')
        tab_to(page, area)
        page.keyboard.press('ArrowDown')
        expect(slot(page, 0, 0)).to_be_focused()
        assert not any(u['g']=='cr_notes' for u in stock(page)[2])
        page.keyboard.press('Enter')
        moved_cash = [u for u in stock(page)[2] if u['g']=='cr_notes']
        assert len(moved_cash)==1 and (moved_cash[0]['x'], moved_cash[0]['y'], moved_cash[0]['amount'])==(0,0,125)
        assert stock(page)[0] == wallet and stock(page)[1]['water'] == 2
        assert not errors, errors
        print(f'PASS {width}px: 1 Tab to owned water, collision refused, 9 rows by arrow and Enter moves one UID; reload, pointer placement and split 125 CR preserve stock and wallet.', flush=True)
    finally:
        ctx.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('widths', nargs='*', type=int)
    args = parser.parse_args()
    launch = {'args':['--no-sandbox','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy'] = {'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch)
        try:
            for width in args.widths or [390,1280]:
                exercise(browser, width)
        finally:
            browser.close()
