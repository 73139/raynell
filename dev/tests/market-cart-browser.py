"""RL-TC01 cart acceptance (introduced in v0.28). Run after python3 build.py.

python3 tests/market-cart-browser.py
python3 tests/market-cart-browser.py 390 --natural

All interactions use isolated Chromium profiles. The storage quota barrier, stale
button and the 190/192-cell layout are explicit failure fixtures. The original
v27 JSON was exported from that release after ordinary UI purchases and packing.
Set RUSTLINE_URL to run the same tests on the canonical public deployment.
"""
import argparse
import copy
import json
import os
import runpy
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
shared = runpy.run_path(str(ROOT/'tests/survivor-browser.py'))
at, snapshot = shared['at'], shared['snapshot']
KEY = 'rl-reboot-session-v35'
V27 = ROOT/'tests/fixtures/market-cart-v27.json'
PRICES = {'bandage':4500, 'gauze':4000}
NAMES = {'bandage':'구급 붕대', 'gauze':'멸균 거즈'}


def profile(browser, width, natural=False):
    ctx, page, errors = shared['profile'](browser,width,wall=natural)
    at(page,'cart')
    expect(page.locator('[data-cart-panel]')).to_be_visible()
    return ctx,page,errors


def trader(p, name='medic'):
    control=p.locator(f'[data-market="trader"][data-id="{name}"]')
    control.click()
    expect(control).to_have_attribute('aria-pressed','true')


def button(p, action):
    return p.locator(f'[data-cart="{action}"]:visible').first


def add(p,item,quantity=1):
    p.locator(f'[data-market="item"][data-id="{item}"]:visible').click()
    for _ in range(quantity-1):
        p.locator('[data-market="quantity"][data-step="1"]:visible').click()
    button(p,'add').click()


def cart(p, merchant='medic'):
    return snapshot(p)['marketCarts']['traders'].get(merchant,{})


def items(p,merchant='medic'):
    return {l['item']:l['quantity'] for l in cart(p,merchant).get('items',[])}


def medical_order(p):
    trader(p)
    add(p,'bandage',2)
    add(p,'gauze')
    assert items(p)=={'bandage':2,'gauze':1}


def figures(p, balance=17000):
    for item,qty in [('bandage',2),('gauze',1)]:
        row=p.locator(f'[data-cart-line="{item}"]')
        expect(row).to_be_visible()
        expect(row).to_contain_text(NAMES[item])
        expect(row).to_contain_text(f'{PRICES[item]:,}')
        expect(row).to_contain_text(f'{PRICES[item]*qty:,}')
    expect(p.locator('[data-cart-total]:visible').first).to_contain_text('13,000')
    if balance>=0:
        expect(p.locator('[data-cart-balance]:visible').first).to_contain_text(f'{balance:,}')


def stock(s):
    return s['wallet'],s['stash'],s['stashSlots'],s.get('gearOverflow',[])


def receipt(p, balance=17000):
    s=snapshot(p)
    r=cart(p)['receipt']
    assert not items(p) and r['trader']=='medic' and r['total']==13000 and r['balance']==balance
    assert r['before']==balance+13000 and r['quantity']==3
    assert {l['item']:(l['quantity'],l['unit'],l['total']) for l in r['lines']}=={
        'bandage':(2,4500,9000),'gauze':(1,4000,4000)}
    panel=p.locator('[data-cart-receipt]')
    expect(panel).to_be_visible()
    expect(panel).to_contain_text('13,000')
    expect(panel).to_contain_text(f'{balance:,}')
    for item,subtotal in [('bandage',9000),('gauze',4000)]:
        row=panel.locator(f'[data-cart-receipt-line="{item}"]')
        expect(row).to_contain_text(NAMES[item])
        expect(row).to_contain_text(f'{subtotal:,}')
    assert s['wallet']==balance
    return r


