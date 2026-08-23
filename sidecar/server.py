"""ScoreView sidecar HTTP API (Phase 6: single `--score-media` call).

Wraps ONE `xvfb-run` + `timeout` + `mscore4portable … --score-media`
invocation (see PLAN.md Phase 6, M1-M4) behind a small async job API. All
media parsing (base64 decoding, coordinate scaling, spos/mpos -> JSON)
happens here - the PHP side only caches and proxies bytes, it never
re-implements this parsing (see PLAN.md Abschnitt 2, "Leitprinzip").

Previously (Phase 3) this ran three separate `mscore4portable` invocations
(-o score.musicxml / audio.mp3 / score.spos) because MuseScore 4 does not
reliably honour multiple `-o` flags in one call. `--score-media` sidesteps
that entirely: one process, one JSON blob on stdout containing every
artifact MuseScore can produce for the score (see M2). We keep svgs, midi,
sposXML, mposXML and metadata; pngs/pdf/mxml are decoded only to be
discarded (see PLAN.md "Was ersatzlos entfaellt").
"""

import base64
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file

APP_SECRET = os.environ.get("SCOREVIEW_SIDECAR_SECRET")
if not APP_SECRET:
    raise RuntimeError(
        "SCOREVIEW_SIDECAR_SECRET must be set - refusing to start an "
        "unauthenticated conversion service."
    )

