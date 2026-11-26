"""Compare recovered-loot quotes with an actual confirmed sale and its persistent receipt."""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-return-market.test/").url


def play(browser, width, outcome):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile,
                             is_mobile=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        page.set_default_timeout(7000)
        page.set_default_navigation_timeout(90000)
        page.clock.install()
        response = page.goto(URL + "#map", wait_until="domcontentloaded")
        assert response and response.ok and response.body() == HTML

        def click(selector):
            target = page.locator(selector + ":visible").first
            if mobile:
                target.tap()
            else:
                target.click()

        def saved():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        click('.command-station[data-index="0"]')
        click('.command-deploy[data-page="prep"]')
        page.evaluate("Math.random = () => .1")
        click('.lo-deploy[data-raid="start"]')
        click(".landmark-header summary")
        click('[data-field="landmark"][data-index="7"]')
        click('[data-field="scan"]')
        page.clock.fast_forward(10000)
        click('[data-field="open"]')
        tab = '[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]'
        if page.locator(tab + ":visible").count():
            click(tab)
        appraisal = page.locator('[data-field-appraisal]:visible')
        expect(appraisal).to_have_count(0)
        click('.lo-search[data-field="search"]')
        page.clock.fast_forward(10000)
        click('[data-side="loot"][aria-label^="구급 붕대"]')
        expect(appraisal).to_have_text('귀환 후 상인 매입가 2,250 CR')
        assert saved()['wallet'] == 30000 and not saved()['saleReceipts']
        click('[data-field="take"]')
        click('[data-field="close"]')
        assert [unit["g"] for unit in saved()["field"]["bag"]] == ["bandage"]
        if outcome == "abandoned":
            click('[data-field="abandon"]')
        else:
            if outcome == "success":
                page.clock.fast_forward(7 * 60000)
            click('[data-field="extract"][data-exit="b04"]')
            page.clock.fast_forward(12000)
        report = page.locator(".result-panel")
        expect(report).to_be_visible()
        result = saved()
        assert result["lastSummary"]["goods"] == ["bandage"]
        assert result["lastSummary"]["rating"] == outcome and result["wallet"] == 30000
        market = page.locator("[data-return-market]")
        if outcome == "abandoned":
            expect(report).to_contain_text("잃은 물품")
            expect(market).to_have_count(0)
            assert result["stash"].get("bandage", 0) == 0 and not result["saleReceipts"]
            assert not errors, errors
            print(f"PASS {width}px lost bandage: no stash copy, quote or sale.", flush=True)
            return

        assert result["stash"]["bandage"] == 1
        uid = next(item["uid"] for item in result["stashSlots"] if item["g"] == "bandage")
        if mobile:
            assert market.locator("summary").bounding_box()["height"] >= 44
        click("[data-return-market] summary")
        row = market.locator('[data-return-item="bandage"]')
        expect(row).to_contain_text("구급 붕대")
        expect(row).to_contain_text("2,250 CR")
        expect(row).to_contain_text("윤서진")
        click('[data-raid="sale"][data-trader="medic"][data-id="bandage"]')
        expect(page.locator('[data-market="mode"][data-mode="sell"]')).to_have_attribute("aria-pressed", "true")
        expect(page.locator('[data-market="trader"][data-id="medic"]')).to_have_attribute("aria-pressed", "true")
        confirm = page.locator('[data-tg="sell-confirm"]')
        expect(confirm).to_be_disabled()
        opened = saved()
        assert opened["raid"] is None and opened["wallet"] == result["wallet"]
        assert opened["stashSlots"] == result["stashSlots"] and not opened["saleReceipts"]
        source = page.locator(f'[data-trade-grid="stash"] [data-uid="{uid}"]')
        expect(source).to_have_attribute("data-trade-item", "bandage")
        assert "2,250 CR" in source.get_attribute("aria-label")
        if mobile:
            source.tap()
            click(f'[data-tg="sell-add"][data-uid="{uid}"]')
        else:
            tray = page.locator('[data-trade-grid="sale"]')
            tray.scroll_into_view_if_needed()
            pos = tray.evaluate("el => ({x:el.clientWidth/Number(el.dataset.cols)/2, y:el.clientHeight/Number(el.dataset.rows)/2})")
            source.drag_to(tray, target_position=pos)
        expect(page.locator("[data-sale-total]")).to_contain_text("2,250")
        assert saved()["wallet"] == 30000 and saved()["stashSlots"] == opened["stashSlots"]
        click('[data-tg="sell-confirm"]')

        def receipt():
            line = page.locator('[data-sale-receipt-line="bandage"]')
            expect(line).to_contain_text("단가 2,250 CR × 1개")
            expect(page.locator("[data-sale-receipt-total]")).to_contain_text("2,250")
            expect(page.locator("[data-sale-receipt-balance]")).to_contain_text("32,250")

        receipt()
        sold = saved()
        record = sold["saleReceipts"]["medic"]
        assert (record["before"], record["total"], record["balance"]) == (30000, 2250, 32250)
        assert record["lines"][0]["uids"] == [uid] and not sold["stash"].get("bandage")
        assert sum(note["amount"] for note in sold["cash"]["pocket"]) == 32250
        page.reload(wait_until="domcontentloaded")
        page.goto(URL + "#shop", wait_until="domcontentloaded")
        click('[data-market="trader"][data-id="medic"]')
        click('[data-market="mode"][data-mode="sell"]')
        history = page.locator("details[data-sale-history]")
        if history.get_attribute("open") is None:
            click("[data-sale-history] summary")
        receipt()
        assert saved()["saleReceipts"]["medic"] == record and saved()["wallet"] == 32250
        assert not errors, errors
        print(f"PASS {width}px {outcome}: field appraisal and return quote 2,250 CR, same buyer, no automatic staging or sale, "
              "explicit sale, physical balance and identical receipt after reload.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as chromium:
            for width, outcome in ((390, "quick"), (1280, "success"), (390, "abandoned")):
                play(chromium, width, outcome)
