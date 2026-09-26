; ============================================================
; Music Studio — Windows Installer Script
; Built with NSIS (Nullsoft Scriptable Install System) 3.x
; ============================================================

!define APP_NAME        "Music Studio"
!define APP_VERSION     "1.0.0"
!define APP_PUBLISHER   "Music Studio"
!define APP_URL         "https://github.com/sahasbelbase/MusicDownloder"
!define UNINSTALLER_EXE "Uninstall Music Studio.exe"
!define REG_KEY         "Software\Microsoft\Windows\CurrentVersion\Uninstall\MusicStudio"

; ============================================================
; Compiler Settings
; ============================================================
Name "${APP_NAME}"
OutFile "..\releases\MusicStudio-Setup.exe"
InstallDir "$PROGRAMFILES64\MusicStudio"
InstallDirRegKey HKCU "Software\MusicStudio" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32

; ============================================================
; Modern UI 2
; ============================================================
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; UI Customization
!define MUI_ICON                        "..\MusicStudio.ico"
!define MUI_UNICON                      "..\MusicStudio.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP          "header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP    "sidebar.bmp"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT           "Are you sure you want to cancel the Music Studio installation?"

; Welcome page text
!define MUI_WELCOMEPAGE_TITLE           "Welcome to Music Studio Setup"
!define MUI_WELCOMEPAGE_TEXT            "This wizard will install Music Studio ${APP_VERSION} on your computer.$\r$\n$\r$\nMusic Studio is a high-speed music downloader and player that supports Spotify, YouTube, and YouTube Music with 320 kbps audio quality.$\r$\n$\r$\nClick Next to continue."

; Finish page
!define MUI_FINISHPAGE_TITLE            "Installation Complete"
!define MUI_FINISHPAGE_TEXT             "Music Studio has been installed successfully on your computer.$\r$\n$\r$\nClick Finish to close this wizard."
!define MUI_FINISHPAGE_RUN             "$INSTDIR\MusicStudio.exe"
!define MUI_FINISHPAGE_RUN_TEXT        "Launch Music Studio"
!define MUI_FINISHPAGE_LINK            "Visit Music Studio on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION   "${APP_URL}"

; ============================================================
; Variables (must be declared before Pages)
; ============================================================
Var StartMenuFolder

; ============================================================
; Pages
; ============================================================
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_STARTMENU Application $StartMenuFolder
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; ============================================================
; Languages
; ============================================================
!insertmacro MUI_LANGUAGE "English"

