"""Pin a timed delivery, drop/recover identified lamps, and inspect marginal delivery amounts offline."""
import json
import os
from datetime import datetime, timedelta, timezone
import re
from pathlib import Path
import subprocess

from playwright.sync_api import expect, sync_playwright


DEV = Path(__file__).resolve().parents[1]
URL = 'https://rustline-ground-delivery.test/'
KEY = 'rl-reboot-session-v36'
START = datetime(2026, 12, 10, 4, tzinfo=timezone.utc)


def run(browser, width, cadence):
    mobile = width < 600
    seed = subprocess.check_output([
        'node', '-e', "const {operator}=require('./tests/ground-delivery.cjs');console.log(JSON.stringify(operator(process.argv[1]).g.s))", cadence
    ], cwd=DEV, text=True)
    html = (DEV / 'index.html').read_bytes()
    with browser.new_context(viewport={'width':width, 'height':900}, is_mobile=mobile, has_touch=mobile,
                             offline=True, service_workers='block', reduced_motion='reduce') as context:
        context.route('**/*', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8')
                      if r.request.url == URL else r.abort())
        context.add_init_script(script="if(!localStorage.getItem('"+KEY+"'))localStorage.setItem('"+KEY+"',"+json.dumps(seed)+");")
        p = context.new_page()
        p.set_default_timeout(20000)
        errors = []
        p.on('pageerror', lambda error: errors.append(str(error)))
        p.clock.set_fixed_time(START)
        p.goto(URL+'#quests')

        def press(control):
            if mobile:
                control.tap()
            else:
                control.focus()
                control.press('Enter')

        def click(selector):
            press(p.locator(selector+':visible').first)

        def data():
            return p.evaluate('key=>JSON.parse(localStorage.getItem(key))', KEY)

        def gear(tab):
            if p.locator('#inside').get_attribute('data-page') != 'inventory':
                click('.nav [data-page=inventory]')
            target = f'[data-loadout=mobile-tab][data-screen=gear][data-index="{tab}"]'
            if p.locator(target+':visible').count():
                click(target)

        click('[data-contract=trader][data-id=quarter]')
        click(f'[data-contract=board][data-mode="{cadence}"]')
        quest = 'daily-quarter-delivery-lamp' if cadence == 'daily' else 'weekly-quarter-delivery-lights'
        required = 1 if cadence == 'daily' else 3
        click(f'[data-contract=periodAccept][data-id="{quest}"]')
        click(f'[data-objective=pin][data-id="{quest}"]')
        p.goto(URL+'#map')
        click('.command-deploy[data-page=prep]')
        click('[data-raid=start]')
        gear(1)
        bag = data()['field']['bag']
        bare = [u for u in bag if u['g']=='flash' and not u['gear'].get('module')]
        fitted = next(u for u in bag if u.get('gear', {}).get('module'))
        for unit in bag:
            click(f'[data-pick="{unit["uid"]}"][data-side=bag]')
            click(f'[data-gear=drop][data-unit="{unit["uid"]}"]')
        gear(2)

        def button(unit):
            return p.locator(f'[data-gear=recover][data-unit="{unit["uid"]}"]')

        panel = p.locator('.kit-ground')
        expect(panel.locator('[data-ground-delivery]')).to_have_count(required+2)
        expect(button(fitted)).to_have_accessible_name(re.compile('모듈을 분리해야 납품 가능'))
        press(button(fitted))
        for i in range(required):
            expect(button(bare[i])).to_have_accessible_name(re.compile(
                f'현장 가방 납품 가능 {i}개 · 현재 생환 시 부족 {required-i}개'))
            press(button(bare[i]))
        expect(button(bare[-1])).to_have_accessible_name(re.compile('현재 가방으로 생환하면 이 품목 충족'))
        assert panel.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
        p.reload()
        gear(2)
        expect(button(bare[-1])).to_have_accessible_name(re.compile('현재 가방으로 생환하면 이 품목 충족'))
        assert {u['uid'] for u in data()['field']['bag']} == {u['uid'] for u in [fitted,*bare[:required]]}
        p.goto(URL+'#map')
        click('.command-deploy[data-page=raid]')
        click('[data-field=extract][data-exit=b04]')
        p.clock.set_fixed_time(START + timedelta(seconds=11))
        expect(p.locator('.result-panel')).to_be_visible()
        assert data()['stash']['flash'] == required+1
        assert not errors, errors
        print(f'PASS {width}px {cadence}: real board pin, drop, accessible matching/fitted/surplus rows, exact pickup, reload and extraction.')


if __name__ == '__main__':
    executable = os.getenv('RUSTLINE_CHROMIUM') or os.getenv('CHROMIUM_BIN')
    with sync_playwright() as p, p.chromium.launch(executable_path=executable) as browser:
        for width in (390,1280):
            for cadence in ('daily','weekly'):
                run(browser,width,cadence)
