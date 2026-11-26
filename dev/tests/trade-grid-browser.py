"""Browser acceptance for v29. Use a real v28 export and only UI controls after import.
The advanced-standing example is a controlled save fixture. Other transactions use the
game's normal clock, mouse/keyboard inputs and a fresh browser profile.
"""
import copy
import json
import os
import runpy
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
legacy = json.loads((ROOT/'tests/fixtures/trade-grid-v28.json').read_text())
previous = runpy.run_path(str(ROOT/'tests/market-cart-browser.py'))
shared = previous['shared']
at, snap, merchant = shared['at'], shared['snapshot'], previous['trader']


def grid(p, kind):
    return p.locator(f'[data-trade-grid="{kind}"]')


def mode(p, name):
    p.locator(f'[data-market="mode"][data-mode="{name}"]').click()


def physical(s):
    notes = s['cash']['pocket'] + [u for u in s['stashSlots'] if u['g']=='cr_notes']
    assert all(u['amount']>0 and u['w']==u['h']==1 for u in notes)
    assert len(notes)==len({u['uid'] for u in notes})
    assert sum(u['amount'] for u in notes)==s['wallet']
    return s['wallet']


def picture(p, scene, width):
    dest=os.getenv('RUSTLINE_TRADE_SCREENSHOTS')
    if dest:
        dest=Path(dest)
        dest.mkdir(parents=True,exist_ok=True)
        p.evaluate("document.querySelector('.content').scrollTop=0")
        p.screenshot(path=str(dest/f'{scene}_{width}px.png'),animations='disabled')


def drag_at(source, board, x, y):
    board.scroll_into_view_if_needed()
    size = board.evaluate('(e)=>[e.clientWidth,e.clientHeight,+e.dataset.cols,+e.dataset.rows]')
    source.drag_to(board,target_position={'x':int((x+.40)*size[0]/size[2]),'y':int((y+.45)*size[1]/size[3])})


def buy_sell(browser,width,folder):
    ctx,p,errors=shared['profile'](browser,width,wall=True)
    try:
        desktop=width>=1000
        at(p,'cart')
        assert physical(snap(p))==30000
        merchant(p,'medic')
        stock,cart=grid(p,'stock'),grid(p,'cart')
        bandage=stock.locator('[data-trade-item="bandage"]')
        if desktop:
            drag_at(bandage,cart,1,1)
            row=cart.locator('[data-trade-item="bandage"]')
            expect(row).to_have_attribute('data-x','1')
            drag_at(row,cart,3,2)
            expect(row).to_have_attribute('data-y','2')
            expect(row).to_have_attribute('data-x','3')
            drag_at(stock.locator('[data-trade-item="gauze"]'),cart,3,2)
            expect(cart.locator('[data-trade-item="gauze"]')).to_have_count(0)
            p.locator('[data-cart="inc"][data-id="bandage"]').click()
        else:
            previous['add'](p,'bandage',2)
        previous['add'](p,'gauze')
        expect(p.locator('[data-cart-total]')).to_contain_text('13,000')
        assert physical(snap(p))==30000
        if desktop:
            c_data=shared['export_profile'](p,folder/'before-grid-checkout.json')
            c2,p2,errs2=shared['profile'](browser,390,wall=True)
            try:
                shared['import_profile'](p2,c_data)
                at(p2,'cart')
                restored=grid(p2,'cart').locator('[data-trade-item="bandage"]')
                expect(restored).to_have_attribute('data-x','3')
                expect(restored).to_have_attribute('data-y','2')
                assert not errs2,errs2
            finally:c2.close()
            at(p,'cart')
        picture(p,'상인구매',width)
        p.locator('[data-cart="checkout"]').click()
        after=snap(p)
        assert physical(after)==17000
        bands=[u for u in after['stashSlots'] if u['g']=='bandage']
        assert len(bands)==2
        mode(p,'sell')
        stash,sale=grid(p,'stash'),grid(p,'sale')
        src=stash.locator('[data-uid="'+bands[1]['uid']+'"]')
        if desktop:
            drag_at(src,sale,2,1)
        else:
            src.click()
            p.locator('[data-tg="sell-add"]').click()
        pending=sale.locator('[data-uid="'+bands[1]['uid']+'"]')
        expect(pending).to_be_visible()
        expect(p.locator('[data-sale-total]')).to_contain_text('2,250')
        assert snap(p)['stashSlots']==after['stashSlots']
        p.locator('[data-tg="sell-remove"]').click()
        expect(pending).to_have_count(0)
        assert physical(snap(p))==17000
        if desktop:drag_at(src,sale,2,1)
        else:
            src.click()
            p.locator('[data-tg="sell-add"]').click()
        picture(p,'상인판매',width)
        p.locator('[data-tg="sell-confirm"]').click()
        result=snap(p)
        assert physical(result)==19250
        assert [u for u in result['stashSlots'] if u['g']=='bandage']==[bands[0]]
        expect(src).to_have_count(0)
        expect(p.locator('[data-tg="sell-confirm"]')).to_be_disabled()
        assert not errors,errors
        print(f'PASS {width}px: 13,000 CR purchase from physical 30,000; staged, removed and sold only the second bandage UID for 2,250; first UID and coordinates intact; 19,250 physical CR. '+('Native mouse drag to/from actual grids, collision and backed-up coordinates.' if desktop else 'Touch-sized tap workflow.'),flush=True)
    finally:ctx.close()


