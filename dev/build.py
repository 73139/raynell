"""Build the offline single-page game from its source. Requires Python 3."""
from base64 import b64encode
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'

def source(name):
    return (SRC / name).read_text(encoding='utf-8')

def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

def build():
    template = source('terminal.html')
    release = re.search(r'<title>[^<]* v(\d+)\.(\d+)(?:\.(\d+))?</title>', template)
    if not release:
        raise ValueError("Provide a numeric release version in the terminal title")
    major, minor, patch = (int(part or 0) for part in release.groups())
    if max(major, minor, patch) >= 1000:
        raise ValueError("Release version components must be below 1000")
    writer_build = major * 1_000_000 + minor * 1_000 + patch
    db = json.loads((ROOT / 'Rustline_Database_v10.json').read_text(encoding='utf-8'))
    goods_fields = ('name', 'width', 'height', 'weightKg', 'icon', 'category', 'valueCR')
    meta_fields = ('usage', 'rarity', 'lootSources', 'hideoutUses')
    data = {
        'UI_ART': {p.stem: 'data:image/webp;base64,' + b64encode(p.read_bytes()).decode('ascii')
                   for p in sorted((SRC / 'assets' / 'ui').glob('*.webp'))},
        'GOODS': {id: [item[k] for k in goods_fields] for id, item in db['items'].items()},
        'ITEM_META': {id: {k: item[k] for k in meta_fields} for id, item in db['items'].items()},
        'LOOT_TABLES': db['containers'],
        'FACILITIES': db['hideout']['facilities'],
        'PRODUCTION': db['hideout']['production']
    }
    game = source('game.js')
    for key, value in data.items():
        game = game.replace(f'__DATA_{key}__', compact(value))
    modules = ('field', 'stash', 'hideout', 'equipment', 'landmarks', 'journey', 'session', 'supply',
               'command-ui', 'loadout-ui', 'bunker-ui', 'market', 'market-cart', 'cash', 'cash-ui', 'exchange', 'sale-receipts', 'ward-trial', 'contracts-data', 'contracts', 'recurring-data', 'recurring', 'market-ui', 'market-cart-ui', 'contracts-ui', 'recurring-ui', 'possessions', 'possessions-ui', 'cases-ui', 'objective', 'objective-cart', 'facility-search', 'objective-ui', 'objective-cart-ui', 'onboarding', 'onboarding-ui', 'routes-ui', 'presets', 'presets-ui', 'gear-instances', 'gear-service', 'gear-ui', 'injuries', 'injuries-ui', 'weather', 'weather-ui', 'campaign', 'finale', 'survivor', 'loot-goals', 'loot-goals-ui', 'survivor-loot', 'survivor-ui', 'campaign-ui', 'finale-ui', 'trade-grid-ui', 'trade-touch', 'barter-hunt', 'barter-odds', 'barter-hunt-ui', 'postal', 'relief', 'ward-field', 'ward-shuttle', 'dock-lift', 'shell-ui')
    game = game.replace('/* @gameplay-modules */', '\n'.join(source(f'{m}.js') for m in modules))
    game = game.replace('__WRITER_BUILD__', str(writer_build))
    css = source('terminal.css').replace('/* Modules */', '\n'.join(source(f'{m}.css') for m in (*modules[:4], 'maps', 'shell-ui', 'command-ui', 'loadout-ui', 'bunker-ui', 'market-ui', 'contracts-ui', 'recurring-ui', 'cases', 'objective', 'possessions', 'onboarding', 'routes', 'presets', 'campaign', 'survivor', 'loot-goals', 'gear-ui', 'injuries', 'weather', 'market-cart', 'cash', 'trade-grid', 'trade-touch', 'barter-hunt')))
    launcher = b64encode((SRC / 'assets' / 'launcher.webp').read_bytes()).decode('ascii')
    html = template.replace('{{LAUNCHER}}', launcher).replace('{{CSS}}', css).replace('{{GAME}}', game)
    (ROOT / 'index.html').write_text(html, encoding='utf-8')

if __name__ == '__main__':
    build()
