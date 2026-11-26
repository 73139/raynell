"""Play both medical recovery alternatives with new browser saves and actual game controls.

Run after build.py. Set RUSTLINE_URL to verify the same build on the public server.
"""
import argparse
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_URL = os.getenv("RUSTLINE_URL")
ORIGIN = (PUBLIC_URL or "https://rustline-med-supply.test/").split("#")[0]
ORDER = "med-supply"
TITLE = "끊긴 의무품 보급선"
SITES = (
    (0, 7, "임시 진료소", "진료대 응급함"),
    (1, 1, "검역 천막", "응급 케이스"),
)


def play(browser, html, width, site):
    zone, landmark, landmark_name, box_name = site
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile,
                             is_mobile=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as context:
        if not PUBLIC_URL:
            context.route(ORIGIN + "**", lambda route: route.fulfill(body=html, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.set_default_timeout(7000)
        page.set_default_navigation_timeout(60000)
        page.clock.install()
        response=page.goto(ORIGIN + "#quests", wait_until="domcontentloaded")
        assert response and response.ok and response.body()==html, "Browser received a different release"

        def activate(locator):
            if mobile:
                locator.tap()
            else:
                locator.click()

        def click(selector):
            activate(page.locator(selector + ":visible").first)

        def saved():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        click('[data-page="orders"]')
        offer = page.locator(f'[data-bui="order"][data-id="{ORDER}"]')
        expect(offer).to_contain_text(TITLE)
        activate(offer)
        briefing = page.locator(".bu-order-columns")
        expect(briefing).to_contain_text("열쇠 없이")
        expect(briefing).to_contain_text("검역실 열쇠")
        click(f'[data-order="{ORDER}"]')
        click(f'[data-objective="pin"][data-id="{ORDER}"]')
        if zone == 1:
            page.goto(ORIGIN + "#shop")
            click('[data-market="trader"][data-id="medic"]')
            key = page.locator('[data-market="item"][data-id="rl_16_19"]:visible')
            while not key.count():
                next_page = page.locator('[data-market="page"][data-step="1"]:visible')
                expect(next_page).to_be_enabled()
                activate(next_page)
            activate(key)
            click('[data-market="trade"][data-id="rl_16_19"]')
            assert saved()["stash"]["rl_16_19"] == 1
        starting_cash = saved()["wallet"]
        assert starting_cash == (2000 if zone == 1 else 30000)
        page.goto(ORIGIN + "#map")

        # The non-target third zone must show both genuine alternatives in its
        # outbound route list, and its own station must remain unmarked.
        click('.command-station[data-index="2"]')
        expect(page.locator(".command-station .obj-map-match")).to_have_count(2)
        expect(page.locator('.command-station[data-index="2"] .obj-map-match')).to_have_count(0)
        for target_zone, _, site_name, _ in SITES:
            station = page.locator(f'.command-station[data-index="{target_zone}"]')
            expect(station).to_have_accessible_name(re.compile("목표 지역"))
            road = page.locator(f'[data-route-card][data-from="2"][data-to="{target_zone}"]')
            expect(road.locator('[data-route-objective="target"]')).to_contain_text(site_name)
        click(f'.command-station[data-index="{zone}"]')
        click('.command-deploy[data-page="prep"]')
        expect(page.locator('[data-objective-panel="prep"]')).to_contain_text(TITLE)
        if zone == 1:
            gear_tab = page.locator('[data-loadout="mobile-tab"][data-screen="prep"][data-index="0"]:visible')
            if gear_tab.count():
                activate(gear_tab)
            click('[data-loadout="slot"][data-slot="access"]')
            click('[data-gear="wear-stash"][data-id="rl_16_19"]')
            assert saved()["equipment"]["worn"]["access"] == "rl_16_19"
            deploy_tab = page.locator('[data-loadout="mobile-tab"][data-screen="prep"][data-index="2"]:visible')
            if deploy_tab.count():
                activate(deploy_tab)
        # Fixed random draws generate the real medical table's bandage and a
        # clear return road. No inventory or mission progress is injected.
        page.evaluate("Math.random = () => .1")
        click('.lo-deploy[data-raid="start"]')
        assert saved()["raid"]["zone"] == zone
        click('.landmark-header summary')
        expect(page.locator('.landmark-list .obj-landmark-match')).to_have_count(1)
        target = page.locator(f'button[data-field="landmark"][data-index="{landmark}"]')
        expect(target).to_contain_text(landmark_name)
        expect(target).to_contain_text("목표 지역")
        activate(target)
        hint = page.locator("[data-order-container]")
        expect(hint).to_contain_text(box_name)
        expect(hint).to_contain_text("구급 붕대")
        if zone == 1:
            expect(hint).to_contain_text("검역실 열쇠 필요")
        click('[data-field="scan"]')
        page.clock.fast_forward(10000)
        if zone == 1:
            locked = page.locator('[data-loot-lock="locked"][data-index="2"]')
            expect(locked).to_contain_text("검역실 열쇠")
            activate(locked.locator('[data-lootplan="unlock"]'))
            assert saved()["field"]["open"] == "1-2"
        else:
            container = page.locator('[data-field="open"]').filter(has_text=box_name)
            expect(container).to_have_count(1)
            activate(container)
        loot_tab = page.locator('[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]:visible')
        if loot_tab.count():
            activate(loot_tab)
        grid = page.locator('[data-grid="loot"]:visible')
        unidentified = grid.locator(".loot-tile")
        expect(unidentified).to_have_count(1)
        expect(unidentified).to_have_accessible_name("미확인 물품 수색")
        expect(unidentified.locator(".obj-tile-mark")).to_have_count(0)
        assert unidentified.get_attribute("title") is None
        click('.lo-search[data-field="search"]')
        expect(grid.locator(".obj-tile-mark")).to_have_count(0)
        page.clock.fast_forward(10000)
        bandage = grid.locator('[data-side="loot"][aria-label^="구급 붕대"]')
        expect(bandage.locator(".obj-tile-mark")).to_be_visible()
        activate(bandage)
        expect(page.locator('[data-objective-item="bandage"]')).to_contain_text("현장 가방 0개 / 필요 1개")
        click('[data-field="take"]')
        click('[data-field="close"]')
        before = saved()
        assert before["wallet"] == starting_cash and before["career"]["done"] == []
        assert any(item["g"] == "bandage" for item in before["field"]["bag"])
        expect(page.locator("[data-order-container]")).to_have_count(0)
        click('.field-links [data-page="map"]')
        expect(page.locator(".command-station .obj-map-match")).to_have_count(0)
        expect(page.locator('[data-route-objective="target"]')).to_have_count(0)
        expect(page.locator('[data-objective-panel="map"]')).to_contain_text("생환 시 1 / 1")
        page.reload()
        expect(page.locator(".command-station .obj-map-match")).to_have_count(0)
        click('.command-deploy[data-page="raid"]')
        if zone != 0:
            page.evaluate("Math.random = () => .1")
            click(f'[data-route-card][data-from="{zone}"][data-to="0"] [data-field="move"]')
            page.clock.fast_forward(15000)
            assert saved()["raid"]["zone"] == 0
        page.clock.fast_forward(7 * 60000)
        click('[data-field="extract"][data-exit="b04"]')
        page.clock.fast_forward(12000)
        receipt = saved()
        summary = receipt["lastSummary"]
        assert (summary["rating"], summary["completedObjectiveOrder"]) == ("success", ORDER)
        assert (summary["commission"], summary["missionXp"]) == (28000, 100)
        assert receipt["career"]["done"] == [ORDER] and receipt["wallet"] == starting_cash + 28000
        assert receipt["stash"]["bandage"] == 1
        page.reload()
        reopened = saved()
        assert (reopened["wallet"], reopened["career"]["xp"]) == (receipt["wallet"], receipt["career"]["xp"])
        assert reopened["career"]["done"] == [ORDER] and reopened["stash"]["bandage"] == 1
        assert not errors, errors
        print(f"PASS {width}px {landmark_name} / {box_name}: both alternative pins, masked loot, "
              "search, collect, remove pins, reload and normal return with one reward.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("game", nargs="?", type=Path, default=ROOT / "index.html")
    game = parser.parse_args().game.read_bytes()
    with sync_playwright() as playwright:
        proxy = {"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with playwright.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as chromium:
            for width in (1280,390):
                for source in SITES:
                    play(chromium, game, width, source)
