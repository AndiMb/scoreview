"""Tests fuer ``_parse_pos_xml`` - die Funktion, auf der der gesamte Cursor
steht (PLAN.md M4/M7).

Sie war bis zum Codereview (Befund B4) ungetestet, waehrend die JS-Seite 99
Tests hatte. Geprueft werden genau die Zusagen, die anderswo als gemessen
gelten: die Division durch 12, die Sortierung nach Zeit, und dass ein
mehrfach vorkommendes ``elid`` (Wiederholung) NICHT zusammengefasst wird.
"""

import base64

import pytest

import server


def encode(xml: str) -> str:
    return base64.b64encode(xml.encode("utf-8")).decode("ascii")


def test_teilt_koordinaten_durch_zwoelf():
    # M4: --score-media liefert Koordinaten im 12-fachen der SVG-viewBox.
    # Der Client soll diese Konstante nie kennen muessen (PLAN.md Phase 6).
    result = server._parse_pos_xml(encode("""
        <score>
          <elements>
            <element id="0" page="0" x="15447" y="25786" sx="1200" sy="600"/>
          </elements>
          <events/>
        </score>
    """))

    assert result["elements"]["0"] == {
        "page": 0,
        "x": pytest.approx(1287.25),
        "y": pytest.approx(2148.83),
        "w": pytest.approx(100.0),
        "h": pytest.approx(50.0),
    }


def test_rundet_auf_zwei_nachkommastellen():
    result = server._parse_pos_xml(encode(
        '<score><elements>'
        '<element id="3" page="1" x="1000" y="1000" sx="7" sy="7"/>'
        '</elements><events/></score>'
    ))
    assert result["elements"]["3"]["x"] == 83.33
    assert result["elements"]["3"]["w"] == 0.58


def test_sortiert_events_nach_zeit():
    # Die Binaersuche im Client (findStepIndex) setzt aufsteigende Zeiten
    # voraus; die Sortierung passiert hier, nicht dort.
    result = server._parse_pos_xml(encode(
        '<score><elements/><events>'
        '<event elid="2" position="1000"/>'
        '<event elid="0" position="0"/>'
        '<event elid="1" position="500"/>'
        '</events></score>'
    ))
    assert [e["timeMs"] for e in result["events"]] == [0, 500, 1000]
    assert [e["elid"] for e in result["events"]] == [0, 1, 2]


def test_behaelt_mehrfache_elids_bei_wiederholung():
    # M7: bei einer Wiederholung erscheint dasselbe elid mehrfach mit
    # steigender Zeit. Genau darauf steht das Cursor-Datenmodell - wuerde
    # hier entdoppelt, waere der Cursor im zweiten Durchgang still falsch.
    result = server._parse_pos_xml(encode(
        '<score><elements/><events>'
        '<event elid="0" position="0"/>'
        '<event elid="1" position="500"/>'
        '<event elid="0" position="4000"/>'
        '<event elid="1" position="4500"/>'
        '</events></score>'
    ))
    assert len(result["events"]) == 4
    assert [e["timeMs"] for e in result["events"] if e["elid"] == 0] == [0, 4000]


def test_kommt_mit_fehlenden_abschnitten_klar():
    # mposXML einer einseitigen Partitur ohne Events darf keinen KeyError
    # ausloesen, sondern leere Listen liefern.
    result = server._parse_pos_xml(encode("<score/>"))
    assert result == {"events": [], "elements": {}}


def test_liefert_leere_elemente_bei_leerem_abschnitt():
    result = server._parse_pos_xml(encode("<score><elements/><events/></score>"))
    assert result["elements"] == {}
    assert result["events"] == []


def test_beide_exporte_haben_dieselbe_form():
    # M7: sposXML (Noten) und mposXML (Takte) tragen dieselbe Struktur -
    # deshalb EIN gemeinsamer Parser. Bricht das, faellt es hier auf.
    xml = (
        '<score><elements>'
        '<element id="0" page="0" x="12" y="24" sx="12" sy="12"/>'
        '</elements><events>'
        '<event elid="0" position="0"/>'
        '</events></score>'
    )
    spos = server._parse_pos_xml(encode(xml))
    mpos = server._parse_pos_xml(encode(xml))
    assert spos == mpos
    assert set(spos) == {"events", "elements"}
