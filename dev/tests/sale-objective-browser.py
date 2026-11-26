"""Exercise a pinned facility shortage preview with three independently purchased warehouse units.

Run after build.py. RUSTLINE_URL can point at a public deployment. Each width starts with
a new browser context, real timers and ordinary player actions. Only assertions read the save.
Set RUSTLINE_SALE_OBJECTIVE_SHOTS to capture each viewport's warning and preparation screens.
"""
import argparse
import os
import re
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
market = runpy.run_path(str(ROOT / 'tests/market-cart-browser.py'))
shared = market['shared']
at, snapshot = shared['at'], shared['snapshot']
pin = {'kind': 'facility', 'id': 'power', 'tier': 1}


def physical_cash(state):
    notes = [*state['cash']['pocket'], *state['stashSlots']]
    return sum(note['amount'] for note in notes if note['g'] == 'cr_notes')


def stage(page, uid):
    page.locator(f'[data-tg="stash-select"][data-uid="{uid}"]').click()
    page.get_by_role('button', name='판매대에 올리기').click()
    expect(page.locator(f'[data-tg="sale-select"][data-uid="{uid}"]')).to_have_count(1)


def shot(page, anchor, width, label):
    folder = os.getenv('RUSTLINE_SALE_OBJECTIVE_SHOTS')
    if folder:
        dest = Path(folder)
        dest.mkdir(parents=True, exist_ok=True)
        anchor.evaluate("element => element.scrollIntoView({block: 'center', behavior: 'instant'})")
        page.screenshot(path=str(dest / f'{label}-{width}.png'), animations='disabled')


def scarcity(page, context, owned, missing):
    panel = page.locator(f'[data-objective-panel="{context}"]')
    expect(panel.get_by_role('heading', name='발전 시설 1단계')).to_be_visible()
    wire = panel.locator('[data-objective-material="wire"]')
    for name, value in [('required', 2), ('usable', owned), ('owned', owned), ('missing', missing)]:
        expect(wire).to_have_attribute(f'data-{name}', str(value))
    expect(wire).to_contain_text(f'부족 {missing}')
    return wire


def case(browser, width):
    ctx, page, errors = shared['profile'](browser, width, wall=True)
    try:
        fresh = snapshot(page)
        assert fresh['wallet'] == physical_cash(fresh) == 30_000
        assert not fresh['stashSlots'] and fresh['objectivePin'] is None
        page.locator('button[data-page="bunker"]:visible').first.click()
        page.locator('[data-bui="facility"][data-id="power"]:visible').first.click()
        page.locator('[data-objective="pin"][data-kind="facility"][data-id="power"][data-tier="1"]').click()
        assert snapshot(page)['objectivePin'] == pin

        at(page, 'shop')
        market['trader'](page, 'repair')
        expect(page.locator('.tg-standing')).to_contain_text('임도현')
        market['add'](page, 'wire', 3)
        expect(page.locator('[data-cart-total]')).to_contain_text('15,000 CR')
        page.locator('[data-cart="checkout"]').click()
        before = snapshot(page)
        wires = [unit for unit in before['stashSlots'] if unit['g'] == 'wire']
        assert before['stash']['wire'] == len(wires) == 3
        assert len({unit['uid'] for unit in wires}) == 3
        assert before['wallet'] == physical_cash(before) == 15_000
        first, keep, last = (unit['uid'] for unit in wires)
        page.locator('[data-market="mode"][data-mode="sell"]').click()
        warning = page.get_by_role('region', name='판매 후 고정 목표 부족량')
        confirm = page.get_by_role('button', name='판매 확정', exact=True)
        expect(confirm).to_be_disabled()

        stage(page, last)
        expect(warning).to_have_count(0)
        expect(page.locator('[data-sale-total]')).to_contain_text('2,500 CR')
        expect(confirm).to_be_enabled()
        stage(page, first)
        expect(warning.get_by_role('heading', name='판매 후 목표 부족량')).to_be_visible()
        expect(warning).to_contain_text('발전 시설 1단계')
        expect(warning.get_by_role('listitem')).to_have_count(1)
        expect(warning.get_by_role('listitem')).to_have_text('전선 묶음부족 0개 → 1개')
        expect(page.locator('[data-sale-total]')).to_contain_text('5,000 CR')
        expect(page.locator('[data-sale-balance]')).to_contain_text('20,000 CR')
        expect(confirm).to_be_enabled()
        shared['fit'](page)
        shot(page, warning, width, 'sale-warning')

        # This tab owns the real browser lock. A second tab can check actual holdings
        # while the first has an unsold draft. It cannot clear the shared pin.
        observer = ctx.new_page()
        observer.on('pageerror', lambda err: errors.append(str(err)))
        at(observer, 'map')
        expect(observer.locator('html')).to_have_class(re.compile(r'\bread-only\b'))
        scarcity(observer, 'map', owned=3, missing=0)
        expect(observer.locator('[data-objective="clear"]')).to_be_disabled()
        observer.close()

        for uid in (first, last):
            button = page.locator(f'[data-tg="sell-remove"][data-uid="{uid}"]')
            expect(button).to_have_accessible_name('전선 묶음 판매대에서 제외')
            button.click()
            expect(warning).to_have_count(0)
        expect(confirm).to_be_disabled()
        unchanged = snapshot(page)
        for field in ('objectivePin', 'stashSlots', 'stash', 'cash', 'wallet', 'marketCarts'):
            assert unchanged[field] == before[field], field

        stage(page, first)
        stage(page, last)
        expect(warning).to_be_visible()
        expect(confirm).to_be_enabled()
        confirm.focus()
        page.keyboard.press('Enter')
        expect(page.locator('[data-trade-pane="order"] [role="status"]')).to_contain_text('2개 판매 완료 · 5,000 CR 수령')
        expect(warning).to_have_count(0)
        expect(confirm).to_be_disabled()
        final = snapshot(page)
        assert [unit for unit in final['stashSlots'] if unit['g'] == 'wire'] == [wires[1]]
        assert {u['uid'] for u in before['stashSlots']} - {u['uid'] for u in final['stashSlots']} == {first, last}
        assert final['stash']['wire'] == 1 and final['objectivePin'] == pin
        assert final['wallet'] == physical_cash(final) == 20_000
        assert final['cash']['pocket'][0]['uid'] == before['cash']['pocket'][0]['uid']
        assert final['marketCarts'] == before['marketCarts']
        expect(page.locator(f'[data-tg="stash-select"][data-uid="{keep}"]')).to_have_count(1)

        at(page, 'map')
        page.locator('.command-deploy[data-page="prep"]').click()
        wire = scarcity(page, 'prep', owned=1, missing=1)
        shared['fit'](page)
        shot(page, wire, width, 'post-sale-prep')
        assert not errors, errors
        print(f'PASS {width}px fresh profile: repair shop sold 3 distinct wire UIDs for 15,000 CR; '
              'staging 1 surplus wire gave no warning, staging 2 projected shortage 0 → 1; '
              'read-only tab saw all 3 and could not clear pin. Unstaging restored empty sale. '
              'Confirmed with Enter: exact first and last UIDs removed, middle UID retained; '
              'physical cash +5,000 to 20,000 CR; preparation showed 2 required, 1 owned, 1 missing.', flush=True)
    finally:
        ctx.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('widths', nargs='*', type=int)
    args = parser.parse_args()
    launch = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy'] = {'server': os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch)
        try:
            for width in args.widths or [390, 1280]:
                case(browser, width)
        finally:
            browser.close()
