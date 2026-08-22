# MuseScore CLI Sidecar

Docker-Image mit einer gepinnten MuseScore-Studio-Version (siehe
`Dockerfile`-`ARG`s), die als extrahiertes AppImage headless unter
`xvfb-run` läuft. Phase 1: nur CLI, keine HTTP-API (kommt in Phase 3).

## Build

```sh
docker build -t scoreview-musescore-cli sidecar/
```

## Nutzung (CLI, ein Format pro Aufruf)

Mehrere `-o`-Flags in einem Aufruf funktionieren bei MuseScore 4 **nicht**
zuverlässig (nur die letzte Ausgabe wird erzeugt) - pro gewünschtem Format
einen eigenen Aufruf machen:

```sh
docker run --rm -v <hostdir>:/data scoreview-musescore-cli \
  /data/stück.mscz -o /data/stück.musicxml

docker run --rm -v <hostdir>:/data scoreview-musescore-cli \
  /data/stück.mscz -o /data/stück.mp3

docker run --rm -v <hostdir>:/data scoreview-musescore-cli \
  /data/stück.mscz -o /data/stück.spos

docker run --rm -v <hostdir>:/data scoreview-musescore-cli \
  /data/stück.mscz -o /data/stück.mpos
```

Timeout-Guard per Env-Var überschreibbar (Default 120s):

```sh
docker run --rm -e MSCORE_TIMEOUT_SECONDS=300 -v <hostdir>:/data \
  scoreview-musescore-cli /data/stück.mscz -o /data/stück.mp3
```

**Windows/Git-Bash-Falle:** Git Bashs automatische Pfad-Umwandlung
verstümmelt `/data/...`-Argumente. Mit `MSYS_NO_PATHCONV=1` vor `docker run`
umgehen.

## spos vs. mpos

Beide sind wohlgeformtes XML mit zwei Blöcken:

- `<elements>`: `id` → x/y-Position auf der gedruckten Seite.
- `<events>`: `elid` → `position` (Zeit in **Millisekunden**, monoton
  steigend). Gleichzeitige Noten/Akkorde über mehrere Stimmen/Systeme
  erzeugen **einen** gemeinsamen Event (kein doppelter Zeitstempel) - das
  entspricht direkt einem OSMD-Cursor-Schritt.

`spos` ist deutlich feinkörniger (mehr Events) als `mpos`. Welche der
beiden Granularitäten zur Schrittzahl des OSMD-Cursors passt, ist
partiturabhängig und wird im Spike (`spike/main.js`) live verglichen und
angezeigt statt fest angenommen.

## Docker-Compose-Skizze (spätere Testumgebung, Phase 5)

Nicht produktiv genutzt, nur als Dokumentation für eine künftige saubere
Umgebung neben dem bestehenden, händisch verwalteten `nextcloud-test`:

```yaml
services:
  scoreview-sidecar:
    build: ./sidecar
    networks: [scoreview-net]
    # Phase 3: HTTP-API-Port statt reinem CLI-Image
    # ports: ["8765:8765"]

networks:
  scoreview-net:
```
