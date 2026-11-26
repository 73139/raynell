"""Goal 13 acceptance through a disposable Chromium profile, locally or via RUSTLINE_URL.

The fresh profile uses the ordinary campaign and shop controls. The medical-stage test
imports an explicitly advanced v28 campaign fixture, then pins, queues and checks out
through the game UI. The saved ledger and physical warehouse units are read back.
"""
import argparse
import copy
import json
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
helpers=runpy.run_path(str(ROOT/'tests/market-cart-browser.py'))
shared=helpers['shared']
campaign=runpy.run_path(str(ROOT/'tests/campaign-browser.py'))
at,snapshot,merchant=shared['at'],shared['snapshot'],helpers['trader']


def control(p,name,merchant_id=None):
    take=p.locator(f'[data-objective="procurement-{name}"]')
    if merchant_id is not None:
        take=take.and_(p.locator(f'[data-trader="{merchant_id}"]'))
    return take


def cart_units(save,trader):
    return {row['item']:row['quantity'] for row in save['marketCarts']['traders'].get(trader,{}).get('items',[])}


def picture(p,width):
    directory=os.getenv('RUSTLINE_OBJECTIVE_CART_SHOTS')
    if directory:
        directory=Path(directory)
        directory.mkdir(parents=True,exist_ok=True)
        p.locator('[data-procurement]').scroll_into_view_if_needed()
        p.screenshot(path=str(directory/f'목표조달_{width}px.png'),animations='disabled')


def pin_and_review(p,stage):
    at(p,'campaign')
    p.locator(f'[data-objective="pin"][data-kind="campaign"][data-id="{stage}"]').click()
    control(p,'review').click()
    expect(p.locator('[data-procurement="objective"]')).to_be_visible()
    expect(control(p,'toggle')).to_have_attribute('aria-expanded','true')


def natural(browser,width):
    ctx,p,errors=shared['profile'](browser,width,wall=True)
    try:
        pin_and_review(p,'power')
        for trader_id in ('supply','repair'):
            expect(control(p,'add',trader_id)).to_be_enabled()
        # One failed joint write must leave both merchants' previously empty carts intact.
        empty=snapshot(p)
        helpers['write_barrier'](p)
        control(p,'add','').click()
        expect(p.locator('[data-procurement-status]')).to_contain_text('저장')
        assert snapshot(p)['marketCarts']==empty['marketCarts']
        assert snapshot(p)['wallet']==empty['wallet']
        p.evaluate('window.releaseWriteBarrier()')
        control(p,'add','').click()
        all_drafts=snapshot(p)
        assert cart_units(all_drafts,'supply')=={'food':2}
        assert cart_units(all_drafts,'repair')=={'fuel':1,'wire':2,'bolt':2}
        assert all_drafts['revision']==empty['revision']+1
        assert all_drafts['wallet']==empty['wallet'] and all_drafts['stashSlots']==empty['stashSlots']
        for trader_id in ('supply','repair'):
            control(p,'cart',trader_id).click()
            while p.locator('[data-cart="remove"]').count():
                p.locator('[data-cart="remove"]').first.click()
            at(p,'campaign')
            control(p,'review').click()
        at(p,'shop')
        merchant(p,'repair')
        control(p,'toggle').click()
        panel=p.locator('[data-procurement="shop"]')
        expect(panel.locator('[data-procurement-trader]')).to_have_count(1)
        expect(panel.locator('[data-procurement-trader="repair"]')).to_be_visible()
        expect(control(p,'add','supply')).to_have_count(0)
        start=snapshot(p)
        control(p,'add','repair').click()
        order=snapshot(p)
        assert cart_units(order,'repair')=={'fuel':1,'wire':2,'bolt':2}
        assert not cart_units(order,'supply')
        assert (order['wallet'],order['stashSlots'])==(start['wallet'],start['stashSlots'])
        control(p,'review').click()
        expect(control(p,'add','supply')).to_be_enabled()
        expect(control(p,'add','repair')).to_have_count(0)
        control(p,'add','supply').click()
        control(p,'cart','supply').click()
        expect(p.locator('[data-cart-panel]')).to_have_attribute('data-trader','supply')
        assert cart_units(snapshot(p),'supply')=={'food':2}
        assert not errors,errors
        print(f'PASS {width}px fresh game: joint save failure preserved both carts; retry staged all merchants in one revision; repair shop queued 1 fuel, 2 wires and 2 bolts only; operator wallet and warehouse unchanged. Supply goal queued 2 food and opened the correct cart.',flush=True)
    finally:ctx.close()


