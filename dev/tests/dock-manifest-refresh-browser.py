"""A facility completes while a local operator is deciding which identical cargo to leave behind."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = 'https://rustline-manifest.invalid/'
KEY = 'rl-reboot-session-v36'
START = datetime(2026, 11, 26, tzinfo=timezone.utc)


def scenario(browser, width, focus_on, real_time=False):
    seed = json.loads((ROOT / 'tests/fixtures/possessions-v17.json').read_text())['session']
    seed['career']['surveyedBoxes'] = ['2-3', '2-4', '2-8']
    first = seed['equipment']['bag'][0]
    seed['equipment']['bag'].append(dict(first, uid='kit-second-water', x=1))
    due = datetime.now(timezone.utc) + timedelta(seconds=12) if real_time else START + timedelta(minutes=1)
    seed['hideout']['builds']['power'] = {'tier': 1, 'end': int(due.timestamp() * 1000)}
    with browser.new_context(viewport={'width': width, 'height': 844}, has_touch=width<600,
                             reduced_motion='reduce', service_workers='block', offline=True) as ctx:
        html = (ROOT / 'index.html').read_bytes()
        ctx.route('**/*', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8')
                  if r.request.url == URL else r.abort())
        ctx.add_init_script("if(!localStorage.getItem('rl-reboot-session-v17'))localStorage.setItem('rl-reboot-session-v17',"
                            + json.dumps(json.dumps(seed)) + ");")
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        if not real_time:
            page.clock.install(time=START - timedelta(days=1))
            page.clock.pause_at(START)
        page.goto(URL + '#map')
        def activate(control):
            if width<600:
                control.tap()
            else:
                control.focus()
                control.press('Enter')
        def prepare():
            activate(page.locator('.command-station[data-index="2"]'))
            activate(page.locator('.command-deploy[data-page="prep"]'))
        prepare()
        manifest = page.locator('[data-dock-manifest]')
        summary = manifest.locator('summary')
        activate(summary)
        keep = manifest.locator('[data-dock-omit="kit-water"]')
        omitted = manifest.locator('[data-dock-omit="kit-second-water"]')
        review = manifest.locator('[data-loadout="dock-review"][data-uid="kit-second-water"]')
        omitted.check()
        focus = {'omit': omitted, 'review': review, 'summary': summary}[focus_on]
        focus.focus()
        expected_weight = manifest.locator('output').inner_text()
        read = lambda: page.evaluate('k=>JSON.parse(localStorage.getItem(k))', KEY)
        before = read()
        assert before['hideout']['levels']['power'] == 0
        if real_time:
            page.wait_for_function('k => JSON.parse(localStorage.getItem(k)).hideout.levels.power === 1',
                                   arg=KEY, timeout=20000)
        else:
            page.clock.fast_forward(61000)
        after = read()
        assert after['hideout']['levels']['power'] == 1 and 'power' not in after['hideout']['builds']
        assert after['equipment'] == before['equipment'] and after['wallet'] == before['wallet']
        expect(manifest).to_have_attribute('open', '')
        expect(omitted).to_be_checked()
        expect(keep).not_to_be_checked()
        expect(focus).to_be_focused()
        expect(manifest.locator('output')).to_have_text(expected_weight)

        # Removing that exact unit must drop its omission; the other copy stays included.
        activate(review)
        activate(page.locator('[data-gear="unpack"]'))
        expect(omitted).to_have_count(0)
        expect(keep).not_to_be_checked()
        expect(manifest.locator('output')).to_have_text(expected_weight)
        keep.check()
        expect(manifest.locator('output')).to_contain_text('0.000 kg /')
        activate(page.locator('.nav [data-page="map"]'))
        prepare()
        expect(manifest).not_to_have_attribute('open', '')
        activate(summary)
        expect(keep).not_to_be_checked()
        expect(manifest.locator('output')).to_have_text(expected_weight)
        if focus_on == 'review':
            # A different tab loads another checkpoint, even if its physical IDs match.
            keep.check()
            helper = ctx.new_page()
            helper.route(URL, lambda r: r.fulfill(body='<title>Local test tab</title>', content_type='text/html'))
            helper.goto(URL)
            helper.evaluate('k=>{const s=JSON.parse(localStorage.getItem(k));s.revision++;localStorage.setItem(k,JSON.stringify(s))}', KEY)
            expect(manifest).not_to_have_attribute('open', '')
            activate(summary)
            expect(keep).not_to_be_checked()
            expect(manifest.locator('output')).to_have_text(expected_weight)
            helper.close()
        assert not errors, errors
        print(f'PASS {width}px {focus_on} real_time={real_time}: timer, per-instance omissions, weight, focus, removal and navigation', flush=True)


if __name__ == '__main__':
    with sync_playwright() as pw,pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
        for width in (390,1280):
            for control in ('omit','review','summary'):
                scenario(browser,width,control)
        scenario(browser,390,'omit',real_time=True)
