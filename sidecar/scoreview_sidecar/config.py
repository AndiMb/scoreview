"""Configuration read from the environment, in one place.

Everything here is read exactly once at import time - a sidecar is
configured by its container, not at runtime.
"""

import json
import os
import re
from pathlib import Path

APP_SECRET = os.environ.get("SCOREVIEW_SIDECAR_SECRET")
if not APP_SECRET:
    raise RuntimeError(
        "SCOREVIEW_SIDECAR_SECRET must be set - refusing to start an "
        "unauthenticated conversion service."
    )

MSCORE_BIN = "/opt/musescore/bin/mscore4portable"

# Two renderers in one image (docs/architecture.md E3): MuseScore itself
# (the AppImage, `--score-media`) and the scoreview-engine - the same
# converter the app runs on its local path, under the Node in the image.
# The engine writes what stock MuseScore cannot: segment ids in the SVG
# (M10), the score facts and lyric lists in meta.json (E12, E15), and the
# display variants (E19). MuseScore keeps the original music fonts of old
# scores and rasterises SVG images. The app names the renderer per job;
# this default applies to a request without one (an older app, a manual
# curl).
RENDERER_ENGINE = "engine"
RENDERER_MUSESCORE = "musescore"
RENDERERS = (RENDERER_ENGINE, RENDERER_MUSESCORE)
DEFAULT_RENDERER = os.environ.get("SCOREVIEW_SIDECAR_RENDERER", RENDERER_ENGINE).strip().lower()
if DEFAULT_RENDERER not in RENDERERS:
    raise RuntimeError(
        f"SCOREVIEW_SIDECAR_RENDERER must be one of {', '.join(RENDERERS)}, not {DEFAULT_RENDERER!r}."
    )

NODE_BIN = os.environ.get("SCOREVIEW_NODE_BIN", "/usr/local/bin/node")
CONVERTER_DIR = Path(os.environ.get("SCOREVIEW_CONVERTER_DIR", "/opt/scoreview-converter"))

# Measured on real conversions: ~6s per rendered page plus ~2s startup
# (linear fit over 1/4/5-page scores, see docs/limits.md). A timeout
# too close to that rate would fail the orchestral scores (30+ pages) the
# app is meant to handle, as an opaque "timeout" error. 600s covers ~100
# pages while still bounding a runaway/pathological process. See
# docs/limits.md.
TIMEOUT_SECONDS = os.environ.get("MSCORE_TIMEOUT_SECONDS", "600")

