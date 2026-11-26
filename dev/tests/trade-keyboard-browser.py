"""Exercise keyboard focus in grid sales. Test widths and public URL are configurable.

Once the sale tab is open, reach the second warehouse bandage with actual Tab events.
Separate keyboard and pointer interactions use disposable browser storage.
"""
import argparse
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

tests=Path(__file__).resolve().parent
helpers=runpy.run_path(str(tests/'market-cart-browser.py'))
shared=helpers['shared']


def tab_to(page,selector):
    for _ in range(120):
        page.keyboard.press('Tab')
        if page.evaluate('selector=>document.activeElement.matches(selector)',selector):
            return
    raise AssertionError(f'Tab did not reach {selector}')


def case(browser,width):
    ctx,p,errors=shared['profile'](browser,width,wall=True)
    try:
        helpers['at'](p,'shop')
        helpers['trader'](p,'medic')
        helpers['add'](p,'bandage',2)
        p.locator('[data-cart="checkout"]').click()
        p.locator('[data-market="mode"][data-mode="sell"]').click()
        units=[tile for tile in shared['snapshot'](p)['stashSlots'] if tile['g']=='bandage']
        first,second=units
        def sel(uid):return f'[data-tg="stash-select"][data-uid="{uid}"]'
        def add(uid):return f'[data-tg="sell-add"][data-uid="{uid}"]'
        tab_to(p,sel(second['uid']))
        p.keyboard.press('Enter')
        expect(p.locator(add(second['uid']))).to_be_focused()
        assert shared['snapshot'](p)['wallet']==21000
        p.keyboard.press('Enter')
        expect(p.locator('[data-trade-pane="order"]')).to_be_focused()
        expect(p.locator(f'[data-tg="sale-select"][data-uid="{second["uid"]}"]')).to_have_count(1)
        assert shared['snapshot'](p)['wallet']==21000
        tab_to(p,'[data-tg="sell-confirm"]')
        p.keyboard.press('Enter')
        expect(p.locator('[data-sale-notice]')).to_be_focused()
        expect(p.locator('[data-sale-notice]')).to_contain_text('2,250 CR')
        saved=shared['snapshot'](p)
        assert saved['wallet']==23250 and [u for u in saved['stashSlots'] if u['g']=='bandage']==[first]
        # Pointer selection and confirmation should not inherit the keyboard-only focus handoff.
        p.locator(sel(first['uid'])).click()
        expect(p.locator(add(first['uid']))).not_to_be_focused()
        p.locator(add(first['uid'])).click()
        assert shared['snapshot'](p)['wallet']==23250
        if width>850:expect(p.locator('[data-trade-pane="order"]')).not_to_be_focused()
        p.locator('[data-tg="sell-confirm"]').click()
        expect(p.locator('[data-sale-notice]')).not_to_be_focused()
        final=shared['snapshot'](p)
        assert final['wallet']==25500 and not any(u['g']=='bandage' for u in final['stashSlots'])
        assert not errors,errors
        print(f'PASS {width}px: Tab → second UID, Enter → its staging button, Enter → review with 21,000 CR intact; separate confirmation → focused 2,250 CR sale result and 23,250 CR. Pointer selection and settlement bypass keyboard-only focus and end at 25,500 CR.',flush=True)
    finally:ctx.close()


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('widths',nargs='*',type=int)
    args=cli.parse_args()
    launch={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):launch['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):launch['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as w:
        b=w.chromium.launch(**launch)
        try:
            for width in args.widths or [1280,390,320]:case(b,width)
        finally:b.close()
