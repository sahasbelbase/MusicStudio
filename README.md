<div align="center">

<img src="MusicStudio.png" width="96" alt="Music Studio icon" />

# Music Studio

A music player and downloader for macOS and Windows. Play your library, stream anything, and download songs, albums and playlists from YouTube, YouTube Music and Spotify as 320 kbps MP3s with full tags and artwork.

[![Latest release](https://img.shields.io/github/v/release/sahasbelbase/MusicStudio?label=release&color=10b981)](https://github.com/sahasbelbase/MusicStudio/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/sahasbelbase/MusicStudio/total?color=10b981)](https://github.com/sahasbelbase/MusicStudio/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-10b981)](LICENSE)

[![Download for macOS](https://img.shields.io/badge/Download-macOS_(.dmg)-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/sahasbelbase/MusicStudio/releases/latest/download/MusicStudio-Installer.dmg)
[![Download for Windows](https://img.shields.io/badge/Download-Windows_(Installer)-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/sahasbelbase/MusicStudio/releases/latest/download/MusicStudio-Setup.exe)
[![Download for Android](https://img.shields.io/badge/Download-Android_(.apk)-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/sahasbelbase/MusicStudio/releases/latest/download/MusicStudio.apk)

</div>

---

## Install

### macOS

1. Download **[MusicStudio-Installer.dmg](https://github.com/sahasbelbase/MusicStudio/releases/latest/download/MusicStudio-Installer.dmg)**, open it and drag **Music Studio** into **Applications**.
2. The app is not signed with an Apple Developer ID yet, so macOS may say it is *damaged* or *can't be opened*. Run this once in **Terminal**, then open the app normally:

   ```bash
   xattr -cr "/Applications/Music Studio.app"
   ```

   This only removes the "downloaded from the internet" flag that macOS adds to the app.

### Windows

1. Download **[MusicStudio-Setup.exe](https://github.com/sahasbelbase/MusicStudio/releases/latest/download/MusicStudio-Setup.exe)** and run it.
2. If Windows shows *"Windows protected your PC"*, click **More info → Run anyway** (the installer is not code-signed yet).

Everything the app needs (Python, FFmpeg, the download engine) is inside the app. Nothing else has to be installed.

### Android

Install **[MusicStudio.apk](https://github.com/sahasbelbase/MusicStudio/releases/latest/download/MusicStudio.apk)** (Android 7.0+). The Android app plays music stored on the phone.

---

## Features

### Player

- Smart Transition between songs: blends songs that fit together, echoes out on the beat when the genre or tempo changes a lot, lets songs that fade out end naturally, plays albums gaplessly, skips silence at the start and end of songs, and evens out loudness.
- Queue you can search, reorder and edit, with *Up next* in the full-screen player.
- Shuffle and repeat, a mini player and a full-screen player, lock-screen and media-key controls on macOS.
- Remembers the last song, queue and settings between launches.

### Library

- Search, sort and browse by songs, artists, albums, genres and playlists.
- *Play* and *Shuffle* for the whole library or just your search results.
- Create playlists and pick songs from your library or the web while creating them.
- *Most Played*: a playlist of your top 100 songs, built automatically.

### Discover & Downloader

- Charts, curated playlists and search across Deezer and YouTube (including independent and regional releases that are only on YouTube).
- Paste a YouTube, YouTube Music or Spotify link (song, album or playlist) to download it.
- Downloads queue up one after another; *Stop* cancels the current download and everything waiting.
- 320 kbps MP3 with title, artist, album, year, genre and 1000×1000 cover art.
- Already-downloaded songs are skipped, and downloading a playlist asks before downloading songs you already have.

### Keeps working by itself

- The download engine (yt-dlp) updates itself in the background, and repairs itself when YouTube or Spotify change something.
- The app checks for new versions when it opens; you can also check in **Settings → App Updates**.

---

## Run from source

Requires Python 3.11 and FFmpeg (`brew install ffmpeg`, `winget install Gyan.FFmpeg`, or `sudo apt install ffmpeg`).

```bash
git clone https://github.com/sahasbelbase/MusicStudio.git
cd MusicStudio
pip install -r requirements.txt

python3 desktop_app.py     # desktop window
# or
python3 app.py             # then open http://localhost:5050 in a browser
```

### Command line

```bash
python3 download_playlist.py "https://music.youtube.com/playlist?list=PLAYLIST_ID"
python3 download_playlist.py "https://open.spotify.com/playlist/PLAYLIST_ID" --threads 4
python3 fix_metadata.py    # add artwork and tags to MP3s you already have
```

| Flag | Short | Default | Description |
| :--- | :--- | :--- | :--- |
| `url` | | | Spotify, YouTube or YouTube Music link (song, album or playlist) |
| `--output` | `-o` | `~/Music/Music Studio` | Folder for downloaded MP3s |
| `--threads` | `-t` | `3` | Songs downloaded at the same time |
| `--quality` | `-q` | `320k` | Bitrate: `320k`, `256k` or `192k` |
| `--sort` | `-s` | `latest` | `latest` (newest additions first) or `oldest` |
| `--naming` | `-n` | `title` | File names: `title` or `artist-title` |
| `--limit` | `-l` | | Download at most this many songs |

### Build the apps

```bash
./package_dmg.sh                  # macOS: dist/MusicStudio-Installer.dmg
installer\build_installer.bat     # Windows: dist\MusicStudio-Setup.exe (needs NSIS)
```

---

## Releasing a new version

1. Push a version tag: `git tag v1.0.1 && git push origin v1.0.1`
2. GitHub Actions builds the macOS `.dmg` and the Windows installer with that version and publishes them as a GitHub release.
3. Installed copies notice the new release the next time they open.

---

## Contributing

Contributions are welcome:

1. Fork the repository and create a branch (`git checkout -b fix/my-change`).
2. Make your change and check it in the app (`python3 desktop_app.py`).
3. Open a pull request describing what changed and why.

Bug reports and ideas are welcome in [Issues](https://github.com/sahasbelbase/MusicStudio/issues).

### Contributors

Thank you to everyone who has helped build Music Studio.

[![Contributors](https://contrib.rocks/image?repo=sahasbelbase/MusicStudio)](https://github.com/sahasbelbase/MusicStudio/graphs/contributors)

---

## Project structure

```text
MusicStudio/
├── desktop_app.py          # Desktop window (pywebview) that runs the local server
├── app.py                  # Local API server (FastAPI): library, streaming, downloads, playlists
├── download_playlist.py    # Spotify / YouTube extraction and the MP3 download pipeline (also a CLI)
├── discovery.py            # Charts, playlists and search (Deezer + YouTube)
├── audio_analysis.py       # Loudness, tempo, beats and silence for Smart Transition
├── updater.py              # Self-updating download engine, JavaScript runtime, app update check
├── fix_metadata.py         # Artwork and tag enrichment (iTunes catalogue)
├── static/                 # The app's interface (HTML, CSS, JavaScript)
├── installer/              # Windows installer (NSIS)
├── scripts/                # Release helpers
├── .github/workflows/      # Builds and publishes releases
├── android/ · ios/         # Mobile apps (Capacitor)
└── architecture.md         # How it all fits together
```

See [architecture.md](architecture.md) for the design.

---

## Third-party software

| Component | Used for | License |
| :--- | :--- | :--- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Reading and downloading from YouTube | Unlicense |
| [FFmpeg](https://ffmpeg.org) | Audio conversion and analysis | LGPL/GPL |
| [QuickJS-NG](https://github.com/quickjs-ng/quickjs) | JavaScript runtime for yt-dlp, downloaded when no other runtime is installed | MIT |
| [SpotAPI](https://github.com/Aran404/SpotAPI) | Reading full Spotify playlists and albums | GPL-3.0 |
| [FastAPI](https://fastapi.tiangolo.com), [pywebview](https://pywebview.flowrl.com), [mutagen](https://github.com/quodlibet/mutagen) | Server, desktop window, MP3 tags | MIT / BSD / GPL-2.0 |

## License

Music Studio is released under the [MIT License](LICENSE).
