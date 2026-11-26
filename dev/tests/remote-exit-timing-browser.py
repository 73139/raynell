"""Verify the remote B-04 arrival warning through an isolated, offline Chromium session."""
import argparse
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ORIGIN = 'https://rustline-exit-timing.test/'
SAVE = 'rl-reboot-session-v36'


def run_case(browser, html, width):
    mobile = width < 600
    with browser.new_context(viewport={'width': width, 'height': 900}, is_mobile=mobile,
                             has_touch=mobile, reduced_motion='reduce', service_workers='block') as context:
        def serve(route):
            if route.request.url == ORIGIN and route.request.resource_type == 'document':
                route.fulfill(content_type='text/html; charset=utf-8', body=html)
            else:
                route.abort()

        context.route('**/*', serve)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(7000)
        start = datetime(2026, 11, 26, 0, tzinfo=timezone.utc)
        page.clock.install(time=start - timedelta(days=1))
        page.clock.pause_at(start)

        def press(target):
            if mobile:
                target.tap()
            else:
                target.click()

        page.goto(ORIGIN + '#map')
        press(page.locator('button.command-station[data-index="1"]'))
        press(page.locator('.command-deploy[data-page="prep"]'))
        press(page.locator('[data-raid="start"]'))
        card = page.locator('.exit-card').filter(has_text='B-04 지하 벙커')
        expect(card.locator('b')).to_have_text('직행 도착 기준 · 이용 가능')

        # Let the running field clock cross the 7-second walk + 10-second extraction cutoff.
        left = page.evaluate('key => JSON.parse(localStorage.getItem(key)).raid.endsAt - Date.now()', SAVE)
        page.clock.fast_forward(left - 16100)
        expect(card.locator('b')).to_contain_text('시간 부족')
        expect(card.locator('button')).to_be_enabled()
        page.reload()
        if not card.count():
            press(page.locator('[data-page="raid"]:visible').first)
        expect(card.locator('b')).to_contain_text('시간 부족')

        # Resolve an uninterrupted journey through the real move handler.
        page.evaluate('Math.random = () => .1')
        press(card.locator('button'))
        page.clock.fast_forward(7500)
        expect(page.locator('[data-exit="b04"]')).to_be_disabled()
        expect(card.locator('b')).to_contain_text('시간 부족')
        page.clock.fast_forward(10500)
        expect(page.locator('.result-panel')).to_contain_text('MIA')
        receipt = page.evaluate('key => JSON.parse(localStorage.getItem(key)).lastSummary', SAVE)
        assert receipt['rating'] == 'expired', receipt
        assert not errors, errors
        print(f'PASS {width}px: remote deadline updates while idle and after reload; movement, local rejection and MIA receipt.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widths', type=int, nargs='*', default=[390, 1280])
    parser.add_argument('--game', type=Path, default=Path(__file__).resolve().parents[1] / 'index.html')
    args = parser.parse_args()
    html = args.game.read_bytes()
    binary = os.getenv('RUSTLINE_CHROMIUM') or os.getenv('CHROMIUM_BIN')
    with sync_playwright() as playwright, playwright.chromium.launch(executable_path=binary) as browser:
        for viewport in args.widths:
            run_case(browser, html, viewport)
