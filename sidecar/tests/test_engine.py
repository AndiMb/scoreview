"""Tests for the second renderer: the scoreview-engine under Node.

Without Node or the engine: ``engine._run`` and the conversion functions are
replaced where a test reaches them. What is checked is what the sidecar
itself decides - which renderer a job gets, how the Node call is locked in,
what reaches the converter's environment, and how a variant comes back.
"""

import io
import json
import time

import pytest

from scoreview_sidecar import app as app_modul
from scoreview_sidecar import config, engine, errors, jobs
from scoreview_sidecar.app import create_app

SECRET = {"X-ScoreView-Secret": "test-secret"}


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


def _schreibe_artefakte(out_dir, seiten=2, midi=True):
    out_dir.mkdir(parents=True, exist_ok=True)
    for n in range(1, seiten + 1):
        (out_dir / f"page-{n}.svg").write_text(f"<svg>{n}</svg>", encoding="utf-8")
    if midi:
        (out_dir / "score.mid").write_bytes(b"MThd")
    for name in ("timing.json", "measures.json", "meta.json"):
        (out_dir / name).write_text("{}", encoding="utf-8")


# --- The Node call ----------------------------------------------------------

def test_node_laeuft_mit_liftoff_und_permission(tmp_path):
    eingabe = tmp_path / "in.mscz"
    ausgabe = tmp_path / "out"
    befehl = engine._command([eingabe], [ausgabe], [str(eingabe), str(ausgabe)])

    node_an = befehl.index(config.NODE_BIN)
    # The time limit wraps Node, as it wraps mscore4portable.
    assert befehl[:3] == ["timeout", "--signal=KILL", config.TIMEOUT_SECONDS]
    assert befehl[node_an + 1:node_an + 3] == ["--liftoff-only", "--permission"]
    assert f"--allow-fs-read={config.CONVERTER_DIR}" in befehl
    assert f"--allow-fs-read={eingabe}" in befehl
    # One flag per path (a comma is part of the path from Node 22 on), and
    # write access only to the output directory.
    assert [a for a in befehl if a.startswith("--allow-fs-write=")] == [f"--allow-fs-write={ausgabe}"]
    assert befehl[-3:] == [str(config.CONVERTER_DIR / "convert.mjs"), str(eingabe), str(ausgabe)]


def test_der_konverter_sieht_das_secret_nicht(monkeypatch):
    monkeypatch.setenv("SCOREVIEW_SIDECAR_SECRET", "streng-geheim")
    umgebung = engine._environment()
    assert "streng-geheim" not in json.dumps(umgebung)
    assert set(umgebung) == {"PATH", "LANG", "HOME"}


def test_fehlerzeile_ist_die_meldung_nicht_der_stackframe():
    ausgabe = "Qt-Rauschen\nError: Variant ex9~orig~w~0 fails its invariants\n    at main (convert.mjs:1:1)\n    at async x\n"
    assert engine.last_line(ausgabe) == "Error: Variant ex9~orig~w~0 fails its invariants"
    assert engine.last_line("") == "no error output"


def test_seiten_werden_nach_nummer_gezaehlt(tmp_path):
    for n in (1, 2, 10):
        (tmp_path / f"page-{n}.svg").write_text("<svg/>", encoding="utf-8")
    # page-10 without page-3..9 is not a page of this run.
    assert [p.name for p in engine._pages(tmp_path)] == ["page-1.svg", "page-2.svg"]


def test_ohne_seite_ist_es_ein_fehler(tmp_path):
    with pytest.raises(errors.ConversionError, match="no SVG page") as fehler:
        engine._pages(tmp_path)
    assert fehler.value.code == errors.NO_PAGES


