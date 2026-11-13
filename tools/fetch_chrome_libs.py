#!/usr/bin/env python3
"""Lädt die fehlenden Chrome-Systembibliotheken als .deb-Pakete und entpackt sie
lokal nach .tools/sysroot (ohne root / ohne apt-Listen).

Aufruf:  python3 tools/fetch_chrome_libs.py
Danach:  export LD_LIBRARY_PATH=$PWD/.tools/sysroot/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
"""
from __future__ import annotations

import gzip
import pathlib
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEBS = pathlib.Path("/tmp/chrome-debs")
SYSROOT = ROOT / ".tools/sysroot"
SUITES = ["noble", "noble-updates", "noble-security"]
COMPONENTS = ["main", "universe"]
MIRROR = "http://archive.ubuntu.com/ubuntu"

# Alles, was ldd für chrome-headless-shell als fehlend gemeldet hat.
WANTED = [
    "libnspr4",
    "libnss3",
    "libatk1.0-0t64",
    "libatk-bridge2.0-0t64",
    "libxcomposite1",
    "libxdamage1",
    "libxfixes3",
    "libxrandr2",
    "libxkbcommon0",
    "libasound2t64",
    "libatspi2.0-0t64",
]


def load_index() -> dict[str, tuple[str, list[str]]]:
    index: dict[str, tuple[str, list[str]]] = {}
    for suite in SUITES:
        for comp in COMPONENTS:
            url = f"{MIRROR}/dists/{suite}/{comp}/binary-amd64/Packages.gz"
            try:
                raw = urllib.request.urlopen(url, timeout=120).read()
            except Exception as exc:  # noqa: BLE001 - Netzfehler tolerieren
                print(f"  ! {suite}/{comp}: {exc}", file=sys.stderr)
                continue
            text = gzip.decompress(raw).decode("utf-8", "replace")
            count = 0
            for stanza in text.split("\n\n"):
                name = re.search(r"^Package: (.+)$", stanza, re.M)
                filename = re.search(r"^Filename: (.+)$", stanza, re.M)
                if not name or not filename:
                    continue
                depends = re.findall(r"^(?:Pre-)?Depends: (.+)$", stanza, re.M)
                virtual = "Essential: yes" in stanza or "Section: metapackages" in stanza
                if virtual:
                    continue
                index[name.group(1).strip()] = (
                    filename.group(1).strip(),
                    [d.strip() for chunk in depends for d in chunk.split(",")],
                )
                count += 1
            print(f"  {suite}/{comp}: {count} Pakete")
    return index


def resolve(index, wanted):
    seen: dict[str, str] = {}
    queue = list(wanted)
    while queue:
        pkg = queue.pop()
        if pkg in seen:
            continue
        entry = index.get(pkg)
        if not entry:
            print(f"  ? {pkg} nicht im Index", file=sys.stderr)
            continue
        filename, depends = entry
        seen[pkg] = filename
        for dep in depends:
            alternative = dep.split("|")[0].strip()
            name = re.sub(r"\(.*?\)", "", alternative).strip()
            name = name.split(":")[0].strip()
            if name and name not in seen:
                queue.append(name)
    return seen


def main() -> None:
    print("Indizes laden …")
    index = load_index()
    debs = resolve(index, WANTED)
    print(f"{len(debs)} Pakete aufzulösen")
    DEBS.mkdir(parents=True, exist_ok=True)
    SYSROOT.mkdir(parents=True, exist_ok=True)
    for pkg, filename in sorted(debs.items()):
        target = DEBS / filename.split("/")[-1]
        if not target.exists():
            urllib.request.urlretrieve(f"{MIRROR}/{filename}", target)
        subprocess.run(
            ["dpkg-deb", "-x", str(target), str(SYSROOT)], check=True
        )
        print(f"  + {pkg}")
    libdir = SYSROOT / "usr/lib/x86_64-linux-gnu"
    print(f"\nFertig: {len(debs)} Pakete entpackt nach {libdir}")


if __name__ == "__main__":
    main()
