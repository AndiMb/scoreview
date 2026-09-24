"""Tests fuer ``run_score_media`` - insbesondere fuer M3.

MuseScore schreibt rund zwoelf Zeilen Qt-Logausgabe (Locale-Warnung,
DBus-Fehler) VOR das JSON auf stdout; das JSON beginnt erst beim ersten
``\\n{\\n``. Das ist bekanntes Verhalten (MuseScore-Issue #13304) und darf
laut docs/architecture.md M3 "nicht per Zufall funktionieren". Diese Stelle
faellt sonst erst auf, wenn eine neue MuseScore-Version das Ausgabeformat
aendert, und dann als unspezifischer Konvertierungsfehler.

``subprocess.run`` wird ersetzt, damit die Tests ohne MuseScore, ohne Xvfb
und in Millisekunden laufen. Was der Prozess selbst liefert, prueft der
Selbsttest gegen das echte Image (``GET /selftest``).
"""

import json
import subprocess
import pytest

from scoreview_sidecar import musescore


class FakeCompletedProcess:
    def __init__(self, returncode: int = 0):
        self.returncode = returncode


def fake_run(monkeypatch, stdout: bytes, returncode: int = 0, stderr: bytes = b""):
    """Ersetzt subprocess.run. Der Prozess schreibt nicht in Pipes, sondern
    in die Dateien, die run_score_media als stdout/stderr uebergibt - also
    schreibt die Attrappe genau dorthin."""
    calls = []

    def _run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        kwargs["stdout"].write(stdout)
        kwargs["stderr"].write(stderr)
        return FakeCompletedProcess(returncode)

    monkeypatch.setattr(musescore.subprocess, "run", _run)
    # Auf einem Linux-Entwicklerrechner laege unter /tmp/.X99-lock womoeglich
    # ein echter X-Server - den raeumt kein Unit-Test weg.
    monkeypatch.setattr(musescore, "_clear_stale_display", lambda display: None)
    return calls


@pytest.fixture()
def partitur(tmp_path):
    # Die Ausgabe landet in Dateien neben der Eingabe, das Verzeichnis muss
    # also existieren.
    return tmp_path / "egal.mscz"


QT_RAUSCHEN = (
    b'qt.qpa.xcb: could not connect to display\n'
    b'Warning: Ignoring XDG_SESSION_TYPE=wayland\n'
    b'QDBusConnection: session D-Bus connection created before QCoreApplication\n'
)


def test_schneidet_qt_rauschen_vor_dem_json_weg(monkeypatch, partitur):
    nutzlast = {"svgs": ["abc"], "metadata": {"pages": 1}}
    stdout = QT_RAUSCHEN + b"\n" + json.dumps(nutzlast, indent=1).encode()
    fake_run(monkeypatch, stdout)

    assert musescore.run_score_media(partitur) == nutzlast


def test_findet_json_auch_ohne_vorheriges_rauschen(monkeypatch, partitur):
    # Falls MuseScore irgendwann sauberes stdout liefert, darf der Parser
    # nicht dadurch brechen, dass er das Rauschen ERWARTET.
    nutzlast = {"svgs": ["abc"]}
    fake_run(monkeypatch, b"\n" + json.dumps(nutzlast, indent=1).encode())

    assert musescore.run_score_media(partitur) == nutzlast


def test_meldet_fehlenden_json_marker_deutlich(monkeypatch, partitur):
    # Der Kernpunkt aus M3: kein stilles Leerlaufen, sondern ein Fehler, der
    # sagt, dass sich das Ausgabeformat geaendert haben koennte.
    fake_run(monkeypatch, b"nur Rauschen, kein JSON\n")

    with pytest.raises(RuntimeError, match="no recognizable JSON"):
        musescore.run_score_media(partitur)


def test_meldet_ungueltiges_json_getrennt(monkeypatch, partitur):
    # Anderer Befund als "Marker fehlt" und deshalb eine andere Meldung -
    # sonst sucht man bei einer abgeschnittenen Ausgabe am falschen Ende.
    fake_run(monkeypatch, b"Rauschen\n{\n das ist kein JSON")

    with pytest.raises(RuntimeError, match="not valid JSON"):
        musescore.run_score_media(partitur)


