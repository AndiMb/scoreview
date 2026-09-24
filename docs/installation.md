# Installation und Konfiguration

ScoreView besteht aus der Nextcloud-App und einem Konvertierungsweg. Davon gibt
es **zwei zur Wahl**, und sie liefern dasselbe Ergebnis
([E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api)):

| | **Weg A: Lokal** (Voreinstellung) | **Weg B: Sidecar** |
|---|---|---|
| Braucht | Node.js ≥ 18 auf dem Nextcloud-Server | einen Docker-Host |
| MuseScore | MuseScore 4.7.5 als WebAssembly, im App-Paket | echtes MuseScore 4 im Container |
| SoundFont | holt der Server selbst, Adresse voreingestellt | bringt der Container mit |
| Einzurichten | nichts | Container starten, Adresse und Secret eintragen |
| Empfohlen, wenn | keine Container laufen | ohnehin welche laufen |

**Weg A ist voreingestellt und braucht keine Einstellung.** Wo eine
Node-Laufzeit vorhanden ist, ist die App nach `occ app:enable scoreview`
betriebsbereit; es bleiben die Schritte 4 und 5 unten, die beide Wege
betreffen. Für Weg B rechnen Sie mit 15 Minuten.

**Und wenn keins von beidem geht?** Auf verwaltetem Hosting – keine
Node-Laufzeit, keine Container, `proc_open` gesperrt – konvertiert die App im
Browser der Nutzerin
([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)). Dafür ist
nichts einzurichten: Der Rückfall greift von selbst, sobald der Server nicht
kann, und meldet sich in der Betriebsdiagnose. Zu wissen ist nur, was er
kostet – jedes Gerät lädt einmal rund 14 MB, und zwischengespeichert wird
nichts. Wo der Server konvertieren kann, ist er nicht aktiv.

## Voraussetzungen

- Nextcloud 31 bis 35
- PHP 8.1 bis 8.5
- SQLite, MySQL/MariaDB oder PostgreSQL
- Background-Jobs im Modus `cron` (Schritt 5)
- Je nach Weg: **A** eine Node.js-Laufzeit ab Version 18 auf dem
  Nextcloud-Server, und PHP muss Prozesse starten dürfen (`proc_open` nicht per
  `disable_functions` gesperrt). **B** ein Docker-Host – dieselbe Maschine wie
  Nextcloud oder eine andere, erreichbar über HTTP. **Keins von beidem** ist
  auch möglich: Dann konvertiert der Browser (siehe oben); vorausgesetzt wird
  dafür ein Browser, der WebAssembly und Web Worker beherrscht – also jeder
  aktuelle.
