"""Assemble two physical kits, carry them through an actual search and verify gram-accurate UI weights."""
import json
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
URL=urldefrag(os.getenv('RUSTLINE_URL') or 'https://rustline-pack-mass.test/').url
KEY='rl-reboot-session-v36'


def play(browser,width):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844}, has_touch=mobile,is_mobile=mobile,
            reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as c:
        if not os.getenv('RUSTLINE_URL'):c.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        p=c.new_page();p.set_default_timeout(8000);errors=[]
        p.on('dialog',lambda dialog:dialog.accept());p.on('pageerror',lambda error:errors.append(str(error)))
        def click(sel):
            node=p.locator(sel+':visible').first
            node.tap() if mobile else node.click()
        def snap():
            return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def visit(fragment,page):
            p.goto(URL+'#'+fragment,wait_until='domcontentloaded')
            if p.locator('#inside').get_attribute('data-page')!=page:p.reload(wait_until='domcontentloaded')
            expect(p.locator('#inside')).to_have_attribute('data-page',page)
        def gear():
            visit('map','map')
            click('.nav [data-page=inventory]')
        def tab(screen,index):
            sel=f'[data-loadout=mobile-tab][data-screen="{screen}"][data-index="{index}"]'
            if p.locator(sel+':visible').count():click(sel)
        def mass(value):
            node=p.locator('[data-bag-mass]:visible')
            expect(node).to_have_text(value)
            assert node.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
        def inspect_prepared():
            before=snap()['equipment']
            for item,label in [('flash','0.5 kg (배터리 포함)'),('radio','0.85 kg (무전기 안테나 포함)')]:
                unit=current('equipment',item)
                click(f'[data-gear=select][data-unit="{unit["uid"]}"]')
                expect(p.locator('.lo-bag [data-selected-mass]:visible')).to_have_text(label)
                assert unit['gear']['uid']==serials[item]
            assert snap()['equipment']==before
        def field():
            visit('map','map');click('.command-deploy[data-page=raid]')
        def current(stage,item):
            return next(u for u in snap()[stage]['bag'] if u['g']==item)
        def select(item,expectation):
            unit=current('field',item);click(f'[data-pick="{unit["uid"]}"][data-side=bag]')
            expect(p.locator('[data-selected-mass]:visible')).to_have_text(expectation)
            return unit
        def action_done():
            p.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,timeout=35000,polling=300)
            while snap()['field'].get('contact'):
                click('[data-field=evade]')
                p.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,timeout=30000,polling=300)

        r=p.goto(URL+'#presets',wait_until='domcontentloaded',timeout=90000);assert r.ok and r.body()==HTML
        click('.shell-settings')
        p.locator('#restore-file').set_input_files(ROOT/'tests/fixtures/presets-v20.json')
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다.')
        visit('presets','presets')
        click('[data-preset=select][data-index="0"]')
        for slot,host,part in [('light','flash','battery'),('comms','radio','rl_13_02')]:
            box=p.locator(f'select[data-preset-slot="{slot}"]')
            if not box.is_visible():click('[data-preset=edit]')
            box.select_option(host);p.locator(f'select[data-preset-module="{slot}"]').select_option(part)
        p.locator('#preset-name').fill('운반 중량 시험')
        click('[data-preset=save]');click('[data-preset=apply]')
        kit=snap()['equipment'];assert kit['modules']=={'light':'battery','comms':'rl_13_02'}
        serials={kit['instances'][slot]['g']:kit['instances'][slot]['uid'] for slot in ['light','comms']}
        gear();tab('gear',1)
        for unit in list(snap()['equipment']['bag']):
            click(f'[data-gear=select][data-unit="{unit["uid"]}"]');click('[data-gear=unpack]')
        mass('0 kg')
        tab('gear',0)
        for slot in ['light','comms']:
            click(f'[data-loadout=slot][data-slot="{slot}"]');click(f'[data-gear=unwear][data-slot="{slot}"]')
        for item in ['flash','radio']:
            visit('stash','stash');click(f'[data-stash=select][data-id="{item}"]');click(f'[data-gear=pack][data-id="{item}"]')
            assert current('equipment',item)['gear']['uid']==serials[item]
        gear();tab('gear',1);mass('1.35 kg');inspect_prepared()
        visit('map','map');click('.command-station[data-index="0"]');click('.command-deploy[data-page=prep]')
        tab('prep',1);mass('1.35 kg');inspect_prepared();tab('prep',2);click('.lo-deploy[data-raid=start]')
        gear();tab('gear',1);mass('1.35 kg')
        select('radio','0.85 kg (무전기 안테나 포함)');lamp=select('flash','0.5 kg (배터리 포함)')
        click(f'[data-gear=drop][data-unit="{lamp["uid"]}"]');mass('0.85 kg')
        assert snap()['field']['gearGround'][0][0]['gear']['uid']==serials['flash']
        p.reload(wait_until='domcontentloaded');gear();tab('gear',1);mass('0.85 kg')
        tab('gear',2);click(f'[data-gear=recover][data-unit="{lamp["uid"]}"]');tab('gear',1);mass('1.35 kg')
        for item in serials:assert current('field',item)['gear']['uid']==serials[item]
        field();click('[data-field=scan]');action_done();click('.container-card[data-field=open]');tab('loot',2)
        scan=p.locator('.lo-search[data-field=search]:visible')
        if scan.is_enabled():scan.click();action_done()
        s=snap();assert s['field']['boxes'][s['field']['open']]['complete']
        tab('loot',1);mass('1.35 kg');select('radio','0.85 kg (무전기 안테나 포함)')
        if os.getenv('RUSTLINE_MASS_SHOTS'):
            out=Path(os.environ['RUSTLINE_MASS_SHOTS']);out.mkdir(parents=True,exist_ok=True)
            p.locator('.lo-bag:visible').screenshot(path=str(out/f'pack-{width}.png'),animations='disabled')
        expect(p.locator('[data-field-appraisal]:visible')).to_be_visible()
        click('[data-field=close]');click('[data-field=extract][data-exit=b04]');action_done()
        expect(p.locator('.result-panel')).to_be_visible();click('[data-raid=ack]')
        state=snap();assert state['wallet']==30000
        for item,uid in serials.items():
            assert next(u['gear']['uid'] for u in state['stashSlots'] if u['g']==item)==uid
        assert not errors,errors
        print(f'PASS {width}px natural clock/RNG, migrated v20 assembled at workbench: 0.50 kg lamp, 0.85 kg radio, 1.35 → 0.85 → 1.35 kg on original physical serials across drop/reload/recover, real search and return.',flush=True)


if __name__=='__main__':
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in [390,1280]:play(browser,width)
