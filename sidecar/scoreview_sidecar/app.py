"""The HTTP surface: Flask routes and nothing else.

Everything that knows anything lives in ``config``, ``musescore`` and
``jobs``; this module only maps URLs onto it.

The secret check moved from twelve individual ``require_secret()`` calls to a
single ``before_request`` hook with an explicit allowlist. Before, adding a
route without the check was a pure oversight away - now it takes deliberately
adding the path to ``PUBLIC_PATHS``.
"""

import hashlib
import secrets
import shutil
import tempfile
import threading
import time
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file

from . import config, jobs
from .musescore import check_promises, run_score_media

# The only endpoint without a secret (see sidecar/README.md): it is what
# distinguishes "sidecar is running at all" from "secret is wrong" - exactly
# the distinction that is missing when debugging without log access.
PUBLIC_PATHS = frozenset({"/health"})

# Content hash of the SoundFont, computed lazily on first request (~0.1 s
# for 40 MB) and then cached for the process lifetime. The PHP side stores
# it alongside its cached copy and uses it as the HTTP ETag, so swapping the
# SoundFont in a new image invalidates every browser cache without anyone
# having to remember to.
_SOUNDFONT_VERSION = None
_SOUNDFONT_VERSION_LOCK = threading.Lock()


def soundfont_version() -> str:
    global _SOUNDFONT_VERSION
    with _SOUNDFONT_VERSION_LOCK:
        if _SOUNDFONT_VERSION is None:
            digest = hashlib.sha256()
            with config.SOUNDFONT_PATH.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                    digest.update(chunk)
            _SOUNDFONT_VERSION = digest.hexdigest()
    return _SOUNDFONT_VERSION


def _ready_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None or job.get("status") != "ready":
        abort(404)
    return job


def create_app(start_reaper: bool = True) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_BYTES

    @app.before_request
    def require_secret():
        if request.path in PUBLIC_PATHS:
            return None
        provided = request.headers.get("X-ScoreView-Secret", "")
        if not secrets.compare_digest(provided, config.APP_SECRET):
            abort(401)
        return None

    @app.get("/health")
    def health():
        return "ok"

    # "Wie kommt eine neue MuseScore-Version ins Image, ohne dass
    # --score-media unbemerkt bricht?" Der Selbsttest laesst eine echte
    # Konvertierung gegen die mitgelieferte Minipartitur laufen und prueft
    # das Ergebnis auf die Merkmale, an denen ein Formatwechsel zuerst
    # auffiele. Absichtlich KEIN Test beim Containerstart: das wuerde jeden
    # Start um ~6s verzoegern und einen an sich benutzbaren Sidecar bei
    # einem Teilproblem gar nicht erst hochkommen lassen.
    @app.get("/selftest")
    def selftest():
        if not config.SELFTEST_SCORE.exists():
            return jsonify({"ok": False, "error": f"Selbsttest-Partitur fehlt: {config.SELFTEST_SCORE}"})

        workdir = Path(tempfile.mkdtemp(prefix="scoreview-selftest-"))
        try:
            target = workdir / "selftest.mscz"
            shutil.copy(config.SELFTEST_SCORE, target)
            started = time.time()
            media = run_score_media(target)
            elapsed = time.time() - started

            problems, details = check_promises(media)
            return jsonify({
                "ok": not problems,
                "error": "; ".join(problems) if problems else None,
                "details": {
                    "musescoreVersion": config.musescore_version(),
                    "seconds": round(elapsed, 1),
                    **details,
                },
            })
        except Exception as exc:  # noqa: BLE001 - Selbsttest darf nie 500en
            # Bewusst 200 mit ok:false statt 5xx: ein 5xx waere fuer die
            # PHP-Seite von "Sidecar nicht erreichbar" nicht zu unterscheiden -
            # dieselbe Ueberlegung wie bei /soundfont/info.
            return jsonify({"ok": False, "error": str(exc)})
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    @app.get("/soundfont/info")
    def soundfont_info():
        """Cheap availability/version probe so the PHP side can decide whether
        its cached copy is still current without pulling 40 MB every time."""
        if config.SOUNDFONT_PATH is None:
            return jsonify({"available": False}), 200
        return jsonify({
            "available": True,
            "name": config.SOUNDFONT_PATH.name,
            "size": config.SOUNDFONT_PATH.stat().st_size,
            "version": soundfont_version(),
        })

    @app.get("/soundfont")
    def soundfont():
        if config.SOUNDFONT_PATH is None:
            abort(404, "no SoundFont available in this image (set SCOREVIEW_SOUNDFONT_PATH)")
        return send_file(config.SOUNDFONT_PATH, mimetype="application/octet-stream")

    @app.post("/convert")
    def convert():
        uploaded = request.files.get("file")
        if uploaded is None or uploaded.filename == "":
            abort(400, "multipart field 'file' with the .mscz upload is required")
        return jsonify({"jobId": jobs.submit(uploaded)}), 202

    @app.get("/convert/<job_id>")
    def convert_status(job_id):
        job = jobs.get(job_id)
        if job is None:
            abort(404)

        body = {"status": job["status"]}
        if job["status"] == "ready":
            page_count = len(job["files"]["pages"])
            body["files"] = {
                "pages": [f"/convert/{job_id}/artifact/page-{n}" for n in range(1, page_count + 1)],
                "midi": f"/convert/{job_id}/artifact/midi",
                "timingJson": f"/convert/{job_id}/artifact/timing",
                "measuresJson": f"/convert/{job_id}/artifact/measures",
                "metaJson": f"/convert/{job_id}/artifact/meta",
            }
        elif job["status"] == "error":
            body["error"] = job.get("error", "unknown error")
        return jsonify(body)

    # EINE Auslieferungsroute statt fuenf fast identischer: die frueheren
    # convert_page/-midi/-timing/-measures/-meta unterschieden sich nur in
    # Dateiname und MIME-Typ. Ein weiteres Artefakt - etwa ein zweites
    # serverseitiges Layout (siehe docs/limits.md) - ist damit ein Eintrag in
    # ARTIFACTS statt eines neuen Handlers.
    ARTIFACTS = {
        "midi": ("midi", "audio/midi"),
        "timing": ("timingJson", "application/json"),
        "measures": ("measuresJson", "application/json"),
        "meta": ("metaJson", "application/json"),
    }

    @app.get("/convert/<job_id>/artifact/<name>")
    def convert_artifact(job_id, name):
        job = _ready_job(job_id)
        if name.startswith("page-"):
            pages = job["files"]["pages"]
            try:
                number = int(name[len("page-"):])
            except ValueError:
                abort(404)
            if number < 1 or number > len(pages):
                abort(404)
            return send_file(pages[number - 1], mimetype="image/svg+xml")

        entry = ARTIFACTS.get(name)
        if entry is None:
            abort(404)
        key, mimetype = entry
        return send_file(job["files"][key], mimetype=mimetype)

    if start_reaper:
        jobs.start_reaper()

    return app
