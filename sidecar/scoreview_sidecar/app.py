"""The HTTP surface: Flask routes and nothing else.

Everything that knows anything lives in ``config``, ``musescore`` and
``jobs``; this module only maps URLs onto it.

The secret check moved from twelve individual ``require_secret()`` calls to a
single ``before_request`` hook with an explicit allowlist. Before, adding a
route without the check was a pure oversight away - now it takes deliberately
adding the path to ``PUBLIC_PATHS``.
"""

import hashlib
import re
import secrets
import shutil
import tempfile
import threading
import time
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file

from . import config, engine, errors, jobs
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


# The shape of a variant key (E19, `src~fmt~pitch~tr`), as the app's route
# allows it. Only the shape: what the key means, convert.mjs checks.
_VARIANT_KEY = re.compile(r"^[A-Za-z0-9_~\-]{1,64}$")


def _renderer(value) -> str:
    """The renderer a request names, or the configured default when it
    names none. An unknown name is a 400: converting with something the
    caller did not ask for would give it artifacts it does not expect."""
    if value is None or value == "":
        return config.DEFAULT_RENDERER
    if value not in config.RENDERERS:
        abort(400, f"renderer must be one of {', '.join(config.RENDERERS)}")
    return value


def _files_body(job_id: str, job: dict) -> dict:
    """Relative URLs of a ready job's artifacts. A variant has no MIDI."""
    files = job["files"]
    body = {
        "pages": [f"/convert/{job_id}/artifact/page-{n}" for n in range(1, len(files["pages"]) + 1)],
        "timingJson": f"/convert/{job_id}/artifact/timing",
        "measuresJson": f"/convert/{job_id}/artifact/measures",
        "metaJson": f"/convert/{job_id}/artifact/meta",
    }
    if "midi" in files:
        body["midi"] = f"/convert/{job_id}/artifact/midi"
    return body


