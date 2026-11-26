"""Use a restored operator to inspect three hand-in boards, unwear a bare radio and claim it."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_bytes()
PUBLIC = os.getenv("RUSTLINE_URL")
URL = urldefrag(PUBLIC or "https://rustline-delivery.test/").url
KEY = re.search(rb"const SAVE_KEY\s*=\s*['\"]([^'\"]+)", HTML).group(1).decode()
STAMP = datetime.datetime.fromisoformat("2027-02-04T08:00:00+00:00")
QUEST = "repair-bunker-net"


def make_backup():
    seed = json.loads(subprocess.check_output(
        ["node", "-e", "console.log(JSON.stringify(require('./tests/fitted-deliveries.cjs').prepared()))"],
        cwd=ROOT, text=True))
    return {"name":"operator.json", "mimeType":"application/json",
            "buffer":json.dumps({"format":"rustline-tc01", "session":seed}).encode()}


def play(browser, backup, width):
    touch = width < 600
    with browser.new_context(viewport={"width":width,"height":850}, has_touch=touch, is_mobile=touch,
                             reduced_motion="reduce", ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as ctx:
        if not PUBLIC:
            ctx.route(URL+"**",lambda route:route.fulfill(body=HTML,content_type="text/html; charset=utf-8"))
        page=ctx.new_page()
        page.clock.set_fixed_time(STAMP)
        page.set_default_timeout(8000)
        page.on("dialog",lambda dialog:dialog.accept())
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        def click(selector):
            loc=page.locator(selector+":visible").first
            if touch:
                loc.tap()
            else:
                loc.click()
        def saved():
            return page.evaluate("k=>JSON.parse(localStorage.getItem(k))",KEY)
        def visit(fragment):
            if page.url==URL+"#"+fragment:
                page.reload(wait_until="domcontentloaded",timeout=90000)
            else:
                page.goto(URL+"#"+fragment,wait_until="domcontentloaded",timeout=90000)
        def quest_board(trader):
            visit("quests")
            click(f'[data-contract=trader][data-id="{trader}"]')
        def verify_protected(s):
            assert s["stash"]["radio"]==2
            grid=next(u for u in s["stashSlots"] if u["g"]=="radio")
            case=next(u for u in s["stashSlots"] if u["g"]=="rs_case_items")
            for unit,serial,module in ((grid["gear"],"grid","rl_13_02"),
                                       (case["contents"][0]["gear"],"case","battery"),
                                       (s["equipment"]["bag"][0]["gear"],"bag","rl_13_02"),
                                       (s["gearOverflow"][0],"queue","battery")):
                assert (unit["uid"],unit["module"],unit["durability"])==("s-serial-"+serial,module,81)

        response=page.goto(URL+"#quests",wait_until="domcontentloaded",timeout=90000)
        assert response and response.ok and response.body()==HTML
        click(".shell-settings")
        page.locator("#restore-file").set_input_files(backup)
        expect(page.locator(".save-panel [role=status]")).to_contain_text("복원했습니다")
        quest_board("quarter")
        for mode,offer,target in (("daily","daily-quarter-delivery-lamp",1),("weekly","weekly-quarter-delivery-lights",3)):
            click(f'[data-contract=board][data-mode="{mode}"]')
            card=page.locator(f'[data-offer="{offer}"]')
            expect(card.locator("[data-delivery-stock=flash]")).to_contain_text("모듈 장착 1개 제외")
            expect(card.locator(".rc-goals li").first).to_contain_text(f"0 / {target}")
            click(f'[data-contract=periodAccept][data-id="{offer}"]')
            expect(card.locator("[data-contract=periodClaim]")).to_be_disabled()

        quest_board("repair")
        click('[data-contract=board][data-mode=standing]')
        click(f'[data-contract=open][data-id="{QUEST}"]')
        detail=page.locator(".cq-detail")
        info=detail.locator("[data-delivery-stock=radio]")
        expect(info).to_contain_text("모듈 장착 4개 제외")
        expect(info).to_contain_text("착용 중 1개 제외")
        expect(info).to_contain_text("준비 가방 0개")
        expect(detail.locator("[data-contract=claim]")).to_be_disabled()
        click(f'[data-objective=pin][data-id="{QUEST}"]')
        visit("map")
        row=page.locator("[data-objective-material=radio]").first
        expect(row).to_have_attribute("data-owned","5")
        expect(row).to_have_attribute("data-usable","0")
        expect(row).to_contain_text("모듈 장착 4개")
        assert saved()["wallet"]==30000
        click(".nav [data-page=inventory]")
        if touch:
            click('[data-loadout=mobile-tab][data-screen=gear][data-index="0"]')
        click("[data-loadout=slot][data-slot=comms]")
        click("[data-gear=unwear][data-slot=comms]")
        quest_board("repair")
        click(f'[data-contract=open][data-id="{QUEST}"]')
        expect(info).to_contain_text("창고·입고 대기 1개")
        expect(detail.locator("[data-contract=claim]")).to_be_enabled()
        click(f'[data-contract=claim][data-id="{QUEST}"]')
        expect(detail.locator("[role=status]")).to_contain_text("62,000 CR")
        assert saved()["wallet"]==92000 and saved()["career"]["xp"]==205
        verify_protected(saved())
        page.reload(wait_until="domcontentloaded",timeout=90000)
        quest_board("repair")
        click(f'[data-contract=open][data-id="{QUEST}"]')
        expect(detail.locator(".cq-state")).to_have_text("완료")
        expect(detail.locator("[data-contract=claim]")).to_have_count(0)
        expect(detail.locator("[data-delivery-stock]")).to_have_count(0)
        assert saved()["wallet"]==92000 and saved()["career"]["xp"]==205
        verify_protected(saved())
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth") and not errors,errors
        print(f"PASS {width}px: both rotating boards block fitted lamp; 4 assembled radios protected, 1 worn bare radio released and delivered. 62,000 CR/205 XP exactly once across reload.",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("widths",type=int,nargs="*",default=[390,1280])
    args=parser.parse_args()
    backup=make_backup()
    proxy=os.getenv("RUSTLINE_PROXY")
    with sync_playwright() as pw, pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),
                                                     proxy={"server":proxy} if proxy else None) as browser:
        for width in args.widths:
            play(browser,backup,width)
