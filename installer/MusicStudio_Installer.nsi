; ============================================================
; Music Studio — Windows Installer Script
; Built with NSIS (Nullsoft Scriptable Install System) 3.x
; ============================================================

!define APP_NAME        "Music Studio"
!define APP_VERSION     "1.0.0"
!define APP_PUBLISHER   "Music Studio"
!define APP_URL         "https://github.com/sahasbelbase/MusicStudio"
!define UNINSTALLER_EXE "Uninstall Music Studio.exe"
!define REG_KEY         "Software\Microsoft\Windows\CurrentVersion\Uninstall\MusicStudio"

; ============================================================
; Compiler Settings
; ============================================================
Name "${APP_NAME}"
OutFile "..\dist\MusicStudio-Setup.exe"
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

    ; Remove leftovers of the old script-based install (embedded Python + loose .py files)
    RMDir /r "$INSTDIR\runtime"
    RMDir /r "$INSTDIR\static"
    RMDir /r "$INSTDIR\data"
    Delete "$INSTDIR\*.py"
    Delete "$INSTDIR\MusicStudio.bat"
    Delete "$INSTDIR\MusicStudioLaunch.vbs"
    Delete "$INSTDIR\requirements.txt"

    SetDetailsPrint textonly
    DetailPrint "Copying Music Studio..."
    SetDetailsPrint listonly

    ; One self-contained executable: Python, every package, FFmpeg and the UI are inside it.
    ; Nothing is downloaded or installed on first run. Songs live in the user's Music folder.
    SetOutPath "$INSTDIR"
    File "..\dist\MusicStudio.exe"
    File "..\LICENSE"
    File "..\MusicStudio.ico"

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

    Delete "$INSTDIR\MusicStudio.exe"
    Delete "$INSTDIR\MusicStudio.ico"
    Delete "$INSTDIR\LICENSE"
    Delete "$INSTDIR\${UNINSTALLER_EXE}"
    RMDir "$INSTDIR"
    ; Downloaded songs are in Music\Music Studio and are never touched by the uninstaller.

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
        ; In-app updates run this installer with /S: answer No and install over the existing copy
        MessageBox MB_YESNO|MB_ICONQUESTION \
            "Music Studio is already installed.$\r$\n$\r$\nWould you like to uninstall the previous version first?$\r$\nThis is recommended before installing a new version." \
            /SD IDNO IDNO skip_uninstall
            ExecWait '$0 /S'
            Sleep 2000
        skip_uninstall:
    ${EndIf}
FunctionEnd
