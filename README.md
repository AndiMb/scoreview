# ScoreView

Nextcloud-App, die MuseScore-Partituren direkt aus Files anzeigt und im Browser
abspielt – als originalgetreue MuseScore-Notation mit einem Wiedergabe-Cursor,
der synchron mitläuft, statt als starrer PDF-Export.

Gedacht für Chor- und Ensemblearbeit: Die Noten sehen aus wie die eigenen Noten,
jede Stimme ist einzeln hörbar, und jeder Takt ist in einem Klick erreichbar.

## Was die App kann

**Noten lesen.** MuseScores eigenes Seitenbild als Vektorgrafik – Zoom ohne
Qualitätsverlust, Zoom-Presets, Vollbild, und ein Autoscroll, das den laufenden
Takt im Sichtband hält.

**Hören, was man üben will.** Die Wiedergabe wird im Browser synthetisiert, nicht
als fertiges MP3 abgespielt. Deshalb lässt sich pro Stimme die Lautstärke regeln,
stummschalten und solo hören, das Tempo in BPM ändern und ein Metronom
zuschalten – auf jedem Schlag oder nur auf dem Taktanfang. „Meine Stimme" hebt
eine Stimme hervor und lässt die übrigen leise mithörbar.

**Gezielt proben.** Taktnavigation mit dauerhaft sichtbarer Taktangabe, ein Loop
über einen frei gewählten Taktbereich mit Markierung im Notenbild, und ein Klick
auf eine Note springt genau dorthin.

**Notizen machen.** Privat oder mit allen geteilt, die die Datei sehen. Sie
hängen an einer musikalischen Position statt an Pixeln und überstehen deshalb
ein Neurendern und einen Re-Upload derselben Partitur.

**Auf dem Tablet am Notenständer.** Touch-Bedienung, Pinch-Zoom und ein
Bildschirm, der während der Wiedergabe nicht schlafen geht.

Tastatur im Viewer: `Leertaste` Start/Stopp · `←` `→` Takt zurück/vor · `L` Loop
· `+` `−` Zoom · `0` Seitenbreite.

Oberfläche auf Deutsch und Englisch.

## Wie es funktioniert

Eine hochgeladene `.mscz`-Datei wird **einmalig** serverseitig konvertiert –
über einen MuseScore-Sidecar zu Notenseiten (SVG), MIDI und Timing-Daten – und
das Ergebnis gecacht. Erneutes Öffnen rendert nicht neu; erst eine Änderung an
der Datei stößt eine neue Konvertierung an. Die Audiowiedergabe passiert
clientseitig im Browser, mit einem SoundFont, das die App ohne Konfiguration
selbst ausliefert.

Ausführlich in [docs/architecture.md](docs/architecture.md).

## Voraussetzungen

- Nextcloud 31–35, PHP 8.1–8.5
- Ein erreichbarer **MuseScore-Sidecar** (in `sidecar/` enthalten, läuft als
  eigener Container). Die App läuft nicht ohne ihn – warum, steht unter
  [E3](docs/architecture.md#e3-der-sidecar-ist-voraussetzung). Auf
  SaaS-gehosteten Nextcloud-Instanzen ist ScoreView damit nicht installierbar.

## Installation

```sh
# 1. Konvertierungsdienst bauen und starten
docker build -t scoreview-musescore-cli sidecar/
docker network create scoreview-net
docker network connect scoreview-net <nextcloud-container>
docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET="$(openssl rand -hex 32)" \
  --memory=2g --pids-limit=512 scoreview-musescore-cli

# 2. App aktivieren
occ app:enable scoreview
```

Danach unter **Einstellungen → Verwaltung → ScoreView** die Sidecar-Adresse und
das Secret eintragen. Es fehlen noch zwei einmalige Schritte – die
Mimetype-Registrierung für `.mscz` und Background-Jobs im Modus `cron`:
**[vollständige Anleitung](docs/installation.md)**.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [Installation und Konfiguration](docs/installation.md) | Einrichtung Schritt für Schritt, Einstellungen, Aktualisieren |
| [Architektur](docs/architecture.md) | Aufbau, Entwurfsentscheidungen, Datenfluss, Formatgrundlagen |
| [Grenzwerte und Einschränkungen](docs/limits.md) | Gemessene Werte, bekannte Lücken, was die App bewusst nicht tut |
| [Troubleshooting](docs/troubleshooting.md) | Fehlerbilder und was hilft |
| [Entwicklung](docs/development.md) | Bauen, testen, Konventionen, Release |
| [Sidecar](sidecar/README.md) | Betrieb und HTTP-API des Konvertierungsdienstes |

## Mitarbeiten

Siehe [CONTRIBUTING.md](CONTRIBUTING.md). Fehler und Wünsche gehören in die
[Issues](https://github.com/AndiMb/scoreview/issues).

## Lizenz

AGPL-3.0-or-later, siehe [LICENSE](LICENSE).

Das mitgelieferte SoundFont stammt aus der MuseScore-Installation im
Sidecar-Image (MuseScore General von S. Christian Collins, MIT).
