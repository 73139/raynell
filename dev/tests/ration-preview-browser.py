"""New profile, two real water bottles, two food units, a real scan, precise instance use and cold reload."""
import os
from pathlib import Path
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
URL='https://rustline-rations.test/'
KEY='rl-reboot-session-v36'
def play(browser,width):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844},is_mobile=mobile,has_touch=mobile,reduced_motion='reduce') as ctx:
        ctx.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        p=ctx.new_page();p.set_default_timeout(6500);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        def nav(page):p.goto(URL+'#'+page,wait_until='domcontentloaded')
        def hit(sel):
            c=p.locator(sel+':visible').first
            if mobile:c.tap()
            else:c.focus();c.press('Enter')
        def saved():return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def gear():
            nav('map');hit('.nav [data-page=inventory]')
            t='[data-loadout=mobile-tab][data-screen=gear][data-index="1"]'
            if p.locator(t+':visible').count():hit(t)
        nav('shop');hit('[data-market=trader][data-id=supply]')
        for item in ('water','food'):
            hit(f'[data-market=item][data-id="{item}"]')
            for _ in range(2):hit(f'[data-cart=add][data-id="{item}"]')
        hit('[data-cart=checkout]');assert saved()['wallet']==8000
        if not mobile:
            nav('map');hit('.nav [data-page=inventory]')
            hit('[data-loadout=slot][data-slot=back]');hit('[data-gear=unwear][data-slot=back]')
            assert not saved()['equipment']['worn'].get('back')
        pack='가방' if mobile else '주머니'
        nav('stash')
        units=[u for u in saved()['stashSlots'] if u['g'] in ('food','water')]
        for u in units:
            hit(f'[data-stash=select][data-uid="{u["uid"]}"]');hit(f'[data-gear=pack][data-unit="{u["uid"]}"]')
        nav('map');hit('.command-station[data-index="0"]');hit('.command-deploy[data-page=prep]');hit('.lo-deploy[data-raid=start]')
        after=saved()['field'];waters=[u for u in after['bag'] if u['g']=='water'];food=next(u for u in after['bag'] if u['g']=='food')
        uid=waters[1]['uid']
        gear();hit(f'[data-pick="{uid}"][data-side=bag]')
        expect(p.locator(f'[data-ration-preview="{uid}"]')).to_contain_text('수분 100 · 최대 · 소모 없음')
        expect(p.locator(f'[data-gear=consume][data-unit="{uid}"]')).to_be_disabled()
        nav('map');hit('.command-station[data-index="0"]');hit('.command-deploy[data-page=raid]');hit('[data-field=scan]')
        p.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,timeout=20000)
        gear();hit(f'[data-pick="{uid}"][data-side=bag]')
        preview=p.locator(f'[data-ration-preview="{uid}"]')
        expect(preview).to_contain_text(f'{pack} {waters[1]["y"]+1}행 {waters[1]["x"]+1}열 · 수분 99 → 100 · 실효 +1 · 초과 24')
        out=os.getenv('RUSTLINE_RATION_SHOTS')
        if out:
            folder=Path(out);folder.mkdir(parents=True,exist_ok=True)
            preview.locator('..').screenshot(path=str(folder/f'water-{width}.png'),animations='disabled')
        hit(f'[data-gear=consume][data-unit="{uid}"]')
        s=saved();assert s['field']['water']==100 and [u['uid'] for u in s['field']['bag'] if u['g']=='water']==[waters[0]['uid']]
        hit(f'[data-pick="{food["uid"]}"][data-side=bag]');expect(p.locator(f'[data-ration-preview="{food["uid"]}"]')).to_contain_text('기력 98 → 100 · 실효 +2 · 초과 18')
        hit(f'[data-gear=consume][data-unit="{food["uid"]}"]')
        p.reload(wait_until='domcontentloaded');s=saved();assert s['field']['energy']==s['field']['water']==100
        assert len(s['field']['bag'])==2 and s['wallet']==8000 and not errors
        print(f'PASS {width}px {pack} real clock, new wallet 30,000→8,000 CR, two pairs packed, selected second water +1/24, food +2/18; distinct earlier water persists after reload.',flush=True)
if __name__=='__main__':
    with sync_playwright() as w,w.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as b:
        for width in (390,1280):play(b,width)
