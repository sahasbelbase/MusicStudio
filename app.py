#!/usr/bin/env python3
"""
Spotify & YouTube Music Downloader - Web Application Backend
Powered by FastAPI, Uvicorn, yt-dlp, FFmpeg, and Mutagen
"""

import os
import re
import sys
import time
import json
import asyncio
import shutil
import base64
import hashlib
import urllib.request
import urllib.error
import urllib.parse
from ssl_helper import safe_urlopen
import subprocess
import uuid
import queue
from threading import Thread, Lock
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import mutagen
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, APIC, ID3NoHeaderError
from mutagen.mp3 import MP3
import updater
updater.activate()
import yt_dlp

# Import extractor and download logic from download_playlist
from download_playlist import (
    SpotifyExtractor,
    YouTubeExtractor,
    clean_track_artist_and_title,
    download_single_track,
    find_ffmpeg,
    check_dependencies,
    DEFAULT_OUTPUT_FOLDER,
)
import discovery
import audio_analysis
from fix_metadata import process_file as enrich_single_file, fetch_itunes_metadata

app = FastAPI(title="Music Studio")

@app.on_event("startup")
def _silent_engine_update():
    """Keep yt-dlp current in the background; failures are ignored (the bundled copy still works)."""
    def run():
        try:
            updater.ensure_js_runtime()  # fetch QuickJS if this machine has no deno/node/bun
        except Exception:
            pass
        try:
            if updater.check().get("update_available"):
                updater.update()
        except Exception:
            pass
    Thread(target=run, daemon=True).start()

# The server is local-only: this machine's own window/browser may call it, nothing else.
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?|capacitor://localhost)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def reject_non_local_hosts(request: Request, call_next):
    # Blocks DNS-rebinding: a web page can't reach the API through a hostname that points at 127.0.0.1
    raw_host = request.headers.get("host") or ""
    host = "[::1]" if raw_host.startswith("[") else raw_host.rsplit(":", 1)[0]
    if host not in LOCAL_HOSTS:
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    return await call_next(request)

@app.middleware("http")
async def add_no_cache_header(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static") or path == "/" or path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

def get_resource_path(relative_path):
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative_path)

SONGS_DIR = DEFAULT_OUTPUT_FOLDER
os.makedirs(SONGS_DIR, exist_ok=True)
STATIC_DIR = get_resource_path("static")
os.makedirs(STATIC_DIR, exist_ok=True)

# User Data & Playlists Storage
if getattr(sys, 'frozen', False):
    USER_DATA_DIR = os.path.expanduser("~/Music/Music Studio/.musicstudio")
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    target_pl = os.path.join(USER_DATA_DIR, "playlists.json")
    if not os.path.exists(target_pl):
        bundle_pl = get_resource_path(os.path.join("data", "playlists.json"))
        if os.path.exists(bundle_pl):
            try:
                import shutil
                shutil.copy2(bundle_pl, target_pl)
            except Exception:
                pass
else:
    USER_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(USER_DATA_DIR, exist_ok=True)
PLAYLISTS_FILE = os.path.join(USER_DATA_DIR, "playlists.json")
PLAY_STATS_FILE = os.path.join(USER_DATA_DIR, "play_stats.json")
SETTINGS_FILE = os.path.join(USER_DATA_DIR, "settings.json")
PLAYLIST_COVERS_DIR = os.path.join(USER_DATA_DIR, "covers")
os.makedirs(PLAYLIST_COVERS_DIR, exist_ok=True)
playlists_lock = Lock()
play_stats_lock = Lock()
settings_lock = Lock()

def load_settings() -> Dict:
    with settings_lock:
        if not os.path.exists(SETTINGS_FILE):
            return {}
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading settings: {e}")
            return {}

