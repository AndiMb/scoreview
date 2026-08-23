"""Tests fuer ``run_score_media`` - insbesondere fuer M3.

MuseScore schreibt rund zwoelf Zeilen Qt-Logausgabe (Locale-Warnung,
DBus-Fehler) VOR das JSON auf stdout; das JSON beginnt erst beim ersten
``\\n{\\n``. Das ist bekanntes Verhalten (MuseScore-Issue #13304) und darf
laut PLAN.md "nicht per Zufall funktionieren". Bis zum Codereview war genau
diese Stelle ungetestet - sie faellt erst auf, wenn eine neue
MuseScore-Version das Ausgabeformat aendert, und dann als unspezifischer
Konvertierungsfehler.

``subprocess.run`` wird ersetzt, damit die Tests ohne MuseScore, ohne Xvfb
und in Millisekunden laufen. Was der Prozess selbst liefert, prueft der
Selbsttest gegen das echte Image (``GET /selftest``, Phase 21).
"""

import json
import subprocess
from pathlib import Path

import pytest

import server


class FakeCompletedProcess:
    def __init__(self, stdout: bytes, returncode: int = 0, stderr: bytes = b""):
        self.stdout = stdout
        self.returncode = returncode
        self.stderr = stderr


def fake_run(monkeypatch, stdout: bytes, returncode: int = 0, stderr: bytes = b""):
    calls = []

    def _run(cmd, **kwargs):
        calls.append(cmd)
        return FakeCompletedProcess(stdout, returncode, stderr)

    monkeypatch.setattr(subprocess, "run", _run)
    return calls


QT_RAUSCHEN = (
    b'qt.qpa.xcb: could not connect to display\n'
    b'Warning: Ignoring XDG_SESSION_TYPE=wayland\n'
    b'QDBusConnection: session D-Bus connection created before QCoreApplication\n'
)


def test_schneidet_qt_rauschen_vor_dem_json_weg(monkeypatch):
    nutzlast = {"svgs": ["abc"], "metadata": {"pages": 1}}
    stdout = QT_RAUSCHEN + b"\n" + json.dumps(nutzlast, indent=1).encode()
    fake_run(monkeypatch, stdout)

    assert server.run_score_media(Path("egal.mscz")) == nutzlast


def test_findet_json_auch_ohne_vorheriges_rauschen(monkeypatch):
    # Falls MuseScore irgendwann sauberes stdout liefert, darf der Parser
    # nicht dadurch brechen, dass er das Rauschen ERWARTET.
    nutzlast = {"svgs": ["abc"]}
    fake_run(monkeypatch, b"\n" + json.dumps(nutzlast, indent=1).encode())

    assert server.run_score_media(Path("egal.mscz")) == nutzlast


def test_meldet_fehlenden_json_marker_deutlich(monkeypatch):
    # Der Kernpunkt aus M3: kein stilles Leerlaufen, sondern ein Fehler, der
    # sagt, dass sich das Ausgabeformat geaendert haben koennte.
    fake_run(monkeypatch, b"nur Rauschen, kein JSON\n")

    with pytest.raises(RuntimeError, match="no recognizable JSON"):
        server.run_score_media(Path("egal.mscz"))


def test_meldet_ungueltiges_json_getrennt(monkeypatch):
    # Anderer Befund als "Marker fehlt" und deshalb eine andere Meldung -
    # sonst sucht man bei einer abgeschnittenen Ausgabe am falschen Ende.
    fake_run(monkeypatch, b"Rauschen\n{\n das ist kein JSON")

    with pytest.raises(RuntimeError, match="not valid JSON"):
        server.run_score_media(Path("egal.mscz"))


def test_meldet_exitcode_mit_stderr_auszug(monkeypatch):
    fake_run(monkeypatch, b"", returncode=124, stderr=b"getoetet nach timeout")

    with pytest.raises(RuntimeError, match="exited 124") as exc:
        server.run_score_media(Path("egal.mscz"))
    assert "getoetet nach timeout" in str(exc.value)


def test_ruft_mscore_mit_timeout_und_xvfb_auf(monkeypatch):
    # xvfb-run ist Pflicht (mscore4portable braucht auch fuer reine
    # CLI-Konvertierung einen X-Server), timeout ist die harte Schranke
    # gegen einen haengenden Prozess (Risiko 6 im Plan). Beides darf bei
    # einem Umbau nicht stillschweigend wegfallen.
    nutzlast = {"svgs": ["abc"]}
    calls = fake_run(monkeypatch, b"\n" + json.dumps(nutzlast, indent=1).encode())

    server.run_score_media(Path("/data/eingabe.mscz"))

    cmd = calls[0]
    assert cmd[0] == "timeout"
    assert "--signal=KILL" in cmd
    assert "xvfb-run" in cmd
    assert cmd[-1] == "--score-media"
    assert str(Path("/data/eingabe.mscz")) in cmd
