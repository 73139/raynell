"""New player buys two identical vests and recovers them with a keyboard and with a pointer."""
import os
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT/'index.html').read_bytes()
SAVE = re.search(rb"const SAVE_KEY\s*=\s*['\"]([^'\"]+)",HTML)[1].decode()
LIVE = os.getenv('RUSTLINE_URL')
URL = LIVE or 'https://rustline-ground-focus.test/'


def reach(page, locator):
    for _ in range(240):
        if locator.evaluate('e => e===document.activeElement'):
            return
        page.keyboard.press('Tab')
    raise AssertionError('The ground control was not reached with the keyboard')


def play(browser,width):
    mobile = width < 650
    with browser.new_context(viewport={'width':width,'height':844},has_touch=mobile,
                             is_mobile=mobile and browser.browser_type.name!='firefox',
                             ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1',
                             reduced_motion='reduce') as context:
        if not LIVE:
            context.route(URL+'**',lambda route:route.fulfill(body=HTML,content_type='text/html;charset=utf-8'))
        page = context.new_page()
        page.set_default_timeout(9000)
        response = page.goto(URL+'#shop',wait_until='domcontentloaded',timeout=90000)
        assert response and response.ok and response.body()==HTML

        def click(selector):
            target=page.locator(selector+':visible').first
            target.tap() if mobile else target.click()

        def saved():
            return page.evaluate('key=>JSON.parse(localStorage.getItem(key))',SAVE)

        def visit(fragment,screen):
            page.goto(URL+'#'+fragment,wait_until='domcontentloaded')
            if page.locator('#inside').get_attribute('data-page')!=screen:
                page.reload(wait_until='domcontentloaded')
            expect(page.locator('#inside')).to_have_attribute('data-page',screen)

        def tab(screen,index):
            selector=f'[data-loadout=mobile-tab][data-screen="{screen}"][data-index="{index}"]'
            if page.locator(selector+':visible').count():
                click(selector)

        def drop_vests():
            tab('gear',1)
            for unit in [x for x in saved()['field']['bag'] if x['g']=='rl10_vest']:
                click(f'[data-side=bag][data-pick="{unit["uid"]}"]')
                click(f'[data-gear=drop][data-unit="{unit["uid"]}"]')

        assert saved()['wallet']==30000 and not saved()['stash']
        click('[data-market=trader][data-id=quarter]')
        click('[data-market=mode][data-mode=buy]')
        click('[data-market=item][data-id=rl10_vest]')
        click('[data-market=quantity][data-step="1"]')
        click('[data-market=trade][data-id=rl10_vest][data-qty="2"]')
        assert saved()['wallet']==0 and saved()['stash']['rl10_vest']==2
        for _ in range(2):
            visit('stash','stash')
            click('[data-stash=select][data-id=rl10_vest]')
            click('[data-gear=pack][data-id=rl10_vest]')
        visit('map','map')
        click('.command-station[data-index="0"]')
        click('.command-deploy[data-page=prep]')
        click('.lo-deploy[data-raid=start]')
        click('.nav [data-page=inventory]')
        drop_vests()
        tab('gear',0)
        click('[data-loadout=slot][data-slot=back]')
        click('[data-gear=ground-worn][data-slot=back]')
        tab('gear',2)
        ground=page.locator('.kit-ground')
        labels=ground.aria_snapshot()
        serials=list(dict.fromkeys(re.findall(r'B-04 방호 조끼 #([0-9a-f]{8})',labels)))
        assert len(serials)==2
        first,second=[ground.get_by_role('button',name=re.compile(s+r'.*2\.1 kg.*회수'))for s in serials]
        pack=ground.get_by_role('button',name=re.compile('지급 배낭.*다시 메기'))
        reach(page,first)
        page.keyboard.press('Enter')
        expect(second).to_be_focused()
        state=saved()['field']
        assert len(state['bag'])==1 and len(state['gearGround'][0])==2
        # Pockets are only 3 × 2. Another 2 × 2 vest cannot fit beside the first.
        page.keyboard.press('Enter')
        expect(page.locator('.lo-msg')).to_contain_text('가방에 공간이 부족합니다')
        expect(second).to_be_focused()
        assert saved()['field']['bag']==state['bag'] and saved()['field']['gearGround']==state['gearGround']
        page.keyboard.press('Tab')
        expect(pack).to_be_focused()
        page.keyboard.press('Enter')
        expect(second).to_be_focused()
        page.keyboard.press('Enter')
        empty=page.locator('[data-ground-empty]')
        expect(empty).to_be_focused()
        expect(empty).to_have_text('이 지역에 내려놓은 물품이 없습니다.')
        page.keyboard.press('Tab')
        expect(page.locator('.lo-gear .lo-layout [data-page=health]')).to_be_focused()
        assert sorted(x['gear']['uid'][-8:]for x in saved()['field']['bag'])==sorted(serials)
        # A held Enter should not consume the next physical item without a second deliberate press.
        drop_vests()
        tab('gear',2)
        reach(page,first)
        page.keyboard.down('Enter')
        expect(second).to_be_focused()
        page.keyboard.down('Enter')
        page.keyboard.up('Enter')
        expect(second).to_be_focused()
        assert len(saved()['field']['gearGround'][0])==1
        # A pointer action does not move keyboard focus to another active control.
        drop_vests()
        tab('gear',2)
        first.tap() if mobile else first.click()
        expect(second).to_be_visible()
        assert not second.evaluate('e=>e===document.activeElement')
        print(f'PASS {width}px: two purchased physical vests, adjacent focus, full-pocket retry, final empty status, forward Tab and pointer behavior.',flush=True)


if __name__=='__main__':
    proxy=os.getenv('RUSTLINE_PROXY')
    with sync_playwright() as playwright,playwright.chromium.launch(
            executable_path=os.getenv('RUSTLINE_CHROMIUM') or None,
            proxy={'server':proxy} if proxy else None) as browser:
        for width in (390,1280):
            play(browser,width)
