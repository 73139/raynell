#!/usr/bin/env python3
"""Play alternating Rustline sorties with the game's own clock and RNG.

Use a dedicated empty state directory outside the repository. Resume with the
same directory, source mode and absolute cutoff. Pass --local-html for a fully
offline run against a self-contained local build. RUSTLINE_CHROMIUM may name an installed
Chromium, otherwise use Playwright's Chromium. RUSTLINE_PROXY and an explicit
RUSTLINE_IGNORE_HTTPS_ERRORS=1 support local test proxies.
Create stop.request to pause after the current sortie, then remove it to resume.
Create refresh.request to load updated bytes from the same source.
Exit 0 means a complete sortie was observed, 1 a game invariant failed, 2 invalid
configuration or another running instance, and 3 incomplete observations.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from urllib.parse import urlsplit
from uuid import uuid4

DEFAULT_URL = "https://rustline-protocol-web.onrender.com/"
OFFLINE_URL = "https://rustline-exploration.invalid/"
MARKER = "exploration-owner.json"
MARKER_FORMAT = "rustline-live-exploration-1"
PROFILE_TAG = "rustline-profile-owner.json"


class Cutoff(Exception):
    pass


class Verdict(Exception):
    pass


class RefreshRequested(Exception):
    pass


class Access(Exception):
    pass


def stamp(at=None):
    return datetime.fromtimestamp(time.time() if at is None else at, timezone.utc).isoformat(timespec="milliseconds")


def until_arg(value):
    try:
        end = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if end.utcoffset() is None:
            raise ValueError()
        timestamp = end.timestamp()
    except (ValueError, OSError, OverflowError):
        raise argparse.ArgumentTypeError("use an ISO 8601 timestamp with a UTC offset or Z") from None
    if timestamp <= time.time():
        raise argparse.ArgumentTypeError("the absolute cutoff must still be in the future")
    return timestamp


def url_arg(value):
    u = urlsplit(value)
    if u.scheme != "https" or not u.hostname or u.username is not None or u.password is not None or u.query or u.fragment:
        raise argparse.ArgumentTypeError("use a public HTTPS URL without credentials, query or fragment")
    return value


def atomic_json(path, value):
    descriptor, name = tempfile.mkstemp(dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path, default):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def validate_owner(owner, url, end):
    if (not isinstance(owner, dict) or owner.get("format") != MARKER_FORMAT or owner.get("url") != url
            or owner.get("cutoff") != end or not isinstance(owner.get("token"), str)
            or not re.fullmatch(r"[0-9a-f]{32}", owner["token"])):
        raise ValueError("the state owner, endpoint or cutoff does not match this run")


@contextmanager
def exclusive(path, url, end):
    path = path.expanduser()
    if path.is_symlink():
        raise ValueError("state directory cannot be a symbolic link")
    root = path.resolve()
    source = Path(__file__).resolve().parent.parent
    if root == root.parent or root == Path.home().resolve() or root.is_relative_to(source):
        raise ValueError("use a dedicated state directory outside the source tree")
    for parent in (root, *root.parents):
        if (parent / "Local State").is_file() or (parent / "Preferences").is_file():
            raise ValueError("choose an isolated directory outside browser profiles")
    root.mkdir(parents=True, mode=0o700, exist_ok=True)
    entries = list(root.iterdir())
    if any(f.is_symlink() for f in entries):
        raise ValueError("a state-directory entry is a symbolic link")
    marker = root / MARKER
    signature = (MARKER_FORMAT + "\n").encode("ascii")
    lock_path = root / "runner.lock"
    if marker.is_file():
        validate_owner(read_json(marker, {}), url, end)
    elif entries and not (len(entries) == 1 and entries[0] == lock_path and
                          lock_path.is_file() and lock_path.stat().st_size == len(signature)
                          and lock_path.read_bytes() == signature):
        raise ValueError("state directory is nonempty and is not owned by this runner")
    with lock_path.open("a+b") as lock:
        if not entries and lock.seek(0, os.SEEK_END) == 0:
            lock.write(signature)
            lock.flush()
        try:
            if os.name == "nt":
                import msvcrt
                if lock.seek(0, os.SEEK_END) == 0:
                    lock.write(b"0")
                    lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise ValueError("another exploration runner owns this state directory") from None
        yield root


class Journal:
    def __init__(self, root, url, end, local_html=None):
        self.root, self.url, self.end = root, url, end
        self.local_html = local_html
        owner = self.read(MARKER)
        if not (root / MARKER).exists():
            owner = dict(format=MARKER_FORMAT, token=uuid4().hex, url=url, cutoff=end)
            self.write(MARKER, owner)
        validate_owner(owner, url, end)
        self.profile = root / ("profile-" + owner["token"])
        if self.profile.exists():
            tag = self.profile / PROFILE_TAG
            if (self.profile.is_symlink() or tag.is_symlink() or (self.profile / "Default").is_symlink()
                    or read_json(tag, {}) != {"owner":owner["token"]}):
                raise ValueError("private browser profile has a missing or mismatched ownership tag")
        else:
            if (root / "mission.json").exists():
                raise ValueError("the private profile for this existing mission is missing")
            self.profile.mkdir(mode=0o700)
            atomic_json(self.profile / PROFILE_TAG, {"owner":owner["token"]})

    def read(self, name):
        return read_json(self.root / name, {})

    def write(self, name, value):
        atomic_json(self.root / name, value)

    def emit(self, event, **data):
        row = dict(at=stamp(), event=event, **data)
        with (self.root / "events.jsonl").open("a", encoding="utf-8") as stream:
            print(json.dumps(row, ensure_ascii=False), file=stream)
        self.write("latest.json", row)

    def budget(self, milliseconds=9000):
        remaining = int((self.end-time.time())*1000)
        if remaining < 1:
            raise Cutoff()
        return min(milliseconds, remaining)

    def wait(self, seconds):
        time.sleep(self.budget(max(1, round(seconds*1000)))/1000)

    def finish(self, reason):
        mission = self.read("mission.json")
        observed = mission.get("cycle", 0) if mission.get("ended") else max(0, mission.get("cycle", 1)-1)
        unresolved = bool(self.read("unavailable.json"))
        self.emit("runner-end", reason=reason, completedSorties=observed, unresolvedAccess=unresolved)
        return 0 if observed and not unresolved else 3


def check(ok, message):
    if not ok:
        raise Verdict(message)


KEY = re.compile(rb"""\bconst\s+SAVE_KEY\s*=\s*['"](rl-reboot-session-v\d+)['"]""")
PAY = {"pump-gauge":(12000,55), "pump-pipe":(18000,65), "handover-ledgers":(34000,115),
       "stores":(32000,120), "scout":(20000,80)}
