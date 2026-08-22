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
```

(`.mpos` absichtlich nicht mehr erzeugt - siehe unten.)

Timeout-Guard per Env-Var überschreibbar (Default 120s):

```sh
docker run --rm -e MSCORE_TIMEOUT_SECONDS=300 -v <hostdir>:/data \
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
Spike noch in einer künftigen Sidecar-HTTP-API (Phase 3).

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
