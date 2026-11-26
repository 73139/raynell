"""Restore representative cash receipts, expand the records and check the totals through normal navigation."""
import json
import os
from pathlib import Path
import re
from urllib.parse import urldefrag
from playwright.sync_api import expect, sync_playwright

DEV = Path(__file__).resolve().parents[1]
HTML = (DEV/'index.html').read_bytes()
KEY = re.search(rb"const SAVE_KEY\s*=\s*['\"]([^'\"]+)", HTML).group(1).decode()
LIVE = os.getenv('RUSTLINE_URL')
URL = urldefrag(LIVE or 'https://rustline-ledger.test/').url

def play(browser, width):
    mobile = width < 600
    with browser.new_context(viewport={'width':width,'height':880}, is_mobile=mobile,has_touch=mobile,
                             ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1', reduced_motion='reduce') as c:
        if not LIVE:
            c.route(URL+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        p=c.new_page()
        p.set_default_timeout(8500)
        p.on('dialog',lambda d:d.accept())
        errors=[]
        p.on('pageerror',lambda error:errors.append(str(error)))
        def click(css):
            target=p.locator(css+':visible').first
            target.tap() if mobile else target.click()
        def save():
            return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def journal():
            if p.locator('.nav [data-page=journal]:visible').count():
                click('.nav [data-page=journal]')
            else:
                click('.nav [data-page=more]')
                click('.shortcut-grid [data-page=journal]')
        response=p.goto(URL+'#map',wait_until='domcontentloaded',timeout=90000)
        assert response and response.ok and response.body()==HTML
        p.wait_for_function('k=>!!localStorage.getItem(k)',arg=KEY)
        journal()
        expect(p.locator('[data-recent-settlements]')).to_have_count(0)
        state=save()
        rows=[('success',10000,12000,0,22000),('quick',5000,0,15000,-10000),('expired',7000,0,0,0)]
        state['career'].update(sorties=4,returns=3,history=[
            {'rating':rating,'elapsed':60000,'xp':0,'carriedCash':carried,'commission':reward,'cost':cost,'cash':net}
            for rating,carried,reward,cost,net in rows]+[{'rating':'quick','elapsed':4000,'xp':25}])
        click('.shell-settings')
        p.locator('#restore-file').set_input_files({'name':'records.json','mimeType':'application/json',
             'buffer':json.dumps({'format':'rustline-tc01','session':state}).encode()})
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다')
        journal()
        def check_panel():
            details=p.locator('[data-recent-settlements]')
            expect(details.locator('summary')).to_have_text('최근 4회 정산 분석 · 귀환 3회')
            if details.get_attribute('open') is None:
                if mobile:details.locator('summary').tap()
                else:
                    details.locator('summary').focus()
                    p.keyboard.press('Enter')
            expect(details.locator('[data-records-coverage]')).to_contain_text('3 / 4회')
            for key,value in {'net':'12,000','recovered':'15,000','orders':'12,000','fees':'15,000','lost':'7,000'}.items():
                expect(details.locator('[data-records-amount="'+key+'"]')).to_have_text(value+' CR')
            assert details.evaluate('(node)=>node.scrollWidth<=node.clientWidth+1')
        before=save()
        check_panel()
        after=save()
        assert (before['career'],before['wallet'])==(after['career'],after['wallet'])
        p.reload(wait_until='domcontentloaded')
        p.goto(URL+'#map',wait_until='domcontentloaded')
        journal()
        check_panel()
        assert save()['career']['history']==before['career']['history'] and not errors
        print('PASS',width,'px: modern and legacy receipts, recovered and lost banknotes, commissions, exit costs, net wallet balance, touch/keyboard and reload.')

if __name__=='__main__':
    opts={'headless':True}
    if os.getenv('RUSTLINE_CHROMIUM'):opts['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):opts['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as pw,pw.chromium.launch(**opts) as b:
        for width in (390,1280):play(b,width)
