# -*- mode: python ; coding: utf-8 -*-
import os
import sys
import shutil

block_cipher = None

BASE_DIR = os.path.abspath(SPECPATH)

# Locate ffmpeg binary to embed into the app bundle
ffmpeg_path = None
for candidate in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", shutil.which("ffmpeg")]:
    if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
        ffmpeg_path = candidate
        break

binaries = []
if ffmpeg_path:
    binaries.append((ffmpeg_path, '.'))
    print(f"[*] Embedding FFmpeg into bundle from: {ffmpeg_path}")
else:
    print("[!] Warning: ffmpeg not found for bundling!")

datas = [
    (os.path.join(BASE_DIR, 'static'), 'static'),
]

hiddenimports = [
    'audio_analysis',
    'curl_cffi',

    'updater',
    'ssl_helper',
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespans',
    'uvicorn.lifespans.on',
    'uvicorn.lifespans.off',
    'fastapi',
    'pydantic',
    'mutagen',
    'mutagen.mp3',
    'mutagen.id3',
    'yt_dlp',
    'yt_dlp.extractor',
    'requests',
    'certifi',
    'webview',
    'webview.platforms.cocoa',
    'PIL',
    'PIL.Image',
    'AppKit',
    'Foundation',
    'app',
    'download_playlist',
    'discovery',
    'fix_metadata',
    'ssl_helper',
    'mac_nowplaying',
    'mac_icon_helper',
    'WebKit',
    'PyObjCTools',
    'PyObjCTools.AppHelper',
    'spotapi',
]

a = Analysis(
    ['desktop_app.py'],
    pathex=[BASE_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Music Studio',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(BASE_DIR, 'MusicStudio.icns') if os.path.exists(os.path.join(BASE_DIR, 'MusicStudio.icns')) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Music Studio',
)

if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='Music Studio.app',
        icon=os.path.join(BASE_DIR, 'MusicStudio.icns') if os.path.exists(os.path.join(BASE_DIR, 'MusicStudio.icns')) else None,
        bundle_identifier='com.musicstudio.app',
        info_plist={
            'CFBundleShortVersionString': '1.0.0',
            'CFBundleVersion': '1.0.0',
            'NSHighResolutionCapable': 'True',
            'LSMinimumSystemVersion': '11.0',
            'NSHumanReadableCopyright': 'Copyright © 2026 Music Studio',
        },
    )
