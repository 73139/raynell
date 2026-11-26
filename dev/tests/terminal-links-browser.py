"""Exercise actual same-tab anchors, subpanels, native Back/Forward and a live saved raid."""
import os
from pathlib import Path
from urllib.parse import urldefrag
from playwright.sync_api import expect, sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"index.html").read_bytes()
LIVE=os.getenv("RUSTLINE_URL")
BASE=urldefrag(LIVE or "https://rustline-terminal.test/phone").url
URL=BASE+("&" if "?" in BASE else "?")+"launch=nav&source=a%2Bb"
MODES={"daily":"daily","weekly":"weekly","quests":"standing"}
PAGES={"weather":"map","routes":"map","map":"map","shop":"trade","cart":"trade","health":"health",
       "stash":"stash","clinic":"facility",**{key:"traderQuests" for key in MODES}}

def play(browser,width):
    mobile=width==390
    with browser.new_context(viewport={"width":width,"height":850},is_mobile=mobile,has_touch=mobile,
                             reduced_motion="no-preference",ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1") as c:
        if not LIVE:
            c.route("https://rustline-terminal.test/**",lambda r:r.fulfill(body=HTML,content_type="text/html; charset=utf-8"))
        p=c.new_page();errors=[];p.on("pageerror",lambda err:errors.append(str(err)))
        p.set_default_timeout(6200);p.set_default_navigation_timeout(90000)
        p.on('dialog',lambda dialog:dialog.accept())

        def click(css):
            button=p.locator(css+":visible").first
            button.tap() if mobile else button.click()

        def anchor(key):
            # A real link activation does not reload a document when the requested fragment is already on this URL.
            p.evaluate("""url=>{const a=document.createElement('a');a.href=url;document.body.append(a);a.click();a.remove()}""",URL+"#"+key)

        def visible(key):
            expect(p).to_have_url(URL+"#"+key)
            expect(p.locator("#inside")).to_be_visible()
            expect(p.locator("#inside")).to_have_attribute("data-page",PAGES[key])
            if key in MODES:
                expect(p.locator('[data-contract="board"][aria-pressed="true"]')).to_have_attribute("data-mode",MODES[key])
            elif key=="clinic":expect(p.locator(".bu-f-spec header h2")).to_have_text("의무실")
            elif key=="cart":expect(p.locator("[data-cart-panel]")).to_be_visible()

        def link(key):anchor(key);visible(key)

        def snap():
            return p.evaluate("""()=>{
                const s=Object.keys(localStorage).filter(k=>k.startsWith('rl-reboot-session-'))
                    .map(k=>JSON.parse(localStorage.getItem(k))).filter(o=>o?.career && Array.isArray(o.stashSlots))
                    .sort((a,b)=>b.version-a.version||b.revision-a.revision)[0];
                return Object.fromEntries(['raid','field','wallet','equipment','stash','stashSlots','hideout','career','saleReceipts','contracts','marketCarts'].map(k=>[k,s[k]]));
            }""")

        r=p.goto(URL+"#weather",wait_until="domcontentloaded")
        assert r and r.ok and r.body()==HTML
        visible("weather")
        expect(p.locator("[data-weather-board]")).to_be_focused()
        initial=snap()
        origin=p.evaluate("performance.timeOrigin")
        for key in PAGES:
            link(key)
            p.evaluate("history.replaceState({host:'fixture',nested:{version:2}},'',location.href)")
            history_length=p.evaluate("history.length")
            click('.nav [data-page="bunker"]')
            expect(p.locator(".bu-deck")).to_be_visible()
            expect(p).to_have_url(URL)
            assert p.evaluate("history.length")==history_length
            assert p.evaluate("history.state")=={"host":"fixture","nested":{"version":2}}
            link(key)
            assert p.evaluate("performance.timeOrigin")==origin
        assert snap()==initial

        link("daily")
        p.evaluate("history.replaceState({portal:3},'',location.href)")
        click('[data-contract="board"][data-mode="weekly"]');visible("weekly")
        assert p.evaluate("history.state")=={"portal":3}
        click('[data-contract="board"][data-mode="standing"]');visible("quests")

        link("weather");click('[data-cui="routes"]');visible("routes")
        expect(p.locator("[data-route-compare]")).to_be_focused()
        link("weather");expect(p.locator("[data-weather-board]")).to_be_focused()
        # A repeated link to the same fragment can scroll directly back to its native anchor.
        p.locator('.command-station[data-index="0"]').focus()
        p.locator(".content").evaluate("e=>{e.scrollTop=0}")
        anchor("weather")
        expect(p.locator("[data-weather-board]")).to_be_focused()

        link("cart")
        click('[data-market="mode"][data-mode="sell"]')
        expect(p).to_have_url(URL)
        link("cart")
        expect(p.locator("[data-cart-panel]")).to_be_focused()

        link("shop");click('.nav [data-page="bunker"]');expect(p).to_have_url(URL)
        link("daily");link("weekly")
        p.go_back();visible("daily")
        p.go_back();expect(p).to_have_url(URL);expect(p.locator(".bu-deck")).to_be_visible()
        p.go_forward();visible("daily")
        p.go_forward();visible("weekly")
        # A link during the animated phone exit requests the final destination after the transition.
        p.keyboard.press("Escape");anchor("weather");visible("weather")
        expect(p.locator("[data-weather-board]")).to_be_focused()
        assert snap()==initial

        link("shop")
        click('[data-market="item"][data-id="water"]')
        click('[data-cart="add"][data-id="water"]')
        cart=snap()
        link("cart")
        seller=p.locator("[data-cart-panel]").get_attribute("data-trader")
        expect(p.locator("[data-cart-count]")).to_contain_text("1개")
        click('[data-market="trader"][aria-pressed="false"]')
        expect(p).to_have_url(URL)
        link("cart")
        expect(p.locator("[data-cart-panel]")).to_have_attribute("data-trader",seller)
        expect(p.locator("[data-cart-count]")).to_contain_text("1개")
        assert snap()==cart and cart["wallet"]==30000

        link("map");click('.command-station[data-index="0"]');click('.command-deploy[data-page="prep"]')
        click('.lo-deploy[data-raid="start"]')
        started=snap();assert started["raid"] and started["raid"]["zone"]==0
        for key in ("daily","weather","shop","weekly","map"):link(key)
        click('.command-deploy[data-page="raid"]')
        expect(p.locator(".landmark-header")).to_be_visible()
        assert snap()==started
        assert p.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        assert not errors,errors
        print(f"PASS {width}px: same-tab repeat for {len(PAGES)} destinations, query/history metadata, daily/weekly, same-map forecast and routes, cart, back/forward, animated exit, active raid preserved.",flush=True)

if __name__=="__main__":
    with sync_playwright()as pw:
        proxy={"server":os.environ["RUSTLINE_PROXY"]} if os.getenv("RUSTLINE_PROXY") else None
        with pw.chromium.launch(executable_path=os.getenv("RUSTLINE_CHROMIUM"),proxy=proxy)as b:
            for width in (390,1280):play(b,width)
