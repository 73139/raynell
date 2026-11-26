"""Final operation UI acceptance, using real game actions and a reproducible advanced test profile.

Run after build.py. RUSTLINE_URL and Chromium/proxy settings match campaign-browser.py.
The fixture originates in the v0.21 and v0.22 exporters. tests/finale.cjs rebuilds
the advanced checkpoint from the earlier quest receipts and three fresh campaign payouts.
"""
import json
import os
import runpy
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / 'tests/campaign-browser.py'))
new_profile, restore, read, campaign, fit, tick = [helpers[k] for k in ['profile', 'restore', 'state', 'campaign', 'fit', 'tick_to']]
ADVANCED = json.loads((ROOT / 'tests/fixtures/finale-v22.json').read_text())


def profile(browser, width, now=None):
    # Network transfer time is unrelated to the saved simulation checkpoint.
    # Freeze both tabs at one instant so an eight-second leg cannot finish
    # while Chromium downloads the game into the second disposable profile.
    c, p, errors = new_profile(browser, width, now - 86400000 if now is not None else None)
    instant = now if now is not None else p.evaluate('Date.now()') + 1000
    p.clock.pause_at(datetime.fromtimestamp(instant / 1000, timezone.utc))
    return c, p, errors


def arm_and_start(p):
    panel = p.locator('[data-finale-status="available"]')
    panel.locator('[data-finale="arm"]').click()
    assigned = p.locator('[data-finale-status="armed"]')
    assigned.locator('[data-page="prep"]').click()
    # Zone choice persists after abandoning elsewhere; explicitly stage at the outskirts.
    p.locator('.lo-prep [data-page="map"]:visible').first.click()
    p.locator('.command-station[data-index="0"]').click()
    p.locator('.command-deploy[data-page="prep"]').click()
    p.locator('.lo-deploy[data-raid="start"]').click()
    data = read(p)
    rid = data['raid']['startedAt']
    assert data['finale']['attempt'] == {'raidId': rid, 'confirmed': []} and data['raid']['zone'] == 0
    return rid


def control(p, zone, rid):
    return p.locator(f'button[data-finale="signal"][data-zone="{zone}"][data-raid-id="{rid}"]')


def confirm_station(p, zone, rid):
    btn = control(p, zone, rid)
    expect(btn).to_be_enabled()
    btn.click()
    expect(p.locator(f'[data-finale-field] [data-finale-station="{zone}"]')).to_have_attribute('data-confirmed', 'true')
    assert read(p)['finale']['attempt']['confirmed'].count(zone) == 1


def leave_for(p, zone):
    state = read(p)
    origin = state['raid']['zone']
    # Freeze only RNG at departure to cover the directed routes with uninterrupted legs.
    p.evaluate('''()=>{if(!window.originalFinaleRng)window.originalFinaleRng=Math.random; Math.random=()=>.01}''')
    p.locator(f'[data-route-card][data-from="{origin}"][data-to="{zone}"] button[data-field="move"]:visible').first.click()
    assert read(p)['field']['action']['type'] == 'travel-step'
    p.evaluate('''()=>{Math.random=window.originalFinaleRng;delete window.originalFinaleRng}''')


def arrive(p, zone):
    for _ in range(4):
        s = read(p)
        if s['raid']['zone'] == zone and not s['field'].get('journey'):
            return
        a = s['field']['action']
        assert a['type'] == 'travel-step'
        tick(p, a['end'] + 350)
    assert read(p)['raid']['zone'] == zone


def extract_now(p):
    p.locator('[data-exit="b04"][data-field="extract"]:visible').first.click()
    a = read(p)['field']['action']
    assert a and a['type'] == 'extract'
    tick(p, a['end'] + 350)
    assert read(p)['field']['result'] == 'success'


def back_to_campaign(p):
    p.locator('[data-raid="ack"]:visible').first.click()
    campaign(p)


def backup(p, path):
    p.locator('.shell-settings').click()
    with p.expect_download() as download:
        p.locator('[data-backup="export"]').click()
    download.value.save_as(path)
    return json.loads(path.read_text())


