"""Follow a water facility budget into direct catalog ordering on a new and a native v28 save."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-catalog-budget.test/").url
KEY = "rl-reboot-session-v36"
PIPE, VALVE = "rl_08_15", "rl_08_19"


def play(browser, width):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, is_mobile=mobile, has_touch=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.set_default_timeout(8000)

        def click(tab, selector):
            ctl = tab.locator(selector + ":visible").first
            if mobile:
                ctl.tap()
            else:
                ctl.click()

        def catalog(tab, selector):
            click(tab, selector)
            expect(tab.locator("#db-detail .db-detail-title h2")).to_be_visible()

        def saved():
            return page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)

        def pin_water():
            click(page, '.nav [data-page="bunker"]')
            click(page, '.bu-facility-tile[data-id="water"]')
            click(page, '[data-objective="pin"][data-id="water"][data-tier="1"]')

        def expand(tab):
            click(tab, '.nav [data-page="map"]')
            toggle = tab.locator('[data-procurement="objective"] [data-objective="procurement-toggle"]')
            if toggle.get_attribute("aria-expanded") != "true":
                toggle.click()
            return tab.locator("[data-facility-budget]")

        def facts(tab, direct, known, wallet):
            panel = expand(tab)
            expect(panel).to_have_attribute("data-facility-budget", "partial")
            expect(panel.locator("[data-budget-direct]")).to_have_text(f"{direct:,} CR")
            expect(panel.locator("[data-budget-materials]")).to_have_text(f"{direct:,} CR")
            expect(panel.locator("[data-budget-known]")).to_have_text(f"{known:,} CR")
            expect(panel.locator("[data-budget-wallet]")).to_have_text(f"{wallet:,} CR")
            expect(panel.locator("[data-budget-unavailable]")).to_contain_text("정수 필터 2개")
            expect(panel.locator("[data-budget-unavailable]")).to_contain_text("우호도")
            expect(panel.locator("[data-budget-total], [data-budget-balance]")).to_have_count(0)
            assert panel.evaluate("el=>el.scrollWidth <= el.clientWidth + 1")
            return panel

        def budget_link(item):
            return f'[data-budget-catalog-item="{item}"] [data-objective="procurement-catalog"]'

        response = page.goto(URL + "#map", wait_until="domcontentloaded", timeout=90000)
        assert response and response.ok and response.body() == HTML
        pin_water()
        panel = facts(page, 50000, 70000, 30000)
        expect(panel.locator("[data-budget-retail]")).to_have_text("0 CR")
        expect(panel.locator(budget_link(PIPE))).to_have_accessible_name("PVC 배관 도감 열기")
        original = saved()
        observer = context.new_page()
        observer.on('pageerror', lambda error: errors.append(str(error)))
        observer.goto(URL + "#map", wait_until="domcontentloaded")
        expect(observer.locator("html")).to_have_class(re.compile(r"\bread-only\b"))
        read_only_toggle = observer.locator('[data-procurement="objective"] [data-objective="procurement-toggle"]')
        expect(read_only_toggle).to_contain_text("도감 주문 2종 · 50,000 CR")
        read_only_toggle.click()
        expect(read_only_toggle).to_have_attribute("aria-expanded", "false")
        expect(observer.locator(f'[data-supply="{PIPE}"]')).to_have_count(0)
        observer.close()
        assert saved() == original

        catalog(page, budget_link(PIPE))
        expect(page.locator("#db-detail .db-detail-title h2")).to_have_text("PVC 배관")
        expect(page.locator("#db-detail .db-detail-title h2")).to_be_focused()
        assert saved() == original
        click(page, f'[data-supply="{PIPE}"]')
        after = saved()
        assert after["wallet"] == 14000 and after["stash"][PIPE] == 1
        assert after["marketCarts"] == original["marketCarts"] and after["saleReceipts"] == original["saleReceipts"]
        facts(page, 34000, 54000, 14000)
        catalog(page, budget_link(VALVE))
        blocked = page.locator(f'[data-supply="{VALVE}"]')
        expect(blocked).to_be_disabled()
        expect(blocked).to_have_text("자금 부족")
        page.reload(wait_until="domcontentloaded")
        assert saved()["wallet"] == 14000 and saved()["stashSlots"] == after["stashSlots"]

        legacy = json.loads((ROOT / "tests/fixtures/trade-grid-v28.json").read_text())
        click(page, ".shell-settings")
        page.locator("#restore-file").set_input_files({"name": "native-v28.json", "mimeType": "application/json",
                                                        "buffer": json.dumps(legacy).encode()})
        expect(page.locator('.save-panel [role="status"]')).to_contain_text("복원했습니다")
        pin_water()
        facts(page, 50000, 70000, 17000)
        click(page, '.command-station[data-index="0"]')
        click(page, '.command-deploy[data-page="prep"]')
        click(page, '.lo-deploy[data-raid="start"]')
        active = saved()
        click(page, '.nav [data-page="bunker"]')
        click(page, '.bu-facility-tile[data-id="water"]')
        catalog(page, f'.bu-materials [data-db="lookup"][data-id="{PIPE}"]')
        expect(page.locator(f'[data-supply="{PIPE}"]')).to_have_text("귀환 후 주문 가능")
        expect(page.locator(f'[data-supply="{PIPE}"]')).to_be_disabled()
        final = saved()
        assert final["raid"] == active["raid"] and final["wallet"] == 17000 and final["stash"] == active["stash"]
        assert not errors, errors
        print(f"PASS {width}px: exact shop/catalog split, underfunded quote, preserved cart, real payment, "
              "saved stock, native v28 migration, and secondary-tab/field purchase locks.", flush=True)



def keyboard_catalog(browser, width):
    """No network, no imported data: exercise catalog focus with actual key events."""
    with browser.new_context(viewport={"width": width, "height": 844},
                             offline=True, reduced_motion="reduce", has_touch=width<600) as ctx:
        ctx.route("http://**/*", lambda route: route.abort())
        ctx.route("https://**/*", lambda route: route.abort())
        p = ctx.new_page()
        errors = []
        p.on("pageerror", lambda err: errors.append(str(err)))
        p.goto((ROOT / "index.html").as_uri() + "#bunker", wait_until="domcontentloaded")
        p.wait_for_function("k => !!localStorage.getItem(k)", arg=KEY)
        p.locator('.nav [data-page="more"]').click()
        p.locator('.shortcut-grid [data-page="catalog"]').click()
        before = p.evaluate("k => JSON.parse(localStorage.getItem(k))", KEY)
        nxt, prev = p.locator('[data-db="next"]'), p.locator('[data-db="prev"]')
        nxt.focus()
        p.keyboard.press("Enter")
        expect(nxt).to_be_focused()
        expect(prev).to_be_enabled()
        prev.focus()
        p.keyboard.press("Enter")
        expect(prev).to_be_disabled()
        expect(nxt).to_be_focused()
        # Advance all the way to the last page. Focus must not disappear at the boundary.
        for _ in range(40):
            if nxt.is_disabled():
                break
            p.keyboard.press("Enter")
        expect(nxt).to_be_disabled()
        expect(prev).to_be_focused()
        tile = p.locator('#db-results [data-db="item"]').first
        selected = tile.get_attribute("data-id")
        tile.focus()
        p.keyboard.press("Enter")
        expect(p.locator("#db-detail .db-detail-title h2")).to_be_focused()
        back = p.locator('[data-db="list-return"]')
        p.keyboard.press("Tab")
        expect(back).to_be_focused()
        p.keyboard.press("Enter")
        expect(p.locator(f'#db-results [data-db="item"][data-id="{selected}"]')).to_be_focused()
        # If a filter removes the selected item, the return action targets the search input.
        p.locator("#db-query").fill("no-such-rustline-item-987654321")
        back.focus()
        p.keyboard.press("Enter")
        expect(p.locator("#db-query")).to_be_focused()
        after = p.evaluate("k => JSON.parse(localStorage.getItem(k))", KEY)
        for key in ("wallet", "stash", "stashSlots", "career", "raid"):
            assert before[key] == after[key], key
        assert not errors, errors
        print(f"PASS {width}px offline catalog: keyboard paging boundaries, detail focus, list return, search fallback and unchanged game state", flush=True)

if __name__ == "__main__":
    with sync_playwright() as playwright:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with playwright.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as browser:
            play(browser, 390)
            play(browser, 1280)
            keyboard_catalog(browser, 390)
            keyboard_catalog(browser, 1280)
