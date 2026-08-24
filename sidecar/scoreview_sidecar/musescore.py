"""Everything that talks to MuseScore, and the parsing of what it returns.

Split out of the former single-file ``server.py`` in Phase 23/step 5 (code
review finding B3). Deliberately free of Flask and of the job registry: the
two functions here are the ones the unit tests in ``tests/`` cover, and they
should be importable without starting a web application.

Previously (Phase 3) this ran three separate `mscore4portable` invocations
(-o score.musicxml / audio.mp3 / score.spos) because MuseScore 4 does not
reliably honour multiple `-o` flags in one call. `--score-media` sidesteps
that entirely: one process, one JSON blob on stdout containing every
artifact MuseScore can produce for the score (see M2). We keep svgs, midi,
sposXML, mposXML and metadata; pngs/pdf/mxml are decoded only to be
discarded (see PLAN.md "Was ersatzlos entfaellt").
"""

import base64
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from . import config


def run_score_media(input_path: Path) -> dict:
    # Mirrors entrypoint.sh (Phase 1 spike): xvfb-run because
    # mscore4portable needs an X server even for pure CLI conversion,
    # timeout as a hard guard against MuseScore hanging on unusual input
    # (Risiko "MuseScore-Sicherheitsluecke ueber praeparierte .mscz").
    cmd = [
        "timeout", "--signal=KILL", config.TIMEOUT_SECONDS,
        "xvfb-run", "-a", "-s",
        "-screen 0 640x480x24 -ac +extension GLX +render -noreset",
        config.MSCORE_BIN, str(input_path), "--score-media",
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"mscore4portable --score-media exited {result.returncode}: "
            f"{result.stderr[-2000:].decode('utf-8', 'replace')}"
        )

    # M3: MuseScore writes ~12 lines of Qt log noise (locale warning, DBus
    # errors) to stdout BEFORE the JSON payload - a naive json.loads(stdout)
    # fails. The JSON always starts at the first "\n{\n" (known MuseScore
    # behaviour, issue #13304) - this must not work "by accident", so we
    # fail loudly if that marker is missing instead of silently returning
    # nothing.
    stdout = result.stdout
    marker = stdout.find(b"\n{\n")
    if marker == -1:
        raise RuntimeError(
            "mscore4portable --score-media produced no recognizable JSON "
            "payload on stdout (missing '\\n{\\n' marker) - output format "
            "may have changed."
        )
    try:
        return json.loads(stdout[marker + 1:])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"mscore4portable --score-media stdout was not valid JSON: {exc}") from exc


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

    Separate from the route (Phase 23/step 5) so that it is testable without
    a request context, and so the route stays what it should be: an entry
    point, not a place where knowledge lives.

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
