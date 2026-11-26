"""Use a fresh player, a deliberately pinned order, and genuine mouse/touch/keyboard controls.
The default run is offline and serves the compiled HTML from memory. RUSTLINE_URL selects the
exact published build; no profile is imported and no game clock or loot draw is modified.
"""
from hashlib import sha256
import os
from pathlib import Path
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
LIVE=os.getenv('RUSTLINE_URL')
URL=urldefrag(LIVE or 'http://127.0.0.1:8692/').url
KEY='rl-reboot-session-v36'


def play(browser,width):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,
                             offline=not LIVE,service_workers='block',reduced_motion='reduce',
                             ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as ctx:
        if not LIVE:
            ctx.route('**/*',lambda route:route.fulfill(body=HTML,content_type='text/html;charset=utf-8')
                      if route.request.url.startswith(URL) else route.abort())
        p=ctx.new_page()
        p.set_default_timeout(10000)
        p.set_default_navigation_timeout(90000)
        errors=[]
        p.on('pageerror',lambda e:errors.append(str(e)))
        response=p.goto(URL+'#map',wait_until='domcontentloaded')
        assert response.ok and sha256(response.body()).digest()==sha256(HTML).digest()

        def state():return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def button(selector):return p.locator(selector+':visible').first
        def hit(selector):
            target=button(selector)
            target.tap() if mobile else target.click()
        def nav(fragment):p.goto(URL+'#'+fragment,wait_until='domcontentloaded')
        def deploy():
            nav('map');hit('.command-station[data-index="0"]');hit('.command-deploy[data-page=prep]');hit('.lo-deploy[data-raid=start]')
        def settle():
            for _ in range(15):
                f=state()['field']
                if f.get('action'):
                    p.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,timeout=60000)
                elif f.get('contact'):
                    hit('[data-field=evade]')
                else:return
            raise AssertionError('Action did not settle')
        def preserved(s):
            return {k:s[k] for k in ('raid','field','wallet','equipment','contracts','career','objectivePin','onboarding')}
        def preview(context):
            start=preserved(state())
            guide=p.locator('[data-guide-panel]:visible').first
            expect(guide).to_contain_text('빗물 펌프장 수위 판독')
            jump=guide.get_by_role('button',name='고정 목표 보기',exact=True)
            if mobile:
                # Separate deliberate taps after navigation from the guide's double-tap guard.
                p.wait_for_timeout(650)
                jump.tap()
            else:
                for _ in range(260):
                    if jump.evaluate('e=>e===document.activeElement'):break
                    p.keyboard.press('Tab')
                expect(jump).to_be_focused()
                p.keyboard.press('Enter')
            panel=p.locator(f'[data-objective-panel="{context}"]:visible')
            expect(panel).to_be_focused()
            expect(panel.get_by_role('heading')).to_have_text('빗물 펌프장 수위 판독')
            assert panel.locator('h2').evaluate("""h=>{const r=h.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}""")
            p.keyboard.press('Enter')
            assert preserved(state())==start,'Opening the objective changed gameplay'

        assert state()['wallet']==30000 and state()['career']['returns']==0
        if mobile:
            deploy();expect(button('[data-guide=next]')).to_have_attribute('data-guide-action','extract')
            hit('[data-field=extract][data-exit=b04]');settle();hit('[data-raid=ack]')
        nav('quests');hit('[data-page=orders]');hit('[data-bui=order][data-id=pump-gauge]')
        hit('[data-order=pump-gauge]');hit('[data-objective=pin][data-id=pump-gauge]');deploy()
        assert state()['objectivePin']=={'kind':'order','id':'pump-gauge'}
        preview('field')
        nav('map');preview('map')
        hit('[data-page=inventory]')
        expect(p.locator('#inside')).to_have_attribute('data-page','inventory')
        preview('field')
        hit('[data-field=scan]');settle()
        hit('[data-field=open]');assert state()['field']['open']
        preview('loot')
        hit('[data-field=close]')
        hit('[data-field=extract][data-exit=b04]');settle()
        s=state()
        assert not s['lastSummary']['commission'] and s['career']['order']=='pump-gauge'
        assert s['wallet']==30000 and 'supply-pantry'not in s['contracts']['supply']['done']
        assert not errors,errors
        print(f'PASS {width}px {"touch / one prior return" if mobile else "keyboard / first sortie"}: field, map, open loot objective focused in view; no extraction or gameplay mutation through preview; optional manual exit, no unearned credit.',flush=True)


if __name__=='__main__':
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright()as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy)as browser:
        for width in (390,1280):play(browser,width)
