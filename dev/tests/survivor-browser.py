"""Browser acceptance for moving survivors. Run after python3 build.py.

python tests/survivor-browser.py                  # 3 fresh viewport paths plus v22 import
python tests/survivor-browser.py 390 --natural    # wall clock, fresh profile and real travel
Supports RUSTLINE_URL, RUSTLINE_CHROMIUM, RUSTLINE_PROXY and RUSTLINE_IGNORE_HTTPS_ERRORS.
The legacy checkpoint was exported from v0.22 through its own browser UI during a real route.
"""
import argparse
import json
import os
import runpy
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = urldefrag(os.getenv('RUSTLINE_URL') or (ROOT / 'index.html').as_uri()).url
KEY = 'rl-reboot-session-v35'
LEGACY = ROOT / 'tests/fixtures/survivor-v22-route.json'
helpers = runpy.run_path(str(ROOT / 'tests/campaign-browser.py'))
fit = helpers['fit']


def snapshot(p):
    return p.evaluate('key=>JSON.parse(localStorage.getItem(key))', KEY)


def count_water(s):
    return sum(u['g'] == 'water' for u in s['field']['bag'])


def action(p, name):
    return p.locator(f'[data-survivor="{name}"]:visible').first


def at(p, fragment):
    target=URL + '#' + fragment
    if p.url==target:
        p.reload(wait_until='domcontentloaded', timeout=60000)
    else:
        p.goto(target, wait_until='domcontentloaded', timeout=60000)


