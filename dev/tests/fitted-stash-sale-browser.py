"""Verify a real battery, its flashlight and the warehouse and trader sales through player controls.

The original v0.20 backup has an unfitted flashlight and a separate battery inside
a named case. Disposable profiles exercise the regular equipment and sales screens.
Uses RUSTLINE_URL, RUSTLINE_CHROMIUM, RUSTLINE_PROXY and RUSTLINE_IGNORE_HTTPS_ERRORS.
"""
import argparse
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

helper=runpy.run_path(str(Path(__file__).with_name('presets-browser.py')))


def click(p,selector):
    p.locator(selector+':visible').first.click()


def unwear_light(p):
    click(p,'.nav [data-page="inventory"]')
    # An already-open slot can be reused after returning from another screen.
    if not p.locator('[data-gear="unwear"][data-slot="light"]:visible').count():
        click(p,'[data-loadout="slot"][data-slot="light"]')
    click(p,'[data-gear="unwear"][data-slot="light"]')


def go(p,page):
    url=helper['URL']+'#'+page
    if p.url==url:
        p.reload(wait_until='domcontentloaded')
    else:
        p.goto(url,wait_until='domcontentloaded')


def scenario(browser,width):
    ctx,p,errors=helper['profile'](browser,width)
    read=helper['read']
    try:
        helper['restore'](p,helper['FIXTURE'])
        helper['select_preset'](p,0)
        helper['set_slot'](p,'light','flash')
        helper['set_module'](p,'light','battery')
        helper['button'](p,'apply').click()
        assert read(p)['equipment']['modules']['light']=='battery'
        unwear_light(p)
        unit=next(u for u in read(p)['stashSlots'] if u['g']=='flash')
        serial=unit['gear']['uid']
        assert unit['gear']['module']=='battery' and read(p)['wallet']==30000
        go(p,'shop')
        click(p,'[data-market="trader"][data-id="quarter"]')
        click(p,'[data-market="mode"][data-mode="sell"]')
        click(p,f'[data-tg="stash-select"][data-uid="{unit["uid"]}"]')
        expect(p.locator('[data-tg="sell-add"]:visible')).to_be_disabled()
        go(p,'stash')
        select=f'[data-stash="select"][data-uid="{unit["uid"]}"]'
        click(p,select)
        expect(p.locator('[data-stash="sell"]:visible')).to_be_disabled()
        expect(p.locator('#stash-sale-reason')).to_contain_text('배터리')
        expect(p.locator('[data-stash="sell"]:visible')).to_have_attribute('aria-describedby','stash-sale-reason')
        click(p,'[data-stash="clear"]')
        p.reload()
        assert next(u for u in read(p)['stashSlots'] if u['g']=='flash')==unit and read(p)['wallet']==30000

        # Use the same selected physical host in the equipment and maintenance flows.
        click(p,select)
        click(p,f'[data-gear="wear-stash"][data-unit="{unit["uid"]}"]')
        go(p,'presets')
        click(p,'[data-preset="mode"][data-mode="bench"]')
        helper['set_module'](p,'light','')
        expect(p.locator('[data-preset-return="battery"]')).to_be_visible()
        helper['button'](p,'apply').click()
        assert read(p)['stash']['battery']==1
        unwear_light(p)
        clean=next(u for u in read(p)['stashSlots'] if u['g']=='flash')
        assert clean['gear']['uid']==serial and clean['gear']['module'] is None
        go(p,'stash')
        click(p,f'[data-stash="select"][data-uid="{clean["uid"]}"]')
        sale=p.locator('[data-stash="sell"]:visible')
        expect(sale).to_be_enabled();expect(sale).to_contain_text('6,000 CR')
        sale.click()
        p.reload()
        end=read(p)
        assert end['wallet']==36000 and not end['stash'].get('flash') and end['stash']['battery']==1
        assert len([u for u in end['stashSlots'] if u['g']=='battery'])==1
        assert not errors,errors
        print(f'PASS {width}px: native v20 fixture, fitted lamp rejected by trader and warehouse, cancel/reload preserves its battery and 30,000 CR; remove module, resell same host for 6,000 CR, one loose battery + 36,000 CR after reload.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('widths',nargs='*',type=int)
    args=parser.parse_args()
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw, pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in args.widths or (390,1280):
            scenario(browser,width)
