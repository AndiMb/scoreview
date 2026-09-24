# ScoreView (Nextcloud-App)

Zeigt MuseScore-Partituren (`.mscz`) direkt aus Files an – als originalgetreue
MuseScore-Notation mit einem Wiedergabe-Cursor, der synchron zur clientseitig
synthetisierten MIDI-Wiedergabe mitläuft.

Dies ist das App-Paket. Projektüberblick, Anleitungen und Hintergrund stehen im
Repository: <https://github.com/AndiMb/scoreview>

## Kurz zur Einrichtung

Konvertiert wird auf einem von zwei gleichwertigen Wegen: **lokal** durch die
Node.js-Laufzeit des Servers (ab Version 18), für die MuseScore als
WebAssembly in `converter/` beiliegt – das ist die Voreinstellung –, oder über
einen **MuseScore-Sidecar**, einen Konvertierungsdienst als eigener Container
neben Nextcloud. Kann der Server keinen von beiden ausführen, konvertiert
ersatzweise der Browser der Nutzerin.

```sh
occ app:enable scoreview
```

Für den lokalen Weg ist danach nichts einzustellen; das SoundFont holt der
Server beim ersten Abspielen selbst. Wer den Sidecar nutzt, wählt ihn unter
**Einstellungen → Verwaltung → ScoreView** und trägt Adresse und Secret ein.
Den Mimetype für `.mscz` trägt die App selbst ein; einmalig nötig bleibt nur,
dass Background-Jobs im Modus `cron` laufen.

**Vollständige Anleitung:**
<https://github.com/AndiMb/scoreview/blob/master/docs/installation.md>

Wenn etwas klemmt, führt die Betriebsdiagnose auf der Verwaltungsseite meist
schon zur Ursache; sonst hilft
<https://github.com/AndiMb/scoreview/blob/master/docs/troubleshooting.md>.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `lib/` | PHP: Controller, Services, Background-Jobs, Listener, Migrationen |
| `converter/` | Lokaler Konvertierungsweg: MuseScore als WebAssembly unter Node |
| `src/` | Vue 3: Viewer, Composables und die reine Logik unter `src/lib/` |
| `js/` | Build-Artefakte (`npm run build`), nicht im Repository |
| `l10n/` | Übersetzungen; Quellstrings sind Englisch |
| `templates/`, `img/`, `appinfo/` | Nextcloud-Standardlayout |
| `tests/` | PHPUnit gegen OCP-Mocks |
| `tools/` | Prüfung und Extraktion der Übersetzungen (`npm run l10n:extract`) |

Die Dateien `appinfo/mimetypemapping.json` und `appinfo/mimetypealiases.json`
sind **Vorlage, keine wirksame Konfiguration**: Nextcloud lädt sie nicht aus
Apps. Den Mimetype trägt die App trotzdem selbst ein
(`lib/Service/MimetypeRegistration.php`); die Vorlagen braucht nur noch, wer
zusätzlich das Dateisymbol und die Erkennung beim Upload will – siehe
Installationsanleitung.

## Entwicklung

```sh
npm ci && npm run build     # Pflicht nach jeder Änderung unter src/
npm test                    # vitest
composer install
composer run test:unit      # PHPUnit
```

Ausführlich:
<https://github.com/AndiMb/scoreview/blob/master/docs/development.md>

## Lizenz

AGPL-3.0-or-later, siehe [LICENSE](LICENSE).
