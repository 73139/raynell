"""Exercise both clinical shuttle routes through separate returns, using native import and game controls."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://rustline-ward-shuttle.test/"
KEY = "rl-reboot-session-v36"
JOB = "ward-shuttle"
HTML = (ROOT / "index.html").read_bytes()


def play(browser, width, route, backup, natural):
    touch = width == 390
    with browser.new_context(viewport={"width": width,"height": 844},has_touch=touch,is_mobile=touch,reduced_motion="reduce") as ctx:
        ctx.route(BASE+"**",lambda r:r.fulfill(body=HTML,content_type="text/html; charset=utf-8"))
        if not natural:
            ctx.add_init_script("Math.random=()=>0.10")
        p=ctx.new_page()
        initial=json.loads(backup.read_text())["session"]
        if not natural:
            p.clock.install(time=datetime.fromtimestamp((initial["career"]["wardCheckReceipt"]["at"]+120000)/1000,timezone.utc))
        p.set_default_timeout(7500)
        p.on("dialog",lambda d:d.accept())
        errors=[];p.on("pageerror",lambda e:errors.append(str(e)))

        def saved():return p.evaluate("k=>JSON.parse(localStorage.getItem(k))",KEY)
        def click(sel):
            loc=p.locator(sel+":visible").first
            if touch:loc.tap()
            else:loc.focus();loc.press("Enter")
        def nav(key):p.goto(BASE+"#"+key,wait_until="domcontentloaded")
        def deploy(zone):
            nav("map");click(f'.command-station[data-index="{zone}"]');click(".command-deploy[data-page=prep]")
            click(".lo-deploy[data-raid=start]");assert saved()["raid"]["zone"]==zone
        def settle():
            for _ in range(120):
                s=saved();f=s['field']
                if f.get('result'):return
                if f.get('action'):
                    if natural:
                        p.wait_for_function("k=>!JSON.parse(localStorage.getItem(k)).field.action",arg=KEY,polling=200,timeout=45000)
                    else:p.clock.fast_forward(max(300,f['action']['end']-p.evaluate('Date.now()')+350))
                elif f.get('contact'):click('[data-field=evade]')
                elif f.get('journey') and f['journey'].get('event')=='supply':click('[data-field=journey-pass]')
                elif f.get('journey'):p.wait_for_timeout(150) if natural else p.clock.fast_forward(350)
                else:return
            raise AssertionError("field did not settle")
        def site(index):
            s=saved();z=s['raid']['zone']
            if s['field']['landmarkByZone'][z]==index:return
            picker=p.locator('.landmark-picker')
            if not picker.evaluate("e=>e.open"):click('.landmark-picker summary')
            click(f'[data-field=landmark][data-index="{index}"]')
            assert saved()['field']['landmarkByZone'][z]==index
        def move(zone):
            if saved()['raid']['zone']!=zone:
                click(f'[data-route-card][data-to="{zone}"] [data-field=move]');settle()
            assert saved()['raid']['zone']==zone
        def search_outer_clinic():
            move(0);site(7)
            for i in (14,15):
                control=f'[data-field=open][data-index="{i}"]'
                while not p.locator(control+':visible').count():click('[data-field=scan]');settle()
                click(control)
                mobile_tab='[data-loadout=mobile-tab][data-screen=loot][data-index="2"]'
                if p.locator(mobile_tab+':visible').count():click(mobile_tab)
                if p.locator('.lo-search').is_enabled():click('.lo-search');settle()
                assert saved()['field']['boxes'][f'0-{i}']['complete']
                click('[data-field=close]');settle()
        def return_normal():
            search_outer_clinic();click('[data-field=extract][data-exit=b04]');settle()
            report=saved()['lastSummary'];assert report['rating']=='success'
            return report

        nav("clinic");click(".shell-settings")
        with p.expect_file_chooser() as dialog:click("[data-backup=import]")
        dialog.value.set_files(backup);expect(p.locator(".save-panel [role=status]")).to_contain_text("복원했습니다")
        nav("quests");click("[data-page=orders]");click('[data-bui=order-filter][data-id=done]')
        click('[data-bui=order][data-id=ward-packing]');click('[data-bui=shuttle-dossier]')
        expect(p.locator('.bu-order-title h2')).to_be_focused()
        expect(p.locator("[data-shuttle-dossier]")).to_contain_text("50,000 CR")
        expect(p.locator("[data-shuttle-dossier]")).to_contain_text("정류장 사이 권역 이동 없음")
        expect(p.locator("[data-shuttle-dossier]")).to_contain_text("적재장 연결로 2칸")
        expect(p.locator("[data-shuttle-dossier]")).to_contain_text("도중 조우 확률 48.2%")
        assert not saved()["career"]["order"]
        click(f'[data-order="{JOB}"]');click(f'[data-objective=pin][data-id="{JOB}"]')
        wallet=saved()['wallet'];finale=saved()['finale'];proof=saved()['career']['wardCheckReceipt']
        deploy(1);site(6);other='freight' if route=='local' else 'local'
        click(f'[data-field=shuttle][data-route="{other}"]');click(f'[data-field=shuttle][data-route="{route}"]')
        first_id=saved()['raid']['startedAt'];assert saved()['field']['shuttle']['route']==route
        receipt=return_normal();first_elapsed=receipt['elapsed'];assert receipt['commission']==receipt['missionXp']==0
        expect(p.locator('[data-shuttle-dispatch]')).to_contain_text("수당 0 CR")
        plan=saved()['career']['shuttle'];assert plan['raidId']==first_id and plan['route']==route
        click('[data-raid=ack]');p.reload(wait_until='domcontentloaded')
        assert saved()['career']['shuttle']==plan and saved()['wallet']==wallet

        zone=0 if route=='local' else 2
        deploy(zone);site(1);click('[data-field=shuttle][data-step=call]')
        called=saved()['field']['shuttle']
        assert called['raidId']!=first_id and called['route']==route
        expect(p.locator('[data-shuttle-seconds]')).to_be_visible()
        if not natural:
            p.clock.fast_forward((45 if route=='local' else 90)*1000+500)
            expect(p.locator('[data-shuttle=expired]')).to_contain_text('다시 호출')
            click('[data-field=shuttle][data-step=call]')
            assert saved()['field']['shuttle']['at']>called['at']
        if zone:move(1)
        site(7 if not zone else 1);click('[data-field=shuttle][data-step=arrive]')
        expect(p.locator('[data-shuttle=arrived]')).to_contain_text("정상 탈출")
        measure=saved()['field']['shuttle']
        assert 0<=measure['arrived']-measure['at']<(45000 if not zone else 90000)
        receipt=return_normal()
        expected=38000 if not zone else 50000;xp=120 if not zone else 155
        assert (receipt['commission'],receipt['missionXp'])==(expected,xp)
        click('[data-raid=ack]');p.reload(wait_until='domcontentloaded')
        final=saved();assert final['wallet']==wallet+expected
        assert final['career']['shuttle']['receipt']['arrived']==measure['arrived']
        assert final['career']['done'].count(JOB)==1 and final['career']['wardCheckReceipt']==proof and final['finale']==finale
        assert not errors,errors
        print(f"PASS {width}px {route} {'real clock/RNG' if natural else 'controlled'}: first {first_id}, "
              f"second {measure['raidId']}; returns {first_elapsed}/{receipt['elapsed']}ms; timed leg {measure['arrived']-measure['at']}ms, "
              f"{wallet} + {expected} = {final['wallet']} CR, {xp} XP once.",flush=True)


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--natural',action='store_true');ap.add_argument('--route',choices=['local','freight'])
    ap.add_argument('widths',nargs='*',type=int)
    args=ap.parse_args();earned=os.getenv('RUSTLINE_WARD_PACKED_SAVE')
    if args.natural and not earned:ap.error('--natural requires RUSTLINE_WARD_PACKED_SAVE')
    with TemporaryDirectory(prefix='rustline-shuttle-') as tmp,sync_playwright() as pw:
        path=Path(earned).resolve() if earned else Path(tmp)/'paid-packing.json'
        if not earned:subprocess.run(['node','tests/ward-packing.cjs'],cwd=ROOT,check=True,env={**os.environ,'RUSTLINE_EXPORT_WARD_PACKED':str(path)})
        with pw.chromium.launch(executable_path=os.getenv('RUSTLINE_CHROMIUM')) as browser:
            for width in args.widths or [390,1280]:
                for r in ([args.route] if args.route else ['local','freight']):play(browser,width,r,path,args.natural)
