"""
discovery.py - In-App Music Discovery, Trending Charts, and Live Search
Provides free, keyless music exploration via Deezer & Spotify Embed extractors.
"""

import os
import json
import time
import urllib.request
import urllib.parse
from ssl_helper import safe_urlopen
from typing import List, Dict, Optional, Tuple
from download_playlist import SpotifyExtractor

USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

# In-memory cache to ensure sub-millisecond responses and prevent redundant API hits
_CACHE = {}
CACHE_TTL = 3600  # 1 hour

def _get_cached(key: str) -> Optional[any]:
    entry = _CACHE.get(key)
    if entry and (time.time() - entry['time'] < CACHE_TTL):
        return entry['data']
    return None

def _set_cache(key: str, data: any):
    _CACHE[key] = {
        'time': time.time(),
        'data': data
    }

def _fetch_json(url: str, timeout: int = 10) -> Optional[Dict]:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with safe_urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"[Discovery] Error fetching {url}: {e}")
        return None

def get_featured_playlists() -> List[Dict]:
    """Returns curated featured playlists for the Discover view."""
    return [
        {
            "id": "most-played-weekly",
            "title": "Most Played This Week",
            "subtitle": "Global viral chart leaders & most streamed hits",
            "badge": "Most Played This Week",
            "type": "weekly",
            "deezer_id": "4403076402",
            "cover_url": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80",
            "spotify_url": "https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF"
        },
        {
            "id": "todays-top-hits",
            "title": "Today's Top Hits",
            "subtitle": "The hottest songs right now worldwide",
            "badge": "Top 100 Worldwide",
            "type": "chart",
            "deezer_id": "3155776842",
            "cover_url": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80",
            "spotify_url": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
        },
        {
            "id": "all-time-legends",
            "title": "Rock & Pop Legends",
            "subtitle": "Timeless rock anthems & legendary classics",
            "badge": "100 Classics",
            "type": "legendary",
            "deezer_id": "11242423484",
            "cover_url": "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=600&auto=format&fit=crop&q=80",
            "spotify_url": "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U"
        },
        {
            "id": "hip-hop-classics",
            "title": "Hip-Hop Heavyweights",
            "subtitle": "Golden era icons, trap beats, and modern anthems",
            "badge": "Hip-Hop & Rap",
            "type": "genre",
            "deezer_id": "1976915302",
            "cover_url": "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80"
        },
        {
            "id": "edm-dance-festival",
            "title": "EDM & Dance Festival",
            "subtitle": "High-energy house, synth drops, and festival bangers",
            "badge": "Dance Festival",
            "type": "genre",
            "deezer_id": "12134756071",
            "cover_url": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80"
        },
        {
            "id": "chill-deep-focus",
            "title": "Chill & Deep Focus",
            "subtitle": "Acoustic melodies, mellow beats, and relaxing vibes",
            "badge": "Lo-Fi & Chill",
            "type": "mood",
            "deezer_id": "1290316405",
            "cover_url": "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80"
        },
        {
            "id": "all-out-2000s",
            "title": "2000s Golden Era",
            "subtitle": "The defining hits and party anthems of the 2000s",
            "badge": "2000s Hits",
            "type": "era",
            "deezer_id": "4897737548",
            "cover_url": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80",
            "spotify_url": "https://open.spotify.com/playlist/37i9dQZF1DX4o1oenSJRJd"
        },
        {
            "id": "all-out-80s",
            "title": "All Out 80s Classics",
            "subtitle": "Synthwave, iconic pop, and timeless 80s gems",
            "badge": "80s Hits",
            "type": "era",
            "deezer_id": "1913763402",
            "cover_url": "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80",
            "spotify_url": "https://open.spotify.com/playlist/37i9dQZF1DX4UtSsGT1Sbe"
        }
    ]

