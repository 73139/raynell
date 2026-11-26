"""Verify the pinned two-ledger pre-sortie route against the real map, spawn and roads."""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-inspection-route.test/").url
ORDER = "handover-ledgers"
KEY = "rl-reboot-session-v36"
ZONES = ("벙커 외곽", "폐쇄 검문소", "군수 보급 창고")
DEFAULT_START = ("외곽 보급소", "경비 초소", "중앙 보급동")
# Each tuple contains route, cells, base walk seconds and displayed contact probability.
TRIPS = (((0, 1, 0), 2, 15, "17.2%"), ((1, 0), 1, 7, "8%"), ((2, 1, 0), 3, 21, "52.3%"))
DRAWERS = ("0-17", "1-6")


def play(browser, origin, width, fixed_destination):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, has_touch=mobile, is_mobile=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as ctx:
        if not LIVE:
            ctx.route(URL + "**", lambda route: route.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = ctx.new_page()
        page.set_default_navigation_timeout(90000)
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.clock.install()
        response = page.goto(URL + "#map", wait_until="domcontentloaded")
        assert response and response.ok and response.body() == HTML, "Loaded page differs from local release"
        guidance = page.locator("[data-inspection-route]")
        expect(guidance).to_have_count(0)

        def click(selector):
            control = page.locator(selector + ":visible").first
            if mobile:
                control.tap()
            else:
                control.click()

        def saved():
            return page.evaluate("k => JSON.parse(localStorage.getItem(k))", KEY)

        def checklist_rows():
            return page.locator("[data-inspection-box]").evaluate_all("rows => rows.map(r => r.dataset.inspectionBox)")

        def guide(z, point=0):
            path, cells, seconds, chance = TRIPS[z]
            expected = {"origin": str(z), "start-landmark": str(point), "path": ",".join(map(str, path)),
                        "legs": str(len(path) - 1), "cells": str(cells), "walk-ms": str(seconds * 1000)}
            expect(guidance).to_be_visible()
            for key, value in expected.items():
                expect(guidance).to_have_attribute("data-" + key, value)
            expect(guidance).to_contain_text(ZONES[z] + " · " + ("검역 천막" if point == 1 else DEFAULT_START[z]))
            expect(guidance).to_contain_text(" → ".join(ZONES[i] for i in path) + " · B-04 탈출구")
            expect(guidance).to_contain_text(f"권역 이동 {len(path) - 1}회 · {cells}칸 · 순수 이동 {seconds}초")
            expect(guidance).to_contain_text("이동 중 한 번 이상 조우할 확률 " + chance)
            assert checklist_rows() == list(DRAWERS if z == 0 else reversed(DRAWERS))
            expect(page.locator('[data-inspection-box][data-complete="false"]')).to_have_count(2)
            assert guidance.evaluate("""n => {const r = n.getBoundingClientRect();
                return r.left >= -1 && r.right <= innerWidth + 1 && n.scrollWidth <= n.clientWidth + 1}""")

        page.goto(URL + "#quests")
        click('[data-page="orders"]')
        click(f'[data-bui="order"][data-id="{ORDER}"]')
        click(f'[data-order="{ORDER}"]')
        click(f'[data-objective="pin"][data-id="{ORDER}"]')
        if fixed_destination:
            page.goto(URL + "#lootplan")
            click('[data-lootplan="goal"][data-id="medical"]')
            click('[data-lootplan="region"][data-zone="1"]')
            click('[data-lootplan="candidate"][data-zone="1"][data-landmark="1"]')
            guide(1, 1)
            click('[data-objective-panel="prep"] [data-page="map"]')
        else:
            page.goto(URL + "#map")

        # Selecting a station changes the UI departure preference only. Viewing any number
        # of plans must leave the entire persisted gameplay session untouched.
        baseline = saved()
        assert baseline["wallet"] == 30000 and not baseline["stash"] and baseline["raid"] is None
        if fixed_destination:
            assert baseline["lootDestination"] == {"goal": "medical", "zone": 1, "index": 1}
        for z in (0, 1, 2, origin):
            click(f'.command-station[data-index="{z}"]')
            expect(page.locator(f'.command-station[data-index="{z}"]')).to_have_attribute("aria-pressed", "true")
            guide(z, int(fixed_destination and z == 1))
            assert saved() == baseline
        click('.command-deploy[data-page="prep"]')
        start_point = int(fixed_destination and origin == 1)
        guide(origin, start_point)
        assert saved() == baseline
        if fixed_destination:
            row = page.locator('[data-preflight-kind="destination"]')
            expect(row).to_have_attribute("data-ready", "true" if start_point else "false")
        if mobile:
            click('[data-loadout="mobile-tab"][data-screen="prep"][data-index="2"]')
        if origin == 2:
            page.evaluate("Math.random = () => .01")  # Generate both empty drawers through normal spawning.
        click('.lo-deploy[data-raid="start"]')
        actual = saved()
        assert actual["raid"]["zone"] == origin and actual["field"]["landmarkByZone"][origin] == start_point
        assert actual["field"].get("journey") is None and actual["lootDestination"] == baseline["lootDestination"]
        expect(guidance).to_have_count(0)
        assert checklist_rows() == list(DRAWERS)
        expect(page.locator('[data-inspection-box][data-complete="false"]')).to_have_count(2)
        click('.field-links [data-page="map"]')
        expect(guidance).to_have_count(0)
        expect(page.locator('[data-inspection-box][data-complete="false"]')).to_have_count(2)
        click(f'.command-station[data-index="{origin}"]')
        click('.command-deploy[data-page="raid"]')

        # Play the longest recommended road pair. Only scenario rolls and timer advancement
        # are controlled; every travel and search is started by a real UI input.
        if origin == 2:
            page.evaluate("Math.random = () => .1")
            for sector, destination, steps, landmark, box in ((2, 1, 2, 1, 6), (1, 0, 1, 8, 17)):
                click(f'[data-route-card][data-from="{sector}"][data-to="{destination}"] [data-field="move"]')
                for _ in range(steps):
                    page.clock.fast_forward(7200)
                assert saved()["raid"]["zone"] == destination
                click(".landmark-header summary")
                click(f'[data-field="landmark"][data-index="{landmark}"]')
                for _ in range(2):
                    click('[data-field="scan"]')
                    page.clock.fast_forward(10500)
                    if page.locator('[data-field="evade"]:visible').count():
                        click('[data-field="evade"]')
                        page.clock.fast_forward(10000)
                click(f'[data-field="open"][data-index="{box}"]')
                click('.lo-search[data-field="search"]')
                page.clock.fast_forward(18000)
                click('[data-field="close"]')
                expect(page.locator(f'[data-inspection-box="{destination}-{box}"]')).to_have_attribute("data-complete", "true")
            click('[data-field="extract"][data-exit="b04"]')
            page.clock.fast_forward(12000)
            assert saved()["lastSummary"]["completedObjectiveOrder"] == ORDER and saved()["wallet"] == 64000
            expect(guidance).to_have_count(0)
        assert not errors, errors
        print(f"PASS {width}px origin {origin}, fixed destination {fixed_destination}: all three map plans, "
              f"actual spawn {origin}/{start_point}, original field checklist and read-only planning.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as browser:
            play(browser, origin=0, width=390, fixed_destination=False)
            play(browser, origin=1, width=390, fixed_destination=True)
            play(browser, origin=2, width=1280, fixed_destination=True)
