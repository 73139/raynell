"""Check the physical identity of a dock deposit through two sorties and an alternate exit."""
import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import subprocess

from playwright.sync_api import expect, sync_playwright


DEV = Path(__file__).resolve().parents[1]
ORIGIN = 'https://rustline-dock-cache.test/'
SAVE = 'rl-reboot-session-v36'
VEST = 'rl10_vest'
START = datetime(2026, 11, 26, 6, tzinfo=timezone.utc)


class Operator:
    def __init__(self, browser, html, seed, width, now):
        self.mobile = width < 600
        self.context = browser.new_context(viewport={'width':width, 'height':880}, has_touch=self.mobile,
                                           is_mobile=self.mobile, reduced_motion='reduce', offline=True,
                                           service_workers='block')
        self.context.route('**/*', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8')
                           if r.request.url==ORIGIN and r.request.method=='GET' else r.abort())
        self.context.add_init_script(script='Math.random=()=>0.13; if(!localStorage.getItem("'+SAVE+
                                     '"))localStorage.setItem("'+SAVE+'",'+json.dumps(json.dumps(seed))+');')
        self.errors = []
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.set_default_timeout(12000)
        self.page.clock.set_fixed_time(now)
        self.page.goto(ORIGIN+'#map')

    def saved(self):
        return self.page.evaluate('key => JSON.parse(localStorage.getItem(key))', SAVE)

    def click(self, selector):
        target = self.page.locator(selector+':visible').first
        if self.mobile:
            target.tap()
        else:
            target.focus()
            target.press('Enter')

    def visit(self, fragment):
        self.page.goto(ORIGIN+'#'+fragment, wait_until='domcontentloaded')

    def button(self, selector):
        return self.page.locator(selector)

    def field(self):
        self.visit('map')
        self.click('.command-deploy[data-page=raid]')

    def prepare(self, zone):
        self.visit('map')
        self.click(f'.command-station[data-index="{zone}"]')
        self.click('.command-deploy[data-page=prep]')

    def start(self, zone):
        self.prepare(zone)
        start = self.button('.lo-deploy[data-raid=start]')
        if not start.is_visible():
            self.click('[data-loadout=mobile-tab][data-screen=prep][data-index="2"]')
        self.click('.lo-deploy[data-raid=start]')
        assert self.saved()['raid']['zone']==zone

    def settle(self):
        for _ in range(30):
            f = self.saved()['field']
            action = f.get('action')
            if action:
                when = max(self.page.evaluate('Date.now()'), action['end']+1)
                self.page.clock.set_fixed_time(datetime.fromtimestamp(when/1000, timezone.utc))
                self.page.wait_for_function('([key,end])=>JSON.parse(localStorage.getItem(key)).field.action?.end!==end',
                                            arg=[SAVE,action['end']],polling=50)
            elif f.get('contact'):
                self.click('[data-field=evade]')
            elif f.get('journey') and f['journey'].get('event')=='supply':
                self.click('[data-field=journey-pass]')
            else:
                return
        raise AssertionError('The interrupted journey did not resolve.')

    def move(self, zone):
        self.click(f'[data-route-card][data-to="{zone}"] [data-field=move]')
        self.settle()
        assert self.saved()['raid']['zone']==zone

    def landmark(self, index):
        if self.saved()['field']['landmarkByZone'][2]==index:
            return
        picker = self.button('.landmark-picker')
        if not picker.evaluate('e=>e.open'):
            self.click('.landmark-picker summary')
        self.click(f'[data-field=landmark][data-index="{index}"]')

    def inventory(self, tab):
        if self.page.locator('#inside').get_attribute('data-page')!='inventory':
            self.click('.nav [data-page=inventory]')
        selector = f'[data-loadout=mobile-tab][data-screen=gear][data-index="{tab}"]'
        if self.button(selector).is_visible():
            self.click(selector)

    def backpack(self, action):
        self.inventory(0)
        control = '[data-gear='+action+']'+('[data-slot=back]' if action!='issue' else '')
        if not self.button(control+':visible').count():
            self.click('[data-loadout=slot][data-slot=back]')
        self.click(control)

    def pack(self, uid):
        self.visit('stash')
        self.click(f'[data-stash=select][data-uid="{uid}"]')
        self.click(f'[data-gear=pack][data-unit="{uid}"]')

    def extract(self, exit_id):
        self.click(f'[data-field=extract][data-exit="{exit_id}"]')
        self.settle()
        expect(self.button('.result-panel')).to_be_visible()
        assert self.saved()['lastSummary']['result']=='success'

    def close(self):
        self.context.close()
        assert not self.errors, self.errors


