"""Mixed-release Web Locks regression. Optional RUSTLINE_LEGACY59_HTML and RUSTLINE_LEGACY60_HTML
supply authentic released clients. The future-build scenario is a marked test double, not a release.
RUSTLINE_URL may point to the public copy of the compiled HTML under test.
"""
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urldefrag, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_bytes()
KEY='rl-reboot-session-v36'
LEGACY='rl-reboot-session-v35'
URL=urldefrag(os.getenv('RUSTLINE_URL') or 'https://rustline-build-handoff.test/').url
FIXTURES=ROOT/'tests/fixtures'
BUILD=int(re.search(rb'const WRITER_BUILD=(\d+);',HTML)[1])
FUTURE=HTML.replace(f'const WRITER_BUILD={BUILD};'.encode(),f'const WRITER_BUILD={BUILD+1};'.encode(),1)
# Only the synthetic client writes this extra field. The production snapshot may grow or reorder its fields.
FUTURE, snapshot_count = re.subn(
    rb'\bfunction snapshot(?=\s*\(\s*\)\s*\{)',
    b'function snapshot(){return {...futureWriterSnapshotForTest(),syntheticFutureField:"preserve-me"};}\n'
    b'function futureWriterSnapshotForTest',
    FUTURE,
)
assert snapshot_count == 1, 'The synthetic future client needs exactly one snapshot function.'


def context(browser,clients):
    c=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',
                          ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    def serve(route):
        label=parse_qs(urlparse(route.request.url).query).get('writer-test',['current'])[0]
        if label=='current' and os.getenv('RUSTLINE_URL'):
            route.continue_()
        else:
            route.fulfill(body=clients.get(label,HTML),content_type='text/html; charset=utf-8')
    c.route(re.compile(r'[?&]writer-test='),serve)
    return c


def visit(c,label,route='shop'):
    page=c.new_page()
    page.set_default_timeout(7000)
    page.on('dialog',lambda d:d.accept())
    sep='&' if '?' in URL else '?'
    r=page.goto(URL+sep+'writer-test='+label+'#'+route,wait_until='domcontentloaded',timeout=90000)
    assert r and r.ok
    if label=='current': assert r.body()==HTML
    return page


def writer(p,on):
    p.wait_for_function("on=>on!==document.documentElement.classList.contains('read-only')",arg=on)


def raw(p,key=KEY):
    return p.evaluate('key=>localStorage.getItem(key)',key)


def player(p,key=KEY):
    return json.loads(raw(p,key))


def click(p,selector):
    p.locator(selector+':visible').first.click()


