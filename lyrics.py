#!/usr/bin/env python3
"""
Lyrics Engine for Music Studio
Provides synchronized (LRC) and plain lyrics fetching, parsing, caching,
and offline library synchronization.
Powered by LRCLIB, local .lrc files, and ID3 tags.
"""

import os
import re
import sys
import time
import json
import urllib.request
import urllib.parse
import urllib.error
from threading import Thread, Lock
from typing import Optional, Dict, Any, List, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import mutagen
from mutagen.id3 import ID3, USLT, SYLT, ID3NoHeaderError
from mutagen.mp3 import MP3

from ssl_helper import safe_urlopen
from download_playlist import clean_track_artist_and_title, DEFAULT_OUTPUT_FOLDER

# Setup directories
if getattr(sys, 'frozen', False):
    USER_DATA_DIR = os.path.expanduser("~/Music/Music Studio/.musicstudio")
else:
    USER_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

LYRICS_CACHE_DIR = os.path.join(USER_DATA_DIR, "lyrics")
os.makedirs(LYRICS_CACHE_DIR, exist_ok=True)

USER_AGENT = "MusicStudio/3.7.0 (https://github.com/sahas/MusicStudio)"

# Sync status tracking
_sync_lock = Lock()
_sync_status = {
    "is_running": False,
    "total": 0,
    "completed": 0,
    "found": 0,
    "not_found": 0,
    "current_song": "",
    "cancelled": False
}


def sanitize_filename(name: str) -> str:
    """Sanitize filename to prevent invalid characters across OSes."""
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()


def parse_lrc(lrc_text: str) -> List[Dict[str, Any]]:
    """
    Parse LRC formatted text into structured lines with timestamps and optional word-level sync.
    Handles standard LRC [mm:ss.xx], multiple timestamps [00:01][00:05],
    and enhanced LRC word timestamps <mm:ss.xx> word.
    """
    if not lrc_text:
        return []

    lines = []
    time_regex = re.compile(r'\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]')
    word_regex = re.compile(r'<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>\s*([^<]+)')

    for raw_line in lrc_text.splitlines():
        line_clean = raw_line.strip()
        if not line_clean:
            continue
        # Skip standard LRC metadata tags like [ti:], [ar:], [al:], [by:], [offset:], [length:]
        if re.match(r'^\[(?:ti|ar|al|by|offset|length|re|ve):', line_clean, re.IGNORECASE):
            continue

        matches = list(time_regex.finditer(line_clean))
        if not matches:
            continue

        # Text begins after the last timestamp marker in the prefix
        last_match = matches[-1]
        text_part = line_clean[last_match.end():].strip()

        # Check for enhanced word-level timestamps <mm:ss.xx> word
        word_matches = list(word_regex.finditer(text_part))
        words = []
        if word_matches:
            for wm in word_matches:
                m, s, ms, w_text = wm.groups()
                ms_norm = '0.' + (ms or '0')
                try:
                    w_time = int(m) * 60 + int(s) + float(ms_norm)
                except ValueError:
                    w_time = int(m) * 60 + int(s)
                if w_text.strip():
                    words.append({"time": round(w_time, 2), "text": w_text.strip()})
            clean_text = " ".join(w["text"] for w in words)
        else:
            clean_text = re.sub(r'<[^>]+>', '', text_part).strip()

        for match in matches:
            m, s, ms = match.groups()
            ms_norm = '0.' + (ms or '0')
            try:
                sec = int(m) * 60 + int(s) + float(ms_norm)
            except ValueError:
                sec = int(m) * 60 + int(s)

            lines.append({
                "time": round(sec, 2),
                "text": clean_text,
                "words": words
            })

    lines.sort(key=lambda x: x["time"])
    generate_word_timings(lines)
    return lines


