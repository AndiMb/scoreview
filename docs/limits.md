# Grenzwerte und bekannte Einschränkungen

Was ScoreView leistet, wo die gemessenen Grenzen liegen und was bewusst nicht
abgedeckt ist. Alle Zahlen sind an der laufenden Installation gemessen, nicht
geschätzt; wo etwas Hochrechnung ist, steht es dabei.

## Gemessene Werte

Drei Partituren, gemessen auf einer gewöhnlichen Arbeitsmaschine:

| Partitur | Seiten | Takte | `.mscz` | Sidecar | lokal | SVG gesamt | größte Seite | MIDI | Cache gesamt |
|---|---|---|---|---|---|---|---|---|---|
| Minipartitur | 1 | 5 | 30 KB | **6,3 s** | **1,9 s** | 107 KB | 107 KB | 0,4 KB | 111 KB |
| Chorsatz | 4 | 58 | 114 KB | **23,0 s** | **2,9 s** | 3236 KB | 1041 KB | 12,4 KB | 5038 KB |
| Chorsatz | 5 | 63 | 98 KB | **27,7 s** | **2,5 s** | 1174 KB | 303 KB | 8,3 KB | 4623 KB |

Die Artefaktspalten gelten für beide Konvertierungswege
([E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api)): die MIDI ist
byteweise identisch, die SVG-Summen liegen innerhalb von 0,4 %.

Daraus abgeleitet:

- **Konvertierungsdauer über den Sidecar ≈ 5,4 s pro Seite + 1 s Grundlast**
  (lineare Regression über die drei Messpunkte). Daran hängt der Default von
  `MSCORE_TIMEOUT_SECONDS` (600 s, rechnerisch ~110 Seiten). Wer sehr große
  Partituren erwartet, rechnet mit `Seitenzahl × 5,4 s + Puffer` hoch. Die Zahl
  hängt spürbar von der CPU ab – Größenordnung, keine Garantie.
