"""Restore the shipped legacy fixture locally and transfer one of three identical goods by position."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
GAME='https://case-source.test/'
KEY='rl-reboot-session-v36'

def play(browser,width):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':850},is_mobile=mobile,has_touch=mobile,offline=True,service_workers='block') as ctx:
        data=(ROOT/'index.html').read_bytes()
        ctx.route('**/*',lambda r:r.fulfill(body=data,content_type='text/html; charset=utf-8') if r.request.url.split('#')[0]==GAME else r.abort())
        p=ctx.new_page();p.set_default_timeout(10000)
        errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        p.goto(GAME+'#stash',wait_until='domcontentloaded')
        p.locator('.nav [data-page=more]:visible').click()
        p.locator('.content [data-page=settings]:visible').click()
        p.on('dialog',lambda d:d.accept())
        p.locator('#restore-file').set_input_files(ROOT/'tests/fixtures/possessions-v17.json')
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다')
        p.goto(GAME+'#stash',wait_until='domcontentloaded')
        def saved():return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def select(control):
            if mobile:control.tap()
            else:control.focus();control.press('Enter')
        def tile(uid):return p.locator(f'[data-stash=select][data-uid="{uid}"]:visible').first
        case,other,uid='s-drinks','s-rations','s-loose-water'
        before=saved()
        def contents(s,key):return next(u.get('contents',[]) for u in s['stashSlots'] if u['uid']==key)
        for choice in [case,other]:
            select(tile(choice))
            entry=p.locator(f'[data-pos-alias][data-box="{choice}"]')
            entry.fill('비상 식수' if choice==case else '야간 배급')
            select(p.locator(f'[data-pos=rename][data-box="{choice}"]'))
        select(tile(uid))
        targets=p.locator('[data-case-destinations]')
        select(targets.locator('summary'))
        buttons=targets.locator('button')
        expect(buttons).to_have_count(2)
        expect(targets).to_contain_text('비상 식수')
        expect(targets).to_contain_text('야간 배급')
        assert targets.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        select(targets.locator(f'[data-box="{case}"][data-unit="{uid}"]'))
        inside=p.locator(f'[data-stash=case-take][data-box="{case}"][data-unit="{uid}"]')
        expect(inside).to_be_focused()
        mid=saved()
        assert mid['wallet']==before['wallet'] and mid['stash']['water']==before['stash']['water']-1
        assert contents(mid,other)==contents(before,other)
        assert [v['uid'] for v in contents(mid,case)]==[v['uid'] for v in contents(before,case)]+[uid]
        assert not any(u['uid']==uid for u in mid['stashSlots'])
        p.reload(wait_until='domcontentloaded');select(tile(case))
        open_case=p.locator(f'[data-stash=case-open][data-box="{case}"]')
        if open_case.count():select(open_case)
        expect(inside).to_be_visible();select(inside)
        p.reload(wait_until='domcontentloaded')
        end=saved()
        assert end['stash']==before['stash'] and end['wallet']==before['wallet']
        assert contents(end,case)==contents(before,case) and contents(end,other)==contents(before,other)
        expect(tile(uid)).to_be_visible()
        # Transfer the selected bottle straight to another named case. Both cases hold water.
        select(tile(other))
        toggle=p.locator(f'[data-stash=case-open][data-box="{other}"]')
        if toggle.count():select(toggle)
        select(p.get_by_text('다른 보관함으로 옮기기',exact=True))
        item_selector=p.locator(f'[data-case-source="{other}"]')
        item_selector.select_option('s-water-a')
        receiver=p.locator(f'[data-stash=case-relocate][data-from="{other}"][data-box="{case}"]')
        expect(receiver).to_contain_text('비상 식수')
        expect(receiver).to_have_attribute('data-unit','s-water-a')
        select(receiver)
        moved=p.locator(f'[data-stash=case-take][data-box="{case}"][data-unit="s-water-a"]')
        expect(moved).to_be_focused()
        expect(p.locator('.content [role=status]').filter(has_text='보관함 이동 완료').first).to_be_visible()
        p.reload(wait_until='domcontentloaded')
        final=saved()
        assert final['wallet']==end['wallet'] and final['stash']==end['stash']
        assert [v['uid'] for v in contents(final,other)]==['s-can']
        assert [v['uid'] for v in contents(final,case)]==['s-tea','s-water-b','s-water-a']
        assert not errors,errors
        print(f'PASS {width}px: selected original loose water despite two queued copies, chose named food case, preserved the other case, recovered the same UID, then transferred a selected bottle directly between named cases and reloaded.',flush=True)

if __name__=='__main__':
    with sync_playwright() as p,p.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
        for width in (390,1280):play(browser,width)
