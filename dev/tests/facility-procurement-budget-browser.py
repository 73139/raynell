"""Use real facility pins, merchant tills, and construction controls at mobile and desktop widths."""
import json
import os
from pathlib import Path
import runpy

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / "tests" / "objective-cart-browser.py"))
at, shared, merchant = helpers["at"], helpers["shared"], helpers["merchant"]
control, add = helpers["control"], helpers["helpers"]["add"]


def facility(p, room):
    at(p, "clinic")
    if room != "med":
        p.locator(f'.bu-room-strip [data-bui="facility"][data-id="{room}"]').first.click()
    pin = p.locator(f'[data-objective="pin"][data-kind="facility"][data-id="{room}"][data-tier="1"]')
    if pin.count():
        pin.click()


def expanded(p):
    toggle = control(p, "toggle")
    if toggle.get_attribute("aria-expanded") != "true":
        toggle.click()
    return p.locator("[data-facility-budget]")


def numbers(p, amounts, balance):
    panel = expanded(p)
    expect(panel).to_have_attribute("data-facility-budget", "complete")
    for key, n in zip(("materials", "build", "total", "wallet"), amounts):
        expect(panel.locator(f"[data-budget-{key}]")).to_have_text(f"{n:,} CR")
    expect(panel.locator("[data-budget-balance]")).to_contain_text(balance)
    expect(panel).to_contain_text("전체 상인")
    assert panel.evaluate("e => e.scrollWidth <= e.clientWidth+1")
    return panel


def play(browser, width):
    with browser.new_context(viewport={"width":width, "height":844}, reduced_motion="reduce",
                             is_mobile=width==390, has_touch=width==390,
                             ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as ctx:
        p = ctx.new_page()
        p.set_default_timeout(9000)
        errors=[]
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.on("dialog", lambda d: d.accept())
        facility(p, "power")
        before=shared["snapshot"](p)
        control(p, "review").click()
        numbers(p,(56000,20000,76000,30000),"46,000 CR 부족")
        assert shared["snapshot"](p)==before

        at(p,"shop")
        merchant(p,"repair")
        add(p,"wire",3)
        add(p,"tape")
        panel=numbers(p,(56000,20000,76000,30000),"46,000 CR 부족")
        expect(panel).to_contain_text("10,000 CR 포함")
        cart=p.locator("[data-cart-total]:visible").first
        expect(cart).not_to_have_text("10,000 CR")
        for item, amounts, included in [("bolt",(51500,20000,71500,25500),10000),
                                        ("wire",(46500,20000,66500,20500),5000)]:
            p.locator(f'[data-market="item"][data-id="{item}"]:visible').click()
            p.locator(f'[data-market="trade"][data-id="{item}"][data-qty="1"]:visible').click()
            p.locator('[data-market="continue"]:visible').click()
            panel=numbers(p,amounts,"46,000 CR 부족")
            expect(panel).to_contain_text(f"{included:,} CR 포함")
        assert shared["snapshot"](p)["stash"]["wire"]==1
        at(p,"map")
        numbers(p,(46500,20000,66500,20500),"46,000 CR 부족")

        facility(p,"med")
        control(p,"review").click()
        partial=expanded(p)
        expect(partial).to_have_attribute("data-facility-budget","partial")
        expect(partial.locator("[data-budget-materials]")).to_have_text("21,500 CR")
        expect(partial.locator("[data-budget-unavailable]")).to_contain_text("1개")
        expect(partial.locator("[data-budget-total], [data-budget-balance]")).to_have_count(0)

        # Native v28 save migrates its scalar wallet; exactly fund one construction without changing its materials.
        old=json.loads((ROOT/"tests/fixtures/trade-grid-v28.json").read_text())
        old["session"]["wallet"]=76000
        shared["import_profile"](p,old)
        facility(p,"power")
        control(p,"review").click()
        numbers(p,(56000,20000,76000,76000),"잔액 0 CR")
        control(p,"add","repair").click()
        numbers(p,(56000,20000,76000,76000),"잔액 0 CR")
        control(p,"cart","repair").click()
        p.locator('[data-cart="checkout"]:visible').click()
        assert shared["snapshot"](p)["wallet"] == 20000
        at(p,"map")
        numbers(p,(0,20000,20000,20000),"잔액 0 CR")
        facility(p,"power")
        p.locator('[data-hideout="build"][data-id="power"][data-tier="1"]:visible').click()
        final=shared["snapshot"](p)
        assert final["wallet"]==0 and final["hideout"]["builds"]["power"]["tier"]==1
        at(p,"map")
        expect(p.locator("[data-facility-budget]")).to_have_count(0)
        assert not errors, errors
        print(f"PASS {width}px: new wallet, excess wire and unrelated tape, physical purchases, partial medic shelf, migrated v28 receipt and exact zero-balance construction.",flush=True)


if __name__=="__main__":
    with sync_playwright() as pw:
        proxy={"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as browser:
            for width in (390,1280):
                play(browser,width)