- **Lokal sind rund 1,7 s davon Grundlast** – die einmalige Übersetzung des
  Wasm-Moduls je Prozess. Die eigentliche Konvertierung dauert 0,2–1,2 s, also
  etwa 0,25 s pro Seite. Der lokale Weg gewinnt vor allem, weil er keine
  PNG/PDF/MusicXML mitrendert, die anschließend verworfen werden
  ([M2](architecture.md#m2-schlüssel-im---score-media-json)).
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

**Der lokale Konvertierungsweg unter Last.** Gemessen ist er an einer einzelnen
Maschine mit einer Partitur nach der anderen. Wie sich mehrere gleichzeitige
Konvertierungen verhalten, ist ungeprüft: Jeder Lauf ist ein eigener Prozess mit
rund 130–250 MB Speicherbedarf, und anders als beim Sidecar begrenzt nichts ihre
Zahl (dort tut das eine Semaphore). Auf einem kleinen Server kann eine
Sammel-Vorabkonvertierung (`eager_conversion`) deshalb spürbar werden.

**Die MuseScore-Version des lokalen Wegs hängt an einem Fork.**
[AndiMb/webmscore](https://github.com/AndiMb/webmscore) trägt 4.7.4; sie zieht
nicht von selbst nach, wenn MuseScore weitergeht – ein neuer Kern heißt, den
Fork zu bauen und die Tarball-URL hochzuziehen. Der Selbsttest der
Betriebsdiagnose prüft, ob die Zusagen aus M2/M4/M7 noch halten – dass eine
neuere MuseScore-Version verfügbar wäre, meldet er nicht.

**Tablet-Hardware.** Touch-Bedienung, Pinch-Zoom und Wachhalten des Bildschirms
sind umgesetzt und im Browser verifiziert, aber nicht auf einem echten Tablet in
einer Probe erprobt.

**Offlinebetrieb.** Im Probenraum ist WLAN oft schlecht oder gar nicht vorhanden.
Die Artefakte sind unveränderlich und aggressiv cachebar, was günstig ist – aber
Nextclouds Viewer ist keine installierbare Web-App, und das SoundFont wiegt
~40 MB. Ob die App ohne Netz brauchbar ist, ist ungeprüft.

## Was die App bewusst nicht tut

- **Kein serverseitiges Rendern auf verwaltetem Hosting.** Der lokale
  Konvertierungsweg braucht eine Node.js-Laufzeit und die Erlaubnis, Prozesse
  zu starten; wo es beides nicht gibt, ist ScoreView nicht betreibbar. In PHP
  allein lässt sich das Wasm-Modul nicht ausführen – die Gründe stehen in
  [E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api).
- **Kein Reflow.** Das Seitenbild ist MuseScores A4-Satz
  ([E2](architecture.md#e2-musescore-svg-statt-neusatz-im-browser)).
  „Bildschirmfüllend" ist eine Skalierung, kein Umbruch. Echter Umbruch bräuchte
  ein zweites serverseitiges Layout.
- **Kein Bearbeiten von Partituren.** ScoreView zeigt und spielt; es korrigiert
  nichts in der `.mscz`.
- **Keine eigene Seite in Nextcloud.** Eingestiegen wird ausschließlich aus
  Files – über Nextclouds Viewer oder über die Dateiaktion auf der Endung
  ([E6](architecture.md#e6-zwei-einstiege--mimetype-und-dateiendung));
  `/apps/scoreview/` antwortet bewusst 404.
- **Kein Stift-/Freihand-Layer.** Notizen sind Text an einem musikalischen Anker.
  Freie Striche wären eine zweite Datenart, deren Anker ein Pfad statt eines
  Punktes sein müsste – und die anders als Text ein Neurendern der Partitur
  nicht übersteht, weil ein Strich an Pixeln hängt und nicht an einem Takt.
- **Kein zweiter Notensatz je Stimme.** „Nur meine Zeile" nimmt die übrigen
  Stimmen optisch zurück; die Seite behält ihr Layout samt der Leerräume, wo
  die anderen Zeilen stehen. Ein echter Einzelstimmenauszug wäre ein zweites
  serverseitiges Layout (MuseScore kann das über Auszüge) und damit ein
  weiteres Artefakt je Stimme im Cache.
- **Kein Sandboxing des MuseScore-Prozesses über den Container hinaus.** Der
  Container läuft non-root mit Speicher- und PID-Limit; eine
  Netzwerk-Isolation nur für den Konvertierungs-Subprozess bräuchte eine eigene
  Sandbox-Schicht. Siehe [Sicherheit](../sidecar/README.md#sicherheit).
- **Nur Deutsch und Englisch.** Eine weitere Sprache ist das Hinzufügen einer
  Datei, keine Umstellung ([E4](architecture.md#e4-englische-quellstrings-deutsch-als-gepflegte-übersetzung)).
- **Keine Verpackung als AppAPI/ExApp.** Der Sidecar wird heute als eigener
  Container betrieben, nicht von Nextcloud verwaltet.
- **Keine mitgelieferte Node-Laufzeit.** Der lokale Weg benutzt das `node` des
  Servers; die App bringt keines mit und lädt auch keines nach (wie es etwa
  Nextclouds `recognize` tut).
- **Keine CJK-Fonts im App-Store-Paket.** Auf dem lokalen Konvertierungsweg
  setzt MuseScore chinesische, japanische und koreanische Liedtexte deshalb als
  Ersatzkästchen; alles andere ist unberührt. Die Fonts wiegen 4,2 MB, und der
  App Store nimmt Archive nur bis 20 MB an. Wer sie braucht, legt Fontdateien
  (`.woff2`, `.otf`, `.ttf`) in ein Verzeichnis **außerhalb der App** und trägt
  es ein:

  ```sh
  occ config:app:set scoreview cjk_font_dir --value=/srv/scoreview-fonts
  ```

  Außerhalb der App, weil das ausgelieferte App-Verzeichnis **signiert** ist –
  jede zusätzliche Datei darin lässt Nextclouds Integritätsprüfung dauerhaft
  Alarm schlagen. Der Sidecar-Weg hat die Systemfonts seines Images und ist von
  alldem nicht betroffen.
