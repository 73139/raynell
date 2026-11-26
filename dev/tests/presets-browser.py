"""Test the packed v0.21 game locally or with RUSTLINE_URL set to its HTTPS URL.

Uses Playwright, RUSTLINE_CHROMIUM, optional RUSTLINE_PROXY and
RUSTLINE_IGNORE_HTTPS_ERRORS=1. All profiles are disposable. The seeded JSON
was exported by the v0.20 game. Pass viewport widths to run specific cases.
"""
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/presets-v20.json'
URL = urldefrag(os.environ.get('RUSTLINE_URL') or (ROOT / 'index.html').as_uri()).url
SAVE = 'rl-reboot-session-v35'
ALPHA = '야간 조명'
BRAVO = '관측 통신'


def legacy_gear_shape(value):
    if isinstance(value, list):
        return [legacy_gear_shape(v) for v in value]
    if not isinstance(value, dict):
        return value
    def check(host, item, module=None):
        assert host['g'] == item and host['uid'] and host['durability'] == 100
        assert host['ammo'] == {'rl10_carbine':30, 'rl12_sidearm':12}.get(item, 0)
        assert host['module'] == module
    if 'gear' in value:
        check(value['gear'], value['g'])
    for slot, host in value.get('instances', {}).items():
        check(host, value['worn'][slot], value.get('modules', {}).get(slot))
    return {key:legacy_gear_shape(v) for key, v in value.items() if key not in ('gear','instances')}


def profile(browser, width, fixed_time=None):
    context = browser.new_context(viewport={'width': width, 'height': 844},
                                  reduced_motion='reduce',
                                  ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.set_default_timeout(7000)
    if fixed_time is None:
        page.clock.install()
    else:
        to_date = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc)
        page.clock.install(time=to_date(fixed_time - 60000))
        page.clock.pause_at(to_date(fixed_time))
    response = page.goto(URL + '#presets', wait_until='domcontentloaded', timeout=60000)
    if URL.startswith('http'):
        assert response and response.ok
    page.wait_for_function('key => !!localStorage.getItem(key)', arg=SAVE)
    return context, page, errors


def read(page):
    return page.evaluate('k => JSON.parse(localStorage.getItem(k))', SAVE)


def bureau(page):
    # The same permanent link must also work after a report or in another profile.
    if page.locator('#inside').get_attribute('data-page') != 'presets':
        page.reload(wait_until='domcontentloaded')
    expect(page.locator('#inside')).to_have_attribute('data-page', 'presets')


def button(page, action, extra=''):
    return page.locator(f'button[data-preset="{action}"]{extra}:visible').first


def select_preset(page, index):
    button(page, 'select', f'[data-index="{index}"]').click()


def set_slot(page, slot, item):
    box = page.locator(f'select[data-preset-slot="{slot}"]')
    if not box.is_visible():
        button(page, 'edit').click()
    box.select_option(item)


def set_module(page, slot, item):
    box = page.locator(f'select[data-preset-module="{slot}"]')
    expect(box).to_be_visible()
    box.select_option(item)


def fit(page):
    overflow = page.evaluate('''() => [document.documentElement.scrollWidth - innerWidth,
        document.querySelector('.content').scrollWidth - document.querySelector('.content').clientWidth]''')
    assert max(overflow) <= 1, overflow