def generate_word_timings(lines: List[Dict[str, Any]]) -> None:
    """
    Ensure every single line has smooth word-level timings with startTime and endTime.
    If the line already has word timestamps from an enhanced LRC file, compute endTimes.
    If the line does not have word timestamps, calculates phonetic duration-weighted
    word intervals based on word length, vowel distribution, and punctuation pauses.
    """
    total_lines = len(lines)
    for i, line in enumerate(lines):
        text = (line.get("text") or "").strip()
        if not text:
            line["words"] = []
            continue

        existing_words = line.get("words")
        line_start = line["time"]

        # Calculate line duration based on next line's timestamp
        if i < total_lines - 1:
            next_start = lines[i + 1]["time"]
            line_duration = max(0.8, next_start - line_start)
        else:
            line_duration = max(2.5, len(text.split()) * 0.45)

        # If existing word timestamps are present from enhanced LRC
        if existing_words and len(existing_words) > 0:
            for w_idx, w in enumerate(existing_words):
                if "startTime" not in w:
                    w["startTime"] = w.get("time", line_start)
                if "endTime" not in w:
                    if w_idx < len(existing_words) - 1:
                        w["endTime"] = existing_words[w_idx + 1].get("time", w["startTime"] + 0.3)
                    else:
                        w["endTime"] = min(line_start + line_duration, w["startTime"] + 0.5)
            continue

        # Otherwise, calculate duration-weighted word intervals
        words_raw = text.split()
        if not words_raw:
            line["words"] = []
            continue

        # Singing vocal duration: leaves natural breath gap before next line if gap > 2.5s
        if line_duration > 6.0:
            vocal_duration = min(line_duration * 0.78, len(words_raw) * 0.58)
        elif line_duration > 3.0:
            vocal_duration = line_duration * 0.88
        else:
            vocal_duration = line_duration * 0.94

        weights = []
        for w in words_raw:
            clean_w = w.strip('.,!?:;\"\'()[]-—')
            w_len = max(1, len(clean_w))
            # Vowels add singing length
            vowels = sum(1 for c in clean_w.lower() if c in 'aeiouy')
            weight = w_len + vowels * 0.65
            if w.endswith((',', ';')):
                weight += 1.6
            elif w.endswith(('.', '!', '?', '...')):
                weight += 2.4
            weights.append(weight)

        total_weight = sum(weights) or 1.0
        cur_t = line_start
        computed_words = []
        for w, weight in zip(words_raw, weights):
            w_dur = (weight / total_weight) * vocal_duration
            computed_words.append({
                "text": w,
                "startTime": round(cur_t, 3),
                "endTime": round(cur_t + w_dur, 3),
                "time": round(cur_t, 3)
            })
            cur_t += w_dur

        line["words"] = computed_words


def read_id3_lyrics(mp3_path: str) -> Optional[str]:
    """Read lyrics embedded in ID3 tags (USLT or SYLT)."""
    if not os.path.isfile(mp3_path):
        return None
    try:
        raw = ID3(mp3_path)
        # Check USLT (unsynced lyrics)
        uslt_frames = raw.getall("USLT")
        if uslt_frames and uslt_frames[0].text:
            return str(uslt_frames[0].text)
    except Exception:
        pass
    return None


def embed_lyrics_id3(mp3_path: str, lyrics_text: str):
    """Embed lyrics into MP3 ID3 tags (USLT frame)."""
    if not os.path.isfile(mp3_path) or not lyrics_text:
        return
    try:
        try:
            audio = ID3(mp3_path)
        except ID3NoHeaderError:
            audio = ID3()
        audio.delall("USLT")
        audio.add(USLT(encoding=3, lang='eng', desc='', text=lyrics_text))
        audio.save(mp3_path)
    except Exception as e:
        print(f"[Lyrics] Warning: could not embed ID3 lyrics into {mp3_path}: {e}")


