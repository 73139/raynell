"""Construction planning through fresh and native v21 saves, including the actual payment and completion."""
import json
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
ORIGINAL = json.loads((ROOT / "tests/fixtures/campaign-v21.json").read_text())["baseline"]
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-construction.test/").url


def scenario(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile, is_mobile=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as ctx:
        if not LIVE:
            ctx.route(URL + "**", lambda r: r.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        p = ctx.new_page()
        p.set_default_navigation_timeout(90000)
        p.set_default_timeout(7000)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.on("dialog", lambda d: d.accept())
        p.clock.install()

        def click(selector):
            control = p.locator(selector + ":visible").first
            if mobile:
                control.tap()
            else:
                control.click()

        def saved():
            return p.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        def clinic():
            response = p.goto(URL + "#clinic", wait_until="domcontentloaded") if p.url != URL+"#clinic" else p.reload(wait_until="domcontentloaded")
            expect(p.locator(".bu-f-spec header h2")).to_have_text("의무실")
            return response

        def review(expected_rooms, cost, shortage=None, paid=None):
            panel = p.locator("[data-build-plan]")
            summary = panel.locator("summary")
            expect(summary).to_be_visible()
            expect(summary).to_contain_text(f"{len(expected_rooms)}단계")
            expect(summary).to_contain_text(f"남은 건설비 {cost:,} CR")
            assert not panel.evaluate("n => n.open")
            expect(panel.locator("ol")).to_be_hidden()
            before = saved()
            click("[data-build-plan] summary")
            expect(panel.locator("ol")).to_be_visible()
            rows = panel.locator("[data-plan-room]")
            assert rows.evaluate_all("els => els.map(el => el.dataset.planRoom)") == expected_rooms
            assert rows.evaluate_all("els => els.map(el => el.dataset.planTier)") == ["1"] * len(expected_rooms)
            for room in expected_rooms:
                row = panel.locator(f'[data-plan-room="{room}"]')
                expect(row).to_contain_text("공사 중 · 지불 완료" if room == paid else "20,000 CR")
            if paid is not None:
                timer = panel.locator(f'[data-plan-room="{paid}"] time[data-facility-end]')
                expect(timer).to_have_attribute("data-facility-end", str(before["hideout"]["builds"][paid]["end"]))
                shown = timer.inner_text()
                p.clock.fast_forward(2300)
                expect(timer).not_to_have_text(shown)
            else:
                expect(panel.locator("time[data-facility-end]")).to_have_count(0)
            if shortage is not None:
                expect(panel.locator("[data-plan-build-balance]")).to_contain_text(f"{shortage:,} CR 부족")
            else:
                expect(panel.locator("[data-plan-build-balance]")).to_contain_text("충당 가능")
            expect(panel.locator("[data-plan-quote]")).to_be_visible()
            assert panel.evaluate("""n => {const r=n.getBoundingClientRect();return r.left>=-1 &&
                r.right<=innerWidth+1 && n.scrollWidth<=n.clientWidth+1}""")
            assert saved() == before, "Opening the plan changed the game save"
            click("[data-build-plan] summary")
            expect(panel.locator("ol")).to_be_hidden()
            assert saved() == before, "Closing the plan changed the game save"

        initial_response = clinic()
        assert initial_response and initial_response.ok and initial_response.body() == HTML
        assert saved()["wallet"] == 30000 and not saved()["stash"]
        review(["power", "water", "med"], 60000, shortage=30000)
        expect(p.locator('[data-hideout="build"][data-id="med"]')).to_be_disabled()
        click(".shell-settings")
        p.locator("#restore-file").set_input_files({"name":"original-v21.json","mimeType":"application/json",
                                                   "buffer":json.dumps(ORIGINAL, ensure_ascii=False).encode()})
        expect(p.locator('.save-panel [role="status"]')).to_contain_text("복원했습니다")
        clinic()
        initial = saved()
        assert initial["wallet"] == 100000 and initial["hideout"]["levels"]["power"] == 0
        review(["power", "water", "med"], 60000)
        click('.bu-needs [data-bui="facility"][data-id="water"]')
        click('.bu-needs [data-bui="facility"][data-id="power"]')
        expect(p.locator("[data-build-plan]")).to_have_count(0)
        click('[data-hideout="build"][data-id="power"][data-tier="1"]')
        working = saved()
        end = working["hideout"]["builds"]["power"]["end"]
        assert working["wallet"] == 80000 and working["hideout"]["levels"]["power"] == 0
        for item, qty in (("fuel", 1), ("wire", 2), ("bolt", 2)):
            assert working["stash"].get(item, 0) == initial["stash"][item] - qty
        remaining = end - p.evaluate("Date.now()")
        assert 595000 < remaining <= 600000
        clinic()
        review(["power", "water", "med"], 40000, paid="power")
        assert saved()["hideout"]["builds"]["power"]["end"] == end
        p.clock.fast_forward(end - p.evaluate("Date.now()") + 600)
        clinic()
        done = saved()
        assert done["hideout"]["levels"]["power"] == 1 and not done["hideout"]["builds"] and done["wallet"] == 80000
        review(["water", "med"], 40000)
        # Work can only be started by the existing build button, never by the plan.
        click('.bu-needs [data-bui="facility"][data-id="water"]')
        click('[data-hideout="build"][data-id="water"][data-tier="1"]')
        water = saved()
        assert water["wallet"] == 60000
        clinic()
        review(["water", "med"], 20000, paid="water")
        p.clock.fast_forward(water["hideout"]["builds"]["water"]["end"] - p.evaluate("Date.now()") + 600)
        clinic()
        expect(p.locator("[data-build-plan]")).to_have_count(0)
        expect(p.locator('[data-hideout="build"][data-id="med"][data-tier="1"]')).to_be_enabled()
        assert saved()["wallet"] == 60000 and not saved()["hideout"]["builds"]
        assert not errors, errors
        print(f"PASS {width}px: 60,000 CR plan, 30,000 CR shortage for fresh profile; v21 restore, "
              "real 20,000 CR charges, paid buildings omitted from costs, completed rooms omitted from order, "
              "solo clinic ready and native disclosure read-only.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as w:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with w.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as browser:
            scenario(browser, 390)
            scenario(browser, 1280)
