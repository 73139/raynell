"""Run python build.py, then python tests/onboarding-browser.py with Playwright and Chromium.
Optional RUSTLINE_URL, RUSTLINE_CHROMIUM, RUSTLINE_PROXY and RUSTLINE_IGNORE_HTTPS_ERRORS=1
select a deployment, browser or proxy. Only disposable browser profiles are used.
Timers advance through Playwright's clock; the game generates its own loot and writes all progress.
"""
import json
import os
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright


TESTS = Path(__file__).resolve().parent
URL = urldefrag(os.environ.get('RUSTLINE_URL') or (TESTS.parent / 'index.html').as_uri()).url
SAVE = 'rl-reboot-session-v35'
OLD = 'rl-reboot-session-v18'
PANEL = '[data-guide-panel]'
NEXT = '[data-guide="next"]'
PANTRY = 'supply-pantry'


def snapshot(page):
    return page.evaluate('key => JSON.parse(localStorage.getItem(key))', SAVE)


def start_page(context, hash_route='#guide', saved=None):
    if saved:
        argument = json.dumps({'key': OLD, 'data': saved})
        context.add_init_script(f"""(()=>{{const a={argument};
        if(!localStorage.getItem(a.key)) localStorage.setItem(a.key,JSON.stringify(a.data));}})()""")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_default_timeout(6500)
    page.clock.install()
    response = page.goto(URL + hash_route, wait_until='domcontentloaded', timeout=60000)
    if URL.startswith('http'):
        assert response and response.ok, 'Production game must respond successfully'
    page.wait_for_function('key => !!localStorage.getItem(key)', arg=SAVE)
    return page, errors


def context_for(browser, width):
    return browser.new_context(viewport={'width': width, 'height': 844},
                               reduced_motion='reduce',
                               ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1')


def panel(page):
    return page.locator(PANEL + ':visible').first


def next_button(page):
    return panel(page).locator(NEXT).first


def wait_timed_action(page):
    action = snapshot(page)['field']['action']
    if not action:
        return False
    now = page.evaluate('Date.now()')
    page.clock.fast_forward(max(300, action['end'] - now + 350))
    return True


def layout(page):
    overflow = page.evaluate("""() => {
      const content = document.querySelector('.content');
      return [document.documentElement.scrollWidth - innerWidth, content.scrollWidth - content.clientWidth];
    }""")
    assert max(overflow) <= 1, f'horizontal overflow {overflow}'
    button = next_button(page)
    if button.count() and button.is_enabled():
        button.scroll_into_view_if_needed()
        assert button.evaluate("""e => {
          const b=e.getBoundingClientRect();
          const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
          return !!hit && e.contains(hit);
        }"""), 'The next-action button must be clickable without a fixed overlay'


def advance_until(page, predicate, limit=30):
    history = []
    for _ in range(limit):
        state = snapshot(page)
        if predicate(state):
            return history
        if wait_timed_action(page):
            continue
        current = panel(page)
        expect(current).to_be_visible()
        btn = next_button(page)
        expect(btn).to_be_enabled()
        action = btn.get_attribute('data-guide-action') or btn.inner_text()
        pair = (current.get_attribute('data-guide-step'), action, page.locator('#inside').get_attribute('data-page'))
        assert history.count(pair) < 3, f'guided route loop {history}'
        history.append(pair)
        layout(page)
        btn.click()
    raise AssertionError(f'guided route did not reach its goal: {history}')


def success(browser, width):
    context = context_for(browser, width)
    try:
        page, errors = start_page(context)
        expect(panel(page)).to_have_attribute('data-guide-step', 'accept')
        trace = advance_until(page, lambda s: bool(s['raid']))
        assert snapshot(page)['contracts']['supply']['active']['id'] == PANTRY
        assert snapshot(page)['objectivePin'] == {'kind':'contract','id':PANTRY}
        expect(panel(page)).to_have_attribute('data-guide-step', 'search')
        trace += advance_until(page, lambda s: bool(s['field']['action']))
        before = snapshot(page)
        assert before['field']['action']['type'] == 'scan'
        page.reload(wait_until='domcontentloaded')
        expect(panel(page)).to_have_attribute('data-guide-step', 'search')
        after = snapshot(page)
        assert after['raid']['startedAt'] == before['raid']['startedAt']
        trace += advance_until(page, lambda s: bool(s['field']['result']))
        saved = snapshot(page)
        assert saved['field']['result'] == 'success', trace
        assert saved['contracts']['supply']['active']['progress'] == [1]
        expect(panel(page)).to_have_attribute('data-guide-step', 'debrief')
        wallet, xp = saved['wallet'], saved['career']['xp']
        trace += advance_until(page, lambda s: PANTRY in s['contracts']['supply']['done'])
        paid = snapshot(page)
        assert paid['wallet'] == wallet + 4200 and paid['career']['xp'] == xp + 25
        assert paid['contracts']['supply']['done'] == [PANTRY]
        assert paid['onboarding']['mode'] == 'completed'
        assert paid['objectivePin'] is None
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('button[data-contract="claim"][data-id="supply-pantry"]')).to_have_count(0)
        assert snapshot(page)['wallet'] == paid['wallet']
        assert snapshot(page)['career']['xp'] == paid['career']['xp']
        assert not errors, errors
        print(f'PASS {width}px new player → guide → timed scan/reload → full pantry search → B-04 → one payout (+4200 CR / +25 XP).', flush=True)
    finally:
        context.close()


