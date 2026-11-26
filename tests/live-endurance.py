#!/usr/bin/env python3
"""Observe a public Rustline build on real wall time in an isolated, resumable QA profile.

Install playwright and a supported Chromium. Pass the same state directory, URL and
timezone-aware cutoff on resume. RUSTLINE_CHROMIUM overrides executable discovery.
Set RUSTLINE_PROXY for an anonymous proxy. Test proxies with an untrusted CA may
explicitly set RUSTLINE_IGNORE_HTTPS_ERRORS=1. All observations remain local. Exit 0 means the
due checkpoints were observed with at least one complete cycle, 1 a game invariant
failed, 2 a configuration/lock error, and 3 incomplete or unavailable observations.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
import uuid

CURRENT_KEY = re.compile(rb"""\bconst\s+SAVE_KEY\s*=\s*['"](rl-reboot-session-v[0-9]+)['"]""")
DEFAULT_URL = "https://rustline-protocol-web.onrender.com/"
CHECKS = ("90s", "3m", "30m")
TOLERANCE_MS = 45_000


class Invariant(Exception):
    """The loaded game returned state inconsistent with a verified prior state."""


class Access(Exception):
    """A public document or compatible test interface could not be reached."""


class Finished(Exception):
    pass


def require(ok, message):
    if not ok:
        raise Invariant(message)


def now_ms():
    return time.time_ns() // 1_000_000


def stamp(at=None):
    return datetime.fromtimestamp(time.time() if at is None else at, timezone.utc).isoformat(timespec="milliseconds")


def until_arg(text):
    try:
        end = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if end.utcoffset() is None:
            raise ValueError()
        return end.timestamp()
    except (ValueError, OverflowError, OSError):
        raise argparse.ArgumentTypeError("use an ISO 8601 timestamp with a UTC offset or Z") from None


def url_arg(text):
    u = urlsplit(text)
    if u.scheme != "https" or not u.hostname or u.username is not None or u.password is not None or u.query or u.fragment:
        raise argparse.ArgumentTypeError("use a public HTTPS URL without credentials, query parameters or a fragment")
    return text


