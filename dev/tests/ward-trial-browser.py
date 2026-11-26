"""Clinic commission through native register, craft, trader hand-in and JSON backup controls."""
import argparse
import json
import os
import re
import runpy
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
base=runpy.run_path(str(ROOT/'tests/survivor-browser.py'))
ward=runpy.run_path(str(ROOT/'tests/ward-manual-browser.py'))
at,snap=ward['at'],ward['snapshot']
ITEM='rl_craft_dressing'


def medic(p):
    at(p,'quests')
    p.locator('[data-contract="trader"][data-id="medic"]:visible').click()


def screen(p,where):
    base['fit'](p)
    if os.getenv('RUSTLINE_TRIAL_SCREENSHOTS'):
        dest=Path(os.environ['RUSTLINE_TRIAL_SCREENSHOTS'])
        dest.mkdir(parents=True,exist_ok=True)
        p.locator('[data-ward-trial]').scroll_into_view_if_needed()
        p.screenshot(path=str(dest/f'의료납품_{where}_{p.viewport_size["width"]}px.png'),animations='disabled')


def test(browser,width,payload,clock,folder):
    c,p,errors=base['profile'](browser,width,clock)
    other=None
    try:
        medic(p);expect(p.locator('[data-ward-trial]')).to_have_count(0)
        base['import_profile'](p,payload)
        medic(p)
        expect(p.locator('#inside')).not_to_contain_text('현장 의료 시범 납품')
        ward['enter_med'](p)
        expect(p.locator('[data-ward-referral]')).to_have_count(0)
        pre=snap(p);old_standing=pre['contracts'];pin=pre['objectivePin']
        assert pre['hideout']['levels']['med']>=1 and not pre['hideout']['wardManual']['registered']
        p.locator('[data-hideout="manual-register"]:visible').first.click()
        p.locator('[data-hideout="ward-referral"]:visible').click()
        expect(p.locator('[data-ward-trial="available"]')).to_be_visible()
        expect(p.locator('[data-contract="trader"][data-id="medic"]')).to_have_attribute('aria-pressed','true')
        p.locator('[data-contract="ward-trial"][data-step="accept"]').click()
        expect(p.locator('[data-ward-trial="active"]')).to_contain_text('필요 1개')
        p.locator('[data-ward-trial] [data-bui="facility"]').click()
        start=snap(p)
        for _ in range(2):
            p.locator(ward['RECIPE']).click()
            end=snap(p)['hideout']['production']['med']['end']
            ward['advance'](p,end,False)
        crafted=snap(p);assert crafted['stash'].get(ITEM,0)==start['stash'].get(ITEM,0)+2
        for item in ('gauze','bandage'):assert crafted['stash'].get(item,0)==start['stash'].get(item,0)-2
        medic(p)
        panel=p.locator('[data-ward-trial="active"]')
        copies=sorted([u for u in crafted['stashSlots'] if u['g']==ITEM],key=lambda u:(u['y'],u['x']))
        assert len(copies)>=2
        first,selected=copies[:2]
        expect(panel.locator(f'[data-uid="{selected["uid"]}"]')).to_have_attribute('aria-label',f'창고 {selected["y"]+1}행 {selected["x"]+1}열의 처치포 한 개 납품')
        screen(p,'선택')
        observer=None;observer_errors=[]
        if width==390:
            observer=c.new_page();observer.set_default_timeout(9000)
            observer.on('pageerror',lambda err:observer_errors.append(str(err)))
            at(observer,'quests')
            expect(observer.locator('html')).to_have_class(re.compile(r'\bread-only\b'))
        target=panel.locator(f'[data-step="deliver"][data-uid="{selected["uid"]}"]')
        if width==390:
            base['deny_next_write'](p)
            target.click()
            expect(panel.locator('[role="status"]')).to_contain_text('저장하지 못했습니다')
            failed=snap(p);assert failed['stashSlots']==crafted['stashSlots'] and failed['cash']==crafted['cash'] and failed['career']['xp']==crafted['career']['xp']
        target.click()
        paid=snap(p);expect(p.locator('[data-ward-trial-receipt]')).to_contain_text('10,000 CR 입금 · +25 XP')
        expect(p.locator('[data-contract="ward-trial"][data-step="deliver"]')).to_have_count(0)
        assert paid['wallet']==crafted['wallet']+10000 and paid['career']['xp']==crafted['career']['xp']+25
        assert paid['contracts']==old_standing and paid['objectivePin']==pin
        assert sum(u['g']==ITEM for u in paid['stashSlots'])==len(copies)-1
        assert any(u['uid']==first['uid'] for u in paid['stashSlots']) and not any(u['uid']==selected['uid'] for u in paid['stashSlots'])
        receipt=paid['hideout']['wardTrial']['paid'];assert receipt['uid']==selected['uid']
        screen(p,'완료')
        if observer:
            expect(observer.locator('#shell-wallet')).to_contain_text(f'{paid["wallet"]:,}')
            assert snap(observer)['hideout']['wardTrial']['paid']==receipt
            observer.close()
            backup=base['export_profile'](p,folder/'paid-ward.json')
            other,p2,errs=base['profile'](browser,width,p.evaluate('Date.now()'))
            base['import_profile'](p2,backup);medic(p2)
            expect(p2.locator('[data-ward-trial="paid"]')).to_be_visible()
            assert snap(p2)['hideout']['wardTrial']['paid']==receipt and snap(p2)['wallet']==paid['wallet']
            assert not errs and not observer_errors,(errs,observer_errors)
        p.reload(wait_until='domcontentloaded');medic(p)
        expect(p.locator('[data-ward-trial="paid"]')).to_be_visible()
        assert snap(p)['hideout']['wardTrial']['paid']==receipt
        assert not errors,errors
        print(f'PASS {width}px previously unseen clinic commission, register recovered original, accept via clinic referral, two actual 2-minute crafts, deliver second exact coordinate/UID; CR +10,000, XP +25, earlier normal commission and pin survive, reload retains receipt.'+
              (' Includes write failure then retry, read-only second-tab update and separate-profile native JSON restore.' if width==390 else ''),flush=True)
    finally:
        c.close()
        if other:other.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('widths',type=int,nargs='*')
    args=parser.parse_args();opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}
    if os.getenv('RUSTLINE_CHROMIUM'):opts['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):opts['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with TemporaryDirectory() as temp,sync_playwright() as w:
        folder=Path(temp);file=folder/'earned.json'
        subprocess.run(['node','tests/ward-trial.cjs'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,env={**os.environ,'RUSTLINE_TRIAL_CHECKPOINT':str(file)})
        payload=json.loads(file.read_text());clock=int(Path(str(file)+'.time').read_text())
        browser=w.chromium.launch(**opts)
        try:
            for width in args.widths or [1280,390]:test(browser,width,payload,clock,folder)
        finally:browser.close()
