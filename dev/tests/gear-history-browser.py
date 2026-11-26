"""Earn three independent game receipts, then restore the real downloaded file in a new profile."""
import json
import os
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
KEY='rl-reboot-session-v36'
URL=urldefrag(os.getenv('RUSTLINE_URL') or 'https://gear-history.test/').url


def play(browser,width):
    mobile=width==390
    errors=[]
    with ExitStack() as stack, TemporaryDirectory(prefix='rustline-gear-history-') as folder:
        def profile():
            c=stack.enter_context(browser.new_context(viewport={'width':width,'height':844},is_mobile=mobile,has_touch=mobile,
                reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1'))
            if not os.getenv('RUSTLINE_URL'):
                c.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
            p=c.new_page();p.set_default_timeout(8000)
            p.on('dialog',lambda dialog:dialog.accept())
            p.on('pageerror',lambda e:errors.append(str(e)))
            r=p.goto(URL+'#map',wait_until='domcontentloaded',timeout=90000)
            assert r.ok and r.body()==HTML
            p.wait_for_function('k=>!!localStorage.getItem(k)',arg=KEY)
            return c,p

        def click(sel):
            loc=p.locator(sel+':visible').first
            if mobile:loc.tap()
            else:loc.click()

        def saved():
            return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)

        def journal():
            if p.locator('.nav [data-page=journal]:visible').count():click('.nav [data-page=journal]')
            else:
                click('.nav [data-page=more]');click('.shortcut-grid [data-page=journal]')

        def map_page():
            if p.locator('#inside').get_attribute('data-page')=='map':return
            p.goto(URL+'#map',wait_until='domcontentloaded')
            if p.locator('#inside').get_attribute('data-page')!='map':p.reload(wait_until='domcontentloaded')

        c,p=profile()
        uid=saved()['equipment']['instances']['primary']['uid']
        def sortie(stage):
            map_page()
            click('.command-station[data-index="0"]')
            click('.command-deploy[data-page=prep]');click('.lo-deploy[data-raid=start]')
            if stage=='left':
                click('.nav [data-page=inventory]')
                tab=p.locator('[data-loadout=mobile-tab][data-screen=gear][data-index="0"]:visible')
                if tab.count():tab.click()
                click('[data-loadout=slot][data-slot=primary]')
                click('[data-gear=ground-worn][data-slot=primary]')
                assert any(u.get('gear',{}).get('uid')==uid for u in saved()['field']['gearGround'][0])
                map_page();click('.command-deploy[data-page=raid]')
            click('[data-field=extract][data-exit=b04]')
            expect(p.locator('.result-panel')).to_be_visible(timeout=17000)
            snap=saved()
            assert snap['career']['history'][0]['gearReport']==snap['lastSummary']['gearReport']
            if stage=='empty':expect(p.locator('.gear-use-report')).to_have_count(0)
            else:
                expect(p.locator('.gear-use-report')).to_contain_text(uid)
                expect(p.locator('.gear-use-report')).to_contain_text({'left':'현장에 남김','returned':'회수'}[stage])
            click('[data-raid=ack]')

        for stage in ['returned','left','empty']:sortie(stage)
        before=saved()
        assert before['wallet']==30000 and before['career']['returns']==3
        click('.shell-settings')
        with p.expect_download() as download:click('[data-backup=export]')
        path=Path(folder)/download.value.suggested_filename
        download.value.save_as(path)
        assert json.loads(path.read_bytes())['session']['career']['history']==before['career']['history']
        p.close();c.close()
        c,p=profile()
        assert not saved()['career']['history']
        click('.shell-settings')
        with p.expect_file_chooser() as chooser:click('[data-backup=import]')
        chooser.value.set_files(path)
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습')
        assert saved()['career']['history']==before['career']['history'] and saved()['wallet']==30000
        p.reload(wait_until='domcontentloaded');journal()
        expect(p.locator('.bu-log-detail')).to_have_count(0)
        for i,word in [(2,'회수'),(1,'현장에 남김'),(0,'개별 정산 장비 없음')]:
            button=p.locator(f'[data-bui=history][data-index="{i}"]')
            if mobile:button.tap()
            else:
                button.focus();p.keyboard.press('Enter');expect(button).to_be_focused()
            expect(button).to_have_attribute('aria-expanded','true')
            detail=p.locator('.bu-log-detail');expect(detail).to_have_count(1)
            expect(detail).to_contain_text(word)
            if i:
                pile=detail.locator('.gear-use-report');expect(pile).to_contain_text(uid)
                expect(pile).to_contain_text('탄약 30 → 30');expect(pile).to_contain_text('내구도 100 → 100')
                if mobile:
                    assert button.bounding_box()['height']>=44
                    assert detail.bounding_box()['width']<=p.locator('.bu-table-wrap').bounding_box()['width']
                if os.getenv('RUSTLINE_GEAR_SHOTS') and i==1:
                    out=Path(os.environ['RUSTLINE_GEAR_SHOTS']);out.mkdir(exist_ok=True,parents=True)
                    detail.screenshot(path=str(out/f'gear-history-{width}.png'),animations='disabled')
            else:expect(detail.locator('.gear-use-report')).to_have_count(0)
            if mobile:button.tap()
            else:p.keyboard.press('Space')
            expect(detail).to_have_count(0)
        assert not errors,errors
        print(f'PASS {width}px natural clock: same UID returned → left → absent, 3 exact receipts in new profile after file restore, keyboard/touch expand/collapse and real balance unchanged',flush=True)


if __name__=='__main__':
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        for width in [390,1280]:play(browser,width)
