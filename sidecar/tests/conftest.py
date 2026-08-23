"""Macht ``server`` importierbar, ohne den Container zu starten.

``server.py`` erzwingt beim Import ein Secret (bewusst - ein
unauthentifizierter Konvertierungsdienst soll gar nicht erst hochkommen),
legt ``JOBS_DIR`` an und startet den Reaper-Thread. Fuer reine Unit-Tests
der Parserfunktionen wird das hier vorab gesetzt bzw. in ein tmp-Verzeichnis
umgelenkt, statt die Modulstruktur dafuer umzubauen - das Aufteilen von
server.py steht als eigener Befund (B3) in Schritt 5 an, und die Tests
sollen VORHER da sein, nicht danach.
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