def copy_session(browser,page,width,folder,name):
    data=shared['export_profile'](page,folder/(name+'.json'))
    ctx,other,errors=profile(browser,width)
    shared['import_profile'](other,data)
    at(other,'cart')
    assert stock(snapshot(other))==stock(data['session'])
    assert snapshot(other)['marketCarts']==data['session']['marketCarts']
    return ctx,other,errors


def warehouse(p):
    stored=snapshot(p)
    at(p,'stash')
    for item,qty in [('bandage',2),('gauze',1)]:
        p.locator('#pos-query').fill(NAMES[item])
        rows=p.locator('#pos-results [data-pos="locate"]')
        expect(rows).to_have_count(qty)
        tiles=[t for t in stored['stashSlots'] if t['g']==item]
        assert len(tiles)==qty
        for t in tiles:
            loc=rows.and_(p.locator(f'[data-key="stash:{t["uid"]}:{item}"]'))
            expect(loc).to_have_attribute('data-kind','stash')
            expect(loc).to_contain_text(f'창고 {t["y"]+1}행 {t["x"]+1}열')
        rows.first.click()
        expect(p.locator('[data-stash="select"].pos-found')).to_be_visible()
    all_units=stored['stashSlots']
    assert len({t['uid'] for t in all_units})==len({(t['x'],t['y']) for t in all_units})==3
    assert stored['stash']=={'bandage':2,'gauze':1} and not stored['gearOverflow']
    return [(u['g'],u['y']+1,u['x']+1) for u in all_units]


def write_barrier(p):
    p.evaluate("""key=>{
      const original=Storage.prototype.setItem;
      window.releaseWriteBarrier=()=>{Storage.prototype.setItem=original};
      Storage.prototype.setItem=function(k,v){
        if(this===localStorage&&k===key)throw new DOMException('QA quota test','QuotaExceededError');
        return original.call(this,k,v);
      };
    }""",KEY)


def capture(p, selector, name):
    folder=os.getenv('RUSTLINE_CART_SCREENSHOTS')
    if folder:
        Path(folder).mkdir(parents=True,exist_ok=True)
        p.locator(selector).screenshot(path=str(Path(folder)/name),animations='disabled')


