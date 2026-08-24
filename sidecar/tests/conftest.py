"""Macht ``scoreview_sidecar`` importierbar, ohne den Container zu starten.

``config`` erzwingt beim Import ein Secret (bewusst - ein
unauthentifizierter Konvertierungsdienst soll gar nicht erst hochkommen) und
legt ``JOBS_DIR`` an. Beides wird hier vorab gesetzt bzw. in ein
tmp-Verzeichnis umgelenkt.

Seit Phase 23/Schritt 5 ist der Reaper-Thread kein Import-Nebeneffekt mehr,
sondern haengt an ``create_app()`` - Tests, die nur die Parserfunktionen
brauchen, starten also gar nichts mehr.
"""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("SCOREVIEW_SIDECAR_SECRET", "test-secret")
os.environ.setdefault(
    "SCOREVIEW_JOBS_DIR", tempfile.mkdtemp(prefix="scoreview-jobs-test-")
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
