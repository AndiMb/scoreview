# Architektur

Wie ScoreView aufgebaut ist, welche Entwurfsentscheidungen dahinterstehen und
auf welchen Eigenschaften des MuseScore-Exports die Umsetzung aufbaut. Dieses
Dokument beschreibt den Stand der App, nicht ihren Entstehungsweg.

## Überblick

ScoreView besteht aus diesen Teilen:

| Teil | Wo | Aufgabe |
|---|---|---|
| Nextcloud-App | `scoreview/lib/` (PHP) | Konvertierung anstoßen, Ergebnis cachen, Artefakte ausliefern, Notizen, Leitungen, „Folgt mir“, Setlisten und Aufnahmen verwalten |
| Viewer | `scoreview/src/` (Vue 3) | Notenseiten anzeigen, MIDI im Browser synthetisieren, Cursor führen, Mikrofon auswerten |
| Sidecar | `sidecar/` (Python + MuseScore 4) | `.mscz` übersetzen – im eigenen Container |
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
   |  invalidiert nur den Cache, er konvertiert nicht selbst
   v
Konvertierung - einer von zwei Wegen, gleiche Artefakte (E3)
   |
   |  Sidecar: ein mscore-Aufruf --score-media
   |     -> svgs[] · midi · sposXML · mposXML · metadata
   |     (pngs/pdf/mxml werden verworfen)
   |  Lokal:   ein node-Prozess mit der scoreview-engine (MuseScore als Wasm)
   |     -> saveSvg() · saveMidi() · savePositions() · metadata()
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
   +- Mikrofon: Aufnahmen (IAppData), Intonation (nur im Browser)
