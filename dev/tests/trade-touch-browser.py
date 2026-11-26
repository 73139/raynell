"""Chromium mobile touch emulation (CDP Input.dispatchTouchEvent), responsive widths 320 and 390.
Uses fresh game profiles and wall time. RUSTLINE_URL, RUSTLINE_CHROMIUM and RUSTLINE_PROXY are optional.
"""
import argparse
import os
import re
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = urldefrag(os.getenv('RUSTLINE_URL') or (ROOT/'index.html').as_uri()).url
KEY = 'rl-reboot-session-v36'


def center(tile):
    tile.evaluate("el=>el.scrollIntoView({behavior:'instant',block:'center',inline:'center'})")
    bounds = tile.bounding_box()
    return bounds['x']+bounds['width']/2, bounds['y']+bounds['height']/2


def finger(cdp, kind, x=0, y=0):
    points = [] if kind in ['touchEnd','touchCancel'] else [{'x':x, 'y':y, 'id':1, 'radiusX':4, 'radiusY':4}]
    cdp.send('Input.dispatchTouchEvent', {'type':kind, 'touchPoints':points})


def hold_and_drop(page, cdp, tile, target, cancel=False):
    x,y = center(tile)
    finger(cdp,'touchStart',x,y)
    tray = page.locator(f'[data-touch-drop="{target}"]')
    expect(tray).to_be_visible(timeout=2500)
    if cancel:
        finger(cdp,'touchCancel')
    else:
        bounds = tray.bounding_box()
        end_x,end_y = bounds['x']+bounds['width']*.65,bounds['y']+bounds['height']*.5
        for part in [.1,.3,.6,1]:
            finger(cdp,'touchMove',x+(end_x-x)*part,y+(end_y-y)*part)
        expect(tray).to_have_class(re.compile('tg-touch-ready'))
        finger(cdp,'touchEnd')
    expect(tray).to_have_count(0)


def scenario(browser, width):
    ctx = browser.new_context(viewport={'width':width,'height':844}, is_mobile=True,has_touch=True,
                              device_scale_factor=1,reduced_motion='reduce',
                              ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    try:
        p = ctx.new_page();p.set_default_timeout(8000)
        errors=[];p.on('pageerror', lambda e: errors.append(str(e)))
        cdp=ctx.new_cdp_session(p)
        p.goto(URL+'#cart',wait_until='domcontentloaded',timeout=60000)
        state=lambda:p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        p.locator('[data-market="trader"][data-id="medic"]').tap()
        src=p.locator('[data-tg-drag="stock"][data-id="bandage"]')
        cart=p.locator('[data-trade-grid="cart"] [data-trade-item="bandage"]')
        at_x,at_y = center(src)
        finger(cdp,'touchStart',at_x,at_y);finger(cdp,'touchEnd')
        expect(src).to_have_attribute('aria-pressed','true')
        expect(cart).to_have_count(0)
        at_x,at_y = center(src)
        scroll=lambda:p.locator('.content').evaluate('e=>e.scrollTop')
        before=scroll()
        finger(cdp,'touchStart',at_x,at_y)
        for distance in [16,35,65,95]:
            finger(cdp,'touchMove',at_x,at_y-distance)
        finger(cdp,'touchEnd')
        p.wait_for_function("n=>Math.abs(document.querySelector('.content').scrollTop-n)>5",arg=before)
        expect(p.locator('[data-touch-drop]')).to_have_count(0)
        expect(cart).to_have_count(0)
        hold_and_drop(p,cdp,src,'cart',cancel=True)
        expect(cart).to_have_count(0)
        hold_and_drop(p,cdp,src,'cart')
        expect(cart).to_have_count(1)
        assert state()['wallet']==30000 and not state()['stash']
        p.locator('[data-cart="checkout"]').tap()
        bought=state();assert bought['wallet']==25500 and bought['stash']['bandage']==1
        uid=next(u['uid'] for u in bought['stashSlots'] if u['g']=='bandage')
        p.locator('[data-market="mode"][data-mode="sell"]').tap()
        stored=p.locator(f'[data-tg-drag="stash"][data-uid="{uid}"]')
        hold_and_drop(p,cdp,stored,'sale')
        expect(p.locator(f'[data-trade-grid="sale"] [data-uid="{uid}"]')).to_have_count(1)
        assert state()['stashSlots']==bought['stashSlots'] and state()['wallet']==25500
        p.locator('[data-tg="sell-confirm"]').tap()
        sold=state();assert sold['wallet']==27750 and not sold['stash']
        assert sum(u['amount'] for u in sold['cash']['pocket'])==27750
        expect(p.locator('[data-tg="sell-confirm"]')).to_be_disabled()
        assert not errors,errors
        print(f'PASS {width}px Chromium mobile CDP touch: short tap, scroll and cancel leave cart empty; '
              'long press → cart → 4,500 CR checkout; exact UID → sale tray → 2,250 CR separately confirmed.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widths',nargs='*',type=int)
    args=parser.parse_args()
    launch={'headless':True,'args':['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):launch['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):launch['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as w:
        browser=w.chromium.launch(**launch)
        try:
            for width in args.widths or [320,390]:scenario(browser,width)
        finally:browser.close()
