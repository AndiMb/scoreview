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

## Aktuell laufende Testumgebung (vorgezogen aus Phase 5, für die Phase-3-Verifikation)

Für den Ende-zu-Ende-Test der Konvertierungs-Pipeline bereits so aufgesetzt
und weiterhin so belassen (kein Docker-Compose, weiterhin manuell verwaltet,
wie im Plan für den Prototyp vorgesehen):

```sh
docker network create scoreview-net
docker network connect scoreview-net nextcloud-test
docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET=<secret> scoreview-musescore-cli

docker exec -u www-data nextcloud-test php occ config:app:set scoreview sidecar_url --value="http://scoreview-sidecar:8765"
docker exec -u www-data nextcloud-test php occ config:app:set scoreview sidecar_secret --value="<secret>"
```

**Background-Jobs ausführen:** Das schlichte `nextcloud`-Image hat keinen
System-Cron. Nextclouds Default-Modus "ajax" reicht für den Prototyp nicht
zuverlässig (Jobs blieben sichtbar für immer auf `pending` hängen, wenn kein
Seitenaufruf sie anstößt). Einmalig auf `cron` umstellen und einen simplen
Ersatz-Loop im Container starten:

```sh
docker exec -u www-data nextcloud-test php occ background:cron
docker exec -d -u www-data nextcloud-test sh -c 'while true; do php -f /var/www/html/cron.php; sleep 15; done'
```

Der Loop überlebt einen Container-Neustart **nicht** (kein systemd/Supervisor
im Image) - nach einem Neustart von `nextcloud-test` erneut ausführen, sonst
bleiben neu eingereihte Jobs (z. B. `ConvertScoreJob`) unbegrenzt auf
`pending` stehen und der Viewer dreht sich endlos.

**Wichtig:** Nextcloud blockiert per Default abgehende HTTP-Anfragen an
lokale/interne Hostnamen (SSRF-Schutz) - ohne folgende Einstellung schlägt
jeder Sidecar-Aufruf mit „violates local access rules" fehl. Dieselbe
Einstellung brauchen z. B. auch Collabora/OnlyOffice-Sidecar-Integrationen:

```sh
docker exec -u www-data nextcloud-test php occ config:system:set allow_local_remote_servers --value=true --type=boolean
```

Ende-zu-Ende verifiziert (Upload per WebDAV als Testnutzer → Event-Listener
→ `occ background-job:execute` → Sidecar → IAppData-Cache → Status-API):
Ergebnisse identisch zum direkten Sidecar-API-Test. Zweiter Statusabruf
ohne Dateiänderung liefert sofort `ready` ohne neuen Job (Kernziel „einmal
konvertieren, cachen" bestätigt). Fremder Nutzer bekommt 404 statt fremder
Datei-Bytes. Kaputte `.mscz` läuft sauber auf `status: error`.

## Docker-Compose-Skizze (spätere, sauberere Variante)

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