def fresh(browser,width,folder,natural=False):
    ctx,p,errors=profile(browser,width,natural)
    more=[]
    started=monotonic()
    try:
        assert snapshot(p)['wallet']==30000 and not snapshot(p)['stash']
        expect(p.locator('[data-cart-panel]')).to_be_focused()
        medical_order(p)
        figures(p)
        initial=stock(snapshot(p))
        token=cart(p)['token']
        assert token
        shared['fit'](p)
        capture(p,'[data-cart-panel]',f'quote-{width}.png')
        if width==390 and not natural:
            trader(p,'supply')
            add(p,'water')
            assert items(p,'supply')=={'water':1}
            assert items(p)=={'bandage':2,'gauze':1}
            trader(p)
            expect(p.locator('[data-cart-total]')).to_contain_text('13,000')
            p.reload(wait_until='domcontentloaded')
            trader(p)
            figures(p)
            assert cart(p)['token']==token
            other,copied,err=copy_session(browser,p,width,folder,'draft')
            more.append((other,err))
            trader(copied);figures(copied)
            assert items(copied,'supply')=={'water':1}
            assert cart(copied)['token']==token
            at(p,'cart');trader(p)
        if width==1280 and not natural:
            write_barrier(p)
            button(p,'checkout').click()
            expect(p.locator('[data-cart-warning]')).to_contain_text('저장')
            assert stock(snapshot(p))==initial and cart(p)['token']==token and not cart(p)['receipt']
            p.evaluate('window.releaseWriteBarrier()')
            button(p,'checkout').evaluate('b=>{window.lastCartButton=b.cloneNode(true)}')
        if width==320 and not natural:
            # Capture a payable quoted button before the same player spends the balance elsewhere.
            button(p,'checkout').evaluate('b=>{window.previousQuote=b.cloneNode(true)}')
            trader(p,'supply')
            p.locator('[data-market="item"][data-id="water"]').click()
            for _ in range(3):
                p.locator('[data-market="quantity"][data-step="1"]').click()
            p.locator('[data-market="trade"][data-id="water"]').click()
            trader(p)
            figures(p,-1)
            expect(p.locator('[data-cart-warning]')).to_contain_text('부족')
            expect(button(p,'checkout')).to_be_disabled()
            insufficient=stock(snapshot(p))
            p.evaluate("""()=>{
              const root=document.querySelector('.mk-screen');
              root.append(window.previousQuote);
              window.previousQuote.click();
              window.previousQuote.remove();
            }""")
            assert snapshot(p)['wallet']==10000 and cart(p)['token']==token and stock(snapshot(p))==insufficient
            assert items(p)=={'bandage':2,'gauze':1} and not cart(p)['receipt']
            p.locator('[data-cart-line="gauze"] [data-cart="remove"]').click()
            expect(p.locator('[data-cart-total]')).to_contain_text('9,000')
            p.locator('[data-cart-line="bandage"] [data-cart="dec"]').click()
            expect(p.locator('[data-cart-total]')).to_contain_text('4,500')
            p.locator('[data-cart-line="bandage"] [data-cart="inc"]').click()
            expect(p.locator('[data-cart-total]')).to_contain_text('9,000')
            button(p,'checkout').click()
            expect(p.locator('[data-cart-receipt]')).to_contain_text('1,000')
            assert snapshot(p)['wallet']==1000 and snapshot(p)['stash']=={'water':4,'bandage':2}
            assert cart(p)['receipt']['quantity']==2
            assert not errors,errors
            print('PASS 320px low funds after a previous valid quote: 13,000 CR basket preserved at 10,000 CR, no partial debit or deposit; removed gauze, edited quantities, 9,000 CR purchase completed at 1,000 CR.',flush=True)
            return
        if natural:
            button(p,'checkout').click()
        else:
            # Two trusted pointer click events at the same checkout coordinates.
            button(p,'checkout').dblclick(delay=55)
        order=receipt(p)
        assert order['token']==token
        capture(p,'[data-cart-receipt]',f'receipt-{width}.png')
        if width==1280 and not natural:
            add(p,'gauze')
            newer=cart(p)['token']
            assert newer and newer!=token
            before=stock(snapshot(p))
            p.evaluate("""()=>{
              const root=document.querySelector('.mk-screen');
              root.append(window.lastCartButton);
              window.lastCartButton.click();
              window.lastCartButton.remove();
            }""")
            assert stock(snapshot(p))==before and cart(p)['token']==newer and items(p)=={'gauze':1}
        if width==390 and not natural:
            ctx2,restored,err=copy_session(browser,p,width,folder,'paid')
            more.append((ctx2,err))
            trader(restored);receipt(restored)
            assert items(restored,'supply')=={'water':1}
            at(p,'cart');trader(p);receipt(p)
        coords=warehouse(p)
        assert not errors and all(not e for _,e in more),(errors,more)
        print(f'PASS {width}px {"real clock and game RNG" if natural else "UI checkout"}: 2 bandages at 4,500 CR, gauze at 4,000 CR; 13,000 CR paid, 17,000 CR remain, 3 unique physical UIDs located in warehouse {coords}. {monotonic()-started:.1f}s.',flush=True)
    finally:
        for context,_ in more:context.close()
        ctx.close()


