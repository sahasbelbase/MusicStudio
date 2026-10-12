@echo off
setlocal
title Music Studio - Build Windows Installer
cd /d "%~dp0\.."

echo [1/3] Installing build dependencies...
python -m pip install --upgrade pip || goto :fail
python -m pip install -r requirements.txt pyinstaller || goto :fail

echo [2/3] Building the standalone MusicStudio.exe...
python -m PyInstaller --clean -y windows_app.spec || goto :fail

echo [3/3] Building the installer with NSIS...
set "MAKENSIS=makensis"
where makensis >nul 2>nul || set "MAKENSIS=%ProgramFiles(x86)%\NSIS\makensis.exe"
"%MAKENSIS%" installer\MusicStudio_Installer.nsi || goto :fail

echo.
echo Done: dist\MusicStudio-Setup.exe
exit /b 0

:fail
echo.
echo Build failed. Install NSIS from https://nsis.sourceforge.io (or: choco install nsis) and retry.
exit /b 1
