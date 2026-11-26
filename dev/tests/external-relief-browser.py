"""Restore a completed finale through Settings and personally fulfill the first external supply request.
Default profiles use the shipped finale fixture, completed through the engine, and controlled time.
Set RUSTLINE_RELIEF_EARNED_SAVE to an actual completed native export. RUSTLINE_RELIEF_NATURAL=1
requires that export and leaves time and random generation unmodified. Optional widths / --choice
select independent runs. No player file is written to the checkout.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LIVE = os.getenv('RUSTLINE_URL')
URL = urldefrag(LIVE or 'https://rustline-relief.test/').url
HTML = (ROOT / 'index.html').read_bytes()
KEY = 'rl-reboot-session-v36'
NEED = {'meals': {'food': 2, 'water': 2}, 'power': {'battery': 1, 'rl_03_25': 1}}
ORDER = 'external-relief'


def run(browser, width, kind, path, natural):
    mobile = width == 390
    with browser.new_context(viewport={'width': width, 'height': 844}, has_touch=mobile, is_mobile=mobile,
                             reduced_motion='reduce', ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1') as ctx:
        if not LIVE:
            ctx.route(URL+'**', lambda route: route.fulfill(body=HTML, content_type='text/html; charset=utf-8'))
        if not natural:
            ctx.add_init_script('Math.random=()=>0.1')
        p = ctx.new_page()
        if not natural:
            native_reply = json.loads(path.read_text())['session']['finale']['reply']['raidId']
            p.clock.install(time=datetime.fromtimestamp(max(1800003500000, native_reply + 1800000)/1000, timezone.utc))
        p.set_default_timeout(7500)
        errors = []
        p.on('pageerror', lambda e: errors.append(str(e)))

        def state():
            return p.evaluate('key=>JSON.parse(localStorage.getItem(key))', KEY)

        def click(sel):
            loc = p.locator(sel+':visible').first
            if mobile: loc.tap()
            else: loc.click()

        def nav(fragment):
            p.goto(URL+'#'+fragment, wait_until='domcontentloaded')

        def settle():
            for _ in range(90):
                f = state()['field']
                if f.get('result'): return
                a = f.get('action')
                if a:
                    if natural:
                        p.wait_for_function('key=>!JSON.parse(localStorage.getItem(key)).field.action', arg=KEY, polling=250, timeout=60000)
                    else: p.clock.fast_forward(max(350, a['end']-p.evaluate('Date.now()')+350))
                elif f.get('contact'): click('[data-field=evade]')
                elif f.get('journey') and f['journey'].get('event') == 'supply': click('[data-field=journey-pass]')
                elif f.get('journey'): p.wait_for_timeout(100) if natural else p.clock.fast_forward(350)
                else: return
            raise AssertionError('Field action did not settle')

        def move(z):
            if state()['raid']['zone'] != z:
                click(f'[data-route-card][data-to="{z}"] [data-field=move]');settle()
            assert state()['raid']['zone'] == z

        def landmark(z, i):
            move(z)
            if state()['field']['landmarkByZone'][z] == i: return
            picker = p.locator('.landmark-picker')
            if not picker.evaluate('e=>e.open'): click('.landmark-picker summary')
            click(f'[data-field=landmark][data-index="{i}"]')
            assert state()['field']['landmarkByZone'][z] == i

        def search(z, point, case, take_battery=False):
            landmark(z, point)
            open_case = f'[data-field=open][data-index="{case}"]'
            for _ in range(3):
                if p.locator(open_case+':visible').count(): break
                click('[data-field=scan]');settle()
            click(open_case)
            loot_tab = '[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
            if p.locator(loot_tab+':visible').count(): click(loot_tab)
            button = p.locator('.lo-search')
            if button.is_enabled():
                click('.lo-search');settle()
            assert state()['field']['boxes'][f'{z}-{case}']['complete']
            target = p.locator('[data-side=loot][data-pick][aria-label="배터리"]:visible').first
            found = bool(take_battery and target.count())
            if found:
                if mobile: target.tap()
                else: target.click()
                click('[data-field=take]')
                assert any(u['g']=='battery' for u in state()['field']['bag'])
            click('[data-field=close]')
            return found

        def deploy(z):
            nav('map');click(f'.command-station[data-index="{z}"]')
            click('.command-deploy[data-page=prep]');click('.lo-deploy[data-raid=start]')
            assert state()['raid']['zone'] == z

        def pack(item, n):
            nav('stash')
            for _ in range(n):
                unit = next(u for u in state()['stashSlots'] if u['g']==item)
                click(f'[data-stash=select][data-uid="{unit["uid"]}"]')
                click(f'[data-gear=pack][data-id="{item}"][data-unit="{unit["uid"]}"]')
                assert any(u['g']==item for u in state()['equipment']['bag'])

        def extract():
            move(0);click('[data-field=extract][data-exit=b04]');settle()
            s = state()
            assert s['lastSummary']['rating']=='success' and s['lastSummary']['searched']>=2, s['lastSummary']
            click('[data-raid=ack]')
            return s['lastSummary']

        response = p.goto(URL+'#campaign', wait_until='domcontentloaded', timeout=90000)
        assert response and response.ok and response.body()==HTML
        expect(p.locator('[data-bui=external-relief]')).to_have_count(0)
        click('.shell-settings')
        dialogs = []
        def accept(d):
            dialogs.append(d.message)
            d.accept()
        p.once('dialog',accept)
        with p.expect_file_chooser() as chooser: click('[data-backup=import]')
        chooser.value.set_files(path)
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다')
        assert len(dialogs)==1 and '백업으로 교체' in dialogs[0]
        nav('campaign');reply = p.locator('[data-finale-reply] [data-bui=external-relief]')
        expect(reply).to_have_text('첫 보급 요청 보기')
        before = state()
        assert not before['raid'] and ORDER not in before['career']['done'] and not before['equipment']['bag']
        reply.click()
        expect(p.locator('.bu-order-panel')).to_contain_text('회신 뒤의 첫 보급')
        expect(p.locator('[data-relief-choice]')).to_have_count(2)
        assert state()['wallet'] == before['wallet'] and not state()['career']['order']
        click(f'[data-order="{ORDER}"]')
        click(f'[data-objective=pin][data-id="{ORDER}"]')
        need = NEED[kind]
        cost = 0
        if kind=='power' and not state()['stash'].get('rl_03_25'):
            nav('stash')
            click('[data-stash=select]:not([data-id=cr_notes])')
            click('.stash-detail [data-db=lookup]')
            p.locator('#db-query').fill('전원 커넥터')
            click('[data-db=item][data-id=rl_03_25]')
            expect(p.locator('[data-supply=rl_03_25]')).to_contain_text('13,000 CR')
            click('[data-supply=rl_03_25]');cost=13000
            assert state()['wallet']==before['wallet']-cost
        # When a real final save lacks a retail battery, find one in an accessible computer/drawer.
        hunt = kind=='power' and not state()['stash'].get('battery')
        z = int(kind=='power')
        for attempt in range(6):
            for item,n in need.items():
                if item=='battery' and hunt: continue
                pack(item,n)
            assert state()['wallet']==before['wallet']-cost
            deploy(z)
            if not hunt: break
            for place in [(1,3,4),(1,4,5),(1,1,6),(1,2,7),(0,5,11),(0,8,17),(0,1,6),(2,3,7)]:
                if search(*place,take_battery=True):
                    print(f'{width}px {kind}: recovered battery from zone/landmark/container {place} on sortie {attempt+1}.',flush=True)
                    break
            else:
                r=extract();assert not r['commission']
                continue
            break
        else: raise AssertionError('No naturally recoverable battery in six independent sorties.')
        landmark(z,3)
        panel=p.locator('[data-relief-stage=ready]')
        button=panel.locator(f'[data-field=relief-deliver][data-kind="{kind}"]')
        expect(button).to_be_enabled()
        assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        s=state();rid=s['raid']['startedAt'];old_bag=s['field']['bag']
        assert Counter(u['g'] for u in old_bag)==Counter(need)
        button.focus();p.keyboard.press('Enter') if not mobile else button.tap()
        done=p.locator('[data-relief-stage=given]')
        expect(done).to_contain_text('정상 탈출하면 수당')
        s=state();delivery=s['field']['reliefDelivery']
        assert delivery['raidId']==rid and delivery['kind']==kind and not s['field']['bag']
        assert s['wallet']==before['wallet']-cost
        p.reload(wait_until='domcontentloaded')
        assert state()['field']['reliefDelivery']==delivery
        if p.locator('#inside').get_attribute('data-page')!='raid':
            nav('map');click(f'.command-station[data-index="{z}"]');click('.command-deploy[data-page=raid]')
        expect(p.locator('[data-field=relief-deliver]')).to_have_count(0)
        # Both branches personally search two unlocked outside supply cases (B-04 normal return).
        search(0,0,0);search(0,0,1)
        r=extract()
        assert r['commission']==36000 and r['missionXp']==110 and r['raidId']==rid
        final=state()
        assert not final['raid'] and final['wallet']==before['wallet']-cost+36000
        assert final['career']['reliefReceipt']==delivery and final['career']['done'].count(ORDER)==1
        assert final['finale']['reply']==before['finale']['reply'] and final['saleReceipts']==before['saleReceipts']
        assert final['marketCarts']==before['marketCarts'] and final['campaign']==before['campaign']
        for item,n in need.items():
            original=before['stash'].get(item,0)
            paid=1 if item=='rl_03_25' and cost else 0
            found=1 if item=='battery' and hunt else 0
            assert final['stash'].get(item,0)==original+paid+found-n
        p.reload(wait_until='domcontentloaded')
        nav('campaign');expect(reply).to_have_text('첫 보급 인계 기록');reply.click()
        expect(p.locator('[data-relief-stage=settled]')).to_be_visible()
        expect(p.locator(f'[data-order="{ORDER}"]')).to_be_disabled()
        assert state()['wallet']==final['wallet'] and state()['career']['reliefReceipt']==delivery and not errors,errors
        print(f'PASS {width}px {kind}, {"wall clock/RNG" if natural else "controlled fixture"}: native restore, '
              f'{len(old_bag)} units handed over, {r["searched"]} searched, {r["elapsed"]}ms, '
              f'{before["wallet"]} - {cost} + 36000 = {final["wallet"]} CR, 110 XP once.',flush=True)


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('widths',nargs='*',type=int)
    cli.add_argument('--choice',choices=NEED)
    args=cli.parse_args()
    natural=os.getenv('RUSTLINE_RELIEF_NATURAL')=='1'
    earned=os.getenv('RUSTLINE_RELIEF_EARNED_SAVE')
    if natural and not earned: cli.error('natural runs require RUSTLINE_RELIEF_EARNED_SAVE')
    with TemporaryDirectory(prefix='rustline-relief-') as temp, sync_playwright() as pw:
        path=Path(earned).resolve() if earned else Path(temp)/'ended.json'
        if not earned:
            subprocess.run(['node','tests/external-relief.cjs'],cwd=ROOT,check=True,
                env={**os.environ,'RUSTLINE_EXPORT_RELIEF_FIXTURE':str(path)})
        proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
        with pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
            for width in args.widths or [390,1280]:
                for choice in ([args.choice] if args.choice else NEED):
                    run(browser,width,choice,path,natural)
