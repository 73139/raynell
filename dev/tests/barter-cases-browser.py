"""An earned profile from tests/barter-cases.cjs; native bunker UI, restore, merchant and search."""
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
hunt=runpy.run_path(str(ROOT/'tests/barter-hunt-browser.py'))
common=hunt['common']
pos=runpy.run_path(str(ROOT/'tests/possessions-browser.py'))
at,snapshot=common['at'],common['snapshot']
FABRIC,RECIPE='rl_x_fabric','rl_x_ammo'


def case_panel(p,box):
    return p.locator(f'.sc-case[data-case-uid="{box}"]')


def store(p,box,label,items):
    pos['rename'](p,box,label)
    panel=case_panel(p,box)
    if panel.locator('[data-stash="case-open"]').count():panel.locator('[data-stash="case-open"]').click()
    for item in items:
        panel.locator(f'[data-stash="case-put"][data-id="{item}"]').click()


def see_cases(p,item,amount):
    d=p.locator(f'[data-material-cases="{item}"]')
    expect(d.locator('summary')).to_contain_text(f'내 보관함에 {amount}개')
    if d.get_attribute('open') is None:d.locator('summary').click()
    return d


def find_and_take(p,item,box,qty,origin):
    details=see_cases(p,item,qty)
    link=details.locator(f'[data-bh="case"][data-case-uid="{box}"]')
    key=link.get_attribute('data-key')
    uid=key.split(':')[2]
    before=snapshot(p)
    link.click()
    panel=case_panel(p,box)
    expect(panel.locator(f'[data-unit="{uid}"].pos-found')).to_be_visible()
    expect(panel.locator('.sc-scroll')).to_be_focused()
    expect(p.locator('#pos-query')).to_have_value('봉인 보급 패치' if item==FABRIC else '천 조각')
    after=snapshot(p)
    assert before['stashSlots']==after['stashSlots'] and before['wallet']==after['wallet']
    assert before['barterHunt']==after['barterHunt'] and before['stash']==after['stash']
    panel.locator(f'[data-stash="case-take"][data-unit="{uid}"]').click()
    after=snapshot(p)
    assert after['stash'].get(item)==before['stash'].get(item,0)+1
    assert not any(u['uid']==uid for q in after['stashSlots'] for u in q.get('contents',[]))
    panel.locator('[data-bh="case-back"]').click()
    if origin=='hunt':
        expect(p.locator('[data-hunt-page]')).to_be_visible()
    else:expect(p.locator('[data-tg="barter-confirm"]')).to_be_visible()


