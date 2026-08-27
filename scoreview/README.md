# ScoreView (Nextcloud-App)

Zeigt MuseScore-Partituren (`.mscz`) direkt aus Files an – als originalgetreue
MuseScore-Notation mit einem Wiedergabe-Cursor, der synchron zur clientseitig
synthetisierten MIDI-Wiedergabe mitläuft.

Dies ist das App-Paket. Projektüberblick, Anleitungen und Hintergrund stehen im
Repository: <https://github.com/AndiMb/scoreview>

## Kurz zur Einrichtung

Konvertiert wird auf einem von zwei gleichwertigen Wegen: über einen
**MuseScore-Sidecar** – einen Konvertierungsdienst als eigener Container neben
Nextcloud – oder **lokal** durch die Node.js-Laufzeit des Servers, für die
MuseScore als WebAssembly in `converter/` beiliegt. Einer der beiden muss
stehen, sonst läuft die App nicht.

```sh
occ app:enable scoreview
```

Danach unter **Einstellungen → Verwaltung → ScoreView** den Weg wählen: für den
Sidecar Adresse und Secret eintragen, für den lokalen Weg eine
SoundFont-Download-URL. Zwei einmalige Schritte fehlen dann noch: die
Mimetype-Registrierung für `.mscz` und Background-Jobs im Modus `cron`.

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

Die Dateien `appinfo/mimetypemapping.json` und `appinfo/mimetypealiases.json`
sind **Vorlage, keine wirksame Konfiguration**: Nextcloud lädt sie nicht aus
Apps. Ihr Inhalt gehört in die gleichnamigen Dateien unter `config/` des
Servers, siehe Installationsanleitung.

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
