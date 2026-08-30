# Changelog

Alle nennenswerten Änderungen an ScoreView. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt

- **Partituren mit eingebetteten Bildern lassen sich auch auf dem lokalen
  Konvertierungsweg öffnen.** Bisher lehnte die App sie dort ab, bevor die
  Konvertierung überhaupt begann: Die scoreview-engine stürzte an so einer
  Partitur schon beim Laden ab, und der Viewer riet auf den Sidecar-Container
  auszuweichen. Die Engine setzt Bilder jetzt selbst – sie legt die
  Originalbytes als Daten-URI in die Seite, die sie trägt. Erkannt werden PNG,
  JPEG, GIF und BMP; zu den beiden Formaten, die dabei leer bleiben, siehe
  [Grenzwerte](docs/limits.md#bekannte-lücken). Ein alter Fehlerdatensatz
  bleibt stehen, bis die Partitur neu konvertiert wird – dafür gibt es den
  Knopf unten. Der Absturz war als
  [scoreview-engine#3](https://github.com/AndiMb/scoreview-engine/issues/3)
  gemeldet.

- **„Neu konvertieren" im Viewer** – im Aufklapper der Anzeigeeinstellungen,
  direkt unter der Angabe, womit die Seiten gesetzt wurden. Eine einmal fertige
  Konvertierung bleibt sonst liegen, solange niemand die Datei anfasst: Eine
  App-Fassung, die besser setzt, erreichte bestehende Partituren bisher nur
  über ein Hochzählen der Cache-Formatversion – das trifft jede Partitur der
  Instanz statt der einen, um die es geht. Der Knopf verwirft die gespeicherte
  Konvertierung samt Cache-Ordner und lässt sie neu erzeugen; er erscheint nur
  dort, wo Schreibrecht auf die Datei besteht, denn der Cache hängt an der
  Datei und gilt für alle, die sie öffnen.

- **Die Hervorhebung der klingenden Stelle lässt sich einstellen** – Form und
  Farbe, je Nutzerin gespeichert und damit auf jedem Gerät dieselbe. Zur Wahl
  stehen die eingefärbten Notenköpfe oder ein Band an der klingenden Stelle,
  dazu sechs Farbvorschläge und ein freier Farbwähler. Voreingestellt ist jetzt
  ein kräftiges Rot statt des bisherigen Blaus: Blau war aus
  Notenständer-Entfernung kaum auszumachen, und das Band war zusätzlich so
  blass, dass es auf hellen Bildschirmen unterging.
- **Der Viewer sagt, womit die angezeigten Seiten gesetzt wurden** – im selben
  Aufklapper: der Konvertierungsweg (Sidecar-Container oder scoreview-engine
  auf dem Server) und, getrennt davon, die MuseScore-Version, mit der die
  Partitur geschrieben wurde. Aufgezeichnet wird der Weg beim Konvertieren, denn
  die Admin-Einstellung sagt nur, was *jetzt* gilt – eine vor einem Wechsel
  konvertierte Partitur stammt weiterhin vom alten Weg. Vor dieser Fassung
  konvertierte Partituren melden „unbekannt", bis sie neu konvertiert werden.
- **Der klingende Notenkopf wird eingefärbt**, statt nur von einem Band
  überdeckt zu werden. Der SVG-Export der scoreview-engine schreibt zu jedem
  gezeichneten Element, zu welchem Segment, welcher Notenzeile und welcher
  Stimme es gehört – und die Segmentnummer ist dieselbe, die `timing.json`
  vergibt (M10). Das Band tritt dafür zurück, sobald Notenköpfe leuchten –
  zwei Anzeigen derselben Stelle sind eine zu viel. Auf dem Sidecar-Weg bleibt
  es unverändert beim Band: MuseScore selbst schreibt diese Kennungen nicht.
- Ein zweiter Einstieg in den Viewer: eine Dateiaktion auf der Endung `.mscz`,
  die eine Partitur in einem eigenen Vollbildfenster öffnet. Sie greift genau
  dann, wenn Nextclouds Viewer es nicht tut – wenn der Mimetype nicht
  registriert ist oder eine vorhandene Datei noch nicht neu eingelesen wurde.
  Damit ist die App auch dort benutzbar, wo niemand `occ` ausführen kann.

### Behoben

- **Eine nicht erreichbare SoundFont-Quelle endete als Serverfehler statt als
  Hinweis.** Der Auslieferungs-Endpunkt fing die falsche Ausnahmeklasse: Er
  fing `SidecarException`, die Beschaffung über eine konfigurierte
  `soundfont_fetch_url` wirft aber deren Basisklasse `ConverterException`.
  Damit lief genau der Fall ins Leere, für den es diese Einstellung überhaupt
  gibt – erste Wiedergabe auf dem lokalen Konvertierungsweg, Quelle nicht
  erreichbar, nichts im Cache: Statt der gemeinten 503-Antwort mit lesbarer
  Meldung, die der Viewer anzeigt, während er ohne Ton benutzbar bleibt, kam
  ein nackter 500, und die Warnung landete nicht einmal im Log. Der
  Sidecar-Weg war nicht betroffen. Der Endpunkt fängt jetzt die Basisklasse,
  wie es die Hintergrundjobs schon taten.
- **Eine präparierte Partitur konnte über das `style`-Attribut eine fremde
  Adresse ins Notenbild holen.** Der Sanitizer verbietet das
  `<style`-*Element* ausdrücklich damit, dass ein `url(...)` darin externe
  Ressourcen zieht und so den Aufruf verrät – dieselbe Schreibweise stand
  jedoch im gleichnamigen *Attribut* offen, das die Allowlist braucht.
  DOMPurify parst kein CSS, `style="fill:url(http://…)"` blieb also
  wortgleich stehen. Ein tatsächlicher Abruf war dabei nicht nachweisbar
  (Browser lösen externe SVG-Paint-Server nicht auf, und Nextclouds
  `img-src` griffe ohnehin) – die Allowlist gab aber eine Zusage, die sie
  nicht einhielt. `url(...)` ist im Attribut jetzt auf lokale
  `#`-Fragmente beschränkt.
- **Eine neu konvertierte Partitur blieb im Browser die alte.** Die
  Auslieferungsrouten der Artefakte versprachen `immutable` – dass sich unter
  dieser URL nie etwas ändert –, trugen den Cache-Schlüssel aber gar nicht in
  der URL: der etag stand nur im serverseitigen Cache-Pfad. Nach einer
  Neukonvertierung, und ebenso nach einer Bearbeitung der `.mscz`, zeigte der
  Browser deshalb weiter die alten Seiten; Neuladen half nicht, weil Chrome
  Unterressourcen dabei nicht revalidiert und `immutable` es ausdrücklich
  verbietet. Sichtbar wurde die neue Fassung erst nach hartem Neuladen oder in
  einem frischen Profil. Die URLs tragen jetzt etag und Zeitstempel der
  Konvertierung.
- **Auf dem lokalen Konvertierungsweg war die Hervorhebung unsichtbar.** Zwei
  Ursachen, beide seit der Umstellung auf die scoreview-engine: Die Engine
  hängt die Segmentkennung an eine Gruppe statt an das gezeichnete Element, und
  das `fill`-Attribut am Glyph gewann gegen die geerbte Farbe – die Notenköpfe
  blieben schwarz. Zugleich malt sie einen weißen Hintergrundpfad ohne
  `class`-Attribut, den die bisherige Regel nicht erwischte; er deckte das Band
  vollständig zu. Beides ist jetzt für beide Konvertierungswege geregelt.
- **Beim Blättern zeigte die folgende Seite Buchstaben und Ziffern statt
  Noten.** Die scoreview-engine legt jede Glyphe einmal als `<path id="g0">`
  ab und verweist rund 1200-mal je Seite darauf – die Nummerierung beginnt aber
  auf jeder Seite wieder bei Null. Solche Verweise löst der Browser im ganzen
  Dokument auf, nicht innerhalb der eigenen Seite, und der Viewer hält beim
  Scrollen mehrere Seiten gleichzeitig geladen: Die neue Seite griff deshalb
  auf die gleichnamigen Glyphen der vorherigen zu. Der Satz reparierte sich
  scheinbar von selbst, sobald die vorherige Seite weit genug entfernt und
  freigegeben war. Die Kennungen werden jetzt beim Einbetten je Seite eindeutig
  gemacht. Betroffen war nur der lokale Weg; der Sidecar schreibt gar keine
  Kennungen.
- **Partituren aus MuseScore 1 bis 3 wurden mit den Stilvorgaben von
  MuseScore 4 gesetzt.** Die scoreview-engine lieferte die Vorgaben nicht mit,
  die MuseScore für ältere Dateien lädt – im Log stand `failed load style:
  legacy-style-defaults-v2.mss`, im Notenbild ein Satz, der nicht der seiner
  Zeit war. Gegen echtes MuseScore 4 geprüft: Eine MuseScore-2-Datei wird dort
  6 Seiten und wurde hier 5; jetzt sind es auf beiden Seiten 6. Ein
  MuseScore-3-Export derselben Partitur behält seine vier Seiten, setzt sie
  aber anders – und trifft damit MuseScores Bild. Die Vorgaben liegen jetzt im
  Ressourcenpaket der Engine. Eine Ersatzschrift bleibt – siehe
  [Grenzwerte](docs/limits.md#bekannte-lücken). Bereits konvertierte alte
  Partituren behalten ihr Bild, bis sie neu konvertiert werden.
- **Fehlermeldungen des lokalen Konverters nannten einen Stack-Frame statt der
  Ursache.** Gesucht wurde die letzte nicht leere Zeile der Fehlerausgabe – bei
  einem Node-Stacktrace ist das immer ein `at …`-Frame, die Meldung steht
  darüber. Jetzt steht die Ursache in der Oberfläche.
- **Ein Fehlerzustand blieb unübersetzt.** `local_unavailable` – der lokale
  Weg ist eingestellt, aber nicht lauffähig – hatte im Viewer keinen eigenen
  Satz und erschien als „unbekannter Fehler".

### Geändert

- **Der lokale Konvertierungsweg läuft jetzt auf der
  [scoreview-engine](https://github.com/AndiMb/scoreview-engine)**
  (`v4.7.4-engine.2`): derselbe MuseScore-Kern 4.7.4, aber Qt-frei gebaut
  (MuseScore als ungepatchtes, gepinntes Submodul). Halber Wasm-Fußabdruck
  (9 statt 17,5 MB), rund dreimal schnellere Konvertierung, und die
  `duration` in den Metadaten entspricht jetzt der von Desktop-MuseScore –
  bisher stammte sie aus einem veralteten Zwischenstand. Die Engine ist
  korpus-geprüft: 569 Testpartituren gegen die bisherige Ausgabe, jede
  Abweichung gegen Desktop-MuseScore 4.7.4 geprüft und einzeln begründet.
  Text steht im SVG jetzt als referenzierte Glyph-Umrisse (`<defs>`/`<use>`,
  etwa halbe Dateigröße); der SVG-Sanitizer des Viewers lässt genau diese
  lokale Referenzform zu – Nebenbefund dabei: seine Allowlists waren
  wegen `USE_PROFILES` bisher wirkungslos, jetzt gelten sie wirklich.
  Die Notenkopf-Lageprobe des Selbsttests liest beide Glyph-Formen.
- Das App-Paket wird rund 5 MB kleiner, und die Zusatzfonts für CJK-Liedtexte
  werden wieder gelesen: Die Engine (`v4.7.4-engine.3`) bringt einen
  Brotli-Decoder mit, liefert ihre eigenen Schriften als woff2 aus (4,8 statt
  9,3 MB) und nimmt `.woff2` auch aus `cjk_font_dir` entgegen.

## [1.0.0] – 2026-08-26

Erste öffentliche Fassung.

### Notendarstellung

- MuseScores eigener SVG-Satz statt eines Neusatzes im Browser: Das Seitenbild
  entspricht dem, was MuseScore selbst druckt.
- Zoom ohne Qualitätsverlust, Zoom-Presets, Vollbild, Autoscroll im Sichtband,
  dauerhaft sichtbare Taktangabe.
- Nur sichtbare Seiten liegen im DOM; weggescrollte werden wieder freigegeben.

### Wiedergabe

- MIDI wird im Browser synthetisiert, gegen ein SoundFont, das die App selbst
  ausliefert – ohne Konfiguration und ohne fremden Host.
- Wiedergabe-Cursor, der synchron mitläuft – ein schmales Band je Notenzeile
  hinter den klingenden Noten statt eines Balkens über das ganze System.
- Ein Klick auf eine Note springt dorthin.
- Tempo in BPM, Mixer mit Lautstärke, Mute und Solo je Stimme, „meine
  Stimme"-Preset.
- Metronom auf jedem Schlag oder nur auf dem Taktanfang, Einzähler vor dem
  Start.
- Taktnavigation, Loop über einen Taktbereich mit Markierung im Notenbild,
  Tastaturkürzel.

### Notizen

- Text an einer musikalischen Position (Takt und Anteil im Takt), nicht an
  Pixelkoordinaten – Notizen überstehen ein Neurendern und einen Re-Upload
  derselben Partitur.
- Privat oder geteilt; geteilte Notizen hängen an den Dateirechten, nicht an
  einer eigenen Rechteverwaltung.
- **Auf Wunsch direkt im Notenbild** über dem zugehörigen System, statt nur im
  Panel: „In Takt 10 bitte forte" ist damit beim Singen lesbar, ohne etwas
  aufzuklappen. Mehrere Notizen am selben Takt stapeln sich, statt sich zu
  überlagern.

### Die eigene Stimme

- Wer im Mixer „meine Stimme" wählt, bekommt sie **auch im Notenbild markiert** –
  ein durchgehender Streifen unter der eigenen Zeile, das Gegenstück zum
  Buntstiftstrich.
- **„Nur meine Zeile"** nimmt die übrigen Stimmen zurück, statt sie zu
  entfernen: Das Seitenbild bleibt dasselbe (kein Reflow, E2), die
  Nachbarstimmen sind zur Orientierung noch schemenhaft da.
- Beides erscheint nur, wenn sich die Notenzeilen den Stimmen zweifelsfrei
  zuordnen lassen. Bei einem Klavierauszug oder einer Partitur mit
  ausgeblendeten leeren Zeilen bleibt es aus – eine falsche Markierung wäre
  schlimmer als keine.

### Betrieb

- **Zwei Konvertierungswege zur Wahl**, die dieselben Artefakte erzeugen: der
  Sidecar-Container mit echtem MuseScore 4, oder – ohne Container – MuseScore
  als WebAssembly, ausgeführt von der Node-Laufzeit des Servers. Siehe
  [E3](docs/architecture.md#e3-zwei-konvertierungswege-hinter-einer-api).
- Cache je `(fileId, etag)`, unveränderlich ausgeliefert; ein
  Cache-Formatwechsel invalidiert sich über `format_version` selbst.
- Betriebsdiagnose und Selbsttest auf der Verwaltungsseite – für beide
  Konvertierungswege, mit denselben Prüfungen.
- Aufräumjob für Cache und Notizen gelöschter Dateien und Konten.
- Verständliche Konvertierungsfehler mit Fehlercode statt roher Ausgaben.

### Oberfläche

- Touch-Bedienung mit Pinch-Zoom und Wachhalten des Bildschirms, für das Tablet
  am Notenständer.
- Deutsch und Englisch, Vollständigkeit der Übersetzungen durch einen Test
  abgesichert.

### Bekannt offen

Siehe [docs/limits.md](docs/limits.md) – insbesondere D.C./D.S./Coda-Sprünge,
Orchesterpartituren, Offlinebetrieb und die Verpackung als AppAPI/ExApp.

[Unveröffentlicht]: https://github.com/AndiMb/scoreview/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AndiMb/scoreview/releases/tag/v1.0.0
