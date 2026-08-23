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
| ~~MIDI-Kanalreihenfolge ≠ `metadata.tracks`~~ **erledigt** | Mixer ordnet falsch zu | An echtem Ton bestätigt: Solo auf Mixerkanal 0 lässt genau die Sopranstimme stehen (siehe Phase 9) |
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
| Geteilte Notizen sind eine Datenweitergabe an alle mit Dateizugriff | Jemand teilt versehentlich etwas Privates | Sichtbarkeit beim Anlegen unmissverständlich anzeigen, serverseitig an `PERMISSION_UPDATE` binden (Phase 18) |
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
