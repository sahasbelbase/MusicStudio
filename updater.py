"""
Runtime updater and self-repair for the download engine.

The packaged app bundles frozen copies of yt-dlp and spotapi, which go stale whenever YouTube or
Spotify change. This module downloads the latest pure-Python wheels from PyPI into a user-writable
folder that sits ahead of the bundled copies on sys.path, so no app re-install is needed. It also
provides a JavaScript runtime (QuickJS) when the machine has none, which yt-dlp needs to solve
YouTube's playback challenges.
"""

import hashlib
import importlib
import io
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
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

BIN_DIR = os.path.expanduser("~/.musicstudio/bin")

# QuickJS-NG builds (MIT), pinned by SHA-256: https://github.com/quickjs-ng/quickjs/releases/tag/v0.17.0
QJS_VERSION = "v0.17.0"
QJS_ASSETS = {
    ("darwin", "arm64"): ("qjs-darwin-arm64", "8be3ddfe3397d2e692e4e1e8972ee9d032a0a580505d2f8b4ea528cf1b651c11"),
    ("darwin", "x86_64"): ("qjs-darwin-x86_64", "9e5e101b4fd13cda3204222ca9f8be35412c41dcdef3745829633b7a67245412"),
    ("win32", "amd64"): ("qjs-windows-x86_64.exe", "2aeabf0092c3262d6b2609824418f7dd7ed1f1df939f73b2b15645230cac0d77"),
    ("win32", "arm64"): ("qjs-windows-x86_64.exe", "2aeabf0092c3262d6b2609824418f7dd7ed1f1df939f73b2b15645230cac0d77"),
    ("win32", "x86"): ("qjs-windows-x86.exe", "dedc4dd8da20234d206c433a706336fede47a14e75c690cb607f81aa9c9c71be"),
    ("linux", "x86_64"): ("qjs-linux-x86_64", "0bfc02511a9f549c28b53880d988fc7cd5d361e90c5e8afdfcd7dc6774ceace5"),
    ("linux", "aarch64"): ("qjs-linux-aarch64", "3372133484edf50a69f3c67903af41206d22a061e930e3cfb63269272ef56d2e"),
}

HEAL_INTERVAL = 30 * 60   # at most one self-repair attempt per package every 30 minutes

_lock = threading.Lock()
_heal_lock = threading.Lock()
_last_heal = {}


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


def _purge(*packages: str):
    """Drop cached modules so the next import picks up the updated copy."""
    for m in [m for m in sys.modules if any(m == p or m.startswith(p + ".") for p in packages)]:
        del sys.modules[m]
    importlib.invalidate_caches()


def reload_ytdlp():
    activate()
    _purge("yt_dlp", "yt_dlp_ejs")
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


def update_spotapi() -> bool:
    """Hot-swap the latest spotapi; roll back if the new copy does not import with the bundled dependencies."""
    with _lock:
        dst = os.path.join(PKG_DIR, "spotapi")
        backup = dst + ".bak"
        shutil.rmtree(backup, ignore_errors=True)
        had_copy = os.path.isdir(dst)
        if had_copy:
            shutil.copytree(dst, backup)
        try:
            _install_wheel("spotapi", ["spotapi"])
            activate()
            _purge("spotapi")
            importlib.import_module("spotapi")
            shutil.rmtree(backup, ignore_errors=True)
            return True
        except Exception:
            shutil.rmtree(dst, ignore_errors=True)
            if had_copy:
                os.replace(backup, dst)
            _purge("spotapi")
            return False


def _qjs_path() -> str:
    return os.path.join(BIN_DIR, "qjs.exe" if sys.platform == "win32" else "qjs")


def ensure_js_runtime() -> bool:
    """
    Make sure yt-dlp has a JavaScript runtime by downloading a checksum-verified QuickJS (~1-2 MB).
    Fetched even when deno/node/bun are installed: yt-dlp rejects old ones (Node older than 22, common
    on Windows PCs). Without a runtime, YouTube often answers 403, a bot check, or hides formats.
    """
    if os.path.isfile(_qjs_path()):
        return True
    os_key = "linux" if sys.platform.startswith("linux") else sys.platform
    asset = QJS_ASSETS.get((os_key, platform.machine().lower()))
    if not asset:
        return False
    name, digest = asset
    try:
        with safe_urlopen(f"https://github.com/quickjs-ng/quickjs/releases/download/{QJS_VERSION}/{name}", timeout=60) as r:
            blob = r.read()
    except Exception:
        return False
    if hashlib.sha256(blob).hexdigest() != digest:
        return False
    os.makedirs(BIN_DIR, exist_ok=True)
    tmp = _qjs_path() + ".part"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.chmod(tmp, 0o755)
    os.replace(tmp, _qjs_path())
    return True


