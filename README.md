# ScoreView

Nextcloud-App, die `.mscz`-Partituren (MuseScore) einmalig serverseitig über
einen MuseScore-Sidecar konvertiert (SVG-Seiten + MIDI + Timing-Daten,
siehe `PLAN.md` E1/E2), das Ergebnis cached und beim Öffnen aus Files als
Notation mit synchronisiertem Wiedergabe-Cursor anzeigt (ähnlich
musescore.com), statt bei jedem Aufruf neu zu rendern. Die Audiowiedergabe
passiert clientseitig im Browser (MIDI-Synthese über ein SoundFont, das die
App aus dem Sidecar ausliefert - ohne Konfiguration), nicht als
vorgerendertes MP3.

**Status: Prototyp.** Phasen 1–11 des Implementierungsplans (`PLAN.md`) sind
umgesetzt: Konvertierungs-Pipeline, Cache/Auslieferung, SVG-Viewer mit
Overlay-Cursor, Wiedergabe/Tempo/Mixer, Taktnavigation/Loop/Zoom/Klick-auf-
Note, private Notizen. Phase 12 (Betrieb/Härtung - AppAPI-Verpackung,
Sandboxing, Admin-Health-UI) ist teilweise umgesetzt (non-root
Sidecar-Prozess); Phase 13 (Korrektur-Layer) ist bewusst zurückgestellt.
Aus der zweiten Planungsrunde (Phasen 14-21) sind Phase 14
(Mehrsprachigkeit DE+EN, verständliche Konvertierungsfehler über
`error_code`, `format_version` für einen künftigen Cache-Formatwechsel),
Phase 15 (Bedienelemente auf `@nextcloud/vue`, E5) und Phase 16
(Probentauglichkeit I: Autoscroll im Sichtband, dauerhafte Taktangabe,
Zoom-Presets, Vollbild) umgesetzt. Siehe `PLAN.md` für den vollständigen
Stand inklusive offener Punkte.

**Vorausgesetzt:** ein erreichbarer MuseScore-Sidecar (siehe `sidecar/`) -
die App läuft nicht ohne ihn (E3 in `PLAN.md`).

## Repo-Layout

- `spike/` – Wegwerfcode aus Phase 1 (isolierter Sync-Spike, historisch) plus
  `spike/test-scores/` mit lokalen Testpartituren (nicht committet, bis auf
  eine selbst komponierte Ausnahme - siehe dortige README).
- `sidecar/` – MuseScore-CLI-Docker-Image + HTTP-API (`server.py`). Läuft als
  eigenständiger Container neben Nextcloud, ist nicht Teil des App-Pakets.
  Siehe `sidecar/README.md` für Betrieb, API und Sicherheitshinweise.
- `scoreview/` – die eigentliche Nextcloud-App, Layout analog zu bestehenden
  Nextcloud-Apps (`appinfo/`, `lib/`, `src/`, `js/`, `templates/`, `tests/`,
  `img/`, `l10n/`). Bei einer Veröffentlichung wird nur dieses Verzeichnis
  als Release-Tarball gepackt.
- `PLAN.md` – Umsetzungsplan mit Architekturentscheidungen (E1-E3),
  verifizierter Faktenbasis (M1-M7) und Phasenstatus. Erste Anlaufstelle für
  „warum ist das so gebaut" und „was ist noch offen".

## Lizenz

AGPL-3.0-or-later, siehe [LICENSE](LICENSE).
