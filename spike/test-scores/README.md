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
