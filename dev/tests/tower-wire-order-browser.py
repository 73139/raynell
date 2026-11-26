"""Play the tower order in a fresh browser; set RUSTLINE_URL to test a published build."""
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

URL = os.environ.get("RUSTLINE_URL", "https://rustline.test/").split("#")[0]
SOURCE = Path(__file__).resolve().parents[1] / "index.html"

def play(browser,width):
    c = browser.new_context(viewport={"width":width,"height":844},reduced_motion='reduce',
        has_touch=width<600,ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1")
    try:
        if URL=="https://rustline.test/":
            c.route(URL+"**",lambda r:r.fulfill(content_type="text/html",body=SOURCE.read_bytes()))
        page=c.new_page()
        page.set_default_timeout(7000)
        page.set_default_navigation_timeout(60000)
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.clock.install()
        page.goto(URL+"#quests")
        def click(selector):page.locator(selector+":visible").first.click()
        def snap():return page.evaluate("() => JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")
        click('[data-page=orders]')
        click('[data-bui=order][data-id=tower-wire]')
        click('[data-order=tower-wire]')
        click('[data-objective=pin][data-id=tower-wire]')
        page.goto(URL+"#map")
        click('[data-cui=inspect][data-index="0"]')
        click('.command-deploy[data-page=prep]')
        # Predictable industrial loot roll; no items or saved data are injected.
        page.evaluate('() => {window.savedRand=Math.random;Math.random=()=>.35}')
        click('[data-raid=start]')
        page.evaluate('() => {Math.random=window.savedRand;delete window.savedRand}')
        def open_loot(index):
            click(f'[data-field=open][data-index="{index}"]')
            tab=page.locator('[data-loadout=mobile-tab][data-screen=loot][data-index="2"]:visible')
            if tab.count():tab.click()

        def scan():
            click('[data-field=scan]')
            page.clock.fast_forward(10000)
            if page.locator('[data-field=evade]:visible').count():
                # The third scan can prompt a contact before the tower box opens.
                page.evaluate('() => {window.savedRand=Math.random;Math.random=()=>0}')
                click('[data-field=evade]')
                page.evaluate('() => {Math.random=window.savedRand;delete window.savedRand}')
                page.clock.fast_forward(10000)

        def search_box():
            grid=page.locator('[data-grid=loot]:visible')
            for tile in grid.locator('.loot-tile').all():
                expect(tile).to_have_accessible_name('미확인 물품 수색')
                assert tile.get_attribute('title') is None
            expect(grid.locator('.obj-tile-mark')).to_have_count(0)
            click('.lo-search[data-field=search]')
            expect(grid.locator('.obj-tile-mark')).to_have_count(0)
            page.clock.fast_forward(20000)
            return grid

        # A wire of the same type in another container in the same zone
        # must not be identified as the power crew's sample.
        scan()
        scan()
        open_loot(1)
        wrong=search_box().locator('[data-side=loot][aria-label="전선 묶음"]').first
        expect(wrong.locator('.obj-tile-mark')).to_have_count(0)
        wrong.click()
        expect(page.locator('[data-objective-item=wire]')).to_have_count(0)
        click('[data-field=close]')
        click('.landmark-header summary')
        target=page.locator('[data-field=landmark][data-index="5"]')
        expect(target).to_contain_text("목표 지역")
        target.click()
        scan()
        open_loot(10)
        grid=search_box()
        wires=grid.locator('[data-side=loot][aria-label^="전선 묶음"]')
        expect(wires).to_have_count(2)
        for wire in wires.all():
            expect(wire).to_have_accessible_name('전선 묶음 · 의뢰 회수품 · 현장 가방 0개 / 필요 1개 · 가방에 넣고 정상 탈출하면 의뢰에 반영됩니다.')
            expect(wire.locator('.obj-tile-mark')).to_be_visible()
        wires.first.click()
        expect(page.locator('[data-objective-item=wire]')).to_contain_text('현장 가방 0개 / 필요 1개')
        click('[data-field=take]')
        expect(wires).to_have_count(1)
        expect(wires).to_have_accessible_name('전선 묶음')
        expect(wires.locator('.obj-tile-mark')).to_have_count(0)
        wires.click()
        expect(page.locator('[data-objective-item=wire]')).to_have_count(0)
        click('[data-field=close]')
        assert any(u['g']=='wire' for u in snap()['field']['bag'])
        page.reload()
        click('.command-deploy[data-page=raid]')
        page.clock.fast_forward(7*60*1000)
        click('[data-field=extract][data-exit=b04]')
        page.clock.fast_forward(12000)
        paid=snap()
        assert paid['lastSummary']['rating']=='success'
        assert paid['lastSummary']['commission']==36000 and paid['lastSummary']['missionXp']==130
        assert paid['wallet']==66000 and paid['stash']['wire']==1
        assert paid['career']['done']==['tower-wire']
        page.reload();assert snap()['wallet']==paid['wallet'] and snap()['career']['xp']==paid['career']['xp']
        assert not errors,errors
        print("PASS",width,"UI accept/pin, target map marker, natural generation with fixed draw, scan/search/collect, active reload, normal extraction + 36000 CR/130 XP once",flush=True)
    finally:c.close()

if __name__=="__main__":
    with sync_playwright() as p:
        proxy={"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        b=p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy,args=["--no-sandbox"])
        for width in (1280,390):play(b,width)
        b.close()
