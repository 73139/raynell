"""Run after python build.py with Playwright and Chromium installed: python tests/possessions-browser.py
Set RUSTLINE_CHROMIUM for a custom executable, RUSTLINE_URL for a deployment, and RUSTLINE_PROXY when needed.
For a TLS-inspecting test proxy, RUSTLINE_IGNORE_HTTPS_ERRORS=1 opts into accepting its test certificate.
An optional argument selects a viewport width, for example 390. All browser storage and downloads are disposable.
"""
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


TESTS = Path(__file__).resolve().parent
FIXTURE = TESTS / 'fixtures' / 'possessions-v17.json'
DEFAULT_URL = (TESTS.parent / 'index.html').as_uri()
GAME = urldefrag(os.environ.get('RUSTLINE_URL') or DEFAULT_URL).url + '#stash'
CASE_A = 's-rations'
CASE_B = 's-drinks'
ALIAS_A = '야간 <물자> & "A"'
ALIAS_B = '비상 음료'


def open_game(context):
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(GAME, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function("Boolean(localStorage.getItem('rl-reboot-session-v36'))")
    return page, errors


def menu(page, name):
    page.locator('.nav button[data-page="more"]').click()
    page.locator(f'.content button[data-page="{name}"]').click()


def restore(page, path):
    menu(page, 'settings')
    page.locator('#restore-file').set_input_files(path)
    expect(page.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    menu(page, 'stash')


def snapshot(page):
    return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")


def rename(page, uid, label):
    page.locator(f'[data-stash="select"][data-uid="{uid}"]').click()
    entry = page.locator(f'[data-pos-alias][data-box="{uid}"]')
    entry.fill(label)
    page.locator(f'[data-pos="rename"][data-box="{uid}"]').click()
    expect(entry).to_have_value(label)


def search(page, query):
    page.locator('#pos-query').fill(query)
    return page.locator('#pos-results [data-pos="locate"]')


def open_content(page, query, case_uid, item_uid, row, col):
    results = search(page, query)
    expect(results).to_have_count(1)
    results.click()
    panel = page.locator(f'.sc-case[data-case-uid="{case_uid}"]')
    tile = panel.locator(f'[data-unit="{item_uid}"].pos-found')
    expect(tile).to_be_visible()
    expect(panel.locator('.sc-scroll')).to_be_focused()
    assert tile.evaluate('e=>[e.style.gridRowStart,e.style.gridColumnStart]') == [str(row), str(col)]


def check_width(page):
    assert page.evaluate('document.documentElement.scrollWidth - innerWidth') <= 1
    assert page.locator('.content').evaluate('e=>e.scrollWidth-e.clientWidth') <= 1


def check_owned_locations(page):
    # Exercise the normal navigation to queue, loose grid, prepared bag and worn equipment.
    for kind, query, selector in [
        ('overflow', '물통', '[data-stash="select"][data-uid="overflow"][data-id="water"]'),
        ('stash', '물통', '[data-stash="select"][data-uid="s-loose-water"]'),
        ('bag', '물통', '[data-gear="select"][data-unit="kit-water"]'),
        ('worn', '지급 배낭', '[data-loadout="slot"][data-slot="back"]'),
    ]:
        search(page, query)
        result = page.locator(f'#pos-results [data-pos="locate"][data-kind="{kind}"]')
        expect(result).to_have_count(1)
        result.click()
        expect(page.locator(selector + '.pos-found')).to_be_visible()
        check_width(page)
        menu(page, 'stash')


def swap_contents(page):
    for name, box, unit, row in [
        ('통조림', CASE_A, 's-can', 8),
        ('차 음료', CASE_B, 's-tea', 4),
    ]:
        open_content(page, name, box, unit, row, 7)
        page.locator(f'.sc-case [data-stash="case-take"][data-unit="{unit}"]').click()
        expect(search(page, name)).to_have_attribute('data-kind', 'stash')

    for box, alias, item_id in [(CASE_B, ALIAS_B, 'food'), (CASE_A, ALIAS_A, 'tea')]:
        search(page, alias).click()
        case = page.locator(f'.sc-case[data-case-uid="{box}"]')
        case.locator(f'[data-stash="case-put"][data-id="{item_id}"]').click()

    for box, item_id, term in [(CASE_B, 'food', '통조림'), (CASE_A, 'tea', '차 음료')]:
        hit = search(page, term)
        expect(hit).to_have_count(1)
        expect(hit).to_have_attribute('data-case-uid', box)
        expect(page.locator('#pos-results .pos-status')).to_contain_text('보유 1개 · 위치 1곳')
        case = next(unit for unit in snapshot(page)['stashSlots'] if unit['uid'] == box)
        items = [unit for unit in case['contents'] if unit['g'] == item_id]
        assert len(items) == 1
        assert (items[0]['x'], items[0]['y']) == (0, 0)
        open_content(page, term, box, items[0]['uid'], 1, 1)


def check_mobile_composition(page):
    # Composition events exercise the DOM integration independently of an operating system keyboard.
    entry = page.locator('#pos-query')
    entry.fill('')
    entry.focus()
    entry.dispatch_event('compositionstart', {'data': ''})
    page.keyboard.insert_text('음료')
    entry.dispatch_event('compositionend', {'data': '음료'})
    expect(entry).to_be_focused()
    expect(entry).to_have_value('음료')
    expect(page.locator('#pos-results [data-pos="locate"]')).to_have_count(2)
    check_width(page)


def check_window(browser, width, folder):
    context_options = dict(viewport={'width': width, 'height': 844}, reduced_motion='reduce',
                           ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1')
    context = browser.new_context(**context_options)
    try:
        page, errors = open_game(context)
        restore(page, FIXTURE)
        assert snapshot(page)['objectivePin'] == {'kind': 'contract', 'id': 'supply-pantry'}
        rename(page, CASE_A, ALIAS_A)
        rename(page, CASE_B, ALIAS_B)
        assert page.locator('물자').count() == 0
        check_owned_locations(page)

        before = snapshot(page)['stashSlots']
        open_content(page, '통조림', CASE_A, 's-can', 8, 7)
        assert snapshot(page)['stashSlots'] == before
        check_width(page)
        hits = search(page, '물 통')
        expect(hits).to_have_count(5)
        expect(page.locator('#pos-results .pos-status')).to_contain_text('보유 6개 · 위치 5곳')
        labels = hits.all_inner_texts()
        assert any(ALIAS_A in text for text in labels) and any(ALIAS_B in text for text in labels)
        page.locator(f'#pos-results [data-pos="locate"][data-case-uid="{CASE_B}"]').click()
        expect(page.locator(f'.sc-case[data-case-uid="{CASE_B}"] [data-unit="s-water-b"].pos-found')).to_be_visible()
        open_content(page, '차 음료', CASE_B, 's-tea', 4, 7)
        assert snapshot(page)['stashSlots'] == before

        result = search(page, '비상음료')
        expect(result).to_have_count(1)
        result.click()
        expect(page.locator(f'.sc-case[data-case-uid="{CASE_B}"]')).to_be_visible()
        page.locator('[data-stash="place"][data-x="2"][data-y="27"]').click()
        unit = next(unit for unit in snapshot(page)['stashSlots'] if unit['uid'] == CASE_B)
        assert (unit['x'], unit['y']) == (2, 27)
        expect(search(page, '차 음료')).to_contain_text('창고 28행 3열')
        page.reload()
        open_content(page, '차 음료', CASE_B, 's-tea', 4, 7)

        if width == 390:
            check_mobile_composition(page)

        menu(page, 'settings')
        with page.expect_download() as download:
            page.locator('[data-backup="export"]').click()
        backup = folder / f'backup-{width}.json'
        download.value.save_as(backup)
        assert json.loads(backup.read_text(encoding='utf-8'))['session']['version'] == 36

        fresh = browser.new_context(**context_options)
        try:
            restored, restored_errors = open_game(fresh)
            restore(restored, backup)
            expect(search(restored, '차 음료')).to_contain_text(f'창고 28행 3열 › {ALIAS_B}')
            expect(search(restored, '통조림')).to_contain_text(ALIAS_A)
            swap_contents(restored)
            restored.locator(f'.sc-case[data-case-uid="{CASE_A}"] [data-stash="case-take"].pos-found').click()
            loose = search(restored, '차 음료')
            expect(loose).to_have_count(1)
            expect(loose).to_have_attribute('data-kind', 'stash')
            loose.click()
            restored.locator('[data-stash="sell"]').click()
            expect(search(restored, '차 음료')).to_have_count(0)
            expect(restored.locator('#pos-results .pos-status')).to_contain_text('일치하는 소유품이 없습니다')
            assert not restored_errors, restored_errors
        finally:
            fresh.close()
        assert not errors, errors
        print(f'PASS {width}px — both cases, all five location types, move, reload, backup, content swap and sale.', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    launch = {'headless': True, 'args': ['--disable-dev-shm-usage', '--disable-gpu']}
    if os.environ.get('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.environ.get('RUSTLINE_PROXY'):
        launch['proxy'] = {'server': os.environ['RUSTLINE_PROXY']}
    with TemporaryDirectory() as temp, sync_playwright() as runtime:
        browser = runtime.chromium.launch(**launch)
        try:
            for width in (list(map(int, sys.argv[1:])) or [1280, 390]):
                check_window(browser, width, Path(temp))
        finally:
            browser.close()
