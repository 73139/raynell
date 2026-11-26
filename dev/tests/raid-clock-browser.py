"""Measure idle status bar mutations in Chromium. An optional baseline runs the same real-time trial."""
import argparse
import json
from datetime import datetime, timezone
import os
import re
from pathlib import Path
from time import monotonic,sleep

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
URL="https://rustline-clock.test/"
def active_key(path):
    match=re.search(rb"const SAVE_KEY='([^']+)'",path.read_bytes())
    if not match:
        raise ValueError(f"Missing active save key in {path}")
    return match[1].decode("ascii")
METRICS=("LayoutCount","RecalcStyleCount","LayoutDuration","RecalcStyleDuration","ScriptDuration","TaskDuration")


def open_game(browser, path, mode, controlled=False):
    key=active_key(path)
    live=os.getenv("RUSTLINE_URL") if path.resolve()==(ROOT/"index.html").resolve() else None
    context=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,reduced_motion="reduce",
                                ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1")
    page=context.new_page()
    if controlled:
        page.clock.install(time=datetime(2025,1,1,tzinfo=timezone.utc))
        page.clock.pause_at(datetime(2025,1,2,tzinfo=timezone.utc))
    body=path.read_bytes()
    if not live:
        page.route(URL+"**",lambda route:route.fulfill(content_type="text/html; charset=utf-8",body=body))
    response=page.goto((live or URL)+("#clinic" if mode=="clinic" else "#map"))
    assert response and response.ok and response.body()==body
    page.wait_for_function("k=>!!localStorage.getItem(k)",arg=key)
    if mode=="raid":
        page.locator('.command-deploy[data-page="prep"]:visible').click()
        start=page.locator('.lo-deploy[data-raid="start"]:visible')
        if not start.count():
            page.locator('[data-loadout="mobile-tab"][data-screen="prep"][data-index="2"]:visible').first.click()
        start.click()
        expect(page.locator("#raid-status")).to_be_visible()
    return context,page


