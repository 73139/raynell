"""Chromium acceptance of published loot targeting, physical keys and partial recovery.

Run python3 build.py then python3 tests/loot-goals-browser.py. Pass --natural for
a clean 390px run on real timers and natural item rolls. The three default new
profiles fix only the deployed loot draw so each selected box has enough units
to verify partial recovery. Inventory, balances and game actions use the UI.
The v23 fixture is that game's own export during an open pantry item search.
"""
import argparse
import json
import os
import runpy
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
URL=urldefrag(os.environ.get('RUSTLINE_URL') or (ROOT/'index.html').as_uri()).url
KEY='rl-reboot-session-v36'
FIX=ROOT/'tests/fixtures/loot-goals-v23-search.json'
survivor=runpy.run_path(str(ROOT/'tests/survivor-browser.py'))
fit=survivor['fit']
until=survivor['until']
SITES=[
    (0,3,8,'provisions','supply','rl_16_14','식량 창고 열쇠'),
    (1,1,2,'medical','medic','rl_16_19','검역실 열쇠'),
    (2,2,6,'electronics','quarter','rl_16_01','보급 창고 열쇠'),
]

def read(p):
    return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',KEY)

def at(p,fragment):
    target=URL+'#'+fragment
    if p.url==target: p.reload(wait_until='domcontentloaded',timeout=60000)
    else: p.goto(target,wait_until='domcontentloaded',timeout=60000)

