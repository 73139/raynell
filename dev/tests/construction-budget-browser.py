"""Open facility plans and their item dossier by touch or keyboard. Inspect only actual saved game state."""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
URL = "https://rustline-build-plan.test/"


def scenario(browser, width):
    mobile = width == 390
    with browser.new_context(viewport={"width": width, "height": 844}, is_mobile=mobile, has_touch=mobile,
                             reduced_motion="reduce") as ctx:
        ctx.route(URL + "**", lambda r: r.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        p = ctx.new_page()
        p.set_default_timeout(7000)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.clock.install()
        p.goto(URL + "#clinic")

        def act(locator):
            expect(locator).to_be_visible()
            if mobile:
                locator.tap()
            else:
                locator.focus()
                locator.press("Enter")

        def saved():
            return p.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        def economy():
            s = saved()
            return {k: s[k] for k in ("wallet", "cash", "stash", "stashSlots", "equipment", "hideout",
                                         "marketCarts", "objectivePin", "career", "raid")}

        def validate_amounts(quote, build, mat, total, funds):
            for key, number in (("build", build), ("materials", mat), ("total", total), ("wallet", funds)):
                expect(quote.locator(f"[data-plan-{key}]")).to_have_text(f"{number:,} CR")
            expect(quote.locator("[data-plan-quote]")).to_have_attribute("data-plan-quote", "complete")
            assert quote.evaluate("e => e.scrollWidth <= e.clientWidth + 1")

        def unfold():
            panel = p.locator("[data-build-plan]")
            if not panel.evaluate("e => e.open"):
                act(panel.locator("summary"))
            expect(panel.locator("[data-plan-quote]")).to_be_visible()
            return panel

        # Preserve a real pinned objective throughout review of a different facility.
        act(p.locator('[data-objective="pin"][data-kind="facility"][data-id="med"]'))
        clinic = unfold()
        expect(clinic.locator("[data-plan-quote]")).to_have_attribute("data-plan-quote", "partial")
        expect(clinic.locator("[data-plan-known]")).to_have_text("187,500 CR")
        expect(clinic.locator("[data-plan-total]")).to_have_count(0)
        for item, trader in (("filter", "임도현"), ("medkit", "윤서진")):
            expect(clinic.locator(f'[data-plan-item="{item}"]')).to_contain_text(trader)
        act(p.locator('.bu-room-strip [data-bui="facility"][data-id="stash"]'))
        act(p.locator('[data-bui="tier"][data-tier="3"]'))
        before = economy()
        plan = unfold()
        assert economy() == before
        validate_amounts(plan, 265000, 279200, 544200, 30000)
        expect(plan.locator("[data-plan-balance]")).to_have_text("지갑에서 514,200 CR 부족")
        expect(plan.locator("[data-plan-phase]")).to_have_text([
            "자재 구매비 86,400 CR · 단계 합계 106,400 CR",
            "자재 구매비 106,400 CR · 단계 합계 171,400 CR",
            "자재 구매비 86,400 CR · 단계 합계 266,400 CR"])
        expect(plan.locator("[data-plan-item]")).to_have_count(9)
        item = 'rl_07_03'
        link = p.locator(f'[data-db="plan-material"][data-id="{item}"]')
        assert link.bounding_box()["height"] >= 44
        act(link)
        back = p.locator('[data-db="plan-return"]')
        expect(back).to_be_focused()
        expect(p.locator("#db-detail .mono")).to_have_text(item)
        assert economy() == before
        act(back)
        expect(link).to_be_focused()
        assert economy() == before and plan.evaluate("el=>el.open")
        validate_amounts(plan, 265000, 279200, 544200, 30000)

        # A distinct, explicit purchase changes both sides by the same amount on return.
        act(link)
        act(p.locator(f'[data-supply="{item}"]'))
        act(back)
        expect(link).to_be_focused()
        validate_amounts(plan, 265000, 274400, 539400, 25200)
        expect(plan.locator("[data-plan-balance]")).to_have_text("지갑에서 514,200 CR 부족")
        expect(plan.locator(f'[data-plan-item="{item}"]')).to_contain_text("필요 3 · 창고 사용 1 · 부족 2")
        assert economy()["objectivePin"] == before["objectivePin"]
        assert economy()["marketCarts"] == before["marketCarts"]
        assert saved()["stash"][item] == 1
        p.reload()
        p.goto(URL + "#clinic")
        act(p.locator('.bu-room-strip [data-bui="facility"][data-id="stash"]'))
        act(p.locator('[data-bui="tier"][data-tier="3"]'))
        validate_amounts(unfold(), 265000, 274400, 539400, 25200)
        assert not errors, errors
        print(f"PASS {width}px: 54.42만 CR, exact 3 stages; partial clinic, item dossier focus/return, "
              "single 4,800 CR voluntary purchase; pin, cart and budget unchanged until payment.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as w:
        with w.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM")) as browser:
            for width in (390, 1280):
                scenario(browser, width)
