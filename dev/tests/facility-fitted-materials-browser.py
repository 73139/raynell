"""Verify the construction bill and the exact flashlight kept by an isolated player."""
import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-facility-materials.test/").url
KEY = re.search(rb"const SAVE_KEY\s*=\s*['\"]([^'\"]+)", HTML).group(1).decode()


def lamp(tile, serial, x, module=None):
    return {"uid":tile, "g":"flash", "x":x, "y":0, "w":1, "h":2,
            "gear":{"uid":serial, "g":"flash", "ammo":0, "durability":87 if module else 100, "module":module}}


def play(browser, width):
    mobile = width < 600
    with browser.new_context(viewport={"width":width,"height":850}, has_touch=mobile, is_mobile=mobile,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as context:
        if not LIVE:
            context.route(URL+"**",lambda route:route.fulfill(body=HTML,content_type="text/html; charset=utf-8"))
        page=context.new_page()
        errors=[]
        page.on("dialog",lambda d:d.accept())
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.set_default_timeout(7500)

        def click(selector):
            button=page.locator(selector+":visible").first
            if mobile:
                button.tap()
            else:
                button.click()

        def saved():
            return page.evaluate("key=>JSON.parse(localStorage.getItem(key))",KEY)

        def light():
            click(".nav [data-page=bunker]")
            click(".bu-facility-tile[data-id=light]")

        def budget():
            click(".nav [data-page=map]")
            toggle=page.locator("[data-procurement=objective] [data-objective=procurement-toggle]")
            if toggle.get_attribute("aria-expanded")!="true":
                click("[data-procurement=objective] [data-objective=procurement-toggle]")
            return page.locator("[data-facility-budget]")

        response=page.goto(URL+"#map",wait_until="domcontentloaded",timeout=90000)
        assert response and response.ok and response.body()==HTML
        page.wait_for_function("k=>!!localStorage.getItem(k)",arg=KEY)
        seed=saved()
        seed["hideout"]["levels"]["power"]=1
        seed["stash"]={"flash":2,"wire":2,"rl_03_25":2}
        protected=lamp("s-fitted-lamp","s-module-lamp",1,"battery")
        seed["stashSlots"]=[lamp("s-first-lamp","s-first-lamp-serial",0),protected]
        seed["equipment"]["bag"]=[{**lamp("kit-spare-lamp","s-spare-lamp-serial",0), "revealed":True}]
        click(".shell-settings")
        page.locator("#restore-file").set_input_files({"name":"facility-lamps.json","mimeType":"application/json",
                                                       "buffer":json.dumps({"format":"rustline-tc01","session":seed}).encode()})
        expect(page.locator(".save-panel [role=status]")).to_contain_text("복원했습니다")
        light()
        material=page.locator(".bu-materials [data-id=flash]")
        expect(material).to_contain_text("1 / 2")
        expect(material).to_contain_text("모듈 장착 1개 제외")
        expect(page.locator("[data-hideout=build]")).to_be_disabled()
        click("[data-objective=pin][data-id=light]")
        bill=budget()
        obj=page.locator("[data-objective-material=flash]")
        expect(obj).to_have_attribute("data-owned","3")
        expect(obj).to_have_attribute("data-usable","1")
        expect(obj).to_have_attribute("data-missing","1")
        expect(bill.locator("[data-budget-unavailable]")).to_contain_text("휴대용 조명 1개")
        assert saved()["wallet"]==30000 and not saved()["hideout"]["builds"]
        click(".nav [data-page=inventory]")
        if mobile:
            click('[data-loadout=mobile-tab][data-screen=gear][data-index="1"]')
        click("[data-gear=select][data-unit=kit-spare-lamp]")
        click("[data-gear=unpack]")
        light()
        expect(material).to_contain_text("2 / 2")
        expect(material).to_contain_text("모듈 장착 1개 제외")
        bill=budget()
        expect(obj).to_have_attribute("data-missing","0")
        expect(bill.locator("[data-budget-materials]")).to_have_text("0 CR")
        expect(bill.locator("[data-budget-total]")).to_have_text("20,000 CR")
        light()
        click("[data-hideout=build]")
        after=saved()
        assert after["wallet"]==10000 and after["hideout"]["builds"]["light"]["tier"]==1
        assert after["stash"]["flash"]==1 and [u for u in after["stashSlots"] if u["g"]=="flash"]==[protected]
        page.reload(wait_until="domcontentloaded",timeout=90000)
        fresh=saved()
        assert fresh["wallet"]==10000 and fresh["hideout"]["builds"]==after["hideout"]["builds"]
        assert [u for u in fresh["stashSlots"] if u["g"]=="flash"]==[protected] and not errors,errors
        print(f"PASS {width}px: displayed 1/2 then 2/2 after moving bare lamp. Budget 20,000 CR; exact fitted lamp and battery survive build and reload.")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("widths",type=int,nargs="*",default=[390,1280])
    options=parser.parse_args()
    proxy=os.getenv("RUSTLINE_PROXY")
    with sync_playwright() as pw, pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),
                                                     proxy={"server":proxy} if proxy else None) as browser:
        for width in options.widths:
            play(browser,width)