# Both site drawers are free. Settlement always uses the guaranteed B-04 exit in zone 0.
PLANS = {
    "pump-gauge": [(0,6,12),(0,6,13)], "pump-pipe": [(0,6,12),(0,6,13)],
    "handover-ledgers": [(1,1,6),(0,8,17)], "stores": [(0,5,10),(0,5,11)],
    "scout": [(1,3,8),(0,8,17)], "clinic": [(0,7,14),(0,7,15)],
    "rail": [(1,1,6),(0,8,17)], "depot": [(2,4,8),(0,0,0)],
    "tools": [(0,5,10),(0,2,3)], "pantry": [(1,6,12),(0,3,4)],
}
SURVEYS = ("clinic","rail","depot","tools","pantry")
KEEP = {"cr_notes","fuel","wire","bolt","filter","rl_08_15","rl_08_19","bandage","gauze","medkit","cloth"}
GAME_STATE = """key=>{const s=JSON.parse(localStorage.getItem(key)), f=s.field; return {
 raid:s.raid,order:s.career.order,done:s.career.done,sorties:s.career.sorties,xp:s.career.xp,
 wallet:s.wallet,stash:s.stash,kit:s.equipment?.bag?.map(x=>x.g)||[],stock:s.stashSlots.map(({uid,g})=>({uid,g})),
 hideout:s.hideout,summary:s.lastSummary,open:f?.open,over:!!f?.result,contact:!!f?.contact,
 action:f?.action?.type,journey:f?.journey?{event:f.journey.event}:null,place:f?.landmarkByZone,
 completed:Object.keys(f?.boxes||{}).filter(k=>f.boxes[k].complete),
 bag:f?.bag?.map(x=>x.g)||[]};}"""


