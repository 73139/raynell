"""Verify both purchase paths on the packaged offline game using a synthetic full cash grid."""
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1/paid-cells-offline/'
KEY = 'rl-reboot-session-v36'

def snapshot(page):
    return page.evaluate('key=>JSON.parse(localStorage.getItem(key))', KEY)

def test(browser, html, width, cart):
    with browser.new_context(viewport={'width': width,'height': 844},has_touch=width == 390,
                             reduced_motion='reduce',offline=True,service_workers='block') as ctx:
        denied=[]
        def only_packaged(route):
            if route.request.method == 'GET' and route.request.url == URL:
                return route.fulfill(body=html,content_type='text/html; charset=utf-8')
            denied.append(route.request.url)
            return route.abort()
        ctx.route('**/*', only_packaged)
        p=ctx.new_page()
        p.goto(URL+'#shop')
        p.wait_for_function('key=>!!localStorage.getItem(key)',arg=KEY)
        # Establish a valid local fixture. Purchases, receipts, stash views and reload use normal controls.
        p.evaluate('''key=>{
          const s=JSON.parse(localStorage.getItem(key));
          s.cash.pocket=[]; s.stash={cr_notes:192};
          s.stashSlots=Array.from({length:192},(_,i)=>({uid:'s-paid-browser-'+i,g:'cr_notes',
            amount:i===191?29809:1,x:i%6,y:Math.floor(i/6),w:1,h:1,revealed:true}));
          localStorage.setItem(key,JSON.stringify(s));
        }''',KEY)
        p.reload();p.locator('[data-market=item][data-id=water]:visible').click()
        if cart:
            p.locator('[data-cart=add][data-id=water]:visible').click()
            pay=p.locator('[data-cart=checkout]:visible')
            if not pay.count():p.locator('[data-cart=open]:visible').first.click()
            expect(pay).to_be_enabled();pay.click()
            expect(p.locator('[data-cart-receipt-balance]')).to_contain_text('25,000')
            p.goto(URL+'#stash')
        else:
            p.locator('[data-market=trade][data-id=water]:visible').click()
            expect(p.locator('.mk-receipt-body')).to_contain_text('25,000')
            expect(p.locator('.mk-receipt-body')).not_to_contain_text('입고 대기 1개')
            p.locator('.mk-receipt-actions [data-page=stash]').click()
        grid=p.locator('[data-stash-grid]');expect(grid).to_be_visible()
        s=snapshot(p);units=[u for u in s['stashSlots'] if u['g']=='water'];cash=[u for u in s['stashSlots'] if u['g']=='cr_notes']
        assert len(units)==len(cash)==1 and cash[0]['amount']==25000 and s['wallet']==25000
        assert s['stash']=={'cr_notes':1,'water':1} and (units[0]['x'],units[0]['y'])==(0,0)
        tile=grid.locator(f'[data-stash=select][data-uid="{units[0]["uid"]}"]')
        expect(tile).to_be_visible();expect(p.locator('[data-uid=overflow][data-id=water]')).to_have_count(0)
        p.goto(URL+'#stash');p.reload();expect(tile).to_be_visible()
        cold=snapshot(p);assert cold['wallet']==s['wallet'] and cold['stashSlots']==s['stashSlots'] and not denied
        print(f'PASS {width}px {"cart" if cart else "single"}: 5,000 CR paid, one physical water, 25,000 CR at reload, zero network.',flush=True)

if __name__=='__main__':
    with sync_playwright() as pw:
        with pw.chromium.launch(executable_path=os.environ.get('RUSTLINE_CHROMIUM'),args=['--disable-dev-shm-usage']) as browser:
            for width in [390,1280]:
                for cart in [False,True]:test(browser,(ROOT/'index.html').read_bytes(),width,cart)
