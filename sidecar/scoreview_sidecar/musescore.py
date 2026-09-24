"""Everything that talks to MuseScore, and the parsing of what it returns.

Deliberately free of Flask and of the job registry: the two functions here
are the ones the unit tests in ``tests/`` cover, and they should be
importable without starting a web application.

MuseScore 4 does not reliably honour multiple `-o` flags in one call, so
producing musicxml/audio/spos artifacts separately would need three
separate `mscore4portable` invocations (-o score.musicxml / audio.mp3 /
score.spos). `--score-media` sidesteps that entirely: one process, one JSON
blob on stdout containing every artifact MuseScore can produce for the
score (see M2). We keep svgs, midi, sposXML, mposXML and metadata;
pngs/pdf/mxml are parsed only to be discarded (see docs/architecture.md M2).
"""

import base64
import json
import mmap
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from . import config


# Teile der `--score-media`-Ausgabe, die nie gebraucht werden (M2). Sie
# werden direkt nach dem Parsen verworfen, damit sie nicht die ganze
# Weiterverarbeitung ueber im Speicher liegen - PNG und PDF sind zusammen
# ein guter Teil der Gesamtgroesse.
DISCARDED_KEYS = ("pngs", "pdf", "mxml")

# subprocess meldet "durch Signal 9 beendet" als -9. Als Zahl statt
# -signal.SIGKILL, weil es SIGKILL unter Windows nicht gibt und die
# Unit-Tests auch dort laufen sollen.
_KILLED_BY_SIGKILL = -9


def _clear_stale_display(display: int) -> None:
    """Entfernt, was ein per SIGKILL beendetes Xvfb auf `display` liegen
    liess.

    `timeout --signal=KILL` trifft die ganze Prozessgruppe (timeout legt
    eine eigene an), also auch xvfb-run - dessen Aufraeum-Trap laeuft dann
    nie, und /tmp/.X<n>-lock bleibt stehen. Mit `xvfb-run -a` verbrauchte
    das bei jedem Timeout eine Displaynummer. Mit fester Nummer je Platz
    haette Xvfb eine verwaiste Sperre zwar selbst erkannt, aber nur ueber
    die darin stehende PID; im Container werden PIDs schnell wieder
    vergeben, und eine zufaellig lebende fremde PID liesse den Platz
    dauerhaft scheitern. Wegraeumen ist sicher, weil der Aufrufer den Platz
    - und damit diese Displaynummer - exklusiv haelt."""
    for leftover in (Path(f"/tmp/.X{display}-lock"), Path(f"/tmp/.X11-unix/X{display}")):
        try:
            leftover.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            # Nicht unser Problem zu loesen: scheitert Xvfb daran, meldet der
            # Lauf das als Fehler mit stderr-Auszug.
            pass


