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
Phase 15 (Bedienelemente auf `@nextcloud/vue`, E5), Phase 16
(Probentauglichkeit I: Autoscroll im Sichtband, dauerhafte Taktangabe,
Zoom-Presets, Vollbild) und Phase 17 (Probentauglichkeit II: Tempo in BPM,
lesbare Loop-Felder samt Bereichsmarkierung, Stimmgruppen/„meine Stimme"-
Preset, Metronom/Einzähler, Tastaturkürzel - dabei einen realen, seit Phase
9 unentdeckten Mixer-Bug gefunden und behoben, siehe dort) und Phase 18
(geteilte Notizen: an Dateirechten statt eigener Rechteverwaltung
festgemacht, 403 statt nur ausgeblendet bei fehlendem Schreibrecht, an drei
echten Konten mit unterschiedlichen Freigaben verifiziert) umgesetzt.
Phase 19 (Touch-Bedienung, Pinch-Zoom, Bildschirm-Wachhalten,
SoundFont-Ladefortschritt), Phase 20 (gemessene Grenzwerte, echter
SVG-Sanitizer statt Regex, Timeout-Default korrigiert) und Phase 21
(Sidecar-Selbsttest, Admin-Betriebsdiagnose inkl. Cron-Prüfung) sind
**teilweise** umgesetzt: die Abnahmen von 19 (echtes Tablet), 20
(Orchesterpartitur, D.C. aus der MuseScore-GUI, Klangurteil) und 21
(AppAPI-Verpackung) sind mangels Material bzw. Umfang ausdrücklich **offen**.
Phase 22 (Bedienfläche: eine Leiste außerhalb des Scrollbereichs statt zweier
mitscrollender, Mixer/Notizen als Overlay, Takt-Anzeige und -Eingabe in einem
schmalen Feld, zoomabhängiges Autoscroll, Zoom über die Seitenbreite hinaus,
Metronom auf jedem Schlag) ist umgesetzt und nachgemessen.
Aus dem Codereview vom 2026-08-23 (Phase 23, 24 Befunde) ist **Schritt 1**
umgesetzt: das Phase-2-Gerüst ist entfernt (die App hat damit keine eigene
Seite mehr – `/apps/scoreview/` antwortet 404, Einstieg ist ausschließlich
der Viewer aus Files), fünf überholte Kommentare sind korrigiert. Die
**Schritt 2** ebenfalls: ESLint und Stylelint nach Nextcloud-Standard, 32
PHPUnit-Tests gegen OCP-Mocks, 13 pytest-Tests für den Sidecar-Parser und
GitHub-Actions für CI und Release-Tarball – zusammen mit den 99 vitest-Tests
prüft jetzt für alle drei Sprachen des Repos etwas automatisch. **Schritt 3**
ebenfalls: das seit Nextcloud 29 veraltete `IConfig` ist durch `IAppConfig`
ersetzt (und damit typsicher), das Sidecar-Secret wird als sensibel geführt
und in `occ config:list` ausgeblendet, und die Administrationsseite ist eine
Vue-Komponente auf `@nextcloud/vue` statt 163 Zeilen handgeschriebenem DOM.
**Schritt 4** ebenfalls, die fünf Befunde mit Außenwirkung: die CSP-Lockerung
für die Audio-Dekodierung galt instanzweit und gilt jetzt nur noch auf
Files-Seiten; eine fehlgeschlagene Seitenladung ist sichtbar und
wiederholbar statt endgültig; ein Klick abseits der Noten springt nicht mehr
(und ein Wischen auf dem Tablet erst recht nicht); Cache und Notizen
gelöschter Dateien und Konten werden aufgeräumt – die Notizen bewusst erst,
wenn die Datei auch aus dem Papierkorb verschwunden ist; und zu große
Partituren werden mit eigenem Fehlercode abgelehnt statt in einen Speicher-
oder Timeout-Fehler zu laufen. **Schritt 5** ebenfalls: der Sidecar ist aus
einer 515-Zeilen-Datei ein Paket geworden (`scoreview_sidecar`), läuft hinter
gunicorn statt Flasks Entwicklungsserver, begrenzt gleichzeitige
Konvertierungen (Standard 2 – vorher unbegrenzt) und liefert alle Artefakte
über eine Route statt über fünf fast gleiche. Die Schritte 6–7 (Zerlegung von
`ScoreViewer.vue`, Feinschliff) stehen mit Reihenfolge und Begründung in
`PLAN.md`.
Siehe `PLAN.md` für den vollständigen Stand inklusive offener Punkte.

**Vorausgesetzt:** ein erreichbarer MuseScore-Sidecar (siehe `sidecar/`) -
die App läuft nicht ohne ihn (E3 in `PLAN.md`).

## Repo-Layout

- `spike/` – Wegwerfcode aus Phase 1 (isolierter Sync-Spike, historisch) plus
  `spike/test-scores/` mit lokalen Testpartituren (nicht committet, bis auf
  eine selbst komponierte Ausnahme - siehe dortige README).
- `sidecar/` – MuseScore-CLI-Docker-Image + HTTP-API (Paket
  `scoreview_sidecar`, hinter gunicorn). Läuft als
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
