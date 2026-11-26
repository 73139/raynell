"""Use normal merchant controls and physical CR on the local build or RUSTLINE_URL."""
import argparse
import os
import runpy
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
trade=runpy.run_path(str(ROOT/'tests/trade-grid-browser.py'))
shared,cart=trade['shared'],trade['previous']
at,snapshot=shared['at'],shared['snapshot']


def register(p):
    p.locator('[data-market="mode"][data-mode="sell"]').click()


def receipt(p):
    panel=p.locator('[data-sale-receipt]')
    expect(panel).to_be_visible()
    expect(panel.locator('[data-sale-receipt-line="bandage"]')).to_contain_text('2,250 CR × 2개')
    expect(panel.locator('[data-sale-receipt-line="bandage"] strong')).to_contain_text('4,500')
    expect(panel.locator('[data-sale-receipt-line="gauze"]')).to_contain_text('2,000 CR × 1개')
    expect(panel.locator('[data-sale-receipt-total]')).to_contain_text('6,500')
    expect(panel.locator('[data-sale-receipt-balance]')).to_contain_text('23,500')
    expect(panel).to_contain_text('17,000')
    shared['fit'](p)


def test(browser,width,folder):
    ctx,p,errors=shared['profile'](browser,width,wall=True)
    other=None
    try:
        at(p,'cart')
        cart['medical_order'](p)
        p.locator('[data-cart="checkout"]').click()
        paid=snapshot(p)
        assert trade['physical'](paid)==17000
        register(p)
        expect(p.locator('[data-sale-receipt]')).to_have_count(0)
        for i,unit in enumerate(paid['stashSlots']):
            if unit['g']=='cr_notes':continue
            src=trade['grid'](p,'stash').locator(f'[data-uid="{unit["uid"]}"]')
            if width>=1000:
                trade['drag_at'](src,trade['grid'](p,'sale'),i,1)
            else:
                src.click()
                p.locator('[data-tg="sell-add"]').click()
        expect(p.locator('[data-sale-total]')).to_contain_text('6,500')
        p.locator('[data-tg="sell-confirm"]').click()
        receipt(p)
        state=snapshot(p)
        assert trade['physical'](state)==23500 and not state['stash']
        assert state['marketCarts']['traders']['medic']['receipt']==paid['marketCarts']['traders']['medic']['receipt']
        sale=state['saleReceipts']['medic']
        assert sorted(uid for line in sale['lines'] for uid in line['uids'])==sorted(u['uid'] for u in paid['stashSlots'] if u['g']!='cr_notes')
        cart['trader'](p,'supply');register(p)
        expect(p.locator('[data-sale-receipt]')).to_have_count(0)
        cart['trader'](p,'medic');register(p);receipt(p)
        p.reload(wait_until='domcontentloaded')
        cart['trader'](p,'medic');register(p);receipt(p)
        if width==390:
            payload=shared['export_profile'](p,folder/'sale.json')
            other,p2,errs=shared['profile'](browser,width,wall=True)
            shared['import_profile'](p2,payload)
            at(p2,'cart');cart['trader'](p2,'medic');register(p2);receipt(p2)
            assert snapshot(p2)['saleReceipts']['medic']==sale and trade['physical'](snapshot(p2))==23500
            assert not errs,errs
        assert not errors,errors
        print(f'PASS {width}px: 3 physical goods bought and sold; grouped at 2,250 and 2,000 CR, receipt 6,500, post-sale cash 23,500; merchant isolation and reload.'+
              (' Includes separate profile JSON restoration.' if width==390 else ''),flush=True)
    finally:
        ctx.close()
        if other:other.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('widths',nargs='*',type=int)
    args=parser.parse_args()
    opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}
    if os.getenv('RUSTLINE_CHROMIUM'):opts['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):opts['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as w,TemporaryDirectory() as tmp:
        browser=w.chromium.launch(**opts)
        try:
            for width in args.widths or [1280,390,320]:test(browser,width,Path(tmp))
        finally:browser.close()