def retry_and_preferences(browser, width, failed_by):
    context = context_for(browser, width)
    try:
        page, errors = start_page(context, '')
        page.locator('[data-launch="start"]').click()
        expect(panel(page)).to_have_attribute('data-guide-step','accept')
        page.locator('.shell-settings').click()
        page.locator('[data-guide="skip"]:visible').first.click()
        assert snapshot(page)['onboarding']['mode'] == 'skipped'
        page.goto(URL + '#guide')
        page.reload(wait_until='domcontentloaded')
        assert snapshot(page)['onboarding']['mode'] == 'skipped'
        expect(page.locator('[data-guide="resume"]:visible')).to_be_visible()
        page.locator('[data-guide="resume"]:visible').click()
        page.goto(URL + '#shop')
        page.locator('[data-market="item"][data-id="water"]:visible').click()
        page.locator('[data-market="trade"][data-id="water"]:visible').click()
        kept = snapshot(page)
        assert kept['stash']['water'] == 1 and kept['wallet'] == 25000
        page.goto(URL + '#guide')
        advance_until(page, lambda s: bool(s['raid']))
        initial = snapshot(page)
        assert initial['field']['worn']['primary'] == 'rl10_carbine'
        if failed_by == 'expired':
            now = page.evaluate('Date.now()')
            page.clock.fast_forward(initial['raid']['endsAt'] - now + 500)
        else:
            page.locator('[data-field="abandon"]:visible').first.click()
        expect(panel(page)).to_have_attribute('data-guide-step','failed')
        layout(page)
        failed = snapshot(page)
        assert failed['lastSummary']['rating'] == failed_by
        assert failed['wallet'] == initial['wallet']
        assert not failed['equipment']['worn']
        assert failed['stash']['water'] == 1
        stock = panel(page).locator('.guide-stock div')
        expect(stock.filter(has_text='벙커 보유')).to_contain_text('물통')
        expect(stock.filter(has_text='출격 손실')).to_contain_text('지급 배낭')
        assert failed['contracts']['supply']['active']['progress'] == [0]
        page.reload(wait_until='domcontentloaded')
        expect(panel(page)).to_have_attribute('data-guide-step','failed')
        trace = advance_until(page, lambda s: s['raid'] is None)
        assert snapshot(page)['onboarding']['step'] == 'retry'
        page.reload(wait_until='domcontentloaded')
        expect(panel(page)).to_have_attribute('data-guide-step','retry')
        if not panel(page).locator('[data-guide="issue"]').count():
            expect(next_button(page)).to_have_attribute('data-guide-action','kit')
            next_button(page).click()
        issue = page.locator('[data-guide="issue"]:visible')
        expect(issue).to_be_enabled()
        if width == 390:
            issue.click()
            assert snapshot(page)['equipment']['worn']['back'] == 'issued_pack'
        trace += advance_until(page, lambda s: bool(s['raid']))
        retry = snapshot(page)
        assert retry['raid']['startedAt'] != initial['raid']['startedAt']
        assert retry['onboarding']['step'] == 'search'
        assert retry['field']['worn'].get('back') == ('issued_pack' if width == 390 else None)
        assert not retry['field']['worn'].get('primary')
        assert retry['wallet'] == failed['wallet']
        assert retry['career']['sorties'] == 1
        assert any(x[2] == 'prep' for x in trace), trace
        assert not errors, errors
        print(f'PASS {width}px launcher → skip/reload/resume → {failed_by} → preserved purchased water → loss report → retry/reload → equipment → prep → real second sortie.', flush=True)
    finally:
        context.close()


def migration(browser):
    context = context_for(browser, 390)
    try:
        with (TESTS/'fixtures'/'possessions-v17.json').open(encoding='utf-8') as f:
            saved = json.load(f)['session']
        saved['version'] = 18
        saved['stashSlots'][0]['alias'] = '회수 물자'
        saved['contracts']['supply']['active'] = {'id':'supply-spare-flask','progress':[0]}
        saved['contracts']['medic']['active'] = {'id':'medic-field-clinic','progress':[0]}
        saved['objectivePin'] = {'kind':'contract','id':'medic-field-clinic'}
        page, errors = start_page(context, '#stash', saved)
        assert snapshot(page)['onboarding']['mode'] == 'available'
        expect(page.locator(PANEL)).to_have_count(0)
        page.locator('#pos-query').fill('회수물자')
        expect(page.locator('#pos-results [data-pos="locate"]')).to_have_count(1)
        page.locator('.shell-settings').click()
        page.locator('[data-guide="resume"]:visible').click()
        expect(panel(page)).to_have_attribute('data-guide-step','busy')
        state = snapshot(page)
        assert state['wallet'] == saved['wallet']
        assert state['contracts']['supply'] == saved['contracts']['supply']
        assert state['objectivePin'] == saved['objectivePin']
        assert state['stashSlots'] == saved['stashSlots']
        next_button(page).click()
        page.locator('[data-contract="claim"][data-id="supply-spare-flask"]:visible').click()
        advance_until(page, lambda s: s['contracts']['supply'].get('active') and
                      s['contracts']['supply']['active']['id'] == PANTRY)
        state = snapshot(page)
        assert state['objectivePin'] == saved['objectivePin']
        assert state['contracts']['medic']['active'] == saved['contracts']['medic']['active']
        assert next(box['alias'] for box in state['stashSlots'] if box['uid']=='s-rations') == '회수 물자'
        assert not errors, errors
        print('PASS 390px v0.18 returning player: opt-in, existing quest, pinned objective and case alias preserved.', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    launch = {'headless':True, 'args':['--disable-dev-shm-usage','--disable-gpu']}
    if os.environ.get('RUSTLINE_CHROMIUM'):
        launch['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.environ.get('RUSTLINE_PROXY'):
        launch['proxy'] = {'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(**launch)
        try:
            for width in (1280, 390):
                success(browser, width)
                retry_and_preferences(browser, width, 'expired' if width == 390 else 'abandoned')
            migration(browser)
        finally:
            browser.close()