```

**Leitprinzip: Das Frontend kennt ausschließlich die HTTP-API der App.** Es
verzweigt an keiner Stelle danach, welcher Konvertierungsweg gelaufen ist. Genau
deshalb konnte der zweite Weg
([E3](#e3-zwei-konvertierungswege-hinter-einer-api)) ein reiner Backend-Austausch
bleiben, ohne eine einzige Zeile im Viewer. Diese Trennung bitte nicht
aufweichen. Der Statusendpunkt *nennt* den Weg inzwischen (`renderer.backend`),
und der Viewer *zeigt* ihn an – das ist eine Angabe für Menschen, keine
Verzweigung; was der Viewer tut, hängt weiterhin allein an den Artefakten.

## Serverseite

### HTTP-API

Alle Routen liegen unter `/apps/scoreview/api/` und stehen in
`scoreview/appinfo/routes.php`. Die App hat bewusst **keine eigene Seite** und
keinen Navigationseintrag; `/apps/scoreview/` antwortet 404. Eingestiegen wird
auf vier Wegen, und alle vier zeigen **dieselbe Komponente**:

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
sich jede Route exakt wie vorher. Die Spalte „Token“ unten nennt, was eine
Route mit Token annimmt; Einzelheiten in
[E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps).

| Route | Zweck | Token |
|---|---|---|
| `GET /api/scores/{fileId}/status` | Konvertierungsstatus, Seitenzahl, Metadaten | ja |
| `GET /api/scores/{fileId}/artifact/{name}` | Ein Artefakt aus dem Cache (`page-N`, `midi`, `timing`, `measures`, `meta`) | ja |
| `GET /api/scores/{fileId}/source` | Die `.mscz` selbst – nur für die Konvertierung im Browser ([E7](#e7-konvertierung-im-browser-als-rückfall)) | ja |
| `GET /api/engine/{name}` | Die drei Dateien der scoreview-engine, für denselben Weg (**ohne Anmeldung** – appeigene Bauartefakte, für alle dieselben Bytes; ein nativer `import()` kann keinen Ausweis tragen) | – |
| `POST /api/scores/{fileId}/reconvert` | Verwirft die gespeicherte Konvertierung und lässt sie neu erzeugen (nur mit Schreibrecht auf die Datei) | – |
| `GET /api/soundfont` | Das SoundFont für die Browser-Wiedergabe | ja |
| `GET\|POST\|PUT\|DELETE /api/scores/{fileId}/annotations[/{id}]` | Notizen und Stempel; Sichtbarkeit `parts` nur für Leitungen ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) | ja |
| `GET\|PUT /api/scores/{fileId}/my-part` | „Meine Stimme“ je Partitur und Nutzerin | ja |
| `GET\|POST /api/scores/{fileId}/leaders`, `DELETE …/leaders/{uid}` | Leitungen lesen, ernennen, abberufen ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) | ja |
| `GET /api/scores/{fileId}/leader-candidates?q=` | Nutzersuche für die Ernennung, nur Leitungen, 30 Aufrufe je Minute | ja |
| `GET\|POST\|PATCH\|DELETE /api/scores/{fileId}/follow`, `POST …/follow/join` | „Folgt mir“: Zustand lesen (alle mit Dateizugriff), Sitzung führen (Leitung), für Push anmelden ([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)) | ja |
| `GET\|POST /api/scores/{fileId}/recordings`, `GET\|DELETE …/recordings/{id}` | Eigene Aufnahmen – nur die eigenen, fremde antworten 404 | ja |
| `GET\|PUT /api/setlists/{fileId}` | Setliste lesen (aufgelöst aus Sicht der Nutzerin) und schreiben ([E11](#e11-die-setliste-als-markdown-datei)) | Setlisten-Begleit-Token; schreibend nur mit Einträgen um die Partitur herum |
| `POST /api/setlists` | Neue Setliste anlegen | nur im Ordner der Token-Datei, ohne Begleit-Token |
| `GET /api/scores/{fileId}/setlists` | Setlisten im Ordner der Partitur, die sie enthalten | ja, ohne Begleit-Token |
| `GET /api/scores/{fileId}/score-candidates` | Partituren um die offene herum, für den Setlisten-Editor | ja, ohne Begleit-Token |
| `POST /api/scores/{fileId}/setlists/{setlistId}/tokens` | Begleit-Token für die Stücke einer Setliste ausgeben | **nur** Direct-Editing-Token |
| `POST /api/preferences` | Anzeigeeinstellungen der Nutzerin (nur schreibend – gelesen aus dem Anfangszustand der Seite) | ja, ohne Begleit-Token |
| `POST /api/settings` | Admin-Einstellungen speichern | – |
| `GET /api/health`, `POST /api/selftest` | Betriebsdiagnose, Sidecar-Selbsttest (nur Admins) | – |

Die Endpunkte von „Folgt mir“, Aufnahme und Intonation hängen an je einem
Schalter der Verwaltung (`FeatureConfig`). Ist er aus, antworten sie 404, und
der Viewer zeigt nichts davon – wer eine Funktion nicht nutzt, bemerkt sie
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

Die Spalte `format_version` in `scoreview_conversions` hält fest, mit welchem
Cache-Format ein Eintrag geschrieben wurde. Ein Eintrag mit älterer Version –
oder mit fehlender Cache-Datei – gilt automatisch als „nicht fertig" und stößt
eine Neukonvertierung an. Ein Formatwechsel braucht deshalb **keinen**
Migrationspfad und kein manuelles Löschen von Zeilen.

Das deckt den Formatwechsel ab, nicht aber den häufigeren Fall, dass eine
neuere Fassung der App dieselbe Partitur **besser** setzt: Ein fertiger
Eintrag bleibt liegen, solange niemand die Datei anfasst. Dafür gibt es
`POST …/reconvert` – der Knopf „Neu konvertieren" im Viewer, unter der Angabe
der Herkunft. Er verwirft Statuszeile und Cache-Ordner der Datei und reiht die
Konvertierung neu ein; nur mit Schreibrecht, denn der Cache hängt an der Datei
und gilt für alle, die sie öffnen. Für **alle** Partituren einer Instanz auf
einmal bleibt das Hochzählen von `CURRENT_FORMAT_VERSION` der Hebel.

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

### Datenbank

| Tabelle | Inhalt |
|---|---|
| `scoreview_conversions` | `file_id`, `etag`, `status`, `error_code`, `error_message`, `format_version`, `backend` |
| `scoreview_annotations` | `file_id`, `user_id`, `content`, `visibility`, `measure_number`, `fraction`, `elid`, `anchor_etag`, `kind`, `stamp`, `target_parts`, `by_leader` |
| `scoreview_leaders` | `file_id`, `user_id`, `appointed_by`, `created_at` – ernannte Leitungen; die Eigentümerin steht nie darin ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) |
| `scoreview_follow` | `file_id` (Primärschlüssel: höchstens eine Sitzung je Datei), `leader_uid`, `started_at`, `heartbeat_at`, `version`, `state` ([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)) |
| `scoreview_recordings` | `file_id`, `user_id`, `created_at`, `duration_ms`, `size_bytes`, `score_start_ms`, `tempo_factor`, `with_accompaniment` – die WAV selbst liegt in IAppData |

`backend` hält fest, welcher Konvertierungsweg **diese** Darstellung erzeugt hat
(`sidecar`, `local`, oder `NULL` für Datensätze aus der Zeit vor der Spalte).
Nur so bleibt die Frage später beantwortbar: Die Admin-Einstellung sagt, was
*jetzt* gilt, nicht, was beim Konvertieren dieser Datei galt. Die Spalte ist
rein beschreibend – nichts im Server und nichts im Viewer verzweigt danach.

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
damit eine abberufene Leitung ihre Hinweise behält.

Aufnahmen liegen in IAppData unter `recordings/<uid>/<fileId>/<id>.wav`, nicht
in Files: Nur die Aufnehmende hört sie, und in Files tauchten sie in Freigaben,
Suche und Kontingent der Partitur-Eigentümerin auf. Weil IAppData gegen **kein**
Kontingent zählt, hat die App eigene Grenzen – je Partitur (Anzahl), je
Aufnahme (Länge), je Person und für die ganze Instanz (Bytes); beim Erreichen
antwortet der Server 409, 413 oder 507 mit einer lesbaren Meldung. Eine fremde
Aufnahme antwortet 404, nicht 403.

### Aufräumen

`CleanupOrphansJob` räumt Cache-Einträge, Notizen, Leitungen, Folgesitzungen und
Aufnahmen gelöschter Dateien ab. Das geschieht bewusst erst, wenn die Datei
auch aus dem Papierkorb verschwunden ist – eine Wiederherstellung aus dem
Papierkorb soll nichts davon verlieren. Folgesitzungen ohne Lebenszeichen
der Leitung (30 min) entfernt er unabhängig davon. `UserDeletedListener`
löscht beim Löschen eines Kontos dessen Notizen, Ernennungen, geleitete
Sitzungen und Aufnahmen. Zeilen und WAV-Dateien der Aufnahmen verschwinden
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

- Drei Webpack-Einträge für drei Seiten: `src/viewer.js` für die Dateien-Seite
  (Viewer-Handler **und** die beiden Dateiaktionen,
  [E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)),
  `src/standalone.js` für die eigenständige Seite der mobilen Apps
  ([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps)) und
  `src/settings.js` für die Verwaltung. Dazu ein vierter, der keine Seite ist:
  `src/worklets/captureWorklet.js`, das Aufnahme-Worklet (siehe
  [Mikrofon](#mikrofon)).
- `src/components/` – `ScoreViewer.vue` als Rahmen, dazu `ScorePage.vue`,
  `ScoreMixer.vue`, `ScoreAnnotations.vue`, `ScoreStamps.vue`,
  `ScoreModal.vue`, `StandaloneFrame.vue`, `AdminSettings.vue` und die
  Bedienteile der Probe- und Konzertfunktionen (Tabelle unten).
- `src/composables/` – der Zustand des Viewers, nach Themen getrennt:
  Konvertierungsstatus, Notizen, Zoom, Autoscroll, Metronom, Loop, Wiedergabe,
  und je eines für jede Funktion der Tabelle unten.
- `src/lib/` – **reine Logik ohne DOM, ohne `AudioContext`, ohne Nextcloud** und
  damit ohne Browser testbar: `scoreLayout.js`, `mixerLayout.js`,
  `timingSync.js`, `scrollPlan.js`, `metronome.js`, `svgSanitizer.js`,
  `silentClock.js`, `player.js`, `scoreSync.js`, `scoreFile.js`,
  `playbackTime.js`, `audioHealth.js`, `directToken.js`, `mobileBridge.js`,
  `svgIndex.js`, `highlightStyle.js`, `staffBands.js` und die Module der
  Tabelle unten. Neue Logik gehört hierhin, nicht in die Komponenten.

`ScoreViewer.vue` ist auf allen drei Seiten dieselbe Komponente und weiß
nicht, über welche sie geladen wurde. Was den Seiten eigen ist – das
Schließkreuz, der Token an den Anfragen, die Brücke zur mobilen App – steht in
ihrem jeweiligen Einstiegspunkt, nicht im Viewer.

Wiedergabe: `spessasynth_lib` synthetisiert das MIDI im Browser gegen das
ausgelieferte SoundFont. Eine einzige `requestAnimationFrame`-Schleife treibt
Cursor, Autoscroll, Loop und Metronom; SVG-Seiten werden beim Wegscrollen wieder
aus dem DOM genommen.

**Zwei Zeiten, nicht eine.** `AudioContext.currentTime` – und damit
`sequencer.currentTime` – ist die Zeit des Audios, das gerade an das
Ausgabegerät *übergeben* wurde, nicht die des Audios, das gerade an einem Ohr
ankommt. Dazwischen liegt die Ausgabelatenz – gemessen 51 ms an einer
Arbeitsmaschine und 232 ms an einem Android-Telefon mit Bluetooth-Kopfhörern
([Grenzwerte](limits.md#bekannte-lücken)), bei ♩ = 120 also fast eine
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
Die Zuordnung fällt an genau einer Stelle, in der rAF-Schleife in
`ScoreViewer.vue`. Aus demselben Grund hält `pause()` nicht an der Renderzeit
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
  Wurzel des Viewers; alles Gefärbte erbt sie über die Kaskade, auch das per
  `v-html` eingesetzte SVG. Eine Farbänderung rendert deshalb keine einzige
  Seite neu.

Beides ist **je Nutzerin serverseitig** gespeichert (`ViewerPreferences`), nicht
im `localStorage`: Vorbereitet wird am Rechner, gelesen am Tablet auf dem
Notenständer. Gelesen wird trotzdem ohne eigene Anfrage – der Anfangszustand
hängt schon an der Files-Seite, auf der das Viewer-Bundle ohnehin geladen wird.
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
| „Meine Stimme“ je Partitur, eigene Stimme im Stereobild | `panLayout.js` | `useMyPart`, `useMyPartSound` | im Mixer |
| Speed-Trainer im Loop | `speedTrainer.js` | `useSpeedTrainer` | `ScoreSpeedTrainer.vue` |
| Helle Noten auf dunklem Grund | `noteTheme.js` | `useViewerPreferences` | Aufklapper „Darstellung“ |
| Aufführungsmodus, Blättern per Taste/Pedal | `interactionPolicy.js`, `pagingPlan.js`, `keyMap.js` | `usePerformanceMode`, `usePaging`, `useWakeLock` | `ScoreLockButton.vue` |
| Leitungen ([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)) | `leaders.js` | `useLeaders` | `LeaderPanel.vue` |
| Stimmnotizen, Stempel, Studierbuchstaben | `annotationFilter.js`, `stampLayout.js`, `scoreFacts.js` | `useAnnotations`, `useScoreFacts` | `ScoreStamps.vue`, `StampSymbol.vue` |
| „Folgt mir“ ([E10](#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)) | `followState.js` | `useFollowSession` | `FollowBadge.vue`, `LeaderPanel.vue` |
| Setliste ([E11](#e11-die-setliste-als-markdown-datei)) | `setlistNav.js`, `setlistEdit.js`, `soundFontCache.js` | `useSetlist` | `SetlistBar.vue`, `SetlistEditor.vue` |
| Mikrofon, Aufnahme, Intonation | `micAccess.js`, `resample.js`, `wavCodec.js`, `recordingAlign.js`, `pitchDetect.js`, `intonation.js` | `useMicrophone`, `useRecorder`, `useIntonation` | `MicIndicator.vue`, `RecordingPanel.vue` |
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
gespielt wird, der Aufführungsmodus an ist oder einer Leitung gefolgt wird.

**Studierbuchstaben in der Navigation.** Die Takteingabe nimmt „47“, „C“ und
die Form der Taktanzeige „C+3“ an, damit sich eine abgelesene Angabe
unverändert eintippen lässt; woher die Buchstaben kommen, steht in
[E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall).

### Wiedergabe: was ein Suchlauf zurücksetzt

Gemessen: Jeder Suchlauf in spessasynth – und damit jeder Loop-Rücksprung –
setzt den Synthesizer zurück (`setTimeTo()` ruft `synth.reset()`) und spielt
danach die Controller und Programmwechsel aus dem MIDI bis zur Zielstelle
nach. MuseScore schreibt Lautstärke (CC7) und Panorama (CC10) an den Anfang
jeder Spur. Ohne Gegenmaßnahme waren Mute, Solo, „Meine Stimme“, das Stereobild
und ein im Mixer gewähltes Instrument nach dem ersten Suchlauf wieder weg.
`player.js` sperrt deshalb, was die Nutzerin einstellt:

- **Controller** über `lockController(ch, cc, true)`: Ein gesperrter
  Controller übersteht den Reset und ignoriert die Werte aus dem MIDI. Gesetzt
  wird in der Reihenfolge entsperren – setzen – sperren, sonst prallte der
  eigene Wert an der eigenen Sperre ab.
- **Instrumente** über den Systemparameter `presetLock`: Er lässt jeden
  Programmwechsel abprallen, auch das `programChange(0)` des Resets.

Ein zweites Merkmal desselben Suchlaufs: Er wirkt **asynchron**. Nach
`seek()` stimmt die Zeit des Sequencers erst mit dem Ereignis `timechange`;
`player.js` meldet das über `seekIsAsync`. Wer direkt nach einem Sprung die
Position braucht – das Abhören einer Aufnahme setzt seinen Anker genau dann –,
wartet darauf. Der stumme Platzhalter (`silentClock.js`) springt sofort und
kennt das Ereignis nicht.

Der Anfangston klingt auf einem freien Kanal – dem ersten, der keiner Spur
gehört, nie Kanal 9 (Schlagzeug) – als Klavier und durch dieselbe
Ausgabekette wie die Musik, also mit derselben Latenz und Lautstärke. Ein
Tipp, der nie losgelassen wird, endet nach 8 s von selbst.

### Mikrofon

`useMicrophone.js` ist **die einzige Stelle mit `getUserMedia`**. Aufnahme,
Intonation und (vorgesehen) Mitverfolgen melden sich dort an und ab; solange
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

**Der Aufnahmeweg ist strukturell getrennt ([S7](#s7-der-aufnahmeweg-ist-strukturell-getrennt)).** Blöcke aus dem Worklet
bekommen nur Aufnahme und Intonation (`mayUseCapturePath`). Ein
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
[Grenzwerte](limits.md#mikrofon-aufnahme-und-intonation).

**Intonation** rechnet YIN (`pitchDetect.js`) in einem Web Worker, live und
danach aus der gespeicherten WAV – gespeichert wird nichts zusätzlich, eine
Verbesserung am Verfahren wirkt auch auf alte Aufnahmen. Bewertet wird der
Median nach dem Einschwingen (100 ms), gegen a' = 440 Hz, Oktaven gefaltet;
ein Signal ohne klare Tonhöhe ist „nicht auswertbar“ statt geschätzt.
Notenköpfe färben sich nur, wo das SVG `st-`/`vc-` trägt
([M10](#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)) und
sich Notenzeilen den Stimmen zuordnen lassen; sonst bleibt es bei Nadel und
Problemliste.

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
| Tonhöhen-Worker, Teile von `@nextcloud/dialogs` | webpack-Nachladen (`new Worker(new URL(…))`, `import()`) | `__webpack_public_path__`, zur Laufzeit gesetzt (`publicPath.js`) | Inhalts-Hash als `?v=` im Dateinamen der Teile |

Die Laufzeit-Adresse ist nötig, weil die Vorgabe von
`@nextcloud/webpack-vue-config` fest `/apps/scoreview/js/` lautet – liegt die App
wie üblich unter `custom_apps/`, liefe jedes Nachladen ins 404. Ein Worklet
kann nichts nachladen (im `AudioWorkletGlobalScope` gibt es weder
`importScripts` noch `fetch`); es ist deshalb ein eigener Webpack-Eintrag, der
für sich allein steht.

### Stückwechsel im Viewer

Eine Setliste wechselt das Stück **im** Viewer, nicht durch ein neues
Einhängen von außen: `ScoreViewer.vue` hält dafür seine eigene `activeFileId`,
die `useSetlist` setzt. Nur so bleiben Aufführungsmodus, Notenfarbe und Zoom
über den Wechsel erhalten. Der AudioContext wird dabei neu aufgebaut, das
SoundFont (rund 24–40 MB, je nach Quelle) aber nicht neu geladen: `soundFontCache.js` hält es auf
Modulebene für die Lebensdauer der Seite, teilt einen laufenden Abruf und
merkt sich keinen Fehler. Ein Generationszähler in `usePlayback.js` verwirft
Antworten, die zu einem schon verlassenen Stück gehören.

## Sicherheitsregeln

Die Regeln, die die Probe- und Konzertfunktionen und die eigenständige Seite
([E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps)) verbindlich
einhalten. Die Begründungen stehen ausführlich an den verlinkten Stellen; hier
steht, was nicht aufgeweicht werden darf. Im Code sind sie als `S1`…`S8`
referenziert.

### S1: Begleit-Token sind an Zweck, Datei und Direct-Editing-Token gebunden

Ein Begleit-Token (`Service\CompanionTokenService`) gilt nur für seinen Zweck
(`score` oder `setlist`), nur für seine Datei und nur zusammen mit dem lebenden
Direct-Editing-Token, aus dem es ausgegeben wurde (`dt`). Ausgegeben wird nur
mit einem Direct-Editing-Token und nur für eine Setliste neben dessen Partitur,
die sie enthält – nie aus einer Sitzung, nie aus einem Begleit-Token heraus
(keine Kette). Widerrufen wird bei jeder Anfrage: hartes Ablaufdatum nach
12 h, Epoche der Nutzerin, Konto aktiv, Datei neu aufgelöst. Token stehen nur
im Header, nie in URL, Protokoll oder `localStorage`. Einzelheiten:
[E8](#e8-eine-eigenständige-seite-für-die-mobilen-apps).

### S2: Schreiben mit Token nur um die Partitur herum

Mit einem Token kommt in eine Setliste nichts, was nicht schon um die offene
Partitur liegt: mit dem Direct-Editing-Token nur Dateien aus deren Ordner bis
Tiefe 2, mit einem Begleit-Token gar nichts Neues (Umordnen und Entfernen
bleiben), angelegt wird nur im Ordner der Token-Datei. Beliebige Pfade gibt es
nur in der Browser-Sitzung. Sonst würde aus der Erlaubnis für eine Datei über
eine selbst angelegte Liste und S1 eine für alle.

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
das Restrisiko, siehe [Grenzwerte](limits.md). Einzelheiten:
[Mikrofon](#mikrofon).

### S4: Teure Arbeit ist gedeckelt

Was ohne Sitzung erreichbar ist, darf nicht unbegrenzt Arbeit auslösen:

- Die Dateiauswahl für den Setlisten-Editor besucht höchstens 100 Ordner,
  nicht nur höchstens 200 Treffer.
- Eine Setliste hat höchstens 200 Einträge – beim Schreiben **und** beim
  Lesen, denn jede aufgelöste Zeile kostet einen Zugriff auf den Dateibaum,
  und die Datei lässt sich im Texteditor beliebig füllen. Die Suche nach
  Listen, die eine Partitur enthalten, sieht höchstens 20 Listen je Ordner an.
- Die Nutzersuche für Leitungen und die schreibenden Routen (Aufnahme
  hochladen, „Folgt mir“ steuern, Setliste speichern und anlegen) tragen
  `#[UserRateLimit]` **und** `#[AnonRateLimit]`: Anfragen mit Token sind für
  Nextclouds Drosselung anonym, weil sie vor der eigenen Middleware läuft.

