"""Run with Python, Playwright and Chromium. All gameplay runs in an isolated browser profile."""
import argparse
import os
from pathlib import Path
from shutil import which

from playwright.sync_api import sync_playwright


GAME = Path(__file__).resolve().parents[1] / "index.html"
URL = "https://rustline.test/#map"
A, B = "0-0-0", "0-0-1"


def check_rotation(page, action):
    mobile = action == "mobile-tap"

    def activate(locator):
        if mobile:
            locator.tap()
        else:
            locator.click()

    page.goto(URL)
    activate(page.locator(".command-deploy[data-page=prep]"))
    activate(page.locator("[data-raid=start]"))
    # Use a real freshly generated raid. Only its loot, free cells and open box are
    # fixed so every run has exactly the same puzzle regardless of its loot roll.
    key = page.evaluate("""() => Object.keys(localStorage).find(k =>
      k.startsWith('rl-reboot-session-') && JSON.parse(localStorage[k]).raid)""")
    size = page.locator("#shell-pack").inner_text()
    page.evaluate("""({key, block}) => {
      const game = JSON.parse(localStorage[key]), f = game.field;
      const [cols, rows] = f.worn.back === 'issued_pack' ? [6,6] : [3,2];
      const tile = (uid,g,x,y,w,h) => ({uid,g,x,y,w,h,revealed:true});
      f.found[0]=[0]; f.open='0-0'; f.bag=[];
      f.boxes['0-0'].items=[tile('0-0-0','ammo',0,0,2,1), tile('0-0-1','ammo',0,1,2,1)];
      f.boxes['0-0'].complete=true;
      if(block) for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) {
        if(x===cols-1 && y<2)continue;
        f.bag.push(tile('fill-'+x+'-'+y,'tape',x,y,1,1));
      }
      localStorage[key]=JSON.stringify(game);
    }""", {"key": key, "block": action not in ("other-unit", "unrotated", "bag-reposition")})
    page.reload()
    activate(page.locator(".command-deploy[data-page=raid]"))
    a = page.locator(f'[data-side=loot][data-pick="{A}"]')
    b = page.locator(f'[data-side=loot][data-pick="{B}"]')
    bag = page.locator("[data-grid=bag]")
    cols = bag.locator('[data-cell=bag][data-y="0"]').count()
    assert cols in (3, 6), f"unexpected backpack: {size}"
    edge = bag.locator(f'[data-cell=bag][data-x="{cols-1}"][data-y="0"]')
    origin = bag.locator('[data-cell=bag][data-x="0"][data-y="0"]')
    uid = B if action == "other-unit" else A
    if action != "unrotated":
        activate(a)
        rotate = page.locator('[data-field="rotate"]')
        activate(rotate)
        rotation_pressed = rotate.get_attribute("aria-pressed")
    if action in ("rotated-drag", "bag-reposition"):
        a.drag_to(edge)
    elif action == "double-click":
        a.dblclick()
    elif action in ("single-click", "mobile-tap"):
        if mobile:
            page.locator('[data-screen=loot][data-index="1"]').tap()
        activate(edge)
    elif action == "other-unit":
        b.drag_to(origin)
    else:
        a.drag_to(origin)

    def locate():
        return page.evaluate("""({key,uid}) => {
            const f=JSON.parse(localStorage[key]).field;
            const matches=f.bag.filter(i=>i.uid===uid), u=matches[0];
            return [f.boxes['0-0'].items.filter(i=>i.uid===uid).length, matches.length,
                    u ? [u.x,u.y,u.w,u.h] : null];
        }""", {"key": key, "uid": uid})

    expected = [0, 0, 2, 1] if action in ("other-unit", "unrotated") else [cols-1, 0, 1, 2]
    assert locate() == [0, 1, expected], f"{action}: expected {expected}, got {locate()}"
    if action != "unrotated":
        assert rotation_pressed == "true"
    if action == "bag-reposition":
        moved = bag.locator(f'[data-pick="{A}"]')
        moved.click()
        page.locator('[data-field=rotate]').click()
        moved.drag_to(origin)
        assert locate() == [0, 1, [0, 0, 2, 1]], f"within bag: {locate()}"
    page.reload()
    assert locate() == [0, 1, [0, 0, 2, 1] if action == "bag-reposition" else expected]


def main():
    parser = argparse.ArgumentParser(description="Check field loot orientation using desktop and touch input.")
    parser.add_argument("game", nargs="?", type=Path, default=GAME)
    body = parser.parse_args().game.read_bytes()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_BIN") or which("chromium"),
            args=["--disable-dev-shm-usage"],
        )
        for action in ("rotated-drag", "unrotated", "other-unit", "double-click", "single-click", "bag-reposition", "mobile-tap"):
            mobile = action == "mobile-tap"
            viewport = {"width": 412, "height": 915} if mobile else {"width": 1680, "height": 1350}
            with browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile) as context:
                context.route("https://rustline.test/**", lambda r: r.fulfill(content_type="text/html", body=body))
                page = context.new_page()
                page.set_default_timeout(6000)
                check_rotation(page, action)
                print(f"PASS {action}", flush=True)
        browser.close()


if __name__ == "__main__":
    main()
