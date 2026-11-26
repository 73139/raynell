"""Check pre-departure route forecasts with real controls and an isolated browser profile.

Run after build.py. Optionally pass a built HTML file and set RUSTLINE_CHROMIUM.
"""
import argparse
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://rustline-route-risk.test/"

# Direction matters. Columns are per-cell contact, per-cell supply, whole-trip
# contact at least once and whole-trip supply at least once (one decimal place).
ODDS = {
    (0, 1): ("10%", "25%", "10%", "25%"),
    (0, 2): ("35%", "27%", "72.5%", "61.1%"),
    (1, 0): ("8%", "20%", "8%", "20%"),
    (1, 2): ("20%", "34%", "36%", "56.4%"),
    (2, 0): ("15%", "30%", "38.6%", "65.7%"),
    (2, 1): ("28%", "32%", "48.2%", "53.8%"),
}


def assert_label_fits(field):
    fits = field.evaluate("""el => {
        const row = el.parentElement, label = row.querySelector('dt');
        const labelBox = label.getBoundingClientRect(), valueBox = el.getBoundingClientRect();
        const card = el.closest('[data-route-card]').getBoundingClientRect();
        return labelBox.left >= card.left - 1 && valueBox.right <= card.right + 1
            && labelBox.right <= valueBox.left + 1;
    }""")
    assert fits, (field.inner_text(), "label overlaps value or card edge")


def compare(page, origin, active):
    panel = page.locator(f'[data-route-compare][data-from="{origin}"]:visible')
    expect(panel).to_have_count(1)
    expect(panel.locator("[data-route-card]")).to_have_count(2)
    for (start, end), odds in ODDS.items():
        if origin != start:
            continue
        card = panel.locator(f'[data-route-card][data-to="{end}"]')
        for selector, value in zip(("risk", "supply", "trip-risk", "trip-supply"), odds):
            field = card.locator(f"[data-route-{selector}]")
            expect(field).to_be_visible()
            expect(field).to_have_text(value)
            # At narrow widths check the actual text and its label fit inside
            # the card, including when the player has to scroll down to it.
            assert_label_fits(field)
        expect(card.locator('[data-field="move"]')).to_have_count(1 if active else 0)
        if (start, end) == (0, 2):
            energy = card.locator("[data-route-energy]")
            expect(energy).to_have_text("100 → 91" if active else "9")
            expect(card.locator("[data-route-exhaustion]")).to_have_count(0)
            assert_label_fits(energy)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")


def play(browser, html, width):
    touch = width < 600
    with browser.new_context(viewport={"width": width, "height": 844},
                             is_mobile=touch, has_touch=touch, reduced_motion="reduce") as context:
        context.route(ORIGIN + "**", lambda r: r.fulfill(body=html, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(7000)
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.clock.install()
        page.goto(ORIGIN + "#map")

        def activate(button):
            if touch:
                button.tap()
            else:
                button.click()

        for origin in (0, 1, 2, 0):
            activate(page.locator(f'button.command-station[data-index="{origin}"]'))
            compare(page, origin, False)

        # The in-game text setting must also enlarge the numeric forecast. The
        # browser restores the same map link and the persisted preference on reload.
        number = page.locator('[data-route-trip-risk]:visible').first
        def font_size():
            return number.evaluate('el => parseFloat(getComputedStyle(el).fontSize)')
        standard = font_size()
        activate(page.locator('.shell-settings'))
        activate(page.locator('[data-setting="large"]'))
        page.reload()
        assert font_size() > standard
        compare(page, 0, False)
        activate(page.locator('.shell-settings'))
        activate(page.locator('[data-setting="large"]'))
        page.reload()
        assert font_size() == standard

        activate(page.locator('.command-deploy[data-page="prep"]'))
        activate(page.locator('.lo-deploy[data-raid="start"]'))
        compare(page, 0, True)
        activate(page.locator('.field-links [data-page="map"]'))
        activate(page.locator('button.command-station[data-index="2"]'))
        compare(page, 0, True)  # Inspecting another station cannot move the player.
        long_route = page.locator('[data-route-card][data-from="0"][data-to="2"]:visible')
        # Seed low energy in this private test profile. Keep the normal game
        # clock and move controls; force clear cells to isolate walking damage.
        page.evaluate("""() => {
            const key = 'rl-reboot-session-v36', save = JSON.parse(localStorage.getItem(key));
            save.field.energy = 5;
            localStorage.setItem(key, JSON.stringify(save));
        }""")
        page.goto(ORIGIN + "#map")
        page.reload()
        expect(long_route.locator("[data-route-energy]")).to_have_text("5 → 0")
        warning = long_route.locator("[data-route-exhaustion]")
        expect(warning).to_have_text("2칸째부터 체력 −16 (합계)")
        assert_label_fits(warning)
        page.evaluate("""() => {
            let remaining = 3;
            const random = Math.random;
            Math.random = () => remaining-- > 0 ? .01 : random();
        }""")
        activate(long_route.locator('[data-field="move"]'))
        for refresh in (False, True):
            if refresh:
                page.reload()
            status = page.locator("[data-route-status]:visible").first
            expect(status).to_contain_text("폐철도 화물선")
            expect(page.locator("[data-route-trip-risk]:visible, [data-route-trip-supply]:visible")).to_have_count(0)
        def current():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        for _ in range(3):
            step = current()["field"]["action"]
            assert step["outcome"] == "clear"
            page.clock.fast_forward(step["end"] - page.evaluate("Date.now()") + 300)
        arrived = current()
        assert (arrived["raid"]["zone"], arrived["field"]["energy"], arrived["field"]["hp"]) == (2, 0, 84)
        assert not errors, errors
        print(f"PASS {width}px {'touch' if touch else 'mouse'} | six routes, raid and map views, "
              "energy forecast/actual damage, departure/reload, label fit and clean page errors")


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("game", nargs="?", type=Path, default=ROOT / "index.html")
    html = cli.parse_args().game.read_bytes()
    with sync_playwright() as playwright:
        with playwright.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM")) as chromium:
            print("Chromium", chromium.version)
            for viewport in (1280, 390):
                play(chromium, html, viewport)