### S5: Aufnahmen haben eigene Speichergrenzen

Aufnahmen liegen in `IAppData` und zählen deshalb **nicht** gegen die Quota der
Nutzerin. Die App zieht ihre eigenen Grenzen: Anzahl je Person und Partitur,
Länge, Bytes je Person und Bytes auf der ganzen Instanz; beim Erreichen
antwortet der Server 507 bzw. 413 mit klarer Meldung. Die Werte stehen in
[Installation](installation.md).

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
fremde Aufnahmen antworten ebenfalls 404. Erst wer sie sieht, aber nicht darf,
bekommt 403. Sonst ließe sich abtasten, welche fileIds es gibt
([E9](#e9-die-leitungsrolle-ergänzt-die-dateirechte)).

## Entwurfsentscheidungen

Diese Entscheidungen tragen den Aufbau. Sie sind im Code an vielen Stellen als
`E1`…`E12` referenziert und sollten nicht ohne erneute Bewertung revidiert
werden.

### E1: MIDI statt MP3 als Audioartefakt

Der Sidecar liefert MIDI, die Synthese passiert im Browser (SoundFont + Web
Audio). Ein vorgerenderter Stereo-Mixdown kann drei Ziele prinzipiell nicht
erfüllen: Lautstärke einzelner Stimmen (unmöglich), Instrumentenwechsel
(kombinatorisch nicht vorrenderbar), Tempoänderung (nur mit Time-Stretching und
Qualitätsverlust). Mit clientseitiger Synthese werden alle drei zu Parametern
statt zu Pipelinestufen.

Der Preis: Ein SoundFont (~24–40 MB SF3, je nach Quelle) muss ausgeliefert werden, und die
Klangqualität liegt unter MuseScores eigenem Render – gemessen rund 7 dB
leiser, siehe [Grenzwerte](limits.md). Dafür ist das Audioartefakt pro Partitur
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

### E3: Zwei Konvertierungswege hinter einer API

Die Konvertierung läuft wahlweise über den **Sidecar-Container** oder **lokal
auf dem Server**. Beide erzeugen dieselben Artefakte im selben Cache und stehen
hinter derselben HTTP-API; nichts im Viewer verzweigt danach, welcher gelaufen
ist. Die Wahl ist eine einzelne Admin-Einstellung (`conversion_backend`,
Voreinstellung `local`) und wird an genau einer Stelle im Code ausgewertet
(`ConvertScoreJob`).

Welcher Weg gelaufen ist, wird beim Ablegen der Artefakte **aufgezeichnet**
(Spalte `backend`) und im Viewer angezeigt. Das ist kein Aufweichen der
Trennung, sondern ihr Preis: Weil man dem Ergebnis nicht ansieht, woher es
kommt, und weil eine gecachte Partitur nach einem Wechsel weiterhin vom alten
Weg stammt, wäre die Frage „womit ist das gesetzt worden?" sonst gar nicht mehr
zu beantworten.

| | Lokal (Voreinstellung) | Sidecar |
|---|---|---|
| MuseScore | MuseScore 4.7.5 als WebAssembly, Qt-frei ([AndiMb/scoreview-engine](https://github.com/AndiMb/scoreview-engine)) | echtes MuseScore 4 aus gepinntem AppImage |
| Läuft als | Kindprozess der Node-Laufzeit des Servers | eigener Container, HTTP-API |
| Voraussetzung beim Betreiber | Node.js ≥ 18, `proc_open` erlaubt | Docker o. ä. |
| Im App-Paket | rund 14 MB Wasm + Ressourcen (`converter/`) | nichts |
| SoundFont | holt der Server von einer voreingestellten Adresse | bringt das Image mit |
| Vorab-Konvertierung, Selbsttest | ja | ja |

**Warum es den Sidecar weiterhin gibt.** Er bringt echtes, aktuelles MuseScore 4
mit: eine Abhängigkeit, die ein Versionswechsel aktualisiert, und keine, die
jemand bauen und pflegen muss. Wo ohnehin Container laufen, ist das der
robustere Weg – und der einzige, dessen MuseScore-Version sich ohne einen
eigenen Build nachziehen lässt.

**Warum es den lokalen Weg gibt.** Der Sidecar setzt voraus, dass der Betreiber
einen zweiten Container betreiben kann. Das schließt Instanzen ohne Docker aus –
und war der Grund, warum ScoreView auf verwalteten Instanzen gar nicht lief.

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
[Grenzwerte](limits.md#gemessene-werte), auf derselben Maschine:

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

**Ein Unterschied bleibt (M10):** Auf dem lokalen Weg tragen die SVG-Elemente
ihre Segment-, Notenzeilen- und Stimmenkennung, auf dem Sidecar-Weg nicht – die
schreibt der SVG-Writer der Engine, und MuseScore selbst kennt sie nicht. Der
Viewer erkennt das Fehlen beim Aufbau seines Index und bleibt dann beim
Cursor-Band; es gibt keinen Schalter und keine Einstellung dafür. Wer die
Hervorhebung auch im Container will, müsste dort die Engine statt MuseScore
konvertieren lassen – und gäbe damit das beste Argument des Sidecars auf,
nämlich echtes, per Versionswechsel aktualisierbares MuseScore.

**Und einer in `meta.json`:** Tonarten mit Dur/Moll und Studierbuchstaben
(`keySigs`, `rehearsalMarks`) schreibt ebenfalls nur die Engine. Auch hier
entscheidet der Viewer am Inhalt, nicht am Weg: Fehlen die Felder, kommen
Buchstaben und Tonarten aus dem MIDI, das auf beiden Wegen byteweise gleich
ist – nur ohne Dur/Moll
([E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)).

**Und einer bei den eingebetteten Bildern:** Beide Wege setzen sie, aber der
lokale reicht die Originalbytes als Daten-URI durch, statt sie zu rastern –
die Qt-freie Engine dekodiert kein einziges Pixel. Damit hängt an ihr, was
ein Browser selbst anzeigt; die beiden Formate, die dabei ausfallen, stehen
in [Grenzwerte](limits.md#bekannte-lücken).

Dass die Ergebnisse im Übrigen zusammenpassen, liegt am gemeinsamen Kern: Es
ist derselbe MuseScore 4.7.5, einmal als AppImage und einmal Qt-frei nach
WebAssembly übersetzt (MuseScore als ungepatchtes Submodul). `savePositions`
liefert die Koordinaten dort bereits in SVG-Einheiten, die Division durch 12
entfällt (`converter/lib/artifacts.mjs`).

Dieses „derselbe" ist eine Zusage, keine Beobachtung: Die eine Version steht als
Release-URL in `converter/package.json`, die andere als `ARG MUSESCORE_VERSION`
in `sidecar/Dockerfile`, und nichts zwang sie bisher zusammen. Laufen sie
auseinander, legt dieselbe Partitur je nach Weg ein anderes Layout hin, ohne
dass ein Test anschlägt. Der Job `versionen` in `ci.yml` vergleicht beide
Angaben deshalb bei jedem Lauf, und `engine-release.yml` hebt sie nur gemeinsam:
Der Wächter sieht täglich nach, ob
[scoreview-engine](https://github.com/AndiMb/scoreview-engine) ein neues Release
hat, und macht daraus einen Pull Request, der den Engine-Pin und – falls das
Release eine neue MuseScore-Version mitbringt – die beiden Dockerfile-ARGs in
einem Zug hebt. Dependabot kann das nicht übernehmen, weil eine Release-URL
keiner Registry gehört (siehe `.github/dependabot.yml`). Auf der anderen Seite
hängt daran eine zweite Automatik: Im Engine-Repo bereitet
`musescore-release.yml` den MuseScore-Sprung als Entwurf vor, sobald upstream
veröffentlicht.

#### Was der lokale Weg kostet

- **Eine Node-Laufzeit auf dem Server.** Das offizielle Nextcloud-Docker-Image
  bringt keine mit; auf verwaltetem Hosting ist sie meist nicht nachrüstbar.
- **Rund 14 MB mehr im App-Paket** (9,3 MB Wasm-Code, 4,8 MB vorgeladene
  Ressourcen: Notenschrift, Textschriften, SMuFL-Metadaten als woff2). Das Paket
  muss sie fertig installiert enthalten – eine Instanz ohne Container hat kein
  npm, mit dem sie das nachholen könnte (siehe `release.yml`). Die CJK-Fonts
  bleiben deshalb draußen, siehe [Grenzwerte](limits.md#bekannte-lücken).
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

#### Welchen Weg wählen

Wo Container laufen, der Sidecar – eine Abhängigkeit weniger, die im Repo
gepflegt werden muss. Wo keine laufen, der lokale Weg. Umstellen heißt: die
Einstellung ändern; bereits konvertierte Partituren bleiben im Cache gültig,
weil die Artefakte dieselben sind.

Wege, den Sidecar bereitzustellen, stehen in
[`../sidecar/README.md`](../sidecar/README.md#bereitstellung); die Einrichtung
des lokalen Wegs in [Installation](installation.md).

### E4: Englische Quellstrings, Deutsch als gepflegte Übersetzung

Die UI-Strings im Quelltext sind **Englisch**; Deutsch ist eine im Repo
gepflegte Übersetzung (`l10n/de.json` für PHP, `l10n/de.js` für den Browser).
Kommentare, Dokumentation und Commit-Messages bleiben Deutsch.

Grund: Nextclouds l10n-Format benutzt den Quellstring selbst als
Übersetzungsschlüssel. Deutsche Schlüssel hätten drei Folgen – jede weitere
Sprache würde aus dem Deutschen übersetzt, die Rückfallsprache bei fehlender
Übersetzungsdatei wäre Deutsch, und die App antwortete jedem nicht
deutschsprachigen Nutzer in einer Sprache, die er nicht gewählt hat.

**Fehlende Übersetzungen fallen still aus** – Nextclouds `JSResourceLocator`
ignoriert fehlende l10n-Dateien bewusst. Deshalb prüft `npm test` die
Vollständigkeit; Disziplin allein trägt das nicht. Siehe
[Entwicklung](development.md#übersetzungen).

Nicht übersetzt wird Inhalt aus der Partitur selbst: Stimmennamen, Titel,
Komponist, GM-Instrumentennamen. Das ist Material, keine Oberfläche.

### E5: `@nextcloud/vue` als UI-Basis

Die Bedienelemente kommen aus `@nextcloud/vue` statt aus handgeschriebenem HTML.
Tastaturbedienung, Fokusführung, Touch-Zielgrößen, Theming und Dark Mode einzeln
nachzubauen kostet mehr als die Bibliothek – und die App soll aussehen wie der
Rest von Nextcloud.

Der Preis ist Bundle-Größe (Gegenmaßnahme: gezielte Einzelimporte statt
Sammelimport) und eine stärkere Bindung an die Nextcloud-Version: `info.xml`
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
von Hand ([installation.md](installation.md)).

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

### E7: Konvertierung im Browser als Rückfall

Wo der Server **nicht konvertieren kann** – keine Node-Laufzeit, `proc_open`
gesperrt, kein erreichbarer Sidecar –, konvertiert der Browser. Dieselbe Engine
(scoreview-engine, MuseScore 4.7.5 als WebAssembly), dieselben Artefakte, nur
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

Das Urteil ist gespeichert und gilt fünf Minuten – die ehrliche Antwort kostet
einen Prozessstart oder eine HTTP-Anfrage, und der Viewer fragt den Status im
Sekundentakt. Ein Selbsttest und jedes Speichern der Admin-Einstellungen
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
| CSP | `blob:` in `worker-src` und `connect-src`, begrenzt auf `/apps/files` und nur solange der Rückfall greift (`Listener\AddCspListener`) |
| App-Paket | rund 40 KB. Wasm und Ressourcenpaket liegen ohnehin für den Node-Weg darin – ausgeliefert wird zusätzlich nur der Browser-Glue |

**Warum keine Zeile im Viewer.** Der Vertrag ist der Körper von `onReady()`,
nicht die HTTP-Antwort, aus der er stammt: Der Rückfall baut dasselbe
`files`-Objekt, nur mit Blob-URLs statt Serverrouten. `ScoreViewer.vue`,
`ScorePage.vue`, `usePlayback.js` und `useAnnotations.js` sind unverändert; die
Verzweigung sitzt an einer Stelle in `useConversionStatus.js`. Dass der Viewer
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
Dass er stimmt, besorgt die App inzwischen selbst
([E6](#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste)); vorher hing dieser
Einstieg an einer Handreichung des Betreibers und war auf verwaltetem Hosting
überhaupt nicht erreichbar.

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
sie vorher hatte. Was eine Anfrage vorgelegt hat, hält
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

Eine Ausnahme bleibt: `GET /api/engine/{name}` trägt **keinen** Token, sondern
`#[PublicPage]`. Der Grund ist technisch zwingend – die Engine wird mit
`import(engineUrl)` geladen, und ein nativer dynamischer Import kann keinen
Header tragen. Was dort herauskommt, sind appeigene Bauartefakte: für jede
Instanz dieselben Bytes, kein Nutzerinhalt, dieselbe Art Material, die
Nextcloud unter `/apps/<app>/js/` ohnehin ohne Anmeldung ausliefert. Der Preis
ist benannt: rund 14 MB sind ohne Konto abholbar.

**Sie hat keinen Wirt.** In den übrigen Einstiegen stellt der Wirt das
Schließkreuz – Nextclouds Viewer-App bzw. das `NcModal`. `ScoreViewer.vue` hat
dafür weder Knopf noch Ereignis, es gäbe also keinen Weg hinaus. Deshalb eine
schmale Kopfzeile mit Dateiname und ✕ in `StandaloneFrame.vue`. Der Rahmen
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
| Vollbild-API | `document.fullscreenEnabled === false` | Der Vollbildknopf erscheint nur, wo Vollbild möglich ist (`useZoom.js`) |

Der Vollbildknopf hängt dabei an der **Fähigkeit des Browsers**, nicht am
Einstieg: Der Viewer soll nicht danach verzweigen, wie seine Seite ausgeliefert
wurde. Dieselbe Regel deckt ein iframe mit entsprechender Permissions-Policy
gleich mit ab.

**Telefonbreite.** Die Leiste muss auf 360 px in eine Zeile passen: Play,
Taktfeld, Anfangston, Schloss und „Mehr“. Entschieden wird das an der Breite
des Streifens, nicht des Fensters (`@container (max-width: 400px)` in
`ScoreViewer.vue`) – der Viewer kann auch in einem schmalen Rahmen stecken.
Weichen muss dort der Suchlauf, den das Taktfeld daneben ohnehin trägt, und bei
Studierbuchstaben die Gesamtzahl der Takte.

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

Eine Leitung schickt ihre Stelle, einen Loop und den Anfangston an alle
Geräte, die dieselbe Partitur offen haben (`Service\FollowService`,
`useFollowSession.js`).

**Zustand statt Ereignisse.** Gespeichert wird je Datei *ein* Zustand –
`position`, `loop` und `tone`, jeder mit eigenem Zähler `seq`, dazu eine
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
antwortet 204, wenn sich nichts geändert hat. Während einer Sitzung und bei
sichtbarer Seite fragt ein Gerät im Takt von `follow_poll_ms` (Vorgabe 800 ms,
erlaubt 500–3000, in der Verwaltung einstellbar und mit jeder Antwort
mitgeschickt, damit eine Änderung auch laufende Sitzungen erreicht), sonst
alle 15 s („läuft eine Sitzung?“). Ist `notify_push` eingerichtet, schickt der
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
([Grenzwerte](limits.md#folgt-mir)).

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

**Die Leitung sendet nacheinander, der letzte Tipp gewinnt**
(`leaderQueue.js`). Zwei Änderungen, die gleichzeitig unterwegs wären, kämen
in beliebiger Reihenfolge an – der ältere Sprung läge dann über dem neueren.
Also läuft je Gerät höchstens eine Anfrage; was währenddessen getippt wird,
geht gleich danach als *ein* PATCH hinaus: von Stelle und Loop nur der neueste
Stand, ein Anfangston als Auslöser immer (mehrere Tontipps während einer
Anfrage als einer). Starten und Beenden verdrängen, was vor ihnen wartete. Die
Knöpfe bleiben dabei bedienbar – gesperrte Knöpfe verlören den zweiten Tipp
von „B – nein, C“. Die Warteschlange hält sich selbst unter 100 Anfragen je
Minute, unter der Grenze des Servers von 120 (dazu Herzschlag und ein zweites
Gerät); ist das Budget erschöpft, wartet sie und sammelt weiter.

**Sitzungsende:** durch eine Leitung, oder nach 30 min ohne Herzschlag – das
wird schon beim Lesen als beendet gewertet. Eine andere Leitung übernimmt eine
laufende Sitzung, indem sie selbst startet; allen wird das angezeigt. Es gibt
höchstens eine Sitzung je Datei.

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

**Bestehende Partituren bekommen die Felder durch eine Neukonvertierung.**
`CURRENT_FORMAT_VERSION` steht auf 3; ein älterer Cache-Eintrag gilt beim
nächsten Öffnen als nicht fertig und wird neu erzeugt
([Konvertierung und Cache](#konvertierung-und-cache)).

## Formatgrundlagen

Eigenschaften des MuseScore-Exports, auf denen die Umsetzung aufbaut. Alle gegen
das gebaute Image bzw. die Engine gemessen, nicht angenommen. Die Kennungen
`M1`…`M11` sind im Code referenziert.

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

`metadata` trägt bei der Engine des lokalen Wegs zwei Felder mehr, die
Stock-MuseScore nicht kennt: `keySigs` und `rehearsalMarks`
([E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall), Form im
[Artefaktschema](#artefaktschema)). Das `metadata` des Sidecars hat keines
von beiden.

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

**Die MIDI-Kanalnummer ist aber nicht der Index in `tracks`.** An einer
fünfstimmigen Partitur gemessen: Sopran/Alt/Tenor/Bariton/Bass liegen auf den
MIDI-Kanälen 0/2/3/1/6, nicht auf 0–4. `resolveMixerChannels()` leitet die
Kanäle deshalb aus dem geladenen MIDI ab (`player.js::getTrackChannels()`), nicht
aus der Position in der Liste.

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
[Grenzwerte](limits.md#bekannte-lücken).

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
Sidecar-Weg**; was die Engine daran ändert, steht in
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

An der Selbsttest-Partitur gemessen (`v4.7.4-engine.2`, an `v4.7.5-engine.1`
und `v4.7.5-engine.2` unverändert nachgemessen): 20 Segmente, 44
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
- **`meta.json` des Sidecars hat weder `keySigs` noch `rehearsalMarks`.**
- Ein MIDI-Marker liegt gerechnet oft einen Bruchteil einer Millisekunde vor
  dem Taktanfang (Gleitkomma aus der Tempokarte), `measures.json` auf ganzen
  Millisekunden. Ohne 1 ms Zugabe landete ein Buchstabe gelegentlich im Takt
  davor (`scoreFacts.js`).

## Artefaktschema

`timing.json` und `measures.json` haben dieselbe Form (ein gemeinsamer Parser im
Sidecar erzeugt beide aus `sposXML` bzw. `mposXML`):

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
Die Engine des lokalen Wegs ergänzt zwei Felder
([E12](#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)):

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
- Fehlen die Felder (Sidecar, Konvertierung mit einer älteren Engine), ist das
  kein Fehler – der Viewer nimmt dann das MIDI.

Welche Fassung dieses Schemas ein Cache-Eintrag hat, hält `format_version` fest
(`CURRENT_FORMAT_VERSION` = 3, [Konvertierung und Cache](#konvertierung-und-cache)).

## Weiter

- [Grenzwerte und bekannte Einschränkungen](limits.md)
- [Installation und Konfiguration](installation.md)
- [Entwicklung](development.md)
- [Sidecar: Betrieb und HTTP-API](../sidecar/README.md)
