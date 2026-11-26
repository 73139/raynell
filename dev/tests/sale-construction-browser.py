"""Check a filter's construction uses without altering warehouse selection, sale drafts or payment."""
import copy
import hashlib
import json
import os
from pathlib import Path
from time import time
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
FIXTURES = json.loads((ROOT / "tests/fixtures/campaign-v21.json").read_text())
LIVE = os.getenv("RUSTLINE_URL")
BASE = urldefrag(LIVE or "https://rustline-sale.test/").url
KEY = "rl-reboot-session-v35"


def scenario(browser, width):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, is_mobile=mobile,
                             has_touch=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(BASE + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())

        def click(selector):
            target = page.locator(selector + ":visible").first
            if mobile:
                target.tap()
            else:
                target.click()

        def saved():
            return page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)

        def restore(backup):
            click(".shell-settings")
            page.locator("#restore-file").set_input_files({"name": "campaign.json", "mimeType": "application/json",
                "buffer": json.dumps(backup).encode()})
            expect(page.locator('.save-panel [role="status"]')).to_contain_text("복원했습니다")
            click('.nav [data-page="trade"]')
            click('[data-market="trader"][data-id="repair"]')
            click('[data-market="mode"][data-mode="sell"]')

        def select(uid):
            click(f'[data-trade-grid="stash"] [data-uid="{uid}"]')

        def stage(uid):
            click(f'[data-tg="sell-add"][data-uid="{uid}"]')

        readout = page.locator('[data-sale-construction="filter"]')
        def inspect(owned, left, status):
            assert readout.count() == 1
            summary = readout.locator("summary")
            original = saved()
            expect(summary).to_have_text("시설 건설 사용처")
            summary.click()
            assert readout.evaluate("node => node.open")
            expect(readout).to_contain_text("1개 매입가 9,000 CR")
            expect(readout).to_contain_text(f"창고 {owned}개 · 이 물품 포함 판매 후 {left}개")
            expect(readout.get_by_role("listitem")).to_have_text("정수 시설 Lv.1 " + status)
            expect(readout).not_to_contain_text("접이식 야전 처치포")
            assert readout.evaluate("node => node.scrollWidth <= node.clientWidth + 1")
            summary.click()
            assert not readout.evaluate("node => node.open")
            assert saved() == original

        response = page.goto(BASE + "#shop", wait_until="domcontentloaded", timeout=90000)
        assert response and response.ok and hashlib.sha256(response.body()).digest() == hashlib.sha256(HTML).digest()
        restore(FIXTURES["baseline"])
        before = saved()
        a, b = [u["uid"] for u in before["stashSlots"] if u["g"] == "filter"]
        confirm = page.locator('[data-tg="sell-confirm"]')
        expect(readout).to_have_count(0)
        select(a)
        inspect(2, 1, "건설에 2개 필요")
        expect(confirm).to_be_disabled()
        stage(a)
        select(b)
        inspect(2, 0, "건설에 2개 필요")
        expect(page.locator("[data-sale-total]")).to_contain_text("9,000 CR")
        confirm.click()
        after = saved()
        assert after["wallet"] == before["wallet"] + 9000 and after["stash"]["filter"] == 1
        receipt = after["saleReceipts"]["repair"]
        assert receipt["lines"] == [{"item": "filter", "unit": 9000, "uids": [a]}]
        click('[data-market="trader"][data-id="medic"]')
        select(b)
        expect(readout).to_have_count(0)
        expect(confirm).to_be_disabled()
        click('[data-market="trader"][data-id="repair"]')
        select(b)
        inspect(1, 0, "건설에 2개 필요")
        stage(b)
        select(b)
        inspect(1, 0, "건설에 2개 필요")
        expect(confirm).to_be_enabled()
        confirm.click()
        final = saved()
        assert final["wallet"] == before["wallet"] + 18000 and not final["stash"].get("filter")
        assert final["saleReceipts"]["repair"]["lines"] == [{"item": "filter", "unit": 9000, "uids": [b]}]
        expect(readout).to_have_count(0)
        page.reload(wait_until="domcontentloaded")
        assert saved()["cash"] == final["cash"] and saved()["saleReceipts"] == final["saleReceipts"]

        for state, text in (("paid", "공사 중 · 자재 지급 완료"), ("built", "건설 완료")):
            backup = copy.deepcopy(FIXTURES["baseline"])
            hideout = backup["session"]["hideout"]
            hideout["levels"]["power"] = 1
            if state == "built":
                hideout["levels"]["water"] = 1
            else:
                hideout["builds"]["water"] = {"tier": 1, "end": round(time() * 1000) + 600000}
            restore(backup)
            select(a)
            inspect(2, 1, text)
        # Cash has its own inventory controls. The manual remains an ordinarily sellable original.
        ward = json.loads((ROOT / "tests/fixtures/ward-market-v33.json").read_text())
        restore(ward)
        click('[data-market="trader"][data-id="quarter"]')
        untouched = saved()
        manual = next(u["uid"] for u in untouched["stashSlots"] if u["g"] == "rl_bp_dressing")
        cash = next(u["uid"] for u in untouched["stashSlots"] if u["g"] == "cr_notes")
        click(f'[data-trade-grid="stash"] .cash-tile[data-uid="{cash}"]')
        expect(page.locator('[data-sale-construction]')).to_have_count(0)
        expect(confirm).to_be_disabled()
        select(manual)
        expect(page.locator('[data-sale-construction]')).to_have_count(0)
        stage(manual)
        expect(confirm).to_be_enabled()
        assert saved() == untouched
        assert not errors, errors
        print(f"PASS {width}px: filter use, one or two selected UIDs, previous payment/completion, "
              "uninterested trader, unchanged cash and existing sale receipts.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as playwright:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with playwright.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as browser:
            scenario(browser, 390)
            scenario(browser, 1280)
