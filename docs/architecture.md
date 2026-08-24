# Architektur

Wie ScoreView aufgebaut ist, welche Entwurfsentscheidungen dahinterstehen und
auf welchen Eigenschaften des MuseScore-Exports die Umsetzung aufbaut. Dieses
Dokument beschreibt den Stand der App; die Entwicklungsgeschichte liegt in
[`history/plan.md`](history/plan.md) und ist nicht gepflegt.

## Überblick

ScoreView besteht aus drei Teilen, die über HTTP miteinander sprechen:

| Teil | Wo | Aufgabe |
|---|---|---|
| Nextcloud-App | `scoreview/lib/` (PHP) | Konvertierung anstoßen, Ergebnis cachen, Artefakte ausliefern, Notizen verwalten |
| Viewer | `scoreview/src/` (Vue 3) | Notenseiten anzeigen, MIDI im Browser synthetisieren, Cursor führen |
| Sidecar | `sidecar/` (Python + MuseScore 4) | `.mscz` in Notenseiten, MIDI und Timing-Daten übersetzen |

Der Sidecar läuft als eigener Container neben Nextcloud und ist nicht Teil des
App-Pakets (siehe [E3](#e3-der-sidecar-ist-voraussetzung)). Seine HTTP-API
beschreibt [`../sidecar/README.md`](../sidecar/README.md).

## Datenfluss

```
.mscz in Nextcloud Files
   |
   |  Öffnen im Viewer stößt die Konvertierung an; ein Datei-Listener
   |  invalidiert nur den Cache, er konvertiert nicht selbst
   v
Sidecar: ein mscore-Aufruf --score-media
   |     -> svgs[] · midi · sposXML · mposXML · metadata
   |     (pngs/pdf/mxml werden verworfen)
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
erfährt an keiner Stelle, dass ein Sidecar existiert. Nur deshalb bleibt
[E3](#e3-der-sidecar-ist-voraussetzung) revidierbar – ein späterer Weg ohne
Sidecar wäre ein reiner Backend-Austausch. Diese Trennung bitte nicht
aufweichen.

## Serverseite

### HTTP-API

Alle Routen liegen unter `/apps/scoreview/api/` und stehen in
`scoreview/appinfo/routes.php`. Die App hat bewusst **keine eigene Seite** und
keinen Navigationseintrag; `/apps/scoreview/` antwortet 404. Einstiegspunkt ist
ausschließlich die Viewer-Integration in Files.

| Route | Zweck |
|---|---|
| `GET /api/scores/{fileId}/status` | Konvertierungsstatus, Seitenzahl, Metadaten |
| `GET /api/scores/{fileId}/artifact/{name}` | Ein Artefakt aus dem Cache (`page-N`, `midi`, `timing`, `measures`, `meta`) |
| `GET /api/soundfont` | Das SoundFont für die Browser-Wiedergabe |
| `GET\|POST\|PUT\|DELETE /api/scores/{fileId}/annotations[/{id}]` | Notizen |
| `POST /api/settings` | Admin-Einstellungen speichern |
| `GET /api/health`, `POST /api/selftest` | Betriebsdiagnose, Sidecar-Selbsttest (nur Admins) |

Gültige Artefaktnamen sind eine Allowlist in `ConversionService`, kein
Dateipfad. Die Route selbst schränkt nur die Zeichenklasse ein, damit ein
unbekannter Name als 404 aus dem Controller kommt und nicht als Routing-Fehler.

### Konvertierung und Cache

Konvertiert wird **lazy**: Erst das Öffnen einer Partitur reiht
`ConvertScoreJob` ein, `PollConversionJob` holt das Ergebnis ab. Optional lässt
sich in den Admin-Einstellungen die Vorab-Konvertierung beim Hochladen
einschalten (`eager_conversion`).

Der Cache-Schlüssel ist `(fileId, etag)`: Eine geänderte Datei bekommt ein neues
`etag` und damit automatisch einen neuen Cache-Eintrag; der alte wird verworfen.
Die Artefakte selbst sind unveränderlich und werden mit `ETag` und
`Cache-Control: immutable` ausgeliefert.

Die Spalte `format_version` in `scoreview_conversions` hält fest, mit welchem
Cache-Format ein Eintrag geschrieben wurde. Ein Eintrag mit älterer Version –
oder mit fehlender Cache-Datei – gilt automatisch als „nicht fertig" und stößt
eine Neukonvertierung an. Ein Formatwechsel braucht deshalb **keinen**
Migrationspfad und kein manuelles Löschen von Zeilen.

### Datenbank

| Tabelle | Inhalt |
|---|---|
| `scoreview_conversions` | `file_id`, `etag`, `status`, `error_code`, `error_message`, `format_version` |
| `scoreview_annotations` | `file_id`, `user_id`, `content`, `visibility`, `measure_number`, `fraction`, `elid`, `anchor_etag` |

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
  `ScoreMixer.vue`, `ScoreAnnotations.vue`, `AdminSettings.vue`.
- `src/composables/` – der Zustand des Viewers, nach Themen getrennt:
  Konvertierungsstatus, Notizen, Zoom, Autoscroll, Metronom, Loop, Wiedergabe.
- `src/lib/` – **reine Logik ohne DOM, ohne `AudioContext`, ohne Nextcloud** und
  damit ohne Browser testbar: `scoreLayout.js`, `mixerLayout.js`,
  `timingSync.js`, `scrollPlan.js`, `metronome.js`, `svgSanitizer.js`,
  `silentClock.js`, `player.js`, `scoreSync.js`. Neue Logik gehört hierhin, nicht
  in die Komponenten.

Wiedergabe: `spessasynth_lib` synthetisiert das MIDI im Browser gegen das
ausgelieferte SoundFont. Eine einzige `requestAnimationFrame`-Schleife treibt
Cursor, Autoscroll, Loop und Metronom; SVG-Seiten werden beim Wegscrollen wieder
aus dem DOM genommen.

Nur sichtbare Seiten werden gerendert. Eingehendes SVG läuft durch einen echten
Sanitizer (DOMPurify), nicht durch reguläre Ausdrücke.

## Entwurfsentscheidungen

Diese fünf Entscheidungen tragen den Aufbau. Sie sind im Code an vielen Stellen
als `E1`…`E5` referenziert und sollten nicht ohne erneute Bewertung revidiert
werden.

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

### E3: Der Sidecar ist Voraussetzung

Die App setzt einen erreichbaren Sidecar voraus; ein Betrieb ohne ihn ist nicht
vorgesehen. Der Sidecar ist der einzige Weg zu aktuellem, echtem MuseScore 4.
Die Alternative (webmscore/WASM) ist auf MuseScore 3 eingefroren und liefert für
aktuelle `.mscz`-Dateien leere Ergebnisse.

**Bewusst in Kauf genommen:** Auf SaaS-gehosteten Nextcloud-Instanzen ist die App
damit nicht installierbar. Das Leitprinzip oben hält die Tür für eine spätere
Lockerung offen.

Wege, den Sidecar bereitzustellen, stehen in
[`../sidecar/README.md`](../sidecar/README.md#bereitstellung).

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

## Formatgrundlagen

Eigenschaften des MuseScore-Exports, auf denen die Umsetzung aufbaut. Alle gegen
das gebaute Image gemessen, nicht angenommen. Die Kennungen `M1`…`M9` sind im
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

### M9: Das SVG trägt keine Kennung, die sich mit `elid` verbinden lässt

Im gesamten Dokument steht kein einziges `id="…"`-Attribut. Adressierbar ist nur
über `class` (`Note`, `BarLine`, `StaffLines`, `Clef`, …) – eine Kategorie, kein
Bezug zu einer einzelnen Note. Eine echte Hervorhebung des getroffenen
Notenkopfs (Füllfarbe, `filter`) ist damit **nicht** möglich; das Overlay bleibt
die einzige Option.

Für die Overlay-Umsetzung wichtig: Das allererste Element im Dokument ist ein
deckendes weißes Hintergrundrechteck über die volle `viewBox` – als einziges
Element mit leerem `class`-Attribut zuverlässig über `path[class=""]`
adressierbar, ohne von der Dokumentreihenfolge abzuhängen. Ein Cursor-Overlay
hinter dem SVG bliebe ohne diese Regel unsichtbar.

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
