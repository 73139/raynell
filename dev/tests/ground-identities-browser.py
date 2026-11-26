"""Identify one of two dropped lamps by its visible configuration and accessible action name."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
URL=urldefrag(os.getenv('RUSTLINE_URL') or 'https://ground-gear.test/').url
KEY='rl-reboot-session-v36'


def play(browser,width):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844},is_mobile=mobile,has_touch=mobile,
            reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as ctx:
        if not os.getenv('RUSTLINE_URL'):ctx.route(URL+'**',lambda route:route.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        p=ctx.new_page();p.set_default_timeout(7500);errors=[]
        p.on('pageerror',lambda error:errors.append(str(error)));p.on('dialog',lambda d:d.accept())
        def click(selector):
            button=p.locator(selector+':visible').first
            button.tap() if mobile else button.click()
        def saved():
            return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def visit(fragment,screen):
            p.goto(URL+'#'+fragment,wait_until='domcontentloaded')
            if p.locator('#inside').get_attribute('data-page')!=screen:p.reload(wait_until='domcontentloaded')
            expect(p.locator('#inside')).to_have_attribute('data-page',screen)
        def tab(screen,i):
            sel=f'[data-loadout=mobile-tab][data-screen="{screen}"][data-index="{i}"]'
            if p.locator(sel+':visible').count():click(sel)
        def gear(i):
            visit('map','map');click('.nav [data-page=inventory]');tab('gear',i)
        r=p.goto(URL+'#presets',timeout=90000,wait_until='domcontentloaded');assert r.ok and r.body()==HTML
        # The native v20 backup has one lamp, a case-held battery and an issued kit. Add one unfitted spare.
        old=json.loads((ROOT/'tests/fixtures/presets-v20.json').read_text())
        old['session']['stash']['flash']+=1
        click('.shell-settings');p.locator('#restore-file').set_input_files({'name':'two-lamps-v20.json','mimeType':'application/json','buffer':json.dumps(old).encode()})
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다.')
        visit('presets','presets');click('[data-preset=select][data-index="0"]')
        slot=p.locator('select[data-preset-slot=light]')
        if not slot.is_visible():click('[data-preset=edit]')
        slot.select_option('flash');p.locator('select[data-preset-module=light]').select_option('battery')
        p.locator('#preset-name').fill('조명 2점 구분');click('[data-preset=save]');click('[data-preset=apply]')
        gear(0);click('[data-loadout=slot][data-slot=light]');click('[data-gear=unwear][data-slot=light]')
        for _ in range(2):
            visit('stash','stash');click('[data-stash=select][data-id=flash]');click('[data-gear=pack][data-id=flash]')
        visit('map','map');click('.command-station[data-index="0"]');click('.command-deploy[data-page=prep]');click('.lo-deploy[data-raid=start]')
        gear(1)
        lamps=[u for u in saved()['field']['bag'] if u['g']=='flash']
        assert sorted(str(u['gear'].get('module')) for u in lamps)==['None','battery']
        fitted=next(u for u in lamps if u['gear'].get('module'))
        bare=next(u for u in lamps if not u['gear'].get('module'))
        for unit in [bare,fitted]:
            click(f'[data-pick="{unit["uid"]}"][data-side=bag]');click(f'[data-gear=drop][data-unit="{unit["uid"]}"]')
        gear(2)
        panel=p.locator('.kit-ground')
        expect(panel.get_by_role('button')).to_have_count(2)
        # Use only the information an actual player can see or hear to choose the recover action.
        chosen=panel.get_by_role('button',name=re.compile(r'휴대용 조명.*0\.5 kg.*배터리 포함.*회수'))
        other=panel.get_by_role('button',name=re.compile(r'휴대용 조명.*0\.25 kg.*회수'))
        for button in [chosen,other]:
            expect(button).to_have_count(1);assert button.bounding_box()['height']>=44
        expect(panel).to_contain_text('#'+fitted['gear']['uid'][-8:]);expect(panel).to_contain_text('#'+bare['gear']['uid'][-8:])
        assert panel.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
        if os.getenv('RUSTLINE_GROUND_SHOTS'):
            out=Path(os.environ['RUSTLINE_GROUND_SHOTS']);out.mkdir(parents=True,exist_ok=True)
            panel.screenshot(path=str(out/f'floor-{width}.png'),animations='disabled')
        if mobile:chosen.tap()
        else:chosen.focus();p.keyboard.press('Enter')
        expect(other).to_be_visible();expect(chosen).to_have_count(0)
        live=saved()['field'];returned=[u for u in live['bag'] if u['g']=='flash']
        assert len(returned)==1 and returned[0]['gear']==fitted['gear'] and returned[0]['uid']==fitted['uid']
        assert [u['uid'] for u in live['gearGround'][0]]==[bare['uid']]
        p.reload(wait_until='domcontentloaded');gear(2);expect(other).to_be_visible()
        visit('map','map');click('.command-deploy[data-page=raid]');click('[data-field=extract][data-exit=b04]')
        expect(p.locator('.result-panel')).to_be_visible(timeout=16000)
        report=saved()['lastSummary']['gearReport']
        assert {row['uid']:row['disposition'] for row in report if row['g']=='flash'}=={fitted['gear']['uid']:'returned',bare['gear']['uid']:'left'}
        click('[data-raid=ack]');assert saved()['stash']['flash']==1
        assert not errors,errors
        print(f'PASS {width}px native v20 plus spare → fit and drop both, choose using module/weight only, retain exact other serial on ground across reload, independent returned/left receipts.',flush=True)


if __name__=='__main__':
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in [390,1280]:play(browser,width)
