"""Play a forecast-led expedition. --natural uses unmodified Chromium time and game randomness."""
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT/"index.html").read_bytes()
LIVE = os.getenv("RUSTLINE_URL")
URL = urldefrag(LIVE or "https://rustline-visibility.test/").url
ORDER = "weather-survey"
STATIONS = [9, 6, 1]
NAMES = ["경계 울타리", "대기 차량 행렬", "하역 도크"]

def play(browser, width, natural):
    touch = width < 600
    with browser.new_context(viewport={"width":width,"height":860}, is_mobile=touch, has_touch=touch,
                             reduced_motion="reduce",ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as c:
        if not LIVE:
            c.route(URL+"**",lambda r:r.fulfill(body=HTML,content_type="text/html; charset=utf-8"))
        p=c.new_page()
        p.set_default_timeout(8000)
        p.set_default_navigation_timeout(90000)
        errors=[]
        p.on("pageerror",lambda error:errors.append(str(error)))
        p.on("dialog",lambda dialog:dialog.accept())
        begin=time.monotonic()
        if not natural:
            p.clock.install(time=datetime.fromtimestamp(1800000001,tz=timezone.utc))
            p.add_init_script('Math.random=()=>0.20')

        def click(css):
            button=p.locator(css+":visible").first
            button.tap() if touch else button.click()

        def saved():
            return p.evaluate("""Object.keys(localStorage).filter(k=>k.startsWith('rl-reboot-session-'))
              .map(k=>JSON.parse(localStorage.getItem(k))).filter(s=>s && Array.isArray(s.stashSlots) && s.career)
              .sort((a,b)=>b.version-a.version||b.revision-a.revision)[0]""")

        def advance(ms):
            if natural:time.sleep(max(.08,min(.45,ms/1000)))
            else:p.clock.fast_forward(int(max(50,ms)))

        def finish():
            for _ in range(780):
                state=saved()
                f=state["field"]
                if f.get("result"):return
                if f.get("action"):
                    now=p.evaluate("Date.now()")
                    advance(max(100,f["action"]["end"]-now+120))
                elif f.get("contact"):
                    click('[data-field="evade"]')
                elif f.get("journey",{} ) and f["journey"].get("event")=="supply":
                    click('[data-field="journey-pass"]')
                else:return
            raise AssertionError("Field action or route did not finish")

        def visit(point):
            click(".landmark-picker summary")
            click(f'[data-field="landmark"][data-index="{point}"]')

        def travel(zone):
            origin=saved()["raid"]["zone"]
            if origin!=zone:
                click(f'[data-route-card][data-from="{origin}"][data-to="{zone}"] [data-field="move"]')
                finish()
            assert saved()["raid"]["zone"]==zone

        def visible_forecasts():
            cards=p.locator('[data-weather-board] [data-weather-zone]')
            assert cards.count()==3
            zones={}
            for card in cards.all():
                z=int(card.get_attribute("data-weather-zone"))
                expect(card.locator("[data-survey-site]")).to_contain_text(NAMES[z])
                zones[card.get_attribute("data-condition")]=z
            return zones

        def search_two():
            visit(0)
            for index in (0,1):
                click('[data-field="scan"]');finish()
                click(f'[data-field="open"][data-index="{index}"]')
                tab='[data-loadout="mobile-tab"][data-screen="loot"][data-index="2"]'
                if p.locator(tab+":visible").count():click(tab)
                click('.lo-search[data-field="search"]');finish()
                assert saved()["field"]["boxes"]["0-"+str(index)]["complete"]
                click('[data-field="close"]')

        response=p.goto(URL+"#quests",wait_until="domcontentloaded")
        assert response and response.ok and response.body()==HTML
        click('[data-page="orders"]')
        click(f'[data-bui="order"][data-id="{ORDER}"]')
        expect(p.locator(".bu-order-panel")).to_contain_text("26,000 CR")
        click(f'[data-order="{ORDER}"]')
        click(f'[data-objective="pin"][data-id="{ORDER}"]')
        click('.bu-order-panel [data-cui="forecast"]')
        forecasts=visible_forecasts()
        condition="clear" if width==390 else "fog"
        edge_test=not natural and width==390
        origin=forecasts["rain"] if edge_test else forecasts[condition]
        click(f'[data-weather-board] [data-weather-zone="{origin}"] [data-cui="weather-select"]')
        click('[data-weather-deploy]')
        expect(p.locator('[data-weather-prep]:visible').first).to_contain_text("투입지 예보")
        click('.lo-deploy[data-raid="start"]')
        assert saved()["raid"]["zone"]==origin
        if edge_test:
            visit(STATIONS[origin])
            button=p.locator('[data-field="survey-observe"]')
            expect(button).to_be_disabled()
            expect(p.locator('[data-survey-sight]')).to_contain_text("빗줄기")
            expect(p.locator('[data-survey-status]')).to_contain_text("안개의 영향을")
            ends=int(p.locator('[data-weather-field]').get_attribute('data-next-at'))
            p.clock.fast_forward(ends-p.evaluate("Date.now()")+1100)
            expect(button).to_be_enabled()
            expect(p.locator('[data-survey-condition]')).to_have_text("맑음")
            expect(p.locator('[data-survey-sight]')).to_contain_text("뚜렷")
            assert not saved()["field"].get("weatherSurvey")
        count=0
        while count<2:
            assert time.monotonic()-begin<430, "The chosen weather window did not arrive"
            f=saved()["field"]
            rows=f.get("weatherSurvey",{}).get("observations",[])
            sought=({"clear","fog"}-{row["condition"] for row in rows})
            stay=saved()["raid"]["zone"]
            visit(STATIONS[stay])
            action=p.locator('[data-field="survey-observe"]')
            expect(action).to_be_visible()
            if action.is_enabled():
                click('[data-field="survey-observe"]')
                new_rows=saved()["field"].get("weatherSurvey",{}).get("observations",[])
                if len(new_rows)>count:
                    current=new_rows[-1]
                    assert current["condition"] in sought and current["zone"]==stay
                    count=len(new_rows)
                    expect(p.locator("[data-survey-log]")).to_contain_text("맑음" if current["condition"]=="clear" else "안개")
                    expect(action).to_be_disabled()
                    if count==2:break
            click('[data-survey-station] [data-cui="forecast"]')
            # An ordinary reload mid-raid must keep the first observation.
            p.goto(URL+"#map");p.reload(wait_until="domcontentloaded")
            rows=saved()["field"].get("weatherSurvey",{}).get("observations",[])
            assert len(rows)==count
            sought=({"clear","fog"}-{row["condition"] for row in rows})
            used={row["zone"] for row in rows}
            for _ in range(360):
                forecasts=visible_forecasts()
                target=next((forecasts[k] for k in sorted(sought) if forecasts[k] not in used),None)
                if target is not None:break
                card=p.locator('[data-weather-board] [data-weather-zone]').first
                advance(int(card.get_attribute("data-next-at"))-p.evaluate("Date.now()")+1000)
            assert target is not None
            click('.command-deploy[data-page="raid"]')
            travel(target)

        rows=saved()["field"]["weatherSurvey"]["observations"]
        assert len({row["zone"] for row in rows})==len({row["condition"] for row in rows})==2
        travel(0)
        search_two()
        assert p.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        click('[data-field="extract"][data-exit="b04"]');finish()
        expect(p.locator(".result-panel")).to_be_visible()
        paid=saved();result=paid["lastSummary"]
        assert (result["rating"],result["commission"],result["missionXp"])==("success",26000,95)
        assert paid["wallet"]==56000 and paid["career"]["done"]==[ORDER]
        assert not paid["field"].get("weatherSurvey") and paid["stash"]=={}
        click('[data-raid="ack"]')
        p.reload(wait_until="domcontentloaded")
        assert saved()["wallet"]==56000 and saved()["career"]==paid["career"] and not errors, errors
        print(json.dumps({"width":width,"natural":natural,"elapsed_seconds":round(time.monotonic()-begin,2),
                          "title":p.title(),"observations":rows,"raid_ms":result["elapsed"],"searched":result["searched"],
                          "wallet":paid["wallet"],"commission":result["commission"],"order_xp":result["missionXp"]},
                         ensure_ascii=False),flush=True)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument('--natural',action='store_true')
    parser.add_argument('--width',type=int,choices=(390,1280))
    args=parser.parse_args()
    with sync_playwright() as pw:
        proxy={"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy) as browser:
            for width in ((args.width,) if args.width else (390,1280)):
                play(browser,width,args.natural)