def restore(page, backup):
    page.locator('.shell-settings').click()
    page.locator('#restore-file').set_input_files(backup)
    expect(page.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    bureau(page)


def save(page, name):
    page.locator('#preset-name').fill(name)
    button(page, 'save').click()
    expect(page.locator('[data-preset-notice]')).to_contain_text('저장')


def counts(s):
    count = Counter(s['stash'])
    for box in s['stashSlots']:
        count.update(item['g'] for item in box.get('contents', []))
    kit = s['field'] if s.get('raid') and not s['field'].get('result') else s['equipment']
    count.update(item['g'] for item in kit['bag'])
    count.update(kit['worn'].values())
    count.update(kit.get('modules', {}).values())
    return count


def required(page, id_, need, owned, missing):
    row = page.locator(f'[data-preset-need="{id_}"]')
    for attr, value in [('needed', need), ('owned', owned), ('missing', missing)]:
        expect(row).to_have_attribute('data-' + attr, str(value))


def deploy(page):
    page.locator('.content [data-page="prep"]:visible').first.click()
    page.locator('.lo-deploy[data-raid="start"]').click()
    assert read(page)['raid'] is not None


def apply(page, index):
    select_preset(page, index)
    button(page, 'apply').click()
    expect(page.locator('[data-preset-notice]')).to_contain_text('적용')


def complete_action(page):
    a = read(page)['field']['action']
    assert a
    page.clock.fast_forward(max(350, a['end'] - page.evaluate('Date.now()') + 350))


def scenario(browser, width, folder):
    original, page, errors = profile(browser, width)
    restored = None
    try:
        restore(page, FIXTURE)
        initial = counts(read(page))
        select_preset(page, 0)
        set_slot(page, 'light', 'flash')
        set_module(page, 'light', 'battery')
        set_slot(page, 'comms', 'radio')
        set_module(page, 'comms', 'battery')
        required(page, 'battery', 2, 1, 1)
        expect(button(page, 'apply')).to_be_disabled()
        assert counts(read(page)) == initial
        assert 'optic' not in page.locator('select[data-preset-module="comms"] option').evaluate_all('xs=>xs.map(x=>x.value)')
        set_slot(page, 'comms', '')
        required(page, 'battery', 1, 1, 0)
        fit(page)
        save(page, ALPHA)
        select_preset(page, 1)
        set_slot(page, 'comms', 'radio')
        set_module(page, 'comms', 'rl_13_02')
        set_slot(page, 'eyes', 'rl_13_07')
        set_module(page, 'eyes', 'optic')
        save(page, BRAVO)
        assert [p['name'] for p in read(page)['presets']] == [ALPHA, BRAVO]
        assert counts(read(page)) == initial
        apply(page, 0)
        assert read(page)['equipment']['modules'] == {'light': 'battery'}
        box = next(x for x in read(page)['stashSlots'] if x.get('alias') == '야간 정비함')
        assert [x['g'] for x in box['contents']] == ['optic', 'matches']
        # The workbench is a distinct UI route; detach/reattach the same real part.
        button(page, 'mode', '[data-mode="bench"]').click()
        set_module(page, 'light', '')
        expect(page.locator('[data-preset-return="battery"]')).to_be_visible()
        button(page, 'apply').click()
        assert read(page)['equipment']['modules'] == {} and read(page)['stash']['battery'] == 1
        set_module(page, 'light', 'battery')
        button(page, 'apply').click()
        assert counts(read(page)) == initial
        assert read(page)['equipment']['modules']['light'] == 'battery'
        fit(page)
        deploy(page)
        assert read(page)['field']['modules'] == {'light': 'battery'}
        page.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        complete_action(page)
        assert read(page)['field']['result'] == 'success'
        page.locator('[data-raid="ack"]:visible').first.click()
        bureau(page)
        assert read(page)['equipment']['modules']['light'] == 'battery'
        select_preset(page, 1)
        expect(page.locator('[data-preset-return="battery"]')).to_be_visible()
        apply(page, 1)
        equipped = read(page)
        assert equipped['equipment']['modules'] == {'comms': 'rl_13_02', 'eyes': 'optic'}
        assert equipped['stash']['battery'] == 1
        assert counts(equipped) == initial
        page.reload(wait_until='domcontentloaded')
        assert read(page)['presets'] == equipped['presets']
        assert read(page)['equipment'] == equipped['equipment']
        page.locator('.shell-settings').click()
        with page.expect_download() as downloaded:
            page.locator('[data-backup="export"]').click()
        backup = folder / f'presets-{width}.json'
        downloaded.value.save_as(backup)
        assert json.loads(backup.read_text())['session']['version'] == 35
        restored, fresh, fresh_errors = profile(browser, width)
        restore(fresh, backup)
        actual = read(fresh)
        for key in ['presets', 'equipment', 'stash', 'stashSlots', 'objectivePin']:
            assert actual[key] == equipped[key], key
        deploy(fresh)
        assert read(fresh)['field']['modules'] == equipped['equipment']['modules']
        fresh.locator('[data-field="abandon"]:visible').first.click()
        assert read(fresh)['field']['result'] == 'abandoned'
        fresh.locator('[data-raid="ack"]:visible').first.click()
        bureau(fresh)
        select_preset(fresh, 1)
        required(fresh, 'optic', 1, 0, 1)
        expect(button(fresh, 'apply')).to_be_disabled()
        assert read(fresh)['stash']['battery'] == 1
        fit(fresh)
        assert not errors and not fresh_errors, (errors, fresh_errors)
        print(f'PASS {width}px — v20 JSON migration, two named presets, one battery needed twice, compatible edits, workbench detach/refit, successful sortie, reload/export/new profile, second sortie loss and accurate shortages.', flush=True)
    finally:
        if restored:
            restored.close()
        original.close()


def storage_recovery(browser):
    context, page, errors = profile(browser, 390)
    try:
        restore(page, FIXTURE)
        select_preset(page, 0)
        set_slot(page, 'light', 'flash')
        set_module(page, 'light', 'battery')
        save(page, ALPHA)
        stock = read(page)
        page.evaluate('''key => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function(k, v) {
                if (this === localStorage && k === key) {
                    Storage.prototype.setItem = original;
                    throw new DOMException('Simulated test quota', 'QuotaExceededError');
                }
                return original.call(this, k, v);
            };
        }''', SAVE)
        button(page, 'apply').click()
        expect(page.locator('[data-preset-notice]')).to_contain_text('취소')
        assert read(page) == stock
        button(page, 'apply').click()
        assert read(page)['equipment']['modules'] == {'light': 'battery'}

        # The real Web Lock belongs to the first tab, then transfers on its close.
        observer = context.new_page()
        observer.on('pageerror', lambda e: errors.append(str(e)))
        observer.set_default_timeout(7000)
        observer.goto(URL + '#presets', wait_until='domcontentloaded', timeout=60000)
        expect(observer.locator('html')).to_have_class(re.compile(r'\bread-only\b'))
        expect(button(observer, 'apply')).to_be_disabled()
        assert read(observer)['equipment'] == read(page)['equipment']
        page.close()
        expect(button(observer, 'apply')).to_be_enabled()
        button(observer, 'mode', '[data-mode="bench"]').click()
        set_module(observer, 'light', '')
        button(observer, 'apply').click()
        resumed = read(observer)
        assert resumed['equipment']['modules'] == {}
        assert resumed['stash']['battery'] == 1
        assert counts(resumed) == counts(stock)
        assert not errors, errors
        print('PASS 390px — simulated one-write storage quota, visible rollback/retry, real browser two-tab write lock and handoff; action on new author tab returns exactly one battery.', flush=True)
    finally:
        context.close()


def v20_migration(browser, kind):
    base = json.loads(FIXTURE.read_text())['session']
    data = json.loads((FIXTURE.parent / 'presets-v20-field.json').read_text())[kind]
    source = {**base, **data['sessionChanges']}
    context, page, errors = profile(browser, 390, data['now'])
    try:
        page.locator('.shell-settings').click()
        page.locator('#restore-file').set_input_files({
            'name': f'v20-{kind}.json', 'mimeType': 'application/json',
            'buffer': json.dumps({'format': 'rustline-tc01', 'session': source}).encode()
        })
        expect(page.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('.pw-workshop')).to_contain_text('귀환')
        expect(page.locator('button[data-preset="apply"]')).to_have_count(0)
        state = read(page)
        assert state['presets'] == [None, None]
        assert legacy_gear_shape(state['field']) == {**source['field'], 'modules': {}, 'lootLocks':{'raidId':source['raid']['startedAt'], 'legacy':True, 'unlocked':[]}}
        assert legacy_gear_shape(state['equipment']) == {**source['equipment'], 'modules': {}}
        for key in ['raid', 'stash', 'stashSlots', 'objectivePin', 'wallet']:
            assert legacy_gear_shape(state[key]) == source[key]
        page.locator('.pw-workshop [data-page="raid"]').click()
        if kind == 'route':
            expect(page.locator('[data-route-status] time').first).to_have_attribute('data-route-eta', '1800000030000')
            complete_action(page)
            expect(page.locator('.road-supply')).to_contain_text('배터리')
            bag = len(read(page)['field']['bag'])
            page.locator('[data-field="journey-take"]').click()
            assert len(read(page)['field']['bag']) == bag + 1
            assert read(page)['field']['bag'][-1]['g'] == 'battery'
        else:
            action = state['field']['action']
            assert action['end'] - action['start'] == 1800
            previous = state['field']['boxes'][action['key']]['items']
            complete_action(page)
            current = read(page)['field']['boxes'][action['key']]['items']
            assert sum(bool(u['revealed']) for u in current) == sum(bool(u['revealed']) for u in previous) + 1
            assert next(u for u in current if u['uid'] == action['uid'])['revealed']
        assert not errors, errors
        print(f'PASS 390px — authentic in-flight v20 {kind} JSON, same physical state and deadlines after reload, one normal in-field action.', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    options = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        options['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        options['proxy'] = {'server': os.environ['RUSTLINE_PROXY']}
    with TemporaryDirectory() as temp, sync_playwright() as runner:
        browser = runner.chromium.launch(**options)
        try:
            for width in (list(map(int, sys.argv[1:])) or [1280, 390, 320]):
                scenario(browser, width, Path(temp))
            if len(sys.argv) == 1 or '390' in sys.argv[1:]:
                storage_recovery(browser)
                for kind in ['route', 'search']:
                    v20_migration(browser, kind)
        finally:
            browser.close()
