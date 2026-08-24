"""In-memory job registry, the conversion worker, and the reaper thread.

Deliberately not persisted: this service is a stateless-ish converter behind
ConversionService's own durable IAppData cache. If the sidecar restarts
mid-job, the caller (PollConversionJob) sees a missing job and simply
re-submits - no job queue durability is needed.

**One process only.** Because the registry lives in memory, a poll request
must reach the same process that started the job. The container therefore
runs gunicorn with exactly one worker and several threads (see Dockerfile);
raising the worker count would make polling fail intermittently and
inexplicably - a job submitted to worker A would be unknown to worker B.
The number of *conversions* is bounded separately, by the semaphore below.
"""

import base64
import json
import shutil
import threading
import time
import uuid
from pathlib import Path

from . import config
from .musescore import parse_pos_xml, run_score_media

JOBS = {}
JOBS_LOCK = threading.Lock()

# Bounds how many MuseScore processes run at once (code review finding A5).
# Waiting submissions simply stay on "pending" - the PHP side polls anyway
# and needs no knowledge of the queue.
_CONVERSION_SLOTS = threading.BoundedSemaphore(config.MAX_CONCURRENT_CONVERSIONS)


def submit(uploaded_file) -> str:
    """Stores the upload and starts a conversion thread. Returns the job id."""
    job_id = uuid.uuid4().hex
    workdir = config.JOBS_DIR / job_id
    workdir.mkdir(parents=True)
    input_path = workdir / "input.mscz"
    uploaded_file.save(input_path)

    with JOBS_LOCK:
        JOBS[job_id] = {"status": "pending", "completedAt": None}

    threading.Thread(
        target=run_conversion, args=(job_id, input_path, workdir), daemon=True
    ).start()
    return job_id


def get(job_id: str):
    return JOBS.get(job_id)


def run_conversion(job_id: str, input_path: Path, workdir: Path):
    # Wait for a free slot BEFORE marking the job as processing: while it
    # waits it is honestly still "pending", which is exactly what the caller
    # should see.
    with _CONVERSION_SLOTS:
        _convert(job_id, input_path, workdir)


def _convert(job_id: str, input_path: Path, workdir: Path):
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

        timing_path = workdir / "timing.json"
        timing_path.write_text(json.dumps(parse_pos_xml(media["sposXML"])), encoding="utf-8")

        measures_path = workdir / "measures.json"
        measures_path.write_text(json.dumps(parse_pos_xml(media["mposXML"])), encoding="utf-8")

        meta_path = workdir / "meta.json"
        meta_path.write_text(json.dumps(media.get("metadata") or {}), encoding="utf-8")

        # pngs/pdf/mxml are present in `media` but intentionally never
        # written to disk - see docs/architecture.md M2.

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
        time.sleep(config.REAPER_INTERVAL_SECONDS)
        reap_once()


def reap_once() -> list[str]:
    """One reaper pass - separated from the loop so it can be tested."""
    now = time.monotonic()
    with JOBS_LOCK:
        expired = [
            job_id for job_id, job in JOBS.items()
            if job.get("completedAt") is not None and now - job["completedAt"] > config.JOB_TTL_SECONDS
        ]
        for job_id in expired:
            del JOBS[job_id]
    for job_id in expired:
        shutil.rmtree(config.JOBS_DIR / job_id, ignore_errors=True)
    return expired


def start_reaper() -> threading.Thread:
    thread = threading.Thread(target=reap_expired_jobs, daemon=True)
    thread.start()
    return thread
