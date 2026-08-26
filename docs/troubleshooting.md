# Troubleshooting

Nach Symptom sortiert. Erste Anlaufstelle bei jedem Problem ist
**Einstellungen → Verwaltung → ScoreView**: Die Betriebsdiagnose dort zeigt
Sidecar-Erreichbarkeit, SoundFont-Zustand, Alter des letzten Cron-Laufs und die
Zahl der Konvertierungen je Status.

## Eine `.mscz`-Datei bietet nur „Herunterladen" an

Fast immer ein Mimetype-Problem. Die Registrierung wirkt **nicht rückwirkend**:
Dateien, die vor der Registrierung hochgeladen wurden, bleiben dauerhaft auf
`application/octet-stream` stehen, auch nach
`occ maintenance:mimetype:update-db`. Der Bestand braucht zusätzlich einen
Rescan:

```sh
occ files:scan <Nutzername>
```

Siehe [Installation, Schritt 4](installation.md#4-mimetype-registrieren). Prüfen
lässt sich der gespeicherte Mimetype direkt in der Datenbank:

```sh
php -r '
require "/var/www/html/lib/base.php";
$db = \OCP\Server::get(\OCP\IDBConnection::class);
$qb = $db->getQueryBuilder();
$qb->select("fileid","path","mimetype")->from("filecache")
   ->where($qb->expr()->like("name", $qb->createNamedParameter("%.mscz")));
foreach ($qb->executeQuery()->fetchAll() as $row) { print_r($row); }
'
```

`mimetype` muss die ID von `application/x-musescore` sein – herauszufinden über
`SELECT * FROM oc_mimetypes WHERE mimetype LIKE '%musescore%'` –, nicht die von
`application/octet-stream`.

## Der Viewer dreht sich endlos, die Konvertierung bleibt auf „pending"

Background-Jobs laufen nicht. Nextclouds Default-Modus `ajax` reicht nicht
zuverlässig; es braucht `cron` **und** einen echten Cron-Aufruf von `cron.php`:

```sh
occ background:cron
```

Die Betriebsdiagnose meldet diesen Fall ausdrücklich („kein Lauf in den letzten
15 Minuten"). Siehe
[Installation, Schritt 5](installation.md#5-background-jobs-sicherstellen).

## „Der Konvertierungsdienst konnte nicht erreicht werden"

Gilt für den Sidecar-Weg. Drei Ursachen, in dieser Reihenfolge zu prüfen:

1. **Kein gemeinsames Docker-Netz.** Auf Dockers Standard-Bridge lösen sich
   Containernamen nicht auf. Der Sidecar läuft, `curl` vom Host funktioniert,
   Nextcloud erreicht ihn trotzdem nicht. Beide Container müssen in dasselbe
   benutzerdefinierte Netz (`--network`).
2. **SSRF-Schutz.** Nextcloud blockiert ausgehende Anfragen an interne
   Hostnamen. Ohne
   `occ config:system:set allow_local_remote_servers --value=true --type=boolean`
   scheitert jeder Aufruf mit „violates local access rules".
3. **Falsches Secret.** Der Sidecar antwortet dann 401. Der Selbsttest-Knopf auf
   der Verwaltungsseite unterscheidet die Fälle.

## Der lokale Konvertierungsweg läuft nicht

Die Betriebsdiagnose auf der Verwaltungsseite beantwortet die drei Fragen
getrennt, weil sie von außen alle gleich aussehen:

- **„PHP darf keine Prozesse starten"** – `proc_open` ist per
  `disable_functions` gesperrt. Das lässt sich nur in der PHP-Konfiguration
  ändern; wo das nicht geht, bleibt nur der Sidecar-Weg.
- **„Keine Node.js-Laufzeit gefunden"** – gesucht wird `node` über `PATH` und
  an den üblichen Stellen. PHP-FPM läuft oft mit einem ausgedünnten `PATH`;
  dann den absoluten Pfad eintragen. Gegenprobe mit demselben Konto, unter dem
  Nextcloud läuft:
  ```sh
  sudo -u www-data /usr/bin/node --version
  ```
- **„Das webmscore-Paket fehlt"** – im App-Paket fehlt
  `converter/node_modules`. Das passiert, wenn die App aus einem Git-Checkout
  statt aus einem Release-Tarball installiert wurde; dort ist das Verzeichnis
  gitignored. Nachholen mit `npm ci` in `scoreview/converter/`.

Der Selbsttest-Knopf konvertiert eine mitgelieferte Minipartitur über den
gewählten Weg und nennt die Ursache im Klartext. Dasselbe von Hand:

```sh
cd /var/www/html/custom_apps/scoreview/converter && node convert.mjs --selftest
```

## „Kein Ton: …" über der Notenansicht

Die Notenansicht funktioniert weiter, nur die Wiedergabe nicht; der Text hinter
dem Doppelpunkt nennt die Ursache.

- **„Der Sidecar liefert kein SoundFont aus"** – das Image enthält keines
  (mehr). Prüfen und gegebenenfalls `SCOREVIEW_SOUNDFONT_PATH` setzen, siehe
  [`../sidecar/README.md`](../sidecar/README.md#konfiguration):
  ```sh
  curl -s -H "X-ScoreView-Secret: <secret>" http://scoreview-sidecar:8765/soundfont/info
  ```
- **Stumm auf dem lokalen Konvertierungsweg** – dort gibt es kein Image, das ein
  SoundFont mitbrächte. Ohne die Einstellung **SoundFont-Download-URL** bleibt
  die Wiedergabe stumm; siehe [Installation](installation.md#soundfont).
- **HTTP-Fehler bei einer selbst eingetragenen SoundFont-URL** – bei der
  **SoundFont-URL** muss die Adresse vom **Browser** aus erreichbar sein, nicht
  nur vom Server, und CORS erlauben. Bei der **SoundFont-Download-URL** genügt
  Erreichbarkeit vom Server. Ein leeres Feld verwendet das mitgelieferte
  SoundFont.

## Die Konvertierung schlägt fehl

Der Viewer zeigt eine verständliche Meldung, das technische Detail steht
daneben. Die Fehlercodes:

| Code | Bedeutung | Was hilft |
|---|---|---|
| `sidecar_unreachable` | Dienst nicht erreichbar | siehe oben |
| `sidecar_rejected` | Datei abgelehnt (z. B. Secret, Größe) | Secret und `SCOREVIEW_MAX_UPLOAD_BYTES` prüfen |
| `too_large` | Partitur überschreitet das Limit | Limit anheben oder Partitur teilen |
| `timeout` | Konvertierung nicht rechtzeitig fertig | Sidecar: `MSCORE_TIMEOUT_SECONDS` anheben – rund 5,4 s pro Seite einplanen, siehe [Grenzwerte](limits.md). Lokal: `local_timeout` (Vorgabe 120 s) |
| `conversion_failed` | MuseScore selbst ist gescheitert | Datei in MuseScore öffnen; oft eine defekte `.mscz`. Auf dem lokalen Weg steht die Ausgabe des Konverters im `nextcloud.log` |
| `no_pages` | Konvertierung lief, lieferte aber keine Seite | Selbsttest auslösen; deutet auf ein Problem im Image hin |
| `local_unavailable` | Lokaler Weg gewählt, aber nicht lauffähig | siehe [oben](#der-lokale-konvertierungsweg-läuft-nicht) |
| `unknown` | Alles andere | `nextcloud.log` auf die Exception prüfen |

## Der Viewer meldet HTTP 500

Ein Cache-Formatwechsel ist **kein** möglicher Grund mehr: Die Spalte
`format_version` markiert jeden Eintrag, und ein Eintrag mit älterer Version –
oder mit fehlender Cache-Datei – stößt automatisch eine Neukonvertierung an
(siehe [Architektur](architecture.md#konvertierung-und-cache)). Tritt ein 500er
auf, ist es ein anderer Fall: `nextcloud.log` auf die konkrete Exception prüfen.

## „database is locked" (SQLite)

Cron läuft zu häufig und kollidiert mit parallelen Anfragen. Auf das übliche
Intervall zurückgehen (Nextcloud-Standard: alle 5 Minuten) oder auf
MySQL/PostgreSQL wechseln.

## Eine neu hinzugefügte Route liefert 404

Betrifft die Entwicklung, nicht den Betrieb. Nextclouds `CachingRouter` legt die
komplette kompilierte Routentabelle für 3600 s im lokalen Cache ab, mit dem
**Host-Header als Teil des Schlüssels**. Eine neue Route existiert für Anfragen
mit demselben Host also bis zu einer Stunde lang nicht – und zwar host-genau:
Derselbe Request mit `Host: localhost` statt `Host: localhost:8080` trifft einen
anderen Cache-Schlüssel und funktioniert sofort. Das macht das Fehlerbild sehr
irreführend.

Abhilfe: App-Version in `appinfo/info.xml` erhöhen und `occ upgrade` laufen
lassen (der übliche Weg), oder den lokalen Cache leeren – im Container-Setup am
einfachsten per Neustart des Nextcloud-Containers.
