"""Verify player-visible recovery progress with generated loot and fresh Chromium saves."""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-med-progress.test/").url
SAVE = "rl-reboot-session-v36"


def scenario(browser, roll, width):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile,
                             is_mobile=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL + "**", lambda r: r.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(6500)
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.clock.install()
        response = page.goto(URL + "#quests", wait_until="domcontentloaded", timeout=60000)
        assert response and response.ok and response.body() == HTML

        def click(selector):
            target = page.locator(selector + ":visible").first
            if mobile:
                target.tap()
            else:
                target.click()

        def state(site, value):
            expect(page.locator(f'[data-recovery-site="{site}"]:visible').first).to_have_attribute("data-recovery-state", value)

        def search():
            click('.lo-search[data-field="search"]')
            page.clock.fast_forward(10000)

        click('[data-page="orders"]')
        click('[data-bui="order"][data-id="med-supply"]')
        click('[data-order="med-supply"]')
        click('[data-objective="pin"][data-id="med-supply"]')
        page.goto(URL + "#map")
        click('.command-station[data-index="0"]')
        click('.command-deploy[data-page="prep"]')
        page.evaluate("n => { Math.random = () => n }", roll)
        click('.lo-deploy[data-raid="start"]')
        click('.landmark-header summary')
        click('[data-field="landmark"][data-index="7"]')
        state("0-7", "unsearched")
        state("1-1", "unsearched")
        click('[data-field="scan"]')
        page.clock.fast_forward(10000)
        click('[data-field="open"]')
        state("0-7", "unsearched")
        tab = '[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]'
        if page.locator(tab + ":visible").count():
            click(tab)
        grid = page.locator('[data-grid="loot"]')
        tiles = grid.locator(".loot-tile.unknown")
        count = tiles.count()
        for tile in tiles.all():
            expect(tile).to_have_accessible_name("미확인 물품 수색")
            assert tile.get_attribute("title") is None
        expect(grid.locator(".obj-tile-mark")).to_have_count(0)
        if roll == .5:
            assert count == 2
            click('.loot-tile.unknown')
            state("0-7", "searching")
            page.clock.fast_forward(10000)
            state("0-7", "partial")
            state("1-1", "unsearched")
            expect(tiles).to_have_count(1)
            expect(tiles).to_have_accessible_name("미확인 물품 수색")
        else:
            assert count == (0 if roll == .01 else 1)
        search()
        state("1-1", "unsearched")
        if roll == .1:
            state("0-7", "available")
            expect(page.locator('[data-recovery-advice="collect"]:visible').first).to_be_visible()
            click('[data-side="loot"][aria-label^="구급 붕대"]')
            click('[data-field="take"]')
            click('[data-field="close"]')
            click('.field-links [data-page="inventory"]')
            click('[data-side="bag"][aria-label="구급 붕대"]')
            click('[data-gear="drop"]')
            click('.lo-gear [data-page="raid"]')
            click('.field-links [data-page="map"]')
            expect(page.locator('[data-recovery-advice="ground"]')).to_contain_text("벙커 외곽")
            expect(page.locator('.command-station[data-index="0"] .obj-map-match')).to_have_count(1)
            expect(page.locator('.command-station[data-index="1"] .obj-map-match')).to_have_count(0)
            page.reload()
            expect(page.locator('[data-recovery-advice="ground"]')).to_have_count(1)
            click('.command-deploy[data-page="raid"]')
            click('.field-links [data-page="inventory"]')
            click('[data-gear="recover"]')
            click('.lo-gear [data-page="raid"]')
            click('.field-links [data-page="map"]')
            expect(page.locator("[data-recovery-advice]")).to_have_count(0)
            expect(page.locator(".command-station .obj-map-match")).to_have_count(0)
            expect(page.locator('[data-objective-panel="map"]')).to_contain_text("생환 시 1 / 1")
        else:
            state("0-7", "empty")
            expect(page.locator('[data-recovery-advice="alternate"]:visible').first).to_contain_text("검역 천막")
            click('[data-field="close"]')
            click('.field-links [data-page="map"]')
            for refresh in (False, True):
                if refresh:
                    page.reload()
                state("0-7", "empty")
                state("1-1", "unsearched")
                expect(page.locator('.command-station[data-index="0"] .obj-map-match')).to_have_count(0)
                expect(page.locator('.command-station[data-index="1"] .obj-map-match')).to_have_count(1)
        saved = page.evaluate("k => JSON.parse(localStorage.getItem(k))", SAVE)
        assert saved["wallet"] == 30000 and saved["career"]["done"] == []
        assert sum(item["g"] == "bandage" for item in saved["field"]["bag"]) == int(roll == .1)
        assert not errors, errors
        print(f"PASS {width}px, generated roll {roll}: hidden contents, observed progress, reload, no extra credit.")


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as chromium:
            for draw, width in ((.01,390), (.5,390), (.1,1280)):
                scenario(chromium, draw, width)
