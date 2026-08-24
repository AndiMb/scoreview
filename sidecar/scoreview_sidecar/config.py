"""Configuration read from the environment, in one place.

Everything here is read exactly once at import time - a sidecar is
configured by its container, not at runtime.
"""

import os
from pathlib import Path

APP_SECRET = os.environ.get("SCOREVIEW_SIDECAR_SECRET")
if not APP_SECRET:
    raise RuntimeError(
        "SCOREVIEW_SIDECAR_SECRET must be set - refusing to start an "
        "unauthenticated conversion service."
    )

MSCORE_BIN = "/opt/musescore/bin/mscore4portable"

# Measured on real conversions: ~5.4s per rendered page plus ~1s startup
# (1/4/5-page scores took 6.3s/23.0s/27.7s on the test machine). A timeout
# too close to that rate would fail the orchestral scores (30+ pages) the
# app is meant to handle, as an opaque "timeout" error. 600s covers ~110
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
# Without a limit, every POST /convert would immediately spawn a thread with
# its own mscore4portable plus Xvfb, and `run_score_media` additionally
# buffers the complete `--score-media` output in memory - measured at 16 MB
# of JSON for a five-page score, correspondingly more for the orchestral
# scores the 600s timeout accounts for. Twenty scores opened at once would
# be enough to put the container under memory pressure, and nothing on the
# PHP side throttles either.
#
# Default 2: conversion is CPU- and memory-bound, so more parallelism buys
# little, and waiting jobs simply stay "pending" - the PHP side polls anyway
# and does not need to know (see jobs.py).
MAX_CONCURRENT_CONVERSIONS = int(os.environ.get("SCOREVIEW_MAX_CONCURRENT", "2"))

# `--score-media` coordinates are 12x the SVG viewBox units (M4, measured
# against real output: viewBox "0 0 10200 13200" vs. spos coordinates in
# the 15000-112000 range, division by 12 lands exactly on SVG note
# positions). Converting once here means the client never has to know
# this constant exists (see docs/architecture.md M4: "Der Sidecar teilt
# bereits, der Client rechnet nicht um.").
SPOS_TO_SVG_SCALE = 12

# E1: the browser synthesizes the MIDI itself and needs a SoundFont
# to do it. This image already contains a General MIDI SoundFont (MuseScore
# cannot render audio without one), and the sidecar is a hard requirement
# anyway (E3) - so serving it from here means an operator does not have to
# find, license and host a 40 MB SF3 somewhere reachable by every browser
# just to get sound. The PHP side caches it once and re-serves it
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

# Mini score for the self-test.
SELFTEST_SCORE = Path("/opt/scoreview-sidecar/selftest-score.mscz")


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
