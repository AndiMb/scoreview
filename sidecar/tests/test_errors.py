"""The error codes a failed job reports (E3, E4).

The same score must read the same in the viewer whichever path converted
it; the app takes ``errorCode`` from the status answer as it is. Checked
here: each renderer's ways to fail end in the app's code names, the
engine's exit codes are those of convert.mjs, and both answers that report
a failure - a job's status and a variant - carry the code.
"""

import io
import re
import time
from pathlib import Path

import pytest

from scoreview_sidecar import config, engine, errors, jobs, musescore
from scoreview_sidecar.app import create_app

SECRET = {"X-ScoreView-Secret": "test-secret"}
ERRORS_MJS = Path(__file__).resolve().parents[2] / "scoreview" / "converter" / "lib" / "errors.mjs"


@pytest.fixture()
def client():
    app = create_app(start_reaper=False)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def leere_registry():
    jobs.JOBS.clear()
    yield
    jobs.JOBS.clear()


class _Prozess:
    def __init__(self, returncode):
        self.returncode = returncode


def _prozess_endet_mit(monkeypatch, modul, returncode):
    """Replaces subprocess.run in `modul`: the process writes a Node error
    to the stderr file it is given and exits with `returncode`."""
    def run(cmd, stdout, stderr, **kwargs):
        stderr.write(b"ConversionError: The engine returned no SVG page.\n    at convert (convert.mjs:1:1)\n")
        return _Prozess(returncode)

    monkeypatch.setattr(modul.subprocess, "run", run)


def test_die_exitcodes_sind_die_des_konverters():
    # converter/lib/errors.mjs is the one list; this copy must not drift.
    quelle = ERRORS_MJS.read_text(encoding="utf-8")
    block = re.search(r"EXIT_CODES = Object\.freeze\(\{(.*?)\}\)", quelle, re.S)
    assert block, "EXIT_CODES not found in errors.mjs"
    aus_dem_konverter = {int(code): name for name, code in re.findall(r"(\w+):\s*(\d+)", block.group(1))}
    assert aus_dem_konverter
    assert aus_dem_konverter == errors.CONVERTER_EXIT_CODES


@pytest.mark.parametrize("returncode, code", [
    (3, errors.NO_PAGES),
    (1, errors.CONVERSION_FAILED),
    (-9, errors.TIMEOUT),
])
def test_engine_meldet_den_code_ihres_exitcodes(monkeypatch, tmp_path, returncode, code):
    _prozess_endet_mit(monkeypatch, engine, returncode)
    with pytest.raises(errors.ConversionError) as fehler:
        engine._run([], [], ["x"], tmp_path)
    assert fehler.value.code == code


def test_engine_behaelt_die_meldungszeile(monkeypatch, tmp_path):
    _prozess_endet_mit(monkeypatch, engine, 3)
    with pytest.raises(errors.ConversionError, match="returned no SVG page"):
        engine._run([], [], ["x"], tmp_path)


def test_musescore_ueber_der_zeitgrenze_ist_timeout(monkeypatch, tmp_path):
    _prozess_endet_mit(monkeypatch, musescore, -9)
    with pytest.raises(errors.ConversionError) as fehler:
        musescore.run_score_media(tmp_path / "input.mscz")
    assert fehler.value.code == errors.TIMEOUT


def _auftrag(job_id, renderer):
    jobs.JOBS[job_id] = {"status": "pending", "renderer": renderer, "createdAt": time.monotonic(), "completedAt": None}


def test_musescore_ohne_seiten_ist_no_pages(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs, "run_score_media", lambda *a, **k: {"svgs": []})
    _auftrag("m", config.RENDERER_MUSESCORE)

    jobs.run_conversion("m", tmp_path / "input.mscz", tmp_path)

    assert jobs.JOBS["m"]["status"] == "error"
    assert jobs.JOBS["m"]["errorCode"] == errors.NO_PAGES


def test_ein_sonstiger_fehler_ist_conversion_failed(monkeypatch, tmp_path):
    def kaputt(*a, **k):
        raise RuntimeError("mscore4portable --score-media exited 1: kaputt")

    monkeypatch.setattr(jobs, "run_score_media", kaputt)
    _auftrag("m", config.RENDERER_MUSESCORE)

    jobs.run_conversion("m", tmp_path / "input.mscz", tmp_path)

    assert jobs.JOBS["m"]["errorCode"] == errors.CONVERSION_FAILED


@pytest.mark.parametrize("renderer", config.RENDERERS)
def test_der_status_traegt_denselben_code_auf_beiden_renderern(client, monkeypatch, tmp_path, renderer):
    def engine_ohne_seiten(eingabe, out_dir):
        out_dir.mkdir(parents=True, exist_ok=True)
        return engine._pages(out_dir)

    monkeypatch.setattr(engine, "convert", engine_ohne_seiten)
    monkeypatch.setattr(jobs, "run_score_media", lambda *a, **k: {"svgs": []})
    _auftrag("j", renderer)

    jobs.run_conversion("j", tmp_path / "input.mscz", tmp_path)

    body = client.get("/convert/j", headers=SECRET).get_json()
    assert body["status"] == "error"
    assert body["errorCode"] == errors.NO_PAGES
    assert body["error"]


def test_eine_gescheiterte_variante_traegt_den_code(client, monkeypatch):
    def ohne_seiten(*_):
        raise errors.ConversionError(errors.NO_PAGES, "engine conversion failed: ConversionError: The engine returned no SVG page.")

    monkeypatch.setattr(engine, "convert_variant", ohne_seiten)
    antwort = client.post("/variant", headers=SECRET, data={
        "file": (io.BytesIO(b"mscz"), "x.mscz"),
        "timing": (io.BytesIO(b"{}"), "timing.json"),
        "measures": (io.BytesIO(b"{}"), "measures.json"),
        "key": "full~phone~w~0",
    })

    body = antwort.get_json()
    assert antwort.status_code == 200
    assert body["status"] == "error"
    assert body["errorCode"] == errors.NO_PAGES


def test_ein_eintrag_ohne_code_ist_conversion_failed(client):
    jobs.JOBS["alt"] = {"status": "error", "renderer": "musescore", "error": "x", "completedAt": 0}
    assert client.get("/convert/alt", headers=SECRET).get_json()["errorCode"] == errors.CONVERSION_FAILED