- Auf Weg A einmalig ausgehendes HTTPS vom Server: Von dort holt er beim ersten
  Abspielen das SoundFont. Wo das nicht geht, tritt eine eigene Adresse an die
  Stelle der voreingestellten – siehe [SoundFont](#soundfont).

Die `occ`-Befehle unten stehen so, wie sie auf einer nativen Installation
laufen. In einer Container-Installation davor `docker exec -u www-data
<container> php` setzen.

## 1a. Weg A: Node.js bereitstellen

Für den lokalen Weg ist nichts zu bauen und nichts zu starten – der Konverter
liegt fertig im App-Paket (`scoreview/converter/`, rund 15 MB). Nötig ist nur
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

## 1b. Weg B: Sidecar starten

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

## 2. App installieren

Über den Nextcloud App Store, oder das Archiv `scoreview.tar.gz` eines
[GitHub-Releases](https://github.com/AndiMb/scoreview/releases) nach `apps/`
entpacken, sodass `apps/scoreview` entsteht. Ein Git-Checkout von `scoreview/`
genügt nicht: Frontend-Bundle (`js/`) und Konverter-Engine
(`converter/node_modules`) sind nicht eingecheckt, sie entstehen erst beim Bauen
([Entwicklung](development.md)). Danach:

```sh
occ app:enable scoreview
occ upgrade
```

## 3. Konvertierungsweg einstellen

Unter **Einstellungen → Verwaltung → ScoreView** steht die Wahl ganz oben; sie
schaltet darunter frei, was jeweils einzutragen ist. Voreingestellt ist der
lokale Weg.

### Weg A: Lokal

**Hier ist nichts einzustellen.** Liegt `node` an einer der üblichen Stellen,
findet die App es selbst; das SoundFont holt der Server beim ersten Abspielen
von einer voreingestellten Adresse (siehe [SoundFont](#soundfont)). Nur wenn
`node` woanders liegt, braucht es eine Angabe:

```sh
occ config:app:set scoreview node_path --value=/usr/bin/node   # nur falls nötig
```

### Weg B: Sidecar

Den Sidecar auswählen, seine URL (z. B. `http://scoreview-sidecar:8765`) und das
Secret aus Schritt 1b eintragen. Alternativ auf der Kommandozeile:

```sh
occ config:app:set scoreview conversion_backend --value=sidecar
occ config:app:set scoreview sidecar_url --value="http://scoreview-sidecar:8765"
occ config:app:set scoreview sidecar_secret --value="<secret>" --sensitive
```

Nextcloud blockiert ausgehende Anfragen an lokale und interne Hostnamen
(SSRF-Schutz). Ohne die folgende Einstellung schlägt jeder Sidecar-Aufruf mit
„violates local access rules" fehl – dieselbe Einstellung brauchen auch
Collabora- und OnlyOffice-Integrationen. Das gilt ebenso für einen Sidecar auf
einem anderen Host, solange er unter einer privaten IP oder einem internen
Namen erreichbar ist:

```sh
occ config:system:set allow_local_remote_servers --value=true --type=boolean
```

### Prüfen

Auf der Verwaltungsseite prüft ein Knopf den Zustand und ein zweiter startet den
**Selbsttest**: eine echte Konvertierung der mitgelieferten Minipartitur über
den gewählten Weg, samt Prüfung aller Zusagen, auf denen die App aufbaut. Nach
jedem Wechsel der MuseScore-Version einmal auslösen.

## 4. Mimetype (in der Regel nichts zu tun)

Damit eine `.mscz` als `application/x-musescore` gilt, **trägt die App den
Mimetype selbst ein** – bei der Installation, bei jedem Update und nach jedem
Upload erneut
([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)). Dafür
braucht es weder `occ` noch Schreibzugriff auf `config/`; auf verwaltetem
Hosting funktioniert es genauso.

Prüfen lässt sich das ohne Shell, mit den Zugangsdaten einer Nutzerin:

```sh
curl -u <Nutzerin> -X PROPFIND -H 'Depth: 0' \
  --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontenttype/></d:prop></d:propfind>' \
  'https://<instanz>/remote.php/dav/files/<Nutzerin>/Pfad/Partitur.mscz'
```

Steht dort `application/x-musescore`, ist alles in Ordnung. Steht dort
`application/octet-stream`, lief entweder das Update der App noch nicht, oder
die Partitur wurde gerade erst hochgeladen und der zuständige Background-Job
ist noch nicht gelaufen (siehe Schritt 5 – ohne Cron bleibt er liegen).

### Was die Registrierung von Hand zusätzlich bringt

Zwei Dinge kann eine App nicht, beide rein kosmetisch bzw. zeitlich:

- **Das eigene Dateisymbol.** Es hängt an `mimetypealiases.json` und an
  `occ maintenance:mimetype:update-js`.
- **Die Erkennung beim Upload.** Nextcloud fragt dafür seine eigene
  Zuordnungstabelle; eine frisch hochgeladene Partitur trägt deshalb bis zum
  nächsten Cron-Lauf `application/octet-stream`.

Wer `occ` hat und beides will, übernimmt den Inhalt von
`scoreview/appinfo/mimetypemapping.json` und
`scoreview/appinfo/mimetypealiases.json` in `config/mimetypemapping.json` bzw.
`config/mimetypealiases.json` des Servers – vorhandene andere Einträge dabei
erhalten, nicht überschreiben; Nextcloud legt die eigene Datei per
`array_replace` nur über die mitgelieferte, die Standardzuordnungen bleiben
also erhalten. Danach:

```sh
occ maintenance:mimetype:update-db
occ maintenance:mimetype:update-js
```

`update-db` zieht den **Bestand mit**: Für jeden Mimetype, der noch nicht in
der Datenbank steht, aktualisiert es zugleich alle Filecache-Zeilen mit der
passenden Endung – quer über alle Speicher, Gruppenordner und Freigaben
eingeschlossen. Ein `occ files:scan` ist dafür nicht nötig. Nur wenn der
Mimetype bereits eingetragen war, bleibt der Bestand unberührt; dann hilft
`occ maintenance:mimetype:update-db --repair-filecache`.

## 5. Background-Jobs sicherstellen

Konvertierungen laufen als Background-Job. Nextclouds Default-Modus `ajax`
reicht dafür nicht zuverlässig: Jobs bleiben sichtbar auf `pending` stehen, wenn
kein Seitenaufruf sie anstößt. Der Viewer weist nach zwei Minuten auf diese
Ursache hin und gibt nach einer halben Stunde auf – eine Partitur lässt sich
ohne laufenden Cron also gar nicht öffnen.

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

**In beiden Fällen ist nichts zu tun** – die Wege dorthin sind nur verschieden.

**Weg A: von einer Adresse, die voreingestellt ist.** Ohne Sidecar gibt es kein
Image, aus dem sich ein SoundFont nehmen ließe, und mitliefern lässt es sich
nicht: Der App Store nimmt nur Archive bis 20 MB, die MuseScore-WebAssembly
belegt davon den Großteil. Der **Server** holt die Datei deshalb einmalig aus
dem Netz und liefert sie danach selbst aus; voreingestellt ist
`FluidR3Mono_GM.sf3` (~23 MB, MIT-lizenziert, dasselbe SoundFont, das auch
MuseScore mitbringt) als Release-Asset dieses Projekts.

Das Feld **SoundFont-Download-URL** überschreibt diese Adresse. Sie muss nur vom
Server aus erreichbar sein und braucht kein CORS. Geholt wird einmal je URL –
wer dieselbe Adresse später mit einer anderen Datei belegt, speichert die
Einstellung einmal neu.

**Weg B: aus dem Container.** Läuft ein Sidecar, holt die App das SoundFont von
dort, denn dessen MuseScore-Installation bringt bereits eines mit – nichts wird
aus dem Netz geladen. Der Browser spricht dabei nie mit dem Sidecar; die App legt
die Datei in ihrem IAppData-Cache ab und liefert sie selbst aus.

Der erste Abruf nach einer Neuinstallation überträgt das SoundFont einmal zum
Browser: ~23 MB bei Weg A (`FluidR3Mono_GM`), ~40 MB bei Weg B
(`MuseScore_General_Lite` aus dem Sidecar-Image). Danach greifen der serverseitige Cache und `Cache-Control: immutable`.

Das Feld **SoundFont-URL** ist etwas anderes: eine Übersteuerung, bei der der
**Browser** direkt von dieser Adresse lädt. Sie muss dann vom Browser aus
erreichbar sein und CORS erlauben; den Host trägt die App automatisch in die
`connect-src`-Richtlinie ein. Ein leeres Feld bedeutet: die App liefert selbst
aus.

## Probe und Konzert

Leitung, „Folgt mir“, eigene Aufnahmen und die Rückmeldung zur Intonation
sind nach der Installation eingeschaltet und brauchen nichts weiter. Unter
**Einstellungen → Verwaltung → ScoreView → Probe und Konzert** lassen sie
sich einzeln abschalten; eine abgeschaltete Funktion verschwindet aus dem
Viewer, und ihre Endpunkte antworten 404. Drei Dinge sind trotzdem zu wissen.

### `notify_push` für „Folgt mir“ (empfohlen)

Ohne Push fragt jedes Folgegerät während einer Sitzung alle 800 ms beim Server
nach. Das kostet rund 50 ms CPU je Gerät und Abfrage – bei 40 Sängerinnen 2–3
Kerne für die Dauer der Probe ([Grenzwerte](limits.md#folgt-mir)). Mit der App
[`notify_push`](https://github.com/nextcloud/notify_push) schickt der Server
bei jeder Änderung ein Ereignis, und die Geräte fragen nur noch dann.
ScoreView braucht dafür keine eigene Einstellung: Ist `notify_push`
installiert und eingerichtet, wird es benutzt, sonst wird abgefragt.

```sh
occ app:install notify_push
occ notify_push:setup   # führt durch Dienst und Reverse-Proxy
```

Die Betriebsdiagnose zeigt unter **„Folgt mir“**, ob Push greift, und rät ab
etwa 20 Folgegeräten zur Installation. Wo `notify_push` nicht in Frage kommt,
senkt ein größeres **Abfrageintervall** (`follow_poll_ms`, 500–3000 ms) die
Last – um den Preis späterer Sprünge. Die mobilen Apps fragen immer ab, auch
mit `notify_push`.

Einen Cron-Lauf braucht „Folgt mir“ nicht: Alles geschieht in den Anfragen
selbst.

### Uploadgröße für Aufnahmen

Eine Aufnahme wird als eine WAV-Datei hochgeladen, bei der Vorgabe von höchstens
600 s rund 19 MB. Der Webserver vor Nextcloud muss Anfragen dieser Größe
annehmen – bei nginx `client_max_body_size` mindestens `20M` (Nextclouds
empfohlene nginx-Konfiguration setzt ohnehin mehr). Die PHP-Grenzen
`upload_max_filesize`/`post_max_size` spielen keine Rolle, die App liest den
Rumpf selbst und zieht ihre eigene Grenze. Wer `max_recording_seconds` anhebt,
rechnet mit etwa 32 KB je Sekunde.

Aufnahmen liegen in den App-Daten (IAppData) und zählen gegen **kein**
Kontingent der Nutzerinnen. Deshalb hat die App eigene Grenzen, einstellbar in
der Verwaltung (dort in MB) oder per `occ` (in Bytes):

```sh
occ config:app:set scoreview max_recordings_per_score --value 5
occ config:app:set scoreview max_recording_seconds --value 600
occ config:app:set scoreview max_recording_bytes_per_user --value 209715200    # 200 MB
occ config:app:set scoreview max_recording_bytes_total --value 5368709120      # 5 GB
```

Werte außerhalb der erlaubten Spanne werden beim Lesen begrenzt (siehe
Tabelle unten).

### Mikrofon

Nextcloud sperrt das Mikrofon auf jeder Seite per `Feature-Policy`. ScoreView
gibt es auf den Seiten unter `/apps/files` und auf der Seite für die mobilen
Apps frei, und nur, solange Aufnahme oder Intonation eingeschaltet sind –
Dashboard, Talk und alles Übrige bleiben unberührt. Eine erteilte Erlaubnis
des Browsers gilt dann innerhalb von Files für alle Skripte dort, wie bei Talk.
Wer das nicht will, schaltet Aufnahme und Intonation ab; die Freigabe entfällt
damit.

Das Mikrofon braucht einen sicheren Kontext, also HTTPS (oder `localhost`).

### Begleit-Token der mobilen Apps

Für Setlisten stellt die App aus der Seite der mobilen Apps heraus kurzlebige
Begleit-Token aus (höchstens 12 h,
[E8](architecture.md#e8-eine-eigenständige-seite-für-die-mobilen-apps)). Das
Geheimnis dafür legt die App bei Installation und Update an. Alle ausgegebenen
Token auf einmal widerrufen heißt, es zu verwerfen:

```sh
occ config:app:delete scoreview companion_secret
```

Beim nächsten Gebrauch entsteht ein neues; nach spätestens 3 s greift der
Wechsel überall. Eine abgewiesene Anfrage lässt die Seite selbst neue Token
holen, solange ihr Direct-Editing-Token noch gilt. Die Token einer einzelnen Person verfallen außerdem, wenn sie ihr
Passwort ändert oder ihr Konto deaktiviert wird.

## Einstellungen im Überblick

| Schlüssel | Wo | Bedeutung |
|---|---|---|
| `conversion_backend` | Verwaltung | `local` (Voreinstellung) oder `sidecar` |
| `node_path` | Verwaltung | Pfad zu `node`; leer = übliche Orte durchsuchen (Weg A) |
| `soundfont_fetch_url` | Verwaltung | Adresse, von der der Server das SoundFont einmalig holt; leer = voreingestellte Adresse (Weg A) |
| `sidecar_url` | Verwaltung | Adresse des Konvertierungsdienstes (Weg B) |
| `sidecar_secret` | Verwaltung | Shared Secret, als sensibel geführt und in `occ config:list` ausgeblendet (Weg B) |
| `soundfont_url` | Verwaltung | Übersteuerung: Der Browser lädt direkt von dieser Adresse |
| `eager_conversion` | Verwaltung | Beim Hochladen sofort konvertieren statt beim ersten Öffnen |
| `local_timeout` | nur `occ` | Zeitgrenze eines lokalen Konvertierungslaufs in Sekunden (Vorgabe 120) |
| `cjk_font_dir` | nur `occ` | Verzeichnis mit Zusatzfonts für CJK-Liedtexte, außerhalb der App (Weg A) |
| `max_score_bytes` | nur `occ` | Obergrenze der Dateigröße (Vorgabe 100 MB) |
| `client_max_score_bytes` | nur `occ` | Obergrenze für die Konvertierung **im Browser**, deutlich kleiner (Vorgabe 10 MB). Geprüft, bevor der Browser die Engine lädt |
| `feature_follow_session` | Verwaltung | Leitung und „Folgt mir“ (Vorgabe an) |
| `feature_recording` | Verwaltung | Eigene Aufnahmen (Vorgabe an) |
| `feature_intonation` | Verwaltung | Rückmeldung zur Intonation (Vorgabe an) |
| `feature_score_follower` | nur `occ` | Vorgesehen für das Mitverfolgen per Mikrofon, noch ohne Funktion (Vorgabe aus) |
| `follow_poll_ms` | Verwaltung | Abfrageintervall von „Folgt mir“ ohne Push in ms (Vorgabe 800, erlaubt 500–3000) |
| `max_recordings_per_score` | Verwaltung | Aufnahmen je Person und Partitur (Vorgabe 5, 1–50) |
| `max_recording_seconds` | Verwaltung | Höchstlänge einer Aufnahme in Sekunden (Vorgabe 600, 10–3600) |
| `max_recording_bytes_per_user` | Verwaltung (MB), `occ` (Bytes) | Speicher für Aufnahmen je Person (Vorgabe 200 MB, 10 MB–100 GB) |
| `max_recording_bytes_total` | Verwaltung (MB), `occ` (Bytes) | Speicher für Aufnahmen auf der ganzen Instanz (Vorgabe 5 GB, 100 MB–10 TB) |
| `companion_secret` | nur `occ` | Geheimnis der Begleit-Token, sensibel geführt; löschen widerruft alle ([oben](#begleit-token-der-mobilen-apps)) |

## Prüfen, ob alles läuft

1. **Einstellungen → Verwaltung → ScoreView** öffnen. Die Betriebsdiagnose zeigt
   den Zustand des gewählten Konvertierungswegs, den SoundFont-Zustand, das
   Cron-Alter und die Zahl der Konvertierungen je Status. Steht dort eine Zeile
   **Rückfall**, konvertiert gerade der Browser – die Zeile darüber nennt den
   Grund, aus dem der Server es nicht tut.
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
