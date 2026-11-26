"""Verify CR search units, search navigation and the departure amount with normal player inputs.

The test imports one empty document case with a matching alias for mixed search. A second
independent fixture exercises pagination and the largest supported denomination. A public
build can be selected with RUSTLINE_URL. Screenshots are optional via --capture-dir.
"""
import argparse
import json
import os
import runpy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

TESTS=Path(__file__).resolve().parent
helper=runpy.run_path(str(TESTS/'ward-manual-browser.py'))
at,snapshot=helper['at'],helper['snapshot']


def restore(page,session):
    page.locator('.shell-settings').click()
    page.locator('#restore-file').set_input_files({'name':'cash-search-fixture.json','mimeType':'application/json',
        'buffer':json.dumps({'format':'rustline-tc01','session':session},ensure_ascii=False).encode()})
    expect(page.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
    at(page,'stash')


def search(page,term):
    page.locator('#pos-query').fill(term)
    return page.locator('#pos-results .pos-status')


def cash_rows(page):
    return page.locator('#pos-results .pos-result').filter(has=page.locator('.pos-note-value'))


def verify_layout(page):
    assert page.locator('#pos-results').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
    assert page.locator('.content').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
    assert page.locator('#inside').evaluate('e=>e.scrollWidth<=e.clientWidth+1 && e.scrollLeft===0')
    assert page.locator('.pos-panel').evaluate('e=>e.getBoundingClientRect().left>=0 && e.getBoundingClientRect().right<=innerWidth+1')
    assert page.locator('#pos-results .pos-result, #pos-results .pos-status').evaluate_all(
        'nodes=>nodes.every(e=>e.scrollWidth<=e.clientWidth+1)')


def shot(page,root,width,stage):
    if root:
        root.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(root/f'cash-search-{width}-{stage}.png'))


