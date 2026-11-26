"""Exercise local and road contacts in isolated Chromium profiles with real navigation."""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-contact.test/").url


def scenario(browser, width, order):
    road = order is None
    mobile = width < 600
    with browser.new_context(viewport={"width":width, "height":844}, is_mobile=mobile,
                             has_touch=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL+"**",lambda route:route.fulfill(body=HTML,content_type="text/html; charset=utf-8"))
        page=context.new_page()
        errors=[]
        page.on("pageerror",lambda err:errors.append(str(err)))
        page.set_default_timeout(7000)
        page.set_default_navigation_timeout(90000)
        page.clock.install()
        response=page.goto(URL+"#quests",wait_until="domcontentloaded")
        assert response and response.ok and response.body() == HTML

        def click(selector):
            button=page.locator(selector+":visible").first
            if mobile:
                button.tap()
            else:
                button.click()

        def saved():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v35'))")

        def finish():
            action=saved()["field"]["action"]
            assert action
            delay=action["end"]-page.evaluate("Date.now()")+300
            page.clock.fast_forward(max(300,delay))

        if order:
            click('[data-page="orders"]')
            click(f'[data-bui="order"][data-id="{order}"]')
            click(f'[data-order="{order}"]')
            click(f'[data-objective="pin"][data-id="{order}"]')
        page.goto(URL+"#map")
        zone=0 if road else 1
        click(f'.command-station[data-index="{zone}"]')
        click('.command-deploy[data-page="prep"]')
        page.evaluate("Math.random=()=>.1")  # The real third completed scan triggers a contact.
        click('.lo-deploy[data-raid="start"]')
        expect(page.locator("[data-contact-context]")).to_have_count(0)

        if road:
            # Three publicly plausible rolls. The third cell's supply must
            # remain undisclosed until after the second cell's contact resolves.
            page.evaluate("""() => {
                const draws=[.1,.99,.5,.01];
                Math.random=()=>draws.length ? draws.shift() : .1;
            }""")
            click('[data-route-card][data-from="0"][data-to="2"] [data-field="move"]')
            finish()
            finish()
            assert saved()["field"]["journey"]["done"] == 2
        else:
            for _ in range(2):
                click('[data-field="scan"]')
                finish()
            click('.landmark-header summary')
            click('[data-field="landmark"][data-index="1"]')
            click('[data-field="scan"]')
            finish()
            assert saved()["field"]["found"][1] == [0,1,2]
            assert not saved()["field"]["boxes"]["1-2"]["complete"]

        def check_context():
            expect(page.locator('[data-field="evade"]')).to_be_visible()
            if road:
                expect(page.locator('[data-contact-context="road"]')).to_be_visible()
                expect(page.locator('[data-contact-context="landmark"]')).to_have_count(0)
                route=page.locator('[data-route-status][data-from="0"][data-to="2"]')
                for text in ("폐철도 화물선","벙커 외곽","군수 보급 창고","2 / 3"):
                    expect(route).to_contain_text(text)
                expect(route).not_to_contain_text("배터리")
                expect(page.locator(".road-supply, [data-contact-target]")).to_have_count(0)
            else:
                local=page.locator('[data-contact-context="landmark"]')
                for text in ("폐쇄 검문소","검역 천막"):
                    expect(local).to_contain_text(text)
                expect(page.locator('[data-contact-found="1"]')).to_be_visible()
                expect(page.locator('[data-contact-context="road"], [data-route-status]')).to_have_count(0)
                target=page.locator("[data-contact-target]")
                if order == "med-supply":
                    expect(target).to_contain_text("응급 케이스")
                    expect(target).not_to_contain_text("구급 붕대")
                else:
                    expect(target).to_have_count(0)
                expect(local).not_to_contain_text("검역 접수 서랍")
                expect(page.locator('[data-field="open"], [data-field="scan"]')).to_have_count(0)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+1")

        check_context()
        # Local context and route progress persist across a failed evade and reload.
        page.evaluate("Math.random=()=>.99")
        click('[data-field="evade"]')
        finish()
        check_context()
        expect(page.locator(".evade-result")).to_contain_text("도주 실패")
        previous=saved()["field"]
        page.reload(wait_until="domcontentloaded")
        click('.command-deploy[data-page="raid"]')
        check_context()
        current=saved()["field"]
        assert current["contact"] == previous["contact"] and current.get("journey") == previous.get("journey")
        page.evaluate("Math.random=()=>.01")
        click('[data-field="evade"]')
        finish()
        expect(page.locator("[data-contact-context]")).to_have_count(0)
        if road:
            state=saved()["field"]
            assert state["journey"]["done"] == 2 and state["action"]["type"] == "travel-step"
            expect(page.locator(".road-supply")).to_have_count(0)
            finish()
            expect(page.locator(".road-supply")).to_contain_text("배터리")
            click('[data-field="journey-pass"]')
            after=saved()
            assert after["raid"]["zone"] == 2 and after["field"]["visited"] == [0,2]
        else:
            expect(page.locator(".landmark-header h2")).to_have_text("검역 천막")
            expect(page.locator('[data-loot-lock="locked"][data-index="2"]')).to_contain_text("검역실 열쇠")
            assert saved()["field"]["action"] is None and saved()["field"]["found"][1] == [0,1,2]
            click('[data-field="scan"]')
            finish()
            expect(page.locator('[data-field="open"][data-index="6"]')).to_contain_text("검역 접수 서랍")
        assert not errors,errors
        print(f"PASS {width}px, {order or 'road'}: verified context, no premature information, "
              "failed evade, active save reload, successful evade and correct continuation.",flush=True)


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy={"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as chromium:
            for width,job in ((390,"handover-ledgers"),(1280,"med-supply"),(390,None),(1280,None)):
                scenario(chromium,width,job)
