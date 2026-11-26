"""Record three physically selected first finds in one new player's archive and keep the goods."""
import json
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT/'index.html').read_bytes()
URL = 'https://rustline-recovery-archive.test/'
KEY = 'rl-reboot-session-v36'

def play(browser,width):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':850},is_mobile=mobile,has_touch=mobile,service_workers='block') as ctx:
        ctx.route('**/*',lambda route:route.fulfill(body=HTML,content_type='text/html; charset=utf-8') if route.request.url.startswith(URL) else route.abort())
        p=ctx.new_page()
        p.set_default_timeout(10000)
        p.set_default_navigation_timeout(60000)
        p.clock.install()
        errors=[]
        p.on('pageerror',lambda e:errors.append(str(e)))
        def click(selector):
            loc=p.locator(selector+':visible').first
            loc.tap() if mobile else loc.click()
        def saved():
            return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def settle():
            for _ in range(30):
                state=saved()['field']
                if state.get('action'):
                    p.clock.fast_forward(max(400,state['action']['end']-p.evaluate('Date.now()')+400))
                elif state.get('contact'):
                    click('[data-field=evade]')
                else:
                    return
            raise AssertionError('local interaction did not settle')
        response=p.goto(URL+'#bunker',wait_until='domcontentloaded')
        assert response and response.ok and response.body()==HTML
        expect(p.locator('.bu-deck')).to_be_visible()
        def archive():
            p.goto(URL+'#archive',wait_until='domcontentloaded')
            panel=p.locator('[data-recovery-archive]')
            summary=panel.locator(':scope>summary')
            expect(panel).to_have_attribute('open','')
            expect(summary).to_be_focused()
            group=panel.locator('.archive-series').first
            if not group.evaluate('e=>e.open'):
                group.locator(':scope>summary').click()
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            return panel,group
        panel,group=archive()
        expect(panel.locator(':scope>summary')).to_contain_text('0 / 9')
        expect(group.locator('[data-archive-item=wrench]')).to_contain_text('미등록')
        def property_state():
            state=saved()
            return {key:state.get(key) for key in ('wallet','stash','stashSlots','equipment','objective','lootGoal','lootGoals','career','raid')}
        before=property_state()
        wrench=group.locator('[data-db="archive-item"][data-id=wrench]')
        expect(wrench).to_have_accessible_name('렌치 수색처 보기')
        if mobile:wrench.tap()
        else:wrench.focus();wrench.press('Enter')
        dossier=p.locator('[data-catalog-sources=wrench]')
        expect(dossier).to_have_attribute('open','')
        box=dossier.locator('[data-catalog-box="0-1"]')
        expect(box).to_contain_text('정비 사물함')
        expect(box).to_contain_text('열쇠 불필요')
        assert '%' in box.inner_text()
        back=p.locator('[data-db=archive-return]')
        expect(back).to_be_focused()
        if mobile:back.tap()
        else:back.press('Enter')
        expect(wrench).to_be_focused()
        expect(group).to_have_attribute('open','')
        assert property_state()==before
        sequences=[('wrench','렌치',.12),('driver','드라이버',.174),('wire','전선 묶음',.35),('wrench','렌치',.12)]
        for n,(id,name,roll) in enumerate(sequences,1):
            p.goto(URL+'#map',wait_until='domcontentloaded')
            click('.command-station[data-index="0"]')
            click('.command-deploy[data-page=prep]')
            p.evaluate('roll=>{Math.random=()=>roll}',roll)
            click('.lo-deploy[data-raid=start]')
            opener='[data-field=open][data-index="1"]'
            for _ in range(4):
                if p.locator(opener+':visible').count():break
                click('[data-field=scan]')
                settle()
            click(opener)
            tab='[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
            if p.locator(tab+':visible').count():click(tab)
            click('.lo-search[data-field=search]')
            settle()
            unit=next(u for u in saved()['field']['boxes']['0-1']['items'] if u['g']==id and u['revealed'])
            click(f'[data-side=loot][data-pick="{unit["uid"]}"]')
            tool='[data-loadout=mobile-tab][data-screen=loot][data-index="1"]'
            if not p.locator('[data-field=take]:visible').count() and p.locator(tool+':visible').count():click(tool)
            click('[data-field=take]')
            assert any(u['uid']==unit['uid'] and u['g']==id for u in saved()['field']['bag'])
            click('[data-field=close]')
            click('[data-field=extract][data-exit=b04]')
            settle()
            returned=saved()
            if n<=3:
                expect(p.locator('[data-archive-return]')).to_contain_text(name)
                assert returned['lastSummary']['archiveItems']==[id]
            else:
                expect(p.locator('[data-archive-return]')).to_have_count(0)
            assert len(returned['career']['archive'])==min(n,3) and returned['stash'][id]==(2 if n==4 else 1)
            click('[data-raid=ack]')
            panel,group=archive()
            tile=group.locator(f'[data-archive-item="{id}"]')
            expect(tile).to_have_attribute('data-recorded','true')
            expect(tile).to_contain_text('정비 사물함')
            expect(group.locator('[data-archive-caption]')).to_have_count(0 if n<3 else 1)
            if n>=3:
                illustration=group.locator('.archive-plate img')
                expect(illustration).to_have_attribute('alt','정비반의 작업대 삽화')
                assert illustration.evaluate('e=>e.complete && e.naturalWidth>0')
        p.reload(wait_until='domcontentloaded')
        panel,group=archive()
        expect(panel.locator(':scope>summary')).to_contain_text('3 / 9')
        if os.getenv('RUSTLINE_ARCHIVE_SHOTS'):
            folder=Path(os.environ['RUSTLINE_ARCHIVE_SHOTS']);folder.mkdir(exist_ok=True,parents=True)
            group.screenshot(path=str(folder/f'first-series-{width}.png'))
        assert not errors,errors
        print('PASS',width,'px: four native outings, three distinct source cards, first series interpretation, duplicate and original physical goods retained.',flush=True)

if __name__=='__main__':
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
        for width in (390,1280):play(browser,width)
