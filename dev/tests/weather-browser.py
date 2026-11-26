"""Goal 11, through actual controls in a fresh Chromium profile.

    python3 tests/weather-browser.py
    python3 tests/weather-browser.py 390 --natural

The default runs check all three insertion zones, an actual v26 export and
precise transition edges with a controlled clock. --natural uses Chromium's
wall clock and the game's unmodified RNG. RUSTLINE_URL selects deployed HTML.
"""
import argparse
import json
import os
import runpy
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
shared = runpy.run_path(str(ROOT / 'tests/survivor-browser.py'))
field_ui = runpy.run_path(str(ROOT / 'tests/gear-service-browser.py'))['visit_field']
at, snapshot, until = (shared[key] for key in ('at', 'snapshot', 'until'))
BASE = 1800000000000
SLOT = 120000
CONDITIONS = (('clear', '맑음', 4), ('fog', '안개', 6), ('rain', '강우', 5))
FIXTURE = ROOT / 'tests/fixtures/weather-v26-scan.json'


def now(page):
    return page.evaluate('Date.now()')


def prediction(zone, ms, torso=False):
    index = (ms // SLOT + zone) % 3
    condition, label, seconds = CONDITIONS[index]
    next_label = CONDITIONS[(index + 1) % 3][1]
    start = ms // SLOT * SLOT
    duration = seconds * (1250 if torso else 1000)
    return (condition, label, next_label, start, start + SLOT, duration)


def visible_duration(locator, ms):
    expect(locator).to_contain_text(f'{ms / 1000:g}초')


def check_card(card, zone, timestamp, torso=False):
    condition, current, upcoming, start, end, duration = prediction(zone, timestamp, torso)
    expect(card).to_be_visible()
    for name, value in [('zone',zone), ('condition',condition), ('starts-at',start),
                        ('next-at',end), ('scan-ms',duration)]:
        key = 'data-weather-zone' if name == 'zone' else f'data-{name}'
        expect(card).to_have_attribute(key,str(value))
    expect(card.locator('[data-weather-current]')).to_contain_text(current)
    expect(card.locator('[data-weather-next]')).to_contain_text(upcoming)
    readout=card.locator('[data-weather-readout]')
    next_duration=prediction(zone,end,torso)[-1]
    expect(card).to_have_attribute('data-next-scan-ms',str(next_duration))
    visible_duration(readout.locator('dd').last,next_duration)
    for index, instant in enumerate((start,end)):
        clock=readout.locator('time').nth(index)
        local_time=datetime.fromtimestamp(instant/1000,ZoneInfo('Asia/Seoul')).strftime('%H:%M:%S')
        iso=datetime.fromtimestamp(instant/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        expect(clock).to_have_text(local_time)
        expect(clock).to_have_attribute('datetime',iso)
    visible_duration(card.locator('[data-weather-duration]'), duration)
    return duration


def map_board(page, timestamp, torso=False):
    board = page.locator('[data-weather-board]')
    expect(board.locator('[data-weather-zone]')).to_have_count(3)
    for zone in range(3):
        check_card(board.locator(f'[data-weather-zone="{zone}"]'),zone,timestamp,torso)
    shared['fit'](page)


def select_and_deploy(page, zone):
    selected=page.locator(f'[data-weather-zone="{zone}"] [data-cui="weather-select"]')
    selected.click()
    expect(selected).to_have_attribute('aria-pressed','true')
    expect(page.locator(f'[data-cui="inspect"][data-index="{zone}"]')).to_have_attribute('aria-pressed','true')
    page.locator('[data-weather-board] [data-weather-deploy]').click()
    prep = page.locator('[data-weather-prep]:visible').first
    check_card(prep,zone,now(page))
    page.locator('.lo-deploy[data-raid="start"]').click()
    assert snapshot(page)['raid']['zone']==zone
    card = page.locator('[data-weather-field]:visible').first
    check_card(card,zone,now(page))
    return card


def action(page):
    return snapshot(page)['field']['action']


def confirm_pending(page, stored):
    assert action(page)==stored, (action(page),stored)
    card = page.locator('[data-weather-action]:visible').first
    expect(card).to_have_attribute('data-start',str(stored['start']))
    expect(card).to_have_attribute('data-end',str(stored['end']))


def maybe_screenshot(card, name):
    folder=os.getenv('RUSTLINE_WEATHER_SCREENSHOTS')
    if folder:
        Path(folder).mkdir(parents=True,exist_ok=True)
        card.screenshot(path=str(Path(folder)/name),animations='disabled',timeout=10000)


def restored_pending(browser, page, width, zone, stored, folder):
    exported = shared['export_profile'](page,folder/'weather-crossing.json')
    assert exported['session']['field']['action']==stored
    context, other, errors=shared['profile'](browser,width,now(page))
    try:
        shared['import_profile'](other,exported)
        field_ui(other)
        check_card(other.locator('[data-weather-field]:visible').first,zone,now(other))
        confirm_pending(other,stored)
        assert stored['end']-now(other)==stored['end']-now(page)
        until(other,stored['end']-1)
        confirm_pending(other,stored)
        until(other,stored['end']+350)
        assert action(other) is None
        assert len(snapshot(other)['field']['found'][zone])==1
        assert not errors, errors
    finally:
        context.close()


def run_timed(browser,width,folder):
    # Three separate fresh people enter different zones at one of the three
    # exact edges. The phone also follows the in-flight scan through restoration.
    zone,offset={390:(0,-1),1280:(1,0),320:(2,1)}[width]
    ctx,page,errors=shared['profile'](browser,width,BASE-1000)
    try:
        at(page,'weather' if width==1280 else 'map')
        map_board(page,now(page))
        board=page.locator('[data-weather-board]')
        if width==1280:
            expect(board).to_be_focused()
        # Observe an unattended forecast change while the map is still open.
        focused=board.locator('[data-cui="weather-select"]').first
        focused.focus()
        until(page,BASE+600)
        map_board(page,now(page))
        expect(focused).to_be_focused()
        maybe_screenshot(board,f'forecast-{width}.png')
        card=select_and_deploy(page,zone)
        boundary=BASE+SLOT
        until(page,boundary-450)
        check_card(card,zone,now(page))
        scan=page.locator('[data-field="scan"]:visible').first
        visible_duration(scan,prediction(zone,now(page))[-1])
        until(page,boundary+offset)
        scan.click()
        saved=action(page)
        assert saved and saved['type']=='scan' and saved['start']==boundary+offset, saved
        duration=prediction(zone,saved['start'])[-1]
        assert saved['end']-saved['start']==duration, (duration,saved)
        until(page,boundary+600)
        # No refresh or player input after the boundary. The panel updates now
        # while the accepted scan retains the preceding window's exact deadline.
        check_card(card,zone,now(page))
        confirm_pending(page,saved)
        maybe_screenshot(card,f'field-{width}.png')
        if width==390:
            page.reload(wait_until='domcontentloaded')
            field_ui(page)
            check_card(card,zone,now(page))
            confirm_pending(page,saved)
            restored_pending(browser,page,width,zone,saved,folder)
            field_ui(page)
        until(page,saved['end']-1)
        confirm_pending(page,saved)
        until(page,saved['end']+350)
        assert action(page) is None and len(snapshot(page)['field']['found'][zone])==1
        current=check_card(card,zone,now(page))
        visible_duration(scan,current)
        scan.click()
        following=action(page)
        assert following['end']-following['start']==current
        until(page,following['end']+350)
        assert action(page) is None and len(snapshot(page)['field']['found'][zone])==2
        if width==1280:
            # A real inter-sector journey keeps the original sector visible
            # in transit. Its weather changes to the destination upon arrival.
            to=2
            shared['start_route'](page,to)
            check_card(card,zone,now(page))
            expect(card).to_contain_text('출발지 기상')
            shared['finish_route'](page,to)
            # A real inter-sector encounter can injure the torso during transit.
            injury = snapshot(page)['injuryState']
            torso_events = [event for event in injury['events'] if event['part'] == 'torso']
            wounded = bool(torso_events and torso_events[-1]['kind'] == 'hit' and not injury['legacy'])
            check_card(card,to,now(page),wounded)
            expect(card).to_contain_text('현장 기상')
            page.locator('[data-weather-field] [data-cui="forecast"]').click()
            map_board(page,now(page),wounded)
            expect(page.locator('[data-weather-board]')).to_be_focused()
        shared['fit'](page)
        assert not errors,errors
        print(f'PASS {width}px region {zone}, boundary {offset:+}ms · all three map forecasts changed without input; matching prep/field, scan {duration}ms frozen, following scan {current}ms; both discovered once.'
              +(' Reload + separate backup restored the same transition and deadline.' if width==390 else ' Real journey verified source in transit, destination on arrival and focused map return.' if width==1280 else ''),flush=True)
    finally:
        ctx.close()


def run_natural(browser,width):
    began=monotonic()
    ctx,page,errors=shared['profile'](browser,width,wall=True)
    try:
        at(page,'map')
        # For an apples-to-apples comparison across all three screens, avoid
        # starting the comparison in the last few seconds of a forecast window.
        current=now(page)
        if SLOT-(current % SLOT)<10000:
            until(page,current//SLOT*SLOT+SLOT+500,True)
        map_board(page,now(page))
        zone=1
        card=select_and_deploy(page,zone)
        scan=page.locator('[data-field="scan"]:visible').first
        current=check_card(card,zone,now(page))
        visible_duration(scan,current)
        start=monotonic()
        scan.click()
        saved=action(page)
        assert saved['type']=='scan' and saved['end']-saved['start']==prediction(zone,saved['start'])[-1]==current
        confirm_pending(page,saved)
        until(page,saved['end']+350,True)
        elapsed=monotonic()-start
        assert action(page) is None and len(snapshot(page)['field']['found'][zone])==1
        assert elapsed>=current/1000
        assert not errors,errors
        print(f'PASS {width}px real clock + natural RNG, region {zone}: {prediction(zone,saved["start"])[1]}, predicted {current}ms, saved {saved["end"]-saved["start"]}ms, actual completion observed after {elapsed:.2f}s, 1 new container. Entire path {monotonic()-began:.1f}s.',flush=True)
    finally:
        ctx.close()


def run_legacy(browser):
    payload=json.loads(FIXTURE.read_text())
    original=payload['session']
    saved=original['field']['action']
    assert original['version']==26 and saved['end']-saved['start']==5000
    assert [e['part'] for e in original['injuryState']['events']]==['arm','leg','torso']
    ctx,page,errors=shared['profile'](browser,390,saved['start']+550)
    try:
        shared['import_profile'](page,payload)
        s=snapshot(page)
        assert s['version']==36 and s['wallet']==original['wallet']==21000
        assert s['raid']==original['raid'] and s['injuryState']==original['injuryState']
        assert s['field']['bag']==original['field']['bag'] and s['field']['hp']==original['field']['hp']
        assert action(page)==saved
        zone=s['raid']['zone']
        before=len(s['field']['found'][zone])
        at(page,'map')
        map_board(page,now(page),True)
        field_ui(page)
        card=page.locator('[data-weather-field]:visible').first
        assert check_card(card,zone,now(page),True)==7500
        confirm_pending(page,saved)
        until(page,saved['end']+350)
        assert action(page) is None and len(snapshot(page)['field']['found'][zone])==before+1
        scan=page.locator('[data-field="scan"]:visible').first
        if scan.is_disabled():
            used=snapshot(page)['field']['landmarkByZone'][zone]
            page.locator('.landmark-picker summary').click()
            page.locator(f'[data-field="landmark"][data-index="{used+1}"]').click()
        visible_duration(scan,7500)
        scan.click()
        later=action(page)
        assert later['end']-later['start']==7500
        until(page,later['end']+350)
        assert action(page) is None and len(snapshot(page)['field']['found'][zone])==before+2
        assert not errors,errors
        print(f'PASS 390px authentic v26 injured scan restored · HP {s["field"]["hp"]}, 21,000 CR, both bandages and three actual injuries retained. Original 5,000ms deadline completed in fog; new torso injury + fog forecast and actual scan 7,500ms.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('widths',type=int,nargs='*',choices=[1280,390,320])
    parser.add_argument('--natural',action='store_true')
    parser.add_argument('--legacy',action='store_true')
    args=parser.parse_args()
    with sync_playwright() as w, TemporaryDirectory() as temp:
        settings={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if os.getenv('RUSTLINE_CHROMIUM'):
            settings['executable_path']=os.environ['RUSTLINE_CHROMIUM']
        if os.getenv('RUSTLINE_PROXY'):
            settings['proxy']={'server':os.environ['RUSTLINE_PROXY']}
        browser=w.chromium.launch(**settings)
        try:
            if not args.legacy:
                for width in args.widths or ([390] if args.natural else [390,1280,320]):
                    if args.natural:
                        run_natural(browser,width)
                    else:
                        run_timed(browser,width,Path(temp))
            if args.legacy or (not args.natural and not args.widths):
                run_legacy(browser)
        finally:
            browser.close()
