# Architektur

Wie ScoreView aufgebaut ist, welche Entwurfsentscheidungen dahinterstehen und
auf welchen Eigenschaften des MuseScore-Exports die Umsetzung aufbaut. Dieses
Dokument beschreibt den Stand der App, nicht ihren Entstehungsweg.

## Überblick

ScoreView besteht aus diesen Teilen:

| Teil | Wo | Aufgabe |
|---|---|---|
| Nextcloud-App | `scoreview/lib/` (PHP) | Konvertierung anstoßen, Ergebnis cachen, Artefakte ausliefern, Notizen, Leitungen, „Folgt mir“, Setlisten und Aufnahmen verwalten, Übe-Tracks in Files ablegen, die Offline-Seite ausliefern |
| Viewer | `scoreview/src/` (Vue 3) | Notenseiten anzeigen, MIDI im Browser synthetisieren, Cursor führen, Mikrofon auswerten, Übe-Tracks rendern, Partituren für die Offline-Seite vormerken |
| Sidecar | `sidecar/` (Python, darin die scoreview-engine unter Node und MuseScore 4 als AppImage) | `.mscz` übersetzen – im eigenen Container, mit einem der beiden Renderer |
| Lokaler Konverter | `scoreview/converter/` (Node + scoreview-engine: MuseScore als WebAssembly) | dasselbe, ohne Container |