class Exploration:
    def __init__(self, page, journal):
        self.j = journal
        self.p=page
        self.last_check=0
        self.current={}
        self.order={}

    def click(self, sel):
        self.p.locator(sel+":visible").first.click(timeout=self.j.budget())

    def visible(self, sel):
        return self.p.locator(sel+":visible").count() > 0

    def nav(self, page):
        if self.p.locator("#inside").get_attribute("data-page")==page:
            return
        for selector in [".nav [data-page="+page+"]","button[data-page="+page+"]"]:
            if self.visible(selector):
                self.click(selector)
                return
        if page in ("map","trade"):
            fragment="map" if page=="map" else "shop"
            if self.p.url.endswith("#"+fragment):
                fragment="routes" if page=="map" else "cart"
            self.p.goto(self.p.url.split("#")[0]+"#"+fragment,wait_until="domcontentloaded",timeout=self.j.budget(70000))
            return
        raise Verdict("No visible navigation to "+page)

    def load(self):
        # Once per 15 minutes and on reconnect, check the selected build. In between,
        # hash navigation and reads stay inside this loaded document.
        live_before=self.state() if self.current else None
        r=self.p.goto(self.j.url+"?qa=exploration-"+str(time.time_ns())+"#map",wait_until="domcontentloaded",timeout=self.j.budget(70000))
        if not r or not r.ok:
            raise Access("Game navigation HTTP "+str(r.status if r else "no response"))
        data=r.body()
        key=KEY.search(data)
        check(key and "RUSTLINE" in self.p.title(), "Unrecognized game HTML or save key")
        self.key=key.group(1).decode()
        self.p.wait_for_function("k=>!!localStorage.getItem(k)",arg=self.key,timeout=self.j.budget(12000))
        sha=hashlib.sha256(data).hexdigest()
        old=self.j.read("release.json")
        self.current=dict(title=self.p.title(),sha256=sha,bytes=len(data),saveKey=self.key)
        if old.get("saveKey") and old["saveKey"]!=self.key:
            prior=self.p.evaluate(GAME_STATE,old["saveKey"])
            current=self.state()
            old_id=(prior["raid"] or {}).get("startedAt")
            new_id=(current["raid"] or {}).get("startedAt")
            receipt_id=(current["summary"] or {}).get("raidId")
            if old_id:
                check(old_id in (new_id,receipt_id),"Save migration lost the outgoing raid")
            check(set(prior["done"]).issubset(current["done"]),"Save migration lost completed orders")
            self.j.emit("live-generation-handoff",previousKey=old["saveKey"],newKey=self.key,previousRaidId=old_id,
                 raidId=new_id,receiptId=receipt_id,previousOrder=prior["order"],currentOrder=current["order"],
                 previousCompleted=prior["completed"],currentCompleted=current["completed"],
                 previousWallet=prior["wallet"],wallet=current["wallet"],previousSorties=prior["sorties"],
                 sorties=current["sorties"],release=sha)
        if old!=self.current:
            self.j.emit("release",previous=old,current=self.current)
        self.j.write("release.json",self.current)
        self.last_check=time.monotonic()
        if live_before and live_before["raid"]:
            active=self.state()
            old_id=live_before["raid"]["startedAt"]
            reached=(active["summary"] or {}).get("raidId")==old_id
            check((active["raid"] or {}).get("startedAt")==old_id or reached,"Reload lost current sortie")
            if not reached:
                check(set(live_before["completed"]).issubset(active["completed"]),"Reload lost completed searches")
            self.j.emit("page-reload-in-raid",raidId=old_id,completedBefore=live_before["completed"],
                 completedAfter=active["completed"],settled=reached,release=sha)
        (self.j.root/"refresh.request").unlink(missing_ok=True)
        if self.j.local_html is not None:
            check(not self.p.evaluate("navigator.onLine"), "Offline browser reports an active network")
            self.j.emit("local-html", transport="offline-local-intercept", **self.current)
        else:
            self.j.emit("public-http", status=r.status, **self.current)
        mission=self.j.read("mission.json")
        if mission.get("ended"):
            state=self.state()
            check(state["sorties"]==mission["cycle"] and state["raid"] is None and
                  state["summary"]["raidId"]==mission["raidId"],"Previously acknowledged receipt changed on reload")
            self.j.emit("receipt-after-reload",cycle=mission["cycle"],raidId=mission["raidId"],wallet=state["wallet"],release=sha)

    def state(self):
        self.p.set_default_timeout(self.j.budget())
        return self.p.evaluate(GAME_STATE,self.key)

    def event(self, stage, **data):
        self.j.emit(stage,cycle=self.order.get("cycle"),plan=self.order.get("plan"),release=self.current.get("sha256"),**data)

    def rest(self):
        for _ in range(120):
            if (self.j.root/"refresh.request").exists():
                raise RefreshRequested()
            s=self.state()
            if s["over"]:
                return False
            if s["action"]:
                self.p.wait_for_function("k=>!JSON.parse(localStorage.getItem(k)).field.action || JSON.parse(localStorage.getItem(k)).field.result",
                                         arg=self.key, timeout=self.j.budget(45000), polling=500)
            elif s["contact"]:
                self.click("[data-field=evade]")
                self.event("evade-attempt")
            elif s["journey"] and s["journey"]["event"]=="supply":
                self.click("[data-field=journey-pass]")
                self.event("road-supply-passed")
            elif s["journey"]:
                self.j.wait(.5)
            else:
                return True
        raise Verdict("Journey or encounter did not resume")

    def close_loot(self):
        if self.visible("[data-field=close]"):
            self.click("[data-field=close]")

    def select(self, zone, site):
        self.close_loot()
        if self.state()["raid"]["zone"]!=zone:
            self.click(f'[data-route-card][data-to="{zone}"] [data-field=move]')
            self.event("travel-start",destination=zone)
            if not self.rest():
                return False
            check(self.state()["raid"]["zone"]==zone,"Travel arrived in the wrong region")
            self.event("travel-end",destination=zone)
        if self.state()["place"][zone]!=site:
            picker=self.p.locator(".landmark-picker")
            if picker.get_attribute("open") is None:
                self.click(".landmark-picker summary")
            self.click(f'[data-field=landmark][data-index="{site}"]')
        return True

    def loot(self, zone, site, box):
        if f"{zone}-{box}" in self.state()["completed"]:
            return True
        if not self.select(zone,site):
            return False
        if self.order["plan"]=="pump-gauge" and self.visible("[data-field=gauge-read]"):
            self.click("[data-field=gauge-read]")
        if self.order["plan"]=="pump-gauge" and self.visible("[data-field=gauge-report]"):
            text=self.p.locator("[data-gauge-reading]").inner_text()
            amount=int(re.search(r"(\d+)\s*칸",text).group(1))
            check(amount in (3,4,5),f"Unexpected displayed gauge: {text}")
            answer="above" if amount>4 else "below" if amount<4 else "level"
            self.click(f"[data-field=gauge-report][data-answer={answer}]")
            check(self.visible('[data-pump-gauge=recorded]'),"Incorrect gauge result shown")
            self.event("gauge",displayed=amount,reference=4,answer=answer)
        selector=f'[data-field=open][data-index="{box}"]'
        for _ in range(3):
            if self.visible(selector):
                break
            self.click("[data-field=scan]")
            if not self.rest():
                return False
        self.click(selector)
        self.click(".lo-search[data-field=search]")
        if not self.rest():
            return False
        check(f"{zone}-{box}" in self.state()["completed"],"Completed search absent")
        picked=[]
        items=self.p.locator("[data-pick][data-side=loot]:visible").evaluate_all(
            "nodes=>nodes.map(b=>[b.dataset.pick,b.innerText.split('\\n')[0]])")
        priorities={"정수 필터","PVC 배관","배관 밸브","멸균 거즈","치료 키트","구급 붕대"}
        for uid,caption in sorted(items,key=lambda row:row[1] not in priorities)[:3]:
            current=self.p.locator(f'[data-pick="{uid}"][data-side=loot]:visible')
            if not current.count():
                continue
            current.first.click()
            take=self.p.locator("[data-field=take]:visible")
            if take.count() and take.first.is_enabled():
                take.first.click()
                if not current.count():
                    picked.append(caption)
        self.close_loot()
        self.event("searched",zone=zone,site=site,box=box,kept=picked)
        return True

    def order_screen(self, name):
        self.nav("more")
        self.click(".shortcut-grid [data-page=orders]")
        detail=f"[data-bui=order][data-id={name}]"
        if not self.visible(detail):
            return False
        self.click(detail)
        return True

    def buy_pipe(self):
        if "rl_08_15" in self.state()["kit"]:
            return
        if not self.state()["stash"].get("rl_08_15"):
            self.click("[data-db=lookup][data-id=rl_08_15]")
            wallet=self.state()["wallet"]
            self.click("[data-supply=rl_08_15]")
            check(self.state()["wallet"]==wallet-16000,"PVC purchase did not settle for listed unit price")
            self.event("purchase",item="rl_08_15",cost=16000)
        self.nav("more")
        self.click(".shortcut-grid [data-page=stash]")
        self.click("[data-stash=select][data-id=rl_08_15]")
        self.click("[data-gear=pack][data-id=rl_08_15]")
        check("rl_08_15" in self.state()["kit"],"PVC packing did not persist")

    def choose(self,s):
        if s["order"] in PAY:
            return s["order"]
        for name in PAY:
            if name not in s["done"] and self.order_screen(name):
                self.click("[data-order="+name+"]")
                check(self.state()["order"]==name,"Order acceptance did not persist")
                return name
        return SURVEYS[s["sorties"]%len(SURVEYS)]

    def sell(self):
        stash=self.state()["stock"]
        eligible={row["uid"] for row in stash if row["g"] not in KEEP}
        if not eligible:
            return
        self.nav("trade")
        for trader in ("repair","supply","medic","quarter"):
            self.click(f"[data-market=trader][data-id={trader}]")
            self.click("[data-market=mode][data-mode=sell]")
            offered=[]
            visible_uids=self.p.locator('[data-trade-grid=stash] [data-tg=stash-select]:not(.tg-unaccepted):visible').evaluate_all("nodes=>nodes.map(n=>n.dataset.uid)")
            for uid in visible_uids:
                if uid not in eligible:
                    continue
                cell=self.p.locator(f'[data-trade-grid=stash] [data-uid="{uid}"]:visible').first
                if not cell.count() or cell.is_disabled():
                    continue
                cell.click()
                add=self.p.locator(f'[data-tg=sell-add][data-uid="{uid}"]:visible').first
                if add.count() and add.is_enabled():
                    add.click()
                    offered.append(uid)
                    eligible.remove(uid)
                if len(offered)>=8:
                    break
            confirm=self.p.locator("[data-tg=sell-confirm]:visible").first
            if offered and confirm.count() and confirm.is_enabled():
                before=self.state()["wallet"]
                confirm.click()
                after=self.state()
                check(after["wallet"]>before,"Sale did not credit the wallet")
                self.event("sale",trader=trader,quantity=len(offered),credit=after["wallet"]-before)
            if not eligible:
                break

    def facilities(self):
        for room,required in [("power",{"fuel":1,"wire":2,"bolt":2}),("water",{"filter":2,"rl_08_15":2,"rl_08_19":1}),
                              ("med",{"bandage":3,"gauze":2,"medkit":1})]:
            s=self.state()
            if s["hideout"]["levels"].get(room):
                continue
            if room in s["hideout"]["builds"]:
                return
            if room=="power" and s["wallet"]>=90000 and any(s["stash"].get(k,0)<v for k,v in required.items()):
                self.nav("trade")
                self.click("[data-market=trader][data-id=repair]")
                self.click("[data-market=mode][data-mode=buy]")
                for item,n in required.items():
                    for _ in range(max(0,n-self.state()["stash"].get(item,0))):
                        self.click(f"[data-market=item][data-id={item}]")
                        buy=self.p.locator(f"[data-market=trade][data-id={item}]:visible").first
                        if not buy.count() or buy.is_disabled():
                            break
                        before=self.state()["wallet"]
                        buy.click()
                        after=self.state()["wallet"]
                        check(after<before,"Build-material purchase did not debit wallet")
                        self.event("purchase",item=item,cost=before-after)
            self.nav("bunker")
            self.click(f".bu-facility-tile[data-id={room}]")
            if room in ("water","med") and s["wallet"]>=100000:
                for item,n in required.items():
                    for _ in range(max(0,n-self.state()["stash"].get(item,0))):
                        link=self.p.locator(f".bu-materials [data-id={item}]:visible").first
                        if not link.count():
                            break
                        link.click()
                        buy=self.p.locator(f"[data-supply={item}]:visible").first
                        paid=False
                        if buy.count() and buy.is_enabled():
                            before=self.state()["wallet"]
                            buy.click()
                            after=self.state()["wallet"]
                            check(after<before,"Catalog order did not debit wallet")
                            self.event("purchase",item=item,cost=before-after)
                            paid=True
                        self.nav("bunker")
                        self.click(f".bu-facility-tile[data-id={room}]")
                        if not paid:
                            break
            build=self.p.locator(f"[data-hideout=build][data-id={room}]:visible").first
            if build.count() and build.is_enabled():
                before=self.state()["wallet"]
                build.click()
                s=self.state()
                check(room in s["hideout"]["builds"] and s["wallet"]==before-20000,"Facility construction settlement mismatch")
                self.event("construction",room=room,due=s["hideout"]["builds"][room]["end"])
            return
        self.craft("med")

    def craft(self,room):
        self.nav("bunker")
        self.click(f".bu-facility-tile[data-id={room}]")
        make=self.p.locator(f'[data-hideout=produce][data-id={room}][data-recipe="0"]:visible').first
        if make.count() and make.is_enabled():
            make.click()
            s=self.state()
            check(room in s["hideout"]["production"],"Craft did not persist")
            self.event("craft",room=room,due=s["hideout"]["production"][room]["end"])

    def cycle(self):
        if time.monotonic()-self.last_check>=900 or not self.current or (self.j.root/"refresh.request").exists():
            self.load()
        checkpoint=self.j.read("mission.json")
        s=self.state()
        if not checkpoint or checkpoint.get("ended"):
            check(not s["raid"],"Saved raid exists with no matching QA mission")
            plan=self.choose(s)
            checkpoint=dict(cycle=s["sorties"]+1,plan=plan,previousDone=s["done"],startRelease=self.current,ended=False)
            self.j.write("mission.json",checkpoint)
        self.order=checkpoint
        plan=checkpoint["plan"]
        if not s["raid"] and not checkpoint.get("raidId"):
            if plan=="pump-pipe":
                check(self.order_screen(plan),"Accepted pipe order disappeared")
                self.buy_pipe()
            self.nav("map")
            zone=PLANS[plan][0][0]
            self.click(f'.command-station[data-index="{zone}"]')
            self.click(".command-deploy[data-page=prep]")
            self.click(".lo-deploy[data-raid=start]")
            s=self.state()
            checkpoint["raidId"]=s["raid"]["startedAt"]
            self.j.write("mission.json",checkpoint)
            self.event("deployed",zone=zone,raidId=checkpoint["raidId"],wallet=s["wallet"])
        elif s["raid"]:
            self.nav("map")
            self.click(f'.command-station[data-index="{s["raid"]["zone"]}"]')
            self.click(".command-deploy[data-page=raid]")
            self.event("resumed",raidId=s["raid"]["startedAt"],completed=s["completed"])
            if not checkpoint.get("raidId"):
                checkpoint["raidId"]=s["raid"]["startedAt"]
                self.j.write("mission.json",checkpoint)
        if self.state()["raid"] and not self.state()["over"]:
            if self.rest():
                self.close_loot()
                for zone,site,box in PLANS[plan]:
                    if not self.loot(zone,site,box):
                        break
            if not self.state()["over"]:
                check(self.state()["raid"]["zone"]==0,"Route did not reach B-04")
                self.click("[data-field=extract][data-exit=b04]")
                self.rest()
        s=self.state()
        receipt=s["summary"] or {}
        check(receipt.get("raidId")==checkpoint["raidId"] and s["sorties"]==checkpoint["cycle"],"Missing or duplicate settlement")
        rating=receipt["rating"]
        award=PAY.get(plan,(0,0)) if rating=="success" else (0,0)
        check((receipt["commission"],receipt["missionXp"])==award,f"Unexpected order reward {receipt['commission']}/{receipt['missionXp']} for {plan}/{rating}")
        if award[0]:
            check(plan in s["done"] and plan not in checkpoint["previousDone"],"Completion receipt and career differ")
        check(rating in ("success","expired","kia"),"Unexpected receipt "+rating)
        if s["raid"]:
            self.click("[data-raid=ack]")
        settled=self.state()
        check(settled["raid"] is None and settled["sorties"]==checkpoint["cycle"],"Acknowledgment did not clear raid")
        if not checkpoint.get("verified"):
            self.event("receipt",raidId=receipt["raidId"],rating=rating,elapsedMs=receipt["elapsed"],searched=receipt["searched"],
                       commission=receipt["commission"],orderXP=receipt["missionXp"],goods=len(receipt["goods"]),wallet=settled["wallet"],xp=settled["xp"])
            checkpoint["verified"]=True
            self.j.write("mission.json",checkpoint)
        self.sell()
        self.facilities()
        if self.state()["hideout"]["levels"].get("water"):
            self.craft("water")
        checkpoint["ended"]=True
        self.j.write("mission.json",checkpoint)
        self.event("cycle-end",startRelease=checkpoint["startRelease"]["sha256"],endRelease=self.current["sha256"],wallet=self.state()["wallet"])