def prepared(browser,width):
    ctx,p,errors=shared['profile'](browser,width,wall=True)
    try:
        base=json.loads((ROOT/'tests/fixtures/trade-grid-v28.json').read_text())
        before=base['session']
        before['career'].update(sorties=2,returns=2)
        before['campaign']={'claimed':[1700000000000,1700000100000],'delivered':0,'returnId':None}
        before['hideout']['levels'].update(power=1,water=1)
        before['wallet']=30000
        shared['import_profile'](p,base)
        at(p,'shop')
        merchant(p,'medic')
        helpers['add'](p,'bandage')
        pin_and_review(p,'med')
        panel=p.locator('[data-procurement="objective"]')
        line=panel.locator('[data-procurement-item="bandage"]')
        for field in ('필요 5','보유 2','부족 3','장바구니 1','추가 2개','9,000 CR'):
            expect(line).to_contain_text(field)
        expect(panel.locator('[data-procurement-trader="medic"] .op-group-head')).to_contain_text('13,000 CR')
        expect(panel.locator('.op-unavailable')).to_contain_text('1개 부족')
        start=snapshot(p)
        existing=copy.deepcopy(start['marketCarts']['traders']['supply'])
        original_ids={u['uid'] for u in start['stashSlots']}
        picture(p,width)
        campaign['fit'](p)
        control(p,'add','medic').click()
        s=snapshot(p)
        assert s['wallet']==30000 and s['stashSlots']==start['stashSlots']
        assert cart_units(s,'medic')=={'bandage':3,'gauze':1}
        assert s['marketCarts']['traders']['supply']==existing
        expect(control(p,'add','medic')).to_have_count(0)
        expect(line).to_contain_text('추가 0개')
        expect(line).to_contain_text('장바구니 3')
        expect(panel.locator('[data-procurement-status]')).to_contain_text('3개를 장바구니에 담았습니다')
        control(p,'cart','medic').click()
        expect(p.locator('[data-cart-total]')).to_contain_text('17,500 CR')
        p.locator('[data-cart="checkout"]').click()
        final=snapshot(p)
        assert final['wallet']==12500 and not cart_units(final,'medic')
        assert original_ids.issubset({u['uid'] for u in final['stashSlots']})
        assert final['stash']['bandage']==5 and final['stash']['gauze']==2
        assert 'medkit' not in final['stash'] and final['marketCarts']['traders']['supply']==existing
        at(p,'map')
        expect(p.locator('[data-objective-material="bandage"]')).to_have_attribute('data-missing','0')
        p.locator('.command-deploy[data-page="prep"]').click()
        goal=p.locator('[data-objective-panel="prep"]')
        expect(goal.locator('[data-objective-material="bandage"]')).to_have_attribute('data-owned','5')
        expect(goal.locator('[data-objective-material="medkit"]')).to_have_attribute('data-missing','1')
        expect(goal.locator('.obj-goals')).to_contain_text('생환')
        assert not errors,errors
        print(f'PASS {width}px controlled medical stage: 5 required, 2 owned, 1 queued -> 2 bandages added plus 1 gauze (13,000 CR). Entire cart 17,500 CR; after checkout 12,500 CR and 5 owned bandages, zero missing. Existing supply draft unchanged; locked medkit and field-return conditions stay outstanding.',flush=True)
    finally:ctx.close()


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('widths',nargs='*',type=int)
    cli.add_argument('--natural',action='store_true')
    args=cli.parse_args()
    cfg={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):cfg['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):cfg['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as w:
        b=w.chromium.launch(**cfg)
        try:
            for width in args.widths or [1280,390,320]:
                (natural if args.natural else prepared)(b,width)
        finally:b.close()
