"""Check the survivor's physical container trace in a clean 390 px profile."""
import os
import runpy
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

helpers = runpy.run_path(str(Path(__file__).with_name('survivor-browser.py')))
profile, first_raid, snapshot, until = [helpers[name] for name in ['profile', 'first_raid', 'snapshot', 'until']]

def run(browser, seed, first_contact):
    context, page, errors = profile(browser, 390)
    try:
        # Both seeds send the survivor to the same third container, with the first
        # contact scheduled on scan three or four respectively.
        random_setup = f"""(() => {{
            let state = {seed};
            Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
        }})()"""
        context.add_init_script(random_setup)
        page.evaluate(random_setup)
        start = first_raid(page)
        assert snapshot(page)['field']['nextContact'] == first_contact
        before = snapshot(page)['field']['boxes']
        until(page, start + 90100)
        state = snapshot(page)
        event = state['field']['survivorScavenge']
        box = event['box']
        assert box and event['uid'] in [unit['uid'] for unit in before[box]['items']]
        assert len(before[box]['items']) == len(state['field']['boxes'][box]['items']) + 1
        expect(page.get_by_text('뒤진 흔적', exact=False)).to_have_count(0)
        assert state['survivor']['active']['clues'] == []
        index = int(box.split('-')[1])
        # Evade any contact through the same control as a player. Fix only the
        # subsequent random rolls so that the in-game evasion always succeeds.
        page.evaluate("()=>{Math.random=()=>.2}")
        encounters = 0
        page.locator('.landmark-picker>summary').click()
        landmarks = page.locator('[data-field="landmark"]').evaluate_all('(buttons) => buttons.map(b=>b.dataset.index)')
        page.locator('.landmark-picker>summary').click()
        for landmark in landmarks:
            page.locator('.landmark-picker>summary').click()
            page.locator(f'[data-field="landmark"][data-index="{landmark}"]').click()
            scan = page.locator('[data-field="scan"]:visible')
            while index not in snapshot(page)['field']['found'][0] and scan.count() and scan.is_enabled():
                scan.click()
                until(page, snapshot(page)['field']['action']['end'] + 250)
                if snapshot(page)['field'].get('contact'):
                    page.locator('[data-field="evade"]:visible').click()
                    until(page, snapshot(page)['field']['action']['end'] + 250)
                    assert not snapshot(page)['field'].get('contact')
                    encounters += 1
            if index in snapshot(page)['field']['found'][0]:
                break
        target = page.locator(f'[data-field="open"][data-index="{index}"]')
        expect(target).to_contain_text('뒤진 흔적')
        target.click()
        expect(page.locator('[data-scavenge-trace]')).to_contain_text('누군가 먼저 이 상자를 뒤졌습니다')
        assert len(snapshot(page)['field']['boxes'][box]['items']) == len(before[box]['items'])-1
        assert index == 2 and encounters == int(first_contact == 3), (index, encounters)
        assert not errors, errors
        print(f'PASS 390px first contact at step {first_contact}, evaded {encounters} — one real field unit removed; no mark before discovery. Normal landmark search, scan and container opening revealed the disturbance and correct remaining contents.', flush=True)
    finally:
        context.close()

if __name__ == '__main__':
    launch = {'headless':True,'args':['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy'] = {'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as runner:
        browser = runner.chromium.launch(**launch)
        try:
            run(browser, 81, 3)
            run(browser, 11, 4)
        finally:
            browser.close()