def save_settings(settings_data: Dict):
    with settings_lock:
        try:
            cur = {}
            if os.path.exists(SETTINGS_FILE):
                try:
                    with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                        cur = json.load(f)
                except Exception:
                    cur = {}
            cur.update(settings_data)
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(cur, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving settings: {e}")

def load_play_stats() -> Dict[str, Dict]:
    with play_stats_lock:
        if not os.path.exists(PLAY_STATS_FILE):
            return {}
        try:
            with open(PLAY_STATS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading play stats: {e}")
            return {}

def save_play_stats(stats: Dict[str, Dict]):
    with play_stats_lock:
        try:
            with open(PLAY_STATS_FILE, "w", encoding="utf-8") as f:
                json.dump(stats, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving play stats: {e}")

def load_playlists() -> List[Dict]:
    with playlists_lock:
        if not os.path.exists(PLAYLISTS_FILE):
            return []
        try:
            with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                for pl in data:
                    pl["is_custom"] = (pl.get("type") == "custom")
                return data
        except Exception as e:
            print(f"Error loading playlists: {e}")
            return []

def save_playlists(playlists: List[Dict]):
    with playlists_lock:
        try:
            with open(PLAYLISTS_FILE, "w", encoding="utf-8") as f:
                json.dump(playlists, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving playlists: {e}")

# Global Application State
class AppState:
    def __init__(self):
        self.lock = Lock()
        self.is_downloading = False
        self.is_enriching = False
        self.should_stop = False
        
        # Download metrics
        self.current_url = ""
        self.playlist_title = ""
        self.total_tracks = 0
        self.downloaded_count = 0
        self.skipped_count = 0
        self.failed_count = 0
        self.active_tracks: List[str] = []
        self.recent_completed: List[Dict] = []
        self.start_time = 0.0
        self.status_message = "Ready"
        
        # Enrichment cache: {(artist, title): enriched_metadata}
        self.enriched_metadata_cache: Dict[tuple, Dict] = {}
        
        # Event listeners for SSE
        self.listeners: List[asyncio.Queue] = []

    def reset_download_state(self, url: str):
        with self.lock:
            self.is_downloading = True
            self.should_stop = False
            self.current_url = url
            self.playlist_title = "Fetching metadata..."
            self.total_tracks = 0
            self.downloaded_count = 0
            self.skipped_count = 0
            self.failed_count = 0
            self.active_tracks = []
            self.recent_completed = []
            self.start_time = time.time()
            self.status_message = "Analyzing playlist..."

    def notify(self, event_type: str, data: dict):
        payload = json.dumps({"type": event_type, "data": data})
        for q in list(self.listeners):
            try:
                q.put_nowait(payload)
            except Exception:
                pass

state = AppState()

class DownloadRequest(BaseModel):
    url: str
    threads: int = 3
    quality: str = "320k"
    sort: str = "latest"
    naming: str = "title"

class SingleTrackDownloadRequest(BaseModel):
    title: str
    artist: str
    album: Optional[str] = "Single"
    cover_url: Optional[str] = None
    query: Optional[str] = None
    quality: str = "320k"
    naming: str = "title"

class BatchTracksDownloadRequest(BaseModel):
    title: str
    tracks: List[Dict]
    threads: int = 3
    quality: str = "320k"
    naming: str = "title"

class EnrichRequest(BaseModel):
    threads: int = 4
    upgrade_artwork: bool = True
    force: bool = False

# Playlist Management Models
class CreatePlaylistRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    cover_url: Optional[str] = None

class UpdatePlaylistRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None

class AddTrackToPlaylistRequest(BaseModel):
    title: str
    artist: str
    album: Optional[str] = "Single"
    cover_url: Optional[str] = ""
    duration: Optional[int] = 0
    query: Optional[str] = ""
    preview_url: Optional[str] = ""

class FavoritePlaylistRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    cover_url: Optional[str] = ""
    external_id: Optional[str] = ""
    tracks: Optional[List[Dict]] = []

class CoverUploadPayload(BaseModel):
    image_data: Optional[str] = None
    image_url: Optional[str] = None

class ImportPlaylistRequest(BaseModel):
    url: str

class RecordPlayRequest(BaseModel):
    filename: Optional[str] = ""
    title: Optional[str] = ""
    artist: Optional[str] = ""
    album: Optional[str] = ""
    duration: Optional[int] = 0

def enrich_tracks_for_download(tracks: List[Dict], threads: int = 4) -> Dict[tuple, Dict]:
    """Enrich track metadata before downloading. Returns cache of enriched data."""
    enriched_cache = {}
    total = len(tracks)
    
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = {}
        for idx, track in enumerate(tracks):
            artist = track.get('artist', 'Unknown Artist')
            title = track.get('title', 'Unknown Title')
            cache_key = (artist, title)
            
            # Skip if already cached
            if cache_key in state.enriched_metadata_cache:
                enriched_cache[cache_key] = state.enriched_metadata_cache[cache_key]
                state.notify("enrich_progress", {
                    "current": len(enriched_cache),
                    "total": total,
                    "percent": int((len(enriched_cache) / total) * 100),
                    "status": "cached",
                    "title": title
                })
                continue
            
            # Submit enrichment task
            future = executor.submit(fetch_itunes_metadata, artist, title)
            futures[future] = (cache_key, title, idx)
        
        # Collect results
        for idx, future in enumerate(as_completed(futures), 1):
            if state.should_stop:
                for f in futures:
                    f.cancel()
                break
            cache_key, title, track_idx = futures[future]
            try:
                enriched_data = future.result()
                if enriched_data and enriched_data.get('match_score', 0) >= 0.45:
                    enriched_cache[cache_key] = enriched_data
                    state.enriched_metadata_cache[cache_key] = enriched_data
                    
                    state.notify("enrich_progress", {
                        "current": len(enriched_cache) + (total - len(futures)),
                        "total": total,
                        "percent": int((len(enriched_cache) / total) * 100),
                        "status": "enriched",
                        "title": title,
                        "album": enriched_data.get('album', 'N/A')
                    })
                else:
                    state.notify("enrich_progress", {
                        "current": len(enriched_cache) + idx,
                        "total": total,
                        "percent": int(((len(enriched_cache) + idx) / total) * 100),
                        "status": "no_match",
                        "title": title
                    })
            except Exception as e:
                state.notify("enrich_progress", {
                    "current": len(enriched_cache) + idx,
                    "total": total,
                    "percent": int(((len(enriched_cache) + idx) / total) * 100),
                    "status": "error",
                    "title": title
                })
    
    return enriched_cache


def run_download_worker(req: DownloadRequest):
    ffmpeg_bin = find_ffmpeg()
    state.reset_download_state(req.url)
    state.notify("status", {"message": "Fetching playlist tracks...", "running": True})

    try:
        if SpotifyExtractor.is_spotify_url(req.url):
            collection_title, tracks = SpotifyExtractor.extract_tracks(req.url)
        else:
            collection_title, tracks = YouTubeExtractor.extract_tracks(req.url)

        if not tracks:
            with state.lock:
                state.is_downloading = False
                state.status_message = "No tracks found in playlist."
            state.notify("status", {"message": "No tracks found", "running": False})
            return

        # Sort order
        if req.sort == "latest":
            tracks.reverse()

        with state.lock:
            state.playlist_title = collection_title
            state.total_tracks = len(tracks)
            state.status_message = f"Downloading \"{collection_title}\""

        state.notify("playlist_loaded", {
            "title": collection_title,
            "total": len(tracks)
        })

        # Phase 1: Enrich metadata from iTunes before downloading
        with state.lock:
            state.status_message = "Enriching metadata with Apple Music..."
        state.notify("enrich_start", {"message": "Enriching metadata from iTunes...", "total": len(tracks)})
        
        enriched_cache = enrich_tracks_for_download(tracks, threads=min(4, req.threads))
        
        with state.lock:
            state.status_message = f"Downloading \"{collection_title}\" with enriched metadata"
        state.notify("enrich_complete", {
            "enriched": len(enriched_cache),
            "total": len(tracks),
            "message": f"Enriched {len(enriched_cache)} tracks. Starting downloads..."
        })

        # Phase 2: Download tracks with enriched metadata
        with ThreadPoolExecutor(max_workers=req.threads) as executor:
            future_to_track = {
                executor.submit(
                    download_single_track,
                    track,
                    SONGS_DIR,
                    ffmpeg_bin,
                    req.quality,
                    req.naming,
                    None,  # cookies_browser
                    enriched_cache.get((track.get('artist', 'Unknown Artist'), track.get('title', 'Unknown Title'))),
                    should_stop=lambda: state.should_stop,
                ): track
                for track in tracks
            }

            for future in as_completed(future_to_track):
                if state.should_stop:
                    for f in future_to_track:  # queued songs never start; running ones abort via should_stop
                        f.cancel()
                    break

                track = future_to_track[future]
                try:
                    success, status, filename = future.result()
                    with state.lock:
                        if status == "skipped":
                            state.skipped_count += 1
                        elif success:
                            state.downloaded_count += 1
                        else:
                            state.failed_count += 1

                        song_item = {
                            "filename": filename,
                            "title": track.get("title"),
                            "artist": track.get("artist"),
                            "album": track.get("album"),
                            "cover_url": track.get("cover_url"),
                            "status": status,
                            "timestamp": time.time()
                        }
                        state.recent_completed.insert(0, song_item)
                        if len(state.recent_completed) > 100:
                            state.recent_completed.pop()

                    processed = state.downloaded_count + state.skipped_count + state.failed_count
                    pct = int((processed / max(1, state.total_tracks)) * 100)
                    
                    state.notify("progress", {
                        "processed": processed,
                        "total": state.total_tracks,
                        "percent": pct,
                        "downloaded": state.downloaded_count,
                        "skipped": state.skipped_count,
                        "failed": state.failed_count,
                        "last_song": song_item
                    })
                except Exception as e:
                    with state.lock:
                        state.failed_count += 1

    except Exception as e:
        with state.lock:
            state.status_message = f"Error: {e}"
    finally:
        with state.lock:
            state.is_downloading = False
            state.status_message = "Download completed!" if not state.should_stop else "Download stopped."
        state.notify("completed", {
            "downloaded": state.downloaded_count,
            "skipped": state.skipped_count,
            "failed": state.failed_count,
            "time": round(time.time() - state.start_time, 1)
        })

def run_enrich_worker(req: EnrichRequest):
    with state.lock:
        state.is_enriching = True
        state.status_message = "Enriching metadata with Apple Music..."
    state.notify("enrich_start", {"running": True})

    try:
        mp3_files = [
            os.path.join(SONGS_DIR, f)
            for f in os.listdir(SONGS_DIR)
            if f.endswith('.mp3') and not f.startswith('.')
        ]
        total = len(mp3_files)
        success_count = 0

        with ThreadPoolExecutor(max_workers=min(4, req.threads)) as executor:
            future_to_file = {
                executor.submit(enrich_single_file, f, req.upgrade_artwork, req.force): f
                for f in mp3_files
            }

            for idx, future in enumerate(as_completed(future_to_file), 1):
                status, filename, details = future.result()
                if status == 'updated':
                    success_count += 1
                state.notify("enrich_progress", {
                    "current": idx,
                    "total": total,
                    "percent": int((idx / max(1, total)) * 100),
                    "filename": filename,
                    "status": status,
                    "details": details
                })

    finally:
        with state.lock:
            state.is_enriching = False
            state.status_message = "Metadata enrichment complete!"
        state.notify("enrich_complete", {"updated": success_count, "total": total})

def run_single_song_worker(req: SingleTrackDownloadRequest):
    ffmpeg_bin = find_ffmpeg()
    track_title = f"{req.artist} - {req.title}"
    state.reset_download_state(track_title)
    with state.lock:
        state.playlist_title = track_title
        state.total_tracks = 1
        state.status_message = f"Downloading \"{req.title}\"..."

    state.notify("playlist_loaded", {
        "title": track_title,
        "total": 1
    })

    track_dict = {
        "title": req.title,
        "artist": req.artist,
        "album": req.album or "Single",
        "cover_url": req.cover_url or "",
        "track_number": 1,
        "query": req.query or f"{req.artist} - {req.title} Official Audio"
    }

    try:
        enriched = fetch_itunes_metadata(req.artist, req.title)
        success, status, filename = download_single_track(
            track_dict,
            SONGS_DIR,
            ffmpeg_bin,
            req.quality,
            req.naming,
            None,
            enriched,
            should_stop=lambda: state.should_stop,
        )

        with state.lock:
            if status == "skipped":
                state.skipped_count = 1
                state.status_message = f"Already downloaded: {req.title}"
            elif success:
                state.downloaded_count = 1
                state.status_message = f"Downloaded: {req.title}"
            else:
                state.failed_count = 1
                state.status_message = f"Failed to download: {req.title}"

            song_item = {
                "filename": filename,
                "title": req.title,
                "artist": req.artist,
                "album": req.album,
                "cover_url": req.cover_url,
                "status": status,
                "timestamp": time.time()
            }
            state.recent_completed.insert(0, song_item)

        state.notify("progress", {
            "processed": 1,
            "total": 1,
            "percent": 100,
            "downloaded": state.downloaded_count,
            "skipped": state.skipped_count,
            "failed": state.failed_count,
            "last_song": song_item
        })
    except Exception as e:
        with state.lock:
            state.failed_count = 1
            state.status_message = f"Error: {e}"
        state.notify("song_failed", {"title": req.title, "error": str(e)})
    finally:
        with state.lock:
            state.is_downloading = False
        state.notify("completed", {
            "downloaded": state.downloaded_count,
            "skipped": state.skipped_count,
            "failed": state.failed_count,
            "time": round(time.time() - state.start_time, 1)
        })

def run_batch_songs_worker(req: BatchTracksDownloadRequest):
    ffmpeg_bin = find_ffmpeg()
    tracks = req.tracks
    if not tracks:
        return

    state.reset_download_state(req.title)
    with state.lock:
        state.playlist_title = req.title
        state.total_tracks = len(tracks)
        state.status_message = f"Downloading \"{req.title}\" ({len(tracks)} tracks)"

    state.notify("playlist_loaded", {
        "title": req.title,
        "total": len(tracks)
    })

    enriched_cache = enrich_tracks_for_download(tracks, threads=min(4, req.threads))

    with ThreadPoolExecutor(max_workers=req.threads) as executor:
        future_to_track = {
            executor.submit(
                download_single_track,
                track,
                SONGS_DIR,
                ffmpeg_bin,
                req.quality,
                req.naming,
                None,
                enriched_cache.get((track.get('artist', 'Unknown Artist'), track.get('title', 'Unknown Title'))),
                should_stop=lambda: state.should_stop,
            ): track
            for track in tracks
        }

        for future in as_completed(future_to_track):
            if state.should_stop:
                for f in future_to_track:
                    f.cancel()
                break

            track = future_to_track[future]
            try:
                success, status, filename = future.result()
                with state.lock:
                    if status == "skipped":
                        state.skipped_count += 1
                    elif success:
                        state.downloaded_count += 1
                    else:
                        state.failed_count += 1

                    song_item = {
                        "filename": filename,
                        "title": track.get("title"),
                        "artist": track.get("artist"),
                        "album": track.get("album"),
                        "cover_url": track.get("cover_url"),
                        "status": status,
                        "timestamp": time.time()
                    }
                    state.recent_completed.insert(0, song_item)
                    if len(state.recent_completed) > 100:
                        state.recent_completed.pop()

                processed = state.downloaded_count + state.skipped_count + state.failed_count
                pct = int((processed / max(1, state.total_tracks)) * 100)

                state.notify("progress", {
                    "processed": processed,
                    "total": state.total_tracks,
                    "percent": pct,
                    "downloaded": state.downloaded_count,
                    "skipped": state.skipped_count,
                    "failed": state.failed_count,
                    "last_song": song_item
                })
            except Exception as e:
                with state.lock:
                    state.failed_count += 1
                state.notify("song_failed", {"title": track.get("title"), "error": str(e)})

    with state.lock:
        state.is_downloading = False
        state.status_message = "Download completed!" if not state.should_stop else "Download stopped."
    state.notify("completed", {
        "downloaded": state.downloaded_count,
        "skipped": state.skipped_count,
        "failed": state.failed_count,
        "time": round(time.time() - state.start_time, 1)
    })

# REST Endpoints
@app.get("/api/status")
def get_status():
    with state.lock:
        processed = state.downloaded_count + state.skipped_count + state.failed_count
        pct = int((processed / max(1, state.total_tracks)) * 100) if state.total_tracks > 0 else 0
        elapsed = time.time() - state.start_time if state.is_downloading else 0
        speed = round((state.downloaded_count / max(1, elapsed)) * 60, 1) if elapsed > 0 else 0

        return {
            "is_downloading": state.is_downloading,
            "is_enriching": state.is_enriching,
            "playlist_title": state.playlist_title,
            "total_tracks": state.total_tracks,
            "downloaded": state.downloaded_count,
            "skipped": state.skipped_count,
            "failed": state.failed_count,
            "percent": pct,
            "speed_songs_per_min": speed,
            "status_message": state.status_message,
            "queued": list(_pending_labels),
            "recent_completed": state.recent_completed[:20]
        }

@app.get("/api/app-update")
def app_update():
    return updater.check_app_update()

class OpenUrlPayload(BaseModel):
    url: str

@app.post("/api/app-update/open")
def app_update_open(req: OpenUrlPayload):
    import webbrowser
    # Only ever open this project's GitHub release downloads
    if not req.url.startswith(f"https://github.com/{updater.APP_REPO}/"):
        raise HTTPException(status_code=400, detail="Unsupported URL")
    webbrowser.open(req.url)
    return {"status": "opened"}

# ==================== DOWNLOAD QUEUE ====================
# Jobs share one progress display, so they run one at a time. A download requested while another is
# running waits its turn instead of being rejected (that used to make every second download fail).
_download_jobs: "queue.Queue" = queue.Queue()
_pending_labels: List[str] = []
_pending_lock = Lock()

def _download_queue_loop():
    while True:
        label, worker, req = _download_jobs.get()
        with _pending_lock:
            if _pending_labels:
                _pending_labels.pop(0)
        try:
            worker(req)
        except Exception as e:
            print(f"[Downloads] {label} failed: {e}")
        finally:
            with state.lock:
                state.is_downloading = False

Thread(target=_download_queue_loop, daemon=True, name="download-queue").start()

def enqueue_download(label: str, worker, req) -> dict:
    with _pending_lock:
        waiting = state.is_downloading or bool(_pending_labels)
        _pending_labels.append(label)
        position = len(_pending_labels)
        _download_jobs.put((label, worker, req))
    if waiting:
        state.notify("queued", {"title": label, "position": position})
        return {"status": "queued", "position": position, "title": label}
    return {"status": "started", "position": 0, "title": label}

@app.post("/api/download/start")
def start_download(req: DownloadRequest):
    return enqueue_download(req.url, run_download_worker, req)

@app.post("/api/download/stop")
def stop_download():
    """Stops the running download and cancels everything waiting behind it."""
    with _pending_lock:
        cleared = len(_pending_labels)
        while True:
            try:
                _download_jobs.get_nowait()
            except queue.Empty:
                break
        _pending_labels.clear()
    if not state.is_downloading:
        return {"status": "not_running", "cleared": cleared}
    with state.lock:
        state.should_stop = True
        state.status_message = "Stopping download workers..."
    return {"status": "stopping", "cleared": cleared}

@app.post("/api/enrich/start")
def start_enrich(req: EnrichRequest, background_tasks: BackgroundTasks):
    if state.is_enriching:
        raise HTTPException(status_code=400, detail="Metadata enrichment is already in progress.")
    background_tasks.add_task(run_enrich_worker, req)
    return {"status": "enriching_started"}

@app.get("/api/explore/featured")
def get_featured():
    return {
        "featured": discovery.get_featured_playlists(),
        "trending": discovery.get_trending_tracks(limit=60)
    }

@app.get("/api/explore/playlist/{playlist_id}")
def get_playlist_view(playlist_id: str):
    details = discovery.get_playlist_details(playlist_id)
    if not details:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return details

@app.get("/api/explore/album/{album_id}")
def get_album_view(album_id: str):
    details = discovery.get_album_details(album_id)
    if not details:
        raise HTTPException(status_code=404, detail="Album not found")
    return details

@app.get("/api/explore/search")
def search_explore(q: str, type: Optional[str] = "all"):
    clean_q = q.strip() if q else ""
    if not clean_q:
        return {"results": [], "tracks": [], "albums": []}

    tracks = []
    albums = []
    if type in ("all", "tracks"):
        tracks = discovery.search_tracks_everywhere(clean_q, limit=25)
    if type in ("all", "albums"):
        albums = discovery.search_albums(clean_q, limit=12)

    return {
        "results": tracks,
        "tracks": tracks,
        "albums": albums
    }

@app.post("/api/download/track")
def download_single_track_route(req: SingleTrackDownloadRequest):
    return enqueue_download(f"{req.artist} - {req.title}", run_single_song_worker, req)

@app.post("/api/download/playlist-tracks")
def download_batch_tracks_route(req: BatchTracksDownloadRequest):
    res = enqueue_download(req.title, run_batch_songs_worker, req)
    res["count"] = len(req.tracks)
    return res

# ==================== PLAY STATS & SMART PLAYLISTS ====================
def record_play_stat(req: RecordPlayRequest) -> Dict:
    stats = load_play_stats()
    now_ts = int(time.time())
    
    key = ""
    if req.filename and req.filename.strip():
        key = req.filename.strip()
    elif req.title and req.title.strip():
        key = f"{req.title.strip().lower()} - {(req.artist or '').strip().lower()}"
    else:
        return {"status": "ignored", "reason": "empty_track"}

    entry = stats.get(key, {})
    current_count = entry.get("play_count", 0) + 1
    
    entry.update({
        "filename": req.filename or entry.get("filename", ""),
        "title": req.title or entry.get("title", ""),
        "artist": req.artist or entry.get("artist", ""),
        "album": req.album or entry.get("album", ""),
        "duration": req.duration or entry.get("duration", 0),
        "play_count": current_count,
        "last_played": now_ts,
        "first_played": entry.get("first_played", now_ts)
    })
    
    stats[key] = entry
    save_play_stats(stats)
    return {"status": "recorded", "play_count": current_count, "key": key}

def get_most_played_tracks(limit: int = 100) -> List[Dict]:
    stats = load_play_stats()
    ranked = []
    
    try:
        songs = list_songs()
        song_by_fn = {s["filename"]: s for s in songs}
        song_by_title_artist = {f"{s['title'].strip().lower()} - {s['artist'].strip().lower()}": s for s in songs}
    except Exception:
        song_by_fn = {}
        song_by_title_artist = {}

    for key, item in stats.items():
        count = item.get("play_count", 0)
        if count <= 0:
            continue
            
        fn = item.get("filename", "")
        tit = item.get("title", "")
        art = item.get("artist", "")
        lookup_key = f"{tit.strip().lower()} - {art.strip().lower()}"
        
        match = song_by_fn.get(fn) or song_by_title_artist.get(lookup_key)
        
        final_fn = match["filename"] if match else fn
        final_title = match["title"] if match else tit
        final_artist = match["artist"] if match else art
        final_album = match["album"] if match else item.get("album", "Most Played")
        final_dur = match["duration"] if match else item.get("duration", 0)
        cover_url = f"/api/songs/artwork/{urllib.parse.quote(final_fn)}" if final_fn else (item.get("cover_url") or "/static/placeholder.svg")
        
        ranked.append({
            "id": f"mp_{key}",
            "filename": final_fn,
            "title": final_title,
            "artist": final_artist,
            "album": final_album,
            "duration": final_dur,
            "cover_url": cover_url,
            "play_count": count,
            "last_played": item.get("last_played", 0),
            "query": f"{final_title} {final_artist}".strip()
        })
        
    ranked.sort(key=lambda x: (x["play_count"], x.get("last_played", 0)), reverse=True)
    return ranked[:limit]

def get_smart_most_played_playlist() -> Dict:
    tracks = get_most_played_tracks(100)
    return {
        "id": "smart_most_played",
        "title": "🔥 Most Played",
        "description": "Your Top 100 most played tracks of all time",
        "type": "smart",
        "is_smart": True,
        "is_custom": False,
        "track_count": len(tracks),
        "cover_url": tracks[0]["cover_url"] if tracks else "/static/placeholder.svg",
        "created_at": 0,
        "updated_at": int(time.time()),
        "tracks": tracks
    }

# ==================== PLAYLISTS API ====================
@app.get("/api/playlists")
def list_playlists_route():
    playlists = load_playlists()
    smart_pl = get_smart_most_played_playlist()
    return [smart_pl] + playlists

@app.post("/api/play-stats/record")
def record_play_route(req: RecordPlayRequest):
    return record_play_stat(req)

@app.get("/api/play-stats/most-played")
def get_most_played_route(limit: int = 100):
    return get_most_played_tracks(limit=limit)

@app.post("/api/playlists")
def create_playlist_route(req: CreatePlaylistRequest):
    if not req.title or not req.title.strip():
        raise HTTPException(status_code=400, detail="Playlist title cannot be empty")
    
    playlists = load_playlists()
    now_ts = int(time.time())
    new_id = f"pl_{now_ts}_{len(playlists)+1}"
    
    playlist = {
        "id": new_id,
        "title": req.title.strip(),
        "description": (req.description or "").strip(),
        "cover_url": req.cover_url or "/static/placeholder.svg",
        "type": "custom",
        "is_custom": True,
        "track_count": 0,
        "created_at": now_ts,
        "updated_at": now_ts,
        "tracks": []
    }
    playlists.insert(0, playlist)
    save_playlists(playlists)
    return playlist

@app.get("/api/playlists/{playlist_id}")
def get_playlist_route(playlist_id: str):
    if playlist_id == "smart_most_played":
        return get_smart_most_played_playlist()
    playlists = load_playlists()
    for pl in playlists:
        if pl.get("id") == playlist_id:
            return pl
    raise HTTPException(status_code=404, detail="Playlist not found")

@app.put("/api/playlists/{playlist_id}")
def update_playlist_route(playlist_id: str, req: UpdatePlaylistRequest):
    if playlist_id == "smart_most_played":
        raise HTTPException(status_code=400, detail="Cannot modify system smart playlist")
    playlists = load_playlists()
    for pl in playlists:
        if pl.get("id") == playlist_id:
            if req.title is not None and req.title.strip():
                pl["title"] = req.title.strip()
            if req.description is not None:
                pl["description"] = req.description.strip()
            if req.cover_url is not None:
                pl["cover_url"] = req.cover_url
            pl["updated_at"] = int(time.time())
            save_playlists(playlists)
            return pl
    raise HTTPException(status_code=404, detail="Playlist not found")

@app.delete("/api/playlists/{playlist_id}")
def delete_playlist_route(playlist_id: str):
    if playlist_id == "smart_most_played":
        raise HTTPException(status_code=400, detail="Cannot delete system smart playlist")
    playlists = load_playlists()
    initial_len = len(playlists)
    playlists = [pl for pl in playlists if pl.get("id") != playlist_id]
    if len(playlists) == initial_len:
        raise HTTPException(status_code=404, detail="Playlist not found")
    save_playlists(playlists)
    cover_path = os.path.join(PLAYLIST_COVERS_DIR, f"{playlist_id}.png")
    if os.path.exists(cover_path):
        try:
            os.remove(cover_path)
        except Exception:
            pass
    return {"status": "deleted", "id": playlist_id}

@app.post("/api/playlists/{playlist_id}/tracks")
def add_track_to_playlist_route(playlist_id: str, req: AddTrackToPlaylistRequest):
    playlists = load_playlists()
    for pl in playlists:
        if pl.get("id") == playlist_id:
            tracks = pl.setdefault("tracks", [])
            for t in tracks:
                if t.get("title") == req.title and t.get("artist") == req.artist:
                    return {"status": "already_exists", "playlist": pl}
            
            new_track = {
                "id": f"trk_{int(time.time()*1000)}",
                "title": req.title,
                "artist": req.artist,
                "album": req.album or "Single",
                "cover_url": req.cover_url or "/static/placeholder.svg",
                "duration": req.duration or 0,
                "query": req.query or f"{req.title} {req.artist}",
                "preview_url": req.preview_url or "",
                "added_at": int(time.time())
            }
            tracks.append(new_track)
            pl["track_count"] = len(tracks)
            if pl.get("cover_url") in [None, "", "/static/placeholder.svg"] and req.cover_url:
                pl["cover_url"] = req.cover_url
            pl["updated_at"] = int(time.time())
            save_playlists(playlists)
            return {"status": "added", "track": new_track, "playlist": pl}
    raise HTTPException(status_code=404, detail="Playlist not found")

@app.delete("/api/playlists/{playlist_id}/tracks/{track_index}")
def remove_track_from_playlist_route(playlist_id: str, track_index: int):
    playlists = load_playlists()
    for pl in playlists:
        if pl.get("id") == playlist_id:
            tracks = pl.setdefault("tracks", [])
            if 0 <= track_index < len(tracks):
                removed = tracks.pop(track_index)
                pl["track_count"] = len(tracks)
                pl["updated_at"] = int(time.time())
                save_playlists(playlists)
                return {"status": "removed", "track": removed, "playlist": pl}
            raise HTTPException(status_code=400, detail="Invalid track index")
    raise HTTPException(status_code=404, detail="Playlist not found")

@app.post("/api/playlists/favorite")
def favorite_external_playlist_route(req: FavoritePlaylistRequest):
    if not req.title:
        raise HTTPException(status_code=400, detail="Playlist title is required")
    playlists = load_playlists()
    
    # Check if already favorited
    for pl in playlists:
        if (req.external_id and pl.get("external_id") == req.external_id) or (pl.get("title") == req.title and pl.get("type") == "saved"):
            return {"status": "already_favorited", "playlist": pl, "is_favorited": True}
    
    now_ts = int(time.time())
    new_id = f"fav_{now_ts}_{len(playlists)+1}"
    
    formatted_tracks = []
    for idx, t in enumerate(req.tracks or []):
        formatted_tracks.append({
            "id": t.get("id") or f"trk_{idx+1}",
            "title": t.get("title") or "Unknown Title",
            "artist": t.get("artist") or "Unknown Artist",
            "album": t.get("album") or req.title,
            "cover_url": t.get("cover_url") or req.cover_url or "/static/placeholder.svg",
            "duration": t.get("duration") or 0,
            "query": t.get("query") or f"{t.get('title')} {t.get('artist')}",
            "preview_url": t.get("preview_url") or "",
            "added_at": now_ts
        })
        
    fav_playlist = {
        "id": new_id,
        "title": req.title.strip(),
        "description": req.description or "Saved from Music Studio Discover",
        "cover_url": req.cover_url or "/static/placeholder.svg",
        "type": "saved",
        "is_custom": False,
        "external_id": req.external_id or "",
        "track_count": len(formatted_tracks),
        "created_at": now_ts,
        "updated_at": now_ts,
        "tracks": formatted_tracks
    }
    playlists.insert(0, fav_playlist)
    save_playlists(playlists)
    return {"status": "favorited", "playlist": fav_playlist, "is_favorited": True}

@app.post("/api/playlists/{playlist_id}/cover")
def upload_playlist_cover_route(playlist_id: str, payload: CoverUploadPayload):
    playlists = load_playlists()
    target_pl = None
    for pl in playlists:
        if pl.get("id") == playlist_id:
            target_pl = pl
            break
    if not target_pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
        
    if payload.image_url:
        target_pl["cover_url"] = payload.image_url
        target_pl["updated_at"] = int(time.time())
        save_playlists(playlists)
        return {"status": "updated", "cover_url": payload.image_url}
        
    if payload.image_data:
        raw_data = payload.image_data
        if "," in raw_data:
            raw_data = raw_data.split(",", 1)[1]
        try:
            img_bytes = base64.b64decode(raw_data)
            cover_path = os.path.join(PLAYLIST_COVERS_DIR, f"{playlist_id}.png")
            with open(cover_path, "wb") as f:
                f.write(img_bytes)
            cover_url = f"/api/playlists/cover/{playlist_id}?t={int(time.time())}"
            target_pl["cover_url"] = cover_url
            target_pl["updated_at"] = int(time.time())
            save_playlists(playlists)
            return {"status": "updated", "cover_url": cover_url}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to process image: {e}")
            
    raise HTTPException(status_code=400, detail="No image data or URL provided")

@app.get("/api/playlists/cover/{playlist_id}")
def serve_playlist_cover_route(playlist_id: str):
    cover_path = os.path.join(PLAYLIST_COVERS_DIR, f"{playlist_id}.png")
    if os.path.isfile(cover_path):
        return FileResponse(cover_path, media_type="image/png")
    placeholder = os.path.join(STATIC_DIR, "placeholder.svg")
    if os.path.isfile(placeholder):
        return FileResponse(placeholder, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Cover not found")

@app.post("/api/playlists/import")
def import_playlist_route(req: ImportPlaylistRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Playlist URL is required")

    collection_title = "Imported Playlist"
    tracks = []
    source = "custom"

    try:
        if SpotifyExtractor.is_spotify_url(url):
            source = "spotify"
            collection_title, tracks = SpotifyExtractor.extract_tracks(url)
        elif "youtube.com" in url or "youtu.be" in url:
            source = "youtube"
            collection_title, tracks = YouTubeExtractor.extract_tracks(url)
        else:
            raise HTTPException(status_code=400, detail="Unsupported URL. Please enter a valid Spotify or YouTube Music playlist link.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import playlist: {str(e)}")

    if not tracks:
        raise HTTPException(status_code=404, detail="No tracks found in the provided playlist URL.")

    # Determine cover art from tracks or fallback
    cover_url = tracks[0].get('cover_url', '') if tracks else '/static/placeholder.svg'

    now_ts = int(time.time())
    formatted_tracks = []
    for idx, t in enumerate(tracks):
        t_artist = t.get('artist') or "Unknown Artist"
        t_title = t.get('title') or "Unknown Title"
        formatted_tracks.append({
            "id": f"trk_{idx+1}",
            "title": t_title,
            "artist": t_artist,
            "album": t.get('album') or collection_title,
            "cover_url": t.get('cover_url') or cover_url,
            "duration": t.get('duration') or 0,
            "query": t.get('query') or f"{t_title} {t_artist}",
            "preview_url": t.get('preview_url') or "",
            "added_at": now_ts
        })

    playlist_id = f"imported_{now_ts}_{uuid.uuid4().hex[:6]}"
    new_playlist = {
        "id": playlist_id,
        "title": collection_title,
        "description": f"Imported from {source.title()} • {len(formatted_tracks)} tracks",
        "cover_url": cover_url,
        "type": "custom",
        "is_custom": True,
        "is_imported": True,
        "source": source,
        "source_url": url,
        "track_count": len(formatted_tracks),
        "created_at": now_ts,
        "updated_at": now_ts,
        "tracks": formatted_tracks
    }

    playlists = load_playlists()
    playlists.insert(0, new_playlist)
    save_playlists(playlists)

    return {
        "status": "imported",
        "success": True,
        "playlist": new_playlist,
        "message": f"Successfully imported \"{collection_title}\" with {len(formatted_tracks)} tracks!"
    }

@app.get("/api/songs")
def list_songs(search: Optional[str] = None):
    songs = []
    if not os.path.isdir(SONGS_DIR):
        return []

    for f in os.listdir(SONGS_DIR):
        if not f.lower().endswith(".mp3") or f.startswith("."):
            continue
        filepath = os.path.join(SONGS_DIR, f)
        try:
            stat = os.stat(filepath)
            size_mb = round(stat.st_size / (1024 * 1024), 2)
            
            title = f[:-4]
            artist = "Unknown Artist"
            album = "Unknown Album"
            year = ""
            genre = ""
            collaborators = []
            duration = 0
            bitrate = "320 kbps"
            
            try:
                mp3 = MP3(filepath)
                duration = int(mp3.info.length)
                # Extract bitrate
                if hasattr(mp3.info, 'bitrate'):
                    bitrate = f"{mp3.info.bitrate // 1000} kbps"
                    
                raw = ID3(filepath)
                if 'TIT2' in raw and raw['TIT2'].text:
                    title = raw['TIT2'].text[0]
                if 'TPE1' in raw and raw['TPE1'].text:
                    artist = raw['TPE1'].text[0]
                elif 'TPE2' in raw and raw['TPE2'].text:
                    artist = raw['TPE2'].text[0]
                if 'TALB' in raw and raw['TALB'].text:
                    album = raw['TALB'].text[0]
                if 'TDRC' in raw and raw['TDRC'].text:
                    year = str(raw['TDRC'].text[0])
                if 'TCON' in raw and raw['TCON'].text:
                    genre = str(raw['TCON'].text[0])
                # Extract featuring artists (TPE4 is "Involved people list" or look in title)
                if 'TPE4' in raw and raw['TPE4'].text:
                    collaborators = [str(c) for c in raw['TPE4'].text]
                elif ' feat. ' in title or ' featuring ' in title:
                    # Extract from title if present
                    parts = title.split(' feat. ')[-1] if ' feat. ' in title else title.split(' featuring ')[-1]
                    collaborators = [c.strip() for c in parts.split(',')] if parts else []
            except Exception:
                pass

            if title in ["Unknown Title", ""]:
                clean_art, clean_tit = clean_track_artist_and_title(f[:-4])
                title = clean_tit or f[:-4]
                if artist in ["Unknown Artist", ""] and clean_art and clean_art != "Unknown Artist":
                    artist = clean_art
            if album in ["Unknown Album", ""]:
                album = title

            if search:
                query = search.lower()
                search_match = (query in title.lower() or query in artist.lower() or 
                               query in album.lower() or query in f.lower() or
                               any(query in c.lower() for c in collaborators))
                if not search_match:
                    continue

            songs.append({
                "filename": f,
                "title": title,
                "artist": artist,
                "album": album,
                "year": year,
                "genre": genre,
                "collaborators": collaborators,
                "duration": duration,
                "size_mb": size_mb,
                "bitrate": bitrate,
                "mtime": stat.st_mtime
            })
        except Exception as e:
            print(f"[Library] Skipping {f!r}: {e}")
            continue

    # Tags can hold lone surrogates / bad bytes (seen on some Windows setups). One such value used to make
    # the whole JSON response fail to encode, so the library came back empty while Discover still worked.
    def _clean(v):
        if isinstance(v, str):
            return v.encode("utf-8", "replace").decode("utf-8")
        if isinstance(v, list):
            return [_clean(x) for x in v]
        return v
    songs = [{k: _clean(v) for k, v in song.items()} for song in songs]

    # Sort newest downloaded first
    songs.sort(key=lambda x: x["mtime"], reverse=True)
    return songs

@app.api_route("/api/songs/artwork/{filename:path}", methods=["GET", "HEAD"])
def get_song_artwork(filename: str, request: Request):
    candidates = [
        filename,
        urllib.parse.unquote(filename),
        f"{filename}.mp3" if not filename.endswith(".mp3") else filename,
        f"{urllib.parse.unquote(filename)}.mp3" if not filename.endswith(".mp3") else urllib.parse.unquote(filename)
    ]
    filepath = None
    for cand in candidates:
        fp = os.path.join(SONGS_DIR, cand)
        if os.path.isfile(fp):
            filepath = fp
            break

    if filepath and os.path.isfile(filepath):
        try:
            raw = ID3(filepath)
            for k in raw.keys():
                if k.startswith('APIC'):
                    frame = raw[k]
                    mime = frame.mime or "image/jpeg"
                    data = frame.data
                    if request.method == "HEAD":
                        return Response(status_code=200, media_type=mime, headers={
                            "Cache-Control": "public, max-age=86400",
                            "Content-Length": str(len(data))
                        })
                    return Response(
                        content=data,
                        media_type=mime,
                        headers={
                            "Cache-Control": "public, max-age=86400",
                            "Content-Length": str(len(data))
                        }
                    )
        except Exception:
            pass

    # Fallback to default SVG placeholder
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.5"><rect width="100%" height="100%" fill="#18181b"/><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v9"/></svg>"""
    svg_bytes = svg.encode('utf-8')
    if request.method == "HEAD":
        return Response(status_code=200, media_type="image/svg+xml", headers={"Content-Length": str(len(svg_bytes))})
    return Response(content=svg_bytes, media_type="image/svg+xml", headers={
        "Cache-Control": "public, max-age=86400",
        "Content-Length": str(len(svg_bytes))
    })

@app.api_route("/api/songs/audio/{filename:path}", methods=["GET", "HEAD"])
def stream_audio(filename: str, request: Request):
    candidates = [
        filename,
        urllib.parse.unquote(filename),
        f"{filename}.mp3" if not filename.endswith(".mp3") else filename,
        f"{urllib.parse.unquote(filename)}.mp3" if not filename.endswith(".mp3") else urllib.parse.unquote(filename)
    ]
    filepath = None
    for cand in candidates:
        fp = os.path.join(SONGS_DIR, cand)
        if os.path.isfile(fp):
            filepath = fp
            break
    if not filepath or not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Song not found")

    stat = os.stat(filepath)
    file_size = stat.st_size

    if request.method == "HEAD":
        return Response(
            status_code=200,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Type": "audio/mpeg",
            }
        )

    range_header = request.headers.get("range")

    if not range_header:
        return FileResponse(
            filepath,
            media_type="audio/mpeg",
            headers={"Accept-Ranges": "bytes"}
        )

    try:
        range_value = range_header.strip().lower()
        if not range_value.startswith("bytes="):
            return FileResponse(filepath, media_type="audio/mpeg", headers={"Accept-Ranges": "bytes"})

        byte_range = range_value[6:].split("-")
        start = int(byte_range[0]) if byte_range[0] else 0
        end = int(byte_range[1]) if len(byte_range) > 1 and byte_range[1] else file_size - 1

        if start >= file_size or end >= file_size or start > end:
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{file_size}"}
            )

        chunk_size = (end - start) + 1

        def iterfile(start_pos: int, length: int):
            with open(filepath, mode="rb") as f:
                f.seek(start_pos)
                remaining = length
                chunk = 64 * 1024
                while remaining > 0:
                    read_size = min(chunk, remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": "audio/mpeg",
        }
        return StreamingResponse(
            iterfile(start, chunk_size),
            status_code=206,
            headers=headers
        )
    except Exception:
        return FileResponse(filepath, media_type="audio/mpeg", headers={"Accept-Ranges": "bytes"})

@app.delete("/api/songs/{filename:path}")
def delete_song_file(filename: str):
    """Permanently delete a downloaded MP3 song from the library and disk."""
    if not filename or not filename.strip():
        raise HTTPException(status_code=400, detail="Filename parameter is required")
    
    candidates = [
        filename,
        urllib.parse.unquote(filename),
        f"{filename}.mp3" if not filename.endswith(".mp3") else filename,
        f"{urllib.parse.unquote(filename)}.mp3" if not urllib.parse.unquote(filename).endswith(".mp3") else urllib.parse.unquote(filename),
    ]

    target_path = None
    real_songs_dir = os.path.realpath(SONGS_DIR)
    for c in candidates:
        fp = os.path.realpath(os.path.join(SONGS_DIR, c))
        if fp.startswith(real_songs_dir) and os.path.isfile(fp):
            target_path = fp
            break

    if not target_path:
        raise HTTPException(status_code=404, detail="Song file not found in library")

    # Windows refuses to delete a file that is still open (e.g. the player's last range request
    # is finishing), so retry briefly before giving up.
    for attempt in range(6):
        try:
            os.remove(target_path)
            break
        except PermissionError as e:
            if attempt == 5:
                raise HTTPException(status_code=409, detail="The song is still in use. Stop playback and try again.")
            time.sleep(0.4)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to delete file from disk: {str(e)}")

    # Clean up from play stats if present
    try:
        stats = load_play_stats()
        base = os.path.basename(target_path)
        if base in stats:
            del stats[base]
            save_play_stats(stats)
    except Exception:
        pass

    return {
        "status": "deleted",
        "success": True,
        "filename": os.path.basename(target_path),
        "message": f"Successfully deleted {os.path.basename(target_path)}"
    }

# ==================== ON-THE-FLY STREAMING & DISK CACHE ENGINE ====================
STREAM_CACHE: Dict[str, dict] = {}
STREAM_CACHE_LOCK = Lock()
STREAM_CACHE_DIR = os.path.join(SONGS_DIR, ".stream_cache")
os.makedirs(STREAM_CACHE_DIR, exist_ok=True)
ACTIVE_PREFETCHES: set = set()
ACTIVE_PREFETCHES_LOCK = Lock()

def get_stream_cache_path(query: str):
    clean = re.sub(r"[\/\\:\*\?" + chr(34) + "<>\|]", "", query).strip().lower()
    h = hashlib.sha256(clean.encode("utf-8")).hexdigest()[:24]
    cache_file = os.path.join(STREAM_CACHE_DIR, f"{h}.m4a")
    tmp_file = os.path.join(STREAM_CACHE_DIR, f"{h}.tmp")
    return cache_file, tmp_file

def clean_stream_cache(max_size_mb: int = 800):
    """LRU cache cleaner to keep disk space capped."""
    try:
        if not os.path.isdir(STREAM_CACHE_DIR):
            return
        files = []
        total_size = 0
        for f in os.listdir(STREAM_CACHE_DIR):
            if f.endswith(".m4a") or f.endswith(".mp3"):
                p = os.path.join(STREAM_CACHE_DIR, f)
                st = os.stat(p)
                files.append((p, st.st_atime, st.st_size))
                total_size += st.st_size
        max_bytes = max_size_mb * 1024 * 1024
        if total_size > max_bytes:
            files.sort(key=lambda x: x[1])
            for p, _, size in files:
                try:
                    os.remove(p)
                    total_size -= size
                    if total_size <= max_bytes * 0.75:
                        break
                except Exception:
                    pass
    except Exception:
        pass

def stream_file_with_range(filepath: str, request: Request, content_type: str = "audio/mp4"):
    stat = os.stat(filepath)
    file_size = stat.st_size

    try:
        os.utime(filepath, None)
    except Exception:
        pass

    if request.method == "HEAD":
        return Response(
            status_code=200,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Type": content_type,
            }
        )

    range_header = request.headers.get("range")
    if not range_header:
        return FileResponse(
            filepath,
            media_type=content_type,
            headers={"Accept-Ranges": "bytes"}
        )

    try:
        range_value = range_header.strip().lower()
        if not range_value.startswith("bytes="):
            return FileResponse(filepath, media_type=content_type, headers={"Accept-Ranges": "bytes"})

        byte_range = range_value[6:].split("-")
        start = int(byte_range[0]) if byte_range[0] else 0
        end = int(byte_range[1]) if len(byte_range) > 1 and byte_range[1] else file_size - 1

        if start >= file_size or end >= file_size or start > end:
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{file_size}"}
            )

        chunk_size = (end - start) + 1

        def iterfile(start_pos: int, length: int):
            with open(filepath, mode="rb") as f:
                f.seek(start_pos)
                remaining = length
                chunk = 64 * 1024
                while remaining > 0:
                    read_size = min(chunk, remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": content_type,
            "Access-Control-Allow-Origin": "*",
        }
        return StreamingResponse(
            iterfile(start, chunk_size),
            status_code=206,
            headers=headers
        )
    except Exception:
        return FileResponse(filepath, media_type=content_type, headers={"Accept-Ranges": "bytes"})

def download_track_to_cache_worker(query: str):
    """Background worker to prefetch and cache audio file."""
    cache_file, tmp_file = get_stream_cache_path(query)
    if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 100000:
        return

    with ACTIVE_PREFETCHES_LOCK:
        if query in ACTIVE_PREFETCHES:
            return
        ACTIVE_PREFETCHES.add(query)

    try:
        stream_info = resolve_stream_url(query)
        stream_url = stream_info.get("url")
        if not stream_url:
            return

        req = urllib.request.Request(stream_url, headers={"User-Agent": "Mozilla/5.0"})
        with safe_urlopen(req, timeout=15) as upstream, open(tmp_file, "wb") as out_f:
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                out_f.write(chunk)

        if os.path.isfile(tmp_file) and os.path.getsize(tmp_file) > 100000:
            os.replace(tmp_file, cache_file)
            clean_stream_cache()
    except Exception:
        if os.path.isfile(tmp_file):
            try:
                os.remove(tmp_file)
            except Exception:
                pass
    finally:
        with ACTIVE_PREFETCHES_LOCK:
            ACTIVE_PREFETCHES.discard(query)

def resolve_stream_url(query: str) -> dict:
    """Resolve direct audio streaming URL using yt-dlp with caching."""
    cache_key = query.strip().lower()
    now = time.time()
    with STREAM_CACHE_LOCK:
        if cache_key in STREAM_CACHE:
            item = STREAM_CACHE[cache_key]
            if now - item.get("timestamp", 0) < 7200:
                return item

    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'noplaylist': True,
        'no_warnings': True,
    }
    ffmpeg_loc = find_ffmpeg()
    if ffmpeg_loc:
        ydl_opts['ffmpeg_location'] = ffmpeg_loc

    search_query = query if query.startswith("http") else f"ytsearch1:{query}"

    def extract():
        import yt_dlp as _ytdlp  # re-resolved so in-app updates take effect
        ydl_opts['js_runtimes'] = updater.js_runtimes()
        with _ytdlp.YoutubeDL(ydl_opts) as ydl:
            return ydl.extract_info(search_query, download=False)

    try:
        extracted = extract()
    except Exception as e:
        if not updater.heal(e):  # newer yt-dlp / JS runtime, then one retry
            raise
        extracted = extract()
    entry = extracted['entries'][0] if 'entries' in extracted else extracted
    stream_url = entry.get('url')
    duration = entry.get('duration') or 0
    title = entry.get('title') or query

    if not stream_url:
        raise ValueError("No audio stream available")

    content_type = "audio/webm"
    total_size = 0
    try:
        req = urllib.request.Request(stream_url, headers={'User-Agent': 'Mozilla/5.0'})
        with safe_urlopen(req, timeout=4) as probe:
            content_type = probe.headers.get('Content-Type', 'audio/webm')
            total_size = int(probe.headers.get('Content-Length', 0))
    except Exception:
        pass

    res = {
        'url': stream_url,
        'content_type': content_type,
        'total_size': total_size,
        'duration': duration,
        'title': title,
        'timestamp': now
    }
    with STREAM_CACHE_LOCK:
        STREAM_CACHE[cache_key] = res
    return res

@app.get("/api/stream/info")
def get_stream_info(q: str):
    """Returns streaming metadata without transferring full audio stream."""
    if not q or not q.strip():
        raise HTTPException(status_code=400, detail="Query parameter 'q' is required")
    try:
        info = resolve_stream_url(q)
        return {
            "title": info.get("title"),
            "duration": info.get("duration"),
            "content_type": info.get("content_type"),
            "stream_url": f"/api/stream?q={urllib.parse.quote(q)}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.api_route("/api/stream", methods=["GET", "HEAD"])
def stream_audio_live(q: str, request: Request, background_tasks: BackgroundTasks):
    """
    Streams audio on-the-fly for any track with disk caching and full HTTP Range request
    support for instantaneous scrubbing, seeking, and offline replay.
    """
    if not q or not q.strip():
        raise HTTPException(status_code=400, detail="Query parameter 'q' is required")

    # 1. If already downloaded permanently in user's library SONGS_DIR, stream local file directly!
    clean_q = re.sub(r'[\/\:\*\?"<>\|]', '', q).lower()
    if os.path.isdir(SONGS_DIR):
        for f in os.listdir(SONGS_DIR):
            if f.lower().endswith('.mp3'):
                f_clean = re.sub(r'[\/\:\*\?"<>\|]', '', f[:-4]).lower()
                if clean_q == f_clean or (len(clean_q) > 4 and clean_q in f_clean):
                    return stream_audio(f, request)

    # 2. If already cached in .stream_cache, serve directly from SSD with 0 latency!
    cache_file, tmp_file = get_stream_cache_path(q)
    if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 100000:
        return stream_file_with_range(cache_file, request, "audio/mp4")

    # 3. Resolve live stream URL
    try:
        stream_info = resolve_stream_url(q)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Streaming error: {str(e)}")

    stream_url = stream_info['url']
    content_type = stream_info.get('content_type', 'audio/webm')

    req_headers = {'User-Agent': 'Mozilla/5.0'}
    range_header = request.headers.get("range")
    if range_header:
        req_headers['Range'] = range_header

    try:
        try:
            upstream = safe_urlopen(urllib.request.Request(stream_url, headers=req_headers), timeout=10)
        except urllib.error.HTTPError as e:
            if e.code != 403:
                raise
            # Stream URLs expire or get refused: forget the cached one and resolve a fresh URL once
            with STREAM_CACHE_LOCK:
                STREAM_CACHE.pop(q.strip().lower(), None)
            stream_info = resolve_stream_url(q)
            stream_url = stream_info['url']
            upstream = safe_urlopen(urllib.request.Request(stream_url, headers=req_headers), timeout=10)
        status_code = upstream.status

        resp_headers = {
            'Content-Type': upstream.headers.get('Content-Type', content_type),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
        }
        if 'Content-Range' in upstream.headers:
            resp_headers['Content-Range'] = upstream.headers['Content-Range']
        if 'Content-Length' in upstream.headers:
            resp_headers['Content-Length'] = upstream.headers['Content-Length']

        if request.method == "HEAD":
            upstream.close()
            return Response(status_code=status_code, headers=resp_headers)

        # If full stream from beginning, cache to disk concurrently!
        is_full_stream = (not range_header or range_header.strip() == "bytes=0-")
        if is_full_stream and not os.path.isfile(cache_file):
            def iter_stream_and_cache():
                out_f = None
                try:
                    out_f = open(tmp_file, "wb")
                except Exception:
                    pass

                try:
                    while True:
                        chunk = upstream.read(64 * 1024)
                        if not chunk:
                            break
                        if out_f:
                            try:
                                out_f.write(chunk)
                            except Exception:
                                pass
                        yield chunk

                    if out_f:
                        out_f.close()
                        out_f = None
                        if os.path.isfile(tmp_file) and os.path.getsize(tmp_file) > 100000:
                            os.replace(tmp_file, cache_file)
                            clean_stream_cache()
                finally:
                    if out_f:
                        try:
                            out_f.close()
                        except Exception:
                            pass
                    upstream.close()

            return StreamingResponse(
                iter_stream_and_cache(),
                status_code=status_code,
                headers=resp_headers
            )
        else:
            # Range stream: proxy upstream and trigger background cache worker for the full file
            if not os.path.isfile(cache_file):
                background_tasks.add_task(download_track_to_cache_worker, q)

            def iter_stream():
                try:
                    while True:
                        chunk = upstream.read(64 * 1024)
                        if not chunk:
                            break
                        yield chunk
                finally:
                    upstream.close()

            return StreamingResponse(
                iter_stream(),
                status_code=status_code,
                headers=resp_headers
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upstream stream error: {str(e)}")

# ==================== TRACK ANALYSIS (for smart transitions) ====================
@app.get("/api/audio/analysis")
def audio_analysis_route(filename: Optional[str] = None, q: Optional[str] = None):
    """Silence, loudness, tempo and intro/outro shape for a library file (filename) or a cached stream (q)."""
    path = None
    if filename:
        cand = os.path.realpath(os.path.join(SONGS_DIR, urllib.parse.unquote(filename)))
        if cand.startswith(os.path.realpath(SONGS_DIR) + os.sep) and os.path.isfile(cand):
            path = cand
    elif q:
        cache_file, _ = get_stream_cache_path(q)
        if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 100000:
            path = cache_file
    if not path:
        return {"ready": False}
    res = audio_analysis.analyze(path, find_ffmpeg())
    return {"ready": True, **res} if res else {"ready": False}

@app.api_route("/api/stream/prefetch", methods=["GET", "POST"])
def prefetch_stream_audio(q: str, background_tasks: BackgroundTasks):
    """Prefetches and caches the upcoming track in the background for zero-gap playback."""
    if not q or not q.strip():
        return {"status": "ignored"}
    cache_file, _ = get_stream_cache_path(q)
    if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 100000:
        return {"status": "already_cached"}
    background_tasks.add_task(download_track_to_cache_worker, q)
    return {"status": "prefetching", "query": q}

@app.post("/api/open-folder")
def open_songs_folder():
    if sys.platform == "darwin":
        subprocess.run(["open", SONGS_DIR])
    elif sys.platform == "win32":
        os.startfile(SONGS_DIR)
    else:
        subprocess.run(["xdg-open", SONGS_DIR])
    return {"status": "opened", "path": SONGS_DIR}

class PlaybackStatePayload(BaseModel):
    is_playing: bool = False
    title: str = ""
    artist: str = ""
    album: str = ""
    cover_url: str = ""
    current_time: float = 0
    duration: float = 0
    index: int = -1

class PlaybackActionPayload(BaseModel):
    action: str
    time: Optional[float] = None
    filename: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    cover_url: Optional[str] = None
    query: Optional[str] = None
    duration: Optional[float] = None
    index: Optional[int] = None
    track: Optional[Dict[str, Any]] = None

    class Config:
        extra = "allow" 

current_playback_state = {
    "is_playing": False,
    "title": "",
    "artist": "",
    "album": "",
    "cover_url": "",
    "current_time": 0,
    "duration": 0,
    "index": -1
}

@app.get("/api/playback")
def get_playback_status():
    return current_playback_state

@app.post("/api/playback")
def update_playback_status(payload: PlaybackStatePayload):
    global current_playback_state
    current_playback_state = payload.dict()
    state.notify("playback", current_playback_state)
    return {"status": "ok"}

@app.post("/api/playback/action")
def trigger_playback_action(req: PlaybackActionPayload):
    state.notify("playback_command", req.dict())
    return {"status": "command_dispatched", "action": req.action}

@app.get("/api/events")
async def events_stream():
    queue = asyncio.Queue()
    state.listeners.append(queue)
    
    async def event_generator():
        try:
            while True:
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            state.listeners.remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# Mount Static Assets & Frontend
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/style.css")
def serve_root_css():
    return FileResponse(os.path.join(STATIC_DIR, "style.css"), media_type="text/css")

@app.get("/app.js")
def serve_root_js():
    return FileResponse(os.path.join(STATIC_DIR, "app.js"), media_type="application/javascript")

@app.get("/placeholder.svg")
def serve_root_placeholder():
    return FileResponse(os.path.join(STATIC_DIR, "placeholder.svg"), media_type="image/svg+xml")

@app.get("/favicon.svg")
def serve_root_favicon_svg():
    return FileResponse(os.path.join(STATIC_DIR, "favicon.svg"), media_type="image/svg+xml")

@app.get("/favicon.ico")
def serve_favicon():
    fav_path = os.path.join(STATIC_DIR, "favicon.svg")
    if os.path.isfile(fav_path):
        return FileResponse(fav_path, media_type="image/svg+xml")
    return HTMLResponse("", status_code=204)

@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.isfile(index_path):
        # Version asset URLs by content: a webview with a persistent cache must never run an old app.js/style.css
        h = hashlib.md5()
        for name in ("app.js", "style.css"):
            try:
                with open(os.path.join(STATIC_DIR, name), "rb") as fh:
                    h.update(fh.read())
            except OSError:
                pass
        with open(index_path, encoding="utf-8") as fh:
            html = re.sub(r'((?:app\.js|style\.css))\?v=[^"\']*', lambda m: f"{m.group(1)}?v={h.hexdigest()[:12]}", fh.read())
        return HTMLResponse(html, headers={"Cache-Control": "no-cache, no-store, must-revalidate, max-age=0"})
    return HTMLResponse("<h1>Loading UI...</h1>")

if __name__ == "__main__":
    import uvicorn
    PORT = int(os.environ.get("PORT", 5050))
    print(f"\n🚀 Starting Music Studio Web Server on http://localhost:{PORT}")
    print("📁 Destination folder:", SONGS_DIR)
    uvicorn.run("app:app", host="127.0.0.1", port=PORT, reload=False, log_level="info")
