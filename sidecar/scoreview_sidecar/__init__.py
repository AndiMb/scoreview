"""ScoreView sidecar: MuseScore 4 behind a small HTTP API.

Vier Module mit klar getrennter Verantwortung:

* ``config``    - alles aus der Umgebung, einmal beim Import gelesen
* ``musescore`` - der ``--score-media``-Aufruf und das Parsen (ohne Flask,
                  ohne Job-Registry - das ist der unit-getestete Teil)
* ``jobs``      - Job-Registry, Konvertierungs-Thread, Reaper
* ``app``       - nur noch die Routen
"""