def _error_body(job: dict) -> dict:
    """`error` for people, `errorCode` for the app, which translates the
    code (E4) and takes it as it is - the same names whichever renderer
    ran (E3)."""
    return {
        "error": job.get("error", "unknown error"),
        "errorCode": job.get("errorCode", errors.CONVERSION_FAILED),
    }


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
    # Start um ~8 s verzoegern und einen an sich benutzbaren Sidecar bei
    # einem Teilproblem gar nicht erst hochkommen lassen.
    @app.get("/selftest")
    def selftest():
        renderer = _renderer(request.args.get("renderer"))
        if renderer == config.RENDERER_ENGINE:
            return _engine_selftest()
        if not config.SELFTEST_SCORE.exists():
            return jsonify({"ok": False, "renderer": config.RENDERER_MUSESCORE, "error": f"self-test score missing: {config.SELFTEST_SCORE}"})

        workdir = Path(tempfile.mkdtemp(prefix="scoreview-selftest-"))
        try:
            target = workdir / "selftest.mscz"
            shutil.copy(config.SELFTEST_SCORE, target)
            # Ueber denselben Konvertierungsplatz wie jeder Auftrag: sonst
            # liefe ein dritter MuseScore-Prozess neben den erlaubten zwei,
            # und auf derselben Xvfb-Displaynummer wie einer von ihnen.
            # Begrenzt gewartet - ein voll ausgelasteter Sidecar soll das
            # sagen, statt den Aufruf in den Timeout der PHP-Seite laufen
            # zu lassen (NoSlotAvailable landet unten als ok:false).
            with jobs.conversion_slot(timeout=config.SELFTEST_SLOT_WAIT_SECONDS) as display:
                started = time.time()
                media = run_score_media(target, display=display)
                elapsed = time.time() - started

            problems, details = check_promises(media)
            return jsonify({
                "ok": not problems,
                "renderer": config.RENDERER_MUSESCORE,
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
            return jsonify({"ok": False, "renderer": config.RENDERER_MUSESCORE, "error": str(exc)})
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def _engine_selftest():
        """The converter's own self-test (`convert.mjs --selftest`), the one
        the app runs on its local path: five bundled scores instead of one,
        and on top of M2/M4/M7 the engine's own promises - segment ids
        (M10), score facts, lyrics, meters, display variants."""
        workdir = Path(tempfile.mkdtemp(prefix="scoreview-selftest-"))
        try:
            with jobs.conversion_slot(timeout=config.SELFTEST_SLOT_WAIT_SECONDS):
                result = engine.selftest(workdir)
            return jsonify({**result, "renderer": config.RENDERER_ENGINE})
        except Exception as exc:  # noqa: BLE001 - same rule as the MuseScore self-test
            return jsonify({"ok": False, "renderer": config.RENDERER_ENGINE, "error": str(exc)})
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
        renderer = _renderer(request.form.get("renderer"))
        try:
            job_id = jobs.submit(uploaded, renderer)
        except jobs.QueueFull as exc:
            # 503 statt 429: die Ablehnung sagt nichts ueber diesen Aufrufer
            # oder diese Partitur, sondern dass der Dienst gerade ausgelastet
            # ist. Auf der PHP-Seite landet ein 5xx dadurch NICHT bei den
            # 4xx-Ablehnungen (sidecar_rejected, ein Fehler dieser Datei),
            # sondern bei den Infrastrukturfehlern - und die loesen den
            # Rueckfall auf die Konvertierung im Browser aus (E7). Genau das
            # ist bei einem ueberlasteten Sidecar die brauchbare Antwort.
            response = jsonify({"error": f"conversion queue full: {exc}"})
            response.status_code = 503
            response.headers["Retry-After"] = str(config.QUEUE_FULL_RETRY_AFTER_SECONDS)
            return response
        return jsonify({"jobId": job_id, "renderer": renderer}), 202

    @app.get("/convert/<job_id>")
    def convert_status(job_id):
        job = jobs.get(job_id)
        if job is None:
            abort(404)

        # `renderer` says what actually ran, so the app can tell an image
        # without the engine from one that has it.
        body = {"status": job["status"], "renderer": jobs.renderer_of(job)}
        if job["status"] == "ready":
            body["files"] = _files_body(job_id, job)
        elif job["status"] == "error":
            body.update(_error_body(job))
        return jsonify(body)

    @app.post("/variant")
    def variant():
        """A display variant (E19), engraved within this request.

        Multipart: `file` (the .mscz), `timing` and `measures` (the base
        conversion's timing.json and measures.json, which the variant is
        checked against), and the form field `key`. Answers like
        GET /convert/<id> for a finished job; the files are fetched over the
        same artifact route. A score the engine cannot engrave this way is a
        200 with status "error" - a result, not a failure of the service."""
        uploaded = request.files.get("file")
        timing = request.files.get("timing")
        measures = request.files.get("measures")
        key = request.form.get("key", "")
        if uploaded is None or timing is None or measures is None or not _VARIANT_KEY.match(key):
            abort(400, "multipart fields 'file', 'timing', 'measures' and a variant 'key' are required")
        try:
            job_id = jobs.run_variant(uploaded, key, timing, measures)
        except jobs.NoSlotAvailable as exc:
            # 503 like a full queue: busy, not broken.
            response = jsonify({"error": str(exc)})
            response.status_code = 503
            response.headers["Retry-After"] = str(config.VARIANT_SLOT_WAIT_SECONDS)
            return response
        job = jobs.get(job_id)
        body = {"status": job["status"], "renderer": config.RENDERER_ENGINE, "engine": config.engine_version()}
        if job["status"] == "ready":
            body["files"] = _files_body(job_id, job)
        else:
            body.update(_error_body(job))
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
        if entry is None or entry[0] not in job["files"]:
            abort(404)
        key, mimetype = entry
        return send_file(job["files"][key], mimetype=mimetype)

    if start_reaper:
        jobs.start_reaper()

    return app
