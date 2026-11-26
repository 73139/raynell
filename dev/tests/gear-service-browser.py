"""Exercise v0.25 from the terminal. No authored inventory or encounter state.
Normal gameplay creates both carbines and the spent resources. Timers may be
advanced for three viewport cases. --natural leaves clocks and RNG untouched.
The v24 fixture is an export from the previous release during a queued contact.
"""
import argparse
import json
import os
import runpy
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / 'tests/survivor-browser.py'))
loot = runpy.run_path(str(ROOT / 'tests/loot-goals-browser.py'))
at, snapshot, until = (helpers[n] for n in ('at', 'snapshot', 'until'))
MODEL = 'rl10_carbine'
FIXTURE = ROOT / 'tests/fixtures/gear-v24-engage.json'


def visit_field(page):
    if page.locator('#inside').get_attribute('data-page') != 'raid':
        page.locator('[data-page="raid"]:visible').first.click()


def service(page, action, uid):
    return page.locator(f'[data-maintenance="{action}"][data-uid="{uid}"]:visible').first


def select(page, uid):
    service(page, 'select', uid).click()
    panel = page.locator('[data-maintenance-selected]:visible')
    expect(panel).to_have_attribute('data-uid', uid)
    return panel


def gear(page, uid):
    session = snapshot(page)
    kit = session['field'] if session['raid'] and not session['field'].get('result') else session['equipment']
    records = list(kit.get('instances', {}).values())
    records += [tile.get('gear') for tile in session['stashSlots'] + kit['bag']]
    return next(record for record in records if record and record['uid'] == uid)


def deploy(page):
    at(page, 'map')
    page.locator('[data-cui="inspect"][data-index="0"]').click()
    page.locator('.command-deploy[data-page="prep"]').click()
    expect(page.locator('[data-gear-readiness]:visible').first).to_be_visible()
    page.locator('.lo-deploy[data-raid="start"]').click()


def finish_action(page, natural):
    action = snapshot(page)['field']['action']
    assert action, 'timed gameplay action was queued'
    until(page, action['end'] + 350, natural)


def contact(page, natural):
    for step in range(7):
        if snapshot(page)['field'].get('contact'):
            return
        scan = page.locator('[data-field="scan"]:visible').first
        if scan.is_disabled():
            page.locator('.landmark-picker summary').click()
            page.locator(f'[data-field="landmark"][data-index="{step}"]').click()
        scan.click()
        finish_action(page, natural)
    raise AssertionError('no encounter after seven scans')


def buy_duplicate(page):
    at(page, 'shop')
    page.locator('[data-market="trader"][data-id="quarter"]').click()
    item = page.locator(f'[data-market="item"][data-id="{MODEL}"]:visible')
    for _ in range(12):
        if item.count():
            break
        page.locator('[data-market="page"][data-step="1"]:visible').click()
    item.click()
    page.locator(f'[data-market="trade"][data-id="{MODEL}"]').click()
    data = snapshot(page)
    assert data['wallet'] == 13000 and data['stash'][MODEL] == 1
    return next(tile['gear']['uid'] for tile in data['stashSlots'] if tile['g'] == MODEL)


