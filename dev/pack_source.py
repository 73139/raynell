"""Build a deterministic modular-source archive from the dev/ directory."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import argparse
import stat

def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', type=Path,
                        default=root.parent / 'development' / 'Rustline-source.zip')
    parser.add_argument('--source', type=Path, default=root)
    args = parser.parse_args()
    source = args.source.resolve()
    entries = {'build.py': source / 'build.py',
               'Rustline_Database_v10.json': source / 'Rustline_Database_v10.json',
               'pack_source.py': Path(__file__).resolve()}
    for directory, allowed in (('src', {'.js', '.css', '.html', '.webp', '.json'}),
                               ('tests', {'.cjs', '.mjs', '.js', '.py', '.json'})):
        for path in sorted((source / directory).rglob('*')):
            if path.is_symlink():
                raise ValueError(f'Unexpected symbolic link: {path}')
            if not path.is_file() or '__pycache__' in path.parts:
                continue
            if path.suffix not in allowed:
                raise ValueError(f'Review unrecognized source file: {path.relative_to(source)}')
            if directory == 'tests' and path.suffix == '.json' and path.parent != source/'tests'/'fixtures':
                raise ValueError(f'Review non-fixture JSON: {path.relative_to(source)}')
            entries[path.relative_to(source).as_posix()] = path
    if not entries or not any(p.startswith('tests/fixtures/') for p in entries):
        raise ValueError('No regression fixtures found')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, path in sorted(entries.items()):
            info = ZipInfo(f'dev/{name}', (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    print(f'{args.output}: {len(entries)} files, {args.output.stat().st_size} bytes')

if __name__ == '__main__':
    main()