def local_seed(html_path):
    # Seed only the three recorded surveys. Both pieces of equipment are bought through the shop.
    js = """const {boot,clone}=require('./tests/game-fixture.cjs');
             const b=boot(),s=clone(b.g.s);s.career.surveyedBoxes=['2-3','2-4','2-8'];
             s.contracts.quarter.done=b.g.quests.filter(q=>q.trader==='quarter'&&q.tier<4).map(q=>q.id);
             process.stdout.write(JSON.stringify(s));"""
    return json.loads(subprocess.check_output(['node','-e',js,'seed',str(html_path)],cwd=DEV,text=True))


def gear_units(units, serial):
    return [u for u in units if u.get('gear',{}).get('uid')==serial]


def dock_contract(op):
    op.visit('quests')
    op.click('[data-contract=trader][data-id=quarter]')
    op.click('[data-contract=tier][data-tier="4"]')
    op.click('[data-contract=open][data-id=quarter-dock-chain]')


def primary(browser, html, seed, width):
    op = Operator(browser,html,seed,width,START)
    try:
        op.visit('shop')
        op.click('[data-market=trader][data-id=quarter]')
        op.click('[data-market=item][data-id=rl10_vest]')
        op.click('[data-market=quantity][data-step="1"]')
        op.click('[data-market=trade][data-id=rl10_vest][data-qty="2"]')
        stock = [u for u in op.saved()['stashSlots'] if u['g']==VEST]
        assert len(stock)==2
        for unit in stock:
            op.pack(unit['uid'])
        dock_contract(op)
        op.click('[data-contract=accept][data-id=quarter-dock-chain]')
        assert op.saved()['contracts']['quarter']['active']['progress']==[0]
        op.start(2)
        first = op.saved()
        a,b = first['field']['bag']
        assert all(u['g']==VEST for u in (a,b)) and a['gear']['uid']!=b['gear']['uid']
        op.landmark(0)
        expect(op.button('[data-field=dock-deposit]')).to_have_count(0)
        op.landmark(1)
        lift = op.button('[data-exit=lift]')
        expect(lift).to_be_disabled()
        expect(op.button('[data-dock-load]')).to_contain_text('4.200 kg')
        offered = op.button('[data-field=dock-deposit]')
        expect(offered).to_have_count(2)
        for vest in (a,b):
            label = re.compile(f'방호 조끼.*{vest["y"]+1}행 {vest["x"]+1}열.*맡기기')
            control = op.page.get_by_role('button',name=label)
            expect(control).to_have_attribute('data-gear-uid',vest['gear']['uid'])
        output=os.getenv('RUSTLINE_DOCK_CACHE_SHOTS')
        if output:
            folder=Path(output)
            folder.mkdir(parents=True,exist_ok=True)
            locker=op.button('[data-dock-cache="empty"]')
            locker.evaluate("el=>el.scrollIntoView({block:'center',behavior:'instant'})")
            op.page.screenshot(path=str(folder/f'dock-selection-{width}.png'),animations='disabled')
            locker.screenshot(path=str(folder/f'dock-controls-{width}.png'),animations='disabled')
        op.click(f'[data-field=dock-deposit][data-uid="{a["uid"]}"]')
        pending = op.saved()
        assert pending['dockCache']['stage']=='pending'
        assert pending['dockCache']['unit']['gear']==a['gear']
        assert [u['gear'] for u in pending['field']['bag']]==[b['gear']]
        expect(op.button('[data-dock-load]')).to_contain_text('2.100 kg')
        expect(lift).to_be_enabled()
        expect(op.button('[data-field=dock-deposit]')).to_have_count(0)
        op.click('[data-field=dock-cancel]')
        assert not op.saved().get('dockCache')
        assert sorted(u['gear']['uid'] for u in op.saved()['field']['bag'])==sorted([a['gear']['uid'],b['gear']['uid']])
        expect(lift).to_be_disabled()
        op.click(f'[data-field=dock-deposit][data-uid="{a["uid"]}"]')
        pending = op.saved()
        op.extract('lift')
        ready = op.saved()
        assert ready['dockCache']['stage']=='ready' and ready['dockCache']['unit']['gear']==a['gear']
        assert ready['lastSummary']['liftGrams']==2100
        assert ready['lastSummary']['dockCacheOutcome']=='booked'
        record=ready['contracts']['quarter']['active']
        assert record['progress']==[1] and record['dockProof']['uid']==a['gear']['uid']
        expect(op.button('[data-dock-cache-receipt]')).to_contain_text('보관 확정')
        assert len(gear_units(ready['stashSlots'],b['gear']['uid']))==1 and not gear_units(ready['stashSlots'],a['gear']['uid'])
        op.click('[data-raid=ack]')
        op.pack(gear_units(op.saved()['stashSlots'],b['gear']['uid'])[0]['uid'])
        for zone in (0,1,2):
            op.prepare(zone)
            preflight = op.button('[data-sortie-preflight]')
            brief = preflight.locator('[data-dock-cache-brief]')
            pickup = preflight.locator('[data-preflight-kind="dock-pickup"]')
            expect(brief).to_contain_text('다음 출격 한 번')
            expect(brief).to_contain_text('하역 도크')
            expect(brief).to_contain_text('방호 조끼')
            expect(pickup).to_contain_text('내구도 '+str(a['gear']['durability'])+'/100')
            expect(pickup).to_contain_text('2 × 2칸')
            expect(pickup).to_have_attribute('data-ready','true')
            expect(pickup).to_contain_text('현재 가방에 수납 가능')
        op.backpack('unwear')
        op.prepare(0)
        expect(pickup).to_have_attribute('data-ready','false')
        expect(pickup).to_contain_text('가방 공간 확보 필요')
        assert [u['gear'] for u in op.saved()['equipment']['bag']]==[b['gear']]
        op.backpack('issue')
        op.start(0)
        second = op.saved()
        cache = second['dockCache']
        assert cache['stage']=='claimable' and cache['depositRaidId']==first['raid']['startedAt']
        assert cache['claimRaidId']==second['raid']['startedAt']!=first['raid']['startedAt']
        expect(op.button('[data-field=dock-claim]')).to_have_count(0)
        op.move(2)
        op.landmark(0)
        expect(op.button('[data-field=dock-claim]')).to_have_count(0)
        op.landmark(1)
        expect(op.button('[data-field=dock-claim]')).to_be_enabled()
        op.page.reload()
        if op.page.locator('#inside').get_attribute('data-page')!='raid':
            op.field()
        assert op.saved()['dockCache']==cache
        op.backpack('ground-worn')
        assert not op.saved()['field']['worn'].get('back')
        op.field()
        expect(op.button('[data-field=dock-claim]')).to_be_disabled()  # 3 × 2 pockets already hold vest B.
        assert op.saved()['dockCache']==cache
        op.inventory(1)
        held_b = gear_units(op.saved()['field']['bag'],b['gear']['uid'])[0]
        op.click(f'[data-pick="{held_b["uid"]}"][data-side=bag]')
        op.click(f'[data-gear=drop][data-unit="{held_b["uid"]}"]')
        op.field()
        expect(op.button('[data-field=dock-claim]')).to_be_enabled()
        op.click('[data-field=dock-claim]')
        claimed = op.saved()
        assert not claimed.get('dockCache')
        exact = gear_units(claimed['field']['bag'],a['gear']['uid'])
        assert len(exact)==1 and exact[0]['gear']==a['gear'] and exact[0]['uid']!=a['uid']
        assert len(gear_units(claimed['field']['gearGround'][2],b['gear']['uid']))==1
        expect(op.button('[data-field=dock-claim]')).to_have_count(0)
        op.page.reload()
        if op.page.locator('#inside').get_attribute('data-page')!='raid':
            op.field()
        expect(op.button('[data-field=dock-claim]')).to_have_count(0)
        assert gear_units(op.saved()['field']['bag'],a['gear']['uid'])==exact
        op.extract('lift')
        final = op.saved()
        assert final['lastSummary']['liftGrams']==2100 and not final.get('dockCache')
        assert len(gear_units(final['stashSlots'],a['gear']['uid']))==1
        assert not gear_units(final['stashSlots'],b['gear']['uid'])
        assert final['contracts']['quarter']['active']['progress']==[2]
        assert final['contracts']['quarter']['active']['dockProof']['returnedRaidId']==second['raid']['startedAt']
        op.click('[data-raid=ack]')
        dock_contract(op)
        before=op.saved()
        op.click('[data-contract=claim][data-id=quarter-dock-chain]')
        after=op.saved()
        assert after['wallet']-before['wallet']==30000
        assert after['career']['xp']-before['career']['xp']==120
        op.page.reload()
        dock_contract(op)
        assert 'quarter-dock-chain' in op.saved()['contracts']['quarter']['done']
        expect(op.button('[data-contract=claim][data-id=quarter-dock-chain]')).to_have_count(0)
        assert op.saved()['wallet']==after['wallet']
        return pending, second
    finally:
        op.close()


