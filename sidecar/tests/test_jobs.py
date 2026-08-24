"""Tests fuer die Nebenlaeufigkeitsgrenze (Codereview-Befund A5).

Vorher startete jedes ``POST /convert`` sofort einen Thread mit einem eigenen
MuseScore-Prozess samt Xvfb, und ``run_score_media`` puffert zusaetzlich die
komplette Ausgabe im Speicher (gemessen 16 MB JSON schon bei fuenf Seiten).
Zwanzig gleichzeitig geoeffnete Partituren reichten, um den Container unter
Speicherdruck zu setzen - und die PHP-Seite drosselte nichts.

Die Grenze ist von aussen nicht sichtbar (wartende Jobs stehen schlicht auf
"pending"), also muss sie hier gemessen werden statt geglaubt.
"""

import threading
import time

import pytest

from scoreview_sidecar import config, jobs


class FakeUpload:
    """Minimaler Ersatz fuer werkzeugs FileStorage."""

    def __init__(self, inhalt=b"nicht wirklich eine mscz"):
        self.inhalt = inhalt

    def save(self, ziel):
        ziel.write_bytes(self.inhalt)


@pytest.fixture(autouse=True)
def leere_registry():
    jobs.JOBS.clear()
    yield
    jobs.JOBS.clear()


def test_laesst_hoechstens_so_viele_konvertierungen_gleichzeitig_laufen(monkeypatch):
    grenze = config.MAX_CONCURRENT_CONVERSIONS
    gleichzeitig = 0
    hoechststand = 0
    zaehler_lock = threading.Lock()
    freigeben = threading.Event()

    def blockierendes_mscore(pfad):
        nonlocal gleichzeitig, hoechststand
        with zaehler_lock:
            gleichzeitig += 1
            hoechststand = max(hoechststand, gleichzeitig)
        # Haelt den Slot, bis der Test freigibt - so ist der Hoechststand
        # ueberhaupt messbar.
        freigeben.wait(timeout=10)
        with zaehler_lock:
            gleichzeitig -= 1
        raise RuntimeError("Testabbruch nach der Messung")

    monkeypatch.setattr(jobs, "run_score_media", blockierendes_mscore)

    ids = [jobs.submit(FakeUpload()) for _ in range(grenze + 3)]

    # Warten, bis die erlaubte Zahl wirklich drin ist.
    frist = time.monotonic() + 5
    while time.monotonic() < frist:
        with zaehler_lock:
            if gleichzeitig >= grenze:
                break
        time.sleep(0.02)

    with zaehler_lock:
        assert gleichzeitig == grenze, f"es liefen {gleichzeitig} statt {grenze}"

    # Die ueberzaehligen Jobs muessen waehrenddessen "pending" sein - genau
    # das sieht die PHP-Seite, und mehr braucht sie nicht zu wissen.
    wartende = [j for j in ids if jobs.JOBS[j]["status"] == "pending"]
    assert len(wartende) == 3

    freigeben.set()

    # Alle muessen irgendwann drankommen (hier: mit Fehler enden).
    frist = time.monotonic() + 10
    while time.monotonic() < frist:
        if all(jobs.JOBS[j]["status"] == "error" for j in ids):
            break
        time.sleep(0.02)

    assert all(jobs.JOBS[j]["status"] == "error" for j in ids), "kein Job blieb haengen"
    assert hoechststand == grenze, f"Hoechststand war {hoechststand}, erlaubt sind {grenze}"


def test_ein_fehler_gibt_den_slot_wieder_frei(monkeypatch):
    # Wuerde das Semaphor bei einem Fehlschlag nicht freigegeben, waere der
    # Sidecar nach MAX_CONCURRENT kaputten Partituren dauerhaft blockiert -
    # ohne dass irgendwo ein Fehler erschiene.
    def kaputtes_mscore(pfad):
        raise RuntimeError("kaputte Partitur")

    monkeypatch.setattr(jobs, "run_score_media", kaputtes_mscore)

    for _ in range(config.MAX_CONCURRENT_CONVERSIONS + 2):
        job_id = jobs.submit(FakeUpload())
        frist = time.monotonic() + 5
        while time.monotonic() < frist and jobs.JOBS[job_id]["status"] != "error":
            time.sleep(0.01)
        assert jobs.JOBS[job_id]["status"] == "error", "Slot wurde nicht freigegeben"


def test_reaper_raeumt_nur_abgeschlossene_jobs(monkeypatch):
    monkeypatch.setattr(config, "JOB_TTL_SECONDS", 0)
    jobs.JOBS["fertig"] = {"status": "ready", "completedAt": time.monotonic() - 1}
    jobs.JOBS["laeuft"] = {"status": "processing", "completedAt": None}

    entfernt = jobs.reap_once()

    assert entfernt == ["fertig"]
    assert "laeuft" in jobs.JOBS
