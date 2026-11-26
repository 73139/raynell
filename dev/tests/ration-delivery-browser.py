"""Local-only ration delivery warning and actual consumption at two viewport sizes."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from playwright.sync_api import expect, sync_playwright

DEV=Path(__file__).resolve().parents[1]
ORIGIN='https://rustline-ration-delivery.test/'
KEY='rl-reboot-session-v36'
ITEM='rl_09_10'
HTML=(DEV/'index.html').read_text(encoding='utf-8')
BASELINE_PATH=os.getenv('RUSTLINE_RATION_BASELINE_HTML')
BASELINE_HTML=Path(BASELINE_PATH).read_text(encoding='utf-8') if BASELINE_PATH else None

def seed(count, energy, pinned, game_path):
    env={**os.environ,'RATION_COUNT':str(count),'RATION_ENERGY':str(energy),'RATION_PIN':'1' if pinned else '0'}
    out=subprocess.check_output(['node','tests/ration-delivery.cjs',str(game_path),'--seed'],cwd=DEV,env=env,text=True)
    return json.loads(out)

def play(browser,width,count,energy,pinned,shortage,after,baseline=False):
    state=seed(count,energy,pinned,Path(BASELINE_PATH).resolve() if baseline else DEV/'index.html')
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':880},has_touch=mobile,is_mobile=mobile,
                             offline=True,service_workers='block',reduced_motion='reduce') as ctx:
        errors=[]
        html=BASELINE_HTML if baseline else HTML
        def serve(route):
            if route.request.method=='GET' and route.request.url==ORIGIN:
                route.fulfill(body=html,content_type='text/html; charset=utf-8')
            else:
                if not route.request.url.startswith(ORIGIN):errors.append('blocked '+route.request.url)
                route.abort()
        ctx.route('**/*',serve)
        ctx.add_init_script('if(!localStorage.getItem('+json.dumps(KEY)+'))localStorage.setItem('+json.dumps(KEY)+','+
                            json.dumps(json.dumps(state))+');')
        p=ctx.new_page()
        p.set_default_timeout(10000)
        p.on('pageerror',lambda e:errors.append(str(e)))
        p.clock.set_fixed_time(datetime.fromtimestamp(state['raid']['startedAt']/1000,timezone.utc))
        p.goto(ORIGIN+'#map',wait_until='domcontentloaded')
        def saved():return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def press(selector):
            loc=p.locator(selector+':visible').first
            if mobile:loc.tap()
            else:loc.focus();loc.press('Enter')
        def inventory():
            if p.locator('#inside').get_attribute('data-page')!='inventory':
                press('.nav [data-page=inventory]')
            tab='[data-loadout=mobile-tab][data-screen=gear][data-index="1"]'
            if p.locator(tab+':visible').count():press(tab)
        unit=next(u for u in state['field']['bag'] if u['g']==ITEM)
        inventory()
        def select():
            press(f'[data-pick="{unit["uid"]}"][data-side=bag]')
        select()
        warning=p.locator(f'[data-ration-delivery="{unit["uid"]}"]')
        expect(p.locator(f'[data-ration-preview="{unit["uid"]}"]')).to_be_visible()
        if pinned and not baseline:
            expect(warning).to_have_attribute('data-before',str(shortage))
            expect(warning).to_have_attribute('data-after',str(after))
            expect(warning).to_contain_text(f'생환 시 부족 {shortage} → {after}개')
        else:expect(warning).to_have_count(0)
        assert saved()['field']['bag']==state['field']['bag']
        assert saved()['wallet']==state['wallet']
        p.reload(wait_until='domcontentloaded')
        inventory();select()
        if pinned and not baseline:expect(warning).to_have_attribute('data-after',str(after))
        consume=f'[data-gear=consume][data-unit="{unit["uid"]}"]'
        if energy==100:
            expect(p.locator(consume)).to_be_disabled()
            if pinned and not baseline:expect(warning).to_contain_text('회복량 0 · 소모 없음')
        else:press(consume)
        post=saved()
        assert len([u for u in post['field']['bag'] if u['g']==ITEM])==count-int(energy<100)
        assert post['field']['energy']==100 and post['wallet']==state['wallet']
        p.reload(wait_until='domcontentloaded')
        assert saved()['field']['bag']==post['field']['bag']
        assert not errors,errors
        print(f'PASS {width}px baseline={baseline} pinned={pinned} count={count} energy={energy} shortfall={shortage}->{after}',flush=True)

if __name__=='__main__':
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
        if BASELINE_HTML:
            play(browser,1280,2,98,True,0,1,baseline=True)
        for width in (390,1280):
            for args in ((2,98,True,0,1),(1,98,True,1,2),(3,98,True,0,0),(2,100,True,0,0),(2,98,False,None,None)):
                play(browser,width,*args)
