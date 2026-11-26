"""Exercise earned kitchen recipes with local saves, touch and keyboard. All external requests are blocked."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


HTML = (Path(__file__).resolve().parents[1] / "index.html").as_uri()
KEY = "rl-reboot-session-v36"


def scenario(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={"width": width,"height": 860}, has_touch=mobile, is_mobile=mobile,
                             offline=True, service_workers="block", reduced_motion="reduce") as context:
        errors = []
        def block(route):
            errors.append(route.request.url)
            route.abort()
        context.route("http**://**/*", block)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        page.clock.install()
        page.set_default_timeout(7000)
        page.goto(HTML + "#stash")

        def saved():
            return page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)
        def activate(selector):
            control = page.locator(selector + ":visible").first
            if mobile:
                control.tap()
            else:
                control.focus()
                control.press("Enter")
        def kitchen():
            page.goto(HTML + "#bunker")
            activate('[data-bui=facility][data-id=kitchen]')
        def restore(state):
            page.goto(HTML + "#stash")
            activate(".shell-settings")
            page.locator("#restore-file").set_input_files({
                "name": "survey-kitchen-fixture.json", "mimeType": "application/json",
                "buffer": json.dumps({"format": "rustline-tc01", "session": state}).encode(),
            })
            expect(page.locator(".save-panel [role=status]")).to_contain_text("복원했습니다")

        base = saved()
        base["hideout"]["levels"].update(power=1, kitchen=1, water=1)
        base["career"]["done"] = ["scout"]
        restore(base)
        kitchen()
        assert not page.locator('[data-production-recipe="salt-drink"]').count()
        base["career"]["done"].append("ration-survey")
        restore(base)
        kitchen()
        porridge = '[data-production-recipe="oat-porridge"]'
        drink = '[data-production-recipe="salt-drink"]'
        source = porridge + ' [data-craft-input="rl_09_16"]'
        expect(page.locator(porridge + ' [data-hideout=produce]')).to_be_disabled()
        activate(source)
        expect(page.locator('#db-detail h2')).to_have_text("오트밀")
        activate('[data-db=craft-return]')
        expect(page.locator(source)).to_be_focused()

        base["stash"].update(water=2, salt=1, rl_09_16=1)
        restore(base)
        kitchen()
        for panel, product, name in [(drink, "rl_10_16", "식염 음료"), (porridge, "rl_09_10", "즉석 죽")]:
            wallet = saved()["wallet"]
            control = panel + ' [data-hideout=produce]'
            expect(page.locator(control)).to_be_enabled()
            expect(page.locator(panel)).to_contain_text(name + " ×2")
            activate(control)
            session = saved()
            job = session["hideout"]["production"]["kitchen"]
            assert job["recipe"] == ("salt-drink" if panel == drink else "oat-porridge")
            expect(page.locator(control)).to_be_disabled()
            expect(page.locator((porridge if panel == drink else drink) + ' [data-hideout=produce]')).to_be_disabled()
            page.reload()
            assert saved()["hideout"]["production"]["kitchen"] == job
            assert not saved()["stash"].get(product)
            page.clock.fast_forward(max(1000,job["end"] - page.evaluate("Date.now()") + 1500))
            page.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).hideout.production.kitchen',arg=KEY)
            assert saved()["stash"][product] == 2 and saved()["wallet"] == wallet
            page.reload()
            kitchen()
            assert saved()["stash"][product] == 2
        assert saved()["stash"].get("water", 0) == 0 and not errors, errors
        print(f"PASS {width}px {'touch' if mobile else 'keyboard'}: fixture-based unlock gate, recipe lookup/return, "
              "two timed jobs, reload mid-job and after payout, two portions each; no external requests.",flush=True)


if __name__ == "__main__":
    with sync_playwright() as pw, pw.chromium.launch(executable_path=os.environ.get("RUSTLINE_CHROMIUM")) as browser:
        for viewport in (390, 1280):
            scenario(browser, viewport)
