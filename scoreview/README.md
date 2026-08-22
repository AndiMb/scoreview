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

`update-db` aktualisiert dabei auch gleich den Filecache bereits
vorhandener Dateien - ein zusätzliches `occ files:scan --all` war im Test
nicht nötig, schadet aber auch nicht, falls einzelne Dateien nicht erfasst
wurden.

Verifiziert: `.mscz`-Upload danach per WebDAV-PROPFIND geprüft, liefert
`application/x-musescore` statt `application/octet-stream`.