def js_runtimes() -> dict:
    """JS runtimes for yt-dlp's YouTube challenge solving: installed ones plus our QuickJS (yt-dlp skips unsupported ones)."""
    found = {rt: {} for rt in ("deno", "node", "bun") if shutil.which(rt)}
    if os.path.isfile(_qjs_path()):
        found["quickjs"] = {"path": _qjs_path()}
    return found


def looks_like_extractor_failure(exc: Exception) -> bool:
    """Errors that a newer yt-dlp or a JS runtime usually fixes (YouTube changed something)."""
    msg = str(exc).lower()
    return any(k in msg for k in (
        "sign in to confirm", "unable to extract", "http error 403", "http error 400",
        "signature", "nsig", "player response", "requested format is not available",
        "no video formats", "javascript runtime", "po token", "forbidden",
    ))


def heal(exc: Exception, package: str = "yt-dlp") -> bool:
    """
    Self-repair after a failure: for yt-dlp, fetch a JS runtime if missing and update yt-dlp;
    for spotapi, update spotapi. Throttled per package. Returns True when something was refreshed,
    so the caller can retry once.
    """
    if package == "yt-dlp" and not looks_like_extractor_failure(exc):
        return False
    with _heal_lock:
        now = time.time()
        if now - _last_heal.get(package, 0) < HEAL_INTERVAL:
            return False
        _last_heal[package] = now
    try:
        if package == "spotapi":
            return update_spotapi()
        runtime_added = not os.path.isfile(_qjs_path()) and ensure_js_runtime()
        return bool(update().get("ok")) or runtime_added
    except Exception:
        return False


def _ver_tuple(v: str) -> tuple:
    return tuple(int(p) for p in v.lstrip("vV").split(".") if p.isdigit())


def _url_exists(url: str) -> bool:
    try:
        with safe_urlopen(urllib.request.Request(url, method="HEAD"), timeout=15) as r:
            return r.status < 400
    except Exception:
        return False


def check_app_update() -> dict:
    """
    Look for a newer Music Studio release on GitHub and pick the download for this OS.

    Reads the public redirect github.com/<repo>/releases/latest -> .../releases/tag/vX.Y.Z instead of
    the REST API, whose anonymous limit (60 requests/hour per network) is easy to hit.
    """
    out = {"current": APP_VERSION, "latest": None, "update_available": False, "url": None, "error": None,
           "can_install": False}
    try:
        with safe_urlopen(f"https://github.com/{APP_REPO}/releases/latest", timeout=15) as r:
            final_url = r.geturl()
    except urllib.error.HTTPError as e:
        out["error"] = "no_release" if e.code == 404 else f"GitHub returned HTTP {e.code}"
        return out
    except Exception:
        out["error"] = "offline"
        return out

    m = re.search(r"/releases/tag/([^/?#]+)", final_url)
    if not m:
        out["error"] = "no_release"  # GitHub sends us to the release list when nothing is published
        return out
    tag = urllib.parse.unquote(m.group(1))
    out["latest"] = tag.lstrip("vV")
    out["update_available"] = _ver_tuple(tag) > _ver_tuple(APP_VERSION)
    out["url"] = f"https://github.com/{APP_REPO}/releases/tag/{tag}"
    if out["update_available"]:
        # Asset names come from .github/workflows/build_releases.yml
        asset = {"darwin": "MusicStudio-Installer.dmg", "win32": "MusicStudio-Setup.exe"}.get(sys.platform)
        direct = f"https://github.com/{APP_REPO}/releases/download/{tag}/{asset}" if asset else None
        if direct and _url_exists(direct):
            out["url"] = direct
            out["can_install"] = _installed_app_path() is not None
    return out


# ---- In-place app update: download the new release, quit, let a helper swap it in and reopen ----

_app_update = {"state": "idle", "progress": 0, "error": None}
_app_update_lock = threading.Lock()
UPDATE_LOG = os.path.expanduser("~/.musicstudio/app_update.log")


def _installed_app_path():
    """The installed app this process can replace (macOS .app bundle or Windows exe), or None."""
    if not getattr(sys, "frozen", False):
        return None  # running from source
    if sys.platform == "darwin":
        app = os.path.abspath(os.path.join(os.path.dirname(sys.executable), "..", ".."))
        # Apps run from the DMG or a quarantined download live on a read-only translocated path
        if not app.endswith(".app") or "/AppTranslocation/" in app or not os.access(os.path.dirname(app), os.W_OK):
            return None
        return app
    if sys.platform == "win32":
        return sys.executable
    return None


