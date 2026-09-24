# Troubleshooting

Nach Symptom sortiert. Erste Anlaufstelle bei jedem Problem ist
**Einstellungen → Verwaltung → ScoreView**: Die Betriebsdiagnose dort zeigt
Sidecar-Erreichbarkeit, den Zustand des lokalen Wegs (Prozessstart, Node.js,
Engine-Paket), einen aktiven Rückfall im Browser, SoundFont-Zustand, Alter des
letzten Cron-Laufs und die Zahl der Konvertierungen je Status.

## Eine `.mscz`-Datei bietet nur „Herunterladen" an

Fast immer ein Mimetype-Problem. Den Mimetype trägt die App seit 1.9.2 selbst
ein – bei Installation, Update und nach jedem Upload
([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)). Bleibt er
falsch, sind drei Dinge zu prüfen, in dieser Reihenfolge:

1. **Lief das Update der App?** Der Repair-Step hängt an `occ upgrade`; ohne
   Versionswechsel läuft er nicht.
2. **Läuft Cron?** Frisch hochgeladene Partituren berichtigt ein
   Background-Job, kein Upload-Pfad. Ohne Cron bleibt er liegen (siehe
   [Installation, Schritt 5](installation.md#5-background-jobs-sicherstellen)).
3. **Meldet der Server einen Fehler?** `apply()` schluckt jeden Fehlschlag
   bewusst und schreibt ihn ins Log – dort steht dann „Mimetype konnte nicht
   registriert werden".

Ohne Shell prüfen lässt sich der Mimetype über WebDAV:

```sh
curl -u <Nutzerin> -X PROPFIND -H 'Depth: 0' \
  --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontenttype/></d:prop></d:propfind>' \
  'https://<instanz>/remote.php/dav/files/<Nutzerin>/Pfad/Partitur.mscz'
```

Erwartet wird `application/x-musescore`. Mit Shell geht es auch direkt in der
Datenbank:

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

## In der Nextcloud-App am Telefon fehlt „Bearbeiten“

Der Einstieg der mobilen Apps läuft über Nextclouds Direct Editing
([E8](architecture.md#e8-eine-eigenständige-seite-für-die-mobilen-apps)), und
dessen Auswahl hängt **allein am Mimetype**. Die Ersatz-Dateiaktion auf der
Endung, die im Browser einspringt, hat dort keine Entsprechung.

Erste Probe: Meldet der Server den Editor überhaupt?

```sh
curl -u <Nutzerin> -H 'OCS-APIRequest: true' -H 'Accept: application/json'   https://<instanz>/ocs/v2.php/apps/files/api/v1/directEditing
```

In der Antwort muss unter `editors` ein Eintrag `scoreview` stehen – mit
`"mimetypes":["application/x-musescore"]`. Fehlt der Eintrag ganz, ist die App
nicht aktiviert oder älter als 1.9.0. Steht er da und der Menüpunkt fehlt
trotzdem, ist der **Mimetype der Datei** nicht `application/x-musescore` –
siehe den Abschnitt ganz oben.

Zwei Eigenheiten der Android-App, die schon Zeit gekostet haben (beide in
nextcloud/android nachgesehen):

- **Die Editorliste ist zwischengespeichert.** Die App liest sie aus ihrer
  eigenen Datenbank (`EditorUtils.getEditors()`) und holt sie nur beim Sync des
  **Wurzelverzeichnisses** neu, und auch dann nur, wenn sich der ETag der
  Server-Capabilities geändert hat (`RefreshFolderOperation`). Auf der obersten
  Ebene einmal nach unten ziehen.
- **Auch den Mimetype je Datei hält die App lokal.** Wurde er serverseitig
  berichtigt, muss zusätzlich der **Ordner mit der Partitur** neu geladen
  werden – sonst vergleicht `FileMenuFilter.filterEdit()` weiter den alten
  Wert.

## In der App öffnet das Antippen einer `.mscz` eine fremde Anwendung

Kein Fehler, sondern die Vorrangregel der Android-App:
`FileOperationsHelper.openFile()` reicht die Datei an **jede installierte App**
weiter, die den Mimetype öffnen kann – Direct Editing ist dort ausdrücklich nur
der Rückfall („first always try to use available apps"). Wer etwa eine
MuseScore-App auf dem Telefon hat, landet beim Antippen dort, und deren
Fehlermeldung sieht dann aus, als käme sie von ScoreView.

ScoreView erreicht man in diesem Fall über **⋮ → „Bearbeiten"**. Vom Server aus
ist daran nichts zu ändern; die Entscheidung fällt auf dem Gerät.

## Die Seite in der App bleibt leer oder zeigt nur einen Fehler

Zwei Ursachen, am Verhalten zu unterscheiden.

**Der Ladebildschirm der App bleibt liegen und meldet nach zehn Sekunden einen
Timeout.** Dann hat die Seite ihr `loaded()` nicht abgesetzt – entweder ist das
Skript gar nicht angelaufen, oder die Brücke zur App fehlt. Im Zweifel `js/`
neu bauen (`npm run build`).

**Die Seite steht da, zeigt aber nichts von der Partitur.** Dann kommen ihre
Folgeanfragen nicht durch. Sie weisen sich mit einem Token im Header
`X-ScoreView-Token` aus; abgewiesen wird mit einem Code im Antwortkörper:

| Antwort | Bedeutung |
|---|---|
| `401 no_session` | Weder Sitzung noch Token – der Header fehlt |
| `401 token_expired` | Token abgelaufen oder verbraucht; die App holt daraufhin einen frischen. Direct-Editing-Token gelten 12 h und sind für `edit()` Einmal-Token – ein Neuladen der WebView von Hand läuft deshalb in die Fehlerseite der App |
| `403 token_file_mismatch` | Der Token gehört zu einer anderen Partitur |
| `403 token_folder_mismatch` | Eine neue Setliste soll außerhalb des Ordners der geöffneten Partitur entstehen – mit Token geht das nur dort |
| `403 direct_token_required` | Begleit-Token gibt es nur gegen das Direct-Editing-Token der Seite, nicht aus einer Sitzung und nicht aus einem anderen Begleit-Token |
| `401 companion_expired`, `companion_revoked`, `companion_invalid` | Das Begleit-Token eines Setlisten-Stücks ist abgelaufen (12 h), widerrufen (Passwortwechsel, Deaktivieren, neues `companion_secret`) oder passt nicht mehr zum Direct-Editing-Token. Die Seite holt sich selbst ein neues; bleibt es dabei, die Partitur in der App neu öffnen |
| `403 companion_purpose`, `companion_not_allowed` | Ein Begleit-Token an einer Route, für die es nicht gedacht ist – ein Fehler der Seite, kein Bedienfehler |
| `401 user_disabled` | Das Konto ist deaktiviert |

## „Das Mikrofon ist hier nicht verfügbar“

Aufnahme und Intonation brauchen das Mikrofon; die Meldung erscheint, wenn der
Browser es verweigert. Mit ihr kommt der Knopf **„Im Browser öffnen“**, der
dieselbe Partitur in einem neuen Browserfenster öffnet. Die Ursachen, in dieser
Reihenfolge:

1. **In der Nextcloud-App für Android** geht das Mikrofon grundsätzlich nicht –
   ihre WebView gibt es nicht frei, und von ScoreView aus ist daran nichts zu
   ändern ([Grenzwerte](limits.md#mobil)). „Im Browser öffnen“ ist dort der
   vorgesehene Weg.
2. **Die Erlaubnis wurde verweigert.** Im Browser über das Schloss- bzw.
   Einstellungssymbol neben der Adresse für diese Seite wieder erlauben.
3. **Die Seite erlaubt kein Mikrofon.** Nextcloud sperrt es per
   `Feature-Policy`, die App gibt es nur unter `/apps/files` frei und nur,
   solange Aufnahme oder Intonation eingeschaltet sind. Prüfen:

   ```sh
   curl -sI -u <Nutzerin> https://<instanz>/apps/files/ | grep -i feature-policy
   ```

   Dort muss `microphone 'self'` stehen, nicht `microphone 'none'`. Steht
   `'none'` da, sind beide Funktionen in der Verwaltung ausgeschaltet – oder
   ein Reverse-Proxy setzt eine eigene Richtlinie.
4. **Kein sicherer Kontext.** Über schlichtes `http://` (außer `localhost`) gibt
   es kein Mikrofon.

Die anderen Meldungen – „Es wurde kein Mikrofon gefunden“, „… wird von einer
anderen Anwendung benutzt“ – meinen das Gerät, nicht die Seite.

## Ein Klick auf eine Setliste öffnet den Texteditor

Eine `*.setlist.md` ist Markdown, und Markdown öffnet in Files sonst im
Texteditor. ScoreView nimmt den Klick über die Reihenfolge der Dateiaktionen
an sich ([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)).
Öffnet trotzdem Text:

- **Heißt die Datei wirklich auf `.setlist.md`?** `Konzert.md` ist keine
  Setliste, `Konzert.setlist.md` schon.
- **Sind Frontend und App aktuell?** Nach einem Update einmal hart neu laden
  (`Strg`+`Umschalt`+`R`).
- **Eine neue Nextcloud-Version kann die Reihenfolge der Aktionen anders
  auswerten.** Der Eintrag **„Als Setliste öffnen“** im Menü (⋯) der Datei
  bleibt der Ausweg.

In den mobilen Apps ist das kein Fehler: Sie bieten für Markdown Text an.
Dort öffnet man eine Partitur aus der Liste, und ScoreView bietet die
Setlisten aus demselben Ordner an ([Grenzwerte](limits.md#setliste)).

## „Folgt mir“ kommt auf einem Gerät nicht an

Cron spielt hier **keine** Rolle – alles läuft in den Anfragen selbst.

- **Folgt das Gerät überhaupt?** Eigenes Navigieren (Takteingabe, Klick auf
  eine Note, Suchlauf, Loop) löst es von der Leitung; das Abzeichen zeigt
  dann „Folgt … nicht“ und den Knopf „Zurück zur Leitung“. Blättern und Zoom lösen es nicht.
- **Hat es die Sitzung schon bemerkt?** Ohne laufende Sitzung fragt ein Gerät
  nur alle 15 s nach. Wer vor dem Start geöffnet hat, wartet also bis zu 15 s.
- **Steht die Verbindung?** Das Abzeichen zeigt „getrennt“, wenn eine Abfrage
  nicht innerhalb von 5 s beantwortet wird. Nach einem Funkloch holt das Gerät von selbst den
  letzten Stand; ein Anfangston, der dabei älter als 2 s geworden ist, wird
  bewusst nicht mehr gespielt.
- **Ist die Seite im Hintergrund?** Im Takt fragt nur eine sichtbare Seite ab.
- **Sieht das Gerät die Datei?** Folgen setzt Dateizugriff voraus; ohne ihn
  antwortet der Server 404.
- **Kommen die Sprünge spät?** Ohne `notify_push` bestimmt `follow_poll_ms` die
  Verzögerung; mit `notify_push` zeigt die Betriebsdiagnose, ob Push wirklich
  greift – ist der Dienst hinter dem Reverse-Proxy nicht erreichbar, fallen die
  Geräte stillschweigend aufs Abfragen zurück. Die mobilen Apps fragen immer ab.
- **Mehrere Webserver?** Ohne verteilten Cache (Redis) sieht jedes Gerät
  Änderungen bis zu einer Sekunde später
  ([E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).

## Eine Aufnahme lässt sich nicht speichern

Die Aufnahme bleibt dann im Speicher des Browsers, lässt sich abhören und über
„Erneut speichern“ noch einmal hochladen – bis die Seite neu geladen wird. Die
Meldung nennt den Grund:

| Antwort | Bedeutung | Was hilft |
|---|---|---|
| `409` | Die Höchstzahl an Aufnahmen für diese Partitur ist erreicht | die älteste ersetzen (die App fragt) oder eine löschen |
| `413` mit Meldung der App | Die Aufnahme ist länger als `max_recording_seconds` | kürzer aufnehmen oder die Grenze anheben |
| `413` ohne Meldung der App (Seite des Webservers) | Der Webserver nimmt so große Anfragen nicht an | `client_max_body_size` (nginx) auf mindestens `20M`, siehe [Installation](installation.md#uploadgröße-für-aufnahmen) |
| `507` „… all the storage allowed per person“ | Der Speicher je Person ist voll | ältere Aufnahmen löschen, oder `max_recording_bytes_per_user` anheben |
| `507` „… storage for recordings on this server is full“ | Der Speicher der Instanz für Aufnahmen ist voll | `max_recording_bytes_total` anheben |
| `404` | Die Partitur ist nicht (mehr) erreichbar, oder die Aufnahme gehört jemand anderem | – |

## Die Konvertierung kommt nicht voran

Background-Jobs laufen nicht. Nextclouds Default-Modus `ajax` reicht nicht
zuverlässig; es braucht `cron` **und** einen echten Cron-Aufruf von `cron.php`:

```sh
occ background:cron
```

Die Betriebsdiagnose meldet diesen Fall ausdrücklich („kein Lauf in den letzten
15 Minuten"). Siehe
[Installation, Schritt 5](installation.md#5-background-jobs-sicherstellen).

**Woran es im Viewer zu erkennen ist.** Nach zwei Minuten erscheint unter dem
Ladekreisel ein Hinweis auf genau diese Ursache, nach einer halben Stunde bricht
der Viewer mit „Die Konvertierung wurde nie abgeschlossen" ab. Beides ist eine
Aussage über die *Instanz*, nicht über die Partitur – eine andere Datei zu
öffnen hilft nicht.

Dasselbe gilt für einen Lauf, der unterwegs gestorben ist (abgewürgter
Cron-Durchgang, Speichermangel, Neustart des Containers). Der Datensatz bleibt
dann auf `processing` stehen; er gilt nach einer halben Stunde als tot, wird
beim nächsten Öffnen als Fehler gemeldet und erneut eingereiht. „Neu
konvertieren" greift an ihm ebenfalls wieder – anders als an einem Lauf, der
tatsächlich noch arbeitet.

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
- **„Das Engine-Paket (scoreview-engine) fehlt"** – im App-Paket fehlt
  `converter/node_modules`. Das passiert, wenn die App aus einem Git-Checkout
  statt aus einem Release-Tarball installiert wurde; dort ist das Verzeichnis
  gitignored. Nachholen mit `npm ci` in `scoreview/converter/`.

Der Selbsttest-Knopf konvertiert eine mitgelieferte Minipartitur über den
gewählten Weg und nennt die Ursache im Klartext. Dasselbe von Hand:

```sh
cd /var/www/html/custom_apps/scoreview/converter && node convert.mjs --selftest
```

## Die Betriebsdiagnose zeigt eine Zeile „Rückfall"

Dann konvertiert gerade der **Browser**, weil der Server es nicht kann
([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)). Das ist kein
Fehler, sondern die Notlösung – die Partituren sind sichtbar und spielbar.

**Die rote Zeile darüber bleibt trotzdem wichtig**: Sie nennt den Grund, aus
dem der Server nicht konvertiert (siehe die beiden Abschnitte davor). Solange
er besteht, gilt für jede Nutzerin:

- Jedes Gerät lädt beim ersten Öffnen einmal rund 14 MB Konverter.
- Nichts wird auf Dauer zwischengespeichert: Jede Partitur wird nach jedem
  Neuladen der Seite neu gesetzt, auf jedem Gerät.
- Der Schalter „sofort konvertieren" ist wirkungslos, der Selbsttest prüft
  weiterhin nur den Serverweg.

Behoben wird das nicht am Rückfall, sondern an seiner Ursache: Node bereitstellen
(Weg A) oder den Sidecar erreichbar machen (Weg B). Nach der Reparatur greift
der Rückfall beim nächsten Öffnen nicht mehr – das gespeicherte Urteil gilt
höchstens fünf Minuten und wird vom Speichern der Einstellungen und vom
Selbsttest sofort verworfen. Bereits im Browser gesetzte Partituren tauchen
danach ganz normal im Servercache auf, sobald sie einmal geöffnet werden.

## Der Viewer meldet „Diese Partitur konnte in diesem Browser nicht gesetzt werden"

Zwei Meldungen gehören zum Rückfall und stehen in keinem Serverlog, weil sie im
Browser entstehen:

- **„… ist zu groß, um in diesem Browser gesetzt zu werden"** – die Partitur
  liegt über `client_max_score_bytes` (Vorgabe 10 MB). Geprüft wird das
  absichtlich **vor** dem Laden des Konverters, damit nicht erst 14 MB umsonst
  über die Leitung gehen. Die Grenze ist eine reine `occ`-Einstellung:
  ```sh
  occ config:app:set scoreview client_max_score_bytes --value 20971520
  ```
  Sie höher zu setzen ist ein Versprechen an das schwächste Gerät im Chor –
  wie viel ein Tablet trägt, ist ungemessen (siehe [Grenzwerte](limits.md)).
- **„… konnte in diesem Browser nicht gesetzt werden"** – der Konverter ließ
  sich nicht laden oder nicht starten. Das technische Detail unter der Meldung
  nennt die genaue URL. Häufigste Ursachen: der Download brach ab, oder die
  Seite wurde geladen, **bevor** der Rückfall aktiv wurde – dann trägt genau
  dieses Dokument noch die engere CSP, und ein Neuladen genügt. Bleibt es
  dabei, in der Browser-Konsole nach `securitypolicyviolation` sehen: Ein
  blockierter Web Worker meldet sich **nur** dort und sonst nirgends.

## „scoreview-engine: engine initialisation failed" beim Konvertieren im Browser

Steht als technisches Detail unter „Die Partitur konnte nicht konvertiert
werden", bei jedem Öffnen und durch kein Neuladen zu beheben. Der Browser hält
dann einen Engine-Teil (`.wasm`) einer früheren Engine-Fassung im Cache und
setzt ihn unter die neue. Ab 1.10.1 trägt die Engine-Route die Version im Pfad
(`/api/engine/{version}/{name}`); ein solcher Cache wird damit nicht mehr
getroffen und heilt sich von selbst. **Abhilfe: den Server mindestens auf
1.10.1 bringen** – am Gerät ist nichts zu tun. Betroffen ist vor allem die
Android-App, deren WebView ihren Cache nicht von selbst räumt.

Dass der Browser überhaupt konvertiert, heißt, der Server kann es nicht
([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)). Den Grund
nennt die Betriebsdiagnose, häufig ist es eine fehlende Node.js-Laufzeit (siehe
[oben](#der-lokale-konvertierungsweg-läuft-nicht) und
[Installation](installation.md#1a-weg-a-nodejs-bereitstellen)).

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
  SoundFont mitbrächte; der Server holt es beim ersten Abspielen aus dem Netz.
  Kommt er dort nicht hin (kein ausgehendes HTTPS, Proxy, Firewall), bleibt die
  Wiedergabe stumm. Abhilfe: die Datei selbst irgendwo ablegen und die Adresse
  unter **SoundFont-Download-URL** eintragen; siehe
  [Installation](installation.md#soundfont).
- **HTTP-Fehler bei einer selbst eingetragenen SoundFont-URL** – bei der
  **SoundFont-URL** muss die Adresse vom **Browser** aus erreichbar sein, nicht
  nur vom Server, und CORS erlauben. Bei der **SoundFont-Download-URL** genügt
  Erreichbarkeit vom Server; ein leeres Feld bedeutet dort die voreingestellte
  Adresse, nicht „kein SoundFont".

## Der Ton hinkt dem Notencursor hinterher (oder umgekehrt)

Fast immer die **Ausgabelatenz** – am stärksten über Bluetooth-Kopfhörer, wo
Codec-Puffer und Funkstrecke den Ausschlag geben (gemessen: 232 ms an einem
Android-Telefon gegen 51 ms an einer Arbeitsmaschine); bei ♩ = 120 ist das fast
eine Achtelnote. Die App gleicht sie **von selbst** aus, soweit der Browser sie
meldet – auf Android mit Bluetooth-Kopfhörern tut er das (die 232 ms oben kamen
aus der Automatik, bei unangetastetem Regler).

Bleibt trotzdem ein Versatz, nennt der Kopfhörer seine Verzögerung nicht
selbst, und genau dieser Anteil fehlt der Automatik. Abhilfe:
**Tempo und Metronom → „Bild und Ton abgleichen"**. Den Regler bei laufender
Wiedergabe verschieben, bis die hervorgehobene Note zum Gehörten passt. Der
Wert wird pro Gerät gemerkt – am Telefon mit Kopfhörern also ein anderer als am
Rechner.

Ob der Browser die Latenz von sich aus kennt, lässt sich auch ohne die App in
30 Sekunden prüfen: ein YouTube-Video mit sprechendem Gesicht auf demselben
Gerät, mit denselben Kopfhörern. Ist es lippensynchron, kennt der Audio-Stack
die Latenz und die Automatik trägt sie; ist es das nicht, weiß der Browser es
selbst nicht und der Regler trägt die Hauptlast.

**Darstellung → Diagnose der Wiedergabe** zeigt die Zahlen dazu: „gemessen"
stammt aus `getOutputTimestamp()`, „gemeldet" aus `baseLatency + outputLatency`,
„von Hand" ist der Regler. Ein Strich statt einer Zahl heißt, dass der Browser
dazu nichts sagt.

## Der Ton knackt oder setzt aus, die Stimmen klingen unsauber zusammen

Etwas anderes als der Fall darüber, auch wenn es sich ähnlich anfühlt: Hier
stimmt die Zeitrechnung, aber die Synthese kommt auf dem Gerät nicht mit. Zu
sehen unter **Darstellung → Diagnose der Wiedergabe** an der Zeile
**„Aussetzer"** – steht dort eine wachsende Zahl, ist es die Rechenlast; bleibt
sie bei 0, liegt es an der Latenz und der Abschnitt darüber gilt.

Bei Aussetzern hilft, die Last zu senken: andere Tabs schließen, das Notenbild
kleiner zoomen (weniger DOM je Seite), oder die Partitur ohne Ton lesen
(„Ohne Ton fortfahren" beim Laden). Eine kleinere SoundFont-Datei senkt die Last
ebenfalls, siehe [Installation](installation.md#soundfont).

## Die Konvertierung schlägt fehl

Der Viewer zeigt eine verständliche Meldung, das technische Detail steht
daneben. Die Fehlercodes:

| Code | Bedeutung | Was hilft |
|---|---|---|
| `sidecar_unreachable` | Dienst nicht erreichbar | siehe oben |
| `sidecar_rejected` | Datei abgelehnt (z. B. Secret, Größe) | Secret und `SCOREVIEW_MAX_UPLOAD_BYTES` prüfen |
| `too_large` | Partitur überschreitet das Limit | `max_score_bytes` (Vorgabe 100 MB) anheben oder Partitur teilen |
| `timeout` | Konvertierung nicht rechtzeitig fertig | Sidecar: Die App wartet ab dem Einreichen fest höchstens 300 s – bei rund 6 s pro Seite etwa 50 Seiten, siehe [Grenzwerte](limits.md). `MSCORE_TIMEOUT_SECONDS` (Vorgabe 600 s) anzuheben hilft deshalb nicht; bricht der Sidecar selbst ab, heißt das `conversion_failed`. Lokal: `local_timeout` (Vorgabe 120 s) |
| `conversion_failed` | MuseScore selbst ist gescheitert | Datei in MuseScore öffnen; oft eine defekte `.mscz`. Auf dem lokalen Weg steht die Ausgabe des Konverters im `nextcloud.log` |
| `no_pages` | Konvertierung lief, lieferte aber keine Seite | Selbsttest auslösen; deutet auf ein Problem im Image hin |
| `local_unavailable` | Lokaler Weg gewählt, aber nicht lauffähig | siehe [oben](#der-lokale-konvertierungsweg-läuft-nicht) |
| `stale` | Ein Lauf wurde nie abgeschlossen | siehe [oben](#die-konvertierung-kommt-nicht-voran) |
| `client_too_large`, `client_engine_unavailable` | Nur beim Rückfall im Browser | siehe [oben](#der-viewer-meldet-diese-partitur-konnte-in-diesem-browser-nicht-gesetzt-werden) |
| `unknown` | Alles andere | `nextcloud.log` auf die Exception prüfen |

## Der Viewer zeigt eine veraltete Fassung der Partitur

Zwei Ursachen, die sich ähnlich anfühlen und getrennt zu behandeln sind.

**Serverseitig** bleibt eine fertige Konvertierung liegen, solange niemand die
Datei anfasst – auch wenn eine neuere Fassung der App sie besser setzen würde
oder die Herkunft noch „unbekannt" meldet. Der Knopf **„Neu konvertieren"** im
Aufklapper „Darstellung" verwirft sie und lässt sie neu erzeugen; er
erscheint nur mit Schreibrecht auf die Datei. Für alle Partituren einer Instanz
auf einmal ist `CURRENT_FORMAT_VERSION` der Hebel (siehe
[Architektur](architecture.md#konvertierung-und-cache)).

**Im Browser** kann eine ältere Fassung der App nachwirken: Vor 1.4.0 trugen
die Artefakt-Links keinen Cache-Schlüssel, wurden aber als `immutable`
ausgeliefert. Solche Einträge liegen weiterhin im Browsercache, und Neuladen
räumt sie nicht weg – Chrome revalidiert Unterressourcen dabei nicht. Einmal
hart neu laden (`Strg`+`Umschalt`+`R`) genügt; danach zeigen die Links den
Zeitstempel der Konvertierung und lösen sich von selbst ab.

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

Im Betrieb kann dasselbe Bild nach einem App-Update auftreten, wenn die Dateien
ausgetauscht wurden, `occ upgrade` aber nicht lief: Dann antworten die Routen,
die die neue Fassung mitbringt, mit 404 – etwa die von „Folgt mir“, Setlisten
oder Aufnahmen, während die Partitur selbst sich öffnen lässt. `occ upgrade`
behebt das und legt zugleich die neuen Tabellen an.
