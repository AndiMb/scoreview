# Changelog

Alle nennenswerten Änderungen an ScoreView. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

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
- Wiedergabe-Cursor, der synchron mitläuft, und ein Klick auf eine Note springt
  dorthin.
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
