"""
Track analysis for smart transitions: silence, loudness, tempo and the energy shape of the
intro and outro.

Uses ffmpeg plus the standard library only (no numpy, so the packaged app stays small).
Results are cached per file (path + mtime + size).
"""

import math
import os
import re
import subprocess
import sys
from array import array
from threading import Lock
from typing import Dict, List, Optional, Tuple

ENV_RATE = 100               # energy envelope frames per second
PCM_RATE = 8000              # mono sample rate used to build the envelope
MAX_ENVELOPE_SECONDS = 900   # long DJ mixes: skip tempo/shape analysis past this
_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

_cache: Dict[str, dict] = {}
_key_locks: Dict[str, Lock] = {}
_locks_guard = Lock()


def _run(cmd: List[str], binary: bool = False) -> subprocess.CompletedProcess:
    text_opts = {} if binary else {"text": True, "errors": "replace"}
    return subprocess.run(cmd, capture_output=True, timeout=180, creationflags=_NO_WINDOW, **text_opts)


def _silence_and_loudness(ffmpeg_bin: str, path: str) -> Optional[dict]:
    """One decode pass: leading/trailing silence, integrated loudness (LUFS) and true peak."""
    def run(ebur128_opts: str) -> str:
        proc = _run([ffmpeg_bin, "-hide_banner", "-nostats", "-i", path, "-vn",
                     "-af", f"silencedetect=noise=-48dB:d=0.3,ebur128={ebur128_opts}",
                     "-f", "null", "-"])
        return proc.stderr or ""

    log = run("peak=true:framelog=verbose")      # keep the per-100ms meter lines out of the log
    if "framelog" in log and "Option not found" in log:
        log = run("peak=true")                    # older ffmpeg builds

    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", log)
    if not m:
        return None
    duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

    lead = trail = 0.0
    start = None
    for line in log.splitlines():
        ms = re.search(r"silence_start:\s*(-?[\d.]+)", line)
        me = re.search(r"silence_end:\s*(-?[\d.]+)", line)
        if ms:
            start = max(0.0, float(ms.group(1)))
        elif me and start is not None:
            end = float(me.group(1))
            if start <= 0.1:
                lead = end
            elif end >= duration - 0.15:
                trail = duration - start
            start = None
    if start is not None:  # silence that runs to the end of the file never reports silence_end
        trail = duration - start
    if lead + trail >= duration * 0.6:  # whole-file "silence": detector is unreliable here
        lead = trail = 0.0

    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", log)
    peak = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", log)
    return {
        "duration": round(duration, 2),
        "lead": round(min(lead, 45.0), 2),
        "trail": round(min(trail, 45.0), 2),
        "lufs": float(lufs[-1]) if lufs else None,          # the summary comes last
        "peak": float(peak[-1]) if peak and peak[-1] != "-inf" else None,
    }