def run_score_media(input_path: Path, display: int = config.FIRST_DISPLAY_NUMBER) -> dict:
    """Laesst `--score-media` auf `input_path` laufen und gibt das JSON
    zurueck, ohne die Teile aus DISCARDED_KEYS.

    `display` ist die Xvfb-Displaynummer des Konvertierungsplatzes, den der
    Aufrufer haelt (siehe jobs.conversion_slot). Eine feste Nummer statt
    `xvfb-run -a`: -a sucht die erste Nummer ohne Sperrdatei und startet
    erst danach Xvfb - zwei gleichzeitig startende Konvertierungen koennen
    dabei dieselbe freie Nummer finden, und eine scheitert dann mit "Xvfb
    failed to start".
    """
    # Mirrors entrypoint.sh: xvfb-run because
    # mscore4portable needs an X server even for pure CLI conversion,
    # timeout as a hard guard against MuseScore hanging on unusual input
    # (Risiko "MuseScore-Sicherheitsluecke ueber praeparierte .mscz").
    workdir = input_path.parent
    cmd = [
        "timeout", "--signal=KILL", config.TIMEOUT_SECONDS,
        # -f: ohne diese Angabe legt xvfb-run seine Xauthority in einem
        # `mktemp -d` unter /tmp ab und raeumt es nur in dem Trap weg, den
        # ein SIGKILL ueberspringt. Im Arbeitsverzeichnis verschwindet sie
        # mit diesem. Bewusst nicht ueber TMPDIR: das verlegte auch Qts
        # qipc-Schluesseldateien je Auftrag, und gleichzeitige
        # MuseScore-Instanzen teilten sich dann nicht mehr die Sperre auf
        # ihre gemeinsamen Einstellungen im HOME.
        "xvfb-run", "-n", str(display), "-f", str(workdir / "Xauthority"), "-s",
        "-screen 0 640x480x24 -ac +extension GLX +render -noreset",
        config.MSCORE_BIN, str(input_path), "--score-media",
    ]
    _clear_stale_display(display)

    # Ausgabe in anonyme Dateien statt in Pipes (capture_output): stdout ist
    # das komplette JSON samt PNG/PDF als base64 und liegt so nicht waehrend
    # des Laufs in wachsenden Puffern und danach noch einmal zusammengefuegt
    # im Speicher. Nebenbei kann kein Enkelprozess, der den SIGKILL
    # ueberlebt und die Pipe offen haelt, das Einsammeln ewig blockieren -
    # eine Datei hat kein "Ende", auf das gewartet wird.
    with tempfile.TemporaryFile(dir=workdir) as out, tempfile.TemporaryFile(dir=workdir) as err:
        result = subprocess.run(cmd, stdout=out, stderr=err)
        if result.returncode == _KILLED_BY_SIGKILL:
            # `timeout` schickt SIGKILL an seine ganze Prozessgruppe, also
            # auch an sich selbst - der Aufrufer sieht dann -9 statt 124/137
            # und kein stderr (xvfb-run legt MuseScores stderr ohnehin auf
            # stdout). Ohne diese Zeile stuende da nur "exited -9: ".
            raise RuntimeError(
                "mscore4portable --score-media exceeded the time limit "
                f"(MSCORE_TIMEOUT_SECONDS={config.TIMEOUT_SECONDS}) and was killed"
            )
        if result.returncode != 0:
            raise RuntimeError(
                f"mscore4portable --score-media exited {result.returncode}: "
                f"{_tail(err, 2000).decode('utf-8', 'replace')}"
            )
        payload = _json_payload(out)

    # Selbst dekodieren statt json.loads(bytes): so ist das bytes-Objekt
    # schon freigegeben, waehrend geparst wird. Rechnerisch liegt die Spitze
    # damit bei ~2x statt ~4x der Ausgabegroesse (vorher gleichzeitig: das
    # gesammelte stdout, der Slice ab dem Marker, der intern dekodierte str
    # und das Ergebnis).
    text = payload.decode("utf-8")
    del payload
    try:
        media = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"mscore4portable --score-media stdout was not valid JSON: {exc}") from exc
    finally:
        del text
    if isinstance(media, dict):
        for key in DISCARDED_KEYS:
            media.pop(key, None)
    return media


def _tail(fh, limit: int) -> bytes:
    fh.seek(0, os.SEEK_END)
    size = fh.tell()
    fh.seek(max(0, size - limit))
    return fh.read()


def _json_payload(fh) -> bytes:
    """Liest stdout ab dem Beginn des JSON.

    M3: MuseScore writes ~12 lines of Qt log noise (locale warning, DBus
    errors) to stdout BEFORE the JSON payload - a naive json.loads(stdout)
    fails. The JSON always starts at the first "\\n{\\n" (known MuseScore
    behaviour, issue #13304) - this must not work "by accident", so we
    fail loudly if that marker is missing instead of silently returning
    nothing.

    Gesucht wird ueber mmap, gelesen erst ab dem Marker: das Rauschen davor
    wird nie kopiert, und die Nutzlast liegt genau einmal als bytes vor.
    """
    fh.flush()
    size = fh.seek(0, os.SEEK_END)
    marker = -1
    if size:
        with mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as view:
            marker = view.find(b"\n{\n")
    if marker == -1:
        raise RuntimeError(
            "mscore4portable --score-media produced no recognizable JSON "
            "payload on stdout (missing '\\n{\\n' marker) - output format "
            "may have changed."
        )
    fh.seek(marker + 1)
    return fh.read()


