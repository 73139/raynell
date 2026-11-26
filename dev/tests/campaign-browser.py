"""Campaign acceptance through the packed game's UI, using disposable browser profiles.
RUSTLINE_URL can point at the production game. Optional arguments are viewport widths.
Requires the Playwright Python package and Chromium. Set RUSTLINE_CHROMIUM, RUSTLINE_PROXY
or RUSTLINE_IGNORE_HTTPS_ERRORS=1 when needed. Game timers use Playwright's browser clock.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'tests/fixtures/campaign-v21.json').read_text())
URL = urldefrag(os.getenv('RUSTLINE_URL') or (ROOT / 'index.html').as_uri()).url
KEY = 'rl-reboot-session-v35'
CHAPTERS = [('power', 'food', 5000, 35), ('water', 'water', 6500, 45), ('med', 'bandage', 8000, 60)]


def profile(browser, width, now=None, use_clock=True):
    c = browser.new_context(viewport={'width': width, 'height': 844}, reduced_motion='reduce',
                            ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1')
    p = c.new_page()
    p.set_default_timeout(6500)
    errors = []
    p.on('pageerror', lambda e: errors.append(str(e)))
    p.on('dialog', lambda d: d.accept())
    if use_clock:
        p.clock.install(time=datetime.fromtimestamp(now / 1000, timezone.utc) if now else None)
    res = p.goto(URL + '#campaign', wait_until='domcontentloaded', timeout=60000)
    if URL.startswith('http'):
        assert res and res.ok
    p.wait_for_function('k=>!!localStorage.getItem(k)', arg=KEY)
    return c, p, errors


def state(p):
    return p.evaluate('k=>JSON.parse(localStorage.getItem(k))', KEY)


def campaign(p):
    if p.locator('#inside').get_attribute('data-page') != 'campaign':
        back = p.locator('.content button[data-page="campaign"]:visible')
        if back.count():
            back.first.click()
        else:
            p.reload(wait_until='domcontentloaded')
    expect(p.locator('#inside')).to_have_attribute('data-page', 'campaign')


def restore(p, payload):
    p.locator('.shell-settings').click()
    p.locator('#restore-file').set_input_files({
        'name': 'progress.json', 'mimeType': 'application/json',
        'buffer': json.dumps(payload, ensure_ascii=False).encode()
    })
    expect(p.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    campaign(p)


def fit(p):
    overflow = p.evaluate('''()=>[document.documentElement.scrollWidth - innerWidth,
             document.querySelector('.content').scrollWidth - document.querySelector('.content').clientWidth]''')
    assert max(overflow) <= 1, overflow


def tick_to(p, ms):
    now = p.evaluate('Date.now()')
    if ms > now:
        p.clock.fast_forward(ms - now)


def ready(p, stage):
    return p.locator(f'[data-campaign="claim"][data-id="{stage}"]:visible')


def donated(p, stage, expected):
    card = p.locator('[data-campaign-shipment]')
    expect(card).to_have_attribute('data-delivered', str(expected))
    expect(card).to_have_attribute('data-required', '2')
    assert state(p)['campaign']['delivered'] == expected


def deliver_one(p, stage):
    p.locator(f'[data-campaign="deliver"][data-id="{stage}"][data-qty="1"]:visible').first.click()


def sortie(p, success):
    prep = p.locator('.content [data-page="prep"]:visible')
    if prep.count():
        prep.first.click()
    else:
        p.locator('.nav [data-page="map"]:visible').first.click()
        p.locator('.command-deploy[data-page="prep"]').click()
    p.locator('.lo-deploy[data-raid="start"]').click()
    record = state(p)
    assert record['raid'] and record['objectivePin']['kind'] == 'campaign'
    if success:
        p.locator('[data-exit="b04"][data-field="extract"]:visible').first.click()
        tick_to(p, state(p)['field']['action']['end'] + 350)
    else:
        p.locator('[data-field="abandon"]:visible').first.click()
    assert state(p)['field']['result'] == ('success' if success else 'abandoned')
    if success:
        expect(p.locator('[data-campaign-summary]')).to_be_visible()
    p.locator('[data-raid="ack"]:visible').first.click()
    campaign(p)
    return record['raid']['startedAt']


def inventory(s, id_):
    return (s['stash'].get(id_, 0) + sum(u['g'] == id_ for u in s['equipment']['bag'])
            + sum(u['g'] == id_ for box in s['stashSlots'] for u in box.get('contents', [])))


def start_job(p, stage):
    old = state(p)
    p.locator(f'[data-bui="facility"][data-id="{stage}"][data-tier="1"]:visible').first.click()
    expect(p.locator('#inside')).to_have_attribute('data-page', 'facility')
    p.locator(f'button[data-hideout="build"][data-id="{stage}"][data-tier="1"]').click()
    s = state(p)
    end = s['hideout']['builds'][stage]['end']
    assert s['wallet'] == old['wallet'] - 20000
    assert s['hideout']['levels'][stage] == 0
    campaign(p)
    return end


def campaign_run(browser, width, folder):
    contexts = []
    c, p, errors = profile(browser, width)
    contexts.append(c)
    logs = [errors]
    try:
        restore(p, DATA['baseline'])
        s = state(p)
        assert s['career']['returns'] == 1 and s['campaign']['returnId'] is None
        assert [v['name'] for v in s['presets']] == ['전력 복구반', '정수 복구반']
        p.locator('[data-objective="pin"][data-kind="campaign"]:visible').first.click()
        receipts = []
        for i, (stage, item, cash, xp) in enumerate(CHAPTERS):
            expect(p.locator(f'[data-campaign-stage="{stage}"]')).to_be_visible()
            expect(ready(p, stage)).to_be_disabled()
            donated(p, stage, 0)
            end = start_job(p, stage)
            stock = inventory(state(p), item)
            deliver_one(p, stage)
            donated(p, stage, 1)
            assert inventory(state(p), item) == stock - 1
            if i == 0:
                assert all(u['g'] != 'food' for u in state(p)['equipment']['bag'])
                assert any(u['g'] == 'food' for box in state(p)['stashSlots'] for u in box.get('contents', []))
                sortie(p, False)
                expect(p.locator('[data-campaign-sortie]')).to_have_attribute('data-returned', 'false')
                deposited = state(p)
                p.locator('.shell-settings').click()
                with p.expect_download() as captured:
                    p.locator('[data-backup="export"]').click()
                backup = folder / f'chapter-{width}.json'
                captured.value.save_as(backup)
                payload = json.loads(backup.read_text())
                assert payload['session']['version'] == 35
                c, p, fresh_errors = profile(browser, width, p.evaluate('Date.now()'))
                contexts.append(c)
                logs.append(fresh_errors)
                restore(p, payload)
                s = state(p)
                for key in ['campaign', 'stash', 'stashSlots', 'equipment', 'objectivePin', 'hideout']:
                    assert s[key] == deposited[key], key
                donated(p, 'power', 1)
                fit(p)
            deliver_one(p, stage)
            donated(p, stage, 2)
            assert inventory(state(p), item) == stock - 2
            success_id = sortie(p, True)
            expect(p.locator('[data-campaign-sortie]')).to_have_attribute('data-returned', 'true')
            expect(ready(p, stage)).to_be_disabled()
            p.reload(wait_until='domcontentloaded')
            assert state(p)['hideout']['builds'][stage]['end'] == end
            tick_to(p, end + 350)
            expect(ready(p, stage)).to_be_enabled()
            before = state(p)
            assert before['hideout']['levels'][stage] == 1
            assert before['campaign']['returnId'] == success_id
            ready(p, stage).click()
            claimed = state(p)
            receipts.append(success_id)
            assert claimed['campaign']['claimed'] == receipts
            assert claimed['wallet'] == before['wallet'] + cash
            assert claimed['career']['xp'] == before['career']['xp'] + xp
            assert claimed['objectivePin'] == ({'kind': 'campaign', 'id': CHAPTERS[i+1][0]} if i < 2 else None)
            fit(p)
        expect(p.locator('[data-campaign-complete]')).to_be_visible()
        assert len(set(receipts)) == 3
        p.reload(wait_until='domcontentloaded')
        expect(p.locator('[data-campaign-complete]')).to_be_visible()
        assert state(p)['campaign']['claimed'] == receipts
        assert state(p)['wallet'] == 59500
        assert all(not messages for messages in logs), logs
        print(f'PASS {width}px — three level-one builds, six donations, one abandonment, three separate B-04 extractions, restored mid-job backup, auto pin continuation and three exact payouts. Final wallet 59,500 CR.', flush=True)
    finally:
        for context in contexts:
            context.close()


def fresh_player(browser):
    # Run this profile without virtual time and without importing any items, money or facilities.
    c, p, errors = profile(browser, 390, use_clock=False)
    try:
        assert state(p)['wallet'] == 30000 and state(p)['career']['sorties'] == 0
        p.goto(URL + '#shop', wait_until='domcontentloaded', timeout=60000)
        for _ in range(2):
            p.locator('[data-market="item"][data-id="food"]:visible').click()
            p.locator('[data-market="trade"][data-id="food"]:visible').click()
        assert state(p)['wallet'] == 18000 and state(p)['stash']['food'] == 2
        p.goto(URL + '#campaign', wait_until='domcontentloaded', timeout=60000)
        batch = p.locator('[data-campaign="deliver"][data-qty="2"][data-id="power"]')
        expect(batch).to_be_enabled()
        before = state(p)
        p.evaluate('''key => {
            const set = Storage.prototype.setItem;
            Storage.prototype.setItem = function(k, v) {
                if (this === localStorage && k === key) {
                    Storage.prototype.setItem = set;
                    throw new DOMException('Test storage full', 'QuotaExceededError');
                }
                return set.call(this,k,v);
            };
        }''', KEY)
        batch.click()
        expect(p.locator('[data-campaign-notice]')).to_contain_text('복원')
        assert state(p) == before
        batch.click()
        donated(p, 'power', 2)
        assert inventory(state(p), 'food') == 0 and state(p)['wallet'] == 18000
        expect(ready(p, 'power')).to_be_disabled()
        p.locator('[data-objective="pin"][data-kind="campaign"]:visible').first.click()
        p.locator('.content [data-page="map"]:visible').first.click()
        p.locator('.command-deploy[data-page="prep"]').click()
        p.locator('.lo-deploy[data-raid="start"]').click()
        p.locator('[data-exit="b04"][data-field="extract"]:visible').first.click()
        a = state(p)['field']['action']
        assert a['end'] - a['start'] == 10000
        p.wait_for_function("k=>JSON.parse(localStorage.getItem(k)).field.result==='success'", arg=KEY, timeout=17000)
        expect(p.locator('[data-campaign-summary="power"]')).to_be_visible()
        p.locator('[data-raid="ack"]:visible').first.click()
        campaign(p)
        assert state(p)['campaign']['returnId'] == state(p)['lastSummary']['raidId']
        expect(ready(p, 'power')).to_be_disabled()
        assert state(p)['wallet'] == 18000
        assert not errors, errors
        print('PASS fresh 390px — actual trader sold two rations for 12,000 CR, a full-storage error rolled back the batch, retry removed exactly two, natural 10-second extraction credited one return; unfinished power facility blocked claim.', flush=True)
    finally:
        c.close()


def prebuilt(browser):
    c, p, errors = profile(browser, 390)
    try:
        s = {**DATA['baseline']['session'], **DATA['prebuilt']['changes']}
        restore(p, {'format': 'rustline-tc01', 'session': s})
        actual = state(p)
        assert all(actual['hideout']['levels'][id_] == 1 for id_, *_ in CHAPTERS)
        assert actual['campaign'] == {'claimed': [], 'delivered': 0, 'returnId': None}
        expect(ready(p, 'power')).to_be_disabled()
        assert actual['wallet'] == s['wallet']
        p.reload(wait_until='domcontentloaded')
        assert state(p)['campaign'] == actual['campaign']
        assert not errors, errors
        print('PASS 390px — actual v21 all-three-facilities legacy JSON, levels and original wallet retained, earlier return pays no campaign reward.', flush=True)
    finally:
        c.close()


if __name__ == '__main__':
    launch = {'headless': True, 'args': ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy'] = {'server': os.environ['RUSTLINE_PROXY']}
    with TemporaryDirectory() as temp, sync_playwright() as runner:
        browser = runner.chromium.launch(**launch)
        try:
            for width in (list(map(int, sys.argv[1:])) or [1280, 390, 320]):
                campaign_run(browser, width, Path(temp))
            if len(sys.argv) == 1 or '390' in sys.argv[1:]:
                prebuilt(browser)
                fresh_player(browser)
        finally:
            browser.close()
