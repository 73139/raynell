"""Read the visible pump gauge and report it through a fresh character's field controls."""
import os
import re
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-pump.test/").url
ORDER = "pump-gauge"
KEY = "rl-reboot-session-v36"


def play(browser, width):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, is_mobile=mobile, has_touch=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(7000)
        page.set_default_navigation_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        page.clock.install()

        def click(selector):
            target = page.locator(selector + ":visible").first
            if mobile:
                target.tap()
            else:
                target.click()

        def saved():
            return page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)

        def map_page():
            if page.url != URL + "#map":
                page.goto(URL + "#map", wait_until="domcontentloaded")
            elif page.locator("#inside").get_attribute("data-page") != "map":
                click('.nav [data-page="map"]')

        def landmark(index):
            click(".landmark-picker summary")
            click(f'[data-field="landmark"][data-index="{index}"]')

        def start():
            map_page()
            click('.command-station[data-index="0"]')
            click('.command-deploy[data-page="prep"]')
            click('.lo-deploy[data-raid="start"]')
            state = saved()
            assert state["raid"]["zone"] == 0 and not state["field"].get("pumpGauge")
            expect(page.locator('[data-field="gauge-read"]')).to_have_count(0)
            landmark(6)
            expect(page.locator('[data-pump-gauge="unread"]')).to_be_visible()
            return state["raid"]["startedAt"]

        def raw_reading():
            label = page.locator("[data-gauge-reading]").inner_text()
            match = re.search(r"현장 눈금\s*(\d+)\s*칸", label)
            assert match, label
            return int(match.group(1))

        def read_in_field(raid_id):
            read = page.locator('[data-field="gauge-read"]')
            expect(read).to_have_attribute("data-raid-id", str(raid_id))
            read.click()
            panel = page.locator('[data-pump-gauge="read"]')
            expect(panel).to_be_visible()
            expect(panel).to_contain_text(re.compile(r"기준[^\n]*4\s*칸"))
            value = raw_reading()
            return value, "below" if value < 4 else "above" if value > 4 else "level"

        def leave_and_resume(raid_id):
            landmark(0)
            expect(page.locator('[data-field="gauge-report"]:visible')).to_have_count(0)
            landmark(6)
            click('.field-links [data-page="map"]')
            page.reload(wait_until="domcontentloaded")
            click('.command-deploy[data-page="raid"]')
            assert saved()["raid"]["startedAt"] == raid_id

        def report(answer, raid_id):
            button = page.locator(f'[data-field="gauge-report"][data-answer="{answer}"]')
            expect(button).to_have_attribute("data-raid-id", str(raid_id))
            button.click()

        def extract(normal):
            if normal:
                page.clock.fast_forward(7 * 60000 + 1000)
            click('[data-field="extract"][data-exit="b04"]')
            page.clock.fast_forward(12000)
            expect(page.locator(".result-panel")).to_be_visible()
            result = saved()
            assert result["lastSummary"]["rating"] == ("success" if normal else "quick")
            assert not result["field"].get("pumpGauge")
            return result

        response = page.goto(URL + "#quests", wait_until="domcontentloaded")
        assert response and response.ok and response.body() == HTML
        click('[data-page="orders"]')
        click(f'[data-bui="order"][data-id="{ORDER}"]')
        expect(page.locator(".bu-order-panel")).to_contain_text("12,000 CR")
        click(f'[data-order="{ORDER}"]')
        click(f'[data-objective="pin"][data-id="{ORDER}"]')
        initial = saved()
        assert initial["wallet"] == 30000 and initial["career"]["order"] == ORDER

        # A correct reading can survive a restart but cannot pay on an early return.
        first = start()
        value, answer = read_in_field(first)
        wrong = next(option for option in ("below", "level", "above") if option != answer)
        report(wrong, first)
        expect(page.locator('[data-pump-gauge="read"]')).to_be_visible()
        expect(page.locator('[data-pump-gauge="read"] [role="status"]')).to_contain_text("다시 비교")
        assert not saved()["field"]["pumpGauge"]["answer"]
        leave_and_resume(first)
        assert raw_reading() == value
        report(answer, first)
        expect(page.locator('[data-pump-gauge="recorded"]')).to_be_visible()
        assert saved()["field"]["pumpGauge"]["answer"] == answer
        leave_and_resume(first)
        expect(page.locator('[data-pump-gauge="recorded"]')).to_be_visible()
        early = extract(False)
        assert early["wallet"] == initial["wallet"] and early["career"]["order"] == ORDER
        assert (early["lastSummary"]["commission"], early["lastSummary"]["missionXp"]) == (0, 0)
        click('[data-raid="ack"]')

        # Returning normally with an unreported reading does not reuse the previous raid's answer.
        second = start()
        assert second != first
        read_in_field(second)
        unreported = extract(True)
        assert unreported["wallet"] == 30000 and not unreported["career"]["done"]
        assert (unreported["lastSummary"]["commission"], unreported["lastSummary"]["missionXp"]) == (0, 0)
        click('[data-raid="ack"]')

        third = start()
        assert third not in (first, second)
        value, answer = read_in_field(third)
        report(answer, third)
        expect(page.locator('[data-pump-gauge="recorded"]')).to_be_visible()
        leave_and_resume(third)
        done = extract(True)
        summary = done["lastSummary"]
        assert (summary["commission"], summary["missionXp"]) == (12000, 55)
        assert done["wallet"] == 42000 and done["career"]["done"] == [ORDER]
        assert done["stash"] == {} and not done["field"]["bag"]
        page.reload(wait_until="domcontentloaded")
        assert saved()["wallet"] == 42000 and saved()["career"] == done["career"]
        map_page()
        click('.command-deploy[data-page="raid"]')
        click('[data-raid="ack"]')
        page.reload(wait_until="domcontentloaded")
        final = saved()
        assert final["raid"] is None and final["wallet"] == 42000 and final["career"] == done["career"]
        assert not errors, errors
        print(f"PASS {width}px: visible gauge, wrong answer/retry, leave/reload, early and unreported returns, "
              "normal return +12,000 CR / 55 order XP exactly once.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as playwright:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with playwright.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as browser:
            play(browser, 390)
            play(browser, 1280)
