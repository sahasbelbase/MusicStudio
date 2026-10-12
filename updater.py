"""
Runtime updater for the downloader engine (yt-dlp).

The packaged app bundles a frozen copy of yt-dlp, which goes stale whenever YouTube
changes. This module downloads the latest pure-Python wheel from PyPI into a
user-writable folder and puts it ahead of the bundled copy on sys.path, so no
app re-install is needed.
"""

import hashlib
import importlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import zipfile

from ssl_helper import safe_urlopen

APP_VERSION = "1.0.0"
APP_REPO = "sahasbelbase/MusicStudio"
PKG_DIR = os.path.expanduser("~/.musicstudio/pkgs")
# PyPI project name -> top-level import package(s) inside the wheel
PACKAGES = {
    "yt-dlp": ["yt_dlp"],
    "yt-dlp-ejs": ["yt_dlp_ejs"],  # JS challenge solver scripts used by newer yt-dlp
}

_lock = threading.Lock()


def activate():
    """Prefer user-updated packages over the bundled ones. Call before importing yt_dlp."""
    if os.path.isdir(PKG_DIR) and PKG_DIR not in sys.path:
        sys.path.insert(0, PKG_DIR)


def installed_version() -> str:
    try:
        return importlib.import_module("yt_dlp.version").__version__
    except Exception:
        return "unknown"


def _pypi(name: str) -> dict:
    with safe_urlopen(f"https://pypi.org/pypi/{name}/json", timeout=20) as r:
        return json.loads(r.read().decode())


def latest_version() -> str:
    return _pypi("yt-dlp")["info"]["version"]


def _norm(v: str) -> tuple:
    """PyPI says 2026.8.19, yt-dlp says 2026.08.19 - compare numerically."""
    return tuple(int(p) if p.isdigit() else p for p in v.split("."))


def check() -> dict:
    current = installed_version()
    try:
        latest = latest_version()
    except Exception as e:
        return {"current": current, "latest": None, "update_available": False, "error": str(e)}
    return {"current": current, "latest": latest, "update_available": _norm(latest) != _norm(current), "error": None}


def _install_wheel(name: str, roots: list) -> str:
    data = _pypi(name)
    wheel = next((u for u in data["urls"] if u["packagetype"] == "bdist_wheel" and u["filename"].endswith("none-any.whl")), None)
    if not wheel:
        raise RuntimeError(f"No universal wheel published for {name}")
    with safe_urlopen(wheel["url"], timeout=120) as r:
        blob = r.read()
    if hashlib.sha256(blob).hexdigest() != wheel["digests"]["sha256"]:
        raise RuntimeError(f"Checksum mismatch for {name}")

    os.makedirs(PKG_DIR, exist_ok=True)
    stage = tempfile.mkdtemp(dir=PKG_DIR, prefix=".stage_")
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            z.extractall(stage)
        for root in roots:
            src = os.path.join(stage, root)
            if not os.path.isdir(src):
                raise RuntimeError(f"{root} missing from {name} wheel")
            dst = os.path.join(PKG_DIR, root)
            old = dst + ".old"
            shutil.rmtree(old, ignore_errors=True)
            if os.path.isdir(dst):
                os.replace(dst, old)
            os.replace(src, dst)
            shutil.rmtree(old, ignore_errors=True)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return data["info"]["version"]


def reload_ytdlp():
    """Drop cached yt_dlp modules so the next import picks up the updated copy."""
    activate()
    for m in [m for m in sys.modules if m == "yt_dlp" or m.startswith("yt_dlp.") or m.startswith("yt_dlp_ejs")]:
        del sys.modules[m]
    importlib.invalidate_caches()
    return importlib.import_module("yt_dlp")


def update() -> dict:
    """Download and hot-swap the latest yt-dlp. Returns {ok, previous, current, error}."""
    with _lock:
        previous = installed_version()
        try:
            for name, roots in PACKAGES.items():
                try:
                    _install_wheel(name, roots)
                except Exception:
                    if name == "yt-dlp":
                        raise  # the ejs helper is optional
            reload_ytdlp()
            return {"ok": True, "previous": previous, "current": installed_version(), "error": None}
        except Exception as e:
            return {"ok": False, "previous": previous, "current": installed_version(), "error": str(e)}


def js_runtimes() -> dict:
    """JS runtimes found on this machine, for yt-dlp's YouTube challenge solving."""
    return {rt: {} for rt in ("deno", "node", "bun") if shutil.which(rt)}


def _ver_tuple(v: str) -> tuple:
    return tuple(int(p) for p in v.lstrip("vV").split(".") if p.isdigit())


def check_app_update() -> dict:
    """Look for a newer Music Studio release on GitHub and pick the download for this OS."""
    out = {"current": APP_VERSION, "latest": None, "update_available": False, "url": None, "notes": ""}
    try:
        with safe_urlopen(f"https://api.github.com/repos/{APP_REPO}/releases/latest", timeout=15) as r:
            rel = json.loads(r.read().decode())
        latest = rel.get("tag_name", "")
        want = ".dmg" if sys.platform == "darwin" else ("setup.exe" if sys.platform == "win32" else None)
        asset = next((a for a in rel.get("assets", []) if want and a["name"].lower().endswith(want)), None)
        out.update(
            latest=latest.lstrip("vV"),
            update_available=_ver_tuple(latest) > _ver_tuple(APP_VERSION),
            url=asset["browser_download_url"] if asset else rel.get("html_url"),
            notes=(rel.get("body") or "")[:600],
        )
    except Exception:
        pass  # offline, rate-limited, or no release yet: stay quiet
    return out