def other_exit(browser,html,checkpoint,width,expected):
    now = datetime.fromtimestamp((checkpoint['raid']['startedAt']+500)/1000,timezone.utc)
    op = Operator(browser,html,checkpoint,width,now)
    try:
        op.field()
        if op.saved()['raid']['zone']!=0:
            op.move(0)
        op.extract('b04')
        saved = op.saved()
        assert not saved.get('dockCache')
        assert not gear_units(saved['stashSlots'],checkpoint['dockCache']['unit']['gear']['uid'])
        assert saved['lastSummary']['exit']=='B-04 지하 벙커'
        assert saved['lastSummary']['dockCacheOutcome']==expected
        assert saved['contracts']['quarter']['active']['progress']==[0]
        text='맡긴 장비를 잃었습니다' if expected=='forfeited' else '보관 기한이 끝났습니다'
        expect(op.button('[data-dock-cache-receipt]')).to_contain_text(text)
    finally:
        op.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widths',type=int,nargs='*',default=[390,1280])
    parser.add_argument('--game',type=Path,default=DEV/'index.html')
    args=parser.parse_args()
    game=args.game.resolve()
    binary=os.getenv('RUSTLINE_CHROMIUM') or os.getenv('CHROMIUM_BIN')
    with sync_playwright() as pw,pw.chromium.launch(executable_path=binary) as browser:
        for viewport in args.widths:
            html=game.read_bytes()
            pending, claimable=primary(browser,html,local_seed(game),viewport)
            other_exit(browser,html,pending,viewport,'forfeited')
            other_exit(browser,html,claimable,viewport,'expired')
            print(f'PASS {viewport}px: purchased twin vests; wrong site, weight and pocket gates; cancel; lift-only confirmation; next-sortie reload and exact-once physical recovery.',flush=True)