def get_local_lyrics(title: str, artist: str, filename: Optional[str] = None, songs_dir: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Search for lyrics locally:
    1. Check next to the audio file as <basename>.lrc in songs_dir
    2. Check ~/.musicstudio/lyrics/<artist> - <title>.lrc or ~/.musicstudio/lyrics/<title>.lrc
    3. Check embedded ID3 tags
    """
    target_dir = songs_dir or DEFAULT_OUTPUT_FOLDER

    candidate_files = []

    # 1. If filename is given, check directly alongside audio file
    if filename:
        base, _ = os.path.splitext(filename)
        candidate_files.append(os.path.join(target_dir, f"{base}.lrc"))
        if os.path.isabs(filename):
            base_abs, _ = os.path.splitext(filename)
            candidate_files.append(f"{base_abs}.lrc")

    # 2. Check candidate filenames based on artist & title
    safe_art = sanitize_filename(artist)
    safe_tit = sanitize_filename(title)
    if safe_art and safe_tit:
        candidate_files.append(os.path.join(target_dir, f"{safe_art} - {safe_tit}.lrc"))
        candidate_files.append(os.path.join(LYRICS_CACHE_DIR, f"{safe_art} - {safe_tit}.lrc"))
    if safe_tit:
        candidate_files.append(os.path.join(target_dir, f"{safe_tit}.lrc"))
        candidate_files.append(os.path.join(LYRICS_CACHE_DIR, f"{safe_tit}.lrc"))

    # Try each candidate .lrc file
    for cand in candidate_files:
        if os.path.isfile(cand):
            try:
                with open(cand, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read().strip()
                if content:
                    parsed_lines = parse_lrc(content)
                    if parsed_lines:
                        return {
                            "synced": True,
                            "instrumental": False,
                            "plain": content,
                            "lines": parsed_lines,
                            "source": "local"
                        }
                    else:
                        return {
                            "synced": False,
                            "instrumental": False,
                            "plain": content,
                            "lines": [],
                            "source": "local"
                        }
            except Exception as e:
                print(f"[Lyrics] Error reading {cand}: {e}")

    # 3. Check ID3 tag if mp3 exists
    if filename:
        mp3_path = os.path.join(target_dir, filename) if not os.path.isabs(filename) else filename
        if os.path.isfile(mp3_path):
            id3_lyr = read_id3_lyrics(mp3_path)
            if id3_lyr:
                parsed = parse_lrc(id3_lyr)
                return {
                    "synced": bool(parsed),
                    "instrumental": False,
                    "plain": id3_lyr,
                    "lines": parsed,
                    "source": "id3"
                }

    return None


def fetch_lrclib(title: str, artist: str, album: Optional[str] = None, duration: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """
    Query LRCLIB API for synchronized or plain lyrics.
    Tries exact get first, then cleans title/artist, then falls back to search.
    """
    clean_art, clean_tit = clean_track_artist_and_title(f"{artist} - {title}")
    q_art = clean_art or artist
    q_tit = clean_tit or title

    queries_to_try = [
        # 1. Exact query
        {"track_name": title, "artist_name": artist, "album_name": album, "duration": duration},
        # 2. Cleaned query
        {"track_name": q_tit, "artist_name": q_art, "duration": duration},
        # 3. Query without duration
        {"track_name": q_tit, "artist_name": q_art}
    ]

    for q in queries_to_try:
        params = {k: str(v) for k, v in q.items() if v is not None and v != ""}
        url = f"https://lrclib.net/api/get?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with safe_urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data:
                    return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            elif e.code in (429, 503):
                time.sleep(1.0)
                continue
        except Exception:
            continue

    # Fallback to search
    search_queries = [
        f"{q_art} {q_tit}",
        f"{artist} {title}",
        q_tit
    ]

    for sq in search_queries:
        s_url = f"https://lrclib.net/api/search?{urllib.parse.urlencode({'q': sq})}"
        req = urllib.request.Request(s_url, headers={"User-Agent": USER_AGENT})
        try:
            with safe_urlopen(req, timeout=6) as resp:
                results = json.loads(resp.read().decode('utf-8'))
                if not results or not isinstance(results, list):
                    continue

                # Filter for items with syncedLyrics first
                with_synced = [r for r in results if r.get("syncedLyrics")]
                candidates = with_synced if with_synced else results

                # If duration provided, find closest candidate
                if duration and duration > 0:
                    def dur_diff(item):
                        item_dur = item.get("duration") or 0
                        return abs(item_dur - duration)
                    candidates.sort(key=dur_diff)

                if candidates:
                    return candidates[0]
        except Exception:
            continue

    return None


def save_lyrics_cache(artist: str, title: str, lrc_text: str, filename: Optional[str] = None, songs_dir: Optional[str] = None):
    """
    Save lyrics to cache and optionally beside the MP3 file in songs_dir.
    """
    safe_art = sanitize_filename(artist)
    safe_tit = sanitize_filename(title)
    target_dir = songs_dir or DEFAULT_OUTPUT_FOLDER

    # 1. Save in ~/.musicstudio/lyrics/
    cache_path = os.path.join(LYRICS_CACHE_DIR, f"{safe_art} - {safe_tit}.lrc")
    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            f.write(lrc_text)
    except Exception as e:
        print(f"[Lyrics] Error writing cache {cache_path}: {e}")

    # 2. If filename in songs_dir exists, save <base>.lrc right next to it
    if filename:
        base, _ = os.path.splitext(filename)
        file_lrc_path = os.path.join(target_dir, f"{base}.lrc")
        try:
            with open(file_lrc_path, 'w', encoding='utf-8') as f:
                f.write(lrc_text)
        except Exception as e:
            print(f"[Lyrics] Error writing local .lrc {file_lrc_path}: {e}")

        # Also embed into ID3 tags
        mp3_full = os.path.join(target_dir, filename) if not os.path.isabs(filename) else filename
        if os.path.isfile(mp3_full):
            embed_lyrics_id3(mp3_full, lrc_text)


def get_lyrics(
    title: str,
    artist: str,
    album: Optional[str] = None,
    duration: Optional[int] = None,
    filename: Optional[str] = None,
    force_refresh: bool = False,
    songs_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Main function to get lyrics for a track.
    1. Checks local file/cache if not force_refresh
    2. Fetches from LRCLIB
    3. Saves to cache / alongside local MP3
    4. Returns parsed result
    """
    if not title:
        return {"synced": False, "instrumental": False, "plain": "", "lines": [], "source": "none"}

    target_dir = songs_dir or DEFAULT_OUTPUT_FOLDER

    # 1. Try local first
    if not force_refresh:
        local_res = get_local_lyrics(title, artist, filename=filename, songs_dir=target_dir)
        if local_res and (local_res.get("synced") or local_res.get("plain")):
            return local_res

    # 2. Fetch from LRCLIB
    remote_data = fetch_lrclib(title, artist, album=album, duration=duration)
    if not remote_data:
        return {
            "synced": False,
            "instrumental": False,
            "plain": "",
            "lines": [],
            "source": "not_found"
        }

    is_instrumental = bool(remote_data.get("instrumental"))
    synced_raw = remote_data.get("syncedLyrics") or ""
    plain_raw = remote_data.get("plainLyrics") or ""

    if is_instrumental:
        return {
            "synced": False,
            "instrumental": True,
            "plain": "♪ Instrumental ♪",
            "lines": [],
            "source": "lrclib"
        }

    lrc_to_save = synced_raw or plain_raw
    if lrc_to_save:
        save_lyrics_cache(artist, title, lrc_to_save, filename=filename, songs_dir=target_dir)

    parsed_lines = parse_lrc(synced_raw) if synced_raw else []

    return {
        "synced": bool(parsed_lines),
        "instrumental": False,
        "plain": plain_raw or synced_raw,
        "lines": parsed_lines,
        "source": "lrclib"
    }


def fetch_and_save_lrc(mp3_filepath: str, track_info: Dict[str, Any]) -> bool:
    """
    Called upon newly downloaded track completion to immediately fetch and save
    its .lrc file alongside the MP3.
    """
    try:
        title = track_info.get("title", "")
        artist = track_info.get("artist", "")
        album = track_info.get("album", "")
        duration = track_info.get("duration")

        if not title:
            return False

        filename = os.path.basename(mp3_filepath)
        songs_dir = os.path.dirname(mp3_filepath)

        res = get_lyrics(title, artist, album=album, duration=duration, filename=filename, songs_dir=songs_dir)
        return bool(res.get("synced") or res.get("plain"))
    except Exception as e:
        print(f"[Lyrics] Auto-fetch error for {mp3_filepath}: {e}")
        return False


def sync_library_lyrics(songs_dir: Optional[str] = None):
    """
    Background worker that scans the library for downloaded songs that do not have .lrc files
    and fetches them from LRCLIB.
    Updates _sync_status dict for the frontend progress indicator.
    """
    target_dir = songs_dir or DEFAULT_OUTPUT_FOLDER
    if not os.path.isdir(target_dir):
        return

    with _sync_lock:
        if _sync_status["is_running"]:
            return
        _sync_status["is_running"] = True
        _sync_status["cancelled"] = False
        _sync_status["total"] = 0
        _sync_status["completed"] = 0
        _sync_status["found"] = 0
        _sync_status["not_found"] = 0
        _sync_status["current_song"] = "Scanning library..."

    def _worker():
        try:
            mp3_files = [f for f in os.listdir(target_dir) if f.lower().endswith(".mp3") and not f.startswith(".")]
            
            # Find songs without .lrc
            missing_files = []
            for f in mp3_files:
                base, _ = os.path.splitext(f)
                lrc_path = os.path.join(target_dir, f"{base}.lrc")
                if not os.path.isfile(lrc_path):
                    missing_files.append(f)

            with _sync_lock:
                _sync_status["total"] = len(missing_files)
                if len(missing_files) == 0:
                    _sync_status["is_running"] = False
                    _sync_status["current_song"] = "All library tracks have offline lyrics!"
                    return

            for i, fname in enumerate(missing_files):
                with _sync_lock:
                    if _sync_status["cancelled"]:
                        _sync_status["is_running"] = False
                        _sync_status["current_song"] = "Sync cancelled"
                        return
                    _sync_status["current_song"] = fname
                    _sync_status["completed"] = i

                full_path = os.path.join(target_dir, fname)
                title = fname[:-4]
                artist = "Unknown Artist"
                album = ""
                duration = 0

                try:
                    mp3 = MP3(full_path)
                    duration = int(mp3.info.length)
                    raw = ID3(full_path)
                    if 'TIT2' in raw and raw['TIT2'].text:
                        title = raw['TIT2'].text[0]
                    if 'TPE1' in raw and raw['TPE1'].text:
                        artist = raw['TPE1'].text[0]
                    elif 'TPE2' in raw and raw['TPE2'].text:
                        artist = raw['TPE2'].text[0]
                    if 'TALB' in raw and raw['TALB'].text:
                        album = raw['TALB'].text[0]
                except Exception:
                    pass

                clean_art, clean_tit = clean_track_artist_and_title(title)
                if clean_tit:
                    title = clean_tit
                if clean_art and artist == "Unknown Artist":
                    artist = clean_art

                res = get_lyrics(title, artist, album=album, duration=duration, filename=fname, songs_dir=target_dir)
                with _sync_lock:
                    if res.get("synced") or res.get("plain") or res.get("instrumental"):
                        _sync_status["found"] += 1
                    else:
                        _sync_status["not_found"] += 1

                # Polite pause to respect rate limits
                time.sleep(0.35)

            with _sync_lock:
                _sync_status["completed"] = len(missing_files)
                _sync_status["is_running"] = False
                _sync_status["current_song"] = "Finished syncing library lyrics"

        except Exception as e:
            print(f"[Lyrics] Library sync error: {e}")
            with _sync_lock:
                _sync_status["is_running"] = False
                _sync_status["current_song"] = f"Error: {e}"

    Thread(target=_worker, daemon=True).start()


def get_sync_status() -> Dict[str, Any]:
    with _sync_lock:
        return dict(_sync_status)


def cancel_sync():
    with _sync_lock:
        _sync_status["cancelled"] = True
