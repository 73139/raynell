"""Earn the ledger prerequisite and personally carry a single mail parcel using the game UI.
Set RUSTLINE_POSTAL_NATURAL=1 to use the browser's own wall clock and RNG (one mobile run).
"""
import os
from pathlib import Path
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1];HTML=(ROOT/'index.html').read_bytes()
LIVE=os.getenv('RUSTLINE_URL');URL=urldefrag(LIVE or 'https://rustline-postal.test/').url
KEY='rl-reboot-session-v36';MAIL='sealed-mail';GOOD='rl_sealed_mail'

def play(browser,width,natural):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as c:
        if not LIVE:c.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        if not natural:c.add_init_script('Math.random=()=>0.10')
        p=c.new_page();p.set_default_timeout(7500);p.set_default_navigation_timeout(60000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        if not natural:p.clock.install()
        def click(sel):
            loc=p.locator(sel+':visible').first
            if mobile:loc.tap()
            else:loc.click()
        def saved():return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def nav(fragment):p.goto(URL+'#'+fragment,wait_until='domcontentloaded')
        def rest():
            for _ in range(70):
                s=saved();f=s['field']
                if f.get('result'):return
                if f.get('action'):
                    if natural:p.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,timeout=45000,polling=350)
                    else:p.clock.fast_forward(max(400,f['action']['end']-p.evaluate('Date.now()')+500))
                elif f.get('contact'):click('[data-field=evade]')
                elif f.get('journey',{}):
                    if f['journey'].get('event')=='supply':click('[data-field=journey-pass]')
                    elif natural:p.wait_for_timeout(100)
                    else:p.clock.fast_forward(400)
                else:return
            raise AssertionError('field interaction failed to settle')
        def move(z):
            if saved()['raid']['zone']!=z:click(f'[data-route-card][data-to="{z}"] [data-field=move]');rest()
            assert saved()['raid']['zone']==z
        def site(z,l):
            move(z)
            if saved()['field']['landmarkByZone'][z]!=l:
                click('.landmark-picker summary');click(f'[data-field=landmark][data-index="{l}"]')
        def search(z,l,b):
            site(z,l);sel=f'[data-field=open][data-index="{b}"]'
            for _ in range(3):
                if p.locator(sel+':visible').count():break
                click('[data-field=scan]');rest()
            click(sel);tab='[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
            if p.locator(tab+':visible').count():click(tab)
            click('.lo-search[data-field=search]');rest();assert saved()['field']['boxes'][f'{z}-{b}']['complete'];click('[data-field=close]')
        def accept(id):
            nav('quests');click('[data-page=orders]');click(f'[data-bui=order][data-id="{id}"]');click(f'[data-order="{id}"]');click(f'[data-objective=pin][data-id="{id}"]')
        def deploy(z):nav('map');click(f'.command-station[data-index="{z}"]');click('.command-deploy[data-page=prep]');click('.lo-deploy[data-raid=start]')
        def raid_tab(z):nav('map');click(f'.command-station[data-index="{z}"]');click('.command-deploy[data-page=raid]')
        def extract():move(0);click('[data-field=extract][data-exit=b04]');rest();return saved()['lastSummary']
        def stage(name):
            panel=p.locator('[data-postal-stage]');expect(panel).to_have_attribute('data-postal-stage',name)
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            if os.getenv('RUSTLINE_POSTAL_SHOTS') and name in ('waiting','stamped'):
                folder=Path(os.environ['RUSTLINE_POSTAL_SHOTS']);folder.mkdir(parents=True,exist_ok=True)
                panel.screenshot(path=str(folder/f'postal-{name}-{width}.png'),animations='disabled')
        def bag_tab(i):
            sel=f'[data-loadout=mobile-tab][data-screen=gear][data-index="{i}"]'
            if p.locator(sel+':visible').count():click(sel)
        response=p.goto(URL+'#quests');assert response and response.body()==HTML
        click('[data-page=orders]');expect(p.locator('[data-bui=order][data-id=sealed-mail]')).to_have_count(0)
        accept('handover-ledgers');deploy(1);search(1,1,6);search(0,8,17);r=extract();assert r['commission']==34000 and r['rating']=='success';click('[data-raid=ack]')
        print(f'{width}px prerequisite earned: {r["elapsed"]} ms, 34,000 CR, two fully searched drawers.',flush=True)
        accept(MAIL);expect(p.locator('.bu-order-panel')).to_contain_text('가방 두 칸');deploy(2);site(2,4);stage('waiting');click('[data-field=postal-pickup]');stage('carried')
        s=saved();u=next(x for x in s['field']['bag'] if x['g']==GOOD);uid=u['uid'];assert u['w']*u['h']==2 and u['uid']=='post-'+str(s['raid']['startedAt'])
        if os.getenv('RUSTLINE_POSTAL_PREVIOUS_HTML') and not LIVE:
            old=Path(os.environ['RUSTLINE_POSTAL_PREVIOUS_HTML']).read_bytes()
            assert b'RL-TC01 v0.68</title>' in old and b'rl_sealed_mail' not in old
            c.route(URL+'?previous*',lambda route:route.fulfill(body=old,content_type='text/html; charset=utf-8'))
            previous=c.new_page();response=previous.goto(URL+'?previous#map');assert response.body()==old
            expect(previous.locator('#save-upgrade')).to_be_visible();assert saved()==s
            previous.close()
        click('.nav [data-page=inventory]');bag_tab(1);click(f'[data-pick="{uid}"][data-side=bag]');click(f'[data-gear=drop][data-unit="{uid}"]')
        raid_tab(2);stage('ground');expect(p.locator('[data-postal-stage]')).to_contain_text('군수 보급 창고 바닥')
        p.reload(wait_until='domcontentloaded');raid_tab(2);stage('ground');expect(p.locator('[data-field=postal-pickup]')).to_have_count(0)
        click('.nav [data-page=inventory]');bag_tab(2);click(f'[data-gear=recover][data-unit="{uid}"]');raid_tab(2);stage('carried')
        site(1,4);button=p.locator('[data-field=postal-stamp]');expect(button).to_be_enabled();button.focus();p.keyboard.press('Enter');stage('stamped');assert not any(x['g']==GOOD for x in saved()['field']['bag'])
        expect(p.locator('[data-field=postal-stamp]')).to_have_count(0)
        # A genuine two-case search qualifies for normal extraction without buying gear or fighting.
        search(1,4,5);search(1,4,9);r=extract();assert (r['rating'],r['commission'],r['missionXp'],r['goods'])==('success',30000,105,[])
        click('[data-raid=ack]');p.reload(wait_until='domcontentloaded');s=saved();assert s['wallet']==94000 and s['career']['done'].count(MAIL)==1 and not s['stash'] and s['career']['sorties']==2
        nav('quests');click('[data-page=orders]');click(f'[data-bui=order][data-id="{MAIL}"]');expect(p.locator(f'[data-order="{MAIL}"]')).to_be_disabled();assert not errors,errors
        print(f'PASS {width}px {"real clock/RNG" if natural else "controlled clock/RNG"}: new player earned access, real 2-cell mail, region drop and original UID recovered across reload, relay consumed it, normal extraction {r["elapsed"]} ms, one 30,000 CR / 105 XP payment, 94,000 CR after both orders.',flush=True)

if __name__=='__main__':
    natural=os.getenv('RUSTLINE_POSTAL_NATURAL')=='1';proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in ([390] if natural else [390,1280]):play(browser,width,natural)