def restore(p,data):
    click(p,'.shell-settings')
    upload(p,data)
    expect(p.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')


def upload(p,data):
    p.locator('#restore-file').set_input_files({'name':'player.json','mimeType':'application/json',
                                              'buffer':json.dumps(data,ensure_ascii=False).encode()})


def buy_water(p):
    click(p,'[data-market="item"][data-id="water"]')
    click(p,'[data-market="trade"][data-id="water"]')


def legacy_test(browser,clients):
    for stage in ('active','done'):
        backup=json.loads((FIXTURES/('pump-pipe-'+stage+'-v60.json')).read_text())
        with context(browser,clients) as ctx:
            legacy=visit(ctx,'60');writer(legacy,True);restore(legacy,backup)
            current=visit(ctx,'current');writer(current,False)
            assert raw(current) is None
            # The latest v35 transfer, made while the upgraded tab is waiting, must be included.
            click(legacy,'.nav [data-page="trade"]')
            buy_water(legacy)
            old_bytes=raw(legacy,LEGACY)
            initial=json.loads(old_bytes)
            legacy.close();writer(current,True)
            upgraded=player(current)
            for key in ('wallet','stash','stashSlots','career','objectivePin','lastSummary','cash'):
                assert upgraded[key]==initial[key],(stage,key)
            assert upgraded['writerBuild']==BUILD and raw(current,LEGACY)==old_bytes
            checkpoint=raw(current)
            stale=visit(ctx,'59');writer(stale,False)
            current.close();writer(stale,True)
            assert raw(stale)==checkpoint
            reduced=player(stale,LEGACY)
            assert reduced['career']['order'] is None and 'pump-pipe' not in reduced['career']['done']
            again=visit(ctx,'current');writer(again,False)
            stale.close();writer(again,True)
            recovered=player(again)
            for key in ('career','objectivePin','wallet','lastSummary'):
                assert recovered[key]==upgraded[key]
            print(f'PASS v0.60 → current migration ({stage}), subsequent authentic v0.59 ownership changes only v35. v36 retains the last v0.60 purchase and order history.',flush=True)


def same_generation(browser,clients):
    with context(browser,clients) as ctx:
        current=visit(ctx,'current');writer(current,True)
        future=visit(ctx,'future');writer(future,False)
        assert player(current)['writerBuild']==BUILD
        buy_water(current)
        reference=player(current)
        assert reference['wallet']==25000 and 'syntheticFutureField' not in reference
        current.close();writer(future,True)
        future_bytes=raw(future); checkpoint=player(future)
        assert checkpoint['wallet']==25000 and checkpoint['writerBuild']==BUILD+1
        assert checkpoint['syntheticFutureField']=='preserve-me'
        stale=visit(ctx,'current')
        expect(stale.locator('#save-upgrade')).to_be_visible()
        expect(stale.locator('#save-refresh')).to_be_focused()
        future.close()
        assert raw(stale)==future_bytes
        # A blocked stale page does not keep the origin lock from a compatible one.
        newest=visit(ctx,'future');writer(newest,True)
        buy_water(newest)
        assert player(newest)['wallet']==20000 and player(newest)['syntheticFutureField']=='preserve-me'
        assert raw(stale)==raw(newest)
        fresh=visit(ctx,'future');writer(fresh,False)
        newest.close();writer(fresh,True)
        assert player(fresh)['wallet']==20000
        print('PASS newer tab waits while original owner purchases normally. After upgrade, stale cold load shows a keyboard-accessible update prompt and compatible tabs retain their lock handoff.',flush=True)

    with context(browser,clients) as ctx:
        p=visit(ctx,'current');writer(p,True)
        click(p,'.shell-settings')
        original=raw(p)
        newer=dict(json.loads(original),writerBuild=BUILD+1)
        upload(p,{'format':'rustline-tc01','session':newer})
        expect(p.locator('.save-panel [role="status"]')).to_contain_text('최신 버전')
        assert raw(p)==original
        click(p,'.nav [data-page="trade"]');buy_water(p)
        assert player(p)['wallet']==25000
        # Model a writer without Web Locks. A storage event must revoke an already-held lock too.
        injector=ctx.new_page()
        injector.goto(URL+'?writer-test=empty',wait_until='domcontentloaded')
        newer=dict(player(p),writerBuild=BUILD+1,syntheticFutureField='keep')
        protected=json.dumps(newer,ensure_ascii=False)
        injector.evaluate('args=>localStorage.setItem(args[0],args[1])',[KEY,protected])
        expect(p.locator('#save-upgrade')).to_be_visible()
        assert raw(p)==protected
        compatible=visit(ctx,'future');writer(compatible,True)
        assert player(compatible)['wallet']==25000
        print('PASS newer backup rejects before replacement with current play still available; a newer external checkpoint releases even an already-held older lock and retains the newer bytes.',flush=True)


if __name__=='__main__':
    names={v:os.getenv('RUSTLINE_LEGACY'+v+'_HTML') for v in ('59','60')}
    assert bool(names['59'])==bool(names['60'])
    clients={k:Path(v).read_bytes() for k,v in names.items() if v}
    for label,doc in clients.items(): assert f'v0.{label}</title>'.encode() in doc
    clients['future']=FUTURE
    clients['empty']=b'<!doctype html><title>isolated storage-event fixture</title>'
    proxy={'server':os.environ['RUSTLINE_PROXY']} if os.getenv('RUSTLINE_PROXY') else None
    with sync_playwright() as pw, pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM'),proxy=proxy) as browser:
        if names['59']:legacy_test(browser,clients)
        same_generation(browser,clients)