def measure(browser,path,mode,seconds):
    key=active_key(path)
    context,page=open_game(browser,path,mode)
    try:
        before_save=page.evaluate("k=>localStorage.getItem(k)",key)
        page.wait_for_timeout(550)
        page.evaluate("""() => {
          window.statusChanges={visibility:0,clock:0,label:0,zone:0,routeVisibility:0};
          const names={'raid-clock':'clock','raid-label':'label','raid-zone':'zone'};
          const watcher=new MutationObserver(records=>{for(const m of records){
            if(m.attributeName==='hidden'){
              const key=m.target.hasAttribute('data-route-deadline')?'routeVisibility':'visibility';
              window.statusChanges[key]++;
            }
            if(m.type==='childList'&&names[m.target.id]) window.statusChanges[names[m.target.id]]++;
          }});
          watcher.observe(document.getElementById('raid-status'),{attributes:true,attributeFilter:['hidden'],childList:true,subtree:true});
          for(const warning of document.querySelectorAll('[data-route-deadline]'))
            watcher.observe(warning,{attributes:true,attributeFilter:['hidden']});
        }""")
        cdp=context.new_cdp_session(page)
        cdp.send("Performance.enable")
        def metrics():
            return {m["name"]:m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
        a=metrics(); start=monotonic(); sleep(seconds); b=metrics()
        assert page.evaluate("k=>localStorage.getItem(k)",key)==before_save
        return {"seconds":round(monotonic()-start,2),
                "mutations":page.evaluate("window.statusChanges"),
                **{k:round(b[k]-a[k],5) for k in METRICS}}
    finally:
        context.close()


def transitions(browser,path):
    key=active_key(path)
    context,p=open_game(browser,path,"raid",controlled=True)
    try:
        def state():
            return p.evaluate("k=>JSON.parse(localStorage.getItem(k))",key)
        def click(selector):
            p.locator(selector+":visible").first.click()
        def finish():
            action=state()["field"]["action"]
            p.clock.fast_forward(action["end"]-p.evaluate("Date.now()")+250)
        def move(to,name):
            click(f'[data-route-card][data-to="{to}"] [data-field="move"]')
            expect(p.locator("#raid-zone")).to_have_text(name+" 방면")
            finish()
            expect(p.locator("#raid-zone")).to_have_text(name)
        p.evaluate("Math.random=()=>0.1")  # This behavioral scenario follows clear adjacent routes.
        expect(p.locator("#raid-zone")).to_have_text("벙커 외곽")
        click('[data-field="scan"]')
        start=p.locator("#field-seconds").text_content()
        p.clock.run_for(250)
        assert p.locator("#field-seconds").text_content()!=start
        assert 0 < p.locator("#field-progress").evaluate("e=>parseFloat(e.style.width)") < 100
        finish()
        assert len(state()["field"]["found"][0])==1
        move(1,"폐쇄 검문소")
        move(0,"벙커 외곽")
        click('[data-field="extract"][data-exit="b04"]')
        p.clock.run_for(250)
        assert 0 < p.locator("#field-progress").evaluate("e=>parseFloat(e.style.width)") < 100
        finish()
        expect(p.locator("#raid-clock")).to_have_text("CLEAR")
        expect(p.locator("#raid-label")).to_have_text("조기 탈출")
        assert state()["lastSummary"]["rating"]=="quick"
        click('[data-raid="ack"]')
        expect(p.locator("#raid-status")).to_be_hidden()
    finally:
        context.close()
    context,p=open_game(browser,path,"raid",controlled=True)
    try:
        end=p.evaluate("k=>JSON.parse(localStorage.getItem(k)).raid.endsAt",key)
        p.clock.fast_forward(end-300000-p.evaluate("Date.now()"))
        p.clock.run_for(250)
        assert p.locator("#raid-status").evaluate("e=>e.classList.contains('urgent')")
        warning=p.locator('[data-route-deadline]').first
        threshold=int(warning.get_attribute('data-route-deadline'))
        p.clock.fast_forward(threshold-p.evaluate("Date.now()")-300)
        assert warning.evaluate("e=>e.hidden")
        p.clock.run_for(550)
        assert not warning.evaluate("e=>e.hidden")
        p.clock.fast_forward(end-p.evaluate("Date.now()")+250)
        expect(p.locator("#raid-clock")).to_have_text("00:00")
        expect(p.locator("#raid-label")).to_have_text("시간 초과 · 레이드 종료")
        assert p.evaluate("k=>JSON.parse(localStorage.getItem(k)).lastSummary.rating",key)=="expired"
    finally:
        context.close()
    print("PASS 250ms action progress, both directions and arrivals, CLEAR/ack, 5-minute warning and MIA.",flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html",type=Path,default=ROOT/"index.html")
    parser.add_argument("--baseline",type=Path)
    parser.add_argument("--seconds",type=int,default=6)
    args=parser.parse_args()
    if not 3<=args.seconds<=60:
        parser.error("choose 3–60 seconds so the 90-second NPC departure falls outside the idle sample")
    options={"executable_path":os.getenv("RUSTLINE_CHROMIUM")}
    if os.getenv("RUSTLINE_URL") and os.getenv("RUSTLINE_PROXY"):
        options["proxy"]={"server":os.environ["RUSTLINE_PROXY"]}
    with sync_playwright() as pw, pw.chromium.launch(**options) as browser:
        transitions(browser,args.html)
        outputs={}
        for tag,path in (("baseline",args.baseline),("candidate",args.html)):
            if path is None:continue
            outputs[tag]={}
            for mode in ("clinic","raid"):
                trial=measure(browser,path,mode,args.seconds)
                outputs[tag][mode]=trial
                print(json.dumps({"build":tag,"screen":mode,**trial}),flush=True)
        for mode,r in outputs["candidate"].items():
            changes=r["mutations"]
            assert changes["visibility"]==changes["label"]==changes["zone"]==changes["routeVisibility"]==0,changes
            if mode=="raid":assert args.seconds-1<=changes["clock"]<=args.seconds+1,changes
            else:assert changes["clock"]==0,changes
            if args.baseline:
                old=outputs["baseline"][mode]["mutations"]
                assert old["visibility"]>changes["visibility"] or old["clock"]>changes["clock"]


if __name__=="__main__":
    main()
