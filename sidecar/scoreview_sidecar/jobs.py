"""In-memory job registry, the conversion workers, and the reaper thread.

Deliberately not persisted: this service is a stateless-ish converter behind
ConversionService's own durable IAppData cache. If the sidecar restarts
mid-job, the caller (PollConversionJob) sees a missing job and simply
re-submits - no job queue durability is needed.

**One process only.** Because the registry lives in memory, a poll request
must reach the same process that started the job. The container therefore
runs gunicorn with exactly one worker and several threads (see Dockerfile);
raising the worker count would make polling fail intermittently and
inexplicably - a job submitted to worker A would be unknown to worker B.

Zwei getrennte Grenzen:

* **Konvertierungsplaetze** (SCOREVIEW_MAX_CONCURRENT): wie viele
  MuseScore-Prozesse gleichzeitig laufen. Jeder Platz traegt eine feste
  Xvfb-Displaynummer (siehe musescore.run_score_media). Auch /selftest
  nimmt sich einen solchen Platz, sonst liefe er an der Grenze vorbei.
* **Warteplaetze** (SCOREVIEW_MAX_QUEUED): wie viele Auftraege auf einen
  Konvertierungsplatz warten duerfen. Darueber lehnt ``submit`` ab, bevor
  der Upload gespeichert wird.

Wartende Auftraege haben keinen eigenen Thread: eine feste Zahl Worker holt
Auftrags-IDs aus einer Warteschlange. Vorher wartete je Upload ein Thread am
Semaphor - Threads und Upload-Dateien wuchsen mit jedem Einreichen.
"""

import base64
import contextlib
import json
import logging
import queue
import shutil
import threading
import time
import uuid
from pathlib import Path

from . import config
from .musescore import parse_pos_xml, run_score_media

_LOG = logging.getLogger(__name__)

JOBS = {}
JOBS_LOCK = threading.Lock()


class QueueFull(Exception):
    """Alle Warteplaetze belegt - der Aufrufer soll spaeter wiederkommen."""


class NoSlotAvailable(Exception):
    """Innerhalb der Wartezeit wurde kein Konvertierungsplatz frei."""


# Freie Konvertierungsplaetze, jeder als seine Xvfb-Displaynummer. Eine
# Queue statt eines Semaphors, weil der Platz eine Identitaet braucht: zwei
# gleichzeitige Laeufe duerfen nie dieselbe Displaynummer bekommen.
_FREE_SLOTS = queue.Queue()
for _i in range(config.MAX_CONCURRENT_CONVERSIONS):
    _FREE_SLOTS.put(config.FIRST_DISPLAY_NUMBER + _i)

# Auftrags-IDs in Einreichungsreihenfolge. Unbegrenzt, weil die Grenze an
# der Registry haengt (Zahl der "pending"-Eintraege): das ist genau das,
# was der Aufrufer sieht, und ein vom Reaper verworfener Auftrag gibt
# seinen Warteplatz damit sofort frei - seine ID in dieser Queue kostet
# nichts mehr, der Worker ueberspringt sie.
_PENDING = queue.Queue()

_WORKERS_LOCK = threading.Lock()
_WORKERS_STARTED = False


@contextlib.contextmanager
def conversion_slot(timeout=None):
    """Haelt einen Konvertierungsplatz und liefert seine Displaynummer.

    `timeout` None wartet unbegrenzt; sonst NoSlotAvailable nach Ablauf."""
    try:
        display = _FREE_SLOTS.get(timeout=timeout)
    except queue.Empty:
        raise NoSlotAvailable(
            "alle Konvertierungsplaetze belegt - spaeter erneut versuchen"
        ) from None
    try:
        yield display
    finally:
        _FREE_SLOTS.put(display)


def _ensure_workers():
    # Erst beim ersten Einreichen statt beim Import: Tests, die nur die
    # Parser brauchen, sollen keine Threads starten (siehe tests/conftest.py).
    global _WORKERS_STARTED
    with _WORKERS_LOCK:
        if _WORKERS_STARTED:
            return
        for _ in range(config.MAX_CONCURRENT_CONVERSIONS):
            threading.Thread(target=_worker_loop, daemon=True).start()
        _WORKERS_STARTED = True


def _worker_loop():
    while True:
        job_id = _PENDING.get()
        try:
            run_conversion(job_id, config.JOBS_DIR / job_id / "input.mscz", config.JOBS_DIR / job_id)
        except Exception:  # noqa: BLE001 - ein Worker darf nie sterben
            # run_conversion faengt Konvertierungsfehler selbst; was hier
            # ankommt, ist ein Programmfehler. Den Worker zu verlieren waere
            # schlimmer: jeder verlorene Worker ist ein Platz weniger, bis
            # zum Stillstand ohne jede Fehlermeldung.
            _LOG.exception("Konvertierungs-Worker: unerwarteter Fehler bei Auftrag %s", job_id)


