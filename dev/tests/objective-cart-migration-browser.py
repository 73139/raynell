"""Continue an authentic v29 raid in the current client and procure the active campaign's shortages.

tests/fixtures/objective-cart-active-v29.json was exported through v29's settings
after buying and queuing wire, splitting two cash stacks and deploying. The controlled
clock resumes just after departure. Set RUSTLINE_URL to exercise the live release.
"""
import argparse
from datetime import datetime, timezone
import json
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

tests=Path(__file__).resolve().parent
prior=json.loads((tests/'fixtures/objective-cart-active-v29.json').read_text())
goal=runpy.run_path(str(tests/'objective-cart-browser.py'))
shared=goal['shared']
cash_raid=runpy.run_path(str(tests/'cash-raid-browser.py'))


def existing_storage_profile(browser, old):
    # Reproduce the localStorage that the previous client already wrote on this origin.
    context = browser.new_context(viewport={'width':390, 'height':844}, reduced_motion='reduce',
                                  ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    original = json.dumps(old,ensure_ascii=False,separators=(',',':'))
    context.add_init_script("if (!localStorage.getItem('rl-reboot-session-v29')) "
                            "localStorage.setItem('rl-reboot-session-v29', "+json.dumps(original)+");")
    page = context.new_page()
    errors = []
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.set_default_timeout(9000)
    now = old['raid']['startedAt']+1500
    page.clock.install(time=datetime.fromtimestamp((now-86400000)/1000,timezone.utc))
    page.clock.pause_at(datetime.fromtimestamp(now/1000,timezone.utc))
    shared['at'](page,'shop')
    page.wait_for_function("Boolean(localStorage.getItem('rl-reboot-session-v35'))")
    assert page.evaluate("localStorage.getItem('rl-reboot-session-v29')") == original
    return context,page,errors


def migration(browser, stored=False):
    old=prior['session']
    assert old['version']==29 and old['wallet']==24000
    assert old['objectivePin']=={'kind':'campaign','id':'power'} and old['field']['result'] is None
    c,p,errors=(existing_storage_profile(browser,old) if stored else
                shared['profile'](browser,390,now=old['raid']['startedAt']+1500))
    at,snapshot,control=shared['at'],shared['snapshot'],goal['control']
    try:
        if not stored:
            shared['import_profile'](p,prior)
            at(p,'shop')
        loaded=snapshot(p)
        for key in ('objectivePin','marketCarts','cash','stashSlots','stash','raid','wallet'):
            assert loaded[key]==old[key],key
        assert loaded['field']['bag']==old['field']['bag']
        held=cash_raid['assert_cash'](loaded,24000,1000)
        assert len(held)==1 and held[0]['uid']==old['field']['bag'][0]['uid']
        expect(p.locator('[data-procurement]')).to_have_count(0)
        p.locator('.mk-raid [data-page="raid"]').click()
        expect(p.locator('[data-objective-panel="field"]').first).to_contain_text('전력 복구')
        p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        cash_raid['finish_action'](p,False)
        expect(p.get_by_text('휴대 지폐 회수 · 1,000 CR',exact=True)).to_be_visible()
        p.locator('[data-raid="ack"]:visible').first.click()
        returned=snapshot(p)
        cash_raid['assert_cash'](returned,25000,0)
        assert returned['marketCarts']==old['marketCarts'] and returned['objectivePin']==old['objectivePin']
        assert returned['stashSlots']==old['stashSlots']
        assert returned['cash']['pocket'][0]['uid']==old['cash']['pocket'][0]['uid']
        assert returned['cash']['pocket'][0]['amount']==old['cash']['pocket'][0]['amount']+1000
        at(p,'campaign');control(p,'review').click()
        expect(p.locator('[data-objective-panel="prep"] .obj-goals')).to_contain_text('이번 단계 생환')
        wire=p.locator('[data-procurement-item="wire"]')
        for value in ('필요 2','보유 1','장바구니 1','추가 0개'):
            expect(wire).to_contain_text(value)
        control(p,'add','supply').click()
        staged=snapshot(p)
        assert staged['marketCarts']['traders']['repair']==old['marketCarts']['traders']['repair']
        assert staged['wallet']==25000
        control(p,'cart','supply').click()
        expect(p.locator('[data-cart-total]')).to_contain_text('12,000 CR')
        p.locator('[data-cart="checkout"]').click()
        done=snapshot(p)
        cash_raid['assert_cash'](done,13000,0)
        assert done['stash']['food']==2 and done['marketCarts']['traders']['repair']==old['marketCarts']['traders']['repair']
        at(p,'map')
        expect(p.locator('[data-objective-material="food"]')).to_have_attribute('data-missing','0')
        if stored:
            original = p.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v29'))")
            assert original==old
            # Simulate a stale build writing only its own old key, then reopen the real client.
            p.evaluate("""() => {const k='rl-reboot-session-v29',s=JSON.parse(localStorage.getItem(k));
                           s.objectivePin=null;s.revision+=20;localStorage.setItem(k,JSON.stringify(s));}""")
            p.reload(wait_until='domcontentloaded')
            p.wait_for_function("JSON.parse(localStorage.getItem('rl-reboot-session-v35')).wallet===13000")
            restored=snapshot(p)
            assert restored['objectivePin']==done['objectivePin'] and restored['marketCarts']==done['marketCarts']
            assert restored['cash']==done['cash'] and restored['stashSlots']==done['stashSlots']
        assert not errors,errors
        print('PASS '+('previous-client storage migration and old-tab isolation: ' if stored else '')+'genuine v29 in-flight export: identical cash, warehouse UIDs/coordinates, 5,000 CR wire receipt, 1 queued wire and pinned power project. B-04 extraction returned the 1,000 CR stack to 25,000 spendable; the new supply procurement bought 2 food for 12,000, leaving 13,000 CR. Repair draft/receipt survived unchanged and goal shortage became zero.',flush=True)
    finally:c.close()


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('--previous-storage',action='store_true',help='Resume the v29 legacy key instead of importing it.')
    cli.add_argument('--v33-storage',action='store_true',help='Migrate an authentic v33 save with receipts and a pending clinic job.')
    cli.add_argument('--legacy-html',type=Path,help='Run this archived v33 document as a second same-origin client in the v33 scenario.')
    args=cli.parse_args()
    launch={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):launch['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):launch['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as runner:
        b=runner.chromium.launch(**launch)
        try:
            if args.v33_storage:
                from save_generation_browser import v33_migration
                v33_migration(b,args.legacy_html)
            else:
                migration(b,args.previous_storage)
        finally:b.close()
