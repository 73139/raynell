"""Build a midgame workshop, compare search sites, recover a real item and check the next map."""
import json
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
KEY = "rl-reboot-session-v36"
URL = urldefrag(os.getenv("RUSTLINE_URL") or "https://facility-search.test/").url


def play(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={"width":width,"height":844}, has_touch=mobile, is_mobile=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as ctx:
        if not os.getenv("RUSTLINE_URL"):
            ctx.route(URL+"**", lambda route:route.fulfill(body=HTML,content_type="text/html; charset=utf-8"))
        ctx.add_init_script("const roll=Math.random;window.rollCount=0;Math.random=()=>{window.rollCount++;return window.forcedRoll??roll()}")
        page=ctx.new_page()
        page.set_default_timeout(7000)
        errors=[]
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("dialog",lambda dialog:dialog.accept())
        page.clock.install()

        def click(selector):
            button=page.locator(selector+":visible").first
            if mobile:
                button.tap()
            else:
                button.click()

        def snapshot():
            return page.evaluate("k=>JSON.parse(localStorage.getItem(k))",KEY)

        def facility(room):
            click(".nav [data-page=bunker]")
            click(f".bu-facility-tile[data-id={room}]")

        def compare():
            panel=page.locator("[data-facility-search=repair]")
            summary=panel.locator("summary")
            expect(panel.locator("[data-material-site]")).to_have_count(0)
            before=snapshot()
            rolls=page.evaluate("window.rollCount")
            if mobile:
                summary.tap()
            else:
                summary.focus()
                page.keyboard.press("Enter")
                expect(summary).to_be_focused()
            expect(panel.locator("[data-material-site]")).to_have_count(3)
            assert before==snapshot() and rolls==page.evaluate("window.rollCount")
            assert summary.bounding_box()["height"]>=44
            assert panel.evaluate("el=>el.scrollWidth<=el.clientWidth+1")
            return panel

        r=page.goto(URL+"#map",timeout=90000,wait_until="domcontentloaded")
        assert r.ok and r.body()==HTML
        # A real v22 campaign-completed backup. Supply only the workshop's fixture ingredients.
        legacy=json.loads((ROOT/"tests/fixtures/finale-v22.json").read_text())
        materials=json.loads((ROOT/"Rustline_Database_v10.json").read_text())["hideout"]["facilities"]["workshop"]["levels"][0]["materials"]
        legacy["session"]["stash"].update(materials)
        click(".shell-settings")
        page.locator("#restore-file").set_input_files({"name":"workshop-v22.json","mimeType":"application/json","buffer":json.dumps(legacy).encode()})
        expect(page.locator(".save-panel [role=status]")).to_contain_text("복원했습")
        facility("workshop")
        click('[data-hideout=build][data-id=workshop][data-tier="1"]')
        assert snapshot()["wallet"]==legacy["session"]["wallet"]-20000
        page.clock.fast_forward(601000)
        assert snapshot()["hideout"]["levels"]["workshop"]==1
        facility("repair")
        click('[data-objective=pin][data-id=repair][data-tier="1"]')
        click(".nav [data-page=map]")
        panel=compare()
        first=panel.locator("[data-material-site]").first
        expect(first).to_contain_text("빗물 펌프장 · 평균 0.52종")
        expect(first.locator("[data-material-site-item=driver]")).to_contain_text("22.8%")
        expect(first.locator("[data-material-site-item=lube]")).to_contain_text("2개 부족 · 7.91% · 현재 CR 구매 불가")
        if os.getenv("RUSTLINE_SEARCH_SHOTS"):
            folder=Path(os.environ["RUSTLINE_SEARCH_SHOTS"]);folder.mkdir(parents=True,exist_ok=True)
            panel.screenshot(path=str(folder/f"sites-{width}.png"),animations="disabled")
        summary=panel.locator("summary");summary.focus();page.keyboard.press("Space")
        expect(panel.locator("[data-material-sites]")).not_to_be_visible()
        click('.command-station[data-index="0"]')
        click(".command-deploy[data-page=prep]")
        expect(page.locator("[data-facility-search]")).to_have_count(0)
        # Containers are seeded at deployment. Use a fixed real toolbox draw for repeatability.
        page.evaluate("window.forcedRoll=.3757")
        click(".lo-deploy[data-raid=start]")
        page.evaluate("delete window.forcedRoll")
        click(".landmark-picker summary")
        click('[data-field=landmark][data-index="6"]')
        click("[data-field=scan]")
        page.clock.fast_forward(5000)
        click('.container-card[data-field=open]')
        click('.lo-search[data-field=search]')
        page.clock.fast_forward(5500)
        click('[data-grid=loot] [data-side=loot][aria-label^=드라이버]')
        click("[data-field=take]")
        click("[data-field=close]")
        assert any(u["g"]=="driver" for u in snapshot()["field"]["bag"])
        click('.field-links [data-page=map]')
        expect(page.locator("[data-facility-search]")).to_have_count(0)
        click(".command-deploy[data-page=raid]")
        click("[data-field=extract][data-exit=b04]")
        page.clock.fast_forward(12000)
        expect(page.locator(".result-panel")).to_be_visible()
        click("[data-raid=ack]")
        assert snapshot()["stash"]["driver"]==1
        page.reload(wait_until="domcontentloaded")
        if page.locator("#inside").get_attribute("data-page")!="map":
            page.goto(URL+"#map",wait_until="domcontentloaded")
        panel=compare()
        expect(panel.locator("[data-material-site]").first).to_contain_text("도로통제 창고 · 평균 0.3종")
        expect(panel.locator("[data-material-site-item=driver]")).to_have_count(0)
        assert not errors,errors
        print(f"PASS {width}px: v22 campaign → real workshop → map/keyboard/touch → recovered driver → reranked after settlement and reload",flush=True)


if __name__=="__main__":
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM")) as browser:
        for size in [390,1280]:
            play(browser,size)
