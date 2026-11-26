"""Play the two-drawer inspection in either order, starting each with a fresh browser save."""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-handover.test/").url
ORDER = "handover-ledgers"
TITLE = "사라진 화물 인계표"
# Zone, landmark, correct box, display name.
SITES = ((0, 8, 17, "화물표 서랍"), (1, 1, 6, "검역 접수 서랍"))


def play(browser, origin, width, roll):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile,
                             is_mobile=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(7000)
        page.set_default_navigation_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.clock.install()
        response = page.goto(URL + "#quests", wait_until="domcontentloaded")
        assert response and response.ok and response.body() == HTML, "Loaded HTML differs from the release under test"
        completed = set()

        def click(selector):
            button = page.locator(selector + ":visible").first
            if mobile:
                button.tap()
            else:
                button.click()

        def saved():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v35'))")

        def checklist():
            for zone, _, index, name in SITES:
                row = page.locator(f'[data-inspection-box="{zone}-{index}"]:visible').first
                expect(row).to_contain_text(name)
                expect(row).to_have_attribute("data-complete", "true" if zone in completed else "false")

        def pins():
            for zone, _, _, _ in SITES:
                marker = page.locator(f'.command-station[data-index="{zone}"] .obj-map-match')
                expect(marker).to_have_count(0 if zone in completed else 1)
            expect(page.locator('.command-station[data-index="2"] .obj-map-match')).to_have_count(0)

        click('[data-page="orders"]')
        click(f'[data-bui="order"][data-id="{ORDER}"]')
        expect(page.locator(".bu-order-panel")).to_contain_text(TITLE)
        expect(page.locator(".bu-order-panel")).to_contain_text("열쇠 없이")
        click(f'[data-order="{ORDER}"]')
        click(f'[data-objective="pin"][data-id="{ORDER}"]')
        page.goto(URL + "#map")
        pins()
        checklist()
        click(f'.command-station[data-index="{origin}"]')
        click('.command-deploy[data-page="prep"]')
        checklist()
        page.evaluate("draw => { Math.random = () => draw }", roll)
        click('.lo-deploy[data-raid="start"]')
        page.evaluate("Math.random = () => .1")  # Clear travel legs and, when needed, a successful evade.
        assert saved()["raid"]["zone"] == origin

        def search(box, correct):
            click(f'[data-field="open"][data-index="{box}"]')
            checklist()
            tab = '[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]'
            if page.locator(tab + ":visible").count():
                click(tab)
            unknown = page.locator('[data-grid="loot"] .loot-tile.unknown')
            assert (unknown.count() == 0) == (roll == .01)
            click('.lo-search[data-field="search"]')
            if unknown.count():
                checklist()  # Opening a nonempty drawer or starting its search earns nothing yet.
            page.clock.fast_forward(15000)
            if correct:
                completed.add(saved()["raid"]["zone"])
            checklist()
            click('[data-field="close"]')

        def move(start, destination):
            click(f'[data-route-card][data-from="{start}"][data-to="{destination}"] [data-field="move"]')
            page.clock.fast_forward(12000)
            assert saved()["raid"]["zone"] == destination

        for current in (origin, 1 - origin):
            zone, landmark, correct_box, _ = SITES[current]
            if zone != origin:
                move(origin, zone)
            click('.landmark-header summary')
            click(f'[data-field="landmark"][data-index="{landmark}"]')
            for number in (1, 2):
                click('[data-field="scan"]')
                page.clock.fast_forward(10000)
                if page.locator('[data-field="evade"]:visible').count():
                    click('[data-field="evade"]')
                    page.clock.fast_forward(10000)
                checklist()
                if number == 1 and zone == 0 and origin == 0:
                    search(16, False)  # Same landmark's passenger luggage is not a ledger drawer.
            search(correct_box, True)
            click('.field-links [data-page="map"]')
            pins()
            checklist()
            if zone == origin:
                page.reload()
                pins()
                checklist()
                page.evaluate("Math.random = () => .1")
            click(f'.command-station[data-index="{zone}"]')
            click('.command-deploy[data-page="raid"]')

        expect(page.locator('[data-objective-panel="field"]')).to_contain_text("두 서랍을 확인했습니다")
        if saved()["raid"]["zone"] != 0:
            move(1, 0)
        before = saved()
        assert before["field"]["bag"] == [] and not before["field"]["worn"].get("access")
        assert before["wallet"] == 30000 and before["career"]["done"] == []
        click('[data-field="extract"][data-exit="b04"]')
        page.clock.fast_forward(12000)
        result = saved()
        summary = result["lastSummary"]
        expect(page.locator(".result-panel")).to_contain_text("SURVIVED")
        assert summary["rating"] == "success" and summary["completedObjectiveOrder"] == ORDER
        assert (summary["commission"], summary["missionXp"]) == (34000, 115)
        assert result["wallet"] == 64000 and result["career"]["done"] == [ORDER] and result["stash"] == {}
        page.reload()
        after = saved()
        assert (after["wallet"], after["career"]["xp"], after["career"]["done"]) == (64000, result["career"]["xp"], [ORDER])
        assert not errors, errors
        print(f"PASS {width}px, origin {origin}, loot draw {roll}: both source pins and drawer completion, "
              "reload, no key or pickups, 34,000 CR and 115 order XP exactly once.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as chromium:
            play(chromium, origin=0, width=390, roll=.5)
            play(chromium, origin=1, width=1280, roll=.01)