def scenario(browser,width,folder):
    ctx=browser.new_context(viewport={'width':width,'height':844},reduced_motion='reduce',
        ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    page=ctx.new_page();page.set_default_timeout(10000)
    page.set_default_navigation_timeout(60000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
    try:
        at(page,'stash')
        expect(page.locator('#pos-query')).to_be_visible()
        session=snapshot(page)
        session['stash']['rs_case_docs']=1
        session['stashSlots'].append({'uid':'s-display-case','g':'rs_case_docs','w':1,'h':2,'x':0,'y':0,'alias':'CR 지폐 기록'})
        restore(page,session)
        pocket=session['cash']['pocket'][0]['uid']
        for amount,destination in [(4000,'stash'),(2000,'bag'),(3000,'bag')]:
            page.locator(f'[data-cash="select"][data-uid="{pocket}"]').click()
            page.locator('[data-cash-amount]').fill(str(amount))
            if destination=='stash':
                page.locator('[data-stash="place"][data-x="4"][data-y="20"]').click()
            else:
                page.locator('[data-cash="move"][data-to="bag"]').click()
        before=snapshot(page)
        cashunits=before['cash']['pocket']+[u for u in before['stashSlots'] if u['g']=='cr_notes']+before['equipment']['bag']
        status=search(page,'CR 지폐')
        for label in ['일반 물품 1개','지폐 4묶음','액면 합계 30,000 CR','벙커 결제 가능 25,000 CR','출격 준비 휴대액 5,000 CR']:
            expect(status).to_contain_text(label)
        expect(cash_rows(page)).to_have_count(4)
        expect(page.locator('.pos-item').filter(has_text='CR 지폐 기록')).to_contain_text('×1')
        status.evaluate("e=>e.scrollIntoView({block:'center'})");verify_layout(page);shot(page,folder,width,'mixed')
        for where,unit in [('cash',cashunits[0]),('stash',cashunits[1]),('bag',cashunits[2]),('bag',cashunits[3])]:
            at(page,'stash');search(page,'지폐')
            hit=page.locator(f'.pos-result[data-kind="{where}"]').filter(has=page.locator('.pos-note-value',has_text=f"{unit['amount']:,} CR"))
            expect(hit).to_have_count(1);hit.click()
            exact=page.locator(f'[data-cash="select"][data-uid="{unit["uid"]}"].pos-found')
            expect(exact).to_be_visible();expect(exact).to_be_focused()
            assert exact.evaluate('e=>[e.style.gridRowStart,e.style.gridColumnStart]')==[str(unit['y']+1),str(unit['x']+1)]
            assert snapshot(page)['cash']==before['cash']
            assert snapshot(page)['wallet']==before['wallet']
        at(page,'map')
        page.locator('[data-cui="inspect"][data-index="0"]').click()
        page.locator('.command-deploy[data-page="prep"]').click()
        expect(page.locator('[data-prep-cash]')).to_have_text('반입 지폐5,000 CR')
        page.locator('[data-prep-cash]').scroll_into_view_if_needed()
        shot(page,folder,width,'departure')
        page.locator('.lo-deploy[data-raid="start"]').click()
        at(page,'stash')
        status=search(page,'지폐')
        expect(status).to_contain_text('현장 휴대액 5,000 CR')
        expect(status).to_contain_text('벙커 결제 가능 25,000 CR')
        uid=cashunits[3]['uid']
        page.locator('.pos-result[data-kind="bag"]').filter(has_text='3,000 CR').click()
        target=page.locator(f'[data-side="bag"][data-pick="{uid}"].pos-found')
        expect(target).to_be_visible();expect(target).to_be_focused()
        expect(page.locator('.selection-panel')).to_contain_text('액면 금액 3,000 CR')
        assert snapshot(page)['field']['bag'][-1]['uid']==uid
        page.locator('[data-page="raid"]:visible').first.click()
        page.locator('[data-field="abandon"]:visible').first.click()
        page.locator('[data-raid="ack"]:visible').first.click()
        at(page,'stash');status=search(page,'CR 지폐')
        expect(status).to_contain_text('지폐 2묶음');expect(status).to_contain_text('액면 합계 25,000 CR')
        expect(status).to_contain_text('출격 준비 휴대액 0 CR')
        assert snapshot(page)['wallet']==25000
        # A mixed query spanning two pages must retain its full subtotals; 2^53-1 is legal.
        large=snapshot(page);cap=2**53-1
        large['stashSlots']=[u for u in large['stashSlots'] if u['g']!='cr_notes'];large['stash'].pop('cr_notes',None)
        large['wallet']=cap
        large['cash']['pocket']=[{'g':'cr_notes','uid':f's-maxnote-{i}','x':i%6,'y':i//6,'w':1,'h':1,
                                    'revealed':True,'amount':cap-9 if i==0 else 1} for i in range(10)]
        restore(page,large);status=search(page,'CR 지폐')
        expect(status).to_contain_text(f'지폐 10묶음 · 액면 합계 {cap:,} CR')
        expect(status).to_contain_text(f'벙커 결제 가능 {cap:,} CR')
        expect(cash_rows(page).first).to_contain_text(f'{cap-9:,} CR')
        verify_layout(page)
        if folder and width==320:
            status.evaluate("e=>e.scrollIntoView({block:'center'})");shot(page,folder,width,'max')
        page.locator('[data-pos="next"]').click()
        expect(status).to_contain_text(f'{cap:,} CR');expect(cash_rows(page)).to_have_count(2)
        expect(page.locator('button.pos-result')).to_have_count(3)
        verify_layout(page)
        # The same legal 16-digit holding must fit on the preparation checklist when packed.
        page.locator('[data-cash="select"][data-uid="s-maxnote-0"]').click()
        page.locator('[data-cash="move"][data-to="bag"]').click()
        at(page,'map')
        page.locator('[data-cui="inspect"][data-index="0"]').click()
        page.locator('.command-deploy[data-page="prep"]').click()
        expect(page.locator('[data-prep-cash]')).to_contain_text(f'{cap-9:,} CR')
        assert page.locator('[data-prep-cash]').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        assert page.locator('#inside').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        assert not errors,errors
        print(f'PASS {width}px: 4 bundles across drawer/warehouse and packing, mixed alias ×1, 30,000 total / '
              '25,000 spendable / 5,000 carried, each physical coordinate and UID focused, exact prep and field values, '
              'abandonment, 10-bundle max-safe pagination and no overflow.',flush=True)
    finally:
        ctx.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widths',type=int,nargs='*')
    parser.add_argument('--capture-dir',type=Path)
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
