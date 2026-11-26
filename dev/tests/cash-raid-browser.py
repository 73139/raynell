"""Prove physical CR extraction and loss in a fresh Chromium profile using only game controls.

python tests/cash-raid-browser.py 1366 390
python tests/cash-raid-browser.py 390 --natural

Defaults to Playwright's controlled clock for the extraction timer. --natural uses wall time.
Set RUSTLINE_URL to the public release and optionally RUSTLINE_CHROMIUM / RUSTLINE_PROXY.
"""
import argparse
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

tests = Path(__file__).resolve().parent
helpers = runpy.run_path(str(tests / 'gear-service-browser.py'))
at, snapshot, deploy, finish_action = (helpers[name] for name in ('at', 'snapshot', 'deploy', 'finish_action'))
profile = helpers['helpers']['profile']


def assert_cash(session, available, carried):
    bunker_notes = session['cash']['pocket'] + [u for u in session['stashSlots'] if u['g'] == 'cr_notes']
    packed = [u for u in session['equipment']['bag'] + session['field']['bag'] if u['g'] == 'cr_notes']
    assert session['wallet'] == sum(u['amount'] for u in bunker_notes) == available
    assert sum(u['amount'] for u in packed) == carried
    ids = [u['uid'] for u in bunker_notes + packed]
    assert len(ids) == len(set(ids))
    return packed


def pack_and_deploy(page):
    at(page, 'stash')
    drawer = page.locator('.cash-compartment:visible')
    drawer.locator('[data-cash="select"][data-cash-area="pocket"]').click()
    drawer.locator('[data-cash-amount]').fill('1000')
    drawer.locator('[data-cash="move"][data-to="bag"]').click()
    packed = assert_cash(snapshot(page), 29000, 1000)
    assert len(packed) == 1
    uid = packed[0]['uid']
    deploy(page)
    session = snapshot(page)
    assert session['raid']['zone'] == 0
    assert not session['equipment']['bag']
    assert assert_cash(session, 29000, 1000)[0]['uid'] == uid
    return session['raid']['startedAt']


def scenario(browser, width, natural):
    context, page, errors = profile(browser, width, wall=natural)
    try:
        assert_cash(snapshot(page), 30000, 0)
        first_raid = pack_and_deploy(page)
        page.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        finish_action(page, natural)
        expect(page.locator('[data-raid="ack"]:visible').first).to_be_visible()
        expect(page.get_by_text('휴대 지폐 회수 · 1,000 CR', exact=True)).to_be_visible()
        completed = snapshot(page)
        assert completed['field']['result'] == 'success' and completed['lastSummary']['carriedCash'] == 1000
        assert_cash(completed, 30000, 0)
        page.locator('[data-raid="ack"]:visible').first.click()
        assert pack_and_deploy(page) != first_raid
        page.locator('[data-field="abandon"]:visible').first.click()
        expect(page.get_by_text('휴대 지폐 손실 · 1,000 CR', exact=True)).to_be_visible()
        lost = snapshot(page)
        assert lost['field']['result'] == 'abandoned' and lost['lastSummary']['carriedCash'] == 1000
        assert_cash(lost, 29000, 0)
        page.locator('[data-raid="ack"]:visible').first.click()
        at(page, 'stash')
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('.cash-heading')).to_contain_text('29,000 CR')
        assert_cash(snapshot(page), 29000, 0)
        assert not errors, errors
        print(f'PASS {width}px {"wall-clock" if natural else "controlled clock"}: 1,000 CR packed from 30,000, '
              'same note UID in the field, B-04 extraction restores 30,000, next abandonment and reload retain 29,000.', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('widths', nargs='*', type=int)
    cli.add_argument('--natural', action='store_true')
    args = cli.parse_args()
    launch = {'headless': True, 'args': ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy'] = {'server': os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as runner:
        browser = runner.chromium.launch(**launch)
        try:
            for width in args.widths or [1366, 390]:
                scenario(browser, width, args.natural)
        finally:
            browser.close()
