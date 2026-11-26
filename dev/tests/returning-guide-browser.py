"""A first-time and a returning player's optional pantry guide. Uses native backups and wall time.
RUSTLINE_GUIDE_EARNED_SAVE may point to an actual veteran backup with the pantry still available.
Without it, the test earns a return independently in the original new profile, then exports it.
"""
import argparse
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LIVE = os.getenv('RUSTLINE_URL')
URL = urldefrag(LIVE or 'https://rustline-guide.test/').url
KEY = 'rl-reboot-session-v36'
NOVICE = '첫 출격 안내'
VETERAN = '한미정의 배급소 찬장 안내'
PANTRY = 'supply-pantry'


def run(browser, width, folder):
    def profile():
        ctx = browser.new_context(viewport={'width': width, 'height': 844},
                                  ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS') == '1')
        if not LIVE:
            ctx.route(URL+'**', lambda route: route.fulfill(body=(ROOT/'index.html').read_bytes(), content_type='text/html; charset=utf-8'))
        p = ctx.new_page()
        p.set_default_timeout(10000)
        p.on('dialog', lambda d: d.accept())
        p.goto(URL+'#map', wait_until='domcontentloaded')
        return ctx, p

    def state(p):
        return p.evaluate('key=>JSON.parse(localStorage.getItem(key))', KEY)

    def click(p, selector):
        p.locator(selector+':visible').first.click()

    def backup(p, path):
        click(p, '.shell-settings')
        with p.expect_download() as result:
            click(p, '[data-backup=export]')
        result.value.save_as(path)
        return path

    def restore(p, path):
        click(p, '.shell-settings')
        with p.expect_file_chooser() as chooser:
            click(p, '[data-backup=import]')
        chooser.value.set_files(path)
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다')
        p.goto(URL+'#map')

    def guide(p, name, step):
        panel = p.get_by_role('region', name=name, exact=True)
        expect(panel).to_have_attribute('data-guide-step', step)
        assert p.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        return panel

    def fields(s):
        return {k:s[k] for k in ('wallet','equipment','campaign','finale','contracts','career','onboarding','objectivePin')}

    orig, p = profile()
    clean_path = backup(p, folder/'new.json')
    orig.close()
    fresh, p = profile()
    restore(p, clean_path)
    initial = state(p)
    assert initial['career']['returns'] == 0 and initial['wallet'] == 30000
    expect(guide(p, NOVICE, 'accept')).to_contain_text('첫 의뢰를 확인하세요')
    assert fields(initial) == fields(json.loads(clean_path.read_text())['session'])
    earned = os.getenv('RUSTLINE_GUIDE_EARNED_SAVE')
    if earned:
        vet_path = Path(earned)
    else:
        click(p,'.command-deploy[data-page=prep]')
        click(p,'.lo-deploy[data-raid=start]')
        click(p,'[data-field=extract][data-exit=b04]')
        p.wait_for_function('k=>!!JSON.parse(localStorage.getItem(k)).field.result', arg=KEY,timeout=30000)
        click(p,'[data-raid=ack]')
        assert state(p)['career']['returns'] == 1
        vet_path = backup(p,folder/'returned.json')
    fresh.close()
    vet, p = profile()
    restore(p, vet_path)
    before = state(p)
    assert fields(before) == fields(json.loads(vet_path.read_text())['session'])
    assert before['career']['returns'] and PANTRY not in before['contracts']['supply']['done']
    expect(guide(p,VETERAN,'accept')).to_contain_text('1/5')
    expect(guide(p,VETERAN,'accept')).to_contain_text('배급소 찬장 의뢰를 확인하세요')
    click(p,'.shell-settings')
    settings=p.get_by_role('region',name=VETERAN+' 설정',exact=True)
    settings.locator('[data-guide=skip]').click()
    p.reload()
    p.goto(URL+'#guide')
    p.get_by_role('region',name=VETERAN+' 설정',exact=True).locator('[data-guide=resume]').click()
    p.goto(URL+'#map')
    assert fields(state(p)) == fields(before)
    guide(p,VETERAN,'accept').locator('[data-guide-action=quest]').click()
    guide(p,VETERAN,'accept').locator('[data-guide-action=accept]').click()
    assert state(p)['contracts']['supply']['active']['id']==PANTRY
    for _ in range(4):
        if p.locator('.lo-deploy[data-raid=start]:visible').count(): break
        guide(p, VETERAN, 'deploy').locator('[data-guide=next]').click()
    expect(p.locator('.lo-deploy[data-raid=start]:visible')).to_be_visible()
    expect(guide(p,VETERAN,'deploy')).to_contain_text('배급소 식당 수색 출격')
    guide(p,VETERAN,'deploy').locator('[data-guide=next]').click()
    guide(p,VETERAN,'search')
    assert state(p)['wallet']==before['wallet'] and state(p)['career']['xp']==before['career']['xp']
    assert state(p)['campaign']==before['campaign'] and state(p)['finale']==before['finale']
    assert PANTRY not in state(p)['contracts']['supply']['done']
    for _ in range(70):
        current = state(p)
        if current['field'].get('result'):
            break
        if current['field'].get('action'):
            p.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).field.action', arg=KEY, timeout=60000)
        elif current['field'].get('contact'):
            click(p,'[data-field=evade]')
        else:
            panel = p.get_by_role('region',name=VETERAN,exact=True)
            panel.locator('[data-guide=next]').click()
    settled = state(p)
    assert settled['field']['result']=='success' and settled['contracts']['supply']['active']['progress']==[1]
    guide(p,VETERAN,'debrief').locator('[data-guide=next]').click()
    for _ in range(3):
        if PANTRY in state(p)['contracts']['supply']['done']: break
        guide(p,VETERAN,'claim').locator('[data-guide=next]').click()
    paid=state(p)
    assert paid['wallet']==settled['wallet']+4200 and paid['career']['xp']==settled['career']['xp']+25
    assert paid['contracts']['supply']['done'].count(PANTRY)==1
    p.reload();p.goto(URL+'#guide')
    completed=p.get_by_role('region',name=VETERAN+' 설정',exact=True)
    expect(completed).to_contain_text('배급소 찬장 의뢰 완료')
    assert completed.locator('[data-guide]').count()==0
    assert fields(state(p))==fields(paid)
    print(f"PASS {width}px native restored beginner (0 returns) and veteran ({before['career']['returns']} returns); optional 1/5, skip/resume, accepted, deployed, searched and returned in {settled['lastSummary']['elapsed']}ms; 4200 CR and 25 XP claimed once, completed after reload.",flush=True)
    vet.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widths',nargs='*',type=int)
    args=parser.parse_args()
    with TemporaryDirectory() as tmp,sync_playwright() as pw:
        proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
        with pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
            for width in args.widths or [390,1280]:
                run(browser,width,Path(tmp))
