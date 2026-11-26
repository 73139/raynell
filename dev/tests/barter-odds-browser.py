"""Real, read-only ingredient probability cards in an isolated browser. Set RUSTLINE_URL for a published build.

A native restore provides the completed quartermaster commissions needed for late barter recipes. The
forecast itself uses the ordinary merchant controls. Two actual generator rolls then create empty/full
raid boxes while the same unsearched target card must remain identical. --capture-dir exports a sample.
"""
import argparse
import json
import os
import runpy
import subprocess
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
common=runpy.run_path(str(ROOT/'tests/ward-manual-browser.py'))
at,snapshot=common['at'],common['snapshot']
ROWS={
    'cloth':('rl_x_ammo',{'bag':('8.21%','15.87%'),'jacket':('11.51%','15.46%'),'suitcase':('14.19%','25.42%')}),
    'rl_x_mesh':('rl_x_pack',{'locker':('1.73%','3.22%'),'military':('2.07%','4.82%'),'industrial':('3.04%','7.19%')}),
    'rl_x_core':('rl_x_carbine',{'safe':('0.66%','1.22%'),'military':('0.39%','0.93%'),'cache':('0.86%','1.9%')}),
    'rl_x_circuit':('rl_x_carbine',{'pc':('1.44%','2.86%'),'military':('0.89%','2.09%'),'cache':('1.43%','3.15%')}),
    'rl_x_fabric':('rl_x_ammo',{'bag':('5.68%','11.21%'),'military':('3.2%','7.38%'),'jacket':('5.43%','7.49%')})}


def ranked(page):
    session=snapshot(page)
    script=(ROOT/'src/contracts-data.js').read_text()+"\nconsole.log(JSON.stringify(TRADER_CONTRACTS.filter(q=>q.trader==='quarter'&&q.tier<4).sort((a,b)=>a.tier-b.tier).map(q=>q.id)))"
    session['contracts']['quarter']['done']=json.loads(subprocess.check_output(['node'],input=script,text=True))
    page.locator('.shell-settings').click()
    page.locator('#restore-file').set_input_files({'name':'quarter-rank.json','mimeType':'application/json',
        'buffer':json.dumps({'format':'rustline-tc01','session':session},ensure_ascii=False).encode()})
    expect(page.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    at(page,'shop')


def measured_click(button):
    # Same DOM handler as pointer/keyboard activation. Measure synchronous handler and layout, excluding Playwright I/O.
    return button.evaluate("""b=>{
      const start=performance.now();b.click();void document.querySelector('.content').offsetHeight;
      return performance.now()-start;
    }""")


def shown(page):
    return page.locator('[data-hunt-odds]').evaluate_all("""nodes=>nodes.map(n=>[n.dataset.huntOdds,
        n.querySelector('[data-hunt-first]').textContent,n.querySelector('[data-hunt-whole]').textContent])""")


def watch_random(page):
    page.evaluate("""()=>{window.huntTestRandom=Math.random;window.huntTestDraws=0;
        Math.random=()=>{window.huntTestDraws++;return window.huntTestRandom();};}""")


def unwatch(page):
    return page.evaluate("()=>{Math.random=window.huntTestRandom;return window.huntTestDraws;}")


def scenario(browser,width,folder):
    ctx=browser.new_context(viewport={'width':width,'height':844},reduced_motion='reduce',
        ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    page=ctx.new_page();errors=[];page.set_default_timeout(10000)
    page.set_default_navigation_timeout(60000)
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
    try:
        at(page,'shop');expect(page.locator('[data-market="trader"]').first).to_be_visible();ranked(page)
        page.locator('[data-market="trader"][data-id="quarter"]').click()
        page.locator('[data-market="mode"][data-mode="barter"]').click()
        track_ms=[];region_ms=[];pairs=0
        for item,(recipe,values) in ROWS.items():
            page.locator('[data-tg="recipe"][data-id="'+recipe+'"]').click()
            watch_random(page)
            track_ms.append(measured_click(page.locator('[data-bh="track"][data-item="'+item+'"]')))
            expect(page.locator('[data-hunt-page]')).to_have_attribute('data-hunt-page',item)
            saved=snapshot(page);seen={}
            for zone in range(3):
                region_ms.append(measured_click(page.locator(f'[data-bh="region"][data-zone="{zone}"]')))
                for table,first,whole in shown(page):
                    assert (first,whole)==values[table],(item,table,first,whole)
                    seen[table]=(first,whole)
                assert page.locator('.bh-points').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            assert seen==values,(seen,values)
            assert snapshot(page)==saved,'viewing all three regions must be a read-only action'
            assert not unwatch(page),'viewing odds must not consume live random draws'
            pairs+=len(seen)
            if item!='rl_x_fabric':page.locator('[data-bh="offer"]').click()
        assert pairs==15
        page.locator('[data-bh="region"][data-zone="0"]').click()
        reference=shown(page)
        if folder:
            folder.mkdir(parents=True,exist_ok=True)
            page.locator('[data-hunt-point="1"] [data-hunt-odds="bag"]').evaluate("e=>e.scrollIntoView({block:'center'})")
            page.screenshot(path=str(folder/f'barter-odds-{width}.png'))
        for roll,present in [(0,False),(0.9571911799795081,True)]:
            page.locator('[data-bh="candidate"][data-zone="0"][data-index="1"]').click()
            slot=page.locator('[data-loadout="mobile-tab"][data-screen="prep"][data-index="2"]:visible')
            if slot.count():slot.click()
            page.evaluate('v=>{window.huntTestRandom=Math.random;Math.random=()=>v;}',roll)
            page.locator('.lo-deploy[data-raid="start"]:visible').click()
            page.evaluate('()=>{Math.random=window.huntTestRandom;}')
            s=snapshot(page)
            found=s['field']['boxes']['0-2']['items']
            assert any(u['g']=='rl_x_fabric' for u in found)==present
            assert not any(u['revealed'] for u in found)
            before=snapshot(page)
            page.locator('[data-hunt-summary] [data-page="barterhunt"]:visible').first.click()
            page.locator('[data-bh="region"][data-zone="0"]').click()
            assert shown(page)==reference,'seeded holdings must never determine catalog odds'
            content=page.locator('[data-hunt-page]')
            assert not content.locator('[data-uid],[data-pick],[data-hunt-badge]').count()
            after=snapshot(page)
            for key in ('field','equipment','stash','stashSlots','wallet','barterHunt','revision'):assert before[key]==after[key],key
            page.locator('[data-page="raid"]:visible').first.click()
            page.locator('[data-field="abandon"]:visible').first.click()
            page.locator('[data-raid="ack"]:visible').first.click()
            at(page,'barterhunt')
        assert not errors,errors
        print(f'PASS {width}px: 15 table/ingredient pairs (first/whole), max first track click {max(track_ms):.2f} ms, '
              f'max region click {max(region_ms):.2f} ms including synchronous layout; zero renderer RNG, identical '
              'pre-raid, genuinely empty and hidden-target cards. Region and live-holdings reads preserved the save revision.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widths',nargs='*',type=int);parser.add_argument('--capture-dir',type=Path)
    args=parser.parse_args()
    launch={'headless':True,'args':['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):launch['executable_path']=os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):launch['proxy']={'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as runner:
        browser=runner.chromium.launch(**launch)
        try:
            for width in args.widths or [320,390,1366]:scenario(browser,width,args.capture_dir)
        finally:
            browser.close()