def _envelopes(ffmpeg_bin: str, path: str) -> Tuple[List[float], List[float], List[float]]:
    """
    Mean absolute amplitude per 10 ms frame for the full signal, an onset-strength curve built from
    separate low (kick) and high (snare/hat) bands, which tracks the beat far better than full-band
    energy on dense mixes, and the low-band onsets alone (kicks mark downbeats).
    """
    graph = ("[0:a]aformat=channel_layouts=mono,aresample=%d,asplit=3[f][l][h];"
             "[l]lowpass=f=150[lo];[h]highpass=f=3000[hi];"
             "[f][lo][hi]join=inputs=3:channel_layout=3.0[out]" % PCM_RATE)
    proc = _run([ffmpeg_bin, "-hide_banner", "-nostats", "-loglevel", "error", "-i", path, "-vn",
                 "-t", str(MAX_ENVELOPE_SECONDS), "-filter_complex", graph, "-map", "[out]",
                 "-f", "s16le", "-"], binary=True)
    raw = proc.stdout or b""
    pcm = array("h")
    pcm.frombytes(raw[: len(raw) // 6 * 6])
    if sys.byteorder == "big":
        pcm.byteswap()
    hop = PCM_RATE // ENV_RATE
    step = hop * 3                                          # 3 interleaved channels
    full, low, high = [], [], []
    for i in range(0, len(pcm) - step + 1, step):
        frame = pcm[i:i + step]
        full.append(sum(map(abs, frame[0::3])) / hop)
        low.append(sum(map(abs, frame[1::3])) / hop)
        high.append(sum(map(abs, frame[2::3])) / hop)

    def rises(env: List[float]) -> List[float]:
        logs = [math.log(e + 1.0) for e in env]
        return [0.0] + [max(0.0, logs[k] - logs[k - 1]) for k in range(1, len(logs))]

    low_onset = rises(low)
    onset = [x + y for x, y in zip(low_onset, rises(high))]
    return full, onset, low_onset


def _db(amplitude: float) -> float:
    return 20.0 * math.log10(amplitude / 32768.0 + 1e-9)


def _energy_shape(env: List[float], lead: float, sound_end: float) -> Optional[Tuple[float, float, float]]:
    """
    Body level plus how long the outro fades and the intro builds, in seconds.
    "Full level" means within 6 dB of the song's typical (median) loudness.
    """
    size = ENV_RATE // 2                                   # 0.5 s windows
    win = [_db(sum(env[i:i + size]) / size) for i in range(0, len(env) - size + 1, size)]
    wsec = size / ENV_RATE
    a, b = int(lead / wsec), min(len(win), int(sound_end / wsec))
    body = win[a:b]
    if len(body) < 20:
        return None
    core = sorted(body[len(body) // 6: len(body) - len(body) // 6])
    body_db = core[len(core) // 2]
    full = body_db - 6.0

    i = b - 1
    while i > a and win[i] < full:
        i -= 1
    outro_fade = max(0.0, sound_end - (i + 1) * wsec)

    j = a
    while j < b and win[j] < full:
        j += 1
    intro_rise = max(0.0, j * wsec - lead)
    return body_db, outro_fade, intro_rise


def _tempo(onset_env: List[float], lead: float, sound_end: float) -> Tuple[Optional[float], float]:
    """
    BPM from the onset-strength autocorrelation. Each candidate beat period is scored with its
    multiples too (a real beat repeats at 2x, 3x and 4x its period; a 3:4 "triplet" impostor
    does not), then weighted towards ~120 BPM to settle half/double ambiguity.
    Returns (bpm, confidence 0..1).
    """
    start = int(max(lead, sound_end * 0.2) * ENV_RATE)
    seg = onset_env[start:start + 45 * ENV_RATE]
    if len(seg) < 12 * ENV_RATE:
        return None, 0.0
    mean = sum(seg) / len(seg)
    o = [x - mean for x in seg]
    energy = sum(x * x for x in o)
    if energy <= 0:
        return None, 0.0

    lo, hi = int(ENV_RATE * 60 / 200), int(ENV_RATE * 60 / 55)   # 200 .. 55 BPM
    ac: Dict[int, float] = {}

    def corr(lag: int) -> float:
        if lag not in ac:
            ac[lag] = sum(x * y for x, y in zip(o, o[lag:])) / energy if lag < len(o) else 0.0
        return ac[lag]

    weighted = {}
    for lag in range(lo, hi + 1):
        comb = corr(lag) + 0.5 * corr(2 * lag) + 0.33 * corr(3 * lag) + 0.25 * corr(4 * lag)
        bpm = 60.0 * ENV_RATE / lag
        weighted[lag] = comb * math.exp(-0.5 * (math.log2(bpm / 120.0) / 1.0) ** 2)
    best = max(weighted, key=weighted.get)
    shift = 0.0
    if lo < best < hi:                                   # parabolic peak refinement
        y0, y1, y2 = corr(best - 1), corr(best), corr(best + 1)
        denom = y0 - 2 * y1 + y2
        if denom:
            shift = max(-0.5, min(0.5, 0.5 * (y0 - y2) / denom))
    return round(60.0 * ENV_RATE / (best + shift), 1), round(max(0.0, corr(best)), 3)


def _phase_fit(env: List[float], period: float, f0: int, f1: int) -> Tuple[float, int]:
    """(score, phase): the offset of a grid with this period whose beats collect the most onset energy."""
    best = (-1.0, 0)
    for phase in range(int(period)):
        score, k = 0.0, 0
        while True:
            idx = int(round(f0 + phase + k * period))
            if idx > f1:
                break
            score += max(env[idx - 1:idx + 2])    # +-10 ms tolerance
            k += 1
        best = max(best, (score, phase))
    return best


def _refine_bpm(onset: List[float], bpm: float, t_from: float, t_to: float) -> float:
    """
    The autocorrelation tempo is only accurate to a few tenths of a percent, which drifts audibly across
    a beat-matched blend. Refine it (+-0.5%) to the period whose grid best explains the onsets over a long
    stretch of the song: short windows latch onto off-beats, long ones average them out.
    """
    period = 60.0 * ENV_RATE / bpm
    f0, f1 = max(1, int(t_from * ENV_RATE)), min(len(onset) - 2, int(t_to * ENV_RATE))
    if f1 - f0 < 32 * period:
        return bpm
    for step, span in ((0.001, 5), (0.00025, 4)):          # coarse, then fine
        candidates = [period * (1 + d * step) for d in range(-span, span + 1)]
        period = max(candidates, key=lambda p: _phase_fit(onset, p, f0, f1)[0])
    return 60.0 * ENV_RATE / period


def _beat_grid(onset: List[float], low_onset: List[float], bpm: float,
               t_from: float, t_to: float) -> Tuple[List[float], List[float], float]:
    """
    Beat times (s) between t_from and t_to at the given tempo, phase-locked to the strongest onsets,
    plus the downbeats (the one beat in four whose kicks hit hardest) and the grid's quality: onset
    energy on the beats relative to the window's average (around 1 = no clear beat, 2+ = a steady pulse).
    Transitions use these so a song finishes on its last downbeat and the next one locks onto its grid.
    """
    period = 60.0 * ENV_RATE / bpm
    f0, f1 = max(1, int(t_from * ENV_RATE)), min(len(onset) - 2, int(t_to * ENV_RATE))
    if f1 - f0 < 4 * period:
        return [], [], 0.0
    _, phase = _phase_fit(onset, period, f0, f1)
    frames = []
    while True:
        exact = f0 + phase + len(frames) * period
        if exact > f1:
            break
        frames.append(exact)

    def strength(env: List[float], exact: float) -> float:
        idx = int(round(exact))
        return max(env[idx - 1:idx + 2])

    bar = max(range(4), key=lambda m: sum(strength(low_onset, f) for i, f in enumerate(frames) if i % 4 == m))
    window_mean = sum(onset[f0:f1 + 1]) / (f1 - f0 + 1)
    on_beat = sum(strength(onset, f) for f in frames) / len(frames)
    quality = on_beat / window_mean if window_mean > 0 else 0.0
    beats = [round(f / ENV_RATE, 3) for f in frames]
    return beats, [b for i, b in enumerate(beats) if i % 4 == bar], round(quality, 2)


def analyze(path: str, ffmpeg_bin: Optional[str]) -> Optional[dict]:
    """Full analysis for one audio file, or None if ffmpeg is unavailable or the file is unreadable."""
    if not ffmpeg_bin:
        return None
    try:
        key = f"{path}|{os.path.getmtime(path)}|{os.path.getsize(path)}"
    except OSError:
        return None
    with _locks_guard:
        if key in _cache:
            return _cache[key]
        lock = _key_locks.setdefault(key, Lock())
    with lock:  # the same file is often requested twice (as "current" and as "next")
        if key in _cache:
            return _cache[key]
        try:
            res = _silence_and_loudness(ffmpeg_bin, path)
            if res is None:
                return None
            sound_end = res["duration"] - res["trail"]
            res.update(bpm=None, bpm_confidence=0.0, outro_fade=0.0, intro_rise=0.0,
                       outro_beats=[], outro_downbeats=[], outro_grid=0.0,
                       first_beat=None, first_downbeat=None, intro_grid=0.0)
            if res["duration"] <= MAX_ENVELOPE_SECONDS:
                env, onset, low_onset = _envelopes(ffmpeg_bin, path)
                shape = _energy_shape(env, res["lead"], sound_end)
                if shape:
                    _, outro_fade, intro_rise = shape
                    res.update(outro_fade=round(outro_fade, 1), intro_rise=round(intro_rise, 1))
                bpm, conf = _tempo(onset, res["lead"], sound_end)
                if bpm:
                    bpm = round(_refine_bpm(onset, bpm, max(res["lead"], sound_end * 0.15), sound_end), 2)
                res.update(bpm=bpm, bpm_confidence=conf)
                if bpm:
                    out_beats, out_downs, out_grid = _beat_grid(onset, low_onset, bpm, sound_end - 24, sound_end)
                    in_beats, in_downs, in_grid = _beat_grid(onset, low_onset, bpm, res["lead"], res["lead"] + 16)
                    res.update(outro_beats=out_beats, outro_downbeats=out_downs, outro_grid=out_grid,
                               first_beat=in_beats[0] if in_beats else None,
                               first_downbeat=in_downs[0] if in_downs else None, intro_grid=in_grid)
        except Exception:
            return None
        with _locks_guard:
            _cache[key] = res
            _key_locks.pop(key, None)
        return res
