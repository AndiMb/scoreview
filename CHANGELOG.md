# Changelog

Alle nennenswerten Änderungen an ScoreView. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

## [0.0.24]

Erster Stand, der als vollständige App dokumentiert ist. Die Entwicklung davor
ist nicht in einzelne Einträge aufgelöst; sie steht in der Git-Historie und im
archivierten Umsetzungsplan (`docs/history/plan.md`).

### Enthalten

- **Notendarstellung** aus MuseScores eigenem SVG-Satz: Zoom ohne
  Qualitätsverlust, Zoom-Presets, Vollbild, Autoscroll im Sichtband, dauerhaft
  sichtbare Taktangabe.
- **Wiedergabe im Browser** über MIDI und ein mitgeliefertes SoundFont – ohne
  Konfiguration, mit sichtbarem Ladefortschritt. Tempo in BPM, Mixer mit
  Lautstärke, Mute und Solo je Stimme, „meine Stimme"-Preset, Metronom auf jedem
  Schlag oder nur auf dem Taktanfang, Einzähler vor dem Start.
- **Navigation**: Taktnavigation, Loop über einen Taktbereich mit Markierung im
  Notenbild, Klick auf eine Note springt dorthin, Tastaturkürzel.
- **Notizen** an musikalischen Ankern, privat oder geteilt; geteilte Notizen
  hängen an den Dateirechten, nicht an einer eigenen Rechteverwaltung.
- **Touch-Bedienung** mit Pinch-Zoom und Wachhalten des Bildschirms.
- **Cache** je `(fileId, etag)`, unveränderlich ausgeliefert; ein
  Cache-Formatwechsel invalidiert sich über `format_version` selbst.
- **Betrieb**: Betriebsdiagnose und Sidecar-Selbsttest auf der
  Verwaltungsseite, Aufräumjob für Cache und Notizen gelöschter Dateien und
  Konten, verständliche Konvertierungsfehler mit Fehlercode.
- **Sidecar** als eigenes Paket hinter gunicorn, non-root, mit begrenzter
  Nebenläufigkeit und einer Auslieferungsroute für alle Artefakte.
- **Oberfläche auf Deutsch und Englisch**, Vollständigkeit der Übersetzungen
  durch einen Test abgesichert.

### Bekannt offen

Siehe [docs/limits.md](docs/limits.md) – insbesondere D.C./D.S./Coda-Sprünge,
Orchesterpartituren, Offlinebetrieb und die Verpackung als AppAPI/ExApp.

[Unveröffentlicht]: https://github.com/AndiMb/scoreview/compare/v0.0.24...HEAD
[0.0.24]: https://github.com/AndiMb/scoreview/releases/tag/v0.0.24
