# Changelog

Alle nennenswerten Änderungen an ScoreView. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt

- **Der klingende Notenkopf wird eingefärbt**, statt nur von einem Band
  überdeckt zu werden. Möglich wurde das durch webmscore
  `v4.7.4-scoreview.7`: MuseScores SVG-Export schreibt jetzt zu jedem
  gezeichneten Element, zu welchem Segment, welcher Notenzeile und welcher
  Stimme es gehört – und die Segmentnummer ist dieselbe, die `timing.json`
  vergibt (M10). Das Band tritt dafür zurück, sobald Notenköpfe leuchten –
  zwei Anzeigen derselben Stelle sind eine zu viel. Auf dem Sidecar-Weg
  (Stock-MuseScore ohne den Patch) bleibt es unverändert beim Band.
- Ein zweiter Einstieg in den Viewer: eine Dateiaktion auf der Endung `.mscz`,
  die eine Partitur in einem eigenen Vollbildfenster öffnet. Sie greift genau
  dann, wenn Nextclouds Viewer es nicht tut – wenn der Mimetype nicht
  registriert ist oder eine vorhandene Datei noch nicht neu eingelesen wurde.
  Damit ist die App auch dort benutzbar, wo niemand `occ` ausführen kann.

### Geändert

- **Der lokale Konvertierungsweg läuft jetzt auf der
  [scoreview-engine](https://github.com/AndiMb/scoreview-engine)**
  (`v4.7.4-engine.2`) statt auf dem Qt-webmscore-Fork: derselbe
  MuseScore-Kern 4.7.4, aber Qt-frei gebaut (MuseScore als ungepatchtes,
  gepinntes Submodul). Halber Wasm-Fußabdruck (9 statt 17,5 MB), rund
  dreimal schnellere Konvertierung, und die `duration` in den Metadaten
  entspricht jetzt der von Desktop-MuseScore (webmscore meldete sie aus
  einem veralteten Zwischenstand). Die Engine ist korpus-geprüft: 569
  Testpartituren gegen das Qt-webmscore-Release und gegen
  Desktop-MuseScore 4.7.4, jede Abweichung einzeln begründet. Text steht
  im SVG jetzt als referenzierte Glyph-Umrisse (`<defs>`/`<use>`, etwa
  halbe Dateigröße); der SVG-Sanitizer des Viewers lässt genau diese
  lokale Referenzform zu – Nebenbefund dabei: seine Allowlists waren
  wegen `USE_PROFILES` bisher wirkungslos, jetzt gelten sie wirklich.
  Die Notenkopf-Lageprobe des Selbsttests liest beide Glyph-Formen.
- Der lokale Konvertierungsweg läuft auf webmscore `v4.7.4-scoreview.6`:
  derselbe MuseScore-Kern 4.7.4, aber gegen Qt 6.10.2 mit Emscripten 4.0.7
  gebaut statt gegen Qt 6.4.3 mit Emscripten 3.1.14. Am Ergebnis ändert sich
  nichts – der Selbsttest über M2/M4/M7 bleibt grün, auf Node 18, 20 und 22.
- Der Konverter legt unter Node 18 und 20 ein `navigator` mit `languages` an:
  Das globale `navigator` bringt Node erst ab Version 21 mit, und MuseScores
  Qt-Schicht liest es beim Start. Ohne das startet das Wasm-Modul dort nicht.

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
