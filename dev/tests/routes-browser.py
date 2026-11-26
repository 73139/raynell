"""Run python build.py, then python tests/routes-browser.py with Playwright and Chromium.
Optional RUSTLINE_URL, RUSTLINE_CHROMIUM, RUSTLINE_PROXY, RUSTLINE_IGNORE_HTTPS_ERRORS=1.
Only test browser profiles are used. Random draws are fixed at departure to cover all three events.
"""
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = urldefrag(os.getenv('RUSTLINE_URL') or (ROOT / 'index.html').as_uri()).url
SAVE = 'rl-reboot-session-v36'
ROUTES = {
    (0, 1): ('배수로 옆길', 1, 8, 10, 25, ['water','bandage','food']),
    (0, 2): ('폐철도 화물선', 3, 30, 35, 27, ['battery','wire','tape']),
    (1, 0): ('검문소 후문길', 1, 7, 8, 20, ['bandage','water','medkit']),
    (1, 2): ('화물차 대기선', 2, 18, 20, 34, ['food','tape','battery']),
    (2, 0): ('방벽 정비로', 3, 24, 15, 30, ['wire','tape','bandage']),
    (2, 1): ('적재장 연결로', 2, 14, 28, 32, ['medkit','bandage','battery'])
}
NAMES = {k:v['name'] for k,v in json.loads((ROOT/'Rustline_Database_v10.json').read_text())['items'].items()}


def read(page):
    return page.evaluate('key => JSON.parse(localStorage.getItem(key))', SAVE)


