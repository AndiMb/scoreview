# Test-Partituren (nicht committet)

Dieses Verzeichnis enthält lokale `.mscz`-Testpartituren für den Phase-1-
Spike. Sie sind absichtlich in `.gitignore` ausgeschlossen (`*.mscz` etc.
unter `spike/test-scores/`), weil ihre Lizenzlage nicht sicher gemeinfrei
ist - **nicht stillschweigend committen**, auch nicht versehentlich per
`git add -A`.

Aktuell abgelegt (lokal, vom Nutzer bereitgestellt):

- `What_Was_I_Made_For.mscz` - einstimmig (Klavier/Gesang), für den
  Basis-Sync-Test.
- `Duckwerk-Vokaltales-JubiläumsEdition.mscz` - fünfstimmiger Chorsatz
  (Sopran/Alt/Tenor/Bariton/Bass), für den Mehrstimmigkeits-/Akkord-Test
  (Risiko 2 im Implementierungsplan).

Konvertierte Ergebnisse (MusicXML/Audio/spos/mpos) landen in
`spike/output/` bzw. werden für die Spike-Seite nach `spike/public/scores/`
kopiert - beide Verzeichnisse sind ebenfalls gitignored.

## `repeat-test.musicxml` / `repeat-test.mscz` (Phase 5, M7)

Einzige Ausnahme von der Nicht-Commit-Regel oben (siehe `.gitignore`):
selbst komponiert, 5 Takte, eine Stimme, für M7 - siehe Abschnitt „M7" im
`PLAN.md`. `repeat-test.mscz` wird per `mscore4portable
repeat-test.musicxml -o repeat-test.mscz` aus der MusicXML-Quelle erzeugt
(reproduzierbar, daher könnte man die `.mscz` auch weglassen - sie liegt
trotzdem bei, damit `--score-media` ohne Docker-Zusatzschritt direkt darauf
läuft).

Struktur: Takt 1 (Wiederholungsanfang) - Takt 2 (Volta 1, Wiederholungsende)
- Takt 3 (Volta 2) - Takt 4 („Fine") - Takt 5 („D.C. al Fine"). Die
D.C.-Markierung ist als reiner MusicXML-`<sound dacapo="yes"/>`-Hinweis
codiert; MuseScore 4.7.4 übernimmt das beim Import **nicht** als
Sprunganweisung (nur als Text „D.C. al Fine", ohne Jump/Marker-Element -
siehe M7). Für einen echten Sprungtest müsste die Partitur in der
MuseScore-GUI angelegt werden, dort verfügbar sind in dieser Umgebung
nicht.