def scenario(browser,width,checkpoint,folder):
    c,p,errors=common['profile'](browser,width,wall=True)
    restored=None
    observer=None
    observer_errors=[]
    try:
        hunt['see_offer'](p)
        expect(p.locator('[data-material-cases]')).to_have_count(0)
        hunt['material'](p,FABRIC)
        expect(p.locator('[data-material-cases]')).to_have_count(0)
        common['import_profile'](p,checkpoint)
        at(p,'stash');state=snapshot(p)
        boxes=[s['uid'] for s in state['stashSlots'] if s['g']=='rs_case_junk']
        assert len(boxes)==2
        cash=state['wallet']
        west,east=boxes
        store(p,west,'공업 <서쪽>', ['cloth','cloth'])
        store(p,east,'예비 & 동쪽', ['cloth',FABRIC])
        if width==390:
            p.locator(f'[data-stash="select"][data-uid="{east}"]').click()
            p.locator('[data-stash="place"][data-x="1"][data-y="19"]').click()
            moved=next(s for s in snapshot(p)['stashSlots'] if s['uid']==east)
            assert (moved['x'],moved['y'])==(1,19)
        at(p,'barterhunt')
        d=see_cases(p,FABRIC,1)
        expect(d).to_contain_text('예비 & 동쪽')
        expect(d).not_to_contain_text('서쪽')
        expect(d.locator('[data-bh="case"]')).to_have_count(1)
        expect(p.locator('.bh-counts dd')).to_have_text(['1개','0개','0개','1개'])
        common['fit'](p)
        if os.getenv('RUSTLINE_CASE_SCREENSHOTS'):
            path=Path(os.environ['RUSTLINE_CASE_SCREENSHOTS']);path.mkdir(parents=True,exist_ok=True)
            p.locator('[data-hunt-page] .bh-heading').scroll_into_view_if_needed()
            p.screenshot(path=str(path/f'보관재료_{width}px.png'),animations='disabled')
        p.reload(wait_until='domcontentloaded')
        expect(p.locator('[data-material-cases] [data-bh="case"]')).to_be_visible()
        if width==390:
            payload=common['export_profile'](p,folder/'stored.json')
            restored,p2,errors2=common['profile'](browser,width,wall=True)
            common['import_profile'](p2,payload)
            at(p2,'barterhunt')
            d=see_cases(p2,FABRIC,1)
            expect(d.locator(f'[data-case-uid="{east}"]')).to_be_visible()
            assert snapshot(p2)['stashSlots']==payload['session']['stashSlots']
            assert not errors2,errors2
            at(p,'barterhunt')
            observer=c.new_page()
            observer.on('pageerror',lambda err:observer_errors.append(str(err)))
            at(observer,'barterhunt')
            expect(observer.locator('html')).to_have_class(re.compile(r'\bread-only\b'))
            read_only=see_cases(observer,FABRIC,1)
            expect(read_only).to_contain_text('창고 20행 2열')
            expect(read_only.locator('[data-bh="case"]')).to_be_disabled()
        find_and_take(p,FABRIC,east,1,'hunt')
        expect(p.locator('.bh-counts dd')).to_have_text(['1개','1개','0개','0개'])
        expect(p.locator('[data-material-cases]')).to_have_count(0)
        if observer:
            expect(observer.locator('[data-material-cases]')).to_have_count(0)
            expect(observer.locator('.bh-counts dd')).to_have_text(['1개','1개','0개','0개'])
            assert not observer_errors,observer_errors
        p.locator('[data-bh="offer"]').click()
        expect(p.locator('[data-tg="barter-confirm"]')).to_be_disabled()
        cloth=see_cases(p,'cloth',3)
        expect(cloth).to_contain_text('공업 <서쪽>')
        expect(cloth).to_contain_text('예비 & 동쪽')
        expect(cloth.locator('[data-bh="case"]')).to_have_count(2)
        find_and_take(p,'cloth',west,3,'offer')
        expect(p.locator('[data-tg="barter-confirm"]')).to_be_disabled()
        find_and_take(p,'cloth',west,2,'offer')
        confirm=p.locator('[data-tg="barter-confirm"]')
        expect(confirm).to_be_enabled()
        before=snapshot(p);keep=next(s for s in before['stashSlots'] if s['uid']==east)['contents']
        confirm.click();after=snapshot(p)
        assert after['stash'].get(RECIPE)==1 and after['wallet']==cash
        assert not after['stash'].get('cloth') and not after['stash'].get(FABRIC)
        assert next(s for s in after['stashSlots'] if s['uid']==east)['contents']==keep and len(keep)==1
        assert not errors,errors
        print(f'PASS {width}px new-profile no disclosures, earned two-case checkpoint, 2+1 aliased cloth, source-only physical patch, exact case+UID focused, UI withdrawal, ordinary barter, other case and CR preserved.'+
              (' Includes moved case, fresh-profile restore and live read-only second-tab invalidation.' if width==390 else ''),flush=True)
    finally:
        c.close()
        if restored:restored.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('widths',nargs='*',type=int)
    args=parser.parse_args()
    opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}
    if os.getenv('RUSTLINE_CHROMIUM'):opts['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):opts['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as pw, TemporaryDirectory() as temp:
        folder=Path(temp);file=folder/'earned.json'
        subprocess.run(['node','tests/barter-cases.cjs'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,env={**os.environ,'RUSTLINE_CASE_CHECKPOINT':str(file)})
        profile=json.loads(file.read_text())
        browser=pw.chromium.launch(**opts)
        try:
            for width in args.widths or [1280,390,320]:scenario(browser,width,profile,folder)
        finally:browser.close()
