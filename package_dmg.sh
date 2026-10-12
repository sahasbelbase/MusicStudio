#!/usr/bin/env bash
set -e

echo "🎵 =========================================="
echo "   Building Music Studio Desktop (.dmg)     "
echo "=========================================="

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# Clean prior builds
rm -rf build dist/dmg_staging dist/MusicStudio-Installer.dmg

echo "📦 Step 1/3: Compiling standalone app bundle with PyInstaller..."
python3 -m PyInstaller --clean -y music_studio.spec

if [ ! -d "dist/Music Studio.app" ]; then
    echo "❌ Error: dist/Music Studio.app was not created!"
    exit 1
fi

echo "🔧 Step 1b: Patching Mach-O minos to 11.0 for backward compatibility (M1/M2/M3/M4 & macOS 11-15)..."
python3 -c "
import os, subprocess, re

app_dir = 'dist/Music Studio.app'
patched = 0

for root, dirs, files in os.walk(app_dir):
    for f in files:
        fp = os.path.join(root, f)
        if os.path.islink(fp):
            continue
        try:
            out = subprocess.run(['otool', '-l', fp], capture_output=True, text=True).stdout
            match = re.search(r'minos\s+([\d\.]+)', out)
            if match:
                minos = match.group(1)
                major = float(minos.split('.')[0])
                if major > 11.0:
                    cmd = ['vtool', '-set-build-version', 'macos', '11.0', '14.0', '-output', fp, fp, '-replace']
                    res = subprocess.run(cmd, capture_output=True, text=True)
                    if res.returncode == 0:
                        patched += 1
        except Exception:
            pass

print(f'[*] Successfully patched {patched} Mach-O binaries to minos 11.0')
"

echo "🔑 Step 1c: Applying macOS ad-hoc code signature and clearing quarantine..."
xattr -cr "dist/Music Studio.app"
find "dist/Music Studio.app/Contents/Frameworks" -type f \( -name "*.dylib" -o -name "*.so" -o -name "ffmpeg" \) -exec codesign --force --sign - {} + 2>/dev/null || true
codesign --force --sign - "dist/Music Studio.app/Contents/MacOS/Music Studio"
codesign --force --deep --sign - "dist/Music Studio.app"

echo "✨ Step 2/3: Preparing DMG installer staging..."
mkdir -p dist/dmg_staging
cp -a "dist/Music Studio.app" "dist/dmg_staging/"
ln -s /Applications "dist/dmg_staging/Applications"

# Hardening permissions inside the bundle
chmod -R u+rwX,go+rX "dist/dmg_staging/Music Studio.app"
chmod +x "dist/dmg_staging/Music Studio.app/Contents/MacOS/"*
find "dist/dmg_staging/Music Studio.app/Contents/Frameworks" -type f \( -name "*.dylib" -o -name "*.so" -o -name "ffmpeg" \) -exec chmod +x {} + 2>/dev/null || true

# Strip any extended attributes from staging
xattr -cr "dist/dmg_staging/Music Studio.app"

# Resign bundle cleanly inside staging
find "dist/dmg_staging/Music Studio.app/Contents/Frameworks" -type f \( -name "*.dylib" -o -name "*.so" \) -exec codesign --force --sign - {} + 2>/dev/null || true
if [ -f "dist/dmg_staging/Music Studio.app/Contents/Frameworks/ffmpeg" ]; then
    codesign --force --sign - "dist/dmg_staging/Music Studio.app/Contents/Frameworks/ffmpeg" 2>/dev/null || true
fi
codesign --force --sign - "dist/dmg_staging/Music Studio.app/Contents/MacOS/Music Studio"
codesign --force --deep --sign - "dist/dmg_staging/Music Studio.app"

# Create clear text instructions inside DMG
cat << 'EOF' > "dist/dmg_staging/FIRST TIME USERS - READ ME.txt"
======================================================
  🎵 MUSIC STUDIO - macOS INSTALLATION GUIDE
======================================================

1. DRAG TO INSTALL:
   Drag "Music Studio.app" into the "Applications" folder shortcut.

2. FIRST-TIME OPEN (IF BLOCKED BY MACOS):
   Because this app is free and distributed directly (without a
   $99/yr Apple Developer certificate), macOS Gatekeeper blocks
   internet downloads by default.

   To unblock it in 3 seconds, choose EITHER method:

   ▶ METHOD A (1-Line Terminal Command - Recommended):
     Open Terminal on your Mac, paste this command and press Enter:
       xattr -cr "/Applications/Music Studio.app"
     Then double-click Music Studio in Applications!

   ▶ METHOD B (Using System Settings):
     1. Double-click Music Studio in Applications once.
     2. Open System Settings -> Privacy & Security.
     3. Scroll down to Security.
     4. Click "Open Anyway" next to Music Studio.

Enjoy high-fidelity music streaming, downloading, and cover art!
======================================================
EOF

echo "💿 Step 3/3: Creating compressed macOS Disk Image (.dmg)..."
hdiutil create \
    -volname "Music Studio" \
    -srcfolder "dist/dmg_staging" \
    -ov \
    -format UDZO \
    "dist/MusicStudio-Installer.dmg"

# Clean staging
rm -rf dist/dmg_staging

echo ""
echo "=========================================="
echo "🎉 SUCCESS: macOS DMG created successfully!"
echo "📍 Location: $APP_DIR/dist/MusicStudio-Installer.dmg"
ls -lh "dist/MusicStudio-Installer.dmg"
echo "=========================================="
