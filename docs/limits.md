# Grenzwerte und bekannte Einschränkungen

Was ScoreView leistet, wo die gemessenen Grenzen liegen und was bewusst nicht
abgedeckt ist. Alle Zahlen sind an der laufenden Installation gemessen, nicht
geschätzt; wo etwas Hochrechnung ist, steht es dabei.

## Gemessene Werte

Drei Partituren, gemessen auf einer gewöhnlichen Arbeitsmaschine:

| Partitur | Seiten | Takte | `.mscz` | Konvertierung | SVG gesamt | größte Seite | MIDI | Cache gesamt |
|---|---|---|---|---|---|---|---|---|
| Minipartitur | 1 | 5 | 30 KB | **6,3 s** | 107 KB | 107 KB | 0,4 KB | 111 KB |
| Chorsatz | 4 | 58 | 114 KB | **23,0 s** | 3236 KB | 1041 KB | 12,4 KB | 5038 KB |
| Chorsatz | 5 | 63 | 98 KB | **27,7 s** | 1174 KB | 303 KB | 8,3 KB | 4623 KB |

Daraus abgeleitet:

- **Konvertierungsdauer ≈ 5,4 s pro Seite + 1 s Grundlast** (lineare Regression
  über die drei Messpunkte). Daran hängt der Default von
  `MSCORE_TIMEOUT_SECONDS` (600 s, rechnerisch ~110 Seiten). Wer sehr große
  Partituren erwartet, rechnet mit `Seitenzahl × 5,4 s + Puffer` hoch. Die Zahl
  hängt spürbar von der CPU ab – Größenordnung, keine Garantie.
- **Die SVG-Größe schwankt stark pro Seite** (303 KB gegen 1041 KB je nach
  Notendichte, Faktor ~3,4). Eine Hochrechnung „Seitenzahl × Durchschnitt" ist
  deshalb grob. Für 30 Seiten dichten Satzes sind ~30 MB SVG im Cache plausibel.
- **MIDI bleibt vernachlässigbar** (< 15 KB), wie in
  [E1](architecture.md#e1-midi-statt-mp3-als-audioartefakt) erwartet.
- **DOM-Last im Browser:** ~640–1370 Knoten pro gerenderter Seite. Es werden nur
  sichtbare Seiten gerendert, und weggescrollte Seiten werden wieder freigegeben
  – bei einer fünfseitigen Partitur liegen im Betrieb 1–2 Seiten im DOM statt
  aller fünf. Die DOM-Last wächst damit nicht mit der Länge der Partitur.
- **Bedienung:** 30 Zoom-Änderungen in 485–493 ms (~16 ms pro Änderung) bei
  ~5500–6400 Knoten. Auf Desktop-Hardware flüssig.
- **Upload-Limit** (`SCOREVIEW_MAX_UPLOAD_BYTES`, Default 200 MB) liegt weit
  jenseits echter Partituren (größte Testdatei: 114 KB) und schützt nur gegen
  pathologische Uploads.

**Die Messreihe stammt von 1–5-seitigen Partituren.** Alles darüber ist
Hochrechnung.

## Bekannte Lücken

**D.C./D.S./Coda-Sprünge.** MuseScores `--score-media` rollt sie nicht in
zusätzliche Timing-Events aus – geprüft mit handgeschriebenem MusicXML als
Eingabe, siehe [M7](architecture.md#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht).
Ob eine in der MuseScore-GUI angelegte Jump/Marker-Struktur ausgerollt wird, ist
ungeprüft. Wirkung im Fehlerfall: Der Cursor bleibt an einem Sprung stehen,
statt mitzuspringen; die restliche Partitur bleibt normal navigierbar. Reguläre
Wiederholungen und Volten funktionieren gemessen korrekt.

**Große Partituren.** Orchesterpartituren sind nicht gemessen. Die Zahlen oben
stammen von Chorsätzen bis fünf Seiten.

**Klangqualität.** Der Browser-Mixdown liegt rund 7 dB unter MuseScores eigenem
Render; die Stimmentrennung stimmt. Ein pauschaler Verstärkungsfaktor ist
bewusst nicht eingebaut (Clipping-Risiko in lauten Passagen). Der Unterschied
stammt vor allem aus der SoundFont-Wahl und fehlenden Master-Effekten. Wer
besseren Klang braucht, hinterlegt ein eigenes SoundFont – siehe
[Installation](installation.md#soundfont).

**Tablet-Hardware.** Touch-Bedienung, Pinch-Zoom und Wachhalten des Bildschirms
sind umgesetzt und im Browser verifiziert, aber nicht auf einem echten Tablet in
einer Probe erprobt.

**Offlinebetrieb.** Im Probenraum ist WLAN oft schlecht oder gar nicht vorhanden.
Die Artefakte sind unveränderlich und aggressiv cachebar, was günstig ist – aber
Nextclouds Viewer ist keine installierbare Web-App, und das SoundFont wiegt
~40 MB. Ob die App ohne Netz brauchbar ist, ist ungeprüft.

## Was die App bewusst nicht tut

- **Kein Betrieb ohne Sidecar**, und damit keine Installation auf
  SaaS-gehosteten Nextcloud-Instanzen. Siehe
  [E3](architecture.md#e3-der-sidecar-ist-voraussetzung); die Trennung im Code
  hält eine spätere Lockerung offen.
- **Kein Reflow.** Das Seitenbild ist MuseScores A4-Satz
  ([E2](architecture.md#e2-musescore-svg-statt-neusatz-im-browser)).
  „Bildschirmfüllend" ist eine Skalierung, kein Umbruch. Echter Umbruch bräuchte
  ein zweites serverseitiges Layout.
- **Kein Bearbeiten von Partituren.** ScoreView zeigt und spielt; es korrigiert
  nichts in der `.mscz`.
- **Keine eigene Seite in Nextcloud.** Einstieg ist ausschließlich der Viewer
  aus Files, `/apps/scoreview/` antwortet bewusst 404.
- **Kein Stift-/Freihand-Layer.** Notizen sind Text an einem musikalischen Anker.
  Freie Striche wären eine zweite Datenart, deren Anker ein Pfad statt eines
  Punktes sein müsste.
- **Kein Sandboxing des MuseScore-Prozesses über den Container hinaus.** Der
  Container läuft non-root mit Speicher- und PID-Limit; eine
  Netzwerk-Isolation nur für den Konvertierungs-Subprozess bräuchte eine eigene
  Sandbox-Schicht. Siehe [Sicherheit](../sidecar/README.md#sicherheit).
- **Nur Deutsch und Englisch.** Eine weitere Sprache ist das Hinzufügen einer
  Datei, keine Umstellung ([E4](architecture.md#e4-englische-quellstrings-deutsch-als-gepflegte-übersetzung)).
- **Keine Verpackung als AppAPI/ExApp.** Der Sidecar wird heute als eigener
  Container betrieben, nicht von Nextcloud verwaltet.
