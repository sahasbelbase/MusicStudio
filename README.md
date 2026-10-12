# Music Studio 🎵 — Universal Music Downloader & Player

A high-speed, rate-limit resistant music downloader, audio tagger, and full-featured music player available across **Web**, **macOS**, **Windows**, **Android**, and **iPhone (iOS)**.

Supports downloading full playlists, albums, and tracks from **Spotify**, **YouTube**, and **YouTube Music** with **320 kbps MP3 conversion**, clean song-title formatting, and **1000×1000 Ultra-HD embedded cover artwork**—with **zero Spotify credentials required**.

---

## 📦 Ready-to-Install Downloads

| Platform | Package | Size | Details |
| :--- | :--- | :--- | :--- |
| 📱 **Android** | [**`MusicStudio.apk`**](releases/MusicStudio.apk) | 4.0 MB | Universal APK (Android 7.0+ / API 24–36), background audio playback |
| 🍏 **macOS** | [**`MusicStudio-macOS.dmg`**](releases/MusicStudio-macOS.dmg) | 69 MB | Apple Silicon (M1/M2/M3/M4/M5), native Mac Notch Dynamic Island HUD |
| 🍎 **iPhone (iOS)** | [**`MusicStudio-iOS.zip`**](releases/MusicStudio-iOS.zip) | 216 KB | Native Xcode project, iOS 14.0+, background audio & LAN streaming |
| 🪟 **Windows** | [**`MusicStudio-Windows-x64.zip`**](releases/MusicStudio-Windows-x64.zip) | 257 KB | Portable package with standalone [`MusicStudio.exe`](releases/MusicStudio.exe) |

> 📖 **Detailed Installation Instructions**: Read the [**Releases Guide**](releases/README.md) for step-by-step setup on every platform.

---

## ✨ Key Features

### 🎧 Built-in Music Player
- **High-Fidelity Audio Engine**: Crisp local playback with live scrubbing, time remaining, volume boost, shuffle, and repeat modes.
- **Dock & Fullscreen Player**: Minimized floating dock player with quick controls, expandable into an immersive glassmorphism fullscreen visualizer with album art glow.
- **Queue & Playlist Management**: Create custom playlists, reorder songs, and favorite tracks on the fly.

### ⚡ Automatic Offline Detection (Library Only Mode)
- **Zero-Disruption Offline Mode**: Automatically detects when your device loses internet connectivity or switches to Airplane Mode.
- **Library Focus**: Seamlessly restricts navigation to your downloaded **Library**, hiding the Downloader and Discover tabs and displaying an `⚡ Offline Mode • Library Only` indicator pill.
- **Instant Resume**: Restores full Discover and Downloader tabs the moment network connectivity returns.

### 🔥 "Most Played" (Top 100) Smart Playlist
- **Intelligent Habit Tracking**: Tracks every song played for 15+ seconds or to completion, recording play counts and timestamps in real time.
- **Dynamic Top 100 Chart**: Automatically generates a dedicated, delete-protected smart playlist featuring your 100 most played tracks.
- **Local & Server Sync**: Persists listening history across both browser `localStorage` and local backend storage.

### 📥 Rate-Limit Resistant Downloader
- **Zero Spotify Credentials**: Downloads public Spotify playlists of **1,000+ tracks** using resilient paginated scrapers—no Spotify Developer Client ID or Secret needed.
- **True 320 kbps MP3 Conversion**: Direct audio transcoding via multi-threaded FFmpeg pipelines (2–6 parallel workers).
- **Clean Song Titles**: Automatically purges video tags like `(Official Video)`, `[Lyrics]`, `[4K]`, and `Remastered` into pristine song names.
- **Studio Metadata & 1000×1000 HD Artwork**: Integrates with Apple Music to embed official ID3v2.3 tags (artist, album, release year, genre, and HD cover art) into every file for car displays, Apple Music, and iTunes.

### 🏝️ Mac Notch Dynamic Island HUD
- **Hardware Notch Integration**: On MacBook Pro models with display notches (M1/M2/M3/M4/M5), hovering over the physical screen notch reveals an interactive Dynamic Island HUD.
- **Live Controls**: Inspect the active track artwork, title, and artist, scrub through audio, and toggle play/pause directly from the notch.

---

## 📋 Prerequisites

