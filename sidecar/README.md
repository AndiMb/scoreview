# MuseScore Sidecar

Docker-Image mit einer gepinnten MuseScore-Studio-Version (siehe
`Dockerfile`-`ARG`s), die als extrahiertes AppImage headless unter
`xvfb-run` läuft. Standard-Kommando ist seit Phase 3 die HTTP-API
(`server.py`); der reine CLI-Modus aus Phase 1 bleibt als manueller
Debug-Weg erreichbar (siehe unten).

## Build

```sh
docker build -t scoreview-musescore-cli sidecar/
```

## HTTP-API (Phase 3)

Asynchrone Job-API, ein Container läuft dauerhaft. Pflicht-Env-Var
`SCOREVIEW_SIDECAR_SECRET` - startet ohne diese absichtlich **nicht**
(kein unauthentifizierter Konvertierungsdienst).

```sh
MSYS_NO_PATHCONV=1 docker run -d --name scoreview-sidecar \
  -p 8765:8765 \
  -e SCOREVIEW_SIDECAR_SECRET=<zufälliges-secret> \
  scoreview-musescore-cli
```

- `GET /health` - kein Auth, liefert `ok`.
- `POST /convert` (Header `X-ScoreView-Secret`, Multipart-Feld `file` =
  `.mscz`) → `202 {"jobId": "..."}`. Start sofort, Konvertierung läuft im
  Hintergrund-Thread.
- `GET /convert/{jobId}` → `{"status": "pending"|"processing"|"ready"|"error", ...}`.
  Bei `ready` zusätzlich `files: {musicxml, audio, timingJson}` mit den
  Pfaden zum Abruf der Bytes; bei `error` zusätzlich `error` (Freitext aus
  der fehlgeschlagenen `mscore4portable`-Ausgabe).
- `GET /convert/{jobId}/musicxml` · `/audio` · `/timing` - liefert die
  jeweiligen Bytes (nur wenn `status == ready`), je mit `X-ScoreView-Secret`.

`timing.json` ist die zu JSON geparste `.spos`-Datei: `{"events": [{"elid":
0, "timeMs": 0}, ...]}`, sortiert, monoton steigend. Das Parsen passiert
ausschließlich hier im Sidecar - PHP cached/proxy't nur Bytes, wie im Plan
vorgesehen.

Job-Dateien liegen unter `SCOREVIEW_JOBS_DIR` (Default `/tmp/scoreview-jobs`)
im Container, Job-Status nur im Prozessspeicher (kein Neustart-sicherer
Job-Queue nötig für den Prototyp - `ConvertScoreJob` auf PHP-Seite sieht
einen fehlenden/fehlgeschlagenen Job nach einem Sidecar-Neustart und
übermittelt einfach neu).

End-to-end gegen beide Testpartituren verifiziert: Ergebnisse (Dateigrößen,
Event-Anzahl in `timing.json`) sind identisch zu den Phase-1-CLI-Ergebnissen.
Fehlerpfade geprüft: unbekannte `jobId` → 404, fehlendes `file`-Feld → 400,
fehlender/falscher `X-ScoreView-Secret` → 401, kaputte `.mscz` → Job landet
sichtbar auf `status: error` statt zu hängen.

## CLI-Modus (manuelles Debugging)

Für Diagnose ohne HTTP-Layer den Default-Entrypoint überschreiben. Mehrere
`-o`-Flags in einem Aufruf funktionieren bei MuseScore 4 **nicht**
zuverlässig (nur die letzte Ausgabe wird erzeugt) - pro gewünschtem Format
einen eigenen Aufruf machen:

```sh
docker run --rm --entrypoint /usr/local/bin/entrypoint.sh \
  -v <hostdir>:/data scoreview-musescore-cli \
  /data/stück.mscz -o /data/stück.musicxml
```

(`.mpos` absichtlich nicht mehr erzeugt - siehe unten.)

Timeout-Guard per Env-Var überschreibbar (Default 120s, gilt für beide
Modi):

```sh
docker run --rm --entrypoint /usr/local/bin/entrypoint.sh \
  -e MSCORE_TIMEOUT_SECONDS=300 -v <hostdir>:/data \
  scoreview-musescore-cli /data/stück.mscz -o /data/stück.mp3
```

**Windows/Git-Bash-Falle:** Git Bashs automatische Pfad-Umwandlung
verstümmelt `/data/...`-Argumente. Mit `MSYS_NO_PATHCONV=1` vor `docker run`
umgehen.

## spos vs. mpos: nur spos wird verwendet

Beide sind wohlgeformtes XML mit zwei Blöcken:

- `<elements>`: `id` → x/y-Position auf der gedruckten Seite.
- `<events>`: `elid` → `position` (Zeit in **Millisekunden**, monoton
  steigend). Gleichzeitige Noten/Akkorde über mehrere Stimmen/Systeme
  erzeugen **einen** gemeinsamen Event (kein doppelter Zeitstempel) - das
  entspricht direkt einem OSMD-Cursor-Schritt.

Im Spike getestet und empirisch entschieden: `spos` traf bei beiden
Testpartituren die Schrittzahl des OSMD-Cursors exakt (ordinale 1:1-
Zuordnung). `mpos` ist strukturell gröber (deutlich weniger Events) und
entspricht dem OSMD-Cursor bei keiner der beiden Partituren - auch mit
korrekter linearer Zeit-Interpolation zwischen den vorhandenen Events blieb
die Zuordnung sichtbar ungenau. Vermutung: `mpos` ist für eine andere,
kontinuierliche/scrollende Ansicht gedacht (wie sie musescore.com neben der
paginierten Seitenansicht anbietet), nicht für einen Notenblatt-Cursor wie
unseren. `mpos` wird daher **nicht** exportiert/verarbeitet - weder im
Spike noch in der Sidecar-HTTP-API.

## Docker-Compose-Skizze (spätere Testumgebung, Phase 5)

Nicht produktiv genutzt, nur als Dokumentation für eine künftige saubere
Umgebung neben dem bestehenden, händisch verwalteten `nextcloud-test`:

```yaml
services:
  scoreview-sidecar:
    build: ./sidecar
    networks: [scoreview-net]
    environment:
      SCOREVIEW_SIDECAR_SECRET: ${SCOREVIEW_SIDECAR_SECRET}
    # ports: ["8765:8765"]  # nur nötig, wenn nicht nur Nextcloud selbst zugreift

networks:
  scoreview-net:
```
