"""Tests fuer die HTTP-Oberflaeche.

Zwei Eigenschaften, die deshalb belegt gehoeren:

* Die Secret-Pruefung liegt nicht als ``require_secret()`` in zwoelf
  Handlern, sondern in EINEM ``before_request``-Hook mit Ausnahmeliste.
  Eine neue Route ohne Pruefung waere sonst ein reiner Vergessensfehler -
  so muss jemand den Pfad ausdruecklich in ``PUBLIC_PATHS`` eintragen.
  Diese Tests sind die Gegenprobe dazu.
* Die fuenf fast identischen Auslieferungsrouten sind zu einer
  ``/artifact/<name>``-Route zusammengefallen.
"""

import pytest

from scoreview_sidecar import config, jobs
from scoreview_sidecar.app import create_app

SECRET = {"X-ScoreView-Secret": "test-secret"}


@pytest.fixture()
def client():
    # start_reaper=False: der Reaper ist fuer diese Tests irrelevant und ein
    # Thread, der ueber die Testdauer hinaus laeuft, ist nur Unruhe.
    app = create_app(start_reaper=False)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def leere_registry():
    jobs.JOBS.clear()
    yield
    jobs.JOBS.clear()


# --- Secret-Hook ------------------------------------------------------------

def test_health_braucht_kein_secret(client):
    # Der einzige Endpunkt ohne Secret, und zwar mit Absicht: nur so laesst
    # sich "Sidecar laeuft ueberhaupt" von "Secret stimmt nicht"
    # unterscheiden (siehe SidecarClient::checkHealth()).
    antwort = client.get("/health")
    assert antwort.status_code == 200
    assert antwort.get_data(as_text=True) == "ok"


@pytest.mark.parametrize("pfad", [
    "/soundfont",
    "/soundfont/info",
    "/selftest",
    "/convert/egal",
    "/convert/egal/artifact/midi",
])
def test_alles_andere_verlangt_das_secret(client, pfad):
    assert client.get(pfad).status_code == 401


def test_convert_verlangt_das_secret(client):
    assert client.post("/convert").status_code == 401


def test_falsches_secret_wird_abgelehnt(client):
    assert client.get("/soundfont/info", headers={"X-ScoreView-Secret": "falsch"}).status_code == 401


# --- Auslieferung -----------------------------------------------------------

def _fertiger_job(tmp_path):
    seite = tmp_path / "page-1.svg"
    seite.write_text("<svg/>", encoding="utf-8")
    midi = tmp_path / "score.mid"
    midi.write_bytes(b"MThd")
    timing = tmp_path / "timing.json"
    timing.write_text('{"events":[]}', encoding="utf-8")
    jobs.JOBS["j1"] = {
        "status": "ready",
        "completedAt": 0,
        "files": {
            "pages": [seite],
            "midi": midi,
            "timingJson": timing,
            "measuresJson": timing,
            "metaJson": timing,
        },
    }


def test_status_nennt_alle_artefakt_urls(client, tmp_path):
    _fertiger_job(tmp_path)
    body = client.get("/convert/j1", headers=SECRET).get_json()

    assert body["status"] == "ready"
    assert body["files"]["pages"] == ["/convert/j1/artifact/page-1"]
    assert body["files"]["midi"] == "/convert/j1/artifact/midi"
    # Die Schluessel sind Vertrag mit PollConversionJob auf der PHP-Seite.
    assert set(body["files"]) == {"pages", "midi", "timingJson", "measuresJson", "metaJson"}


@pytest.mark.parametrize(("name", "mimetype"), [
    ("page-1", "image/svg+xml"),
    ("midi", "audio/midi"),
    ("timing", "application/json"),
    ("measures", "application/json"),
    ("meta", "application/json"),
])
def test_liefert_jedes_artefakt_mit_passendem_typ(client, tmp_path, name, mimetype):
    _fertiger_job(tmp_path)
    antwort = client.get(f"/convert/j1/artifact/{name}", headers=SECRET)
    assert antwort.status_code == 200
    assert antwort.mimetype == mimetype


@pytest.mark.parametrize("name", ["page-2", "page-0", "page-abc", "unbekannt", "../../etc/passwd"])
def test_weist_unbekannte_artefakte_ab(client, tmp_path, name):
    # Insbesondere: der Name ist eine Allowlist, kein Dateipfad.
    _fertiger_job(tmp_path)
    assert client.get(f"/convert/j1/artifact/{name}", headers=SECRET).status_code == 404


def test_liefert_nichts_fuer_einen_unfertigen_job(client):
    jobs.JOBS["j2"] = {"status": "processing", "completedAt": None}
    assert client.get("/convert/j2/artifact/midi", headers=SECRET).status_code == 404


def test_meldet_unbekannten_job_als_404(client):
    assert client.get("/convert/gibtsnicht", headers=SECRET).status_code == 404


def test_convert_ohne_datei_ist_ein_400(client):
    assert client.post("/convert", headers=SECRET).status_code == 400


def test_upload_limit_ist_gesetzt(client):
    assert client.application.config["MAX_CONTENT_LENGTH"] == config.MAX_UPLOAD_BYTES
