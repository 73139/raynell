"""Exercise the clinic manual with normal player controls in a fresh profile.

The setup imports a level-one clinic with one gauze and one bandage. Only raid
generation fixes the random sample to the end of the actual loot table, making
the small drop reproducible. No item is injected into a raid, bag or warehouse.
Set RUSTLINE_URL to an already-published build. --natural uses real timers.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = urldefrag(os.environ.get('RUSTLINE_URL') or (ROOT / 'index.html').as_uri()).url
SHEET, OUTPUT = 'rl_bp_dressing', 'rl_craft_dressing'
RECIPE = '[data-hideout="produce"][data-recipe="folded-dressing"]'


def snapshot(page):
    return page.evaluate(r"""() => {
      const keys=Object.keys(localStorage).filter(k=>/^rl-reboot-session-v\d+$/.test(k));
      if(!keys.length)return null;
      const key=keys.sort((a,b)=>Number(b.split('-v')[1])-Number(a.split('-v')[1]))[0];
      return JSON.parse(localStorage.getItem(key));
    }""")


def at(page, fragment):
    target=URL+'#'+fragment
    if page.url==target:
        page.reload(wait_until='domcontentloaded')
    else:
        page.goto(target,wait_until='domcontentloaded')


def advance(page, end, natural):
    if natural:
        page.wait_for_function('end=>Date.now()>=end+275', arg=end, timeout=max(1000, end-page.evaluate('Date.now()')+10000))
    else:
        page.clock.fast_forward(max(1, end-page.evaluate('Date.now()')+400))


def finish(page, natural):
    advance(page, snapshot(page)['field']['action']['end'], natural)


def enter_med(page):
    at(page, 'stash')
    page.locator('[data-page="bunker"]:visible').first.click()
    page.locator('[data-bui="facility"][data-id="med"]:visible').first.click()
    expect(page.locator('[data-manual-panel]')).to_be_visible()


def prepare(page):
    at(page, 'stash')
    expect(page.locator('#pos-query')).to_be_visible()
    session = snapshot(page)
    assert not session['stash'] and session['wallet'] == 30000
    session['hideout']['levels'].update({'power':1,'water':1,'med':1})
    for x, item in enumerate(['bandage','gauze']):
        session['stash'][item] = 1
        session['stashSlots'].append({'uid':'s-clinic-'+item,'g':item,'x':x,'y':0,'w':1,'h':1})
    page.locator('.shell-settings').click()
    page.locator('#restore-file').set_input_files({
        'name':'clinic-setup.json','mimeType':'application/json',
        'buffer':json.dumps({'format':'rustline-tc01','session':session},ensure_ascii=False).encode()
    })
    expect(page.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    enter_med(page)
    expect(page.locator(RECIPE)).to_have_count(0)


def find_sheet(page, natural):
    at(page, 'map')
    page.locator('[data-cui="inspect"][data-index="0"]').click()
    page.locator('.command-deploy[data-page="prep"]').click()
    page.evaluate("() => {window.savedWardRandom=Math.random;Math.random=()=>0.999999;}")
    try:
        page.locator('.lo-deploy[data-raid="start"]').click()
    finally:
        page.evaluate('() => {Math.random=window.savedWardRandom;delete window.savedWardRandom;}')
    page.locator('.landmark-picker summary').click()
    page.locator('[data-field="landmark"][data-index="7"]').click()
    page.locator('[data-field="scan"]:visible').first.click()
    finish(page,natural)
    page.locator('[data-field="open"][data-index="14"]').click()
    tile=snapshot(page)['field']['boxes']['0-14']['items'][0]
    assert tile['g']==SHEET and tile['revealed'] is False
    grid=page.locator('[data-grid="loot"]')
    expect(grid).not_to_contain_text('작업지침')
    tile_node=grid.locator(f"[data-field=search][data-tile-x='{tile['x']}'][data-tile-y='{tile['y']}']")
    expect(tile_node).to_have_accessible_name('미확인 물품 수색')
    tile_node.click()
    finish(page,natural)
    grid.locator('[data-pick="'+tile['uid']+'"]').click()
    page.locator('[data-field="take"]:visible').click()
    assert any(u['uid']==tile['sheetUid'] and u['g']==SHEET for u in snapshot(page)['field']['bag'])
    page.locator('[data-field="close"]:visible').first.click()
    return tile['sheetUid']


def scenario(browser,width,natural,capture_dir=None):
    context=browser.new_context(viewport={'width':width,'height':844},reduced_motion='reduce',
        ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    page=context.new_page()
    page.set_default_timeout(10000)
    page.set_default_navigation_timeout(60000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.on('dialog',lambda d:d.accept())
    def capture(stage,selector):
        if capture_dir is None:return
        capture_dir.mkdir(parents=True,exist_ok=True)
        page.locator(selector).first.scroll_into_view_if_needed()
        page.screenshot(path=str(capture_dir/f'ward-manual-{width}-{stage}.png'))
    try:
        if not natural:
            when=lambda ts:datetime.fromtimestamp(ts/1000,timezone.utc)
            page.clock.install(time=when(1800000000000-86400000))
            page.clock.pause_at(when(1800000000000))
        prepare(page)
        lost=find_sheet(page,natural)
        page.locator('[data-field="abandon"]:visible').first.click()
        assert snapshot(page)['field']['result']=='abandoned'
        page.locator('[data-raid="ack"]:visible').first.click()
        enter_med(page)
        expect(page.locator('[data-hideout="manual-register"]')).to_have_count(0)
        expect(page.locator(RECIPE)).to_have_count(0)
        uid=find_sheet(page,natural)
        assert uid!=lost
        page.locator('[data-field="extract"][data-exit="b04"]:visible').first.click()
        finish(page,natural)
        page.locator('[data-raid="ack"]:visible').first.click()
        at(page,'stash')
        page.locator('#pos-query').fill('작업지침')
        row=page.locator('[data-pos="locate"][data-kind="stash"]')
        expect(row).to_have_count(1)
        expect(row).to_contain_text('창고 1행 3열')
        capture('warehouse','[data-pos="locate"][data-kind="stash"]')
        row.click()
        expect(page.locator('[data-stash="select"][data-uid="'+uid+'"]:visible').first).to_be_visible()
        enter_med(page)
        capture('original','[data-hideout="manual-register"]')
        page.locator('[data-hideout="manual-register"][data-uid="'+uid+'"]').click()
        expect(page.locator('[data-manual-state]')).to_contain_text('제조법 등록 완료')
        assert all(u['uid']!=uid for u in snapshot(page)['stashSlots'])
        expect(page.locator(RECIPE)).to_contain_text('2분')
        capture('recipe',RECIPE)
        page.locator(RECIPE).click()
        session=snapshot(page)
        assert not session['stash'].get('bandage') and not session['stash'].get('gauze')
        job=session['hideout']['production']['med']
        assert job['recipe']=='folded-dressing'
        page.reload(wait_until='domcontentloaded')
        enter_med(page)
        expect(page.locator('[data-facility-end="'+str(job['end'])+'"]:visible')).to_be_visible()
        advance(page,job['end'],natural)
        expect(page.locator(RECIPE)).to_be_disabled()
        assert snapshot(page)['stash'][OUTPUT]==1 and not snapshot(page)['hideout']['production']
        at(page,'stash')
        page.locator('#pos-query').fill('접이식 야전 처치포')
        expect(page.locator('[data-pos="locate"][data-kind="stash"]')).to_have_count(1)
        page.reload(wait_until='domcontentloaded')
        assert snapshot(page)['stash'][OUTPUT]==1 and snapshot(page)['wallet']==30000
        assert not errors,errors
        print(f'PASS {width}px {"wall clock" if natural else "controlled clock"}: lost sheet stays lost, second real '
              'hidden drop searched, recovered by UID, located in warehouse, registered at clinic, 120 s timed job '
              'survived reload with one crafted dressing and unchanged 30,000 CR.',flush=True)
    finally:
        context.close()


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('widths',nargs='*',type=int)
    cli.add_argument('--natural',action='store_true')
    cli.add_argument('--capture-dir',type=Path,help='save warehouse, registration and recipe PNGs per viewport')
    args=cli.parse_args()
    launch={'headless':True,'args':['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        launch['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        launch['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as runner:
        browser=runner.chromium.launch(**launch)
        try:
            for width in args.widths or [1366,390]:
                scenario(browser,width,args.natural,args.capture_dir)
        finally:
            browser.close()
