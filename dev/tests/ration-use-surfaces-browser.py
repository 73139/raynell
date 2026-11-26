"""Use a pinned delivery ration from Health and the quickbar on isolated touch and keyboard pages."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess

from playwright.sync_api import expect, sync_playwright


DEV = Path(__file__).resolve().parents[1]
URL = 'https://rustline-ration-inputs.test/'
KEY = 'rl-reboot-session-v36'
NOW = datetime(2026, 11, 26, 4, tzinfo=timezone.utc)


def operator(cadence, game):
    # Select the actual offer for this Korean calendar period and prepare two identified copies.
    js = """const {boot,clone,valid,v12}=require('./tests/game-fixture.cjs');
      const cadence=process.argv[1],now=Date.parse('2026-11-26T04:00:00Z'),g=boot({},{now}).g;
      const q=g.board('supply',cadence).entries.find(e=>e.quest.type==='delivery').quest;
      const goal=q.goals.find(v=>g.kitSupply(v.item)?.stat==='energy'),s=clone(g.s);
      const first=g.unit(goal.item),second={...g.unit(goal.item),x:first.w};
      s.equipment.bag=[first,second,{...g.unit('water'),y:2}];
      const restored=boot({[v12]:s},{now}).g;valid(restored);
      console.log(JSON.stringify({state:restored.s,quest:q.id,item:goal.item,target:goal.target}));"""
    return json.loads(subprocess.check_output(['node','-e',js,cadence,str(game)],cwd=DEV,text=True))


def run(browser, game, width, cadence, screenshot):
    fixture = operator(cadence,game)
    item,quest = fixture['item'],fixture['quest']
    assert fixture['target']==2
    html = game.read_bytes()
    touch = width < 600
    with browser.new_context(viewport={'width':width,'height':860}, has_touch=touch, is_mobile=touch,
                             offline=True, service_workers='block', reduced_motion='reduce') as ctx:
        blocked = []
        def serve(route):
            if route.request.method=='GET' and route.request.url==URL:
                route.fulfill(content_type='text/html; charset=utf-8',body=html)
            else:
                blocked.append(route.request.url)
                route.abort()
        ctx.route('**/*',serve)
        ctx.add_init_script(script='Math.random=()=>0.13;if(!localStorage.getItem("'+KEY+'"))'+
                            'localStorage.setItem("'+KEY+'",'+json.dumps(json.dumps(fixture['state']))+');')
        p = ctx.new_page()
        p.set_default_timeout(12000)
        errors = []
        p.on('pageerror', lambda err:errors.append(str(err)))
        p.clock.set_fixed_time(NOW)
        p.goto(URL+'#quests')

        def press(locator):
            if touch:
                locator.tap()
            else:
                locator.focus()
                locator.press('Enter')

        def click(selector):
            press(p.locator(selector+':visible').first)

        def read():
            return p.evaluate('key=>JSON.parse(localStorage.getItem(key))',KEY)

        def health():
            click('.nav [data-page=health]')
            tab = '[data-loadout=mobile-tab][data-screen=health][data-index="2"]'
            if p.locator(tab+':visible').count():
                click(tab)
            click(f'[data-loadout=medical][data-id="{item}"]')

        def field():
            p.goto(URL+'#map')
            click('.command-deploy[data-page=raid]')

        def finish_action():
            action = read()['field']['action']
            p.clock.set_fixed_time(datetime.fromtimestamp((action['end']+1)/1000,timezone.utc))
            p.wait_for_function('([key,end])=>JSON.parse(localStorage.getItem(key)).field.action?.end!==end',
                                arg=[KEY,action['end']])

        click('[data-contract=trader][data-id=supply]')
        click(f'[data-contract=board][data-mode="{cadence}"]')
        click(f'[data-contract=periodAccept][data-id="{quest}"]')
        click(f'[data-objective=pin][data-id="{quest}"]')
        p.goto(URL+'#map')
        click('.command-deploy[data-page=prep]')
        click('[data-raid=start]')
        health()
        units = [u for u in read()['field']['bag'] if u['g']==item]
        first,second = units
        detail = p.locator('.lo-med-detail')
        health_impact = detail.locator('[data-ration-delivery]')
        expect(health_impact).to_have_attribute('data-ration-delivery',first['uid'])
        expect(health_impact).to_have_text(re.compile('회복량 0 · 소모 없음'))
        expect(detail.locator('[data-gear=consume]')).to_be_disabled()

        # Assigning a quick slot is a configuration action and must not consume a ration.
        quick = p.locator('[data-loadout=quick][data-index="0"]')
        risk = p.locator(f'.lo-keys [data-quick-risk="{item}"]')
        before = read()['field']['bag']
        press(detail.locator('[data-loadout=assign]'))
        expect(quick).not_to_have_attribute('aria-description',re.compile('고정 의뢰'))
        expect(risk).to_have_count(0)
        press(quick)
        assert read()['field']['bag']==before
        expect(quick).to_have_attribute('aria-description',re.compile('생환 시 부족 0 → 0개'))
        expect(risk).to_have_count(0)
        click('[data-loadout=unbind]')
        expect(quick).not_to_have_attribute('aria-description',re.compile('고정 의뢰'))
        click('[data-loadout=unbind]')
        click('[data-loadout=medical][data-id=water]')
        expect(health_impact).to_have_count(0)
        expect(detail.locator('[data-ration-preview]')).to_be_visible()

        field()
        click('[data-field=scan]')
        finish_action()
        health()
        assert read()['field']['energy']<100
        expect(health_impact).to_have_attribute('data-ration-delivery',first['uid'])
        expect(health_impact).to_contain_text('생환 시 부족 0 → 1개')
        expect(quick).to_have_attribute('title',re.compile('생환 시 부족 0 → 1개'))
        press(detail.locator('[data-gear=consume]'))
        assert [u['uid'] for u in read()['field']['bag'] if u['g']==item]==[second['uid']]
        assert read()['field']['energy']==100

        field()
        click('[data-route-card][data-to="1"] [data-field=move]')
        finish_action()
        assert read()['raid']['zone']==1 and read()['field']['energy']<100
        health()
        p.reload()
        health()
        expect(health_impact).to_have_attribute('data-ration-delivery',second['uid'])
        expect(quick).to_have_attribute('aria-description',re.compile('생환 시 부족 1 → 2개'))
        caption = p.locator(f'[data-quick-delivery="{second["uid"]}"]')
        snapshot = read()['field']['bag']
        if touch:
            expect(risk).to_be_visible()
            expect(risk).to_contain_text('사용 시 납품 부족 1 → 2개')
            quick.scroll_into_view_if_needed()
            if screenshot and cadence=='daily':
                quick.evaluate("e=>e.scrollIntoView({block:'center'})")
                expect(quick).to_be_in_viewport()
                expect(risk).to_be_in_viewport()
                p.screenshot(path=str(screenshot),animations='disabled')
            assert read()['field']['bag']==snapshot
            press(quick)
        else:
            quick.focus()
            expect(caption).to_be_visible()
            expect(caption).to_contain_text('생환 시 부족 1 → 2개')
            assert read()['field']['bag']==snapshot
            p.keyboard.press('1')
        assert [u for u in read()['field']['bag'] if u['g']==item]==[]
        assert read()['field']['energy']==100 and read()['field']['bag'][0]['g']=='water'
        expect(quick).not_to_have_attribute('aria-description',re.compile('고정 의뢰'))
        p.reload()
        assert read()['field']['bag'][0]['g']=='water' and len(read()['field']['bag'])==1
        assert not errors,errors
        assert not blocked,blocked
        print(f'PASS {width}px {cadence}: accept/pin, zero gain, unrelated water, bind/unbind, stored quick slot, '
              'Health consumes first UID at 0→1, quick tap/digit consumes second UID at 1→2 after reload.',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game',type=Path,default=DEV/'index.html')
    parser.add_argument('--touch-screenshot',type=Path,help='Save daily touch warning before the quick-use tap.')
    parser.add_argument('widths',type=int,nargs='*',default=[390,1280])
    args=parser.parse_args()
    binary=os.getenv('RUSTLINE_CHROMIUM') or os.getenv('CHROMIUM_BIN')
    with sync_playwright() as pw,pw.chromium.launch(executable_path=binary) as browser:
        for viewport in args.widths:
            for period in ('daily','weekly'):
                run(browser,args.game.resolve(),viewport,period,args.touch_screenshot)
