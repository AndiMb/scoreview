# Architektur

Wie ScoreView aufgebaut ist, welche Entwurfsentscheidungen dahinterstehen und
auf welchen Eigenschaften des MuseScore-Exports die Umsetzung aufbaut. Dieses
Dokument beschreibt den Stand der App, nicht ihren Entstehungsweg.

## Überblick

ScoreView besteht aus diesen Teilen:

| Teil | Wo | Aufgabe |
|---|---|---|
| Nextcloud-App | `scoreview/lib/` (PHP) | Konvertierung anstoßen, Ergebnis cachen, Artefakte ausliefern, Notizen verwalten |
| Viewer | `scoreview/src/` (Vue 3) | Notenseiten anzeigen, MIDI im Browser synthetisieren, Cursor führen |
| Sidecar | `sidecar/` (Python + MuseScore 4) | `.mscz` übersetzen – im eigenen Container |
| Lokaler Konverter | `scoreview/converter/` (Node + scoreview-engine: MuseScore als WebAssembly) | dasselbe, ohne Container |

Konvertiert wird über **einen von zwei Wegen**, wahlweise über den Sidecar oder
lokal auf dem Server; beide erzeugen dieselben Artefakte (siehe
[E3](#e3-zwei-konvertierungswege-hinter-einer-api)). Der Sidecar ist nicht Teil
des App-Pakets, der lokale Konverter schon. Die HTTP-API des Sidecars beschreibt
[`../sidecar/README.md`](../sidecar/README.md).

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
   |- SVG-Seiten anzeigen ............. Zoom · Vollbild · Autoscroll
   |- MIDI clientseitig synthetisieren  Tempo · Mixer · Metronom
   |- Cursor-Overlay über spos/12-Koordinaten
   |- Taktnavigation über mpos
   +- Notizen an musikalischen Ankern (eigene Tabellen)
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
ausschließlich aus Files, auf zwei Wegen: über Nextclouds Viewer (am Mimetype
`application/x-musescore`) und, wo der nicht greift, über eine eigene
Dateiaktion auf der Endung, die dieselbe Komponente in einem Vollbildfenster
zeigt. Warum es beide braucht, steht in
[E6](#e6-zwei-einstiege-mimetype-und-dateiendung).

| Route | Zweck |
|---|---|
| `GET /api/scores/{fileId}/status` | Konvertierungsstatus, Seitenzahl, Metadaten |
| `GET /api/scores/{fileId}/artifact/{name}` | Ein Artefakt aus dem Cache (`page-N`, `midi`, `timing`, `measures`, `meta`) |
| `POST /api/scores/{fileId}/reconvert` | Verwirft die gespeicherte Konvertierung und lässt sie neu erzeugen (nur mit Schreibrecht auf die Datei) |
| `GET /api/soundfont` | Das SoundFont für die Browser-Wiedergabe |
| `GET\|POST\|PUT\|DELETE /api/scores/{fileId}/annotations[/{id}]` | Notizen |
| `POST /api/preferences` | Anzeigeeinstellungen der Nutzerin (nur schreibend – gelesen aus dem Anfangszustand der Files-Seite) |
| `POST /api/settings` | Admin-Einstellungen speichern |
| `GET /api/health`, `POST /api/selftest` | Betriebsdiagnose, Sidecar-Selbsttest (nur Admins) |

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

### Datenbank

| Tabelle | Inhalt |
|---|---|
| `scoreview_conversions` | `file_id`, `etag`, `status`, `error_code`, `error_message`, `format_version`, `backend` |
| `scoreview_annotations` | `file_id`, `user_id`, `content`, `visibility`, `measure_number`, `fraction`, `elid`, `anchor_etag` |

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
403, statt die Bedienelemente nur auszublenden.

### Aufräumen

`CleanupOrphansJob` räumt Cache-Einträge und Notizen gelöschter Dateien und
Konten ab. Notizen werden bewusst erst entfernt, wenn die Datei auch aus dem
Papierkorb verschwunden ist – eine Wiederherstellung aus dem Papierkorb soll die
Notizen nicht verlieren.

## Browserseite

Der Viewer mountet einen **eigenen, zweiten Vue-3-Baum** neben der Vue-Instanz
von Nextclouds Viewer (`src/viewer.js`, dort ausführlich begründet). Zwei
Vue-Kopien im selben Baum sind nicht kompatibel; `@nextcloud/vue`-Komponenten
werden gegen unsere Instanz kompiliert und leben in unserem Baum. Wer an der
UI-Basis arbeitet, muss deshalb **im Viewer** verifizieren, nicht auf der
Einstellungsseite.

Aufbau:

- `src/components/` – `ScoreViewer.vue` als Rahmen, dazu `ScorePage.vue`,
  `ScoreMixer.vue`, `ScoreAnnotations.vue`, `ScoreModal.vue`, `AdminSettings.vue`.
- `src/composables/` – der Zustand des Viewers, nach Themen getrennt:
  Konvertierungsstatus, Notizen, Zoom, Autoscroll, Metronom, Loop, Wiedergabe.
- `src/lib/` – **reine Logik ohne DOM, ohne `AudioContext`, ohne Nextcloud** und
  damit ohne Browser testbar: `scoreLayout.js`, `mixerLayout.js`,
  `timingSync.js`, `scrollPlan.js`, `metronome.js`, `svgSanitizer.js`,
  `silentClock.js`, `player.js`, `scoreSync.js`, `scoreFile.js`,
  `svgIndex.js`, `highlightStyle.js`. Neue Logik gehört hierhin, nicht in die
  Komponenten.

Wiedergabe: `spessasynth_lib` synthetisiert das MIDI im Browser gegen das
ausgelieferte SoundFont. Eine einzige `requestAnimationFrame`-Schleife treibt
Cursor, Autoscroll, Loop und Metronom; SVG-Seiten werden beim Wegscrollen wieder
aus dem DOM genommen.

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

## Entwurfsentscheidungen

Diese sechs Entscheidungen tragen den Aufbau. Sie sind im Code an vielen
Stellen als `E1`…`E6` referenziert und sollten nicht ohne erneute Bewertung
revidiert werden.

### E1: MIDI statt MP3 als Audioartefakt

Der Sidecar liefert MIDI, die Synthese passiert im Browser (SoundFont + Web
Audio). Ein vorgerenderter Stereo-Mixdown kann drei Ziele prinzipiell nicht
erfüllen: Lautstärke einzelner Stimmen (unmöglich), Instrumentenwechsel
(kombinatorisch nicht vorrenderbar), Tempoänderung (nur mit Time-Stretching und
Qualitätsverlust). Mit clientseitiger Synthese werden alle drei zu Parametern
statt zu Pipelinestufen.

Der Preis: Ein SoundFont (~40 MB SF3) muss ausgeliefert werden, und die
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
Voreinstellung `sidecar`) und wird an genau einer Stelle im Code ausgewertet
(`ConvertScoreJob`).

Welcher Weg gelaufen ist, wird beim Ablegen der Artefakte **aufgezeichnet**
(Spalte `backend`) und im Viewer angezeigt. Das ist kein Aufweichen der
Trennung, sondern ihr Preis: Weil man dem Ergebnis nicht ansieht, woher es
kommt, und weil eine gecachte Partitur nach einem Wechsel weiterhin vom alten
Weg stammt, wäre die Frage „womit ist das gesetzt worden?" sonst gar nicht mehr
zu beantworten.

| | Sidecar | Lokal |
|---|---|---|
| MuseScore | echtes MuseScore 4 aus gepinntem AppImage | MuseScore 4.7.4 als WebAssembly, Qt-frei ([AndiMb/scoreview-engine](https://github.com/AndiMb/scoreview-engine)) |
| Läuft als | eigener Container, HTTP-API | Kindprozess der Node-Laufzeit des Servers |
| Voraussetzung beim Betreiber | Docker o. ä. | Node.js ≥ 18, `proc_open` erlaubt |
| Im App-Paket | nichts | rund 14 MB Wasm + Ressourcen (`converter/`) |
| SoundFont | bringt das Image mit | Download-URL in den Einstellungen |
| Vorab-Konvertierung, Selbsttest | ja | ja |

**Warum es den Sidecar weiterhin gibt.** Er bringt echtes, aktuelles MuseScore 4
mit: eine Abhängigkeit, die ein Versionswechsel aktualisiert, und keine, die
jemand bauen und pflegen muss. Wo ohnehin Container laufen, ist das der
robustere Weg – und der einzige, dessen MuseScore-Version sich ohne einen
eigenen Build nachziehen lässt.

**Warum es den lokalen Weg gibt.** Der Sidecar setzt voraus, dass der Betreiber
einen zweiten Container betreiben kann. Das schließt Instanzen ohne Docker aus –
und war der Grund, warum ScoreView auf verwalteten Instanzen gar nicht lief.

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
und beim Sidecar `null` – der einzige gefundene Unterschied, und keiner, den der
Viewer liest.

**Ein Unterschied bleibt (M10):** Auf dem lokalen Weg tragen die SVG-Elemente
ihre Segment-, Notenzeilen- und Stimmenkennung, auf dem Sidecar-Weg nicht – die
schreibt der SVG-Writer der Engine, und MuseScore selbst kennt sie nicht. Der
Viewer erkennt das Fehlen beim Aufbau seines Index und bleibt dann beim
Cursor-Band; es gibt keinen Schalter und keine Einstellung dafür. Wer die
Hervorhebung auch im Container will, müsste dort die Engine statt MuseScore
konvertieren lassen – und gäbe damit das beste Argument des Sidecars auf,
nämlich echtes, per Versionswechsel aktualisierbares MuseScore.

Dass die Ergebnisse im Übrigen zusammenpassen, liegt am gemeinsamen Kern: Es
ist derselbe MuseScore 4.7.4, einmal als AppImage und einmal Qt-frei nach
WebAssembly übersetzt (MuseScore als ungepatchtes Submodul). `savePositions`
liefert die Koordinaten dort bereits in SVG-Einheiten, die Division durch 12
entfällt (`converter/lib/artifacts.mjs`).

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

Für diesen Fall bliebe nur, im Browser zu konvertieren und die Artefakte zum
Server hochzuladen. Das ist keine Umverdrahtung, sondern eine neue
Vertrauensgrenze: Der Server lieferte dann an alle Leser einer Datei aus, was
ein einzelner Browser erzeugt hat. Solange das nicht entschieden ist, bleibt
SaaS außen vor.

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

### E6: Zwei Einstiege – Mimetype und Dateiendung

Der reguläre Einstieg ist Nextclouds Viewer, und der wählt am **Mimetype**:
`application/x-musescore`. Diese Registrierung ist server-weit und lässt sich
aus einer App heraus nicht vornehmen – Nextcloud liest `mimetypemapping.json`
ausschließlich aus `config/` – und sie braucht anschließend `occ`. Auf
verwaltetem Hosting gibt es beides nicht. Selbst auf einer eigenen Instanz
bleiben bereits hochgeladene Dateien bis zu einem `occ files:scan` auf
`application/octet-stream` stehen und sind für den Viewer unsichtbar.

Deshalb registriert `src/viewer.js` zusätzlich eine **Dateiaktion auf der
Endung**, die dieselbe Komponente in einem `NcModal` zeigt. Ihre Bedingung
steht als reine Funktion in `src/lib/scoreFile.js` und lautet: Endung `.mscz`
**und** Mimetype nicht `application/x-musescore`. Sie greift also genau dort,
wo der Viewer nichts tut – wo die Registrierung sitzt, gibt es keinen zweiten
Menüeintrag und keine zweite Standardaktion.

Der Preis ist eine doppelte Registrierung: `@nextcloud/files` hat zwischen den
Nextcloud-Ständen sowohl den Ablageort der Aktionsliste als auch die
Rückrufsignatur gewechselt (bis v3 ein globales Array `_nc_fileactions` mit
`(nodes, view)`, ab v4 `_nc_files_scope.v4_0` mit einem Kontextobjekt). An
Nextcloud 34 gemessen gibt es nur noch den neuen Ort. `viewer.js` trägt sich
deshalb im neuen ein und, wenn der fehlt, zusätzlich im alten – beide Male mit
derselben Bedingung aus `scoreFile.js`. Fehlte der zweite Zweig, täte die
Aktion auf älteren Ständen einfach nichts: keine Fehlermeldung, kein Eintrag.

## Formatgrundlagen

Eigenschaften des MuseScore-Exports, auf denen die Umsetzung aufbaut. Alle gegen
das gebaute Image gemessen, nicht angenommen. Die Kennungen `M1`…`M10` sind im
Code referenziert.

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

An der Selbsttest-Partitur gemessen (`v4.7.4-engine.2`): 20 Segmente, 44
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

## Weiter

- [Grenzwerte und bekannte Einschränkungen](limits.md)
- [Installation und Konfiguration](installation.md)
- [Entwicklung](development.md)
- [Sidecar: Betrieb und HTTP-API](../sidecar/README.md)
