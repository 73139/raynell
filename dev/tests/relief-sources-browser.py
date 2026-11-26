"""Trace procurement from an unlocked relief dossier. Supply, tracking and order acceptance are separate choices.
RUSTLINE_RELIEF_EARNED_SAVE may point to a genuine completed ending from Settings.
Without that variable, generate a late-game fixture using the existing engine scenario.
"""
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
LIVE=os.getenv('RUSTLINE_URL')
URL=urldefrag(LIVE or 'https://rustline-relief-sources.test/').url
KEY='rl-reboot-session-v36'
ORDER='external-relief'


def check(browser,width,path):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,
                             reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as c:
        if not LIVE: c.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        errors=[]
        def new_page():
            p=c.new_page()
            p.set_default_timeout(7500)
            p.on('pageerror',lambda e:errors.append(str(e)))
            now=max(1800004000000,json.loads(path.read_text())['session']['finale']['reply']['raidId']+1800000)
            p.clock.install(time=datetime.fromtimestamp(now/1000,timezone.utc))
            response=p.goto(URL+'#campaign',wait_until='domcontentloaded',timeout=90000)
            assert response and response.body()==HTML
            return p

        def saved(p):
            return p.evaluate('key=>JSON.parse(localStorage.getItem(key))',KEY)
        def use(p,sel):
            control=p.locator(sel+':visible').first
            if mobile: control.tap()
            else:
                control.focus()
                p.keyboard.press('Enter')
        def dossier(p):
            p.goto(URL+'#campaign',wait_until='domcontentloaded')
            use(p,'[data-bui=external-relief]')
        def material(p,kind,item):
            sel=f'[data-db=relief-material][data-kind="{kind}"][data-id="{item}"]'
            assert p.locator(sel).bounding_box()['height']>=44
            use(p,sel)
            details=p.locator(f'[data-catalog-sources="{item}"]')
            expect(details).to_be_visible()
            assert details.evaluate('e=>e.open')
            expect(details.locator('[data-catalog-box]').first).to_be_visible()
            expect(p.locator('[data-db=relief-return]')).to_be_focused()
            assert details.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            return sel,details
        def back(p,sel,order_filter):
            use(p,'[data-db=relief-return]')
            expect(p.locator(sel)).to_be_focused()
            expect(p.locator(f'[data-bui=order-filter][data-id="{order_filter}"]')).to_have_attribute('aria-pressed','true')
            expect(p.locator(f'[data-bui=order][data-id="{ORDER}"]')).to_have_attribute('aria-pressed','true')

        p=new_page()
        use(p,'.shell-settings')
        p.once('dialog',lambda d:d.accept())
        with p.expect_file_chooser() as f: use(p,'[data-backup=import]')
        f.value.set_files(path)
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다')
        dossier(p)
        use(p,'[data-bui=order-filter][data-id=new]')
        baseline=saved(p)
        for kind,item,title in [('meals','food','통조림'),('meals','water','물통'),('power','battery','배터리'),('power','rl_03_25','전원 커넥터')]:
            sel,detail=material(p,kind,item)
            expect(p.locator('#db-detail h2')).to_have_text(title)
            if item=='battery':
                expect(p.locator('[data-relief-seller]')).to_contain_text('우호도 2단계에 판매 · 현재 1단계 (10점)')
                expect(detail.locator('[data-catalog-box="1-6"]')).to_contain_text('검역 접수 서랍')
                expect(detail.locator('[data-catalog-box="1-6"]')).to_contain_text('11.84%')
                expect(detail.locator('[data-catalog-box="1-4"]')).to_contain_text('3.69%')
                folder=os.getenv('RUSTLINE_RELIEF_CAPTURE_DIR')
                if folder:
                    Path(folder).mkdir(parents=True,exist_ok=True)
                    p.locator('[data-db=relief-return]').scroll_into_view_if_needed()
                    p.screenshot(path=Path(folder)/f'battery-{width}.png')
            if item=='food':expect(p.locator('[data-relief-seller]')).to_have_text('한미정 · 상점가 6,000 CR')
            back(p,sel,'new')
        assert saved(p)==baseline
        sel,detail=material(p,'power','rl_03_25')
        waiter=new_page()
        expect(waiter.locator('#tab-state')).to_be_visible()
        # The game's second tab blocks every control until it owns the writer lock.
        use(waiter,'[data-bui=external-relief]')
        expect(waiter.locator('#inside')).to_have_attribute('data-page','campaign')
        expect(waiter.locator('[data-supply], [data-order]')).to_have_count(0)
        assert saved(waiter)==baseline
        waiter.close()
        expect(p.locator('[data-supply=rl_03_25]')).to_contain_text('13,000 CR')
        use(p,'[data-supply=rl_03_25]')
        paid=saved(p)
        assert paid['wallet']==baseline['wallet']-13000
        assert paid['stash']['rl_03_25']==baseline['stash'].get('rl_03_25',0)+1
        assert paid['career']==baseline['career'] and paid['marketCarts']==baseline['marketCarts']
        back(p,sel,'new')
        sel,detail=material(p,'power','battery')
        use(p,'[data-lootplan=catalog-item][data-id=battery]')
        expect(p.locator('[data-lootplan-page]')).to_be_visible()
        assert saved(p)['lootGoal']=='item/battery' and saved(p)['objectivePin']==baseline['objectivePin']
        back(p,sel,'new')
        use(p,f'[data-order="{ORDER}"]')
        use(p,'[data-bui=order-filter][data-id=active]')
        p.goto(URL+'#map',wait_until='domcontentloaded')
        use(p,'.command-station[data-index="0"]');use(p,'.command-deploy[data-page=prep]');use(p,'.lo-deploy[data-raid=start]')
        dossier(p)
        during=saved(p)
        sel,_=material(p,'power','rl_03_25')
        expect(p.locator('[data-supply=rl_03_25]')).to_be_disabled()
        expect(p.locator('[data-supply=rl_03_25]')).to_contain_text('귀환 후')
        back(p,sel,'all')
        assert saved(p)==during and saved(p)['career']['order']==ORDER
        assert not errors,errors
        print(f'PASS {width}px: four source links, unchanged UIDs/wallet/standing/quest, current shelf, drawer & PC odds, '
              'one 13,000 CR connector order, exact keyboard return from catalog & loot plan, raid and observer protections.',flush=True)


if __name__=='__main__':
    earned=os.getenv('RUSTLINE_RELIEF_EARNED_SAVE')
    with TemporaryDirectory(prefix='rustline-sources-') as tmp,sync_playwright() as pw:
        path=Path(earned).resolve() if earned else Path(tmp)/'ending.json'
        if not earned:
            subprocess.run(['node','tests/external-relief.cjs'],cwd=ROOT,check=True,env={**os.environ,'RUSTLINE_EXPORT_RELIEF_FIXTURE':str(path)})
        proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
        with pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
            for width in [390,1280]:
                check(browser,width,path)