def legacy(browser):
    data=json.loads(V27.read_text())
    old=data['session']
    ctx,p,errors=profile(browser,390)
    try:
        shared['import_profile'](p,data)
        at(p,'cart')
        assert snapshot(p)['version']==35
        for key in ['wallet','equipment','stash','stashSlots','injuryState','gearOverflow']:
            assert snapshot(p)[key]==old[key],key
        assert not items(p)
        medical_order(p);figures(p,8000)
        button(p,'checkout').click()
        receipt(p,8000)
        s=snapshot(p)
        assert s['stash']=={'bandage':2,'gauze':2}
        assert s['stashSlots'][0]==old['stashSlots'][0]
        assert s['equipment']['bag']==old['equipment']['bag']
        at(p,'map')
        expect(p.locator('[data-weather-zone="2"] [data-cui="weather-select"]')).to_have_attribute('aria-pressed','true')
        assert not errors,errors
        print('PASS genuine v27 UI export: 21,000 CR, existing gauze UID/position, packed water and preselected warehouse sector retained. Restored cart paid 13,000 CR, leaving 8,000 CR and four physical warehouse units.',flush=True)
    finally:ctx.close()


def near_capacity(browser):
    # Generate a controlled full-size boundary layout from the genuine previous-version export.
    data=copy.deepcopy(json.loads(V27.read_text()))
    s=data['session']
    s['stash']={'cloth':190}
    s['stashSlots']=[{'uid':f's-capacity-{n}','g':'cloth','x':n%6,'y':n//6,'w':1,'h':1} for n in range(190)]
    ctx,p,errors=profile(browser,390)
    try:
        shared['import_profile'](p,data)
        at(p,'cart')
        medical_order(p)
        before=stock(snapshot(p));token=cart(p)['token']
        assert len(before[2])==190
        expect(button(p,'checkout')).to_be_disabled()
        expect(p.locator('[data-cart-warning]')).to_contain_text('창고')
        # Exercise the commit-time preflight independently of the disabled-button affordance.
        button(p,'checkout').evaluate('b=>{b.disabled=false;b.click()}')
        assert stock(snapshot(p))==before and not cart(p)['receipt']
        assert cart(p)['token']==token and items(p)=={'bandage':2,'gauze':1}
        trader(p,'supply')
        p.locator('[data-market="mode"][data-mode="sell"]').click()
        unit=p.locator('[data-tg="stash-select"][data-trade-item="cloth"]').first
        unit.click()
        p.locator('[data-tg="sell-add"]:visible').click()
        p.locator('[data-tg="sell-confirm"]:visible').click()
        p.locator('[data-market="mode"][data-mode="buy"]').click()
        trader(p);figures(p,8900)
        assert cart(p)['token']==token
        survivors=snapshot(p)['stashSlots']
        button(p,'checkout').click();receipt(p,8900)
        new=snapshot(p)
        assert new['stash']=={'cloth':189,'bandage':2,'gauze':1} and len(new['stashSlots'])==192
        assert all(t in new['stashSlots'] for t in survivors) and not new['gearOverflow']
        assert not errors,errors
        print('PASS controlled 190/192 occupied grid: two empty cells for three goods kept all credits, 190 UIDs and the full order. Sold one cloth, paid the same 13,000 CR, filled all 192 grid cells, 8,900 CR remaining, zero overflow.',flush=True)
    finally:ctx.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('widths',type=int,nargs='*')
    parser.add_argument('--natural',action='store_true')
    parser.add_argument('--legacy',action='store_true')
    parser.add_argument('--capacity',action='store_true')
    args=parser.parse_args()
    with sync_playwright() as w, TemporaryDirectory() as folder:
        settings={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if os.getenv('RUSTLINE_CHROMIUM'):settings['executable_path']=os.environ['RUSTLINE_CHROMIUM']
        if os.getenv('RUSTLINE_PROXY'):settings['proxy']={'server':os.environ['RUSTLINE_PROXY']}
        browser=w.chromium.launch(**settings)
        try:
            if not(args.legacy or args.capacity):
                for width in args.widths or ([390] if args.natural else [390,320,1280]):
                    fresh(browser,width,Path(folder),args.natural)
            if args.legacy or (not args.widths and not args.natural and not args.capacity):legacy(browser)
            if args.capacity or (not args.widths and not args.natural and not args.legacy):near_capacity(browser)
        finally:browser.close()
