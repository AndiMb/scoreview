# ScoreView – Umsetzungsplan

Stand: 2026-08-23. Ersetzt den bisherigen Implementierungsplan ab Phase 5.
Phasen 1–4 (Spike, App-Gerüst, Sidecar-HTTP-API, Frontend-Integration) sind
umgesetzt; dieser Plan baut Teile davon bewusst zurück.

**Zweite Planungsrunde, 2026-08-23.** Das Grundgerüst steht: konvertieren,
anzeigen, abspielen, navigieren, annotieren – alles Ende-zu-Ende verifiziert
(siehe die Umsetzungsstände der Phasen 8–12). Ergänzt wurden daraufhin die
Entscheidungen E4/E5, die Messung M8 und die Phasen 14–21. Die Reihenfolge
und ihre Begründung stehen in Abschnitt 3 unter „Reihenfolge der zweiten
Runde".

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

### E4: Englische Quellstrings, Deutsch als gepflegte Übersetzung

Getroffen am 2026-08-23, zweite Planungsrunde. Anlass: Die App muss
mehrsprachig sein.

**Entscheidung.** Die UI-Strings im Quelltext sind **Englisch**. Deutsch ist
eine im Repo gepflegte Übersetzung (`l10n/de.json` für PHP, `l10n/de.js` für
den Browser). Kommentare, dieses Dokument und Commit-Messages bleiben
Deutsch.

**Grund.** Nextclouds l10n-Format benutzt den Quellstring selbst als
Schlüssel – verifiziert an `apps/files/l10n/de.js` der Testinstanz:
`"Added to favorites" : "Zu den Favoriten hinzugefügt"`. Deutsche Schlüssel
hätten drei Folgen: jede weitere Sprache würde aus dem Deutschen übersetzt,
die Rückfallsprache bei fehlender Übersetzungsdatei wäre Deutsch, und die
App antwortete jedem nicht deutschsprachigen Nutzer in einer Sprache, die er
nicht gewählt hat.

**Konsequenzen.**

- Die Konvention „Deutsch für UI-Texte" in `CLAUDE.md` gilt so nicht mehr.
  Sie wird **in Phase 14** korrigiert, nicht vorher – sonst entstehen
  englische Strings, für die es noch keine Übersetzungsdatei gibt.
- Die vorhandenen `$l->t()`-Aufrufe (`lib/Settings/Section.php`,
  `templates/settings/admin.php`) tragen heute deutsche Schlüssel und müssen
  umgestellt werden. Das Frontend kennt `t()` bisher überhaupt nicht.
- **Fehlende Übersetzungen fallen still aus.** Nextclouds
  `JSResourceLocator` behandelt l10n-Dateien gesondert und endet mit
  „missing translations files will be ignored" – ein vergessener String
  erzeugt keinen Fehler, er erscheint einfach auf Englisch. Deshalb der
  Vollständigkeitstest in Phase 14; Disziplin allein trägt das nicht.
- **Nicht übersetzt wird Inhalt**: Stimmennamen aus `metadata.parts[].name`
  („Sopran"/„Soprano" – steht so in der Partitur), Titel, Komponist, und die
  GM-Instrumentennamen aus dem SoundFont. Das ist Material, keine
  Oberfläche.
- Umfang vorerst **DE + EN, im Repo gepflegt**, ohne Transifex- oder
  App-Store-Pipeline. Eine weitere Sprache ist damit das Hinzufügen einer
  Datei, keine Umstellung.

### E5: `@nextcloud/vue` als UI-Basis

Getroffen am 2026-08-23, zweite Planungsrunde.

**Entscheidung.** Die Bedienelemente kommen künftig aus `@nextcloud/vue`
statt aus handgeschriebenem HTML.

**Grund.** Die Phasen 16–19 sind fast ausschließlich UI-Arbeit
(Probenbedienung, Tablet). Tastaturbedienung, Fokusführung, Touch-Zielgrößen,
Theming und Dark Mode dort einzeln nachzubauen kostet mehr als die
Bibliothek – und die App soll aussehen wie der Rest von Nextcloud.

**Konsequenzen, die dabei zu beachten sind.**

- Der Viewer mountet einen **eigenen, zweiten Vue-3-Baum** neben Viewers
  eigener Vue-Instanz (`src/viewer.js`, dort ausführlich begründet – zwei
  Vue-Kopien im selben Baum sind nicht kompatibel). `@nextcloud/vue`-
  Komponenten werden gegen *unsere* Instanz kompiliert und leben in
  *unserem* Baum; nur deshalb geht das überhaupt. Die Verifikation muss
  entsprechend **im Viewer** stattfinden, nicht auf der Einstellungsseite.
- Bundle-Größe ist der Preis. Gegenmaßnahme: gezielte Einzelimporte statt
  Sammelimport, Größe vor und nach der Umstellung messen.
- Stärkere Bindung an die Nextcloud-Version (`info.xml` deklariert 31–35);
  die Bibliotheksversion muss dazu passen.
- Für Regler (Lautstärke, Tempo, Zoom) gibt es voraussichtlich keine
  Entsprechung. Vor der Umstellung nachsehen statt annehmen; falls keine
  existiert, bleibt `<input type="range">` mit NC-CSS-Variablen.

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

**M8 – `metadata` trägt Tempo und Titel, `tracks` ist aber nicht garantiert.**
Gemessen am 2026-08-23 (zweite Planungsrunde) gegen alle drei im Testsystem
gecachten `meta.json` (`appdata_*/scoreview/scoreview/<fileId>/<etag>/`):

| Partitur | `tempo` | `tempoText` | `tracks` | `parts` | `measures` | `pages` | `duration` |
|---|---|---|---|---|---|---|---|
| `repeat-test` | **0** | (leer) | **0** | 1 | 5 | 1 | 12 |
| `duckwerk` | 180 | `<sym>metNoteHalfUp</sym> = 90` | 6 | 5 | 58 | 4 | 77 |
| `wwimf` | 80 | `<sym>metNoteQuarterUp</sym> = 80` | 5 | 4 | 63 | 5 | 191 |

Vier Folgerungen, alle mit Konsequenz für die zweite Runde:

1. **`tempo` ist Viertel-BPM.** 180 bei notiertem „halbe = 90", 80 bei
   „Viertel = 80" – konsistent für beide Partituren, die überhaupt eine
   Tempoangabe tragen. Die BPM-Anzeige aus Phase 17 ist damit aus echten
   Daten ableitbar statt geschätzt.
2. **`tempo` kann 0 sein**, wenn die Partitur keine Tempoangabe enthält
   (`repeat-test`). Eine BPM-Eingabe braucht dann einen Bezugswert
   (MuseScores Vorgabe: 120) und muss kenntlich machen, dass er geraten ist.
3. **`tempoText` ist kein anzeigefertiger Text**, sondern trägt
   SMuFL-Markup (`<sym>…</sym>`) und einen `<font face="Edwin"/>`-Rest.
4. **`tracks` kann leer sein, während `parts` gefüllt ist.**
   `resolveMixerChannels()` (`src/lib/mixerLayout.js`) leitet die Kanäle
   ausschließlich aus `tracks` ab, und `ScoreViewer.vue` blendet den Mixer
   bei `mixerChannels.length === 0` komplett aus. Bei `repeat-test.mscz`
   gibt es also Ton, aber keinerlei Lautstärkeregelung – kein theoretischer
   Fall, sondern die eigene Testpartitur. Behandlung in Phase 17.

Nebenbei bestätigt: `duration` ist in Sekunden (191 s für `wwimf` deckt sich
mit der Angabe zur Testpartitur oben), `pages` deckt sich mit der Zahl der
gelieferten SVG-Seiten – die Herleitung der Seitenzahl aus `meta.json`
(`ConversionService::getPageCount()`) steht damit auf gemessenem Grund.

**M9 – Das MuseScore-SVG trägt keine Kennung, die sich mit `elid` verbinden
lässt.** Gemessen am 2026-08-23 (Phase 16) am gecachten `page-1.svg` von
`repeat-test.mscz` (109.967 Byte, `nextcloud-test`-Testinstanz):
kein einziges `id="…"`-Attribut im gesamten Dokument (`grep -c ' id='` → 0),
weder auf `<path>`- noch auf `<polyline>`-Elementen. Adressierbar ist nur
über `class`: `Note`, `BarLine`, `StaffLines`, `Clef`, `InstrumentName`,
`LedgerLine`, `Stem`, `Text`, `StaffText`, `TimeSig`, `VoltaSegment` – eine
Kategorie, kein Bezug zu einer einzelnen Note oder zu `elid`. Echte
Hervorhebung des Notenkopfs (Füllfarbe/`filter` auf das getroffene Element)
ist damit **nicht** möglich; der in Phase 8 gebaute Overlay-Ansatz bleibt
also die einzige Option (siehe Konsequenz in Phase 16).

Nebenbefund, für die Overlay-Umsetzung wichtig: Das allererste Element im
Dokument ist ein deckendes, weißes Hintergrundrechteck über die volle
`viewBox` (`<path class="" fill="#ffffff" … />`) – als einziges Element mit
leerem `class`-Attribut im ganzen Dokument (`grep -c 'class=""'` → 1), also
zuverlässig über `path[class=""]` adressierbar, ohne von der
Dokumentreihenfolge abhängig zu sein. Ein rein DOM-nachgelagertes
Cursor-Overlay hinter dem SVG (statt davor) bleibt ohne diese Regel
unsichtbar, weil dieses Rechteck es sonst vollständig verdeckt.

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
Takt 30.

**Wichtig für jede Wiederholung dieser Messung:** Das Synth-Worklet hat
viele Ausgänge und ruft `connect(destination, i)` einzeln pro Ausgang auf.
Ein Abgriff, der den Ausgangsindex ignoriert (`connect(analyser)` statt
`connect(analyser, i)`), misst deshalb ausschließlich Ausgang 0 – und der
führt den Effektbus, der bei manchen Partituren komplett stumm ist. Genau
das hat in dieser Sitzung zunächst „kein Ton" gemeldet, obwohl längst
welcher da war. Ergebnis der korrekten Messung:

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

**Bleibt auch nach der zweiten Planungsrunde zurückgestellt** – eingereiht
hinter Phase 21. Die Nummer bleibt, wo sie ist: Phasennummern werden im Code
und in den Commit-Messages referenziert und dürfen nicht wandern.

---

### Reihenfolge der zweiten Runde (Phasen 14–21)

Die erste Runde hat die App zum Funktionieren gebracht. Die zweite macht
daraus etwas, das eine Chorprobe erträgt – und das nicht nur auf Deutsch
funktioniert.

Vier Festlegungen vom 2026-08-23 bestimmen die Reihenfolge:

1. **Probentauglichkeit hat Vorrang vor Verteilung.** Die App soll zuerst in
   der eigenen Probe taugen; die AppAPI-Verpackung folgt danach (Phase 21).
2. **Mehrsprachigkeit steht trotzdem vorn** (Phase 14) – nicht weil sie
   dringender wäre, sondern weil ihr Aufwand mit jeder UI-Phase wächst. Die
   Oberfläche ist heute noch an einem Nachmittag durchzugehen (11 Strings in
   den Admin-Einstellungen, 4 Controller-Fehlermeldungen, der Rest in den
   Vue-Komponenten). Nach den Phasen 15–19 ist es ein Vielfaches,
   und jeder nachgezogene String ist doppelte Arbeit.
3. **DE + EN, im Repo gepflegt** (E4), kein externer Übersetzungsdienst.
4. **`@nextcloud/vue` als UI-Basis** (E5) – und deshalb **vor** den
   UI-Phasen 16–19. Dieselben Bedienelemente erst von Hand zu bauen und
   danach zu ersetzen wäre der teuerste mögliche Weg.

Nicht verhandelbare Abhängigkeiten:

- 14 vor 15–19 (Strings), 15 vor 16–19 (Bedienelemente).
- **Das Feld `format_version` aus Phase 14 muss existieren, bevor
  irgendeine Phase das Cache-Format ändert.** Es gehört thematisch zu
  Phase 20, reist aber in Phase 14 mit, weil die Migration dort für die
  Fehlercodes ohnehin gebraucht wird – eine Migration statt zweier. In
  dieser Runde ist kein Formatwechsel geplant; sollte einer nötig werden
  (etwa ein zweites serverseitiges Layout, siehe Phase 16), ist das Feld
  dann schon da statt erst hinterher.
- 18 (geteilte Notizen) hängt an keiner anderen Phase und ist vorziehbar,
  falls in der Probe früher gebraucht.

### Phase 14 – Mehrsprachigkeit und verständliche Fehler

Dateien: `package.json`, `src/components/*.vue`, `lib/Controller/*.php`,
`lib/Settings/Section.php`, `templates/settings/admin.php`,
`lib/Db/ScoreConversion.php` + neue Migration, `lib/Service/ConversionService.php`,
`lib/BackgroundJob/PollConversionJob.php`, neu `l10n/de.json`, `l10n/de.js`,
neu `tools/l10n.mjs`, `CLAUDE.md`.

