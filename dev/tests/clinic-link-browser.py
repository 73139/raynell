"""Reopen the clinic permalink after changing screens, preserving navigation and raid state."""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
BASE = urldefrag(LIVE or "https://rustline-clinic.test/terminal").url
URL = BASE + ("&" if "?" in BASE else "?") + "from=clinic&source=a%2Bb"
KEY = "rl-reboot-session-v35"


def scenario(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={"width": width, "height": 844}, is_mobile=mobile,
                             has_touch=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not LIVE:
            context.route("https://rustline-clinic.test/**", lambda route: route.fulfill(
                body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(8000)
        page.set_default_navigation_timeout(90000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())

        def visit(fragment):
            return page.goto(URL + "#" + fragment, wait_until="domcontentloaded")

        def click(selector):
            control = page.locator(selector + ":visible").first
            if mobile:
                control.tap()
            else:
                control.click()

        def session():
            saved = page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)
            return {key: saved.get(key) for key in (
                "raid", "field", "wallet", "equipment", "stash", "stashSlots", "hideout", "saleReceipts")}

        def at_clinic():
            expect(page.locator(".bu-f-spec header h2")).to_have_text("의무실")
            expect(page.locator(".bu-f-spec [data-hideout=build]")).to_have_attribute("data-id", "med")
            assert page.url == URL + "#clinic"

        response = visit("clinic")
        assert response and response.ok and response.body() == HTML
        at_clinic()
        initial = session()
        assert initial["wallet"] == 30000 and initial["raid"] is None
        click('[data-bui="tier"][data-tier="2"]')
        at_clinic()
        expect(page.locator('[data-bui="tier"][data-tier="2"]')).to_have_attribute("aria-pressed", "true")
        page.evaluate("history.replaceState({visit: 'clinic'}, '', location.href)")
        length = page.evaluate("history.length")
        click('.bu-room-strip [data-bui="facility"][data-id="power"]')
        expect(page.locator(".bu-f-spec header h2")).to_have_text("발전 시설")
        assert page.url == URL
        assert page.evaluate("history.length") == length
        assert page.evaluate("history.state") == {"visit": "clinic"}

        # A same-document visit to the original URL must work without reloading the document.
        origin = page.evaluate("performance.timeOrigin")
        visit("clinic")
        at_clinic()
        assert page.evaluate("performance.timeOrigin") == origin
        click('.nav [data-page="trade"]')
        expect(page.locator('[data-market="trader"]:visible').first).to_be_visible()
        assert page.url == URL
        visit("clinic")
        at_clinic()
        click('.bu-materials [data-db="lookup"]')
        expect(page.locator("#db-detail .db-detail-title h2")).to_be_visible()
        assert page.url == URL
        visit("clinic")
        at_clinic()
        assert session() == initial
        page.keyboard.press("Escape")
        expect(page.locator("#start")).to_be_visible()
        expect(page).to_have_url(URL)
        visit("clinic")
        at_clinic()
        assert session() == initial

        visit("shop")
        expect(page.locator('[data-market="trader"]:visible').first).to_be_visible()
        click('.nav [data-page="bunker"]')
        expect(page.locator(".bu-deck")).to_be_visible()
        assert page.url == URL + "#shop"
        visit("map")
        expect(page.locator(".command-station:visible").first).to_be_visible()
        click('.command-station[data-index="0"]')
        click('.command-deploy[data-page="prep"]')
        click('.lo-deploy[data-raid="start"]')
        active = session()
        assert active["raid"]["endsAt"] > active["raid"]["startedAt"]
        visit("clinic")
        at_clinic()
        expect(page.locator('.bu-f-spec [data-hideout="build"]')).to_be_disabled()
        page.reload(wait_until="domcontentloaded")
        at_clinic()
        assert session() == active
        visit("map")
        click('.command-deploy[data-page="raid"]')
        expect(page.locator(".landmark-header")).to_be_visible()
        assert session() == active
        assert not errors, errors
        print(f"PASS {width}px: clinic cold start, repeat from another facility, trade and catalog, "
              "history entry, existing shop/map links, and active raid persistence.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as playwright:
        proxy = {"server": os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with playwright.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"), proxy=proxy) as browser:
            scenario(browser, 390)
            scenario(browser, 1280)
