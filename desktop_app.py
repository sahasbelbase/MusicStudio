#!/usr/bin/env python3
"""
Music Studio - Standalone Desktop Launcher
Runs the local FastAPI backend server and displays a native desktop window.
"""

import sys
import os
import time
import socket
import threading
import webbrowser

# Add app directory to sys.path
BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# ── Bundled runtime site-packages (installer drops packages here) ──────────────
# When launched via MusicStudioLaunch.vbs or MusicStudio.exe with the embedded
# Python runtime, packages are installed into runtime\Lib\site-packages via
# `pip install --target`. We add this to sys.path so imports always resolve.
_runtime_site_pkgs = os.path.join(BASE_DIR, "runtime", "Lib", "site-packages")
if os.path.isdir(_runtime_site_pkgs) and _runtime_site_pkgs not in sys.path:
    sys.path.insert(0, _runtime_site_pkgs)

# Also support a flat runtime/ directory (some pip --target layouts put .dist-info at root)
_runtime_dir = os.path.join(BASE_DIR, "runtime")
if os.path.isdir(_runtime_dir) and _runtime_dir not in sys.path:
    sys.path.insert(0, _runtime_dir)


# Set Windows AppUserModelID so taskbar groups properly under Music Studio icon
if sys.platform == 'win32':
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('com.musicstudio.app')
    except Exception:
        pass

def get_log_dir() -> str:
    """Return OS-appropriate log directory."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or os.path.expanduser("~")
        path = os.path.join(base, "MusicStudio", "Logs")
    elif sys.platform == "darwin":
        path = os.path.expanduser("~/Library/Logs/MusicStudio")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
        path = os.path.join(base, "MusicStudio", "logs")

    try:
        os.makedirs(path, exist_ok=True)
        return path
    except Exception:
        fallback = os.path.join(BASE_DIR, "logs")
        try:
            os.makedirs(fallback, exist_ok=True)
            return fallback
        except Exception:
            return BASE_DIR

def show_error_dialog(title: str, message: str):
    """Display a native error dialog so crashes are never silent on any OS."""
    try:
        if sys.__stderr__:
            sys.__stderr__.write(f"[{title}] {message}\n")
            sys.__stderr__.flush()
    except Exception:
        pass

    if sys.platform == "win32":
        try:
            import ctypes
            # MB_ICONERROR (0x10) | MB_OK (0x0) | MB_SYSTEMMODAL (0x1000)
            ctypes.windll.user32.MessageBoxW(0, message, title, 0x10 | 0x1000)
            return
        except Exception:
            pass
    elif sys.platform == "darwin":
        try:
            import subprocess
            escaped_msg = message.replace('\\', '\\\\').replace('"', '\\"')
            escaped_title = title.replace('\\', '\\\\').replace('"', '\\"')
            subprocess.run([
                "osascript", "-e",
                f'display alert "{escaped_title}" message "{escaped_msg}" as critical'
            ], timeout=5)
            return
        except Exception:
            pass
    elif sys.platform.startswith("linux"):
        try:
            import subprocess
            subprocess.run(["zenity", "--error", f"--text={message}", f"--title={title}"], timeout=5)
            return
        except Exception:
            pass

class TeeLogger:
    def __init__(self, stream, file_path):
        self.stream = stream
        try:
            self.file = open(file_path, "a", encoding="utf-8")
        except Exception:
            self.file = None

    def write(self, data):
        if self.stream:
            try:
                self.stream.write(data)
                self.stream.flush()
            except Exception:
                pass
        if self.file:
            try:
                self.file.write(data)
                self.file.flush()
            except Exception:
                pass

    def flush(self):
        if self.stream:
            try:
                self.stream.flush()
            except Exception:
                pass
        if self.file:
            try:
                self.file.flush()
            except Exception:
                pass

    def isatty(self):
        if self.stream and hasattr(self.stream, 'isatty'):
            try:
                return self.stream.isatty()
            except Exception:
                return False
        return False

    def fileno(self):
        if self.stream and hasattr(self.stream, 'fileno'):
            return self.stream.fileno()
        raise OSError('fileno not supported')

    @property
    def encoding(self):
        if self.stream and hasattr(self.stream, 'encoding'):
            return self.stream.encoding
        return 'utf-8'

    @property
    def closed(self):
        return False

# Setup safe logging for windowed mode
log_dir = get_log_dir()
log_file = os.path.join(log_dir, "desktop_app.log")
try:
    if sys.stdout is not None:
        sys.stdout = TeeLogger(sys.stdout, log_file)
    else:
        sys.stdout = open(log_file, "a", encoding="utf-8")
    if sys.stderr is not None:
        sys.stderr = TeeLogger(sys.stderr, log_file)
    else:
        sys.stderr = open(log_file, "a", encoding="utf-8")
except Exception:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')

def _auto_install_deps():
    """Attempt automatic dependency installation if any package is missing."""
    import subprocess
    py_exe = sys.executable
    runtime_py = os.path.join(BASE_DIR, "runtime", "python.exe")
    if os.path.isfile(runtime_py):
        py_exe = runtime_py
    req_file = os.path.join(BASE_DIR, "requirements.txt")
    if not os.path.isfile(req_file):
        return False
    try:
        cmd = [py_exe, "-m", "pip", "install", "--no-warn-script-location", "-r", req_file]
        site_pkgs = os.path.join(BASE_DIR, "runtime", "Lib", "site-packages")
        if os.path.isdir(os.path.join(BASE_DIR, "runtime")):
            cmd.insert(4, f"--target={site_pkgs}")
        subprocess.run(
            cmd,
            creationflags=0x08000000 if sys.platform == "win32" else 0,
            timeout=180,
            check=True
        )
        return True
    except Exception:
        return False

# Guarded top-level imports with auto-install and native graphical error dialog
for _attempt in range(2):
    try:
        import uvicorn
        import ssl_helper  # Configure CA certificates & SSL bypass globally
        from app import app, SONGS_DIR
        break
    except Exception as err:
        if _attempt == 0 and ("No module named" in str(err) or isinstance(err, ModuleNotFoundError)):
            if _auto_install_deps():
                continue
        import traceback
        tb = traceback.format_exc()
        startup_err_file = os.path.join(log_dir, "startup_error.log")
        try:
            with open(startup_err_file, "w", encoding="utf-8") as f:
                f.write(tb)
        except Exception:
            pass

        missing_hint = ""
        err_str = str(err)
        if "No module named" in err_str or isinstance(err, ModuleNotFoundError):
            missing_module = err_str.split("No module named")[-1].strip(" '\"")
            missing_hint = (
                f"\n\nMissing Python module: {missing_module}\n"
                f"To fix this automatically, run MusicStudio.bat or install dependencies:\n"
                f"  python -m pip install -r requirements.txt"
            )

        diag_msg = (
            f"Music Studio encountered a startup error:\n\n"
            f"{err_str}{missing_hint}\n\n"
            f"Detailed log saved to:\n{startup_err_file}"
        )
        show_error_dialog("Music Studio — Startup Error", diag_msg)
        sys.exit(1)


def find_available_port(default_port=5050):
    """Check if default port is free, or pick an available one."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(('127.0.0.1', default_port)) != 0:
            return default_port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

