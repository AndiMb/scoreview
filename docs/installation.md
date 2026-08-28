# Installation und Konfiguration

ScoreView besteht aus der Nextcloud-App und einem Konvertierungsweg. Davon gibt
es **zwei zur Wahl**, und sie liefern dasselbe Ergebnis
([E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api)):

| | **Weg A: Sidecar** | **Weg B: Lokal** |
|---|---|---|
| Braucht | einen Docker-Host | Node.js ≥ 18 auf dem Nextcloud-Server |
| MuseScore | echtes MuseScore 4 im Container | MuseScore 4.7.4 als WebAssembly, im App-Paket |
| SoundFont | bringt der Container mit | einmalig von einer URL zu holen |
| Empfohlen, wenn | ohnehin Container laufen | keine laufen |

Eines von beiden muss eingerichtet sein, sonst zeigt die App nur eine
Fehlermeldung. Rechnen Sie mit 15 Minuten.

## Voraussetzungen

- Nextcloud 31 bis 35
- PHP 8.1 bis 8.5
- SQLite, MySQL/MariaDB oder PostgreSQL
- Background-Jobs im Modus `cron` (Schritt 5)
- Je nach Weg: **A** ein Docker-Host – dieselbe Maschine wie Nextcloud oder eine
  andere, erreichbar über HTTP. **B** eine Node.js-Laufzeit ab Version 18 auf
  dem Nextcloud-Server, und PHP muss Prozesse starten dürfen (`proc_open` nicht
  per `disable_functions` gesperrt).

Die `occ`-Befehle unten stehen so, wie sie auf einer nativen Installation
laufen. In einer Container-Installation davor `docker exec -u www-data
<container> php` setzen.

## 1a. Weg A: Sidecar starten

Das Image bauen (enthält eine gepinnte MuseScore-Studio-Version):

```sh
docker build -t scoreview-musescore-cli sidecar/
```

Ein gemeinsames Netz anlegen, damit Nextcloud den Sidecar unter seinem
Containernamen erreicht, und den Container starten:

```sh
docker network create scoreview-net
docker network connect scoreview-net <nextcloud-container>

docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET="$(openssl rand -hex 32)" \
  --memory=2g --pids-limit=512 \
  scoreview-musescore-cli
```

Merken Sie sich das Secret – Schritt 3 braucht es. Der Container startet ohne
`SCOREVIEW_SIDECAR_SECRET` absichtlich nicht: Ein unauthentifizierter
Konvertierungsdienst, der beliebige Dateien entgegennimmt, soll nicht aus
Versehen entstehen.

> **`--network` nicht vergessen.** Auf Dockers Standard-Bridge gibt es keine
> Namensauflösung zwischen Containern. Der Container startet dann fehlerfrei,
> `curl` vom Host funktioniert tadellos – aber Nextcloud erreicht ihn nicht, und
> die Betriebsdiagnose meldet nur „Konvertierungsdienst nicht erreichbar".

`--memory` und `--pids-limit` sind für den Produktivbetrieb empfohlen: Der
Container lässt eine große C++/Qt-Codebasis auf nicht vertrauenswürdige
`.mscz`-Uploads los. Details und weitere Env-Variablen stehen in
[`../sidecar/README.md`](../sidecar/README.md).