def read(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


@contextmanager
def exclusive(root):
    # Refuse a nonempty unowned target *before* creating anything in it.
    if root.is_symlink():
        raise ValueError("state directory must not be a symbolic link")
    root = root.resolve()
    script_dir = Path(__file__).resolve().parent
    if root == script_dir or (script_dir.name == "tests" and root.is_relative_to(script_dir.parent)):
        raise ValueError("use a state directory outside the tool source tree")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker = root / "endurance-owner.json"
    if any(p.is_symlink() for p in root.iterdir()):
        raise ValueError("symbolic links in the state directory are not supported")
    if not marker.exists() and any(p.name != "runner.lock" for p in root.iterdir()):
        raise ValueError("state directory is nonempty and is not owned by this runner")
    with (root / "runner.lock").open("a+b") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                if lock.seek(0, 2) == 0:
                    lock.write(b"0")
                    lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise ValueError("another endurance runner owns this state directory") from None
        yield root


class Journal:
    def __init__(self, root, url, end):
        self.root, self.url, self.end = root, url, end
        path = root / "endurance-owner.json"
        info = read(path)
        if info is None:
            info = dict(format=1, token=uuid.uuid4().hex, url=url, cutoff=end, created=time.time(),
                        cloth=2 * (max(0, math.ceil((end - time.time()) / 1800)) + 2))
            write(path, info)
        if (not isinstance(info, dict) or info.get("format") != 1 or info.get("url") != url
                or info.get("cutoff") != end or not isinstance(info.get("token"), str)
                or not re.fullmatch(r"[a-f0-9]{32}", info["token"])):
            raise ValueError("this state belongs to a different URL, cutoff or runner format")
        self.info = info
        self.profile = root / "chromium-profile"
        if not self.profile.is_dir() and (root / "initialized.json").exists():
            raise ValueError("the initialized test profile is missing; refusing to recreate it")
        self.profile.mkdir(mode=0o700, exist_ok=True)
        owner = self.profile / "endurance-owner.json"
        if not owner.exists() and not any(self.profile.iterdir()) and not (root / "initialized.json").exists():
            write(owner, {"token": info["token"]})
        if owner.is_symlink() or read(owner, {}) != {"token": info["token"]}:
            raise ValueError("refusing to open an existing or unrelated Chromium profile")
        self.cycles = root / "cycles"
        self.cycles.mkdir(exist_ok=True)
        self.progress = read(root / "coverage.json", {"gaps": [], "last": info["created"]})
        self.heartbeat(force=True)

    def event(self, phase, **data):
        with (self.root / "events.jsonl").open("a", encoding="utf-8") as stream:
            print(json.dumps({"at": stamp(), "phase": phase, **data}, ensure_ascii=False), file=stream)

    def heartbeat(self, force=False):
        t = min(time.time(), self.end)
        last = self.progress["last"]
        if t > last + 150:
            self.progress["gaps"].append({"from": stamp(last), "to": stamp(t), "seconds": round(t-last)})
            self.event("runner-gap", **self.progress["gaps"][-1])
        if force or t >= last + 55:
            self.progress["last"] = max(t, last)
            write(self.root / "coverage.json", self.progress)

    def budget(self, seconds=12):
        if time.time() >= self.end:
            raise Finished()
        return max(1, int(1000 * min(seconds, self.end-time.time())))

    def wait(self, target):
        while True:
            self.budget()
            self.heartbeat()
            remain = min(target, self.end) - time.time()
            if remain <= 0:
                self.budget()
                return
            time.sleep(min(remain, 30))

    def save(self, c):
        write(self.cycles / f"{c['number']:06d}.json", c)

    def check(self, c, name, status, release, **fields):
        c["checks"][name] = dict(at=stamp(), status=status, release=release, **fields)
        self.save(c)
        self.event("checkpoint", number=c["number"], name=name, **c["checks"][name])

    def access_restored(self):
        since = self.progress.pop("unavailableSince", None)
        if since is not None:
            end = min(time.time(), self.end)
            if end - since > 150:
                self.progress["gaps"].append({"kind": "unavailable", "from": stamp(since), "to": stamp(end), "seconds": round(end-since)})
            self.heartbeat(force=True)

    def finish(self, failed=False):
        self.heartbeat(force=True)
        totals = {k: {"observed": 0, "missed": 0} for k in CHECKS}
        records = [read(p) for p in sorted(self.cycles.glob("*.json"))]
        complete = 0
        for c in records:
            complete += int(c.get("done", False) and all(c["checks"].get(k, {}).get("status") == "observed" for k in CHECKS))
            for name in CHECKS:
                ck = c["checks"].get(name)
                if ck:
                    totals[name][ck["status"]] += 1
                elif c.get("due", {}).get(name, float("inf")) <= min(time.time(), self.end)*1000:
                    totals[name]["missed"] += 1
        outage = self.progress.get("unavailableSince")
        gap = bool(self.progress["gaps"]) or (outage is not None and min(time.time(), self.end)-outage>150)
        missed = any(v["missed"] for v in totals.values())
        abandoned = sum(bool(c.get("unobserved")) for c in records)
        verdict = "game-invariant-failed" if failed else (
            "observed" if complete and not missed and not gap and not abandoned else "incomplete")
        report = dict(verdict=verdict, cutoff=stamp(self.end), reported=stamp(), fullyObservedCycles=complete,
                      checkpoints=totals, interruptedCycles=abandoned, runnerGaps=self.progress["gaps"],
                      unavailableSince=stamp(outage) if outage is not None else None,
                      openCycle=records[-1]["number"] if records and not records[-1].get("done") else None)
        if failed:
            report["failure"] = read(self.root / "failure.json")
        write(self.root / "report.json", report)
        print(json.dumps(report, ensure_ascii=False), flush=True)
        return 1 if failed else 0 if verdict == "observed" else 3


class Runner:
    def __init__(self, page, journal, expect):
        self.page, self.j, self.expect = page, journal, expect
        self.release = None
        self.save_key = None

    def load(self, hash_name):
        self.j.budget()
        response = self.page.goto(self.j.url + "?endurance=" + str(now_ms()) + "#" + hash_name,
                                  wait_until="domcontentloaded", timeout=self.j.budget(40))
        if response is None or not response.ok:
            raise Access(f"public page returned HTTP {response.status if response else 'no response'}")
        served, target = urlsplit(response.url), urlsplit(self.j.url)
        if (served.scheme, served.netloc) != (target.scheme, target.netloc):
            raise Access("public navigation left the configured origin")
        title = self.page.title()
        if not re.search(r"RUSTLINE.*v\d+\.\d+", title, re.I):
            raise Access("public URL did not return a recognized Rustline release")
        body = response.body()
        match = CURRENT_KEY.search(body)
        if match is None:
            raise Access("Cannot identify the public build's save generation")
        self.save_key = match.group(1).decode("ascii")
        self.release = {"url": self.j.url, "sha256": hashlib.sha256(body).hexdigest(), "title": title[:100], "saveKey": self.save_key}
        previous = read(self.j.root / "release.json")
        if self.release != previous:
            self.j.event("build-observed", release=self.release)
            write(self.j.root / "release.json", self.release)
        self.page.wait_for_function("k => !!localStorage.getItem(k)", arg=self.save_key, timeout=self.j.budget())
        self.j.budget()

    def snap(self):
        self.j.budget()
        state = self.page.evaluate("k => JSON.parse(localStorage.getItem(k))", self.save_key)
        if not isinstance(state, dict) or not {"stash", "hideout", "career", "raid", "lastSummary"} <= state.keys():
            raise Access("unsupported or unavailable Rustline save interface")
        return state

    def click(self, selector):
        self.page.locator(selector + ":visible").first.click(timeout=self.j.budget())

    def setup(self):
        self.load("clinic")
        if (self.j.root / "initialized.json").exists():
            return
        s = self.snap()
        cloth = self.j.info["cloth"]
        if not s["stash"].get("cloth"):
            if s["raid"] or s["career"]["sorties"] or s["stash"] or s["hideout"]["levels"]["med"]:
                raise ValueError("initialization requires a fresh, isolated test game")
            self.click(".shell-settings")
            with self.page.expect_download(timeout=self.j.budget()) as handle:
                self.click('[data-backup="export"]')
            with tempfile.TemporaryDirectory(dir=self.j.root) as tmp:
                backup = Path(tmp) / "fresh.json"
                handle.value.save_as(backup)
                doc = read(backup)
            state = doc["session"]
            state["hideout"]["levels"]["med"] = 1
            state["stash"]["cloth"] = cloth
            state["stashSlots"] = [dict(uid=f"s-endurance-{i}", g="cloth", x=i%6, y=i//6, w=1, h=1)
                                   for i in range(min(192, cloth))]
            self.page.locator("#restore-file").set_input_files(
                {"name": "endurance-fixture.json", "mimeType": "application/json", "buffer": json.dumps(doc).encode()},
                timeout=self.j.budget())
            self.expect(self.page.locator('.save-panel [role="status"]')).to_contain_text("복원했습니다", timeout=self.j.budget())
            self.load("clinic")
        s = self.snap()
        if s["stash"].get("cloth") != cloth or s["hideout"]["levels"]["med"] != 1 or s["raid"]:
            raise ValueError("initial synthetic QA fixture does not match its state directory")
        write(self.j.root / "initialized.json", {"at": stamp(), "release": self.release})
        self.j.event("initialized", cloth=cloth, release=self.release)

    @staticmethod
    def stock(s):
        return dict(cloth=s["stash"].get("cloth", 0), bandage=s["stash"].get("bandage", 0), wallet=s["wallet"],
                    sorties=s["career"]["sorties"], xp=s["career"]["xp"], returns=s["career"]["returns"])

    def verify(self, c, paid):
        s = self.snap()
        expected = dict(c["baseline"])
        expected["cloth"] -= 2
        expected["bandage"] += 2 if paid else 0
        actual = self.stock(s)
        require(all(actual[k] == v for k,v in expected.items() if k != "sorties"), "warehouse, wallet, XP or return count changed unexpectedly")
        return s

    def cycle(self):
        self.load("clinic")
        paths = sorted(self.j.cycles.glob("*.json"))
        c = read(paths[-1]) if paths else None
        if c is None or c.get("done"):
            s = self.snap()
            require(not s["raid"] and not s["hideout"]["production"], "unexpected outstanding raid or production")
            c = dict(number=1 if c is None else c["number"]+1, baseline=self.stock(s), prepared=stamp(),
                     initial=self.release, checks={}, due={})
            self.j.save(c)
        if "3m" not in c["due"]:
            s = self.snap()
            if s["stash"].get("cloth", 0) == c["baseline"]["cloth"]:
                self.click('[data-hideout="produce"][data-id="med"][data-recipe="0"]')
                s = self.snap()
            job = s["hideout"]["production"].get("med")
            if not job:
                self.verify(c, True)
                c.update(done=True, unobserved="craft settled before its deadline was captured")
                self.j.save(c)
                self.j.event("interrupted-cycle", number=c["number"], reason=c["unobserved"])
                return
            require(job["recipe"] == 0, "unexpected production recipe")
            c["due"].update({"90s": job["end"] - 90_000, "3m": job["end"]})
            self.j.save(c)
        if "raidId" not in c:
            self.load("map")
            s = self.snap()
            if not s["raid"]:
                self.click('.command-station[data-index="0"]')
                self.click('.command-deploy[data-page="prep"]')
                self.click('.lo-deploy[data-raid="start"]')
                s = self.snap()
            require(s["raid"] and s["raid"]["endsAt"]-s["raid"]["startedAt"] == 1_800_000, "unexpected raid duration")
            c["raidId"] = s["raid"]["startedAt"]
            c["due"]["30m"] = s["raid"]["endsAt"]
            self.j.save(c)
            self.j.event("cycle-start", number=c["number"], release=self.release, due=c["due"])
        if not c["checks"] and now_ms()<c["due"]["90s"]:
            self.j.access_restored()
        for name in CHECKS:
            if name in c["checks"]:
                continue
            due = c["due"][name]
            self.j.wait(due/1000 + (0 if name=="90s" else 1))
            self.load("map" if name=="30m" else "clinic")
            late = now_ms()-due
            punctual = 0 <= late <= TOLERANCE_MS
            if name=="90s":
                if punctual:
                    s = self.verify(c, False)
                    require(s["hideout"]["production"].get("med", {}).get("end")==c["due"]["3m"] and
                            (s["raid"] or {}).get("startedAt")==c["raidId"], "active craft or raid deadline changed")
            elif name=="3m":
                s = self.verify(c, True)
                require("med" not in s["hideout"]["production"], "settled craft still running")
            else:
                s = self.verify(c, True)
                last=s["lastSummary"] or {}
                require(tuple(last.get(k) for k in ("raidId","rating","elapsed","commission","earned","missionXp"))
                        == (c["raidId"],"expired",1_800_000,0,0,0) and s["career"]["sorties"]==c["baseline"]["sorties"]+1,
                        "raid timeout settlement mismatch")
                self.click('.command-deploy[data-page="raid"]')
                self.expect(self.page.locator(".result-panel")).to_contain_text("MIA",timeout=self.j.budget())
            self.j.access_restored()
            self.j.check(c, name, "observed" if punctual else "missed", self.release, lateMs=late)
        if self.snap()["raid"]:
            self.load("map")
            self.click('.command-deploy[data-page="raid"]')
            self.click('[data-raid="ack"]')
        self.load("clinic")
        s = self.verify(c, True)
        require(not s["raid"] and s["lastSummary"]["raidId"]==c["raidId"] and
                s["career"]["sorties"]==c["baseline"]["sorties"]+1, "duplicate or missing settlement after reload")
        c.update(done=True, ended=stamp())
        self.j.save(c)
        self.j.access_restored()
        self.j.event("cycle-end", number=c["number"], status=[c["checks"][k]["status"] for k in CHECKS])


def observe(j):
    try:
        from playwright.sync_api import Error as BrowserError, expect, sync_playwright
    except ImportError:
        raise ValueError("install the Python playwright package and Chromium") from None
    override = os.getenv("RUSTLINE_CHROMIUM")
    executable = None
    candidates = (override,) if override else ("chromium", "chromium-browser", "google-chrome", "microsoft-edge")
    for candidate in candidates:
        path = shutil.which(candidate)
        if not path:
            continue
        try:
            result = subprocess.run([path, "--version"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=j.budget(3)/1000, check=False)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0:
            executable = path
            break
    if override and executable is None:
        raise ValueError("RUSTLINE_CHROMIUM does not name a runnable Chromium executable")
    proxy = os.getenv("RUSTLINE_PROXY") or os.getenv("HTTPS_PROXY")
    if proxy:
        endpoint = urlsplit(proxy)
        if not endpoint.hostname or endpoint.username is not None or endpoint.password is not None or endpoint.query or endpoint.fragment:
            raise ValueError("use an anonymous network proxy")
    origin = urlsplit(j.url)
    def allow_public_assets(route):
        request = route.request
        u = urlsplit(request.url)
        public_query = not u.query or (u.path == (origin.path or "/") and re.fullmatch(r"endurance=\d+", u.query))
        if (u.scheme, u.netloc)==(origin.scheme, origin.netloc) and public_query and request.method in {"GET", "HEAD"}:
            route.continue_()
        else:
            route.abort()
    while time.time()<j.end:
        runner=None
        try:
            with sync_playwright() as pw:
                if not executable and not Path(pw.chromium.executable_path).is_file():
                    raise ValueError("install Chromium or set RUSTLINE_CHROMIUM to its executable")
                with pw.chromium.launch_persistent_context(
                        str(j.profile), executable_path=executable, headless=True,
                        timeout=j.budget(30), proxy={"server":proxy} if proxy else None,
                        ignore_https_errors=os.getenv("RUSTLINE_IGNORE_HTTPS_ERRORS")=="1",
                        service_workers="block", reduced_motion="reduce", viewport={"width":1100,"height":760},
                        args=["--disable-background-networking","--disable-extensions","--disable-dev-shm-usage"]) as ctx:
                    ctx.route("**/*", allow_public_assets)
                    page = ctx.pages[0] if ctx.pages else ctx.new_page()
                    for other in ctx.pages[1:]:
                        other.close()
                    page.on("dialog", lambda d: d.accept() if d.type=="confirm" else d.dismiss())
                    page.on("pageerror", lambda e: j.event("client-error", kind=type(e).__name__, description=str(e).splitlines()[0][:200]))
                    runner = Runner(page, j, expect)
                    runner.setup()
                    while time.time()<j.end:
                        runner.cycle()
        except Finished:
            break
        except (Access, BrowserError, AssertionError, KeyError) as exc:
            if time.time()>=j.end:
                break
            # Browser/UI timeouts, failed links and unsupported interfaces are not proof of a game invariant failure.
            phase = "public-access" if isinstance(exc, Access) else "browser-or-interface"
            j.event(phase, description=str(exc).splitlines()[0][:200], release=runner.release if runner else None)
            if "unavailableSince" not in j.progress:
                j.progress["unavailableSince"] = time.time()
                j.heartbeat(force=True)
            try:
                unavailable = time.time() - j.progress["unavailableSince"]
                delay = min(300, 45 + max(0, unavailable))
                j.wait(min(time.time() + delay, j.end))
            except Finished:
                break
        except Invariant as exc:
            j.event("game-invariant-failure", description=str(exc), release=runner.release if runner else None)
            write(j.root/"failure.json", {"at":stamp(), "description":str(exc), "release":runner.release if runner else None})
            return j.finish(failed=True)
    return j.finish()


def main():
    parser=argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--state-dir", required=True, type=Path, help="dedicated empty or previously initialized QA directory outside the source tree")
    parser.add_argument("--until", required=True, type=until_arg, help="absolute cutoff with timezone, e.g. YYYY-MM-DDTHH:MM:SS+09:00")
    parser.add_argument("--url", type=url_arg, default=DEFAULT_URL, help="public Rustline HTTPS endpoint (no credentials)")
    args=parser.parse_args()
    try:
        with exclusive(args.state_dir) as root:
            j=Journal(root,args.url,args.until)
            if (root/"failure.json").exists():
                return j.finish(failed=True)
            if time.time()>=j.end:
                return j.finish()
            j.event("runner-start", cutoff=stamp(j.end))
            try:
                return observe(j)
            except Finished:
                return j.finish()
            except KeyboardInterrupt:
                j.event("interrupted")
                j.finish()
                return 3
    except (OSError,ValueError) as exc:
        print(f"Endurance setup or local state error: {exc}", file=sys.stderr)
        return 2


if __name__=="__main__":
    sys.exit(main())