def cash_migration(browser,folder):
    c,p,errors=shared['profile'](browser,1280,wall=True)
    try:
        shared['import_profile'](p,legacy)
        at(p,'cart')
        s=snap(p)
        assert physical(s)==legacy['session']['wallet']==17000
        assert s['marketCarts']==legacy['session']['marketCarts'] and s['stashSlots']==legacy['session']['stashSlots']
        cash=p.locator('[data-cash="select"][data-cash-area="pocket"]').first
        cash.click()
        p.locator('[data-cash-amount]').fill('4000')
        p.locator('[data-cash="move"][data-to="stash"]').click()
        s=snap(p)
        split=[u for u in s['stashSlots'] if u['g']=='cr_notes']
        assert [u['amount'] for u in split]==[4000] and physical(s)==17000
        ordinary=p.locator('[data-cash="select"][data-cash-area="stash"]')
        ordinary.click()
        p.locator('[data-cash-amount]').fill('1000')
        p.locator('[data-cash="move"][data-to="bag"]').click()
        s=snap(p)
        assert physical(s)==16000 and [u['amount'] for u in s['equipment']['bag'] if u['g']=='cr_notes']==[1000]
        cash.click()
        ordinary.click()
        s=snap(p)
        assert physical(s)==16000 and not s['cash']['pocket']
        assert [(u['uid'],u['amount']) for u in s['stashSlots'] if u['g']=='cr_notes']==[(split[0]['uid'],16000)]
        restore=shared['export_profile'](p,folder/'cash-units.json')
        c2,p2,err2=shared['profile'](browser,390,wall=True)
        try:
            shared['import_profile'](p2,restore)
            at(p2,'cart')
            assert physical(snap(p2))==16000 and snap(p2)['stashSlots']==s['stashSlots'] and snap(p2)['equipment']['bag']==s['equipment']['bag']
            merchant(p2,'supply')
            expect(p2.locator('[data-cart-total]')).to_contain_text('5,000')
            p2.locator('[data-cart="checkout"]').click()
            settled=snap(p2)
            assert physical(settled)==11000 and not settled['cash']['pocket']
            assert [(u['uid'],u['amount']) for u in settled['stashSlots'] if u['g']=='cr_notes']==[(split[0]['uid'],11000)]
            assert settled['equipment']['bag']==s['equipment']['bag']
            assert any(u['g']=='water' for u in settled['stashSlots'])
            assert not err2,err2
        finally:c2.close()
        assert not errors,errors
        print('PASS actual v28 receipt, separate pending order, 3 warehouse UIDs and 17,000 CR migrated. Split 4,000 into an occupied warehouse, split 1,000 into a raid bag; merged to a 16,000 physical warehouse stack. Fresh-profile restoration retained all IDs; the old water order consumed 5,000 from the actual warehouse note (11,000 left) and kept the 1,000 bag note.',flush=True)
    finally:c.close()


def rank_fixture():
    ranked=copy.deepcopy(legacy)
    s=ranked['session']
    query=(ROOT/'src/contracts-data.js').read_text()+"\nconsole.log(JSON.stringify(TRADER_CONTRACTS.filter(q=>q.trader==='quarter'&&q.tier<4).sort((a,b)=>a.tier-b.tier).map(q=>q.id)))"
    s['contracts']['quarter']['done']=json.loads(subprocess.check_output(['node'],input=query,text=True))
    for i,item in enumerate(['rl_x_core']*2+['rl_x_circuit']*3):
        s['stash'][item]=s['stash'].get(item,0)+1
        s['stashSlots'].append(dict(uid=f's-rank-material-{i}',g=item,x=i,y=2,w=1,h=1,revealed=True))
    return ranked


