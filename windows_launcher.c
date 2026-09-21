#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <stdio.h>
#include <wchar.h>

static BOOL FileExists(const wchar_t *path) {
    DWORD attr = GetFileAttributesW(path);
    return (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY));
}

static BOOL FindPython(const wchar_t *baseDir, wchar_t *outConsole, wchar_t *outWindow, size_t outSize) {
    // 1. Check bundled runtime/
    _snwprintf(outConsole, outSize, L"%s\\runtime\\python.exe", baseDir);
    _snwprintf(outWindow, outSize, L"%s\\runtime\\pythonw.exe", baseDir);
    if (FileExists(outConsole)) {
        if (!FileExists(outWindow)) wcsncpy(outWindow, outConsole, outSize);
        return TRUE;
    }

    // 2. Check local application directory
    _snwprintf(outConsole, outSize, L"%s\\python.exe", baseDir);
    _snwprintf(outWindow, outSize, L"%s\\pythonw.exe", baseDir);
    if (FileExists(outConsole)) {
        if (!FileExists(outWindow)) wcsncpy(outWindow, outConsole, outSize);
        return TRUE;
    }

    // 3. Search system PATH for python.exe / pythonw.exe
    if (SearchPathW(NULL, L"python.exe", NULL, (DWORD)outSize, outConsole, NULL) > 0) {
        if (FileExists(outConsole)) {
            if (SearchPathW(NULL, L"pythonw.exe", NULL, (DWORD)outSize, outWindow, NULL) == 0 || !FileExists(outWindow)) {
                wcsncpy(outWindow, outConsole, outSize);
            }
            return TRUE;
        }
    }

    // 4. Search system PATH for py.exe (Python Launcher)
    wchar_t pyLauncher[MAX_PATH];
    if (SearchPathW(NULL, L"py.exe", NULL, (DWORD)outSize, pyLauncher, NULL) > 0) {
        if (FileExists(pyLauncher)) {
            wcsncpy(outConsole, pyLauncher, outSize);
            wcsncpy(outWindow, pyLauncher, outSize);
            return TRUE;
        }
    }

    // 5. Search well-known Windows install directories (e.g. C:\Python314, %LOCALAPPDATA%\Programs\Python)
    const wchar_t *standardVersions[] = {
        L"314", L"313", L"312", L"311", L"310", L"39", L"38"
    };
    wchar_t candidate[MAX_PATH];
    wchar_t localAppData[MAX_PATH];
    DWORD len = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);

    for (int i = 0; i < 7; i++) {
        // Check C:\Python3XX\python.exe
        _snwprintf(candidate, MAX_PATH, L"C:\\Python%s\\python.exe", standardVersions[i]);
        if (FileExists(candidate)) {
            wcsncpy(outConsole, candidate, outSize);
            _snwprintf(outWindow, outSize, L"C:\\Python%s\\pythonw.exe", standardVersions[i]);
            if (!FileExists(outWindow)) wcsncpy(outWindow, outConsole, outSize);
            return TRUE;
        }

        // Check %LOCALAPPDATA%\Programs\Python\Python3XX\python.exe
        if (len > 0) {
            _snwprintf(candidate, MAX_PATH, L"%s\\Programs\\Python\\Python%s\\python.exe", localAppData, standardVersions[i]);
            if (FileExists(candidate)) {
                wcsncpy(outConsole, candidate, outSize);
                _snwprintf(outWindow, outSize, L"%s\\Programs\\Python\\Python%s\\pythonw.exe", localAppData, standardVersions[i]);
                if (!FileExists(outWindow)) wcsncpy(outWindow, outConsole, outSize);
                return TRUE;
            }
        }
    }

    return FALSE;
}

static BOOL CheckDependencies(const wchar_t *consolePy, const wchar_t *baseDir) {
    // Build PYTHONPATH to include runtime\Lib\site-packages (installer puts packages there)
    wchar_t sitePkgs[MAX_PATH];
    _snwprintf(sitePkgs, MAX_PATH, L"%s\\runtime\\Lib\\site-packages", baseDir);

    wchar_t runtimeDir[MAX_PATH];
    _snwprintf(runtimeDir, MAX_PATH, L"%s\\runtime", baseDir);

    // Compose extended PYTHONPATH
    wchar_t pythonPath[MAX_PATH * 3];
    _snwprintf(pythonPath, sizeof(pythonPath)/sizeof(wchar_t), L"%s;%s", sitePkgs, runtimeDir);
    SetEnvironmentVariableW(L"PYTHONPATH", pythonPath);

    wchar_t cmdLine[MAX_PATH * 3];
    _snwprintf(cmdLine, sizeof(cmdLine) / sizeof(wchar_t),
        L"\"%s\" -c \"import fastapi, uvicorn, mutagen, yt_dlp, PIL\"",
        consolePy);

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    BOOL created = CreateProcessW(
        NULL,
        cmdLine,
        NULL,
        NULL,
        FALSE,
        CREATE_NO_WINDOW,
        NULL,
        NULL,
        &si,
        &pi
    );

    if (!created) return FALSE;

    WaitForSingleObject(pi.hProcess, 15000);
    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return (exitCode == 0);
}

