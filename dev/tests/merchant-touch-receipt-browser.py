"""Mobile touch acceptance across merchant checkout, sale receipts and case lookup.
Use RUSTLINE_URL for a published page and RUSTLINE_CHROMIUM for a custom Chromium binary.
Every fresh navigation checks the served HTML against the local build.
"""
import sys, re, runpy, json, os, hashlib, subprocess, tempfile
from urllib.parse import urldefrag
from pathlib import Path
from playwright.sync_api import expect,sync_playwright
root=Path(os.getenv('RUSTLINE_ROOT') or Path(__file__).resolve().parents[1]).resolve()
local_digest=hashlib.sha256((root/'index.html').read_bytes()).hexdigest()
expected=os.getenv('RUSTLINE_EXPECT_SHA') or local_digest
assert local_digest==expected,(local_digest,expected)
temp=tempfile.TemporaryDirectory(); raw=Path(temp.name)/'earned.json'; casefile=Path(temp.name)/'stored.json'
subprocess.run(['node','tests/barter-cases.cjs'],cwd=root,env={**os.environ,'RUSTLINE_CASE_CHECKPOINT':str(raw)},check=True,stdout=subprocess.DEVNULL)
setup='''
const fs=require('node:fs');const {boot,v12}=require('./tests/game-fixture.cjs');const earned=JSON.parse(fs.readFileSync(process.env.QA_RAW));
const b=boot({[v12]:earned.session}),g=b.g,boxes=g.s.stashSlots.filter(u=>u.g==='rs_case_junk');
for(const [i,u] of boxes.entries())g.renameCase(u.uid,['서쪽 정크박스','동쪽 정크박스'][i]);g.caseMove(boxes[0].uid,'put','cloth');g.caseMove(boxes[1].uid,'put','rl_x_fabric');
b.exportData().then(d=>fs.writeFileSync(process.env.QA_CASE,JSON.stringify(d)));
'''
subprocess.run(['node','-'],input=setup,text=True,cwd=root,env={**os.environ,'QA_RAW':str(raw),'QA_CASE':str(casefile)},check=True)

touch=runpy.run_path(str(root/'tests/trade-touch-browser.py'))
url=urldefrag(os.getenv('RUSTLINE_URL') or (root/'index.html').as_uri()).url
print('Source:',url,'expected SHA-256:',expected)
key=touch['KEY']
def snap(p):return p.evaluate('k=>JSON.parse(localStorage.getItem(k))',key)
def at(p,frag):
 fresh=p.url=='about:blank';response=p.goto(url+'#'+frag,wait_until='domcontentloaded',timeout=60000)
 if fresh:
  assert response is not None
  received=hashlib.sha256(response.body()).hexdigest()
  assert received==expected,(received,expected)
  print('Verified navigated document:',received)

def tap(p,s):p.locator(s+':visible').first.tap()
def getctx(b):return b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1,reduced_motion='reduce',ignore_https_errors=os.getenv('RUSTLINE_IGNORE_HTTPS_ERRORS')=='1')
def new(c):
 p=c.new_page(); p.set_default_timeout(6500);p.on('pageerror',lambda err:errors.append(str(err)));p.on('dialog',lambda d:d.accept());return p
def fit(p,label):
 q=p.evaluate('''()=>({vp:innerWidth,root:document.documentElement.scrollWidth,content:document.querySelector('.content').scrollWidth,client:document.querySelector('.content').clientWidth})''')
 assert q['vp']==390 and q['root']-390<=1 and q['content']-q['client']<=1,(label,q)
 print('fit',label,q)
def count(p):
 p.evaluate('''()=>{window.qaTouch={start:0,end:0,move:0};for(const [type,key] of [['touchstart','start'],['touchend','end'],['touchmove','move']])document.addEventListener(type,e=>{if(e.isTrusted)qaTouch[key]++;},{capture:true,passive:true})}''')
