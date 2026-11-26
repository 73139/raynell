"""Earn medic tier 2 through six normal contracts, then compare read-only navigation to the paid receipt."""
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
PUBLIC = os.getenv("RUSTLINE_URL")
URL = urldefrag(PUBLIC or "https://rustline-standing.test/").url
ITEMS = ("splint", "rl_11_03", "rl_11_04", "saline", "rl_11_09", "rs_case_med")
JOBS = ("medic-clean-tray", "medic-patient-route", "medic-fracture")


def progress(browser, width):
    mobile = width < 600
    with browser.new_context(viewport={"width":width, "height":844}, has_touch=mobile,
                             is_mobile=mobile, reduced_motion="reduce",
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS") == "1") as context:
        if not PUBLIC:
            context.route(URL+"**", lambda r: r.fulfill(body=HTML, content_type="text/html; charset=utf-8"))
        page = context.new_page()
        page.set_default_timeout(7000)
        page.set_default_navigation_timeout(90000)
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.clock.install()
        response = page.goto(URL+"#shop", wait_until="domcontentloaded")
        assert response and response.ok and response.body() == HTML

        def click(selector):
            button = page.locator(selector+":visible").first
            if mobile:
                button.tap()
            else:
                button.click()

        def visit(fragment):
            if page.url == URL+"#"+fragment:
                page.reload(wait_until="domcontentloaded")
            else:
                page.goto(URL+"#"+fragment,wait_until="domcontentloaded")

        def saved():
            return page.evaluate("JSON.parse(localStorage.getItem('rl-reboot-session-v36'))")

        def economy():
            s = saved()
            return [s[k] for k in ("wallet","cash","stash","stashSlots","saleReceipts","marketCarts","contracts")]

        def medic_board():
            visit("quests")
            click('[data-contract="trader"][data-id="medic"]')

        def pick_job(id):
            click(f'.cq-row[data-contract="open"][data-id="{id}"]')

        def raid(zone, landmark=None, box=None):
            visit("map")
            click(f'.command-station[data-index="{zone}"]')
            click('.command-deploy[data-page="prep"]')
            page.evaluate("Math.random=()=>.01")  # Natural empty box roll and clear return road.
            click('.lo-deploy[data-raid="start"]')
            if landmark is not None:
                click('.landmark-header summary')
                click(f'[data-field="landmark"][data-index="{landmark}"]')
                while not page.locator(f'[data-field="open"][data-index="{box}"]:visible').count():
                    click('[data-field="scan"]')
                    page.clock.fast_forward(10000)
                click(f'[data-field="open"][data-index="{box}"]')
                tab='[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]'
                if page.locator(tab+":visible").count():
                    click(tab)
                click('.lo-search[data-field="search"]')
                click('[data-field="close"]')
            if zone:
                click(f'[data-route-card][data-from="{zone}"][data-to="0"] [data-field="move"]')
                page.clock.fast_forward(15000)
            click('[data-field="extract"][data-exit="b04"]')
            page.clock.fast_forward(12000)
            click('[data-raid="ack"]')

        # Real stock, real basket checkout and persisted purchase receipt.
        click('[data-market="trader"][data-id="medic"]')
        for item in ("bandage", "gauze", "soap"):
            click(f'[data-market="item"][data-id="{item}"]')
            click('[data-cart="add"]')
        click('[data-cart="checkout"]')
        assert saved()["marketCarts"]["traders"]["medic"]["receipt"]
        medic_board()
        def hidden():
            expect(page.locator('[data-contract="tier"][data-tier="2"]')).to_have_count(0)
            expect(page.locator('[data-standing-unlocks]')).to_have_count(0)
            expect(page.locator(".cq-screen")).not_to_contain_text("처치대 다시 차리기")
            expect(page.locator(".cq-screen")).not_to_contain_text("수술용 마스크")
        hidden()
        # Three deliveries and three separately accepted, played and settled field contracts.
        jobs = (("medic-wash-basin",None), ("medic-one-roll",None), ("medic-gauze-tin",None),
                ("medic-field-clinic",(0,7,14)), ("medic-ward-round",(0,)), ("medic-tent-survey",(1,1,6)))
        for position,(job,site) in enumerate(jobs):
            if position == 5:
                hidden()
                expect(page.locator(".cq-standing")).to_contain_text("50점")
            pick_job(job)
            click(f'[data-contract="accept"][data-id="{job}"]')
            if site is not None:
                raid(*site)
                medic_board()
                pick_job(job)
            click(f'[data-contract="claim"][data-id="{job}"]')
            assert len(saved()["contracts"]["medic"]["done"]) == position+1

        listed = page.locator('[data-standing-unlocks="2"]')
        expect(page.locator(".cq-standing")).to_contain_text("60점")
        expect(page.locator(".cq-feedback")).to_contain_text("새 의뢰 3건과 상점 상품 6종")
        expect(listed.locator('[data-contract="unlock-item"]')).to_have_count(6)
        for item in ITEMS:
            expect(listed.locator(f'[data-trader="medic"][data-id="{item}"]')).to_be_visible()
        for job in JOBS:
            expect(page.locator(f'.cq-row[data-contract="open"][data-id="{job}"]')).to_be_visible()
        expect(page.locator('[data-contract="tier"][data-tier="3"]')).to_have_count(0)
        settled = economy()
        # A last-position new item exercises the shop's correct selection on a wider shelf.
        click('[data-contract="unlock-item"][data-id="rs_case_med"]')
        expect(page.locator('[data-market="trader"][data-id="medic"]')).to_have_attribute("aria-pressed","true")
        expect(page.locator('[data-market="item"][data-id="rs_case_med"]')).to_have_attribute("aria-pressed","true")
        expect(page.locator('[data-market="trade"][data-mode="buy"][data-id="rs_case_med"]')).to_be_visible()
        assert economy() == settled
        click('[data-market="unlocks"][data-trader="medic"]')
        expect(listed).to_be_visible()
        pick_job("medic-clean-tray")
        expect(page.locator(".cq-detail")).to_contain_text("처치대 다시 차리기")
        assert economy() == settled
        click('[data-contract="board"][data-mode="weekly"]')
        expect(listed).to_have_count(0)
        visit("shop")
        click('[data-market="trader"][data-id="medic"]')
        click('[data-market="unlocks"][data-trader="medic"]')
        expect(page.locator('[data-contract="board"][data-mode="standing"]')).to_have_attribute("aria-pressed","true")
        expect(listed).to_be_visible()
        assert economy() == settled
        page.reload(wait_until="domcontentloaded")
        medic_board()
        expect(listed).to_be_visible()
        assert economy() == settled
        click('[data-contract="trader"][data-id="supply"]')
        expect(listed).to_have_count(0)
        assert len(saved()["contracts"]["supply"]["done"]) == 0
        # Import a real historical backup to ensure a lower rank revokes the shelf through normal UI.
        click(".shell-settings")
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#restore-file").set_input_files(ROOT/"tests/fixtures/possessions-v17.json")
        expect(page.locator('.save-panel [role="status"]')).to_contain_text("복원했습니다")
        page.reload(wait_until="domcontentloaded")
        medic_board()
        hidden()
        assert not errors, errors
        print(f"PASS {width}px: six paid medic contracts, 50→60, 6 goods / 3 jobs; exact item "
              "and merchant, stable wallet/receipt/inventory, return from weekly, reload and v17 restore.", flush=True)


if __name__ == "__main__":
    with sync_playwright() as p:
        proxy = {"server":os.getenv("RUSTLINE_PROXY")} if os.getenv("RUSTLINE_PROXY") else None
        with p.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as chromium:
            for width in (390,1280):
                progress(chromium,width)
