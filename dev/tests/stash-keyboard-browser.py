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



def exercise_trade_keyboard(browser, width):
    """Keyboard-only buy, stage, cancel, select, settle; pointer/touch parity."""
    ctx = browser.new_context(viewport={'width':width,'height':844}, has_touch=width<=500,
                              reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    page = ctx.new_page()
    errors, focus_errors = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def activate(selector):
        if not page.evaluate('s => document.activeElement.matches(s)', selector):
            tab_to(page, selector)
        page.keyboard.press('Enter')
    def focus_in_order(label):
        if not page.evaluate("()=>!!document.activeElement.closest('[data-trade-pane=order]')"):
            focus_errors.append(label + ': ' + page.evaluate('()=>document.activeElement.outerHTML.slice(0,180)'))
    try:
        helpers['at'](page, 'shop')
        activate('[data-market="item"][data-id="water"]')
        activate('[data-market="quantity"][data-step="1"]')
        activate('[data-market="trade"][data-id="water"][data-qty="2"]')
        expect(page.locator('.mk-receipt-body')).to_be_visible()
        wallet, counts, units = stock(page)
        assert wallet == 20000 and counts['water'] == 2
        first, second = [u['uid'] for u in units if u['g']=='water']
        activate('[data-market="mode"][data-mode="sell"]')
        def select(uid):
            activate('[data-tg="stash-select"][data-uid="'+uid+'"]')
            expect(page.locator('.tg-unit-value')).to_contain_text('CR')
            expect(page.locator('[data-tg="sell-add"][data-uid="'+uid+'"]')).to_be_enabled()
        before = stock(page)
        select(first)
        activate('[data-tg="sell-add"][data-uid="'+first+'"]')
        focus_in_order('stage')
        assert stock(page)==before
        activate('[data-tg="sell-remove"][data-uid="'+first+'"]')
        focus_in_order('cancel')
        assert stock(page)==before
        expect(page.locator('[data-tg="sell-confirm"]')).to_be_disabled()
        select(second)
        activate('[data-tg="sell-add"][data-uid="'+second+'"]')
        activate('[data-tg="sale-select"][data-uid="'+second+'"]')
        focus_in_order('select staged item')
        total = int(''.join(c for c in page.locator('[data-sale-total]').inner_text() if c.isdigit()))
        assert total>0 and stock(page)==before
        activate('[data-tg="sell-confirm"]')
        expect(page.locator('[data-sale-receipt-total]')).to_contain_text(str(total) if total<1000 else format(total,','))
        after = stock(page)
        assert after[0]==wallet+total and after[1]['water']==1
        assert [u['uid'] for u in after[2] if u['g']=='water']==[first]
        page.reload()
        expect(page.locator('[data-market="mode"][data-mode="sell"]')).to_be_visible()
        assert stock(page)==after
        # Switch to sale if reload restored the default buy tab.
        mode=page.locator('[data-market="mode"][data-mode="sell"]')
        if mode.get_attribute('aria-pressed')!='true':
            mode.tap() if width<=500 else mode.click()
        tile=page.locator('[data-tg="stash-select"][data-uid="'+first+'"]')
        tile.tap() if width<=500 else tile.click()
        add=page.locator('[data-tg="sell-add"][data-uid="'+first+'"]')
        add.tap() if width<=500 else add.click()
        remove=page.locator('[data-tg="sell-remove"][data-uid="'+first+'"]')
        remove.tap() if width<=500 else remove.click()
        assert stock(page)==after
        assert not errors, errors
        assert not focus_errors, focus_errors
        print(f'PASS {width}px: keyboard purchase, quote, sale cancellation, exact UID settlement, reload and pointer/touch cancellation', flush=True)
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
                exercise_trade_keyboard(browser, width)
        finally:
            browser.close()