JOBS_DIR = Path(os.environ.get("SCOREVIEW_JOBS_DIR", "/tmp/scoreview-jobs"))
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# Guards against a pathological/malicious upload tying up the conversion
# process; a legitimate .mscz (even a large orchestral score) is far below
# this. The PHP side rejects earlier and with a clearer error code (see
# ConvertScoreJob, `max_score_bytes`) - this is the backstop for anything
# that reaches the sidecar by another route.
MAX_UPLOAD_BYTES = int(os.environ.get("SCOREVIEW_MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))

# How long a finished (ready/error) job's files stay on disk after
# completion before the reaper thread deletes them. The caller
# (PollConversionJob on the PHP side) fetches all files immediately after
# seeing "ready", so this is a safety net against unbounded growth, not the
# primary handoff mechanism.
JOB_TTL_SECONDS = int(os.environ.get("SCOREVIEW_JOB_TTL_SECONDS", "600"))
REAPER_INTERVAL_SECONDS = 30

# How many MuseScore processes may run at the same time.
#
# Without a limit, every POST /convert would immediately start its own
# mscore4portable plus Xvfb, and `run_score_media` additionally parses the
# complete `--score-media` output in memory - measured at 16 MB of JSON for
# a five-page score, correspondingly more for the orchestral scores the
# 600s timeout accounts for. Twenty scores opened at once would be enough
# to put the container under memory pressure, and nothing on the PHP side
# throttles either.
#
# Default 2: conversion is CPU- and memory-bound, so more parallelism buys
# little, and waiting jobs simply stay "pending" - the PHP side polls anyway
# and does not need to know (see jobs.py).
MAX_CONCURRENT_CONVERSIONS = int(os.environ.get("SCOREVIEW_MAX_CONCURRENT", "2"))

# Wie viele Auftraege hoechstens auf einen freien Konvertierungsplatz warten
# ("pending"). Darueber lehnt POST /convert mit 503 ab, statt den Upload
# anzunehmen: jeder wartende Auftrag belegt seine Upload-Datei in JOBS_DIR
# (bis MAX_UPLOAD_BYTES), und ohne Grenze liesse sich der Container allein
# durch Einreichen volllaufen lassen.
#
# Default 30, hergeleitet aus der Wartezeit der App: ConvertScoreJob gibt
# einen Auftrag 300 s nach dem Einreichen auf. Eine uebliche Chorpartitur
# (2-4 Seiten, ~6 s pro Seite) braucht ~20 s, bei zwei Plaetzen also ~10 s
# Durchsatz je Auftrag - nach rund 30 wartenden kaeme ein neuer ohnehin
# nicht mehr rechtzeitig dran. Mehr Warteplaetze erzeugten nur Arbeit, deren
# Ergebnis niemand mehr abholt. Mindestens 1, sonst wuerde jeder Auftrag
# abgelehnt: auch einer, der sofort drankaeme, ist kurz "pending".
MAX_QUEUED_JOBS = max(1, int(os.environ.get("SCOREVIEW_MAX_QUEUED", "30")))

# Retry-After der 503-Antwort bei voller Warteschlange. Grob die Zeit, in
# der bei zwei Plaetzen wieder einige Auftraege durch sind; eine Zusage ist
# das nicht, nur ein Richtwert fuer den Aufrufer.
QUEUE_FULL_RETRY_AFTER_SECONDS = 30

# Ab welchem Alter der Reaper einen noch wartenden Auftrag verwirft. Die App
# wartet hoechstens 300 s (ConvertScoreJob) und reicht danach neu ein; ein
# Auftrag, der eine Stunde lang nicht drankam, wird also von niemandem mehr
# abgefragt. Ohne diese Grenze liefe MuseScore dafuer spaeter trotzdem noch
# an und belegte einen Platz fuer ein Ergebnis ohne Abnehmer.
PENDING_MAX_AGE_SECONDS = int(os.environ.get("SCOREVIEW_PENDING_MAX_AGE_SECONDS", "3600"))


def _timeout_as_seconds(value: str):
    """MSCORE_TIMEOUT_SECONDS geht unveraendert an `timeout`, das auch
    Suffixe wie "10m" versteht. Fuer den Reaper wird die Zahl gebraucht;
    was sich nicht deuten laesst, ergibt None - dann raeumt der Reaper
    laufende Auftraege lieber gar nicht, als sie zu frueh zu verwerfen."""
    factors = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    text = value.strip().lower()
    factor = factors.get(text[-1:], None)
    if factor is not None:
        text = text[:-1]
    try:
        return float(text) * (factor or 1)
    except ValueError:
        return None


TIMEOUT_SECONDS_NUMERIC = _timeout_as_seconds(TIMEOUT_SECONDS)

# Displaynummern fuer Xvfb, eine feste je Konvertierungsplatz (siehe
# musescore.run_score_media). 99 ist xvfb-runs eigener Default; im Container
# laeuft sonst kein X-Server, Kollisionen gibt es also nicht.
FIRST_DISPLAY_NUMBER = 99

# How long POST /variant waits for a free conversion slot. The app engraves
# a variant inside a browser request (E19), so waiting long only moves the
# timeout there; past this the sidecar answers 503 and the viewer can ask
# again.
VARIANT_SLOT_WAIT_SECONDS = 20

# Wie lange /selftest auf einen freien Konvertierungsplatz wartet. Die
# PHP-Seite gibt dem ganzen Aufruf 120 s (SidecarClient::runSelfTest), die
# Konvertierung selbst braucht ~8 s - 60 s Warten lassen dafuer genug Luft.
SELFTEST_SLOT_WAIT_SECONDS = 60

# `--score-media` coordinates are 12x the SVG viewBox units (M4, measured
# against real output: viewBox "0 0 10200 13200" vs. spos coordinates in
# the 15000-112000 range, division by 12 lands exactly on SVG note
# positions). Converting once here means the client never has to know
# this constant exists (see docs/architecture.md M4: "Der Sidecar teilt
# bereits, der Client rechnet nicht um.").
SPOS_TO_SVG_SCALE = 12

# E1: the browser synthesizes the MIDI itself and needs a SoundFont
# to do it. This image already contains a General MIDI SoundFont (MuseScore
# cannot render audio without one) - so on the sidecar path, serving it from
# here means an operator does not have to find, license and host a 40 MB SF3
# somewhere reachable by every browser just to get sound. (The local path
# has no image to take it from and downloads one instead, see E1.) The PHP side caches it once and re-serves it
# same-origin (see Service\SoundFontService), which also keeps the fetch
# free of CORS and of a CSP connect-src exception.
#
# MuseScore_General_Lite.sf3 comes from the Debian package
# `musescore-general-soundfont-small` (MuseScore General by S. Christian
# Collins, MIT). It survives the `apt-get remove musescore` in the
# Dockerfile because it is a separate package that is not autoremoved.
# `MS Basic.sf3` from the extracted AppImage is deliberately NOT the
# default: it ships under MuseScore's own terms rather than a plain
# permissive license, so redistributing it to browsers is an operator
# decision, not ours. Point SCOREVIEW_SOUNDFONT_PATH at it (or at any other
# SF2/SF3) to override.
SOUNDFONT_CANDIDATES = (
    "/usr/share/sounds/sf3/MuseScore_General_Lite.sf3",
    "/usr/share/sounds/sf3/MuseScore_General.sf3",
    "/usr/share/sounds/sf3/default-GM.sf3",
)

# Mini score for the MuseScore self-test: the converter's own
# selftest-score.mscz (a copy of testdata/repeat-test.mscz), one file for
# both renderers. It covers repeats and voltas - the structure a format
# change in `--score-media` would break first (docs/architecture.md M7).
SELFTEST_SCORE = CONVERTER_DIR / "selftest-score.mscz"


def _resolve_soundfont():
    configured = os.environ.get("SCOREVIEW_SOUNDFONT_PATH", "").strip()
    for candidate in ([configured] if configured else SOUNDFONT_CANDIDATES):
        path = Path(candidate)
        if path.is_file():
            return path
    return None


SOUNDFONT_PATH = _resolve_soundfont()


def musescore_version() -> str:
    """Version of the MuseScore pinned in the image - for the admin display,
    so that an image change is visible without looking inside the container.

    Comes from a build-time ENV (see Dockerfile), NOT from
    `mscore4portable --version`: that call needs an X server and mixes Qt
    noise into its output, making it both slow and unreliable to parse
    (measured: without xvfb it returns nothing usable).
    """
    return os.environ.get("SCOREVIEW_MUSESCORE_VERSION", "unbekannt")


_ENGINE_TAG = re.compile(r"/download/v?([^/]+)/")


def engine_version() -> str:
    """Release tag of the scoreview-engine in the image, e.g.
    "4.7.5-engine.6" - read from the converter's package.json, the same one
    place the app reads it from (LocalConverter::engineVersion()). The
    app stores it with every display variant."""
    try:
        manifest = json.loads((CONVERTER_DIR / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "unknown"
    match = _ENGINE_TAG.search((manifest.get("dependencies") or {}).get("scoreview-engine", ""))
    return match.group(1) if match else "unknown"
