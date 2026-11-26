"""Restore an earned clinic export and make a new dressing for the two-stage field comparison.
Set RUSTLINE_WARD_PAID_SAVE to an actual native paid-clinic backup. --natural leaves clock and RNG alone.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
BASE=urldefrag(os.getenv('RUSTLINE_URL') or 'https://rustline-ward-packing.test/').url
HTML=(ROOT/'index.html').read_bytes()
KEY='rl-reboot-session-v36'
JOB='ward-packing'
ITEM='rl_craft_dressing'

def play(browser,width,zone,path,natural):
    mobile=width==390
    with browser.new_context(viewport={'width':width,'height':844},is_mobile=mobile,has_touch=mobile,reduced_motion='reduce',
                             ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1') as c:
        if not os.getenv('RUSTLINE_URL'):
            c.route(BASE+'**',lambda r:r.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
        if not natural:c.add_init_script('Math.random=()=>0.1')
        p=c.new_page();p.set_default_timeout(8000)
        if not natural:
            start=json.loads(path.read_text())['session']['hideout']['wardTrial']['paid']['at']
            p.clock.install(time=datetime.fromtimestamp(max(1800005000000,start+60000)/1000,timezone.utc))
        errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        p.on('dialog',lambda d:d.accept())
        def saved():return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)
        def click(sel):
            loc=p.locator(sel+':visible').first
            if mobile:loc.tap()
            else:loc.click()
        def nav(fragment):p.goto(BASE+'#'+fragment,wait_until='domcontentloaded')
        def settle():
            for _ in range(100):
                f=saved()['field']
                if f.get('result'):return
                if f.get('action'):
                    if natural:p.wait_for_function('k=>!JSON.parse(localStorage.getItem(k)).field.action',arg=KEY,polling=250,timeout=60000)
                    else:p.clock.fast_forward(max(350,f['action']['end']-p.evaluate('Date.now()')+350))
                elif f.get('contact'):click('[data-field=evade]')
                elif f.get('journey') and f['journey'].get('event')=='supply':click('[data-field=journey-pass]')
                elif f.get('journey'):p.wait_for_timeout(100) if natural else p.clock.fast_forward(350)
                else:return
            raise AssertionError('Field failed to settle')
        def search(i):
            sel=f'[data-field=open][data-index="{i}"]'
            for _ in range(3):
                lock=p.locator(f'[data-lootplan=unlock][data-index="{i}"]:visible')
                if lock.count():lock.click();break
                if p.locator(sel+':visible').count():click(sel);break
                click('[data-field=scan]');settle()
            if not saved()['field']['open']:click(sel)
            tab='[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
            if p.locator(tab+':visible').count():click(tab)
            if p.locator('.lo-search').is_enabled():click('.lo-search');settle()
            assert saved()['field']['boxes'][f'{zone}-{i}']['complete']
            click('[data-field=close]')

        response=p.goto(BASE+'#clinic',wait_until='domcontentloaded',timeout=90000)
        assert response and response.body()==HTML
        click('.shell-settings')
        with p.expect_file_chooser() as selector:click('[data-backup=import]')
        selector.value.set_files(path)
        expect(p.locator('.save-panel [role=status]')).to_contain_text('복원했습니다')
        nav('clinic');initial=saved();trial=initial['hideout']['wardTrial']['paid']
        before={u['uid'] for u in initial['stashSlots'] if u['g']==ITEM}
        click('[data-hideout=produce][data-recipe=folded-dressing]')
        deadline=saved()['hideout']['production']['med']['end']
        assert saved()['stash'].get('gauze',0)==initial['stash']['gauze']-1
        assert saved()['stash'].get('bandage',0)==initial['stash']['bandage']-1
        click('[data-hideout=ward-referral]')
        click('[data-contract=ward-trial][data-step=followup]')
        expect(p.locator('.bu-order-title h2')).to_have_text('회수 포장 대조')
        assert not saved()['career']['order']
        click(f'[data-order="{JOB}"]');click(f'[data-objective=pin][data-id="{JOB}"]')
        cost=0
        if zone==1:
            nav('shop');click('[data-market=trader][data-id=medic]');click('[data-market=item][data-id=rl_16_19]')
            buy=p.locator('[data-market=trade][data-id=rl_16_19]:visible')
            if buy.count():buy.click()
            else:click('[data-cart=add][data-id=rl_16_19]');click('[data-cart=checkout]')
            cost=28000
            nav('stash');click('[data-stash=select][data-id=rl_16_19]');click('[data-gear=wear-stash][data-id=rl_16_19]')
        nav('clinic')
        if natural:p.wait_for_function('key=>!JSON.parse(localStorage.getItem(key)).hideout.production.med',arg=KEY,polling=300,timeout=135000)
        else:p.clock.fast_forward(max(500,deadline-p.evaluate('Date.now()')+500))
        s=saved();ids=[u['uid'] for u in s['stashSlots'] if u['g']==ITEM and u['uid'] not in before];assert len(ids)==1
        uid=ids[0];assert uid!=trial['uid']
        nav('stash');click(f'[data-stash=select][data-uid="{uid}"]');click(f'[data-gear=pack][data-unit="{uid}"]')
        assert any(u['uid']==uid for u in saved()['equipment']['bag'])
        nav('map');click(f'.command-station[data-index="{zone}"]');click('.command-deploy[data-page=prep]');click('.lo-deploy[data-raid=start]')
        rid=saved()['raid']['startedAt'];point,index,second=(7,14,15) if zone==0 else (1,2,6)
        click('.landmark-picker summary');click(f'[data-field=landmark][data-index="{point}"]')
        expect(p.locator('[data-ward-check=search]')).to_be_visible();expect(p.locator('[data-field=ward-compare]')).to_have_count(0)
        search(index)
        compare=p.locator(f'[data-field=ward-compare][data-uid="{uid}"]')
        expect(compare).to_be_enabled();compare.focus();compare.tap() if mobile else p.keyboard.press('Enter')
        expect(p.locator('[data-ward-check=marked]')).to_contain_text('정상 탈출')
        record=saved()['field']['wardCheck']
        assert record['uid']==uid and record['raidId']==rid and record['site']==zone
        p.reload(wait_until='domcontentloaded')
        assert saved()['field']['wardCheck']==record
        if p.locator('#inside').get_attribute('data-page')!='raid':
            nav('map');click(f'.command-station[data-index="{zone}"]');click('.command-deploy[data-page=raid]')
        search(second)
        if zone:click('[data-route-card][data-to="0"] [data-field=move]');settle()
        click('[data-field=extract][data-exit=b04]');settle()
        report=saved()['lastSummary'];assert (report['commission'],report['missionXp'],report['rating'])==(18000,75,'success')
        click('[data-raid=ack]');p.reload(wait_until='domcontentloaded');s=saved()
        assert s['wallet']==initial['wallet']-cost+18000 and s['career']['done'].count(JOB)==1
        assert s['career']['wardCheckReceipt']==record and s['hideout']['wardTrial']['paid']==trial
        assert sum(u['uid']==uid and u['g']==ITEM for u in s['stashSlots'])==1
        assert s['finale']==initial['finale'] and not errors,errors
        print(f'PASS {width}px zone {zone}, {"natural" if natural else "controlled"}: newly made 120-second dressing '
              f'{uid}, searched cases {index}/{second}, {report["elapsed"]}ms, identical UID in warehouse, '
              f'{initial["wallet"]} - {cost} + 18000 = {s["wallet"]} CR and 75 XP once.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--natural',action='store_true')
    parser.add_argument('--zone',type=int,choices=[0,1])
    parser.add_argument('widths',nargs='*',type=int)
    a=parser.parse_args();earned=os.getenv('RUSTLINE_WARD_PAID_SAVE')
    if a.natural and not earned:parser.error('natural runs require RUSTLINE_WARD_PAID_SAVE')
    with TemporaryDirectory(prefix='rustline-ward-') as tmp,sync_playwright() as pw:
        path=Path(earned).resolve() if earned else Path(tmp)/'paid.json'
        if not earned:subprocess.run(['node','tests/ward-packing.cjs'],cwd=ROOT,check=True,env={**os.environ,'RUSTLINE_EXPORT_WARD_PAID':str(path)})
        proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
        with pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
            for width in a.widths or [390,1280]:
                for zone in ([a.zone] if a.zone is not None else [0,1]):play(browser,width,zone,path,a.natural)