def run(browser, width, folder):
    contexts, logs = [], []
    c, p, errs = profile(browser, width)
    contexts.append(c)
    logs.append(errs)
    try:
        restore(p, ADVANCED)
        gate = p.locator('[data-finale-status="locked"]')
        expect(gate).to_be_visible()
        expect(gate.locator('[data-finale-trader][data-done="true"]')).to_have_count(3)
        expect(gate.locator('[data-finale-trader="repair"]')).to_have_attribute('data-done', 'false')
        expect(gate.locator('[data-finale="arm"]')).to_have_count(0)
        gate.locator('[data-finale="trader"][data-id="repair"]').click()
        target = p.locator('[data-contract="claim"][data-id="repair-first-call"]:visible')
        if not target.count():
            p.locator('[data-contract="open"][data-id="repair-first-call"]:visible').first.click()
        target.click()
        assert read(p)['contracts']['repair']['done'] == ['repair-first-call']
        campaign(p)
        expect(p.locator('[data-finale-status="available"]')).to_be_visible()
        fit(p)
        if width == 390:
            # Leaving on a partial sortie is a valid return with no final-operation reply.
            rid = arm_and_start(p)
            confirm_station(p, 0, rid)
            extract_now(p)
            expect(p.locator('[data-finale-settlement="retry"]')).to_be_visible()
            assert read(p)['finale']['reply'] is None
            back_to_campaign(p)
            # All confirmations are scoped to one sortie; abandonment clears its record.
            rid = arm_and_start(p)
            confirm_station(p, 0, rid)
            leave_for(p, 1)
            arrive(p, 1)
            confirm_station(p, 1, rid)
            p.locator('[data-field="abandon"]:visible').first.click()
            expect(p.locator('[data-finale-settlement="retry"]')).to_be_visible()
            assert read(p)['finale']['reply'] is None and read(p)['finale']['attempt'] is None
            back_to_campaign(p)
        rid = arm_and_start(p)
        # Different order on desktop; there is no required ordering between the three stations.
        order = [2,1] if width == 1280 else [1,2]
        confirm_station(p, 0, rid)
        for num, z in enumerate(order):
            leave_for(p, z)
            if num == 0:
                before = read(p)
                if width == 390:
                    payload = backup(p, folder / 'field-operation.json')
                    c, p, errs = profile(browser, width, p.evaluate('Date.now()'))
                    contexts.append(c)
                    logs.append(errs)
                    restore(p, payload)
                else:
                    p.reload(wait_until='domcontentloaded')
                p.locator('[data-finale-status="active"] button[data-page="raid"]:visible').first.click()
                current = read(p)
                assert current['field']['journey']['schedule'] == before['field']['journey']['schedule']
                assert current['field']['action']['end'] == before['field']['action']['end']
                assert current['finale']['attempt'] == {'raidId': rid, 'confirmed':[0]}
            arrive(p, z)
            confirm_station(p, z, rid)
        assert read(p)['finale']['attempt']['confirmed'] == [0,1,2]
        assert read(p)['finale']['reply'] is None
        leave_for(p, 0)
        arrive(p, 0)
        wallet = read(p)['wallet']
        extract_now(p)
        settlement = p.locator('[data-finale-settlement="complete"]')
        expect(settlement).to_be_visible()
        assert read(p)['lastSummary']['finaleReply'] is True
        assert read(p)['wallet'] == wallet
        back_to_campaign(p)
        reply = p.locator('[data-finale-reply]')
        expect(reply).to_be_visible()
        expect(reply).to_contain_text('외부 벙커')
        text = reply.locator('blockquote').inner_text()
        p.reload(wait_until='domcontentloaded')
        expect(p.locator('[data-finale-reply] blockquote')).to_have_text(text)
        assert read(p)['finale'] == {'armed':False,'attempt':None,'reply':{'raidId':rid}}
        if width == 390:
            payload = backup(p, folder / 'ending.json')
            c, p, errs = profile(browser, width, p.evaluate('Date.now()'))
            contexts.append(c)
            logs.append(errs)
            restore(p,payload)
            expect(p.locator('[data-finale-reply] blockquote')).to_have_text(text)
            assert read(p)['finale']['reply']['raidId'] == rid
        fit(p)
        assert all(not e for e in logs), logs
        print(f'PASS {width}px — claimed fourth trader, entered explicitly, verified three actual regions in a single sortie, preserved live route/deadline, returned to B-04 and observed final reply after reload.' + (' Includes partial return, abandonment, re-arm and two independent JSON restorations.' if width == 390 else ''), flush=True)
    finally:
        for context in contexts:
            context.close()


if __name__ == '__main__':
    launch = {'headless': True, 'args':['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy'] = {'server':os.environ['RUSTLINE_PROXY']}
    with TemporaryDirectory() as temp, sync_playwright() as runner:
        browser = runner.chromium.launch(**launch)
        try:
            for width in (list(map(int,sys.argv[1:])) or [1280,390,320]):
                run(browser,width,Path(temp))
        finally:
            browser.close()
