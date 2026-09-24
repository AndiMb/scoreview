"""Tests fuer die Nebenlaeufigkeitsgrenze.

Ohne sie wuerde jedes ``POST /convert`` sofort einen Thread mit einem eigenen
MuseScore-Prozess samt Xvfb starten, und ``run_score_media`` puffert
zusaetzlich die komplette Ausgabe im Speicher (gemessen 16 MB JSON schon bei
fuenf Seiten). Zwanzig gleichzeitig geoeffnete Partituren waeren genug, um
den Container unter Speicherdruck zu setzen - und die PHP-Seite drosselt
nichts.

Die Grenze ist von aussen nicht sichtbar (wartende Jobs stehen schlicht auf
"pending"), also muss sie hier gemessen werden statt geglaubt. Dasselbe gilt
fuer die Grenze der Warteplaetze und fuer das, was der Reaper verwerfen darf.
"""

import contextlib
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

    def blockierendes_mscore(pfad, **_):
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
    def kaputtes_mscore(pfad, **_):
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


def _warte_bis(bedingung, sekunden=5):
    frist = time.monotonic() + sekunden
    while time.monotonic() < frist:
        if bedingung():
            return True
        time.sleep(0.02)
    return bedingung()


class Blockade:
    """MuseScore-Attrappe, die ihren Platz haelt, bis der Test freigibt."""

    def __init__(self):
        self.freigeben = threading.Event()
        self.displays = []
        self.lock = threading.Lock()

    def __call__(self, pfad, display=None, **_):
        with self.lock:
            self.displays.append(display)
        self.freigeben.wait(timeout=10)
        raise RuntimeError("Testabbruch")

    def laufend(self):
        with self.lock:
            return len(self.displays)


def test_lehnt_ab_wenn_alle_warteplaetze_belegt_sind(monkeypatch):
    blockade = Blockade()
    monkeypatch.setattr(jobs, "run_score_media", blockade)
    monkeypatch.setattr(config, "MAX_QUEUED_JOBS", 2)
    plaetze = config.MAX_CONCURRENT_CONVERSIONS

    try:
        laufende = [jobs.submit(FakeUpload()) for _ in range(plaetze)]
        assert _warte_bis(lambda: blockade.laufend() == plaetze)
        # Laufende Auftraege belegen keinen Warteplatz - nur "pending" zaehlt.
        wartende = [jobs.submit(FakeUpload()) for _ in range(2)]
        assert all(jobs.JOBS[j]["status"] == "pending" for j in wartende)

        vorher = set(config.JOBS_DIR.iterdir())
        with pytest.raises(jobs.QueueFull):
            jobs.submit(FakeUpload())
        # Abgelehnt heisst: nichts gespeichert, kein Registry-Eintrag.
        assert set(config.JOBS_DIR.iterdir()) == vorher
        assert len(jobs.JOBS) == plaetze + 2
    finally:
        blockade.freigeben.set()

    alle = laufende + wartende
    assert _warte_bis(lambda: all(jobs.JOBS[j]["status"] == "error" for j in alle), 10)
    # Wieder Platz: jetzt nimmt er an. Abwarten, bis auch dieser durch ist -
    # sonst lief er nach dem Test mit dem echten run_score_media weiter.
    nachzuegler = jobs.submit(FakeUpload())
    assert _warte_bis(lambda: jobs.JOBS[nachzuegler]["status"] == "error")


def test_gleichzeitige_laeufe_bekommen_verschiedene_displays(monkeypatch):
    # Zwei Xvfb auf derselben Displaynummer - genau das Rennen, das
    # `xvfb-run -a` hatte - darf es nicht geben.
    blockade = Blockade()
    monkeypatch.setattr(jobs, "run_score_media", blockade)
    plaetze = config.MAX_CONCURRENT_CONVERSIONS

    try:
        for _ in range(plaetze):
            jobs.submit(FakeUpload())
        assert _warte_bis(lambda: blockade.laufend() == plaetze)
        assert len(set(blockade.displays)) == plaetze
    finally:
        blockade.freigeben.set()


