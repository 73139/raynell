"""Exercise roadside food and water through normal player controls in a fresh game.

Only travel draws and the browser clock are controlled. Set RUSTLINE_URL to test
a published release, and RUSTLINE_CHROMIUM to select the Chromium executable.
"""
import os
from pathlib import Path
import runpy

from playwright.sync_api import expect, sync_playwright


road = runpy.run_path(str(Path(__file__).with_name('routes-browser.py')))
consume = '[data-field="journey-consume"]'


def travel(page, origin, destination, draws):
    road['set_rolls'](page, draws)
    road['card'](page, origin, destination).locator('[data-field="move"]').click()
    road['contact_time'](page)


def reload_field(page):
    page.reload(wait_until='domcontentloaded')
    page.locator('.nav button[data-page="raid"]:visible').click()


def scenario(browser, width):
    context, page, errors = road['new_page'](browser, width, route='#map')
    try:
        page.locator('.command-deploy[data-page="prep"]').click()
        page.locator('.lo-deploy[data-raid="start"]').click()
        bag = road['read'](page)['field']['bag']

        # A full water meter must still let the player take or leave the bottle.
        travel(page, 0, 1, [.70, .01])
        expect(page.locator(consume)).to_be_disabled()
        expect(page.locator(consume)).to_contain_text('수분 최대')
        expect(page.locator('[data-field="journey-take"]')).to_be_enabled()
        page.locator('[data-field="journey-pass"]').click()

        # First cell of a two-cell trip. Six energy is missing after two moves.
        travel(page, 1, 2, [.60, .01, .01])
        before = road['read'](page)
        assert before['field']['energy'] == 94 and before['field']['journey']['supply'] == 'food'
        expect(page.locator(consume)).to_contain_text('기력 +6')
        road['layout'](page)
        reload_field(page)
        expect(page.locator(consume)).to_be_enabled()
        page.locator(consume).click()
        moving = road['read'](page)['field']
        assert moving['energy'] == 100 and moving['water'] == 100 and moving['bag'] == bag
        assert moving['journey']['done'] == 1 and moving['action']['outcome'] == 'clear'
        assert moving['journey']['schedule'] == before['field']['journey']['schedule']
        reload_field(page)
        expect(page.locator(consume)).to_have_count(0)
        resumed = road['read'](page)['field']
        assert resumed['log'] == moving['log'] and resumed['action'] == moving['action']
        assert resumed['bag'] == bag and resumed['energy'] == 100
        road['contact_time'](page)
        assert road['read'](page)['raid']['zone'] == 2

        # Medical supplies keep the regular take/pass controls.
        travel(page, 2, 1, [.50, .01, .01])
        expect(page.locator('.road-supply')).to_be_visible()
        assert road['read'](page)['field']['journey']['supply'] == 'medkit'
        expect(page.locator(consume)).to_have_count(0)
        page.locator('[data-field="journey-pass"]').click()
        road['contact_time'](page)

        # A real landmark scan removes one point of hydration. Drink on the final cell.
        page.locator('[data-field="scan"]:visible').first.click()
        road['contact_time'](page)
        assert road['read'](page)['field']['water'] == 99
        travel(page, 1, 0, [.80, .60])
        expect(page.locator(consume)).to_contain_text('수분 +1')
        energy = road['read'](page)['field']['energy']
        page.locator(consume).click()
        arrived = road['read'](page)
        assert arrived['raid']['zone'] == 0 and not arrived['field'].get('journey')
        assert arrived['field']['water'] == 100 and arrived['field']['energy'] == energy
        assert arrived['field']['bag'] == bag
        reload_field(page)
        expect(page.locator(consume)).to_have_count(0)
        final = road['read'](page)['field']
        assert final['water'] == 100 and final['bag'] == bag and final['log'] == arrived['field']['log']
        assert not errors, errors
        print(f'PASS {width}px — full-water choice, capped food +6 / water +1, medical supply, unchanged bag, mid-trip and final-cell reload.')
    finally:
        context.close()


if __name__ == '__main__':
    options = {'headless':True, 'args':['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']}
    if os.getenv('RUSTLINE_CHROMIUM'):
        options['executable_path'] = os.environ['RUSTLINE_CHROMIUM']
    if os.getenv('RUSTLINE_PROXY'):
        options['proxy'] = {'server':os.environ['RUSTLINE_PROXY']}
    with sync_playwright() as driver:
        browser = driver.chromium.launch(**options)
        try:
            for width in [390, 1280]:
                scenario(browser, width)
        finally:
            browser.close()
