"""Exercise field search and placement with real keyboard and touch input on new and migrated saves."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from urllib.parse import urldefrag
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
PUBLIC=os.getenv('RUSTLINE_URL')
URL=urldefrag(PUBLIC or 'https://field-loot-input.test/').url
KEY=re.search(rb'const SAVE_KEY\s*=\s*[\'"]([^\'"]+)',HTML)[1].decode()
OLD=json.loads((ROOT/'tests/fixtures/loot-goals-v23-search.json').read_text())['session']
OLD_KEY='rl-reboot-session-v23'


def tab_to(page,selector):
    for n in range(125):
        if page.evaluate("s=>document.activeElement.matches(s)",selector):
            return n
        page.keyboard.press("Tab")
    raise AssertionError("Keyboard could not reach "+selector)


def keyboard(page,selector):
    tab_to(page,selector)
    page.keyboard.press("Enter")


def state(page):
    return page.evaluate("k=>JSON.parse(localStorage[k])",KEY)


def page_for(browser,width,legacy=False,blocked=False):
    ctx=browser.new_context(viewport={'width':width,'height':850},has_touch=width<600,
        reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    if not PUBLIC:
        ctx.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
    page=ctx.new_page();page.set_default_timeout(6000)
    errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
    stamp=1800000008500
    date=lambda n:datetime.fromtimestamp(n/1000,tz=timezone.utc)
    page.clock.install(time=date(stamp-86400000));page.clock.pause_at(date(stamp))
    if legacy:
        saved=json.loads(json.dumps(OLD))
        if blocked:
            f=saved['field'];cols,rows=(6,6) if f['worn'].get('back')=='issued_pack' else (3,2)
            f['bag']=[dict(uid=f'qa-occupied-{x}-{y}',g='tape',x=x,y=y,w=1,h=1,revealed=True)
                      for x in range(cols) for y in range(rows)]
        ctx.add_init_script("if(!localStorage.getItem("+json.dumps(OLD_KEY)+"))localStorage.setItem("+
                            json.dumps(OLD_KEY)+","+json.dumps(json.dumps(saved))+");")
    response=page.goto(URL+'#map',wait_until='domcontentloaded',timeout=90000)
    assert response and response.ok and response.body()==HTML
    page.wait_for_function('k=>!!localStorage[k]',arg=KEY)
    return ctx,page,errors


def fresh_run(browser,width):
    ctx,p,errors=page_for(browser,width)
    try:
        p.evaluate('Math.random=()=>.45')  # Native actions, deterministic nonempty box; later advance the field timer.
        keyboard(p,'.command-deploy[data-page=prep]')
        keyboard(p,'.lo-deploy[data-raid=start]')
        if not p.locator('[data-field=open]:visible').count():
            keyboard(p,'[data-field=scan]');p.clock.fast_forward(12000)
        open_sel='[data-field=open][data-index="0"]'
        keyboard(p,open_sel)
        expect(p.locator('.lo-search')).to_be_focused()
        source=p.locator('[data-grid=loot]')
        assert source.locator('button.slot').count()==0
        assert p.locator('button[data-cell=bag]').count()==0
        hidden=source.locator('.unknown').first
        expect(hidden).to_have_accessible_name('미확인 물품 수색')
        assert not hidden.get_attribute('data-uid') and not hidden.get_attribute('data-pick')
        assert p.locator('[data-side=loot][data-pick]').count()==0
        p.keyboard.press('Enter')
        expect(p.locator('[data-field-search-status]')).to_be_focused()
        p.clock.fast_forward(15000)
        first=source.locator('[data-pick]').first
        expect(first).to_be_focused()
        uid=first.get_attribute('data-pick')
        name=first.get_attribute('aria-label')
        p.keyboard.press('Enter')
        rotate=p.locator('[data-field=rotate]:visible').first
        expect(rotate).to_be_focused()
        p.keyboard.press('Enter')
        expect(rotate).to_be_focused();expect(rotate).to_have_attribute('aria-pressed','true')
        assert tab_to(p,'[data-field=take]')==1
        p.keyboard.press('Enter')
        assert any(u['uid']==uid for u in state(p)['field']['bag'])
        if source.locator('[data-pick]').count():
            expect(source.locator('[data-pick]').first).to_be_focused()
        keyboard(p,'[data-field=close]')
        expect(p.locator(open_sel)).to_be_focused()
        p.clock.fast_forward(420000)
        keyboard(p,'[data-field=extract][data-exit=b04]')
        p.clock.fast_forward(11000)
        s=state(p);summary=s['lastSummary']
        assert summary['rating']=='success' and summary['searched']==1 and len(summary['goods'])==1
        keyboard(p,'[data-raid=ack]')
        p.reload(wait_until='domcontentloaded',timeout=90000)
        assert state(p)['lastSummary']['raidId']==summary['raidId'] and state(p)['career']['returns']==1
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth') and not errors,errors
        print(f'PASS fresh {width}px keyboard: field scan, full search, rotate → 1 Tab → take, focus returned to box, normal B-04 and reload ({name}).',flush=True)
    finally:
        ctx.close()


def restored_run(browser,width,blocked=False):
    ctx,p,errors=page_for(browser,width,legacy=True,blocked=blocked)
    try:
        touch=width<600
        def act(selector):
            if touch:p.locator(selector+':visible').first.tap()
            else:keyboard(p,selector)
        act('.command-deploy[data-page=raid]')
        p.clock.fast_forward(3200)
        tile=p.locator('[data-side=loot][data-pick="0-8-0"]')
        expect(tile).to_be_visible()
        pending=p.locator('[data-grid=loot] .unknown')
        assert pending.count()==2 and not pending.first.get_attribute('data-uid')
        target='[data-grid=loot] [data-field=search][data-tile-x="'+pending.first.get_attribute('data-tile-x')+'"][data-tile-y="'+pending.first.get_attribute('data-tile-y')+'"]'
        position=(pending.first.get_attribute('data-tile-x'),pending.first.get_attribute('data-tile-y'))
        act(target);p.clock.fast_forward(3200)
        assert p.locator('[data-grid=loot] .unknown').count()==1
        if not touch:
            expect(p.locator(f'[data-side=loot][data-tile-x="{position[0]}"][data-tile-y="{position[1]}"]')).to_be_focused()
        act('[data-side=loot][data-pick="0-8-0"]')
        act('[data-field=rotate]')
        expect(p.locator('[data-field=rotate]:visible')).to_have_attribute('aria-pressed','true')
        snapshot=state(p)
        if blocked:
            expect(p.locator('[data-field=take]:visible')).to_be_disabled()
            expect(p.locator('[data-pickup-fit]:visible')).to_contain_text('배치 불가')
        act('[data-field=place]')
        if touch:
            expect(p.locator('[data-screen=loot][data-index="1"]')).to_have_attribute('aria-pressed','true')
        current=p.locator('button[data-cell=bag]:focus')
        expect(current).to_be_visible()
        start=(int(current.get_attribute('data-x')),int(current.get_attribute('data-y')))
        if blocked:
            if touch:
                p.locator('button[data-cell=bag][data-x="1"][data-y="0"]').tap()
            else:
                p.keyboard.press('ArrowRight');p.keyboard.press('Enter')
            unchanged=state(p)
            assert unchanged['field']['bag']==snapshot['field']['bag']
            assert unchanged['field']['boxes']['0-8']['items']==snapshot['field']['boxes']['0-8']['items']
            if not touch:
                assert p.locator('[data-cell=bag]:focus').count()==1
            expect(p.locator('.lo-bag [role=status]:visible').last).to_contain_text('겹칩니다')
            act('.lo-bag [data-field=unselect]')
            assert p.locator('[data-field-placing]').count()==0
        else:
            if touch:
                p.locator(f'button[data-cell=bag][data-x="{start[0]}"][data-y="{start[1]}"]').tap()
            else:
                p.keyboard.press('ArrowRight');p.keyboard.press('Enter')
            outcome=state(p)
            assert sum(u['uid']=='0-8-0' for u in outcome['field']['bag'])==1
            assert not any(u['uid']=='0-8-0' for u in outcome['field']['boxes']['0-8']['items'])
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth') and not errors,errors
        print(f"PASS migrated v23 {width}px {'no space' if blocked else 'manual placement'}: single concealed tile search, rotate and bag navigation.",flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widths',type=int,nargs='*',default=[320,390,1280]);args=parser.parse_args()
    proxy=os.getenv('RUSTLINE_PROXY')
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),
                                                     proxy={'server':proxy} if proxy else None) as browser:
        for width in args.widths:
            fresh_run(browser,width)
            restored_run(browser,width)
            restored_run(browser,width,blocked=True)