MSCORE_BIN = "/opt/musescore/bin/mscore4portable"
TIMEOUT_SECONDS = os.environ.get("MSCORE_TIMEOUT_SECONDS", "120")
JOBS_DIR = Path(os.environ.get("SCOREVIEW_JOBS_DIR", "/tmp/scoreview-jobs"))
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# Guards against a pathological/malicious upload tying up the conversion
# process; a legitimate .mscz (even a large orchestral score) is far below
# this. Overridable per deployment.
MAX_UPLOAD_BYTES = int(os.environ.get("SCOREVIEW_MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))

# How long a finished (ready/error) job's files stay on disk after
# completion before the reaper thread deletes them. The caller
# (ConvertScoreJob on the PHP side) fetches all files immediately after
# seeing "ready", so this is a safety net against unbounded growth
# (previously JOBS_DIR/JOBS grew forever - see PLAN.md Phase 6), not the
# primary handoff mechanism.
JOB_TTL_SECONDS = int(os.environ.get("SCOREVIEW_JOB_TTL_SECONDS", "600"))
REAPER_INTERVAL_SECONDS = 30

# `--score-media` coordinates are 12x the SVG viewBox units (M4, measured
# against real output: viewBox "0 0 10200 13200" vs. spos coordinates in
# the 15000-112000 range, division by 12 lands exactly on SVG note
# positions). Converting once here means the client never has to know
# this constant exists (PLAN.md Phase 6: "Der Client soll keine
# Umrechnung kennen muessen").
SPOS_TO_SVG_SCALE = 12

# Phase 9/E1: the browser synthesizes the MIDI itself and needs a SoundFont
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


def _resolve_soundfont():
    configured = os.environ.get("SCOREVIEW_SOUNDFONT_PATH", "").strip()
    for candidate in ([configured] if configured else SOUNDFONT_CANDIDATES):
        path = Path(candidate)
        if path.is_file():
            return path
    return None


SOUNDFONT_PATH = _resolve_soundfont()

# Content hash of the SoundFont, computed lazily on first request (~0.1 s
# for 40 MB) and then cached for the process lifetime. The PHP side stores
# it alongside its cached copy and uses it as the HTTP ETag, so swapping the
# SoundFont in a new image invalidates every browser cache without anyone
# having to remember to.
_SOUNDFONT_VERSION = None
_SOUNDFONT_VERSION_LOCK = threading.Lock()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

# In-memory job registry. Deliberately not persisted: this service is a
# stateless-ish converter behind ConversionService's own durable IAppData
# cache. If the sidecar restarts mid-job, the caller (ConvertScoreJob) sees
# a missing/failed job and simply re-submits - no job queue durability is
# needed for the prototype.
JOBS = {}
JOBS_LOCK = threading.Lock()


def require_secret():
    provided = request.headers.get("X-ScoreView-Secret", "")
    if not secrets.compare_digest(provided, APP_SECRET):
        abort(401)


def run_score_media(input_path: Path) -> dict:
    # Mirrors entrypoint.sh (Phase 1 spike): xvfb-run because
    # mscore4portable needs an X server even for pure CLI conversion,
    # timeout as a hard guard against MuseScore hanging on unusual input
    # (Risiko "MuseScore-Sicherheitsluecke ueber praeparierte .mscz").
    cmd = [
        "timeout", "--signal=KILL", TIMEOUT_SECONDS,
        "xvfb-run", "-a", "-s",
        "-screen 0 640x480x24 -ac +extension GLX +render -noreset",
        MSCORE_BIN, str(input_path), "--score-media",
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"mscore4portable --score-media exited {result.returncode}: "
            f"{result.stderr[-2000:].decode('utf-8', 'replace')}"
        )

    # M3: MuseScore writes ~12 lines of Qt log noise (locale warning, DBus
    # errors) to stdout BEFORE the JSON payload - a naive json.loads(stdout)
    # fails. The JSON always starts at the first "\n{\n" (known MuseScore
    # behaviour, issue #13304) - this must not work "by accident", so we
    # fail loudly if that marker is missing instead of silently returning
    # nothing.
    stdout = result.stdout
    marker = stdout.find(b"\n{\n")
    if marker == -1:
        raise RuntimeError(
            "mscore4portable --score-media produced no recognizable JSON "
            "payload on stdout (missing '\\n{\\n' marker) - output format "
            "may have changed."
        )
    try:
        return json.loads(stdout[marker + 1:])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"mscore4portable --score-media stdout was not valid JSON: {exc}") from exc


def _parse_pos_xml(pos_xml_b64: str) -> dict:
    """Parses a base64-encoded spos/mpos XML blob into
    {"events": [{"elid", "timeMs"}], "elements": {"<elid>": {"page","x","y","w","h"}}}.

    Coordinates are scaled from --score-media units into SVG units once
    here (see SPOS_TO_SVG_SCALE / M4). Kept as one shared helper for both
    sposXML (-> timing.json) and mposXML (-> measures.json): both files
    have the identical `<score><elements>/<events></score>` shape (M7).
    """
    xml_text = base64.b64decode(pos_xml_b64).decode("utf-8")
    root = ET.fromstring(xml_text)

    elements = {}
    elements_el = root.find("elements")
    if elements_el is not None:
        for el in elements_el.findall("element"):
            elements[el.get("id")] = {
                "page": int(el.get("page")),
                "x": round(float(el.get("x")) / SPOS_TO_SVG_SCALE, 2),
                "y": round(float(el.get("y")) / SPOS_TO_SVG_SCALE, 2),
                "w": round(float(el.get("sx")) / SPOS_TO_SVG_SCALE, 2),
                "h": round(float(el.get("sy")) / SPOS_TO_SVG_SCALE, 2),
            }

    events = []
    events_el = root.find("events")
    if events_el is not None:
        events = sorted(
            (
                {"elid": int(e.get("elid")), "timeMs": int(e.get("position"))}
                for e in events_el.findall("event")
            ),
            key=lambda e: e["timeMs"],
        )

    return {"events": events, "elements": elements}


def run_conversion(job_id: str, input_path: Path, workdir: Path):
    try:
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "processing"

        media = run_score_media(input_path)

        svgs_b64 = media.get("svgs") or []
        if not svgs_b64:
            raise RuntimeError("mscore4portable --score-media returned no SVG pages.")

        page_files = []
        for i, svg_b64 in enumerate(svgs_b64):
            page_path = workdir / f"page-{i + 1}.svg"
            page_path.write_bytes(base64.b64decode(svg_b64))
            page_files.append(page_path)

        midi_path = workdir / "score.mid"
        midi_path.write_bytes(base64.b64decode(media["midi"]))

        timing = _parse_pos_xml(media["sposXML"])
        timing_path = workdir / "timing.json"
        timing_path.write_text(json.dumps(timing), encoding="utf-8")

        measures = _parse_pos_xml(media["mposXML"])
        measures_path = workdir / "measures.json"
        measures_path.write_text(json.dumps(measures), encoding="utf-8")

        meta_path = workdir / "meta.json"
        meta_path.write_text(json.dumps(media.get("metadata") or {}), encoding="utf-8")

        # pngs/pdf/mxml are present in `media` but intentionally never
        # written to disk - see PLAN.md "Was ersatzlos entfaellt" (E1/E2).

        with JOBS_LOCK:
            JOBS[job_id].update(
                status="ready",
                completedAt=time.monotonic(),
                files={
                    "pages": page_files,
                    "midi": midi_path,
                    "timingJson": timing_path,
                    "measuresJson": measures_path,
                    "metaJson": meta_path,
                },
            )
    except Exception as exc:  # noqa: BLE001 - reported via the status API, not re-raised
        with JOBS_LOCK:
            JOBS[job_id].update(status="error", error=str(exc), completedAt=time.monotonic())


def reap_expired_jobs():
    while True:
        time.sleep(REAPER_INTERVAL_SECONDS)
        now = time.monotonic()
        with JOBS_LOCK:
            expired = [
                job_id for job_id, job in JOBS.items()
                if job.get("completedAt") is not None and now - job["completedAt"] > JOB_TTL_SECONDS
            ]
            for job_id in expired:
                del JOBS[job_id]
        for job_id in expired:
            shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)


