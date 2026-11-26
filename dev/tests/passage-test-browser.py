"""Three new-character sorties to earn, schedule and reopen a real one-way route.
Set RUSTLINE_PASSAGE_NATURAL=1 for native RNG and clock; optional RUSTLINE_WIDTH=390/1280.
"""
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
BASE='https://passage-test.test/'
KEY='rl-reboot-session-v36'
JOB='passage-test'
HTML=(ROOT/'index.html').read_bytes()
def play(browser,width,natural):
    touch=width==390
    origin,fix=(0,'local') if touch else (1,'service')
    with browser.new_context(viewport={'width':width,'height':844},has_touch=touch,is_mobile=touch,
                             reduced_motion='reduce',offline=True,service_workers='block') as ctx:
        ctx.route('**/*',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8') if r.request.url==BASE else r.abort())
        if not natural:ctx.add_init_script('Math.random=()=>0.10')
        p=ctx.new_page()
        if not natural:p.clock.install()
        p.set_default_timeout(10000); errors=[]
        p.on('pageerror',lambda e:errors.append(str(e)))
        def saved():return p.evaluate("k=>JSON.parse(localStorage.getItem(k))",KEY)
        def click(sel):
            loc=p.locator(sel+":visible").first
            if touch:loc.tap()
            else:loc.focus();loc.press("Enter")
        def nav(key):p.goto(BASE+"#"+key,wait_until="domcontentloaded")
        def deploy(zone):
            nav("map");click(f'.command-station[data-index="{zone}"]');click(".command-deploy[data-page=prep]")
            click(".lo-deploy[data-raid=start]");assert saved()["raid"]["zone"]==zone
        def settle():
            for _ in range(120):
                s=saved();f=s['field']
                if f.get('result'):return
                if f.get('action'):
                    if natural:
                        p.wait_for_function("k=>!JSON.parse(localStorage.getItem(k)).field.action",arg=KEY,polling=200,timeout=45000)
                    else:p.clock.fast_forward(max(300,f['action']['end']-p.evaluate('Date.now()')+350))
                elif f.get('contact'):click('[data-field=evade]')
                elif f.get('journey') and f['journey'].get('event')=='supply':click('[data-field=journey-pass]')
                elif f.get('journey'):p.wait_for_timeout(150) if natural else p.clock.fast_forward(350)
                else:return
            raise AssertionError("field did not settle")
        def site(index):
            s=saved();z=s['raid']['zone']
            if s['field']['landmarkByZone'][z]==index:return
            picker=p.locator('.landmark-picker')
            if not picker.evaluate("e=>e.open"):click('.landmark-picker summary')
            click(f'[data-field=landmark][data-index="{index}"]')
            assert saved()['field']['landmarkByZone'][z]==index
        def move(zone):
            if saved()['raid']['zone']!=zone:
                click(f'[data-route-card][data-to="{zone}"] [data-field=move]');settle()
            assert saved()['raid']['zone']==zone
        def search_outer_clinic():
            move(0);site(7)
            for i in (14,15):
                control=f'[data-field=open][data-index="{i}"]'
                while not p.locator(control+':visible').count():click('[data-field=scan]');settle()
                click(control)
                mobile_tab='[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
                if p.locator(mobile_tab+':visible').count():click(mobile_tab)
                if p.locator('.lo-search').is_enabled():click('.lo-search');settle()
                assert saved()['field']['boxes'][f'0-{i}']['complete']
                click('[data-field=close]');settle()
        def return_normal():
            search_outer_clinic();click('[data-field=extract][data-exit=b04]');settle()
            report=saved()['lastSummary'];assert report['rating']=='success'
            return report


        def capture(tag):
            directory=os.getenv('RUSTLINE_PASSAGE_SHOTS')
            if not directory:return
            where=Path(directory);where.mkdir(parents=True,exist_ok=True)
            chart=p.locator('.command-map-left');chart.scroll_into_view_if_needed()
            chart.screenshot(path=str(where/f'{width}-{tag}.png'),animations='disabled')
        def order(job):
            nav('quests');click('[data-page=orders]');click(f'[data-bui=order][data-id="{job}"]')
            click(f'[data-order="{job}"]');click(f'[data-objective=pin][data-id="{job}"]')
        def do(step,key=''):
            click(f'[data-field=passage][data-step="{step}"]'+key)
        order('stores');deploy(0);first=return_normal();assert first['commission']==32000
        click('[data-raid=ack]');order(JOB);deploy(0);site(9)
        do('plan',f'[data-from="{1-origin}"]');do('plan',f'[data-from="{origin}"]')
        assert not p.locator('[data-passage-closed]').count()
        plan=return_normal();assert plan['commission']==0
        expect(p.locator('[data-passage-return]')).to_contain_text('수당 0 CR')
        click('[data-raid=ack]');p.reload(wait_until='domcontentloaded');wallet=saved()['wallet'];assert wallet==62000
        deploy(origin);card=p.locator(f'[data-route-card][data-to="{1-origin}"]')
        expect(card.locator('[data-passage-closed]')).to_be_visible()
        expect(card.locator('[data-field=move]')).to_be_disabled()
        bypass=p.locator('[data-route-card][data-to="2"] [data-field=move]')
        expect(bypass).to_be_enabled()
        nav('map');click(f'.command-station[data-index="{1-origin}"]');capture('closed')
        expected_text='외곽 → 검문소' if origin==0 else '검문소 → 외곽'
        expect(p.locator('[data-passage-map=closed]')).to_have_text(expected_text+' 차단')
        expect(p.locator('.command-key')).to_contain_text('군수 창고 경유 5칸')
        marker=p.locator('[data-passage-map=closed]').bounding_box()
        for index in (0,1):
            station=p.locator(f'.command-station[data-index="{index}"]').bounding_box()
            assert marker['x']+marker['width']<station['x'] or station['x']+station['width']<marker['x']
        expect(p.locator('.command-deploy')).to_be_disabled()
        click(f'.command-station[data-index="{origin}"]');click('.command-deploy[data-page=raid]')
        site(9 if origin==0 else 0);do('inspect')
        if fix=='service':move(2);site(3)
        p.reload(wait_until='domcontentloaded');nav('map')
        click(f'.command-station[data-index="{saved()["raid"]["zone"]}"]');click('.command-deploy[data-page=raid]')
        assert saved()['field']['gateTest']['stage']=='inspect'
        do(fix);expect(p.locator('[data-passage-panel]')).to_contain_text('통행 재개')
        if fix=='service':move(origin)
        nav('map');click(f'.command-station[data-index="{1-origin}"]');capture('open')
        expect(p.locator('[data-passage-map=open]')).to_have_text(expected_text+' 개통')
        expect(p.locator('.command-key')).to_contain_text('직통 1칸 통행 재개')
        expect(p.locator('.command-deploy')).to_be_enabled()
        click(f'.command-station[data-index="{origin}"]');click('.command-deploy[data-page=raid]')
        expect(p.locator(f'[data-route-card][data-to="{1-origin}"] [data-field=move]')).to_be_enabled()
        # The previously blocked direction is used in this same live sortie.
        move(1-origin);last=return_normal();cr=28000 if touch else 46000;xp=90 if touch else 145
        assert last['commission']==cr and last['missionXp']==xp
        assert not errors,errors
        assert saved()['wallet']==wallet+cr and saved()['career']['gateTest']['receipt']['fix']==fix
        click('[data-raid=ack]');p.reload(wait_until='domcontentloaded')
        assert saved()['wallet']==wallet+cr and saved()['career']['done'].count(JOB)==1
        print(f'PASS {width}px real={natural}: stores/plan/restore {first["elapsed"]}/{plan["elapsed"]}/{last["elapsed"]}ms, origin {origin}→{1-origin}, {fix}, crossed reopened road, {wallet}+{cr} CR and {xp} XP once.',flush=True)

if __name__=='__main__':
    widths=(int(os.environ['RUSTLINE_WIDTH']),) if os.getenv('RUSTLINE_WIDTH') else (390,1280)
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
        for w in widths:play(browser,w,os.getenv('RUSTLINE_PASSAGE_NATURAL')=='1')
