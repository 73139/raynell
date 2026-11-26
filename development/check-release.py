"""Verify that the versioned game sources rebuild both release files byte for byte."""
import filecmp
from hashlib import sha256
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory


def main():
    repo = Path(__file__).resolve().parents[1]
    with TemporaryDirectory(prefix="rustline-release-") as directory:
        scratch = Path(directory)
        dev = scratch / "dev"
        shutil.copytree(repo / "dev", dev, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "index.html"))
        subprocess.run([sys.executable, str(dev / "build.py")], cwd=dev, check=True)
        archive = scratch / "Rustline-source.zip"
        subprocess.run([sys.executable, str(dev / "pack_source.py"), str(archive)], cwd=dev, check=True)
        for generated, released in [(dev / "index.html", repo / "rustline-web/index.html"),
                                    (archive, repo / "development/Rustline-source.zip")]:
            label = released.relative_to(repo)
            if not filecmp.cmp(generated, released, shallow=False):
                raise SystemExit(f"Release differs from its sources: {label}")
            print(f"{label}  {sha256(generated.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
