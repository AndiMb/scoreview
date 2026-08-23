# ScoreView (Nextcloud-App)

Siehe Root-`README.md` für den Projektüberblick, `sidecar/README.md` für
den Konvertierungsdienst.

## Ersteinrichtung nach `app:enable`

```sh
docker exec -u www-data nextcloud-test php occ app:enable scoreview
docker exec -u www-data nextcloud-test php occ upgrade   # oder: bei reiner Migration ohne Versionssprung entfällt das
```

### 1. Sidecar-Zugang konfigurieren

Unter Einstellungen → Verwaltung → ScoreView: Sidecar-URL (z. B.
`http://scoreview-sidecar:8765`) und Shared Secret eintragen. Nextcloud
muss abgehende Anfragen an den (typischerweise internen) Sidecar-Hostnamen
zulassen:

```sh
docker exec -u www-data nextcloud-test php occ config:system:set allow_local_remote_servers --value=true --type=boolean
```

### 2. Mimetype registrieren (einmalig, serverweit)

`.mscz` wird von Nextcloud sonst generisch als `application/octet-stream`
erkannt (getestet). Anders als zunächst angenommen lädt Nextcloud
`appinfo/mimetypemapping.json`/`mimetypealiases.json` **nicht** automatisch
aus Apps - diese beiden Dateien hier sind nur Referenz/Dokumentation. Wirksam
wird es erst als **server-weite** `config/mimetypemapping.json` bzw.
`config/mimetypealiases.json` (Inhalt 1:1 aus den beiden Dateien hier
übernehmen, dabei ggf. vorhandene andere Einträge erhalten statt
überschreiben):

```sh
# Inhalt von appinfo/mimetypemapping.json nach config/mimetypemapping.json
# und appinfo/mimetypealiases.json nach config/mimetypealiases.json kopieren
# (auf dem NC-Server, nicht im App-Verzeichnis!), dann:
docker exec -u www-data nextcloud-test php occ maintenance:mimetype:update-db
docker exec -u www-data nextcloud-test php occ maintenance:mimetype:update-js
```

**Korrektur (2026-08-23, widerlegt eine frühere Annahme hier):**
`update-db` aktualisiert **nicht** den Filecache bereits vorhandener
Dateien - das wurde erneut geprüft und diesmal widerlegt: zwei schon vor
der Mimetype-Registrierung hochgeladene `.mscz`-Dateien blieben auch nach
`update-db`/`update-js` dauerhaft auf `application/octet-stream` stehen
(sichtbar u.a. daran, dass Files sie nur zum Download anbot statt den
Viewer zu öffnen). Für **bereits vorhandene** Dateien ist zusätzlich ein
gezielter Rescan nötig:

```sh
docker exec -u www-data nextcloud-test php occ files:scan <Nutzername>
# oder fuer alle Nutzer, teurer:
docker exec -u www-data nextcloud-test php occ files:scan --all
```

Neu hochgeladene Dateien bekommen den korrekten Mimetype dagegen sofort,
ganz ohne Rescan - das Problem betrifft ausschließlich den Bestand von vor
der Registrierung.

Verifiziert: `.mscz`-Upload danach per WebDAV-PROPFIND geprüft, liefert
`application/x-musescore` statt `application/octet-stream`.

### 3. Wiedergabe (Ton) - nichts zu tun

Die Synthese passiert im Browser (PLAN.md E1) und braucht dafür ein
SoundFont. Das liefert die App selbst aus (`GET /apps/scoreview/api/soundfont`);
sie holt es einmalig vom ohnehin vorausgesetzten Sidecar, der durch die
MuseScore-Installation bereits eines mitbringt, und legt es in ihrem
IAppData-Cache ab. **Es ist keine Konfiguration nötig.**

Bis 0.0.8 war das anders: ohne die Admin-Einstellung „SoundFont-URL" gab es
schlicht keinen Ton, und diese Einstellung ist im Auslieferungszustand leer -
die App war also standardmäßig stumm. Das Feld gibt es weiterhin, aber nur
noch als **Übersteuerung** für ein anderes/besseres SoundFont; es muss dann
vom Browser aus erreichbar sein und CORS erlauben (`Listener\AddCspListener`
trägt den Host automatisch in `connect-src` ein).

Der erste Abruf nach einer Neuinstallation überträgt ~40 MB vom Sidecar zu
Nextcloud und von dort zum Browser; danach greifen der IAppData-Cache
serverseitig und `Cache-Control: immutable` im Browser.

## Troubleshooting

**Eine `.mscz`-Datei lässt sich nur herunterladen, der Viewer öffnet sich
nicht.** Fast immer ein Mimetype-Problem - siehe Abschnitt 2 oben, dabei
insbesondere den Rescan für den betroffenen Nutzer nicht vergessen:
`occ files:scan <Nutzername>`. Prüfen per direkter DB-Abfrage:

