"""WSGI-Einstiegspunkt fuer gunicorn.

Flasks eingebauter Entwicklungsserver (``app.run(...)``) waere hier fehl am
Platz - Werkzeug warnt beim Start selbst davor, und zu Recht: kein
Worker-Management, kein definiertes Verhalten unter Last, kein Neustart
nach dem Absturz eines Threads.

**Genau ein Worker, mehrere Threads** (siehe Dockerfile). Die Job-Registry
liegt im Speicher des Prozesses (``jobs.JOBS``); mit mehreren Workern
landete eine Statusabfrage irgendwann bei einem Prozess, der den Job nie
gesehen hat - und zwar sporadisch und schwer erklaerbar. Die Zahl der
gleichzeitigen KONVERTIERUNGEN begrenzt stattdessen das Semaphor in
``jobs`` (SCOREVIEW_MAX_CONCURRENT), unabhaengig von der Zahl der
HTTP-Threads.
"""

from scoreview_sidecar.app import create_app

app = create_app()