class ServerThread(threading.Thread):
    def __init__(self, port):
        super().__init__(daemon=True)
        self.port = port
        config = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=self.port,
            log_level="warning",
            loop="asyncio"
        )
        self.server = uvicorn.Server(config=config)

    def run(self):
        self.server.run()

    def stop(self):
        self.server.should_exit = True

def wait_for_server(port, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                if s.connect_ex(('127.0.0.1', port)) == 0:
                    return True
        except Exception:
            pass
        time.sleep(0.1)
    return False

def main():
    port = find_available_port(5050)
    server_thread = ServerThread(port)
    server_thread.start()

    if not wait_for_server(port):
        err_msg = f"Music Studio server failed to start on port {port} within 10 seconds."
        print(f"Error: {err_msg}")
        show_error_dialog("Music Studio Server Error", err_msg)
        sys.exit(1)

    url = f"http://127.0.0.1:{port}"
    print(f"🚀 Music Studio running at {url}")
    print(f"📁 Local music library: {SONGS_DIR}")

    # Check if GUI webview is available
    use_webview = True
    if "--browser" in sys.argv:
        use_webview = False

    def on_gui_ready():
        if sys.platform == "darwin":
            try:
                import mac_nowplaying
                from PyObjCTools import AppHelper
                AppHelper.callAfter(mac_nowplaying.init_now_playing, port)
            except Exception as e:
                print(f"[DesktopApp] Mac NowPlaying notice: {e}")

    if use_webview:
        try:
            import webview
            print("Opening native desktop window...")
            window = webview.create_window(
                title="Music Studio",
                url=url,
                width=1280,
                height=840,
                min_size=(380, 600),
                background_color="#0b0e14",
                text_select=True
            )

            def on_closed():
                print("Window closed. Stopping Music Studio server and exiting...")
                try:
                    server_thread.stop()
                except Exception:
                    pass
                import os
                os._exit(0)

            window.events.closed += on_closed

            if sys.platform == "darwin":
                try:
                    import webview.platforms.cocoa as cocoa

                    # Support clicking dock icon to restore window without overwriting delegate
                    def reopen_handler(self, app, flag):
                        for instance in cocoa.BrowserView.instances.values():
                            if instance and instance.window:
                                instance.window.makeKeyAndOrderFront_(None)
                                instance.window.setIsVisible_(True)
                        return True
                    cocoa.BrowserView.AppDelegate.applicationShouldHandleReopen_hasVisibleWindows_ = reopen_handler

                    # Ensure Cmd+Q, App Menu -> Quit, and Dock -> Quit cleanly terminate process
                    def terminate_handler(self, app):
                        print("Terminating Music Studio via Cmd+Q / Menu Quit...")
                        try:
                            server_thread.stop()
                        except Exception:
                            pass
                        import os
                        os._exit(0)
                        return 1
                    cocoa.BrowserView.AppDelegate.applicationShouldTerminate_ = terminate_handler
                except Exception as e:
                    print(f"Cocoa delegate notice: {e}")

            webview.start(on_gui_ready, debug=False)
        except Exception as e:
            print(f"Webview note: {e}. Falling back to default web browser.")
            webbrowser.open(url)
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
    else:
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    print("Shutting down Music Studio...")
    server_thread.stop()

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        err_text = traceback.format_exc()
        crash_log = os.path.join(log_dir, "crash.log")
        try:
            with open(crash_log, "w", encoding="utf-8") as f:
                f.write(err_text)
        except Exception:
            pass
        show_error_dialog("Music Studio — Crash", f"An unexpected error occurred:\n\n{str(e)}\n\nCrash log saved to:\n{crash_log}")
        sys.exit(1)
