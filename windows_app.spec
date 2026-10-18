# -*- mode: python ; coding: utf-8 -*-
import os
import sys

block_cipher = None
BASE_DIR = os.path.abspath(SPECPATH)

# FFmpeg comes from imageio-ffmpeg: a real static build that its PyInstaller hook collects and
# find_ffmpeg() locates at runtime. Don't bundle shutil.which("ffmpeg"): on the CI runner that is
# Chocolatey's shim, a tiny launcher pointing at the build machine's install that fails on every other PC.
binaries = []

datas = [
    (os.path.join(BASE_DIR, 'static'), 'static'),
    (os.path.join(BASE_DIR, 'MusicStudio.ico'), '.'),
]

hiddenimports = [
    'lyrics',
    'audio_analysis',
    'spotapi',
    'curl_cffi',

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
    'python_multipart',
    'mutagen',
    'mutagen.mp3',
    'mutagen.id3',
    'yt_dlp',
    'yt_dlp.extractor',
    'requests',
    'certifi',
    'webview',
    'PIL',
    'PIL.Image',
    'imageio_ffmpeg',
    'app',
    'download_playlist',
    'discovery',
    'fix_metadata',
    'ssl_helper',
    'updater',
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
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='MusicStudio',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(BASE_DIR, 'MusicStudio.ico') if os.path.exists(os.path.join(BASE_DIR, 'MusicStudio.ico')) else None,
)
