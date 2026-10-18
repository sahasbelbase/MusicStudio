#!/usr/bin/env python3
"""
High-Speed Spotify & YouTube Music Playlist Downloader
Supports:
- YouTube Music & YouTube Playlists / Albums / Tracks
- Spotify Playlists / Albums / Tracks
- 320 kbps MP3 Conversion via FFmpeg
- Clean Song Titles (strips (Official Video), lyrics, etc.)
- Full ID3v2 Metadata Tagging & High-Resolution Album Art
- Smart Resume (instantly skips existing songs)
- Latest Songs First (reverse playlist order / newest additions prioritized)
- Parallel Multi-Threaded Downloads
"""

import os
import re
import sys
import time
import json
import shutil
import uuid
import urllib.request
from ssl_helper import safe_urlopen
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from typing import Callable, List, Dict, Optional, Tuple

import updater
updater.activate()
import mutagen
from mutagen.id3 import ID3, TIT2, TPE1, TPE2, TALB, TDRC, TYER, TRCK, APIC, TPE4, TCON, ID3NoHeaderError

try:
    from mac_icon_helper import set_macos_finder_icon
except ImportError:
    _fallback_icon_lock = Lock()
    def set_macos_finder_icon(file_path: str, image_data: bytes) -> bool:
        """Fallback thread-safe macOS Finder file icon setter."""
        if sys.platform != "darwin" or not file_path or not os.path.isfile(file_path):
            return False
        with _fallback_icon_lock:
            try:
                import objc
                from AppKit import NSWorkspace, NSImage, NSData
                with objc.autorelease_pool():
                    nsdata = NSData.dataWithBytes_length_(image_data, len(image_data))
                    img = NSImage.alloc().initWithData_(nsdata)
                    if img and img.size().width > 0:
                        return bool(NSWorkspace.sharedWorkspace().setIcon_forFile_options_(img, file_path, 0))
            except Exception:
                pass
        return False

def _windows_music_dir():
    """The real Music folder: OneDrive/known-folder redirection means ~/Music may not exist or may be the wrong one."""
    try:
        import ctypes
        from ctypes import wintypes
        class GUID(ctypes.Structure):
            _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]
        folderid_music = GUID(0x4BD8D571, 0x6D19, 0x48D3, (ctypes.c_ubyte * 8)(0xBE, 0x97, 0x42, 0x22, 0x20, 0x08, 0x0E, 0x43))
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(folderid_music), 0, None, ctypes.byref(out)) == 0:
            path = out.value
            ctypes.windll.ole32.CoTaskMemFree(out)
            if path and os.path.isdir(path):
                return path
    except Exception:
        pass
    return None

def get_default_output_folder():
    music_root = (_windows_music_dir() if sys.platform == "win32" else None) or os.path.expanduser("~/Music")
    user_music = os.path.join(music_root, "Music Studio")
    legacy_music = os.path.expanduser("~/Music/Music Studio")
    # Keep using the old location if that is where this user's songs already are
    if user_music != legacy_music and not os.path.isdir(user_music) and os.path.isdir(legacy_music):
        user_music = legacy_music
    local_songs = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Songs")
    if getattr(sys, 'frozen', False):
        os.makedirs(user_music, exist_ok=True)
        return user_music
    if os.path.isdir(user_music) and any(f.lower().endswith('.mp3') for f in os.listdir(user_music)):
        return user_music
    if os.path.isdir(local_songs):
        return local_songs
    os.makedirs(user_music, exist_ok=True)
    return user_music

DEFAULT_PLAYLIST_URL = "https://music.youtube.com/playlist?list=YOUR_PLAYLIST_ID"
DEFAULT_OUTPUT_FOLDER = get_default_output_folder()
DEFAULT_THREADS = 3
DEFAULT_BITRATE = "320k"
DEFAULT_NAMING = "title"  # 'title' -> "{Title}.mp3", 'artist-title' -> "{Artist} - {Title}.mp3"

# Keep yt-dlp's own default clients (they track YouTube changes with each yt-dlp update) and add
# web_embedded, which still serves audio when YouTube answers the defaults with "Sign in to confirm
# you're not a bot" (busy shared IPs like an office). web_embedded needs a JS runtime plus yt-dlp-ejs.
# This key is YouTube-specific and harmlessly ignored by other extractors.
_YT_EXTRACTOR_ARGS = {
    'youtube': {
        'player_client': ['default', 'web_embedded']
    }
}

# Console color codes
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    DIM = '\033[2m'
    RESET = '\033[0m'

print_lock = Lock()

def log(msg: str, color: str = ""):
    with print_lock:
        if color:
            print(f"{color}{msg}{Colors.RESET}")
        else:
            print(msg)

