"""End-to-end RL-TC01 v0.26 injury paths from fresh browser profiles.

    python3 tests/injuries-browser.py
    python3 tests/injuries-browser.py 390 --natural
    python3 tests/injuries-browser.py --legacy

Normal store, equipment, exploration and encounter buttons produce all supplies
and injuries. The three default viewport runs advance timers. The separate
--natural run uses the unmodified game clock and random source. The previous
game exported the legacy JSON during a second engagement after actual damage.
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
shared = runpy.run_path(str(ROOT / 'tests/survivor-browser.py'))
gear = runpy.run_path(str(ROOT / 'tests/gear-service-browser.py'))
loot = runpy.run_path(str(ROOT / 'tests/loot-goals-browser.py'))
at, snapshot, until = (shared[key] for key in ('at', 'snapshot', 'until'))
KEY = 'rl-reboot-session-v36'
FIXTURE = ROOT / 'tests/fixtures/injuries-v25-contact.json'


def button(page, action):
    return page.locator(f'[data-injury="{action}"]:visible').first


def part(page, name):
    return page.locator(f'[data-injury="part"][data-part="{name}"]:visible').first


def open_health(page):
    at(page, 'health')
    expect(page.locator('[data-injury-panel]:visible').first).to_be_visible()


def close_health(page):
    gear['visit_field'](page)


def open_prep(page):
    at(page, 'map')
    page.locator('[data-cui="inspect"][data-index="0"]').click()
    page.locator('.command-deploy[data-page="prep"]').click()


def buy_and_pack(page):
    assert snapshot(page)['wallet'] == 30000
    at(page, 'shop')
    page.locator('[data-market="trader"][data-id="medic"]').click()
    page.locator('[data-market="item"][data-id="bandage"]:visible').click()
    page.locator('[data-market="quantity"][data-step="1"]').click()
    page.locator('[data-market="trade"][data-id="bandage"]').click()
    assert snapshot(page)['wallet'] == 21000 and snapshot(page)['stash']['bandage'] == 2
    open_prep(page)
    for _ in range(2):
        page.locator('[data-gear="pack"][data-id="bandage"]:visible').first.click()
    packed = snapshot(page)['equipment']['bag']
    assert len(packed) == 2 and all(unit['g'] == 'bandage' for unit in packed)
    uids = [unit['uid'] for unit in packed]
    assert len(set(uids)) == 2
    tab = page.locator('[data-loadout="mobile-tab"][data-screen="prep"][data-index="1"]:visible')
    if tab.count():
        tab.click()
    page.locator(f'[data-gear="select"][data-unit="{uids[0]}"]:visible').click()
    page.locator('[data-loadout="assign"][data-id="bandage"]:visible').first.click()
    page.locator('[data-loadout="quick"][data-index="0"]:visible').first.click()
    assert snapshot(page)['equipment']['quickslots'][0] == 'bandage'
    checklist=page.locator('[data-loadout="mobile-tab"][data-screen="prep"][data-index="2"]:visible')
    if checklist.count():
        checklist.click()
    page.locator('.lo-deploy[data-raid="start"]').click()
    assert snapshot(page)['field']['hp'] == 100
    return uids


def timed(page, natural):
    action = snapshot(page)['field']['action']
    assert action, 'a timed action must be queued'
    until(page, action['end'] + 350, natural)


def reach_contact(page, previous_sites, natural):
    for _ in range(8):
        if snapshot(page)['field'].get('contact'):
            return
        scan = page.locator('[data-field="scan"]:visible').first
        if scan.is_disabled():
            page.locator('.landmark-picker summary').click()
            points = page.locator('[data-field="landmark"]:visible')
            choice = next(i for i in range(points.count()) if i not in previous_sites)
            page.locator(f'[data-field="landmark"][data-index="{choice}"]:visible').click()
            previous_sites.add(choice)
        scan.click()
        timed(page, natural)
    raise AssertionError('normal landmark exploration did not reach a field contact')


def engage(page, natural):
    page.locator('[data-field="engage"][data-slot="primary"]:visible').click()
    timed(page, natural)


def hit_events(page):
    return [e for e in snapshot(page)['injuryState']['events'] if e['kind'] == 'hit']


def treatment_events(page):
    return [e for e in snapshot(page)['injuryState']['events'] if e['kind'] == 'treat']


def expect_body(page, arm, leg):
    expect(part(page, 'arm')).to_have_attribute('data-state', arm)
    expect(part(page, 'leg')).to_have_attribute('data-state', leg)


def select_exact(page, uid):
    part(page, 'arm').click()
    page.locator(f'[data-injury="item"][data-unit="{uid}"]:visible').click()
    start = page.locator(f'[data-injury="start"][data-unit="{uid}"][data-part="arm"]:visible')
    expect(start).to_be_enabled()
    return start


def bag_uids(page):
    return [u['uid'] for u in snapshot(page)['field']['bag'] if u['g'] == 'bandage']


def assert_pending(page, action, uids, hp):
    s = snapshot(page)
    assert s['field']['action'] == action and s['field']['hp'] == hp
    assert bag_uids(page) == uids and not treatment_events(page)


def quota_pause(page):
    # Block the session storage write until explicitly released, so the browser
    # ticker cannot hide a failed completion by retrying before assertions.
    page.evaluate("""key => {
        const saved = Storage.prototype.setItem;
        window.releaseWriteBarrier = () => { Storage.prototype.setItem=saved };
        Storage.prototype.setItem=function(k, v) {
            if (this===localStorage && k===key) throw new DOMException('QA','QuotaExceededError');
            return saved.call(this,k,v);
        };
    }""", KEY)


def copy_profile(page, browser, folder, name, contexts, errors):
    payload = shared['export_profile'](page, folder/f'{name}.json')
    ctx, other, errs = shared['profile'](browser, 390, page.evaluate('Date.now()'))
    contexts.append(ctx)
    errors.append(errs)
    shared['import_profile'](other, payload)
    open_health(other)
    return other


def run_fresh(browser, width, natural, folder):
    began = monotonic()
    ctx, p, errs = shared['profile'](browser, width, wall=natural)
    contexts, errors = [ctx], [errs]
    try:
        units = buy_and_pack(p)
        sites = {0}
        reach_contact(p, sites, natural)
        engage(p, natural)
        assert [e['part'] for e in hit_events(p)] == ['arm']
        while snapshot(p)['field'].get('contact'):
            engage(p, natural)
        reach_contact(p, sites, natural)
        engage(p, natural)
        assert [e['part'] for e in hit_events(p)] == ['arm', 'leg']
        hp = snapshot(p)['field']['hp']
        assert 0 < hp < 100
        # The real quick slot opens target selection; it spends nothing.
        p.keyboard.press('1')
        expect(p.locator('[data-injury-panel]:visible').first).to_be_visible()
        expect_body(p, 'wounded', 'wounded')
        expect(part(p,'arm')).to_contain_text('내용물 수색 시간 +25%')
        expect(part(p,'leg')).to_contain_text('도주 시간 +1초')
        assert snapshot(p)['field']['action'] is None and bag_uids(p) == units
        uid = units[1]  # take the second physical copy, even though the shortcut matched the first
        start = select_exact(p, uid)
        shared['fit'](p)
        if width == 390 and not natural:
            loot['deny_write'](p)
            start.click()
            assert snapshot(p)['field']['action'] is None and bag_uids(p) == units
            start = select_exact(p, uid)
        start.click()
        action = snapshot(p)['field']['action']
        assert action['type'] == 'treat' and action['end']-action['start'] == 3000
        assert_pending(p, action, units, hp)
        if width == 1280:
            button(p, 'cancel').click()
            assert snapshot(p)['field']['action'] is None and bag_uids(p) == units
            assert not treatment_events(p)
            select_exact(p,uid).click()
            action=snapshot(p)['field']['action']
        if not natural:
            open_health(p)
            expect(p.locator('[data-injury-pending]:visible').first).to_be_visible()
            assert_pending(p, action, units, hp)
        if width == 390 and not natural:
            p=copy_profile(p,browser,folder,'pending',contexts,errors)
            assert_pending(p, action, units, hp)
            quota_pause(p)
            timed(p,False)
            assert_pending(p, action, units, hp)
            p.evaluate('window.releaseWriteBarrier()')
            until(p,p.evaluate('Date.now()')+550,False)
        else:
            timed(p,natural)
        assert bag_uids(p) == [units[0]]
        ledger = treatment_events(p)
        assert len(ledger) == 1 and ledger[0]['uid'] == uid and ledger[0]['part'] == 'arm'
        assert ledger[0]['item'] == 'bandage' and ledger[0]['gain'] == min(18,100-hp)
        assert snapshot(p)['field']['hp']==hp+ledger[0]['gain']
        expect_body(p,'recovered','wounded')
        p.reload(wait_until='domcontentloaded')
        assert len(treatment_events(p)) == 1 and bag_uids(p) == units[:1]
        open_health(p)
        expect_body(p,'recovered','wounded')
        close_health(p)
        # Keep this contact deterministic through normal gameplay: the second
        # strike finishes the drone without another incoming hit.
        while snapshot(p)['field'].get('contact'):
            engage(p,natural)
        final_state = snapshot(p)['injuryState']
        assert len(final_state['events']) == 3
        p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        timed(p,natural)
        report = p.locator('[data-injury-report]:visible').first
        expect(report).to_be_visible()
        expect(report).to_contain_text('보급품 1개 사용')
        expect(report).to_contain_text('치료 1회')
        expect(report).to_contain_text('남은 부상 1곳')
        expect(report.locator('[data-part="arm"][data-state]')).to_have_attribute('data-state','recovered')
        expect(report.locator('[data-part="leg"][data-state]')).to_have_attribute('data-state','wounded')
        s=snapshot(p)
        assert s['lastSummary']['injuries']==final_state
        assert s['stash'].get('bandage')==1 and s['wallet']==21000
        p.locator('[data-raid="ack"]:visible').first.click()
        open_health(p)
        expect(p.locator('[data-injury-report]:visible').first).to_be_visible()
        if width == 390 and not natural:
            p=copy_profile(p,browser,folder,'settlement',contexts,errors)
            assert snapshot(p)['lastSummary']['injuries']==final_state
            assert snapshot(p)['stash']['bandage']==1
        if not natural:
            gear['deploy'](p)
            open_health(p)
            expect_body(p,'normal','normal')
            assert not snapshot(p)['injuryState']['events'] and snapshot(p)['field']['hp']==100
            assert snapshot(p)['lastSummary']['injuries']==final_state
        assert not any(errors),errors
        print(f'PASS {width}px {"natural-clock and RNG" if natural else "timer-advanced"} fresh · two 4,500 CR bandages; independent arm and leg hits, second bandage UID treated arm once, HP {hp}→{hp+ledger[0]["gain"]}, other UID returned, leg still wounded, 21,000 CR. {monotonic()-began:.1f}s',flush=True)
    finally:
        for context in contexts:
            context.close()


def run_legacy(browser):
    data=json.loads(FIXTURE.read_text())
    old=data['session']
    assert old['version']==25
    ctx,p,errors=shared['profile'](browser,390,old['field']['action']['start']+100)
    try:
        shared['import_profile'](p,data)
        new=snapshot(p)
        assert new['version']==36 and new['field']['hp']==old['field']['hp']==84
        assert new['wallet']==old['wallet'] and new['raid']==old['raid']
        assert new['field']['bag']==old['field']['bag'] and new['field']['action']==old['field']['action']
        assert new['injuryState']['legacy'] and not new['injuryState']['events']
        gear['visit_field'](p)
        timed(p,False)
        assert not snapshot(p)['field']['contact']
        assert snapshot(p)['field']['instances']['primary']['ammo']==24
        assert snapshot(p)['field']['hp']==84
        open_health(p)
        expect(p.locator('[data-injury-panel]')).to_have_attribute('data-mode','legacy')
        p.locator('[data-loadout="mobile-tab"][data-screen="health"][data-index="2"]:visible').click()
        med_uid=old['field']['bag'][0]['uid']
        p.locator(f'[data-gear="consume"][data-unit="{med_uid}"]:visible').first.click()
        assert snapshot(p)['field']['hp']==100 and not bag_uids(p)
        assert not snapshot(p)['injuryState']['events']
        close_health(p)
        p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        timed(p,False)
        p.locator('[data-raid="ack"]:visible').first.click()
        gear['deploy'](p)
        assert not snapshot(p)['injuryState']['legacy'] and snapshot(p)['field']['hp']==100
        reach_contact(p,{0},False)
        engage(p,False)
        assert [e['part'] for e in hit_events(p)]==['arm']
        assert not errors,errors
        print('PASS 390px genuine v25 migration · 84 HP, gear, physical bag, 21,000 CR and original 3s engagement timer preserved; old bandage restored HP 84→100 with no invented injury, next sortie records first actual arm hit.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('widths',type=int,nargs='*')
    cli.add_argument('--natural',action='store_true')
    cli.add_argument('--legacy',action='store_true')
    args=cli.parse_args()
    with sync_playwright() as w, TemporaryDirectory() as folder:
        opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if os.getenv('RUSTLINE_CHROMIUM'):
            opts['executable_path']=os.environ['RUSTLINE_CHROMIUM']
        if os.getenv('RUSTLINE_PROXY'):
            opts['proxy']={'server':os.environ['RUSTLINE_PROXY']}
        b=w.chromium.launch(**opts)
        try:
            if not args.legacy:
                for width in args.widths or ([390] if args.natural else [1280,390,320]):
                    run_fresh(b,width,args.natural,Path(folder))
            if args.legacy or (not args.widths and not args.natural):
                run_legacy(b)
        finally:
            b.close()