def new_page(browser, width, now=None, route='#map'):
    ctx=browser.new_context(viewport={'width':width,'height':844}, reduced_motion='reduce',
                            ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    page=ctx.new_page()
    page.set_default_timeout(7000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.on('dialog',lambda dialog:dialog.accept())
    page.clock.install(time=datetime.fromtimestamp(now/1000,timezone.utc) if now else None)
    response=page.goto(URL+route,wait_until='domcontentloaded',timeout=60000)
    if URL.startswith('http'): assert response and response.ok
    page.wait_for_function('k=>!!localStorage.getItem(k)',arg=SAVE)
    return ctx,page,errors


def contact_time(page):
    action=read(page)['field']['action']
    assert action
    page.clock.fast_forward(max(300,action['end']-page.evaluate('Date.now()')+270))


def set_rolls(page,values):
    # Set only the RNG used by the real move/evade handler; no inventory/field state is injected.
    page.evaluate('''values=>{const fallback=Math.random; Math.random=()=>values.length?values.shift():fallback();}''',values)


def layout(page):
    result=page.evaluate('''()=>[document.documentElement.scrollWidth-innerWidth,
             document.querySelector('.content').scrollWidth-document.querySelector('.content').clientWidth]''')
    assert max(result)<=1,result


def card(page, origin, destination):
    return page.locator(f'[data-route-card][data-from="{origin}"][data-to="{destination}"]').first


def compare(page, origin, live):
    panel=page.locator(f'[data-route-compare][data-from="{origin}"]').first
    expect(panel).to_be_visible()
    expect(panel.locator('[data-route-card]')).to_have_count(2)
    for (src,dst),(name,dist,sec,risk,supply,goods) in ROUTES.items():
        if src!=origin: continue
        tile=card(page,src,dst)
        expect(tile).to_contain_text(name)
        expect(tile.locator('[data-route-time]')).to_have_text(f'{dist}칸 · {sec}초')
        expect(tile.locator('[data-route-risk]')).to_have_text(f'{risk}%')
        expect(tile.locator('[data-route-supply]')).to_have_text(f'{supply}%')
        for g in goods:expect(tile.locator('[data-route-sources]')).to_contain_text(NAMES[g])
        expect(tile.locator('button[data-field="move"]')).to_have_count(1 if live else 0)
        if dst==0:expect(tile.locator('[data-route-objective="target"]')).to_contain_text('배급소 식당')
    layout(page)


def scenario(browser,width):
    ctx,page,errors=new_page(browser,width,route='#guide')
    restored=None
    try:
        for action in ['quest','accept']:
            page.locator(f'[data-guide-action="{action}"]:visible').click()
        page.goto(URL+'#map',wait_until='domcontentloaded')
        for origin in [0,1,2,0]:
            page.locator(f'button.command-station[data-index="{origin}"]').click()
            compare(page,origin,False)
            assert read(page)['raid'] is None
        page.locator('.command-deploy[data-page="prep"]').click()
        page.locator('.lo-deploy[data-raid="start"]').click()
        compare(page,0,True)
        page.locator('.field-links button[data-page="map"]:visible').click()
        page.locator('button.command-station[data-index="2"]').click()
        compare(page,0,True)
        assert read(page)['raid']['zone']==0 and not read(page)['field'].get('journey')
        set_rolls(page,[.50,.05,.99,.02])
        card(page,0,2).locator('button[data-field="move"]').click()
        s=read(page)
        plan=s['field']['journey']['schedule']
        assert [step['outcome'] for step in plan['legs']]==['supply','contact','clear']
        expected=s['field']['action']['end']+20000
        status=page.locator('[data-route-status]').first
        expect(status).to_contain_text('폐철도 화물선')
        expect(status.locator('time')).to_have_attribute('data-route-eta',str(expected))
        # During a countdown the individual upcoming supply item is still undisclosed.
        expect(status).not_to_contain_text(NAMES['battery'])
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('[data-route-status] time').first).to_have_attribute('data-route-eta',str(expected))
        assert read(page)['field']['journey']['schedule']==plan
        contact_time(page)
        expect(page.locator('[data-route-status] time')).to_have_count(0)
        page.locator('.nav button[data-page="raid"]:visible').click()
        expect(page.locator('.road-supply')).to_contain_text(NAMES['battery'])
        before=read(page)
        page.locator('.shell-settings').click()
        with tempfile.TemporaryDirectory() as folder:
            with page.expect_download() as item:page.locator('[data-backup="export"]').click()
            path=Path(folder)/'route.json';item.value.save_as(path)
            restored,p,restored_errors=new_page(browser,width,now=page.evaluate('Date.now()')+4000)
            p.locator('.shell-settings').click()
            p.locator('#restore-file').set_input_files(path)
            expect(p.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
        p.locator('.nav button[data-page="raid"]:visible').click()
        assert read(p)['field']['journey']['schedule']==plan
        expect(p.locator('.road-supply')).to_contain_text(NAMES['battery'])
        p.locator('[data-field="journey-take"]').click()
        assert len(read(p)['field']['bag'])==len(before['field']['bag'])+1
        assert read(p)['field']['bag'][-1]['g']=='battery'
        contact_time(p)
        expect(p.locator('[data-field="evade"]')).to_be_visible()
        expect(p.locator('[data-route-status] time')).to_have_count(0)
        set_rolls(p,[.01])
        p.locator('[data-field="evade"]').click()
        assert read(p)['field']['action']['escaped'] is True
        p.reload(wait_until='domcontentloaded')
        contact_time(p)
        active=read(p)['field']
        assert active['action']['outcome']=='clear'
        expect(p.locator('[data-route-status] time').first).to_have_attribute('data-route-eta',str(active['action']['end']))
        contact_time(p)
        s=read(p);assert s['raid']['zone']==2 and not s['field'].get('journey')
        assert s['field']['visited']==[0,2]
        p.locator('.nav button[data-page="raid"]:visible').click()
        compare(p,2,True)
        assert not errors and not restored_errors,(errors,restored_errors)
        print(f'PASS {width}px — preview six directions, pin, deploy, inspect without moving, supply/checkpoint export/import, resume contact, evade/reload, one item and predicted arrival.',flush=True)
    finally:
        if restored:restored.close()
        ctx.close()


def migration(browser):
    samples=json.loads((ROOT/'tests/fixtures/routes-v19.json').read_text())
    sample=next(row for row in samples['checkpoints'] if row['scenario']=='waiting-supply')
    legacy={**samples['base'],**sample['other'],'field':{**samples['base']['field'],**sample['field']}}
    ctx,page,errors=new_page(browser,390,now=sample['now'])
    try:
        with tempfile.TemporaryDirectory() as directory:
            backup=Path(directory)/'v19.json'
            backup.write_text(json.dumps({'format':'rustline-tc01','session':legacy}))
            page.locator('.shell-settings').click()
            page.locator('#restore-file').set_input_files(backup)
            expect(page.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
        page.locator('.nav button[data-page="raid"]:visible').click()
        status=page.locator('[data-route-status]').first
        expect(status).to_contain_text('이전 버전')
        expect(status).to_contain_text('7.2초')
        expect(status.locator('time')).to_have_count(0)
        expect(page.locator('.road-supply')).to_contain_text(NAMES['food'])
        state=read(page);assert state['field']['journey']['schedule']['rules']=='legacy'
        assert state['field']['journey']['supply']=='food'
        page.reload(wait_until='domcontentloaded')
        page.locator('.nav button[data-page="raid"]:visible').click()
        page.locator('[data-field="journey-take"]').click()
        state=read(page);assert state['field']['bag'][-1]['g']=='food'
        assert state['field']['action']['end']-state['field']['action']['start']==7200
        assert not errors,errors
        print('PASS 390px — authentic v0.19 JSON import, old-only food retained at a paused offer, 7.2-second legacy timer resumed after reload.',flush=True)
    finally:
        ctx.close()


def deadline(browser):
    ctx,page,errors=new_page(browser,390,route='#routes')
    try:
        overview=page.locator('[data-route-compare]').first
        expect(overview).to_be_focused()
        page.locator('.command-deploy[data-page="prep"]').click()
        page.locator('.lo-deploy[data-raid="start"]').click()
        ends_at=read(page)['raid']['endsAt']
        long_route=card(page,0,2)
        short_route=card(page,0,1)
        page.clock.fast_forward(ends_at-page.evaluate('Date.now()')-36000)
        expect(long_route.locator('[data-route-deadline]')).to_be_hidden()
        page.clock.fast_forward(10000)
        expect(long_route.locator('[data-route-deadline]')).to_be_visible()
        expect(short_route.locator('[data-route-deadline]')).to_be_hidden()
        set_rolls(page,[.01,.01,.01])
        long_route.locator('[data-field="move"]').click()
        expect(page.locator('[data-route-status] [data-route-deadline]').first).to_be_visible()
        page.clock.fast_forward(ends_at-page.evaluate('Date.now()')+500)
        state=read(page)
        assert state['field']['result']=='expired' and state['raid']['zone']==0
        assert state['field']['visited']==[0] and not errors, errors
        print('PASS 390px — comparison deep link and focus, deadline crossing, reachable short route and expiry before arrival on long route.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    options={'headless':True,'args':['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):options['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):options['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as p:
        b=p.chromium.launch(**options)
        try:
            for width in [1280,390]:scenario(b,width)
            migration(b)
            deadline(b)
        finally:b.close()
