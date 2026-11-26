"""Shared-link reload, same-document traversal, fresh launcher, and tab-local isolation."""
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
BASE = os.getenv("RUSTLINE_URL", "https://rustline-entry.test/terminal")
URL = BASE + ("&" if "?" in BASE else "?") + "source=calendar%2Bchat"
TARGETS = {"shop": "trade", "map": "map", "presets": "presets"}


def play(browser, width, legacy=False):
    with browser.new_context(viewport={"width": width, "height": 840},
                             has_touch=width==390, is_mobile=width==390,
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as ctx:
        if not os.getenv("RUSTLINE_URL"):
            ctx.route("https://rustline-entry.test/**", lambda r: r.fulfill(body=HTML, content_type="text/html;charset=utf-8"))
        if legacy:
            ctx.add_init_script("Object.defineProperty(window,'navigation',{value:undefined})")
        first, second = ctx.new_page(), ctx.new_page()

        def enter(p, key):
            response = p.goto(URL + "#" + key, wait_until="domcontentloaded", timeout=90000)
            assert response and response.ok and response.body()==HTML
            expect(p.locator("#inside")).to_have_attribute("data-page", TARGETS[key])

        def leave(p):
            p.locator('.nav [data-page="bunker"]:visible').first.click()
            expect(p).to_have_url(URL)
            expect(p.locator(".bu-deck")).to_be_visible()

        def reload_link(p, key):
            p.reload(wait_until="domcontentloaded", timeout=90000)
            expect(p).to_have_url(URL + "#" + key)
            expect(p.locator("#inside")).to_be_visible()
            expect(p.locator("#inside")).to_have_attribute("data-page", TARGETS[key])

        enter(first, "shop")
        first.evaluate("history.replaceState({host:'shop-host', nested:{v:2}},'',location.href)")
        leave(first)
        # Give the second tab the game's legitimate single-writer lock.
        first.goto("about:blank")
        enter(second, "presets")
        leave(second)
        reload_link(second, "presets")
        second.close()
        first.go_back(wait_until="domcontentloaded")
        expect(first).to_have_url(URL)
        first_length=first.evaluate("history.length")
        reload_link(first, "shop")
        assert first.evaluate("history.length") == first_length
        assert first.evaluate("history.state.host")== "shop-host" and first.evaluate("history.state.nested.v")==2
        if not legacy: assert first.evaluate("Object.keys(history.state).sort()")==["host","nested"]
        leave(first)
        # An unrelated navigation to the same bare URL still opens the original phone launcher.
        cold=ctx.new_page()
        cold.goto(URL, wait_until="domcontentloaded")
        expect(cold.locator("#inside")).to_be_hidden()
        cold.reload(wait_until="domcontentloaded")
        expect(cold).to_have_url(URL)
        expect(cold.locator("#inside")).to_be_hidden()
        cold.close()
        reload_link(first, "shop")
        first.evaluate("location.hash='map'")
        expect(first.locator("#inside")).to_have_attribute("data-page","map")
        leave(first)
        reload_link(first,"map")
        print(f"PASS {width}px {'History fallback' if legacy else 'native entries'}: three shared destinations survive document reload twice; host query/state/history length, two same-URL tabs and fresh launcher.", flush=True)


if __name__ == "__main__":
    proxy={"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
    with sync_playwright() as pw, pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as browser:
        play(browser,390)
        play(browser,1280)
        play(browser,1280,True)
