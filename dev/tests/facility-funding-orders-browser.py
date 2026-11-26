"""A pinned facility's budget links to real optional field-order dossiers, and back.
Set RUSTLINE_URL for a deployed build; all browser profiles are disposable.
"""
import argparse
import json
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
helpers=runpy.run_path(str(ROOT/'tests/facility-procurement-budget-browser.py'))
shared,facility,expanded,at=helpers['shared'],helpers['facility'],helpers['expanded'],helpers['at']
control=helpers['control']
details='[data-order-funding]'
def order(id):return f'[data-objective="procurement-order"][data-id="{id}"]'
def snapshot(p):return shared['snapshot'](p)


def tab_to(p,selector,reverse=False):
    for _ in range(80):
        if p.evaluate('s=>document.activeElement.matches(s)',selector):return
        p.keyboard.press('Shift+Tab' if reverse else 'Tab')
    raise AssertionError('Unreachable by Tab: '+selector)


def amount(p,amount,remainder):
    expect(p.locator('[data-funding-reward]')).to_have_text('예상 수당 '+amount+' CR')
    expect(p.locator('[data-funding-balance]')).to_have_text(remainder)


def run(browser,width):
    mobile=width==390
    c=browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,
                           reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    try:
        p=c.new_page();p.set_default_timeout(6500)
        errors=[];p.on('pageerror',lambda err:errors.append(str(err)));p.on('dialog',lambda d:d.accept())
        facility(p,'power')
        before=snapshot(p);assert before['objectivePin']=={'kind':'facility','id':'power','tier':1}
        control(p,'review').click();budget=expanded(p)
        expect(budget.locator('[data-budget-balance]')).to_contain_text('46,000 CR 부족')
        summary=p.locator(details+' summary')
        if mobile:summary.tap()
        else:
            tab_to(p,details+' summary');p.keyboard.press('Enter')
        amount(p,'46,000','부족액 전액 충당')
        first=order('pump-gauge');second=order('handover-ledgers')
        expect(p.locator(first)).to_be_visible();expect(p.locator(second)).to_be_visible()
        for row in [first,second]:expect(p.locator(row).locator('..')).to_contain_text('수락 가능')
        assert p.locator(details+' button').count()==2
        assert summary.bounding_box()['height']>=44
        for row in [first,second]:assert p.locator(row).bounding_box()['height']>=44
        assert p.locator(details).evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        if os.getenv('RUSTLINE_FUNDING_SHOTS'):
            folder=Path(os.environ['RUSTLINE_FUNDING_SHOTS']);folder.mkdir(parents=True,exist_ok=True)
            budget.screenshot(path=str(folder/f'budget-{width}.png'),animations='disabled')
        assert snapshot(p)==before
        if mobile:p.locator(first).tap()
        else:
            p.keyboard.press('Tab');expect(p.locator(first)).to_be_focused();p.keyboard.press('Enter')
        heading=p.locator('.bu-order-panel h2');expect(heading).to_have_text('빗물 펌프장 수위 판독');expect(heading).to_be_focused()
        assert snapshot(p)==before
        back='[data-objective="procurement-funding-return"]'
        p.keyboard.press('Tab');expect(p.locator(back)).to_be_focused();p.keyboard.press('Enter')
        expect(p.locator(first)).to_be_focused();amount(p,'46,000','부족액 전액 충당')
        assert snapshot(p)==before
        p.locator(first).click()
        p.locator('[data-order="pump-gauge"]').click()
        active=snapshot(p);assert active['career']['order']=='pump-gauge'
        assert active['objectivePin']==before['objectivePin'] and active['wallet']==before['wallet'] and active['stash']==before['stash']
        p.locator(back).click()
        expect(p.locator(first).locator('..')).to_contain_text('진행 중')
        expect(p.locator(second).locator('..')).to_contain_text('진행 의뢰 완료 후')
        p.locator(second).click()
        expect(heading).to_have_text('사라진 화물 인계표')
        expect(p.locator('[data-order="handover-ledgers"]')).to_be_disabled()
        assert snapshot(p)==active
        p.locator(back).click();expect(p.locator(second)).to_be_focused()
        at(p,'map');expanded(p);p.locator(details+' summary').click()
        p.locator(second).click();expect(heading).to_have_text('사라진 화물 인계표');p.locator(back).click()
        expect(p.locator('#inside')).to_have_attribute('data-page','map');expect(p.locator(second)).to_be_focused()
        assert snapshot(p)==active

        # A completed historic dossier must never be counted as an unpaid funding candidate.
        completed=json.loads((ROOT/'tests/fixtures/pump-pipe-done-v60.json').read_text())
        shared['import_profile'](p,completed);facility(p,'power')
        at(p,'shop');helpers['merchant'](p,'repair');expanded(p)
        p.locator(details+' summary').click();amount(p,'32,000','부족액 전액 충당')
        only=order('stores');expect(p.locator(only)).to_be_visible();assert p.locator(details+' button').count()==1
        done_before=snapshot(p);p.locator(only).click()
        expect(heading).to_have_text('보급품 위치 확인')
        p.locator(back).click()
        expect(p.locator('#inside')).to_have_attribute('data-page','trade');expect(p.locator(only)).to_be_focused()
        assert snapshot(p)==done_before
        facility(p,'med');control(p,'review').click()
        expect(expanded(p)).to_have_attribute('data-facility-budget','partial');expect(p.locator(details)).to_have_count(0)
        assert not errors,errors
        print(f'PASS {width}px: 46,000 CR exact via two separate jobs, read-only dossiers and exact return focus, explicit acceptance preserves facility pin, ongoing job protects second, v0.60 completed profile picks one 32,000 CR job, original repair shop retained, partial subtotal omitted.',flush=True)
    finally:c.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('widths',nargs='*',type=int);args=parser.parse_args()
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in args.widths or [390,1280]:run(browser,width)
