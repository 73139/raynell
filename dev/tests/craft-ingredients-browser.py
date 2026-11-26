"""Play the clinic's supply lookup, warehouse eligibility and crafting from original exported saves."""
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-craft.test/").url
KEY = "rl-reboot-session-v36"


def scenario(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={"width": width, "height": 844}, is_mobile=mobile, has_touch=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as ctx:
        if not LIVE:
            ctx.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = ctx.new_page()
        page.set_default_navigation_timeout(90000)
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.clock.install(time=datetime(2027, 2, 1, tzinfo=timezone.utc))

        def at(fragment):
            address = URL + "#" + fragment
            if page.url == address:
                return page.reload(wait_until="domcontentloaded")
            return page.goto(address, wait_until="domcontentloaded")

        def click(selector):
            control = page.locator(selector + ":visible").first
            if mobile:
                control.tap()
            else:
                control.click()

        def saved():
            return page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)

        def restore(name):
            at("stash")
            click(".shell-settings")
            page.locator("#restore-file").set_input_files(ROOT / "tests" / "fixtures" / name)
            expect(page.locator('.save-panel [role="status"]')).to_contain_text("복원했습니다")

        def clinic():
            at("stash")
            click('[data-page="bunker"]')
            click('[data-bui="facility"][data-id="med"]')

        def recipe(index):
            return f'[data-production-recipe="{index}"]'

        def input_at(index, item):
            return recipe(index) + f' [data-craft-input="{item}"]'

        def lookup_roundtrip(index, item, name, tier):
            click(f'[data-bui="tier"][data-tier="{tier}"]')
            original = saved()
            trigger = input_at(index, item)
            expect(page.locator(trigger)).to_be_enabled()
            click(trigger)
            expect(page.locator("#db-detail .db-detail-title h2")).to_have_text(name)
            back = '[data-db="craft-return"]'
            expect(page.locator(back)).to_be_focused()
            expect(page.locator("#db-detail")).to_contain_text("루팅 가능한")
            assert saved() == original
            click(back)
            expect(page.locator('.bu-f-spec header h2')).to_have_text("의무실")
            expect(page.locator(f'[data-bui="tier"][data-tier="{tier}"]')).to_have_attribute("aria-pressed", "true")
            expect(page.locator(trigger)).to_be_focused()
            assert saved() == original

        def cloth_count(owned):
            item = page.locator(input_at(0, "cloth"))
            expect(item).to_contain_text("천 조각")
            expect(item).to_contain_text(f"{owned} / 2")
            expect(item).to_have_attribute("data-shortage", str(2 - owned))
            expect(item).to_contain_text("충족" if owned == 2 else f"{2 - owned}개 부족")
            assert item.evaluate("""n => {const r=n.getBoundingClientRect();return r.left>=-1 &&
                r.right<=innerWidth+1 && n.scrollWidth<=n.clientWidth+1}""")
            start = page.locator(recipe(0) + ' [data-hideout="produce"]')
            assert start.is_enabled() == (owned == 2)
            assert page.locator(input_at(0, "cloth") + '[data-db="craft-ingredient"]').count() == (owned < 2)

        response = at("stash")
        assert response and response.ok and response.body() == HTML
        at("clinic")
        expect(page.locator(".bu-f-spec header h2")).to_have_text("의무실")
        expect(page.locator("[data-production-recipe]")).to_have_count(0)
        restore("finale-v22.json")
        clinic()
        initial = saved()
        assert initial["hideout"]["levels"]["med"] == 1 and initial["wallet"] == 69700
        cloth_count(0)
        expect(page.locator(recipe(1))).to_have_count(0)
        lookup_roundtrip(0, "cloth", "천 조각", tier=3)
        at("shop")
        click('[data-market="trader"][data-id="supply"]')
        click('[data-market="item"][data-id="cloth"]')
        click('[data-market="quantity"][data-step="1"]')
        click('[data-market="trade"][data-mode="buy"][data-id="cloth"][data-qty="2"]')
        after_buy = saved()
        assert after_buy["wallet"] < initial["wallet"] and after_buy["stash"]["cloth"] == 2
        expect(page.locator(".mk-receipt")).to_contain_text("구매 완료")
        clinic()
        cloth_count(2)
        at("stash")
        click('[data-stash="select"][data-id="cloth"]')
        click('[data-gear="pack"][data-id="cloth"]')
        packed = saved()
        uid = next(u["uid"] for u in packed["equipment"]["bag"] if u["g"] == "cloth")
        assert packed["stash"]["cloth"] == 1
        clinic()
        cloth_count(1)
        lookup_roundtrip(0, "cloth", "천 조각", tier=1)
        at("stash")
        click('[data-page="inventory"]')
        if mobile:
            click('[data-loadout="mobile-tab"][data-screen="gear"][data-index="1"]')
        click(f'[data-gear="select"][data-unit="{uid}"]')
        click('[data-gear="unpack"]')
        returned = saved()
        assert not any(u["uid"] == uid for u in returned["equipment"]["bag"])
        assert sum(u["g"] == "cloth" for u in returned["stashSlots"]) == 2
        clinic()
        cloth_count(2)
        click(recipe(0) + ' [data-hideout="produce"]')
        crafting = saved()
        assert crafting["stash"].get("cloth", 0) == 0 and crafting["hideout"]["production"]["med"]["recipe"] == 0
        expect(page.locator(recipe(0) + ' [data-hideout="produce"]')).to_be_disabled()
        expect(page.locator(recipe(0))).to_contain_text("다음 제작 · 창고 사용 가능 / 필요")
        remaining = crafting["hideout"]["production"]["med"]["end"] - page.evaluate("Date.now()")
        assert 175000 < remaining <= 180000
        page.clock.fast_forward(remaining + 500)
        final = saved()
        assert not final["hideout"]["production"] and final["stash"]["bandage"] == initial["stash"].get("bandage", 0) + 2
        assert final["wallet"] == after_buy["wallet"] and final["saleReceipts"] == after_buy["saleReceipts"]
        at("clinic")
        expect(page.locator(".bu-f-spec header h2")).to_have_text("의무실")
        cloth_count(0)
        if not mobile:
            restore("ward-market-v33.json")
            clinic()
            folded = "folded-dressing"
            expect(page.locator(input_at(folded, "gauze"))).to_have_attribute("data-shortage", "1")
            lookup_roundtrip(folded, "gauze", "멸균 거즈", tier=2)
            at("map")
            click('.command-deploy[data-page="prep"]')
            click('.lo-deploy[data-raid="start"]')
            active = saved()
            at("clinic")
            expect(page.locator(".bu-f-spec header h2")).to_have_text("의무실")
            expect(page.locator(recipe(0) + ' [data-hideout="produce"]')).to_be_disabled()
            assert saved()["raid"] == active["raid"] and saved()["wallet"] == active["wallet"]
        assert not errors, errors
        print(f"PASS {width}px: original Lv.1 clinic restored, cloth 0→2→1→2→0 via checkout and exact bag UID, "
              "catalog and tier focus restored with unchanged session, 180s craft yielded two bandages once.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as browser:
            scenario(browser, 390)
            scenario(browser, 1280)