def app_update_status() -> dict:
    return dict(_app_update)


def start_app_update(url: str, quit_app) -> None:
    """Download the release asset in the background; once it's ready, start the installer helper and call quit_app()."""
    target = _installed_app_path()
    if not target:
        raise RuntimeError("This copy of Music Studio can't update itself")
    with _app_update_lock:
        if _app_update["state"] in ("downloading", "installing"):
            return
        _app_update.update(state="downloading", progress=0, error=None)
    threading.Thread(target=_download_and_install, args=(url, target, quit_app), daemon=True).start()


def _download_and_install(url: str, target: str, quit_app):
    work = tempfile.mkdtemp(prefix="musicstudio_update_")
    try:
        package = os.path.join(work, url.rsplit("/", 1)[-1])
        with safe_urlopen(url, timeout=60) as r, open(package, "wb") as f:
            total, done = int(r.headers.get("Content-Length") or 0), 0
            while chunk := r.read(256 * 1024):
                f.write(chunk)
                done += len(chunk)
                if total:
                    _app_update["progress"] = min(99, done * 100 // total)
        if total and done != total:
            raise RuntimeError("The download was incomplete")
        _app_update.update(state="installing", progress=100)
        os.makedirs(os.path.dirname(UPDATE_LOG), exist_ok=True)
        if sys.platform == "darwin":
            _launch_mac_helper(package, target, work)
        else:
            _launch_windows_helper(package, target, work)
        quit_app()
    except Exception as e:
        shutil.rmtree(work, ignore_errors=True)
        _app_update.update(state="error", error=str(e))


def _launch_mac_helper(dmg: str, app: str, work: str):
    q = shlex.quote
    old = app + ".old"
    script = os.path.join(work, "update.sh")
    with open(script, "w") as f:
        f.write(f"""#!/bin/sh
# Wait for Music Studio to quit, replace the app with the one in the new disk image, reopen it.
# Any failure puts the previous app back, so the user always ends up with a working Music Studio.
exec >>{q(UPDATE_LOG)} 2>&1
echo "== $(date) updating {q(app)}"
while kill -0 {os.getpid()} 2>/dev/null; do sleep 0.5; done
mnt=$(mktemp -d)
if hdiutil attach -nobrowse -noautoopen -readonly -mountpoint "$mnt" {q(dmg)}; then
  if [ -d "$mnt/Music Studio.app" ]; then
    rm -rf {q(old)}
    if mv {q(app)} {q(old)}; then
      if ditto "$mnt/Music Studio.app" {q(app)}; then rm -rf {q(old)}; else rm -rf {q(app)}; mv {q(old)} {q(app)}; fi
    fi
  fi
  hdiutil detach "$mnt" -quiet || hdiutil detach "$mnt" -force -quiet
fi
rmdir "$mnt" 2>/dev/null
xattr -cr {q(app)}
open {q(app)}
rm -rf {q(work)}
""")
    subprocess.Popen(["/bin/sh", script], start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _launch_windows_helper(setup: str, exe: str, work: str):
    def q(s: str) -> str:  # PowerShell single-quoted string
        return "'" + s.replace("'", "''") + "'"
    name = os.path.splitext(os.path.basename(exe))[0]
    script = os.path.join(work, "update.ps1")
    with open(script, "w", encoding="utf-8-sig") as f:
        f.write(f"""# Wait for Music Studio to quit, run the new installer silently (Windows asks for admin
# permission), then reopen the app. If the user declines, the current version simply reopens.
Start-Transcript -Append -Path {q(UPDATE_LOG)} | Out-Null
Get-Process -Name {q(name)} -ErrorAction SilentlyContinue | Wait-Process -Timeout 60 -ErrorAction SilentlyContinue
try {{ Start-Process -FilePath {q(setup)} -ArgumentList '/S' -Verb RunAs -Wait }} catch {{ Write-Output $_ }}
$dir = (Get-ItemProperty 'HKCU:\\Software\\MusicStudio' -ErrorAction SilentlyContinue).InstallDir
$app = if ($dir -and (Test-Path (Join-Path $dir 'MusicStudio.exe'))) {{ Join-Path $dir 'MusicStudio.exe' }} else {{ {q(exe)} }}
Start-Process -FilePath $app
Stop-Transcript | Out-Null
Remove-Item -Recurse -Force {q(work)} -ErrorAction SilentlyContinue
""")
    subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script],
                     creationflags=0x08000000 | 0x00000200,  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
