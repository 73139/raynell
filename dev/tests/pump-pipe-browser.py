"""Follow the pump crew from a new career through catalog purchase and physical recovery."""
import os
import re
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-pump-pipe.test/").url
PIPE = "rl_08_15"
FIRST = "pump-gauge"
NEXT = "pump-pipe"

def play(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={"width":width, "height":900}, is_mobile=mobile, has_touch=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as context:
        if not LIVE:
            context.route(URL+"**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        p = context.new_page()
        p.set_default_timeout(5500)
        p.set_default_navigation_timeout(90000)
        errors = []
        p.on("pageerror", lambda error: errors.append(str(error)))
        p.on("dialog", lambda dialog: dialog.accept())
        p.clock.install()

        def click(css):
            button = p.locator(css + ":visible").first
            button.tap() if mobile else button.click()

        def saved():
            return p.evaluate("""Object.keys(localStorage).filter(k=>k.startsWith('rl-reboot-session-'))
              .map(k=>JSON.parse(localStorage.getItem(k))).filter(s=>s && Array.isArray(s.stashSlots) && s.career)
              .sort((a,b)=>b.version-a.version || b.revision-a.revision)[0]""")

        def station():
            p.goto(URL+"#map")
            if p.locator("#inside").get_attribute("data-page") != "map":
                click('.nav [data-page="map"]')
            click('.command-station[data-index="0"]')
            click('.command-deploy[data-page="prep"]')
            click('.lo-deploy[data-raid="start"]')
            click(".landmark-picker summary")
            click('[data-field="landmark"][data-index="6"]')

        def extract():
            p.clock.fast_forward(421000)
            click('[data-field="extract"][data-exit="b04"]')
            p.clock.fast_forward(12000)
            expect(p.locator(".result-panel")).to_be_visible()
            state = saved()
            assert state["lastSummary"]["rating"] == "success"
            return state

        def search_target():
            while 12 not in saved()["field"]["found"][0]:
                click('[data-field="scan"]')
                p.clock.fast_forward(12000)
                if saved()["field"].get("contact"):
                    click('[data-field="evade"]')
                    p.clock.fast_forward(12000)
            target = '[data-field="open"][data-index="12"]'
            expect(p.locator(target)).to_contain_text("의뢰 수색 대상")
            click(target)
            tab = '[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]'
            if p.locator(tab+":visible").count():
                click(tab)
            click('.lo-search[data-field="search"]')
            for _ in range(6):
                if saved()["field"]["boxes"]["0-12"]["complete"]:
                    break
                p.clock.fast_forward(12000)
            assert saved()["field"]["boxes"]["0-12"]["complete"]
            click('[data-field="close"]')

        r = p.goto(URL+"#quests", wait_until="domcontentloaded")
        assert r and r.ok and r.body() == HTML
        click('[data-page="orders"]')
        expect(p.locator(f'[data-bui="order"][data-id="{NEXT}"]')).to_have_count(0)
        click(f'[data-bui="order"][data-id="{FIRST}"]')
        click(f'[data-order="{FIRST}"]')
        station()
        click('[data-field="gauge-read"]')
        value = int(re.search(r"\d+", p.locator("[data-gauge-reading]").inner_text()).group())
        answer = "below" if value<4 else "above" if value>4 else "level"
        click(f'[data-field="gauge-report"][data-answer="{answer}"]')
        first = extract()
        assert first["wallet"]==42000 and first["career"]["done"]==[FIRST]
        follow = f'[data-bui="order-followup"][data-id="{NEXT}"]'
        expect(p.locator(follow)).to_be_visible()
        p.reload(wait_until="domcontentloaded")
        if not p.locator(follow+":visible").count():
            click('.command-deploy[data-page="raid"]')
        click(follow)
        expect(p.locator(".bu-order-panel h2")).to_have_text("배수관 규격 대조")
        assert saved()["raid"] is None and saved()["career"]["order"] is None
        click(f'[data-order="{NEXT}"]')
        click(f'[data-objective="pin"][data-id="{NEXT}"]')
        click(f'[data-db="lookup"][data-id="{PIPE}"]')
        expect(p.locator(f'[data-supply="{PIPE}"]')).to_contain_text("16,000")
        click(f'[data-supply="{PIPE}"]')
        assert saved()["wallet"]==26000 and saved()["stash"][PIPE]==1
        p.goto(URL+"#stash")
        click(f'[data-stash="select"][data-id="{PIPE}"]')
        click(f'[data-gear="pack"][data-id="{PIPE}"]')
        uid = next(u["uid"] for u in saved()["equipment"]["bag"] if u["g"]==PIPE)
        station()
        search_target()
        click('.field-links [data-page="map"]')
        p.reload(wait_until="domcontentloaded")
        click('.command-deploy[data-page="raid"]')
        state = saved()
        assert state["field"]["boxes"]["0-12"]["complete"]
        assert any(u["uid"]==uid for u in state["field"]["bag"])
        done = extract()
        assert (done["lastSummary"]["commission"],done["lastSummary"]["missionXp"])==(18000,65)
        assert done["wallet"]==44000 and done["career"]["done"]==[FIRST,NEXT]
        assert done["stash"][PIPE]==1
        expect(p.locator(follow)).to_have_count(0)
        click('[data-raid="ack"]')
        p.reload(wait_until="domcontentloaded")
        assert saved()["wallet"]==44000 and saved()["stash"][PIPE]==1 and saved()["career"]==done["career"]
        assert not errors, errors
        print(f"PASS {width}px: hidden prerequisite, receipt follow-up, manual acceptance, 16,000 CR purchase, UID packing, marked toolbox, reload, normal return, intact pipe, single 18,000 CR/65 XP payout.",flush=True)

if __name__=="__main__":
    with sync_playwright() as pw:
        proxy = {"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as browser:
            for width in (390,1280):
                play(browser,width)
