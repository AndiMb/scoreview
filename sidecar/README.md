# MuseScore-Sidecar

Der Konvertierungsdienst hinter ScoreView: ein Docker-Image mit **zwei
Renderern** und einer kleinen HTTP-API davor (Paket `scoreview_sidecar`,
gestartet über `wsgi.py` mit gunicorn):

- **`engine`** (Voreinstellung) – die scoreview-engine unter Node 22, also
  derselbe Konverter, den die App auf dem lokalen Weg fährt
  (`scoreview/converter`, unverändert ins Image kopiert). Liefert alles, was
  der lokale Weg liefert: Kennungen der Notenköpfe im SVG
  ([M10](../docs/architecture.md#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)),
  Tonarten samt Dur/Moll, Taktarten, Liedtextsilben und Schreibweisen in den
  Metadaten ([E12](../docs/architecture.md#e12-partiturfakten-aus-der-engine-mit-midi-rückfall),
  [E15](../docs/architecture.md#e15-fähigkeiten-statt-weg)) und die
  Darstellungsvarianten ([E19](../docs/architecture.md#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)).
- **`musescore`** – eine gepinnte MuseScore-Studio-Version als extrahiertes
  AppImage, headless unter `xvfb-run`. Behält die Originalnotenschrift alter
  Partituren und rastert SVG-Bilder, liefert aber nichts von dem oben.

Welcher Renderer läuft, entscheidet die App je Auftrag (Einstellung
`sidecar_renderer`); der Sidecar nimmt nur für Anfragen ohne Angabe seine
eigene Voreinstellung.

Er läuft als eigener Container neben Nextcloud und ist **nicht** Teil des
App-Pakets. Er ist einer von zwei Konvertierungswegen – der andere kommt ohne
Container aus und liegt im App-Paket. Beide erzeugen dieselben Artefakte; wann
welcher die bessere Wahl ist, steht unter
[E3](../docs/architecture.md#e3-zwei-konvertierungswege-hinter-einer-api).

## Build und Start

Gebaut wird **aus dem Wurzelverzeichnis des Repositorys**, weil das Image den
Konverter der App (`scoreview/converter`) braucht;
`sidecar/Dockerfile.dockerignore` hält den Kontext auf das, was kopiert wird.

```sh
docker build -f sidecar/Dockerfile -t scoreview-musescore-cli .

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
fehlerfrei, und die Betriebsdiagnose zeigt nur die Zeile „Konvertierung“
rot, mit einer cURL-Meldung zur Namensauflösung; Partituren konvertiert dann
der Browser. Beide Container müssen in dasselbe benutzerdefinierte Netz; der
Netzname hängt von der Installation ab, deshalb steht hier ein Beispiel und kein
fertiger Befehl. Einrichtung siehe
[Installation](../docs/installation.de.md#1b-weg-b-sidecar-starten).

Der Port muss nur dann nach außen veröffentlicht werden (`-p 8765:8765`), wenn
etwas anderes als Nextcloud selbst zugreift – etwa ein Nextcloud auf einer
anderen Maschine (siehe [Bereitstellung](#bereitstellung)).

## Konfiguration

Alle Variablen außer dem Secret sind optional.

| Variable | Default | Bedeutung |
|---|---|---|
| `SCOREVIEW_SIDECAR_SECRET` | – | **Pflicht.** Shared Secret, Header `X-ScoreView-Secret` |
| `SCOREVIEW_SIDECAR_RENDERER` | `engine` | Renderer für Anfragen ohne eigene Angabe (`engine` oder `musescore`); die App nennt ihn bei jedem Auftrag selbst. Ein anderer Wert lässt den Container nicht starten |
| `MSCORE_TIMEOUT_SECONDS` | `600` | Harter Timeout-Guard pro Konvertierung, für beide Renderer |
| `SCOREVIEW_MAX_UPLOAD_BYTES` | `209715200` | Upload-Limit (200 MB); größere Requests werden mit `413` abgelehnt, bevor MuseScore startet |
| `SCOREVIEW_JOB_TTL_SECONDS` | `600` | Wie lange die Dateien eines fertigen Jobs abrufbar bleiben |
| `SCOREVIEW_MAX_CONCURRENT` | `2` | Gleichzeitig laufende Konvertierungen (der Selbsttest zählt mit) |
| `SCOREVIEW_MAX_QUEUED` | `30` | Wie viele Aufträge höchstens auf einen Konvertierungsplatz warten; darüber antwortet `POST /convert` mit `503` |
| `SCOREVIEW_PENDING_MAX_AGE_SECONDS` | `3600` | Ab welchem Alter ein noch wartender Auftrag verworfen wird |
| `SCOREVIEW_JOBS_DIR` | `/tmp/scoreview-jobs` | Arbeitsverzeichnis für laufende Jobs |
| `SCOREVIEW_SOUNDFONT_PATH` | automatische Suche | Welches SoundFont `GET /soundfont` ausliefert |
| `PORT` | `8765` | Port, auf dem gunicorn im Container lauscht |

**Zum Timeout:** Eine Konvertierung braucht gemessen rund **6 s pro
gerenderter Seite** plus etwa 2 s Grundlast. Die engere Grenze setzt allerdings
die App: Sie wartet ab dem Einreichen höchstens 300 s (`ConvertScoreJob`),
rechnerisch rund 50 Seiten. Die 600 s hier greifen deshalb nur, wenn sie
kleiner gesetzt werden. Die Zahl hängt spürbar von der CPU ab und ist als
Größenordnung zu lesen, nicht als Garantie. Siehe
[Grenzwerte](../docs/limits.de.md).

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

Der Container lässt eine große C++-Codebasis – MuseScore als AppImage oder als
WebAssembly – auf beliebige, nicht vertrauenswürdige `.mscz`-Uploads los.
Deshalb:

- Der Konvertierungsprozess läuft **nicht als root** (eigener
  `scoreview`-Nutzer im Image).
- **Die Engine ist zusätzlich eingesperrt**, wie auf dem lokalen Weg
  ([S11](../docs/architecture.md#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis)):
  Node läuft mit `--permission`, liest nur den Konverter, die Partitur und
  gegebenenfalls die Grundartefakte, schreibt nur in das Ausgabeverzeichnis
  des Auftrags und darf keine Prozesse starten. Ihre Umgebung ist auf `PATH`,
  `LANG` und `HOME` beschnitten – das Berechtigungsmodell sperrt
  Umgebungsvariablen nicht, und die des Containers tragen das Secret. Das Netz
  bleibt wie bei Node 22 auf dem lokalen Weg offen.
- `--memory` und `--pids-limit` sind für den Produktivbetrieb empfohlen.
- Alle Endpunkte außer `/health` verlangen das Shared Secret.
- Wer den Dienst über eine Maschinengrenze hinweg betreibt, braucht TLS davor
  (siehe [Bereitstellung](#bereitstellung)).

`--network none` ist **nicht** möglich: Derselbe Container bedient die HTTP-API,
über die die Konvertierung überhaupt erst eingereicht wird. Eine echte
Netzwerk-Isolation nur für den `mscore4portable`-Subprozess bräuchte eine eigene
Sandbox-Schicht innerhalb des Containers – ein offenes Architekturthema, kein
`docker run`-Flag. Siehe [Grenzwerte](../docs/limits.de.md#was-die-app-bewusst-nicht-tut).

## HTTP-API

Asynchrone Job-API; ein Container läuft dauerhaft. Alle Endpunkte außer
`/health` verlangen den Header `X-ScoreView-Secret`.

### Konvertierung

- **`POST /convert`** – Multipart-Feld `file` = `.mscz`, optional `renderer`
  (`engine` oder `musescore`, sonst `SCOREVIEW_SIDECAR_RENDERER`; ein anderer
  Wert ist `400`). Antwortet `202 {"jobId": "...", "renderer": "..."}`; die
  Konvertierung läuft im Hintergrund.
  Warten schon `SCOREVIEW_MAX_QUEUED` Aufträge, antwortet er stattdessen
  `503` mit `Retry-After` und speichert nichts. Bewusst 5xx und nicht 429:
  Die App wertet das als Infrastrukturfehler und lässt den Browser
  konvertieren, statt die Partitur als abgelehnt zu markieren.
- **`GET /convert/{jobId}`** –
  `{"status": "pending"|"processing"|"ready"|"error", "renderer": "...", ...}`.
  `renderer` nennt, was tatsächlich lief. Bei `ready` zusätzlich `files`:

  ```json
  {
    "pages": ["/convert/{jobId}/artifact/page-1", "/convert/{jobId}/artifact/page-2", "..."],
    "midi": "/convert/{jobId}/artifact/midi",
    "timingJson": "/convert/{jobId}/artifact/timing",
    "measuresJson": "/convert/{jobId}/artifact/measures",
    "metaJson": "/convert/{jobId}/artifact/meta"
  }
  ```

  Bei `error` zusätzlich `error` (Freitext: die Ausgabe von
  `mscore4portable` bzw. die Meldungszeile der Engine).
- **`POST /variant`** – eine Darstellungsvariante
  ([E19](../docs/architecture.md#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)),
  **synchron** gesetzt, immer mit der Engine. Multipart: `file` (die
  `.mscz`), `timing` und `measures` (`timing.json`/`measures.json` der
  Grundkonvertierung, gegen die der Konverter die Variante prüft) und das
  Feld `key` (Variantenschlüssel `src~fmt~pitch~tr`). Antwortet `200` wie
  `GET /convert/{jobId}` für einen fertigen Auftrag, zusätzlich `engine` (der
  Release-Tag der Engine im Image); `files` hat **kein** `midi` – eine
  Variante spielt das der Grundkonvertierung. Eine Variante, die der
  Konverter nicht setzen kann oder die eine Invariante bricht, ist
  `200` mit `status: "error"`: ein Ergebnis, kein Ausfall. Ist binnen 20 s kein
  Konvertierungsplatz frei, `503` mit `Retry-After`. Synchron, weil die App
  eine Variante in der Anfrage des Browsers setzt (3–4 s); eine Warteschlange
  brächte nur das Pollen dazu. Variantenaufträge belegen deshalb auch keinen
  Warteplatz.
- **`GET /convert/{jobId}/artifact/{name}`** – **eine** Auslieferungsroute für
  alle Artefakte. Gültige Namen sind eine Allowlist, kein Dateipfad:

  | Name | Inhalt |
  |---|---|
  | `page-{n}` | SVG-Seite `n` (1-indiziert) |
  | `midi` | MIDI-Datei – die Synthese passiert im Browser, hier gibt es kein fertiges Audio |
  | `timing` | `timing.json`, aus `sposXML` geparst (treibt den Cursor) |
  | `measures` | `measures.json`, aus `mposXML` geparst (Taktnavigation) |
  | `meta` | `meta.json`, MuseScores `metadata` unverändert (Titel, Takte, `tracks[]`/`parts[]`) |

Fehlerpfade: unbekannte `jobId` → 404, fehlendes `file`-Feld oder
unbekannter `renderer` → 400, `midi` einer Variante → 404,
fehlendes oder falsches Secret → 401 – auch auf den Artefakt-Endpunkten. Die
Existenz eines Jobs wird erst **nach** der Secret-Prüfung offengelegt; volle
Warteschlange → 503. Eine
defekte `.mscz` landet sichtbar auf `status: error`, statt zu hängen.

### Diagnose

- **`GET /health`** – ohne Auth, liefert `ok`.
- **`GET /selftest?renderer=engine|musescore`** – prüft den genannten
  Renderer (ohne Angabe die Voreinstellung); die Antwort nennt ihn als
  `renderer`. Mit der Engine ist es der Selbsttest des Konverters selbst
  (`convert.mjs --selftest`, derselbe wie auf dem lokalen Weg): fünf
  mitgelieferte Partituren, geprüft auf M2/M4/M7, M10, Partiturfakten,
  Liedtext, Taktarten und Darstellungsvarianten. Mit MuseScore konvertiert er
  die mitgelieferte Minipartitur
  (`selftest-score.mscz`, Kopie von `testdata/repeat-test.mscz`) und prüft das
  Ergebnis auf die Zusagen, auf denen die App aufbaut: alle erwarteten
  `--score-media`-Schlüssel vorhanden, mindestens eine SVG-Seite, Timing-Events
  und Elementkoordinaten vorhanden, Event-Zeiten monoton steigend, **und
  mindestens ein `elid` mehrfach** – Letzteres ist die Zusage, dass MuseScore
  Wiederholungen ausrollt. Bricht sie, wäre der Cursor bei Wiederholungen still
  falsch statt sichtbar kaputt.

  Antwortet `{"ok": true|false, "error": …, "details": {…}}` und **auch im
  Negativfall mit HTTP 200**: Ein 5xx wäre von „Sidecar nicht erreichbar" nicht
  zu unterscheiden. `details.musescoreVersion` kommt bei MuseScore aus einer
  zur Bauzeit gesetzten Umgebungsvariable, nicht aus
  `mscore4portable --version` – der Aufruf braucht einen X-Server und mischt
  Qt-Rauschen in die Ausgabe; bei der Engine ist es ihr Release-Tag. Ein Image
  von vor der Renderer-Wahl übergeht den Parameter und nennt keinen
  `renderer`; die App meldet das als zu altes Image.

  Er belegt einen Konvertierungsplatz wie jeder Auftrag; wird binnen 60 s
  keiner frei, meldet er `ok: false` mit diesem Grund.

  Gedacht für die **Versionspflege**: Nach einem Wechsel der
  `MUSESCORE_VERSION`/`MUSESCORE_BUILD`-ARGs im Dockerfile (samt
  `MUSESCORE_APPIMAGE_SHA256`, wie dort beschrieben) einmal aufrufen, bevor
  das Image produktiv geht. Die Verwaltungsseite in Nextcloud hat dafür einen
  Knopf. Der Selbsttest läuft **nicht** automatisch beim Containerstart: Eine
  echte Konvertierung der Minipartitur dauert gemessen ~8 s, das würde jeden Start verzögern und einen
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
  `SCOREVIEW_JOBS_DIR`. Derselbe Thread verwirft Aufträge, die länger als
  `SCOREVIEW_PENDING_MAX_AGE_SECONDS` warten (die App hat sie da längst
  aufgegeben), und Läufe, die länger dauern, als `MSCORE_TIMEOUT_SECONDS`
  überhaupt zulässt.
- **Hängende Jobs** nach einem Container-Neustart mitten in einer Konvertierung.
  Der Job-Status lebt nur im Prozessspeicher; nach einem Neustart ist die Job-ID
  unbekannt, und `SCOREVIEW_JOBS_DIR` kann verwaiste Arbeitsverzeichnisse
  enthalten. Bei Bedarf manuell:
  `docker exec scoreview-sidecar sh -c 'rm -rf /tmp/scoreview-jobs/*'` – das
  `sh -c` ist nötig, weil `docker exec` keine Shell startet und den `*` sonst
  niemand im Container auflöst.

Ein neustartsicherer Job-Zustand ist bewusst nicht eingebaut: Nextcloud sieht
einen fehlenden oder fehlgeschlagenen Job nach einem Sidecar-Neustart und
übermittelt einfach neu.

## Bereitstellung

Der Sidecar ist **nicht** Pflicht. Voreingestellt ist der lokale Weg, der nur
eine Node-Laufzeit auf dem Nextcloud-Server braucht; kann der Server keinen der
beiden Wege ausführen, konvertiert der Browser als Rückfall
([E3](../docs/architecture.md#e3-zwei-konvertierungswege-hinter-einer-api),
[E7](../docs/architecture.md#e7-konvertierung-im-browser-als-rückfall)). Wer
sich für den Sidecar entscheidet, hat vier Wege, ihn bereitzustellen – mit ihren
echten Kosten:

1. **Docker-Container neben Nextcloud** – der dokumentierte Weg, siehe oben.
2. **Separater Host.** Funktioniert unverändert, der Sidecar spricht ohnehin nur
   HTTP; `sidecar_url` zeigt dann auf eine andere Maschine. Voraussetzung sind
   TLS und ein echtes Secret: den Port dort nur lokal binden
   (`-p 127.0.0.1:8765:8765`) und über einen TLS-Reverse-Proxy veröffentlichen,
   dessen Upload-Limit die größten Partituren durchlässt und dessen Timeout
   großzügig bemessen ist – Nextcloud wartet bis zu 120 s auf eine Antwort,
   `GET /soundfont` überträgt rund 40 MB. Liegt der Host unter einer privaten
   IP oder einem internen Namen, braucht Nextcloud zusätzlich
   `allow_local_remote_servers` (siehe
   [Installation](../docs/installation.de.md#weg-b-sidecar)). Das kommt dem
   High-Performance-Backend-Muster anderer Nextcloud-Apps am nächsten.
3. **Nativ auf dem Nextcloud-Host** (systemd-Service plus venv). Kein Docker
   nötig, aber MuseScore muss samt Qt- und X-Abhängigkeiten auf den Host –
   genau das, was der Container kapselt. Wer das vermeiden will, ist mit dem
   lokalen Weg besser bedient. Realistisch nur mit einem
   distributionsspezifischen Paket oder dem AppImage plus `xvfb`. Die Härtung
   (eigener Nutzer, Speicher- und PID-Limit) müsste über systemd-Direktiven
   nachgebaut werden (`User=`, `MemoryMax=`, `TasksMax=`, `PrivateTmp=`,
   `ProtectSystem=strict`).
4. **AppAPI/ExApp.** Installation über die Nextcloud-UI, Nextcloud verwaltet den
   Container. Nimmt den Betreibern von Instanzen, die AppAPI anbieten, die
   Container-Einrichtung ab – allen anderen nicht. Braucht ein eigenes
   Manifest, ein registriertes Image und eine Umstellung von „Admin trägt URL und Secret ein" auf „AppAPI vergibt
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

Die Engine lässt sich ebenso von Hand aufrufen – derselbe Aufruf wie auf dem
lokalen Weg, Ergebnis als Dateien im Ausgabeverzeichnis:

```sh
docker run --rm --entrypoint node -v <hostdir>:/data scoreview-musescore-cli \
  --liftoff-only /opt/scoreview-converter/convert.mjs /data/stueck.mscz /data/out
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

Parser- und API-Unit-Tests, ohne MuseScore, Node, Xvfb oder Container. Wie die
Engine aufgerufen wird – Berechtigungen, Umgebung, Varianten –, prüft
`tests/test_engine.py` gegen einen ersetzten Aufruf; dass sie im Image
tatsächlich läuft, zeigt `GET /selftest?renderer=engine`.

## Docker-Compose-Skizze

```yaml
services:
  scoreview-sidecar:
    build:
      context: .                      # Wurzel des Repositorys, siehe Build und Start
      dockerfile: sidecar/Dockerfile
    networks: [scoreview-net]
    environment:
      SCOREVIEW_SIDECAR_SECRET: ${SCOREVIEW_SIDECAR_SECRET}
    # ports: ["8765:8765"]  # nur nötig, wenn nicht nur Nextcloud zugreift

networks:
  scoreview-net:
```