def sanitize_filename(name: str) -> str:
    """Sanitize string to be safe for macOS/Linux/Windows filenames."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "", name)
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    return sanitized or "Unknown"

def clean_track_artist_and_title(raw_title: str, raw_artist: str = "") -> Tuple[str, str]:
    """Clean track title and artist, stripping unwanted suffixes like (Official Video), ft., feat., etc."""
    title = raw_title.strip()
    artist = raw_artist.strip() if raw_artist else "Unknown Artist"

    # 1. Clean bracketed noise: (Official Video), [OFFICIAL MUSIC VIDEO], etc.
    bracket_noise = [
        r'\s*[\(\[\{][^\)\]\}]*(?:official|video|audio|lyrics|visualizer|remaster|hd|4k|version|edit|clip)[^\)\]\}]*[\)\]\}]',
        r'\s*[\(\[\{]\s*(?:audio|lyrics|hd|4k|hq)\s*[\)\]\}]',
    ]
    for p in bracket_noise:
        title = re.sub(p, '', title, flags=re.IGNORECASE).strip()

    # 2. Clean trailing noise: Official Video, Official Music Video, Lyrics, etc.
    trailing_noise = [
        r'\s*\|\s*.*$',
        r'\s*-\s*Official\s*.*$',
        r'\s+Official\s*(?:Music\s*)?(?:Video|Audio|Lyric\s*Video|HD|4K)\b.*$',
    ]
    for p in trailing_noise:
        title = re.sub(p, '', title, flags=re.IGNORECASE).strip()

    # 3. Detect Artist embedded in Title (e.g. "Vance Joy - Riptide", "Kendrick Lamar, SZA - All The Stars")
    if " - " in title:
        parts = title.split(" - ", 1)
        artist = parts[0].strip()
        title = parts[1].strip()
    elif ": " in title:
        parts = title.split(": ", 1)
        artist = parts[0].strip()
        title = parts[1].strip()

    if artist.endswith(" - Topic"):
        artist = artist[:-8].strip()

    # 4. Extract and strip featuring artists (ft., feat., featuring)
    feat_patterns = [
        r'\s*[\(\[\{]\s*(?:feat\.?|ft\.?|featuring)\s+([^\)\]\}]+)[\)\]\}]',
        r'\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$',
    ]
    featured_artists = []
    for p in feat_patterns:
        match = re.search(p, title, flags=re.IGNORECASE)
        if match:
            feat_art = match.group(1).strip()
            if feat_art and feat_art not in featured_artists:
                featured_artists.append(feat_art)
            title = re.sub(p, '', title, flags=re.IGNORECASE).strip()

    if featured_artists and artist and artist != "Unknown Artist":
        extra = ", ".join(featured_artists)
        if extra.lower() not in artist.lower():
            artist = f"{artist}, {extra}"

    # Strip surrounding quotes and whitespace
    title = title.strip("'\"` ").strip()
    artist = artist.strip("'\"` ").strip()
    return artist, title

def find_ffmpeg() -> str:
    """Find FFmpeg binary in bundled paths, system PATH, imageio-ffmpeg, or standard locations."""
    # 1. PyInstaller bundled temp directory
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        bundle_ffmpeg = os.path.join(sys._MEIPASS, "ffmpeg")
        if os.path.isfile(bundle_ffmpeg) and (sys.platform == "win32" or os.access(bundle_ffmpeg, os.X_OK)):
            return bundle_ffmpeg
        bundle_ffmpeg_win = os.path.join(sys._MEIPASS, "ffmpeg.exe")
        if os.path.isfile(bundle_ffmpeg_win):
            return bundle_ffmpeg_win

    # 2. Next to executable or current app directory
    base_dirs = [
        os.path.dirname(os.path.abspath(__file__)),
        os.path.dirname(sys.executable),
        getattr(sys, '_MEIPASS', ''),
    ]
    for b_dir in base_dirs:
        if not b_dir:
            continue
        candidates = [
            os.path.join(b_dir, "ffmpeg.exe"),
            os.path.join(b_dir, "ffmpeg"),
            os.path.join(b_dir, "bin", "ffmpeg.exe"),
            os.path.join(b_dir, "bin", "ffmpeg"),
            os.path.join(b_dir, "runtime", "ffmpeg.exe"),
            os.path.join(b_dir, "runtime", "bin", "ffmpeg.exe"),
        ]
        for c in candidates:
            if os.path.isfile(c) and (sys.platform == "win32" or os.access(c, os.X_OK)):
                return c

    # 3. System PATH
    for cmd in ["ffmpeg", "ffmpeg.exe"]:
        ffmpeg_bin = shutil.which(cmd)
        if ffmpeg_bin:
            return ffmpeg_bin

    # 4. Check imageio-ffmpeg (zero-config embedded Python wheel)
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        if ffmpeg_exe and os.path.isfile(ffmpeg_exe):
            return ffmpeg_exe
    except Exception:
        pass

    # 5. Windows common installation paths
    if sys.platform == "win32":
        win_paths = [
            os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\ffmpeg\bin\ffmpeg.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\ffmpeg\bin\ffmpeg.exe"),
            os.path.expandvars(r"%PROGRAMFILES(X86)%\ffmpeg\bin\ffmpeg.exe"),
            r"C:\ffmpeg\bin\ffmpeg.exe",
            os.path.expandvars(r"%USERPROFILE%\scoop\shims\ffmpeg.exe"),
            os.path.expandvars(r"%ALLUSERSPROFILE%\chocolatey\bin\ffmpeg.exe"),
            os.path.expanduser(r"~\.musicstudio\bin\ffmpeg.exe"),
        ]
        for path in win_paths:
            if os.path.isfile(path):
                return path

    # 6. macOS / Unix common paths
    unix_paths = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/opt/local/bin/ffmpeg",
        os.path.expanduser("~/.musicstudio/bin/ffmpeg"),
        os.path.expanduser("~/bin/ffmpeg")
    ]
    for path in unix_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return ""

def check_dependencies() -> str:
    """Verify FFmpeg and yt-dlp are available, attempting auto-recovery if needed."""
    ffmpeg_bin = find_ffmpeg()
    if not ffmpeg_bin:
        # Attempt to auto-install imageio-ffmpeg as on-demand fallback
        try:
            log("⚠️ FFmpeg binary not found. Attempting to install imageio-ffmpeg...", Colors.YELLOW)
            import subprocess
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "imageio-ffmpeg"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            import imageio_ffmpeg
            ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
            if ffmpeg_bin and os.path.isfile(ffmpeg_bin):
                log(f"✅ FFmpeg resolved via imageio-ffmpeg: {ffmpeg_bin}", Colors.GREEN)
                return ffmpeg_bin
        except Exception:
            pass

    if not ffmpeg_bin:
        log("❌ Error: FFmpeg not found on your system!", Colors.RED)
        if sys.platform == "win32":
            log("💡 On Windows, run in PowerShell: winget install Gyan.FFmpeg", Colors.YELLOW)
            log("   or install imageio-ffmpeg: python -m pip install imageio-ffmpeg", Colors.YELLOW)
        elif sys.platform == "darwin":
            log("💡 Install using Homebrew: brew install ffmpeg", Colors.YELLOW)
        else:
            log("💡 Install using package manager: sudo apt install ffmpeg", Colors.YELLOW)
        sys.exit(1)

    try:
        import yt_dlp
    except ImportError:
        log("⚠️ yt-dlp is not installed. Installing now...", Colors.YELLOW)
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-U", "yt-dlp", "mutagen", "requests"])
    
    return ffmpeg_bin

class SpotifyExtractor:
    """Extract tracks from Spotify URLs using public pagination (up to 1,000+ tracks) without requiring any API keys or login."""
    
    @staticmethod
    def is_spotify_url(url: str) -> bool:
        return "open.spotify.com" in url or "spotify.link" in url

    @staticmethod
    def extract_tracks(url: str) -> Tuple[str, List[Dict]]:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
        
        track_match = re.search(r'spotify\.com/track/([a-zA-Z0-9]+)', url)
        playlist_match = re.search(r'spotify\.com/playlist/([a-zA-Z0-9]+)', url)
        album_match = re.search(r'spotify\.com/album/([a-zA-Z0-9]+)', url)

        tracks = []
        collection_title = "Spotify Playlist"

        # 1. Single Track
        if track_match:
            track_id = track_match.group(1)
            embed_url = f"https://open.spotify.com/embed/track/{track_id}"
            req = urllib.request.Request(embed_url, headers=headers)
            with safe_urlopen(req, timeout=15) as resp:
                html = resp.read().decode('utf-8')
            match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
            if match:
                data = json.loads(match.group(1))
                entity = data.get('props', {}).get('pageProps', {}).get('state', {}).get('data', {}).get('entity', {})
                collection_title = entity.get('title', 'Spotify Track')
                dur_ms = entity.get('duration', 0)
                dur_sec = dur_ms // 1000 if dur_ms > 0 else 0
                prev_url = entity.get('audioPreview', {}).get('url', '')
                tracks.append({
                    'title': entity.get('title', ''),
                    'artist': entity.get('subtitle', ''),
                    'album': entity.get('album', {}).get('name', entity.get('title', '')),
                    'cover_url': entity.get('visualIdentity', {}).get('image', [{}])[-1].get('url', ''),
                    'duration': dur_sec,
                    'preview_url': prev_url,
                    'track_number': 1,
                    'query': f"{entity.get('subtitle', '')} - {entity.get('title', '')} Official Audio",
                    'spotify_url': url
                })
            return collection_title, tracks

        # 2. Public Playlist with Full Pagination (No login / keys required)
        if playlist_match:
            playlist_id = playlist_match.group(1)
            try:
                from spotapi import PublicPlaylist
                pl = PublicPlaylist(f"https://open.spotify.com/playlist/{playlist_id}")
                
                # Fetch metadata
                first_info = pl.get_playlist_info(limit=25)
                data_v2 = first_info.get('data', {}).get('playlistV2', {})
                if data_v2:
                    collection_title = data_v2.get('name') or "Spotify Playlist"
                    images = data_v2.get('images', {}).get('items', [])
                    cover_url = images[0].get('sources', [{}])[0].get('url', '') if images else ''
                    
                    track_idx = 1
                    for chunk in pl.paginate_playlist():
                        for item in chunk.get('items', []):
                            t_data = item.get('itemV2', {}).get('data', {})
                            if not t_data or t_data.get('__typename') != 'Track':
                                continue
                            t_title = t_data.get('name', '')
                            if not t_title:
                                continue
                            artists_items = t_data.get('artists', {}).get('items', [])
                            artist_names = [a.get('profile', {}).get('name', '') for a in artists_items if a.get('profile', {}).get('name')]
                            t_artist = ', '.join(artist_names) if artist_names else 'Unknown Artist'
                            album_data = t_data.get('albumOfTrack', {})
                            album_name = album_data.get('name', collection_title)
                            cover_sources = album_data.get('coverArt', {}).get('sources', [])
                            track_cover = cover_sources[0].get('url', cover_url) if cover_sources else cover_url
                            dur_ms = t_data.get('trackDuration', {}).get('totalMilliseconds', 0)
                            dur_sec = dur_ms // 1000 if dur_ms else 0
                            uri = t_data.get('uri', '')
                            track_id = uri.split(':')[-1] if uri else ''
                            tracks.append({
                                'title': t_title,
                                'artist': t_artist,
                                'album': album_name,
                                'cover_url': track_cover,
                                'duration': dur_sec,
                                'preview_url': '',
                                'track_number': track_idx,
                                'query': f"{t_artist} - {t_title} Official Audio",
                                'spotify_url': f"https://open.spotify.com/track/{track_id}" if track_id else f"https://open.spotify.com/track/{track_idx}"
                            })
                            track_idx += 1
                            
                    if tracks:
                        return collection_title, tracks
            except Exception as e:
                print(f"[SpotifyExtractor] Public playlist pagination notice: {e}. Trying embed fallback.")
                if updater.heal(e, "spotapi"):  # Spotify changed something: try a newer spotapi once
                    return SpotifyExtractor.extract_tracks(url)

        # 3. Public Album with Pagination
        if album_match:
            album_id = album_match.group(1)
            try:
                from spotapi import PublicAlbum
                alb = PublicAlbum(f"https://open.spotify.com/album/{album_id}")
                
                first_info = alb.get_album_info(limit=25)
                data = first_info.get('data', {}).get('albumUnion', {})
                if data:
                    collection_title = data.get('name') or "Spotify Album"
                    artists_items = data.get('artists', {}).get('items', [])
                    album_artists = [a.get('profile', {}).get('name', '') for a in artists_items if a.get('profile', {}).get('name')]
                    album_artist = ', '.join(album_artists) if album_artists else 'Unknown Artist'
                    cover_sources = data.get('coverArt', {}).get('sources', [])
                    cover_url = cover_sources[0].get('url', '') if cover_sources else ''
                    
                    track_idx = 1
                    for chunk in alb.paginate_album():
                        for item in chunk:
                            t_data = item.get('track', {}) if isinstance(item, dict) else {}
                            if not t_data:
                                continue
                            t_title = t_data.get('name', '')
                            if not t_title:
                                continue
                            t_artists_items = t_data.get('artists', {}).get('items', [])
                            t_artist_names = [a.get('profile', {}).get('name', '') for a in t_artists_items if a.get('profile', {}).get('name')]
                            t_artist = ', '.join(t_artist_names) if t_artist_names else album_artist
                            dur_ms = t_data.get('duration', {}).get('totalMilliseconds', 0)
                            dur_sec = dur_ms // 1000 if dur_ms else 0
                            uri = t_data.get('uri', '')
                            track_id = uri.split(':')[-1] if uri else ''
                            tracks.append({
                                'title': t_title,
                                'artist': t_artist,
                                'album': collection_title,
                                'cover_url': cover_url,
                                'duration': dur_sec,
                                'preview_url': '',
                                'track_number': track_idx,
                                'query': f"{t_artist} - {t_title} Official Audio",
                                'spotify_url': f"https://open.spotify.com/track/{track_id}" if track_id else f"https://open.spotify.com/track/{track_idx}"
                            })
                            track_idx += 1
                            
                    if tracks:
                        return collection_title, tracks
            except Exception as e:
                print(f"[SpotifyExtractor] Public album pagination notice: {e}. Trying embed fallback.")
                if updater.heal(e, "spotapi"):
                    return SpotifyExtractor.extract_tracks(url)

        # 4. Fallback: Embed scraping (if public GraphQL endpoint is unreachable)
        if playlist_match or album_match:
            entity_type = "playlist" if playlist_match else "album"
            entity_id = playlist_match.group(1) if playlist_match else album_match.group(1)
            embed_url = f"https://open.spotify.com/embed/{entity_type}/{entity_id}"
            
            req = urllib.request.Request(embed_url, headers=headers)
            with safe_urlopen(req, timeout=15) as resp:
                html = resp.read().decode('utf-8')
            
            match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
            if match:
                data = json.loads(match.group(1))
                entity = data.get('props', {}).get('pageProps', {}).get('state', {}).get('data', {}).get('entity', {})
                collection_title = entity.get('title', 'Spotify Collection')
                cover_url = entity.get('visualIdentity', {}).get('image', [{}])[-1].get('url', '')
                
                track_list = entity.get('trackList', [])
                for idx, t in enumerate(track_list, 1):
                    t_title = t.get('title', '')
                    t_artist = t.get('subtitle', '')
                    dur_ms = t.get('duration', 0)
                    dur_sec = dur_ms // 1000 if dur_ms > 0 else 0
                    prev_url = t.get('audioPreview', {}).get('url', '')
                    tracks.append({
                        'title': t_title,
                        'artist': t_artist,
                        'album': collection_title,
                        'cover_url': cover_url,
                        'duration': dur_sec,
                        'preview_url': prev_url,
                        'track_number': idx,
                        'query': f"{t_artist} - {t_title} Official Audio",
                        'spotify_url': f"https://open.spotify.com/track/{t.get('id', '')}"
                    })
            return collection_title, tracks

        return collection_title, tracks

class YouTubeExtractor:
    """Extract tracks from YouTube and YouTube Music URLs using yt-dlp."""
    
    @staticmethod
    def extract_tracks(url: str, limit: Optional[int] = None) -> Tuple[str, List[Dict]]:
        import yt_dlp
        
        ydl_opts = {
            'extract_flat': 'in_playlist',
            'skip_download': True,
            'quiet': True,
            'no_warnings': True,
            'js_runtimes': updater.js_runtimes(),
            'extractor_args': _YT_EXTRACTOR_ARGS,
        }
        
        tracks = []
        collection_title = "YouTube Music Playlist"
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:
            if _is_cert_error(e):
                ydl_opts['nocheckcertificate'] = True  # only after a verified attempt failed
            elif updater.heal(e):
                import yt_dlp
                ydl_opts['js_runtimes'] = updater.js_runtimes()
            else:
                raise
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

        if True:
            
            if 'entries' in info:
                collection_title = info.get('title', 'YouTube Playlist')
                entries = list(info['entries'])
                
                for idx, entry in enumerate(entries, 1):
                    if not entry:
                        continue
                    
                    raw_title = entry.get('title', '')
                    raw_artist = entry.get('artist') or entry.get('uploader') or entry.get('channel') or "Unknown Artist"
                    
                    artist, title = clean_track_artist_and_title(raw_title, raw_artist)
                    thumbnail = entry.get('thumbnail') or (entry.get('thumbnails', [{}])[-1].get('url') if entry.get('thumbnails') else '')
                    video_url = entry.get('url') or f"https://www.youtube.com/watch?v={entry.get('id')}"
                    
                    tracks.append({
                        'title': title,
                        'artist': artist,
                        'album': entry.get('album') or collection_title,
                        'release_year': entry.get('release_year') or (entry.get('upload_date', '')[:4] if entry.get('upload_date') else ''),
                        'cover_url': thumbnail,
                        'track_number': idx,
                        'query': video_url,
                        'yt_url': video_url,
                        'id': entry.get('id')
                    })
            else:
                raw_title = info.get('title', '')
                raw_artist = info.get('artist') or info.get('uploader') or "Unknown Artist"
                artist, title = clean_track_artist_and_title(raw_title, raw_artist)
                    
                collection_title = info.get('album') or title
                thumbnail = info.get('thumbnail') or ''
                video_url = info.get('webpage_url') or url
                
                tracks.append({
                    'title': title,
                    'artist': artist,
                    'album': info.get('album') or collection_title,
                    'release_year': info.get('release_year') or (info.get('upload_date', '')[:4] if info.get('upload_date') else ''),
                    'cover_url': thumbnail,
                    'track_number': 1,
                    'query': video_url,
                    'yt_url': video_url,
                    'id': info.get('id')
                })
                
        return collection_title, tracks

def embed_id3_tags(file_path: str, track_info: Dict, enriched_metadata: Dict = None):
    """Embed comprehensive ID3v2.3 tags and high-resolution album art into MP3 file.
    
    Args:
        file_path: Path to the MP3 file
        track_info: Base track information
        enriched_metadata: Optional enriched metadata from iTunes (album, year, genre, artwork_url, collaborators)
    """
    try:
        try:
            audio = ID3(file_path)
        except ID3NoHeaderError:
            audio = ID3()

        title = track_info.get('title', '')
        artist = track_info.get('artist', '')
        
        # Use enriched metadata if available, fall back to track_info
        album = title
        if enriched_metadata and enriched_metadata.get('album'):
            album = enriched_metadata['album']
        elif track_info.get('album'):
            album = track_info.get('album')
        
        year = str(track_info.get('release_year', ''))
        if enriched_metadata and enriched_metadata.get('year'):
            year = str(enriched_metadata['year'])
        
        genre = ""
        if enriched_metadata and enriched_metadata.get('genre'):
            genre = enriched_metadata['genre']
        
        collaborators = []
        if enriched_metadata and enriched_metadata.get('collaborators'):
            collaborators = enriched_metadata['collaborators']
        
        track_num = str(track_info.get('track_number', '1'))

        if title:
            audio.add(TIT2(encoding=1, text=title))
        if artist:
            audio.add(TPE1(encoding=1, text=artist))
            audio.add(TPE2(encoding=1, text=artist))  # Album Artist for Windows Explorer & macOS Finder
        if album:
            audio.add(TALB(encoding=1, text=album))
        elif title:
            audio.add(TALB(encoding=1, text=title))
        if year and str(year).isdigit():
            clean_year = str(year)[:4]
            audio.add(TDRC(encoding=1, text=clean_year))
            audio.add(TYER(encoding=1, text=clean_year))
        if genre:
            audio.add(TCON(encoding=1, text=genre))
        if collaborators:
            # TPE4 = involved people list
            audio.add(TPE4(encoding=1, text=collaborators))
        if track_num and track_num.isdigit():
            audio.add(TRCK(encoding=1, text=track_num))

        # Prefer enriched artwork, fall back to track_info
        cover_url = enriched_metadata.get('artwork_url') if enriched_metadata else None
        if not cover_url:
            cover_url = track_info.get('cover_url')
        
        img_data = None
        if cover_url:
            try:
                raw_data = None
                if cover_url.startswith('http'):
                    req = urllib.request.Request(cover_url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'})
                    with safe_urlopen(req, timeout=10) as resp:
                        raw_data = resp.read()
                elif os.path.isfile(cover_url):
                    with open(cover_url, 'rb') as f:
                        raw_data = f.read()

                if raw_data:
                    import io
                    from PIL import Image
                    try:
                        # Convert to baseline RGB JPEG for universal compatibility (Windows Explorer & macOS Finder)
                        pil_img = Image.open(io.BytesIO(raw_data)).convert('RGB')
                        pil_img.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
                        buf = io.BytesIO()
                        pil_img.save(buf, format='JPEG', quality=95, progressive=False)
                        img_data = buf.getvalue()
                    except Exception:
                        img_data = raw_data

                    audio.delall('APIC')
                    audio.add(APIC(
                        encoding=0,
                        mime="image/jpeg",
                        type=3,
                        desc="",
                        data=img_data
                    ))
            except Exception:
                pass

        # Save universal ID3v2.3 + ID3v1 tags for Windows Explorer, macOS Finder, and all legacy players
        audio.save(file_path, v2_version=3, v1=2)

        # Set macOS Finder file icon if on Darwin
        if img_data:
            set_macos_finder_icon(file_path, img_data)
    except Exception as e:
        log(f"⚠️ Warning embedding ID3 tags into {os.path.basename(file_path)}: {e}", Colors.YELLOW)

def get_target_filename(track_info: Dict, naming_format: str = "title") -> str:
    """Generate clean filename based on chosen naming convention."""
    artist = sanitize_filename(track_info.get('artist', 'Unknown Artist'))
    title = sanitize_filename(track_info.get('title', 'Unknown Title'))
    track_num = str(track_info.get('track_number', '1')).zfill(2)

    if naming_format == "title":
        return f"{title}.mp3"
    elif naming_format == "artist-title":
        return f"{artist} - {title}.mp3"
    elif naming_format == "track-title":
        return f"{track_num} - {title}.mp3"
    elif naming_format == "track-artist-title":
        return f"{track_num} - {artist} - {title}.mp3"
    return f"{title}.mp3"

def is_file_matching_track(filepath: str, artist: str, title: str) -> bool:
    """Check if an existing audio file actually belongs to the given artist & title."""
    if not os.path.isfile(filepath):
        return False
    clean_art = (artist or '').strip().lower()
    clean_tit = (title or '').strip().lower()
    if not clean_art and not clean_tit:
        return False
    try:
        from mutagen.id3 import ID3
        tags = ID3(filepath)
        file_artist = str(tags.get('TPE1', '')).strip().lower()
        if file_artist and clean_art:
            # If both have artist tags, verify they are compatible
            if clean_art in file_artist or file_artist in clean_art:
                return True
            else:
                return False
    except Exception:
        pass

    basename = os.path.basename(filepath)
    if basename.lower().endswith('.mp3'):
        basename = basename[:-4]
    if ' - ' in basename:
        parts = basename.split(' - ', 1)
        file_art = parts[0].strip().lower()
        if clean_art and file_art:
            if clean_art in file_art or file_art in clean_art:
                return True
            else:
                return False
    return True

def download_single_track(
    track_info: Dict,
    output_folder: str,
    ffmpeg_bin: str,
    bitrate: str = "320k",
    naming_format: str = "title",
    cookies_browser: Optional[str] = None,
    enriched_metadata: Dict = None,
    should_stop: Optional[Callable[[], bool]] = None
) -> Tuple[bool, str, str]:
    """
    Download a single track using yt-dlp, convert to MP3, and tag with ID3 metadata.
    `should_stop` lets the caller abort a download that is already running (the Stop button).
    """
    import yt_dlp

    artist = sanitize_filename(track_info.get('artist', 'Unknown Artist'))
    title = sanitize_filename(track_info.get('title', 'Unknown Title'))
    alt_filename = f"{artist} - {title}.mp3"
    alt_filepath = os.path.join(output_folder, alt_filename)

    target_filename = get_target_filename(track_info, naming_format)
    target_filepath = os.path.join(output_folder, target_filename)
    # Unique per download: playlist/album tracks often have no id, and parallel downloads must never share a file
    temp_prefix = os.path.join(output_folder, f".temp_{uuid.uuid4().hex}")

    # 1. Check if alt_filepath ("Artist - Title.mp3") already exists and matches this artist
    if os.path.isfile(alt_filepath) and os.path.getsize(alt_filepath) > 200 * 1024:
        if is_file_matching_track(alt_filepath, artist, title):
            return True, "skipped", alt_filename

    # 2. Check if target_filepath exists:
    if os.path.isfile(target_filepath) and os.path.getsize(target_filepath) > 200 * 1024:
        if is_file_matching_track(target_filepath, artist, title):
            return True, "skipped", target_filename
        else:
            # Collision! A song with the same title from a DIFFERENT artist already exists on disk!
            # Disambiguate this song to "{Artist} - {Title}.mp3" so both songs coexist cleanly!
            target_filename = alt_filename
            target_filepath = alt_filepath

            # Check if this disambiguated file already exists and matches
            if os.path.isfile(target_filepath) and os.path.getsize(target_filepath) > 200 * 1024:
                if is_file_matching_track(target_filepath, artist, title):
                    return True, "skipped", target_filename
                else:
                    counter = 2
                    while os.path.isfile(target_filepath) and os.path.getsize(target_filepath) > 200 * 1024:
                        target_filename = f"{artist} - {title} ({counter}).mp3"
                        target_filepath = os.path.join(output_folder, target_filename)
                        counter += 1

    query = track_info.get('query') or f"{artist} - {title} Official Audio"
    if not query.startswith("http"):
        query = f"ytsearch1:{query}"

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': f"{temp_prefix}.%(ext)s",
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': bitrate.replace('k', ''),
        }],
        'ffmpeg_location': ffmpeg_bin,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': False,
        'noplaylist': True,
        'js_runtimes': updater.js_runtimes(),
        'extractor_args': _YT_EXTRACTOR_ARGS,
    }

    if cookies_browser:
        ydl_opts['cookiesfrombrowser'] = (cookies_browser,)

    def stop_requested() -> bool:
        return bool(should_stop and should_stop())

    def abort_if_stopped(_progress):
        if stop_requested():
            raise yt_dlp.utils.DownloadCancelled("Stopped by user")

    def remove_temp_files():
        for f in os.listdir(output_folder):
            if f.startswith(os.path.basename(temp_prefix)):
                try:
                    os.remove(os.path.join(output_folder, f))
                except OSError:
                    pass

    if stop_requested():
        return False, "cancelled", target_filename
    ydl_opts['progress_hooks'] = [abort_if_stopped]

    max_retries = 3
    auto_updated = False
    for attempt in range(1, max_retries + 1):
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([query])

            temp_mp3 = f"{temp_prefix}.mp3"
            if not os.path.isfile(temp_mp3):
                raise RuntimeError(f"FFmpeg conversion failed to produce {temp_mp3}")
            embed_id3_tags(temp_mp3, track_info, enriched_metadata)
            shutil.move(temp_mp3, target_filepath)
            try:
                import lyrics
                lyrics.fetch_and_save_lrc(target_filepath, track_info)
            except Exception:
                pass
            return True, "downloaded", target_filename
                
        except Exception as e:
            if stop_requested():
                remove_temp_files()
                return False, "cancelled", target_filename
            # Verify TLS by default; fall back to unverified only if this machine's CA store is the problem
            if _is_cert_error(e) and not ydl_opts.get('nocheckcertificate'):
                ydl_opts['nocheckcertificate'] = True
                continue
            # A stale yt-dlp or a missing JS runtime is the usual cause of 403/extraction failures:
            # repair once (update yt-dlp, fetch QuickJS), then retry with the fresh engine
            if not auto_updated and updater.heal(e):
                auto_updated = True
                import yt_dlp
                ydl_opts['js_runtimes'] = updater.js_runtimes()
                continue
            if attempt < max_retries:
                time.sleep(1.5 * attempt)
            else:
                # Only this song's temp files: other songs of the same playlist are downloading in parallel
                remove_temp_files()
                return False, str(e), target_filename

    return False, "Max retries exceeded", target_filename

def _is_cert_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "certificate verify failed" in msg or "certificate_verify_failed" in msg

def run_downloader(
    url: str,
    output_folder: str,
    threads: int = DEFAULT_THREADS,
    bitrate: str = DEFAULT_BITRATE,
    sort_order: str = "latest",
    naming_format: str = DEFAULT_NAMING,
    limit: Optional[int] = None,
    cookies_browser: Optional[str] = None
):
    os.makedirs(output_folder, exist_ok=True)
    ffmpeg_bin = check_dependencies()

    log(f"\n{Colors.BOLD}{Colors.CYAN}======================================================{Colors.RESET}")
    log(f"{Colors.BOLD}{Colors.GREEN}🎵  Spotify & YouTube Music High-Speed Downloader  🎵{Colors.RESET}")
    log(f"{Colors.BOLD}{Colors.CYAN}======================================================{Colors.RESET}")
    log(f"🔗 Target URL:   {Colors.YELLOW}{url}{Colors.RESET}")
    log(f"📁 Destination:  {Colors.YELLOW}{output_folder}{Colors.RESET}")
    log(f"⚡ Threads:      {Colors.CYAN}{threads}{Colors.RESET} | Quality: {Colors.CYAN}{bitrate} MP3{Colors.RESET} | Sort: {Colors.CYAN}{sort_order.upper()}{Colors.RESET} | Naming: {Colors.CYAN}{naming_format.upper()}{Colors.RESET}")
    log(f"🔍 Fetching playlist metadata...\n", Colors.DIM)

    start_time = time.time()
    if SpotifyExtractor.is_spotify_url(url):
        log("🟢 Detected Spotify URL. Parsing track catalog...", Colors.GREEN)
        collection_title, tracks = SpotifyExtractor.extract_tracks(url)
    else:
        log("🔴 Detected YouTube / YouTube Music URL. Parsing track catalog...", Colors.RED)
        collection_title, tracks = YouTubeExtractor.extract_tracks(url, limit=None)

    total_tracks_found = len(tracks)
    if total_tracks_found == 0:
        log(f"❌ No tracks found for the provided URL: {url}", Colors.RED)
        return

    # Sort tracks according to preference
    if sort_order == "latest":
        tracks.reverse()
        log(f"🔄 Sorted by {Colors.BOLD}LATEST ADDED FIRST{Colors.RESET} (Newest songs prioritized)", Colors.CYAN)
    elif sort_order == "oldest":
        log(f"🔄 Sorted by {Colors.BOLD}OLDEST FIRST{Colors.RESET} (Playlist default order)", Colors.CYAN)

    if limit and len(tracks) > limit:
        tracks = tracks[:limit]

    total_to_download = len(tracks)
    log(f"📋 Playlist Title: {Colors.BOLD}{collection_title}{Colors.RESET}")
    log(f"🔢 Total Tracks to Process: {Colors.BOLD}{total_to_download}{Colors.RESET} (from {total_tracks_found} in playlist)\n")

    downloaded_count = 0
    skipped_count = 0
    failed_count = 0
    failed_list = []

    log(f"🚀 Starting download workers ({threads} concurrent streams)...\n", Colors.BOLD)

    with ThreadPoolExecutor(max_workers=threads) as executor:
        future_to_track = {
            executor.submit(
                download_single_track,
                track,
                output_folder,
                ffmpeg_bin,
                bitrate,
                naming_format,
                cookies_browser
            ): (idx, track)
            for idx, track in enumerate(tracks, 1)
        }

        for future in as_completed(future_to_track):
            idx, track = future_to_track[future]
            try:
                success, status, filename = future.result()
                current_total = downloaded_count + skipped_count + failed_count + 1
                progress = f"[{current_total}/{total_to_download}] ({int(current_total/total_to_download*100)}%)"

                if status == "skipped":
                    skipped_count += 1
                    log(f"{Colors.DIM}⏩ {progress} Skipped (already exists): {filename}{Colors.RESET}")
                elif success:
                    downloaded_count += 1
                    log(f"{Colors.GREEN}✅ {progress} Downloaded: {filename}{Colors.RESET}")
                else:
                    failed_count += 1
                    failed_list.append((filename, status))
                    log(f"{Colors.RED}❌ {progress} Failed: {filename} - {status}{Colors.RESET}")
            except Exception as e:
                failed_count += 1
                failed_list.append((track.get('title', 'Unknown'), str(e)))
                log(f"{Colors.RED}❌ Error processing track {idx}: {e}{Colors.RESET}")

    elapsed = round(time.time() - start_time, 1)
    log(f"\n{Colors.BOLD}{Colors.CYAN}======================================================{Colors.RESET}")
    log(f"{Colors.BOLD}{Colors.GREEN}✨ Download Summary for \"{collection_title}\"{Colors.RESET}")
    log(f"⏱️  Time Elapsed:     {elapsed}s")
    log(f"✅ Newly Downloaded: {Colors.GREEN}{downloaded_count}{Colors.RESET}")
    log(f"⏩ Already Existed:  {Colors.YELLOW}{skipped_count}{Colors.RESET}")
    log(f"❌ Failed Tracks:    {Colors.RED if failed_count else Colors.GREEN}{failed_count}{Colors.RESET}")
    log(f"📂 Folder:           {output_folder}")
    log(f"{Colors.BOLD}{Colors.CYAN}======================================================{Colors.RESET}\n")

    if failed_list:
        log("⚠️  Failed Tracks List:", Colors.YELLOW)
        for item, reason in failed_list:
            log(f"   • {item} ({reason})", Colors.RED)

def main():
    parser = argparse.ArgumentParser(
        description="High-Speed Spotify & YouTube Music Playlist Downloader (320kbps MP3 + Full ID3 Tags)"
    )
    parser.add_argument("url", nargs="?", default=DEFAULT_PLAYLIST_URL, help="Playlist or Track URL")
    parser.add_argument("--output", "-o", default=DEFAULT_OUTPUT_FOLDER, help="Output destination folder")
    parser.add_argument("--threads", "-t", type=int, default=DEFAULT_THREADS, help="Download threads (default: 3)")
    parser.add_argument("--quality", "-q", default=DEFAULT_BITRATE, help="Audio bitrate (default: 320k)")
    parser.add_argument("--sort", "-s", choices=["latest", "oldest"], default="latest", help="Sort order: 'latest' (newest additions first, default) or 'oldest'")
    parser.add_argument("--naming", "-n", choices=["title", "artist-title", "track-title"], default=DEFAULT_NAMING, help="Filename format: 'title' (Song.mp3, default), 'artist-title', or 'track-title'")
    parser.add_argument("--limit", "-l", type=int, default=None, help="Limit number of tracks to download (e.g. --limit 5 for testing)")
    parser.add_argument("--cookies-browser", help="Browser to extract cookies from (chrome, safari, firefox, brave)")

    args = parser.parse_args()

    run_downloader(
        url=args.url,
        output_folder=args.output,
        threads=args.threads,
        bitrate=args.quality,
        sort_order=args.sort,
        naming_format=args.naming,
        limit=args.limit,
        cookies_browser=args.cookies_browser
    )

if __name__ == "__main__":
    main()