def fresh(browser, width, natural, folder):
    began = monotonic()
    ctx, page, errors = helpers['profile'](browser, width, wall=natural)
    contexts, error_sets = [ctx], [errors]
    try:
        original = snapshot(page)['equipment']['instances']['primary']['uid']
        spare = buy_duplicate(page)
        assert original != spare
        at(page, 'maintenance')
        expect(page.locator('[data-maintenance-page]')).to_be_visible()
        select(page, spare)
        service(page, 'equip', spare).click()
        assert snapshot(page)['equipment']['instances']['primary']['uid'] == spare
        deploy(page)
        contact(page, natural)
        page.locator('[data-field="engage"]:visible').click()
        assert gear(page, spare)['ammo'] == 30
        if not natural:
            page.reload(wait_until='domcontentloaded')
            visit_field(page)
        finish_action(page, natural)
        assert (gear(page, spare)['ammo'], gear(page, spare)['durability']) == (27, 98)
        assert (gear(page, original)['ammo'], gear(page, original)['durability']) == (30, 100)
        turns = 1
        while snapshot(page)['field'].get('contact'):
            assert turns < 4
            page.locator('[data-field="engage"]:visible').click()
            finish_action(page, natural)
            turns += 1
        spent, wear = 3 * turns, 2 * turns
        page.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        finish_action(page, natural)
        expect(page.locator('[data-raid="ack"]:visible')).to_be_visible()
        report=page.locator('.gear-use-report > div').filter(has_text=spare)
        expect(report).to_contain_text(f'탄약 30 → {30-spent}발 (사용 {spent}발)')
        expect(report).to_contain_text(f'내구도 100 → {100-wear} (소모 {wear})')
        expect(report).to_contain_text('회수')
        page.locator('[data-raid="ack"]:visible').first.click()
        at(page, 'maintenance')
        assert gear(page, spare)['ammo'] == 30 - spent
        # Move the other copy back into the active slot. The operation must leave
        # the damaged copy unmodified in the warehouse and target it by UID.
        select(page, original)
        service(page, 'equip', original).click()
        panel = select(page, spare)
        helpers['fit'](page)
        assert snapshot(page)['equipment']['instances']['primary']['uid'] == original
        assert gear(page, spare)['durability'] == 100 - wear
        expect(panel.locator('[data-gear-ammo]')).to_have_attribute('data-gear-ammo',str(30-spent))
        expect(panel.locator('[data-gear-durability]')).to_have_attribute('data-gear-durability',str(100-wear))
        expect(panel.locator('[data-service-quote="repair"]')).to_have_attribute('data-cost',str(wear*90))
        expect(panel.locator('[data-service-quote="reload"]')).to_have_attribute('data-cost',str(spent*40))
        if os.environ.get('RUSTLINE_SCREEN_DIR'):
            target = Path(os.environ['RUSTLINE_SCREEN_DIR'])
            target.mkdir(parents=True, exist_ok=True)
            panel.scroll_into_view_if_needed()
            page.screenshot(path=target / f'장비정비_{width}px.png',animations='disabled')
        wallet = snapshot(page)['wallet']
        if width == 390 and not natural:
            loot['deny_write'](page)
            service(page, 'repair', spare).click()
            assert snapshot(page)['wallet'] == wallet and gear(page, spare)['durability'] == 100 - wear
        service(page, 'repair', spare).click()
        assert snapshot(page)['wallet'] == wallet - wear * 90 and gear(page, spare)['durability'] == 100
        assert gear(page, spare)['ammo'] == 30 - spent
        expect(service(page, 'repair', spare)).to_be_disabled()
        expect(page.locator('[data-maintenance-status]')).to_contain_text('차감')
        service(page, 'reload', spare).click()
        final_cash = wallet - wear * 90 - spent * 40
        assert snapshot(page)['wallet'] == final_cash and gear(page, spare)['ammo'] == 30
        page.reload(wait_until='domcontentloaded')
        assert snapshot(page)['wallet'] == final_cash
        if width == 390 and not natural:
            payload = helpers['export_profile'](page, folder / 'maintenance.json')
            ctx2, page2, errors2 = helpers['profile'](browser, width, page.evaluate('Date.now()'))
            contexts.append(ctx2)
            error_sets.append(errors2)
            helpers['import_profile'](page2, payload)
            at(page2,'maintenance')
            for uid in (original, spare):
                assert gear(page2, uid) == gear(page, uid)
            assert snapshot(page2)['wallet'] == final_cash
        if width == 320:
            deploy(page)
            page.locator('[data-field="abandon"]:visible').first.click()
            assert snapshot(page)['field']['result'] == 'abandoned'
            expect(page.locator('.gear-use-report > div').filter(has_text=original)).to_contain_text('손실')
            expect(page.locator('.gear-use-report > div').filter(has_text=spare)).to_have_count(0)
            page.locator('[data-raid="ack"]:visible').first.click()
            assert gear(page, spare)['ammo'] == 30
            assert not snapshot(page)['equipment']['instances'].get('primary')
        assert not any(error_sets), error_sets
        print(f'PASS {width}px {"wall-clock" if natural else "clock-controlled"} fresh · two separately equipped UIDs, {turns} actions, ammo 30→{30-spent}, condition 100→{100-wear}; independent spare, return, repair {wear*90} CR, replenish {spent*40} CR, {final_cash} CR remaining. {monotonic()-began:.1f}s', flush=True)
    finally:
        for context in contexts:
            context.close()


def migrate(browser):
    data = json.loads(FIXTURE.read_text())
    old = data['session']
    ctx,page,errors = helpers['profile'](browser,390,old['field']['action']['start']+100)
    try:
        helpers['import_profile'](page,data)
        visit_field(page)
        new = snapshot(page)
        assert new['version']==35 and new['wallet']==old['wallet'] and new['raid']==old['raid']
        assert new['field']['action']['end']==old['field']['action']['end']
        assert new['field']['boxes']==old['field']['boxes']
        uid=new['field']['instances']['primary']['uid']
        assert gear(page,uid)['ammo']==30 and gear(page,uid)['durability']==100
        finish_action(page,False)
        assert gear(page,uid)['ammo']==30 and gear(page,uid)['durability']==100
        page.locator('[data-field="engage"]:visible').click()
        finish_action(page,False)
        assert gear(page,uid)['ammo']==27 and gear(page,uid)['durability']==98
        assert not errors,errors
        print('PASS 390px v24 migration · real old pending encounter kept original deadline with no retrospective cost, next normal action charged once; spare and original location retained.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('widths',nargs='*',type=int)
    cli.add_argument('--natural',action='store_true')
    cli.add_argument('--legacy',action='store_true')
    args=cli.parse_args()
    with sync_playwright() as w, TemporaryDirectory() as work:
        opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if os.getenv('RUSTLINE_CHROMIUM'):
            opts['executable_path']=os.environ['RUSTLINE_CHROMIUM']
        if os.getenv('RUSTLINE_PROXY'):
            opts['proxy']={'server':os.environ['RUSTLINE_PROXY']}
        browser=w.chromium.launch(**opts)
        try:
            if not args.legacy:
                for width in args.widths or ([390] if args.natural else [1280,390,320]):
                    fresh(browser,width,args.natural,Path(work))
            if args.legacy or (not args.widths and not args.natural):
                migrate(browser)
        finally:
            browser.close()
