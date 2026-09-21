@echo off
setlocal enabledelayedexpansion
title Music Studio
cd /d "%~dp0"

:: ============================================================
:: Music Studio Launcher
:: Silently handles Python detection + dependency installation
:: ============================================================

:: ── Step 1: Find Python ─────────────────────────────────────────────────────

set "PY_CMD="
set "PY_IS_RUNTIME=0"

:: Priority 1: Bundled embedded runtime (installed by Setup)
if exist "%~dp0runtime\python.exe" (
    set "PY_CMD=%~dp0runtime\python.exe"
    set "PY_IS_RUNTIME=1"
    goto :python_found
)

:: Priority 2: System PATH
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set "PY_CMD=python"
    goto :python_found
)

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set "PY_CMD=py -3"
    goto :python_found
)

:: Priority 3: Well-known install directories
for %%V in (314 313 312 311 310 39 38) do (
    if exist "C:\Python%%V\python.exe" (
        set "PY_CMD=C:\Python%%V\python.exe"
        goto :python_found
    )
    if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" (
        set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
        goto :python_found
    )
)

:: Python not found — show friendly message and open download page
powershell -WindowStyle Hidden -Command ^
  "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Python 3.8+ is required to run Music Studio.`n`nThe Python download page will now open.`nPlease install Python and make sure to check ''Add Python to PATH''.', 'Music Studio — Setup Required', 'OK', 'Information') | Out-Null"
start "" "https://www.python.org/downloads/windows/"
exit /b 1

:python_found

:: ── Step 2: Ensure pip is available ─────────────────────────────────────────

%PY_CMD% -m pip --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    :: pip not found — install it silently
    if exist "%~dp0installer\get-pip.py" (
        %PY_CMD% "%~dp0installer\get-pip.py" --no-warn-script-location >nul 2>&1
    ) else (
        %PY_CMD% -m ensurepip --upgrade >nul 2>&1
    )
)

:: ── Step 3: Check and install dependencies ──────────────────────────────────

:: For embedded runtime: packages go into runtime\Lib\site-packages via --target
:: For system Python: packages go into normal site-packages

%PY_CMD% -c "import fastapi, uvicorn, mutagen, yt_dlp, webview, PIL, imageio_ffmpeg, pydantic, certifi" >nul 2>&1
if %ERRORLEVEL% equ 0 goto :deps_ok

:: Dependencies missing — install silently in background with progress window
echo.
echo Installing Music Studio dependencies...
echo This only happens once. Please wait.
echo.

if "!PY_IS_RUNTIME!"=="1" (
    :: Embedded runtime: install into runtime\Lib\site-packages
    set "SITE_PKGS=%~dp0runtime\Lib\site-packages"
    %PY_CMD% -m pip install --no-warn-script-location --target="!SITE_PKGS!" ^
        yt-dlp mutagen fastapi "uvicorn[standard]" requests pywebview pillow ^
        imageio-ffmpeg pydantic python-multipart certifi >nul 2>&1
) else (
    :: System Python: install normally
    %PY_CMD% -m pip install --no-warn-script-location ^
        yt-dlp mutagen fastapi "uvicorn[standard]" requests pywebview pillow ^
        imageio-ffmpeg pydantic python-multipart certifi >nul 2>&1
)

if !ERRORLEVEL! neq 0 (
    :: Installation failed — try once more with verbose output so user sees what's wrong
    echo [INFO] First install attempt had issues. Retrying with requirements.txt...
    if "!PY_IS_RUNTIME!"=="1" (
        %PY_CMD% -m pip install --no-warn-script-location --target="%~dp0runtime\Lib\site-packages" -r "%~dp0requirements.txt"
    ) else (
        %PY_CMD% -m pip install --no-warn-script-location -r "%~dp0requirements.txt"
    )
    if !ERRORLEVEL! neq 0 (
        powershell -WindowStyle Hidden -Command ^
          "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Failed to install Music Studio dependencies.`n`nPlease check your internet connection and try again.`n`nYou can also run manually:`n  pip install -r requirements.txt', 'Music Studio — Setup Error', 'OK', 'Error') | Out-Null"
        exit /b 1
    )
)

echo [OK] Dependencies installed.

:deps_ok

:: ── Step 4: Launch Music Studio ─────────────────────────────────────────────

:: Use pythonw.exe (no console window) if available, otherwise python.exe
set "LAUNCH_PY=!PY_CMD!"
if "!PY_IS_RUNTIME!"=="1" (
    if exist "%~dp0runtime\pythonw.exe" (
        set "LAUNCH_PY=%~dp0runtime\pythonw.exe"
    )
) else (
    :: For system Python try to find pythonw.exe beside python.exe
    for %%P in ("!PY_CMD!") do (
        if exist "%%~dpPpythonw.exe" (
            set "LAUNCH_PY=%%~dpPpythonw.exe"
        )
    )
)

start "" "!LAUNCH_PY!" "%~dp0desktop_app.py"

endlocal
