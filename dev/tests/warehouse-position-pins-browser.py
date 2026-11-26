"""Play a new profile through checkout, manual placement, a position pin, sorting and native file handoff."""
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
URL=urldefrag(os.getenv('RUSTLINE_URL') or (ROOT/'index.html').as_uri()).url
HTML=(ROOT/'index.html').read_bytes()
KEY='rl-reboot-session-v36'

def check(browser,width):
    mobile=width<=500
    config=dict(viewport={'width':width,'height':844},has_touch=mobile,is_mobile=mobile,
                reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    with TemporaryDirectory() as temp,browser.new_context(**config) as source,browser.new_context(**config) as target:
        def start(context):
            p=context.new_page();p.set_default_timeout(8000);p.on('dialog',lambda d:d.accept());return p
        page=start(source);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def saved():return page.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def hit(selector):
            node=page.locator(selector+':visible').first
            if mobile:node.tap()
            else:node.click()
        def tile(uid):return f'[data-stash=select][data-uid="{uid}"]'
        def moved(uid,x,y):
            hit(tile(uid));hit(f'[data-stash=place][data-x="{x}"][data-y="{y}"]')
        def coords(uid):return tuple(next((u['x'],u['y'],u['w'],u['h']) for u in saved()['stashSlots'] if u['uid']==uid))
        def toggle(uid):
            sel=f'[data-loadout=pin-position][data-uid="{uid}"]';hit(sel)
            expect(page.locator(sel+':visible').first).to_be_focused()
        response=page.goto(URL+'#shop',wait_until='domcontentloaded');assert response.body()==HTML
        hit('[data-market=item][data-id=water]');hit('[data-market=quantity][data-step="1"]');hit('[data-market=trade][data-id=water][data-qty="2"]');hit('.mk-receipt-actions [data-page=stash]')
        state=saved();assert state['wallet']==20000 and state['stash']['water']==2 and not state.get('stashPositionPins');fixed,free=[u['uid'] for u in state['stashSlots'] if u['g']=='water']
        moved(fixed,4,19);moved(free,1,16);hit(tile(fixed));toggle(fixed)
        expect(page.locator(tile(fixed))).to_have_accessible_name(re.compile('정리 위치 고정'));expect(page.locator(tile(fixed))).to_have_attribute('data-position-pinned','true')
        cash='[data-cash=select][data-cash-area=pocket]';hit(cash);page.locator('[data-cash-amount]:visible').fill('125');hit('[data-stash=place][data-x="5"][data-y="21"]');state=saved()
        note=next(u for u in state['stashSlots'] if u['g']=='cr_notes');assert note['amount']==125 and (note['x'],note['y'])==(5,21)
        hit(f'[data-cash=select][data-cash-area=stash][data-uid="{note["uid"]}"]');toggle(note['uid'])
        pinset={fixed,note['uid']};assert set(saved()['stashPositionPins'])==pinset
        control=page.locator('[data-loadout=sort]:visible').first
        if mobile:control.tap()
        else:control.focus();page.keyboard.press('Enter');expect(control).to_be_focused()
        assert coords(fixed)==(4,19,1,2) and coords(note['uid'])==(5,21,1,1) and coords(free)==(0,0,1,2)
        assert saved()['wallet']==20000 and saved()['cash']['pocket'][0]['amount']==19875
        page.reload(wait_until='domcontentloaded');assert set(saved()['stashPositionPins'])==pinset
        hit('.shell-settings');path=Path(temp)/'warehouse.json'
        with page.expect_download() as pending:hit('[data-backup=export]')
        pending.value.save_as(path);page=start(target);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL+'#stash',wait_until='domcontentloaded');assert saved()['wallet']==30000
        hit('.shell-settings');page.locator('#restore-file').set_input_files(str(path));expect(page.locator('.save-panel [role=status]')).to_contain_text('복원했습니다');page.goto(URL+'#stash',wait_until='domcontentloaded');page.reload(wait_until='domcontentloaded')
        assert coords(fixed)==(4,19,1,2) and coords(note['uid'])==(5,21,1,1) and set(saved()['stashPositionPins'])==pinset
        hit(tile(fixed));toggle(fixed);hit('[data-loadout=sort]');assert coords(fixed)!=(4,19,1,2) and set(saved()['stashPositionPins'])=={note['uid']};assert saved()['wallet']==20000 and saved()['stash']['water']==2;assert not errors,errors
        print(f'PASS {width}px: actual two-water purchase, independent placements, 125 CR note and exact water UID remain at their original cells through sort, reload and fresh native file restoration; unpin moves only that item.',flush=True)

if __name__=='__main__':
    proxy=os.getenv('RUSTLINE_PROXY')
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM') or None,proxy={'server':proxy} if proxy else None) as browser:
        for w in (390,1280):check(browser,w)
