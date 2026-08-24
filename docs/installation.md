# Installation und Konfiguration

ScoreView besteht aus der Nextcloud-App und einem Konvertierungsdienst
(Sidecar), der als eigener Container daneben läuft. Beides muss eingerichtet
sein, sonst zeigt die App nur eine Fehlermeldung – der Sidecar ist
Voraussetzung, nicht Zubehör
([E3](architecture.md#e3-der-sidecar-ist-voraussetzung)).

Rechnen Sie mit 15 Minuten. Vier der fünf Schritte sind einmalig.

## Voraussetzungen

- Nextcloud 31 bis 35
- PHP 8.1 bis 8.5
- SQLite, MySQL/MariaDB oder PostgreSQL
- Ein Docker-Host für den Sidecar – dieselbe Maschine wie Nextcloud oder eine
  andere, erreichbar über HTTP
- Background-Jobs im Modus `cron` (Schritt 5)

Die `occ`-Befehle unten stehen so, wie sie auf einer nativen Installation
laufen. In einer Container-Installation davor `docker exec -u www-data
<container> php` setzen.

## 1. Sidecar starten

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

Über den Nextcloud App Store, oder das Verzeichnis `scoreview/` als
`apps/scoreview` ablegen. Danach:

```sh
occ app:enable scoreview
occ upgrade
```

## 3. Sidecar-Zugang eintragen

Unter **Einstellungen → Verwaltung → ScoreView** die Sidecar-URL (z. B.
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

Auf der Verwaltungsseite prüft ein Knopf die Verbindung und ein zweiter startet
den **Selbsttest** des Sidecars: eine echte Konvertierung der mitgelieferten
Minipartitur samt Prüfung aller Zusagen, auf denen die App aufbaut. Nach jedem
Wechsel der MuseScore-Version im Image einmal auslösen.

## 4. Mimetype registrieren

Ohne diesen Schritt erkennt Nextcloud `.mscz` als `application/octet-stream` und
bietet in Files nur „Herunterladen" an, nicht den Viewer.

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

**Hier ist nichts zu tun.** Die Wiedergabe synthetisiert im Browser
([E1](architecture.md#e1-midi-statt-mp3-als-audioartefakt)) und braucht dafür ein
SoundFont. Die App holt es einmalig vom ohnehin vorausgesetzten Sidecar, der
durch die MuseScore-Installation bereits eines mitbringt, legt es in ihrem
IAppData-Cache ab und liefert es selbst aus. Der Browser spricht nie mit dem
Sidecar.

Der erste Abruf nach einer Neuinstallation überträgt ~40 MB vom Sidecar zu
Nextcloud und von dort zum Browser. Danach greifen der serverseitige Cache und
`Cache-Control: immutable` im Browser.

Das Feld **SoundFont-URL** in den Verwaltungseinstellungen ist eine reine
Übersteuerung für ein anderes oder besseres SoundFont. Die Adresse muss dann vom
**Browser** aus erreichbar sein, nicht nur vom Server, und CORS erlauben; den
Host trägt die App automatisch in die `connect-src`-Richtlinie ein. Ein leeres
Feld bedeutet: das mitgelieferte SoundFont verwenden.

## Einstellungen im Überblick

| Schlüssel | Wo | Bedeutung |
|---|---|---|
| `sidecar_url` | Verwaltung | Adresse des Konvertierungsdienstes |
| `sidecar_secret` | Verwaltung | Shared Secret, als sensibel geführt und in `occ config:list` ausgeblendet |
| `soundfont_url` | Verwaltung | Optionale Übersteuerung des SoundFonts |
| `eager_conversion` | Verwaltung | Beim Hochladen sofort konvertieren statt beim ersten Öffnen |

## Prüfen, ob alles läuft

1. **Einstellungen → Verwaltung → ScoreView** öffnen. Die Betriebsdiagnose zeigt
   Sidecar-Erreichbarkeit, SoundFont-Zustand, Cron-Alter und die Zahl der
   Konvertierungen je Status.
2. Eine `.mscz`-Datei in Files hochladen und anklicken. Beim ersten Mal läuft
   die Konvertierung sichtbar an; danach öffnet dieselbe Datei aus dem Cache.

Wenn etwas klemmt: [Troubleshooting](troubleshooting.md).

## Aktualisieren

App-Updates laufen über den üblichen Weg (`occ upgrade`).

Der Sidecar wird getrennt aktualisiert – neu bauen, alten Container entfernen,
neuen mit denselben Parametern starten:

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