def submit(uploaded_file) -> str:
    """Reserviert einen Warteplatz, speichert den Upload und reiht ihn ein.

    Raises QueueFull, wenn alle Warteplaetze belegt sind - dann wird auch
    nichts gespeichert."""
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        waiting = sum(1 for job in JOBS.values() if job["status"] == "pending")
        if waiting >= config.MAX_QUEUED_JOBS:
            raise QueueFull(
                f"{waiting} Auftraege warten bereits (SCOREVIEW_MAX_QUEUED={config.MAX_QUEUED_JOBS})"
            )
        # Eintrag VOR dem Speichern: so zaehlt der Warteplatz schon, waehrend
        # die Datei noch geschrieben wird, und gleichzeitige Uploads koennen
        # die Grenze nicht gemeinsam ueberschreiten.
        JOBS[job_id] = {"status": "pending", "createdAt": time.monotonic(), "completedAt": None}

    workdir = config.JOBS_DIR / job_id
    try:
        workdir.mkdir(parents=True)
        uploaded_file.save(workdir / "input.mscz")
    except BaseException:
        with JOBS_LOCK:
            JOBS.pop(job_id, None)
        shutil.rmtree(workdir, ignore_errors=True)
        raise

    _ensure_workers()
    _PENDING.put(job_id)
    return job_id


def get(job_id: str):
    return JOBS.get(job_id)


def _update(job_id: str, **fields) -> bool:
    """Aktualisiert einen Auftrag; False, wenn der Reaper ihn inzwischen
    verworfen hat. Wer dann weiterarbeitet, arbeitet fuer niemanden."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return False
        job.update(fields)
        return True


def run_conversion(job_id: str, input_path: Path, workdir: Path):
    if get(job_id) is None:
        # Schon verworfen, bevor er drankam - dann auch keinen Platz belegen.
        shutil.rmtree(workdir, ignore_errors=True)
        return
    # Wait for a free slot BEFORE marking the job as processing: while it
    # waits it is honestly still "pending", which is exactly what the caller
    # should see.
    with conversion_slot() as display:
        if not _update(job_id, status="processing", startedAt=time.monotonic()):
            # Verworfen, waehrend er wartete: kein MuseScore-Lauf fuer ein
            # Ergebnis, das niemand mehr abholt.
            shutil.rmtree(workdir, ignore_errors=True)
            return
        _convert(job_id, input_path, workdir, display)


def _convert(job_id: str, input_path: Path, workdir: Path, display: int):
    try:
        media = run_score_media(input_path, display=display)

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

        # pngs/pdf/mxml never reach this point - run_score_media drops them
        # right after parsing (see docs/architecture.md M2).

        done = _update(
            job_id,
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
        done = _update(job_id, status="error", error=str(exc), completedAt=time.monotonic())
    if not done:
        # Vom Reaper waehrend des Laufs verworfen: das Verzeichnis gehoert
        # niemandem mehr, und der Reaper sieht es nicht wieder.
        shutil.rmtree(workdir, ignore_errors=True)


def reap_expired_jobs():
    while True:
        time.sleep(config.REAPER_INTERVAL_SECONDS)
        reap_once()


def _is_expired(job: dict, now: float) -> bool:
    if job.get("completedAt") is not None:
        return now - job["completedAt"] > config.JOB_TTL_SECONDS
    if job["status"] == "pending":
        return now - job.get("createdAt", now) > config.PENDING_MAX_AGE_SECONDS
    if job["status"] == "processing" and config.TIMEOUT_SECONDS_NUMERIC is not None:
        # Laeuft laenger, als `timeout` MuseScore ueberhaupt laesst - plus
        # JOB_TTL_SECONDS Luft fuer das Zerlegen der Ausgabe. Das kann nur
        # ein haengender Lauf sein. Ihn aus der Registry zu nehmen ist
        # sicher: der Thread merkt es an _update() und raeumt selbst auf.
        started = job.get("startedAt", now)
        return now - started > config.TIMEOUT_SECONDS_NUMERIC + config.JOB_TTL_SECONDS
    return False


def reap_once() -> list[str]:
    """One reaper pass - separated from the loop so it can be tested."""
    now = time.monotonic()
    with JOBS_LOCK:
        expired = [job_id for job_id, job in JOBS.items() if _is_expired(job, now)]
        for job_id in expired:
            del JOBS[job_id]
    for job_id in expired:
        shutil.rmtree(config.JOBS_DIR / job_id, ignore_errors=True)
    return expired


def start_reaper() -> threading.Thread:
    thread = threading.Thread(target=reap_expired_jobs, daemon=True)
    thread.start()
    return thread
