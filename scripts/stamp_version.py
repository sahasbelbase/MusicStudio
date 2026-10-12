#!/usr/bin/env python3
"""
Stamp the release version into the app before building, so the built app knows its own version.

CI runs this on a `v*` tag push (e.g. v1.0.1 -> 1.0.1). Installed copies compare that version with
the latest GitHub release to tell the user an update is available.

Usage: python scripts/stamp_version.py [v1.2.3]   (defaults to $GITHUB_REF_NAME)
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
version = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GITHUB_REF_NAME", "")).lstrip("vV")
if not re.fullmatch(r"\d+\.\d+\.\d+", version):
    sys.exit(f"Not a release version: {version!r} (expected a tag like v1.2.3)")


def stamp(rel_path, pattern, replacement):
    path = os.path.join(ROOT, rel_path)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    text, count = re.subn(pattern, replacement, text)
    if not count:
        sys.exit(f"Version marker {pattern!r} not found in {rel_path}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


stamp("updater.py", r'APP_VERSION = "[^"]*"', f'APP_VERSION = "{version}"')
stamp("installer/MusicStudio_Installer.nsi", r'!define APP_VERSION(\s+)"[^"]*"', rf'!define APP_VERSION\g<1>"{version}"')
stamp("installer/MusicStudio_Installer.nsi", r'VIProductVersion "[^"]*"', f'VIProductVersion "{version}.0"')
stamp("music_studio.spec", r"'(CFBundleShortVersionString|CFBundleVersion)': '[^']*'", rf"'\g<1>': '{version}'")

pkg_path = os.path.join(ROOT, "package.json")
with open(pkg_path, encoding="utf-8") as f:
    pkg = json.load(f)
pkg["version"] = version
with open(pkg_path, "w", encoding="utf-8") as f:
    json.dump(pkg, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Stamped version {version}")
