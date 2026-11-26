"""Play a real weather-survey sortie across two authentic release binaries.

After build.py, pass --legacy-html /path/to/v0.62/index.html or set
RUSTLINE_LEGACY62_HTML. RUSTLINE_URL optionally serves today's current HTML.
Clocks and encounter rolls are controlled; each viewport has fresh storage.
"""
import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urldefrag, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
BASE=urldefrag(os.getenv('RUSTLINE_URL') or 'https://rustline-release-handoff.test/').url
KEY='rl-reboot-session-v36'
ORDER='weather-survey'
STATIONS=(9,6,1)
START=1800000001000


def raw(page):
    return page.evaluate('k=>localStorage.getItem(k)',KEY)


def player(page):
    return json.loads(raw(page))


def click(page, selector):
    page.locator(selector+':visible').first.click()


def writer(page, active):
    page.wait_for_function("active=>active!==document.documentElement.classList.contains('read-only')",arg=active)


def open_build(c,client,now,fragment,docs,errors):
    p=c.new_page()
    p.set_default_timeout(7000)
    p.on('pageerror',lambda err: errors.append(str(err)))
    p.clock.install(time=datetime.fromtimestamp((now-20000)/1000,tz=timezone.utc))
    p.clock.pause_at(datetime.fromtimestamp(now/1000,tz=timezone.utc))
    sep='&' if '?' in BASE else '?'
    response=p.goto(BASE+sep+'release-handoff='+client+'#'+fragment,wait_until='domcontentloaded',timeout=90000)
    assert response and response.ok and response.body()==docs[client]
    return p


def visit_station(page,z):
    click(page,'.landmark-picker summary')
    click(page,f'[data-field="landmark"][data-index="{STATIONS[z]}"]')
    click(page,'[data-field="survey-observe"]')


def finish_action(page):
    for _ in range(24):
        field=player(page)['field']
        if field.get('action'):
            ms=field['action']['end']-page.evaluate('Date.now()')+300
            page.clock.fast_forward(max(300,ms))
        elif field.get('contact'):
            click(page,'[data-field="evade"]')
        elif (field.get('journey') or {}).get('event')=='supply':
            click(page,'[data-field="journey-pass"]')
        else:
            return
    raise AssertionError('Field action did not finish')


def travel(page,z):
    origin=player(page)['raid']['zone']
    if origin!=z:
        click(page,f'[data-route-card][data-from="{origin}"][data-to="{z}"] [data-field="move"]')
        finish_action(page)
    assert player(page)['raid']['zone']==z


def expect_blocked(page):
    expect(page.locator('#save-upgrade')).to_be_visible()
    expect(page.locator('#save-refresh')).to_be_focused()
    assert page.locator('#inside').evaluate('e=>e.inert')