```sh
docker exec -u www-data nextcloud-test php -r '
require "/var/www/html/lib/base.php";
$db = \OCP\Server::get(\OCP\IDBConnection::class);
$qb = $db->getQueryBuilder();
$qb->select("fileid","path","mimetype")->from("filecache")
   ->where($qb->expr()->like("name", $qb->createNamedParameter("%.mscz")));
foreach ($qb->executeQuery()->fetchAll() as $row) { print_r($row); }
'
```
`mimetype` muss die ID von `application/x-musescore` sein (herausfinden
über `SELECT * FROM oc_mimetypes WHERE mimetype LIKE '%musescore%'`), nicht
z.B. `21` (`application/octet-stream`).

**Der Viewer öffnet sich, zeigt aber „Fehler: Request failed with status
code 500".** War bis PLAN.md Phase 12 ein bekanntes Problem bei einem
`scoreview_conversions`-Datensatz mit `status = ready`, dessen
IAppData-Cache-Ordner noch im **alten** Format vorlag (z.B. aus der Zeit
vor der Umstellung auf `--score-media`/`page-N.svg`+`meta.json` in
PLAN.md Phase 6/7) - der Cache-Schlüssel ist `(fileId, etag)`, und ein
unverändertes `etag` verhinderte, dass eine neue Konvertierung automatisch
angestoßen wurde, obwohl das Cache-Format nicht mehr zum aktuellen
Sidecar/Controller passte.

**Seit PLAN.md Phase 14 behoben:** die Spalte `format_version` markiert
jeden Datensatz mit seiner Cache-Formatversion; `status()`/
`serveCachedFile()` behandeln einen Datensatz mit älterer Version (oder
eine dabei fehlende Cache-Datei) automatisch wie „nicht fertig" und stoßen
selbst eine Neukonvertierung an - kein manuelles Löschen von Zeilen mehr
nötig. Tritt der 500er trotzdem noch auf, ist das ein neuer, noch nicht
dokumentierter Fall - `data/nextcloud.log` auf die konkrete Exception
prüfen, bevor man dieselbe manuelle Zeilen-Löschung wie früher versucht.

**Der Viewer zeigt „Kein Ton: …" über der Notenansicht.** Die Notenansicht
funktioniert dann weiter, nur die Wiedergabe nicht - der Text hinter dem
Doppelpunkt nennt die Ursache. Häufigste Fälle:

- *„Der Sidecar liefert kein SoundFont aus"* - das Sidecar-Image enthält
  keines (mehr). Prüfen und ggf. `SCOREVIEW_SOUNDFONT_PATH` setzen, siehe
  `sidecar/README.md`:
  ```sh
  docker exec nextcloud-test curl -s \
    -H "X-ScoreView-Secret: <secret>" \
    http://scoreview-sidecar:8765/soundfont/info
  ```
- *„SoundFont-Abruf fehlgeschlagen: HTTP 404"* - siehe den nächsten Punkt
  (Route-Cache).
- *HTTP-Fehler bei einer selbst eingetragenen SoundFont-URL* - die Adresse
  muss vom **Browser** aus erreichbar sein, nicht nur vom Server, und
  CORS erlauben. Leeres Feld = das mitgelieferte SoundFont verwenden.

**Eine neu hinzugefügte Route liefert 404, obwohl sie in `appinfo/routes.php`
steht** (trat beim Hinzufügen von `/api/soundfont` real auf). Nextclouds
`CachingRouter` legt die **komplette kompilierte Routentabelle für 3600 s**
im lokalen Cache ab, Schlüssel `<Host>#<BaseUrl>#rootCollection`
(`lib/private/Route/CachingRouter.php`). Eine neue Route existiert für
Anfragen mit demselben Host-Header also bis zu einer Stunde lang nicht -
und zwar host-genau: derselbe Request mit `Host: localhost` statt
`Host: localhost:8080` traf einen anderen Cache-Schlüssel und funktionierte
sofort, was das Fehlerbild sehr irreführend macht. Abhilfe: App-Version in
`appinfo/info.xml` erhöhen und `occ upgrade` laufen lassen (der übliche Weg)
oder den lokalen Cache leeren - im Container-Setup am einfachsten per
`docker restart nextcloud-test` (danach den Cron-Ersatzloop neu starten,
siehe unten).

**„database is locked"-Fehler (SQLite) bei Login oder anderen Anfragen.**
Der manuelle Cron-Ersatzloop (siehe unten, „Background-Jobs ausführen")
läuft zu häufig und kollidiert mit parallelen Anfragen. Auf das
dokumentierte 15s-Intervall prüfen/zurücksetzen:

```sh
docker exec nextcloud-test ps aux | grep cron.php   # aktuellen Loop-Prozess finden
docker exec nextcloud-test kill <PID>
docker exec -d -u www-data nextcloud-test sh -c 'while true; do php -f /var/www/html/cron.php; sleep 15; done'
```
