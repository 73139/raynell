"""Compare the medical order's B-04 forecast with actual receipts in fresh Chromium profiles."""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-exit-order.test/").url
ORDER = "med-supply"
TITLE = "끊긴 의무품 보급선"


def run_case(browser, mode, width):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile,
                             is_mobile=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(7000)
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        start = datetime(2026, 11, 26, 0, tzinfo=timezone.utc)
        page.clock.install(time=start - timedelta(days=1))
        page.clock.pause_at(start)
        response = page.goto(URL + "#quests", wait_until="domcontentloaded", timeout=60000)
        assert response and response.ok and response.body() == HTML

        def click(selector):
            button = page.locator(selector + ":visible").first
            if mobile:
                button.tap()
            else:
                button.click()

        def saved():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        if mode != "no-order":
            click('[data-page="orders"]')
            click(f'[data-bui="order"][data-id="{ORDER}"]')
            click(f'[data-order="{ORDER}"]')
            if mode != "early":
                click(f'[data-objective="pin"][data-id="{ORDER}"]')
        page.goto(URL + "#map")
        click('.command-station[data-index="0"]')
        click('.command-deploy[data-page="prep"]')
        page.evaluate("Math.random = () => .1")
        click('.lo-deploy[data-raid="start"]')
        forecast = page.locator('[data-exit-forecast="b04"]')
        expect(forecast).to_be_visible()
        if mode == "no-order":
            expect(forecast).to_have_text("예상 정산 · 조기 탈출 · 전리품 회수 · 기본 25 XP")
            assert not errors
            print(f"PASS {width}px, plain forecast with no order", flush=True)
            return
        expect(forecast).to_contain_text(TITLE)
        expect(forecast).to_contain_text("목표 미달")
        expect(forecast).to_contain_text("0/1")
        expect(forecast).to_contain_text("0 CR / 0 XP")
        held = mode != "missing"
        if held:
            click('.landmark-header summary')
            click('[data-field="landmark"][data-index="7"]')

            def inspect(box_name, take):
                click('[data-field="scan"]')
                page.clock.fast_forward(10000)
                container = page.locator('[data-field="open"]').filter(has_text=box_name)
                if mobile:
                    container.tap()
                else:
                    container.click()
                tab = '[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]'
                if page.locator(tab + ":visible").count():
                    click(tab)
                click('.lo-search[data-field="search"]')
                page.clock.fast_forward(10000)
                if take:
                    click('[data-side="loot"][aria-label^="구급 붕대"]')
                    click('[data-field="take"]')
                click('[data-field="close"]')

            inspect("진료대 응급함", True)
            assert [unit["g"] for unit in saved()["field"]["bag"]] == ["bandage"]
            expect(forecast).not_to_contain_text("목표 미달")
            expect(forecast).to_contain_text("0 CR / 0 XP")
            if mode == "two-boxes":
                inspect("왕진 가방", False)
        began = saved()["raid"]["startedAt"]

        def advance_to(elapsed_ms):
            delay = began + elapsed_ms - page.evaluate("Date.now()")
            assert delay >= 0
            page.clock.fast_forward(delay)

        if mode == "early":
            advance_to(408000)  # Finish at 6:58, even if an idle preview later changes.
            expect(forecast).to_contain_text("생존 00:02 추가")
            expect(forecast).to_contain_text("컨테이너 1개 추가 수색 완료")
            expect(forecast).to_contain_text("교전 1회 승리")
        elif mode != "two-boxes":
            advance_to(408000)
            expect(forecast).to_contain_text("조기 탈출")
            advance_to(411000)  # Start before seven minutes; finish at 7:01.
        normal = mode != "early"
        paid = normal and held
        rating = "정상 탈출" if normal else "조기 탈출"
        reward_text = "28,000 CR / 100 XP" if paid else "0 CR / 0 XP"
        expect(forecast).to_contain_text(rating)
        expect(forecast).to_contain_text(reward_text)
        assert forecast.evaluate("el => el.scrollWidth <= el.clientWidth + 1")
        click('[data-field="extract"][data-exit="b04"]')
        action = saved()["field"]["action"]
        assert action["type"] == "extract" and (action["end"] - action["start"]) == 10000
        if mode == "early":
            advance_to(415000)  # A newly started exit would now qualify; this one cannot.
            expect(forecast).to_contain_text("생존 00:02 추가")
        if mode == "boundary":
            advance_to(420000)  # This fixed countdown actually crosses the threshold.
        expect(forecast).to_contain_text(rating)
        expect(forecast).to_contain_text(reward_text)
        assert saved()["wallet"] == 30000 and saved()["career"]["done"] == []
        advance_to(action["end"] - began + 400)
        expect(page.locator(".result-panel")).to_contain_text("SURVIVED" if normal else "RUN THROUGH")
        receipt = saved()
        summary = receipt["lastSummary"]
        assert summary["rating"] == ("success" if normal else "quick")
        assert (summary["commission"], summary["missionXp"]) == ((28000, 100) if paid else (0, 0))
        assert summary["elapsed"] == action["end"] - began
        if mode == "two-boxes":
            assert summary["elapsed"] < 420000 and summary["searched"] == 2
        if mode == "early":
            assert summary["earned"] == 25
        assert receipt["stash"].get("bandage", 0) == int(held)
        assert receipt["career"]["done"] == ([ORDER] if paid else [])
        assert receipt["career"]["order"] == (None if paid else ORDER)
        assert receipt["wallet"] == 30000 + summary["commission"]
        page.reload()
        reopened = saved()
        assert (reopened["wallet"], reopened["career"]["xp"]) == (receipt["wallet"], receipt["career"]["xp"])
        assert not errors, errors
        print(f"PASS {width}px, {mode}: {summary['elapsed']} ms, {summary['rating']}, "
              f"order {summary['commission']} CR / {summary['missionXp']} XP", flush=True)


if __name__ == "__main__":
    with sync_playwright() as playwright:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with playwright.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as chromium:
            for path, width in (("early",390), ("boundary",1280), ("two-boxes",390), ("missing",1280), ("no-order",390)):
                run_case(chromium, path, width)