def run(browser,docs,width):
    with browser.new_context(viewport={'width':width,'height':844},has_touch=width==390,reduced_motion='reduce',
                             ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as c:
        def respond(route):
            client=parse_qs(urlparse(route.request.url).query)['release-handoff'][0]
            if client=='current' and os.getenv('RUSTLINE_URL'):
                route.continue_()
            else:
                route.fulfill(body=docs[client],content_type='text/html; charset=utf-8')
        c.route(re.compile(r'[?&]release-handoff='),respond)
        c.add_init_script('Math.random=()=>0.20')
        errors=[]
        def open_tab(label,route,now=START):return open_build(c,label,now,route,docs,errors)
        old=open_tab('previous','shop');writer(old,True)
        p=open_tab('current','quests');writer(p,False)
        queued=open_tab('previous','shop');writer(queued,False)
        assert player(old)['writerBuild']==62000
        click(old,'[data-market="item"][data-id="water"]')
        click(old,'[data-market="trade"][data-id="water"]')
        assert player(old)['wallet']==25000 and player(old)['stash']=={'water':1}
        old.close();writer(p,True);expect_blocked(queued)
        assert player(p)['wallet']==25000
        click(p,'[data-page="orders"]')
        click(p,f'[data-bui="order"][data-id="{ORDER}"]')
        click(p,f'[data-order="{ORDER}"]')
        click(p,f'[data-objective="pin"][data-id="{ORDER}"]')
        click(p,'.bu-order-panel [data-cui="forecast"]')
        cards=p.locator('[data-weather-board] [data-weather-zone]')
        forecasts={card.get_attribute('data-condition'):int(card.get_attribute('data-weather-zone')) for card in cards.all()}
        origin,dest=forecasts['clear'],forecasts['fog']
        click(p,f'[data-weather-board] [data-weather-zone="{origin}"] [data-cui="weather-select"]')
        click(p,'[data-weather-deploy]');click(p,'.lo-deploy[data-raid="start"]')
        visit_station(p,origin)
        now=p.evaluate('Date.now()'); one=raw(p); first=json.loads(one)
        observation=first['field']['weatherSurvey']['observations']
        assert first['career']['order']==ORDER and first['objectivePin']=={'kind':'order','id':ORDER}
        assert len(observation)==1 and observation[0]['condition']=='clear'
        cold=open_tab('previous','quests',now);expect_blocked(cold)
        assert raw(cold)==one and raw(queued)==one
        p.close()
        cold.reload(wait_until='domcontentloaded');expect_blocked(cold)
        assert raw(queued)==one
        p=open_tab('current','map',now);writer(p,True)
        state=player(p)
        assert state['field']['weatherSurvey']==first['field']['weatherSurvey'] and state['objectivePin']==first['objectivePin']
        assert state['raid']==first['raid'] and state['wallet']==25000 and state['stash']=={'water':1}
        click(p,'.command-deploy[data-page="raid"]')
        travel(p,dest);visit_station(p,dest)
        rows=player(p)['field']['weatherSurvey']['observations']
        assert [r['zone'] for r in rows]==[origin,dest] and [r['condition'] for r in rows]==['clear','fog']
        travel(p,0)
        p.clock.fast_forward(max(1,first['raid']['startedAt']+421000-p.evaluate('Date.now()')))
        click(p,'[data-field="extract"][data-exit="b04"]');finish_action(p)
        expect(p.locator('.result-panel')).to_be_visible()
        paid=player(p)
        assert paid['lastSummary']['rating']=='success'
        assert (paid['lastSummary']['commission'],paid['lastSummary']['missionXp'])==(26000,95)
        assert paid['career']['done']==[ORDER] and paid['wallet']==51000 and paid['stash']=={'water':1}
        click(p,'[data-raid="ack"]')
        final=raw(p);now=p.evaluate('Date.now()');p.close()
        cold.reload(wait_until='domcontentloaded');expect_blocked(cold)
        assert raw(queued)==final and raw(cold)==final
        compatible=open_tab('current','quests',now);writer(compatible,True)
        restored=player(compatible)
        assert restored['career']==paid['career'] and restored['wallet']==51000 and restored['raid'] is None
        assert not errors,errors
        print(f'PASS {width}px authentic {old_title(docs["previous"])} / {old_title(docs["current"])}: writer checkout 30,000→25,000 CR, waiting tab and cold stale readers blocked; pinned clear observation survives stale reload and lock reacquisition; fog from a second zone, B-04 normal return, 26,000 CR/95 XP once, 51,000 CR and one water after final reload.',flush=True)


def old_title(doc):
    return re.search(rb' v([0-9.]+)</title>',doc)[1].decode()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--legacy-html',type=Path,default=os.getenv('RUSTLINE_LEGACY62_HTML'))
    parser.add_argument('--width',type=int,choices=[390,1280])
    args=parser.parse_args()
    if args.legacy_html is None:
        print('SKIP authentic release handoff: supply --legacy-html or RUSTLINE_LEGACY62_HTML for the original v0.62 HTML.')
    else:
        docs={'current':HTML,'previous':args.legacy_html.read_bytes()}
        assert old_title(docs['previous'])=='0.62' and hashlib.sha256(docs['previous']).hexdigest()=='3e364570544df52cba2b25ecfa35bdd8d5388c08ad9ea5b19336ec518dd31b55'
        assert b'weatherSurvey' not in docs['previous'] and b'weatherSurvey' in HTML
        proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
        with sync_playwright() as pw, pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
            for width in ([args.width] if args.width else [390,1280]):
                run(browser,docs,width)