Wer den Sidecar auf einer anderen Maschine oder ohne Docker betreiben will,
findet die Wege unter
[Bereitstellung](../sidecar/README.md#bereitstellung).

## 1b. Weg B: Node.js bereitstellen

Für den lokalen Weg ist nichts zu bauen und nichts zu starten – der Konverter
liegt fertig im App-Paket (`scoreview/converter/`, rund 21 MB). Nötig ist nur
eine Node.js-Laufzeit, die der Nextcloud-Prozess starten darf:

```sh
node --version   # muss v18 oder neuer melden
```

**Das offizielle Nextcloud-Docker-Image bringt keine mit.** Dort nachrüsten:

```sh
docker exec <container> sh -c 'apt-get update && apt-get install -y nodejs'
```

Bei einer nativen Installation über die Paketverwaltung der Distribution. Damit
das ein Image-Update übersteht, gehört die Zeile in ein eigenes Dockerfile
`FROM nextcloud:…` statt in den laufenden Container.

Der Konverter selbst ist reines JavaScript und WebAssembly, also unabhängig von
Betriebssystem und Prozessorarchitektur – es gibt nichts zu kompilieren.

## 2. App installieren

Über den Nextcloud App Store, oder das Verzeichnis `scoreview/` als
`apps/scoreview` ablegen. Danach:

```sh
occ app:enable scoreview
occ upgrade
```

## 3. Konvertierungsweg einstellen

Unter **Einstellungen → Verwaltung → ScoreView** steht die Wahl ganz oben; sie
schaltet darunter frei, was jeweils einzutragen ist. Voreingestellt ist der
Sidecar.

### Weg A: Sidecar

Die Sidecar-URL (z. B.
`http://scoreview-sidecar:8765`) und das Secret aus Schritt 1 eintragen.
Alternativ auf der Kommandozeile:

```sh
occ config:app:set scoreview sidecar_url --value="http://scoreview-sidecar:8765"
occ config:app:set scoreview sidecar_secret --value="<secret>" --sensitive
```

Nextcloud blockiert ausgehende Anfragen an lokale und interne Hostnamen
(SSRF-Schutz). Ohne die folgende Einstellung schlägt jeder Sidecar-Aufruf mit
„violates local access rules" fehl – dieselbe Einstellung brauchen auch
Collabora- und OnlyOffice-Integrationen:

```sh
occ config:system:set allow_local_remote_servers --value=true --type=boolean
```

### Weg B: Lokal

Den lokalen Weg auswählen und – falls `node` nicht an einer der üblichen Stellen
liegt – den Pfad eintragen. Auf der Kommandozeile:

```sh
occ config:app:set scoreview conversion_backend --value=local
occ config:app:set scoreview node_path --value=/usr/bin/node   # nur falls nötig
```

Dazu eine **SoundFont-Download-URL**, sonst bleibt die Wiedergabe stumm (siehe
[SoundFont](#soundfont)):

```sh
occ config:app:set scoreview soundfont_fetch_url --value="https://…/FluidR3Mono_GM.sf3"
```

### Prüfen

Auf der Verwaltungsseite prüft ein Knopf den Zustand und ein zweiter startet den
**Selbsttest**: eine echte Konvertierung der mitgelieferten Minipartitur über
den gewählten Weg, samt Prüfung aller Zusagen, auf denen die App aufbaut. Nach
jedem Wechsel der MuseScore-Version einmal auslösen.

## 4. Mimetype registrieren (empfohlen, nicht zwingend)

Ohne diesen Schritt erkennt Nextcloud `.mscz` als `application/octet-stream`.
Die Partitur lässt sich trotzdem öffnen – dafür gibt es die Dateiaktion
**„In ScoreView öffnen"**, die an der Dateiendung hängt und die Partitur in
einem eigenen Fenster zeigt
([E6](architecture.md#e6-zwei-einstiege--mimetype-und-dateiendung)). Wer `occ`
nicht ausführen kann, weil die Instanz verwaltet ist, überspringt diesen
Abschnitt also.

Was die Registrierung zusätzlich bringt: das eigene Dateisymbol, die Vorschau
in Nextclouds Viewer samt Blättern zwischen Dateien und das gewohnte
Öffnen-Verhalten. Wo sie fehlt, übernimmt die Dateiaktion – dieselbe Ansicht,
nur ohne Viewer-Rahmen.

Die Registrierung wirkt **server-weit**, nicht app-lokal: Nextcloud lädt
`mimetypemapping.json` und `mimetypealiases.json` nicht aus Apps. Die beiden
Dateien unter `scoreview/appinfo/` sind Vorlage und Dokumentation. Übernehmen
Sie ihren Inhalt in `config/mimetypemapping.json` bzw.
`config/mimetypealiases.json` des Servers – vorhandene andere Einträge dabei
erhalten, nicht überschreiben – und dann:

```sh
occ maintenance:mimetype:update-db
occ maintenance:mimetype:update-js
```

**Für bereits hochgeladene Dateien reicht das nicht.** `update-db` aktualisiert
den Filecache vorhandener Dateien nicht; sie bleiben dauerhaft auf
`application/octet-stream` stehen. Der Bestand braucht zusätzlich einen Rescan:

```sh
occ files:scan <Nutzername>
occ files:scan --all          # für alle Nutzer, teurer
```

Neu hochgeladene Dateien bekommen den richtigen Mimetype sofort – das Problem
betrifft ausschließlich den Bestand von vor der Registrierung.

## 5. Background-Jobs sicherstellen

Konvertierungen laufen als Background-Job. Nextclouds Default-Modus `ajax`
reicht dafür nicht zuverlässig: Jobs bleiben sichtbar auf `pending` stehen, wenn
kein Seitenaufruf sie anstößt, und der Viewer dreht sich endlos.

```sh
occ background:cron
```

Dazu muss auf dem Server ein echter Cron laufen, der `cron.php` regelmäßig
aufruft (Nextcloud-Standard: alle 5 Minuten). Die Betriebsdiagnose auf der
Verwaltungsseite prüft das mit und meldet, wenn der letzte Lauf zu lange her
ist.

## SoundFont

Die Wiedergabe synthetisiert im Browser
([E1](architecture.md#e1-midi-statt-mp3-als-audioartefakt)) und braucht dafür ein
SoundFont. Woher es kommt, hängt vom gewählten Weg ab.

**Weg A: Hier ist nichts zu tun.** Die App holt es einmalig vom Sidecar, der
durch die MuseScore-Installation bereits eines mitbringt, legt es in ihrem
IAppData-Cache ab und liefert es selbst aus. Der Browser spricht nie mit dem
Sidecar.

**Weg B: Eine Download-URL eintragen.** Ohne Sidecar gibt es kein Image, aus dem
sich ein SoundFont nehmen ließe – ohne diese Einstellung bleibt die App stumm.
Das Feld **SoundFont-Download-URL** nennt eine Adresse, von der der **Server**
die Datei einmalig holt; danach liefert er sie selbst aus. Sie muss also nur vom
Server aus erreichbar sein und braucht kein CORS. Ein brauchbares, frei
lizenziertes General-MIDI-SoundFont ist `FluidR3Mono_GM.sf3` (~24 MB), das
MuseScore selbst mitbringt.

Geholt wird einmal je URL. Wer dieselbe Adresse später mit einer anderen Datei
belegt, speichert die Einstellung einmal neu.

In beiden Fällen überträgt der erste Abruf nach einer Neuinstallation ~40 MB zum
Browser. Danach greifen der serverseitige Cache und `Cache-Control: immutable`.

Das Feld **SoundFont-URL** ist etwas anderes: eine Übersteuerung, bei der der
**Browser** direkt von dieser Adresse lädt. Sie muss dann vom Browser aus
erreichbar sein und CORS erlauben; den Host trägt die App automatisch in die
`connect-src`-Richtlinie ein. Ein leeres Feld bedeutet: die App liefert selbst
aus.

## Einstellungen im Überblick

| Schlüssel | Wo | Bedeutung |
|---|---|---|
| `conversion_backend` | Verwaltung | `sidecar` (Voreinstellung) oder `local` |
| `sidecar_url` | Verwaltung | Adresse des Konvertierungsdienstes (Weg A) |
| `sidecar_secret` | Verwaltung | Shared Secret, als sensibel geführt und in `occ config:list` ausgeblendet (Weg A) |
| `node_path` | Verwaltung | Pfad zu `node`; leer = übliche Orte durchsuchen (Weg B) |
| `soundfont_fetch_url` | Verwaltung | Adresse, von der der Server das SoundFont einmalig holt (Weg B) |
| `soundfont_url` | Verwaltung | Übersteuerung: Der Browser lädt direkt von dieser Adresse |
| `eager_conversion` | Verwaltung | Beim Hochladen sofort konvertieren statt beim ersten Öffnen |
| `local_timeout` | nur `occ` | Zeitgrenze eines lokalen Konvertierungslaufs in Sekunden (Vorgabe 120) |
| `cjk_font_dir` | nur `occ` | Verzeichnis mit Zusatzfonts für CJK-Liedtexte, außerhalb der App (Weg B) |
| `max_score_bytes` | nur `occ` | Obergrenze der Dateigröße (Vorgabe 100 MB) |

## Prüfen, ob alles läuft

1. **Einstellungen → Verwaltung → ScoreView** öffnen. Die Betriebsdiagnose zeigt
   den Zustand des gewählten Konvertierungswegs, den SoundFont-Zustand, das
   Cron-Alter und die Zahl der Konvertierungen je Status.
2. Eine `.mscz`-Datei in Files hochladen und anklicken. Beim ersten Mal läuft
   die Konvertierung sichtbar an; danach öffnet dieselbe Datei aus dem Cache.

Wenn etwas klemmt: [Troubleshooting](troubleshooting.md).

## Aktualisieren

App-Updates laufen über den üblichen Weg (`occ upgrade`).

Der lokale Konverter kommt mit dem App-Paket und braucht keinen eigenen
Schritt.

Der Sidecar dagegen wird getrennt aktualisiert – neu bauen, alten Container
entfernen, neuen mit denselben Parametern starten:

```sh
docker build -t scoreview-musescore-cli sidecar/
docker rm -f scoreview-sidecar
docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET="<secret>" \
  --memory=2g --pids-limit=512 \
  scoreview-musescore-cli
```

Nach einem Wechsel der MuseScore-Version im Image den **Selbsttest** auslösen,
bevor das Image produktiv geht. Bereits konvertierte Partituren bleiben gültig;
ein Wechsel des Cache-Formats invalidiert sie automatisch (siehe
[Architektur](architecture.md#konvertierung-und-cache)).
