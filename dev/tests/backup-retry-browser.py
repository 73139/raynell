"""Cancel a real file selection, choose the same native backup again, and verify the restored player."""
import json
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DOC = (ROOT / "index.html").read_bytes()
KEY = re.search(rb"const SAVE_KEY='([^']+)'", DOC).group(1).decode("ascii")
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-backup-retry.test/").url
PIPE = "rl_08_15"


def play(browser, width):
    mobile = width < 600
    with browser.new_context(viewport={"width": width, "height": 844}, is_mobile=mobile, has_touch=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as ctx, TemporaryDirectory() as work:
        if not LIVE:
            ctx.route(URL + "**", lambda route: route.fulfill(body=DOC, content_type="text/html; charset=utf-8"))
        page = ctx.new_page()
        page.set_default_timeout(8000)
        page.set_default_navigation_timeout(90000)
        response = page.goto(URL + "#map", wait_until="domcontentloaded")
        assert response and response.ok and response.body() == DOC

        def click(selector):
            control = page.locator(selector + ":visible").first
            if mobile:
                control.tap()
            else:
                control.click()

        def saved():
            return page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)

        def choose(path):
            with page.expect_file_chooser() as dialog:
                click('[data-backup="import"]')
            dialog.value.set_files(path)

        click(".shell-settings")
        with page.expect_download() as export:
            click('[data-backup="export"]')
        backup = Path(work) / export.value.suggested_filename
        export.value.save_as(backup)
        original = json.loads(backup.read_text())["session"]
        assert original["wallet"] == 30000
        click('.nav [data-page="bunker"]')
        click('.bu-facility-tile[data-id="water"]')
        click(f'.bu-materials [data-db="lookup"][data-id="{PIPE}"]')
        click(f'[data-supply="{PIPE}"]')
        bought = saved()
        assert bought["wallet"] == 14000 and bought["stash"][PIPE] == 1
        click(".shell-settings")
        confirmations = []

        def confirm(dialog):
            assert dialog.type == "confirm"
            confirmations.append(dialog.message)
            if len(confirmations) == 1:
                dialog.dismiss()
            else:
                dialog.accept()

        page.on("dialog", confirm)
        with page.expect_event("dialog"):
            choose(backup)
        expect(page.locator("#restore-file")).to_have_value("")
        assert saved()["wallet"] == 14000 and saved()["stash"] == bought["stash"]
        # Reopen the native picker with the same physical path and modification time.
        choose(backup)
        expect(page.locator(".content")).to_contain_text("백업을 복원했습니다.")
        assert len(confirmations) == 2 and confirmations[0] == confirmations[1]
        restored = saved()
        assert restored["wallet"] == original["wallet"] and restored["stash"] == original["stash"]
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("key => !!localStorage.getItem(key)", arg=KEY)
        restored = saved()
        assert restored["wallet"] == original["wallet"] and restored["cash"] == original["cash"]
        assert restored["stash"] == original["stash"] and restored["stashSlots"] == original["stashSlots"]
        print(f"PASS {width}px: canceled native restore retained the 16,000 CR purchase; reselecting the same backup restored money and inventory after reload.",flush=True)


if __name__ == "__main__":
    options = {"executable_path": os.getenv("RUSTLINE_CHROMIUM")}
    if os.getenv("RUSTLINE_PROXY"):
        options["proxy"] = {"server": os.environ["RUSTLINE_PROXY"]}
    with sync_playwright() as pw, pw.chromium.launch(**options) as browser:
        for width in (390, 1280):
            play(browser, width)
