# MuseScore-Sidecar

Der Konvertierungsdienst hinter ScoreView: ein Docker-Image mit einer gepinnten
MuseScore-Studio-Version, die als extrahiertes AppImage headless unter
`xvfb-run` läuft, und einer kleinen HTTP-API davor (Paket `scoreview_sidecar`,
gestartet über `wsgi.py` mit gunicorn).

Er läuft als eigener Container neben Nextcloud und ist **nicht** Teil des
App-Pakets. Er ist einer von zwei Konvertierungswegen – der andere kommt ohne
Container aus und liegt im App-Paket. Beide erzeugen dieselben Artefakte; wann
welcher die bessere Wahl ist, steht unter
[E3](../docs/architecture.md#e3-zwei-konvertierungswege-hinter-einer-api).

## Build und Start

```sh
docker build -t scoreview-musescore-cli sidecar/

docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET=<zufälliges-secret> \
  --memory=2g --pids-limit=512 \
  scoreview-musescore-cli
```

`SCOREVIEW_SIDECAR_SECRET` ist Pflicht – ohne die Variable startet der Container
absichtlich **nicht**. Ein unauthentifizierter Dienst, der beliebige Dateien
entgegennimmt und darauf MuseScore loslässt, soll nicht aus Versehen entstehen.

**`--network` ist kein Detail.** Auf Dockers Standard-Bridge gibt es keine
Namensauflösung zwischen Containern; `http://scoreview-sidecar:8765` – die
Adresse, die in den Admin-Einstellungen steht – läuft dann ins Leere, während
`curl` vom Host aus tadellos funktioniert. Der Container startet trotzdem
fehlerfrei, und die Betriebsdiagnose meldet nur „Konvertierungsdienst nicht
erreichbar". Beide Container müssen in dasselbe benutzerdefinierte Netz; der
Netzname hängt von der Installation ab, deshalb steht hier ein Beispiel und kein
fertiger Befehl. Einrichtung siehe
[Installation](../docs/installation.md#1a-weg-a-sidecar-starten).

Der Port muss nur dann nach außen veröffentlicht werden (`-p 8765:8765`), wenn
etwas anderes als Nextcloud selbst zugreift.

## Konfiguration

Alle Variablen außer dem Secret sind optional.

| Variable | Default | Bedeutung |
|---|---|---|
| `SCOREVIEW_SIDECAR_SECRET` | – | **Pflicht.** Shared Secret, Header `X-ScoreView-Secret` |
| `MSCORE_TIMEOUT_SECONDS` | `600` | Harter Timeout-Guard pro Konvertierung |
| `SCOREVIEW_MAX_UPLOAD_BYTES` | `209715200` | Upload-Limit (200 MB); größere Requests werden mit `413` abgelehnt, bevor MuseScore startet |
| `SCOREVIEW_JOB_TTL_SECONDS` | `600` | Wie lange die Dateien eines fertigen Jobs abrufbar bleiben |
| `SCOREVIEW_MAX_CONCURRENT` | `2` | Gleichzeitig laufende Konvertierungen |
| `SCOREVIEW_JOBS_DIR` | `/tmp/scoreview-jobs` | Arbeitsverzeichnis für laufende Jobs |
| `SCOREVIEW_SOUNDFONT_PATH` | automatische Suche | Welches SoundFont `GET /soundfont` ausliefert |

**Zum Timeout:** Eine Konvertierung braucht gemessen rund **5,4 s pro
gerenderter Seite** plus etwa 1 s Grundlast. 600 s decken damit rechnerisch
~110 Seiten ab. Wer sehr große Partituren erwartet, rechnet mit
`Seitenzahl × 5,4 s + Puffer` hoch; die Zahl hängt spürbar von der CPU ab und ist
als Größenordnung zu lesen, nicht als Garantie. Siehe
[Grenzwerte](../docs/limits.md).

**Zum SoundFont:** Ohne Angabe wird der erste vorhandene Kandidat genommen, in
dieser Reihenfolge: `/usr/share/sounds/sf3/MuseScore_General_Lite.sf3`,
`…/MuseScore_General.sf3`, `…/default-GM.sf3`. Alle drei stammen aus dem
Debian-Paket `musescore-general-soundfont-small` (MuseScore General von
S. Christian Collins, MIT) und überleben das `apt-get remove musescore` im
Dockerfile, weil sie in einem eigenen Paket liegen.

Das ebenfalls im Image liegende `MS Basic.sf3` aus dem AppImage ist bewusst
**nicht** Default: Es steht unter MuseScores eigenen Bedingungen statt unter
einer schlichten permissiven Lizenz, seine Weiterverteilung an Browser ist
deshalb eine Betreiberentscheidung. Wer es – oder ein beliebiges anderes SF2/SF3
– verwenden will, setzt `SCOREVIEW_SOUNDFONT_PATH`.

## Sicherheit

Der Container lässt eine große C++/Qt-Codebasis (`mscore4portable`) auf
beliebige, nicht vertrauenswürdige `.mscz`-Uploads los. Deshalb:

- Der Konvertierungsprozess läuft **nicht als root** (eigener
  `scoreview`-Nutzer im Image).
- `--memory` und `--pids-limit` sind für den Produktivbetrieb empfohlen.
- Alle Endpunkte außer `/health` verlangen das Shared Secret.
- Wer den Dienst über eine Maschinengrenze hinweg betreibt, braucht TLS davor.

`--network none` ist **nicht** möglich: Derselbe Container bedient die HTTP-API,
über die die Konvertierung überhaupt erst eingereicht wird. Eine echte
Netzwerk-Isolation nur für den `mscore4portable`-Subprozess bräuchte eine eigene
Sandbox-Schicht innerhalb des Containers – ein offenes Architekturthema, kein
`docker run`-Flag. Siehe [Grenzwerte](../docs/limits.md#was-die-app-bewusst-nicht-tut).

## HTTP-API

Asynchrone Job-API; ein Container läuft dauerhaft. Alle Endpunkte außer
`/health` verlangen den Header `X-ScoreView-Secret`.

### Konvertierung

- **`POST /convert`** – Multipart-Feld `file` = `.mscz`. Antwortet
  `202 {"jobId": "..."}`; die Konvertierung läuft im Hintergrund.
- **`GET /convert/{jobId}`** –
  `{"status": "pending"|"processing"|"ready"|"error", ...}`. Bei `ready`
  zusätzlich `files`:

  ```json
  {
    "pages": ["/convert/{jobId}/artifact/page-1", "/convert/{jobId}/artifact/page-2", "..."],
    "midi": "/convert/{jobId}/artifact/midi",
    "timingJson": "/convert/{jobId}/artifact/timing",
    "measuresJson": "/convert/{jobId}/artifact/measures",
    "metaJson": "/convert/{jobId}/artifact/meta"
  }
  ```

  Bei `error` zusätzlich `error` (Freitext aus der fehlgeschlagenen
  `mscore4portable`-Ausgabe).
- **`GET /convert/{jobId}/artifact/{name}`** – **eine** Auslieferungsroute für
  alle Artefakte. Gültige Namen sind eine Allowlist, kein Dateipfad:

  | Name | Inhalt |
  |---|---|
  | `page-{n}` | SVG-Seite `n` (1-indiziert) |
  | `midi` | MIDI-Datei – die Synthese passiert im Browser, hier gibt es kein fertiges Audio |
  | `timing` | `timing.json`, aus `sposXML` geparst (treibt den Cursor) |
  | `measures` | `measures.json`, aus `mposXML` geparst (Taktnavigation) |
  | `meta` | `meta.json`, MuseScores `metadata` unverändert (Titel, Takte, `tracks[]`/`parts[]`) |

Fehlerpfade: unbekannte `jobId` → 404, fehlendes `file`-Feld → 400,
fehlendes oder falsches Secret → 401 – auch auf den Artefakt-Endpunkten. Die
Existenz eines Jobs wird erst **nach** der Secret-Prüfung offengelegt. Eine
defekte `.mscz` landet sichtbar auf `status: error`, statt zu hängen.

### Diagnose

- **`GET /health`** – ohne Auth, liefert `ok`.
- **`GET /selftest`** – konvertiert die mitgelieferte Minipartitur
  (`selftest-score.mscz`, Kopie von `testdata/repeat-test.mscz`) und prüft das
  Ergebnis auf die Zusagen, auf denen die App aufbaut: alle erwarteten
  `--score-media`-Schlüssel vorhanden, mindestens eine SVG-Seite, Timing-Events
  und Elementkoordinaten vorhanden, Event-Zeiten monoton steigend, **und
  mindestens ein `elid` mehrfach** – Letzteres ist die Zusage, dass MuseScore
  Wiederholungen ausrollt. Bricht sie, wäre der Cursor bei Wiederholungen still
  falsch statt sichtbar kaputt.

  Antwortet `{"ok": true|false, "error": …, "details": {…}}` und **auch im
  Negativfall mit HTTP 200**: Ein 5xx wäre von „Sidecar nicht erreichbar" nicht
  zu unterscheiden. `details.musescoreVersion` kommt aus einer zur Bauzeit
  gesetzten Umgebungsvariable, nicht aus `mscore4portable --version` – der
  Aufruf braucht einen X-Server und mischt Qt-Rauschen in die Ausgabe.

  Gedacht für die **Versionspflege**: Nach einem Wechsel der
  `MUSESCORE_VERSION`/`MUSESCORE_BUILD`-ARGs im Dockerfile einmal aufrufen, bevor
  das Image produktiv geht. Die Verwaltungsseite in Nextcloud hat dafür einen
  Knopf. Der Selbsttest läuft **nicht** automatisch beim Containerstart: Eine
  echte Konvertierung dauert ~7–8 s, das würde jeden Start verzögern und einen
  sonst benutzbaren Sidecar bei einem Teilproblem gar nicht hochkommen lassen.

### SoundFont

- **`GET /soundfont/info`** →
  `{"available": true, "name": "...", "size": 39978561, "version": "<sha256>"}`
  bzw. `{"available": false}`. Bewusst **200 auch im Negativfall**: Ein 404 wäre
  für den HTTP-Client auf PHP-Seite ein Fehler und ließe „Image bringt kein
  SoundFont mit" nicht mehr von „Sidecar nicht erreichbar" unterscheiden.
- **`GET /soundfont`** – das SoundFont selbst (SF3, ~40 MB). Nicht pro Job,
  sondern eine feste Datei des Images. Nextcloud lädt sie einmal in seinen
  Cache und liefert sie dem Browser danach selbst aus; der Browser spricht nie
  mit dem Sidecar. `version` ist der Content-Hash und dient als Cache-Schlüssel
  und HTTP-ETag – ein SoundFont-Wechsel im Image invalidiert damit automatisch
  jeden Browser-Cache.

## Artefaktschema

`timing.json` und `measures.json` haben dieselbe Form; ein gemeinsamer Parser
erzeugt beide aus `sposXML` bzw. `mposXML`:

```json
{
  "events": [{"elid": 0, "timeMs": 0}, "..."],
  "elements": {
    "0": {"page": 0, "x": 1122.05, "y": 2114.17, "w": 2182.33, "h": 330.71}
  }
}
```

`events` ist nach `timeMs` sortiert. Koordinaten sind **bereits durch 12
geteilt** und liegen direkt in SVG-Einheiten der zugehörigen
`page-N.svg`-`viewBox` – der Client rechnet nicht um.

Ein `elid` kann in `events` **mehrfach** auftreten (Wiederholung, Volta); das ist
der Normalfall, kein Sonderfall. Ein einzelnes `elid` in `elements` deckt alle
Vorkommen ab, weil es exakt eine Notenkopf- oder Taktposition auf der Seite
beschreibt – unabhängig davon, wie oft sie beim Abspielen durchlaufen wird.
Hintergrund und die bekannte Lücke bei D.C./D.S./Coda:
[M7](../docs/architecture.md#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht).

### `spos` und `mpos`

Beide sind wohlgeformtes XML mit zwei Blöcken:

- `<elements>`: `id` → x/y/sx/sy-Position auf der gedruckten Seite (12× der
  SVG-Einheiten).
- `<events>`: `elid` → `position` in **Millisekunden**, vom Sidecar monoton
  steigend sortiert. Gleichzeitige Noten über mehrere Stimmen oder Systeme
  erzeugen **einen** gemeinsamen Event, keinen doppelten Zeitstempel.

`spos` liefert Notenpositionen und treibt den Cursor, `mpos` liefert Taktgrenzen
für die Taktnavigation.

## Aufräumen

Zwei unabhängige Mechanismen:

- **Erledigte Jobs.** Ein Hintergrund-Thread löscht Job-Metadaten und
  Arbeitsverzeichnis `SCOREVIEW_JOB_TTL_SECONDS` nach Abschluss. Das ist kein
  Ersatz für die Abholung durch Nextcloud (die passiert sofort nach `ready`),
  sondern ein Sicherheitsnetz gegen unbegrenztes Wachstum von
  `SCOREVIEW_JOBS_DIR`.
- **Hängende Jobs** nach einem Container-Neustart mitten in einer Konvertierung.
  Der Job-Status lebt nur im Prozessspeicher; nach einem Neustart ist die Job-ID
  unbekannt, und `SCOREVIEW_JOBS_DIR` kann verwaiste Arbeitsverzeichnisse
  enthalten. Bei Bedarf manuell:
  `docker exec scoreview-sidecar rm -rf /tmp/scoreview-jobs/*`.

Ein neustartsicherer Job-Zustand ist bewusst nicht eingebaut: Nextcloud sieht
einen fehlenden oder fehlgeschlagenen Job nach einem Sidecar-Neustart und
übermittelt einfach neu.

## Bereitstellung

Der Sidecar ist Pflicht, also ist seine Installation die eigentliche Hürde für
alle, die kein Docker neben Nextcloud betreiben können oder wollen. Vier Wege mit
ihren echten Kosten:

1. **Docker-Container neben Nextcloud** – der dokumentierte Standardweg, siehe
   oben.
2. **Separater Host.** Funktioniert unverändert, der Sidecar spricht ohnehin nur
   HTTP; `sidecar_url` zeigt dann auf eine andere Maschine. Voraussetzung sind
   TLS und ein echtes Secret. Das kommt dem
   High-Performance-Backend-Muster anderer Nextcloud-Apps am nächsten.
3. **Nativ auf dem Nextcloud-Host** (systemd-Service plus venv). Kein Docker
   nötig, aber MuseScore muss samt Qt- und X-Abhängigkeiten auf den Host –
   genau das, was der Container heute kapselt. Realistisch nur mit einem
   distributionsspezifischen Paket oder dem AppImage plus `xvfb`. Die Härtung
   (eigener Nutzer, Speicher- und PID-Limit) müsste über systemd-Direktiven
   nachgebaut werden (`User=`, `MemoryMax=`, `TasksMax=`, `PrivateTmp=`,
   `ProtectSystem=strict`).
4. **AppAPI/ExApp.** Installation über die Nextcloud-UI, Nextcloud verwaltet den
   Container. Löst die Hürde für Instanzen, die AppAPI anbieten – verschiebt sie
   für alle anderen. Braucht ein eigenes Manifest, ein registriertes Image und
   eine Umstellung von „Admin trägt URL und Secret ein" auf „AppAPI vergibt
   beides". **Nicht umgesetzt.**

## CLI-Modus für manuelles Debugging

Für Diagnose ohne HTTP-Schicht den Default-Entrypoint überschreiben:

```sh
docker run --rm --entrypoint /usr/local/bin/entrypoint.sh \
  -v <hostdir>:/data scoreview-musescore-cli \
  /data/stueck.mscz --score-media > stueck.media.json
```

`--score-media` schreibt ein einzelnes JSON-Objekt auf stdout, dem rund 12 Zeilen
Qt-Logausgabe vorausgehen – die eigentliche Nutzlast beginnt am ersten `\n{\n`.
Alle Binäranteile (`svgs`, `pngs`, `pdf`, `midi`, `sposXML`, `mposXML`, `mxml`)
sind base64-kodierte Strings innerhalb des JSON, `svgs`/`pngs` zusätzlich als
Liste mit einem Eintrag pro Seite.

Der Timeout-Guard gilt für beide Modi und lässt sich überschreiben:

```sh
docker run --rm --entrypoint /usr/local/bin/entrypoint.sh \
  -e MSCORE_TIMEOUT_SECONDS=300 -v <hostdir>:/data \
  scoreview-musescore-cli /data/stueck.mscz --score-media > stueck.media.json
```

**Windows/Git-Bash-Falle:** Git Bashs automatische Pfad-Umwandlung verstümmelt
`/data/…`-Argumente; mit `MSYS_NO_PATHCONV=1` vor `docker run` umgehen.
Dateinamen mit Nicht-ASCII-Zeichen können beim Hochladen über `curl -F` in Git
Bash ebenfalls scheitern (400 „file required", obwohl die Datei existiert) – im
Zweifel unter einem ASCII-Namen zwischenkopieren.

## Tests

```sh
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

Parser- und API-Unit-Tests, ohne MuseScore, Xvfb oder Container.

## Docker-Compose-Skizze

```yaml
services:
  scoreview-sidecar:
    build: ./sidecar
    networks: [scoreview-net]
    environment:
      SCOREVIEW_SIDECAR_SECRET: ${SCOREVIEW_SIDECAR_SECRET}
    # ports: ["8765:8765"]  # nur nötig, wenn nicht nur Nextcloud zugreift

networks:
  scoreview-net:
```