def profile(browser,width,now=None,wall=False):
    c=browser.new_context(viewport={'width':width,'height':844},reduced_motion='reduce',
        ignore_https_errors=os.environ.get('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    p=c.new_page()
    errors=[]
    p.on('pageerror',lambda err:errors.append(str(err)))
    p.on('dialog',lambda d:d.accept())
    p.set_default_timeout(9000)
    if not wall:
        now=now or 1800000000000
        to_time=lambda n:datetime.fromtimestamp(n/1000,timezone.utc)
        p.clock.install(time=to_time(now-86400000))
        p.clock.pause_at(to_time(now))
    at(p,'lootplan')
    p.wait_for_function('k=>!!localStorage.getItem(k)',arg=KEY)
    expect(p.locator('[data-lootplan-page]')).to_be_visible()
    return c,p,errors

def plan(p):
    if p.locator('#inside').get_attribute('data-page')!='lootplan':
        btn=p.locator('[data-page="lootplan"]:visible').first
        if btn.count(): btn.click()
        else: at(p,'lootplan')
    expect(p.locator('[data-lootplan-page]')).to_be_visible()

def category(p,goal):
    p.locator(f'[data-lootplan="goal"][data-id="{goal}"]').click()

def candidate(p,site):
    z,land,idx,goal,*_=site
    plan(p)
    category(p,goal)
    p.locator(f'[data-lootplan="region"][data-zone="{z}"]').click()
    result=p.locator(f'[data-lootplan="candidate"][data-zone="{z}"][data-landmark="{land}"]')
    if not result.is_visible():
        more=p.locator('[data-lp-more] summary, summary[data-lp-more]').first
        more.click()
    return result

def choose_goals(p):
    plan(p)
    selected_regions={}
    for goal in ('provisions','medical'):
        category(p,goal)
        p.locator('[data-lootplan="region"][data-zone="0"]').click()
        rows=p.locator('[data-lootplan-point][data-zone="0"]')
        assert rows.count()>=1
        selected_regions[goal]=rows.all_text_contents()
        # The nonempty medical table gives the new manual 40 of 1557.999 weight.
        # 0.92 * (1-40/1557.999) = 89.6379959%, shown to one decimal.
        landmark,table,probability=(3,'식량 보급 상자','95%') if goal=='provisions' else (7,'의료 상자','89.6%')
        row=p.locator(f'[data-lootplan-point][data-zone="0"][data-landmark="{landmark}"]')
        assert any(table in text and probability in text for text in row.locator('li').all_text_contents())
    assert selected_regions['provisions']!=selected_regions['medical']
    assert read(p)['objectivePin'] is None
    fit(p)

def buy(p,site):
    *_,trader,key,display=site
    at(p,'shop')
    p.locator(f'[data-market="trader"][data-id="{trader}"]').click()
    offer=p.locator(f'[data-market="item"][data-id="{key}"]:visible')
    for _ in range(15):
        if offer.count():break
        nxt=p.locator('[data-market="page"][data-step="1"]:visible')
        assert nxt.count() and nxt.is_enabled(),display
        nxt.click()
    offer.click()
    p.locator(f'[data-market="trade"][data-id="{key}"]').click()
    assert read(p)['wallet']==2000 and read(p)['stash'][key]==1

def tab(p,screen,index):
    button=p.locator(f'[data-loadout="mobile-tab"][data-screen="{screen}"][data-index="{index}"]:visible')
    if button.count():button.click()

def carry(p,site,slot):
    key=site[5]
    if slot:
        tab(p,'prep',0)
        p.locator('[data-loadout="slot"][data-slot="access"]:visible').click()
        p.locator(f'[data-gear="wear-stash"][data-id="{key}"]:visible').first.click()
        assert read(p)['equipment']['worn']['access']==key
    else:
        p.locator('[data-page="inventory"]:visible').last.click()
        tab(p,'gear',2)
        p.locator(f'[data-stash="select"][data-id="{key}"]:visible').first.click()
        tab(p,'gear',1)
        p.locator('[data-gear="cell"][data-x="0"][data-y="0"]:visible').first.click()
        assert any(i['g']==key for i in read(p)['equipment']['bag'])
        p.locator('[data-page="prep"]:visible').first.click()
    tab(p,'prep',2)

def launch(p,site,controlled):
    tab(p,'prep',2)
    if controlled:
        p.evaluate("()=>{window.__lootRand=Math.random;Math.random=()=>.70}")
    try:
        p.locator('.lo-deploy[data-raid="start"]').click()
    finally:
        if controlled:p.evaluate("()=>{Math.random=window.__lootRand;delete window.__lootRand}")
    state=read(p)
    assert state['raid']['zone']==site[0]
    assert state['field']['landmarkByZone'][site[0]]==site[1]

def evade(p,wall):
    for _ in range(12):
        f=read(p)['field']
        if not f.get('contact'):return
        if not f['action']:p.locator('[data-field="evade"]:visible').first.click()
        until(p,read(p)['field']['action']['end']+300,wall)
    raise AssertionError('contact still active')

def go_field(p):
    if p.locator('#inside').get_attribute('data-page')!='raid':
        btn=p.locator('[data-page="raid"]:visible').first
        if not btn.count():
            at(p,'map')
            btn=p.locator('[data-page="raid"]:visible').first
        btn.click()

def find_box(p,site,wall,via_plan=True):
    z,land,idx=site[:3]
    if via_plan:
        candidate(p,site).click()
        go_field(p)
    else:
        go_field(p)
        p.locator('.landmark-picker summary').click()
        p.locator(f'[data-field="landmark"][data-index="{land}"]').click()
    assert read(p)['raid']['zone']==z
    assert read(p)['field']['landmarkByZone'][z]==land
    unlock=p.locator(f'[data-lootplan="unlock"][data-index="{idx}"]:visible')
    if idx not in read(p)['field']['found'][z]:
        expect(unlock).to_have_count(0)
    while idx not in read(p)['field']['found'][z]:
        p.locator('[data-field="scan"]:visible').click()
        until(p,read(p)['field']['action']['end']+350,wall)
        evade(p,wall)
    return unlock

def deny_write(p):
    p.evaluate("""key=>{const f=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        if(this===localStorage && k===key){Storage.prototype.setItem=f;throw new DOMException('acceptance','QuotaExceededError')}
        return f.call(this,k,v)}}""",KEY)

def fork(p,browser,width,folder,contexts,error_sets):
    p.locator('.shell-settings').click()
    with p.expect_download() as dlg:p.locator('[data-backup="export"]').click()
    saved=folder/'partial.json';dlg.value.save_as(saved)
    payload=json.loads(saved.read_text())
    assert payload['session']['version']==36
    c,other,errs=profile(browser,width,p.evaluate('Date.now()'))
    contexts.append(c);error_sets.append(errs)
    other.locator('.shell-settings').click()
    other.locator('#restore-file').set_input_files(saved)
    expect(other.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    return other

def new_game(browser,width,folder,wall=False):
    site=SITES[{1280:0,390:0,320:1}[width] if not wall else 2]
    z,land,idx,goal,trader,key,display=site
    c,p,errs=profile(browser,width,wall=wall);contexts=[c];error_sets=[errs]
    try:
        assert read(p)['wallet']==30000 and not read(p)['stash']
        choose_goals(p)
        if width==390:
            candidate(p,site)
            p.locator(f'[data-lootplan="shop"][data-id="{key}"]').click()
            p.locator(f'[data-market="trade"][data-id="{key}"]:visible').click()
            assert read(p)['wallet']==2000 and read(p)['stash'][key]==1
        else:
            buy(p,site)
        candidate(p,site).click()
        destination={'goal':goal,'zone':z,'index':land}
        assert read(p)['lootDestination']==destination
        if width==390 and not wall:
            at(p,'lootplan')
            assert read(p)['lootDestination']==destination
            expect(p.locator(f'[data-lootplan="goal"][data-id="{goal}"]')).to_have_attribute('aria-pressed','true')
            at(p,'map')
            p.locator(f'[data-cui="inspect"][data-index="{z}"]').click()
            p.locator('.command-deploy[data-page="prep"]').click()
            # The correct key physically left at home cannot open the same box.
            launch(p,site,True)
            absent=find_box(p,site,False)
            expect(absent).to_be_disabled()
            assert read(p)['stash'][key]==1 and read(p)['field']['open'] is None
            p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
            until(p,read(p)['field']['action']['end']+300)
            p.locator('[data-raid="ack"]:visible').first.click()
            candidate(p,site).click()
        slot=width in (390,320)
        carry(p,site,slot)
        launch(p,site,not wall)
        correct=find_box(p,site,wall)
        expect(correct).to_be_enabled()
        fit(p)
        box_key=f'{z}-{idx}'
        pre=read(p);contents=pre['field']['boxes'][box_key]['items']
        if not wall:assert len(contents)>=2,contents
        locked_bag=pre['field']['bag'];locked_access=pre['field']['worn'].get('access')
        if width==390 and not wall:
            deny_write(p)
            correct.click()
            after=read(p);assert after['field']['open'] is None and after['field']['boxes'][box_key]['items']==contents
            expect(correct).to_be_enabled()
        correct.click()
        s=read(p)
        assert s['field']['open']==box_key and s['field']['boxes'][box_key]['items']==contents
        assert s['field']['worn'].get('access')==locked_access and s['field']['bag']==locked_bag
        if contents:
            # Reveal one specific item; hidden grid remains opaque until the search ends.
            uid=contents[0]['uid']
            tab(p,'loot',2)
            hidden=p.locator(f'[data-field="search"][data-uid="{uid}"]:visible')
            expect(hidden).to_have_attribute('aria-label','미확인 물품 수색')
            hidden.click()
            until(p,read(p)['field']['action']['end']+350,wall)
            if read(p)['field'].get('contact'):
                evade(p,wall)
            if read(p)['field']['open']!=box_key:
                p.locator(f'[data-field="open"][data-index="{idx}"]:visible').click()
            p.locator(f'[data-pick="{uid}"][data-side="loot"]:visible').click()
            take=p.locator('[data-field="take"]:visible')
            if width==390 and not wall:
                original=read(p)['field']
                deny_write(p)
                take.click()
                current=read(p)['field']
                assert current['boxes'][box_key]==original['boxes'][box_key] and current['bag']==original['bag']
                expect(p.locator('.selection-panel:visible')).to_contain_text('원래 칸')
            take.click()
            f=read(p)['field']
            assert any(o['uid']==uid for o in f['bag'])
            assert f['boxes'][box_key]['items']==contents[1:]
        else:
            p.locator('[data-field="search"]:visible').first.click()
            assert not read(p)['field']['boxes'][box_key]['items']
        if width==390 and not wall:
            before=read(p)
            p.reload(wait_until='domcontentloaded')
            assert read(p)['field']['boxes'][box_key]==before['field']['boxes'][box_key]
            p=fork(p,browser,width,folder,contexts,error_sets)
            s=read(p)
            assert s['field']['open']==box_key and s['field']['boxes'][box_key]==before['field']['boxes'][box_key]
            assert s['field']['bag']==before['field']['bag'] and s['wallet']==before['wallet']
        else:
            p.reload(wait_until='domcontentloaded')
        if p.locator('#inside').get_attribute('data-page')!='raid':
            if not p.locator('[data-page="raid"]:visible').count():at(p,'map')
            go_field(p)
        p.locator('[data-field="close"]:visible').first.click()
        opener=p.locator(f'[data-field="open"][data-index="{idx}"]:visible')
        expect(opener).to_be_enabled()
        opener.click()
        f=read(p)['field']
        assert f['boxes'][box_key]['items']==contents[1:] and read(p)['wallet']==2000
        if contents:assert sum(i['uid']==uid for i in f['bag'])==1
        p.locator('[data-field="close"]:visible').first.click()
        if width==1280 and not wall:
            other=SITES[1]
            p.locator('[data-route-card][data-from="0"][data-to="1"] [data-field="move"]:visible').first.click()
            survivor['finish_route'](p,1)
            wrong=find_box(p,other,False)
            expect(wrong).to_be_disabled()
            assert any(i['g']==key for i in read(p)['field']['bag'])
            assert read(p)['field']['open'] is None
        assert all(not group for group in error_sets),error_sets
        print(f'PASS {width}px {"natural" if wall else "clock-controlled"} fresh · two material goals, real key purchase, {"access slot" if slot else "carried bag"}, discovered and opened {box_key}, {len(contents)}→{max(0,len(contents)-1)} items, reusable key and remaining coordinates preserved.'+
              (' Includes wrong key in another region.' if width==1280 and not wall else '')+
              (' Includes key at home, quota rollback and separate-profile import.' if width==390 and not wall else ''),flush=True)
    finally:
        for ctx in contexts:ctx.close()

def legacy(browser):
    payload=json.loads(FIX.read_text())
    s=payload['session'];current=s['field']['action']['start']
    c,p,errs=profile(browser,390,current)
    try:
        p.locator('.shell-settings').click()
        p.locator('#restore-file').set_input_files(FIX)
        expect(p.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
        snap=read(p)
        assert snap['version']==36 and snap['field']['boxes']['0-8']==s['field']['boxes']['0-8']
        assert snap['field']['action']==s['field']['action'] and snap['field']['open']=='0-8'
        at(p,'map');go_field(p)
        until(p,s['field']['action']['end']+300)
        p.locator('[data-field="close"]:visible').first.click()
        p.locator('[data-field="open"][data-index="8"]:visible').click()
        assert read(p)['field']['open']=='0-8' and not read(p)['field']['worn'].get('access')
        p.locator('[data-field="close"]:visible').first.click()
        p.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        until(p,read(p)['field']['action']['end']+350)
        p.locator('[data-raid="ack"]:visible').first.click()
        candidate(p,SITES[0]).click()
        launch(p,SITES[0],True)
        expect(find_box(p,SITES[0],False)).to_be_disabled()
        assert not errs,errs
        print('PASS 390px genuine v23 migration · old open pantry retained item UIDs, coordinates and active search deadline. Keyless old run reopened it; next deployment required the correct key.',flush=True)
    finally:c.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('widths',type=int,nargs='*');parser.add_argument('--natural',action='store_true')
    args=parser.parse_args()
    options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}
    if os.getenv('RUSTLINE_CHROMIUM'):options['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):options['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as w,TemporaryDirectory() as temp:
        b=w.chromium.launch(**options)
        try:
            for width in args.widths or ([390] if args.natural else [1280,390,320]):
                new_game(b,width,Path(temp),args.natural)
            if not args.widths and not args.natural:legacy(b)
        finally:b.close()
