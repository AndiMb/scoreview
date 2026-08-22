"""ScoreView sidecar HTTP API (Phase 3).

Wraps the spike-validated `xvfb-run` + `timeout` + `mscore4portable`
invocation (see spike/ and entrypoint.sh) behind a small async job API, and
parses the .spos timing export to JSON itself - the PHP side only caches
and proxies bytes, it never re-implements this parsing (see plan Phase 3).

Only .spos is produced. .mpos was tested and dropped in the Phase-1 spike:
it does not correspond 1:1 to OSMD's cursor steps and was structurally too
coarse to drive a note-level notation cursor (see sidecar/README.md).
"""

import json
import os
import secrets
import subprocess
import threading
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

app = Flask(__name__)

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


def run_mscore(input_path: Path, output_path: Path):
    # Mirrors entrypoint.sh exactly (see Phase 1 spike): xvfb-run because
    # mscore4portable needs an X server even for pure CLI conversion, timeout
    # as a hard guard against MuseScore hanging on unusual input (Risiko 6).
    cmd = [
        "timeout", "--signal=KILL", TIMEOUT_SECONDS,
        "xvfb-run", "-a", "-s",
        "-screen 0 640x480x24 -ac +extension GLX +render -noreset",
        MSCORE_BIN, str(input_path), "-o", str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"mscore4portable exited {result.returncode} producing "
            f"{output_path.name}: {result.stderr[-2000:]}"
        )


def parse_spos_to_timing(spos_path: Path, timing_path: Path):
    tree = ET.parse(spos_path)
    events_el = tree.getroot().find("events")
    events = sorted(
        (
            {"elid": int(el.get("elid")), "timeMs": int(el.get("position"))}
            for el in events_el.findall("event")
        ),
        key=lambda e: e["timeMs"],
    )
    timing_path.write_text(json.dumps({"events": events}), encoding="utf-8")


def run_conversion(job_id: str, input_path: Path, workdir: Path):
    try:
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "processing"

        musicxml_path = workdir / "score.musicxml"
        audio_path = workdir / "audio.mp3"
        spos_path = workdir / "score.spos"
        timing_path = workdir / "timing.json"

        # One mscore invocation per format - MuseScore 4 does not reliably
        # honour multiple `-o` flags in a single call (see sidecar/README.md).
        run_mscore(input_path, musicxml_path)
        run_mscore(input_path, audio_path)
        run_mscore(input_path, spos_path)
        parse_spos_to_timing(spos_path, timing_path)

        with JOBS_LOCK:
            JOBS[job_id].update(
                status="ready",
                files={
                    "musicxml": musicxml_path,
                    "audio": audio_path,
                    "timingJson": timing_path,
                },
            )
    except Exception as exc:  # noqa: BLE001 - reported via the status API, not re-raised
        with JOBS_LOCK:
            JOBS[job_id].update(status="error", error=str(exc))


@app.get("/health")
def health():
    return "ok"


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
        JOBS[job_id] = {"status": "pending"}

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
        body["files"] = {
            "musicxml": f"/convert/{job_id}/musicxml",
            "audio": f"/convert/{job_id}/audio",
            "timingJson": f"/convert/{job_id}/timing",
        }
    elif job["status"] == "error":
        body["error"] = job.get("error", "unknown error")
    return jsonify(body)


def _send_job_file(job_id: str, key: str, mimetype: str):
    require_secret()
    job = JOBS.get(job_id)
    if job is None or job.get("status") != "ready":
        abort(404)
    return send_file(job["files"][key], mimetype=mimetype)


@app.get("/convert/<job_id>/musicxml")
def convert_musicxml(job_id):
    return _send_job_file(job_id, "musicxml", "application/vnd.recordare.musicxml+xml")


@app.get("/convert/<job_id>/audio")
def convert_audio(job_id):
    return _send_job_file(job_id, "audio", "audio/mpeg")


@app.get("/convert/<job_id>/timing")
def convert_timing(job_id):
    return _send_job_file(job_id, "timingJson", "application/json")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    # threaded=True: /convert/<id> polling must not block behind an
    # in-flight conversion running in its own background thread.
    app.run(host="0.0.0.0", port=port, threaded=True)