def test_engine_version_aus_dem_package_json(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text(json.dumps({"dependencies": {
        "scoreview-engine": "https://github.com/AndiMb/scoreview-engine/releases/download/v4.7.5-engine.6/scoreview-engine-4.7.5.tgz",
    }}), encoding="utf-8")
    monkeypatch.setattr(config, "CONVERTER_DIR", tmp_path)
    assert config.engine_version() == "4.7.5-engine.6"
    monkeypatch.setattr(config, "CONVERTER_DIR", tmp_path / "fehlt")
    assert config.engine_version() == "unknown"


# --- Renderer per job -------------------------------------------------------

def test_convert_nimmt_den_genannten_renderer(client, monkeypatch):
    eingereicht = []
    monkeypatch.setattr(jobs, "submit", lambda upload, renderer: eingereicht.append(renderer) or "id")
    for renderer in config.RENDERERS:
        antwort = client.post("/convert", headers=SECRET, data={
            "file": (io.BytesIO(b"mscz"), "x.mscz"), "renderer": renderer,
        })
        assert antwort.status_code == 202
        assert antwort.get_json()["renderer"] == renderer
    assert eingereicht == list(config.RENDERERS)


def test_convert_ohne_renderer_nimmt_die_voreinstellung(client, monkeypatch):
    eingereicht = []
    monkeypatch.setattr(jobs, "submit", lambda upload, renderer: eingereicht.append(renderer) or "id")
    client.post("/convert", headers=SECRET, data={"file": (io.BytesIO(b"mscz"), "x.mscz")})
    assert eingereicht == [config.DEFAULT_RENDERER]


def test_unbekannter_renderer_ist_400(client, monkeypatch):
    monkeypatch.setattr(jobs, "submit", lambda *a: pytest.fail("darf nicht einreichen"))
    antwort = client.post("/convert", headers=SECRET, data={
        "file": (io.BytesIO(b"mscz"), "x.mscz"), "renderer": "lilypond",
    })
    assert antwort.status_code == 400


def test_engine_auftrag_laeuft_ohne_mscore(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs, "run_score_media", lambda *a, **k: pytest.fail("MuseScore lief"))
    monkeypatch.setattr(engine, "convert", lambda eingabe, out_dir: (_schreibe_artefakte(out_dir), engine._pages(out_dir))[1])
    jobs.JOBS["e"] = {"status": "pending", "renderer": config.RENDERER_ENGINE, "createdAt": time.monotonic(), "completedAt": None}

    jobs.run_conversion("e", tmp_path / "input.mscz", tmp_path)

    job = jobs.JOBS["e"]
    assert job["status"] == "ready"
    assert [p.name for p in job["files"]["pages"]] == ["page-1.svg", "page-2.svg"]
    assert job["files"]["midi"].name == "score.mid"


def test_engine_fehler_landet_im_status(monkeypatch, tmp_path, client):
    def scheitert(eingabe, out_dir):
        raise RuntimeError("engine conversion failed: Error: kaputt")

    monkeypatch.setattr(engine, "convert", scheitert)
    jobs.JOBS["e"] = {"status": "pending", "renderer": config.RENDERER_ENGINE, "createdAt": time.monotonic(), "completedAt": None}
    jobs.run_conversion("e", tmp_path / "input.mscz", tmp_path)

    body = client.get("/convert/e", headers=SECRET).get_json()
    assert body == {
        "status": "error", "renderer": "engine",
        "error": "engine conversion failed: Error: kaputt", "errorCode": "conversion_failed",
    }


def test_status_nennt_den_renderer(client, tmp_path):
    _schreibe_artefakte(tmp_path, seiten=1)
    jobs.JOBS["m"] = {"status": "ready", "renderer": "musescore", "files": {
        "pages": [tmp_path / "page-1.svg"], "midi": tmp_path / "score.mid",
        "timingJson": tmp_path / "timing.json", "measuresJson": tmp_path / "measures.json", "metaJson": tmp_path / "meta.json",
    }}
    body = client.get("/convert/m", headers=SECRET).get_json()
    assert body["renderer"] == "musescore"
    assert body["files"]["midi"] == "/convert/m/artifact/midi"


# --- Variants ---------------------------------------------------------------

def _variante(client, key="part3~phone~w~-2"):
    return client.post("/variant", headers=SECRET, data={
        "file": (io.BytesIO(b"mscz"), "x.mscz"),
        "timing": (io.BytesIO(b'{"events":[]}'), "timing.json"),
        "measures": (io.BytesIO(b'{"events":[]}'), "measures.json"),
        "key": key,
    })


def test_variante_verlangt_das_secret(client):
    assert client.post("/variant").status_code == 401


def test_variante_kommt_fertig_zurueck_ohne_midi(client, monkeypatch):
    aufrufe = []

    def setzt(eingabe, key, base_dir, out_dir):
        # The base's files reach the converter as written by the app.
        aufrufe.append((key, (base_dir / "timing.json").read_text(), eingabe.read_bytes()))
        _schreibe_artefakte(out_dir, seiten=3, midi=False)
        return engine._pages(out_dir)

    monkeypatch.setattr(engine, "convert_variant", setzt)
    monkeypatch.setattr(config, "engine_version", lambda: "4.7.5-engine.6")

    antwort = _variante(client)

    assert antwort.status_code == 200
    body = antwort.get_json()
    assert aufrufe == [("part3~phone~w~-2", '{"events":[]}', b"mscz")]
    assert body["status"] == "ready"
    assert body["engine"] == "4.7.5-engine.6"
    assert "midi" not in body["files"]
    assert len(body["files"]["pages"]) == 3
    seite = client.get(body["files"]["pages"][2], headers=SECRET)
    assert seite.get_data(as_text=True) == "<svg>3</svg>"
    # A variant plays the base's MIDI - there is none to fetch.
    job_id = body["files"]["pages"][0].split("/")[2]
    assert client.get(f"/convert/{job_id}/artifact/midi", headers=SECRET).status_code == 404


def test_variante_die_scheitert_ist_ein_ergebnis(client, monkeypatch):
    def scheitert(*_):
        raise RuntimeError("engine conversion failed: Error: Variant part3~phone~w~-2 fails its invariants")

    monkeypatch.setattr(engine, "convert_variant", scheitert)
    antwort = _variante(client)
    assert antwort.status_code == 200
    assert antwort.get_json()["status"] == "error"
    assert "invariants" in antwort.get_json()["error"]


def test_variante_ohne_freien_platz_ist_503(client, monkeypatch):
    monkeypatch.setattr(config, "VARIANT_SLOT_WAIT_SECONDS", 0.05)
    monkeypatch.setattr(engine, "convert_variant", lambda *a: pytest.fail("lief ohne Platz"))
    import contextlib
    with contextlib.ExitStack() as stack:
        for _ in range(config.MAX_CONCURRENT_CONVERSIONS):
            stack.enter_context(jobs.conversion_slot(timeout=1))
        antwort = _variante(client)
    assert antwort.status_code == 503
    assert "Retry-After" in antwort.headers
    # Nothing left behind for the reaper.
    assert jobs.JOBS == {}


@pytest.mark.parametrize("key", ["", "../x", "a b", "x" * 65])
def test_variante_mit_unbrauchbarem_schluessel_ist_400(client, monkeypatch, key):
    monkeypatch.setattr(engine, "convert_variant", lambda *a: pytest.fail("darf nicht laufen"))
    assert _variante(client, key).status_code == 400


def test_variante_belegt_keinen_warteplatz(client, monkeypatch):
    # A variant job is never "pending": submit() counts those as the
    # waiting places of the queue, and a variant does not wait there.
    gesehen = []

    def setzt(eingabe, key, base_dir, out_dir):
        gesehen.extend(job["status"] for job in jobs.JOBS.values())
        _schreibe_artefakte(out_dir, seiten=1, midi=False)
        return engine._pages(out_dir)

    monkeypatch.setattr(engine, "convert_variant", setzt)
    _variante(client)
    assert gesehen == ["processing"]


# --- Self-test --------------------------------------------------------------

def test_selftest_der_engine(client, monkeypatch):
    monkeypatch.setattr(engine, "selftest", lambda workdir: {"ok": True, "error": None, "details": {"pages": 1}})
    monkeypatch.setattr(app_modul, "run_score_media", lambda *a, **k: pytest.fail("MuseScore lief"))
    body = client.get("/selftest?renderer=engine", headers=SECRET).get_json()
    assert body == {"ok": True, "error": None, "details": {"pages": 1}, "renderer": "engine"}


def test_selftest_der_engine_meldet_fehler_mit_200(client, monkeypatch):
    def scheitert(workdir):
        raise RuntimeError("engine conversion failed: Error: kein node")

    monkeypatch.setattr(engine, "selftest", scheitert)
    antwort = client.get("/selftest?renderer=engine", headers=SECRET)
    assert antwort.status_code == 200
    assert antwort.get_json() == {"ok": False, "renderer": "engine", "error": "engine conversion failed: Error: kein node"}