1. **Python 3.8+**
2. **FFmpeg** (Required for audio conversion and metadata embedding)
   - **macOS** (Homebrew): `brew install ffmpeg`
   - **Linux (Ubuntu/Debian)**: `sudo apt update && sudo apt install ffmpeg`
   - **Windows**: `winget install Gyan.FFmpeg` or download from [gyan.dev/ffmpeg](https://www.gyan.dev/ffmpeg/builds/)

---

## 🚀 Quick Start

### 1. Launch the Local Web Studio
```bash
# Clone the repository
git clone https://github.com/sahasbelbase/MusicDownloder.git
cd MusicDownloder

# Install Python dependencies
pip install -r requirements.txt

# Start the server
python3 app.py
```
Open **[http://localhost:5000](http://localhost:5000)** in your browser.

---

### 2. Standalone Desktop Applications

#### macOS App with Notch Dynamic Island HUD:
```bash
python3 desktop_app.py
```
Or mount and run [**`releases/MusicStudio-macOS.dmg`**](releases/MusicStudio-macOS.dmg).

#### Windows Launcher:
Double-click [**`releases/MusicStudio.exe`**](releases/MusicStudio.exe) or extract [**`releases/MusicStudio-Windows-x64.zip`**](releases/MusicStudio-Windows-x64.zip).

---

### 3. Mobile Apps (Android & iOS)

#### Android:
Install [**`releases/MusicStudio.apk`**](releases/MusicStudio.apk) on your Android device.

To build from source:
```bash
npm install
npx cap copy android
cd android && ./gradlew assembleDebug
```

#### iPhone & iOS:
Extract [**`releases/MusicStudio-iOS.zip`**](releases/MusicStudio-iOS.zip), open `ios/App/App.xcodeproj` in **Xcode**, select your connected iPhone, and click **Run**.

---

### 4. Command-Line (CLI) Downloader

#### Download a Playlist (Default: 3 threads, latest songs first):
```bash
python3 download_playlist.py "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID"
```

#### Download a Spotify Playlist or Album:
```bash
python3 download_playlist.py "https://open.spotify.com/playlist/YOUR_PLAYLIST_ID" --threads 4
```

#### Download only the Top 25 Newest Songs:
```bash
python3 download_playlist.py --limit 25
```

#### Enrich Existing MP3s with HD Apple Music Artwork:
```bash
python3 fix_metadata.py
```

---

## ⚙️ CLI Options

| Flag | Short | Default | Description |
| :--- | :--- | :--- | :--- |
| `url` | - | *Default URL* | Spotify / YouTube Music playlist, album, or track URL |
| `--output` | `-o` | `./Songs` | Destination folder for downloaded MP3s |
| `--threads` | `-t` | `3` | Number of concurrent download workers |
| `--quality` | `-q` | `320k` | Audio bitrate (320k, 256k, 192k) |
| `--sort` | `-s` | `latest` | Sort order: `latest` (newest additions first) or `oldest` |
| `--naming` | `-n` | `title` | File naming format: `title` (Song.mp3) or `artist-title` |
| `--limit` | `-l` | `None` | Max number of tracks to download |

---

## 📂 Project Structure

```
MusicDownloder/
├── app.py                 # FastAPI backend server with SSE streaming & play stats
├── desktop_app.py         # macOS/Windows native desktop GUI window launcher
├── mac_notch.py           # Hardware Mac notch Dynamic Island HUD controller
├── discovery.py           # Spotify & YouTube Music public paginated scraper
├── download_playlist.py   # Multi-threaded download and stream conversion engine
├── fix_metadata.py        # Apple Music studio metadata and 1000x1000 HD art tagger
├── ssl_helper.py          # Universal SSL certificate verification helper
├── static/                # Responsive glassmorphism frontend application
│   ├── index.html         # Modern web/mobile dashboard
│   ├── style.css          # Responsive styling (desktop, tablet, mobile safe-areas)
│   ├── app.js             # Player engine, SSE client, offline detection & stats
│   └── notch_hud.html     # Mac Notch Dynamic Island HUD interface
├── android/               # Native Android Capacitor 8 project
├── ios/                   # Native iOS Capacitor 8 Xcode project
├── releases/              # Compiled distributables (APK, DMG, iOS zip, Windows zip/exe)
│   ├── README.md          # Multi-platform installation & sharing guide
│   ├── MusicStudio.apk    # Android release APK (4.0 MB)
│   ├── MusicStudio-macOS.dmg # Apple Silicon disk image (69 MB)
│   ├── MusicStudio-iOS.zip   # Xcode iPhone project package
│   ├── MusicStudio-Windows-x64.zip # Portable Windows distribution
│   └── MusicStudio.exe    # Windows GUI launcher executable
└── Songs/                 # Output folder for downloaded 320kbps MP3s
```

---

## 🚢 Releasing a New Version

1. Push a version tag: `git tag v1.0.1 && git push origin v1.0.1`
2. GitHub Actions stamps that version into the app, builds the macOS `.dmg` and the Windows installer, and attaches them to a GitHub release.
3. Installed copies check for the newer release every time they open and show an update banner. Users can also check any time in **Settings → App Updates**.

---

## 📄 License

This project is licensed under the MIT License.
