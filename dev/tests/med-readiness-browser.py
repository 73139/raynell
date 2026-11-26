"""Check the medical order's pre-raid loadout guidance with isolated mouse/touch profiles.

Run after build.py. Set RUSTLINE_URL to test the published copy matching index.html.
"""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-preparation.test/").url
KEY = "rl_16_19"
ORDER = "med-supply"


def play(browser, width, clinic_only=False):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile,
                             is_mobile=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.set_default_timeout(6500)
        response = page.goto(URL + "#quests", wait_until="domcontentloaded", timeout=60000)
        assert response and response.ok and response.body() == HTML

        def click(selector):
            control = page.locator(selector + ":visible").first
            if mobile:
                control.tap()
            else:
                control.click()

        def visit(fragment):
            link = {"prep": "map", "orders": "quests"}.get(fragment, fragment)
            if page.url == URL + "#" + link:
                page.reload()
            else:
                page.goto(URL + "#" + link)
            if fragment == "prep":
                click('.command-deploy[data-page="prep"]')
            elif fragment == "orders":
                click('[data-page="orders"]')

        def mobile_tab(index):
            selector = f'[data-loadout="mobile-tab"][data-screen="prep"][data-index="{index}"]'
            if page.locator(selector + ":visible").count():
                click(selector)

        def saved():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        panel = page.locator("[data-order-readiness]")
        free = panel.locator('[data-ready-site="0-7"]')
        gated = panel.locator('[data-ready-site="1-1"]')

        def state(expected):
            expect(panel).to_be_visible()
            expect(free).to_have_attribute("data-key-state", "free")
            expect(free).to_contain_text("진료대 응급함")
            expect(free).to_contain_text("열쇠 없이 개방 가능")
            expect(gated).to_have_attribute("data-key-state", expected)
            expect(gated).to_contain_text("검역실 열쇠")
            if expected in ("stored", "bag", "equipped"):
                copy = {"stored":"출격 장비로 옮겨야", "bag":"출격 가방에 휴대", "equipped":"열쇠 고리 장착"}
                expect(gated).to_contain_text(copy[expected])
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+1")

        click('[data-page="orders"]')
        click(f'[data-bui="order"][data-id="{ORDER}"]')
        click(f'[data-order="{ORDER}"]')
        visit("prep")
        expect(panel).to_have_count(0)  # Accepted, not pinned.
        visit("orders")
        click(f'[data-bui="order"][data-id="{ORDER}"]')
        click(f'[data-objective="pin"][data-id="{ORDER}"]')
        visit("map")
        state("missing")
        zone = 0 if clinic_only else 1
        click(f'.command-station[data-index="{zone}"]')
        click('.command-deploy[data-page="prep"]')
        state("missing")
        expect(page.locator('.lo-deploy[data-raid="start"]')).to_be_enabled()
        if clinic_only:
            mobile_tab(2)
            click('.lo-deploy[data-raid="start"]')
            after = saved()
            assert after["raid"]["zone"] == 0 and after["wallet"] == 30000
            assert not after["field"]["worn"].get("access")
            expect(panel).to_have_count(0)
            assert not errors, errors
            print(f"PASS {width}px: pinned two-route prep, free clinic deploys without key or charge.", flush=True)
            return

        click(f'[data-order-readiness] [data-lootplan="shop"][data-id="{KEY}"]')
        buy = f'[data-market="trade"][data-id="{KEY}"]'
        expect(page.locator(buy)).to_be_visible()
        assert saved()["wallet"] == 30000
        click(buy)
        assert saved()["wallet"] == 2000 and saved()["stash"][KEY] == 1
        visit("prep")
        state("stored")
        click('[data-order-readiness] [data-pos="locate"]')
        pack = f'[data-gear="pack"][data-id="{KEY}"]'
        expect(page.locator(pack + ":visible").first).to_be_enabled()
        assert not saved()["equipment"]["bag"]
        click(pack)
        visit("prep")
        state("bag")
        assert any(item["g"] == KEY for item in saved()["equipment"]["bag"])
        mobile_tab(0)
        click('[data-loadout="slot"][data-slot="access"]')
        click('[data-gear="wear-bag"]')
        state("equipped")
        assert saved()["equipment"]["worn"]["access"] == KEY
        page.reload()
        state("equipped")
        click('.command-deploy[data-page="prep"]')
        mobile_tab(0)
        if not page.locator('[data-gear="unwear"][data-slot="access"]:visible').count():
            click('[data-loadout="slot"][data-slot="access"]')
        click('[data-gear="unwear"][data-slot="access"]')
        state("stored")
        click(f'[data-objective="clear"][data-id="{ORDER}"]')
        expect(panel).to_have_count(0)
        visit("orders")
        click(f'[data-bui="order"][data-id="{ORDER}"]')
        click(f'[data-order="{ORDER}"]')
        click('[data-bui="order"][data-id="scout"]')
        click('[data-order="scout"]')
        click('[data-objective="pin"][data-id="scout"]')
        visit("prep")
        expect(page.locator('[data-objective-panel="prep"]')).to_contain_text("외곽 통신선 조사")
        expect(panel).to_have_count(0)
        assert saved()["wallet"] == 2000 and saved()["raid"] is None
        assert not errors, errors
        print(f"PASS {width}px: missing, shop link, owned in warehouse, locate, pack, key ring, reload, "
              "unwear, unpin and unrelated pinned order.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as chromium:
            for viewport in (390, 1280):
                play(chromium, viewport)
                play(chromium, viewport, clinic_only=True)