; ============================================================
; Version Info (embedded in EXE properties)
; ============================================================
VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName"      "${APP_NAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName"      "${APP_PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright"   "Copyright 2024 ${APP_PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription"  "${APP_NAME} Installer"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion"      "${APP_VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion"   "${APP_VERSION}"

; ============================================================
; INSTALLER SECTION
; ============================================================

Section "Core Application" SecCore
    SectionIn RO   ; Cannot be deselected

    ; ---- Step 1: Copy application files ----
    SetDetailsPrint textonly
    DetailPrint "Copying Music Studio application files..."
    SetDetailsPrint listonly

    SetOutPath "$INSTDIR"
    File "..\app.py"
    File "..\desktop_app.py"
    File "..\discovery.py"
    File "..\download_playlist.py"
    File "..\fix_metadata.py"
    File "..\ssl_helper.py"
    File "..\requirements.txt"
    File "..\LICENSE"
    File "..\MusicStudio.ico"
    File "..\MusicStudio.png"
    File "..\MusicStudio.bat"
    File "..\MusicStudio.exe"

    ; Static frontend
    SetOutPath "$INSTDIR\static"
    File /r "..\static\*.*"

    ; Empty data and Songs directories
    SetOutPath "$INSTDIR\data"
    SetOutPath "$INSTDIR\Songs"

    ; ---- Step 2: Install bundled Python runtime & all packages ----
    SetDetailsPrint textonly
    DetailPrint "Installing Python runtime and pre-bundled packages..."
    SetDetailsPrint listonly

    SetOutPath "$INSTDIR\runtime"
    File /r "python_embed\*.*"

    ; ---- Step 3: Verify and finalize environment ----
    SetDetailsPrint textonly
    DetailPrint "Configuring Music Studio components..."
    SetDetailsPrint listonly

    ; Fast verification check
    nsExec::ExecToLog '"$INSTDIR\runtime\python.exe" -c "import uvicorn, fastapi, webview, mutagen, yt_dlp, PIL, imageio_ffmpeg, pydantic, certifi"'
    Pop $0

    ${If} $0 != 0
        ; Fallback: Silent install from requirements.txt if any package was missing
        DetailPrint "Finalizing dependencies..."
        nsExec::ExecToLog '"$INSTDIR\runtime\python.exe" -m pip install --no-warn-script-location -r "$INSTDIR\requirements.txt"'
        Pop $0
    ${EndIf}

    ; ---- Step 4: Create silent launcher fallback ----
    SetDetailsPrint textonly
    DetailPrint "Creating application launcher..."
    SetDetailsPrint listonly

    SetOutPath "$INSTDIR"
    FileOpen $0 "$INSTDIR\MusicStudioLaunch.vbs" w
    FileWrite $0 "Option Explicit$\r$\n"
    FileWrite $0 "Dim WshShell, fso, appDir, exePath$\r$\n"
    FileWrite $0 "Set fso = CreateObject($\"Scripting.FileSystemObject$\")$\r$\n"
    FileWrite $0 "Set WshShell = CreateObject($\"WScript.Shell$\")$\r$\n"
    FileWrite $0 "appDir = fso.GetParentFolderName(WScript.ScriptFullName)$\r$\n"
    FileWrite $0 "exePath = appDir & $\"\MusicStudio.exe$\"$\r$\n"
    FileWrite $0 "WshShell.CurrentDirectory = appDir$\r$\n"
    FileWrite $0 "If fso.FileExists(exePath) Then$\r$\n"
    FileWrite $0 "    WshShell.Run Chr(34) & exePath & Chr(34), 0, False$\r$\n"
    FileWrite $0 "Else$\r$\n"
    FileWrite $0 "    WshShell.Run Chr(34) & appDir & $\"\MusicStudio.bat$\" & Chr(34), 0, False$\r$\n"
    FileWrite $0 "End If$\r$\n"
    FileClose $0

    ; ---- Step 5: Create Desktop Shortcut ----
    SetDetailsPrint textonly
    DetailPrint "Creating shortcuts..."
    SetDetailsPrint listonly

    CreateShortcut "$DESKTOP\Music Studio.lnk" \
        "$INSTDIR\MusicStudio.exe" "" \
        "$INSTDIR\MusicStudio.ico" 0 \
        SW_SHOWNORMAL "" "Music Studio - Music Downloader & Player"

    ; ---- Step 6: Create Start Menu shortcuts ----
    !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
        CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
        CreateShortcut "$SMPROGRAMS\$StartMenuFolder\Music Studio.lnk" \
            "$INSTDIR\MusicStudio.exe" "" \
            "$INSTDIR\MusicStudio.ico" 0 \
            SW_SHOWNORMAL "" "Music Studio - Music Downloader & Player"
        CreateShortcut "$SMPROGRAMS\$StartMenuFolder\Uninstall Music Studio.lnk" \
            "$INSTDIR\${UNINSTALLER_EXE}"
    !insertmacro MUI_STARTMENU_WRITE_END

    ; ---- Step 8: Register in Windows Add/Remove Programs ----
    SetDetailsPrint textonly
    DetailPrint "Registering in Windows..."
    SetDetailsPrint listonly

    WriteRegStr   HKLM "${REG_KEY}" "DisplayName"          "${APP_NAME}"
    WriteRegStr   HKLM "${REG_KEY}" "DisplayVersion"       "${APP_VERSION}"
    WriteRegStr   HKLM "${REG_KEY}" "Publisher"            "${APP_PUBLISHER}"
    WriteRegStr   HKLM "${REG_KEY}" "URLInfoAbout"         "${APP_URL}"
    WriteRegStr   HKLM "${REG_KEY}" "InstallLocation"      "$INSTDIR"
    WriteRegStr   HKLM "${REG_KEY}" "UninstallString"      '"$INSTDIR\${UNINSTALLER_EXE}"'
    WriteRegStr   HKLM "${REG_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER_EXE}" /S'
    WriteRegStr   HKLM "${REG_KEY}" "DisplayIcon"          "$INSTDIR\MusicStudio.ico"
    WriteRegDWORD HKLM "${REG_KEY}" "NoModify"             1
    WriteRegDWORD HKLM "${REG_KEY}" "NoRepair"             1

    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM "${REG_KEY}" "EstimatedSize" "$0"

    WriteRegStr HKCU "Software\MusicStudio" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\MusicStudio" "Version"    "${APP_VERSION}"

    ; ---- Step 9: Write Uninstaller ----
    SetDetailsPrint textonly
    DetailPrint "Finalizing installation..."
    SetDetailsPrint listonly

    WriteUninstaller "$INSTDIR\${UNINSTALLER_EXE}"

    SetDetailsPrint textonly
    DetailPrint "Music Studio installation complete!"

SectionEnd

; ============================================================
; UNINSTALLER SECTION
; ============================================================

Section "Uninstall"

    Delete "$INSTDIR\app.py"
    Delete "$INSTDIR\desktop_app.py"
    Delete "$INSTDIR\discovery.py"
    Delete "$INSTDIR\download_playlist.py"
    Delete "$INSTDIR\fix_metadata.py"
    Delete "$INSTDIR\ssl_helper.py"
    Delete "$INSTDIR\requirements.txt"
    Delete "$INSTDIR\LICENSE"
    Delete "$INSTDIR\MusicStudio.ico"
    Delete "$INSTDIR\MusicStudio.png"
    Delete "$INSTDIR\MusicStudioLaunch.vbs"
    Delete "$INSTDIR\MusicStudio.bat"
    Delete "$INSTDIR\MusicStudio.exe"
    Delete "$INSTDIR\${UNINSTALLER_EXE}"

    RMDir /r "$INSTDIR\static"
    RMDir /r "$INSTDIR\runtime"
    RMDir /r "$INSTDIR\data"
    RMDir /r "$INSTDIR\__pycache__"

    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Do you want to delete your downloaded Songs folder?$\r$\n$\r$\nLocation: $INSTDIR\Songs$\r$\n$\r$\nSelect No to keep your downloaded music." \
        IDNO keep_songs
        RMDir /r "$INSTDIR\Songs"
    keep_songs:

    RMDir "$INSTDIR"

    Delete "$DESKTOP\Music Studio.lnk"

    !insertmacro MUI_STARTMENU_GETFOLDER Application $StartMenuFolder
    Delete "$SMPROGRAMS\$StartMenuFolder\Music Studio.lnk"
    Delete "$SMPROGRAMS\$StartMenuFolder\Uninstall Music Studio.lnk"
    RMDir  "$SMPROGRAMS\$StartMenuFolder"

    DeleteRegKey HKLM "${REG_KEY}"
    DeleteRegKey HKCU "Software\MusicStudio"

SectionEnd

; ============================================================
; Functions
; ============================================================

Function .onInit
    ; Check for existing installation
    ReadRegStr $0 HKLM "${REG_KEY}" "UninstallString"
    ${If} $0 != ""
        MessageBox MB_YESNO|MB_ICONQUESTION \
            "Music Studio is already installed.$\r$\n$\r$\nWould you like to uninstall the previous version first?$\r$\nThis is recommended before installing a new version." \
            IDNO skip_uninstall
            ExecWait '$0 /S'
            Sleep 2000
        skip_uninstall:
    ${EndIf}
FunctionEnd