def test_meldet_exitcode_mit_stderr_auszug(monkeypatch, partitur):
    fake_run(monkeypatch, b"", returncode=124, stderr=b"getoetet nach timeout")

    with pytest.raises(RuntimeError, match="exited 124") as exc:
        musescore.run_score_media(partitur)
    assert "getoetet nach timeout" in str(exc.value)


def test_ruft_mscore_mit_timeout_und_xvfb_auf(monkeypatch, tmp_path):
    # xvfb-run ist Pflicht (mscore4portable braucht auch fuer reine
    # CLI-Konvertierung einen X-Server), timeout ist die harte Schranke
    # gegen einen haengenden Prozess. Beides darf bei einem Umbau nicht
    # stillschweigend wegfallen.
    nutzlast = {"svgs": ["abc"]}
    calls = fake_run(monkeypatch, b"\n" + json.dumps(nutzlast, indent=1).encode())
    eingabe = tmp_path / "eingabe.mscz"

    musescore.run_score_media(eingabe)

    cmd, _ = calls[0]
    assert cmd[0] == "timeout"
    assert "--signal=KILL" in cmd
    assert "xvfb-run" in cmd
    assert cmd[-1] == "--score-media"
    assert str(eingabe) in cmd


def test_nutzt_die_displaynummer_des_platzes_statt_xvfb_run_a(monkeypatch, partitur):
    # `xvfb-run -a` laesst zwei gleichzeitig startende Laeufe dieselbe freie
    # Nummer finden; einer scheitert dann mit "Xvfb failed to start". Die
    # Nummer kommt deshalb vom Konvertierungsplatz.
    calls = fake_run(monkeypatch, b"\n" + json.dumps({"svgs": ["abc"]}, indent=1).encode())

    musescore.run_score_media(partitur, display=123)

    cmd, _ = calls[0]
    assert "-a" not in cmd
    assert cmd[cmd.index("-n") + 1] == "123"


def test_xauthority_liegt_im_arbeitsverzeichnis(monkeypatch, partitur):
    # Sonst legte xvfb-run sie in ein eigenes Verzeichnis unter /tmp, das
    # nach einem SIGKILL liegen bliebe - im Arbeitsverzeichnis raeumt sie
    # der Reaper mit weg.
    calls = fake_run(monkeypatch, b"\n" + json.dumps({"svgs": ["abc"]}, indent=1).encode())

    musescore.run_score_media(partitur)

    cmd, _ = calls[0]
    assert cmd[cmd.index("-f") + 1] == str(partitur.parent / "Xauthority")


def test_verwirft_png_pdf_und_mxml(monkeypatch, partitur):
    # M2: nie gebraucht - und zusammen ein guter Teil des Speichers, der
    # sonst die ganze Weiterverarbeitung ueber belegt bliebe.
    nutzlast = {"svgs": ["abc"], "pngs": ["x"], "pdf": "y", "mxml": "z", "midi": "m"}
    fake_run(monkeypatch, QT_RAUSCHEN + b"\n" + json.dumps(nutzlast, indent=1).encode())

    assert musescore.run_score_media(partitur) == {"svgs": ["abc"], "midi": "m"}


def test_leere_ausgabe_meldet_fehlenden_marker(monkeypatch, partitur):
    # Eine leere Datei laesst sich nicht mmappen - das darf nicht als
    # ValueError durchschlagen, sondern ist derselbe Befund wie "kein JSON".
    fake_run(monkeypatch, b"")

    with pytest.raises(RuntimeError, match="no recognizable JSON"):
        musescore.run_score_media(partitur)


def test_benennt_den_timeout(monkeypatch, partitur):
    # `timeout --signal=KILL` trifft seine eigene Prozessgruppe mit, der
    # Aufrufer sieht -9 und kein stderr - ohne eigene Meldung bliebe nur
    # ein nichtssagendes "exited -9".
    fake_run(monkeypatch, b"", returncode=-9)

    with pytest.raises(RuntimeError, match="MSCORE_TIMEOUT_SECONDS"):
        musescore.run_score_media(partitur)
