"""ScoreView sidecar: MuseScore 4 behind a small HTTP API.

Aufgeteilt in Phase 23/Schritt 5 (Codereview-Befund B3) aus der bis dahin
einzigen Datei ``server.py`` (515 Zeilen mit Konfiguration, Job-Registry,
MuseScore-Aufruf, XML-Parsing und zwoelf Routen):

* ``config``    - alles aus der Umgebung, einmal beim Import gelesen
* ``musescore`` - der ``--score-media``-Aufruf und das Parsen (ohne Flask,
                  ohne Job-Registry - das ist der unit-getestete Teil)
* ``jobs``      - Job-Registry, Konvertierungs-Thread, Reaper
* ``app``       - nur noch die Routen
"""