def parse_pos_xml(pos_xml_b64: str) -> dict:
    """Parses a base64-encoded spos/mpos XML blob into
    {"events": [{"elid", "timeMs"}], "elements": {"<elid>": {"page","x","y","w","h"}}}.

    Coordinates are scaled from --score-media units into SVG units once
    here (see SPOS_TO_SVG_SCALE / M4). Kept as one shared helper for both
    sposXML (-> timing.json) and mposXML (-> measures.json): both files
    have the identical `<score><elements>/<events></score>` shape (M7).
    """
    scale = config.SPOS_TO_SVG_SCALE
    xml_text = base64.b64decode(pos_xml_b64).decode("utf-8")
    root = ET.fromstring(xml_text)

    elements = {}
    elements_el = root.find("elements")
    if elements_el is not None:
        for el in elements_el.findall("element"):
            elements[el.get("id")] = {
                "page": int(el.get("page")),
                "x": round(float(el.get("x")) / scale, 2),
                "y": round(float(el.get("y")) / scale, 2),
                "w": round(float(el.get("sx")) / scale, 2),
                "h": round(float(el.get("sy")) / scale, 2),
            }

    events = []
    events_el = root.find("events")
    if events_el is not None:
        events = sorted(
            (
                {"elid": int(e.get("elid")), "timeMs": int(e.get("position"))}
                for e in events_el.findall("event")
            ),
            key=lambda e: e["timeMs"],
        )

    return {"events": events, "elements": elements}


def check_promises(media: dict) -> tuple[list[str], dict]:
    """Checks a `--score-media` result against the promises the rest of the
    app is built on (M2/M4/M7) - the substance of ``GET /selftest``.

    Separate from the route so that it is testable without a request
    context, and so the route stays what it should be: an entry point, not
    a place where knowledge lives.

    Every violated promise is named individually, so that a MuseScore version
    change is diagnosable rather than merely "broken".
    """
    problems = []
    for key in ("svgs", "sposXML", "mposXML", "midi", "metadata"):
        if not media.get(key):
            problems.append(f"Schluessel '{key}' fehlt oder ist leer")

    pages = len(media.get("svgs") or [])
    if pages < 1:
        problems.append("keine SVG-Seite geliefert")

    timing = parse_pos_xml(media["sposXML"]) if media.get("sposXML") else {"events": [], "elements": {}}
    events = timing.get("events") or []
    elements = timing.get("elements") or {}
    if not events:
        problems.append("sposXML enthaelt keine Events")
    if not elements:
        problems.append("sposXML enthaelt keine Elementkoordinaten")

    # M7: bar 1 of the bundled score is repeated, so its elid must appear
    # MORE THAN ONCE with increasing time. That is the promise the cursor
    # data model rests on - if it breaks, the cursor is silently wrong on
    # repeats rather than visibly broken.
    elid_counts = {}
    for e in events:
        elid_counts[e["elid"]] = elid_counts.get(e["elid"], 0) + 1
    if not any(c > 1 for c in elid_counts.values()):
        problems.append(
            "kein elid kommt mehrfach vor - Wiederholung wird nicht mehr "
            "ausgerollt (M7 verletzt)"
        )

    times = [e["timeMs"] for e in events]
    if times != sorted(times):
        problems.append("Event-Zeiten sind nicht monoton steigend")

    return problems, {
        "pages": pages,
        "events": len(events),
        "elements": len(elements),
        "repeatedElids": sum(1 for c in elid_counts.values() if c > 1),
    }
