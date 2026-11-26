"""Keep the selected physical item and keyboard focus during a timed warehouse redraw."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


DEV = Path(__file__).resolve().parents[1]
URL = 'https://rustline-case-focus.test/'
SAVE = 'rl-reboot-session-v36'
START = datetime(2026, 11, 26, tzinfo=timezone.utc)


def scenario(browser, width, control, missing):
    mobile = width < 600
    seed = json.loads((DEV / 'tests/fixtures/possessions-v17.json').read_text())['session']
    seed['hideout']['builds']['power'] = {'tier': 1, 'end': int(START.timestamp() * 1000) + 60000}
    with browser.new_context(viewport={'width': width, 'height': 850}, is_mobile=mobile, has_touch=mobile,
                             offline=True, reduced_motion='reduce', service_workers='block') as context:
        html = (DEV / 'index.html').read_bytes()
        context.route('**/*', lambda r: r.fulfill(content_type='text/html; charset=utf-8', body=html)
                      if r.request.url == URL else r.abort())
        context.add_init_script(script="localStorage.setItem('rl-reboot-session-v17'," + json.dumps(json.dumps(seed)) + ");")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.clock.install(time=START - timedelta(days=1))
        page.clock.pause_at(START)
        page.goto(URL + '#stash')

        def press(button):
            if mobile:
                button.tap()
            else:
                button.focus()
                button.press('Enter')

        press(page.locator('[data-stash="select"][data-uid="s-rations"]:visible').first)
        press(page.locator('[data-stash="case-open"][data-box="s-rations"]'))
        summary = page.get_by_text('다른 보관함으로 옮기기', exact=True)
        press(summary)
        if mobile:
            # Select the option through the DOM, then exercise the same control with keyboard focus.
            item = page.get_by_role('combobox', name='옮길 물품')
            item.select_option('s-water-a')
            item.focus()
        else:
            page.keyboard.press('Tab')
            item = page.get_by_role('combobox', name='옮길 물품')
            expect(item).to_be_focused()
            page.keyboard.press('ArrowDown')
        expect(item).to_have_value('s-water-a')
        receiver = page.locator('[data-stash="case-relocate"][data-box="s-drinks"]')
        if control == 'receiver':
            page.keyboard.press('Tab')
        focus = receiver if control == 'receiver' else item
        expect(focus).to_be_focused()

        page.clock.fast_forward(61000)
        expect(summary.locator('..')).to_have_attribute('open', '')
        expect(item).to_have_value('s-water-a')
        expect(receiver).to_have_attribute('data-unit', 's-water-a')
        expect(focus).to_be_focused()
        read = lambda: page.evaluate('key=>JSON.parse(localStorage.getItem(key))', SAVE)
        assert read()['hideout']['levels']['power'] == 1

        if missing:
            # Withdraw the selected bottle through its own control. Never substitute the remaining food.
            press(page.locator('[data-stash="case-take"][data-box="s-rations"][data-unit="s-water-a"]'))
            expect(item).to_have_value('')
            expect(receiver).to_have_count(0)
            expect(summary.locator('..')).to_contain_text('물품을 다시 선택하세요')
            final = read()
            assert any(row['uid'] == 's-water-a' for row in final['stashSlots'])
            assert [u['uid'] for u in next(row['contents'] for row in final['stashSlots'] if row['uid'] == 's-rations')] == ['s-can']
            # A replacement can be moved only after explicit selection.
            item.select_option('s-can')
            expect(receiver).to_have_attribute('data-unit', 's-can')
        else:
            if control == 'select':
                page.keyboard.press('Tab')
            expect(receiver).to_be_focused()
            if mobile:
                receiver.tap()
            else:
                page.keyboard.press('Enter')
            moved = page.locator('[data-stash="case-take"][data-box="s-drinks"][data-unit="s-water-a"]')
            expect(moved).to_be_focused()
            final = read()
            assert [u['uid'] for u in next(row['contents'] for row in final['stashSlots'] if row['uid'] == 's-rations')] == ['s-can']
            assert [u['uid'] for u in next(row['contents'] for row in final['stashSlots'] if row['uid'] == 's-drinks')] == ['s-tea', 's-water-b', 's-water-a']
        assert not errors, errors
        print(f'PASS {width}px: {control} retains focus/UID after construction, missing={missing}.')


if __name__ == '__main__':
    binary = os.getenv('RUSTLINE_CHROMIUM') or os.getenv('CHROMIUM_BIN')
    with sync_playwright() as playwright, playwright.chromium.launch(executable_path=binary) as chromium:
        for width in (320, 1280):
            for control, missing in [('select', False), ('receiver', False), ('receiver', True)]:
                scenario(chromium, width, control, missing)