def observe(journal):
    try:
        from playwright.sync_api import Error as BrowserError, sync_playwright
    except ImportError:
        raise ValueError("install the Python playwright package and Chromium") from None
    override = os.getenv("RUSTLINE_CHROMIUM")
    executable = shutil.which(override) if override else None
    if override and not executable:
        raise ValueError("RUSTLINE_CHROMIUM must name a runnable Chromium executable")
    offline = journal.local_html is not None
    proxy = "http://127.0.0.1:9" if offline else (os.getenv("RUSTLINE_PROXY") or os.getenv("HTTPS_PROXY"))
    if proxy:
        address = urlsplit(proxy)
        if not address.hostname or address.username is not None or address.password is not None or address.query or address.fragment:
            raise ValueError("use an anonymous test proxy")
    endpoint = urlsplit(journal.url)

    def allow_assets(route):
        request = route.request
        address = urlsplit(request.url)
        query_ok = not address.query or (address.path == (endpoint.path or "/")
                   and re.fullmatch(r"qa=exploration-\d+", address.query))
        if offline:
            if (request.method == "GET" and request.is_navigation_request() and
                    (address.scheme, address.netloc, address.path) == ("https", endpoint.netloc, "/") and query_ok):
                try:
                    data = journal.local_html.read_bytes()
                except OSError:
                    route.abort()
                    return
                if not data.rstrip().endswith(b"</html>"):
                    route.abort()
                    return
                route.fulfill(body=data, content_type="text/html; charset=utf-8", headers={"Cache-Control":"no-store"})
            else:
                route.abort()
            return
        if request.method in {"GET","HEAD"} and (address.scheme, address.netloc) == (endpoint.scheme, endpoint.netloc) and query_ok:
            route.continue_()
        else:
            route.abort()

    if (journal.root / "failure.json").exists():
        journal.emit("unresolved-game-failure", failure=journal.read("failure.json"))
        return 1
    journal.emit("runner-start", deadline=stamp(journal.end), clock="native", rng="native",
                 transport="offline-local-intercept" if offline else "public-http")
    failures = 0
    try:
        while journal.budget():
            if (journal.root / "stop.request").exists():
                return journal.finish("paused")
            try:
                with sync_playwright() as playwright:
                    # The installation chooses the correct headless binary for this Playwright version.
                    with playwright.chromium.launch_persistent_context(
                        str(journal.profile), executable_path=executable, timeout=journal.budget(30000),
                        headless=True, viewport={"width":1280,"height":900}, reduced_motion="reduce",
                        proxy={"server":proxy} if proxy else None,
                        offline=offline, ignore_https_errors=not offline and os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1",
                        service_workers="block", args=["--disable-background-networking","--disable-extensions",
                                                     "--disable-dev-shm-usage","--disk-cache-size=12000000"],
                    ) as context:
                        context.route("**/*", allow_assets)
                        if offline:
                            context.route_web_socket("**/*", lambda websocket: websocket.close())
                        page = context.pages[0] if context.pages else context.new_page()
                        for extra in context.pages[1:]:
                            extra.close()
                        page.set_default_timeout(journal.budget())
                        page.set_default_navigation_timeout(journal.budget(70000))
                        page.on("pageerror",lambda exc:journal.emit("client-error", error=str(exc).splitlines()[0][:400]))
                        game = Exploration(page, journal)
                        while journal.budget():
                            if (journal.root / "stop.request").exists():
                                return journal.finish("paused")
                            try:
                                game.cycle()
                            except RefreshRequested:
                                game.load()
                                continue
                            journal.write("unavailable.json", {})
                            failures = 0
            except Verdict as error:
                journal.write("failure.json", dict(description=str(error), mission=journal.read("mission.json"),
                                                   release=journal.read("release.json")))
                journal.emit("game-invariant-failure", description=str(error))
                return 1
            except (BrowserError, Access, KeyError, TypeError, AttributeError, IndexError) as error:
                if time.time() >= journal.end:
                    break
                detail = str(error)
                if isinstance(error, BrowserError) and "Executable doesn't exist" in detail:
                    raise ValueError("install Playwright Chromium or set RUSTLINE_CHROMIUM") from None
                failures += 1
                category = ("ui-contract" if "Locator." in detail else "navigation"
                            if isinstance(error,(BrowserError, Access)) else "data-contract")
                journal.write("unavailable.json", dict(category=category, at=stamp()))
                journal.emit("attempt-failed", category=category, error=detail.splitlines()[0][:500],
                             consecutive=failures, mission=journal.read("mission.json"), release=journal.read("release.json"))
                journal.wait(min(90, 4*2**min(failures,5)))
    except Cutoff:
        pass
    except KeyboardInterrupt:
        journal.finish("interrupted")
        return 3
    return journal.finish("cutoff")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--state-dir", type=Path, required=True,
                        help="dedicated empty directory outside the repository, or this runner's existing directory")
    parser.add_argument("--until", type=until_arg, required=True,
                        help="future absolute deadline with UTC offset, e.g. YYYY-MM-DDTHH:MM:SS+09:00")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--url", type=url_arg, help="public HTTPS endpoint (the default source)")
    source.add_argument("--local-html", type=Path, help="self-contained local game HTML, run entirely offline")
    args = parser.parse_args()
    try:
        local_html = args.local_html.resolve(strict=True) if args.local_html is not None else None
        if local_html is not None and not local_html.is_file():
            raise ValueError("local HTML source must be a file")
        url = OFFLINE_URL if local_html is not None else (args.url or DEFAULT_URL)
        if local_html is None and url == OFFLINE_URL:
            raise ValueError("the private test origin is reserved for --local-html")
        with exclusive(args.state_dir, url, args.until) as root:
            if args.until <= time.time():
                raise ValueError("the requested cutoff has already passed")
            return observe(Journal(root,url,args.until,local_html))
    except (OSError, ValueError) as exc:
        print(f"Exploration setup or local-state error: {exc}",file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
