"""Exercise first-write retry, native backups and mixed-release tab handoff at one origin.

Supply both original published HTML files through RUSTLINE_LEGACY54_HTML and
RUSTLINE_LEGACY55_HTML to include both real historical writers in the tab test.
All profiles are disposable. The optional RUSTLINE_URL serves the current build.
"""
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urldefrag

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
DOC = (ROOT / "index.html").read_bytes()
FIXTURE = json.loads((ROOT/"tests/fixtures/pump-gauge-v55.json").read_text())
OLD_KEY = "rl-reboot-session-v34"
KEY = "rl-reboot-session-v35"
LIVE = os.getenv("RUSTLINE_URL")
BASE = urldefrag(LIVE or "https://rustline-save-handoff.test/").url
CLOCK = datetime.fromtimestamp((FIXTURE["session"]["field"]["pumpGauge"]["readAt"]+1000)/1000, timezone.utc)


def raw(p, key):
    return p.evaluate("k=>localStorage.getItem(k)",key)


def click(p, selector):
    p.locator(selector+":visible").first.click()


def state(p, key=KEY):
    return json.loads(raw(p,key))


def content(s):
    return {k:v for k,v in s.items() if k not in ("version","revision")}


def writer(p, expected):
    p.wait_for_function("flag=>document.documentElement.classList.contains('read-only')!==flag",arg=expected)


def visit(ctx, client, fragment):
    p=ctx.new_page()
    p.clock.install(time=CLOCK)
    p.set_default_timeout(8000)
    p.set_default_navigation_timeout(90000)
    p.on("dialog",lambda dialog:dialog.accept())
    join="&" if "?" in BASE else "?"
    r=p.goto(BASE+join+"save-test="+client+"#"+fragment,wait_until="domcontentloaded")
    assert r and r.ok
    if client=="current":
        assert r.body()==DOC, "Current public bytes differ from the release under test"
    else:
        assert ("v0."+client+"</title>").encode() in r.body()
    return p