def soundfont_version() -> str:
    global _SOUNDFONT_VERSION
    with _SOUNDFONT_VERSION_LOCK:
        if _SOUNDFONT_VERSION is None:
            digest = hashlib.sha256()
            with SOUNDFONT_PATH.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                    digest.update(chunk)
            _SOUNDFONT_VERSION = digest.hexdigest()
    return _SOUNDFONT_VERSION


@app.get("/health")
def health():
    return "ok"


@app.get("/soundfont/info")
def soundfont_info():
    """Cheap availability/version probe so the PHP side can decide whether
    its cached copy is still current without pulling 40 MB every time."""
    require_secret()
    if SOUNDFONT_PATH is None:
        return jsonify({"available": False}), 200
    return jsonify({
        "available": True,
        "name": SOUNDFONT_PATH.name,
        "size": SOUNDFONT_PATH.stat().st_size,
        "version": soundfont_version(),
    })


@app.get("/soundfont")
def soundfont():
    require_secret()
    if SOUNDFONT_PATH is None:
        abort(404, "no SoundFont available in this image (set SCOREVIEW_SOUNDFONT_PATH)")
    return send_file(SOUNDFONT_PATH, mimetype="application/octet-stream")


@app.post("/convert")
def convert():
    require_secret()
    uploaded = request.files.get("file")
    if uploaded is None or uploaded.filename == "":
        abort(400, "multipart field 'file' with the .mscz upload is required")

    job_id = uuid.uuid4().hex
    workdir = JOBS_DIR / job_id
    workdir.mkdir(parents=True)
    input_path = workdir / "input.mscz"
    uploaded.save(input_path)

    with JOBS_LOCK:
        JOBS[job_id] = {"status": "pending", "completedAt": None}

    threading.Thread(
        target=run_conversion, args=(job_id, input_path, workdir), daemon=True
    ).start()

    return jsonify({"jobId": job_id}), 202


@app.get("/convert/<job_id>")
def convert_status(job_id):
    require_secret()
    job = JOBS.get(job_id)
    if job is None:
        abort(404)

    body = {"status": job["status"]}
    if job["status"] == "ready":
        page_count = len(job["files"]["pages"])
        body["files"] = {
            "pages": [f"/convert/{job_id}/page/{n}" for n in range(1, page_count + 1)],
            "midi": f"/convert/{job_id}/midi",
            "timingJson": f"/convert/{job_id}/timing",
            "measuresJson": f"/convert/{job_id}/measures",
            "metaJson": f"/convert/{job_id}/meta",
        }
    elif job["status"] == "error":
        body["error"] = job.get("error", "unknown error")
    return jsonify(body)


@app.get("/convert/<job_id>/page/<int:page_number>")
def convert_page(job_id, page_number):
    require_secret()
    job = JOBS.get(job_id)
    if job is None or job.get("status") != "ready":
        abort(404)
    pages = job["files"]["pages"]
    if page_number < 1 or page_number > len(pages):
        abort(404)
    return send_file(pages[page_number - 1], mimetype="image/svg+xml")


@app.get("/convert/<job_id>/midi")
def convert_midi(job_id):
    require_secret()
    job = JOBS.get(job_id)
    if job is None or job.get("status") != "ready":
        abort(404)
    return send_file(job["files"]["midi"], mimetype="audio/midi")


@app.get("/convert/<job_id>/timing")
def convert_timing(job_id):
    require_secret()
    job = JOBS.get(job_id)
    if job is None or job.get("status") != "ready":
        abort(404)
    return send_file(job["files"]["timingJson"], mimetype="application/json")


@app.get("/convert/<job_id>/measures")
def convert_measures(job_id):
    require_secret()
    job = JOBS.get(job_id)
    if job is None or job.get("status") != "ready":
        abort(404)
    return send_file(job["files"]["measuresJson"], mimetype="application/json")


@app.get("/convert/<job_id>/meta")
def convert_meta(job_id):
    require_secret()
    job = JOBS.get(job_id)
    if job is None or job.get("status") != "ready":
        abort(404)
    return send_file(job["files"]["metaJson"], mimetype="application/json")


threading.Thread(target=reap_expired_jobs, daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    # threaded=True: /convert/<id> polling must not block behind an
    # in-flight conversion running in its own background thread.
    app.run(host="0.0.0.0", port=port, threaded=True)
