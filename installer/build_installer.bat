@echo off
setlocal enabledelayedexpansion
title Music Studio - Installer Builder
color 0A

echo.
echo  =====================================================
echo    Music Studio Installer Builder v1.0
echo  =====================================================
echo.

cd /d "%~dp0"

:: ============================================================
:: Step 1 — Locate NSIS (makensis.exe)
:: ============================================================
echo [1/5] Locating NSIS (makensis)...

set "NSIS_EXE="

:: Check bundled portable NSIS first
if exist "nsis-3.12\makensis.exe" (
    set "NSIS_EXE=%~dp0nsis-3.12\makensis.exe"
    goto :nsis_found
)
if exist "nsis\makensis.exe" (
    set "NSIS_EXE=%~dp0nsis\makensis.exe"
    goto :nsis_found
)

:: Check system PATH
where makensis >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set "NSIS_EXE=makensis"
    goto :nsis_found
)

:: Common install paths
for %%P in (
    "C:\Program Files\NSIS\makensis.exe"
    "C:\Program Files (x86)\NSIS\makensis.exe"
) do (
    if exist %%P (
        set "NSIS_EXE=%%~P"
        goto :nsis_found
    )
)

echo.
echo  [ERROR] NSIS (makensis) was not found.
echo.
echo  Options:
echo    1. Run this script — it will auto-download NSIS portable
echo    2. Install NSIS: winget install NSIS.NSIS
echo    3. Download from: https://nsis.sourceforge.io/Download
echo.
echo  Attempting to download NSIS portable now...
echo.

python -c "
import urllib.request, zipfile, os, sys

nsis_zip = 'nsis_portable.zip'
nsis_dir = 'nsis-3.12'
url = 'https://sourceforge.net/projects/nsis/files/NSIS%%203/3.12/nsis-3.12.zip/download'

def progress(b, bs, total):
    done = b * bs
    if total > 0:
        pct = min(100, done * 100 // total)
        sys.stdout.write(f'\r  Downloading NSIS: {pct}%%   ')
        sys.stdout.flush()

print('Downloading NSIS 3.12 portable...')
urllib.request.urlretrieve(url, nsis_zip, progress)
print()
with zipfile.ZipFile(nsis_zip) as z:
    z.extractall('.')
os.remove(nsis_zip)
print(f'NSIS extracted.')
"

if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Failed to download NSIS. Please install manually.
    pause
    exit /b 1
)

if exist "nsis-3.12\makensis.exe" (
    set "NSIS_EXE=%~dp0nsis-3.12\makensis.exe"
    goto :nsis_found
)

echo  [ERROR] NSIS download failed. Cannot build installer.
pause
exit /b 1

:nsis_found
echo  [OK] NSIS: %NSIS_EXE%
echo.

:: ============================================================
:: Step 2 — Check Python
:: ============================================================
echo [2/5] Checking Python...

set "PY_CMD="
where python >nul 2>&1
if %ERRORLEVEL% equ 0 ( set "PY_CMD=python" & goto :python_ok )
where py >nul 2>&1
if %ERRORLEVEL% equ 0 ( set "PY_CMD=py -3" & goto :python_ok )

echo  [WARN] Python not found. Skipping Python-dependent setup steps.
goto :skip_python

:python_ok
echo  [OK] Python: %PY_CMD%
echo.

:: ============================================================
:: Step 3 — Download Python Embeddable Package
:: ============================================================
echo [3/5] Checking Python 3.12 embeddable runtime...

if exist "python_embed\python.exe" (
    echo  [OK] python_embed\ already present.
    goto :python_embed_done
)

echo  Downloading Python 3.12.7 embeddable (Windows x64)...
mkdir python_embed 2>nul

%PY_CMD% -c "
import urllib.request, zipfile, os, sys
url = 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip'
def progress(b,bs,total):
    done=b*bs
    if total>0:
        pct=min(100,done*100//total)
        sys.stdout.write(f'\r  Progress: {pct}%%   ')
        sys.stdout.flush()
urllib.request.urlretrieve(url,'python_embed.zip',progress)
print()
with zipfile.ZipFile('python_embed.zip') as z:
    z.extractall('python_embed')
os.remove('python_embed.zip')
# Enable site-packages
import pathlib
pth_files = list(pathlib.Path('python_embed').glob('python*._pth'))
if pth_files:
    pth_files[0].write_text('python312.zip\r\n.\r\n..\r\nLib\\site-packages\r\n\r\nimport site\r\n')
    print('Enabled site-packages in', pth_files[0])
print('Python embeddable ready.')
"

if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Failed to download Python embeddable.
    echo  Download manually from: https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip
    echo  Extract to: %~dp0python_embed\
    pause
    exit /b 1
)

echo  [OK] Python 3.12 embeddable package ready.

:python_embed_done
echo.

:: ============================================================
:: Step 4 — Bundle Dependencies into python_embed
:: ============================================================
echo [4/5] Pre-bundling dependencies into python_embed...

if not exist "get-pip.py" (
    %PY_CMD% -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', 'get-pip.py'); print('get-pip.py downloaded.')"
)

if not exist "python_embed\Scripts\pip.exe" (
    echo  Bootstrapping pip in python_embed...
    python_embed\python.exe get-pip.py --no-warn-script-location
)

python_embed\python.exe -c "import uvicorn, fastapi, webview, mutagen, yt_dlp, PIL, imageio_ffmpeg, pydantic, certifi" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] All Python dependencies already bundled.
) else (
    echo  Installing required packages into python_embed...
    python_embed\python.exe -m pip install --no-warn-script-location setuptools wheel
    python_embed\python.exe -m pip install --no-warn-script-location -r "..\requirements.txt"
    if !ERRORLEVEL! neq 0 (
        echo  [WARN] Dependency installation encountered issues.
    ) else (
        echo  [OK] Dependencies bundled successfully.
    )
)

:skip_python


:: ============================================================
:: Step 5 — Compile the NSIS Installer
:: ============================================================
echo [5/5] Compiling Music Studio installer...
echo.

if not exist "..\releases" mkdir "..\releases"

"%NSIS_EXE%" /V2 MusicStudio_Installer.nsi

if !ERRORLEVEL! neq 0 (
    echo.
    echo  =====================================================
    echo  [ERROR] NSIS compilation failed! (Exit code: !ERRORLEVEL!)
    echo  =====================================================
    echo  Check the output above for details.
    echo.
    pause
    exit /b !ERRORLEVEL!
)


echo.
echo  =====================================================
echo  [SUCCESS] Installer built!
echo.
if exist "..\releases\MusicStudio-Setup.exe" (
    for %%F in ("..\releases\MusicStudio-Setup.exe") do (
        echo   File: releases\MusicStudio-Setup.exe
        set /a SIZE_MB=%%~zF / 1048576
        echo   Size: !SIZE_MB! MB (%%~zF bytes)
    )
)
echo  =====================================================
echo.

pause
endlocal