def test_belegte_plaetze_sperren_auch_den_selbsttest():
    # conversion_slot ist der Weg, ueber den /selftest an die Grenze
    # gebunden ist: sind alle Plaetze belegt, bekommt auch er keinen.
    plaetze = config.MAX_CONCURRENT_CONVERSIONS
    with contextlib.ExitStack() as stack:
        for _ in range(plaetze):
            stack.enter_context(jobs.conversion_slot(timeout=1))
        with pytest.raises(jobs.NoSlotAvailable):
            with jobs.conversion_slot(timeout=0.05):
                pass
    # Und danach ist wieder einer frei.
    with jobs.conversion_slot(timeout=1):
        pass


def test_reaper_verwirft_uralte_wartende_auftraege(monkeypatch):
    monkeypatch.setattr(config, "PENDING_MAX_AGE_SECONDS", 60)
    jetzt = time.monotonic()
    jobs.JOBS["alt"] = {"status": "pending", "createdAt": jetzt - 61, "completedAt": None}
    jobs.JOBS["frisch"] = {"status": "pending", "createdAt": jetzt - 1, "completedAt": None}

    assert jobs.reap_once() == ["alt"]
    assert "frisch" in jobs.JOBS


def test_reaper_verwirft_laeufe_jenseits_des_timeouts(monkeypatch):
    # Laenger, als `timeout` MuseScore laesst, kann nur ein haengender Lauf
    # sein. Einer, der noch innerhalb liegt, bleibt unangetastet.
    monkeypatch.setattr(config, "TIMEOUT_SECONDS_NUMERIC", 100)
    monkeypatch.setattr(config, "JOB_TTL_SECONDS", 10)
    jetzt = time.monotonic()
    jobs.JOBS["haengt"] = {"status": "processing", "startedAt": jetzt - 111, "completedAt": None}
    jobs.JOBS["laeuft"] = {"status": "processing", "startedAt": jetzt - 50, "completedAt": None}

    assert jobs.reap_once() == ["haengt"]
    assert "laeuft" in jobs.JOBS


def test_reaper_laesst_laeufe_ohne_deutbaren_timeout_stehen(monkeypatch):
    monkeypatch.setattr(config, "TIMEOUT_SECONDS_NUMERIC", None)
    jobs.JOBS["laeuft"] = {"status": "processing", "startedAt": 0, "completedAt": None}

    assert jobs.reap_once() == []


def test_verworfener_auftrag_startet_kein_mscore(monkeypatch, tmp_path):
    aufrufe = []
    monkeypatch.setattr(jobs, "run_score_media", lambda *a, **k: aufrufe.append(a))
    arbeitsverzeichnis = tmp_path / "weg"
    arbeitsverzeichnis.mkdir()

    # Kein Registry-Eintrag mehr: der Reaper war schneller.
    jobs.run_conversion("weg", arbeitsverzeichnis / "input.mscz", arbeitsverzeichnis)

    assert aufrufe == []
    assert not arbeitsverzeichnis.exists()


def test_verworfen_waehrend_des_laufs_raeumt_selbst_auf(monkeypatch, tmp_path):
    arbeitsverzeichnis = tmp_path / "j"
    arbeitsverzeichnis.mkdir()
    jobs.JOBS["j"] = {"status": "pending", "createdAt": time.monotonic(), "completedAt": None}

    def mscore_und_reaper(pfad, **_):
        jobs.JOBS.pop("j")
        raise RuntimeError("egal")

    monkeypatch.setattr(jobs, "run_score_media", mscore_und_reaper)
    jobs.run_conversion("j", arbeitsverzeichnis / "input.mscz", arbeitsverzeichnis)

    assert "j" not in jobs.JOBS
    assert not arbeitsverzeichnis.exists()


@pytest.mark.parametrize(("wert", "sekunden"), [
    ("600", 600), ("10m", 600), ("1.5h", 5400), ("30s", 30), ("quatsch", None),
])
def test_deutet_den_timeout_wie_coreutils(wert, sekunden):
    assert config._timeout_as_seconds(wert) == sekunden
