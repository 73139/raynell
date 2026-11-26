"""Recover three original clinic manuals, then compare staging, bulk sale and clinic registration."""
import json
import os
import runpy
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

helpers = runpy.run_path(str(Path(__file__).with_name('ward-manual-browser.py')))
at, snapshot, find_sheet, finish = [helpers[k] for k in ('at', 'snapshot', 'find_sheet', 'finish')]
SHEET = helpers['SHEET']


def scenario(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={'width': width, 'height': 844}, has_touch=mobile, is_mobile=mobile,
                             reduced_motion='reduce', ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1') as ctx:
        ctx.add_init_script('Math.random=()=>0.1')
        p = ctx.new_page()
        p.clock.install()
        p.set_default_timeout(7500)
        errors = []
        p.on('pageerror', lambda e: errors.append(str(e)))
        p.on('dialog', lambda d: d.accept())

        def activate(loc):
            if mobile:
                loc.tap()
            else:
                loc.focus()
                p.keyboard.press('Enter')

        def merchant():
            at(p, 'shop')
            activate(p.locator('[data-market="trader"][data-id="quarter"]'))
            activate(p.locator('[data-market="mode"][data-mode="sell"]'))

        def select(uid):
            activate(p.locator(f'[data-tg="stash-select"][data-uid="{uid}"]'))

        def stage(uid):
            activate(p.locator(f'[data-tg="sell-add"][data-uid="{uid}"]'))
            expect(p.locator('[data-trade-pane="order"]')).to_be_focused()

        def fit(loc):
            assert loc.evaluate('n=>n.scrollWidth<=n.clientWidth+1')

        copies = []
        for _ in range(3):
            copies.append(find_sheet(p, False))
            p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
            finish(p, False)
            p.locator('[data-raid="ack"]:visible').first.click()
        before = snapshot(p)
        assert len(set(copies)) == 3
        assert before['wallet'] == 30000 and before['stash'][SHEET] == 3
        assert not before['hideout']['wardManual']['registered'] and before['hideout']['levels']['med'] == 0
        # Save actual earned originals, then branch into two player choices by ordinary JSON restore.
        p.locator('.shell-settings').click()
        with TemporaryDirectory() as directory:
            with p.expect_download() as pending:
                p.locator('[data-backup="export"]').click()
            path = Path(directory) / 'ward-sale-test.json'
            pending.value.save_as(path)
            saved = json.loads(path.read_text())['session']
            assert [u['uid'] for u in saved['stashSlots'] if u['g'] == SHEET] == copies
            merchant()
            initial = snapshot(p)
            tray, preview = p.locator('#ward-sale-tray'), p.locator('#ward-sale-preview')
            confirm = p.locator('[data-tg="sell-confirm"]')
            for i, uid in enumerate(copies, 1):
                select(uid)
                remaining = f'보유 원본 {3-i}장 남음' if i < 3 else '마지막 보유 원본까지 판매'
                expect(preview).to_contain_text('의무실 등록 가능')
                expect(preview).to_contain_text(f'선택한 원본 포함 {i}장 판매 시 {remaining}')
                expect(p.locator(f'[data-tg="sell-add"][data-uid="{uid}"]')).to_have_attribute('aria-describedby', 'ward-sale-preview')
                fit(preview)
                stage(uid)
                expect(tray).to_contain_text(f'판매대 원본 {i}장 판매 시 {remaining}')
                expect(tray).to_contain_text('의무실 Lv.1부터')
                expect(confirm).to_have_attribute('aria-describedby', 'ward-sale-tray')
                fit(tray)
            # Selecting a staged original again must not count it twice. Removing one updates the final quote.
            select(copies[0])
            expect(preview).to_contain_text('선택한 원본 포함 3장')
            activate(p.locator(f'[data-tg="sell-remove"][data-uid="{copies[1]}"]'))
            expect(tray).to_contain_text('판매대 원본 2장 판매 시 보유 원본 1장 남음')
            select(copies[1])
            stage(copies[1])
            expect(p.locator('[data-sale-total]')).to_contain_text('1,800 CR')
            assert initial == snapshot(p)
            if os.getenv('RUSTLINE_MANUAL_SHOTS'):
                folder = Path(os.environ['RUSTLINE_MANUAL_SHOTS'])
                folder.mkdir(exist_ok=True, parents=True)
                confirm.scroll_into_view_if_needed()
                p.screenshot(path=folder / f'manual-sale-{width}.png')
            activate(confirm)
            if not mobile:
                expect(p.locator('[data-sale-notice]')).to_be_focused()
            after = snapshot(p)
            receipt = after['saleReceipts']['quarter']
            assert after['wallet'] == 31800 and SHEET not in after['stash']
            assert len(receipt['lines']) == 1 and receipt['lines'][0]['unit'] == 600
            assert set(receipt['lines'][0]['uids']) == set(copies)
            expect(tray).to_have_count(0)
            p.reload(wait_until='domcontentloaded')
            assert snapshot(p)['saleReceipts']['quarter'] == receipt
            p.locator('.shell-settings').click()
            p.locator('#restore-file').set_input_files(path)
            expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다')
            at(p, 'stash')
            activate(p.locator(f'[data-stash="select"][data-uid="{copies[0]}"]:visible').first)
            expect(p.locator('[data-stash="sell"]')).to_have_attribute('aria-describedby', 'ward-sale-direct')
            expect(p.locator('#ward-sale-direct')).to_contain_text('원본 1장 판매 시 보유 원본 2장 남음')
            at(p, 'clinic')
            activate(p.locator(f'[data-hideout="manual-register"][data-uid="{copies[0]}"]'))
            expect(p.locator('[data-manual-state]')).to_contain_text('제조법 등록 완료')
            merchant()
            select(copies[1])
            expect(preview).to_have_count(0)
            stage(copies[1])
            expect(tray).to_have_count(0)
            activate(confirm)
            s = snapshot(p)
            assert s['wallet'] == 30600 and s['stash'][SHEET] == 1
            assert s['saleReceipts']['quarter']['lines'][0]['uids'] == [copies[1]]
            assert s['hideout']['wardManual']['registered'] and not errors, errors
            print(f'PASS {width}px: three searched and recovered original UIDs, 1/2/3-copy previews, staged removal, '
                  'keyboard/touch sale of all three for 1,800 CR, file restoration, registration and ordinary surplus sale.', flush=True)


if __name__ == '__main__':
    with sync_playwright() as pw:
        proxy = {'server': os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
        with pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'), proxy=proxy) as browser:
            for w in (390, 1280):
                scenario(browser, w)