def sell_panel(p):tap(p,'[data-market="trader"][data-id="medic"]');tap(p,'[data-market="mode"][data-mode="sell"]')
errors=[]
with sync_playwright() as w:
 options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}
 if os.getenv('RUSTLINE_PROXY'):options['proxy']={'server':os.environ['RUSTLINE_PROXY']}
 if os.getenv('RUSTLINE_CHROMIUM'): options['executable_path']=os.environ['RUSTLINE_CHROMIUM']
 b=w.chromium.launch(**options)
 c=getctx(b);p=new(c);at(p,'cart');count(p);dev=c.new_cdp_session(p);hold=touch['hold_and_drop']
 assert p.evaluate('matchMedia("(pointer:coarse)").matches && navigator.maxTouchPoints > 0');tap(p,'[data-market="trader"][data-id="medic"]');fit(p,'buy')
 hold(p,dev,p.locator('[data-tg-drag="stock"][data-id="bandage"]'),'cart')
 tap(p,'[data-cart="inc"][data-id="bandage"]')
 hold(p,dev,p.locator('[data-tg-drag="stock"][data-id="gauze"]'),'cart')
 assert snap(p)['wallet']==30000
 tap(p,'[data-cart="checkout"]');assert snap(p)['wallet']==17000
 # Tap from warehouse coordinates into the actual prepared bag, then back through the regular unpack button.
 tap(p,'.nav [data-page="inventory"]')
 tap(p,'[data-loadout="mobile-tab"][data-screen="gear"][data-index="2"]');src=p.locator('[data-stash="select"][data-id="gauze"]:visible').first;src.tap()
 tap(p,'[data-loadout="mobile-tab"][data-screen="gear"][data-index="1"]');tap(p,'[data-gear="cell"][data-x="0"][data-y="0"]')
 state=snap(p);assert len(state['equipment']['bag'])==1 and state['equipment']['bag'][0]['g']=='gauze';fit(p,'bag')
 tap(p,'[data-gear="select"]');tap(p,'[data-gear="unpack"]');assert not snap(p)['equipment']['bag'] and snap(p)['stash']['gauze']==1
 tap(p,'.nav [data-page="trade"]');sell_panel(p)
 owned=snap(p);actual=[u['uid'] for u in owned['stashSlots'] if u['g']!='cr_notes'];assert len(actual)==3
 fits=fit(p,'sale')
 observer=new(c);at(observer,'cart');expect(observer.locator('html')).to_have_class(re.compile(r'\bread-only\b'))
 for uid in actual:
  hold(p,dev,p.locator(f'[data-tg-drag="stash"][data-uid="{uid}"]'),'sale')
 assert snap(p)['wallet']==17000 and snap(p)['stashSlots']==owned['stashSlots']
 expect(p.locator('[data-sale-total]')).to_contain_text('6,500')
 tap(p,'[data-tg="sell-confirm"]')
 state=snap(p);r=state['saleReceipts']['medic'];assert [r['before'],r['total'],r['balance']]==[17000,6500,23500] and state['cash']['pocket'][0]['amount']==23500
 assert sorted(uid for row in r['lines'] for uid in row['uids'])==sorted(actual)
 expect(p.locator('[data-sale-receipt-line="bandage"]')).to_contain_text('2,250 CR × 2개')
 expect(p.locator('[data-sale-receipt-line="gauze"]')).to_contain_text('2,000 CR × 1개')
 fit(p,'receipt');expect(observer.locator('#shell-wallet')).to_contain_text('23,500')
 print('Trusted touch counts during shopping/gear/sale:',p.evaluate('qaTouch'))
 p.close();expect(observer.locator('html')).not_to_have_class(re.compile(r'\bread-only\b'))
 sell_panel(observer);expect(observer.locator('[data-sale-receipt-total]')).to_contain_text('6,500')
 observer.reload(wait_until='domcontentloaded');sell_panel(observer);expect(observer.locator('[data-sale-receipt-balance]')).to_contain_text('23,500')
 assert snap(observer)['saleReceipts']['medic']==r;fit(observer,'revisit');c.close()
 # Gameplay-earned save, loaded only through built-in restore. All case and merchant controls use touch.
 c=getctx(b);p=new(c);at(p,'stash');tap(p,'.shell-settings');p.locator('#restore-file').set_input_files(casefile)
 expect(p.locator('.save-panel [role="status"]')).to_contain_text('복원했습니다')
 at(p,'barterhunt');count(p);fit(p,'hunt')
 amount=p.locator('[data-material-cases="rl_x_fabric"]')
 expect(amount).to_contain_text('동쪽 정크박스');expect(amount).not_to_contain_text('서쪽 정크박스')
 hit=amount.locator('[data-bh="case"]');keyv=hit.get_attribute('data-key');box=hit.get_attribute('data-case-uid');unit=keyv.split(':')[2]
 before=snap(p);hit.tap();panel=p.locator(f'.sc-case[data-case-uid="{box}"]')
 tile=panel.locator(f'[data-stash="case-take"][data-unit="{unit}"].pos-found')
 expect(tile).to_be_visible();assert snap(p)['stashSlots']==before['stashSlots'];fit(p,'case')
 tile.tap();tap(p,'[data-bh="case-back"]');assert snap(p)['stash']['rl_x_fabric']==1
 expect(p.locator('.bh-counts dd')).to_have_text(['1개','1개','0개','0개'])
 tap(p,'[data-bh="offer"]');fit(p,'barter-offer');assert snap(p)['wallet']==before['wallet']
 print('Trusted touch counts during case workflow:',p.evaluate('qaTouch'))
 print('PASS merchant workflow: 5 native long-press drops; 3 unique sold physical units in 2 grouped lines; separate-tab balance followed the commit, receipt retained after ownership handoff and reload; loose inventory, prepared bag and aliased case flows through touch; 0 runtime errors.',errors)
 assert not errors,errors;c.close();b.close()