def barter(browser):
    ctx,p,errors=shared['profile'](browser,1280,wall=True)
    try:
        at(p,'shop')
        merchant(p,'supply')
        mode(p,'barter')
        expect(p.locator('[data-tg="other-offers"]')).to_have_count(1)
        link=p.locator('[data-tg="other-offers"][data-id="quarter"]')
        expect(link).to_have_text('강태식 교환품 보기 →')
        expect(p.locator('[data-tg="recipe"]')).to_have_count(0)
        link.click()
        expect(p.locator('[data-market="mode"][data-mode="barter"]')).to_have_attribute('aria-pressed','true')
        expect(p.locator('[data-market="trader"][data-id="quarter"]')).to_have_attribute('aria-pressed','true')
        expect(p.locator('[data-tg="recipe"][data-id="rl_x_ammo"]')).to_be_visible()
        expect(p.locator('[data-tg="recipe"][data-id="rl_x_carbine"]')).to_have_count(0)
        expect(p.locator('[data-tg="barter-confirm"]')).to_be_disabled()
        shared['import_profile'](p,rank_fixture())
        at(p,'shop')
        merchant(p,'quarter')
        mode(p,'barter')
        p.locator('[data-tg="recipe"][data-id="rl_x_carbine"]').click()
        expect(p.locator('[data-barter-material="rl_x_core"]')).to_contain_text('2 / 2')
        expect(p.locator('[data-barter-material="rl_x_circuit"]')).to_contain_text('3 / 3')
        expect(p.locator('[data-trade-pane="order"]')).to_contain_text('Q4')
        picture(p,'상인교환',1280)
        before=snap(p)
        p.locator('[data-tg="barter-confirm"]').click()
        s=snap(p)
        assert physical(s)==physical(before) and s['stash']['rl_x_carbine']==1
        assert not any(item in s['stash'] for item in ('rl_x_core','rl_x_circuit'))
        gun=next(u for u in s['stashSlots'] if u['g']=='rl_x_carbine')
        assert sorted([gun['w'],gun['h']])==[1,4]
        assert not any(u['uid'].startswith('s-rank-material-') for u in s['stashSlots'])
        expect(p.locator('[data-tg="barter-confirm"]')).to_be_disabled()
        mode(p,'buy')
        stock=grid(p,'stock')
        expect(stock.locator('[data-trade-item="rl_x_carbine"]')).to_have_count(0)
        visible=stock.locator('[data-market="item"]')
        assert visible.count()>24
        first=visible.first.get_attribute('data-id')
        last=visible.last
        sku=last.get_attribute('data-id')
        last.scroll_into_view_if_needed()
        scroll=p.locator('.tg-scroll-stock')
        assert scroll.evaluate('area=>area.scrollTop>0')
        last.click()
        expect(last).to_have_attribute('aria-pressed','true')
        expect(p.locator('[data-cart="add"]')).to_have_attribute('data-id',sku)
        assert scroll.evaluate('area=>area.scrollTop>0')
        expect(stock.locator(f'[data-market="item"][data-id="{first}"]')).to_have_count(1)
        last.drag_to(grid(p,'cart'),target_position={'x':8,'y':8})
        expect(grid(p,'cart').locator(f'[data-trade-item="{sku}"]')).to_have_attribute('data-x','0')
        assert not errors,errors
        print('PASS tier I short-material offer and locked tier IV; controlled tier IV: 2 certified cores + 3 inspected circuits -> one 4×1 serialized carbine, exact material UIDs consumed, physical CR unchanged; no cash listing at max standing.',flush=True)
    finally:ctx.close()


if __name__=='__main__':
    with sync_playwright() as pw,TemporaryDirectory() as tmp:
        launch={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if os.getenv('RUSTLINE_CHROMIUM'):launch['executable_path']=os.environ['RUSTLINE_CHROMIUM']
        if os.getenv('RUSTLINE_PROXY'):launch['proxy']={'server':os.environ['RUSTLINE_PROXY']}
        browser=pw.chromium.launch(**launch)
        try:
            for width in (1280,390,320):buy_sell(browser,width,Path(tmp))
            cash_migration(browser,Path(tmp))
            barter(browser)
        finally:browser.close()