def profile(browser, width, now=None, wall=False):
    c = browser.new_context(viewport={'width': width, 'height': 844}, reduced_motion='reduce',
                            ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1')
    p = c.new_page()
    p.set_default_timeout(9000)
    errors = []
    p.on('pageerror', lambda err: errors.append(str(err)))
    p.on('dialog', lambda d: d.accept())
    if not wall:
        now = now if now is not None else 1800000000000
        p.clock.install(time=datetime.fromtimestamp((now-86400000)/1000, timezone.utc))
        p.clock.pause_at(datetime.fromtimestamp(now/1000, timezone.utc))
    at(p,'survivors')
    p.wait_for_function('k=>!!localStorage.getItem(k)',arg=KEY)
    expect(p.locator('[data-survivor-journal]')).to_be_visible()
    return c, p, errors


def until(p, ms, wall=False):
    if wall:
        timeout = max(1000, ms - p.evaluate('Date.now()') + 7500)
        p.wait_for_function('ms=>Date.now()>=ms',arg=ms,timeout=timeout)
    else:
        now = p.evaluate('Date.now()')
        if now < ms:
            p.clock.fast_forward(ms-now)


def first_raid(p):
    s=snapshot(p)
    assert s['wallet'] == 30000 and not s['stash'] and s['career']['sorties']==0
    assert not s['survivor']['active'] and not s['survivor']['last']
    expect(p.locator('[data-survivor-journal] [data-sv-clue]')).to_have_count(0)
    at(p,'shop')
    p.locator('[data-market="item"][data-id="water"]:visible').click()
    p.locator('[data-market="trade"][data-id="water"]:visible').click()
    assert snapshot(p)['wallet']==25000 and snapshot(p)['stash']['water']==1
    at(p,'map')
    p.locator('[data-cui="inspect"][data-index="0"]').click()
    p.locator('.command-deploy[data-page="prep"]').click()
    p.locator('[data-gear="pack"][data-id="water"]:visible').first.click()
    s=snapshot(p)
    assert sum(u['g']=='water' for u in s['equipment']['bag'])==1 and not s['stash'].get('water')
    expect(p.locator('[data-page="survivors"]:visible').first).to_be_visible()
    p.locator('.lo-deploy[data-raid="start"]').click()
    s=snapshot(p)
    assert s['raid']['zone']==0 and count_water(s)==1
    expect(p.locator('[data-survivor-field]')).to_be_visible()
    return s['raid']['startedAt']


def journal(p):
    if p.locator('#inside').get_attribute('data-page') != 'survivors':
        p.locator('[data-page="survivors"]:visible').first.click()
    expect(p.locator('[data-survivor-journal]')).to_be_visible()


def field(p):
    if p.locator('#inside').get_attribute('data-page') != 'raid':
        p.locator('[data-page="raid"]:visible').first.click()
    expect(p.locator('[data-survivor-field]')).to_be_visible()


def export_profile(p, path):
    p.locator('.shell-settings').click()
    with p.expect_download() as download:
        p.locator('[data-backup="export"]').click()
    download.value.save_as(path)
    payload=json.loads(path.read_text())
    assert payload['session']['version']==35
    return payload


def import_profile(p, payload):
    p.locator('.shell-settings').click()
    p.locator('#restore-file').set_input_files({
        'name':'survivor-route.json','mimeType':'application/json',
        'buffer':json.dumps(payload,ensure_ascii=False).encode()
    })
    expect(p.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    # Reopen the deep link after changing the terminal page in-place.
    p.reload(wait_until='domcontentloaded')


def copy_profile(browser, width, p, folder, name, contexts, all_errors):
    payload=export_profile(p,folder/name)
    c, other, errors=profile(browser,width,p.evaluate('Date.now()'))
    contexts.append(c)
    all_errors.append(errors)
    import_profile(other,payload)
    before=payload['session']
    after=snapshot(other)
    for key in ['survivor','wallet','raid']:
        assert before[key]==after[key],key
    assert before['field']['bag']==after['field']['bag']
    return other


def deny_next_write(p):
    p.evaluate("""key=>{
        const real=Storage.prototype.setItem;
        Storage.prototype.setItem=function(k,v){
            if(this===localStorage && k===key){
                Storage.prototype.setItem=real;
                throw new DOMException('Acceptance: device storage full','QuotaExceededError');
            }
            return real.call(this,k,v);
        };
    }""",KEY)


def start_route(p, zone):
    field(p)
    origin=snapshot(p)['raid']['zone']
    p.locator(f'[data-route-card][data-from="{origin}"][data-to="{zone}"] [data-field="move"]:visible').first.click()
    s=snapshot(p)
    assert s['field']['journey']['to']==zone and s['field']['action']['type']=='travel-step'
    return s['field']['action']['end']


def finish_route(p, zone, wall=False):
    # Use the real random route. Resolve any incidental contact or supply with public controls.
    for _ in range(15):
        s=snapshot(p)
        if s['raid']['zone']==zone and not s['field']['journey']:
            return
        f=s['field']
        if f.get('action'):
            until(p,f['action']['end']+450,wall)
        elif f.get('contact'):
            p.locator('[data-field="evade"]:visible').first.click()
        elif f['journey'] and f['journey']['event']=='supply':
            p.locator('[data-field="journey-pass"]:visible').first.click()
        else:
            raise AssertionError(f['journey'])
    raise AssertionError('route did not arrive')


def new_game(browser,width,folder,wall=False):
    contexts,all_errors=[],[]
    c,p,errors=profile(browser,width,wall=wall)
    contexts.append(c)
    all_errors.append(errors)
    try:
        rid=first_raid(p)
        journal(p)
        book=p.locator('[data-survivor-journal]')
        expect(book.locator('[data-sv-clue]')).to_have_count(0)
        expect(book.locator('[data-sv-meeting]')).to_have_count(0)
        expect(book.locator('[data-survivor="meet"]:enabled')).to_have_count(0)
        expect(book).not_to_contain_text('은서')
        expect(book).not_to_contain_text('폐쇄 검문소')
        expect(book).not_to_contain_text('군수 보급 창고')
        fit(p)
        field(p)
        action(p,'observe').click()
        journal(p)
        expect(book.locator('[data-sv-clue][data-kind="boots"]')).to_have_count(1)
        if width==390 and not wall:
            action(p,'pass').click()
            first=snapshot(p)['survivor']['active']['clues'][0]
            assert first['decision']=='pass', first
            p.reload(wait_until='domcontentloaded')
            journal(p)
            assert snapshot(p)['survivor']['active']['clues'][0]==first
        action(p,'follow').click()
        action(p,'meet').click()
        first_state=snapshot(p)['survivor']['active']
        assert len(first_state['meetings'])==1
        encounter=p.locator('[data-sv-encounter]:visible').first
        expect(encounter).to_contain_text('물통')
        identity=encounter.locator('h3').inner_text()
        assert '은서' in identity
        before=snapshot(p)
        choice='decline' if width==320 and not wall else 'help'
        if width==390 and not wall:
            deny_next_write(p)
            action(p,'help').click()
            after=snapshot(p)
            assert after['wallet']==before['wallet'] and count_water(after)==1
            assert not after['survivor']['active']['choice']
            expect(action(p,'help')).to_be_enabled()
        action(p,choice).click()
        s=snapshot(p)
        wallet=25000+(6000 if choice=='help' else 0)
        assert s['wallet']==wallet and count_water(s)==(0 if choice=='help' else 1)
        assert s['survivor']['active']['choice']['kind']==choice
        expect(p.locator('[data-survivor="help"]:visible:enabled')).to_have_count(0)
        if width==390 and not wall:
            p=copy_profile(browser,width,p,folder,'after-aid.json',contexts,all_errors)
            journal(p)
            expect(p.locator('[data-survivor="help"]:visible:enabled')).to_have_count(0)
        # A clock boundary alone cannot disclose an unrevealed clue or a new meeting.
        earlier=snapshot(p)['field']['boxes']
        until(p,rid+90500,wall)
        field(p)
        departed=snapshot(p)['field']
        removed=departed.get('survivorScavenge')
        assert removed and removed['at']==rid+90000
        if removed['uid']:
            key=removed['box']
            previous=[u['uid'] for u in earlier[key]['items']]
            current=[u['uid'] for u in departed['boxes'][key]['items']]
            assert removed['uid'] in previous and current==[uid for uid in previous if uid!=removed['uid']]
            assert sum(len(b['items']) for b in earlier.values())==sum(len(b['items']) for b in departed['boxes'].values())+1
            if width==1280:
                # Find the scavenged container through actual landmark scans and open it.
                marked=p.locator('[data-field="open"]:visible').filter(has_text='뒤진 흔적')
                for index in range(p.locator('[data-field="landmark"]').count()):
                    if index:
                        p.locator('.landmark-picker summary').click()
                        p.locator(f'[data-field="landmark"][data-index="{index}"]').click()
                    scan=p.locator('[data-field="scan"]:visible')
                    while scan.is_enabled():
                        scan.click()
                        until(p,snapshot(p)['field']['action']['end']+450)
                        for _ in range(12):
                            if not snapshot(p)['field'].get('contact'):
                                break
                            p.locator('[data-field="evade"]:visible').first.click()
                            until(p,snapshot(p)['field']['action']['end']+450)
                        if marked.count():
                            break
                    if marked.count():
                        marked.click()
                        expect(p.locator('[data-scavenge-trace]')).to_be_visible()
                        p.locator('[data-field="close"]:visible').first.click()
                        break
                else:
                    raise AssertionError('scavenged box should be discoverable by searching the origin')
        action(p,'observe').click()
        journal(p)
        book=p.locator('[data-survivor-journal]')
        expect(book.locator('[data-sv-clue][data-kind="cloth"]')).to_have_count(1)
        assert len(snapshot(p)['survivor']['active']['meetings'])==1
        action(p,'follow').click()
        end=start_route(p,1)
        route=snapshot(p)['field']['journey']
        if width==390 and not wall:
            p=copy_profile(browser,width,p,folder,'tracking-route.json',contexts,all_errors)
            assert snapshot(p)['field']['journey']==route and snapshot(p)['field']['action']['end']==end
            field(p)
        finish_route(p,1,wall)
        until(p,rid+105600,wall)
        field(p)
        action(p,'meet').click()
        journal(p)
        active=snapshot(p)['survivor']['active']
        assert active['raidId']==rid and [m['step'] for m in active['meetings']]==[0,1]
        assert active['choice']['kind']==choice
        encounter=p.locator('[data-sv-encounter]:visible').first
        expect(encounter.locator('h3')).to_have_text(identity)
        expect(encounter).to_contain_text('건네주신 물' if choice=='help' else '물을 아껴야')
        meetings=p.locator('[data-sv-meeting]')
        expect(meetings).to_have_count(2)
        assert all(m.locator('h3').inner_text()==identity for m in meetings.all())
        expect(p.locator('[data-survivor="help"]:enabled')).to_have_count(0)
        assert snapshot(p)['wallet']==wallet and count_water(snapshot(p))==(0 if choice=='help' else 1)
        fit(p)
        field(p)
        start_route(p,0)
        finish_route(p,0,wall)
        p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        until(p,snapshot(p)['field']['action']['end']+450,wall)
        p.locator('[data-raid="ack"]:visible').first.click()
        at(p,'survivors')
        s=snapshot(p)
        assert s['survivor']['active'] is None and s['survivor']['last']==active
        assert s['wallet']==wallet
        expect(p.locator('[data-sv-mode="archive"]')).to_be_visible()
        assert all(not e for e in all_errors),all_errors
        print(f'PASS {width}px {"wall-clock" if wall else "accelerated"} fresh — genuine water purchase/packing, two clues, two zones, {choice}, exact cash and B-04 archive.'+
              (' Includes pass→resume, quota rollback, isolated post-aid and in-transit JSON restores.' if width==390 and not wall else ''),flush=True)
    finally:
        for c in contexts:
            c.close()


def legacy(browser):
    payload=json.loads(LEGACY.read_text())
    original=payload['session']
    c,p,errors=profile(browser,390,original['field']['action']['start'])
    try:
        import_profile(p,payload)
        actual=snapshot(p)
        for key in ['wallet','raid','campaign','finale']:
            assert actual[key]==original[key]
        for key in ['action','journey','bag']:
            assert actual['field'][key]==original['field'][key]
        journal(p)
        expect(p.locator('[data-sv-mode="legacy"]')).to_be_visible()
        assert not actual['survivor']['active'] and not actual['survivor']['last']
        field(p)
        finish_route(p,1)
        assert snapshot(p)['raid']['zone']==1 and count_water(snapshot(p))==1
        p.locator('[data-field="abandon"]:visible').first.click()
        p.locator('[data-raid="ack"]:visible').first.click()
        at(p,'map')
        p.locator('.command-deploy[data-page="prep"]').click()
        p.locator('.lo-deploy[data-raid="start"]').click()
        assert snapshot(p)['survivor']['active']['raidId']==snapshot(p)['raid']['startedAt']
        assert not errors,errors
        print('PASS 390px migration — genuine v0.22 en-route export retained the same route deadline, water and wallet; new survivor expedition began with the following sortie.',flush=True)
    finally:
        c.close()


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('widths',nargs='*',type=int)
    cli.add_argument('--natural',action='store_true')
    args=cli.parse_args()
    launch={'headless':True,'args':['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with TemporaryDirectory() as tmp,sync_playwright() as runner:
        b=runner.chromium.launch(**launch)
        try:
            for w in args.widths or ([390] if args.natural else [1280,390,320]):
                new_game(b,w,Path(tmp),args.natural)
            if not args.widths and not args.natural:
                legacy(b)
        finally:
            b.close()
