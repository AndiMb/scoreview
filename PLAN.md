# ScoreView – Umsetzungsplan

Stand: 2026-08-23. Ersetzt den bisherigen Implementierungsplan ab Phase 5.
Phasen 1–4 (Spike, App-Gerüst, Sidecar-HTTP-API, Frontend-Integration) sind
umgesetzt; dieser Plan baut Teile davon bewusst zurück.

## 0. Architekturentscheidungen

Drei Grundsatzentscheidungen, getroffen nach dem technischen Review vom
2026-08-23. Sie sind der Grund für den Umbau und sollten nicht ohne erneute
Bewertung revidiert werden.

### E1: MIDI statt MP3 als Audioartefakt

**Entscheidung.** Der Sidecar liefert MIDI. Die Synthese passiert im Browser
(SoundFont + Web Audio). MP3 wird nicht mehr erzeugt.

**Grund.** Ein vorgerenderter Stereo-Mixdown kann drei Roadmap-Ziele
prinzipiell nicht erfüllen: Lautstärke einzelner Stimmen (unmöglich),
Instrumentenwechsel (kombinatorisch nicht vorrenderbar), Tempoänderung (nur
mit Time-Stretching und Qualitätsverlust). Mit clientseitiger Synthese werden
alle drei zu Parametern statt zu Pipelinestufen.

**Konsequenzen.**

- Ein SoundFont muss ausgeliefert werden (SF3, ~14–35 MB, einmalig, cachebar).
  Das ist der Preis dieser Entscheidung.
- Klangqualität sinkt gegenüber MuseScore-4-MP3. Für Probenarbeit wiegt
  Steuerbarkeit das auf.
- Artefaktgröße pro Partitur sinkt drastisch (gemessen: 8 KB MIDI gegen
  3109 KB MP3, Faktor ~388).
- Der langsamste Schritt der bisherigen Konvertierung (Offline-Audiosynthese)
  entfällt vollständig.

### E2: MuseScore-SVG statt OSMD-Neusatz

**Entscheidung.** Die Notendarstellung ist das von MuseScore selbst
gerenderte SVG. OSMD wird aus dem Viewer entfernt.

