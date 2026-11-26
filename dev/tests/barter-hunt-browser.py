"""Real UI acceptance of the barter ingredient hunt. Supports local or published RUSTLINE_URL."""
import argparse
import os
import runpy
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
common = runpy.run_path(str(ROOT / 'tests/survivor-browser.py'))
loot = runpy.run_path(str(ROOT / 'tests/loot-goals-browser.py'))
snapshot = common['snapshot']
at = common['at']
FABRIC = 'rl_x_fabric'
RECIPE = 'rl_x_ammo'


def see_offer(p):
    at(p, 'shop')
    p.locator('[data-market="trader"][data-id="quarter"]:visible').click()
    p.locator('[data-market="mode"][data-mode="barter"]:visible').click()


def material(p, item):
    p.locator(f'[data-bh="track"][data-item="{item}"]:visible').click()
    expect(p.locator(f'[data-hunt-page="{item}"]')).to_be_visible()


def acquire(p):
    loot['tab'](p, 'prep', 2)
    # Fix only RNG. The game itself produces, hides, reveals, moves and settles this UID.
    p.evaluate('()=>{Math.random=()=>0.9571911799795081}')
    p.locator('.lo-deploy[data-raid="start"]:visible').click()
    p.evaluate('()=>{Math.random=()=>0.1}')
    inp = snapshot(p)
    assert inp['field']['landmarkByZone'][0] == 1 and inp['raid']['zone'] == 0
    unit = inp['field']['boxes']['0-2']['items'][0]
    assert unit['g'] == FABRIC and not unit['revealed']
    while 2 not in snapshot(p)['field']['found'][0]:
        p.locator('[data-field="scan"]:visible').click()
        common['until'](p, snapshot(p)['field']['action']['end']+350)
        loot['evade'](p, False)
    p.locator('[data-field="open"][data-index="2"]:visible').click()
    loot['tab'](p, 'loot', 2)
    expect(p.locator('[data-hunt-badge]')).to_have_count(0)
    uid = unit['uid']
    search = p.locator(f'[data-field="search"][data-uid="{uid}"]:visible')
    expect(search).to_have_attribute('aria-label', '미확인 물품 수색')
    search.click()
    common['until'](p, snapshot(p)['field']['action']['end']+350)
    tile = p.locator(f'[data-pick="{uid}"][data-side="loot"]:visible')
    expect(tile.locator('[data-hunt-badge]')).to_be_visible()
    tile.click()
    p.locator('[data-field="take"]:visible').click()
    assert any(u['uid'] == uid for u in snapshot(p)['field']['bag'])
    expect(p.locator('[data-hunt-summary="loot"] .bh-counts dd').nth(2)).to_have_text('1개')
    p.locator('[data-field="close"]:visible').first.click()
    p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
    common['until'](p, snapshot(p)['field']['action']['end']+350)
    expect(p.locator('[data-hunt-outcome]')).to_have_text('이번 출격 회수 1개')
    assert snapshot(p)['stash'][FABRIC] == 1
    assert snapshot(p)['wallet'] == 30000


def test_width(browser, width, folder):
    c, p, errors = common['profile'](browser, width)
    restored = None
    try:
        at(p, 'lootplan')
        p.locator('[data-lootplan="goal"][data-id="fuel"]').click()
        see_offer(p)
        material(p, 'cloth')
        p.locator('[data-bh="offer"]').click()
        material(p, FABRIC)
        p.locator('[data-bh="region"][data-zone="0"]').click()
        row = p.locator('[data-hunt-point="1"]')
        expect(row).to_contain_text('폐버스 정류장')
        expect(row).to_contain_text('첫 추첨')
        expect(p.locator('[data-hunt-footprint]')).to_contain_text('칸')
        common['fit'](p)
        expect(p.locator('.bh-counts dd')).to_have_text(['1개', '0개', '0개', '1개'])
        p.locator('[data-bh="candidate"][data-zone="0"][data-index="1"]').click()
        pin = {'trader':'quarter', 'recipe':RECIPE, 'item':FABRIC, 'destination':{'zone':0, 'index':1}}
        state = snapshot(p)
        assert state['barterHunt'] == pin and state['lootGoal'] == 'fuel' and state['objectivePin'] is None
        assert state['wallet'] == 30000 and not state['stash']
        expect(p.locator('[data-hunt-summary="plan"]:visible').first).to_be_visible()
        p.locator('[data-hunt-summary] [data-page="barterhunt"]:visible').first.click()
        at(p, 'barterhunt')
        expect(p.locator('[data-hunt-point="1"] h3')).to_contain_text('지정됨')
        if width == 390:
            payload = common['export_profile'](p, folder/'hunt.json')
            restored, p2, other_errors = common['profile'](browser,width,p.evaluate('Date.now()'))
            common['import_profile'](p2, payload)
            at(p2, 'barterhunt')
            assert snapshot(p2)['barterHunt'] == pin
            expect(p2.locator('[data-hunt-point="1"] h3')).to_contain_text('지정됨')
            p2.locator('[data-bh="candidate"][data-zone="0"][data-index="1"]').click()
            acquire(p2)
            assert not other_errors, other_errors
            at(p, 'barterhunt')
        p.locator('[data-bh="clear"]').click()
        assert snapshot(p)['barterHunt'] is None and snapshot(p)['lootGoal'] == 'fuel'
        expect(p.locator('[data-lootplan="goal"][data-id="fuel"]')).to_have_attribute('aria-pressed','true')
        assert not errors, errors
        print(f'PASS {width}px ordinary merchant → change ingredient → forecast → landmark prep → reload → cancel; preserved classification, objective, wallet and stock.'+
              (' Includes native backup, separate-profile restore and real timed reveal/take/extract.' if width==390 else ''), flush=True)
    finally:
        c.close()
        if restored: restored.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('widths', type=int, nargs='*')
    args=parser.parse_args()
    opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}
    if os.getenv('RUSTLINE_CHROMIUM'): opts['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'): opts['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as w, TemporaryDirectory() as temp:
        b=w.chromium.launch(**opts)
        try:
            for width in args.widths or [1280,390,320]: test_width(b,width,Path(temp))
        finally: b.close()