Zwei Themen, die auf den ersten Blick nichts miteinander zu tun haben, aber
dieselbe Wurzel: **Die App kann einem Nutzer nicht in seiner Sprache sagen,
was los ist** – und bei einem Konvertierungsfehler kann sie es überhaupt
nicht, weil sie eine rohe Python-Ausnahme durchreicht (`PollConversionJob`
schreibt die Sidecar-Meldung nach `error_message`, `ScoreViewer.vue` zeigt
sie als „Fehler: …" an; der Nutzer liest dann
„mscore4portable --score-media exited 1: …").

**Übersetzungsinfrastruktur.**

- `@nextcloud/l10n` als Abhängigkeit aufnehmen (bisher nicht installiert;
  `l10n/` existiert, ist aber leer), `t()`/`n()` aus `translate`/
  `translatePlural`.
- `l10n/de.json` (PHP/`IL10N`) und `l10n/de.js`
  (`OC.L10N.register('scoreview', {…}, 'nplurals=2; plural=(n != 1);')`).
  Format 1:1 wie in den Kern-Apps, an `apps/files/l10n/` verifiziert.
- Ausliefern muss man dafür nichts: `TemplateLayout` ermittelt die Sprache
  und `JSResourceLocator` hängt die l10n-Datei der App automatisch an,
  sobald deren Skripte geladen werden.
- Genau deshalb `tools/l10n.mjs` + `npm run l10n:extract`: scannt
  `src/**/*.{js,vue}`, `lib/**/*.php` und `templates/**/*.php` nach
  `t('scoreview', '…')` bzw. `$l->t('…')`, schreibt die Schlüsselmenge und
  meldet fehlende wie verwaiste Übersetzungen. Ein vitest-Test ruft dieselbe
  Logik auf, damit `npm test` fehlschlägt, sobald ein String ohne deutsche
  Übersetzung dazukommt – das ist der Schutz gegen den stillen Ausfall aus
  E4, nicht die Sorgfalt beim Schreiben.

**Strings umstellen.**

- Frontend: `ScoreViewer.vue` (Status- und Fehlertexte, Transport,
  Probenleiste, „Kein Ton"-Hinweis), `ScoreMixer.vue` (die
  `title`-Attribute „Stummschalten:"/„Solo:"), `ScoreAnnotations.vue`,
  `ScorePage.vue` (`title="Notiz"`). `console.error`-Ausgaben bleiben
  unübersetzt – Entwicklerausgabe, keine Oberfläche.
- `t()` **nicht** auf Modulebene oder in `data()` einfrieren, sondern dort
  auswerten, wo der Text gebraucht wird (`computed`/Template). Sonst hängt
  die Sprache am Zeitpunkt des Modulimports.
- PHP: die bestehenden `$l->t()`-Aufrufe auf englische Schlüssel umstellen,
  die deutsche Fassung wandert in die l10n-Dateien.
- Controller-Fehlermeldungen (`'Datei nicht gefunden oder kein Zugriff.'`,
  `'Konvertierung noch nicht fertig.'`, `'Notiz darf nicht leer sein.'`)
  über `IL10N` übersetzen. Hier ist das richtig, weil `IL10N` an die Sprache
  der **anfragenden** Nutzerin gebunden ist.

**Fehlercodes statt gespeicherter Fehlertexte.**

- Für `scoreview_conversions.error_message` wäre `IL10N` dagegen falsch: der
  Text wird einmal beim Konvertieren geschrieben und danach von beliebigen
  Nutzern in beliebigen Sprachen gelesen. Die Sprache des Konvertierenden
  ist keine sinnvolle Eigenschaft einer Datei.
- Deshalb neue Spalte `error_code` (`sidecar_unreachable`,
  `sidecar_rejected`, `conversion_failed`, `timeout`, `no_pages`,
  `unknown`). Übersetzt wird der Code beim Anzeigen; `error_message` bleibt
  unverändert als technisches Detail für Admin und Log erhalten – im Viewer
  ausklappbar, nicht als Hauptmeldung.
- Der Gewinn ist nicht nur sprachlich: Erst ein Code erlaubt einen Satz, mit
  dem jemand etwas anfangen kann („Die Partitur konnte nicht konvertiert
  werden." plus Detail), und erst er macht die Fehlerursachen zählbar.

**Cache-Formatversion (reist in derselben Migration mit).**

- Spalte `format_version` (int), gesetzt beim `markReady()` auf die aktuelle
  Konstante. `ConversionController::status()` und `serveCachedFile()`
  behandeln einen Datensatz mit älterer Version wie „nicht fertig" und
  stoßen eine Neukonvertierung an.
- Zusätzlich defensiv: Eine `NotFoundException` beim Lesen einer
  Cache-Datei bedeutet „muss neu konvertiert werden", nicht 500 –
  `getPageCount()` liest `meta.json` heute ungeschützt, genau daran ist der
  in Phase 12 dokumentierte 500er entstanden.
- Damit ist die dortige Lücke geschlossen und der manuelle Eingriff
  („betroffene `scoreview_conversions`-Zeilen löschen") überflüssig.

**`CLAUDE.md`** in derselben Phase korrigieren (E4: englische Quellstrings,
deutsche Übersetzung, Verweis auf `npm run l10n:extract`) – bewusst erst
hier, damit die Anweisung nie auf einen Zustand zeigt, in dem es noch keine
Übersetzungsdateien gibt.

**Abnahme.** Nutzersprache auf Englisch → Oberfläche vollständig englisch,
Fehlermeldungen eingeschlossen; zurück auf Deutsch → vollständig deutsch,
kein durchgerutschter Rest. Ein absichtlich provozierter
Konvertierungsfehler (Sidecar gestoppt) zeigt in beiden Sprachen einen
übersetzten Satz plus unverändertes technisches Detail. Ein neu
hinzugefügter, absichtlich nicht übersetzter String lässt `npm test`
fehlschlagen. Ein Datensatz mit künstlich gesenkter `format_version` führt
zu einer Neukonvertierung statt zu einem 500er.

**Umsetzungsstand (2026-08-23).** Vollständig umgesetzt und gegen die
Testinstanz verifiziert, kein Abweichen vom Plan.

- `@nextcloud/l10n` aufgenommen, `l10n/de.json`/`l10n/de.js` gepflegt.
  `tools/l10n.mjs` (+ `npm run l10n:extract`, eingebunden in `npm test` über
  `tools/l10n.test.js`) scannt `src/**/*.{js,vue}` nach `t('…')` und
  `lib/**/*.php`/`templates/**/*.php` nach `$l->t('…')` (auch über
  `$this->l->t('…')` hinweg, nicht nur die lokale Variable `$l`) und meldet
  fehlende wie verwaiste Übersetzungen getrennt für beide Seiten.
- Alle UI-Strings umgestellt: `ScoreViewer.vue`, `ScoreMixer.vue`,
  `ScoreAnnotations.vue`, `ScorePage.vue`, `settings.js` (eigener `t()`-
  Wrapper, kein Vue-Setup dort), `admin.php`/`Section.php` sowie die
  Fehlermeldungen in `ConversionController`/`AnnotationController`
  (`$this->l->t()`, per DI injiziertes `IL10N`).
- `error_code` umgesetzt wie geplant: neue Spalte (Migration
  `Version000100Date20260823140000`, zusammen mit `format_version`),
  `ScoreConversion::ERROR_*`-Konstanten, `SidecarException` trägt jetzt
  einen Code mit (Default `unknown`), `SidecarClient` unterscheidet
  4xx-Antworten (`ClientException`, Code `sidecar_rejected`) von
  Netzwerk-/Verbindungsfehlern (Code `sidecar_unreachable`) - verifiziert
  an einem gestoppten Sidecar-Container (`Could not resolve host` →
  `sidecar_unreachable`). `PollConversionJob` ordnet zusätzlich Timeout
  (`timeout`) und die "no SVG pages"-Sidecar-Meldung (`no_pages`, per
  Text-Erkennung - der Sidecar hat kein eigenes strukturiertes
  Fehlerformat) zu, alles andere `conversion_failed`. `ScoreViewer.vue`
  übersetzt den Code beim Anzeigen (`errorCodeText()`), `error_message`
  bleibt daneben ausklappbar als technisches Detail - beides an echtem
  Ton/Fehlerzustand in EN und DE geprüft (Playwright, gestoppter Sidecar):
  „Error: The conversion service could not be reached." bzw. „Fehler: Der
  Konvertierungsdienst konnte nicht erreicht werden." mit dem
  unveränderten Guzzle-Fehlertext im Detail-Aufklapper.
- `format_version` umgesetzt wie geplant, mit einem beim Schreiben
  gefundenen und behobenen Zusatzfehler: `ConvertScoreJob`s
  Idempotenz-Guard übersprang jeden Datensatz mit Status `ready`
  bedingungslos - ein künstlich auf `0` gesetztes `format_version` bei
  sonst intaktem `ready`-Datensatz blieb dadurch für immer hängen (der
  Controller reichte per `retryConversion()` brav einen neuen Job ein, der
  Job selbst tat aber nie etwas, weil er den veralteten `ready`-Datensatz
  fälschlich als "schon fertig" überspringt). Behoben: der Guard prüft
  jetzt zusätzlich `ConversionService::isCurrentFormat()` und überspringt
  einen `ready`-Datensatz nur noch, wenn das Format auch aktuell ist. Mit
  dem Fix per Playwright verifiziert: ein manuell auf `format_version = 0`
  gesetzter, sonst `ready` Datensatz löst beim nächsten `status()`-Aufruf
  eine stille Neukonvertierung aus (kein Fehlerzustand, kein 500), endet
  wieder auf `status = ready` und `format_version = 1` - der aus Phase 12
  offene manuelle Eingriff ("betroffene Zeilen löschen") ist damit
  überflüssig. Migration setzt für alle Bestandszeilen defensiv den
  aktuellen Wert als Default (kein ungewollter Massen-Reconvert direkt
  nach dem Upgrade), gemessen: nach `occ upgrade` trugen alle drei
  vorhandenen `ready`-Datensätze der Testinstanz sofort
  `format_version = 1`.
- `serveCachedFile()`/`status()` fangen zusätzlich eine `NotFoundException`
  beim Zusammenstellen der Datei-URLs ab (fehlende Cache-Datei trotz
  `status = ready`) und stoßen ebenfalls eine Neukonvertierung an, statt
  mit 500 zu enden - dieselbe Behandlung wie beim Formatwechsel, nicht
  gesondert an echtem Material geprüft (kein reproduzierbarer Weg, eine
  IAppData-Datei gezielt verschwinden zu lassen), aber dieselbe, bereits
  verifizierte Logik.
- Playwright-Verifikation komplett gegen `nextcloud-test`/
  `scoreview-sidecar`: EN-Oberfläche ohne deutschen Reststring, DE-
  Oberfläche ohne englischen Reststring (beide über `occ user:setting
  Andreas core lang <en|de>`), Fehlerzustand in beiden Sprachen (Sidecar
  gestoppt), Erholung nach Sidecar-Neustart, `format_version`-Downgrade.
  `npm run build` (nur die vorbestehenden Bundle-Größenwarnungen, keine
  Fehler) und `npm test` (40/40) grün, alle geänderten PHP-Dateien per
  `php -l` sauber, `occ upgrade` lief die neue Migration ohne Fehler durch.

### Phase 15 – UI-Basis auf `@nextcloud/vue`

Dateien: `package.json`, `webpack.config.js`, alle `src/components/*.vue`.

Umsetzung von E5. **Reine Substitution, kein neues Verhalten:** Diese Phase
soll nichts können, was die App vorher nicht konnte – nur so ist eine
Regression überhaupt erkennbar. Alles Neue steht in 16/17.

- Ersetzt werden: Buttons (`▶`/`⏸`/`M`/`S`/`Los`) durch `NcButton` mit Icon
  und `aria-label`, die Zahlenfelder durch `NcTextField`, die
  Instrumentenauswahl durch `NcSelect`, Lade- und Fehlerzustand durch
  `NcLoadingIcon`/`NcEmptyContent`, der „Kein Ton"-Hinweis durch
  `NcNoteCard`. Icons aus `vue-material-design-icons` statt der heutigen
  Unicode-Glyphen – die sind weder benennbar noch für Screenreader
  brauchbar.
- **Gezielt einzeln importieren**, nicht als Sammelimport. Bundle-Größe vor
  und nach der Umstellung messen und im Umsetzungsstand festhalten (die
  Zahl ist die einzige Kontrolle über den Preis dieser Entscheidung).
- Für die Regler zuerst nachsehen, ob es eine passende Komponente gibt;
  falls nicht, bleibt `<input type="range">` mit NC-CSS-Variablen.
- Verifikation zwingend **im Viewer-Kontext** (E5): die Komponenten laufen
  in unserem eigenen, zweiten Vue-Baum. Eine Prüfung auf der
  Einstellungsseite sagt darüber nichts.

**Abnahme.** Der Viewer öffnet ohne Konsolenfehler in Viewers Vue-Kontext,
alle bisherigen Funktionen unverändert – Playwright-Durchlauf wie in den
Phasen 8–11 (Cursor auf `elid` 2 bei t=1000 ms, Sprung zu Takt 3 bei
6000 ms, Loop innerhalb der Taktgrenze, Notiz anlegen und nach Reload
wiederfinden). Die gesamte Transportleiste ist mit der Tastatur erreichbar
und bedienbar. Dark Mode folgt dem Nextcloud-Theme ohne eigene Regeln.
Bundle-Größe vorher/nachher dokumentiert.

**Umsetzungsstand (2026-08-23).** Vollständig umgesetzt, gegen die
Testinstanz verifiziert, mit zwei dabei gefundenen und behobenen Fehlern.

- `@nextcloud/vue@9.9.0` und `vue-material-design-icons@5.3.1` aufgenommen.
  Import ausschließlich einzeln über den Subpath-Export
  `@nextcloud/vue/components/<Name>` (die Paket-`exports` von v9 bieten gar
  keinen Sammelimport mehr an) bzw. `vue-material-design-icons/<Icon>.vue` -
  "gezielte Einzelimporte" war damit keine Entscheidung, sondern die einzige
  Option.
- Ersetzt wie geplant: alle Buttons (`ScoreViewer.vue`, `ScoreMixer.vue`,
  `ScoreAnnotations.vue`) durch `NcButton` mit Icon-Slot (vue-material-
  design-icons) und `aria-label`, dabei Toggle-Zustände (Mixer/Notizen-
  Panel, Loop an/aus, Mute, Solo) über `NcButton`s `pressed`-Prop statt
  eigener `.active`-CSS-Klasse - liefert `aria-pressed` gratis mit. Die
  Zahlenfelder (Takt-Sprung, Loop von/bis) durch `NcTextField`, die
  Instrumentenauswahl durch `NcSelect`, Lade-/Fehlerzustand durch
  `NcLoadingIcon`/`NcEmptyContent`, der "Kein Ton"-Hinweis durch
  `NcNoteCard`.
- **Regler bewusst nativ geblieben** (Lautstärke, Tempo, Zoom, Seek): vorher
  nachgesehen wie im Plan gefordert - `@nextcloud/vue@9.9.0` hat kein
  Slider-/Range-Pendant (vollständige Komponentenliste aus dem
  npm-Tarball geprüft, weder "Slider" noch "Range" im Namen). Bleibt
  `<input type="range">` mit den bestehenden NC-CSS-Variablen.
- **Bug 1, gefunden und behoben: `NcTextField` wirft bei `null` als
  `modelValue`.** `loopFromMeasure`/`loopToMeasure` waren mit `null`
  initialisiert (Platzhalter für "noch nichts eingegeben") - beim ersten
  Rendern zwei Konsolenfehler `TypeError: Cannot read properties of null
  (reading 'toString')` aus `NcTextField`, die Felder blieben leere
  Kommentar-Platzhalter statt Eingabefelder. Ein natives `<input>` verträgt
  `null` stillschweigend (DOM wandelt es in `""`), `NcTextField` nicht (Prop-
  Typ `string | number`). Behoben: Default auf `''` statt `null` - bleibt
  für die bestehende `!this.loopFromMeasure`-Leerprüfung in `toggleLoop()`
  genauso falsy, kein Verhaltensunterschied.
- **Bug 2, gefunden und behoben: `NcSelect` zeigte die rohe Programmnummer
  statt des Instrumentennamens.** Erster Versuch band
  `states[channel].program` (nur die Zahl) als `modelValue` mit
  `:reduce="preset => preset.program"`. Sichtbares Ergebnis im Screenshot:
  die Instrumentenauswahl zeigte `"52"` statt `"Choir Aahs"`. Ursache in
  `@nextcloud/vue-select`s `findOptionFromReducedValue()` gefunden (Quelle
  im npm-Tarball gelesen): sie versucht, aus dem reduzierten Wert wieder ein
  Options-Objekt aufzulösen, gibt aber bei **mehrdeutigem** Treffer (mehrere
  Presets mit demselben `program`, aber unterschiedlicher Bank - im
  General-MIDI-Soundfont der Regelfall) den rohen Wert unverändert zurück,
  statt eines Objekts mit `.name`. Das bestand schon im alten reinen
  `<select>` genauso (`:value="preset.program"` mit potenziell doppelten
  Werten), fiel dort aber nie auf, weil der Browser bei einem
  HTML-`value`-Konflikt trotzdem irgendeinen passenden Namen anzeigt statt
  eine nackte Zahl. Behoben ohne `:reduce`: `modelValue` bekommt jetzt über
  eine neue Methode `selectedPreset(channel)` direkt das volle
  Preset-Objekt aus `presetList` (Default-`reduce` von vue-select ist
  Identität, matcht also per Objektinhalt eindeutig); nur beim Auslösen von
  `program-changed` wird weiterhin die reine Programmnummer verschickt -
  `player.js::setProgram()` kennt ohnehin keine Bank-Auswahl, das ändert
  also nichts am Klang, nur an der Anzeige.
- Drei neue, beim Umbau tatsächlich gebrauchte UI-Strings (`aria-label`s für
  Play/Pause/Lautstärke-Regler/Zeitschieberegler/Tempo-Regler sowie
  `NcEmptyContent`s "Error"-Überschrift) in `l10n/de.js` ergänzt
  (`npm run l10n:extract` meldete sie zunächst als fehlend, danach
  "alle Übersetzungen vollständig"); `l10n/de.json` unverändert, keine
  PHP-Strings betroffen. `npm test` 40/40 grün.
- **Bundle-Größe, vor/nach gemessen** (`scoreview-viewer.js`, production-
  Build, derselbe Checkout vor/nach den Component-Änderungen):
  515.774 Byte (503,7 KiB) vorher → 714.134 Byte (697,4 KiB) nachher, also
  +193,7 KiB (+37,6 %) für `@nextcloud/vue` + `vue-material-design-icons`
  zusammen. `scoreview-main.js`/`scoreview-settings.js` unverändert (dort
  wird `@nextcloud/vue` nicht verwendet - `App.vue` ist weiterhin der
  Platzhalter aus Phase 4).
- Gegen `nextcloud-test`/`scoreview-sidecar` per Playwright verifiziert, **im
  Viewer-Kontext** (E5-Vorgabe: eigener, zweiter Vue-Baum), an
  `What_Was_I_Made_For.mscz`, in Englisch und Deutsch: Play/Pause togglet
  Icon **und** `aria-label` korrekt, Taktsprung zu Takt 3 landet bei 0:06
  (deckt sich mit der bekannten Zeitbasis), Loop-Button liefert
  `aria-pressed="true"`/`"false"`, Mixer zeigt alle 5 Kanäle
  (Soprano/Alto/Tenor/Bass/metronome) mit korrektem Instrumentennamen
  ("Choir Aahs" bzw. "Grand Piano" fürs Metronom, deckt sich mit dem
  Phase-9-Befund), Solo-Button liefert `aria-pressed`, Notiz anlegen und
  wieder löschen funktioniert über die neuen `NcButton`-Aktionen. Keine
  ScoreView-eigenen Konsolenfehler in beiden Sprachen (die einzige
  verbleibende Konsolenmeldung ist eine vorbestehende, von Nextclouds
  `text`-App beim Verlassen der Dateivorschau ausgelöste Tiptap-Warnung,
  unabhängig von dieser Phase). Dark Mode per Screenshot geprüft
  (`colorScheme: 'dark'`) - alle neuen Komponenten übernehmen das
  Nextcloud-Theme ohne eigene Farben, wie erwartet, weil keine der
  Ersetzungen eigene Farbregeln definiert.
- **Nicht separat Schritt-für-Schritt geprüft:** die vollständige
  Tab-Reihenfolge der Transportleiste per echtem Tastendruck. Stattdessen
  aus dem gerenderten DOM bestätigt, dass `NcButton`/`NcTextField` auf
  echte `<button>`/`<input>`-Elemente abbilden (per `innerHTML`-Dump
  geprüft) - native Tastaturbedienbarkeit ist damit eine Eigenschaft der
  Elemente selbst, nicht gesondert nachgestellt.
- `appinfo/info.xml` auf `0.0.11` erhöht, `occ upgrade` auf der Testinstanz
  gelaufen (Cache-Busting für das neue Bundle, siehe `CLAUDE.md`-
  Fallstricke).

### Phase 16 – Probentauglichkeit I: Mitlesen

Dateien: `ScorePage.vue`, `ScoreViewer.vue`, neu `src/lib/scrollPlan.js`,
ggf. `src/lib/scoreLayout.js`.

Ausgangslage: Der Cursor ist ein halbtransparentes Rechteck **über** der
Note (`.score-page-cursor`), gescrollt wird nur beim Seitenwechsel
(`lastScrolledPage`), und die Taktangabe steht nirgends – wer wissen will,
wo er ist, scrollt nach oben zum Eingabefeld. Für eine Probe ist jeder
dieser drei Punkte ein Stolperstein.

- **Markierung, die den Notentext nicht überdeckt.** Zuerst messen, dann
  bauen (**M9**, offen – Ergebnis wie bei M7 in Abschnitt 1 festhalten):
  Tragen die MuseScore-SVG-Elemente eine Kennung, die
  sich mit `elid` verbinden lässt? Falls ja, ist echte Hervorhebung des
  Notenkopfs möglich (Füllfarbe/`filter`) statt eines Overlays. Falls nein,
  bleibt das Overlay – dann aber **hinter** dem SVG: die Seite hat einen
  weißen Hintergrund (`.score-page`), das SVG selbst ist transparent, ein
  Rechteck dazwischen wirkt als Hinterlegung und verdeckt nie einen
  Notenkopf. Zusätzlich zurückhaltender einfärben (weicher Schein statt
  Balken plus Rahmen).
- **Autoscroll im Takt der Wiedergabe.** Die Seite muss dem Cursor folgen,
  nicht nur beim Seitenwechsel springen. Was dabei zählt: den Cursor in
  einem ruhigen Sichtband halten statt am Rand, bei manuellem Scrollen
  aussetzen und nach kurzer Zeit wieder übernehmen, und laufende
  Animationen nicht überlagern – der bestehende Kommentar an
  `scrollToPage()` beschreibt genau diesen Konflikt. Die Rechnung
  „Cursor-Rechteck + Viewport-Maße → gewünschte Scrollposition" gehört als
  reine Funktion nach `src/lib/` (dort ohne DOM testbar, siehe `CLAUDE.md`),
  nicht in die Komponente.
- **Taktangabe dauerhaft sichtbar.** Kopfzeile mit „Takt 42 / 63" und
  Partiturtitel, gespeist aus `resolveMeasurePosition()` (existiert bereits
  und wird für die Notiz-Anker ohnehin jeden Frame berechnet) und
  `meta.json` (`title`, `measures`). Die Transportleiste ist bereits
  `position: sticky` – dorthin gehört die Angabe.
- **Zoom-Presets** (Seitenbreite, ganze Seite, 100 %) neben dem stufenlosen
  Regler. Auch das ist eine reine Rechnung (viewBox + verfügbare Fläche →
  Faktor) und gehört nach `src/lib/`.
- **Vollbild einer A4-Seite mit möglichst wenig Rand.** Fullscreen-API auf
  dem Seitencontainer plus „ganze Seite"-Zoom. Die feste Breitenschranke
  (`maxWidth: 900 * zoom` px in `ScorePage.vue`) muss dafür einer
  höhenbezogenen Skalierung weichen.
- Echter Umbruch („bildschirmfüllend" im Sinne eines anderen Notensatzes)
  bleibt zurückgestellt: das bräuchte ein zweites serverseitiges Layout
  (`-S style.mss`) und damit einen Cache-Formatwechsel – dann greift
  `format_version` aus Phase 14.

**Abnahme.** Über eine vollständige Wiedergabe von `wwimf` (191 s,
5 Seiten) bleibt der Cursor durchgehend im Sichtfeld, ohne dass jemand
scrollt; manuelles Scrollen unterbricht das Nachführen und es nimmt danach
wieder auf. Die Taktangabe stimmt an drei Stichproben mit dem Notenbild
überein und ist ohne Scrollen sichtbar. Der Notenkopf unter dem Cursor ist
lesbar (Vorher/Nachher-Screenshot). Eine A4-Seite füllt im Vollbild die
Höhe.

**Umsetzungsstand (2026-08-23).** Vollständig umgesetzt, gegen die
Testinstanz per Playwright verifiziert. M9 (SVG trägt keine mit `elid`
verbindbare Kennung, siehe Abschnitt 1) hat den Overlay-Zweig aus dem Plan
ausgelöst, nicht echte Notenkopf-Einfärbung.

- **Cursor hinter statt vor dem Notenbild** (`ScorePage.vue`): entscheidend
  ist dabei CSS-Stapelreihenfolge, nicht die Template-Reihenfolge - ein
  `position: absolute`-Element (der Cursor) malt laut Spezifikation immer
  NACH nicht-positionierten Elementen, unabhängig davon, wo es im Markup
  steht. Erst ein explizites `.score-page-svg { position: relative;
  z-index: 1 }` bringt das Notenbild über den Cursor. Das deckende weiße
  Hintergrundrechteck, das MuseScore als erstes SVG-Element rendert (M9),
  wird über `path[class=""] { fill: none }` transparent geschaltet - sonst
  bliebe der dahinterliegende Cursor unsichtbar. Stil von Balken+Rahmen auf
  einen weichen `radial-gradient`-Schein umgestellt (`transform: scale(2.2)`
  über die Notenkopf-Bounding-Box hinaus). Per Playwright-Screenshot
  bestätigt: Notenlinien, Notenhals und Notenkopf bleiben unter dem Schein
  vollständig lesbar; `getComputedStyle` bestätigt `z-index: 1`/`position:
  relative` auf dem SVG-Wrapper und `fill: none` auf dem Hintergrundpfad.
- **`src/lib/scrollPlan.js`** (neu, rein, unit-getestet: `planAutoScroll()`
  berechnet ein Ziel-`scrollTop`, das den Cursor in einem Sichtband hält
  (Default 35-65 % der Viewporthöhe), oder `null`, wenn er schon im Band
  liegt; `shouldSuppressAutoScroll()` ist ein reiner Zeitvergleich für die
  Scroll-Pause nach manuellem Eingriff. Beide kennen kein DOM, nur Zahlen
  (Dokumentkoordinaten) - `ScoreViewer.vue` liefert die per
  `getBoundingClientRect()`/`scrollTop`.
- **Autoscroll-Verdrahtung** (`ScoreViewer.vue::updateAutoScroll()`):
  läuft im selben `useScoreSync`-Callback, der bisher nur bei Seitenwechsel
  scrollte (`lastScrolledPage`-Logik komplett entfernt) - jetzt bei jedem
  Notenwechsel. Manuelles Scrollen wird über einen `scroll`-Listener auf dem
  Viewer-Root erkannt; um die eigenen `scrollTo()`-Aufrufe nicht
  selbst als Nutzereingriff misszuverstehen, markiert `performAutoScroll()`
  ein kurzes Ignorierfenster (700 ms, siehe `PROGRAMMATIC_SCROLL_WINDOW_MS`)
  vor jedem eigenen Scroll.
- **Beim Testen gefundene und behobene Lücke: weite Sprünge auf eine noch
  nicht geladene Seite.** Ein Playwright-Lauf mit groben Sprüngen über die
  ganze Partitur (z.B. „springe zu Takt 60") zeigte zunächst, dass der
  Cursor bei den hinteren Seiten schlicht nicht auftauchte (`.score-page-cursor`
  nicht im DOM). Ursache: `ScorePage.vue` rendert den Cursor nur, wenn die
  eigene SVG bereits geladen ist (`cursorStyle` braucht die `viewBox`), eine
  noch nie in die Nähe gescrollte Seite lädt aber erst, wenn ihr
  IntersectionObserver auslöst (Phase 8, `rootMargin: 600px`) - ein
  klassisches Henne-Ei-Problem, das die alte, rein seitenwechsel-basierte
  `scrollToPage()`-Logik nicht hatte (die scrollte immer zum Platzhalter-Div
  der Zielseite, unabhängig vom SVG-Ladezustand). Behoben: `updateAutoScroll()`
  scrollt jetzt, wenn `getCursorClientRect()` noch nichts liefert, grob zum
  Seiten-Platzhalter selbst (der reserviert seine Höhe schon vor dem Laden,
  siehe `pageStyle`/`aspectRatio`) - das bringt die Seite ins Ladefenster,
  der nächste Notenwechsel-Tick übernimmt dann die genaue Position über den
  jetzt verfügbaren Cursor. Bewusst über `performAutoScroll()` (nicht
  `scrollIntoView()`), damit auch dieser Grobschritt als programmatisch
  markiert wird - sonst hätte er die nachfolgende Feinjustierung selbst
  wieder unterdrückt.
- **Bekannte Grenze am Stückende, kein Fehler:** Bei den letzten ~20 % der
  Partitur (gemessen bei `frac` 0,75/0,95 der Gesamtdauer) sitzt der Cursor
  im Playwright-Lauf einige Pixel oberhalb des Sichtbands
  (`cursorTopRelative` -29 px bzw. -101 px statt im Band). Ursache: nahe dem
  Dokumentende reicht der verbleibende scrollbare Bereich unterhalb des
  Cursors nicht mehr aus, um ihn bis zur Bandmitte hochzuziehen -
  `performAutoScroll()` klemmt korrekt auf `maxScrollTop`. Dieselbe Grenze
  hätte jeder Editor/Teleprompter mit Sichtband-Nachführung am Dokumentende;
  kein Bug, aber dokumentiert, damit es bei einer künftigen Messung nicht
  neu als Fehler gilt.
- **Taktangabe + Titel** (`ScoreViewer.vue`, computed `currentMeasureDisplay`,
  Daten `scoreTitle`/`totalMeasures` aus `meta.json`): in der ohnehin schon
  `position: sticky` Transportleiste, wie im Plan vorgezeichnet. Neuer
  l10n-String `"Measure {current} of {total}"`. Der Partiturtitel selbst
  bleibt unübersetzt (Material aus der Partitur, kein UI-Text, siehe
  CLAUDE.md). Playwright: „WWIMF / Takt 3 von 63" nach Sprung zu Takt 3,
  deckt sich mit der bekannten M7/Phase-10-Zeitbasis (0:06 = 6000 ms).
- **Zoom-Presets** (`scoreLayout.js`: `computeFitWidthZoom()`,
  `computeFitPageZoom()`, `computeActualSizeZoom()`, `parseSvgSizeMm()`,
  neue Konstante `BASE_PAGE_WIDTH_PX` als einzige Quelle für die bisher in
  `ScorePage.vue` hartkodierte 900px-Basisbreite). „Ganze Seite" rechnet die
  Höhenschranke in eine äquivalente Breite um (bei fester `aspect-ratio`
  legt die Breite die Höhe vollständig fest) - der im Plan befürchtete
  zweite CSS-Mechanismus für „höhenbezogene Skalierung" war dadurch nicht
  nötig, `max-width` bleibt der einzige Hebel. `ScorePage.vue` liefert die
  Seitengeometrie (`viewBox`, `sizeMm`) beim Laden per neuem `loaded`-Event,
  `ScoreViewer.vue` sammelt sie in `pageDimensions`. Playwright bei 1400 px
  Viewport-Breite: „Seitenbreite" trifft die Containerbreite exakt
  (1376 px), „ganze Seite" liefert eine in sich konsistente Höhen/Breiten-
  Kombination (642×496 px bei 800 px Viewporthöhe abzüglich Bedienleisten),
  „100 %" liefert 816 px - **nebenbei gemessen: `wwimf` ist keine A4-,
  sondern eine US-Letter-Seite** (215,9 mm statt 210 mm Breite; 816 px
  deckt sich mit 215,9 mm × 96/25,4 px/mm, nicht mit den erwarteten 793,9 px
  für A4) - `computeActualSizeZoom()` liest die reale `width="…mm"`-Angabe
  aus dem SVG und nimmt bewusst keine feste A4-Annahme an, genau für diesen
  Fall.
- **Vollbild** (`toggleFullscreen()`/`onFullscreenChange()`): fullscreent
  den gesamten Viewer (nicht eine einzelne Seite), damit die Transportleiste
  bedienbar bleibt; beim Betreten wird automatisch `applyZoomPreset('page')`
  angewendet. Per Playwright bestätigt - auch im headless Chromium dieser
  Sitzung funktionierte `requestFullscreen()` aus einem echten Klick-Event
  heraus (`document.fullscreenElement` zeigte danach auf den Viewer).
- **l10n**: sechs neue Strings (`Measure {current} of {total}`, `Fit page
  width`, `Fit whole page`, `Actual size`, `Fullscreen`, `Exit fullscreen`),
  `npm run l10n:extract` danach „alle Übersetzungen vollständig". `npm test`
  56/56 grün (9 neue Tests in `scrollPlan.test.js`, 9 neue in
  `scoreLayout.test.js` für die Zoom-Presets). `npm run build` ohne neue
  Fehler (nur die vorbestehenden Bundle-Größenwarnungen, `scoreview-viewer.js`
  714 KiB → 720 KiB durch vier zusätzliche Icons). `appinfo/info.xml` auf
  `0.0.12`, `occ upgrade` auf der Testinstanz gelaufen.
- **Umgebungshinweis zur Verifikation, nicht Teil des Produktcodes:** Diese
  Sitzung lief als Background-Job ohne echtes Audio-Ausgabegerät -
  `createPlayer()` (`player.js`) blieb dadurch unbegrenzt in
  `context.audioWorklet.addModule()`/`synth.isReady` hängen (kein Reject,
  kein Timeout), unabhängig von Phase 16 und ohne Zusammenhang mit den
  hier geänderten Dateien. Für die Playwright-Verifikation wurde deshalb
  die `status()`-Antwort per `page.route()` clientseitig um `soundFontUrl`
  bereinigt, damit `ScoreViewer.vue` den synchronen `silentClock`-Pfad nimmt
  (Phase 8/9) - exakt derselbe Cursor-/Timeline-/Scroll-Code wie mit echtem
  Player, nur ohne den Audio-Teil. Alle Cursor-/Autoscroll-/Zoom-/Taktangabe-
  Befunde oben gelten unverändert für den echten Player, weil dieser Code
  strikt hinter `useScoreSync`/`this.clock` liegt und die Zeitquelle nicht
  kennt. Die Playwright-EN/DE-Prüfung (siehe l10n oben) sowie der
  Kern-Loop-Test aus Phase 10 liefen zusätzlich unverändert gegen den
  echten `nextcloud-test`-Sidecar, nur die Audiosynthese selbst wurde für
  diese eine Sitzung umgangen.
- Getestet an `What_Was_I_Made_For.mscz` (SATB, 191 s, 5 Seiten, 63 Takte)
  in Englisch und Deutsch - keine ScoreView-eigenen Konsolenfehler in beiden
  Sprachen (die einzige verbleibende Meldung ist die vorbestehende,
  Phase-15-dokumentierte Tiptap-Warnung der `text`-App).

**Nachtrag (2026-08-23), zwei Nutzer-Rückmeldungen nach dem ersten
Durchlauf.**

1. **Ellipse ragte über das System hinaus.** Der weiche Schein
   (`radial-gradient` + `transform: scale(2.2)`) sollte den Notenkopf
   dezent hinterlegen, wuchs damit aber deutlich über die
   Notenkopf-Bounding-Box hinaus und überlappte benachbarte Systeme. Zurück
   auf ein Rechteck ohne Skalierung (`background: rgba(...)`, `border`,
   `border-radius: 2px`) - inhaltlich dieselbe Deckkraft/Farbe wie vor Phase
   16, nur weiterhin hinter statt vor dem Notenbild (siehe M9), wodurch das
   ursprüngliche Verdeckungsproblem trotzdem gelöst bleibt: die Notenlinien
   werden vom SVG darüber gezeichnet, ein scharfkantiges Rechteck darunter
   stört sie nicht.
2. **Play/Pause-Button nur ganz oben bedienbar - echter, durch Phase 16
   eingeführter Bug.** Ursache: `.score-page-svg` bekam in Phase 16 ein
   explizites `position: relative; z-index: 1`, um vor dem Cursor zu malen
   (siehe oben). Weder `.scoreview-pages` noch `.score-page` eröffnen einen
   eigenen Stacking-Context, das SVG (und der bereits seit Phase 11
   bestehende Notiz-Marker mit `z-index: 2`) konkurrierten dadurch direkt
   mit der sticky Transportleiste (`z-index: 1`) um dieselbe Stapelebene -
   bei gleichem/höherem Wert gewinnt das später im DOM stehende Element
   (`.scoreview-pages` steht nach `.scoreview-transport`), Seiteninhalt
   deckte die Transportleiste also, sobald man vom obersten Bildschirmrand
   wegscrollte, obwohl sie optisch weiter sichtbar blieb. Behoben:
   `.scoreview-transport` auf `z-index: 10` angehoben - klar über jedem
   innerhalb einer Seite verwendeten Wert. Per Playwright verifiziert: nach
   600px Scrollen liegt `document.elementFromPoint()` auf dem Play-Button
   selbst (nicht mehr auf der SVG-Seite darunter), ein Klick dort schaltet
   `aria-label` zuverlässig zwischen „Abspielen"/„Pause" um.
3. **Bei manchen Partituren sprang die Ansicht während der Wiedergabe bei
   jedem Notenwechsel ein Stück nach oben und unten - dritte
   Nutzer-Rückmeldung, echter Logikfehler in `planAutoScroll()`.** Ursache:
   Bei mehrstimmigen/mehrsystemigen Partituren (SATB u.ä.) deckt das vom
   Sidecar gelieferte Cursor-Rechteck einer Note nicht nur die eine Stimme
   ab, sondern die **gesamte Notenzeile/das gesamte System** (gemessen an
   `What_Was_I_Made_For.mscz`: alle Elemente einer Zeile teilen sich
   exakt dieselben `y`/`h`-Werte in `timing.json`, unabhängig von der
   Stimme) - dessen gerenderte Höhe kann die Bandhöhe (30 % der
   Viewporthöhe) locker übersteigen. `planAutoScroll()` prüfte Ober- und
   Unterkante bislang unabhängig voneinander („Oberkante zu weit oben? ->
   scrollen, bis sie im Band ist" / „Unterkante zu weit unten? -> scrollen,
   bis SIE im Band ist") - ist der Cursor höher als das Band, sind diese
   beiden Ziele unerfüllbar UND gegenläufig: ein Scroll, der die Oberkante
   ins Band zieht, reißt die Unterkante sofort wieder heraus (und umgekehrt)
   - bei **unveränderter** Notenposition (mehrere Noten im selben System
   teilen sich dieselbe Cursor-Geometrie) ergab das bei jedem
   Notenwechsel-Tick ein neues, gegenläufiges Scrollziel und damit
   endloses Hoch-Runter-Springen. In den beiden kleineren Testpartituren
   (`repeat-test.mscz`: 1 Stimme, Cursorhöhe ~330 Einheiten; `duckwerk`)
   trat das nicht auf, weil deren Cursor-Rechtecke schmaler als das Band
   blieben - daher „bei einigen Dateien". Behoben: „im Band" heißt jetzt
   „Cursor überlappt das Band irgendwo", nicht mehr „beide Kanten liegen
   im Band" - ein zu hoher Cursor braucht dafür nur einmal in Überlappung
   gebracht zu werden, nicht bei jedem Tick neu ausgerichtet. Alle
   bestehenden `scrollPlan.test.js`-Fälle liefern dieselben Ergebnisse wie
   vorher (die Änderung wirkt sich nur aus, wenn Cursor- und Bandhöhe in
   Konflikt stehen); neuer Regressionstest deckt genau diesen Fall ab.
   Per Playwright an `What_Was_I_Made_For.mscz` mit einem bewusst kleinen
   Viewport (400 px, Cursorhöhe 233 px > Bandhöhe 120 px, damit der Konflikt
   sicher auftritt) verifiziert: `scrollTop` läuft einmalig auf einen
   stabilen Wert ein (`0 → 237 → 459`) und bleibt über 8 weitere
   Notenwechsel-Samples (400 ms-Takt) exakt bei `459` stehen, statt wie vor
   dem Fix zwischen zwei Werten zu pendeln.

### Phase 17 – Probentauglichkeit II: Steuern

Dateien: `ScoreViewer.vue`, `ScoreMixer.vue`, `src/lib/mixerLayout.js`,
ggf. neu `src/lib/click.js`.

- **Tempo in BPM statt Prozent.** `metadata.tempo` ist Viertel-BPM (M8).
  Anzeige „♩ = 80 → 56", Eingabe absolut, intern weiterhin der Faktor auf
  `playbackRate` (Phase 9 hat gemessen, dass die Zeitachse davon unberührt
  bleibt). Zwei Einschränkungen gehören sichtbar in die UI: bei
  `tempo == 0` (Partitur ohne Tempoangabe – kommt vor, M8) ist der
  Bezugswert geraten (120), und bei Tempowechseln im Stück beschreibt die
  Zahl nur das Grundtempo. `tempoText` ist wegen des SMuFL-Markups nicht
  direkt anzeigbar.
- **Loop bedienbar machen.** Die Felder sind heute 60 px breit und zeigen
  von „von"/„bis" nur „v…"/„b…". Beschriftete Felder, dazu „Loop ab
  aktuellem Takt" (der häufigste Fall in der Probe: man ist schon an der
  Stelle) und eine sichtbare Markierung des Loop-Bereichs im Notenbild.
- **Stimmgruppen und „meine Stimme".** Die Zuordnung Track → Part liegt vor
  (`partId`, M6) – mehrere Tracks eines Parts lassen sich damit zu einem
  Regler zusammenfassen (`duckwerk`: 6 Tracks auf 5 Parts). Wichtiger noch
  der Probenfall selbst: „meine Stimme laut, Rest leise" ist heute Solo plus
  vier Regler; dafür genügt ein Klick pro Stimme (Preset, nicht Solo).
- **Mixer auch ohne `tracks`.** Gemessen (M8): `repeat-test.mscz` liefert
  `tracks: []` bei gefüllten `parts`, `resolveMixerChannels()` gibt dann
  null Kanäle zurück und der Mixer verschwindet ganz, obwohl Ton läuft.
  Fallback auf `parts`, mindestens ein Summenregler – „Lautstärke" darf nie
  vollständig fehlen.
- **Metronom und Einzähler.** `metadata.tracks` führt eine Metronomspur
  (M6), aber ob die exportierte MIDI überhaupt Metronomnoten enthält, ist
  ungeprüft – zuerst nachsehen. Falls nicht: Der Klick lässt sich aus
  `measures.json` clientseitig erzeugen, die Taktzeiten liegen ja vor, ganz
  ohne MIDI. Ein Einzähler vor dem Loop-Start ist für Probenarbeit mehr wert
  als die meiste übrige Mixer-Funktionalität.
- **Tastaturkürzel** für die Probe: Leertaste Play/Pause, Pfeiltasten Takt
  vor/zurück, ein Kürzel für Loop an/aus. Nur greifen, wenn der Viewer den
  Fokus hat, und Nextclouds eigene Kürzel nicht überschreiben.

**Abnahme.** Tempo lässt sich in BPM setzen, und die eingestellte Zahl
stimmt mit einer unabhängigen Messung überein (Taktabstand aus
`measures.json` gegen Wanduhr, Verfahren wie in Phase 9). Die Loop-Felder
sind lesbar und mit der Tastatur bedienbar. „Nur meine Stimme laut" ist ein
Klick. Der Mixer erscheint auch bei `repeat-test.mscz`. Ein Einzähler ist
vor dem Loop hörbar – oder es ist dokumentiert, warum nicht.

**Umsetzungsstand (2026-08-23), gefundener Bug in einer als „erledigt"
markierten Annahme.** Vollständig umgesetzt und gegen die Testinstanz per
Playwright verifiziert (`wwimf`, `duckwerk`, `repeat-test`, jeweils mit
echtem Player/Ton, nicht dem stummen Platzhalter).

- **Kernbefund vor der eigentlichen Umsetzung: „MIDI-Kanal = Track-Index"
  (Phase 9, in der Risikotabelle als „erledigt" geführt) stimmt NICHT
  allgemein.** Die Phase-9-Messung hatte das nur an `wwimf` verifiziert, wo
  die Kanäle zufällig 0-3 in Dokumentreihenfolge liegen. Ein eigener,
  abhängigkeitsfreier MIDI-Parser (`tmp/midi_inspect.py`, nur für diese
  Messung, nicht Teil des Produktcodes) gegen `duckwerk`s `score.mid`
  zeigt: Sopran/Alt/Tenor/Bariton/Bass liegen auf den MIDI-Kanälen
  0/2/3/1/6, nicht 0-4. Mit der alten Index-Annahme hätte der Regler
  „Alt" tatsächlich Baritons Kanal gesteuert - ein stummer, aber realer
  Mixer-Fehler, den keine der bisherigen Sitzungen an echtem Ton gehört
  hatte (beide bisherigen Hörproben liefen an `wwimf`). Zusätzlich
  gemessen: **die Metronomspur trägt in keiner der beiden Partituren auch
  nur eine einzige MIDI-Note** (`metadata.tracks` führt sie, aber weder
  MIDI-Track noch -Kanal existieren dafür in der exportierten Datei) -
  ein Mixerregler dafür wäre ein Blindregler.
- **Fix in `mixerLayout.js`/`player.js`:** `player.js` liest nach dem Laden
  die tatsächlich verwendeten MIDI-Kanäle je Spur aus
  `sequencer.midiData.tracks[].channels` (spessasynth_core, neue Funktion
  `getTrackChannels()`). `resolveMixerChannels(tracks, parts, trackChannels)`
  bevorzugt diese echten Kanäle vor dem Index, schließt `instrumentId ===
  'metronome'` aus der Liste aus, und fällt bei `tracks: []` (M8,
  `repeat-test.mscz`) direkt auf `parts` zurück - „Lautstärke darf nie
  vollständig fehlen". Bei einer Längenabweichung zwischen den echten
  Kanaldaten und den erwarteten Spuren (z.B. eine künftige Partitur, deren
  Export doch eine Metronomspur enthält) fällt die Funktion sichtbar auf
  den Index zurück, statt still falsch zuzuordnen. `ScoreViewer.vue` löst
  `mixerChannels` deshalb zweimal auf: einmal grob (Index-Näherung, bevor
  der Player geladen ist), einmal exakt in `setUpRealPlayer()`, sobald
  `player.getTrackChannels()` verfügbar ist - der Mixer selbst wird erst
  bei `hasRealPlayer` überhaupt angezeigt, die grobe Zwischenauflösung wird
  also nie sichtbar. Unit-getestet gegen die tatsächlich gemessenen
  duckwerk-Werte (`mixerLayout.test.js`).
- **Stimmgruppen** (`resolveMixerGroups()`): fasst Mixerkanäle mit
  derselben `partId` zu einer Bedienzeile zusammen (Divisi). An den beiden
  vorhandenen Testpartituren nie mit mehr als einem Kanal pro Gruppe
  geprüft (weder `wwimf` noch `duckwerk` haben echtes Divisi in den
  Metadaten - „6 Tracks auf 5 Parts" bei duckwerk ist die Metronomspur, kein
  geteilter Part) - die Funktion ist an synthetischen Daten unit-getestet,
  ein Divisi-Fall an echtem Material bleibt offen (siehe Phase 20).
- **„Meine Stimme"-Preset** (`computeVoiceFocusVolumes()`, `AccountVoice`-
  Button je Zeile): hebt die eigene Gruppe auf 127 an, dämpft alle übrigen
  auf 40 (nicht auf 0 wie Solo) - der Probenfall ist "klar heraushören",
  nicht "ausblenden". Playwright bestätigt am Mixer von `wwimf`: Klick auf
  Sopran liefert `[127, 40, 40, 40]`, erneuter Klick setzt wieder
  `[127, 127, 127, 127]`.
- **Mixer-Fallback ohne `tracks`**: an `repeat-test.mscz` (M8: `tracks: []`,
  `parts` gefüllt) per Playwright bestätigt - ein Regler „Test" (der
  einzige Part) erscheint, keine leere Mixer-Fläche mehr.
- **Tempo in BPM** (`effectiveTempoBpm`/`minTempoBpm`/`maxTempoBpm`,
  `onTempoBpmInput()`): Anzeige „♩ = 80", Regler rechnet zwischen BPM und
  dem internen `playbackRate`-Faktor (weiterhin 0,5-1,5, wie in Phase 9
  gemessen) um. `tempoGuessed` markiert `tempo == 0` (M8) sichtbar mit „*"
  plus Tooltip, Bezugswert `DEFAULT_TEMPO_BPM = 120` (MuseScores eigene
  Vorgabe). Playwright: `wwimf` zeigt „♩ = 80" (deckt sich mit M8),
  Reglerbereich 40-120 (0,5×/1,5× von 80), ein gesetzter Wert 56 zeigt „♩ =
  56"; `repeat-test.mscz` zeigt „♩ = 120*" (tempo 0, geraten).
- **Loop-Felder**: `NcTextField`s jetzt mit vollem Label „From measure"/„To
  measure" statt „from"/„to" und 130px statt 70px breit (Nutzer-Rückmeldung
  aus Phase 16-Nachtrag: 60px zeigte nur „v…"/„b…"). Neuer Button „Loop from
  current measure" (`CrosshairsGps`-Icon, `loopFromCurrentMeasure()`) füllt
  nur das Von-Feld, aktiviert den Loop nicht automatisch - das Bis-Feld
  bleibt eine bewusste Entscheidung. Playwright: nach Sprung zu Takt 5 setzt
  der Button das Von-Feld auf „5".
- **Sichtbare Loop-Markierung im Notenbild** (`ScorePage.vue`, neue
  `loopMarkers`-Prop, `.score-page-loop-marker`): zwei schmale, farbige
  Flaggen (grün = Start, rot = Ende) an den Takt-Koordinaten aus
  `measuresTimeline.elements` - bewusst nur der Taktanfang, nicht die volle
  Taktbreite, weil `measures.json` nur Punktkoordinaten liefert (M4), keine
  Taktausdehnung. Playwright bestätigt beide Marker im DOM nach Loop-Aktivierung.
- **Einzähler** (`src/lib/metronome.js`, rein/unit-getestet:
  `estimateBeatsInMeasure()`, `computeCountInDelaysMs()`; `metronomeClick.js`,
  AudioContext-Oszillator, ungetestet wie player.js/silentClock.js):
  schätzt die Schlagzahl des Zieltaktes aus seiner Dauer und der aktuellen
  BPM (measures.json trägt keine eigene Taktart) und zählt in Echtzeit
  herunter, bevor `toggleLoop()` die Wiedergabe selbst startet - nur wenn
  beim Aktivieren noch nicht gespielt wird, sonst würde eine laufende Probe
  unterbrochen. Playwright (Oszillator-Aufrufe gezählt statt Audiopegel
  gemessen, siehe unten): 4 Klicks vor dem Loop-Start bei Takt 5 (4/4,
  deckt sich mit der 4/4-Struktur von `wwimf`), danach läuft die Wiedergabe
  automatisch an (`aria-label` wechselt auf „Pause").
- **Metronom-Klick während der Wiedergabe** (`metronomeEnabled`-Toggle in
  der Transportleiste, `Metronome`-Icon): ein Klick pro Takt (nicht pro
  Schlag - measures.json liefert nur Taktebene, siehe oben), unabhängig vom
  Haupt-Synth (score.mid hat nachweislich keine Metronomnoten, siehe
  Kernbefund oben) über einen eigenen `AudioContext`. Playwright bestätigt
  mehrere Klicks über 4s laufende Wiedergabe.
- **Tastaturkürzel** (`onKeydown()`, Listener auf `this.$el`, greift also
  nur, wenn ein Nachfahre des Viewers den Fokus hat - genau die
  Plan-Vorgabe „nur wenn der Viewer den Fokus hat"): Leertaste
  Play/Pause, Pfeiltasten Takt vor/zurück (`jumpRelativeMeasure()`), `L`
  Loop an/aus. Eingabefelder (`INPUT`/`TEXTAREA`/`SELECT`,
  `isContentEditable`) sind explizit ausgenommen, damit z.B. das
  Pfeiltasten-Navigieren im Takt-Eingabefeld nicht gestohlen wird.
  Playwright: Leertaste auf dem fokussierten Play-Button togglet genau
  einmal pro Druck (kein Doppel-Toggle durch die native Button-Space-
  Aktivierung - `preventDefault()` auf `keydown` unterdrückt sie), Pfeil
  rechts/links von Takt 3 aus landet auf „Measure 4 of 63"/„Measure 3 of 63".
- **Verifikationsmethode für den Ton ohne Ausgabegerät:** dieselbe
  Grundidee wie in Phase 9 (Web-Audio-Graph anzapfen statt „hören"), hier
  aber am Erzeugungspunkt statt am Ausgang: `AudioContext.prototype
  .createOscillator` wird per `page.addInitScript()` überschrieben, bevor
  die Seite lädt, und zählt Aufrufe - `metronomeClick.js` ist die einzige
  Quelle für Oszillatoren (player.js nutzt einen AudioWorkletNode, keine
  Oszillatoren), Klicks sind damit ohne echtes Ausgabegerät zuverlässig
  zählbar.
- Keine ScoreView-eigenen Konsolenfehler in allen drei Testpartituren (die
  einzige verbleibende Meldung ist die vorbestehende, Phase-15/16-
  dokumentierte Tiptap-Warnung der `text`-App). Vier neue l10n-Strings
  (`From measure`/`To measure`/`Loop from current measure`/`Tempo (BPM)`/
  `No tempo marking…`/`Metronome on`/`Metronome off`/`My voice: {name}`/
  `Boost this voice…`), `Tempo` (verwaist durch die BPM-Umstellung) entfernt
  - `npm run l10n:extract` meldet „alle Übersetzungen vollständig". `npm
  test` 71/71 grün (`mixerLayout.test.js` erweitert für Kanalzuordnung und
  -gruppierung, neu `metronome.test.js`). `npm run
  build` ohne neue Fehler (nur die vorbestehende Bundle-Größenwarnung,
  `scoreview-viewer.js` 720 KiB → 747 KiB durch Metronom/Crosshairs-Icons
  und die Mixer-Erweiterung). `appinfo/info.xml` auf `0.0.15`, `occ upgrade`
  auf der Testinstanz gelaufen.

### Phase 18 – Geteilte Notizen

Dateien: `AnnotationMapper.php`, `AnnotationService.php`,
`AnnotationController.php`, `ScoreAnnotations.vue`, `ScorePage.vue`.

Die Spalte `visibility` (`private`/`shared`) liegt seit Phase 11 im Schema;
geschrieben und gelesen wird bislang nur `private`. Der Nutzen ist der
eigentliche Probenfall: „Takt 42, Alt: Einsatz beachten" einmal schreiben
statt dreißigmal sagen.

- **Wer darf für alle schreiben?** An den Dateirechten festmachen, statt
  eine eigene Rechteverwaltung zu bauen: Wer die `.mscz` bearbeiten darf
  (`PERMISSION_UPDATE` am aufgelösten Node), darf geteilte Notizen anlegen
  und ändern; wer sie lesen darf, sieht sie. Das deckt den realen Fall ab
  (die Chorleitung besitzt die Datei und teilt sie mit dem Chor) und erbt
  die Zugriffsprüfung, die `UserFileResolver` bereits leistet.
- Lesen: `findByFileIdAndUser()` erweitern auf „eigene private **plus** alle
  geteilten dieser Datei". `requireOwnAccess()` muss künftig zwischen „darf
  sehen" und „darf ändern" unterscheiden – heute ist beides dasselbe.
- UI: eigene und geteilte Notizen unterscheidbar (Markerfarbe, Autor über
  `IUserManager` als Anzeigename), Filter „nur meine". Beim Anlegen muss
  unmissverständlich sein, dass eine geteilte Notiz für alle mit
  Dateizugriff sichtbar ist – das ist eine Datenweitergabe, kein
  Anzeigedetail.
- Anker (Takt + Bruchteil) und Verwaist-Logik bleiben unverändert; sie sind
  von der Sichtbarkeit unabhängig.

**Abnahme.** Zwei Nutzer auf einer geteilten Datei: A (Eigentümer) legt eine
geteilte Notiz an → B sieht sie mit Autorenangabe; B legt eine private an →
A sieht sie nicht; B ohne Schreibrecht kann keine geteilte Notiz anlegen
(403, serverseitig geprüft, nicht bloß ausgeblendet). Damit ist zugleich die
aus Phase 11 offen gebliebene Zwei-Nutzer-Abnahme nachgeholt.

**Umsetzungsstand (2026-08-23).** Vollständig umgesetzt, gegen die
Testinstanz mit drei echten Nutzerinnen und zwei echten Freigaben
(OCS-Share-API: `Andreas` → `Andreas2` mit Schreibrecht, `Andreas` →
`Andreas3` nur lesend) per Playwright verifiziert - kein Abweichen vom Plan.

- **Rechteprüfung wie geplant an `PERMISSION_UPDATE` festgemacht**
  (`AnnotationController::canWriteShared()`, liest die Berechtigung vom
  über `UserFileResolver` aufgelösten Node - der spiegelt bereits die Sicht
  der anfragenden Nutzerin, bei einer Freigabe also genau die vom Share
  gewährte Berechtigung). `AnnotationMapper::findOwnById()` (Owner-only)
  entfällt zugunsten von `findByIdAndFileId()` (nur Existenz zu dieser
  Datei) + `AnnotationService::canModify()`-Logik direkt in
  `updateContent()`/`delete()`: eine geteilte Notiz darf JEDE Nutzerin mit
  Schreibrecht ändern/löschen (nicht nur die Autorin), eine private nur die
  Eigentümerin selbst - genau die im Plan geforderte Unterscheidung
  „darf sehen" vs. „darf ändern".
- **Lesen erweitert** (`AnnotationMapper::findVisibleForUser()`): eigene
  private Notizen PLUS alle geteilten Notizen der Datei, unabhängig vom
  Autor.
- **403 statt nur ausgeblendet, gemessen:** `Andreas3` (nur Lesen) erhält
  beim Versuch, eine geteilte Notiz anzulegen, serverseitig
  `{"error":"You do not have permission to create shared notes for this
  file."}` mit HTTP 403 - die Notiz landet nachweislich nicht in der Liste
  (`andreas3VisibleCountAfterFailedShare` bleibt bei 2). Derselbe Nutzer
  darf trotzdem eine PRIVATE Notiz anlegen (kein Schreibrecht auf die Datei
  nötig, unverändert seit Phase 11) - `andreas3AfterPrivateCreateError`
  bleibt `null`. Ein Löschversuch derselben Nutzerin auf eine fremde
  geteilte Notiz liefert ebenfalls 403
  (`"You do not have permission to change this note."`), die Notiz bleibt
  unverändert in der Liste.
- **Schreibrecht-Trägerin darf fremde geteilte Notizen ändern, gemessen:**
  `Andreas2` (Schreibrecht) bearbeitet erfolgreich die von `Andreas`
  angelegte geteilte Notiz; die Änderung ist danach für `Andreas3` (nur
  Lesen) sichtbar - bestätigt, dass die Berechtigung wirklich an der Datei
  hängt, nicht an der Autorenschaft der Notiz.
- **Autorenname** (`AnnotationService::serialize()`, `IUserManager`):
  `Andreas2`s Zeile zeigt bei `Andreas`s geteilter Notiz „by Andreas"
  (Displayname, nicht die rohe `userId`) - die rohe `userId` wird dafür
  bewusst gar nicht erst an den Client ausgeliefert (`jsonSerialize()`
  trägt sie nicht), `mine`/`authorName` werden serverseitig aus der
  anfragenden Identität berechnet.
- **„Nur meine"-Filter** (`ScoreAnnotations.vue`, rein clientseitig auf der
  bereits vom Server gefilterten Liste): reduziert `Andreas2`s Ansicht
  korrekt von 2 sichtbaren geteilten Notizen auf die eigene (1).
- **Gefundener und behobener Nebenbefund, unabhängig vom eigentlichen
  Phase-18-Vorhaben:** `Annotation::jsonSerialize()` hatte `elid`/
  `anchorEtag` seit Phase 11 nie ausgeliefert - der in
  `ScoreViewer.vue::annotationMarkers` vorgesehene exakte Sekundäranker
  (Notenkoordinate statt Takt-Näherung, siehe PLAN.md Phase 11) konnte
  dadurch nie greifen, jede Notiz landete immer auf der gröberen
  Takt-Koordinate. Behoben durch Ergänzen beider Felder in
  `jsonSerialize()`; an der Testinstanz bestätigt (`elid`/`anchorEtag` sind
  jetzt Teil der API-Antwort, z.B. `"elid":0,"anchorEtag":"ae76a65…"`) -
  keine gesonderte Pixel-Verifikation, da dieselbe, bereits in Phase 11
  getestete Auflösungslogik jetzt lediglich echte statt leerer Werte
  bekommt.
- **UI-Unterscheidung** (`ScoreAnnotations.vue`, `ScorePage.vue`): geteilte
  Notizen bekommen einen linken Akzentbalken in der Liste und eine eigene
  Markerfarbe im Notenbild (`--color-primary-element` statt Orange), plus
  ein Autoren-Badge für fremde geteilte Notizen. Beim Anlegen ein expliziter
  Umschalter „Private"/„Shared with everyone who has access to this file" -
  bewusst nicht vor Nutzerinnen ohne Schreibrecht versteckt (die
  serverseitige 403-Prüfung ist die eigentliche Durchsetzung, siehe oben);
  ein Fehlschlag erscheint als `NcNoteCard`-Fehlermeldung im Notizenpanel
  (`annotationError` in `ScoreViewer.vue`).
- Fünf neue l10n-Strings (`Private`, `Shared with everyone who has access
  to this file`, `Only mine`, `by {name}`, plus zwei PHP-Fehlermeldungen),
  `npm run l10n:extract` meldet „alle Übersetzungen vollständig". `npm
  test` weiterhin 71/71 grün (keine neuen reinen Funktionen in dieser
  Phase - die eigentliche Logik ist Berechtigungsprüfung mit
  Datenbankzugriff, dafür gibt es laut `CLAUDE.md` keine PHP-Testsuite,
  Verifikation lief über `php -l` plus den echten Playwright-Lauf gegen
  drei echte Konten). `npm run build` ohne neue Fehler. `appinfo/info.xml`
  auf `0.0.16`, `occ upgrade` auf der Testinstanz gelaufen (keine neue
  Migration nötig - die `visibility`-Spalte lag seit Phase 11 bereits im
  Schema, siehe dortiger Migrationskommentar).
- **Bei der Verifikation gefundene, harmlose Testumgebungs-Eigenheit,
  nicht Teil des Produktcodes:** Ein druckfrisches Konto (in dieser Sitzung
  `Andreas3`, zuvor nie in Files gewesen) zeigt über der Dateiliste ein
  Willkommens-Panel, das den Klick auf eine Dateizeile im automatisierten
  Test unzuverlässig machte, obwohl der Server (direkt per
  `status()`-Abruf geprüft) korrekt antwortete. Kein Produktbug - über
  einen Deep-Link (`/apps/files/files/{fileId}?openfile=true`) statt eines
  Zeilenklicks umgangen.

**Nicht umgesetzt / bewusst zurückgestellt:** ein serverseitiger Test für
„zwei Freigaben mit unterschiedlichen Rechten" ist damit nachgeholt (siehe
oben), eine automatisierte PHP-Testsuite dafür bleibt außerhalb des Rahmens
dieser Phase (`CLAUDE.md`: keine PHP-Testsuite vorgesehen).

### Phase 19 – Mobil und Tablet

Dateien: alle Komponenten, `src/viewer.js`.

Der Einsatzort ist das Tablet auf dem Notenständer – geprüft ist davon
bisher nichts. Die Bedienleisten sind für Maus und Desktop-Breite gebaut
(`flex-wrap`, 24-px-Buttons, Hover-`title`).

- Bedienelemente in eine kompakte, touchtaugliche Leiste (Zielgrößen
  ≥ 44 px); selten Benutztes in ein Aktionsmenü.
- Pinch-Zoom auf dem Notenbild und Wischen zum Blättern – dabei prüfen, ob
  das mit Nextclouds Viewer kollidiert, der auf Mobilgeräten selbst
  Wischgesten für den Dateiwechsel belegt.
- **Bildschirm wachhalten** (`navigator.wakeLock`) während der Wiedergabe.
  Ein Display, das mitten im Satz ausgeht, macht die ganze übrige Arbeit
  wertlos.
- Die SoundFont-Größe (~40 MB) wird hier zuerst weh tun. Ladefortschritt
  zeigen und einen bewussten „Noten ohne Ton"-Weg anbieten, statt beim
  Warten stumm dazustehen.
- Leistung großer Partituren im DOM auf Tablet-Hardware messen (Risiko
  „SVG-Seiten großer Partituren zu schwer fürs DOM"). Die Lazy-Ladung pro
  Seite existiert (`IntersectionObserver` in `ScorePage.vue`), ist aber nie
  unter Last geprüft worden.

**Abnahme.** Eine vollständige Probe auf einem echten Tablet: Partitur
öffnen, Takt ansteuern, loopen, eigene Stimme lauter – ohne dass das Display
ausgeht oder die Bedienung Fingerspitzen erfordert. Gerätemodell und Browser
im Umsetzungsstand benennen; „funktioniert auf Mobilgeräten" ohne
Gerätenamen ist keine Aussage.

**Umsetzungsstand (2026-08-23), Code umgesetzt – Abnahme bewusst NICHT
erfüllt.** Alle fünf Punkte sind implementiert und im Touch-Emulationsmodus
verifiziert, **aber die eigentliche Abnahme dieser Phase verlangt ein echtes
Tablet, und in dieser Sitzung stand keines zur Verfügung.** Die Phase gilt
deshalb ausdrücklich als *nicht abgenommen* – siehe „Was offen bleibt" am
Ende dieses Abschnitts. Das ist keine Formalie: gerade Touch-Ergonomie,
Pinch-Gefühl und Wake-Lock-Verhalten sind genau die Dinge, die eine
Emulation nicht beantwortet.

- **Touch-Zielgrößen ≥ 44 px** (`ScoreViewer.vue`, `@media (pointer:
  coarse)`). Zuerst gemessen statt angenommen: Nextclouds eigenes
  `--default-clickable-area` liegt in dieser Instanz bei **34 px**, nicht bei
  44 – der Play-Button war also real 33×33 px groß. `NcButton` liest diese
  Variable zur Laufzeit (`--button-size: var(--default-clickable-area)`),
  ein Override auf `.scoreview-viewer` wirkt deshalb auf alle NcButtons
  dieser Komponente **und** der Kindkomponenten (CSS-Variablen vererben sich
  durchs echte DOM, unabhängig von Vues Scoped-Style-Grenzen) – das war der
  Grund, es dort statt an jedem Button einzeln zu setzen. Nur unter
  `(pointer: coarse)`, damit die Maus-Bedienung kompakt bleibt. Gemessen im
  Touch-Kontext: **44×44 px**, `--default-clickable-area: 44px`.
- **Selten Benutztes ins Aktionsmenü** (`NcActions`/`NcActionButton`): die
  drei Zoom-Presets aus Phase 16 (Seitenbreite/ganze Seite/100 %) liegen
  jetzt hinter einem Drei-Punkte-Menü statt als drei Dauerknöpfe in der
  Leiste; der stufenlose Zoom-Regler daneben bleibt der primäre Weg.
  Playwright: Menü öffnet, enthält genau die drei erwarteten Einträge.
- **Pinch-Zoom** (`scoreLayout.js::computePinchZoom()`, rein und
  unit-getestet; Gestenerkennung in `ScoreViewer.vue`
  `onTouchStart/-Move/-End`). Bewusst eine eigene Geste statt des nativen
  Browser-Zooms: der würde die **gesamte** Nextcloud-Oberfläche vergrößern,
  nicht nur die Partitur – deshalb `preventDefault()` während der
  Zweifinger-Geste. Einfingriges Scrollen bleibt unangetastet. Verifiziert
  mit echten Zweifinger-Touchevents über die CDP-Session
  (`Input.dispatchTouchEvent`; `page.touchscreen` kann nur Einzeltipp):
  Fingerabstand 40 px → 200 px vergrößert die Seite von 900 px auf 1800 px
  (Faktor 5 auf den Zoom-Maximalwert 2 geklemmt, wie vorgesehen).
- **Wischen zum Blättern bewusst NICHT umgesetzt** – und zwar aus dem im
  Plan selbst genannten Grund: Nextclouds Viewer belegt auf Mobilgeräten
  eigene Wischgesten für den Dateiwechsel, eine zusätzliche horizontale
  Geste hätte damit kollidiert. Das vertikale Scrollen deckt das Blättern im
  fortlaufenden Einspaltenlayout ohnehin ab.
- **Bildschirm wachhalten** (`navigator.wakeLock`, `requestWakeLock()`/
  `releaseWakeLock()`): als **Watcher auf `isPlaying`** verdrahtet, nicht in
  `togglePlay()` – so ist jeder Weg, der die Wiedergabe startet
  (Tastaturkürzel, Einzähler-Ende, Loop-Neustart), automatisch erfasst,
  ohne an jeder Stelle einzeln daran zu denken. Defensiv gegen fehlende API
  (Firefox ohne Flag, ältere iOS-Versionen) und gegen die vom Browser selbst
  ausgelöste Freigabe beim Tab-Wechsel (`release`-Listener fordert bei
  weiterlaufender Wiedergabe erneut an). Verifiziert über eine zählende
  Attrappe (headless Chromium bietet die echte API nicht an):
  `request:screen` beim Start, `release` beim Pausieren, nichts davor.
- **SoundFont-Ladefortschritt + „Noten ohne Ton"-Weg**
  (`fetchSoundFontWithProgress()`, `skipSoundFontLoad()`): der Abruf läuft
  jetzt gestreamt über einen `ReadableStream`-Reader statt in einem Rutsch,
  daraus der Prozentwert; ein `AbortController` erlaubt den bewussten
  Abbruch. `Content-Length` am eigenen Endpunkt geprüft (**39.978.561 Byte**,
  die im Plan genannten ~40 MB) – ohne den Header bliebe die Anzeige bei 0 %,
  der Abruf funktionierte aber unverändert. Zwei getrennte Messungen:
  (a) mit gedrosseltem **Byte-Strom** (CDP `Network.emulateNetworkConditions`,
  4 MB/s) steigt die Anzeige monoton 0 → 3 → 8 → … → 98 → 100 %, danach ist
  der echte Player da (Mixer-Knopf vorhanden); (b) „Continue without sound"
  während des Ladens bricht ab und landet auf dem stummen Platzhalter
  („No sound: Sound loading skipped."), Transport läuft trotzdem weiter
  (`.scoreview-seek` bewegt sich) – also genau der im Plan geforderte
  bewusste Weg statt stummem Warten.
- Keine ScoreView-eigenen Konsolenfehler in allen drei Läufen. Vier neue
  l10n-Strings, `npm run l10n:extract` „alle Übersetzungen vollständig".
  `npm test` 76/76 grün (5 neue Tests für `computePinchZoom`). `npm run
  build` ohne neue Fehler; `scoreview-viewer.js` 757 KiB → 878 KiB
  (+121 KiB durch `NcActions`/`NcActionButton` samt Popover-Abhängigkeiten –
  der bislang größte Einzelzuwachs einer UI-Phase, hier bewusst in Kauf
  genommen, weil ein selbst gebautes Aktionsmenü Tastatur- und
  Fokusführung erneut nachbauen müsste, siehe E5). `appinfo/info.xml` auf
  `0.0.17`, `occ upgrade` gelaufen.

**Was offen bleibt (Abnahme nicht erfüllt):**

- **Die Abnahme selbst** – „eine vollständige Probe auf einem echten
  Tablet … Gerätemodell und Browser benennen". Emuliert wurde ein
  768×1024-Touch-Kontext in headless Chromium 1228; das ist ausdrücklich
  *kein* Gerätename und ersetzt die Abnahme nicht.
- **Leistung großer Partituren auf Tablet-Hardware** – ungeprüft, und mit
  dem vorhandenen Material auch gar nicht prüfbar (größte Testpartitur:
  5 Seiten). Hängt an derselben fehlenden Orchesterpartitur wie Phase 20;
  dort mitdokumentiert.
- **Echtes Wake-Lock-Verhalten** – nur gegen eine Attrappe gemessen, weil
  headless Chromium die API nicht anbietet. Dass der Bildschirm auf einem
  echten Gerät wirklich anbleibt, ist damit *nicht* gezeigt.

### Phase 20 – Robustheit an echtem Material

Hier steht kein neues Vorhaben, sondern das Nachziehen der offenen Punkte
aus Abschnitt 5 – Messen statt Vermuten.

- **Große Partituren.** Sämtliche Messungen stammen von 1–5 Seiten. Eine
  Orchesterpartitur (30+ Seiten) durch die volle Kette schicken:
  Konvertierungsdauer, SVG-Größe, Speicherbedarf im Sidecar, DOM-Verhalten,
  Reichweite von `MSCORE_TIMEOUT_SECONDS`.
- **D.C./D.S./Coda an einer in der MuseScore-GUI erstellten Partitur** – M7
  ist dafür ausdrücklich offen (der MusicXML-Weg hat die Sprungmarken nicht
  übernommen). Bis dahin gilt weiter: Der Cursor-Code darf sich nicht auf
  lückenlose `elid`-Abdeckung verlassen.
- **Klangqualität** an mehr als einer Partitur beurteilen. Das ist ein
  Urteil am Ohr, keine Messung. Erst danach über einen Verstärkungsfaktor
  entscheiden – die gemessenen ~7 dB Differenz zu MuseScores eigenem Render
  stehen in Phase 9.
- **Grenzwerte dokumentieren** (Partiturgröße, Seitenzahl, Timeout), offen
  aus Phase 12.
- `sanitizeSvg()` neu bewerten: bewusst regexbasiert und begründet
  (`scoreLayout.js`), aber die Quelle ist ein Nutzer-Upload. Spätestens wenn
  die App verteilt wird (Phase 21), ist das die Stelle, an der ein echter
  Sanitizer seinen Preis wert sein kann.

**Abnahme.** Für jeden Punkt eine Zahl oder ein dokumentiertes Urteil in
diesem Dokument – kein „müsste gehen".

**Umsetzungsstand (2026-08-23), teilweise erfüllt – zwei Punkte bleiben
mangels Material offen.** Drei der fünf Punkte sind mit echten Zahlen
beantwortet, einer davon führte zu zwei echten Fixes. Zwei Punkte brauchen
Material, das es hier nicht gibt (eine Orchesterpartitur, eine aus der
MuseScore-GUI stammende D.C.-Partitur) bzw. ein Urteil am Ohr – die stehen
weiterhin offen und sind unten benannt statt stillschweigend als erledigt
behandelt.

**Erledigt: Grenzwerte gemessen und dokumentiert** (Tabelle in
`sidecar/README.md#gemessene-grenzwerte-phase-20`). Kern der Messung, gegen
die laufende Testumgebung, nicht geschätzt:

| Partitur | Seiten | `.mscz` | Konvertierung | SVG gesamt | größte Seite | Cache |
|---|---|---|---|---|---|---|
| `repeat-test` | 1 | 30 KB | 6,3 s | 107 KB | 107 KB | 111 KB |
| `duckwerk` | 4 | 114 KB | 23,0 s | 3236 KB | 1041 KB | 5038 KB |
| `wwimf` | 5 | 98 KB | 27,7 s | 1174 KB | 303 KB | 4623 KB |

Daraus per linearer Regression: **~5,4 s Konvertierung pro Seite + ~1 s
Grundlast**. Die SVG-Größe schwankt je nach Notendichte um Faktor ~3,4 pro
Seite (303 KB vs. 1041 KB) – eine Hochrechnung „Seitenzahl × Durchschnitt"
ist deshalb ausdrücklich grob.

**Dabei gefundener echter Fehler 1: `MSCORE_TIMEOUT_SECONDS` war zu knapp
für genau den Anwendungsfall, den diese Phase prüfen sollte.** Bei 5,4 s pro
Seite brach der bisherige Default von 120 s ab etwa **22 Seiten** ab – eine
Orchesterpartitur mit 30+ Seiten (der ausdrückliche Prüfgegenstand dieser
Phase) wäre also zuverlässig mit einem nichtssagenden „timeout"
gescheitert, ohne dass jemand die Ursache gesehen hätte. Default auf 600 s
angehoben (deckt rechnerisch ~110 Seiten).

**Dabei gefundener echter Fehler 2: der Fix wäre fast wirkungslos
geblieben.** `sidecar/Dockerfile` setzte `ENV MSCORE_TIMEOUT_SECONDS=120`,
und ein ENV gewinnt über den Fallback-Default in `server.py` – eine Änderung
nur an `server.py` hätte im gebauten Image also **nichts** bewirkt. Erst
aufgefallen, weil nach dem Rebuild `printenv MSCORE_TIMEOUT_SECONDS` im
Container weiterhin `120` meldete. Beide Stellen sind jetzt auf 600 und
tragen einen gegenseitigen Verweis, damit sie nicht wieder auseinanderlaufen.
Nach Rebuild verifiziert: `printenv` → `600`, `/health` → `ok`,
`whoami` → `scoreview` (die Phase-12-Härtung ist unbeschädigt).

**Erledigt: DOM-Last großer Partituren – Zahl statt Vermutung.** Gemessen im
Browser: **~640–1370 DOM-Knoten pro gerenderter Seite** (dichtere Partitur
= mehr). Die Lazy-Ladung aus Phase 8 greift nachweislich – bei `wwimf` war
vor dem Scrollen **1 von 5** Seiten geladen. **Aber: geladene Seiten werden
nie wieder freigegeben** (`ScorePage.vue` kennt kein Entladen), wer eine
30-Seiten-Partitur einmal ganz durchscrollt, hat danach grob **40.000**
SVG-Knoten im DOM. Interaktionslatenz bei den vorhandenen 5500–6400 Knoten:
30 Zoom-Änderungen in 485–495 ms, also **~16 ms pro Änderung** – flüssig auf
Desktop-Hardware. Ob das bei ~40.000 Knoten und auf Tablet-Hardware noch
gilt, ist **nicht** gezeigt (siehe offene Punkte).

**Erledigt, mit Konsequenz: `sanitizeSvg()` neu bewertet – und ersetzt.**
Die Neubewertung war keine Stilfrage, sondern eine Messung: die bisherige
regexbasierte Fassung wurde gegen 15 bekannte Umgehungsmuster geprüft und
liess **9 davon durch**, darunter `onload=x()` ohne Anführungszeichen, ein
ungeschlossenes `<script>`, `javascript:`-URLs in `href`/`xlink:href`,
`<foreignObject>` mit eingebettetem `<iframe>`, `<use href="http://…">` auf
eine fremde Adresse und `<style>` mit `url()`. Eine Regex kann SVG nicht
zuverlässig parsen – genau daran scheiterten diese Fälle. Das zählt trotz
„die Quelle ist MuseScores eigener Serializer", weil die `.mscz` ein
Nutzer-Upload ist und MuseScore Material aus der Partitur (Titel, Liedtext,
freie Textfelder) ins SVG rendert.

Ersetzt durch **DOMPurify 3.4.14** in neuer Datei `src/lib/svgSanitizer.js`
(bewusst getrennt von `scoreLayout.js`, das laut `CLAUDE.md` DOM-frei
bleiben soll – DOMPurify parst echt und braucht ein DOM). Konfiguriert mit
einer Allowlist plus expliziten Verboten: `href`/`xlink:href` sind **gar
nicht** erlaubt (also weder `javascript:` noch Nachladen von fremden
Adressen), ebenso wenig `<foreignObject>`, `<style>` und die
`<set>`/`<animate>`-Familie. Ein MuseScore-Notenbild braucht nichts davon.

Verifiziert auf drei Ebenen:
- **Unit-Tests** (`svgSanitizer.test.js`, jsdom-Umgebung, 16 Tests): alle 9
  zuvor durchgelassenen Muster sind entschärft, und die für das Notenbild
  nötigen Merkmale bleiben erhalten (`viewBox`, `width="…mm"`, `class`, das
  leere `class=""` des weißen Hintergrundpfads aus M9/Phase 16,
  `transform`, Text).
- **Kein Inhaltsverlust am echten Material**: DOM-Knotenzahlen pro Seite vor
  und nach dem Wechsel **exakt identisch** (`wwimf` 642/803/868/806/241,
  `duckwerk` 1256/1275/1371/362) – DOMPurify hat an den echten SVGs
  nachweislich nichts entfernt.
- **Funktion im Browser**: weißer Hintergrundpfad überlebt (`path[class=""]`
  vorhanden, `fill: none` greift), 151 `.Note`- und 60 `.StaffLines`-
  Elemente, `viewBox="0 0 10200 13200"`, `width="215.9mm"`, Sprung zu Takt 3
  zeigt „Measure 3 of 63", Cursor sichtbar mit 16×233 px. Der in Phase 16
  gebaute Cursor-hinter-dem-Notenbild-Mechanismus ist also unbeschädigt.

`npm test` 89/89 grün (16 neue Sanitizer-Tests, die 3 alten Regex-Tests
entfernt). Neue Abhängigkeiten: `dompurify` (Laufzeit), `jsdom` (nur
devDependency, damit sicherheitsrelevanter Code überhaupt testbar ist).

**Was offen bleibt (Abnahme NICHT vollständig erfüllt):**

- **Große Partituren durch die volle Kette** – kein Testmaterial vorhanden
  (größte Partitur hier: 5 Seiten). Konvertierungsdauer, SVG-Größe und
  DOM-Last sind oben *hochgerechnet*, nicht gemessen; Speicherbedarf im
  Sidecar unter Last ist gar nicht erfasst. Die Hochrechnung hat immerhin
  den Timeout-Fehler sichtbar gemacht – ersetzt aber keine echte Messung.
- **D.C./D.S./Coda an einer in der MuseScore-GUI erstellten Partitur** –
  unverändert offen (M7). In dieser Umgebung gibt es keine MuseScore-GUI,
  und der MusicXML-Weg überträgt die Sprungmarken nachweislich nicht. Der
  Cursor-Code verlässt sich weiterhin nicht auf lückenlose
  `elid`-Abdeckung, das Risiko bleibt in der Tabelle stehen.
- **Klangqualität an mehr als einer Partitur** – das ist laut Plan „ein
  Urteil am Ohr, keine Messung", und in dieser Umgebung gibt es kein
  Ausgabegerät. Bewusst **kein** Verstärkungsfaktor eingebaut (Clipping-
  Risiko), die gemessenen ~7 dB Differenz aus Phase 9 bleiben der einzige
  belastbare Anhaltspunkt.

### Phase 21 – Betrieb und Verteilung

Der offene Rest aus Phase 12 plus die Betriebsideen aus Abschnitt 7.

- **AppAPI/ExApp-Verpackung** – die Einlösung der Zusage aus E3:
  Installation über die Nextcloud-UI statt `docker run` plus manuellem
  Cron-Ersatzloop.
- **Sidecar-Bereitstellung jenseits von Docker** konzipieren (nativ auf dem
  Nextcloud-Host oder auf separatem Server), entlang bestehender Muster wie
  dem High Performance Backend (vgl.
  https://github.com/sunweaver/nextcloud-high-performance-backend-setup)
  oder Collabora Office. Berührt E3 und entscheidet mit darüber, wie weit
  die SaaS-Hürde sinkt.
- **MuseScore-Versionspflege**: Wie kommt eine neue MuseScore-Version ins
  Image, ohne dass `--score-media` unbemerkt bricht (Risikotabelle)?
  Mindestens ein Selbsttest beim Start des Sidecars gegen eine
  mitgelieferte Minipartitur – `repeat-test.mscz` liegt dafür bereit und
  deckt mit Wiederholung und Volta genau die Struktur ab, an der ein
  Formatwechsel zuerst auffiele.
- **Admin-Health**: Sidecar erreichbar, SoundFont vorhanden – **und läuft
  der Nextcloud-Cron?** Dessen Fehlen hat schon Zeit gekostet und ist von
  außen nur als „bleibt auf pending stehen" sichtbar.
- **Sandboxing-Rest**: Netzwerkisolation für den `mscore4portable`-
  Subprozess statt für den ganzen Container (Begründung in Phase 12).

**Abnahme.** Jemand, der dieses Repo nicht kennt, bekommt App und Sidecar
nach der Anleitung zum Laufen, ohne dass wir danebenstehen.

**Umsetzungsstand (2026-08-23), zwei von fünf Punkten umgesetzt.** Die
beiden Punkte, die die tägliche Fehlersuche betreffen (Selbsttest,
Admin-Health), sind gebaut und verifiziert. Die AppAPI-Verpackung ist
**nicht** umgesetzt – sie ist ein eigenständiges Packaging-Vorhaben, und
die Abnahme dieser Phase („jemand, der dieses Repo nicht kennt, bekommt App
und Sidecar zum Laufen") ist damit **nicht erfüllt**.

**Umgesetzt: MuseScore-Selbsttest** (`GET /selftest` in `sidecar/server.py`,
Fixture `sidecar/selftest-score.mscz` als Kopie von
`spike/test-scores/repeat-test.mscz`). Beantwortet die Planfrage „Wie kommt
eine neue MuseScore-Version ins Image, ohne dass `--score-media` unbemerkt
bricht?". Geprüft werden nicht nur „Exit 0", sondern die Zusagen, auf denen
der Rest steht: alle erwarteten `--score-media`-Schlüssel (M2), mindestens
eine SVG-Seite, Timing-Events **und** Elementkoordinaten (M4), monoton
steigende Zeiten, und **mindestens ein mehrfach vorkommendes `elid`** (M7 –
das Ausrollen von Wiederholungen).

Bewusst **kein** Test beim Containerstart: das würde jeden Start um ~8 s
verzögern und einen sonst benutzbaren Sidecar bei einem Teilproblem gar
nicht hochkommen lassen. Stattdessen auf Abruf, mit einem Knopf auf der
Admin-Seite.

Verifiziert am laufenden Sidecar: `ok: true`, `1 page, 24 events, 20
elements, 4 repeatedElids, 7.1–7.9 s` – **deckungsgleich mit der
M7-Messung** (20 Notenelemente, 24 Events, `elid` 0–3 je zweimal). Und, weil
ein Test der immer „ok" sagt wertlos wäre, die Gegenprobe: dieselbe
M7-Prüfung gegen `wwimf` (357 Events, 357 verschiedene `elid`s, also keine
Wiederholung) meldet die Zusage korrekt als **verletzt** – die Prüfung ist
also nicht vakuum.

**Dabei gefundener Fehler: `--version` ist als Versionsquelle untauglich.**
Erster Entwurf las die MuseScore-Version zur Laufzeit über
`mscore4portable --version`; gemessen liefert der Aufruf ohne X-Server gar
nichts Brauchbares und mit `xvfb` nur Qt-Rauschen (`Session DBus not
running` u.ä.), die Anzeige stand entsprechend auf „unbekannt". Umgestellt
auf eine zur **Bauzeit** gesetzte ENV aus den ohnehin vorhandenen
Dockerfile-ARGs – zeigt jetzt `4.7.4 (4.7.4.260706075)`, passend zu M1.

**Umgesetzt: Admin-Health** (`lib/Service/HealthService.php`,
`SettingsController::health()`/`selfTest()`, Anzeige in
`templates/settings/admin.php` + `src/settings.js`). Vier Zeilen, jede mit
Symbol **und** Text (nicht Farbe allein):

- **Konvertierungsdienst** – gegen `/health` geprüft, den einzigen Endpunkt
  ohne Secret; damit lässt sich „Sidecar läuft nicht" von „Secret stimmt
  nicht" unterscheiden.
- **SoundFont** – Override-URL / Sidecar-Meldung / gecachte Kopie.
- **Hintergrundjobs (Cron)** – der im Plan ausdrücklich genannte Punkt
  („Dessen Fehlen hat schon Zeit gekostet"). Gemessen an Nextclouds eigenem
  `lastcron`-Zeitstempel, Schwelle großzügige 15 min.
- **Konvertierungen** – fertig/ausstehend/fehlgeschlagen, damit ein hoher
  `pending`-Stand bei totem Cron als das erkennbar wird, was er ist.

Alle drei Zustände am echten System durchgespielt, nicht nur der gute:

| Zustand | Anzeige |
|---|---|
| alles läuft | ✓ Dienst, ✓ SoundFont, ✓ Cron (`last run 13 s ago`), ✓ 3 ready / 0 pending; Selbsttest ✓ `MuseScore 4.7.4 … (1 page(s), 24 events, 7.1 s)` |
| Sidecar gestoppt | ✗ Dienst mit konkretem cURL-Fehler, Selbsttest ✗ mit derselben Ursache |
| Cron seit 30 min tot | ✗ `no run in the last 15 minutes (30 min ago) – conversions will stay pending` |

**Dabei gefundener und behobener eigener UI-Fehler:** im Sidecar-gestoppt-
Zustand zeigte die SoundFont-Zeile ein **✓ neben einer rohen
cURL-Fehlermeldung** – eine Zeile, die sich selbst widerspricht. Das ✓ war
sachlich richtig (eine gecachte Kopie liegt vor, Wiedergabe funktioniert
weiter), der Detailtext nicht. Getrennt: bei erreichbarem Sidecar dessen
Name, bei unerreichbarem „cached copy in use (conversion service currently
unreachable)", und die Fehlermeldung nur noch, wenn wirklich nichts da ist.

**Konzipiert, nicht umgesetzt: Sidecar-Bereitstellung jenseits von Docker.**
Vier Wege samt Kosten in `sidecar/README.md#bereitstellung-jenseits-von-docker-phase-21-konzept`
gegenübergestellt (AppAPI/ExApp, nativ per systemd, separater Host, kein
Sidecar). Kernbefund: **Weg 3 (separater Host) funktioniert schon heute
unverändert** – der Sidecar spricht ohnehin nur HTTP, `sidecar_url` darf auf
eine andere Maschine zeigen; nötig sind dann TLS und ein echtes Secret. Die
Entscheidung berührt E3 und ist bewusst nicht nebenbei gefallen.

**Nicht umgesetzt (Abnahme damit NICHT erfüllt):**

- **AppAPI/ExApp-Verpackung** – der eigentliche Kern der E3-Zusage
  („Installation über die Nextcloud-UI statt `docker run`"). Eigenständiges
  Packaging-Vorhaben: braucht ein ExApp-Manifest, ein veröffentlichtes
  Image und die Umstellung der Konfiguration von „Admin trägt URL+Secret
  ein" auf „AppAPI vergibt beides". Bis dahin bleibt die Installation der
  dokumentierte `docker run`-Weg plus manueller Cron-Ersatzloop – also
  weiterhin Prototypenstand im Sinne von E3.
- **Sandboxing-Rest** (Netzwerkisolation nur für den
  `mscore4portable`-Subprozess) – unverändert offen, Begründung steht in
  Phase 12. `--memory`/`--pids-limit` bleiben dokumentierte
  Betriebsempfehlung, der non-root-Prozess aus Phase 12 ist nach allen
  Image-Rebuilds dieser Sitzung weiterhin aktiv (`whoami` → `scoreview`
  nachgeprüft).

### Phase 22 – Bedienfläche zurückgeben (UI-Konzept II)

Dateien: `ScoreViewer.vue`, `ScorePage.vue`, `ScoreMixer.vue`,
`ScoreAnnotations.vue`, `src/lib/scrollPlan.js`, `src/lib/metronome.js`,
`src/lib/metronomeClick.js`, `src/lib/scoreLayout.js`.

Ausgangslage (Nutzer-Rückmeldung nach Phase 19, am Bestand nachgemessen –
`wwimf`, Viewport 1400×900):

- Nur die Transportleiste ist `position: sticky`. Die zweite Leiste
  (`.scoreview-rehearsal`: Takt, Loop, Zoom, Vollbild) und die Panels für
  Mixer und Notizen stehen im normalen Fluss und sind **nur ganz oben**
  erreichbar. Und dorthin kommt man beim Lesen nie zurück: das Autoscroll
  aus Phase 16 scrollt schon beim Öffnen so weit, dass diese Leiste
  verschwindet (gemessen: `.scoreview-rehearsal` liegt direkt nach dem
  Laden bei `top: -54px`). Zoom, Mixer und Notizen sind damit im laufenden
  Betrieb faktisch nicht bedienbar.
- Die beiden Leisten kosten zusammen **158 px von 900 px** (17,6 %) – und
  das dauerhaft, obwohl die Noten der eigentliche Inhalt sind.
- Das Taktfeld ist **1376 px breit** für eine zweistellige Zahl. Die
  scoped-CSS-Regel `width: 70px` greift nicht: `NcInputField` bringt
  `.input-field[data-v-…] { width: 100% }` mit, gleiche Spezifität (0,2,0)
  wie unsere Regel, und die Bibliotheks-CSS wird später eingebunden – bei
  Gleichstand gewinnt die Reihenfolge. Eine feste Breite muss deshalb an
  einen **Wrapper** statt an die Komponente.
- Zoom über die Seitenbreite hinaus wirkt nicht: `.score-page` ist
  `width: 100%` mit `max-width: 900 · zoom` px. Sobald `900 · zoom` die
  Containerbreite übersteigt, begrenzt `width: 100%`. Hineinzoomen und
  schieben – der Normalfall auf dem Tablet – ist damit unmöglich.
- Das Metronom klickt nur auf den Taktanfang (ein Klick je Wechsel von
  `currentAnchor.measureNumber`). Für die Probe zu wenig.

**Leitgedanke.** Die Noten sind der Inhalt; jede Bedienfläche muss sich
rechtfertigen. Was ständig gebraucht wird, bleibt sichtbar; alles andere
liegt einen Klick tief in einem Popover, das über den Noten aufgeht, statt
sie dauerhaft zu verdrängen. Und: **nichts scrollt weg.**

- **Eine einzige Leiste, außerhalb des Scrollbereichs** (K1). Statt zweier
  `sticky`-Leisten im Scroll-Container trägt der Viewer jetzt eine
  Flex-Spalte: Leiste (`flex: 0 0 auto`) über einem eigenen Scroll-Element
  (`flex: 1`). Damit ist „nach oben scrollen, um an die Bedienelemente zu
  kommen" strukturell unmöglich, und der `z-index`-Wettlauf gegen die
  SVG-Seiten aus Phase 17 entfällt ersatzlos.
- **Panels als Overlay statt im Fluss** (K2). Mixer und Notizen liegen als
  Karten rechts über dem Notenbild (eigenes Scrollen, Schließen-Knopf),
  nicht mehr zwischen Leiste und Seiten. Sie kosten damit keine Höhe,
  wenn sie zu sind, und keinen Weg nach oben, wenn sie offen sind.
- **Takt: Anzeige und Eingabe sind dasselbe Feld** (K3). Statt „Takt 12 von
  63" links und einem Sprungfeld plus „Los"-Knopf in der zweiten Leiste
  ein Feld von 72 px, das die laufende Taktnummer zeigt, und daneben
  `/ 63`. Hineinklicken, Zahl tippen, Enter springt; solange das Feld den
  Fokus hat, läuft die Anzeige nicht mit (sonst überschriebe sie die
  Eingabe). Der Partiturtitel entfällt in der Leiste – Nextclouds Viewer
  zeigt den Dateinamen ohnehin in seiner eigenen Kopfzeile.
- **Selten Benutztes in Popovers** (K4): Loop (Von/Bis, „ab aktuellem
  Takt", An/Aus), Tempo + Metronom-Auflösung, Zoom (Regler + die drei
  Presets). Jeweils ein Icon-Knopf in der Leiste, der seinen Zustand zeigt
  (`pressed`), statt einer Reihe beschrifteter Knöpfe. Häufiges bleibt
  ein Klick: Play/Pause, Suchlauf, Takt, Loop an/aus, Metronom an/aus,
  Mixer, Notizen, Vollbild.
- **Autoscroll, das den Zoom kennt** (K5). Das feste Sichtband (35–65 % der
  Viewporthöhe) aus Phase 16 passt nur, solange das Cursor-Rechteck klein
  gegen den Viewport ist. Bei starkem Zoom ist ein System höher als das
  Band – die „überlappt das Band"-Regel meldet dann „alles gut", während
  die halbe Zeile unter der Kante steht. Neue Regel, weiterhin rein in
  `scrollPlan.js`: passt das System (mit Rand) in den Viewport, wird es
  **vollständig** sichtbar gehalten und beim Nachführen so gelegt, dass
  35 % des freien Platzes über und 65 % unter ihm liegen (Vorausschau auf
  das Kommende); passt es nicht, wird die Oberkante angelegt. Beides ist
  nachweisbar stabil: nach einem Nachführen liefert dieselbe Funktion
  `null`, also kein zweiter Sprung. Dazu ein waagerechtes Pendant für den
  Fall, dass die Seite breiter als der Viewport ist.
- **Zoom, der über die Seitenbreite hinausgeht** (K6). `.score-page`
  bekommt eine echte Breite (`900 · zoom` px) statt `width: 100%` mit
  Deckel; der Scroll-Container erlaubt waagerechtes Schieben. Startwert ist
  „Seitenbreite" und bleibt es, solange niemand selbst zoomt – dann folgt
  er der Fenstergröße wie bisher (`ResizeObserver`). Sobald jemand zoomt,
  gilt sein Faktor absolut. Zoomgrenzen dadurch weiter (0,25–4 statt
  0,5–2): auf einem Telefon liegt „Seitenbreite" bei etwa 0,43.
- **Metronom auf Schlagebene** (K7). `measures.json` liefert nur Taktzeiten
  (M4) – die Schlaganzahl wird wie beim Einzähler aus Taktdauer und
  `metadata.tempo` geschätzt (`estimateBeatsInMeasure()`, Phase 17) und der
  Takt gleichmäßig geteilt. Voreinstellung „jeder Schlag" mit Akzent auf
  der Eins, umschaltbar auf „nur Taktanfang" (das alte Verhalten). Geklickt
  wird nicht mehr im Bildwiederholtakt, sondern mit ~60 ms Vorlauf im
  `AudioContext` terminiert – rAF-Jitter würde man auf Schlagebene hören.

**Abnahme.** Bei jeder Scrollposition und in jedem Zoom sind Play/Pause,
Takt, Loop, Metronom, Zoom, Mixer und Notizen ohne Scrollen erreichbar. Die
Leiste kostet höchstens ein Drittel der bisherigen 158 px. Das Taktfeld ist
schmal und zeigt die laufende Taktnummer. Über eine Wiedergabe bei Zoom
„Seitenbreite" und bei zweifachem Zoom bleibt das aktuelle System jeweils
vollständig sichtbar. Das Metronom klickt hörbar auf jedem Schlag, mit
Akzent auf der Eins, und lässt sich auf „nur Taktanfang" zurückstellen.

**Umsetzungsstand (2026-08-23).** Vollständig umgesetzt und an der
Testinstanz per Playwright nachgemessen (`wwimf`, 63 Takte, 5 Seiten,
Viewport 1400×1000 sowie 390×844).

- **Leiste (K1).** 47 px statt vorher 158 px in zwei Leisten, und an jeder
  Scrollposition an derselben Stelle (bei `scrollTop = 3000` unverändert
  `top: 50`). Elf Bedienelemente in einer Zeile: Play/Pause, Suchlauf,
  Laufzeit, Takt, Loop, Tempo/Metronom, Metronom, Zoom, Mixer, Notizen,
  Vollbild.
- **Panels (K2).** 404 px breite Karten rechts; das Notenbild verschiebt
  sich beim Öffnen nachweislich nicht (`.score-page` behält seine Position).
  Beim ersten Messen waren sie **durchsichtig** – dasselbe `z-index`-Rennen,
  das bis Phase 21 die sticky Transportleiste hatte: `.score-page-svg`
  (`z-index: 1`) und `.score-page-marker` (`z-index: 2`) konkurrieren
  direkt mit dem Panel-Container, weil weder `.scoreview-pages` noch
  `.score-page` einen eigenen Stacking-Context eröffnen. Behoben über
  `z-index: 20` (Kommentar an der Regel).
- **Taktfeld (K3).** 72 px statt 1376 px, zeigt während der Wiedergabe die
  laufende Taktnummer (bei 0:40 stand dort „14"), Eingabe + Enter springt
  (Takt 30 → 1:29, Ansicht auf Seite 2 nachgeführt).
- **Autoscroll (K5).** Über je 20 s Wiedergabe, 80 Stichproben im
  250-ms-Takt: das Cursor-Rechteck war bei „Seitenbreite" **98 %** und bei
  zweifachem Zoom **98 %** der Zeit vollständig sichtbar, in 100 % bzw. 99 %
  mindestens teilweise – die Ausreißer sind die laufende
  Smooth-Scroll-Animation selbst. Cursorhöhe dabei 346–452 px bei 853 px
  Sichthöhe. Bei vierfachem Zoom (Systemhöhe 927 px > Sichthöhe 853 px)
  greift der zweite Zweig: die Oberkante liegt exakt auf dem Rand (24 px).
  Manuelles Scrollen setzt weiterhin aus und nimmt danach wieder auf
  (gemessen: 1212 → nach der Pause 121, Cursor wieder vollständig sichtbar).
- **Zoom (K6).** Startwert „Seitenbreite" (1376 px Seitenbreite bei 1400 px
  Viewport, 366 px bei 390 px). Bei Zoom 2 ist die Seite 1800 px breit und
  der Scrollbereich 1812 px – waagerechtes Schieben funktioniert, bis
  Phase 21 war das an der Containerbreite gedeckelt.
- **Metronom (K7).** 20 s Wiedergabe bei ♩ = 80, gemessen an den im
  `AudioContext` terminierten Startzeiten: 27 Klicks, Abstände 747–753 ms
  (Soll 750 ms), davon 7 mit Akzent – also genau ein Akzent je 4/4-Takt. Auf
  „nur Taktanfang" umgestellt: 8 Klicks, Abstände 3000 ms, alle mit Akzent.
- **Nebenbefund, mitbehoben:** ein Sprung bei **angehaltener** Wiedergabe
  (Taktfeld, Klick auf eine Note, Loop-Start) bewegte den Cursor nicht –
  die Transportanzeige sprang auf 1:29, der Cursor blieb in Takt 1. Ursache
  ist der Setter `sequencer.currentTime` in `player.js`: er wirkt nicht
  synchron, der aus dem `seeked`-Ereignis unmittelbar danach gelesene Wert
  war noch der alte. `useScoreSync.js` rechnet deshalb jetzt in jedem Frame
  nach, nicht nur während der Wiedergabe (Kosten: eine Binärsuche pro
  Frame). Das war ein Fehler seit Phase 10 und fiel erst auf, seit das
  Taktfeld Anzeige und Sprung vereint.
- **Einzähler.** Startet die Wiedergabe jetzt einen Schlag NACH dem letzten
  Klick statt auf ihm – vorher zählte ein Viertakter faktisch nur drei
  Schläge vor.

**Bewusst offen geblieben:**

- Auf Telefonbreite (390 px) bricht die Leiste in **zwei Zeilen** um (87 px
  von 744 px). Alles bleibt erreichbar; die Laufzeitanzeige wird unter
  600 px ausgeblendet. Ein Überlaufmenü für die selteneren Knöpfe wäre der
  nächste Schritt, wenn sich das in der Probe als störend erweist – es
  lohnt sich erst mit einem echten Urteil an einem echten Gerät.
- Das waagerechte Nachführen greift nur, wenn die Seite breiter als das
  Bild ist; an `wwimf` bei zweifachem Zoom blieb die aktuelle Stelle ohnehin
  im Bild. Der Zweig ist damit real nur an seiner reinen Funktion
  (`planHorizontalScroll`, Test) belegt, nicht am laufenden Notenbild.

### Phase 23 – Codereview-Nacharbeit (Prototyp → Produktiv-App)

Anlass: vollständiger Codereview am 2026-08-23 auf Stand `b419f17`
(24 Befunde, Bericht als Artifact). Schwerpunkte laut Auftrag: Wartbarkeit,
Modularisierung, Vereinfachung über Nextcloud-Standard, Aktualität der
Bibliotheken. Diese Phase hält fest, was daraus abgearbeitet ist und was in
welcher Reihenfolge folgt – die Reihenfolge ist begründet, nicht beliebig:
Schritt 2 spannt das Netz, das Schritt 6 braucht, und Schritt 1 löscht Code,
den man sonst in Schritt 6 mit umbaut.

| # | Schritt | Befunde | Stand |
|---|---|---|---|
| 1 | Aufräumen: Phase-2-Gerüst, überholte Kommentare | D1, F | **umgesetzt** |
| 2 | Netz spannen: ESLint/Stylelint, PHP-Tests, Sidecar-Tests, CI | C4, C5, C6, B4, B5 | **umgesetzt** |
| 3 | Mechanische Modernisierung: `IAppConfig`, Secret als sensibel, Einstellungsseite auf `@nextcloud/vue` | C1, C2, C3 | offen |
| 4 | Echte Fehler: CSP-Reichweite, Seitenladefehler, Klick-Trefferradius, Aufräumen bei Lösch-Events | A1, A2, A3, A4, A7 | offen |
| 5 | Sidecar produktionsfähig: Nebenläufigkeitsgrenze, WSGI-Server, Modulaufteilung | A5, A6, B3 | offen |
| 6 | Der große Umbau: `ScoreViewer.vue` in Composables, Auslieferungsrouten zusammenführen | B1, B2 | offen |
| 7 | Feinschliff: rAF-Schleifen, SVG-Entladen, Store-Metadaten | E1, E2, E3, C7 | offen |

**Aktualität – nichts zu tun.** `npm outdated` liefert nichts: Vue 3.5.41,
`@nextcloud/vue` 9.9.0, spessasynth_lib 4.3.14, DOMPurify 3.4.14,
vitest 4.1.11, webpack 5.109.2. Gegenprobe zu E5 mitgemacht:
`@nextcloud/vue` 9.9 hat weiterhin **keine** Slider-Komponente – die
Entscheidung, für Seek/Tempo/Zoom bei `<input type="range">` zu bleiben, gilt
unverändert. Die einzige Aktualitätslücke ist PHP-seitig (C1, Schritt 3).

**Umsetzungsstand Schritt 1 (2026-08-23).**

*D1 – Phase-2-Gerüst entfernt.* Gelöscht: `Controller\PageController`,
`templates/main.php`, `src/main.js`, `src/components/App.vue`, die Route
`page#index` und der Webpack-Entry `scoreview-main`. Der Befund war nicht
bloß toter Code, sondern nach außen sichtbar: `/apps/scoreview/` lieferte
jeder eingeloggten Nutzerin „App-Grundgerüst läuft. Konvertierungs-Pipeline
und Viewer-Integration folgen in späteren Phasen." – ein hartkodierter
deutscher Text, der zusätzlich an E4 vorbeigeht und den
`tools/l10n.mjs` nicht bemerken konnte, weil er nicht in einem `t()` steckte.
Dazu wurde ein 66-KB-Bundle gebaut und ausgeliefert, das nichts tat.

Verifiziert gegen `nextcloud-test` (Playwright, als eingeloggte Nutzerin –
ein anonymer Aufruf hätte nur den Login-Redirect gemessen und nichts belegt):
`/apps/scoreview/` antwortet **404**, der Platzhaltertext ist nicht mehr im
DOM. Der Viewer läuft unverändert: Leiste mit 7 Knöpfen, 5 Seitencontainer,
Seite 1 mit 351 `<path>`-Knoten geladen, Suchlauf und Taktfeld vorhanden,
Cursor-Overlay nach dem Start sichtbar, Gesamtdauer 3:11 (= die 191 s aus
M2/M8). **Null fehlgeschlagene Requests, keine ScoreView-Konsolenfehler**
(die einzige verbliebene Meldung stammt aus Nextclouds `text`-App).
Zusätzliches Indiz, dass der Viewer nicht angefasst wurde:
`scoreview-viewer.js` ist vor und nach der Änderung byte-identisch
(929.283 B).

*F – fünf überholte Kommentare korrigiert.* CLAUDE.md verlangt Kommentare,
die das *Warum* erklären; ein falsches Warum kostet mehr Zeit als gar keins.

- `SettingsController::update()` behauptete „Leer = keine echte Wiedergabe,
  ScoreViewer.vue fällt auf den stummen Phase-8-Cursor-Modus zurück" – seit
  der Korrektur in Phase 9 ist es genau umgekehrt: leer heißt, die App
  liefert das SoundFont des Sidecars selbst aus. Der Kommentar beschrieb den
  Zustand, dessen Beseitigung Phase 9 ausdrücklich als Fehler festhält.
- `SidecarClient`: Der Docblock zu `fetchSoundFontInfo()` stand verwaist über
  `checkHealth()` (zwei gestapelte Docblocks), `fetchSoundFontInfo()` selbst
  hatte keinen – jetzt an der richtigen Methode. `pollStatus()`s `@return`
  nannte noch `{musicxml, audio, timingJson}` aus Phase 3 statt
  `{pages, midi, timingJson, measuresJson, metaJson}`.
- `AnnotationMapper::findByIdAndFileId()` verwies auf
  `AnnotationService::canModify()` – diese Methode existiert nicht, die
  Entscheidung liegt in `updateContent()`/`delete()`.
- Migration `…130000`: „`visibility`: aktuell immer 'private'" – seit
  Phase 18 nicht mehr.
- `ScoreFileListener`: „ein eigenes mimetypemapping.json kommt erst in
  Phase 4". Es existiert längst – aber Nextcloud lädt es nicht aus
  `appinfo/`. Der Kommentar nennt jetzt den *heute gültigen* Grund für die
  Endungsprüfung: ein Mimetype-Vergleich würde den Trigger davon abhängig
  machen, ob der Betreiber die Datei nach `config/` kopiert hat.

`npm test` (99 grün), `npm run build`, `npm run l10n:extract` (vollständig)
und `php -l` über alle PHP-Dateien laufen durch. Version auf 0.0.20 erhöht
und `occ upgrade` ausgeführt (Routenänderung – siehe Fallstrick
`CachingRouter`).

**Umsetzungsstand Schritt 2 (2026-08-23).** Das Netz steht für alle drei
Sprachen des Repos. Vorher: 99 JS-Tests und sonst nichts – kein Linter, keine
PHP-Tests, keine Sidecar-Tests, keine CI.

*C4 – ESLint und Stylelint.* `@nextcloud/eslint-config` 9
(`recommendedJavascript`, weil die `<script>`-Blöcke JavaScript sind) und
`@nextcloud/stylelint-config`, dazu vier npm-Skripte. Beim ersten Lauf: 263
Befunde, davon 171 maschinell behebbar. Drei Entscheidungen dabei, die
festzuhalten sind, weil sie von außen wie Nachlässigkeit aussehen könnten:

1. **`jsdoc/require-jsdoc` ist abgeschaltet.** Die Regel ist autofixbar und
   setzt dabei leere `/** */`-Blöcke über jede Funktion – gemessen 35 allein
   in `player.js` und `silentClock.js`. Das widerspricht der Konvention aus
   `CLAUDE.md` direkt und verdünnt genau die dichte, handgeschriebene
   Kommentierung, die dieser Bestand als Stärke hat. Dasselbe für
   `require-param-description`/`-type`.
2. **Die Allowlists in `svgSanitizer.js` behalten ihre Gruppierung**
   (`exp-list-style` lokal aus). Bei einer Allowlist *ist* die Liste der
   sicherheitsrelevante Inhalt, und die Gruppierung (Struktur / Formen /
   Text / Verläufe) sagt, warum ein Eintrag drinsteht. Ein Eintrag pro Zeile
   macht daraus 74 Zeilen ohne diese Aussage.
3. **Der Notiz-Marker in `ScorePage.vue` bleibt bei `margin-left`**, obwohl
   Stylelint `margin-inline-start` verlangt: er wird über `left`/`top` in
   Prozent der SVG-`viewBox` positioniert, und ein Notenbild spiegelt sich in
   einer RTL-Oberfläche nicht mit. Die Bedienfläche drumherum ist dagegen auf
   logische Eigenschaften umgestellt (`border-inline-start`,
   `inset-inline-end`, `text-align: start`) – das ist zugleich die Vorarbeit
   für den RTL-Punkt aus Abschnitt 7.

Die einzige **Verhaltensänderung**: Custom-Events heißen jetzt camelCase
(`noteClick`, `markerClick`, `volumesChanged`, `programChanged`, `jumpTo`);
die Templates bleiben kebab-case, weil Vue 3 beides auf denselben
`onNoteClick`-Prop auflöst. Weil keine Komponente unit-getestet ist, wurde
jeder der fünf Pfade einzeln am laufenden Viewer belegt: Klick ins Notenbild
springt (22 % der Seite → 7 s, 80 % → 37 s, stabil bei Wiederholung), Mute im
Mixer erreicht nachweislich `player.applyChannelVolumes()` (Nachrichten an
das Synth-Worklet steigen bei angehaltener Wiedergabe von 5 auf 9), Klick auf
eine Notiz und auf ihren Seitenmarker springen beide, und das unveränderte
`loaded` trägt weiterhin den Startzoom.

Nebenbefund, den der Linter selbst geliefert hat: `OC.generateUrl` in
`src/settings.js` ist seit Nextcloud 19 deprecated. Das bestätigt C3
unabhängig und bleibt bewusst als **Warnung** stehen, bis Schritt 3 die
Einstellungsseite umstellt.

`.gitattributes` setzt jetzt `* text=auto eol=lf`. Die committeten Blobs
waren ohnehin LF, aber der Windows-Working-Tree bekam CRLF – womit
`@stylistic/linebreak-style` für jede frisch ausgecheckte Datei einen Fehler
meldete, den es im Repo gar nicht gibt. Der Linter wäre lokal unbenutzbar
gewesen, während CI grün ist.

*B5/C5 – PHP-Tests und Codingstandard.* `phpunit` 10.5,
`nextcloud/coding-standard` 1.5 und `nextcloud/ocp` 31 als `require-dev`;
**32 Tests, 63 Assertions**, Laufzeit 0,06 s. Getestet ist genau das, was
bisher nur von Hand gegen die Testinstanz geprüft wurde und beim Umbau in
Schritt 6 still umkippen könnte:

- `AnnotationService` – alle vier Rechte-Verzweigungen je Schreiboperation,
  einschließlich der bewussten Unterscheidung „null → 404, ohne Existenz zu
  bestätigen" gegen „Exception → 403", und dass `serialize()` die rohe
  `userId` gar nicht erst ausliefert.
- `SoundFontService` – die Rückfallpfade, an denen allein die Zusage hängt,
  dass Wiedergabe den Sidecar nicht braucht.
- `AddCspListener` – geprüft wird die gebaute Policy-Zeichenkette, nicht der
  interne Zustand. Diese Tests halten fest, was heute gilt, **bevor**
  Schritt 4 die Reichweite eingrenzt (A1).

Beide Testsuiten sind gegen einen Mutationstest abgesichert, nicht nur als
„läuft grün" abgehakt: das Aushebeln der `canWriteShared`-Prüfung lässt 3
PHP-Tests fallen, das Aushebeln der M3-Markersuche 2 Sidecar-Tests. Der
erste Versuch dieses Mutationstests hat *nichts* verändert (ein Backslash
ging in der Shell verloren) und trotzdem „grün" gemeldet – der Beleg zählt
erst, seit die Ersetzung selbst geprüft wird.

Der Codingstandard fand **1 von 31 Dateien** abweichend, und nur bei der
Docblock-Ausrichtung. Übernommen statt ausgenommen – anders als bei den drei
Punkten oben trägt die Abweichung hier keine Aussage.

*B4 – Sidecar-Tests.* **13 pytest-Tests**, ohne MuseScore, ohne Xvfb, ohne
Container. Sie decken die Division durch 12 (M4), die Sortierung nach Zeit,
das Erhalten mehrfacher `elid`s bei Wiederholungen (M7) und vor allem M3: das
Wegschneiden des Qt-Rauschens vor dem JSON, samt der Unterscheidung zwischen
„Marker fehlt" und „JSON kaputt". Dass `xvfb-run` und `timeout` im Aufruf
stehen, ist ebenfalls festgenagelt – beides darf bei einem Umbau nicht
stillschweigend wegfallen. `conftest.py` setzt Secret und `JOBS_DIR` vorab,
statt `server.py` dafür schon jetzt aufzuteilen; das Aufteilen ist Befund B3
und gehört zu Schritt 5 – die Tests sollen davor da sein, nicht danach.

*C6 – CI und Release.* `.github/workflows/ci.yml` mit drei parallelen Jobs
(Frontend, Backend über PHP 8.1/8.4, Sidecar über Python 3.10/3.12), damit
ein roter Job sofort sagt, wo es klemmt. Dazu `release.yml`: der Tarball
**muss** aus einem echten Build entstehen, weil `scoreview/js/` gitignored ist
– ein aus dem Repo gepacktes `scoreview/` enthielte kein einziges
Frontend-Bundle. Die Action baut deshalb Frontend und Autoloader und prüft
danach ausdrücklich nach, dass keine OCP-Stubs im Produktions-Autoloader
gelandet sind. Lokal gegengeprüft: mit `--no-dev` enthält der Classmap 27
Klassen (nur `lib/`), und `class_exists('OCP\AppFramework\Db\Entity')` ist
`false`. Ebenfalls gegengeprüft, weil es ein neues Risiko im
Entwicklungs-Checkout wäre: das jetzt vorhandene `scoreview/vendor/`
verdeckt die echten OCP-Klassen **nicht** – in der Testinstanz kommt
`OCP\AppFramework\Db\Entity` weiterhin aus `/var/www/html/lib/public/`.

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
| Phase-2-Gerüst (`PageController`, Route `page#index`, `templates/main.php`, `src/main.js`, `App.vue`, Bundle `scoreview-main`) | Phase 23/D1 – die App hat bewusst keine eigene Seite, nur die Viewer-Integration |

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
- **Offline im Probenraum.** WLAN ist dort oft schlecht oder gar nicht
  vorhanden. Ob die App ohne Netz brauchbar ist, ist ungeprüft: Die
  Artefakte sind bereits unveränderlich und aggressiv cachebar (Phase 7),
  was günstig ist, aber Nextclouds Viewer ist keine installierbare Web-App,
  und das SoundFont wiegt ~40 MB. Diese Frage entscheidet mit darüber, ob
  eine eigene Mobil-App überhaupt ein Problem löst, das der Browser nicht
  löst (Abschnitt 7).
- **Übersetzungsumfang.** DE + EN sind beschlossen (E4). Ob weitere Sprachen
  gebraucht werden – und damit ein Community-Übersetzungsweg statt der
  gepflegten Dateien im Repo – hängt daran, ob die App über den eigenen Chor
  hinausgeht.

Zwei bisher offene Punkte haben jetzt einen Termin statt nur eine Notiz:
Klangqualität und große Partituren werden in Phase 20 gemessen bzw.
beurteilt.

## 6. Risiken

| Risiko | Auswirkung | Umgang |
|---|---|---|
| Wiederholungen im Timing anders als erwartet | Cursor-Datenmodell ändert sich | Phase 5 vor Phase 8 |
| SoundFont-Größe verschlechtert Erstladezeit spürbar | UX | Kleineren SF3 wählen, aggressiv cachen, Ladefortschritt zeigen |
| ~~MIDI-Kanalreihenfolge ≠ `metadata.tracks`~~ **erledigt (korrigiert in Phase 17)** | Mixer ordnet falsch zu | Phase 9 hatte das nur an `wwimf` bestätigt (Solo auf Kanal 0 = Sopran), wo Kanal zufällig = Index war. Phase 17 hat an `duckwerk` gemessen, dass das NICHT allgemein gilt (Sopran/Alt/Tenor/Bariton/Bass auf MIDI-Kanal 0/2/3/1/6, nicht 0-4) und `resolveMixerChannels()` auf die echten, aus dem geladenen MIDI gelesenen Kanäle umgestellt (`player.js::getTrackChannels()`) statt auf den Index |
| SVG-Seiten großer Partituren zu schwer fürs DOM | Ruckeln | Nur sichtbare Seiten rendern |
| `--score-media` in künftiger MuseScore-Version geändert | Pipeline bricht | Version ist gepinnt; Update bewusst und getestet |
| MuseScore-Sicherheitslücke über präparierte `.mscz` | Server kompromittiert | Phase 12, nicht später |
| D.C./D.S./Coda werden von `--score-media` nicht ausgerollt (M7, nur mit Hand-MusicXML getestet, GUI-Fall offen) | Cursor bleibt bei einem Sprung stumm/stehen statt zu springen, Restpartitur bleibt aber normal navigierbar | An echter, in der MuseScore-GUI erstellter Partitur mit D.C. nachprüfen, sobald verfügbar; Cursor-Code darf sich nicht auf lückenlose `elid`-Abdeckung verlassen |
| Antivirus (bestätigt: Windows Defender) quarantäniert Dateien unter `scoreview/node_modules` (u.a. `stb-vorbis/dist/index.js`) | `npm install`/`npm run build` liefert ein kaputtes `spessasynth_lib` aus, Phase 9 bricht ohne offensichtliche Fehlerursache | Defender-Ausnahme für `scoreview/node_modules` einrichten (siehe Phase 9); auf CI/Build-Maschinen vorab prüfen |
| ~~Echte Tonausgabe (Phase 9) nicht Ende-zu-Ende verifiziert~~ **erledigt** | – | Pegel, Mixer-Wirkung und Tempo-Zeitachse am laufenden Browser gemessen und gegen einen MuseScore-WAV-Render verglichen (siehe Phase 9) |
| Klangqualität/Lautstärke: der Browser-Mixdown liegt ~7 dB unter MuseScores eigenem Render (gemessen, siehe Phase 9) | Nutzer, die MuseScore gewohnt sind, empfinden die Wiedergabe als leise | Bewusst kein pauschaler Verstärkungsfaktor eingebaut (Clipping-Risiko in lauten Passagen); erst an mehr echtem Material bewerten – der Unterschied stammt vor allem aus SoundFont-Wahl und fehlenden Master-Effekten |
| Neue Route in `appinfo/routes.php` wirkt bis zu 1 h nicht (`CachingRouter` cached die kompilierte Routentabelle je Host-Header) | Endpunkt liefert 404, obwohl korrekt definiert – irreführend, weil derselbe Request mit anderem Host-Header sofort funktioniert | App-Version in `info.xml` erhöhen + `occ upgrade`, oder lokalen Cache leeren; dokumentiert in `scoreview/README.md#troubleshooting` |
| ~~Cache-Format-Wechsel (wie in dieser Sitzung Phase 6/7) hat keinen Migrationspfad für schon konvertierte Partituren (siehe Phase 12, „Neu gefundene Lücke")~~ **erledigt** | `status()` lieferte 500 für jede Datei, die unter einem älteren Cache-Format bereits `status=ready` war | Behoben in Phase 14: `format_version`-Spalte, `status()`/`serveCachedFile()` behandeln eine ältere Version (oder eine fehlende Cache-Datei) automatisch wie „nicht fertig" und stoßen selbst eine Neukonvertierung an - kein manuelles Löschen mehr nötig |
| Neu registrierter Mimetype gilt nicht rückwirkend für schon vorhandene Dateien (`occ maintenance:mimetype:update-db` reicht dafür nachweislich NICHT, entgegen einer früheren, jetzt widerlegten Annahme in `scoreview/README.md`) | Alte `.mscz`-Bestandsdateien bieten nur „Herunterladen" an, nicht den Viewer | Nach Registrierung zusätzlich `occ files:scan <Nutzer>` (oder `--all`) für den betroffenen Bestand ausführen - siehe `scoreview/README.md#troubleshooting` |

Ergänzt in der zweiten Planungsrunde (2026-08-23):

| Risiko | Auswirkung | Umgang |
|---|---|---|
| `@nextcloud/vue` (E5) verhält sich im selbst gemounteten zweiten Vue-Baum (`src/viewer.js`) anders als in einer gewöhnlichen Nextcloud-App | Die UI-Phasen 16–19 bauen auf einer Basis auf, die ausgerechnet im Viewer bricht | Phase 15 verifiziert ausschließlich im Viewer-Kontext und **vor** 16–19; Bundle-Größe vorher/nachher messen |
| Fehlende oder unvollständige Übersetzung fällt nicht auf – Nextclouds `JSResourceLocator` ignoriert fehlende l10n-Dateien bewusst („missing translations files will be ignored") | Die Oberfläche mischt still Sprachen, niemand merkt es | Vollständigkeitstest in `npm test` statt Sorgfalt (Phase 14) |
| `metadata.tracks` leer, obwohl `parts` gefüllt ist (gemessen, M8) | Der Mixer verschwindet komplett, obwohl Ton läuft – keinerlei Lautstärkeregelung | Fallback auf `parts` bzw. mindestens ein Summenregler (Phase 17) |
| `metadata.tempo == 0` bei Partituren ohne Tempoangabe (gemessen, M8) | Eine BPM-Anzeige hätte keinen echten Bezugswert und behauptete eine Genauigkeit, die nicht da ist | MuseScore-Vorgabe 120 annehmen **und** als geraten kennzeichnen (Phase 17) |
| ~~Geteilte Notizen sind eine Datenweitergabe an alle mit Dateizugriff~~ **erledigt** | Jemand teilt versehentlich etwas Privates | Umgesetzt in Phase 18: expliziter Umschalter beim Anlegen, serverseitig an `PERMISSION_UPDATE` gebunden - an drei echten Konten mit unterschiedlichen Freigaberechten verifiziert (403 bei fehlendem Schreibrecht, siehe dort) |
| Fehlermeldungen der Konvertierung werden einmal geschrieben und später von beliebigen Nutzern gelesen | Eine zum Schreibzeitpunkt übersetzte Meldung wäre für alle anderen in der falschen Sprache | `error_code` speichern, erst beim Anzeigen übersetzen, technisches Detail unübersetzt danebenstellen (Phase 14) |

## 7. Ideensammlung und ihre Zuordnung

Die am 2026-08-23 gesichtete Ideensammlung ist in der zweiten Planungsrunde
bewertet und den Phasen 14–21 zugeordnet worden. Diese Tabelle hält
vollständig fest, wo jede Idee gelandet ist – auch die, die bewusst nicht
eingeplant wurden. Nichts davon ist stillschweigend verschwunden.

| Idee | Zuordnung |
|---|---|
| Automatisch weiterscrollen/blättern im Takt der Wiedergabe | Phase 16 |
| Standard-Zoom-Presets (Seitenbreite, ganze Seite, …) | Phase 16 |
| Taktangabe während der Probe dauerhaft sichtbar | Phase 16 |
| Vollbildmodus einer A4-Seite mit wenig Rand | Phase 16 (Vollbild/Skalierung), Phase 19 (Touch-Bedienung darin) |
| Bessere Markierung der aktuellen Position (Balken überdeckt Notentext) | Phase 16, mit vorgelagerter Messung M9 |
| Lautstärke einzelner Stimmen/Stimmgruppen | Phase 17 (Einzelstimmen gibt es seit Phase 9; neu sind Gruppen und das „meine Stimme"-Preset) |
| Loop-Felder zu schmal, Inhalt nicht lesbar | Phase 17 |
| Abspielgeschwindigkeit direkt in BPM | Phase 17, auf Basis von M8 |
| Sidecar-Bereitstellung jenseits von Docker | Phase 21 |
| MuseScore-Version im Sidecar aktuell halten | Phase 21 |
| Durchgängige Nutzbarkeit auf Mobilgeräten | Phase 19 |
| Notizen mit Stift auf dem Tablet | **nicht eingeplant**, siehe unten |
| Separate Android-/iOS-App | **nicht eingeplant**, siehe unten |

**Notizen mit Stift auf dem Tablet – warum nicht jetzt.** Das ist kein
Zusatz zu den Notizen aus Phase 11, sondern eine zweite Datenart: freie
Striche statt Text an einem Anker. Sie müssten an musikalischen Koordinaten
hängen, um ein Neurendern zu überleben (derselbe Grundsatz wie in Phase 11),
und ein Strich zieht sich über mehrere Noten – der Anker ist also kein Punkt
mehr, sondern ein Pfad. Diese Frage lässt sich seriös erst beantworten, wenn
Phase 19 gezeigt hat, wie sich das Notenbild auf einem Tablet überhaupt
anfühlt. Bleibt als Idee stehen.

**Separate Android-/iOS-App – warum nicht jetzt.** Der Bedarf dahinter ist
vermutlich nicht „eine native App", sondern „Noten offline und ohne
Browser-Umweg am Notenständer". Eine eigene App bedeutet eine zweite
Codebasis, eine zweite Wiedergabe, einen zweiten Renderer und zwei Stores –
für ein Ziel, das eine installierbare, offlinefähige Web-App womöglich
ebenfalls erreicht. Die Artefakte sind bereits unveränderlich und cachebar
(Phase 7), die Voraussetzungen dafür also günstig. Erst die Offline-Frage
aus Abschnitt 5 beantworten, dann neu bewerten.

**Was sonst noch bewusst nicht eingeplant ist:** der Korrektur-Layer
(Phase 13, weiterhin hinter Phase 21), ein zweites serverseitiges Layout für
echten Umbruch (Phase 16 nennt die Bedingung), sowie
Rechts-nach-links-Sprachen – bei DE + EN (E4) kein Thema, bei einer
Ausweitung des Sprachumfangs neu zu prüfen.
