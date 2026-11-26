"""Test narrow terminal chrome offline, including actual Firefox minimum-font preferences."""
import argparse
import os
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
KEY='rl-reboot-session-v36'


def final_glyph(label):
    return label.evaluate('''e=>{
      const text=e.firstChild,range=document.createRange();
      range.setStart(text,text.length-1);range.setEnd(text,text.length);
      const box=range.getBoundingClientRect();
      return {x:box.left+0.75*box.width,y:box.top+0.5*box.height};
    }''')


def visible_target(button):
    return button.evaluate('''e=>{
      const r=e.getBoundingClientRect();
      return r.left>=-1&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&
        document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e;
    }''')


def scenario(browser, html, engine, width, enlarged):
    height=640 if width<390 else 844
    # WebKit's simulated offline switch also disables file: URLs. Intercept a loopback
    # URL in memory for that engine; its browser uses an unreachable local proxy.
    routed=engine=='webkit'
    with browser.new_context(viewport={'width':width,'height':height},offline=not routed,
                             service_workers='block',reduced_motion='reduce') as ctx:
        network=[]
        def deny(route):
            network.append(route.request.url)
            route.abort()
        source='http://127.0.0.1:4179/packaged/' if routed else html.resolve().as_uri()
        if routed:
            def local_only(route):
                if route.request.url==source and route.request.method=='GET':
                    return route.fulfill(body=html.read_bytes(),content_type='text/html; charset=utf-8')
                if route.request.url.startswith('blob:'):
                    return route.continue_()
                deny(route)
            ctx.route('**/*',local_only)
        else:
            ctx.route('http://**/*',deny);ctx.route('https://**/*',deny)
        p=ctx.new_page();p.set_default_timeout(3500)
        def ready():
            expect(p.locator('.foot .nav button').first).to_be_visible()
            if enlarged and engine!='firefox':
                p.add_style_tag(content='''#inside .foot .nav button,#inside .shell-readouts,
                  #inside .shell-readouts button{font-size:24px!important}''')
            p.evaluate('document.fonts.ready');p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        p.goto(source+'#shop');ready()
        nav=p.locator('.foot .nav');quest=nav.locator('button[data-page=traderQuests]')
        focus_test=nav.locator('button[data-page=trade]');expect(focus_test).to_have_attribute('aria-current','page')
        for label in nav.locator('button:visible span').all():
            point=final_glyph(label)
            assert label.evaluate('''(e,p)=>document.elementFromPoint(p.x,p.y)?.closest('button')===e.parentElement''',point),label.inner_text()
        point=final_glyph(quest.locator('span'));p.mouse.click(**point)
        expect(quest).to_have_attribute('aria-current','page');expect(p.locator('.foot .nav [aria-current=page]')).to_have_count(1)
        focus_test.focus();p.keyboard.press('Tab');expect(quest).to_be_focused();assert quest.evaluate("e=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none'")
        p.keyboard.press('Enter');expect(quest).to_have_attribute('aria-current','page')
        rows=nav.locator('button:visible').evaluate_all('es=>new Set(es.map(e=>Math.round(e.getBoundingClientRect().top))).size')
        if not enlarged:assert rows==1,(width,rows)
        for balance in ([1120325,9876543210123,9007199254740991] if enlarged else [30000]):
            if balance!=30000:
                # Generated local currency fixture. No production profile or network is used.
                p.evaluate('''([key,amount])=>{const s=JSON.parse(localStorage[key]);
                  s.wallet=amount;s.cash.pocket[0].amount=amount;localStorage.setItem(key,JSON.stringify(s));}''',[KEY,balance]);p.reload();ready()
            readout=p.locator('#shell-wallet');expect(readout).to_have_text('CR '+f'{balance:,}')
            assert readout.evaluate('''e=>{const t=document.createRange();t.selectNodeContents(e);return [...t.getClientRects()].every(r=>r.x>=-1&&r.right<=innerWidth+1)}''')
            assert visible_target(p.locator('#shell-pack')) and visible_target(p.locator('.shell-settings'))
            p.locator('.shell-settings').click();expect(nav.locator('[data-page=more]')).to_have_attribute('aria-current','page')
        p.goto(source+'#archive');ready();archive=p.locator('[data-recovery-archive]');expect(archive).to_be_visible()
        series=archive.locator('.archive-series').last;series.locator('summary').click()
        btn=series.locator('[data-db=archive-item]').last;item=btn.get_attribute('data-id');btn.click()
        p.locator('[data-db=archive-return]').click();original=archive.locator('[data-db=archive-item][data-id="'+item+'"]');expect(original).to_be_focused()
        assert visible_target(original)
        # Normal wheel scrolling to the end leaves the last available action above the fixed footer.
        content=p.locator('#inside .content');box=content.bounding_box();p.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        for _ in range(4):p.mouse.wheel(0,20000)
        p.wait_for_function('''()=>{const e=document.querySelector('#inside .content');return e.scrollHeight-e.scrollTop-e.clientHeight<3}''')
        last=content.locator('button:visible').last;last.focus();expect(last).to_be_focused();assert visible_target(last)
        assert p.locator('.foot').evaluate("e=>e.getBoundingClientRect().top>=document.querySelector('#inside .content').getBoundingClientRect().bottom-1")
        assert not network
        print(f'PASS {engine} {width}px enlarged={enlarged}: {rows} nav rows, final Korean glyph opens quests, focus and active destination, wallet/settings, archive return and last action.',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--engine',choices=['chromium','firefox','webkit'],default='chromium');a=parser.parse_args()
    path=os.environ.get('RUSTLINE_LOCAL_HTML');doc=Path(path) if path else ROOT/'index.html'
    if not doc.is_file():raise SystemExit('Build the local index.html first.')
    with sync_playwright()as pw:
        for enlarged,widths in ((False,(320,360,390,1280)),(True,(320,360))):
            opts={};exe=os.getenv('RUSTLINE_'+a.engine.upper());
            if exe:opts['executable_path']=exe
            if a.engine=='webkit':opts['proxy']={'server':'http://127.0.0.1:9'}
            if a.engine=='firefox' and enlarged:opts['firefox_user_prefs']={'font.minimum-size.ko':24,'font.minimum-size.x-western':24,'font.minimum-size.x-unicode':24}
            with getattr(pw,a.engine).launch(**opts)as browser:
                for width in widths:scenario(browser,doc,a.engine,width,enlarged)
