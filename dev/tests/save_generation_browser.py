"""Verify a genuine v0.33 checkpoint in the current client and, optionally, run its old writer."""
import json
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urldefrag

from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[1]
CURRENT = 'rl-reboot-session-v36'
PREVIOUS = 'rl-reboot-session-v32'
EARLIER = 'rl-reboot-session-v29'
PRESERVED = ('wallet','stash','stashSlots','equipment','cash','hideout','marketCarts','saleReceipts','career','lastSummary')


@contextmanager
def current_origin():
    published = os.getenv('RUSTLINE_URL')
    if published:
        yield urldefrag(published).url
        return
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1',0), partial(Handler,directory=ROOT))
    thread = Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/index.html'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def start_page(context, url, instant, errors):
    page = context.new_page()
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_default_timeout(10000)
    to_dt=lambda ms:datetime.fromtimestamp(ms/1000,timezone.utc)
    page.clock.install(time=to_dt(instant-86400000))
    page.clock.pause_at(to_dt(instant))
    page.goto(url,wait_until='domcontentloaded',timeout=60000)
    return page


def raw(page, key):
    return page.evaluate('k=>localStorage.getItem(k)',key)


def compare(actual, expected):
    for key in PRESERVED:
        if key=='hideout' and 'wardTrial' not in expected[key]:
            facility=dict(actual[key])
            assert facility.pop('wardTrial',None) is None
            assert facility==expected[key],key
        else:
            assert actual[key]==expected[key],key


def v33_migration(browser, legacy_html=None):
    fixtures=ROOT/'tests/fixtures'
    old=json.loads((fixtures/'ward-market-v33.json').read_text())['session']
    earlier=json.loads((fixtures/'objective-cart-active-v29.json').read_text())['session']
    assert old['version']==32 and earlier['version']==29
    sources={k:json.dumps(s,ensure_ascii=False,separators=(',',':')) for k,s in [(PREVIOUS,old),(EARLIER,earlier)]}
    end=old['hideout']['production']['med']['end']
    begin=end-119000
    errors=[]
    context=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',
                                ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
    context.add_init_script('for(const [key,bytes] of Object.entries('+json.dumps(sources)+'))'
                            'if(localStorage.getItem(key)===null)localStorage.setItem(key,bytes);')
    try:
        with current_origin() as url:
            page=start_page(context,url+'#stash',begin,errors)
            page.wait_for_function('k=>!!localStorage.getItem(k)',arg=CURRENT)
            migrated=json.loads(raw(page,CURRENT))
            assert migrated['version']==36
            compare(migrated,old)
            assert raw(page,PREVIOUS)==sources[PREVIOUS] and raw(page,EARLIER)==sources[EARLIER]
            page.locator('[data-page="bunker"]:visible').first.click()
            page.locator('[data-bui="facility"][data-id="med"]:visible').first.click()
            expect(page.locator('[data-manual-state]')).to_contain_text('제조법 등록 완료')
            expect(page.locator(f'[data-facility-end="{end}"]:visible')).to_be_visible()
            page.clock.fast_forward(end-begin+400)
            page.wait_for_function("key=>JSON.parse(localStorage.getItem(key)).stash.rl_craft_dressing===1",arg=CURRENT)
            done=json.loads(raw(page,CURRENT))
            assert not done['hideout']['production'] and done['wallet']==18250
            page.locator('.shell-settings').click()
            with page.expect_download() as stream:
                page.locator('[data-backup="export"]').click()
            download=stream.value
            assert download.suggested_filename=='Rustline_save_v36.json'
            backup=json.loads(Path(download.path()).read_text())
            assert backup['session']['version']==36
            compare(backup['session'],done)
            saved=raw(page,CURRENT)

            if legacy_html:
                # Both genuine clients share the same origin, localStorage and Web Lock.
                # Only the archival document is served from the caller's prior release file.
                context.route(re.compile(r'[?&]rustline-generation=33(?:&|$)'),
                              lambda route:route.fulfill(path=Path(legacy_html).resolve(),content_type='text/html'))
                page.close()
                legacy_url=url+('&' if '?' in url else '?')+'rustline-generation=33#cart'
                older=start_page(context,legacy_url,begin,errors)
                expect(older.locator('html')).not_to_have_class(re.compile('read-only'))
                assert json.loads(raw(older,PREVIOUS))['hideout']['production']['med']==old['hideout']['production']['med']
                page=start_page(context,url+'#stash',end+500,errors)
                expect(page.locator('html')).to_have_class(re.compile('read-only'))
                page.locator('#pos-query').fill('접이식 야전 처치포')
                match=page.locator('[data-pos="locate"][data-kind="stash"]')
                expect(match).to_have_count(1)
                page.evaluate("() => {window.sawLegacyWrites=0;addEventListener('storage',e=>{if(e.key==='rl-reboot-session-v32')++window.sawLegacyWrites})}")
                older.locator('[data-market="trader"][data-id="medic"]').click()
                older.locator('[data-market="item"][data-id="bandage"]:visible').click()
                older.locator('[data-cart="add"]:visible').first.click()
                older.locator('[data-cart="checkout"]:visible').first.click()
                stale=json.loads(raw(older,PREVIOUS))
                assert stale['version']==32 and stale['wallet']==13750
                assert stale['marketCarts']['traders']['medic']['receipt']['total']==4500
                page.wait_for_function('window.sawLegacyWrites>0')
                assert raw(page,CURRENT)==saved
                expect(page.locator('#pos-query')).to_have_value('접이식 야전 처치포')
                expect(match).to_have_count(1)
                older.close()
                expect(page.locator('html')).not_to_have_class(re.compile('read-only'))
            else:
                page.evaluate("""key=>{const s=JSON.parse(localStorage.getItem(key));s.revision+=500;
                    localStorage.setItem(key,JSON.stringify(s))}""",PREVIOUS)
                assert raw(page,CURRENT)==saved
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('html')).not_to_have_class(re.compile('read-only'))
            final=json.loads(raw(page,CURRENT))
            compare(final,done)
            assert final['stash']['rl_craft_dressing']==1 and raw(page,EARLIER)==sources[EARLIER]
            assert json.loads(raw(page,PREVIOUS))['revision']>old['revision']
            assert not errors,errors
            print('PASS v33 schema 32 and v29 originals, exact UIDs/coordinates and receipts, '
                  '120-second v36 job with one output after reload, v36 backup, and '
                  +('real v33 checkout while v36 reader stayed on its search.' if legacy_html
                    else 'stale v32 checkpoint write ignored.'),flush=True)
    finally:
        context.close()
