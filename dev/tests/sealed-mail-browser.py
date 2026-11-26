"""Earn the ledger prerequisite and personally carry a single mail parcel using the game UI.
Set RUSTLINE_POSTAL_NATURAL=1 for the browser's wall clock and RNG (one mobile run).
Set RUSTLINE_POSTAL_TRANSFER=1 to move the live sortie to a fresh profile via a downloaded file.
"""
import json
import os
from contextlib import ExitStack
from hashlib import sha256
from tempfile import TemporaryDirectory
from pathlib import Path
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1];HTML=(ROOT/'index.html').read_bytes()
LIVE=os.getenv('RUSTLINE_URL');URL=urldefrag(LIVE or 'https://rustline-postal.test/').url
KEY='rl-reboot-session-v36';MAIL='sealed-mail';GOOD='rl_sealed_mail'

def play(browser,width,natural):
    mobile=width==390
    transfer=os.getenv('RUSTLINE_POSTAL_TRANSFER')=='1'
    errors=[]
    with ExitStack() as stack:
        def new_profile(clock=None):
            ctx=stack.enter_context(browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,
                reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1'))
            if not LIVE:ctx.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
            if not natural:ctx.add_init_script('Math.random=()=>0.10')
            page=ctx.new_page()
            page.set_default_timeout(7500);page.set_default_navigation_timeout(60000)
            page.on('pageerror',lambda e:errors.append(str(e)))
            if not natural:page.clock.install(time=clock)
            return ctx,page
        c,p=new_profile()
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
            if saved()['field']['landmarkByZone'][z]==l:return
            picker=p.locator('.landmark-picker')
            option=picker.locator(f'[data-field=landmark][data-index="{l}"]')
            expect(picker).to_be_visible()
            # The native disclosure and the location button change this page in place.
            if not picker.evaluate('details=>details.open'):
                summary=picker.locator('summary')
                if mobile:summary.tap()
                else:summary.click(no_wait_after=True)
            expect(option).to_be_visible()
            if mobile:option.tap()
            else:option.click(no_wait_after=True)
            expect(option).to_have_attribute('aria-pressed','true')
            state=saved()
            assert state['raid']['zone']==z and state['field']['landmarkByZone'][z]==l
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
        if transfer:
            def identity(state):
                assert state['field']['postal']['raidId']==state['raid']['startedAt']
                assert state['objectivePin']=={'kind':'order','id':MAIL} and state['career']['order']==MAIL
                units=[(z,u['uid']) for z,ground in enumerate(state['field']['gearGround']) for u in ground if u['g']==GOOD]
                assert units==[(2,uid)] and not any(u['g']==GOOD for u in state['field']['bag'])
                return state['raid']['startedAt'],state['raid']['endsAt'],state['raid']['zone'],state['field']['landmarkByZone'][2],state['wallet'],units
            before=identity(saved())
            assert before[2:5]==(2,4,64000) and before[1]-before[0]==30*60000
            click('.shell-settings')
            with TemporaryDirectory(prefix='rustline-postal-transfer-') as directory:
                with p.expect_download() as downloading:click('[data-backup=export]')
                download=downloading.value;path=Path(directory)/download.suggested_filename
                assert path.name=='Rustline_save_v36.json'
                download.save_as(path)
                raw=path.read_bytes();data=json.loads(raw)
                assert data['format']=='rustline-tc01' and identity(data['session'])==before
                clock=None if natural else p.evaluate('Date.now()/1000')
                p.close();c.close()
                c,p=new_profile(clock)
                response=p.goto(URL+'#map');assert response.ok and response.body()==HTML
                click('.shell-settings')
                p.wait_for_function('k=>!!localStorage.getItem(k)',arg=KEY)
                empty=saved()
                assert empty['wallet']==30000 and empty['raid'] is None and not empty['career']['done'] and not empty['objectivePin']
                confirmations=[]
                def replace(dialog):
                    confirmations.append((dialog.type,dialog.message))
                    dialog.accept()
                p.once('dialog',replace)
                with p.expect_file_chooser() as choosing:click('[data-backup=import]')
                choosing.value.set_files(path)
                expect(p.locator('.save-panel [role=status]')).to_contain_text('백업을 복원했습니다.')
                assert len(confirmations)==1 and confirmations[0][0]=='confirm' and '백업으로 교체' in confirmations[0][1]
                assert identity(saved())==before
                print('TRANSFER '+json.dumps(dict(start=before[0],end=before[1],zone=before[2],landmark=before[3],wallet=before[4],
                    uid=uid,fileSize=len(raw),fileSha256=sha256(raw).hexdigest(),htmlSha256=sha256(HTML).hexdigest()),ensure_ascii=False),flush=True)
        else:p.reload(wait_until='domcontentloaded')
        raid_tab(2);stage('ground');expect(p.locator('[data-field=postal-pickup]')).to_have_count(0)
        click('.nav [data-page=inventory]');bag_tab(2);click(f'[data-gear=recover][data-unit="{uid}"]');raid_tab(2);stage('carried')
        assert [unit['uid'] for unit in saved()['field']['bag'] if unit['g']==GOOD]==[uid]
        site(1,4);button=p.locator('[data-field=postal-stamp]');expect(button).to_be_enabled();button.focus();p.keyboard.press('Enter');stage('stamped');assert not any(x['g']==GOOD for x in saved()['field']['bag'])
        expect(p.locator('[data-field=postal-stamp]')).to_have_count(0)
        assert not any(unit['g']==GOOD for ground in saved()['field']['gearGround'] for unit in ground)
        # A genuine two-case search qualifies for normal extraction without buying gear or fighting.
        search(1,4,5);search(1,4,9);r=extract();assert (r['rating'],r['commission'],r['missionXp'],r['goods'])==('success',30000,105,[])
        click('[data-raid=ack]');p.reload(wait_until='domcontentloaded');s=saved();assert s['wallet']==94000 and s['career']['done'].count(MAIL)==1 and not s['stash'] and s['career']['sorties']==2
        assert sum(row.get('commission',0) for row in s['career']['history'])==64000 and s['career']['returns']==2
        nav('quests');click('[data-page=orders]');click(f'[data-bui=order][data-id="{MAIL}"]');expect(p.locator(f'[data-order="{MAIL}"]')).to_be_disabled();assert not errors,errors
        print(f'PASS {width}px {"real clock/RNG" if natural else "controlled clock/RNG"}: new player earned access, real 2-cell mail, region drop and original UID recovered across {"file transfer" if transfer else "reload"}, relay consumed it, normal extraction {r["elapsed"]} ms, one 30,000 CR / 105 XP payment, 94,000 CR after both orders.',flush=True)

        if os.getenv('RUSTLINE_COURIER_CHAIN')=='1':
            accept('courier-checkin');deploy(0)
            field_note=p.locator('[data-courier-checkins]:visible').first
            expect(field_note.locator('li')).to_have_count(0)
            assert '폐쇄 검문소' not in field_note.inner_text()
            start=saved()['raid']['startedAt']
            def at_time(elapsed):
                left=start+elapsed-p.evaluate('Date.now()')
                if left<=0:return
                if natural:
                    while left>0:
                        p.wait_for_timeout(min(12000,left+50));left=start+elapsed-p.evaluate('Date.now()')
                else:p.clock.fast_forward(left+50)
            def notebook():
                click('[data-courier-checkins] [data-page=survivors]')
                expect(p.locator('[data-survivor=observe]')).to_be_visible()
            notebook();click('[data-survivor=observe]');click('[data-survivor=follow][data-token=boots-0]')
            click('[data-survivor=meet]');click('[data-survivor=decline]')
            assert saved()['wallet']==94000 and len(saved()['survivor']['active']['meetings'])==1
            raid_tab(0);expect(field_note.locator('li')).to_have_count(1)
            # Search while waiting in this region; two fully searched cases qualify for normal extraction.
            search(0,0,0);search(0,0,1)
            at_time(90050);notebook();click('[data-survivor=observe]')
            clue=p.locator('[data-sv-clue][data-kind=cloth]:visible').first
            expect(clue).to_contain_text('폐쇄 검문소');click('[data-survivor=follow][data-token=cloth-0]')
            raid_tab(0);move(1);at_time(105050)
            p.reload(wait_until='domcontentloaded');raid_tab(1);expect(field_note.locator('li')).to_have_count(1)
            notebook();click('[data-survivor=meet]');raid_tab(1)
            expect(field_note.locator('li')).to_have_count(2)
            expect(field_note).to_contain_text('정상 탈출');assert saved()['wallet']==94000
            r=extract();assert r['rating']=='success' and (r['commission'],r['missionXp'])==(38000,135)
            click('[data-raid=ack]');p.reload(wait_until='domcontentloaded');end=saved()
            assert end['wallet']==132000 and end['career']['sorties']==3 and end['career']['done'].count('courier-checkin')==1
            assert not errors,errors
            print(f'PASS {width}px {"real clock/RNG" if natural else "controlled clock/RNG"}: ledger → sealed mail → two courier meetings, real journal clue and mid-raid reload, water declined, {r["elapsed"]} ms, 38,000 CR / 135 XP once, 132,000 CR.',flush=True)

if __name__=='__main__':
    natural=os.getenv('RUSTLINE_POSTAL_NATURAL')=='1';proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in ([390] if natural else [390,1280]):play(browser,width,natural)