Konvertiert wird über **einen von zwei Wegen**, wahlweise über den Sidecar oder
lokal auf dem Server; beide erzeugen dieselben Artefakte (siehe
[E3](#e3-zwei-konvertierungswege-hinter-einer-api)). Der Sidecar ist nicht Teil
des App-Pakets, der lokale Konverter schon. Die HTTP-API des Sidecars beschreibt
[`../sidecar/README.md`](../sidecar/README.md).

Kann der Server **keinen von beiden** ausführen, springt ein Rückfall ein:
dieselbe Engine, ausgeführt im Browser der Nutzerin
([E7](#e7-konvertierung-im-browser-als-rückfall)). Er ist nirgends wählbar und
greift nur, wo sonst gar nichts liefe.

## Datenfluss

```
.mscz in Nextcloud Files
   |
   |  Öffnen im Viewer stößt die Konvertierung an; ein Datei-Listener
   |  reiht nur mit eager_conversion vorab ein - invalidiert wird
   |  allein über den Schlüssel (fileId, etag)
   v
Konvertierung - einer von zwei Wegen, gleiche Artefakte (E3)
   |
   |  Lokal:   ein node-Prozess mit der scoreview-engine (MuseScore als Wasm)
   |     -> saveSvg() · saveMidi() · savePositions() · metadata()
   |  Sidecar mit Renderer engine: derselbe node-Prozess, im Container
   |  Sidecar mit Renderer musescore: ein mscore-Aufruf --score-media
   |     -> svgs[] · midi · sposXML · mposXML · metadata
   |     (pngs/pdf/mxml werden verworfen)
   v
IAppData-Cache  scoreview/<fileId>/<etag>/
   |     page-1.svg … page-N.svg · score.mid · timing.json · measures.json · meta.json
   v
HTTP-Auslieferung, unveränderlich (ETag + Cache-Control: immutable)
   v
Browser

  ... oder, wo der Server keinen der beiden Wege ausfuehren kann (E7):

.mscz -> GET /api/scores/<id>/source -> dieselbe Engine im Web Worker
      -> dieselben Artefakte, als Blob-URLs, nur in diesem Browser
      (kein IAppData, keine Statuszeile - der Cache entfaellt)
   |- SVG-Seiten anzeigen ............. Zoom · Vollbild · Autoscroll
   |- MIDI clientseitig synthetisieren  Tempo · Mixer · Metronom
   |- Cursor-Overlay über spos/12-Koordinaten
   |- Taktnavigation über mpos, Studierbuchstaben aus meta.json/MIDI (E12)
   |- Notizen und Stempel an musikalischen Ankern (eigene Tabellen)
   |- „Folgt mir“: Zustand einer Leitung, abgefragt oder per Push (E10)
   |- Mikrofon: Aufnahmen (IAppData), Intonation (nur im Browser)
   |- Übe-Track: im Browser gerendert, als MP3 in Files (E13)
   +- Vormerken: Antworten in den Cache des Browsers, gelesen von der
      Offline-Seite /apps/scoreview/offline mit eigenem Service Worker (E14)
```

**Leitprinzip: Das Frontend kennt ausschließlich die HTTP-API der App.** Es
verzweigt an keiner Stelle danach, welcher Konvertierungsweg gelaufen ist. Genau
deshalb ist der Wechsel zwischen den beiden Wegen
([E3](#e3-zwei-konvertierungswege-hinter-einer-api)) ein reiner Backend-Austausch,
ohne eine einzige Zeile im Viewer. Diese Trennung bitte nicht
aufweichen. Der Statusendpunkt *nennt* den Weg (`renderer.backend`),
und der Viewer *zeigt* ihn an – das ist eine Angabe für Menschen, keine
Verzweigung; was der Viewer tut, hängt weiterhin allein an den Artefakten.
Was eine Darstellung braucht, fragt er als **Fähigkeit** der Artefakte ab,
nie als Weg ([E15](#e15-fähigkeiten-statt-weg)).

## Serverseite

### HTTP-API

Die Routen stehen in `scoreview/appinfo/routes.php` und liegen bis auf vier
unter `/apps/scoreview/api/`. Die App hat bewusst **keinen Einstieg in
Partituren außerhalb von Files** und keinen Navigationseintrag;
`/apps/scoreview/` antwortet 404. Eigene Seiten gibt es zwei, und keine ist
ein Einstieg: die Offline-Seite unter `/apps/scoreview/offline` zeigt nur, was
vorher in Files vorgemerkt wurde
([E14](#e14-eine-offline-seite-mit-eigenem-service-worker)); die Druckseite
unter `/apps/scoreview/print/{fileId}` wird aus dem Viewer heraus geöffnet
([E16](#e16-drucken-aus-den-seiten-svgs)).
Eingestiegen wird auf vier Wegen, und alle vier zeigen **dieselbe Komponente**:

1. **Nextclouds Viewer**, am Mimetype `application/x-musescore` – der
   reguläre Weg im Browser.
2. **Eine eigene Dateiaktion auf der Endung**, wo der Mimetype nicht
   registriert ist ([E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)).
3. **Eine Dateiaktion auf `*.setlist.md`**, die den Viewer mit einer Setliste
   öffnet ([E11](#e11-die-setliste-als-markdown-datei)).
4. **Eine eigenständige Seite über Nextclouds Direct Editing**, für die
   mobilen Apps, die keine Skripte der Dateien-Seite laden
   ([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps)). Auch sie hat
   keine eigene Route – sie wird unter `/apps/files/directEditing/{token}`
   ausgeliefert.

Der vierte Weg bringt eine zweite Art Ausweis mit: Seine Seite kommt **ohne
Sitzungscookie** an, ihre Folgeanfragen weisen sich mit einem
Direct-Editing-Token im Header `X-ScoreView-Token` aus, für weitere Dateien
einer Setliste zusätzlich mit einem Begleit-Token in `X-ScoreView-Companion`.
Welche Routen das annehmen, entscheidet das Attribut `#[DirectTokenOrSession]`;
geprüft wird es in `Middleware\DirectAccessMiddleware`. Ohne Header verhält
sich jede Route wie eine gewöhnliche Route mit Sitzung. Die Spalte „Token“ unten nennt, was eine
Route mit Token annimmt; Einzelheiten in
[E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps).

| Route | Zweck | Token |
|---|---|---|
| `GET /api/scores/{fileId}/status` | Konvertierungsstatus, Seitenzahl, Metadaten | ja |
| `GET /api/scores/{fileId}/artifact/{name}` | Ein Artefakt aus dem Cache (`page-N`, `midi`, `timing`, `measures`, `meta`) | ja |
| `GET /api/scores/{fileId}/source` | Die `.mscz` selbst – nur für die Konvertierung im Browser ([E7](#e7-konvertierung-im-browser-als-rückfall)) | ja |
| `GET /api/engine/{version}/{name}` | Die drei Dateien der scoreview-engine, für denselben Weg – die Engine-Version steht im Pfad, damit auch `.wasm` und `.data` sie tragen, die der Glue relativ zu seiner eigenen URL anfordert (**ohne Anmeldung** – appeigene Bauartefakte, für alle dieselben Bytes; ein nativer `import()` kann keinen Ausweis tragen) | – |
| `POST /api/scores/{fileId}/reconvert` | Verwirft die gespeicherte Konvertierung und lässt sie neu erzeugen (nur mit Schreibrecht auf die Datei) | – |
| `GET /api/scores/{fileId}/variants/{key}` | Eine Darstellungsvariante ([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)): fertig mit `files` wie beim Status, sonst wird sie **in dieser Anfrage** gesetzt; `pending`, solange eine andere Anfrage sie setzt | ja |
| `GET /api/scores/{fileId}/variants/{key}/artifact/{name}` | Ein Artefakt einer Variante (`page-N`, `timing`, `measures`, `meta`; kein `midi`) | ja |
| `GET /api/soundfont` | Das SoundFont für die Browser-Wiedergabe | ja |
| `GET\|POST\|PUT\|DELETE /api/scores/{fileId}/annotations[/{id}]` | Notizen, Stempel, gespeicherte Loops und Zeichnungen ([E22](#e22-freihand-als-notiz-in-linienabständen)); Sichtbarkeit `parts` nur für Leitungen ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) | ja |
| `GET\|PUT /api/scores/{fileId}/my-part` | „Meine Stimme“ je Partitur und Nutzerin; `GET` liefert die Übe-Einstellungen (`practice`) mit | ja |
| `PUT /api/scores/{fileId}/practice` | Übe-Einstellungen je Partitur und Nutzerin: Transposition, Coach, Pegel der übrigen Stimmen. Was fehlt, bleibt unverändert | ja |
| `POST /api/scores/{fileId}/practice-tracks` | Einen im Browser gerenderten Übe-Track als MP3 in Files ablegen ([E13](#e13-übe-tracks-sind-dateien-in-files)) | Direct-Editing-Token nur neben die Partitur, Begleit-Token nein |
| `POST /api/scores/{fileId}/pdf?name=&replace=` | Eine im Browser geschriebene PDF-Datei der Partitur neben ihr ablegen ([E16](#e16-drucken-aus-den-seiten-svgs)); 409 mit freiem Namen, wenn es die Datei schon gibt | Direct-Editing-Token ja (es gibt nur das Ziel neben der Partitur), Begleit-Token nein |
| `GET\|POST /api/scores/{fileId}/leaders`, `DELETE …/leaders/{uid}` | Leitungen lesen, ernennen, abberufen ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) | ja |
| `GET /api/scores/{fileId}/leader-candidates?q=` | Nutzersuche für die Ernennung, nur Leitungen, 30 Aufrufe je Minute | ja |
| `GET\|POST\|PATCH\|DELETE /api/scores/{fileId}/follow`, `POST …/follow/join` | „Folgt mir“: Zustand lesen (alle mit Dateizugriff), Sitzung führen (Leitung), für Push anmelden ([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)) | ja |
| `POST /api/scores/{fileId}/follow/move` | Die Sitzung zum nächsten Stück mitnehmen (Leitung, E10) | ja |
| `GET /api/scores/{fileId}/follow/companion?target=` | Begleit-Token für das Stück, zu dem eine Sitzung umgezogen ist ([S1](#s1-begleit-token-sind-an-zweck-datei-und-direct-editing-token-gebunden)) | **nur** Direct-Editing-Token |
| `GET\|POST /api/scores/{fileId}/recordings`, `GET\|DELETE …/recordings/{id}` | Eigene Aufnahmen – nur die eigenen, fremde antworten 404; die Liste trägt zusätzlich, was Leitungen für Stimmen freigegeben haben (`shared`), und nur das lässt sich auch abspielen ([E21](#e21-aufnahmen-der-leitung-für-stimmen)) | ja |
| `PUT /api/scores/{fileId}/recordings/{id}` | Eine eigene Aufnahme für Stimmen freigeben (nur Leitungen) oder die Freigabe zurücknehmen (immer) ([E21](#e21-aufnahmen-der-leitung-für-stimmen)) | ja |
| `GET\|POST /api/scores/{fileId}/practice-log` | Das eigene Übetagebuch der Partitur lesen, gezählte Sekunden melden ([E20](#e20-übetagebuch-ohne-bestenliste)) | ja |
| `GET\|POST\|DELETE /api/scores/{fileId}/sing-runs` | Eigene Durchgänge der Sing-Wertung lesen (je Stufe und Taktbereich, mit Bestwert je Tempo), einen fertig gesungenen Durchgang melden, die eigenen Ergebnisse der Partitur löschen ([E24](#e24-sing-wertung-nur-für-sich)) | ja |
| `PUT /api/scores/{fileId}/practice-goal` | Das Wochenziel der Partitur setzen oder mit 0 löschen (nur Leitungen, E20) | ja |
| `GET\|PUT /api/setlists/{fileId}` | Setliste lesen (aufgelöst aus Sicht der Nutzerin) und schreiben ([E11](#e11-die-setliste-als-markdown-datei)) | Setlisten-Begleit-Token; schreibend nur mit Einträgen um die Partitur herum |
| `POST /api/setlists` | Neue Setliste anlegen | nur im Ordner der Token-Datei, ohne Begleit-Token |
| `GET /api/scores/{fileId}/setlists` | Setlisten im Ordner der Partitur, die sie enthalten | ja, ohne Begleit-Token |
| `GET /api/scores/{fileId}/score-candidates` | Partituren um die offene herum, für den Setlisten-Editor | ja, ohne Begleit-Token |
| `POST /api/scores/{fileId}/setlists/{setlistId}/tokens` | Begleit-Token für die Stücke einer Setliste ausgeben | **nur** Direct-Editing-Token |
| `POST /api/preferences` | Anzeigeeinstellungen der Nutzerin (nur schreibend – gelesen aus dem Anfangszustand der Seite) | ja, ohne Begleit-Token |
| `POST /api/settings` | Admin-Einstellungen speichern | – |
| `GET /api/health`, `POST /api/selftest` | Betriebsdiagnose, Sidecar-Selbsttest (nur Admins) | – |
| `GET /offline`, `GET /offline/sw.js`, `GET /offline/manifest.webmanifest` | Offline-Seite, ihr Service Worker und ihr Web-App-Manifest ([E14](#e14-eine-offline-seite-mit-eigenem-service-worker)); Worker und Manifest **ohne Anmeldung** – statischer Code ohne Daten, den der Browser beim Aktualisieren ohne Sitzung holt | – |
| `GET /print/{fileId}` | Die Druckseite: alle Seiten einer Partitur für den Druckdialog des Browsers ([E16](#e16-drucken-aus-den-seiten-svgs)); 404 für jede Datei außerhalb des eigenen Dateibaums | – |

Der Statusendpunkt trägt zusätzlich `canWriteFolder`: ob die Person neben der
Partitur anlegen darf. Daran hängt, ob der Viewer „Tracks für alle Stimmen“
anbietet und die Druckseite „Als PDF in Dateien speichern“. Und
`variants.supported`: ob der Server Darstellungsvarianten setzen kann – eine
Fähigkeit, kein Weg ([E15](#e15-fähigkeiten-statt-weg),
[E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)).

Ohne eigene Route: Der Suchprovider `Search\ScoreSearchProvider` hängt an
Nextclouds globaler Suche (`/ocs/v2.php/search/providers/scoreview/search`,
[E17](#e17-suche-über-die-konvertierungstabelle)).

Die Endpunkte von „Folgt mir“, Aufnahme, Übe-Tracks und der Offline-Seite
hängen an je einem Schalter der Verwaltung (`FeatureConfig`). Ist er aus,
antworten sie 404, und der Viewer zeigt nichts davon; die Intonation hat keinen
eigenen Endpunkt, ihren Schalter wertet nur der Viewer aus – wer eine Funktion nicht nutzt, bemerkt sie
nicht, auch nicht als zusätzliche Anfrage. Die Leitungsrolle hängt an keinem
Schalter: Auf ihr bauen Stimmnotizen ebenso auf wie „Folgt mir“.

Gültige Artefaktnamen sind eine Allowlist in `ConversionService`, kein
Dateipfad. Die Route selbst schränkt nur die Zeichenklasse ein, damit ein
unbekannter Name als 404 aus dem Controller kommt und nicht als Routing-Fehler.

### Konvertierung und Cache

Konvertiert wird **lazy**: Erst das Öffnen einer Partitur reiht
`ConvertScoreJob` ein. Auf dem Sidecar-Weg reicht der Job die Partitur nur ein
und überlässt das Abholen `PollConversionJob` – ein blockierender Poll-Loop
würde sonst bis zu 300 s die gesamte Job-Queue der Instanz belegen. Auf dem
lokalen Weg gibt es nichts zu pollen: Der Kindprozess läuft gemessen 0,7–2,9 s
mit harter Zeitgrenze, und der Job schreibt das Ergebnis selbst in den Cache.
Optional lässt sich in den Admin-Einstellungen die Vorab-Konvertierung beim
Hochladen einschalten (`eager_conversion`).

Kann der Server gar nicht konvertieren, antwortet der Statusendpunkt statt mit
Artefakten mit `status: "client"` und überlässt die Arbeit dem Browser
([E7](#e7-konvertierung-im-browser-als-rückfall)). Dann wird **kein Job
eingereiht und nichts gespeichert** – alles Folgende in diesem Abschnitt gilt
für diesen Weg nicht.

Der Cache-Schlüssel ist `(fileId, etag)`: Eine geänderte Datei bekommt ein neues
`etag` und damit automatisch einen neuen Cache-Eintrag; der alte wird verworfen.
Die Artefakte selbst sind unveränderlich und werden mit `ETag` und
`Cache-Control: immutable` ausgeliefert.

`immutable` verspricht dem Browser, dass sich unter **dieser URL** nie etwas
ändert. Der Cache-Schlüssel muss deshalb in der URL stehen und nicht nur im
serverseitigen Pfad: Die Artefakt-Links tragen `?v=<etag>-<Zeitstempel der
Konvertierung>`. Beide Teile sind nötig, weil es zwei verschiedene Änderungen
gibt – der `etag` benennt die Fassung der Partitur, der Zeitstempel die
Konvertierung dieser Fassung. Der Server wertet den Parameter nicht aus; er
löst den `etag` ohnehin aus der Datei auf.

Dasselbe gilt für das SoundFont, das die App selbst ausliefert: Seine Adresse
trägt `?v=<Version>` (`ConversionController::soundFontUrl()`). Beim
Download-Weg ist die Version der Hash der Download-URL und ohne Abruf bekannt;
beim Sidecar ist es der zuletzt geholte Stand, weil der Statusendpunkt bei jeder
Abfrage nicht den Sidecar fragen soll – ein neues Image wird also erst bekannt,
wenn jemand das SoundFont wieder abruft. Anders als bei den Artefakten wertet
der Server den Parameter aus: `immutable` gibt es nur, wenn er der aktuellen
Version entspricht. Sonst bekäme die neue Datei für ein Jahr die Adresse der
alten; eine solche Antwort gilt nur bis zur nächsten Nachfrage, die das `ETag`
zu einem 304 macht. Die Offline-Seite wertet eine neue SoundFont-Adresse als
veralteten Eintrag (`soundFontChanged`) und räumt die alte Datei, sobald kein
Eintrag sie mehr nennt.

Die Spalte `format_version` in `scoreview_conversions` hält fest, mit welchem
Cache-Format ein Eintrag geschrieben wurde. Ein Eintrag mit älterer Version –
oder mit fehlender Cache-Datei – gilt automatisch als „nicht fertig" und stößt
eine Neukonvertierung an. Ein Formatwechsel braucht deshalb **keinen**
Migrationspfad und kein manuelles Löschen von Zeilen.

Den häufigeren Fall, dass eine neuere Fassung der App dieselbe Partitur
**besser** setzt, deckt auf dem lokalen Weg die Spalte `engine_version` ab:
Sie hält das Release der scoreview-engine fest, das den Eintrag gesetzt hat
(`LocalConverter::engineVersion()`). Weicht es vom installierten ab, gilt der
Eintrag wie ein älteres Format als „nicht fertig" und wird beim **nächsten
Öffnen** neu erzeugt (`ConversionService::isCurrent()`, auch für das
Vorwärmen von Setlisten). Bewusst beim Öffnen und nicht in einem
Reparaturschritt: Eine Instanz mit Tausenden Partituren setzte sonst alle auf
einmal neu, die meisten davon ungeöffnet. Ein lokaler Eintrag ohne Stempel
stammt aus der Zeit vor der Spalte und gilt als älter. Ausgenommen sind
Einträge des Sidecars – welche Engine oder welches MuseScore dort läuft,
erfährt die App nur auf Nachfrage – und ein Eintrag des anderen Wegs nach
einem Wechsel (E3); ebenso jeder Vergleich, solange die installierte Engine
kein Release nennt (`unknown`), sonst konvertierte jedes Öffnen neu.

Für alles Übrige – den Sidecar, einen Satzunterschied ohne neue Engine – gibt
es `POST …/reconvert`, den Knopf „Neu konvertieren" im Viewer, unter der
Angabe der Herkunft. Er verwirft Statuszeile und Cache-Ordner der Datei und reiht die
Konvertierung neu ein; nur mit Schreibrecht, denn der Cache hängt an der Datei
und gilt für alle, die sie öffnen. Für **alle** Partituren einer Instanz auf
einmal bleibt das Hochzählen von `CURRENT_FORMAT_VERSION` der Hebel.

Darstellungsvarianten ([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild))
liegen unter dem Ordner ihrer Fassung, in `<etag>/v/<Schlüssel>/`. Alles, was
eine Fassung räumt – `gcOldVersions`, `deleteAllForFile`, „Neu konvertieren“,
der Papierkorb –, nimmt ihre Varianten mit; ihre Zeilen in
`scoreview_variants` räumt `ConversionService` an denselben Stellen. Wird die
Grundkonvertierung einer Fassung neu geschrieben, verfallen deren Varianten:
Sie wurden gegen die alte geprüft.

Während ein Lauf arbeitet, verweigert der Knopf – sonst schriebe der laufende
Job sein Ergebnis auf eine gelöschte Zeile. Ob überhaupt noch einer arbeitet,
beantwortet `ConversionService::isStale()` an genau einer Stelle: Ein Datensatz
auf `pending`/`processing`, dessen `updated_at` älter als eine halbe Stunde ist,
gilt als tot. Der Lauf, der ihn hielt, ist dann abgebrochen (Speichermangel,
abgewürgter Cron-Durchgang, Neustart), und ohne diese Frage bliebe die Partitur
dauerhaft unerreichbar – der Hintergrundjob übersprang sie als „läuft schon",
dieser Knopf verweigerte aus demselben Grund. Der Statusendpunkt meldet einen
solchen Datensatz als Fehler `stale` und reiht ihn neu ein. Bewusst **kein**
`timeout`: Das bedeutet „diese Partitur war zu langsam", also einen
Inhaltsfehler, und `ClientFallback` entscheidet an diesen Codes.

**Fehlercodes sind auf allen Wegen dieselben (E3).** Der Konverter meldet sie
über seinen Exitcode (`converter/lib/errors.mjs`, z. B. 3 = `no_pages`), der
Sidecar über das Feld `errorCode` seines Jobstatus (`scoreview_sidecar/errors.py`);
PHP übernimmt nur bekannte Codes (`LocalConverter::errorCodeForExit()`,
`SidecarClient::jobErrorCode()`) und liest nie den Meldungstext aus. Ein
Textvergleich hätte dieselbe Partitur je nach Weg unter verschiedenen Codes
gemeldet.

### Datenbank

| Tabelle | Inhalt |
|---|---|
| `scoreview_conversions` | `file_id`, `etag`, `status`, `error_code`, `error_message`, `format_version`, `backend`, `engine_version`, `title`, `composer`, `search_text`, `page_count`, `measure_count` |
| `scoreview_annotations` | `file_id`, `user_id`, `content`, `visibility`, `measure_number`, `fraction`, `elid`, `anchor_etag`, `kind`, `stamp`, `target_parts`, `by_leader`, `end_measure` |
| `scoreview_leaders` | `file_id`, `user_id`, `appointed_by`, `created_at` – ernannte Leitungen; die Eigentümerin steht nie darin ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) |
| `scoreview_follow` | `file_id` (Primärschlüssel: höchstens eine Sitzung je Datei), `leader_uid`, `started_at`, `heartbeat_at`, `version`, `state` ([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)) |
| `scoreview_recordings` | `file_id`, `user_id`, `created_at`, `duration_ms`, `size_bytes`, `score_start_ms`, `tempo_factor`, `with_accompaniment`, `reference_hz`, `shared_parts` (Stimmen, für die eine Leitung sie freigegeben hat, [E21](#e21-aufnahmen-der-leitung-für-stimmen)) – die WAV selbst liegt in IAppData |
| `scoreview_practice_log` | `user_id`, `file_id`, `day` (lokaler Kalendertag `YYYY-MM-DD`, eindeutig zusammen), `seconds` ([E20](#e20-übetagebuch-ohne-bestenliste)) |
| `scoreview_sing_runs` | `user_id`, `file_id`, `from_measure`, `to_measure` (beide `NULL`: ganzes Stück), `level`, `tempo_pct`, `total_pct`, `pitch_pct`, `onset_pct`, `release_pct`, `notes_scored`, `created_at` – nur die Zusammenfassung eines Durchgangs, keine Rahmen; höchstens 200 je Nutzerin, Partitur, Stufe und Taktbereich ([E24](#e24-sing-wertung-nur-für-sich)) |
| `scoreview_practice_goals` | `file_id` (eindeutig), `minutes_per_week`, `user_id` (wer es gesetzt hat; `NULL`, wenn das Konto gelöscht ist), `updated_at` |
| `scoreview_variants` | `file_id`, `etag`, `variant` (eindeutig zusammen – zugleich die Sperre eines Laufs), `status`, `error_code`, `error_message`, `format_version`, `engine`, `page_count`, `accessed_at` ([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)) |

`backend` hält fest, welcher Konvertierungsweg **diese** Darstellung erzeugt hat
(`sidecar`, `local`, oder `NULL`, wo der Weg nicht festgehalten ist).
Nur so bleibt die Frage später beantwortbar: Die Admin-Einstellung sagt, was
*jetzt* gilt, nicht, was beim Konvertieren dieser Datei galt. Die Spalte ist
rein beschreibend – nichts im Server und nichts im Viewer verzweigt danach.

`title`, `composer` und `search_text` sind für die Suche da
([E17](#e17-suche-über-die-konvertierungstabelle)): die ersten beiden zum
Anzeigen eines Treffers, die dritte – Titel, Untertitel, Komponist und
Textdichter in Kleinbuchstaben – zum Suchen. `ConversionService::markReady()`
füllt sie aus `meta.json`, für Datensätze von vor den Spalten der
Repair-Step `Migration\BackfillSearchText` beim Update. Gekürzt wird nach
Bytes (255/1024), nicht nach Zeichen: Auf Oracle ist ein `VARCHAR(1024)`
1024 Bytes lang.

`page_count` und `measure_count` setzt ebenfalls `markReady()`, damit die
Statusabfrage und das Laden der Notizen nicht bei jedem Öffnen ein `meta.json`
von bis zu 250 KB dekodieren. Ältere Datensätze trägt der Repair-Step
`Migration\BackfillScoreCounts` nach; was er nicht erreicht hat, liest
`ConversionService` einmal aus `meta.json` und schreibt es zurück.

Geschrieben werden die Artefakte von Basis und Variante über eine Klasse,
`Service\ArtifactStore` (Ordner, Allowlist der Dateinamen, Seitennamen); sie
räumt dabei auch Seiten einer früheren, längeren Fassung im selben Ordner weg.
Die Schlüssel der Admin-Einstellungen zur Konvertierung stehen als Konstanten
in `Service\ConversionConfig`, und ob eine Partitur (neu) konvertiert werden
muss, beantwortet `ConversionService::needsConversion()` für den Job wie für
das Vorkonvertieren einer Setliste.

Notizen hängen an einer **musikalischen** Position (Takt + Anteil im Takt), nicht
an Pixelkoordinaten. Nur deshalb überstehen sie ein Neurendern und einen
Re-Upload derselben Partitur. `anchor_etag` hält fest, gegen welche Fassung der
Anker gesetzt wurde.

Geteilte Notizen hängen an den **Dateirechten**, nicht an einer eigenen
Rechteverwaltung: Wer eine Notiz sieht, sieht die Datei; wer sie ändern darf,
braucht `PERMISSION_UPDATE`. Fehlt das Schreibrecht, antwortet der Controller
403, statt die Bedienelemente nur auszublenden. Eine dritte Sichtbarkeit,
`parts`, richtet sich an bestimmte Stimmen und ist Leitungen vorbehalten
([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)). Ausgeliefert wird sie an
alle mit Dateizugriff; welche Stimme sie sieht, hervorgehoben oder
zurückgenommen, entscheidet der Browser (`annotationFilter.js`). Die Zielstimme
steht doppelt darin, als Part-ID und als Name, weil nicht belegt ist, dass
MuseScores Part-ID einen Re-Upload übersteht. Ein **Stempel** (`kind = stamp`)
ist eine Notiz mit einem Symbol aus einer festen Liste (Atemzeichen, Zäsur,
Dynamik, Fermate …) statt Text; `by_leader` wird beim Anlegen festgehalten,
damit eine abberufene Leitung ihre Hinweise behält. Ein **gespeicherter
Loop** (`kind = loop`, ab 1.17) ist eine Notiz mit Endtakt (`end_measure`):
`measure_number` ist der erste Takt, `content` der Name, `fraction` 0 und
kein Notenanker. Eine vierte Art statt einer eigenen Tabelle, weil ein Loop
genau das will, was eine Notiz hat – den musikalischen Anker, die drei
Sichtbarkeiten samt Stimmen für Leitungen, die Obergrenze je Person, einen
Löschort. Verwaist ist er, sobald sein *Ende* jenseits der Partitur liegt.
Eine **Zeichnung** (`kind = drawing`) ist die fünfte Art: verankert wie ein
Stempel über Takt und Anteil, ohne Notenanker, die Striche als JSON in
`content` ([E22](#e22-freihand-als-notiz-in-linienabständen)).

Aufnahmen liegen in IAppData unter `recordings/<uid>/<fileId>/<id>.wav`, nicht
in Files: Nur die Aufnehmende hört sie, und in Files tauchten sie in Freigaben,
Suche und Kontingent der Partitur-Eigentümerin auf. Weil IAppData gegen **kein**
Kontingent zählt, hat die App eigene Grenzen – je Partitur (Anzahl), je
Aufnahme (Länge), je Person und für die ganze Instanz (Bytes); beim Erreichen
antwortet der Server 409, 413 oder 507 mit einer lesbaren Meldung. Eine fremde
Aufnahme antwortet 404, nicht 403 – außer eine Leitung hat sie für Stimmen
freigegeben ([E21](#e21-aufnahmen-der-leitung-für-stimmen)).

### Aufräumen

`CleanupOrphansJob` räumt Cache-Einträge, Notizen, Leitungen, Folgesitzungen,
Aufnahmen, die gemerkte Stimmwahl („Meine Stimme“, `my_part.<fileId>` in den
Nutzereinstellungen) und die Übe-Einstellungen (`practice.<fileId>`)
gelöschter Dateien ab, ebenso Übetagebuch und Wochenziel
([E20](#e20-übetagebuch-ohne-bestenliste)). Das geschieht bewusst erst, wenn die Datei
auch aus dem Papierkorb verschwunden ist – eine Wiederherstellung aus dem
Papierkorb soll nichts davon verlieren. Nur den Cache nimmt schon
`Listener\NodeDeletedListener` beim Verschieben in den Papierkorb weg: Er ist
regenerierbar, das nächste Öffnen baut ihn neu auf. Folgesitzungen ohne
Lebenszeichen der Leitung (30 min) entfernt `CleanupOrphansJob` unabhängig
davon, ebenso Tage im Übetagebuch, die älter als 400 Tage sind. Übe-Tracks räumt die App nicht: Sie sind gewöhnliche Dateien in Files
([E13](#e13-übe-tracks-sind-dateien-in-files)). `UserDeletedListener`
löscht beim Löschen eines Kontos dessen Notizen, Ernennungen, geleitete
Sitzungen, Aufnahmen und Übetagebuch; ein gesetztes Wochenziel bleibt, nur
ohne Namen. Zeilen und WAV-Dateien der Aufnahmen verschwinden
dabei immer zusammen (`RecordingStorage`), und ein leer gewordener Ordner
`recordings/<uid>/` geht mit – entschieden an der Tabelle, weil `ISimpleFolder`
keine Unterordner auflistet.

## Browserseite

Der Viewer mountet einen **eigenen, zweiten Vue-3-Baum** neben der Vue-Instanz
von Nextclouds Viewer (`src/viewer.js`, dort ausführlich begründet). Zwei
Vue-Kopien im selben Baum sind nicht kompatibel; `@nextcloud/vue`-Komponenten
werden gegen unsere Instanz kompiliert und leben in unserem Baum. Wer an der
UI-Basis arbeitet, muss deshalb **im Viewer** verifizieren, nicht auf der
Einstellungsseite.

Aufbau:

- Vier Webpack-Einträge für vier Seiten: `src/viewer.js` für die Dateien-Seite
  (Viewer-Handler **und** die beiden Dateiaktionen,
  [E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)),
  `src/standalone.js` für die eigenständige Seite der mobilen Apps
  ([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps)),
  `src/offline.js` für die Offline-Seite
  ([E14](#e14-eine-offline-seite-mit-eigenem-service-worker)) und
  `src/settings.js` für die Verwaltung. Dazu drei, die keine Seite sind:
  `src/worklets/captureWorklet.js`, das Aufnahme-Worklet (siehe
  [Mikrofon](#mikrofon)), `src/workers/renderWorker.js`, der Übe-Tracks
  rendert ([E13](#e13-übe-tracks-sind-dateien-in-files)), und
  `src/offline-sw.js`, der Service Worker der Offline-Seite.
- `src/components/` – `ScoreViewer.vue` als Rahmen und Orchestrierung, dazu
  `ScorePage.vue`, `ScoreMixer.vue`, `ScoreAnnotations.vue`, `ScoreStamps.vue`,
  `ScoreModal.vue`, `StandaloneFrame.vue`, `AdminSettings.vue`, die Teile der
  Oberfläche des Viewers (`ViewerBar.vue` für Inhalt und Bedienung der
  Leiste – die Composables bekommt sie per `provide`/`inject` über den
  Schlüssel in `viewerContext.js` statt als Dutzende Props –, `ScoreBar.vue`
  für ihre Gestalt, `ToolGroup.vue`, `ToolRow.vue`, `ToolSwitch.vue` und `ToolPin.vue` für ihre
  Werkzeuggruppen und das Anheften,
  `ScoreStatus.vue`, `ScorePanel.vue` als Rahmen der Seitenkarten, die
  Bedienfelder für Tempo, Zoom, Farben und Info) und die Bedienteile der Probe- und
  Konzertfunktionen (Tabelle unten). `LiveValue.vue` liest die
  Wiedergabezeit, den Cursor und die klingende Note an Stelle des Viewers:
  Was sich mit jedem Frame oder jeder Note ändert, hängt nur an diesem kleinen
  Teilbaum (Positionsanzeige, Seitenliste, Band), der Viewer selbst mit Leiste
  und Bedienfeldern rendert beim Abspielen nicht mit. `ScorePage.vue` hängt
  das Seiten-SVG in ein **eigenes Dokument**, einen quellenlosen `iframe`
  (`scorePageFrame.js`) mit eigenem Stylesheet (`scorePageSvgStyle.js`):
  Nextclouds globale Selektoren reichen nicht hinein, und keine Stiländerung
  im Files-Dokument – ein Menü geht auf, der Fokus wandert – prüft die
  tausenden SVG-Knoten einer Seite. Ein Shadow-Root reichte dafür nicht: Am
  schmalen Bildschirm gilt in Nextcloud eine `:has()`-Regel der
  Kopfzeilen-Suche, unter der jede Änderung den ganzen Baum samt
  Shadow-Inhalt neu prüft; erst ein eigenes Dokument liegt außerhalb jeder
  Kaskade. Das Notenbild liegt auf einer **eigenen Compositor-Ebene**
  (`will-change: opacity`), damit Cursor und Positionsregler beim Abspielen
  nicht in jedem Bild die Ebene des Notenbilds neu aufteilen. Messwerte in den
  [Grenzwerten](limits.de.md#darstellungen).
- `src/l10n.js` – `translate()` mit Ergebnis-Cache
  (`lib/translateCache.js`): Nextclouds `translate()` reinigt jedes Ergebnis
  mit DOMPurify, beim Abspielen am Handy gemessen gut ein Drittel der
  Skriptzeit. Gecacht werden nur Aufrufe ohne Platzhalter.
- `src/directives/` – `nodeText.js` (`v-node-text`) für Text, der sich
  während der Wiedergabe laufend ändert: Es ändert den Wert des vorhandenen
  Textknotens, statt ihn wie Vue über `textContent` zu ersetzen. Ersetzte
  Kindknoten lösen in Files über Nextclouds `:has()`-Regeln eine
  Stil-Neuberechnung über den ganzen Baum aus (gemessen ~70 ms je Änderung,
  siehe [Grenzwerte](limits.de.md#darstellungen)).
- `src/composables/` – der Zustand des Viewers, nach Themen getrennt: die
  offene Partitur mit Laden, Zurücksetzen und Zeitschleife (`useScoreSession`),
  Taktnavigation, Gestalt der Leiste, Konvertierungsstatus, Notizen, Zoom,
  Autoscroll, Metronom, Loop, Wiedergabe, und je eines für jede Funktion der
  Tabelle unten.
- `src/lib/` – **reine Logik ohne DOM, ohne `AudioContext`, ohne Nextcloud** und
  damit ohne Browser testbar: `scoreLayout.js`, `mixerLayout.js`,
  `timingSync.js`, `scrollPlan.js`, `metronome.js`, `svgSanitizer.js`,
  `scoreSync.js`, `scoreFile.js`,
  `playbackTime.js`, `audioHealth.js`, `directToken.js`, `mobileBridge.js`,
  `svgIndex.js`, `highlightStyle.js`, `staffBands.js`, `generation.js`,
  `assetVersion.js`, `viewerFormat.js`, `viewerTexts.js`, für die Leiste
  `barGroups.js` und `barFit.js`, für den sparsamen Betrieb `timeLoopWake.js`,
  `audioIdle.js`, `followPoll.js` und `conversionPoll.js`, für den Rückfall im Browser `clientConversion.js` und
  `artifactUrls.js` ([E7](#e7-konvertierung-im-browser-als-rückfall)), für die
  Fähigkeiten der Artefakte `capabilities.js`
  ([E15](#e15-fähigkeiten-statt-weg)) und die Module der beiden Tabellen
  unten. Neue Logik gehört hierhin, nicht in die Komponenten. Ausnahmen
  sind drei dünne Hüllen, die bewusst neben der reinen Logik liegen und ohne
  Browser nicht testbar sind: `player.js` und `metronomeClick.js` um Web Audio
  (`AudioContext`), `silentClock.js` um die Uhr (`performance.now()`).

`ScoreViewer.vue` ist auf allen drei Seiten mit Partituren dieselbe
Komponente und weiß nicht, über welche sie geladen wurde. Was den Seiten eigen
ist – das Schließkreuz, der Token an den Anfragen, die Brücke zur mobilen App –
steht in ihrem jeweiligen Einstiegspunkt, nicht im Viewer. Die Offline-Seite
zeigt ebenfalls diese Komponente, mit einem einzigen Kontextwert `offline`
([E14](#e14-eine-offline-seite-mit-eigenem-service-worker)).

Wiedergabe: `spessasynth_lib` synthetisiert das MIDI im Browser gegen das
ausgelieferte SoundFont. Eine einzige `requestAnimationFrame`-Schleife treibt
Cursor, Autoscroll, Loop und Metronom; SVG-Seiten werden beim Wegscrollen wieder
aus dem DOM genommen.

**Im Stillstand ruht alles außer dem Bildschirm.** Ein Tablet zeigt am
Notenständer meist eine *angehaltene* Partitur, eine ganze Probe lang. Gemessen
lief dabei früher die Zeitschleife mit 60 Bildern je Sekunde weiter, und der
AudioContext renderte Stille, ohne dass sich am Bild etwas änderte. Beides
läuft heute nur noch mit Grund:

- **Die Zeitschleife** (`useScoreSession`) läuft, solange abgespielt wird,
  solange die Anzeige der Leitung folgt, und für ein kurzes Fenster nach jeder
  Änderung, die die Uhr meldet (`timeLoopWake.js`). Gemeldet wird an der Uhr
  selbst – `player.js` und `silentClock.js` lösen bei `play`, `pause`, `seek`,
  Tempo und bei `timeChange` des Sequencers das Ereignis `wake` aus –, nicht an
  den vielen Stellen, die sie bewegen. Das Fenster ist nötig, weil ein
  Suchlauf im Sequencer nicht sofort wirkt; ohne es bliebe der Cursor nach
  einem Sprung im Stillstand an der alten Stelle. Wer den Takt der Schleife
  sonst noch braucht (`LyricsView`), meldet sich mit `onFrame()` an, statt
  eine eigene Schleife zu drehen.
- **Der AudioContext** ruht (`suspend()`), sobald nichts klingt und niemand
  ihn hält, nach einer kurzen Nachlaufzeit (`audioIdle.js`). Er ist geteilt:
  Einzähler, Mikrofon und das Abhören einer Aufnahme klingen oder hören durch
  ihn, der Einzähler sogar *vor* `play()`. Jede dieser Nutzungen hält ihn mit
  `hold()` wach und gibt ihn beim Abbau frei. Ein ruhender Kontext meldet
  keine Latenz; die Wiedergabe behält dann den zuletzt gemessenen Wert.
- **Die Seiten** bekommen Cursor, klingendes `elid` und Nadel nur, wenn der
  Cursor auf ihnen steht – Vue rendert ein Kind schon dann neu, wenn sich
  irgendeine seiner Props ändert, und sonst lief bei jedem Notenschritt jede
  geladene Seite mit. Ihre Lade- und Entladebeobachter hängen am Scroll-
  Container (`provide`/`inject`), nicht am Viewport; sonst wirkten die Ränder
  nicht, und eine Seite wurde schon beim kleinsten Hin- und Herscrollen neu
  geholt und bereinigt.

**Zwei Zeiten, nicht eine.** `AudioContext.currentTime` – und damit
`sequencer.currentTime` – ist die Zeit des Audios, das gerade an das
Ausgabegerät *übergeben* wurde, nicht die des Audios, das gerade an einem Ohr
ankommt. Dazwischen liegt die Ausgabelatenz – gemessen 51 ms an einer
Arbeitsmaschine und 232 ms an einem Android-Telefon mit Bluetooth-Kopfhörern
([Grenzwerte](limits.de.md#bekannte-lücken)), bei ♩ = 120 also fast eine
Achtelnote. Ein
Videoplayer löst dasselbe Problem seit jeher andersherum, als man zuerst denkt –
nicht der Ton kommt früher, das *Bild* wird später gezeigt. Genauso hier
(`playbackTime.js`):

- Die **Renderzeit** (`currentTimeMs`) bekommt alles, was gegen dieselbe
  Audiouhr *terminiert* oder springt: die Metronomklicks, der Loop-Rücksprung,
  jedes `seek()`.
- Die **Anzeigezeit** (`displayTimeMs`, = Renderzeit − Latenz × Tempofaktor)
  bekommt alles, was zeigt, was gerade zu *hören* ist: Cursor, Autoscroll,
  Taktanzeige, Notiz-Anker, Suchlaufposition.

Ein pauschaler Abzug schon in der Zeitquelle wäre deshalb falsch – er verschöbe
die Metronom-Terminierung gleich mit, und der Klick käme um die Latenz zu spät.
Die Zuordnung fällt an genau einer Stelle, in der Zeitschleife in
`useScoreSession.js`. Aus demselben Grund hält `pause()` nicht an der Renderzeit
an, sondern stellt auf die zuletzt *gehörte* Stelle zurück: Was beim Anhalten
noch im Ausgabepuffer stand, wird verworfen und hat nie geklungen.

Woher die Latenz kommt: `getOutputTimestamp().contextTime` gegen
`currentTime` – dieselbe Größe, mit der die Media-Pipeline des Browsers ein
`<video>` an den Ton hängt –, ersatzweise `baseLatency + outputLatency`. Beide
sagen aber nur, was das *System* weiß; ob der Bluetooth-Anteil darin steckt,
hängt daran, ob der Kopfhörer seine Verzögerung meldet. Deshalb daneben ein
Wert von Hand („Bild und Ton abgleichen"), und der liegt als einzige
Viewer-Einstellung im `localStorage` statt am Nutzerkonto: Er gehört zum Gerät,
nicht zur Person – am Desktop 0, am Telefon mit Kopfhörern 250.

**Manuelles Scrollen wird an der Geste erkannt**, nicht an `scroll`-Ereignissen
(`useAutoScroll.js`): Mobile Browser blenden ihre Adressleiste beim Scrollen ein
und aus und erzeugen dabei Ereignisse, die von keinem Finger stammen. Ob einer
auf dem Glas liegt, meldet der Browser aber – es wird gefragt statt erschlossen.
Mausrad und Tastatur zählen ebenfalls als Eingriff. Das Ende eines
Trägheitsscrollens (`scrollend`) zählt nur, wenn seit dem eigenen Nachführen
eine Geste begann (`scrollPlan.js#isManualScrollEnd`) – sonst hielte das Ende
des eigenen weichen Nachführens das Mitscrollen an.

**Abschaltbar ist nur das automatische Nachführen**, nicht das Springen auf
Befehl (Einstellung `autoScroll`, `Service\ViewerPreferences`). Ausgeschaltet
steht die Ansicht während der Wiedergabe und beim Loop-Rücksprung still; ein
eigener Sprung (Taktfeld, Studierbuchstabe, Pfeiltasten, Notiz, Problemliste)
und ein Sprung der Leitung zeigen ihr Ziel trotzdem, über dasselbe
`forceAutoScrollFor`-Fenster. Welche Navigation dazu zählt, entscheidet
`scrollPlan.js#revealsCursor` an der einen Stelle, an der jede eigene Navigation
ohnehin gemeldet wird (`noteNavigation`, für „Folgt mir“). Ein Tipp auf eine
Note zählt nicht: Sie steht schon im Bild. Band und Liedtext lesen dasselbe
Fenster über `cursorForced`. Ist die klingende Stelle aus dem Bild, führt ein
Knopf zurück; gemessen wird dafür nur bei Notenwechsel und nach einem
manuellen Scrollen, nie je Frame.

Was auf dem Gerät gemessen wurde, steht im Aufklapper „Darstellung" neben der
Herkunft: Ausgabelatenz, Tonausgabe, Aussetzer und Bildrate (`audioHealth.js`).
Rein beschreibend. Der Grund dafür ist, dass „die Wiedergabe synchronisiert
nicht sauber" zwei ganz verschiedene Ursachen hat, die sich gleich anfühlen –
die Anzeige läuft dem Ton voraus, oder der Ton setzt aus, weil die Synthese auf
dem Gerät nicht mitkommt. Aus der Ferne ist das nicht zu unterscheiden, auf dem
Gerät mit einem Blick.

Der klingende Notenkopf wird eingefärbt, wo das SVG die Kennungen aus
[M10](#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg) trägt.
`svgIndex.js` baut dafür **einmal je geladener Seite** eine Karte `elid` →
Knoten; ein Wiedergabeschritt hängt danach nur noch eine CSS-Klasse um, statt
das Dokument zu durchsuchen.

**Wie die klingende Stelle aussieht, entscheidet die Nutzerin** – Form und Farbe
(`highlightStyle.js`, `useViewerPreferences.js`):

- **Form:** entweder die klingenden Notenköpfe einfärben, oder ein Band an der
  klingenden Stelle. Beides gleichzeitig markierte dieselbe Stelle doppelt,
  deshalb ein Umschalter und kein Nebeneinander. „Notenköpfe" bleibt der
  Standard und fällt auf das Band zurück, wo das SVG keine Kennungen trägt.
- **Farbe:** sechs Vorschläge plus freie Wahl. Sie steht als CSS-Variable an der
  Wurzel des Viewers; alles Gefärbte erbt sie über die Kaskade. Ins eigene
  Dokument einer Seite (`scorePageFrame.js`) erbt nichts – dorthin reicht
  der Viewer dieselben Variablen als `svgVars` weiter, und die Seite setzt sie
  an die Wurzel ihres Rahmens. Eine Farbänderung rendert deshalb keine
  einzige Seite neu.

Beides ist **je Nutzerin serverseitig** gespeichert (`ViewerPreferences`), nicht
im `localStorage`: Vorbereitet wird am Rechner, gelesen am Tablet auf dem
Notenständer. Gelesen wird trotzdem ohne eigene Anfrage – der Anfangszustand
hängt schon an der Files-Seite, auf der der Einstieg des Viewers ohnehin geladen wird.
Geschrieben wird verzögert, sonst wäre jede Bewegung im Farbwähler ein POST.

Im selben Aufklapper steht, **womit die angezeigten Seiten gesetzt wurden**:
Konvertierungsweg (aus `renderer.backend`) und, davon getrennt beschriftet, die
MuseScore-Version, mit der die *Partitur* geschrieben wurde
(`meta.mscoreVersion`). Die beiden werden leicht verwechselt – `mscoreVersion`
ist die `<programVersion>` der `.mscz`, nicht die Version des Konvertierers.

Nur sichtbare Seiten werden gerendert. Eingehendes SVG läuft durch einen echten
Sanitizer (DOMPurify), nicht durch reguläre Ausdrücke.

### Probe- und Konzertfunktionen

Jede Funktion folgt demselben Schnitt: die Entscheidung als reines Modul in
`src/lib/` (getestet), die Verdrahtung in einem Composable, die Bedienung in
einer eigenen Komponente. `ScoreViewer.vue` bekommt nur die Verdrahtung.

| Funktion | Reine Logik (`src/lib/`) | Composable | Komponente |
|---|---|---|---|
| Anfangston der eigenen Stimme oder Grundton | `midiNotes.js`, `scoreFacts.js`, `startTone.js` | `useStartTone`, `useScoreFacts` | `ScoreStartTone.vue` |
| „Meine Stimme“ je Partitur, eigene Stimme im Stereobild | `mixState.js`, `panLayout.js` | `useMyPart`, `useMix`, `useMyPartSound` | `MyPartControls.vue`, im Mixer |
| Speed-Trainer im Loop | `speedTrainer.js` | `useSpeedTrainer` | `ScoreSpeedTrainer.vue` |
| Helle Noten auf dunklem Grund | `noteTheme.js` | `useViewerPreferences` | Unterseite „Farben“ |
| Aufführungsmodus, Blättern per Taste/Pedal | `interactionPolicy.js`, `pagingPlan.js`, `keyMap.js` | `usePerformanceMode`, `usePaging`, `useWakeLock` | `ScoreLockButton.vue` |
| Leitungen ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) | `leaders.js` | `useLeaders` | `LeaderPanel.vue` |
| Stimmnotizen, Stempel, Studierbuchstaben | `annotationFilter.js`, `stampLayout.js`, `scoreFacts.js` | `useAnnotations`, `useScoreFacts` | `ScoreStamps.vue`, `StampSymbol.vue` |
| Zeichnen in den Noten ([E22](#e22-freihand-als-notiz-in-linienabständen)) | `drawingLayout.js` | `useAnnotations` | `ScoreDrawings.vue` |
| Übetagebuch ([E20](#e20-übetagebuch-ohne-bestenliste)) | `practiceLog.js` | `usePracticeLog` | `PracticeLogPanel.vue` |
| Aufnahmen der Leitung für Stimmen ([E21](#e21-aufnahmen-der-leitung-für-stimmen)) | `sharedRecordings.js`, `annotationFilter.js` | `useRecorder` | `RecordingPanel.vue` |
| Taktart, Zählzeiten, Loop-Fokus, gespeicherte Loops (1.17) | `scoreFacts.js` (`metersFromArtifacts`), `countLabels.js`, `countLayout.js`, `loopFocus.js` | `useScoreFacts`, `useMetronome`, `useAnnotations` | `NoteNameControls.vue`, `LoopSaveForm.vue`, Overlays in `ScorePage.vue` |
| Drucken ([E16](#e16-drucken-aus-den-seiten-svgs)), Stimmgerät | `printLayout.js`, `tuner.js` | `useConversionStatus`, `useTuner` | `PrintApp.vue`, `PrintToolbar.vue`, `TunerPanel.vue`, `TunerNeedle.vue` |
| PDF-Datei neben der Partitur (1.18, E16) | `svgToPdf.js`, `pdfWriter.js` | – | `PrintApp.vue`, `PrintToolbar.vue` |
| Zwei Seiten nebeneinander (1.18) | `spreadLayout.js`, `pagingPlan.js` (`nextRowScrollTop`) | `useZoom`, `usePaging`, `useViewerPreferences` | `LayoutControls.vue`, Gitter in `ScoreViewer.vue` |
| „Folgt mir“ ([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)) | `followState.js`, `leaderQueue.js`, `followPlayback.js` | `useFollowSession` | `FollowBadge.vue`, `LeaderPanel.vue` |
| Setliste ([E11](#e11-die-setliste-als-markdown-datei)) | `setlistNav.js`, `setlistEdit.js`, `soundFontCache.js` | `useSetlist` | `SetlistBar.vue`, `SetlistEditor.vue` |
| Mikrofon, Aufnahme, Intonation | `micAccess.js`, `resample.js`, `wavCodec.js`, `recordingAlign.js`, `pitchDetect.js`, `intonation.js`, `rhythm.js`, `waitMode.js` | `useMicrophone`, `useRecorder`, `useIntonation`, `useWaitMode` | `MicIndicator.vue`, `RecordingPanel.vue` |
| Sing-Wertung ([E24](#e24-sing-wertung-nur-für-sich)) | `singScore.js`, `singLane.js`, `rhythm.js` (`createLevelStream`) | `useSingScore`, `useIntonation` (`onScoreFrames`) | `SingPanel.vue`, `SingLane.vue` |
| Schalter der Verwaltung | `featureFlags.js` | – | – |

**Die Zeitregel gilt auch hier.** Was plant oder springt, nimmt die
Renderzeit: der Loop-Rücksprung des Speed-Trainers, der Start einer Aufnahme,
der Sprung, den eine Leitung schickt. Was zeigt, was gerade zu hören ist,
nimmt die Anzeigezeit: die Position des Anfangstons („der Ton an der Stelle,
die man sieht und hört“), die Taktangabe mit Studierbuchstabe, die Sollnote der
Intonation bei stehender Wiedergabe, die Position, die eine Leitung an alle
schickt. Aufnahme und Intonation gehen noch einen Schritt weiter, siehe
[Mikrofon](#mikrofon).

**Der Aufführungsmodus fragt eine Stelle.** Welche Bedienung gerade wirken darf,
beantwortet allein `interactionPolicy.js`; im Aufführungsmodus bleiben
Blättern, Zoom, „nächstes Stück“ und der Sprung einer Leitung. Eine Bedienung,
die dort nicht eingetragen ist, gilt als gesperrt – wer eine neue einbaut und
das vergisst, bekommt eine gesperrte, keine offene. Ein Pedal sendet an das
Dokument, nicht an den Viewer; solange der Modus an ist, hängt deshalb ein
zweiter Tastenlistener am `document`. Der Bildschirm bleibt wach, solange
gespielt wird, der Aufführungsmodus an ist, man selbst leitet oder einer
Leitung folgt – ein gelöstes Gerät nimmt keine Sprünge an und darf dunkel
werden; der Bildschirm ist der größte Verbraucher von allen.

**Studierbuchstaben in der Navigation.** Die Takteingabe nimmt „47“, „C“ und
die Form der Taktanzeige „C+3“ an, damit sich eine abgelesene Angabe
unverändert eintippen lässt; woher die Buchstaben kommen, steht in
[E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall).

### Üben und Lesen auf dem Handy

Derselbe Schnitt wie oben – reines Modul, Composable, Komponente:

| Funktion | Reine Logik (`src/lib/`) | Composable | Komponente |
|---|---|---|---|
| Transposition des Klangs | `noteNames.js` (Zieltonart) | `useMyPart` | `TransposeControls.vue` |
| Coach: eigene Stimme als Klavier rechts, übrige leise links | `coachMix.js` | `useMyPart`, `useMyPartSound` | `CoachControls.vue` |
| Übe-Track als MP3, Tracks für alle Stimmen ([E13](#e13-übe-tracks-sind-dateien-in-files)) | `exportPlan.js`, `practiceTrackName.js`, `id3.js` | `usePracticeExport` | `PracticeExportControls.vue` |
| Titel und Medientasten, Hinweis bei gesperrtem Bildschirm | – | `useMediaSession` | – |
| Darstellung: Seiten, Systemband, Liedtext ([E15](#e15-fähigkeiten-statt-weg)) | `capabilities.js`, `systemBand.js`, `lyricsLayout.js` | `useViewerPreferences` | `LayoutControls.vue`, `SystemBand.vue`, `LyricsView.vue` |
| Tonnamen, Note antippen | `noteNames.js`, `noteSpellingIndex.js`, `noteLabelLayout.js` | `useViewerPreferences` | `NoteNameControls.vue`, Overlay in `ScorePage.vue` |
| Offline vormerken ([E14](#e14-eine-offline-seite-mit-eigenem-service-worker)) | `offlinePlan.js` | `useOffline` | `PinControls.vue`, `OfflineApp.vue` |

**Ein Versatz für alle Verbraucher.** Die Transposition (−12 … +12 Halbtöne)
verschiebt nur den Klang, nie das Notenbild. Derselbe Wert geht an den Player,
an den Anfangston, an die Sollnoten der Intonation und an den Export; die
Tonnamen nennen dagegen die **geschriebene** Note, und die Unterseite sagt
das. Gespeichert wird sie je Partitur und Person auf dem Server, zusammen mit
Coach und dem Pegel der übrigen Stimmen (`ViewerPreferences`, `practice.<fileId>`)
– was in einem Stück einen Ton tiefer geübt wird, soll das nächste nicht
verstimmen. Eine Leitung kann eine Transposition für alle setzen
([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).

**Coach ist ein Preset, kein vierter Mischzustand.** Er setzt sich aus dem
Fokus auf die eigene Stimme (`mixerLayout.js`) und dem Stereobild
(`panLayout.js`) zusammen; dazu spielt die eigene Stimme Klavier. Der Regler
„Andere Stimmen“ ersetzt den festen Pegel des Fokus und gilt auch ohne Coach.
Beim Ausschalten kehren genau die Programme zurück, die Coach verändert hat –
eine Instrumentenwahl, die währenddessen im Mixer fiel, bleibt.

**Sperrbildschirm.** Gemessen am Galaxy S23: Die Wiedergabe läuft bei
gesperrtem Bildschirm weiter, in Chrome und in der Nextcloud-App. Eine
Steuerung auf dem Sperrbildschirm erscheint für Web Audio aber nicht, auch
nicht über ein `<audio>` mit `MediaStream`, und die Kopfhörertaste wirkt nicht.
`useMediaSession` setzt Titel und Handler trotzdem – am Desktop greifen die
Medientasten. Wer am Handy während der Wiedergabe sperrt, bekommt **einmal je
Gerät** den Hinweis auf den Übe-Track: Den spielt jeder Player mit Steuerung
auf dem Sperrbildschirm.

**Systemband.** Die Systeme stehen nebeneinander, jedes so hoch wie der Platz,
aber mit höchstens 12 px Linienabstand (`bandScale` in `systemBand.js`) – am
Handy quer gehalten füllt ein System den Bildschirm, hochkant wird ein
einzeiliger Auszug nicht zur 130-px-Notenzeile mit drei Noten je Bildschirm.
Der Maßstab gilt je System, nicht einer fürs ganze Band: Sonst bestimmte ein
einziges hohes System (Titel, viele Strophen) die Größe aller. Nichts wird neu gesetzt
([E2](#e2-musescore-svg-statt-neusatz-im-browser)): Jedes System ist eine
gewöhnliche `ScorePage` mit einem Ausschnitt (`crop`) ihrer Seite, die Grenzen
kommen aus den Notenlinien (`staffBands.js`), Liedtext darunter zählt zum
System. Cursor, Stempel, Notizen, Loop und Tonnamen liegen in Prozent der
Seite und funktionieren deshalb unverändert. Gerendert werden nur das
sichtbare System und seine Nachbarn; das übernächste baut das Band im
Leerlauf vor (`requestIdleCallback`), damit beim Systemwechsel keine Seite
erst gereinigt und eingelesen werden muss. Am Handy ist ein System leicht zwei bis
fünf Bildschirme breit; darin blättert das Band **seitenweise** statt zu
gleiten (`bandPaging.js`): Erreicht der Cursor 85 % der Breite, springt es so
weit, dass er bei 15 % steht – das zuletzt Gelesene bleibt links stehen, das
Bild steht bis zum nächsten Sprung still, und es kostet kein Scrollen je
Note. Folgt das Band der Wiedergabe, springt es **ohne Gleiten**, beim
Umblättern wie beim nächsten System: Am Ende eines Systems steht die nächste
Note schon rechts außerhalb, und ein Gleiten dauerte auf einem Galaxy S23
400–850 ms – so lange war der Cursor bei jedem Systemwechsel nicht zu sehen.
Gleiten bleibt, wo die Hand blättert (Pedal, „Zurück zur Wiedergabe“). Während
des eigenen Sprungs ist das Einrasten an den Systemanfängen aus; gemessen
hielt `scroll-snap` sonst einen Sprung auf 988 px bei 745 px an. `Bild↓`/`Bild↑` und ein Pedal blättern in einem breiten System erst
seitenweise, dann ein System weiter. Wer den Viewer zum ersten Mal unter 600 px Breite mit Seiten
öffnet, bekommt das Band einmal angeboten; die Antwort merkt sich die App.

Das Band hat einen **eigenen Zoom** (`useBandZoom`, 50–300 % auf die
Standardgröße, Knöpfe, `+`/`-`/`0`, zwei Finger), getrennt vom Seitenzoom: Der
ist eine an die Fensterbreite gekoppelte Seitenbreite und bedeutet im Band
nichts, ein gemeinsamer Wert spränge bei jedem Wechsel. Gemerkt wird er je
Gerät, wie Seitenformat und Latenz. Ein größer gezoomtes System schiebt man im
Band senkrecht, ein kleineres steht oben. Den freien Platz darunter füllt das
Band bewusst **nicht** mit dem nächsten System: Ein System ist am Handy auch
bei 48-px-Notenzeilen zwei bis fünf Bildschirme breit, gestapelt läse man das
obere nach rechts und spränge dann an den Anfang des unteren zurück – das
Zickzack der Seitenansicht, das das Band vermeiden soll. Wer hochkant mehrere
Systeme untereinander sehen will, nimmt die Handyseiten
([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)). Ändert sich die Größe der Rahmen –
Zoom, Drehen, ein Hinweis darüber, die quer beim Abspielen einfahrende Leiste
(gemessen: Bandhöhe 157 → 208 px) –, behält das Band seine Stelle
(`bandAnchor`): auf dem Cursor, solange es folgt, sonst auf der Stelle am linken
Rand; ein absolutes `scrollLeft` zeigte danach woanders hin. Hinweise stehen
über dem Band, das Band füllt den Rest.

Die Rahmen sind nach Seiten-URL **und** Index geschlüsselt, und die URLs gelten
erst zusammen mit den daraus geschnittenen Ausschnitten (`loadedUrls`): Eine
`ScorePage` behält das SVG, das sie zuerst geladen hat. Gemessen lagen nach
einem Wechsel der Darstellungsvariante sonst die neuen Ausschnitte und der neue
Cursor über dem alten Seitenbild; dasselbe gälte für alles, was neue
`pageUrls` unter denselben Indizes bringt.

**Zwei Seiten nebeneinander.** Keine vierte Darstellung, sondern eine
Eigenschaft der Seitenansicht: Sie gilt, sobald die Notenfläche mindestens
900 px breit ist (`spreadLayout.js`), und die Einstellung `double_page`
(`off`, `left`, `right`; Vorgabe `left`) sagt, was dann geschieht – Seite 1
links (Paare 1–2, 3–4) oder allein rechts wie im Heft (1, 2–3). Die Schwelle
hängt an der Fläche, nicht am Gerät: Ein Telefon quer bleibt einspaltig, ein
schmales Desktop-Fenster auch. Die Zoom-Presets passen dann das Paar ein;
wer darüber hinaus zoomt, schiebt waagerecht, die Reihe klappt nicht um.
`ScorePage` bleibt unverändert, das Gitter liegt am Container. Blättern geht
reihenweise (`nextRowScrollTop`): Die halbe Seitenwende der einspaltigen
Ansicht schöbe das letzte System der Reihe nach oben und zerschnitte die
nächste Reihe – wer dann noch links liest, verlöre den Anfang der rechten
Seite. Nur eine Reihe, die höher ist als der Ausschnitt, wird wie bisher
nach Systemen geblättert.

**Liedtext-Ansicht.** Nur der Text der eigenen Stimme – ohne gewählte Stimme
der der obersten Notenzeile mit Text –, die Strophen untereinander, ein Block
je System. Text darf umbrechen, Noten nicht. Welche Strophe klingt, sagt die
ausgerollte Wiederholung ([M7](#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht)):
Das n-te Auftreten einer `elid` im Timing singt Strophe n, gibt es weniger
Strophen, bleibt es bei der letzten. Die gesungene Silbe leuchtet über eine
Klasse am Knoten, nicht über eine Vue-Eigenschaft; ein Tipp auf ein Wort
springt dorthin, Ziehen über mehrere Wörter setzt einen Loop. Mit **Alle
Stimmen** steht je System eine Zeile je Notenzeile mit Text, beschriftet mit
dem Namen ihrer Stimme, und es leuchten die Zeilen, die gerade eine Silbe
beginnen (`buildChoirLyrics`, `choirActiveSyllables` in `lyricsLayout.js`).
Den Namen trägt eine Zeile nur, wenn die Zahl der Notenzeilen der der Stimmen
entspricht; sonst heißt sie „Notenzeile n“ – dieselbe Vorsicht wie bei
den Stimmstempeln (`canMapStavesToParts` in `staffBands.js`).

**Tonnamen und Note antippen.** Deutsch (H, B für Hes), Englisch, feste und
relative Solmisation, wahlweise nur an der eigenen Stimme (Vorgabe). Der Name
kommt aus der Schreibweise je Notenkopf (`tpc` in `noteSpellings`,
[E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)): Aus der
MIDI-Tonhöhe allein ist Fis von Ges nicht zu unterscheiden. Zugeordnet wird
der Reihe nach je Segment, Notenzeile und Stimme; stimmt die Zahl einer Gruppe
nicht, bleibt sie ohne Namen – lieber keiner als ein falscher. Das relative Do
braucht keinen Modus: do sitzt auf der Dur-Tonika der Vorzeichnung, Moll ist
la-basiert. Ein Tipp auf eine Note springt dorthin und spielt bei stehender
Wiedergabe zusätzlich deren Ton (mit Transposition), der Name erscheint kurz am
Kopf.

### Wiedergabe: was ein Suchlauf zurücksetzt

Gemessen: Jeder Suchlauf in spessasynth – und damit jeder Loop-Rücksprung –
setzt den Synthesizer zurück (`setTimeTo()` ruft `synth.reset()`) und spielt
danach die Controller und Programmwechsel aus dem MIDI bis zur Zielstelle
nach. MuseScore schreibt Lautstärke (CC7) und Panorama (CC10) an den Anfang
jeder Spur. Ohne Gegenmaßnahme waren Mute, Solo, „Meine Stimme“, das Stereobild
und ein im Mixer gewähltes Instrument nach dem ersten Suchlauf wieder weg.
`player.js` sperrt deshalb, was die Nutzerin einstellt (die Lautstärke jedes
Kanals schon beim Laden, siehe „Die Mischung“ unten):

- **Controller** über `lockController(ch, cc, true)`: Ein gesperrter
  Controller übersteht den Reset und ignoriert die Werte aus dem MIDI. Gesetzt
  wird in der Reihenfolge entsperren – setzen – sperren, sonst prallte der
  eigene Wert an der eigenen Sperre ab.
- **Instrumente** über den Systemparameter `presetLock`: Er lässt jeden
  Programmwechsel abprallen, auch das `programChange(0)` des Resets.

Die **Transposition** braucht keine Sperre: Sie sitzt im globalen
Systemparameter `keyShift`, nicht im gleichnamigen Kanalparameter. Gemessen:
C4 klingt mit +2 auf 294 Hz und nach zwei Suchläufen weiterhin auf 294 Hz;
den Kanalparameter setzt der Reset dagegen auf 0. Schlagzeugkanäle lassen den
globalen Wert von selbst aus. Der Render-Worker der Übe-Tracks benutzt
denselben Parameter.

Ein zweites Merkmal desselben Suchlaufs: Er wirkt **asynchron**. Nach
`seek()` stimmt die Zeit des Sequencers erst mit dem Ereignis `timechange`;
`player.js` meldet das über `seekIsAsync`. Wer direkt nach einem Sprung die
Position braucht – das Abhören einer Aufnahme setzt seinen Anker genau dann –,
wartet darauf. Der stumme Platzhalter (`silentClock.js`) springt sofort und
kennt das Ereignis nicht.

**Die Mischung.** Lautstärke, Mute, Solo, Instrument und „Meine Stimme“ sind
ein Zustand (`lib/mixState.js`), den `useMix.js` für die Lebensdauer des
Players hält; der Mixer zeigt ihn nur an. Angewendet wird er, sobald der
Player steht – nicht erst, wenn ein Regler sich bewegt. **100 % ist die
Mischung der Partitur:** Ein Pegel ist ein Faktor auf den CC7-Wert, mit dem
die Stimme in `score.mid` beginnt (`midiNotes.js`, `channelVolumes`), also
auf die Einstellung in MuseScores eigenem Mixer. Gemessen schreibt MuseScore
dort für jede Stimme 100, nicht 127; mit absoluten Werten spielte eine nie
berührte Stimme mit 100 und eine einmal bewegte mit 127, alle Regler auf
„voll“. Lauter als die Partitur gibt es nicht – über 100 lägen nur 2 dB.
„Meine Stimme“ lässt die eigene Stimme bei 100 % und setzt die übrigen auf
den Regler „andere Stimmen“, ebenfalls relativ; Coach und die Tracks je
Stimme rechnen mit derselben Funktion. Der Warte-Modus schaltet die eigene
Stimme stumm, ohne ihren Pegel zu vergessen.

Gewählt wird „Meine Stimme“ an zwei Stellen, die denselben Zustand setzen
(`useMyPart.js`): über das Stimmensymbol im Mixer und über die Zeile „Meine
Stimme“ in der Gruppe Ansicht (`MyPartControls.vue`). Die Zeile braucht
keinen Ton, denn Hervorhebung, Tonnamen, Zählzeiten und Druck benutzen die
Wahl auch ohne; ihre Stimmen kommen aus `meta.parts`, nicht aus den
Mixerkanälen.

Der Anfangston klingt auf einem freien Kanal – dem ersten, der keiner Spur
gehört, nie Kanal 9 (Schlagzeug) – als Klavier und durch dieselbe
Ausgabekette wie die Musik, also mit derselben Latenz und Lautstärke. Ein
Tipp, der nie losgelassen wird, endet nach 8 s von selbst.

### Mikrofon

`useMicrophone.js` ist **die einzige Stelle mit `getUserMedia`**. Aufnahme,
Intonation, Stimmgerät und (vorgesehen) Mitverfolgen melden sich dort an und ab; solange
niemand angemeldet ist, ist das Mikrofon ganz aus, und die Anzeige des Browsers
erlischt. Ein roter Punkt in der Leiste (`MicIndicator.vue`) zeigt, wofür es
gerade läuft, und schaltet es mit einem Tipp für alle ab. Echounterdrückung,
Rauschunterdrückung und automatische Verstärkung sind aus: Die erste zieht die
Begleitung heraus, die zweite glättet genau die Obertöne, an denen die
Tonhöhe hängt, die dritte pumpt.

Ob das Mikrofon geht, zeigt allein der Fehler von `getUserMedia`
(`micAccess.js`), nie der User-Agent. Die WebView der Android-App lehnt heute
ab; ändert sie das, geht es ohne Zutun. Bis dahin führt der Knopf „Im Browser
öffnen“ dorthin, wo es geht.

**Der Typ der Audio-Sitzung** (`navigator.audioSession`, `audioSession.js`)
ist eine Angabe pro Seite, nicht pro Kontext. Mit dem Standard `'auto'`
behandelt Safari Web Audio als Umgebungsklang, und iOS schaltet ihn mit dem
Stummschalter stumm. Vor jedem Klang (`createAudioContext()`, das `resume` in
`player.js`, der eigene Kontext des Metronoms) steht deshalb `'playback'`, um
`getUserMedia` herum `'play-and-record'`. Solange jemand aufnimmt, behält der
zweite Typ Vorrang. Mit dem Abbau des Players fällt die Sitzung auf `'auto'`
zurück. Gesetzt wird der Typ erst beim ersten Klang, nicht beim Öffnen, denn
`'playback'` hält die Musik anderer Apps an. Wo die Schnittstelle fehlt
(Chrome, iOS < 16.4), ändert sich nichts.

**Der Aufnahmeweg ist strukturell getrennt ([S7](#s7-der-aufnahmeweg-ist-strukturell-getrennt)).** Blöcke aus dem Worklet
bekommen nur Aufnahme, Intonation und Stimmgerät (`mayUseCapturePath`); das
Stimmgerät liest sie und schreibt nichts. Ein
Mitverfolgen bekäme die Quelle für eigene Analyser, aber keine Blöcke – es
kann also nichts speichern, auch nicht durch einen Fehler im Aufrufer.

**Ein AudioContext für alles.** Die Quelle hängt am Wiedergabe-AudioContext,
damit Zeitstempel, Latenz und Sequencer dieselbe Uhr haben. Das Worklet
(`captureWorklet.js`) mischt auf Mono, rechnet auf 16 kHz herunter
(`resample.js`) und schickt Blöcke von 20 ms mit ihrer Kontextzeit
(`currentFrame`). Gespeichert wird WAV, mono, 16 kHz, 16 bit
(`wavCodec.js`, serverseitig geprüft von `WavFormat`).

**Wohin ein Sample gehört** (`recordingAlign.js`): Die Aufnahme liegt um zwei
Anteile hinter der Partitur. Die Sängerin hört die Begleitung um die
Ausgabelatenz verspätet und singt dazu; das Mikrofon liefert um die
Eingangslatenz verspätet (`getSettings().latency`, wo gemeldet, plus
`baseLatency`). Die Partiturzeit hängt über einen **Anker** an der
Kontextuhr – ein Paar aus Kontextzeit und Partiturzeit, im selben Moment
abgelesen –, der die Gerade des Sequencers nachbildet. `score_start_ms` wird
um beide Anteile korrigiert gespeichert. Abgehört wird die WAV im **selben**
AudioContext, auf die Kontextzeit des Sequencers gestartet; Cursor,
Begleitung und Aufnahme laufen damit auf derselben Uhr. Der Restfehler steht in
[Grenzwerte](limits.de.md#mikrofon-aufnahme-und-intonation).

**Intonation** rechnet YIN (`pitchDetect.js`) in einem Web Worker, live und
danach aus der gespeicherten WAV – gespeichert wird nichts zusätzlich, eine
Verbesserung am Verfahren wirkt auch auf alte Aufnahmen. Bewertet wird der
Median nach dem Einschwingen (100 ms), gegen den eingestellten Stimmton a'
(`referencePitch.js`: die gehörten Frequenzen werden beim Eintreffen auf 440
umgerechnet, die Vergleiche selbst kennen nur 440; eine Aufnahme rechnet mit
ihrem gespeicherten `referenceHz`), Oktaven gefaltet;
ein Signal ohne klare Tonhöhe ist „nicht auswertbar“ statt geschätzt.
Notenköpfe färben sich nur, wo das SVG `st-`/`vc-` trägt
([M10](#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)) und
sich Notenzeilen den Stimmen zuordnen lassen; sonst bleibt es bei Nadel und
Problemliste. Ob sie sich zuordnen lassen, meldet jede geladene Seite mit
mindestens einem System – eine Titel- oder Textseite schweigt, sonst
überstimmte ihr „nein“ die Notenseiten.

**Rhythmus** (`rhythm.js`) liest aus denselben Rahmen, ohne zweiten Lauf durch
den Worker, Einsatz und Ende jeder bewerteten Note. Gefunden wird der Einsatz
über die Tonhöhe – drei stimmhafte Rahmen in Folge auf der Sollnote, nur dort,
wo davor Stille oder eine andere Tonhöhe lag; an dieselbe Tonhöhe gebunden ist
„nicht auswertbar“. Gesucht wird ab 250 ms vor dem Schlag (höchstens bis zur
Mitte zur vorigen Note) bis kurz vor das Ende der Note, höchstens 250 ms
danach: Ein später Einsatz muss noch 60 ms der Note übrig lassen, weil die
stabile Tonhöhe erst nach der Silbe kommt; nur bis zur Notenmitte gesucht,
war ein kurzer, 150 ms später Ton „nicht auswertbar“ statt zu spät. Weiter
geht es nicht, denn dahinter liegt die Stimme in der Zeit der nächsten Note.
Gemessen wird er dann am **Beginn der Silbe**: nach
Stille zurück bis dahin, wo der Pegel zuletzt 15 dB unter dem der Note lag
(Pegelverlauf im 5-ms-Raster, `levelEnvelope`, vom Worker mitgerechnet), nach
einer anderen Note zurück, solange die Stimme sie nicht mehr hält. An der
stabilen Tonhöhe selbst gemessen las eine echte Stimme mit pünktlichen Silben
etwa 40 ms zu spät – ein Drittel der Einsätze wurde gelb. Als Tonwechsel gilt
es, wenn die vorige Note in den letzten 80 ms stimmhaft klang; ein unsicherer
Rahmen mitten im Wechsel ist keine Stille. Abgezogen wird der synthetisch
gemessene Versatz (nach Stille 3 ms, nach Tonwechsel 10 ms), bewertet wird absolut gegen die Partitur und in
Echtzeit, nicht gegen das eigene Mittel und nicht in Partiturzeit: Wer
gleichmäßig schleppt, soll es sehen, und 60 ms sind bei halbem Tempo so
hörbar wie bei vollem. Grün ist nie enger als 55 ms, über dem Versatz der
Aufnahme gegen den Cursor. Das Ende („zu kurz“) gilt nur vor einer Pause,
„zu lang“ gibt es nicht. Ein Notenkopf zeigt den schlechtesten der drei Werte;
die Markierungen rechnet `useIntonation` aus den Bewertungen nach, sobald
Zeilenzuordnung oder Segmente sich ändern, statt sie mit der Auswertung
festzuschreiben.

**Der Warte-Modus** (`waitMode.js`, `useWaitMode.js`) hält die Wiedergabe vor
jeder Note der eigenen Stimme an, die mindestens 200 ms dauert, und lässt sie
weiterlaufen, sobald drei Rahmen in Folge auf ihr liegen (±50 Cent, Oktave
gefaltet, im Divisi jede Note des Akkords). Er hört über die Rahmen der
Live-Intonation (`useIntonation.onFrames`), keine zweite Analyse am selben
Mikrofon, und die Nadel bleibt an. Angehalten wird 30 ms **vor** dem
Einsatz, über einen Zeitgeber auf der Uhr des Sequencers, damit die Note-ons
der Begleitung an dieser Stelle erst mit der Sängerin einsetzen. Singt sie
den Ton schon, wenn die Note kommt, wird nicht angehalten. Während des
Wartens klingt die Begleitung, die beim Anhalten spielte, als Haltechord
weiter (`player.holdChord`): spessasynth schaltet beim Pausieren alle Noten
ab und schlägt sie bei `play()` neu an; der Player schlägt sie deshalb selbst
an und löst sie in `play()` vor dem Sequencer, wer auch immer auf „Abspielen“
drückt. Die eigene Stimme ist für den ganzen Modus stumm – über einen
Lautsprecher hörte das Mikrofon sonst die App singen. Metronom, Speed-Trainer,
Aufnahme und „Folgt mir“ schließen ihn aus (die letzte Einschaltung gewinnt,
verdrahtet in `ScoreViewer`); eine Aufnahme ließe sich mit seinen Pausen ohnehin
nicht linear auf die Partitur legen (`recordingAlign.js`).

**Das Stimmgerät** (`useTuner.js`, `tuner.js`) nimmt dieselbe Kette – Blöcke
in denselben Worker, Rahmen zurück –, hat aber keine Sollnote: Es faltet auf
die nächste Note, nicht auf die Oktave, denn ein Stimmgerät zeigt die Oktave.
Der Median über die letzten 120 ms hält die Nadel durch Vibrato hindurch
ruhig; ein Signal ohne klare Tonhöhe (zwei Stimmen, Atem) zeigt nichts statt
einer Schätzung. Benannt wird die Note nach dem Tonnamen-System der Person
und der Tonart an der aktuellen Stelle (`tpcForPitch`: die Schreibweise, die
MuseScore selbst wählte – in F-Dur B, nicht Ais). Der Referenzton ist dieselbe
Konstante wie bei der Intonation (`A4_HZ`), damit beide gemeinsam einstellbar
werden können. Das Stimmgerät hängt am Schalter „Intonation“ der Verwaltung:
dieselbe Analyse, dieselbe Mikrofonfrage.

**Die Berechtigungsrichtlinie.** Nextcloud schickt jede Seite mit
`Feature-Policy: … microphone 'none'`, und `getUserMedia` scheitert dort, bevor
der Browser fragt. Freigegeben wird `microphone 'self'` nur, wo es gebraucht
wird: auf der Files-Seite über `Listener\AddFeaturePolicyListener`, und nur,
wenn es keine XHR-Antwort ist, mindestens eine Mikrofonfunktion eingeschaltet
ist und der Pfad mit `/apps/files` beginnt; auf der eigenständigen Seite an der
Antwort von `ScoreDirectEditor::open()`. Dashboard, Talk und alle übrigen Seiten
behalten `'none'`. Der Grund für die Enge: Eine Erlaubnis des Browsers gilt je
Herkunft, nach „Immer erlauben“ dürfte sonst jedes Skript auf jeder Seite der
Instanz ohne Rückfrage aufnehmen.

### Nachgeladene Dateien

Nicht alles, was der Viewer lädt, geht über `Util::addScript`, und was daran
vorbeigeht, braucht eine eigene Antwort auf zwei Fragen – woher, und wie ein
Update einen alten Stand im Browser-Cache ablöst:

| Datei | Geladen über | Woher | Cache-Busting |
|---|---|---|---|
| `spessasynth_processor.min.js`, `scoreview-capture-worklet.js` | `audioWorklet.addModule(url)` | `generateFilePath()` | `?v=<App-Version>`, beim Bauen aus `info.xml` (`assetVersion.js`) |
| Der Viewer selbst auf der Files-Seite (`viewerUi.js`), Tonhöhen-Worker, Teile von `@nextcloud/dialogs` | webpack-Nachladen (`new Worker(new URL(…))`, `import()`) | `__webpack_public_path__`, zur Laufzeit gesetzt (`publicPath.js`) | Inhalts-Hash als `?v=` im Dateinamen der Teile |
| scoreview-engine (`scoreview.mjs`, `.lib.wasm`, `.lib.data`), nur für [E7](#e7-konvertierung-im-browser-als-rückfall) | nativer `import(engineUrl)`; `.wasm`/`.data` fordert der Glue relativ zu seiner eigenen URL an | `GET /api/engine/{version}/{name}` (`EngineController`) | Engine-Version im **Pfad** – ein `?v=` am Glue erbten die Geschwister nicht; eine fremde Version antwortet 404 |
| `scoreview-render-worker.js` ([E13](#e13-übe-tracks-sind-dateien-in-files)) | `new Worker(url)` | `generateFilePath()` | `?v=<App-Version>`, wie die Worklets |
| `scoreview-offline-sw.js` ([E14](#e14-eine-offline-seite-mit-eigenem-service-worker)) | `navigator.serviceWorker.register()` | `GET /offline/sw.js` (`PageController`), damit `Service-Worker-Allowed` gesetzt werden kann | `?v=<App-Version>`; der Worker benennt danach seinen Cache für die Hülle der Seite und räumt ältere |

Der Viewer selbst wird auf der Files-Seite erst beim Öffnen einer Partitur
nachgeladen: `viewer.js` läuft auf *jeder* Files-Seite, auch ohne Partitur in
Sicht, und trug früher den ganzen Viewer mit (~2,2 MB, bei jedem Ordnerwechsel
neu zu parsen und zu übersetzen). Handler und Dateiaktion registriert er
weiterhin sofort – sonst böte Files für eine `.mscz` nur „Herunterladen“ an.
Die eigenständige Seite und die Offline-Seite zeigen immer eine Partitur und
laden den Viewer deshalb gleich mit.

Die Laufzeit-Adresse ist nötig, weil die Vorgabe von
`@nextcloud/webpack-vue-config` fest `/apps/scoreview/js/` lautet – liegt die App
wie üblich unter `custom_apps/`, liefe jedes Nachladen ins 404. Ein Worklet
kann nichts nachladen (im `AudioWorkletGlobalScope` gibt es weder
`importScripts` noch `fetch`); es ist deshalb ein eigener Webpack-Eintrag, der
für sich allein steht. Dasselbe gilt für den Render-Worker und den Service
Worker: Als nachgeladener Teil spaltete die Nextcloud-Vorlage ihre
Abhängigkeiten in einen Vendor-Teil ab, den der Worker unter dem festen Pfad
`/apps/scoreview/js/` suchte – die Laufzeit-Adresse korrigiert das nur für die
Seite, nicht für einen Worker.

### Stückwechsel im Viewer

Eine Setliste wechselt das Stück **im** Viewer, nicht durch ein neues
Einhängen von außen: `ScoreViewer.vue` hält dafür seine eigene `activeFileId`,
die `useSetlist` setzt. Nur so bleiben Aufführungsmodus, Notenfarbe und Zoom
über den Wechsel erhalten. Der AudioContext wird dabei neu aufgebaut, das
SoundFont (rund 24–40 MB, je nach Quelle) aber nicht neu geladen: `soundFontCache.js` hält es auf
Modulebene für die Lebensdauer der Seite, teilt einen laufenden Abruf und
merkt sich keinen Fehler. Ein Generationszähler in `usePlayback.js` verwirft
Antworten, die zu einem schon verlassenen Stück gehören.

Denselben Weg nimmt der Wechsel, den eine Leitung in „Folgt mir“ auslöst:
Wer eine Setliste offen hat, die das neue Stück enthält, wechselt über deren
Navigation, sonst wird das neue Stück als Einzelstück geöffnet
([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).

## Sicherheitsregeln

Die Regeln, die die Probe- und Konzertfunktionen und die eigenständige Seite
([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps)) verbindlich
einhalten. Die Begründungen stehen ausführlich an den verlinkten Stellen; hier
steht, was nicht aufgeweicht werden darf. Im Code sind sie als `S1`…`S11`
referenziert.

### S1: Begleit-Token sind an Zweck, Datei und Direct-Editing-Token gebunden

Ein Begleit-Token (`Service\CompanionTokenService`) gilt nur für seinen Zweck
(`score` oder `setlist`), nur für seine Datei und nur zusammen mit dem lebenden
Direct-Editing-Token, aus dem es ausgegeben wurde (`dt`). Ausgegeben wird nur
mit einem Direct-Editing-Token, und zwar an genau zwei Stellen: für eine
Setliste neben dessen Partitur, die sie enthält, und für das Stück, zu dem
eine Sitzung von „Folgt mir“ umgezogen ist
([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
Das zweite nur für eine Partitur (`application/x-musescore`), die die Person
lesen darf, und nur, wenn die Sitzung der Token-Datei dorthin umgezogen ist –
beide tragen dieselbe Sitzungskennung (`FollowService::isMoveTarget`); eine
beliebige Datei mit irgendeiner laufenden Sitzung reicht nicht. Nie aus einer
Sitzung, nie aus einem Begleit-Token heraus (keine Kette). Widerrufen wird bei jeder Anfrage: hartes Ablaufdatum nach
12 h, Epoche der Nutzerin, Konto aktiv, Datei neu aufgelöst. Token stehen nur
im Header, nie in URL, Protokoll oder `localStorage`. Einzelheiten:
[E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps).

### S2: Schreiben mit Token nur um die Partitur herum

Mit einem Token kommt in eine Setliste nichts, was nicht schon um die offene
Partitur liegt: mit dem Direct-Editing-Token nur Dateien aus deren Ordner bis
Tiefe 2, mit einem Begleit-Token gar nichts Neues (Umordnen und Entfernen
bleiben), angelegt wird nur im Ordner der Token-Datei. Ein Übe-Track
entsteht mit dem Direct-Editing-Token nur neben der Partitur oder in ihrem
Unterordner für Übe-Tracks, mit einem Begleit-Token gar nicht – und auf jedem
Weg nur neben einer `.mscz`: Ist die angegebene Datei ein Ordner oder etwas
anderes, antwortet der Server 404. Beliebige Pfade und frei gewählte Ordner
gibt es nur in der Browser-Sitzung. Sonst würde aus der Erlaubnis für eine
Datei über eine selbst angelegte Liste und S1 eine für alle.

Dateinamen, die die App selbst anlegt (Setlisten, Übe-Tracks), verlieren
Steuer- und Richtungszeichen (U+200E/F, U+202A–202E, U+2066–2069 – sonst ließe
sich eine Endung optisch verdrehen) und sind auf 120 Zeichen bzw. 240 Bytes
begrenzt; einen Namen, den die Instanz verbietet, lehnt der Server mit 400 ab
(`Service\FileNames`).

Die Regel hängt daran, dass Middleware und Controller dieselbe
`DirectAccessContext`-Instanz sehen. `AppInfo\Application` registriert sie
deshalb ausdrücklich als geteilten Dienst, und der schreibende Controller lehnt
ab, wenn die Middleware die Anfrage nicht eingeordnet hat – die Voreinstellung
„Sitzung“ hieße „ohne Grenze“ und darf nie aus einem Verdrahtungsfehler folgen.

### S3: Das Mikrofon nur, wo es gebraucht wird

`microphone 'self'` gibt es nur auf der Files-Seite (keine XHR-Antwort,
mindestens eine Mikrofonfunktion an, Pfad unter `/apps/files`) und auf der
eigenständigen Seite; überall sonst bleibt Nextclouds `'none'`. Eine Erlaubnis
des Browsers gilt je Herkunft – ohne diese Enge dürfte nach „Immer erlauben“
jedes Skript auf jeder Seite der Instanz aufnehmen. Innerhalb von Files bleibt
das Restrisiko, siehe [Grenzwerte](limits.de.md). Einzelheiten:
[Mikrofon](#mikrofon).

### S4: Teure Arbeit ist gedeckelt

Was ohne Sitzung erreichbar ist, darf nicht unbegrenzt Arbeit auslösen:

- Die Dateiauswahl für den Setlisten-Editor besucht höchstens 100 Ordner,
  nicht nur höchstens 200 Treffer.
- Eine Setliste hat höchstens 200 Einträge – beim Schreiben **und** beim
  Lesen, denn jede aufgelöste Zeile kostet einen Zugriff auf den Dateibaum,
  und die Datei lässt sich im Texteditor beliebig füllen. Die Suche nach
  Listen, die eine Partitur enthalten, sieht höchstens 20 Listen je Ordner an.
- Die Nutzersuche für Leitungen und die schreibenden Routen (Aufnahme und
  Übe-Track hochladen, „Folgt mir“ starten, steuern, umziehen, beenden und
  beitreten, Begleit-Token für ein umgezogenes Stück, Notiz anlegen und
  ändern, Setliste speichern und anlegen) tragen
  `#[UserRateLimit]` **und** `#[AnonRateLimit]`: Anfragen mit Token sind für
  Nextclouds Drosselung anonym, weil sie vor der eigenen Middleware läuft.
- „Neu konvertieren“ verwirft den Cache und reiht eine volle Konvertierung
  ein – höchstens fünfmal in fünf Minuten je Person (`#[UserRateLimit]`;
  die Route kennt kein Token, also keine anonyme Drosselung). Der Viewer
  zeigt bei 429 einen Hinweis und behält die Partitur.
- Ein Direct-Editing-Token wird höchstens einmal je Minute verlängert
  (`DirectAccessMiddleware`, Merker im verteilten Cache): Nextclouds
  `extend()` ist ein UPDATE, und die Handy-Seite pollt „Folgt mir“ ohne
  notify_push alle 800 ms. Ohne Speichercache bleibt es bei jeder Anfrage.
- Die Nutzersuche für Leitungen prüft höchstens 30 Treffer auf Dateizugriff –
  jede Prüfung richtet den Dateibaum einer anderen Person ein.
- Eine Person hat je Partitur höchstens 500 Notizen (409), denn wer nur lesen
  darf, darf trotzdem private Notizen anlegen, auch mit Token.
- Darstellungsvarianten ([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)):
  höchstens 20 neue Läufe je Person und Stunde (429, gezählt nur, wenn
  wirklich gesetzt wird – nicht beim Abruf einer fertigen Variante), höchstens
  8 Varianten je Fassung (die am längsten nicht abgerufene fällt weg), und
  dieselbe Größengrenze wie die Grundkonvertierung (`max_score_bytes`). Jeder
  Lauf ist ein Prozess mit 130–250 MB.

### S5: Aufnahmen haben eigene Speichergrenzen

Aufnahmen liegen in `IAppData` und zählen deshalb **nicht** gegen die Quota der
Nutzerin. Die App zieht ihre eigenen Grenzen: Anzahl je Person und Partitur,
Länge, Bytes je Person und Bytes auf der ganzen Instanz; beim Erreichen
antwortet der Server 409 (Anzahl), 413 (Länge) bzw. 507 (Bytes) mit klarer
Meldung. Die Werte stehen in
[Installation](installation.de.md).

### S6: Pfade einer Setliste bleiben im Nutzerordner

Pfade werden vor dem Dateibaum selbst normalisiert: `..` über die Wurzel
hinaus, `\`, NUL und andere Steuerzeichen führen nirgendwohin; ein Eintrag mit
Steuerzeichen oder Zeilenumbruch wird beim Schreiben abgelehnt, nicht still
bereinigt, weil er sonst das Format bräche. Aufgelöst wird immer aus Sicht der
Lesenden – ein absoluter Pfad in einer geteilten Liste zeigt in *ihren* Baum
([E11](#e11-die-setliste-als-markdown-datei)).

### S7: Der Aufnahmeweg ist strukturell getrennt

Blöcke aus dem Aufnahme-Worklet bekommen nur Aufnahme und Intonation
(`mayUseCapturePath` in `micAccess.js`). Eine andere Nutzung des Mikrofons
bekäme die Quelle, aber keine Blöcke – sie kann also nichts speichern, auch
nicht durch einen Fehler im Aufrufer.

### S8: 404 vor 403

Wer eine Datei nicht sieht, bekommt auf jedem Endpunkt 404, auch beim Lesen;
fremde Aufnahmen antworten ebenfalls 404. Die eine Ausnahme ist eine Aufnahme,
die eine Leitung für Stimmen freigegeben hat: Sie ist nicht mehr fremd, sondern
für alle mit Dateizugriff abrufbar
([E21](#e21-aufnahmen-der-leitung-für-stimmen)) – fremd bleibt sie fürs
Freigeben und Löschen, beides antwortet weiter 404. Erst wer sie sieht, aber
nicht darf, bekommt 403. Sonst ließe sich abtasten, welche fileIds es gibt
([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)).

### S9: Was Programme startet oder Adressen abruft, stellt nur ein voller Admin ein

Nextcloud kann Verwaltungsseiten an Gruppen delegieren
(`#[AuthorizedAdminSetting]`); anbieten lässt sich dafür nur eine Seite, die
`IDelegatedSettings` implementiert (`Settings\AdminSettings`). Über Nextclouds
allgemeinen App-Config-Setter gibt sie keinen Schlüssel frei
(`getAuthorizedAppConfig()` leer) – geschrieben wird nur über
`SettingsController`, der prüft. Vier Einstellungen reichen aber über die App
hinaus: `node_path` wird als Programm gestartet, `sidecar_url` und
`soundfont_fetch_url` ruft der Server selbst ab, und `sidecar_secret` öffnet
den Konvertierungsdienst. Aus „darf ScoreView einstellen“ würde damit
Codeausführung bzw. ein Abruf beliebiger Adressen im internen Netz. Ändern
darf diese Felder deshalb nur, wer in der Gruppe `admin` ist
(`SettingsController::update`, 403); unverändert mitgeschickt stören sie
nicht, damit delegierte Admins den Rest der Seite weiter speichern können.
Geänderte Werte werden außerdem geprüft: `node_path` leer oder absolut mit
dem Programmnamen `node`/`nodejs`/`deno`
([E18](#e18-deno-als-zweite-laufzeit-bun-nicht)), die Adressen nur `http(s)`
mit Host.

### S10: Vorgemerktes gehört einem Konto und verschwindet mit der Anmeldung

Vorgemerkte Partituren liegen im Cache Storage des Browsers
([E14](#e14-eine-offline-seite-mit-eigenem-service-worker)), und der hängt am
Origin, nicht am Konto. Deshalb:

- **Ein Konto je Offline-Cache.** Jeder Eintrag trägt die `uid`. Beim
  Vormerken und beim Öffnen der Offline-Seite mit Netz werden Einträge anderer
  Konten gelöscht, samt **aller** ihrer URLs – auch solcher, die ein eigener Eintrag
  mitbenutzt; der gilt danach als beschädigt und wird neu vorgemerkt. Meldet
  sich im selben Browser jemand anderes an, ohne dass vorher abgemeldet wurde
  (abgelaufene Sitzung), sieht er nichts davon. Auf der Offline-Seite löscht
  erst ein Abgleich mit dem Server (`/ocs/v2.php/cloud/user`): Die Seite kann
  aus dem Cache der Hülle kommen und trägt dann die `uid` dessen, der sie
  zuletzt geladen hat – ihr zu glauben, löschte das Vorgemerkte der Person,
  die den Browser gerade benutzt. Nennt der Server ein anderes Konto, lädt die
  Seite neu.
- **Wer nicht mehr angemeldet ist, verliert das Vorgemerkte.** Nextcloud
  schickt beim Abmelden `Clear-Site-Data` nur über HTTPS und nie an Chrome
  (`core/Controller/LoginController.php`); gemessen: In Chrome bleiben Cache
  und Worker nach dem Abmelden liegen. Die App holt das nach: Leitet der Server
  den Aufruf der Offline-Seite mit Netz um, prüft der Worker mit einem
  Folgeabruf, ob das Ziel wirklich der Login derselben Instanz ist; nur dann
  löscht er alle Caches der Offline-Seite und meldet sich selbst ab. Ein
  Captive Portal oder eine Zwischenseite (SSO, zweiter Faktor) leitet ebenfalls
  um und räumt nichts – sonst ginge das Vorgemerkte genau dann verloren, wenn
  das Netz fehlt. Bis zu einem solchen Aufruf ist das Vorgemerkte auf dem Gerät
  ohne Netz über die Offline-Seite lesbar – die Grenze steht in
  [Grenzwerte](limits.de.md#offline).
- **Nur Vorgemerktes kommt in den Datencache.** Was die Offline-Seite online
  abruft, geht ans Netz und wird nicht nebenbei gespeichert; nur „Offline
  vormerken“ schreibt Antworten der API in den Cache. Der Cache der Hülle nimmt
  nur Dateien unter `/apps`, `/custom_apps`, `/apps-extra`, `/core`, `/dist`
  und `/themes` – keine Avatare, Vorschauen oder API-Antworten.
- **Der Worker steuert nur die Offline-Seite.** `Service-Worker-Allowed` nennt
  genau ihre Adresse; Anfragen anderer Nextcloud-Seiten sieht er nicht, und
  der Worker von Files mit dem Scope `/` bleibt unberührt.
- **Schreibendes geht nie aus dem Cache.** Nur `GET` wird beantwortet; alles
  andere geht unverändert ans Netz, und die Oberfläche bietet es offline gar
  nicht an.

### S11: Der lokale Konverter sieht nur die Partitur und sein Ergebnis

Der lokale Weg ([E3](#e3-zwei-konvertierungswege-hinter-einer-api)) führt eine
Partitur aus Files durch rund 9 MB Wasm-Code und den Emscripten-Glue. Ein
Fehler darin soll nicht mehr erreichen als diese eine Konvertierung. Jeder
Lauf von `convert.mjs`, Konvertierung wie Selbsttest, bekommt deshalb nur:

- **Lesen:** das Konverterverzeichnis, die Eingabedatei (eine eigene
  Temp-Datei je Lauf) und, falls gesetzt, `cjk_font_dir`. Liegt ein Pfad
  hinter einem Symlink, wird zusätzlich sein Ziel freigegeben.
- **Schreiben:** das Ausgabeverzeichnis, beim Selbsttest nichts.
- **Nichts sonst**, soweit die Laufzeit es durchsetzen kann: kein Netz, keine
  Kindprozesse, keine Worker (Node), keine Umgebungsvariablen (Deno), keine
  Rückfrage.
- **Eine minimale Umgebung** (`PATH`, `LANG`, zwei Schalter für Deno) statt
  der von PHP-FPM. Node kann Umgebungsvariablen auch mit `--permission`
  nicht sperren; sie nicht weiterzugeben, wirkt für jede Laufzeit.

Wie weit das reicht, hängt an der Laufzeit (gemessen, Tabelle in den
[Grenzwerten](limits.de.md#abschottung-des-lokalen-konverters)):

| Stufe | Laufzeit | gesperrt |
|---|---|---|
| vollständig | Deno ≥ 2, Node ≥ 25 | Dateisystem, Prozesse, Netz |
| teilweise | Node 20.7–24 | Dateisystem, Prozesse – das Netz bleibt offen |
| keine | Node < 20.7 | nichts |

Unter Node 20.0–20.6 zählt von mehreren `--allow-fs-read` nur das letzte, und
Komma-Listen sind ab Node 22 Teil des Pfads – darum beginnt die Abschottung
erst mit 20.7.

Was nicht aufgeweicht werden darf:

- **Kein Schalter.** Die Abschottung gilt immer in dem Umfang, den die
  Laufzeit hergibt. Eine Laufzeit ohne Abschottung konvertiert weiter, aber
  die Betriebsdiagnose sagt es (Zeile „Isolation“) – sie läuft nie still ohne
  Schutz, wo Schutz möglich wäre.
- **Nicht großzügiger freigeben, um einen Lauf zu retten.** Deno trennt jede
  Freigabe an Kommas und kennt kein Escape. Ein Pfad mit Komma wird deshalb
  abgelehnt (`local_unavailable`, der Pfad steht in der Meldung), statt das
  Elternverzeichnis freizugeben oder ohne Flags zu starten.
- **Geprüft wird durch Versuch.** `tests/Sandbox/` startet mit genau den
  Bausteinen der App (`ConverterRuntime::command()`, die Umgebung von
  `LocalConverter`) ein Skript, das alles Verbotene versucht, und erwartet je
  Stufe die Sperren. CI führt das für jede Laufzeit aus.
- **Die Stufe entscheidet nicht über die Verfügbarkeit.** `describe()` meldet
  sie, `ClientFallback` liest weiter nur `available` – der Rückfall in den
  Browser ([E7](#e7-konvertierung-im-browser-als-rückfall)) bleibt davon
  unberührt.

Der Lebendtest `<laufzeit> --version` läuft ohne Abschottung: Er führt kein
Skript aus, und welche Flags gelten, ergibt sich erst aus seiner Antwort.

## Entwurfsentscheidungen

Diese Entscheidungen tragen den Aufbau. Sie sind im Code an vielen Stellen als
`E1`…`E24` referenziert und sollten nicht ohne erneute Bewertung revidiert
werden.

### E1: MIDI statt MP3 als Audioartefakt

Die Konvertierung liefert MIDI, auf beiden Wegen, die Synthese passiert im Browser (SoundFont + Web
Audio). Ein vorgerenderter Stereo-Mixdown kann drei Ziele prinzipiell nicht
erfüllen: Lautstärke einzelner Stimmen (unmöglich), Instrumentenwechsel
(kombinatorisch nicht vorrenderbar), Tempoänderung (nur mit Time-Stretching und
Qualitätsverlust). Mit clientseitiger Synthese werden alle drei zu Parametern
statt zu Pipelinestufen.

Der Preis: Ein SoundFont (~24–40 MB SF3, je nach Quelle) muss ausgeliefert werden, und die
Klangqualität liegt unter MuseScores eigenem Render – gemessen rund 7 dB
leiser, siehe [Grenzwerte](limits.de.md). Dafür ist das Audioartefakt pro Partitur
um etwa den Faktor 400 kleiner (8 KB MIDI statt 3109 KB MP3), und der langsamste
Schritt der Konvertierung entfällt.

### E2: MuseScore-SVG statt Neusatz im Browser

Die Notendarstellung ist das von MuseScore selbst gerenderte SVG, kein
Neusatz aus MusicXML. Layouttreue ist für Chor- und Probenarbeit kein
Kosmetikthema – Sängerinnen und Sänger orientieren sich am Seitenbild, und ein
Neusatz weicht bei mehrstrophigen Sätzen, Divisi und Klavierauszügen sichtbar ab.

Konsequenzen: Zoom ist gratis (Vektor), A4 ist das native Seitenformat, und es
gibt **keinen Reflow** – „bildschirmfüllend" ist eine Skalierung, kein Umbruch.
Der Cursor ist ein Overlay über bekannten Koordinaten
([M4](#m4-koordinaten-passen-mit-faktor-12-auf-das-svg)) statt eines
Renderer-internen Zustands, und Wiederholungen lösen sich strukturell auf
([M7](#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht)).

Die beiden Darstellungen für das Handy halten sich daran: Das Systemband
schneidet Systeme aus dem Seitenbild aus, statt sie neu zu setzen, und die
Liedtext-Ansicht zeigt Text, keine Noten
([Üben und Lesen auf dem Handy](#üben-und-lesen-auf-dem-handy)).

Ausgeschlossen ist der Neusatz im **Browser**, nicht ein zweiter Satz durch
**MuseScore selbst**: Stimmenauszüge, Seiten in Handygröße, klingende und
transponierte Notation setzt die Engine mit anderen Vorgaben neu
([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)). Auch das
ist kein Reflow – eine Handyseite ist ein fester Satz auf kleinerem Papier,
der sich danach genauso nur skalieren lässt.

### E3: Zwei Konvertierungswege hinter einer API

Die Konvertierung läuft wahlweise über den **Sidecar-Container** oder **lokal
auf dem Server**. Beide erzeugen dieselben Artefakte im selben Cache und stehen
hinter derselben HTTP-API; nichts im Viewer verzweigt danach, welcher gelaufen
ist. Die Wahl ist eine einzelne Admin-Einstellung (`conversion_backend`,
Voreinstellung `local`) und wird an genau einer Stelle im Code ausgewertet
(`ConvertScoreJob`).

Der Sidecar hat seinerseits **zwei Renderer**: die Engine des lokalen Wegs oder
MuseScore selbst (`sidecar_renderer`, Voreinstellung `engine`, siehe
[Zwei Renderer im Sidecar](#zwei-renderer-im-sidecar)). Auch das ist keine
dritte Wahl neben den beiden Wegen, sondern eine Eigenschaft des Sidecar-Wegs;
die App nennt den Renderer bei jedem Auftrag.

Welcher Weg gelaufen ist, wird beim Ablegen der Artefakte **aufgezeichnet**
(Spalte `backend`) und im Viewer angezeigt. Das ist kein Aufweichen der
Trennung, sondern ihr Preis: Weil man dem Ergebnis nicht ansieht, woher es
kommt, und weil eine gecachte Partitur nach einem Wechsel weiterhin vom alten
Weg stammt, wäre die Frage „womit ist das gesetzt worden?" sonst gar nicht mehr
zu beantworten.

| | Lokal (Voreinstellung) | Sidecar |
|---|---|---|
| MuseScore | MuseScore 4.7.6 als WebAssembly, Qt-frei ([AndiMb/scoreview-engine](https://github.com/AndiMb/scoreview-engine)) | wählbar: dieselbe Engine (Voreinstellung) oder echtes MuseScore 4 aus gepinntem AppImage |
| Läuft als | abgeschotteter Kindprozess der Node- oder Deno-Laufzeit des Servers ([S11](#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis)) | eigener Container, HTTP-API; die Engine darin als abgeschotteter Kindprozess von Node 22 |
| Voraussetzung beim Betreiber | Node.js ≥ 18 oder Deno ≥ 2, `proc_open` erlaubt | Docker o. ä. |
| Im App-Paket | rund 14 MB Wasm + Ressourcen (`converter/`) | nichts |
| SoundFont | holt der Server von einer voreingestellten Adresse | bringt das Image mit |
| Vorab-Konvertierung, Selbsttest | ja | ja |

**Warum es den Sidecar weiterhin gibt.** Er konvertiert dort, wo der
Nextcloud-Server selbst keine JavaScript-Laufzeit hat oder keine Prozesse
starten darf – etwa im offiziellen Nextcloud-Image –, aber ein Container
daneben laufen kann. Die Konvertierung liegt dann in einem eigenen Container
mit Speicher- und PID-Grenze statt im Webserver-Prozess, und das Image kennt
keine Größengrenze: Es bringt die CJK-Schriften mit, die das App-Paket
weglässt. Und er kann auf Wunsch echtes MuseScore 4 fahren (siehe unten).

**Warum es den lokalen Weg gibt.** Der Sidecar setzt voraus, dass der Betreiber
einen zweiten Container betreiben kann. Das schließt Instanzen ohne Docker aus –
allein mit dem Sidecar liefe ScoreView auf verwalteten Instanzen gar nicht.

**Warum er die Voreinstellung ist.** Er ist der einzige, der nach `app:enable`
schon fertig ist: Was er braucht, liegt im App-Paket, die Node-Laufzeit findet
er selbst, und das SoundFont holt der Server von einer voreingestellten Adresse
(`SoundFontService::DEFAULT_FETCH_URL`). Der Sidecar braucht dagegen einen
zweiten Container *und* eine eingetragene URL – als Voreinstellung hieße er
„nach der Installation passiert erst einmal gar nichts", ohne dass der
Oberfläche anzusehen wäre, warum. Dass ein Update trotzdem keine laufende
Installation umstellt, sorgt eine einmalige Migration: Wo eine `sidecar_url`
eingetragen ist, wird der bis dahin nur implizite Wert ausdrücklich
festgeschrieben.

#### Was der lokale Weg leistet

Gemessen an denselben drei Partituren wie in
[Grenzwerte](limits.de.md#gemessene-werte), auf derselben Maschine:

| Partitur | Sidecar | Lokal |
|---|---|---|
| Minipartitur, 1 Seite | 8,1 s | **0,8 s** |
| Chorsatz, 4 Seiten | 25,6 s | **1,2 s** |
| Chorsatz, 5 Seiten | 31,9 s | **1,2 s** |

Gemessen als Wanduhrzeit, wie die App sie sieht: beim Sidecar einschließlich
HTTP und Statusabfrage, lokal einschließlich Prozessstart.

Der Abstand kommt nicht von schnellerem Code, sondern von weniger Arbeit: Der
Sidecar startet je Konvertierung einen MuseScore-Prozess unter Xvfb und rendert
PNG, PDF und MusicXML mit, die anschließend verworfen werden
([M2](#m2-schlüssel-im---score-media-json)). Von den lokalen Zeiten sind rund
0,45 s Grundlast – Node-Start plus Instanziierung des Wasm-Moduls (0,3 s
gemessen); die eigentliche Konvertierung dauert 0,4–0,8 s.

**Die Artefakte sind gleichwertig.** Gegen den laufenden Sidecar Datei für
Datei verglichen: MIDI **byteweise identisch**, gleiche Zahl an spos-Events mit
identischer elid-Folge und identischen Zeiten (24/315/357), gleiche
Seitenzuordnung, größte Koordinatenabweichung 1,5 SVG-Einheiten auf einer 13200
Einheiten hohen Seite. Die SVG-Seiten zeigen dasselbe Bild, kodieren es aber
anders: Die Engine legt jede Glyphe einmal in `<defs>` und setzt sie mit
`<use>`, MuseScore zeichnet jeden Umriss erneut – rund die halbe Dateigröße bei
gleichem Seitenbild, pixelweise geprüft (`tools/svg-spotcheck.py` der Engine).
Weil die Engine diese Kennungen auf jeder Seite wieder bei `g0` beginnt, ein
`<use>` aber im ganzen Dokument aufgelöst wird und der Viewer mehrere Seiten
gleichzeitig geladen hält, stellt der Sanitizer beim Einbetten jeder Kennung
die Seitennummer voran (`svgSanitizer.js`).
Auch die Formatgrundlagen halten: Element 0 der fünfseitigen Partitur liegt bei
`y=2148` ([M4](#m4-koordinaten-passen-mit-faktor-12-auf-das-svg)), `repeat-test`
zeigt vier doppelte `elid`
([M7](#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht)), der weiße
Hintergrundpfad ist vorhanden (M9), `metadata.tracks` führt die Stimmen samt
Metronomspur (M6). In `meta.json` ist `parts[].instrumentName` lokal *gefüllt*
und beim Sidecar `null` – ein Unterschied, den der Viewer nicht liest.

Der Vergleich in diesem Abschnitt gilt dem Sidecar mit **MuseScore als
Renderer**; mit der Engine liefert er Byte für Byte, was der lokale Weg
liefert.

**Ein Unterschied bleibt (M10):** Mit der Engine tragen die SVG-Elemente
ihre Segment-, Notenzeilen- und Stimmenkennung, mit MuseScore selbst nicht – die
schreibt der SVG-Writer der Engine, und MuseScore selbst kennt sie nicht. Der
Viewer erkennt das Fehlen beim Aufbau seines Index und bleibt dann beim
Cursor-Band; es gibt keinen Schalter und keine Einstellung dafür. Wer die
Hervorhebung im Container will, lässt den Sidecar mit der Engine konvertieren.

**Und einer in `meta.json`:** Tonarten mit Dur/Moll und Studierbuchstaben
(`keySigs`, `rehearsalMarks`), Liedtextsilben und die Schreibweise je Notenkopf
(`lyricSyllables`, `noteSpellings`) schreibt ebenfalls nur die Engine. Auch hier
entscheidet der Viewer am Inhalt, nicht am Weg: Fehlen die Felder, kommen
Buchstaben und Tonarten aus dem MIDI, das auf beiden Wegen byteweise gleich
ist – nur ohne Dur/Moll
([E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)). Für Liedtext und
Schreibweisen gibt es keinen solchen Rückfall; Liedtext-Ansicht und Tonnamen
fehlen dann, und der Viewer sagt warum
([E15](#e15-fähigkeiten-statt-weg)).

**Und einer bei den eingebetteten Bildern:** Beide Wege setzen sie, aber der
lokale reicht die Originalbytes als Daten-URI durch, statt sie zu rastern –
die Qt-freie Engine dekodiert kein einziges Pixel. Damit hängt an ihr, was
ein Browser selbst anzeigt; die beiden Formate, die dabei ausfallen, stehen
in [Grenzwerte](limits.de.md#bekannte-lücken).

Dass die Ergebnisse im Übrigen zusammenpassen, liegt am gemeinsamen Kern: Es
ist derselbe MuseScore 4.7.6, einmal als AppImage und einmal Qt-frei nach
WebAssembly übersetzt (MuseScore als ungepatchtes Submodul). `savePositions`
liefert die Koordinaten dort bereits in SVG-Einheiten, die Division durch 12
entfällt (`converter/lib/artifacts.mjs`).

Dieses „derselbe" ist eine Zusage, keine Beobachtung: Die eine Version steht als
Release-URL in `converter/package.json`, die andere als `ARG MUSESCORE_VERSION`
in `sidecar/Dockerfile`, und von sich aus hält nichts sie zusammen. Laufen sie
auseinander, legt dieselbe Partitur je nach Weg ein anderes Layout hin, ohne
dass ein Test anschlägt. Der Job `versionen` in `ci.yml` vergleicht beide
Angaben deshalb bei jedem Lauf, und `engine-release.yml` hebt sie nur gemeinsam:
Der Wächter sieht täglich nach, ob
[scoreview-engine](https://github.com/AndiMb/scoreview-engine) ein neues Release
hat, und macht daraus einen Pull Request, der den Engine-Pin und – falls das
Release eine neue MuseScore-Version mitbringt – die drei Dockerfile-ARGs
(Version, Build, SHA-256 des AppImage) in einem Zug hebt. Dependabot kann das nicht übernehmen, weil eine Release-URL
keiner Registry gehört (siehe `.github/dependabot.yml`). Auf der anderen Seite
hängt daran eine zweite Automatik: Im Engine-Repo bereitet
`musescore-release.yml` den MuseScore-Sprung als Entwurf vor, sobald upstream
veröffentlicht.

#### Was der lokale Weg kostet

- **Eine JavaScript-Laufzeit auf dem Server**, Node oder Deno
  ([E18](#e18-deno-als-zweite-laufzeit-bun-nicht)). Das offizielle
  Nextcloud-Docker-Image bringt keine mit; auf verwaltetem Hosting ist sie
  meist nicht nachrüstbar.
- **Rund 14 MB mehr im App-Paket** (9,3 MB Wasm-Code, 4,8 MB vorgeladene
  Ressourcen: Notenschrift, Textschriften, SMuFL-Metadaten als woff2). Das Paket
  muss sie fertig installiert enthalten – eine Instanz ohne Container hat kein
  npm, mit dem sie das nachholen könnte (siehe `release.yml`). Die CJK-Fonts
  bleiben deshalb draußen, siehe [Grenzwerte](limits.de.md#bekannte-lücken).
- **`proc_open`.** Auf geteiltem Hosting oft per `disable_functions` gesperrt.
  Die Betriebsdiagnose beantwortet das getrennt, weil es von außen wie ein
  Konvertierungsfehler aussieht.
- **Ein SoundFont muss von irgendwo kommen.** Ohne Sidecar gibt es kein Image,
  aus dem sich eines nehmen ließe; die Einstellung `soundfont_fetch_url` lässt
  den Server einmalig eines holen und danach selbst ausliefern (`SoundFontService`).
- **Ein Prozess je Partitur.** Die Wasm-Instanz über mehrere Konvertierungen zu
  halten hieße, einen langlebigen Dienst zu betreiben – genau das ist der
  Sidecar, und PHP hat dafür keinen Ort. Der Prozessabbau räumt die rund 105 MB
  der Instanz vollständig ab und braucht keinen Zustand; bezahlt wird das mit
  rund 1 s Anlauf je Partitur.
- **Die Engine will gepflegt werden.** Die MuseScore-Version zieht nicht
  von selbst nach: ein neuer Kern heißt bauen, Release setzen, Tarball-URL in
  `converter/package.json` hochziehen. Der Aufwand dafür ist überschaubar –
  die [scoreview-engine](https://github.com/AndiMb/scoreview-engine) führt
  MuseScore als ungepatchtes Submodul, hat kein Qt in der Toolchain, und ein
  Korpus-Gate über 569 Partituren prüft jeden Sprung gegen die vorige Ausgabe.
  Der Selbsttest der Betriebsdiagnose prüft für beide Wege dieselben Zusagen
  aus M2/M4/M7.

Zwei Vorkehrungen trifft der Konverter selbst: Er legt unter Node 18/20 ein
`navigator`-Objekt an, damit die Umgebung über alle Node-Versionen dieselbe
ist (die Engine selbst liest es nicht). Und
stdout wird nach stderr umgeleitet (dasselbe Bild wie
[M3](#m3-stdout-ist-nicht-sauber)), damit Engine- oder Emscripten-Meldungen
nie das JSON-Ergebnis verschmutzen.

#### Was auch der lokale Weg nicht löst: echtes SaaS

Auf verwalteten Instanzen, die weder eine Node-Laufzeit noch das Starten von
Prozessen erlauben, ist **serverseitiges Rendern nicht möglich** – auch nicht in
PHP selbst. Das Wasm-Modul ist ein Emscripten-Build: rund 9 MB Code, der
seine Importe aus der JavaScript-Laufzeit von Emscripten bezieht und keinen
einzigen WASI-Import trägt. Eine PHP-Wasm-Erweiterung (wasmer, wasmtime, extism) müsste
diese Laufzeit vollständig nachbauen – und wäre ihrerseits eine
PECL/FFI-Erweiterung, die auf verwaltetem Hosting nicht installierbar ist. Ein
WASI-Build wäre ein eigenes Portierungsvorhaben: Die Engine liest ihre
Schriften und Metadaten aus Emscriptens virtuellem Dateisystem, in das sie als
vorgeladenes Paket eingebettet sind – nicht über WASI-Systemaufrufe.

Für diesen Fall konvertiert der Browser
([E7](#e7-konvertierung-im-browser-als-rückfall)) – und zwar **ohne** die
Artefakte zum Server hochzuladen. Genau daran hing die Frage: Ein Upload wäre
keine Umverdrahtung, sondern eine neue Vertrauensgrenze, denn der Server
lieferte dann an alle Leser einer Datei aus, was ein einzelner Browser erzeugt
hat. Statt diese Grenze einzuziehen, entfällt auf diesem Weg der Cache.

#### Zwei Renderer im Sidecar

Das Image trägt beide: das AppImage wie bisher und daneben Node 22 mit
`scoreview/converter` – nicht einer Kopie, sondern genau dem Verzeichnis des
App-Pakets, per `npm ci` gegen dessen Lockfile installiert. Deshalb wird es aus
der Wurzel des Repositorys gebaut. Mit der Engine liefert der Sidecar, was der
lokale Weg liefert, bis hin zu den Kennungen (M10), den Listen in `meta.json`
und den Darstellungsvarianten
([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)).

**Warum die Engine die Voreinstellung ist.** Nur mit ihr geht alles, was die
App kann; MuseScore selbst bringt dagegen zwei Dinge, die die Qt-freie Engine
nicht hat – die Originalnotenschrift alter Partituren und gerasterte
SVG-Bilder ([Grenzwerte](limits.de.md#bekannte-lücken)). Wem die wichtiger
sind, stellt um; es ist eine Abwägung je Instanz, nicht je Partitur.

**Warum die App den Renderer nennt und nicht der Sidecar.** Die App muss
wissen, ob es Varianten gibt (`ConversionBackend::supportsVariants()`), und
zwar bei jeder Statusabfrage, ohne den Sidecar zu fragen. Eine Einstellung im
Container müsste sie erst erfragen und zwischenspeichern – eine zweite Wahrheit,
die auseinanderlaufen kann. Der Sidecar hat für Anfragen ohne Angabe nur eine
Voreinstellung (`SCOREVIEW_SIDECAR_RENDERER`); der Status eines Auftrags nennt,
was tatsächlich lief.

**Ein Image von vor der Wahl** übergeht das Feld und konvertiert mit
MuseScore. Damit ein Update daran nichts kaputt macht, schreibt
`Version000100Date20261025200000` für jede Instanz mit eingetragener
`sidecar_url` `musescore` fest – dieselbe Regel wie beim Wechsel der
Voreinstellung auf den lokalen Weg. Wer danach auf die Engine stellt, ohne neu
zu bauen, erfährt es an zwei Stellen: Der Selbsttest vergleicht den
gemeldeten Renderer mit dem gewählten, und eine Variante scheitert mit
`variant_unsupported`, weil `POST /variant` fehlt (404).

**Varianten über den Sidecar** setzt die App wie lokal in der Anfrage
des Browsers: `ConvertScoreJob::convertVariant()` schickt Partitur und die
Grundartefakte `timing.json`/`measures.json` an `POST /variant`, der Sidecar
antwortet nach dem Lauf, und die Artefakte kommen über dieselbe Route wie bei
der Grundkonvertierung. Gemessen 3,9 s je Variante – so viel wie lokal. Ein
belegter Sidecar (`sidecar_busy`) oder ein nicht erreichbarer gelten bei
Varianten als vorübergehend: Die Zeile darf nach einer Minute neu laufen statt
nach einer Stunde (`VariantService::RETRY_TRANSIENT_AFTER_SECONDS`).

**Abschottung.** Die Engine läuft im Container wie auf dem lokalen Weg mit
`--permission` und denselben Freigaben
([S11](#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis)),
dazu mit beschnittener Umgebung: Das Berechtigungsmodell sperrt
Umgebungsvariablen nicht, und die des Containers tragen das Secret.

#### Welchen Weg wählen

Wo der Nextcloud-Server eine JavaScript-Laufzeit hat und Prozesse starten
darf, der lokale Weg – es gibt nichts einzurichten. Wo nicht, aber Container
laufen, der Sidecar mit der Engine. MuseScore selbst, wo alte Partituren mit
ihrer Originalschrift oder SVG-Bilder wichtiger sind als Notenkopffärbung,
Liedtext-Ansicht und Varianten. Umstellen heißt: die Einstellung ändern;
bereits konvertierte Partituren bleiben im Cache gültig. Was ein Wechsel von
MuseScore auf die Engine an Kennungen und Listen bringt, bekommt eine
Partitur erst mit ihrer nächsten Konvertierung – „Neu konvertieren“ im Viewer
oder eine neue Fassung der Datei.

Wege, den Sidecar bereitzustellen, stehen in
[`../sidecar/README.md`](../sidecar/README.md#bereitstellung); die Einrichtung
des lokalen Wegs in [Installation](installation.de.md).

### E4: Englische Quellstrings, Deutsch als gepflegte Übersetzung

Die UI-Strings im Quelltext sind **Englisch**. Übersetzungen liegen als
gettext-PO unter `translationfiles/<sprache>/scoreview.po`, die Vorlage mit allen
Quellstrings unter `translationfiles/templates/scoreview.pot`. Deutsch pflegt
der Maintainer selbst und hält es vollständig. Jede weitere Sprache kommt aus
der Community per Pull Request und darf Lücken haben: Was fehlt, erscheint
englisch.

„Deutsch (Sie)“ (`de_DE`) bekommt keine eigene Übersetzung, sondern beim Build
eine Kopie von `de`. Nextcloud führt die Sie-Fassung als eigene Sprache und fällt
von ihr nicht auf `de` zurück; ohne Kopie sähe, wer sie gewählt hat, Englisch.
Eine zweite, vollständig gepflegte deutsche Fassung kostete bei jedem neuen
String doppelte Arbeit, und Du statt Sie ist für diese Nutzer die kleinere
Abweichung als Englisch. Eine `translationfiles/de_DE/` lehnt `l10n:check` ab.

Was Nextcloud liest – `l10n/<sprache>.js` für den Browser, `l10n/<sprache>.json`
für PHP –, ist **Build-Artefakt** (`npm run build`, gitignored wie `js/`). Der
Grund ist der Beitragsweg: Eine Übersetzung kommt als Pull Request aus dem
GitHub-Webeditor, und ein solcher PR kann nichts erzeugen. Wären die
Laufzeitdateien committet, fiele jeder Übersetzungs-PR in CI als „veraltet“
durch, und einen Bot, der nachcommittet, gibt es bewusst nicht. Eine PO-Datei je
Sprache heißt außerdem, dass Übersetzende nie wissen müssen, welcher String zu
PHP und welcher zum Browser gehört. Die Aufteilung folgt den Fundstellen in der
Vorlage (`src/` → `.js`, `lib/`/`templates/` → `.json`). Das Layout entspricht
dem von Nextclouds `translationtool`; ein späterer Wechsel zu Transifex bliebe
damit offen.

Grund: Nextclouds l10n-Format benutzt den Quellstring selbst als
Übersetzungsschlüssel. Deutsche Schlüssel hätten drei Folgen – jede weitere
Sprache würde aus dem Deutschen übersetzt, die Rückfallsprache bei fehlender
Übersetzungsdatei wäre Deutsch, und die App antwortete jedem nicht
deutschsprachigen Nutzer in einer Sprache, die er nicht gewählt hat.

**Fehlende Übersetzungen fallen still aus** – Nextclouds `JSResourceLocator`
ignoriert fehlende l10n-Dateien bewusst. Deshalb prüft `npm test` die
Vollständigkeit von Deutsch; Disziplin allein trägt das nicht. In jeder
Sprache, auch einer lückenhaften, sind dagegen verwaiste Einträge und
abweichende Platzhalter ein Fehler. Ein vertipptes `{nmae}` stünde sonst
wörtlich in der Oberfläche. Gemessen in der Testinstanz: Ein in `fr` fehlender
String erscheint englisch, nicht deutsch. Siehe
[Entwicklung](development.md#übersetzungen).

Dokumentation: Die Nutzerseite (README, Installation, Fehlerbilder, Grenzen) ist
englisch geführt, mit einer gepflegten deutschen Fassung `*.de.md` daneben. Die
Entwicklerdoku, darunter diese Datei, bleibt deutsch. Neue Kommentare und
Commit-Messages sind englisch.

Nicht übersetzt wird Inhalt aus der Partitur selbst: Stimmennamen, Titel,
Komponist, GM-Instrumentennamen. Das ist Material, keine Oberfläche.

### E5: `@nextcloud/vue` als UI-Basis

Die Bedienelemente kommen aus `@nextcloud/vue` statt aus handgeschriebenem HTML.
Tastaturbedienung, Fokusführung, Touch-Zielgrößen, Theming und Dark Mode einzeln
nachzubauen kostet mehr als die Bibliothek – und die App soll aussehen wie der
Rest von Nextcloud.

Der Preis ist Bundle-Größe (Gegenmaßnahmen: gezielte Einzelimporte statt
Sammelimport; der Player mit spessasynth und die Panels, die nur online
angeboten werden, liegen in eigenen, nachgeladenen Teilen – der Player startet
parallel zur ersten Seite. Was die Offline-Seite braucht, bleibt im Bundle
oder wird dort vorab geladen, weil ihr Service Worker nur zwischenspeichert,
was die Seite schon geladen hat) und eine stärkere Bindung an die Nextcloud-Version: `info.xml`
deklariert 31–35, die Bibliotheksversion muss dazu passen. Für Regler
(Lautstärke, Tempo, Zoom) gibt es keine Entsprechung; dort steht
`<input type="range">` mit Nextcloud-CSS-Variablen.

### E6: Drei Einstiege in Files – Mimetype, Dateiendung, Setliste

Der reguläre Einstieg ist Nextclouds Viewer, und der wählt am **Mimetype**:
`application/x-musescore`. Die *Zuordnung* `.mscz` → Mimetype liest Nextcloud
ausschließlich aus `config/mimetypemapping.json`, nie aus einer App. Auf
verwaltetem Hosting ist diese Datei unerreichbar, und `occ` gibt es dort
ebenfalls nicht.

**Die App trägt den Mimetype deshalb selbst in die Instanz ein**
(`Service\MimetypeRegistration`): `IMimeTypeLoader::getId()` legt ihn an,
`IMimeTypeLoader::updateFilecache()` setzt ihn auf jede Filecache-Zeile, deren
Name auf `.mscz` endet – ein einziges UPDATE über alle Speicher hinweg,
Gruppenordner und Freigaben eingeschlossen. Das ist genau das, was
`occ maintenance:mimetype:update-db` tut, nur über öffentliche Schnittstellen
und ohne Shell. Ausgelöst wird es an zwei Stellen:

| Auslöser | Was er abdeckt |
|---|---|
| `Migration\RegisterScoreMimetype` (Repair-Step bei Installation **und** Update) | den Bestand |
| `Listener\ScoreMimetypeListener` → `BackgroundJob\RegisterMimetypeJob` | jeden neuen Upload |

Der zweite ist nötig, weil Nextclouds **Erkennung** unberührt bleibt:
`IMimeTypeDetector` bietet einer App nur Lesezugriff, eine frisch hochgeladene
Partitur trägt also zuerst wieder `application/octet-stream`. Der Job hängt
ohne Argument in der Warteschlange und fällt damit für beliebig viele Uploads
zu einem einzigen Lauf zusammen – der Tabellendurchlauf gehört nicht in den
Upload-Pfad.

Ohne Wirkung bleibt das beim **Dateisymbol**: Das hängt an
`mimetypealiases.json` und `occ maintenance:mimetype:update-js`, beides
außerhalb der Reichweite einer App. Wer es haben will, registriert zusätzlich
von Hand ([installation.de.md](installation.de.md)).

Trotzdem bleibt es nicht beim Viewer allein: `src/viewer.js` registriert
zusätzlich eine **Dateiaktion auf der Endung**, die dieselbe Komponente in
einem `NcModal` zeigt. Ihre Bedingung steht als reine Funktion in
`src/lib/scoreFile.js` und lautet: Endung `.mscz` **und** Mimetype nicht
`application/x-musescore`. Sie greift also genau dort, wo der Viewer nichts
tut – und das ist nach wie vor ein echtes Fenster: zwischen Upload und dem
nächsten Cron-Lauf, auf einer Instanz, deren Registrierung scheiterte, und bei
jedem Bestand, der noch nie ein Update der App gesehen hat. Wo der Mimetype
stimmt, ist die Aktion abgeschaltet – kein zweiter Menüeintrag, keine zweite
Standardaktion.

Der Preis ist eine doppelte Registrierung: `@nextcloud/files` hat zwischen den
Nextcloud-Ständen sowohl den Ablageort der Aktionsliste als auch die
Rückrufsignatur gewechselt (bis v3 ein globales Array `_nc_fileactions` mit
`(nodes, view)`, ab v4 `_nc_files_scope.v4_0` mit einem Kontextobjekt). Gemessen:
Nextcloud 32 liefert `@nextcloud/files` v3 aus und liest ausschließlich das
Array (`dist/files-main.js`), Nextcloud 34 nur noch den neuen Ort. `viewer.js`
trägt sich deshalb in **beide** ein – bedingungslos und beide Male mit derselben Bedingung
aus `scoreFile.js`.

Bedingungslos, weil sich von der App aus nicht feststellen lässt, welchen Ort
der Server liest: `window._nc_files_scope.v4_0` entsteht bereits im Modulrumpf
von `@nextcloud/files` v4, also beim bloßen Import, ganz gleich ob die
Files-App des Servers das Objekt je ansieht. Eine Abfrage darauf ist immer
wahr. Zwei Einträge stören nicht, weil kein Stand beide Listen liest – der
jeweils andere bleibt unbeachtet, es gibt weiterhin genau einen Menüeintrag.

Der **dritte Einstieg** ist eine zweite Dateiaktion derselben Bauart, auf
Namen, die auf `.setlist.md` enden: „Als Setliste öffnen“ öffnet dieselbe
Komponente im selben `NcModal`, nur mit einer Setliste
([E11](#e11-die-setliste-als-markdown-datei)). Anders als die erste muss sie
einer Aktion **den Klick abnehmen**, die ebenfalls zuständig ist – Markdown
öffnet in Files sonst im Texteditor. Gemessen an
`apps/files/src/components/FileEntryMixin.ts` (Server 34): Files sortiert die
Aktionen nach `order` und nimmt beim Klick die erste mit gesetztem `default`.
Die Aktion trägt deshalb `default: DefaultType.DEFAULT` und `order: -10`; die
Viewer-Aktion hat `order: 0`, bei Gleichstand entschiede die Ladereihenfolge.
`HIDDEN` statt `DEFAULT` gewönne den Klick ebenso, stünde aber nicht im Menü.
Text bleibt über „Ansicht“ im Menü erreichbar, eine gewöhnliche `.md` öffnet
unverändert im Texteditor. Weil die Sortierung zur inneren Umsetzung von Files
gehört, ist das Verhalten eine Prüfung im Browser wert, sobald eine neue
Nextcloud-Version erscheint – kippt es, bleibt der Menüeintrag als Ausweg.

Die mobilen Apps kennen keine dieser Aktionen, und eine `*.setlist.md` hat dort
den Mimetype `text/markdown`, für den sie Text anbieten. ScoreView meldet sich
dafür bewusst **nicht** als Direct Editor an – es erschiene sonst bei jeder
Markdown-Datei. Mobil öffnet eine Setliste deshalb über eine ihrer Partituren
(siehe [E11](#e11-die-setliste-als-markdown-datei)).

**Eigene Seiten gibt es zwei, und keine ist ein Einstieg.**
`/apps/scoreview/offline` zeigt nur, was in Files vorgemerkt wurde
([E14](#e14-eine-offline-seite-mit-eigenem-service-worker));
`/apps/scoreview/print/{fileId}` wird aus dem Viewer heraus geöffnet und hat
keine Navigation ([E16](#e16-drucken-aus-den-seiten-svgs)).
`/apps/scoreview/` antwortet weiterhin 404.

### E7: Konvertierung im Browser als Rückfall

Wo der Server **nicht konvertieren kann** – keine Node-Laufzeit, `proc_open`
gesperrt, kein erreichbarer Sidecar –, konvertiert der Browser. Dieselbe Engine
(scoreview-engine, MuseScore 4.7.6 als WebAssembly), dieselben Artefakte, nur
ein anderer Ort.

Das ist **kein dritter Konvertierungsweg**: Er steht in keiner Einstellung zur
Wahl, und er greift nur, wenn der eingestellte Weg nicht laufen kann. Damit
bleibt [E3](#e3-zwei-konvertierungswege-hinter-einer-api) unberührt – die Wahl
ist weiterhin eine zwischen zwei Serverwegen.

**Warum es ihn gibt.** Ohne ihn ist ScoreView auf verwaltetem Hosting nicht
betreibbar: Dort gibt es weder Docker noch das Recht, Prozesse zu starten, und
[in PHP allein lässt sich das Wasm-Modul nicht ausführen](#was-auch-der-lokale-weg-nicht-löst-echtes-saas).

**Wann er greift.** Entschieden wird an genau einer Stelle
(`Service\ClientFallback`), so wie die Wahl zwischen Sidecar und lokalem Weg
allein in `ConvertScoreJob` fällt:

| Weg | Auslöser | Warum so |
|---|---|---|
| `local` | `LocalConverter::describe()` meldet „nicht verfügbar" | Fehlendes Node ist eine dauerhafte Eigenschaft der Instanz. Erst einen Job einzureihen, der sicher scheitert, hieße bis zu einen Cron-Takt warten, bevor überhaupt etwas passiert |
| `sidecar` | die Lebendprüfung schlägt fehl – oder ein Lauf ist mit `sidecar_unreachable` gescheitert | Ein konfigurierter Sidecar *soll* laufen; sein Ausfall ist ein Betriebsproblem. Beide Auslöser zusammen fangen sowohl den Dauerzustand als auch den Ausfall zwischen zwei Prüfungen |

Das Urteil ist gespeichert (im verteilten Cache, sonst in der AppConfig – dort
hieße jedes Schreiben, den AppConfig-Cache der ganzen Instanz zu verwerfen) und gilt fünf Minuten – die ehrliche Antwort kostet
einen Prozessstart oder eine HTTP-Anfrage, und der Viewer fragt den Status
anfangs alle 2 s (später seltener, `conversionPoll.js`). Ein Selbsttest und jedes Speichern der Admin-Einstellungen
verwerfen es sofort.

**Ein Inhaltsfehler löst ihn nicht aus.** Wenn die Partitur kaputt ist,
scheitert der Browser mit derselben Engine genauso – nur 14 MB später. Nur die
beiden Infrastrukturcodes (`local_unavailable`, `sidecar_unreachable`) greifen.

**Eine fertige Konvertierung schlägt den Rückfall.** Wer seine Node-Laufzeit
verliert, behält den Zugriff auf alles, was schon im Cache liegt; gerechnet
wird nur, wo es nichts gibt.

**Was er kostet.**

| | |
|---|---|
| Client-Last | rund 14 MB Engine je Browser, davon ~7,3 MB über die Leitung (das Wasm wird komprimiert übertragen, das Ressourcenpaket nicht). Einmal je Engine-Version, danach `immutable` im Browser-Cache |
| Cache | **keiner.** Jedes Gerät und jedes Öffnen rechnet neu; im Browser bleibt nur ein Sitzungscache mit einem Eintrag |
| Vorab-Konvertierung | entfällt – es gibt nichts vorzubereiten |
| `occ`-Selbsttest | prüft weiterhin nur die Serverwege |
| CSP | `blob:` in `worker-src` und `connect-src`, begrenzt auf `/apps/files` und nur solange der Rückfall greift (`Listener\AddCspListener`, die Direktiven selbst in `Service\ViewerPolicy` – dieselben für Offline- und Druckseite) |
| App-Paket | rund 40 KB. Wasm und Ressourcenpaket liegen ohnehin für den Node-Weg darin – ausgeliefert wird zusätzlich nur der Browser-Glue |

**Warum keine Zeile im Viewer.** Der Vertrag ist der Körper von `onReady()`,
nicht die HTTP-Antwort, aus der er stammt: Der Rückfall baut dasselbe
`files`-Objekt, nur mit Blob-URLs statt Serverrouten. `ScoreViewer.vue`,
`ScorePage.vue`, `usePlayback.js` und `useAnnotations.js` kennen den Rückfall
nicht; die Verzweigung sitzt an einer Stelle in `useConversionStatus.js`. Dass der Viewer
`renderer.backend === 'client'` **anzeigt**, ist wie bei den beiden anderen
Wegen eine Angabe für Menschen, kein `if`.

**Woher die Gleichheit der Artefakte kommt.** Nicht aus Sorgfalt, sondern aus
der Bauart: Es ist dieselbe Engine in derselben Aufrufreihenfolge, und die
Umformung in die Cache-Form macht `converter/lib/artifacts.mjs` – dasselbe
Modul, das auch der Node-Weg benutzt. Nachgemessen an `repeat-test.mscz`:
`timing.json`, `measures.json` und `meta.json` sind Byte für Byte identisch zu
`node convert.mjs`, die SVG-Seite ist gleich lang.

**Grenzen.** Eine eigene, kleinere Schranke `client_max_score_bytes` (Vorgabe
10 MB, `occ`) bricht **vor** dem Engine-Download ab – sonst lädt ein Tablet
14 MB, um dann aufzugeben. Zwei eigene Fehlercodes stehen daneben:
`client_too_large` und `client_engine_unavailable`. Der zweite hat einen
Grund, der von außen nicht zu erraten ist: Ein von der CSP blockierter
`new Worker(blob:…)` **wirft nicht**, es kommt nur eine
`securitypolicyviolation` – ohne eigene Zeitgrenze bliebe der Viewer für immer
auf „wird konvertiert" stehen.

**Was er nicht löst.** Öffentliche Freigaben: Die Routen hängen am
angemeldeten Nutzerkontext, und die CSP-Lockerung greift nur auf
`/apps/files`. Der Rückfall nimmt dafür die serverseitige Hürde weg, mehr
nicht.

### E8: Eine eigenständige Seite für die mobilen Apps

Die Nextcloud-Apps für Android und iOS laden **keine Skripte der Dateien-Seite**
und kennen Nextclouds Weboberfläche nicht. Weder der Viewer-Handler noch die
Dateiaktionen aus [E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste) erreichen sie:
Eine `.mscz` ließe sich dort nur herunterladen.

Der einzige Haken, den die Apps anbieten, ist **Direct Editing**. Meldet der
Server für den Mimetype einer Datei einen Editor, blenden sie den Menüpunkt
„Bearbeiten“ ein und öffnen dessen Seite in einer Vollbild-WebView.
`DirectEditing\ScoreDirectEditor` meldet genau einen Mimetype an –
`application/x-musescore`, keine optionalen – und liefert
`templates/standalone.php` mit `src/standalone.js` aus. Kein Creator: ScoreView
erzeugt keine Partituren, ein Eintrag „Neue Partitur“ führte nirgendwohin.

**Die Auswahl läuft allein über den Mimetype.** Die Krücke aus E6 hat in der
App keine Entsprechung – ohne registrierten Mimetype bleibt der Menüpunkt aus.
Dass er stimmt, besorgt die App selbst
([E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)); ohne das hinge
dieser Einstieg an einer Handreichung des Betreibers und wäre auf verwaltetem
Hosting überhaupt nicht erreichbar.

**Und er hängt am ⋮-Menü, nicht am Antippen.** Nachgesehen in
nextcloud/android, `FileOperationsHelper.openFile()`: Kann irgendeine
installierte App den Mimetype öffnen, bekommt sie die heruntergeladene Datei –
Direct Editing ist dort ausdrücklich nur der Rückfall („first always try to use
available apps"). Wer auf dem Telefon eine App installiert hat, die `.mscz`
beansprucht, landet beim Antippen also bei ihr und erreicht ScoreView über
⋮ → „Bearbeiten". Das entscheidet das Gerät; vom Server aus ist daran nichts zu
ändern.

Drei Dinge unterscheiden diese Seite vom Browser, und jedes hat eine Folge:

**Sie hat keine Sitzung.** `OC\DirectEditing\Manager` nimmt den Token-Scope
gleich nach `open()` wieder zurück; gemessen auf Nextcloud 31 und 34
antworten alle Folgeanfragen mit 401. Der Ausweis ist deshalb der Token selbst,
im Header `X-ScoreView-Token`. `Middleware\DirectAccessMiddleware` prüft ihn
und vergleicht **verpflichtend** die Datei: Ein Token für Partitur A darf kein
Schlüssel für Partitur B derselben Nutzerin sein. Routen ohne `fileId`
(SoundFont) liefern instanzweites Beiwerk, dort bleibt es bei der Gültigkeit.
`POST /api/preferences` nimmt den Token ebenfalls an, obwohl die Route nicht
dateibezogen ist: Die Kennung der Nutzerin kommt allein aus dem gesetzten
Nutzer, nie aus der Anfrage, ein Token erreicht also nur die Einstellungen
seiner eigenen Nutzerin. Darum gelten Hervorhebung, Notenfarbe und Stereobild
auch mobil, und dort Eingestelltes gilt am Rechner weiter. Ein Begleit-Token
(unten) nimmt die Route nicht an – es ist für weitere *Dateien* gedacht.

Für den Sitzungsfall holt die Middleware die CSRF-Prüfung nach, die
`#[PublicPage]`/`#[NoCSRFRequired]` sonst abschalteten – dort, wo die Route
sie als gewöhnliche Sitzungsroute hätte (abschaltbar über
`csrfInSession: false`, etwa für Artefakte und SoundFont). Was eine Anfrage vorgelegt hat, hält
`Middleware\DirectAccessContext` fest, ein je Anfrage geteilter Träger: Die
meisten Controller brauchen das nicht, weil der gesetzte Nutzer und ihr
Dateibaum entscheiden; das Schreiben einer Setliste braucht es (unten, und
[S2](#s2-schreiben-mit-token-nur-um-die-partitur-herum)).

**Weitere Dateien: Begleit-Token.** Ein Direct-Editing-Token gilt für genau
eine Datei; eine Setliste braucht mehrere. Dafür stellt
`Service\CompanionTokenService` eigene Token aus, und zwar nur so, dass eine
Berechtigung für eine Datei nie mehr werden kann als das, was die Nutzerin
ohnehin öffnen dürfte:

- **Ausgabe nur mit dem Direct-Editing-Token** und nur für eine Setliste, die
  im Ordner seiner Partitur liegt und diese Partitur enthält. Weder eine
  Sitzung noch ein Begleit-Token kann Token ausgeben – aus einem Begleiter
  heraus entstünde sonst eine Kette, an deren Ende jede Datei stünde.
- **Zweck im Token:** `score` gilt für die Partitur-Routen, `setlist` nur für
  Lesen und Schreiben der Setlisten-Datei. Ein Token für die Liste öffnet also
  nicht deren Partitur-Routen, und ein Partitur-Token schreibt keine Liste.
- **Schreiben mit Token nur um die Partitur herum.** Mit dem
  Direct-Editing-Token nimmt eine Setliste als neue Einträge nur Dateien aus
  dem Ordner der Partitur bis Tiefe 2 an, mit einem Begleit-Token gar keine –
  dort bleiben Umordnen und Entfernen; vorhandene Einträge bleiben Wort für
  Wort, wie sie waren. Neu angelegt wird nur im Ordner der Token-Datei
  (`folderParam` am Attribut).
  Sonst ließe sich über eine selbst angelegte Liste mit beliebigen Pfaden und
  die Ausgabe von Begleit-Token aus der Erlaubnis für eine Datei eine für alle
  machen. Beliebige Pfade gibt es nur in der Browser-Sitzung.
- **Aufbau:** `v1.<payload>.<mac>`, die Nutzlast `{uid, fid, purpose, exp, dt,
  ep}` als base64url-JSON, das MAC ein HMAC-SHA256 über ein Domänenpräfix und
  die Nutzlast. Selbsttragend statt als Datenbankzeile, weil jede Anfrage der
  Seite einen prüft und im Konzert viele Geräte gleichzeitig blättern.
  Längengrenze vor jedem Dekodieren, Vergleich in konstanter Zeit.
- **Widerruf, bei jeder Anfrage geprüft:** `exp` liegt hart 12 h nach der
  Ausgabe und wird nie verlängert. `dt` ist ein gekürzter SHA-256 des
  Direct-Editing-Tokens; die Seite schickt beide Header, und ohne ein lebendes
  Direct-Editing-Token taugt der Begleiter nichts. `ep` ist eine Epoche je
  Nutzerin, die bei Passwortwechsel und Deaktivieren steigt
  (`Listener\CompanionRevocationListener`); „alle Geräte abmelden“ hat kein
  Ereignis, das nicht auch jede gewöhnliche Abmeldung träfe. Dazu Konto
  aktiv, Datei neu aufgelöst. Das Geheimnis (32 Byte, `sensitive`) lässt sich
  mit `occ config:app:delete scoreview companion_secret` wechseln; das
  widerruft alle Token auf einmal.
- **Nie in URL, Log oder Speicher:** Token stehen nur im Header, werden nicht
  protokolliert und liegen im Browser nur im JS-Speicher, nicht in
  `localStorage`.

`standalone.js` hält dafür eine Tabelle Datei → Begleit-Token und setzt beim
Stückwechsel den passenden; welcher Ausweis zu welcher Anfrage gehört,
entscheidet `directToken.js` (`ausweisFuer`).

Einen zweiten Anlass zur Ausgabe gibt es: Zieht eine Leitung ihre Sitzung von
„Folgt mir“ zum nächsten Stück um
([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)),
braucht ein Folgegerät in der App ein Token für dieses Stück, auch ohne
Setliste. `GET …/follow/companion?target=` gibt es aus – wieder nur gegen das
Direct-Editing-Token der geöffneten Partitur, nur für eine Datei, die die
Person lesen darf, und nur, wenn die Sitzung der geöffneten Partitur dorthin
umgezogen ist (dieselbe Sitzungskennung, `FollowService::isMoveTarget`); eine
beliebige Datei mit laufender Sitzung reicht nicht. Ein abgegriffenes Token
der Seite öffnet so keine beliebigen Dateien.

**Push gibt es dort nicht.** `notify_push` meldet sich über eine Sitzung an,
die die Seite nicht hat. Folgegeräte in den Apps fragen deshalb immer ab
([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)); Leiten
geht mobil uneingeschränkt, das sind gewöhnliche Anfragen.

**Das Mikrofon** gibt die Seite in ihrer eigenen Antwort frei
(`ScoreDirectEditor::open()`, siehe [Mikrofon](#mikrofon)). Ob die WebView es
dann an die Seite weiterreicht, liegt an der App: Die Android-App tut es nicht
(Quellcode: kein `RECORD_AUDIO`, kein `onPermissionRequest`), dort führt „Im
Browser öffnen“ weiter. Für iOS spricht der Quellcode dafür, gemessen ist es
nicht.

Der Token hängt an **zwei** Wegen, weil der Viewer zwei benutzt: einem
axios-Interceptor und einem Mantel um `window.fetch` (das SoundFont holt
`usePlayback.js` bewusst mit `fetch`). Beide entscheiden mit derselben reinen
Prüfung in `src/lib/directToken.js`, und zwar an der **Herkunft der URL** –
ein extern konfiguriertes SoundFont bekommt den Token nie zu sehen, und
`blob:`-URLs bleiben außen vor.

Eine Ausnahme bleibt: `GET /api/engine/{version}/{name}` trägt **keinen** Token, sondern
`#[PublicPage]`. Der Grund ist technisch zwingend – die Engine wird mit
`import(engineUrl)` geladen, und ein nativer dynamischer Import kann keinen
Header tragen. Was dort herauskommt, sind appeigene Bauartefakte: für jede
Instanz dieselben Bytes, kein Nutzerinhalt, dieselbe Art Material, die
Nextcloud unter `/apps/<app>/js/` ohnehin ohne Anmeldung ausliefert. Der Preis
ist benannt: rund 14 MB sind ohne Konto abholbar.

**Sie hat keinen Wirt.** In den übrigen Einstiegen stellt der Wirt das
Schließkreuz – Nextclouds Viewer-App bzw. das `NcModal`. Hier setzt
`StandaloneFrame.vue` deshalb `closable`, und `ScoreViewer.vue` zeigt das ✕
selbst und meldet `close`. Was Schließen heißt (Brücke oder Historie),
entscheidet weiter der Rahmen. Das ✕ steht in der Leiste neben Vollbild, in
der kompakten Leiste also hinter „Mehr“. Ohne Leiste (Fehleranzeige) schwebt es
über der Meldung. Eine eigene Kopfzeile gibt es nicht: Sie und die Leiste
belegten am Telefon quer zusammen etwa ein Drittel der Höhe, während Nextcloud
Text auf derselben Seite direkt unter der Statusleiste beginnt. Unter Android
schließt die Zurück-Geste mit einem Tipp, deshalb sind die zwei Tipps
über „Mehr“ hingenommen. Den Aufführungsmodus sperrt das ✕ nicht, denn er
sperrt die Arbeit an der Partitur, nicht das Verlassen. Den Dateinamen
behält nur der Seitentitel. Der Rahmen
räumt zwei Eigenheiten des `base`-Renderers weg, beide am Gerät gemessen: Der
Montageknoten ist ein Flex-Eintrag und wuchs ohne `min-inline-size: 0` auf die
natürliche Breite der Partitur (924 px in einem 412 px breiten Bild), und die
über 100 px Rand für eine Kopfleiste, die es hier nicht gibt, sind auf einem
Telefon Bildschirm für nichts.

**Sie läuft in einer WebView.** Die App zeigt ihren eigenen Ladebildschirm und
blendet ihn erst auf `loaded()` aus; bleibt das aus, meldet sie nach zehn
Sekunden einen Timeout. `ScoreViewer.vue` feuert dafür `ready`, sobald
wirklich etwas zu sehen ist – Notenbild **oder** Fehlermeldung, nicht schon
beim Laden der Seite. Das ist die einzige Änderung, die dieser Weg am Viewer
verlangt, und für die anderen Einstiege folgenlos. Die Brücke selbst liegt als
reines Modul in `src/lib/mobileBridge.js`; fehlt sie, sind alle Aufrufe
wirkungslos statt Fehler – dieselbe Seite läuft auch im gewöhnlichen Browser.

**Was die WebView kann**, ist gemessen, nicht angenommen (Galaxy S23,
Android-App, Instanz über `adb reverse` als `http://localhost:8134` –
`localhost` gilt als sicherer Kontext, und ohne den gibt es weder `wakeLock`
noch `audioWorklet`):

| | Befund | Folge |
|---|---|---|
| AudioWorklet, WebAssembly, Ton | laufen, Ton hörbar | keine |
| `navigator.wakeLock` | Sperre wird erteilt | keine |
| Vollbild-API | `document.fullscreenEnabled === false` | Der Vollbildknopf schaltet ein Vollbild innerhalb der Seite (`useZoom.js`) |

Der Vollbildknopf hängt dabei an der **Fähigkeit des Browsers**, nicht am
Einstieg: Der Viewer soll nicht danach verzweigen, wie seine Seite ausgeliefert
wurde. Dieselbe Regel deckt ein iframe mit entsprechender Permissions-Policy
und das iPhone gleich mit ab. Ohne Vollbild-API legt sich der Viewer per
`position: fixed` über sein Fenster, auch über Nextclouds Kopfzeile, und gilt
für Zoom („ganze Seite“) und Leiste als Vollbild; die Zurück-Taste verlässt
es über einen eigenen Verlaufseintrag. Die Systemleisten bleiben: Die
Android-App setzt in ihrem WebChromeClient kein `onShowCustomView` um, und
ihre JS-Brücke (`DirectEditingMobileInterface`) kennt nur `close`, `share`,
`loaded` und `reload` – geprüft im Quelltext von 35.0.1.

**Die Leiste.** Draußen steht, was während des Singens gebraucht wird: der
Transport (Play, Suchlauf, Zeit, Taktfeld, Studierbuchstaben, Anfangston,
Schloss, Mikrofonanzeige) und Vollbild. Davor stehen die angehefteten Werkzeuge
([E23](#e23-anheften-statt-umsortieren)). Alle übrigen Werkzeuge stehen in drei
Gruppen, jede ein Knopf mit einem einzigen Aufklapper (`ToolGroup.vue`):
**Wiedergabe und Üben** (was ich höre und wie ich übe: Loop, Metronom, Tempo,
Mixer, Transponieren, Coach; dann die Mikrofonwerkzeuge; dann das
Übetagebuch), **Ansicht** (Zoom, Mitscrollen, nur meine Zeile, Tonnamen,
Notizen; dann Seiten und Fassung, Farben) und **Partitur** (meine Stimme mit
der Wahl des Anfangstons, Leitung, neue Setliste; dann Drucken, Audiodatei,
Offline, Info und Diagnose). In jeder Gruppe steht das Häufige oben, was einmal
eingestellt wird, unter einer Trennlinie. Werkzeuge mit eigenem Bedienfeld
öffnen darin eine Unterseite, keinen zweiten Aufklapper; der Zoom steht ohne
Unterseite oben in „Ansicht“, weil er im Aufführungsmodus dort das einzige
Werkzeug ist. Die Wahl des Anfangstons steht unter „Meine Stimme“ und nicht am
Anfangston-Knopf: Dessen langer Druck heißt schon „Ton klingt“, und „mein Ton“
ist der erste Ton der gewählten Stimme. Was wann sichtbar ist und in welcher
Gruppe, steht allein in `lib/barGroups.js`: Leere Gruppen entfallen, die
Reihenfolge ist für alle gleich. Dieselbe Tabelle beantwortet, ob ein Werkzeug
an ist (`toolOn`) und ob seine Gruppe deshalb einen Punkt trägt – Knopf und
Punkt können nicht auseinanderlaufen. Ist in einer Gruppe etwas eingeschaltet
(Metronom, Loop, Coach, eine Transposition, Tonnamen, ein offenes Panel), trägt
ihr Knopf einen Punkt – eine vergessene Transposition hieße in der Probe falsch
ansingen. Die Folgen-Anzeige steht nicht in der Leiste,
sondern über den Noten (`FollowBadge.vue`) – dort kostet sie keine Höhe und
bleibt im Aufführungsmodus sichtbar.

Breit oder kompakt (Werkzeuge auf Abruf hinter „Werkzeuge“) entscheidet der
**Überlauf des Transports**, keine Breitenschwelle (`lib/barFit.js`,
gemessen in `ScoreBar.vue`). Eine feste Schwelle müsste aus einer Knopfzahl
gerechnet werden und veraltete mit jedem neuen Werkzeug. Nach „breit“ zurück geht es erst 24 px über der
Breite, bei der der Überlauf auftrat, oder wenn sich der Inhalt der Leiste
ändert (Aufführungsmodus, Folgen, Leitung, Studierbuchstaben, Mikrofon).
Gemessen wird der Überlauf und nicht ein Umbruch, weil der Transport ein
Container für die Abfragen unten ist (`container-type: inline-size`) und damit
für Flexbox keine Eigenbreite hat: Er würde zusammengedrückt, nie umgebrochen.

**Telefonbreite.** Die kompakte Leiste muss auf 360 px in eine Zeile passen:
Play, Taktfeld, Anfangston, Schloss und „Mehr“. Vollbild (und auf der
eigenständigen Seite das ✕) steht deshalb dort vorn im aufgeklappten
Werkzeugstreifen statt im Transport. Entschieden wird an
der Breite des Streifens, nicht des Fensters (`@container (max-width: 400px)`
in `ScoreViewer.vue`) – der Viewer kann auch in einem schmalen Rahmen stecken.
Weichen muss dort der Suchlauf, den das Taktfeld daneben ohnehin trägt, und bei
Studierbuchstaben die Gesamtzahl der Takte.

**Eingefahrene Leiste.** Die Leiste zieht sich nach 3 s Ruhe zu einer
8-px-Fortschrittslinie zusammen, ein Tipp darauf holt sie zurück
(`useBarLayout.js`, Regel in `lib/barCollapse.js`). Dafür braucht es einen
Grund und keinen Bedarf: Grund ist Vollbild **oder knapper Platz** – die
stehende Leiste belegt mindestens 15 % der Höhe des Viewers (zurück erst unter
12 %) –, und niemand braucht sie während der Wiedergabe, im Aufführungsmodus
und beim Folgen einer Leitung. Knapper Platz greift auch ohne Knopfdruck, wo
es kein echtes Vollbild gibt: iPhone und WebView der Android-App; dort
schaltet der Vollbildknopf außerdem das Vollbild innerhalb der Seite. Gemessen in Files mit
emuliertem Telefon: Die 59-px-Leiste belegt quer 25 % des Viewers, hochkant
10 %. Ein Anteil statt einer Media Query auf
Ausrichtung oder Höhe aus demselben Grund wie beim Überlauf: Der Viewer
steckt in verschiedenen Rahmen. Die Leistenhöhe wird gemessen, solange die
Leiste steht, und gilt weiter, solange sie eingefahren ist – sonst hieße die
Linie „nicht knapp“ und holte die Leiste sofort zurück. Ein offener
Aufklapper der Leiste hält das Einfahren auf: Er hängt außerhalb der Leiste
im DOM, ein Tipp darin erreicht ihr `activity` nicht, und Einfahren risse
ihn unter dem Finger weg. **Kein** „Tipp auf die Partitur schaltet die
Leiste“: Ein Tipp auf die Partitur springt an die Note, zwei Bedeutungen für
dieselbe Geste wären ein Fehler. Auf knappem Platz bietet der Viewer außerdem
einmal das Systemband an, wie unter 600 px Breite.

### E9: Die Leitungsrolle ergänzt die Dateirechte

Chorprobe und Konzert brauchen eine Rolle, die Nextcloud nicht kennt: wer
Stimmnotizen setzen, „Folgt mir“ starten und andere zur Leitung ernennen darf.
Sie ist **eine Ergänzung der Dateirechte, kein Ersatz**: Jede Prüfung bekommt
eine Datei, die schon aus Sicht der handelnden Person aufgelöst ist
(`UserFileResolver`) – wer die Datei nicht sieht, kommt gar nicht bis zur
Rolle. Eine eigene Rechteverwaltung neben den Freigaben hätte zwei Wahrheiten
darüber, wer eine Partitur sehen darf.

Leitung ist (`Service\LeaderService`):

1. **die Eigentümerin**, bei jeder Prüfung aus `$node->getOwner()` bestimmt.
   Sie steht nie in der Tabelle und lässt sich deshalb gar nicht abberufen –
   auch nicht durch einen versehentlichen Eintrag;
2. **ohne Eigentümerin** (Gruppenordner und ähnliche Speicher liefern keine):
   wer Schreibrecht hat. Irgendwer muss die erste Ernennung aussprechen
   können, und Schreibrecht ist dort das Recht, das einer Eigentümerschaft am
   nächsten kommt – dasselbe, das schon geteilte Notizen erlaubt. Eine
   Leitung kraft Schreibrecht erscheint nicht in der Liste der Leitungen; die
   zeigt die Eigentümerin und die Ernannten;
3. **wer in `scoreview_leaders` steht** – aber nur, solange die Person die Datei
   sieht. Verliert sie den Zugriff, verliert sie die Rolle, ohne dass der
   Eintrag verschwindet; bekommt sie ihn zurück, ist sie wieder Leitung. Eine
   vorübergehend entzogene Freigabe soll keine Ernennung löschen.

Ernennen können nur Leitungen, und nur Personen, die die Datei sehen – eine
Ernennung ohne Zugriff säße sonst unsichtbar in der Tabelle, bis jemand die
Datei freigibt. Die Nutzersuche dafür (`leader-candidates`) läuft
serverseitig über `ISearch`, liefert nur Treffer mit Dateizugriff (höchstens
20, ab zwei Zeichen) und ist auf 30 Aufrufe je Minute begrenzt, weil jeder
Treffer einen Blick in den Dateibaum einer anderen Nutzerin kostet. Sie ist
eine eigene Route statt Nextclouds Sharee-API, weil die mobile Seite keine
Sitzung hat und die Filterung auf den Dateizugriff ohnehin hierher gehört.

**404 vor 403.** Wer die Datei nicht sieht, bekommt auf jedem Endpunkt 404,
auch beim Lesen – sonst ließe sich abtasten, welche fileIds es gibt. Erst wer
sie sieht, aber keine Leitung ist, bekommt beim Ändern 403. Dass der Viewer die
Knöpfe gar nicht erst zeigt, ist Bequemlichkeit, keine Absicherung. Dieselbe
Staffelung gilt für Setlisten und Aufnahmen.

**Kontonamen nur an Leitungen.** Die Liste der Leitungen trägt UIDs nur für
Leitungen, die damit jemanden abberufen; alle anderen sehen Anzeigenamen –
sie sollen sehen, wer leitet, nicht die Kontonamen der Instanz sammeln.

### E10: „Folgt mir“ – ein Zustand mit Zählern, abgefragt oder gepusht

Eine Leitung schickt ihre Stelle, einen Loop, den Anfangston und eine
Transposition an alle Geräte, die dieselbe Partitur offen haben, lässt sie
stumm mitblättern, solange sie selbst abspielt, und nimmt sie in der Setliste
zum nächsten Stück mit (`Service\FollowService`, `useFollowSession.js`).

**Zustand statt Ereignisse.** Gespeichert wird je Datei *ein* Zustand –
`position`, `loop`, `tone`, `transpose`, `playback` und `moved`, jeder mit eigenem Zähler
`seq`, dazu eine
`version`, die bei jeder Änderung steigt. Ein Gerät vergleicht nur die Version
und holt bei Abweichung den ganzen Zustand; was daraus folgt, entscheidet
`followState.js` an den Zählern. Ein Nachzügler oder ein Gerät nach einem
Funkloch bekommt so den letzten Stand, und nichts wird nachgespielt. Ein
Anfangston erklingt nur, wenn sein Zähler gestiegen ist **und** er nach der
Uhr des Servers (`serverNow` in jeder Antwort) jünger als 2 s ist – ein
verspäteter Ton in eine laufende Probe hinein ist schlimmer als keiner. Ein
Sprung wirkt nur, solange das Gerät folgt: Eigenes Navigieren löst es,
Blättern und Zoom nicht (sonst wäre Folgen am Notenständer nutzlos), „Zurück
zur Leitung“ holt es wieder heran.

**Die Version ist die Sitzungskennung.** Eine neue Sitzung beginnt nicht bei 1,
sondern bei einer Zufallszahl, die zugleich als `state.session` im Zustand
steht. Ein Gerät, das die alte Sitzung bei Version 3 verlassen hat und in der
neuen zufällig wieder auf 3 träfe, bekäme sonst ein 204 und sähe die neue
Sitzung nie.

**Transport: abfragen, mit Push als Abkürzung.** `GET …/follow?since=<version>`
antwortet 204, wenn sich nichts geändert hat. Wie oft ein Gerät fragt, hängt an
seiner Rolle (`followPoll.js`): Ein **folgendes** Gerät mit sichtbarer Seite
fragt im Takt von `follow_poll_ms` (Vorgabe 800 ms, erlaubt 500–3000, in der
Verwaltung einstellbar und mit jeder Antwort mitgeschickt, damit eine Änderung
auch laufende Sitzungen erreicht) – auch dann, wenn die Leitung lange steht,
denn gerade im Stillstand sagt sie „ab B“. Das **Gerät der Leitung** kennt den
Stand aus den Antworten auf seine eigenen Änderungen und fragt nur alle 5 s
(für ein zweites Gerät derselben Leitung); ein **gelöstes** Gerät und jedes im
Hintergrund alle 15 s. **Ohne Sitzung** („läuft eine Sitzung?“) fragt ein
Gerät alle 15 s, solange es in den letzten zwei Minuten geöffnet, sichtbar
geworden oder benutzt wurde, danach alle 60 s; eine Berührung macht es wieder
schnell. Push hilft beim Entdecken nicht: Der Server schickt nur an Geräte, die
einer laufenden Sitzung beigetreten sind. Ist `notify_push` eingerichtet, schickt der
Server bei jeder Änderung ein Ereignis `scoreview_follow` an die angemeldeten
Teilnehmenden (`POST …/follow/join`), und jedes Gerät holt einmal den Zustand;
das Abfragen tritt dann in den Hintergrund. Die Abhängigkeit ist **optional**:
`Service\PushNotifier` nennt die Schnittstelle von notify_push nur als
Zeichenkette und löst sie erst auf, wenn die App aktiv ist – jeder Fehler heißt
schlicht „kein Push“. Im Browser prüft der Viewer zusätzlich, ob die
Verbindung wirklich steht, nicht nur, ob der Server Push anbietet; sonst fragt
er im vollen Takt. Auf der mobilen Seite gibt es keinen Push
([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps)).

**Warum kein Long-Polling und keine Server-Sent Events.** Jedes wartende Gerät
belegte einen PHP-Worker für die Dauer des Wartens; 40 Sängerinnen legten
einen gewöhnlichen Server damit lahm. Eine kurze Abfrage kostet dagegen
gemessen rund 50 ms CPU, fast alles für den Start von Nextcloud selbst
([Grenzwerte](limits.de.md#folgt-mir)).

**Lesen ohne Datenbank.** Der Stand liegt im Cache, geschrieben bei jeder
Änderung der Leitung, gelesen bei jeder Abfrage; die Datenbank sieht nur die
Änderungen, den Herzschlag der Leitung (60 s) und einen Fehlgriff je
Cache-Ablauf. Welcher Cache: der verteilte, wenn einer eingerichtet ist
(Eintrag 30 s), sonst der lokale (APCu). Der lokale gehört *einem* Webserver –
bei mehreren ohne verteilten Cache bekäme ein Gerät auf dem einen Server 204
auf einen Stand, den der andere längst überschrieben hat, und verlöre einen
Sprung. Ein lokaler Eintrag gilt deshalb höchstens 1 s (geprüft an einem
mitgespeicherten Zeitstempel, weil APCu in ganzen Sekunden rechnet); bei
einem Webserver kostet das einen Lesezugriff je Sekunde und Datei, nicht je
Gerät. Aus der Datenbank Gelesenes kommt nur mit `IMemcache::add` in den
Cache, also nur, wenn dort noch nichts liegt – sonst legte eine Abfrage, die
die alte Zeile gelesen hat, den alten Stand über den, den die Leitung gerade
geschrieben hat.

**Die Dateiprüfung bleibt bei jeder Abfrage.** Sie macht nur einen kleinen Teil
der 50 ms aus; sie zu cachen spart kaum etwas und ließe nach einem
Freigabeentzug ein Fenster offen.

**Mitblättern ohne Ton.** Spielt die Leitung ab, folgen Cursor, Mitscrollen
und Zeitanzeige der Folgegeräte ihrer Wiedergabe – die Geräte selbst bleiben
stumm: In der Probe wird live gesungen, und 40 Lautsprecher mit je eigener
Verzögerung wären ein Echo. Gesendet wird dafür kein Strom von Zeiten, sondern
ein Stand `playback` („spielt ab *t* mit Tempo *r*“), den der Server wie den
Anfangston mit seiner Uhr stempelt (`at`); jedes Gerät rechnet mit
`serverNow` selbst weiter (`lib/followPlayback.js`). Neu gemeldet wird nur,
was sich so nicht vorhersagen lässt – Start, Halt, Tempo, ein Sprung über
400 ms (Suchlauf, Loop) – und alle 15 s zum Nachstellen; geprüft wird im
250-ms-Takt, nicht je Bild, und nur, solange die Leitung spielt. Start und Halt
meldet der Viewer sofort, im Stillstand gibt es nichts zu melden. Die fremde Zeit treibt im Viewer nur die
Anzeigezeit (`usePlayback.followTime`): Die eigene Audiouhr steht, Loop und
Metronom hängen an ihr und bleiben still. Wer selbst Play drückt, hört sich
selbst; wer selbst navigiert, löst wie bei jedem Sprung das Folgen. Hält die
Leitung an, bleibt das Gerät an ihrer Stelle stehen. Im Stillstand bewegt
die Leitung niemanden stumm – eine Stelle zeigt sie ausdrücklich.

**Die Leitung sendet nacheinander, der letzte Tipp gewinnt**
(`leaderQueue.js`). Zwei Änderungen, die gleichzeitig unterwegs wären, kämen
in beliebiger Reihenfolge an – der ältere Sprung läge dann über dem neueren.
Also läuft je Gerät höchstens eine Anfrage; was währenddessen getippt wird,
geht gleich danach als *ein* PATCH hinaus: von Stelle, Loop, Transposition
und Wiedergabestand nur der neueste, ein Anfangston als Auslöser immer (mehrere Tontipps während einer
Anfrage als einer). Starten und Beenden verdrängen, was vor ihnen wartete. Die
Knöpfe bleiben dabei bedienbar – gesperrte Knöpfe verlören den zweiten Tipp
von „B – nein, C“. Die Warteschlange hält sich selbst unter 100 Anfragen je
Minute, unter der Grenze des Servers von 120 (dazu Herzschlag und ein zweites
Gerät); ist das Budget erschöpft, wartet sie und sammelt weiter.

**Sitzungsende:** durch eine Leitung, oder nach 30 min ohne Herzschlag – das
wird schon beim Lesen als beendet gewertet. Eine andere Leitung übernimmt eine
laufende Sitzung, indem sie selbst startet; allen wird das angezeigt. Es gibt
höchstens eine Sitzung je Datei.

**Transposition für alle.** Die Leitung setzt sie mit `PATCH {transpose}`
(−12 … +12). Folgende übernehmen sie für die Dauer der Sitzung, gespeichert
wird sie bei ihnen **nicht**; beim Lösen oder Ende gilt wieder die eigene. Wer
folgt und selbst transponiert, löst sich – wie bei eigenem Navigieren, sonst
überschriebe die nächste Angabe der Leitung die eigene Wahl ungefragt.

**Umzug zum nächsten Stück.** Eine Sitzung bleibt an *einer* Datei. Schaltet
die Leitung in der Setliste weiter, ruft der Viewer `POST …/follow/move` mit
dem neuen Stück auf. Der Server legt dort eine Sitzung mit **derselben
Kennung** (`state.session`) und denselben Zählern an und schreibt danach auf
der alten `moved` mit dem Ziel – in dieser Reihenfolge, damit wer dem Verweis
folgt, die Sitzung schon vorfindet. Folgende behalten ihre gesehenen Zähler
und springen erst beim nächsten neuen Stand; fingen die Zähler bei 0 an,
überginge ein Gerät die ersten Stände dort. Wer folgt, wird mitgenommen, auch
ohne Setliste; wer sich gelöst hat, bekommt nur den Hinweis mit „Dorthin
wechseln“. Wer das neue Stück direkt öffnet, findet die Sitzung dort.

- **Stelle, Loop und Wiedergabestand tragen ihre Datei** (`fileId`). Während eines Umzugs kann
  ein Stand der alten noch unterwegs sein, und Takt 12 dort ist ein anderer
  Takt 12; `followState.js` verwirft fremde.
- **Nur Partituren.** `move` nimmt als Ziel nur eine `.mscz`
  (`application/x-musescore`) an.
- **Getragene Leitung.** Die Leitung darf auf dem neuen Stück führen, auch wenn
  sie dort keine Leitungsrolle hat – aber nur, solange sie die Sitzung dort
  angelegt hat, auf der Herkunft (`carriedFrom`: die letzte Datei der
  Kette, auf der sie Leitung ist) weiterhin Leitung ist und **Herkunft und
  Ziel derselben Eigentümerin gehören**. Ohne diese letzte Bedingung genügte
  irgendeine eigene Partitur: hochladen, dort starten, auf eine nur lesbar
  geteilte Partitur umziehen und alle führen, die ihr folgen. Eine Setliste,
  die beide Dateien nennt, belegt nichts – schreiben kann sie jede. Speicher
  ohne Eigentümerin (Gruppenordner) tragen keine Leitung; dort macht schon
  Schreibrecht zur Leitung, und ACLs können es auf der einen Datei gewähren
  und auf der anderen nicht. Stimmnotizen und
  Stempel auf dem neuen Stück prüft weiter `LeaderService`; dafür muss sie dort
  Leitung sein. Übernimmt dort eine echte Leitung die Sitzung, indem sie selbst
  startet, entfällt `carriedFrom`.
- **Fremde Sitzungen bleiben unangetastet.** Führt auf dem Ziel schon jemand
  anderes, lehnt der Server ab (409); das Stück wechselt für die Leitung
  trotzdem, die Folgenden bleiben stehen. Übernimmt jemand die Herkunft,
  während der Umzug läuft, oder endet sie, nimmt der Server das schon
  angelegte Ziel zurück, statt den Verweis in die fremde Sitzung zu schreiben.
- **Ein Neustart auf der Herkunft vergisst den Umzug.** Wer auf einer Datei
  startet, von der die Sitzung weggezogen war, führt dort wieder; der alte
  Verweis `moved` fällt weg, sonst schickte er jedes neu beitretende Gerät
  zum früheren Ziel.
- **Ohne Leserecht auf dem Ziel** antwortet es einer Folgenden mit 404, wie
  jede fremde Datei ([S8](#s8-404-vor-403)), und der Viewer zeigt das. Der
  Umzug selbst verlangt nur, dass die *Leitung* das Ziel lesen darf.
- **Mobil** holt ein Folgegerät für das neue Stück ein Begleit-Token
  ([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps),
  [S1](#s1-begleit-token-sind-an-zweck-datei-und-direct-editing-token-gebunden)).
- **Aufräumen.** Endet die Sitzung auf dem neuen Stück, enden die Vorgänger
  mit, sonst schickten sie Nachzügler an ein beendetes Stück. Rückwärts
  gegangen wird über `movedFrom`, und je Glied nur, solange dort noch dieselbe
  Sitzung steht und auf genau den Nachfolger zeigt – eine inzwischen neu
  gestartete Sitzung einer anderen Leitung bleibt unberührt.
- **Die Kette bleibt beim Server.** `carriedFrom` und `movedFrom` nennen
  fileIds, die Folgende womöglich nicht lesen dürfen; an Geräte ausgeliefert
  wird der Zustand ohne sie ([S8](#s8-404-vor-403)).

### E11: Die Setliste als Markdown-Datei

Eine Setliste ist eine Datei `*.setlist.md` in Files, keine Tabelle der App:
Sie lässt sich teilen, verschieben, versionieren und im Texteditor von Hand
schreiben – mit denselben Rechten wie jede andere Datei.

```markdown
# Konzert Herbst 2026

Freier Text bleibt erhalten.

1. [Kyrie](../Messe/Kyrie.mscz)
2. [Ave verum](Ave%20verum.mscz)
3. Zugabe/Abendlied.mscz
```

**Einträge sind die Elemente der ersten Liste** (`Service\SetlistFormat`),
nummeriert oder nicht, als Link (%-kodiert wie jeder Link) oder als roher
Pfad (dort sind Leerzeichen roh erlaubt, weil so jemand tippt). Dasselbe Stück
darf mehrfach vorkommen. Alles andere ist freier Text. Bewusst nicht
CommonMark in jeder Ecke: Eine nicht eingerückte Zeile direkt nach einem
Eintrag beendet die Liste, statt als „faule Fortsetzung“ dazuzugehören;
eingerückte Zeilen gehören zum Eintrag davor und wandern beim Umordnen mit.

**Der Schreiber ersetzt nur die erste Liste.** Der übrige Text bleibt Byte für
Byte stehen. Ein unveränderter Eintrag kommt aus dem Editor als Verweis auf
seine Stelle in der gelesenen Datei (`origin`) zurück und wird im
Originaltext übernommen – ein roher Pfad bleibt roh, Titel und Unterpunkte
bleiben. Neue Einträge schreibt der Server als Link, den relativen Pfad
rechnet er selbst aus. Weil `origin` auf Stellen der gelesenen Fassung zeigt,
lehnt er ab (409), wenn die Datei seither im Texteditor geändert wurde.
Zeilenumbrüche, Steuerzeichen, `\` und NUL in einem Pfad lehnt er ab.

**Aufgelöst wird aus Sicht der Leserin.** Pfade sind relativ zur
Setlisten-Datei; `..` darf den Nutzerordner nicht verlassen, sonst ist der
Eintrag fehlend. Weil dieselbe Datei bei jeder, die sie über eine Freigabe
hat, anders im Baum liegt, löst der Server jeden Eintrag im Baum der
anfragenden Nutzerin auf – was eine Sängerin nicht sieht, ist für sie
`missing` und wird beim Blättern übersprungen, für die Chorleitung aber nicht.
Absolute Pfade werden ebenso im Baum der jeweiligen Leserin aufgelöst. Ein
Nachschlagen per fileId aus der Sicht eines anderen Kontos gibt es bewusst
nirgends. Noch nicht konvertierte Stücke reiht das Lesen gleich zur
Konvertierung ein.

**Drei Wege hinein.** (1) Die Dateiaktion auf `*.setlist.md`
([E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)). (2) Aus
einer offenen Partitur: Der Viewer bietet die Setlisten aus demselben Ordner
an, die sie enthalten (höchstens 20 je Ordner) – das ist zugleich der einzige
Weg in den mobilen Apps, die für Markdown Text anbieten. (3) „Neue Setliste“
im Viewer, im Ordner der offenen Partitur. Der Editor fügt Partituren über
Nextclouds Dateiauswahl hinzu (`@nextcloud/dialogs`, nur mit Sitzung) oder aus
der Auswahl um die offene Partitur (`score-candidates`: ihr Ordner bis Tiefe
2, höchstens 200 Treffer und 100 besuchte Ordner); mobil ist nur Letzteres
möglich, mit einem Begleit-Token auch das nicht
([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps)).

Das Stück wechselt im Viewer, nicht durch ein neues Einhängen (siehe
[Stückwechsel im Viewer](#stückwechsel-im-viewer)).

### E12: Partiturfakten aus der Engine, mit MIDI-Rückfall

Anfangston, Studierbuchstaben in der Navigation und der Grundton brauchen
Tonarten mit Dur/Moll und Studierbuchstaben je Takt. MuseScores
`--score-media` liefert beides nicht in `metadata`, und im SVG steht der Text
eines Studierbuchstabens nur als Glyphenpfad
([M11](#m11-was-midi-und-svg-über-studierbuchstaben-und-tonarten-tragen)).

**Die Engine schreibt beides in `meta.json`** – `keySigs` und `rehearsalMarks`
([Artefaktschema](#artefaktschema)), aus dem ersten Staff, mit
`KeySig::concertKey()`, `KeySig::mode()` und `RehearsalMark::plainText()`.
`converter/lib/artifacts.mjs` reicht `metadata` unverändert durch, der
Selbsttest prüft beides an `keys-marks-test.mscz` (c-Moll, Wechsel nach D-Dur,
Buchstaben A/B/C). Der Sidecar mit Stock-MuseScore liefert die Felder nicht.

**Entschieden wird am Inhalt, nicht am Weg** (`scoreFacts.fromArtifacts`), wie
bei den Kennungen aus M10: Liefert `meta.json` ein Feld, gilt es – auch leer,
denn „keine Buchstaben“ ist dann eine Aussage. Fehlt es, kommen Buchstaben aus
den MIDI-Markern und Tonarten aus den Vorzeichen-Ereignissen des MIDI, das
beide Wege byteweise gleich erzeugen, über die Zeit auf `measures.json`
abgebildet; je Buchstabe zählt das erste Vorkommen, bei Wiederholungen also
der erste Durchgang. Das MIDI trägt keinen Modus, der Grundton ist dann die
Dur-Tonika – eine ehrliche Näherung, der Ton liegt immerhin in der Tonleiter.
Gelesen wird das MIDI dafür nur, wenn es gebraucht wird; auf dem lokalen Weg
bezahlt niemand dafür.

**Mehrtaktpausen.** Die Engine zählt Takte in der notierten Kette, der Viewer
(`measures.json`, Notizen, Takteingabe) in der dargestellten, in der eine
Mehrtaktpause *ein* Takt ist. Gemessen: Engine „D in Takt 8“, `measures.json`
kennt nur 6 Takte, D steht dort in Takt 6. Die Engine-Felder gelten deshalb nur,
wenn beide Zählungen nachweislich gleich lang sind (`engineMeasuresMatch`);
sonst kommt die Lage aus dem MIDI und landet damit von selbst in der Zählung
des Viewers. Den Modus übernimmt der Rückfall dann aus der Engine, wo er je
Vorzeichnung eindeutig ist.

**Liedtext und Schreibweisen kommen ebenfalls aus der Engine.** Sie schreibt
(ab `v4.7.5-engine.4`) zwei weitere Listen in `meta.json`
([Artefaktschema](#artefaktschema)): `lyricSyllables`, jede sichtbare Silbe
mit Segment, Notenzeile, Stimme, Strophe und Silbenart, und `noteSpellings`,
je Notenkopf die klingende Tonhöhe und die gezeigte Schreibweise (`tpc`).
Beides ist aus den übrigen Artefakten nicht zu gewinnen
([M12](#m12-liedtext-steht-im-svg-nur-als-glyphen)). Auf ihnen bauen die
Liedtext-Ansicht und die Tonnamen auf, und angeboten werden diese nur, wo die
Listen da sind ([E15](#e15-fähigkeiten-statt-weg)). Einen Rückfall aus dem MIDI
gibt es dafür nicht: Das MIDI trägt keinen Text und keine Schreibweise. Der
Selbsttest prüft beide Listen an `lyrics-test.mscz` – drei Strophen unter einer
Wiederholung, 56 Silben, jede an einer `elid` aus `timing.json`, und je Segment,
Notenzeile und Stimme so viele Schreibweisen wie Notenköpfe im SVG.

**Die Taktart je Takt kommt ebenfalls aus der Engine** (ab
`v4.7.5-engine.5`): `measureFacts` nennt je notiertem Takt die nominelle
Taktart und die tatsächliche Länge in Ticks, und jeder `noteSpellings`-Eintrag
trägt den notierten `tick` seines Segments ([Artefaktschema](#artefaktschema)).
`measures.json` sagt nur, wann ein Takt beginnt, nicht was er ist; das Metronom
schätzte die Schläge deshalb aus der Taktdauer und dem Viertel-Tempo – was 6/8
nicht von 3/4 unterscheidet und einen Auftakt falsch zählt. Der Rückfall ohne
das Feld bleibt die Schätzung, ergänzt um die Taktart-Ereignisse des MIDI
(`FF 58`, M11); der Selbsttest prüft die Felder an `timesig-test.mscz`
(ein Viertel Auftakt, 4/4, 3/4, 6/8) und die Lückenlosigkeit der Ticks an
`keys-marks-test.mscz`. Der Viewer übernimmt sie wie die Tonarten nur bei
`engineMeasuresMatch`.

**Ein Cache-Eintrag mit kleinerer `format_version` wird beim nächsten Öffnen
neu erzeugt** (`CURRENT_FORMAT_VERSION` = 5) – so bekommt jede Partitur die
Felder ([Konvertierung und Cache](#konvertierung-und-cache)).

### E13: Übe-Tracks sind Dateien in Files

Ein Übe-Track ist ein MP3 der aktuellen Mischung – die eigene Stimme im
Coach, ein Ausschnitt im Loop, ein langsameres Tempo, eine Transposition –,
das die Person in Files ablegt. Damit hört sie unterwegs ohne Viewer: in der
Nextcloud-App offline vorgehalten, im Hintergrund mit Steuerung auf dem
Sperrbildschirm, in jedem Player, geteilt mit anderen. Genau das kann der
Viewer im Browser nicht
([Sperrbildschirm](#üben-und-lesen-auf-dem-handy)).

**Das bricht bewusst mit „Aufnahmen nicht in Files“.** Eigene Aufnahmen liegen
in IAppData, weil sie die Stimme eines Menschen tragen und nur die
Aufnehmende sie hören soll. Ein Übe-Track ist synthetisiert, er trägt keinen
Personenbezug; als Datei soll er gerade geteilt, verschoben und offline
gehalten werden können. Er zählt deshalb wie jede Datei gegen das Kontingent
der Ordnerbesitzerin, und die App räumt ihn nicht auf.

**Gerendert wird im Browser, gespeichert vom Server.** Der Browser hat
SoundFont, MIDI und Mischung ohnehin; der Server bräuchte sonst eine eigene
Synthese. `usePracticeExport` baut aus dem, was gerade an den Player geht
(Lautstärken nach Mute, Solo, Fokus und Coach, Panorama, Programme), einen Plan
(`exportPlan.js`); ein eigener Worker (`renderWorker.js`) spielt das MIDI damit
über `spessasynth_core` ab, setzt jeden verschobenen Kanal nach derselben Kurve
wie der `StereoPannerNode` des Viewers neu ins Stereobild, legt Metronomklicks
dazu, normalisiert auf −1 dBFS Spitze (höchstens +12 dB) und kodiert mit
`@breezystack/lamejs` (LGPL-3.0) als MP3 mit 128 kbit/s, ID3v2.3-Kopf mit
Titel, Stimme und Mischung.
Ein eigener Worker statt des Players oder eines `OfflineAudioContext`: Er läuft
unabhängig von der laufenden Wiedergabe, und Chromium reicht Nachrichten an
ein Worklet im `OfflineAudioContext` nicht weiter. Der Track klingt so wie das,
was man eben gehört hat.

**Wohin.** `POST …/practice-tracks` nimmt das MP3 als Rumpf, Name, Ziel und
„ersetzen“ als Parameter:

| Ziel | Ordner | Mit Token |
|---|---|---|
| `folder` | neben der Partitur | Direct-Editing-Token ja |
| `sub` | Unterordner „Übe-Tracks“ neben der Partitur, bei Bedarf angelegt | Direct-Editing-Token ja |
| `own` | ein selbst gewählter Ordner (Nextclouds Dateiauswahl), als fileId im eigenen Nutzerordner aufgelöst, nie als Pfad | nein |

Mit einem Begleit-Token entsteht gar nichts
([S2](#s2-schreiben-mit-token-nur-um-die-partitur-herum)). Der Name des
Unterordners steht in der **Voreinstellungssprache der Instanz**
(`default_language`), nicht in der der Person – ein geteilter Ordner soll für
den ganzen Chor gleich heißen und nicht je Sprache doppelt entstehen. Der
Dateiname (`practiceTrackName.js`, bereinigt wie auf dem Server in
`Service\FileNames`) nennt Titel, Stimme oder „Gesamtmischung“ und, wo
zutreffend, Coach, Tempo, Transposition und Ausschnitt.

| Prüfung | Antwort |
|---|---|
| Schalter `feature_practice_export` aus, Datei nicht sichtbar oder keine `.mscz` | 404 ([S8](#s8-404-vor-403)) |
| Größer als `practice_track_max_mb` (Vorgabe 60 MB) | 413, vor dem Lesen am `Content-Length` und beim Lesen |
| Kein ID3-Kopf und kein MPEG-Frame-Sync in den ersten 4 KB | 400 – hält Versehen fern, mehr nicht; Nextcloud führt die Datei nie aus |
| Name leer oder von der Instanz verboten (nach dem Bereinigen, [S2](#s2-schreiben-mit-token-nur-um-die-partitur-herum)) | 400 |
| Kein Anlegerecht im Zielordner, vorhandene Datei nicht änderbar, Token-Regel verletzt | 403 |
| Name vergeben, ohne „ersetzen“ | 409 mit einem freien Vorschlag „… (2).mp3“ |
| Kontingent erschöpft | 507 |
| gespeichert | 201 mit fileId und Pfad |

**Tracks für alle Stimmen.** Wer neben der Partitur anlegen darf
(`canWriteFolder` im Status), bekommt je Stimme einen Coach-Track in den
Unterordner, vorhandene werden ersetzt. Bewusst am Schreibrecht, nicht an der
Leitungsrolle: Wer schreiben darf, darf auch Dateien ablegen. Die Leitungsrolle
regelt weiterhin Notizen, Stempel und „Folgt mir“. Gerendert wird Stimme für
Stimme; bricht man ab, bleiben die fertigen Tracks, eine halbe Datei entsteht
nicht.

### E14: Eine Offline-Seite mit eigenem Service Worker

Im Probenraum ist das Netz oft schlecht oder gar nicht da. Vorgemerkte
Partituren – Noten und Ton – sollen dann trotzdem gehen.

**Warum eine eigene Seite.** Gemessen auf Nextcloud 34: Files registriert
selbst einen Service Worker mit dem Scope `/` (`preview-service-worker.js`),
und der steuert damit auch den Viewer. Je Scope gibt es nur einen Worker; ein
ScoreView-Worker mit `/` verdrängte den von Files. Ein Worker wirkt aber auf
Seiten unter seinem eigenen Pfad, und dort gewinnt der spezifischere Scope.
Ohne Worker lädt die Files-Seite ohne Netz gar nicht. Deshalb gibt es genau
eine eigene Seite, `/apps/scoreview/offline`, mit einem Worker, dessen Scope
**nur diese Seite** ist
([E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste) bleibt
sonst, wie es ist).

**Tragende Idee: dieselben URLs.** Der Viewer fragt auf der Offline-Seite
genau die Adressen ab, die er auch in Files abfragt – unter anderem Status,
Artefakte samt `?v=`, Notizen, Leitungen, „Meine Stimme“, Setliste samt
Angeboten, SoundFont und Worklet. „Offline vormerken“ legt
die Antworten unter genau diesen URLs in den Cache `scoreview-offline-data`
(`offlinePlan.js` nennt sie, `useOffline.js` lädt sie), und der Worker
beantwortet sie von dort, wenn das Netz fehlt. Der Viewer braucht dadurch
keine zweite Datenquelle, nur einen Kontextwert `offline`, der in `barGroups.js`
und `interactionPolicy.js` ausblendet und sperrt, was einen Server braucht:
Notizen und Stempel setzen, Leitung und „Folgt mir“, Aufnahme und Intonation,
Übe-Tracks, Vormerken und Setlisten bearbeiten. Wiedergabe, Mixer, Loop,
Tempo, Metronom, Anfangston, Transposition, Coach, Darstellungen und
Aufführungsmodus bleiben.

**Was der Worker tut** (`src/offline-sw.js`), nach Art der Anfrage:

| Anfrage | Regel |
|---|---|
| die Seite selbst | erst das Netz, sonst der Cache der Hülle; eine nachgewiesene Umleitung zum Login räumt alles ([S10](#s10-vorgemerktes-gehört-einem-konto-und-verschwindet-mit-der-anmeldung)) |
| `GET` an `/apps/scoreview/api/…` | erst das Netz, sonst `scoreview-offline-data`, mit und ohne `index.php`; sonst 503 `{offline: true}` |
| Skripte, Stile, Schriften, Übersetzungen unter `/apps`, `/custom_apps`, `/apps-extra`, `/core`, `/dist`, `/themes` | aus dem Cache der Hülle, im Hintergrund erneuert; der Cache trägt die App-Version im Namen. Fehlt dort etwas, hilft der Datencache aus – das Worklet des Synthesizers legt „Offline vormerken“ dort ab, und nach einem App-Update ist das die einzige Kopie |
| alles andere `GET` (etwa ein externes SoundFont) | erst der Datencache, dann das Netz |
| nicht `GET` | geht unverändert ans Netz |

**Einmal online öffnen.** Die Seite richtet sich beim ersten Besuch mit Netz
ein: Sie registriert den Worker und schickt ihm die Liste dessen, was sie
schon geladen hat, damit auch Nextclouds eigene Skripte in den Cache kommen.
Wann das Handy offline sein wird, lässt sich vorher nicht wissen, und die Liste
der Core-Skripte ist nicht stabil genug, um sie blind vorzuladen. Nach dem
Vormerken weist der Viewer deshalb darauf hin. Ein Web-App-Manifest erlaubt
„Zum Startbildschirm hinzufügen“.

**Eine Adresse.** Die Seite antwortet nur unter der Form, die auch der Scope
ist; unter der anderen (mit bzw. ohne `index.php`) leitet sie dorthin um. Sonst
steuerte der Worker sie nie, und die Seite fiele ohne Netz aus.

**Aktualisieren und Räumen.** Öffnet man die Offline-Seite mit Netz, prüft sie
jedes Vorgemerkte am Statusendpunkt; hat sich der Konvertierungsstand
geändert, lädt sie den Eintrag neu („Aktualisiert“), ohne Netz bleibt er
(„Eventuell veraltet“). Ob der Server erreichbar ist, schließt sie aus einer
gescheiterten Prüfung, nicht allein aus `navigator.onLine` – das meldet nur
ein Netz, keinen erreichbaren Server. Der Browser gewährt
`navigator.storage.persist()` in der Regel nicht und darf den Cache bei
Platzmangel räumen; fehlt beim Öffnen eine URL eines Eintrags, gilt er als
„Vom Browser entfernt“. Das SoundFont teilen sich alle Einträge und zählt in
der Platzangabe nur einmal.

Geladen wird erst in einen eigenen Zwischencache und erst nach vollständigem
Erfolg in den Datencache übernommen. Bricht das Netz beim Aktualisieren ab,
bleibt der vorige Stand vollständig – sonst nennte der neue Status Seiten, die
nie ankamen, und die Partitur bliebe offline leer. Zwischencaches eines
abgebrochenen Ladens und Einträge im Datencache, die kein Vorgemerktes mehr
nennt, räumt das nächste Öffnen der Offline-Seite.

**Nur im Browser.** In den mobilen Apps gibt es die Offline-Seite nicht – die
Direct-Editing-Seite hat keinen eigenen Pfad, unter dem ein Worker gelten
könnte –, und der Viewer bietet dort kein Vormerken an.

### E15: Fähigkeiten statt Weg

Liedtext-Ansicht und Tonnamen brauchen Daten, die heute nur die Engine des
lokalen Wegs schreibt (`lyricSyllables`, `noteSpellings`,
[E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)). Der Viewer
fragt deshalb nicht, welcher Weg gelaufen ist, sondern was die Artefakte
hergeben (`capabilities.js`): `segIds` (Kennungen nach
[M10](#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)),
`lyrics`, `spellings`, `keyModes`. Das ist das Leitprinzip aus dem
[Datenfluss](#datenfluss), auf eine neue Frage angewandt: Käme ein Weg mit
denselben Daten dazu, würde er ohne eine Zeile im Viewer mitgenutzt.

| Darstellung | braucht |
|---|---|
| Seiten | nichts |
| Systemband | nichts – die Systemgrenzen kommen aus den Notenlinien, auf beiden Wegen |
| Liedtext | `lyricSyllables` mit mindestens einer Silbe **und** Kennungen nach M10 (`segIds`) |
| Tonnamen, Ton beim Antippen | `noteSpellings` **und** Kennungen nach M10 (`segIds`) |
| Zählzeiten | dazu `measureFacts` und ein `tick` je `noteSpellings`-Eintrag (`meters`, ab `v4.7.5-engine.5`, [E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)) – das Metronom kommt ohne aus und schätzt, die Zahlen über den Noten dürfen das nicht |
| Fassung, Seitenformat, klingend, Noten mittransponieren | `variants.supported` im Status (Server) bzw. der Rückfall im Browser, der dieselbe Engine fährt ([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)); „klingend“ nur bei `hasTransposingParts` |

**Kein stiller Rückfall.** Anders als die Färbung der Notenköpfe, die still auf
das Band zurückfällt, sagen die neuen Darstellungen, warum sie nicht gehen
(`unavailableReason`): Die Partitur hat keinen Liedtext (`hasLyrics`, das beide
Wege schreiben); sie hat zu viel Text (die Engine lässt die Liste über 20 000
Silben ganz weg, statt sie abzuschneiden); oder die Seiten wurden ohne die
nötigen Daten gesetzt – „eine Neukonvertierung auf diesem Server kann sie
nicht ergänzen“. Der letzte Text gilt, wo der Sidecar mit MuseScore selbst
konvertiert, nennt aber keinen Weg. Nicht verfügbare Optionen sind in der Auswahl ausgegraut und nennen den
Grund; ist die gewählte Darstellung bei einer Partitur nicht verfügbar, zeigt
der Viewer die Seiten mit einer Hinweisleiste, und die Wahl bleibt
gespeichert.

### E16: Drucken aus den Seiten-SVGs

Wer vom Bildschirm aufs Papier will, soll die Partitur so bekommen, wie der
Viewer sie zeigt – im Seitenformat der Partitur, auf Wunsch mit Notizen,
Stempeln und Tonnamen.

**Warum eine eigene Seite.** Der Viewer in Files lädt Seiten erst, wenn sie
in die Nähe des Sichtbereichs kommen, und gibt sie wieder frei, wenn sie weit
draußen sind (`ScorePage.vue`, `IntersectionObserver`) – eine Orchesterpartitur
hielte sonst zehntausende `<path>`-Knoten zugleich im DOM. Der Druckbefehl des
Browsers auf der Files-Seite druckte also die zwei, drei Seiten, die gerade
geladen sind, samt Nextclouds Rahmen. Die Druckseite `/apps/scoreview/print/{fileId}`
(`PageController::print`, `PrintApp.vue`) hält **alle** Seiten einer Partitur
zugleich und sonst nichts; der Viewer öffnet sie in einem neuen Tab („Drucken“
in der Gruppe „Ansicht“, `Ctrl`/`Cmd+P`). Sie ist kein zweiter Einstieg in
Partituren: Sie hat keine Navigation, verlangt eine Sitzung und die Datei muss
im eigenen Dateibaum liegen – 404 vor allem anderen
([S8](#s8-404-vor-403)). Ein Token-Zugang ([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps))
wäre eine neue Fläche ohne Nutzen: Die Apps drucken über „Im Browser öffnen“.

**Dieselbe Komponente, ein Prop.** Jede Seite zeichnet `ScorePage.vue` mit
`printSheet`: sofort geladen, nie freigegeben, ohne Cursor und
Zeigerbehandlung. Marker, Notiztexte, Stempel (`stampLayout.js`) und Tonnamen
(`noteLabelLayout.js`) werden von **demselben Code** gesetzt wie am
Bildschirm – der Druck zeigt, was der Bildschirm zeigt. Eine zweite
Platzierungslogik fürs Papier wäre die erste Abweichung. Die Breite des
Blatts kommt aus `meta.json` (`pageFormat`, in mm, auf beiden Wegen); daraus
entstehen `@page { size }` und die Zoomstufe, mit der die Seite genau so breit
ist wie das Blatt (`printLayout.js`). Ränder setzt die Seite keine: MuseScores
Seitensatz trägt sie schon ([E2](#e2-musescore-svg-statt-neusatz-im-browser)).

**Derselbe Weg zu den Artefakten.** Die Seite holt die Artefakte über
`useConversionStatus` – Serverweg oder Rückfall im Browser, dasselbe eine `if`
([E7](#e7-konvertierung-im-browser-als-rückfall)), hier keines. Deshalb trägt
sie dieselbe Content Security Policy wie der Viewer, und zwar aus **einer**
Stelle: `Service\ViewerPolicy` nennt die Direktiven, die der Viewer über
Nextclouds Vorgabe hinaus braucht (`wasm-unsafe-eval`, Worker und Verbindungen
aus `blob:`, der SoundFont-Host), und `Listener\AddCspListener`, die
Offline-Seite und die Druckseite rufen sie. Vorher stand die Liste zweimal; die
dritte Kopie wäre die gewesen, die abweicht.

**Kein Server-PDF.** Keiner der beiden Konvertierungswege kann eines schreiben
([E3](#e3-zwei-konvertierungswege-hinter-einer-api): die Engine hat kein Qt,
der Sidecar schriebe es nur mit MuseScore als Renderer). Der Druckdialog des Browsers macht
es: „Als PDF speichern“ hält die SVG-Pfade als Vektoren (gemessen, siehe
[Grenzwerte](limits.de.md#drucken)). Was die Seite deshalb bewusst **nicht**
tut: drucken, bevor jedes Blatt geladen ist – der Knopf bleibt gesperrt, bis
jede `ScorePage` `loaded` gemeldet hat; sonst druckt jemand nach dem ersten
Blick eine halbe Partitur.

**Die PDF-Datei neben der Partitur.** „Als PDF in Dateien speichern“ auf der
Druckseite schreibt die PDF im Browser und legt sie über
`POST /api/scores/{fileId}/pdf` neben die Partitur. Warum kein Server-PDF,
steht oben; warum keine Bibliothek: Eine PDF-Bibliothek im Browser (jsPDF
mit svg2pdf.js, pdf-lib) wiegt rund 400 KB, und gebraucht wird wenig:
MuseScore zeichnet alles als Pfade, Polylinien und Polygone mit Matrizen, die
Engine dazu Glyphen per `<use>` – der Teil von SVG, der sich eins zu eins auf
PDF-Operatoren abbildet. `svgToPdf.js` übersetzt genau den Dialekt beider
Wege (gemessen: Engine mit verschachtelten `g`, `use` und Pfaden mit `Q`;
Sidecar flach, Matrizen an jedem Pfad, ein weißer Hintergrundpfad, der
entfällt), Glyphen werden Form-XObjects (eines je Glyphe statt ihres
Umrisses an jeder Stelle), Bilder JPEG unverändert, sonst über ein `canvas`
als RGB auf Weiß. `pdfWriter.js` schreibt PDF 1.4 mit Flate über
`CompressionStream`, ohne es unkomprimiert. Was außerhalb des Dialekts liegt
(Text, Verläufe, Clip-Pfade, Bögen, Deckkraft), wird nicht still angenähert,
sondern auf der Druckseite genannt. Die Datei trägt **nur das Notenbild**:
Notizen, Stempel und Tonnamen sind Overlays mit eigener Platzierung, sie in
die PDF zu zeichnen wäre die zweite Platzierung – wer sie auf Papier will,
nimmt den Druckdialog. Gespeichert wird über `Service\SiblingFileService`,
denselben Weg wie die Übe-Tracks ([E13](#e13-übe-tracks-sind-dateien-in-files)):
Schreibrecht im Ordner, bereinigter Name, 409 statt stillem Überschreiben,
Prüfung gegen das Kontingent vor dem Schreiben, keine halbe Datei. Der Server
prüft Größe (`pdf_max_mb`, Vorgabe 50) und den Anfang `%PDF-`; mehr nicht –
eine Datei in Files wird nie ausgeführt.

### E17: Suche über die Konvertierungstabelle

Titel, Untertitel, Komponist und Textdichter einer Partitur stehen in der
globalen Suche von Nextcloud. Nextclouds eigene Dateisuche findet weiter den
Dateinamen; `Search\ScoreSearchProvider` ergänzt, was auf den Noten steht.

**Warum über die eigene Tabelle.** Die Alternativen hätten an die Dateien
selbst geschrieben – Metadaten oder Systemtags. Das braucht Schreibrecht, das
eine Person mit einer Freigabe nur-lesen nicht hat, und es verändert fremde
Dateien. Die Konvertierungstabelle hat eine Zeile je Partitur und kennt Titel
und Komponist ohnehin aus `meta.json`; beide Serverwege laufen durch
`markReady()`, das die drei Spalten füllt (siehe [Datenbank](#datenbank)).
Eine Neukonvertierung aller Partituren für drei Textspalten wäre
unverhältnismäßig gewesen; den Bestand füllt einmal ein Repair-Step.

**Rechte beim Lesen.** Die Tabelle kennt Dateien, keine Personen. Jeder
Treffer wird deshalb im **eigenen** Dateibaum der suchenden Person aufgelöst
(`IRootFolder::getUserFolder()->getById()`); was dort nicht liegt, fällt
spurlos weg – der Provider verrät nie, dass es eine Partitur gibt
([S8](#s8-404-vor-403) sinngemäß). Eine nur-lesend geteilte Partitur liegt im
Baum und wird gefunden. Weil weggefallene Zeilen Lücken lassen, liest der
Provider in bis zu drei Runden nach; der Cursor ist der Zeilenversatz hinter
der letzten gelesenen Zeile.

**Was das kostet und was fehlt.** Ein `LIKE '%…%'` ohne Index (er nützte
nichts) und ein Dateicache-Zugriff je Treffer – für hunderte Partituren
Millisekunden. Eine im Browser konvertierte Partitur
([E7](#e7-konvertierung-im-browser-als-rückfall)) hat keinen Datensatz und
wird nicht gefunden. Die Suche erscheint überall, auf Files-Seiten mit
Reihenfolge 25 (Files hat 5), sonst mit 60, hinter Dateien, Kontakten und
Kalender. Der Treffer öffnet die Datei über `/f/{fileId}` – denselben Einstieg
wie Files ([E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)).

### E18: Deno als zweite Laufzeit, Bun nicht

Der lokale Weg läuft unter Node oder unter Deno. Eingetragen wird Deno im
selben Feld wie Node (`node_path`); die automatische Suche bleibt bei `node`.

**Warum Deno.** Deno kann den Konverter vollständig einschließen –
Dateisystem, Netz, Prozesse und Umgebung –, und zwar in jeder Version ab 2.
Node kann das erst ab 25, die Versionen der Distributionen (Debian 12 und
Ubuntu 24.04: 18, Debian 13: 20, Ubuntu 26.04: 22) lassen das Netz offen oder
kennen gar kein Berechtigungsmodell
([S11](#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis)).
`convert.mjs` läuft unter Deno unverändert, mit derselben Dauer; es gibt
keine Verzweigung nach Laufzeit im Konverter.

**Warum Bun nicht.** Bun läuft den Konverter ebenfalls unverändert, hat aber
kein Berechtigungsmodell. Es brächte nur eine weitere Laufzeit, die CI tragen
müsste, ohne dass der Konverter dadurch irgendetwas weniger dürfte.
`isValidNodePath` lässt den Namen deshalb nicht zu
([S9](#s9-was-programme-startet-oder-adressen-abruft-stellt-nur-ein-voller-admin-ein)).

**Erkannt an der Antwort, nicht am Namen.** Welche Laufzeit vorliegt, sagt
`--version` (`v22.21.1` bzw. `deno 2.9.7 …`), nicht der Dateiname: Ein `node`,
das ein Symlink auf Deno ist, bekäme sonst Node-Flags, die Deno nicht kennt.
Die Regeln je Version stehen an einer Stelle, `Service\ConverterRuntime`, ein
Wert ohne I/O; `LocalConverter` fragt die Laufzeit und startet, was er
zurückbekommt. Deno 1.x wird nicht angenommen (`runtime_version` in der
Diagnose) – seine Node-Kompatibilität ist schwächer und nicht gemessen.

**Was Deno nicht bekommt.** `--no-config` scheidet aus, obwohl es
naheläge: Damit ignoriert Deno auch `package.json`, und der Import der
Engine löst sich nicht mehr auf. `--no-lock` dagegen ist gesetzt: Das
App-Verzeichnis ist signiert, eine dort angelegte `deno.lock` brächte
Nextclouds Integritätsprüfung zum Anschlagen.

### E19: Darstellungsvarianten: dieselbe Zeit, ein anderes Bild

Eine Partitur lässt sich anders setzen als die Datei es tut – **von MuseScore
selbst**, nur mit anderen Vorgaben: als Stimmenauszug, auf Seiten in
Handygröße, klingend notiert oder transponiert. Die Engine kann das seit
`v4.7.5-engine.6` (`setExcerptId`, `generateExcerpts`, `applyView`,
`viewMapping`); E2 bleibt unberührt, denn es ist kein Neusatz im Browser.

**Was eine Variante ist.** Ein zweiter Satz *Bild*-Artefakte derselben
Fassung: Seiten, `timing.json`, `measures.json` und ein `meta.json`, das nur
das Bild beschreibt. **Kein eigenes MIDI** – Mixer, „Meine Stimme“,
Übe-Tracks, Aufnahme, „Folgt mir“ und Intonation hängen an einem Klang, und
ein Stimmenauszug, der nur seine Stimme spielte, bräche das Mitsingen mit den
anderen. Die Variante ändert das Bild, nicht das Stück.

**Vier Achsen, ein Schlüssel.** `<Quelle>~<Format>~<Notation>~<Transposition>`,
etwa `part3~phone~w~-2`:

| Achse | Werte | Engine |
|---|---|---|
| Quelle | `full` · `ex<N>` (gespeicherter Auszug) · `part<id>` (erzeugt) | `setExcerptId` · `generateExcerpts([id])` |
| Format | `orig` · `phone` (105 × 186 mm) · `phonel` (quer) | Seitengröße, Ränder 4 mm, Zeilen- und Seitenumbrüche entfernt (Abschnittsumbrüche bleiben), leere Notenzeilen ausgeblendet |
| Notation | `w` (wie die Datei) · `c` (klingend) | Stil `concertPitch` |
| Transposition | −12 … 12 | nach Intervall, geschrieben wie MuseScores Dialog (`src/view/intervalmap.h`) |

Die Grammatik steht einmal in `converter/lib/variantKey.mjs` (Konverter und
Viewer) und gespiegelt in `Service\VariantKey` (die URL wird zum
Ordnernamen); beide werden gegen dieselben Fälle getestet – eine gemeinsame
Fixture, `tests/fixtures/variant-keys.json`, lesen PHPUnit und Vitest. Nur die kanonische
Schreibweise ist ein Schlüssel, und der Nullpunkt aller Achsen ist keine
Variante, sondern die Grundkonvertierung – sonst gäbe es zwei Adressen für
dieselben Bytes.

**Vier Invarianten** halten Cursor, Taktfeld, Loops, Notizen und „Folgt mir“
in jeder Variante gültig. Der Konverter prüft sie nach jedem Lauf
(`checkVariant`) und schreibt sonst nichts – auf dem Server wie im Browser:

- **I1 Zeitachse.** Jede Ereigniszeit der Variante ist eine der Basis (±1 ms).
  Auszüge teilen Wiederholungsliste und Tempokarte der Hauptpartitur
  (`Score::repeatList()` und `tempomap()` delegieren an den Master).
- **I2 Taktzählung.** Gleiche Takt-Ereignisse und gleiche Takt-Elemente wie die
  Basis – siehe [M13](#m13-auszüge-zählen-takte-über-die-mm-kette).
- **I3 Segmentbezug.** `baseElid` nennt zu jedem Segment der Variante das der
  Basis am selben notierten Tick. Notizen werden **immer gegen die Basis**
  gespeichert und im Bild über die Umkehrung gezeichnet; ohne Gegenstück
  steht eine Notiz am Takt.
- **I4 Notenzeilenbezug.** `staffMap` nennt zu jeder Notenzeile der Variante
  die der Basis, über die Verknüpfung der Auszugs-Notenzeilen mit der
  Partitur.

**Was im Viewer das Bild ist.** `useScoreSession.applyPicture()` tauscht
Seiten, `timing` und `measures`; `pictureMeta` legt die elid- und
notenzeilentragenden Felder der Variante (`noteSpellings`, `lyricSyllables`,
`pageFormat`) über das `meta.json` der Basis, `pictureParts` nennt die
gezeichneten Stimmen. Tonarten, Taktarten, Studierbuchstaben, Tempo und
Stimmen für den Mixer bleiben die der Basis. „Meine Stimme“ als Notenzeile
wird im Bild gesucht: Ein allein gezeichneter Auszug ist dort Notenzeile 0.

**Transponierte Noten, ein Klang.** „Noten mittransponieren“ ist kein
eigener Wert: Der Schlüssel bekommt die Transposition des Klangs
(`practice.transpose`), und der Klang transponiert wie bisher der
Synthesizer. Damit „Ton beim Antippen“ nicht doppelt verschoben klingt,
schreibt der Konverter in die Variante die **Tonhöhe der Basis** und die
**Schreibweise des Bildes** (`toVariantMeta`).

**Wer, wann, wie schnell.** Wer die Datei lesen darf, darf jede Variante
abrufen – sie ist abgeleitet, regenerierbar und für alle gleich. Die
Variantenroute setzt eine fehlende **in der Anfrage**
(`ConvertScoreJob::convertVariant()`, die Wegentscheidung bleibt in der
Klasse aus E3): Die Grundkonvertierung wartet auf den Cron, für einen Wechsel
auf „nur meine Stimme“ wäre das zu lang. Gemessen sind 3–4 s je Lauf
([Grenzwerte](limits.de.md#darstellungsvarianten)). Zwei gleichzeitige Anfragen
für dieselbe Variante ergeben einen Lauf: Der eindeutige Index ist die Sperre,
die zweite Anfrage bekommt `pending` und fragt nach.

**Wo es Varianten gibt.** Überall, wo die Engine konvertiert: auf dem lokalen
Weg, auf dem Sidecar mit der Engine (`POST /variant`, siehe
[Zwei Renderer im Sidecar](#zwei-renderer-im-sidecar)) und im Browser-Rückfall –
der erzeugt Varianten im Tab (höchstens drei,
`useClientConversion.runVariant()`). Ein Sidecar, der mit MuseScore selbst
konvertiert, setzt keine: Stock-MuseScore schreibt weder die Kennungen aus M10
noch `baseElid` und `staffMap`, und die Kommandozeile liefert Auszüge nur als
PDF. Der Status meldet das als Fähigkeit (`variants.supported`), der Viewer
graut die Wahl mit Grund aus und dunkelt wie bisher ab.

**Was gemerkt wird.** Fassung, „klingend“ und „Noten mittransponieren“ je
Person und Partitur bei den Übe-Einstellungen – wer im Tenor singt, will den
Tenorauszug in jedem Stück, auf jedem Gerät. Das **Seitenformat je Gerät**
(`localStorage`): dieselbe Person will auf dem Schreibtisch A4 und auf dem
Handy die Handyseite. Auf einem schmalen Bildschirm bietet der Viewer die
Handyseiten einmal an, statt sie von selbst zu wählen. Drucken und PDF
nehmen die angezeigte Variante (`?variant=`), die Offline-Seite die zuletzt
auf diesem Gerät gezeigte.

**Nicht übernommen: die Endlosansichten.** MuseScores waagrechte und
senkrechte Endlosdarstellung (`LayoutMode::LINE`/`SYSTEM`) setzen die ganze
Partitur auf *eine* Seite. Gemessen an einem vierseitigen Chorsatz: 13 915
statt höchstens 4 170 Knoten in einem SVG, 30 Zoomschritte 980 statt 506 ms –
und das wächst linear, bei 28 Seiten wären es um 100 000 Knoten auf einmal.
Blättern, Doppelseite und Druck hängen am Seitenmodell. Die Handyseite bringt
den Nutzen – größere Noten, Umbruch passend zum Gerät – innerhalb dieses
Modells.

**Nicht als Achse: weitere Stilschalter** (leere Notenzeilen, Liedtextgröße,
Taktnummern). Jede Achse vervielfacht den Cache, und diese Schalter sind
Sache der Datei; das Handyformat blendet leere Notenzeilen von sich aus aus.

### E20: Übetagebuch ohne Bestenliste

Das Übetagebuch zählt, wie lange jemand ein Stück geübt hat, und eine Leitung
kann je Stück ein Wochenziel setzen. Zwei Entscheidungen tragen es.

**Gezählt wird, was klingt.** Die Uhr läuft, während die Partitur spielt oder
eine Aufnahme läuft – nicht, solange die Seite offen ist. Eine offene Seite
auf dem Notenpult ist kein Üben, und Stillstand lässt sich nicht von
Konzentration unterscheiden; Klang schon. Gemessen wird im Browser
(`createPracticeMeter` in `practiceLog.js`; mehr als 120 s zwischen zwei
Blicken auf die Uhr gelten als Schlaf des Geräts, nicht als Übung), gemeldet alle 60 s, beim Verstecken
des Tabs und beim Verlassen der Seite (`keepalive`). Gespeichert wird je
Person, Partitur und **lokalem Kalendertag** als Summe von Sekunden – der Tag
kommt vom Gerät, weil „heute“ für die Sängerin dort endet, wo sie wohnt. Der
Server glaubt ihm nur eingeschränkt: höchstens 300 s je Meldung, höchstens
86 400 s je Tag, nur ein Tag, der höchstens einen Tag vom Serverdatum
abweicht. Mehr als Selbstbetrug verhindert das nicht, und mehr ist nicht
nötig – es sieht ja niemand außer ihr.

**Nur die Person selbst sieht ihre Zeit – auch keine Leitung.** In einem
selbst betriebenen Chorwerkzeug verglichen eine Bestenliste oder eine
Leitungsübersicht Menschen, die dem nie zugestimmt haben, und machten aus
einer Übehilfe eine Anwesenheitskontrolle. Das Wochenziel ist deshalb das
Einzige, was eine Leitung beisteuert: eine Zahl für alle, gegen die jede
Person nur ihre eigene Woche hält. Wer das Ziel gesetzt hat, steht dabei; mit
dem Konto der Leitung verschwindet nur der Name, nicht das Ziel. Die
Serie („Tage in Folge“) zählt über alle Stücke, denn geübt ist geübt.

Aufbewahrt werden 400 Tage, damit ein Jahresvergleich möglich bliebe; die
Ansicht liefert 56. Abschalten lässt es die Verwaltung über
`feature_practice_log` (Vorgabe an: Es fällt nur bei der Person an, die übt,
und zeigt nur ihr etwas).

### E21: Aufnahmen der Leitung für Stimmen

Eine Leitung kann eine **eigene** Aufnahme für bestimmte Stimmen freigeben –
der vorgesungene Alt für den Alt. Es ist die einzige Ausnahme davon, dass
eine Aufnahme nur der gehört, die sie gemacht hat ([S8](#s8-404-vor-403)).

**Warum eine Aufnahme und keine Datei in Files.** Eine Aufnahme kennt ihre
Stelle in der Partitur (`score_start_ms`, `tempo_factor`) und läuft deshalb
synchron mit Cursor und Begleitung – genau das, was eine eingesungene Stimme
zum Üben braucht. Als MP3 in Files wäre sie eine Datei neben anderen, ohne
Bezug zum Takt; dafür gibt es die Übe-Tracks
([E13](#e13-übe-tracks-sind-dateien-in-files)).

**Wie Stimmnotizen.** Die Freigabe trägt die Zielstimmen als `[{id, name}]`
(`shared_parts`, geprüft von `TargetParts` wie bei den Notizen), ausgeliefert
wird an alle mit Dateizugriff, und welche Stimme sie hervorgehoben, gedimmt
oder gar nicht sieht, entscheidet der Browser (`annotationFilter.js`) – ohne
gewählte Stimme gedimmt mit dem Namen der Stimme. Abgespielt werden darf eine
fremde Aufnahme nur, solange sie freigegeben ist
(`RecordingMapper::findListenable`); alles andere an ihr bleibt fremd und
antwortet 404.

**Wer was darf.** Freigeben nur eine Leitung ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)),
und nur die eigene Aufnahme. **Zurücknehmen** darf die Autorin immer, auch
nach dem Verlust der Rolle – sonst bliebe ihre Stimme gegen ihren Willen
hörbar. Löschen bleibt bei ihr, und der Speicher zählt weiter bei ihr
([S5](#s5-aufnahmen-haben-eigene-speichergrenzen)): Eine Freigabe verschiebt
keine Kosten auf die, die zuhören.

### E22: Freihand als Notiz, in Linienabständen

Zeichnen in den Noten – ein Bogen, ein Kreis um ein Intervall, ein Pfeil – ist
eine fünfte Art von Notiz (`kind = drawing`), keine eigene Ebene mit eigenem
Speicher. Damit gelten Sichtbarkeiten samt Stimmen, Obergrenze, Löschort und
Rechte unverändert.

**Verankert wie ein Stempel, gemessen in Linienabständen.** Gespeichert wird
nicht das Bild, sondern Takt und Anteil, wo der erste Strich begann, und die
Striche als Punkte in Linienabständen relativ zu diesem Ursprung – auf der
obersten Linie der Notenzeile, auf der begonnen wurde, mit deren Stimme
(`drawingLayout.js`). Pixel oder Seitenkoordinaten überstünden weder ein
Neurendern noch Handyseiten oder einen Stimmenauszug
([E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)); so wandert
der Ursprung mit dem Takt, und die Größe folgt der Notenzeile. Im Auszug
einer anderen Stimme erscheint eine Zeichnung auf einer Stimmzeile nicht – sie
landete auf fremden Noten. Wo sich Zeilen und Stimmen nicht zuordnen lassen,
ist der Ursprung die Oberkante des Systems; das ist in der vollen Partitur
richtig und im Auszug ungenau, und so steht es in den Grenzen.

**Wenig Daten, voll geprüft.** Die Striche werden vor dem Speichern geglättet
(Ramer-Douglas-Peucker, 0,12 Linienabstände) und auf eine Nachkommastelle
gerundet; 40 Striche und 800 Punkte passen in die 10 000 Zeichen einer Notiz.
Der Server prüft das JSON vollständig (`validateDrawing`): Es geht an alle
Lesenden und wird dort zu SVG-Pfaden, also müssen es Zahlen sein, und wenige.
Geändert wird eine Zeichnung nicht, sondern gelöscht und neu gezeichnet – ein
Bearbeiten ihres Inhalts hieße, Striche einzeln anzufassen, und das lohnt bei
ein paar Strichen nicht.

**Gezeichnet wird auf den Seiten.** Der Zeichenmodus legt über jede Seite
eine Ebene, die den Zeiger nimmt (`touch-action: none`: der Finger zeichnet,
statt zu scrollen); ein zweiter Finger bricht den Strich ab. Systemband und
Liedtext-Ansicht schalten beim Start auf Seiten um; angezeigt werden die
Zeichnungen auch im Band.

### E23: Anheften statt umsortieren

Welches Werkzeug ständig gebraucht wird, hängt an der Person: Wer leitet,
braucht „Folgt mir“, wer allein übt, den Loop, wer im Chor singt, den Mixer.
Eine feste Auswahl in der Leiste passte für keine dieser Rollen ganz, und mehr
Knöpfe trägt die Leiste auf dem Tablet nicht. Deshalb trägt jede Zeile einer
Gruppe eine Nadel: Angeheftete Werkzeuge stehen zusätzlich als Symbolknopf vor
den Gruppen, auf dem Telefon vorn im Werkzeugstreifen. Ein Tipp statt zwei
oder drei.

**Höchstens vier.** Mehr verdrängte die Gruppen und brächte die Leiste auf dem
Tablet in den kompakten Modus. Gezählt wird die gespeicherte Liste, auch was
gerade nicht sichtbar ist – sonst ließe sich auf einer Partitur ohne Ton ein
fünftes Werkzeug anheften, und auf der nächsten stünden fünf da.

**Die Vorgabe ist der Mixer, für die Leitung dazu „Leitung und Folgt mir“.**
Sie gilt, solange jemand nie selbst angeheftet hat (`bar_pins` nicht gesetzt);
eine leere Liste ist eine eigene Wahl. Die Leitung kommt so über die Vorgabe
nach vorn, nicht über eine Gruppenreihenfolge, die je nach Rolle wechselt.

**Dieselbe Regel wie die Gruppen.** Ein angeheftetes Werkzeug steht nur da,
wenn es auch in seiner Gruppe steht (`barPins` in `lib/barGroups.js`) – ein
angehefteter Mixer verschwindet ohne Ton und im Aufführungsmodus wie das
Werkzeug selbst. Was der Knopf tut, folgt der Art des Werkzeugs: Panel und
Schalter schalten direkt, ein Werkzeug mit Unterseite öffnet einen eigenen
Aufklapper gleich auf dieser Seite, eine Aktion läuft. Die Unterseiten stehen
dafür nur einmal im Template (`reusableTemplate.js`) und werden an beiden
Stellen gerendert. Zoom und die Wahl des Anfangstons sind nicht anheftbar: Der
Zoom ist ein Regler und steht schon zuoberst in „Ansicht“, der Anfangston hat
seinen Knopf im Transport.

**Je Nutzerin auf dem Server**, wie die übrigen Anzeigeeinstellungen
(`Service\ViewerPreferences`, nur bekannte Kennungen, höchstens vier): Am
Rechner eingerichtet, gilt die Leiste auch am Tablet. Auf der Offline-Seite
gibt es keine Nadeln – dort lässt sich nichts speichern.

### E24: Sing-Wertung nur für sich

Wer allein übt, will wissen, ob ein Durchgang besser war als der letzte – eine
Zahl, die sich vergleichen lässt, und die Stellen, an denen sie verloren ging.
Die Sing-Wertung bewertet dafür die eigene Stimme **Note für Note** mit
denselben Verfahren wie die Intonation: Tonhöhe wie `evaluateNote`, Einsatz
und Ende wie `evaluateRhythm` (`lib/singScore.js`). Es gibt kein zweites
Verfahren und keine zweite Analyse am Mikrofon; sie liest die Rahmen der
Live-Intonation (`useIntonation.onScoreFrames`), samt dem Pegelverlauf, den
der Worker live mitschickt (`createLevelStream` in `rhythm.js`) – ohne ihn
läge der Einsatz an der stabilen Tonhöhe statt am Silbenbeginn, wie oben bei
**Rhythmus** begründet.

**Gewichtet 60/25/15.** Ton zählt am meisten, weil er im Chor am meisten
auffällt; Einsatz vor Länge, weil ein später Einsatz hörbar ist, ein früh
abgesetzter Ton seltener. Jede Note zählt mit ihrer Dauer, mindestens 250 ms –
sonst entschieden die langen Haltetöne allein. Was nicht zu hören war, zählt
0 %: Schweigen ist kein „nicht auswertbar“, sonst gewänne, wer nur die
sicheren Töne singt. Anders als die Intonation, die eine Note mit weniger
als der Hälfte stimmhafter Rahmen „nicht auswertbar“ nennt, wertet die
Sing-Wertung den Ton schon ab drei stimmhaften Rahmen nach dem Einschwingen:
Eine früh abgesetzte Note ist „zu kurz“, nicht Schweigen (gemessen: auf 40 %
gekürzt hießen sonst alle Noten „nicht gehört“). Im Divisi zählt die
nächstliegende Note des Akkords.

**Die Rückmeldung kommt am Notenende**, als Farbe des Balkens und ein
Stichwort („Perfekt“, „zu tief −40 ct“, „spät“ …), etwa 250 ms nach dem Ende:
Erst dann liegen die Rahmen nach dem Absetzen vor, die das Ende bewerten.
Laufend gezeigt wird nur die gesungene Linie. Ein Urteil schon während der
Note würde die Stimme beim Einschwingen nachregeln lassen.

**Drei Stufen** (Einsteiger, Chor, Streng) weiten oder engen die Grenzen für
Ton und Einsatz; die Werte sind gesetzt, nicht gemessen
([Grenzwerte](limits.de.md#singen-mit-wertung)). Ergebnisse verschiedener Stufen
werden nie miteinander verglichen.

**Gespeichert wird nur ein durchgesungener Durchgang:** vom Anfang des Stücks
oder des Loops bis zu seinem Ende, ohne Sprung, Tempowechsel oder Warte-Modus.
Ein Loop-Umlauf ist ein eigener Durchgang. „Vom Anfang“ heißt: der erste
Rahmen höchstens 250 ms nach der ersten Note – vor dem Start der Wiedergabe
wird nichts analysiert, ein Ton gleich am Anfang hätte sonst nie gezählt.
„Bis zum Ende“ entscheidet beim Anhalten die Position der Wiedergabe, nicht der
letzte Rahmen: Die Rahmen hinken der Uhr um die Analyse nach, am Stückende
läge der letzte noch in der letzten Note. Deren Länge bleibt dann
unbewertet. Alles andere läuft „ohne Wertung“
live mit – wer mittendrin einsteigt, sieht die Farben, aber keine Zahl, die
sich mit einem vollen Durchgang vergleichen ließe. Gespeichert wird die
Zusammenfassung, keine Rahmen und kein Ton (`scoreview_sing_runs`); der
Bestwert gilt je Stufe, Taktbereich und Tempo, weil halbes Tempo leichter ist.
Abgeprüft werden Werte und Stufe, Takte nur formal: Die Taktzahl des Stücks
kennt der Server nicht, ohne die Konvertierung zu lesen.

**Keine Bestenliste.** Wie beim Übetagebuch
([E20](#e20-übetagebuch-ohne-bestenliste)) sieht jede nur die eigenen Zahlen,
auch keine Leitung. Eine Rangliste im Chor misst Mikrofon, Raum und Kopfhörer
mit und macht aus dem Üben einen Wettbewerb, den niemand verlangt hat.

**Zwei Ansichten auf einer Canvas** (`SingLane.vue`): als Band unter der
Partitur, die stehen bleibt, oder als Bühne über ihr mit dem Liedtext der
eigenen Stimme. Kein DOM-Knoten je Note – unter Nextclouds Stylesheet kostet
jeder Knoten (gemessen in 1.26), und die Spur ändert sich mit jedem Bild. Gemalt wird nur in
der Bildschleife des Viewers, die mit der Musik schläft. Welche Ansicht und
welche Stufe, merkt sich der Browser: Das Telefon will die Bühne, das Tablet
das Band.

Der Schalter `feature_sing_score` setzt die Intonation voraus; ist sie aus,
antworten die Routen 404 wie die übrigen abgeschalteten Funktionen.

## Formatgrundlagen

Eigenschaften des MuseScore-Exports, auf denen die Umsetzung aufbaut. Alle gegen
das gebaute Image bzw. die Engine gemessen, nicht angenommen. Die Kennungen
`M1`…`M13` sind im Code referenziert; M5 ist entfallen und bleibt frei,
damit die übrigen Verweise gelten. „Sidecar“ heißt in diesen Abschnitten: der
Sidecar mit MuseScore selbst als Renderer; mit der Engine gilt, was hier für
die Engine steht.

### M1: `--score-media` liefert alles in einem Aufruf

Ein einziger `mscore4portable --score-media`-Prozessstart erzeugt ein JSON mit
allen benötigten Artefakten. (Der Batch-Modus `-j` ist in MuseScore 4 defekt und
kommt nicht in Frage.)

### M2: Schlüssel im `--score-media`-JSON

| Schlüssel | Inhalt | Größe (dekodiert, 5-seitige SATB-Partitur) |
|---|---|---|
| `svgs` | 5 Seiten SVG | 1173 KB |
| `sposXML` | Segmentpositionen | 52 KB |
| `mposXML` | Taktpositionen | 9 KB |
| `midi` | MIDI | **8 KB** |
| `mxml` | MusicXML (komprimiert) | 19 KB |
| `pdf` | PDF | 110 KB |
| `pngs` | 5 Seiten PNG | 10392 KB |
| `metadata` | Titel, Takte, Parts, … | – |

`pngs`, `pdf` und `mxml` werden verworfen: PNG ist der mit Abstand größte Posten
und wird durch SVG ersetzt, MusicXML braucht der Viewer nicht.

`metadata` trägt bei der Engine des lokalen Wegs vier Felder mehr, die
Stock-MuseScore nicht kennt: `keySigs`, `rehearsalMarks`, `lyricSyllables`
und `noteSpellings`
([E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall), Form im
[Artefaktschema](#artefaktschema)). Das `metadata` von MuseScore selbst
(Sidecar mit Renderer `musescore`) hat keines davon.

### M3: stdout ist nicht sauber

MuseScore schreibt rund 12 Zeilen Qt-Logausgabe (Locale-Warnung, DBus-Fehler)
**vor** das JSON auf stdout; das JSON beginnt erst bei Byte-Offset ~905. Ein
naives `json.load(stdout)` schlägt fehl – der Parser schneidet ab dem ersten
`\n{\n`. Bekanntes MuseScore-Verhalten (Issue #13304), das nicht per Zufall
funktionieren darf.

### M4: Koordinaten passen mit Faktor 12 auf das SVG

Die entscheidende Eigenschaft für den gesamten Viewer. Die SVG-`viewBox` ist
`0 0 10200 13200`, spos-Koordinaten liegen im Bereich 15447–112357. Division
durch 12 trifft die SVG-Koordinaten exakt:

```
Seite 0: SVG-Notenlinie y=2148.84   spos y/12 = 2148.83
Seite 1: SVG-Notenlinie y=1287.33   spos y/12 = 1287.25
Seite 2: SVG-Notenlinie y=1287.33   spos y/12 = 1287.25
```

Ein Element ist damit als Rechteck `(x/12, y/12, sx/12, sy/12)` auf Seite `page`
adressierbar – ohne Kalibrierung, ohne Heuristik. Das trägt Cursor-Overlay,
Klick-auf-Note und Notizanker. Der Sidecar teilt bereits, der Client rechnet
nicht um.

### M6: Der Mixer bekommt seine Struktur frei Haus

`metadata.tracks` liefert die Zuordnung Track → Part inklusive Metronomspur:

```json
[{"instrumentId":"soprano","partId":"1","name":"MS Basic","type":"fluid_soundfont"},
 {"instrumentId":"alto",   "partId":"2", "...": "..."},
 {"instrumentId":"metronome","partId":"999", "...": "..."}]
```

Dazu kommen aus `metadata.parts` die Angaben `instrumentId`, `isVisible`,
`lyricCount`, `hasDrumStaff`. Die Mixer-UI ist damit ohne eigene Analyse des
MIDI-Files baubar.

Die scoreview-engine lässt `tracks` gemessen immer leer; der Mixer geht
deshalb in der Regel über `parts`.

**Die MIDI-Kanalnummer ist aber nicht der Index in `tracks`.** An einer
fünfstimmigen Partitur gemessen: Sopran/Alt/Tenor/Bariton/Bass liegen auf den
MIDI-Kanälen 0/2/3/1/6, nicht auf 0–4. `resolveMixerChannels()` leitet die
Kanäle deshalb aus `score.mid` selbst ab (`midiNotes.js::readTrackLayout()`),
nicht aus der Position in der Liste. Drei weitere Befunde an einer selbst
gebauten Partitur (Flöte und Klavier mit Akkordsymbolen, Kontrabass):

- **Eine Stimme spielt auf mehreren Kanälen.** MuseScore gibt jedem Klang eines
  Instruments einen eigenen Kanal (Kontrabass: arco, pizzicato, tremolo auf
  3/4/5), und Akkordsymbole bekommen noch einen, `harmony`, ans Ende der
  Kanalliste angehängt. Eine Mixerzeile trägt alle Kanäle ihrer Stimme; der
  Akkordkanal wird eine eigene Zeile „Akkordsymbole“ und zählt nicht als
  „Meine Stimme“. Vorher regelte jede Zeile nur den ersten Kanal, und die
  Akkorde ließen sich nicht abschalten.
- **Die Kanäle stehen in der Reihenfolge ihrer Einrichtung**, nicht ihrer
  ersten Note: Jeder Kanal beginnt in der Spur mit einem eigenen Block bei
  Tick 0 (CC121, Programm, CC7), in der Reihenfolge der Kanalliste. Der
  Akkordkanal ist deshalb der zuletzt eingerichtete Kanal der Spur. Seine
  Nummer verrät ihn nicht: Flöte 0 → Akkorde 1, Klavier 2 → Akkorde 6. Die
  Kanalliste von spessasynth (`track.channels`) kennt nur Kanäle mit Noten und
  ordnet sie nach der ersten Note. Bei einer Melodie, die mit einer Pause
  beginnt, stand der Akkordkanal dort vorn.
- **Eine Stimme kann mehrere Spuren haben**, eine je System: das Klavier zwei.
  Eine Spur ohne eigenen neuen Kanal setzt die Stimme davor fort. Nur wenn
  dabei genau eine Gruppe je Stimme herauskommt, gilt die Zuordnung; sonst
  bleibt, sichtbar falsch statt stumm falsch, der Index.

### M7: Wiederholungen rollen sich aus, D.C./D.S./Coda nicht

Bei einer Wiederholung erscheint dasselbe `elid` mit mehreren `position`-Werten.
Für den Overlay-Cursor ist das der **Normalfall**, kein Sonderfall: Derselbe
Notenkopf wird zu zwei Zeitpunkten angesteuert.

Gemessen an einer fünftaktigen Testpartitur (Wiederholung + Volta 1/2): 20
Notenelemente, aber 24 Events; die vier `elid` aus Takt 1 erscheinen exakt
zweimal mit streng monoton steigenden Zeiten, Volta 1 nur im ersten, Volta 2 nur
im zweiten Durchgang. `mposXML` zeigt dieselbe Struktur auf Taktebene, und die
exportierte MIDI bestätigt sie exakt (24 Note-on-Events, 11520 Ticks bei 480
Ticks/Viertel = 24 Viertel). Zwischen MIDI und Timing gibt es damit **kein
Interpolations- oder Rundungsrisiko** – beide Exporte laufen durch denselben
internen Wiedergabe-Ablauf.

**Bekannte Lücke:** D.C./D.S./Coda-Sprünge werden nicht in zusätzliche Events
aufgelöst – jedenfalls nicht mit handgeschriebenem MusicXML als Eingabe.
MuseScore übernimmt ein von Hand gesetztes `<sound dacapo="yes"/>` beim Import
nicht als Wiedergabe-Sprung. Ob eine in der MuseScore-GUI angelegte
Jump/Marker-Struktur ausgerollt wird, ist ungeprüft. Der Cursor-Code darf sich
deshalb **nicht auf lückenlose `elid`-Abdeckung verlassen**; siehe
[Grenzwerte](limits.de.md#bekannte-lücken).

### M8: `metadata` trägt Tempo und Titel, `tracks` ist aber nicht garantiert

Gemessen an drei Partituren:

| Partitur | `tempo` | `tempoText` | `tracks` | `parts` | `measures` | `pages` | `duration` |
|---|---|---|---|---|---|---|---|
| `repeat-test` | **0** | (leer) | **0** | 1 | 5 | 1 | 12 |
| 4-seitig | 180 | `<sym>metNoteHalfUp</sym> = 90` | 6 | 5 | 58 | 4 | 77 |
| 5-seitig | 80 | `<sym>metNoteQuarterUp</sym> = 80` | 5 | 4 | 63 | 5 | 191 |

Vier Eigenschaften mit Folgen für den Viewer:

1. **`tempo` ist Viertel-BPM** – 180 bei notiertem „halbe = 90", 80 bei
   „Viertel = 80". Die BPM-Anzeige steht damit auf echten Daten.
2. **`tempo` kann 0 sein**, wenn die Partitur keine Tempoangabe enthält. Die
   BPM-Eingabe nimmt dann MuseScores Vorgabe 120 an **und macht kenntlich, dass
   der Wert geraten ist**.
3. **`tempoText` ist kein anzeigefertiger Text**, sondern trägt SMuFL-Markup
   (`<sym>…</sym>`) und einen `<font face="Edwin"/>`-Rest.
4. **`tracks` kann leer sein, während `parts` gefüllt ist.** Ohne Fallback gäbe
   es dann Ton, aber keinerlei Lautstärkeregelung – kein theoretischer Fall.

`duration` ist in Sekunden, `pages` deckt sich mit der Zahl der gelieferten
SVG-Seiten (Grundlage von `ConversionService::getPageCount()`).

### M9: Stock-MuseScore adressiert nur über den Elementtyp

Im gesamten Dokument steht kein einziges `id="…"`-Attribut. Adressierbar ist nur
über `class` (`Note`, `BarLine`, `StaffLines`, `Clef`, …) – eine Kategorie, kein
Bezug zu einer einzelnen Note. Eine Hervorhebung des klingenden Notenkopfs ist
damit nicht möglich; es bleibt beim Overlay. **Das gilt weiterhin für den
Sidecar mit MuseScore als Renderer**; was die Engine daran ändert, steht in
[M10](#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg).

Für die Overlay-Umsetzung wichtig: Das allererste Element im Dokument ist ein
deckendes weißes Hintergrundrechteck über die volle `viewBox`. Ein Cursor-Overlay
hinter dem SVG bleibt ohne eine Gegenregel unsichtbar – und zwar auf **beiden**
Wegen, die es nur unterschiedlich schreiben:

| | Sidecar | Engine |
|---|---|---|
| Markup | `<path class="">` | `<path fill="#ffffff">` ohne `class` |
| Adressierbar über | `path[class=""]` – als einziges Element mit leerem `class`-Attribut eindeutig | `svg > path[fill="#ffffff"]` – beide Merkmale nötig: ein Bogen ist ebenfalls ein classloses `<path>`, liegt aber in einer Gruppe |

Gemessen: je Seite genau ein Treffer. `ScorePage.vue` nimmt beide Formen auf
`fill: none` zurück.

### M10: Die Engine schreibt Segment, Notenzeile und Stimme ins SVG

Auf dem lokalen Weg trägt jedes gezeichnete Element zusätzlich zu seinem Typ
drei Kennungen: `class="Note seg-42 st-1 vc-0"`.

- **`seg-N`** ist genau die `elid` aus `timing.json` – dieselbe laufende Nummer
  über die ChordRest-Segmente. Beide Exporte zählen sie an einer Stelle
  (`src/positions/segmentindex.h` in der Engine), statt getrennt zu zählen und
  zufällig übereinzustimmen.
- **`st-N`** ist die Notenzeile, **`vc-N`** die Stimme innerhalb der Zeile.
  Beide fehlen bei Elementen ohne Track (Titel, Seitenzahlen).

Damit ist die Umkehrung von [M4](#m4-koordinaten-passen-mit-faktor-12-auf-das-svg)
nicht mehr nur geometrisch möglich: Zu einem Zeitpunkt liefert `timing.json` die
`elid`, und die zeigt direkt auf die Knoten, die dafür gezeichnet wurden.

An der Selbsttest-Partitur gemessen (`v4.7.5-engine.2`): 20 Segmente, 44
Elemente mit Kennung, **jede Kennung hat ein Element in `spos`, und kein
`spos`-Element bleibt ungezeichnet**. Der größte Abstand zwischen einem
Notenkopf und der x-Position seines Segments beträgt **0,98 SVG-Einheiten** bei
107–162 Einheiten Segmentbreite – eine um eins verschobene Nummerierung läge
ein ganzes Segment daneben und fiele sofort auf. Genau das prüft der Selbsttest
(`converter/lib/artifacts.mjs`), und zwar in beide Richtungen.

Der Viewer setzt darauf auf, ohne sich darauf zu verlassen: Findet
`src/lib/svgIndex.js` keine Kennungen, bleibt es beim Cursor-Band. Leuchten
dagegen die Notenköpfe, malt das Band nichts mehr – zwei Anzeigen derselben
Stelle sind eine zu viel. Im DOM bleibt es trotzdem, denn das Autoscroll misst
seine Bildschirmposition (`getCursorClientRect()`). Wer lieber das Band sieht,
stellt das um (siehe [Browserseite](#browserseite)); dann bleiben die Notenköpfe
schwarz, obwohl die Kennungen da sind.

**Wo die Kennung hängt, ist nicht überall gleich** – für das Einfärben per CSS
der entscheidende Unterschied, an ausgelieferten Seiten beider Formen
nachgesehen:

| | Klasse sitzt an | Gezeichnet wird |
|---|---|---|
| Sidecar-Form | dem gezeichneten Element selbst | `<path class="Note seg-7 …">`, `<polyline class="Stem …" fill="none" stroke="#000000">` |
| Engine-Form | einer Gruppe darum | `<g class="Note seg-7 …"><g transform><use fill="#000000"/></g></g>` |

In der Engine-Form trägt eine `fill`-Regel an der Gruppe **nicht**: Das
`fill`-Attribut am `<use>` gewinnt gegen einen geerbten Wert, und die Note bliebe
schwarz. `ScorePage.vue` färbt deshalb zusätzlich die Nachfahren – und dort
genau das, was überhaupt Farbe trägt, sonst würde ein Notenhals
(`fill="none"`) als Fläche ausgemalt.

**`st-` und `vc-` werden gebraucht, wo es um eine Stimme geht.** Die
Intonation färbt die Notenköpfe der eigenen Stimme: zum Zeitpunkt einer Note
liefert `timing.json` das Segment, `st-` die Notenzeile darin
(`svgIndex.js` baut dafür eine zweite Karte Segment → Zeile → Knoten). Ohne
`st-` bleibt die Karte leer, und die Intonation bleibt bei Nadel und Liste.

**Die Notenlinien stehen in der Engine-Form ebenfalls anders.** Wo die Zeilen
liegen, liest `staffBands.js` aus den `StaffLines` – die Grundlage für
„Meine Zeile“, die Größe der Stempel und die Zuordnung Zeile → Stimme:

| | Form |
|---|---|
| Sidecar | `<polyline class="StaffLines" points="1489.73,2148.84 9491.34,2148.84"/>`, absolute Punkte |
| Engine | `<g class="StaffLines st-0 vc-0"><g transform="matrix(1 0 0 1 1345.086 1303.268)"><polyline points="0,0 7873.422,0" …/></g></g>`, Klasse an der äußeren Gruppe, Lage als Transformation der inneren, Punkte relativ dazu |

Beide Formen werden gelesen. Nur die erste zu kennen hieß gemessen: auf dem
lokalen Weg 0 statt 10 Notenzeilen je Seite einer SATB-Partitur.

### M11: Was MIDI und SVG über Studierbuchstaben und Tonarten tragen

Gemessen an `keys-marks-test.mscz` (c-Moll, Wechsel nach D-Dur in Takt 4,
Studierbuchstaben A/B/C, eine Wiederholung) auf beiden Wegen:

- **Das MIDI trägt Studierbuchstaben als Marker (`FF 06`)** und Tonarten als
  Vorzeichen-Ereignis (`FF 59`) – ausgerollt wie `timing.json`: Marker A, A, B,
  C (A doppelt, weil die Wiederholung ausgerollt ist), Tonarten −3, −3, 2.
  **Das Modus-Byte von `FF 59` ist überall 0**, also Dur, auch für c-Moll: Ob
  Dur oder Moll gemeint ist, lässt sich dem MIDI nicht entnehmen.
- **Das MIDI des Sidecars ist byteweise identisch** mit dem des lokalen Wegs
  (Sidecar-Image mit MuseScore 4.7.5). Der Rückfall aus
  [E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall) liefert auf
  beiden Wegen also dasselbe.
- **Im SVG stehen `RehearsalMark` und `KeySig` ohne `seg-`**, und den Text
  eines Studierbuchstabens gibt es dort nur als Glyphenpfad. Auslesen ließe er
  sich nur über eine Glyphenerkennung – deshalb die Felder in `meta.json`.
- **`meta.json` von MuseScore selbst hat weder `keySigs` noch `rehearsalMarks`.**
- **Das MIDI trägt Taktarten als `FF 58`**, je Wechsel und ausgerollt wie die
  Marker (gemessen an `timesig-test.mscz` und `keys-marks-test.mscz` mit
  der Engine, deren MIDI dem des Sidecars byteweise gleicht): 4/4 bei Tick 0,
  3/4 bei 2400, 6/8 bei 3840, und nach einer ausgerollten Wiederholung die
  Taktart erneut am Beginn des zweiten Durchgangs. **Einen Auftakt schreibt
  MuseScore als eigene Taktart seiner Länge** – ein Viertel Auftakt in 4/4
  erscheint als `1/4` bei Tick 0 und `4/4` bei Tick 480. Aus dem MIDI lässt
  sich also die Taktart jedes Takts gewinnen, nicht aber die *nominelle*
  Taktart eines Auftakts; dafür gibt es `measureFacts`.
- Ein MIDI-Marker liegt gerechnet oft einen Bruchteil einer Millisekunde vor
  dem Taktanfang (Gleitkomma aus der Tempokarte), `measures.json` auf ganzen
  Millisekunden. Ohne 1 ms Zugabe landete ein Buchstabe gelegentlich im Takt
  davor (`scoreFacts.js`).

### M12: Liedtext steht im SVG nur als Glyphen

Gemessen an `lyrics-test.mscz` (Sopran und Bass, Takt 1–2 dreimal wiederholt
mit drei Strophen, Schluss „A-men“) auf beiden Wegen:

| | lokal (Engine) | Sidecar |
|---|---|---|
| Liedtext-Gruppen im SVG | 76 × `<g class="Lyrics seg-N st-N vc-N">` – 56 Silben und 20 Linien zwischen und hinter Silben (`LyricsLineSegment`) | 76 × `<g class="Lyrics">`, ohne `seg-` |
| Silbentext lesbar | nein – Glyphen als `<use>` | nein, ebenso Glyphen |
| Strophennummer | keine; nur die senkrechte Lage ordnet die Strophen | keine |
| `meta.json` `lyrics` | ein flacher String aller Strophen beider Stimmen, Silben zusammengezogen | dasselbe |

Aus den übrigen Artefakten lässt sich damit **kein Liedtext rekonstruieren** –
weder Wörter noch die Zuordnung Silbe ↔ Strophe ↔ Stimme. Deshalb schreibt die
Engine `lyricSyllables`
([E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)); mit MuseScore
selbst auf dem Sidecar gibt es die Liedtext-Ansicht nicht
([E15](#e15-fähigkeiten-statt-weg)). Das Timing rollt die Wiederholung
korrekt aus (28 Ereignisse = 3 × 8 + 4,
[M7](#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht)); daraus folgt, welche
Strophe bei welchem Durchgang klingt.

**Die Notenköpfe im SVG stehen in derselben Reihenfolge wie
`noteSpellings`**, einschließlich Vorschlags- und Ornament-Hilfsnoten: Über den
vtest-Korpus der Engine (838 Dateien, 14 254 Noten) stimmt die Zahl der Köpfe
je Segment, Notenzeile und Stimme mit dem SVG überein. Darauf beruht die
Zuordnung der Tonnamen der Reihe nach; der Selbsttest prüft sie an
`lyrics-test.mscz`. Der Modus einer Tonart steht weiterhin nicht im MIDI
([M11](#m11-was-midi-und-svg-über-studierbuchstaben-und-tonarten-tragen)) –
für das relative Do wird er nicht gebraucht.

### M13: Auszüge zählen Takte über die MM-Kette

Der Positionsschreiber der Engine nummeriert Takte und Segmente über die
Kette mit Mehrtaktpausen (`firstMeasureMM`, `next1MM`). Eine Mehrtaktpause
ist dort **ein** Takt. Stimmenauszüge haben Mehrtaktpausen per Voreinstellung
(`createMultiMeasureRests`), die Partitur meist nicht – gemessen an
`parts-test.mscz`: Die Klarinette pausiert in den Takten 14–21 und zeichnet
dafür eine Pause „8“. Ein `measures.json` des Auszugs nach der eigenen Kette
hätte 17 statt 24 Takte, und jeder Takt ab 14 stünde unter falscher Nummer.

Deshalb zählt `savePositions(false, true)` die Takte **nach der Kette der
Hauptpartitur** und gibt jedem den Kasten dessen, was der Auszug an diesem
Tick zeichnet: Takt 14 bis 21 zeigen alle auf die Mehrtaktpause. Die
Takt-Ereignisse sind damit Byte für Byte die der Basis (I2). Die
Segment-Ereignisse bleiben die des Auszugs – unter einer Mehrtaktpause
gibt es ein Segment, und der Cursor steht dort, solange sie dauert.

Ein Abschnittsumbruch beginnt die **angezeigte** Taktnummer wieder bei 1
(`parts-test.mscz`: Takte 13–24 tragen 1–12). Das ändert an der Zählung nichts:
`measures.json` zählt Takte der Reihe nach, nicht ihre Beschriftung.

## Artefaktschema

`timing.json` und `measures.json` haben dieselbe Form (mit MuseScore als Renderer
erzeugt ein gemeinsamer Parser im Sidecar beide aus `sposXML` bzw. `mposXML`,
die Engine schreibt sie über `converter/lib/artifacts.mjs` gleich in dieser
Form):

```json
{
  "events": [{"elid": 0, "timeMs": 0}, "..."],
  "elements": {
    "0": {"page": 0, "x": 1122.05, "y": 2114.17, "w": 2182.33, "h": 330.71}
  }
}
```

`events` ist nach `timeMs` sortiert. Koordinaten sind bereits durch 12 geteilt
([M4](#m4-koordinaten-passen-mit-faktor-12-auf-das-svg)) und liegen direkt in
SVG-Einheiten der zugehörigen `page-N.svg`-`viewBox`.

Ein `elid` kann in `events` mehrfach auftreten
([M7](#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht)). Ein einzelnes `elid`
in `elements` deckt alle Vorkommen ab, weil es exakt eine
Notenkopf-/Takt-Position auf der Seite beschreibt – unabhängig davon, wie oft sie
beim Abspielen durchlaufen wird.

`timing.json` treibt den Cursor, `measures.json` die Taktnavigation.

`meta.json` ist das `metadata`-Objekt des Konverters, unverändert
([M8](#m8-metadata-trägt-tempo-und-titel-tracks-ist-aber-nicht-garantiert)).
Die Engine des lokalen Wegs ergänzt fünf Felder
([E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)), zuerst zwei
für Tonarten und Studierbuchstaben:

```json
"keySigs":        [{"measure": 1, "tick": 0,    "concertKey": -3, "mode": "minor"},
                   {"measure": 4, "tick": 5760, "concertKey":  2, "mode": "major"}],
"rehearsalMarks": [{"measure": 1, "tick": 0,    "text": "A"},
                   {"measure": 3, "tick": 3840, "text": "B"}]
```

- Beide stammen aus dem ersten Staff. `concertKey` ist die klingende Tonart als
  Vorzeichenzahl (−7…7), `mode` MuseScores `KeyMode` (`major`, `minor`,
  `dorian` …) oder `null`, wo MuseScore keinen kennt. `text` ist der
  Studierbuchstabe ohne Formatierung.
- `measure` ist die **notierte** Taktnummer, 1-basiert, `tick` notiert und
  nicht ausgerollt. Ohne Mehrtaktpausen ist das dieselbe Zählung wie in
  `measures.json`; mit ihnen nicht, siehe E12.
- Fehlen die Felder (Sidecar mit MuseScore, Konvertierung mit einer älteren Engine), ist das
  kein Fehler – der Viewer nimmt dann das MIDI.

Dann zwei für Liedtext und Schreibweisen (ab `v4.7.5-engine.4`):

```json
"lyricSyllables": [{"elid": 0, "staff": 0, "voice": 0, "verse": 0,
                    "syllabic": "begin", "text": "Hal", "melisma": false}],
"noteSpellings":  [{"elid": 3, "staff": 0, "voice": 0, "tick": 1440, "notes": [[67, 15], [71, 19]]}]
```

- `elid` ist dieselbe Segmentnummer wie in `timing.json` und `seg-N` im SVG
  ([M10](#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)),
  `staff` und `voice` entsprechen `st-N` und `vc-N`.
- `lyricSyllables` enthält jede sichtbare Silbe auf einer gezeichneten
  Notenzeile, geordnet nach `elid`, Notenzeile, Stimme und Strophe. `verse`
  zählt ab 0, `syllabic` nimmt MuseScores Vokabular (`single`, `begin`,
  `middle`, `end`) – ein Wort endet genau dort, wo MuseScore keinen
  Silbenstrich zeichnet –, `melisma` sagt, dass eine Haltelinie folgt, `text`
  ist die Silbe ohne Formatierung. Über 20 000 Silben fehlt das Feld ganz,
  statt abgeschnitten zu werden: Ein halber Text wäre schlimmer als keiner, und
  „zu viel“ (Feld fehlt, `hasLyrics` wahr) bleibt von „keiner“ (leere Liste)
  unterscheidbar.
- `noteSpellings` nennt je Segment, Notenzeile und Stimme die Notenköpfe in der
  Reihenfolge des SVG ([M12](#m12-liedtext-steht-im-svg-nur-als-glyphen)) als
  `[pitch, tpc]`: `pitch` ist die klingende MIDI-Tonhöhe (wie im MIDI),
  `tpc` MuseScores „tonal pitch class“ der Note, wie sie im Notenbild steht
  (14 = C, 21 = Fis, 13 = F, eine Quinte je Schritt).
- Fehlen die Felder, gibt es Liedtext-Ansicht und Tonnamen nicht
  ([E15](#e15-fähigkeiten-statt-weg)); einen Rückfall aus dem MIDI gibt es
  dafür nicht.

Und eines für die Taktart je Takt (ab `v4.7.5-engine.5`), dazu je
`noteSpellings`-Eintrag der notierte `tick` seines Segments:

```json
"measureFacts": [{"measure": 1, "tick": 0,    "sigN": 4, "sigD": 4, "ticks": 480},
                 {"measure": 2, "tick": 480,  "sigN": 4, "sigD": 4, "ticks": 1920},
                 {"measure": 3, "tick": 2400, "sigN": 3, "sigD": 4, "ticks": 1440}]
```

- Ein Eintrag je **notiertem** Takt, gezählt wie `keySigs`; `sigN`/`sigD` ist
  die nominelle Taktart, `ticks` die tatsächliche Länge (480 je Viertel) –
  ein Auftakt ist kürzer als seine Taktart sagt, ein unregelmäßiger Takt
  länger. Aufeinanderfolgende Einträge schließen lückenlos aneinander an.
- `tick` am Segment liegt auf derselben Skala: Wo im Takt ein Akkord steht,
  ist `tick − measureFacts[i].tick`, exakt und ohne Umweg über Zeit und Tempo.
  Darauf bauen Metronom-Schläge nach Taktart und Zählzeiten auf.
- Fehlt das Feld (Sidecar mit MuseScore, ältere Engine), schätzt der Viewer die Schläge aus
  der Taktdauer und liest Taktartwechsel aus dem MIDI
  ([M11](#m11-was-midi-und-svg-über-studierbuchstaben-und-tonarten-tragen)).

Zwei für die Darstellungsvarianten (ab `v4.7.5-engine.6`,
[E19](#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)):

```json
"excerpts":            [{"id": 0, "name": "Sopran", "partIds": ["1"]},
                        {"id": 1, "name": "Frauenstimmen", "partIds": ["1", "2"]}],
"hasTransposingParts": true
```

- `excerpts` sind die in der Datei gespeicherten Auszüge, in der Reihenfolge,
  in der `ex<N>` sie adressiert; `partIds` sind die `id`s aus `parts`.
- `hasTransposingParts`: ob irgendeine Stimme irgendwo nicht klingt, wie sie
  notiert ist – nur dann bietet der Viewer „klingend“ an.

Das `meta.json` einer **Variante** beschreibt nur ihr Bild:

```json
{
  "variant": "part3~phone~w~-2",
  "pages": 1,
  "pageFormat": {"width": 105, "height": 186},
  "keySigs": [...], "noteSpellings": [...], "lyricSyllables": [...],
  "parts": [{"id": "3", "name": "Klarinette in B"}],
  "baseElid": {"0": 0, "1": 4},
  "staffMap": [2]
}
```

- `noteSpellings` und `lyricSyllables` tragen die `elid`s und Notenzeilen der
  Variante; `pitch` ist die Tonhöhe der Basis, `tpc` die Schreibweise des
  Bildes (E19). `keySigs` sind die des Bildes – der Viewer nimmt die der
  Basis und transponiert sie selbst.
- `parts` sind die gezeichneten Stimmen in Notenzeilen-Reihenfolge,
  `baseElid` und `staffMap` die Bezüge I3 und I4.

Welche Fassung dieses Schemas ein Cache-Eintrag hat, hält `format_version` fest
(`CURRENT_FORMAT_VERSION` = 6, [Konvertierung und Cache](#konvertierung-und-cache);
Varianten `VariantService::FORMAT_VERSION` = 1).

## Weiter

- [Grenzwerte und bekannte Einschränkungen](limits.de.md)
- [Installation und Konfiguration](installation.de.md)
- [Entwicklung](development.md)
- [Sidecar: Betrieb und HTTP-API](../sidecar/README.md)