def open_context(browser, legacy):
    c=browser.new_context(viewport={"width":1000,"height":800},reduced_motion="reduce",
                          ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1")
    def serve(route):
        client=parse_qs(urlparse(route.request.url).query).get("save-test",["current"])[0]
        if client in legacy:
            route.fulfill(body=legacy[client],content_type="text/html; charset=utf-8")
        elif LIVE:
            route.continue_()
        else:
            route.fulfill(body=DOC,content_type="text/html; charset=utf-8")
    c.route(re.compile(r"[?&]save-test="),serve)
    return c


def import_file(p, data):
    click(p,".shell-settings")
    p.locator("#restore-file").set_input_files({"name":"player.json","mimeType":"application/json",
                                               "buffer":json.dumps(data,ensure_ascii=False).encode()})
    expect(p.locator('.save-panel [role="status"]')).to_contain_text("복원했습니다")


def suite(browser, legacy):
    with open_context(browser,legacy) as ctx:
        # A one-page disk fault during the very first migration, untouched legacy bytes, and native reload retry.
        seed=json.dumps(FIXTURE["session"],ensure_ascii=False,separators=(",",":"))
        ctx.add_init_script("""(seed=>{if(localStorage.getItem('rl-reboot-session-v34')===null)
            localStorage.setItem('rl-reboot-session-v34',seed);
            if(sessionStorage.getItem('retry')===null){sessionStorage.setItem('retry','1');
              const set=Storage.prototype.setItem;
              Storage.prototype.setItem=function(k,v){if(k==='rl-reboot-session-v35')throw new DOMException('test','QuotaExceededError');
                return set.call(this,k,v)}}})(%s)"""%json.dumps(seed))
        p=visit(ctx,"current","map");writer(p,True)
        assert raw(p,KEY) is None and raw(p,OLD_KEY)==seed
        p.reload();writer(p,True)
        assert state(p)["version"]==35 and content(state(p))==content(FIXTURE["session"])
        assert raw(p,OLD_KEY)==seed
        print("PASS real v0.55 export remained intact after denied first write; reload migrated the complete checkpoint.",flush=True)

    with open_context(browser,legacy) as ctx:
        if legacy:
            old=visit(ctx,"55","map");writer(old,True);import_file(old,FIXTURE)
            before=raw(old,OLD_KEY)
            p=visit(ctx,"current","map");writer(p,False)
            assert raw(p,KEY) is None
            old.close();writer(p,True)
            assert raw(p,OLD_KEY)==before
        else:
            ctx.add_init_script("if(localStorage.getItem(%s)===null)localStorage.setItem(%s,%s)"%
                                (json.dumps(OLD_KEY),json.dumps(OLD_KEY),json.dumps(json.dumps(FIXTURE["session"]))))
            p=visit(ctx,"current","map");writer(p,True)
        assert content(state(p))==content(FIXTURE["session"])
        for previous in legacy:
            # Lock holder updates the new timeline. The old timeline is never rewritten by the new client.
            previous_bytes=raw(p,OLD_KEY)
            click(p,'.command-station[data-index="0"]');click(p,'.command-deploy[data-page="raid"]')
            click(p,".landmark-picker summary");click(p,'[data-field="landmark"][data-index="0"]')
            assert raw(p,OLD_KEY)==previous_bytes
            current_bytes=raw(p,KEY)
            old=visit(ctx,previous,"map");writer(old,False);old.bring_to_front()
            click(old,'.command-station[data-index="1"]')
            assert raw(old,KEY)==current_bytes and raw(old,OLD_KEY)==previous_bytes
            p.close();writer(old,True)
            assert raw(old,KEY)==current_bytes
            click(old,'.command-station[data-index="0"]');click(old,'.command-deploy[data-page="raid"]')
            click(old,".landmark-picker summary");click(old,'[data-field="landmark"][data-index="1"]')
            assert state(old,OLD_KEY)["field"]["landmarkByZone"][0]==1
            assert raw(old,KEY)==current_bytes
            legacy_after=raw(old,OLD_KEY)
            p=visit(ctx,"current","map");writer(p,False)
            expect(p.locator('[data-objective-panel="map"]')).to_contain_text("빗물 펌프장 수위 판독")
            assert raw(p,KEY)==current_bytes
            old.close();writer(p,True)
            assert raw(p,OLD_KEY)==legacy_after
            assert content(state(p))==content(json.loads(current_bytes))
            assert state(p)["field"]["pumpGauge"]==FIXTURE["session"]["field"]["pumpGauge"]
            print("PASS authentic v0."+previous+" reader, writer handoff, normal field action and current writer reacquisition; separate saves remain independent.",flush=True)

        newer=visit(ctx,"current","map");writer(newer,False)
        click(p,'.command-station[data-index="0"]');click(p,'.command-deploy[data-page="raid"]')
        click(p,".landmark-picker summary");click(p,'[data-field="landmark"][data-index="6"]')
        expect(p.locator('[data-pump-gauge="recorded"]')).to_be_visible()
        winner=state(p);p.close();writer(newer,True)
        assert content(state(newer))==content(winner)
        click(newer,".shell-settings")
        with newer.expect_download() as ev:click(newer,'[data-backup="export"]')
        assert ev.value.suggested_filename=="Rustline_save_v35.json"
        exported=json.loads(Path(ev.value.path()).read_text());assert exported["session"]["version"]==35
    with open_context(browser,legacy) as restored:
        p=visit(restored,"current","map");writer(p,True);import_file(p,exported)
        assert content(state(p))==content(exported["session"])
        print("PASS same-generation lock handoff and native v35 backup round-trip retained the recorded gauge, current raid, receipts, cash and pending production.",flush=True)


if __name__=="__main__":
    names={n:os.getenv("RUSTLINE_LEGACY"+n+"_HTML") for n in ("54","55")}
    assert bool(names["54"])==bool(names["55"]),"Supply both published clients for mixed-generation testing."
    legacy={n:Path(path).read_bytes() for n,path in names.items() if path}
    with sync_playwright() as w:
        proxy={"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with w.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as browser:suite(browser,legacy)
