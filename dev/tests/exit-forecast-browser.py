"""Exercise live forecast changes and the vehicle fare with isolated Chromium profiles."""
import argparse
import os
import shutil
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://rustline-acceptance.test/'
KEY = 'rl-reboot-session-v36'


def run_case(browser, html, width):
    with browser.new_context(viewport={'width':width,'height':900}, is_mobile=width < 600,
                             has_touch=width < 600, reduced_motion='reduce') as context:
        context.route(ORIGIN + '**', lambda route: route.fulfill(body=html,content_type='text/html; charset=utf-8'))
        page = context.new_page()
        errors = []
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.clock.install()
        page.goto(ORIGIN + '#map')
        page.locator('.command-deploy[data-page=prep]').click()
        page.locator('[data-raid=start]').click()
        forecast = page.locator('[data-exit-forecast=b04]')
        expect(forecast).to_contain_text('조기 탈출')
        page.clock.fast_forward(411000)
        expect(forecast).to_contain_text('정상 탈출')
        page.locator('[data-exit=b04]').click()
        expect(forecast).to_contain_text('정상 탈출')
        page.clock.fast_forward(11000)
        expect(page.locator('.result-panel')).to_contain_text('SURVIVED')

        page.evaluate("""key => {
            const s=JSON.parse(localStorage.getItem(key)), now=Date.now(), start=now-60000;
            const current={raid:{zone:1,startedAt:start,endsAt:start+1800000},
              field:{raidId:start,bag:[],found:[[],[],[]],boxes:{},visited:[1],open:null,action:null,result:null,log:[],energy:100,water:100},
              wallet:6000,stash:{},lastSummary:null};
            localStorage.clear();localStorage.setItem('rl-reboot-session-v09',JSON.stringify(current));
        }""",KEY)
        page.goto(ORIGIN + '#map')
        page.reload()
        page.wait_for_function("key => JSON.parse(localStorage.getItem(key))?.raid?.zone === 1",arg=KEY)
        page.evaluate("""key => {
            const s=JSON.parse(localStorage.getItem(key));
            s.field.bag.push({uid:'s-acceptance-cash',g:'cr_notes',amount:8999,x:0,y:0,w:1,h:1,revealed:true});
            localStorage.setItem(key,JSON.stringify(s));
        }""",KEY)
        page.reload()
        page.locator('[data-page=raid]:visible').first.click()
        fare = page.locator('[data-exit-fare]')
        expect(fare).to_contain_text('1 CR 부족')
        expect(page.locator('[data-exit=truck]')).to_be_disabled()
        expect(page.locator('[data-exit-forecast=truck]')).to_be_hidden()
        page.evaluate("""key => {
            const s=JSON.parse(localStorage.getItem(key));s.field.bag[0].amount=10000;
            localStorage.setItem(key,JSON.stringify(s));
        }""",KEY)
        page.reload()
        page.locator('[data-page=raid]:visible').first.click()
        expect(fare).to_contain_text('벙커 6,000 CR · 휴대 10,000 CR')
        expect(fare).to_contain_text('요금 차감 후 1,000 CR')
        page.locator('[data-exit=truck]').click()
        page.clock.fast_forward(61000)
        expect(page.locator('.result-panel')).to_contain_text('탈출 비용 15,000 CR')
        page.reload()
        outcome = page.evaluate("""key => {
            const s=JSON.parse(localStorage.getItem(key));return [s.wallet,s.career.sorties,s.lastSummary.rating];
        }""",KEY)
        assert outcome == [1000,1,'quick'], outcome
        assert not errors,errors
        print(f'PASS {width}px: real button navigation, clock threshold, free/paid settlement, disabled shortage, refresh and wallet')


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('game',nargs='?',type=Path,default=ROOT/'index.html')
    game=cli.parse_args().game.read_bytes()
    with sync_playwright() as playwright:
        with playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium'),
                                        args=['--disable-dev-shm-usage']) as chromium:
            for viewport in [390,1280]:
                run_case(chromium,game,viewport)
