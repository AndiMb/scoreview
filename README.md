# ScoreView

Nextcloud-App, die `.mscz`-Partituren (MuseScore) einmalig serverseitig zu
MusicXML + Audio + Timing-Daten konvertiert, das Ergebnis cached und beim
Öffnen aus Files als Notation mit synchronisiertem Wiedergabe-Cursor anzeigt
(ähnlich musescore.com), statt bei jedem Aufruf neu zu rendern.

**Status: Prototyp in Arbeit.** Aktuell befinden wir uns in Phase 1 des
Implementierungsplans (isolierter Sync-Spike), der das größte technische
Risiko klärt, bevor App-Code entsteht.

## Repo-Layout

- `spike/` – Wegwerfcode aus Phase 1: validiert, ob MuseScores `.spos`/`.mpos`-
  Timing-Export zuverlässig einen [OSMD](https://opensheetmusicdisplay.org/)-
  Cursor synchron zur Audiowiedergabe treiben kann.
- `sidecar/` – MuseScore-CLI-Docker-Image + (ab Phase 3) HTTP-API. Läuft als
  eigenständiger Container neben Nextcloud, ist nicht Teil des App-Pakets.
- `scoreview/` – die eigentliche Nextcloud-App (ab Phase 2), Layout analog zu
  bestehenden Nextcloud-Apps (`appinfo/`, `lib/`, `src/`, `js/`, `templates/`,
  `tests/`, `img/`, `l10n/`). Bei einer Veröffentlichung wird nur dieses
  Verzeichnis als Release-Tarball gepackt.

## Lizenz

AGPL-3.0-or-later, siehe [LICENSE](LICENSE).