static BOOL InstallDependencies(const wchar_t *consolePy, const wchar_t *baseDir) {
    // Check if we're using the bundled embedded runtime
    wchar_t embeddedPy[MAX_PATH];
    _snwprintf(embeddedPy, MAX_PATH, L"%s\\runtime\\python.exe", baseDir);
    BOOL isEmbedded = FileExists(embeddedPy) && (_wcsicmp(consolePy, embeddedPy) == 0);

    int choice = MessageBoxW(
        NULL,
        L"Music Studio is setting up for its first run.\n\n"
        L"Required packages (yt-dlp, fastapi, pywebview...) need to be installed.\n\n"
        L"Click Yes to install them automatically now.\n"
        L"This is a one-time setup and takes 1\u20135 minutes.",
        L"Music Studio \u2014 First Run Setup",
        MB_ICONINFORMATION | MB_YESNO | MB_DEFBUTTON1
    );

    if (choice != IDYES) {
        return FALSE;
    }

    wchar_t reqPath[MAX_PATH];
    _snwprintf(reqPath, MAX_PATH, L"%s\\requirements.txt", baseDir);

    wchar_t sitePkgs[MAX_PATH];
    _snwprintf(sitePkgs, MAX_PATH, L"%s\\runtime\\Lib\\site-packages", baseDir);

    wchar_t cmdLine[MAX_PATH * 6];
    if (isEmbedded) {
        // Install into the embedded runtime's site-packages (matches NSIS installer)
        _snwprintf(cmdLine, sizeof(cmdLine) / sizeof(wchar_t),
            L"cmd.exe /c \"title Music Studio - Installing Packages && "
            L"echo =========================================== && "
            L"echo   Music Studio First-Run Setup && "
            L"echo   Installing required packages... && "
            L"echo =========================================== && "
            L"\"%s\" -m pip install --no-warn-script-location --target=\"%s\" "
            L"yt-dlp mutagen fastapi \"uvicorn[standard]\" requests pywebview "
            L"pillow imageio-ffmpeg pydantic python-multipart certifi && "
            L"echo. && echo   Setup complete! Starting Music Studio... && "
            L"echo =========================================== && "
            L"timeout /t 2 >nul\"",
            consolePy, sitePkgs);
    } else {
        // System Python: normal pip install
        _snwprintf(cmdLine, sizeof(cmdLine) / sizeof(wchar_t),
            L"cmd.exe /c \"title Music Studio - Installing Packages && "
            L"echo =========================================== && "
            L"echo   Music Studio First-Run Setup && "
            L"echo   Installing required packages... && "
            L"echo =========================================== && "
            L"\"%s\" -m pip install --no-warn-script-location -r \"%s\" && "
            L"echo. && echo   Setup complete! Starting Music Studio... && "
            L"echo =========================================== && "
            L"timeout /t 2 >nul\"",
            consolePy, reqPath);
    }

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    BOOL created = CreateProcessW(
        NULL,
        cmdLine,
        NULL,
        NULL,
        FALSE,
        0, // Visible console window during install
        NULL,
        baseDir,
        &si,
        &pi
    );

    if (!created) {
        MessageBoxW(NULL, L"Failed to start the setup installer.", L"Music Studio Error", MB_ICONERROR | MB_OK);
        return FALSE;
    }

    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    if (exitCode != 0) {
        MessageBoxW(
            NULL,
            L"Package installation encountered an issue.\n\n"
            L"Please check your internet connection and try again.\n\n"
            L"You can also install manually by running:\n"
            L"  pip install -r requirements.txt",
            L"Music Studio \u2014 Setup Incomplete",
            MB_ICONWARNING | MB_OK
        );
        return FALSE;
    }

    // Re-inject PYTHONPATH so the newly installed packages are found immediately
    wchar_t newSitePkgs[MAX_PATH];
    _snwprintf(newSitePkgs, MAX_PATH, L"%s\\runtime\\Lib\\site-packages", baseDir);
    wchar_t runtimeDir[MAX_PATH];
    _snwprintf(runtimeDir, MAX_PATH, L"%s\\runtime", baseDir);
    wchar_t pythonPath[MAX_PATH * 3];
    _snwprintf(pythonPath, sizeof(pythonPath)/sizeof(wchar_t), L"%s;%s", newSitePkgs, runtimeDir);
    SetEnvironmentVariableW(L"PYTHONPATH", pythonPath);

    return TRUE;
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(NULL, exePath, MAX_PATH);

    // Extract directory
    wchar_t baseDir[MAX_PATH];
    wcsncpy(baseDir, exePath, MAX_PATH);
    wchar_t *lastSlash = wcsrchr(baseDir, L'\\');
    if (lastSlash) {
        *lastSlash = L'\0';
    } else {
        wcscpy(baseDir, L".");
    }

    // Set current working directory to the app directory
    SetCurrentDirectoryW(baseDir);

    // Target script
    wchar_t scriptPath[MAX_PATH];
    _snwprintf(scriptPath, MAX_PATH, L"%s\\desktop_app.py", baseDir);
    if (!FileExists(scriptPath)) {
        _snwprintf(scriptPath, MAX_PATH, L"%s\\app.py", baseDir);
    }

    wchar_t consolePy[MAX_PATH] = {0};
    wchar_t windowPy[MAX_PATH] = {0};

    if (!FindPython(baseDir, consolePy, windowPy, MAX_PATH)) {
        int choice = MessageBoxW(
            NULL,
            L"Music Studio requires Python 3.8 or higher on Windows.\n\n"
            L"Python was not detected on this system.\n\n"
            L"Would you like to open the official Python download page?",
            L"Music Studio — Python Required",
            MB_ICONQUESTION | MB_YESNO
        );
        if (choice == IDYES) {
            ShellExecuteW(NULL, L"open", L"https://www.python.org/downloads/windows/", NULL, NULL, SW_SHOWNORMAL);
        }
        return 1;
    }

    // Pre-flight check: verify dependencies are installed
    if (!CheckDependencies(consolePy, baseDir)) {
        if (!InstallDependencies(consolePy, baseDir)) {
            // User cancelled or install failed
            return 1;
        }
        // Re-check after install; if still failing, warn but continue
        if (!CheckDependencies(consolePy, baseDir)) {
            int cont = MessageBoxW(NULL,
                L"Some dependencies could not be verified.\n\n"
                L"Music Studio will try to start anyway.\n"
                L"If it fails, please run MusicStudio.bat for details.",
                L"Music Studio \u2014 Warning", MB_ICONWARNING | MB_OKCANCEL);
            if (cont != IDOK) return 1;
        }
    }

    // Launch application script using windowPy
    wchar_t cmdLine[MAX_PATH * 3];
    _snwprintf(cmdLine, sizeof(cmdLine) / sizeof(wchar_t), L"\"%s\" \"%s\"", windowPy, scriptPath);

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    DWORD flags = CREATE_NO_WINDOW;
    BOOL success = CreateProcessW(
        NULL,
        cmdLine,
        NULL,
        NULL,
        FALSE,
        flags,
        NULL,
        baseDir,
        &si,
        &pi
    );

    if (!success) {
        wchar_t errMsg[512];
        _snwprintf(errMsg, 512, L"Failed to start Music Studio process.\nError code: %lu\nCommand: %s", GetLastError(), cmdLine);
        MessageBoxW(NULL, errMsg, L"Music Studio Error", MB_ICONERROR | MB_OK);
        return 1;
    }

    // Monitor for immediate crash within 2 seconds
    DWORD waitResult = WaitForSingleObject(pi.hProcess, 2000);
    if (waitResult == WAIT_OBJECT_0) {
        DWORD exitCode = 0;
        GetExitCodeProcess(pi.hProcess, &exitCode);
        if (exitCode != 0) {
            wchar_t errMsg[1024];
            _snwprintf(errMsg, sizeof(errMsg) / sizeof(wchar_t),
                L"Music Studio closed unexpectedly during startup (Exit Code %lu).\n\n"
                L"Please check the log file located at:\n"
                L"%%LOCALAPPDATA%\\MusicStudio\\Logs\\desktop_app.log\n\n"
                L"Or run 'MusicStudio.bat' to view the full traceback in a console.",
                exitCode);
            MessageBoxW(NULL, errMsg, L"Music Studio — Startup Error", MB_ICONERROR | MB_OK);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            return 1;
        }
    }

    // Process is running healthy
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return 0;
}