**Grund.** Layouttreue („die Noten sehen aus wie unsere Noten") ist für
Chorarbeit kein Kosmetikthema – Sänger orientieren sich am Seitenbild. OSMD
setzt aus MusicXML neu und weicht bei mehrstrophigen Sätzen, Divisi und
Klavierauszügen sichtbar ab. Zusätzlich hat OSMD keinen frei verfügbaren
Audio-Player (Playback ist Early Access für GitHub-Sponsoren), taugt für E1
also ohnehin nicht als Fundament.

**Konsequenzen.**

- Zoom ist gratis (Vektor), A4 ist das native Seitenformat.
- Kein Reflow. „Bildschirmfüllend" wird ein zweites serverseitiges Layout
  oder eine Skalierung, kein Umbruch.
- Der Cursor wird ein Overlay über bekannten Koordinaten statt eines
  Renderer-internen Zustands – siehe Messung M4.
- Wiederholungen lösen sich strukturell auf (siehe M5), statt das Modell zu
  brechen.

### E3: Sidecar bleibt zwingende Voraussetzung

**Entscheidung.** Die App setzt einen erreichbaren Sidecar voraus. Ein
Betrieb ohne Sidecar ist vorerst nicht vorgesehen.

**Grund.** Der Sidecar ist der einzige Weg zu aktuellem, echtem MuseScore 4.
Die Alternative (webmscore/WASM) ist auf MuseScore 3 eingefroren – letzter
Push Januar 2023, offenes Issue seit September 2024, dass aktuelle
MuseScore-4-Dateien leere Ergebnisse liefern. Genau daran leiden beide
existierenden Nextcloud-Apps.

**Bekannte Konsequenz, bewusst in Kauf genommen.** Auf SaaS-gehosteten
Nextcloud-Instanzen ist die App damit nicht installierbar. Das schließt einen
Teil der Zielgruppe aus. Phase 12 hält die Tür für eine spätere Lockerung
offen, indem die HTTP-API des Backends frontendseitig die einzige
Wissensquelle bleibt: Das Frontend darf an keiner Stelle erfahren, woher
seine Artefakte stammen. Ein späterer sidecar-loser Pfad wäre damit ein
reiner Backend-Austausch.

**Nicht verhandelbar dabei:** Wenn der Sidecar Pflicht ist, muss seine
Installation dokumentiert und reproduzierbar sein. Der aktuelle Weg
(Handstart per `docker run`, manueller Cron-Ersatzloop) ist Prototypenstand
und wird in Phase 12 auf AppAPI/ExApp umgestellt.

## 1. Verifizierte Faktenbasis

Alle folgenden Punkte wurden am 2026-08-23 gegen das gebaute Image
`scoreview-musescore-cli` (MuseScore Studio 4.7.4) gemessen, nicht angenommen.
Testpartitur: `spike/test-scores/What_Was_I_Made_For.mscz` (5 Seiten,
63 Takte, SATB, 191 s).

**M1 – `--score-media` funktioniert in 4.7.4.** Exit 0, ein einziger
Prozessstart, 16 MB JSON auf stdout. (Der Batch-Modus `-j` ist in MuseScore 4
kaputt und kommt als Alternative nicht in Frage.)

**M2 – Ein Aufruf liefert alles Benötigte.** Schlüssel im JSON:

| Schlüssel  | Inhalt                 | Größe (dekodiert) |
|------------|------------------------|-------------------|
| `svgs`     | 5 Seiten SVG           | 1173 KB           |
| `sposXML`  | Segmentpositionen      | 52 KB             |
| `mposXML`  | Taktpositionen         | 9 KB              |
| `midi`     | MIDI                   | **8 KB**          |
| `mxml`     | MusicXML (komprimiert) | 19 KB             |
| `pdf`      | PDF                    | 110 KB            |
| `pngs`     | 5 Seiten PNG           | 10392 KB          |
| `metadata` | Titel, Takte, Parts, … | –                 |

Damit fallen die bisherigen drei MuseScore-Prozessstarts auf einen.
`pngs` und `pdf` werden verworfen (PNG ist der mit Abstand größte Posten und
wird durch SVG ersetzt).

**M3 – stdout ist nicht sauber.** MuseScore schreibt 12 Zeilen Qt-Logausgabe
(Locale-Warnung, DBus-Fehler) **vor** das JSON auf stdout. Das JSON beginnt
erst bei Byte-Offset 905. Ein naives `json.load(stdout)` schlägt fehl. Der
Parser muss ab dem ersten `\n{\n` schneiden. Das ist bekanntes
MuseScore-Verhalten (Issue #13304) und darf nicht per Zufall funktionieren.

**M4 – spos/mpos-Koordinaten passen exakt auf das SVG, Faktor 12.**
Die entscheidende Messung für den gesamten Viewer. Die SVG-`viewBox` ist
`0 0 10200 13200`; spos-Koordinaten liegen im Bereich 15447–112357.
Division durch 12 trifft die SVG-Koordinaten exakt:

```
Seite 0: SVG-Notenlinie y=2148.84   spos y/12 = 2148.83
Seite 1: SVG-Notenlinie y=1287.33   spos y/12 = 1287.25
Seite 2: SVG-Notenlinie y=1287.33   spos y/12 = 1287.25
```

Über alle 5 Seiten liegen die durch 12 geteilten Werte sauber innerhalb der
viewBox. Ein Element ist damit als Rechteck `(x/12, y/12, sx/12, sy/12)` auf
Seite `page` adressierbar – ohne Kalibrierung, ohne Heuristik. Das ist die
Grundlage für Cursor-Overlay, Klick-auf-Note und Annotationsanker.

**M5 – Wiederholungen sind ungetestet.** Beide bisherigen Testpartituren
enthalten keine Wiederholung: In `wwimf` und `duckwerk` kommt jedes `elid`
in genau einem Event vor (357/357 bzw. 315/315). Die im Spike gefundene
1:1-Übereinstimmung zwischen Timing-Events und OSMD-Cursorschritten wurde
also nie unter der Bedingung geprüft, unter der sie bricht. Das war der
Hauptbefund des Reviews und ist **weiterhin offen** – erste Aufgabe in
Phase 5.

Erwartung nach Umstellung: Bei einer Wiederholung erscheint dasselbe `elid`
mit mehreren `position`-Werten. Für den Overlay-Cursor ist das der Normalfall
und kein Sonderfall – derselbe Notenkopf wird schlicht zu zwei Zeitpunkten
angesteuert. Das ist ein struktureller Vorteil gegenüber dem bisherigen
ordinalen Matching, muss aber bestätigt werden.

**M7 – Bestätigt für Wiederholung+Volta, offen für D.C.** Gemessen am
2026-08-23 gegen `spike/test-scores/repeat-test.mscz` (5 Takte: Takt 1
Wiederholungsanfang, Takt 2 Volta 1 + Wiederholungsende, Takt 3 Volta 2,
Takt 4 „Fine", Takt 5 „D.C. al Fine"), erzeugt aus
`repeat-test.musicxml` via `mscore4portable … -o repeat-test.mscz`.

`--score-media` liefert 20 Notenelemente (`elid` 0–19) aber 24 Events in
`sposXML`. Die vier `elid`s aus Takt 1 (0–3) erscheinen exakt zweimal, mit
streng monoton steigenden `position`-Werten (0/500/1000/1500 und erneut
4000/4500/5000/5500) – die Wiederholung rollt sich also strukturell aus,
genau wie erwartet. Volta 1 (`elid` 4–7, Takt 2) erscheint nur im ersten
Durchgang, Volta 2 (`elid` 8–11, Takt 3) nur im zweiten – korrektes
Volta-Verhalten. `mposXML` zeigt dieselbe Struktur auf Taktebene (`elid`
0 zweimal, alle anderen einmal) – beide Exporte stimmen überein. Die
exportierte `midi` bestätigt das exakt: 24 Note-on-Events, Gesamtlänge
11520 Ticks bei 480 Ticks/Viertel = 24 Viertel = deckungsgleich mit den 24
sposXML-Events. **Kein Interpolations-/Rundungsrisiko zwischen MIDI und
Timing** – beide Exporte laufen sichtbar durch denselben internen
Wiedergabe-Ablauf.

Für den D.C.-Teil des Tests (Takt 5 → zurück zu Takt 1, Stopp bei „Fine" in
Takt 4) zeigt sich dagegen: **kein dritter Durchlauf.** Weder `sposXML`
noch `midi` enthalten Events für einen erneuten Durchlauf ab `elid` 0 nach
Takt 5. Ursache identifiziert, nicht bloß vermutet: Der aus `mxml`
zurückgelesene MusicXML-Reimport enthält `Fine` nur noch als Text
(`<words>Fine</words>`), aber **kein** `dacapo`/`fine`-Sound-Attribut und
kein Jump/Marker-Element mehr – MuseScore 4.7.4 übernimmt einen per Hand in
MusicXML gesetzten `<sound dacapo="yes"/>`/`<sound fine="yes"/>`-Hinweis
beim Import nicht als Wiedergabe-Sprung, unabhängig davon, ob er an
`<direction>` oder `<barline>` hängt (beides getestet, identisches
Ergebnis). Eine echte, in der MuseScore-GUI selbst angelegte
Jump/Marker-Struktur konnte in dieser Umgebung nicht erzeugt werden (keine
GUI verfügbar) – **D.C./D.S./Coda bleiben damit für „aus der GUI
stammende" Partituren ungetestet.**

**Konsequenz für Phase 8.** Das Cursor-Datenmodell aus Abschnitt 2
(`elid` → mehrere Zeitpunkte statt ordinaler 1:1-Zuordnung) ist für
Wiederholungen/Volta durch echte Messung abgesichert und kann wie geplant
gebaut werden. Für D.C./D.S./Coda gilt dieselbe Modellannahme strukturell
genauso (falls MuseScore intern einen Jump ausführt, erscheint das
betroffene `elid` schlicht ein weiteres Mal in der Eventliste – kein
Sonderfall im Datenmodell) – das ist aber nicht an echtem Material
verifiziert. Risiko entsprechend in Abschnitt 6 ergänzt statt
stillschweigend als erledigt zu behandeln.

**M6 – Der Mixer bekommt seine Struktur frei Haus.** `metadata.tracks`
liefert die Zuordnung Track → Part, inklusive Metronomspur:

```json
[{"instrumentId":"soprano","partId":"1","name":"MS Basic","type":"fluid_soundfont"},
 {"instrumentId":"alto",   "partId":"2", "...": "..."},
 {"instrumentId":"tenor",  "partId":"3", "...": "..."},
 {"instrumentId":"bass",   "partId":"4", "...": "..."},
 {"instrumentId":"metronome","partId":"999", "...": "..."}]
```

`metadata.parts` liefert dazu `instrumentId`, `isVisible`, `lyricCount`,
`hasDrumStaff`. Damit ist die Mixer-UI (Stimmennamen, Solo/Mute pro Stimme,
Metronom zuschaltbar) ohne eigene Analyse des MIDI-Files baubar.
`metadata.measures` (63) und `mposXML` (63 Elemente, 63 Events) liefern die
Taktnavigation.

## 2. Zielarchitektur

```
.mscz in Nextcloud Files
   |
   |  (lazy beim ersten Öffnen; Listener invalidiert nur)
   v
Sidecar: EIN mscore-Aufruf  --score-media
   |     -> svgs[] · midi · sposXML · mposXML · metadata
   |     (pngs/pdf/mxml verworfen)
   v
IAppData-Cache  scoreview/<fileId>/<etag>/
   |     page-1.svg … page-N.svg · score.mid · timing.json · measures.json · meta.json
   v
HTTP-Auslieferung, unveränderlich (ETag + Cache-Control: immutable)
   v
Browser
   |- SVG-Seiten anzeigen ............. Zoom · A4 · bildschirmfüllend
   |- MIDI clientseitig synthetisieren  Tempo · Mixer · Instrumente
   |- Cursor-Overlay über spos/12-Koordinaten
   |- Taktnavigation über mpos
   +- Notizen als Layer an musikalischen Koordinaten (eigene Tabellen)
```

Leitprinzip: **Das Frontend kennt nur die App-eigene HTTP-API.** Es erfährt
nie, dass ein Sidecar existiert. Das hält E3 revidierbar.

## 3. Phasen

### Phase 5 – Wiederholungen klären (Vorbedingung)

Blockiert Phase 8. Zuerst, weil das Ergebnis das Cursor-Datenmodell bestimmt.

- Testpartitur mit Wiederholung, Volta und D.C. anlegen (klein, selbst
  erstellt, damit sie ins Repo darf – siehe `spike/test-scores/README.md`).
- `--score-media` darauf ausführen, `sposXML` auswerten:
  - Kommen `elid`s mehrfach mit verschiedenen `position`-Werten vor?
  - Sind die `position`-Werte über alle Durchgänge monoton steigend?
  - Deckt sich `mposXML` mit derselben Abspielreihenfolge?
- Ergebnis in diesem Dokument als M7 festhalten.

**Abnahme.** Dokumentierte Antwort auf: „Wie sieht die Timingstruktur bei
Wiederholungen aus?" Falls MuseScore Wiederholungen **nicht** ausrollt, ist
ein Ausrollschritt im Sidecar nötig (`mpos` plus Wiederholungsstruktur) –
dann wächst Phase 8 entsprechend.

### Phase 6 – Sidecar auf `--score-media` umstellen

Dateien: `sidecar/server.py`, `sidecar/README.md`, ggf. `sidecar/Dockerfile`.

- `run_conversion()`: drei `run_mscore()`-Aufrufe durch einen
  `--score-media`-Aufruf ersetzen.
- stdout robust parsen: ab erstem `\n{\n` schneiden (M3). Bei fehlendem
  JSON-Start klar als Fehler melden, nicht stillschweigend leerlaufen.
- Aus dem JSON extrahieren und als Dateien ablegen: `page-N.svg` (aus
  `svgs`), `score.mid` (aus `midi`), `timing.json` (aus `sposXML`),
  `measures.json` (aus `mposXML`), `meta.json` (aus `metadata`).
- `pngs`, `pdf`, `mxml` verwerfen.
- Koordinaten beim Parsen **einmal** durch 12 teilen und in SVG-Einheiten
  ablegen. Der Client soll keine Umrechnung kennen müssen.
- `timing.json` neu:
  `{"events": [{"elid": N, "timeMs": N}], "elements": {"<elid>": {"page": N, "x": N, "y": N, "w": N, "h": N}}}`
  – Zeiten und Koordinaten getrennt, beide über `elid` verbunden.
- Upload-Größenlimit einführen.
- Aufräumen: `JOBS_DIR` und `JOBS`-Dict nach Abholung bzw. per TTL leeren
  (bisher unbegrenztes Wachstum).

**Abnahme.** Beide bestehenden Testpartituren laufen durch; das Ergebnis
enthält N SVG-Seiten, MIDI und Timing mit Koordinaten. Ein Prozessstart statt
drei, messbar an der Laufzeit. Eine kaputte `.mscz` landet weiterhin sichtbar
auf `status: error`.

### Phase 7 – Cache, Auslieferung, Job-Struktur

Dateien: `ConversionService.php`, `ConversionController.php`,
`ConvertScoreJob.php`, `ScoreFileListener.php`, `routes.php`.

- Cache-Layout auf variable Seitenzahl umstellen (`page-1.svg` … `page-N.svg`).
- Neue Routen: `…/page/{n}`, `…/midi`, `…/timing`, `…/meta`. Die Routen für
  `musicxml` und `audio` entfernen.
- **HTTP-Caching**: Artefakte sind unveränderlich (der etag steckt bereits im
  Cache-Pfad). `ETag`, `Last-Modified` und
  `Cache-Control: private, immutable, max-age=31536000` setzen, `304`
  beantworten. Bisher wurde bei jedem Öffnen alles neu übertragen.
- Auslieferung auf `StreamResponse` umstellen statt den kompletten Inhalt als
  PHP-String in den Speicher zu laden.
- **Blockierenden Poll-Loop auflösen** (`ConvertScoreJob::pollUntilDone`,
  aktuell bis zu 300 s `sleep` in einem Nextcloud-Worker – blockiert die
  gesamte Job-Queue der Instanz). Aufteilen: Job A reicht ein, Job B pollt
  einmal und reiht sich selbst neu ein, bis fertig oder Deadline erreicht.
- **`ScoreFileListener` entschärfen**: nicht mehr bei jedem Upload
  konvertieren, sondern nur den Cache invalidieren. Der Lazy-Trigger im
  Controller genügt. Eager-Konvertierung höchstens als Admin-Option.
  (Bisher: 300 hochgeladene Partituren = 300 Konvertierungen für Dateien,
  die vielleicht nie jemand öffnet.)
- `#[NoCSRFRequired]` von `status()` entfernen – der Endpunkt hat mit
  `jobList->add()` einen Seiteneffekt. Auf den reinen Auslieferungsrouten
  darf es bleiben.
- Cache-GC: alte etag-Ordner einer fileId aufräumen.

**Abnahme.** Zweites Öffnen derselben Datei erzeugt `304`-Antworten statt
erneuter Übertragung. Drei parallele Konvertierungen blockieren die Job-Queue
nicht mehr. Der Upload von 20 Dateien löst keine Konvertierung aus.

### Phase 8 – SVG-Viewer und Cursor

Dateien: `ScoreViewer.vue`, neu `src/lib/scoreLayout.js`,
`src/composables/useScoreSync.js`, `src/lib/timingSync.js`.

- OSMD entfernen (`opensheetmusicdisplay` aus `package.json`). Das sollte das
  1,39-MB-Bundle deutlich verkleinern.
- SVG-Seiten laden und anzeigen; sichtbare Seiten bevorzugt laden, nicht alle
  auf einmal.
- **Cursor als Overlay**: Bei Wiedergabezeit `t` das größte Event mit
  `timeMs <= t` suchen (binäre Suche – `findStepIndex` aus `timingSync.js`
  bleibt unverändert brauchbar), über `elid` die Koordinaten nachschlagen,
  ein absolut positioniertes Rechteck über der Seite platzieren, bei
  Seitenwechsel scrollen.
- **Ersatzlos entfernen**: `buildStepTimes()` (lineare Interpolation über die
  Gesamtlänge – die Fehlerquelle aus dem Review), `countCursorSteps()` (lief
  die ganze Partitur nur zum Zählen durch), das ordinale Index-Matching und
  der `currentIndex`-Sonderfall.
- Tempo-unabhängig rechnen: `t_original = t_player * speedFactor`. Damit
  bleibt der Cursor auch bei geänderter Abspielgeschwindigkeit korrekt, ohne
  die Timingdaten neu zu berechnen.

**Abnahme.** Der Cursor läuft auf beiden Testpartituren synchron;
Seitenwechsel funktioniert; ein Sprung per `seeked` landet an der richtigen
Note. Bei der Wiederholungs-Testpartitur aus Phase 5 springt der Cursor beim
zweiten Durchgang korrekt zurück.

**Umsetzungsstand (2026-08-23), gefundener Bug.** Gegen einen echten
Playwright-Lauf verifiziert (`repeat-test.mscz`, alle Endpunkte über
`nextcloud-test`) - dabei einen echten, sonst unbemerkten Positionsfehler
gefunden und behoben: `ScorePage.vue`s Regel `.score-page-svg svg { width:
100%; ... }` griff **nie**, weil `v-html` das `<svg>` als rohes DOM ohne
Vues Scoped-CSS-Attribut einfügt - Vue hängt das Scope-Attribut an den
*rechten* Teil des Selektors (`svg[data-v-xxxx]`), der dadurch nichts mehr
trifft. Gemessen: Das SVG rendert dadurch in seiner eigenen mm-Bemaßung
(793.9px) statt auf 100 % der 900px-Containerbreite - das prozentbasierte
Cursor-Overlay (relativ zum Container) und die tatsächlich sichtbare Note
wichen dadurch bei jedem Zoomlevel und jeder Notenposition systematisch
voneinander ab (~11 % Skalenfehler, addiert sich mit dem Abstand vom
Seitenursprung). Fix: `:deep(svg)` statt `svg` - siehe Kommentar dort. Nach
dem Fix per `getBoundingClientRect()` verifiziert: SVG- und
Container-Rechteck sind exakt deckungsgleich, der Cursor sitzt exakt auf
der erwarteten Note (elid 2 bei t=1000ms).

### Phase 9 – Wiedergabe, Tempo, Mixer

Dateien: neu `src/lib/player.js`, Mixer-Komponente.

- Synthese mit **spessasynth_lib** (Apache-2.0, TypeScript, SF2/SF3/DLS,
  aktiv gepflegt – letzter Push August 2026). Fallback-Option:
  `js-synthesizer` (FluidSynth via WASM, LGPL). Beide Lizenzen sind mit
  AGPL-3.0 vereinbar.
- SoundFont als SF3 ausliefern (komprimiert; SF2 wäre um ein Vielfaches
  größer). Auslieferungsweg und Caching bewusst festlegen – das ist der
  größte statische Posten der App.
- Transport: Play/Pause/Stop/Seek, Position in Sekunden nach außen für den
  Cursor.
- **Tempo**: globaler Faktor. Skaliert die Timingdaten linear korrekt, auch
  bei Tempowechseln im Stück.
- **Mixer**: Lautstärke, Solo und Mute pro Stimme, Zuordnung über
  `metadata.tracks[].partId` (M6). Metronomspur separat schaltbar.
- **Instrumentenwechsel**: Program Change pro Kanal, Auswahl aus dem
  SoundFont.
- Verifizieren, dass die MIDI-Kanalreihenfolge der Reihenfolge in
  `metadata.tracks` entspricht – sonst über `instrumentId` zuordnen.

**Abnahme.** Eine Stimme lässt sich isoliert laut stellen, während der Rest
leise bleibt; Tempo 70 % läuft synchron zum Cursor; ein Instrumentenwechsel
ist hörbar. Das sind drei Roadmap-Ziele, die mit MP3 unerreichbar waren.

**Umsetzungsstand (2026-08-23).** `lib/player.js`, `lib/mixerLayout.js`
(rein, unit-getestet), `ScoreMixer.vue` und die Backend-Seite sind
implementiert und Ende-zu-Ende an echtem Ton verifiziert (siehe unten).

**Korrektur der SoundFont-Auslieferung (2026-08-23, zweite Sitzung).** Der
ursprüngliche Weg – SoundFont-URL als Admin-Einstellung, leer = kein Ton –
war zwar lizenzrechtlich sauber gedacht, hatte aber eine Konsequenz, die im
Betrieb schwerer wiegt: **das leere Feld ist der Auslieferungszustand, die
App war damit standardmäßig stumm.** Genau so ist sie beim Nutzer
angekommen („funktioniert, aber kein Ton"). Ein Betreiber hätte selbst ein
40-MB-SF3 finden, lizenzieren, CORS-fähig hosten und eintragen müssen,
bevor überhaupt ein Ton zu hören ist.

Umgestellt auf: **die App liefert das SoundFont selbst aus** (`GET
/api/soundfont`, `Controller\SoundFontController`). Sie holt es einmalig vom
Sidecar (`GET /soundfont`, neu in `sidecar/server.py`) und legt es in
IAppData ab (`Service\SoundFontService`). Der Sidecar ist nach E3 ohnehin
Pflicht und bringt durch die MuseScore-Installation bereits ein
General-MIDI-SoundFont mit – MuseScore kann ohne eines gar kein Audio
rendern. Damit fällt die Lizenzfrage nicht weg, sie ist nur dort verortet,
wo sie ohnehin schon beantwortet war: im Sidecar-Image. Default ist
`MuseScore_General_Lite.sf3` aus dem Debian-Paket
`musescore-general-soundfont-small` (MIT, S. Christian Collins); das
ebenfalls vorhandene `MS Basic.sf3` aus dem AppImage ist bewusst nicht
Default (MuseScore-eigene Bedingungen statt schlicht permissiv), über
`SCOREVIEW_SOUNDFONT_PATH` aber wählbar.

Nebeneffekte, die den Ausschlag mitgegeben haben: der Abruf ist damit
same-origin (kein CORS, keine `connect-src`-Ausnahme für einen fremden
Host), und der SoundFont-Cache-Schlüssel ist ein Content-Hash, den
`/soundfont/info` liefert – ein SoundFont-Wechsel im Image invalidiert
Server- und Browser-Cache automatisch. Die Admin-Einstellung
`soundfont_url` bleibt als **Übersteuerung** bestehen (siehe
`ConversionController::soundFontUrl()`).

Gegen einen echten Playwright-Lauf mit MuseScores eigenem `MS Basic.sf3`
(nur lokal geliehen, nicht im Repo) wurden zwei **echte, sonst blockierende**
CSP-Lücken gefunden und in `Listener\AddCspListener.php` behoben (siehe dort
für Details) – ohne beide bricht jede echte Wiedergabe in jeder
Nextcloud-Instanz mit Default-CSP:

1. `wasm-unsafe-eval` fehlte in `script-src` – spessasynth_lib dekodiert
   Vorbis-Samples per WebAssembly (`stb-vorbis`), `WebAssembly.instantiate()`
   scheitert sonst an derselben CSP-Regel wie `eval()`.
2. `connect-src` erlaubte nur `'self'` – jeder `fetch()` zur konfigurierten
   (potenziell fremden) SoundFont-URL wurde geblockt. Gelöst über
   `AddContentSecurityPolicyEvent` (der Viewer hängt sich per
   `Util::addScript` in die Files-Seite ein, hat also keine eigene
   Controller-Response, an der sich die CSP direkt setzen ließe) plus
   dynamisches `addAllowedConnectDomain()` für den Host aus `soundfont_url`.

**Tonausgabe jetzt gemessen, nicht mehr nur angenommen (2026-08-23, zweite
Sitzung).** Verifiziert über einen Playwright-Lauf gegen `nextcloud-test`,
der den Web-Audio-Graph unmittelbar vor `AudioContext.destination` anzapft
(`AnalyserNode` pro Worklet-Ausgang) und Pegel misst – in einem
Headless-Browser gibt es kein Ausgabegerät, „es klingt" muss also gemessen
werden. Testpartitur `What_Was_I_Made_For.mscz` (SATB), Wiedergabe ab
Takt 30:

- **Es kommt Signal an.** Ausgänge 1–4 des Synth-Worklets führen die vier
  Stimmen (Spitzenpegel 0,051 / 0,029 / 0,020 / 0,036), Ausgang 0 den
  Effektbus, die Ausgänge 5–16 sind stumm (ungenutzte MIDI-Kanäle) – genau
  das erwartete Bild für SATB.
- **Der Pegel stimmt größenordnungsmäßig.** Als unabhängige Referenz
  dieselbe Partitur von MuseScore selbst nach WAV gerendert
  (`mscore4portable … -o wwimf.wav`): Spitze 0,138 / RMS 0,026 über die
  ersten 25 s. Der Browser-Mixdown liegt bei Spitze 0,062 / RMS 0,011 über
  ein vergleichbares Fenster, also rund 7 dB darunter – erklärbar durch das
  andere SoundFont (MuseScore General Lite statt MS Basic) und fehlende
  Master-Effekte, kein kaputter Verstärkungspfad.
- **Mixer wirkt hörbar, Kanalzuordnung stimmt.** Solo auf Mixerkanal 0
  („Soprano") lässt exakt einen Ausgang stehen (Ausgang 1, Spitze steigt
  auf 0,090), die drei anderen Stimmen fallen auf 0. Damit ist die
  Indexannahme aus `mixerLayout.js` (MIDI-Kanal `i` = `metadata.tracks[i]`)
  an echtem Ton bestätigt – das war eine offene Zeile in der Risikotabelle.
- **Tempo verschiebt die Zeitachse nicht.** Bei `playbackRate` 0,5 rücken
  6 s Wanduhr die Transportzeit um 3011 ms vor, bei 1,0 um 6040 ms –
  `sequencer.currentTime` bleibt also auf der Original-Zeitachse der
  Partitur. Die Annahme aus Phase 8 („Tempo-unabhängig rechnen", kein
  Umrechnen in `useScoreSync.js`) ist damit gemessen, nicht mehr aus
  Typdefinitionen geschlossen.

Dabei gefundene und behobene Fehler:

1. **Der Mixer beschriftete alle Stimmen gleich.** `metadata.tracks[].name`
   ist bei MuseScore 4 der Name der Klangbibliothek und lautet für jede
   Stimme `"MS Basic"` – der Mixer zeigte fünf identische Regler und war
   für „meine Stimme lauter" unbrauchbar. Der Stimmenname steht in
   `metadata.parts[].name`, verbunden über `parts[].id === tracks[].partId`;
   `resolveMixerChannels()` nimmt jetzt beides entgegen. Ebenso übernommen:
   `parts[].program` als Startwert der Instrumentenauswahl (vorher fix 0,
   das Auswahlfeld behauptete also „Acoustic Grand Piano", während Choir
   Aahs klang).
2. **Scheiterte der SoundFont-Abruf, war die Partitur danach nicht mehr
   durchfahrbar.** Der Fallback in `ScoreViewer.setUpRealPlayer()` baute
   den stummen Ersatztakt mit einer *leeren* Zeitachse
   (`buildTimeline({events: []})`) statt mit der bereits geladenen – die
   Transportdauer wurde dadurch 0. Jetzt wird die echte Timeline verwendet.
3. **„Kein Ton" war von außen nicht diagnostizierbar.** Der Hinweis lautete
   pauschal „Wiedergabe ist nicht konfiguriert", auch wenn in Wahrheit der
   Abruf oder der Synthesizer gescheitert war. Er nennt jetzt die konkrete
   Ursache (`playbackError`).

**Umgebungsproblem, weiterhin gültig:** Windows Defender quarantänierte in
der ersten Sitzung Dateien unter `scoreview/node_modules`
(`stb-vorbis/dist/index.js`), bestätigt über `Get-MpThreatDetection`. Das
betrifft **jeden** `npm install`/`npm run build` auf einer
Defender-geschützten Maschine ohne Ausnahme für `node_modules` und kann
`spessasynth_lib` im Build unbrauchbar machen (siehe Risiko-Tabelle). In
dieser Sitzung trat es nicht erneut auf, der Build lief durch. Auf
Nutzerwunsch nicht automatisch behoben (Antivirus-Ausnahmen sind eine
Sicherheitseinstellung, keine, die eine Sitzung selbst setzen sollte).

### Phase 10 – Probenarbeit und Darstellung

- Taktnavigation über `measures.json`: „springe zu Takt 42" setzt Player und
  Cursor. Taktnummern-Eingabe und Klick auf einen Takt im SVG.
- Loop von Takt A bis Takt B (Kernfunktion für Probenarbeit).
- Zoom (stufenlos über die SVG-Skalierung).
- Darstellungsmodi: A4 einzeln, fortlaufend, bildschirmfüllend. Eine echte
  Umbruchänderung erfordert ein zweites serverseitiges Layout mit anderen
  Seitenmaßen (`-S style.mss`) – erst umsetzen, wenn der Bedarf bestätigt ist.
- Klick auf eine Note springt dorthin (Umkehrung von M4: Koordinate → `elid`
  → Zeit).

**Abnahme.** Eine Probe lässt sich damit tatsächlich durchführen: Takt
ansteuern, Abschnitt loopen, eigene Stimme lauter, langsameres Tempo.

**Umsetzungsstand (2026-08-23).** `findMeasureStartTime`/`findElementAtPoint`/
`findNearestOccurrenceTimeMs` in `scoreLayout.js` (rein, unit-getestet).
Taktnavigation, Loop, Zoom und Klick-auf-Note gegen einen echten
Playwright-Lauf verifiziert: Sprung zu Takt 3 landet exakt bei 6000 ms
(deckt sich mit der M7-Messung), Zoom 1.5 skaliert die Seitenbreite exakt
auf 1350px, ein Loop Takt 1→1 bleibt über 6 s Wiedergabe zuverlässig
innerhalb der Taktgrenze, ein Seitenklick löst einen Sprung zur
nächstgelegenen Note aus. „Klick auf einen Takt im SVG" bewusst NICHT als
eigene, taktgenaue Trefferfläche gebaut - derselbe klick-auf-Note-Handler
deckt den praktischen Bedarf ab (Klick irgendwo im Takt landet auf die
nächstgelegene Note darin), eine separate Takt-Trefferfläche wäre
Mehraufwand ohne zusätzlichen Probennutzen. Darstellungsmodi (A4 einzeln /
bildschirmfüllend) wie geplant nicht umgesetzt - der bestehende
fortlaufende Einspaltenmodus deckt die Baseline ab, bis Bedarf für die
anderen Modi bestätigt ist.

### Phase 11 – Notizen pro Nutzer

Neue Migration, neue Tabellen, neuer Controller.

Die zentrale Entscheidung dieser Phase ist der **Anker**, nicht die UI.

- Anker sind **musikalische Koordinaten** (Part, Staff, Takt, Beat/Fraction,
  Voice), nicht Renderer-Indizes und nicht Pixel. Nur sie überleben ein
  Neurendern und die meisten Bearbeitungen der Quelldatei.
- `elid` als sekundärer Anker für exaktes Wiederfinden innerhalb desselben
  etags.
- Tabelle `scoreview_annotations`: `fileId`, `userId`, Anker, Typ, Inhalt,
  Zeitstempel. Bewusst **nicht** an den etag gebunden – Notizen müssen einen
  Re-Upload überleben.
- Migrationsstrategie über etag-Wechsel definieren: Anker über Takt/Beat
  wiederfinden, nicht auflösbare Notizen sichtbar als „verwaist" markieren
  statt sie zu verlieren.
- Sichtbarkeit: privat pro Nutzer. Geteilte Notizen (Chorleitung an alle)
  erst später, aber im Datenmodell vorsehen.

**Abnahme.** Zwei Nutzer sehen auf derselben geteilten Datei ihre eigenen
Notizen. Ein Re-Upload der Datei behält sie.

**Umsetzungsstand (2026-08-23), Abweichung vom Plan.** Anker abweichend von
der ursprünglichen Formulierung umgesetzt: **Takt + Bruchteil innerhalb des
Taktes** (`measure_number`, `fraction` 0.0-1.0) statt „Part, Staff, Takt,
Beat/Fraction, Voice" - `--score-media` liefert pro Note/Takt nur Zeit +
Koordinate, keine Part/Staff/Voice-Zuordnung (siehe M2/M4), ein
feingranularerer Anker wäre also nicht aus echten Sidecar-Daten ableitbar
gewesen, sondern erfunden. Takt+Bruchteil ist trotzdem ein musikalischer,
kein Pixel-Anker - berechnet aus der Wiedergabezeit über
`resolveMeasurePosition()`/`measurePositionToTimeMs()` (`scoreLayout.js`,
unit-getestet), unabhängig von Zoom, Seitenumbruch und Renderer-Indizes.
`elid` + `anchor_etag` als Sekundäranker wie geplant, für die exakte
Notenkoordinate innerhalb desselben etags (Migration
`Version000100Date20260823130000`).

„Verwaist"-Markierung umgesetzt als: `measureNumber` liegt über der
aktuellen Taktzahl der Partitur (`AnnotationService::listForFile()`) - ein
Re-Upload, der Takte entfernt hat. Eine unveränderte `measureNumber` bei
GLEICHER oder GRÖSSERER Taktzahl gilt bewusst nicht als verwaist, das ist
der Kernvorteil des musikalischen Ankers gegenüber Pixelkoordinaten.

Gegen einen echten Playwright-Lauf verifiziert: Notiz an aktueller Position
anlegen (Takt 3), Marker erscheint exakt auf der richtigen Note im SVG,
Notiz übersteht einen vollen Seiten-Reload (also DB-Persistenz bestätigt,
nicht nur clientseitiger Zustand), Bearbeiten/Löschen funktionieren, Klick
auf den Marker springt exakt auf Takt 3 (6000 ms, deckt sich mit M7).

**Nicht umgesetzt / bewusst zurückgestellt:**
- Geteilte Notizen (Chorleitung an alle) - `visibility`-Spalte liegt im
  Schema bereit (`private`/`shared`), aber nur `private` wird geschrieben/
  gelesen - wie im Plan „im Datenmodell vorsehen, aber nicht umsetzen"
  vorgezeichnet.
- Die Zwei-Nutzer-Abnahme („zwei Nutzer sehen auf derselben Datei ihre
  eigenen Notizen") nicht separat verifiziert - folgt aber direkt aus der
  serverseitigen `(fileId, userId)`-Filterung in
  `AnnotationMapper::findByFileIdAndUser()` und
  `AnnotationController::requireOwnAccess()`, dieselbe Isolation wie beim
  bereits verifizierten Cross-User-404-Test in Phase 7.

### Phase 12 – Betrieb und Härtung

- **Sidecar als AppAPI/ExApp** statt Handstart. Das ist die Einlösung der
  Zusage aus E3: Installation über die Nextcloud-UI statt `docker run`,
  `occ config:app:set` und manuellem Cron-Loop.
- **Sandboxing des Konvertierungsprozesses.** Der Sidecar lässt eine große
  C++/Qt-Codebasis auf beliebige, nicht vertrauenswürdige Nutzerdateien los –
  aktuell als root, mit Netzwerkzugang, ohne Ressourcenlimits. Minimum:
  non-root, `--network none`, read-only Rootfs mit tmpfs-Workdir,
  `--memory`, `--pids-limit`. Der bestehende Timeout-Guard bleibt.
- Admin-UI: Sidecar-Health sichtbar machen, Fehlerdiagnose ohne Logzugriff.
- `README.md` und `appinfo/info.xml` aktualisieren – beide beschreiben noch
  die alte Architektur (MusicXML + Audio, „Wiedergabe-Cursor zur Audiospur").
- Sinnvolle Grenzwerte dokumentieren (Partiturgröße, Seitenzahl, Timeout).

**Umsetzungsstand (2026-08-23), teilweise umgesetzt.**

- **Non-root Konvertierungsprozess: umgesetzt und verifiziert.**
  `sidecar/Dockerfile` legt einen eigenen `scoreview`-Nutzer (UID 10001) an
  und wechselt per `USER scoreview` dorthin, bevor `server.py`/
  `mscore4portable` läuft. Verifiziert per `docker exec scoreview-sidecar
  whoami` (liefert `scoreview`, nicht `root`) und einer echten
  End-zu-Ende-Konvertierung unter diesem Nutzer über die volle
  Nextcloud-Pipeline.
- **`--network none`: geprüft und als nicht umsetzbar in dieser Form
  verworfen**, nicht einfach ausgelassen: derselbe Container bedient die
  eigene HTTP-API, über die PHP die Konvertierung erst einreicht - ganz
  ohne Netzwerk gäbe es keinen Weg, den Container anzusprechen. Eine
  Isolation nur für den `mscore4portable`-Subprozess (nicht für den ganzen
  Container) bräuchte eine eigene Sandbox-Schicht (z.B. Netzwerk-Namespace-
  Trennung innerhalb des Containers) und ist ein größeres, weiterhin
  offenes Architekturthema - siehe `sidecar/README.md`.
  `--memory`/`--pids-limit` sind stattdessen als empfohlene `docker
  run`-Flags dokumentiert (kein Code, nur Betriebsempfehlung).
- **`README.md`/`appinfo/info.xml` aktualisiert.** Root-`README.md` und
  `info.xml`-Beschreibung spiegeln jetzt die SVG/MIDI/Sidecar-Architektur
  statt der alten MusicXML/MP3-Beschreibung. `info.xml`-Version auf 0.0.8
  angehoben. `scoreview/README.md` zusätzlich um einen
  **Troubleshooting-Abschnitt** ergänzt (zwei real aufgetretene, in dieser
  Sitzung gefundene und behobene Fehlerbilder - siehe unten).
- **Nicht umgesetzt:** AppAPI/ExApp-Verpackung (eigenständiges,
  umfangreiches Packaging-Vorhaben, bewusst nicht in dieser Sitzung
  begonnen), Admin-UI für Sidecar-Health, dokumentierte Grenzwerte für
  Partiturgröße/Seitenzahl/Timeout jenseits der bestehenden
  `MSCORE_TIMEOUT_SECONDS`/`SCOREVIEW_MAX_UPLOAD_BYTES`-Env-Vars.

**Neu gefundene Lücke: Cache-Format-Upgrade nicht migriert.** Beim
Testen mit einem Nutzer, dessen `.mscz`-Dateien schon vor dem
Phase-6/7-Umbau (altes Cache-Format: `score.musicxml`/`audio.mp3`) einmal
erfolgreich konvertiert worden waren, warf `status()` einen 500er
(`OCP\Files\NotFoundException` beim Lesen von `meta.json`, das im alten
Format nie existierte). Ursache: Der Cache-Schlüssel ist `(fileId, etag)`
(siehe `ConversionService`) - ein unverändertes `etag` lässt
`ConversionController::status()` den alten, als `status=ready` markierten
Datensatz für gültig halten, obwohl der zugehörige IAppData-Ordner nicht
zum aktuellen Controller/Sidecar-Format passt. **Kein automatischer
Migrationspfad vorhanden.** Für diese Sitzung manuell behoben (betroffene
`scoreview_conversions`-Zeilen gelöscht, siehe
`scoreview/README.md#troubleshooting`), aber das ist ein struktureller
Gap, der jede reale Installation träfe, die vor einem künftigen
Cache-Format-Wechsel schon Partituren konvertiert hatte. Für einen
sauberen Fix (nicht umgesetzt, da über den Rahmen dieser Sitzung
hinausgehend): entweder ein Format-Versionsfeld in
`scoreview_conversions`, das bei jedem inkompatiblen Umbau hochgezählt
wird und `status()`/`serveCachedFile()` zwingt, ältere Versionen wie
„nicht fertig" zu behandeln, oder defensiv `NotFoundException` beim
Lesen der Cache-Dateien als „muss neu konvertiert werden" statt als
500 behandeln.

### Phase 13 – Korrektur-Layer (später)

Für „die Chorleitung möchte in der Probe etwas anders".

Grundsatz: **Die `.mscz` wird nie aus der App heraus überschrieben.** Der
MusicXML-Roundtrip verliert Daten, und die Datei liegt möglicherweise in
einem Share, das parallel bearbeitet wird. Änderungen sind ein Layer über der
Quelle – dieselbe Datenstruktur wie die Notizen aus Phase 11, andere
Semantik. Die Nextcloud-Datei bleibt Single Source of Truth.

Vor Beginn zu klären: Was kann ein Layer überhaupt darstellen (Text- und
Dynamikänderungen ja, strukturelle Eingriffe eher nicht), und wie wird er
gerendert – als Overlay über dem SVG oder durch erneutes Rendern einer
modifizierten Quelle im Sidecar.

## 4. Was ersatzlos entfällt

| Entfällt | Grund |
|---|---|
| MP3-Erzeugung im Sidecar | E1 |
| `opensheetmusicdisplay` im Viewer | E2 |
| `buildStepTimes()` (lineare Interpolation) | Falsch bei Wiederholungen; durch `elid`-Zuordnung ersetzt |
| `countCursorSteps()` | Ordinales Matching entfällt |
| Zwei der drei `mscore`-Aufrufe | M2 |
| MusicXML als Auslieferungsformat | Wird vom Viewer nicht mehr gebraucht |
| Eager-Konvertierung im Listener | Phase 7 |

`.mpos` kehrt zurück: Im Spike wurde es als Cursor-Treiber verworfen (zu grob
für Notenschritte) – für Taktnavigation ist es genau das richtige Format. Die
damalige Entscheidung war richtig, betraf aber einen anderen Zweck.

## 5. Was bewusst offen bleibt

- **SaaS-Installierbarkeit.** Durch E3 vorerst ausgeschlossen. Phase 12
  reduziert die Hürde auf „der Hoster muss AppAPI anbieten", beseitigt sie
  aber nicht. Ein sidecar-loser Pfad (MusicXML-Eingang mit clientseitigem
  Renderer) bleibt architektonisch möglich, solange das Leitprinzip aus
  Abschnitt 2 eingehalten wird.
- **Klangqualität** der clientseitigen Synthese gegenüber MuseScore-MP3.
  Erste Messung liegt vor (Phase 9): der Pegel liegt rund 7 dB unter
  MuseScores eigenem Render, die Stimmentrennung stimmt. Ob der Klang für
  Probenarbeit *ausreicht*, ist damit nicht beantwortet – das braucht ein
  Urteil am Ohr, an mehr als einer Partitur.
- **Große Partituren.** Alle Messungen stammen von einem fünfseitigen
  SATB-Satz. Das Verhalten bei Orchesterpartituren (Seitenzahl, SVG-Größe,
  Konvertierungsdauer) ist unbekannt.

## 6. Risiken

| Risiko | Auswirkung | Umgang |
|---|---|---|
| Wiederholungen im Timing anders als erwartet | Cursor-Datenmodell ändert sich | Phase 5 vor Phase 8 |
| SoundFont-Größe verschlechtert Erstladezeit spürbar | UX | Kleineren SF3 wählen, aggressiv cachen, Ladefortschritt zeigen |
| ~~MIDI-Kanalreihenfolge ≠ `metadata.tracks`~~ **erledigt** | Mixer ordnet falsch zu | An echtem Ton bestätigt: Solo auf Mixerkanal 0 lässt genau die Sopranstimme stehen (siehe Phase 9) |
| SVG-Seiten großer Partituren zu schwer fürs DOM | Ruckeln | Nur sichtbare Seiten rendern |
| `--score-media` in künftiger MuseScore-Version geändert | Pipeline bricht | Version ist gepinnt; Update bewusst und getestet |
| MuseScore-Sicherheitslücke über präparierte `.mscz` | Server kompromittiert | Phase 12, nicht später |
| D.C./D.S./Coda werden von `--score-media` nicht ausgerollt (M7, nur mit Hand-MusicXML getestet, GUI-Fall offen) | Cursor bleibt bei einem Sprung stumm/stehen statt zu springen, Restpartitur bleibt aber normal navigierbar | An echter, in der MuseScore-GUI erstellter Partitur mit D.C. nachprüfen, sobald verfügbar; Cursor-Code darf sich nicht auf lückenlose `elid`-Abdeckung verlassen |
| Antivirus (bestätigt: Windows Defender) quarantäniert Dateien unter `scoreview/node_modules` (u.a. `stb-vorbis/dist/index.js`) | `npm install`/`npm run build` liefert ein kaputtes `spessasynth_lib` aus, Phase 9 bricht ohne offensichtliche Fehlerursache | Defender-Ausnahme für `scoreview/node_modules` einrichten (siehe Phase 9); auf CI/Build-Maschinen vorab prüfen |
| ~~Echte Tonausgabe (Phase 9) nicht Ende-zu-Ende verifiziert~~ **erledigt** | – | Pegel, Mixer-Wirkung und Tempo-Zeitachse am laufenden Browser gemessen und gegen einen MuseScore-WAV-Render verglichen (siehe Phase 9) |
| Klangqualität/Lautstärke: der Browser-Mixdown liegt ~7 dB unter MuseScores eigenem Render (gemessen, siehe Phase 9) | Nutzer, die MuseScore gewohnt sind, empfinden die Wiedergabe als leise | Bewusst kein pauschaler Verstärkungsfaktor eingebaut (Clipping-Risiko in lauten Passagen); erst an mehr echtem Material bewerten – der Unterschied stammt vor allem aus SoundFont-Wahl und fehlenden Master-Effekten |
| Neue Route in `appinfo/routes.php` wirkt bis zu 1 h nicht (`CachingRouter` cached die kompilierte Routentabelle je Host-Header) | Endpunkt liefert 404, obwohl korrekt definiert – irreführend, weil derselbe Request mit anderem Host-Header sofort funktioniert | App-Version in `info.xml` erhöhen + `occ upgrade`, oder lokalen Cache leeren; dokumentiert in `scoreview/README.md#troubleshooting` |
| Cache-Format-Wechsel (wie in dieser Sitzung Phase 6/7) hat keinen Migrationspfad für schon konvertierte Partituren (siehe Phase 12, „Neu gefundene Lücke") | `status()` liefert 500 für jede Datei, die unter einem älteren Cache-Format bereits `status=ready` war | Betroffene `scoreview_conversions`-Zeilen manuell löschen (siehe `scoreview/README.md#troubleshooting`), bis ein Format-Versionsfeld oder eine defensive Fehlerbehandlung existiert |
| Neu registrierter Mimetype gilt nicht rückwirkend für schon vorhandene Dateien (`occ maintenance:mimetype:update-db` reicht dafür nachweislich NICHT, entgegen einer früheren, jetzt widerlegten Annahme in `scoreview/README.md`) | Alte `.mscz`-Bestandsdateien bieten nur „Herunterladen" an, nicht den Viewer | Nach Registrierung zusätzlich `occ files:scan <Nutzer>` (oder `--all`) für den betroffenen Bestand ausführen - siehe `scoreview/README.md#troubleshooting` |
