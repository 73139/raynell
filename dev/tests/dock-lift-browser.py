"""A new operator unlocks a cargo lift, buys two vests and weighs them on the next sortie."""
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

HTML = (Path(__file__).resolve().parents[1] / 'index.html').read_bytes()
LIVE = os.getenv('RUSTLINE_URL')
URL = LIVE or 'https://rustline-dock.test/'
KEY = 'rl-reboot-session-v36'
NATURAL = os.getenv('RUSTLINE_LIFT_NATURAL') == '1'

def play(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={'width': width, 'height': 860}, has_touch=mobile, is_mobile=mobile,
                             ignore_https_errors=bool(LIVE), service_workers='block', accept_downloads=True) as ctx:
        errors = []
        def serve(route):
            if route.request.method != 'GET' or urlsplit(route.request.url).netloc != urlsplit(URL).netloc:
                errors.append(route.request.url)
                return route.abort()
            if LIVE:
                return route.continue_()
            route.fulfill(body=HTML, content_type='text/html; charset=utf-8')
        ctx.route('**/*', serve)
        page = ctx.new_page()
        page.set_default_timeout(8000)
        page.set_default_navigation_timeout(60000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        if not NATURAL:
            page.clock.install()
            ctx.add_init_script('Math.random = () => 0.13')
        response = page.goto(URL + '#map', wait_until='domcontentloaded')
        assert response and response.ok and response.body() == HTML
        def screenshot(locator,label):
            target=os.getenv('RUSTLINE_LIFT_SHOTS')
            if target:
                folder=Path(target);folder.mkdir(parents=True,exist_ok=True)
                locator.screenshot(path=str(folder/f'dock-{label}-{width}.png'),animations='disabled')
        def saved():
            return page.evaluate('k => JSON.parse(localStorage.getItem(k))', KEY)
        def press(selector):
            loc = page.locator(selector + ':visible').first
            loc.tap() if mobile else loc.click()
        def settle():
            for _ in range(100):
                f = saved()['field']
                if f.get('result'):
                    return
                if f.get('action'):
                    if NATURAL:
                        page.wait_for_function('k => !JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,timeout=60000)
                    else:
                        remaining = f['action']['end'] - page.evaluate('Date.now()')
                        page.clock.fast_forward(max(400, remaining + 500))
                elif f.get('contact'):
                    press('[data-field=evade]')
                elif f.get('journey'):
                    if f['journey'].get('event') == 'supply':
                        press('[data-field=journey-pass]')
                    elif NATURAL:
                        page.wait_for_timeout(200)
                    else:
                        page.clock.fast_forward(500)
                else:
                    return
            raise AssertionError('field activity did not settle')
        def move(zone):
            if saved()['raid']['zone'] != zone:
                press(f'[data-route-card][data-to="{zone}"] [data-field=move]')
                settle()
            assert saved()['raid']['zone'] == zone

        def select_map():
            page.goto(URL+'#map',wait_until='domcontentloaded')
            press('.command-station[data-index="2"]')
        def plan(count):
            select_map();panel=page.locator('[data-dock-plan]')
            expect(panel.locator('summary')).to_contain_text(f'{count} / 3')
            if not panel.evaluate('e=>e.open'):
                trigger=panel.locator('summary')
                if mobile:trigger.tap()
                else:trigger.focus();trigger.press('Enter')
            expect(panel.locator('[data-dock-survey]')).to_have_count(3)
            expect(panel).to_contain_text('4.000 kg')
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        def start():
            select_map();press('.command-deploy[data-page=prep]')
            if not page.locator('.lo-deploy[data-raid=start]:visible').count():
                press('[data-loadout=mobile-tab][data-screen=prep][data-index="2"]')
            press('.lo-deploy[data-raid=start]')
            assert saved()['raid']['zone']==2
        def site(index):
            if saved()['field']['landmarkByZone'][2]==index:return
            if not page.locator('.landmark-picker').evaluate('e=>e.open'):press('.landmark-picker summary')
            press(f'[data-field=landmark][data-index="{index}"]')
            assert saved()['field']['landmarkByZone'][2]==index
        def tab(screen,index):
            select=f'[data-loadout=mobile-tab][data-screen="{screen}"][data-index="{index}"]'
            if page.locator(select+':visible').count():press(select)
        def search(landmark,index):
            site(landmark)
            control=f'[data-field=open][data-index="{index}"]'
            for _ in range(4):
                if page.locator(control+':visible').count():break
                press('[data-field=scan]');settle()
            press(control);tab('loot',2)
            if page.locator('.lo-search').is_enabled():press('.lo-search');settle()
            assert saved()['field']['boxes'][f'2-{index}']['complete']
            press('[data-field=close]');settle()
        plan(0);screenshot(page.locator('[data-dock-plan]'),'map');start()
        first=saved()['raid']['startedAt'];assert 'lift' not in saved()['field']['exits']
        for lm,i in [(1,3),(2,4),(4,8)]:search(lm,i)
        assert not saved()['career'].get('surveyedBoxes')
        move(0);press('[data-field=extract][data-exit=b04]');settle()
        one=saved()['lastSummary'];assert one['rating']=='success'
        assert set(one['newSurveyBoxes'])=={'2-3','2-4','2-8'} and 'lift' not in saved()['field']['exits']
        press('[data-raid=ack]');plan(3)
        assert saved()['wallet']==30000
        page.goto(URL+'#shop');press('[data-market=trader][data-id=quarter]');press('[data-market=item][data-id=rl10_vest]')
        for _ in range(2):press('[data-cart=add][data-id=rl10_vest]')
        press('[data-cart=checkout]')
        assert saved()['wallet']==0 and saved()['stash']['rl10_vest']==2
        page.goto(URL+'#stash');stock=[u['uid'] for u in saved()['stashSlots'] if u['g']=='rl10_vest']
        for uid in stock:
            press(f'[data-stash=select][data-uid="{uid}"]');press(f'[data-gear=pack][data-unit="{uid}"]')
        select_map()
        map_card=page.locator('[data-dock-plan]')
        if not map_card.evaluate('e=>e.open'):press('[data-dock-plan] summary')
        expect(map_card.locator('[data-dock-kit]')).to_contain_text('4.200 kg / 4.000 kg · 0.200 kg 초과')
        press('.command-deploy[data-page=prep]')
        manifest=page.locator('[data-dock-manifest]')
        press('[data-dock-manifest] summary')
        expect(manifest.locator('summary')).to_contain_text('0.200 kg 초과')
        before=saved()
        copies=[u['uid'] for u in before['equipment']['bag'] if u['g']=='rl10_vest']
        assert len(copies)==2
        boxes=manifest.locator('input[type=checkbox]')
        boxes.nth(0).check()
        expect(manifest.locator('output')).to_contain_text('2.100 kg / 4.000 kg · 1.900 kg 여유')
        screenshot(manifest,'preflight-one-vest')
        boxes.nth(1).check()
        expect(manifest.locator('output')).to_contain_text('0.000 kg')
        boxes.nth(0).uncheck()
        assert saved()==before
        chosen=copies[1]
        press(f'[data-loadout=dock-review][data-uid="{chosen}"]')
        expect(page.locator(f'[data-kit-grid] [data-gear=select][data-unit="{chosen}"]')).to_be_focused()
        assert saved()==before
        press('[data-gear=unpack]')
        now=saved()
        assert now['stash']['rl10_vest']==1 and [u['uid'] for u in now['equipment']['bag']]==[copies[0]]
        expect(page.locator('[data-dock-manifest] summary')).to_contain_text('2.100 kg')
        page.goto(URL+'#stash',wait_until='domcontentloaded')
        packed=next(u for u in saved()['stashSlots'] if u['g']=='rl10_vest')
        press(f'[data-stash=select][data-uid="{packed["uid"]}"]')
        press(f'[data-gear=pack][data-unit="{packed["uid"]}"]')
        start();initial=saved();ids=[u['uid'] for u in initial['field']['bag'] if u['g']=='rl10_vest']
        assert len(ids)==2 and initial['raid']['startedAt']!=first and initial['field']['exits'].count('lift')==1
        press_lift='[data-field=extract][data-exit=lift]'
        expect(page.locator(press_lift)).to_be_disabled()
        site(1);expect(page.locator('[data-dock-load]')).to_contain_text('4.200 kg')
        card=page.locator('.exit-card').filter(has=page.locator(press_lift))
        expect(card).to_contain_text('0.200 kg 초과');screenshot(card,'overweight')
        card.locator('[data-page=inventory]').click();tab('gear',1)
        press(f'[data-pick="{ids[0]}"][data-side=bag]');press(f'[data-gear=drop][data-unit="{ids[0]}"]')
        assert saved()['field']['gearGround'][2][0]['uid']==ids[0]
        select_map();press('.command-deploy[data-page=raid]')
        expect(page.locator('[data-dock-load]')).to_contain_text('2.100 kg')
        expect(page.locator(press_lift)).to_be_enabled()
        press(press_lift);state=saved()
        assert state['field']['action']['end']-state['field']['action']['start']==25000
        end=state['field']['action']['end']
        page.reload(wait_until='domcontentloaded')
        assert saved()['field']['action']['end']==end
        settle();report=saved()['lastSummary']
        assert report['result']=='success' and report['exit']=='하역 도크 화물 리프트'
        assert report['liftGrams']==2100 and report['goods']==['rl10_vest'] and report['cost']==0
        if page.locator('#inside').get_attribute('data-page')!='raid':
            select_map();press('.command-deploy[data-page=raid]')
        expect(page.locator('[data-dock-receipt]')).to_contain_text('2.100 kg')
        press('[data-raid=ack]');page.reload(wait_until='domcontentloaded')
        final=saved();assert final['stash']['rl10_vest']==1
        assert final['career']['history'][0]['liftGrams']==2100 and final['career']['sorties']==2
        if page.locator('.nav [data-page=journal]:visible').count():press('.nav [data-page=journal]')
        else:press('.nav [data-page=more]');press('.shortcut-grid [data-page=journal]')
        press('[data-bui=history][data-index="0"]')
        expect(page.locator('[data-dock-receipt]')).to_contain_text('2.100 kg')
        screenshot(page.locator('.bu-log-detail'),'receipt')
        assert not errors,errors
        print(f'PASS {width}px natural={NATURAL}: three unkeyed sites in {one["elapsed"]}ms; '
              f'two 15,000 CR vests, 4.200→2.100 kg; 25,000 ms extract and reload, '
              f'{report["elapsed"]}ms second sortie, 2.100 kg receipt and exactly one returned vest.',flush=True)
if __name__=='__main__':
    import argparse
    args=argparse.ArgumentParser(description=__doc__);args.add_argument('widths',nargs='*',type=int);a=args.parse_args()
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
        for width in a.widths or [390,1280]:play(browser,width)