def get_trending_tracks(limit: int = 60) -> List[Dict]:
    """Fetches real-time trending tracks from Deezer global chart."""
    cached = _get_cached(f"trending_{limit}")
    if cached:
        return cached

    url = f"https://api.deezer.com/chart/0/tracks?limit={limit}"
    data = _fetch_json(url)
    tracks = []

    if data and "data" in data:
        for rank, t in enumerate(data["data"], 1):
            tracks.append({
                "rank": rank,
                "id": str(t.get("id")),
                "title": t.get("title_short") or t.get("title"),
                "artist": t.get("artist", {}).get("name", "Unknown Artist"),
                "album": t.get("album", {}).get("title", "Single"),
                "duration": t.get("duration", 0),
                "cover_url": t.get("album", {}).get("cover_medium") or t.get("album", {}).get("cover_big", ""),
                "preview_url": t.get("preview", ""),
                "query": f"{t.get('artist', {}).get('name', '')} - {t.get('title', '')} Official Audio"
            })

    # Fallback to Spotify extractor if Deezer didn't return tracks
    if not tracks:
        try:
            _, sp_tracks = SpotifyExtractor.extract_tracks("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
            for idx, t in enumerate(sp_tracks[:limit]):
                tracks.append({
                    "rank": idx + 1,
                    "id": f"sp_{idx}",
                    "title": t.get("title"),
                    "artist": t.get("artist"),
                    "album": t.get("album"),
                    "duration": t.get("duration", 0),
                    "cover_url": t.get("cover_url"),
                    "preview_url": "",
                    "query": t.get("query")
                })
        except Exception as e:
            print(f"[Discovery] Spotify fallback error: {e}")

    if tracks:
        _set_cache(f"trending_{limit}", tracks)

    return tracks

def get_playlist_details(playlist_id: str) -> Optional[Dict]:
    """Retrieves full playlist metadata and tracklist by ID with unique covers and real durations."""
    if playlist_id.startswith("album_") or playlist_id.startswith("album-"):
        clean_alb = playlist_id.split("_", 1)[-1] if "_" in playlist_id else playlist_id.split("-", 1)[-1]
        return get_album_details(clean_alb)

    cached = _get_cached(f"playlist_{playlist_id}")
    if cached:
        return cached

    featured_map = {p["id"]: p for p in get_featured_playlists()}
    playlist_meta = featured_map.get(playlist_id)

    title = playlist_meta["title"] if playlist_meta else "Featured Playlist"
    subtitle = playlist_meta["subtitle"] if playlist_meta else ""
    cover_url = playlist_meta["cover_url"] if playlist_meta else ""
    tracks = []

    # 1. Primary: If playlist has a Deezer playlist ID, fetch directly for individual album covers and duration
    deezer_pid = None
    if playlist_meta and playlist_meta.get("deezer_id"):
        deezer_pid = playlist_meta["deezer_id"]
    elif playlist_id.isdigit():
        deezer_pid = playlist_id

    if deezer_pid:
        data = _fetch_json(f"https://api.deezer.com/playlist/{deezer_pid}")
        if data and "tracks" in data:
            if not playlist_meta and data.get("title"):
                title = data.get("title")
            if not cover_url and data.get("picture_medium"):
                cover_url = data.get("picture_medium")

            for idx, t in enumerate(data.get("tracks", {}).get("data", []), 1):
                track_title = t.get("title_short") or t.get("title", "")
                track_artist = t.get("artist", {}).get("name", "Unknown Artist")
                track_album = t.get("album", {}).get("title", "")
                track_cover = (
                    t.get("album", {}).get("cover_big")
                    or t.get("album", {}).get("cover_medium")
                    or cover_url
                )
                track_duration = t.get("duration", 0)
                preview_url = t.get("preview", "")

                tracks.append({
                    "track_number": idx,
                    "title": track_title,
                    "artist": track_artist,
                    "album": track_album or title,
                    "cover_url": track_cover,
                    "duration": track_duration,
                    "preview_url": preview_url,
                    "query": f"{track_artist} - {track_title} Official Audio"
                })

    # 2. Secondary fallback: Spotify Extractor if Deezer returned no tracks
    if not tracks and playlist_meta and playlist_meta.get("spotify_url"):
        try:
            sp_title, sp_tracks = SpotifyExtractor.extract_tracks(playlist_meta["spotify_url"])
            if sp_title:
                title = sp_title
            for idx, t in enumerate(sp_tracks, 1):
                raw_dur = t.get("duration", 0)
                dur_sec = raw_dur // 1000 if raw_dur > 1000 else raw_dur
                tracks.append({
                    "track_number": idx,
                    "title": t.get("title"),
                    "artist": t.get("artist"),
                    "album": t.get("album", title),
                    "cover_url": t.get("cover_url", cover_url),
                    "duration": dur_sec,
                    "preview_url": "",
                    "query": t.get("query") or f"{t.get('artist')} - {t.get('title')} Official Audio"
                })
        except Exception as e:
            print(f"[Discovery] Error extracting playlist {playlist_id} via Spotify: {e}")

    result = {
        "id": playlist_id,
        "title": title,
        "subtitle": subtitle,
        "cover_url": cover_url,
        "track_count": len(tracks),
        "tracks": tracks
    }

    if tracks:
        _set_cache(f"playlist_{playlist_id}", result)

    return result

def search_tracks(query: str, limit: int = 25) -> List[Dict]:
    """Performs instant live search across millions of tracks using Deezer public API."""
    q_clean = query.strip()
    if not q_clean:
        return []

    cache_key = f"search_{q_clean.lower()}_{limit}"
    cached = _get_cached(cache_key)
    if cached:
        return cached

    url = f"https://api.deezer.com/search?q={urllib.parse.quote(q_clean)}&limit={limit}"
    data = _fetch_json(url)
    results = []

    if data and "data" in data:
        for t in data["data"]:
            results.append({
                "id": str(t.get("id")),
                "title": t.get("title_short") or t.get("title"),
                "artist": t.get("artist", {}).get("name", "Unknown Artist"),
                "album": t.get("album", {}).get("title", ""),
                "duration": t.get("duration", 0),
                "cover_url": t.get("album", {}).get("cover_medium") or t.get("album", {}).get("cover_big", ""),
                "preview_url": t.get("preview", ""),
                "query": f"{t.get('artist', {}).get('name', '')} - {t.get('title', '')} Official Audio"
            })

    _set_cache(cache_key, results)
    return results

def search_albums(query: str, limit: int = 12) -> List[Dict]:
    """Searches albums and singles with cover art and track counts."""
    q_clean = query.strip()
    if not q_clean:
        return []

    cache_key = f"search_albums_{q_clean.lower()}_{limit}"
    cached = _get_cached(cache_key)
    if cached:
        return cached

    albums = []
    # 1. Primary: iTunes Search for high-res artwork and accurate track counts
    try:
        itunes_url = f"https://itunes.apple.com/search?term={urllib.parse.quote(q_clean)}&entity=album&limit={limit}"
        data = _fetch_json(itunes_url)
        if data and "results" in data:
            for a in data["results"]:
                art = a.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
                release_date = a.get("releaseDate", "")
                year = release_date[:4] if release_date else ""
                albums.append({
                    "id": str(a.get("collectionId")),
                    "title": a.get("collectionName", "Unknown Album"),
                    "artist": a.get("artistName", "Unknown Artist"),
                    "year": year,
                    "track_count": a.get("trackCount", 0),
                    "cover_url": art,
                    "genre": a.get("primaryGenreName", "Music"),
                    "type": "album",
                    "source": "itunes"
                })
    except Exception as e:
        print(f"[Discovery] Error searching albums via iTunes: {e}")

    # 2. Fallback to Deezer album search if iTunes was empty
    if not albums:
        try:
            dz_url = f"https://api.deezer.com/search/album?q={urllib.parse.quote(q_clean)}&limit={limit}"
            data = _fetch_json(dz_url)
            if data and "data" in data:
                for a in data["data"]:
                    albums.append({
                        "id": f"dz_{a.get('id')}",
                        "title": a.get("title", ""),
                        "artist": a.get("artist", {}).get("name", "Unknown Artist"),
                        "year": "",
                        "track_count": a.get("nb_tracks", 0),
                        "cover_url": a.get("cover_big") or a.get("cover_medium", ""),
                        "genre": "Music",
                        "type": "album",
                        "source": "deezer"
                    })
        except Exception as e:
            print(f"[Discovery] Error searching albums via Deezer: {e}")

    if albums:
        _set_cache(cache_key, albums)
    return albums

def get_album_details(album_id: str) -> Optional[Dict]:
    """Fetches full album metadata and all tracklist songs."""
    clean_id = str(album_id).replace("album_", "").replace("album-", "")
    cache_key = f"album_{clean_id}"
    cached = _get_cached(cache_key)
    if cached:
        return cached

    title = "Album"
    artist = "Unknown Artist"
    cover_url = ""
    year = ""
    tracks = []

    if clean_id.startswith("dz_"):
        # Deezer album lookup
        dz_id = clean_id[3:]
        data = _fetch_json(f"https://api.deezer.com/album/{dz_id}")
        if data:
            title = data.get("title", "Album")
            artist = data.get("artist", {}).get("name", "Unknown Artist")
            cover_url = data.get("cover_big") or data.get("cover_medium", "")
            release_date = data.get("release_date", "")
            year = release_date[:4] if release_date else ""
            for idx, t in enumerate(data.get("tracks", {}).get("data", []), 1):
                t_title = t.get("title_short") or t.get("title", "")
                t_artist = t.get("artist", {}).get("name", artist)
                tracks.append({
                    "track_number": idx,
                    "title": t_title,
                    "artist": t_artist,
                    "album": title,
                    "cover_url": cover_url,
                    "duration": t.get("duration", 0),
                    "preview_url": t.get("preview", ""),
                    "query": f"{t_artist} - {t_title} Official Audio"
                })
    else:
        # iTunes lookup
        lookup_url = f"https://itunes.apple.com/lookup?id={clean_id}&entity=song"
        data = _fetch_json(lookup_url)
        if data and data.get("results"):
            results = data["results"]
            album_meta = results[0]
            title = album_meta.get("collectionName", "Album")
            artist = album_meta.get("artistName", "Unknown Artist")
            cover_url = album_meta.get("artworkUrl100", "").replace("100x100bb", "600x600bb")
            release_date = album_meta.get("releaseDate", "")
            year = release_date[:4] if release_date else ""

            for idx, t in enumerate(results[1:], 1):
                t_title = t.get("trackName", "")
                t_artist = t.get("artistName", artist)
                dur_sec = t.get("trackTimeMillis", 0) // 1000
                tracks.append({
                    "track_number": t.get("trackNumber", idx),
                    "title": t_title,
                    "artist": t_artist,
                    "album": title,
                    "cover_url": cover_url,
                    "duration": dur_sec,
                    "preview_url": t.get("previewUrl", ""),
                    "query": f"{t_artist} - {t_title} Official Audio"
                })

    subtitle = f"{artist} • {year} • {len(tracks)} Tracks" if year else f"{artist} • {len(tracks)} Tracks"
    result = {
        "id": f"album_{clean_id}",
        "title": title,
        "subtitle": subtitle,
        "artist": artist,
        "cover_url": cover_url,
        "track_count": len(tracks),
        "type": "album",
        "tracks": tracks
    }

    if tracks:
        _set_cache(cache_key, result)

    return result

