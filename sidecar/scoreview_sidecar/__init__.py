"""ScoreView sidecar: two renderers - the scoreview-engine and MuseScore 4 -
behind a small HTTP API.

Fuenf Module mit klar getrennter Verantwortung:

* ``config``    - alles aus der Umgebung, einmal beim Import gelesen
* ``musescore`` - der ``--score-media``-Aufruf und das Parsen (ohne Flask,
                  ohne Job-Registry - das ist der unit-getestete Teil)
* ``engine``    - the call of the app's converter under Node, as on the
                  local path (likewise without Flask and registry)
* ``jobs``      - Job-Registry, Konvertierungs-Thread, Reaper
* ``app``       - nur noch die Routen
"""
