# Grenzwerte und bekannte Einschränkungen

Was ScoreView leistet, wo die gemessenen Grenzen liegen und was bewusst nicht
abgedeckt ist. Alle Zahlen sind an der laufenden Installation gemessen, nicht
geschätzt; wo etwas Hochrechnung ist, steht es dabei.

## Gemessene Werte

Drei Partituren, gemessen auf einer gewöhnlichen Arbeitsmaschine – beide
Konvertierungswege in derselben Sitzung, damit die Spalten vergleichbar sind:

| Partitur | Seiten | Takte | `.mscz` | Sidecar | lokal | SVG gesamt (Sidecar / lokal) | größte Seite | MIDI | Cache (Sidecar / lokal) |
|---|---|---|---|---|---|---|---|---|---|
| Minipartitur | 1 | 5 | 30 KB | **8,1 s** | **0,8 s** | 107 / 52 KB | 107 / 52 KB | 0,4 KB | 111 / 55 KB |
| Chorsatz | 4 | 58 | 114 KB | **25,6 s** | **1,2 s** | 3235 / 1148 KB | 1040 / 354 KB | 12,4 KB | 3291 / 1196 KB |
| Chorsatz | 5 | 63 | 98 KB | **31,9 s** | **1,2 s** | 1173 / 813 KB | 302 / 210 KB | 8,3 KB | 1227 / 858 KB |

Die MIDI ist auf beiden Wegen byteweise identisch
([E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api)). Die
SVG-Seiten zeigen dasselbe Bild, kodieren es aber anders: Die Engine legt jede
Glyphe einmal in `<defs>` und setzt sie mit `<use>`, MuseScore zeichnet jeden
Umriss erneut – je nach Notendichte 35–70 % der Dateigröße.

Daraus abgeleitet:

- **Konvertierungsdauer über den Sidecar ≈ 6 s pro Seite + 2 s Grundlast**
  (lineare Regression über die drei Messpunkte). Daran hängt der Default von
  `MSCORE_TIMEOUT_SECONDS` (600 s, rechnerisch rund 100 Seiten). Wer sehr große
  Partituren erwartet, rechnet mit `Seitenzahl × 6 s + Puffer` hoch. Die Zahl
  hängt spürbar von der CPU ab – Größenordnung, keine Garantie.
- **Lokal sind rund 0,45 s davon Grundlast** – Prozessstart plus Instanziierung
  des Wasm-Moduls. Die eigentliche Konvertierung dauert 0,4–0,8 s, also
  etwa 0,1 s pro Seite. Der lokale Weg gewinnt vor allem, weil er keine
  PNG/PDF/MusicXML mitrendert, die anschließend verworfen werden
  ([M2](architecture.md#m2-schlüssel-im---score-media-json)).
- **Die SVG-Größe schwankt stark pro Seite** (303 KB gegen 1041 KB je nach
  Notendichte, Faktor ~3,4). Eine Hochrechnung „Seitenzahl × Durchschnitt" ist
  deshalb grob. Für 30 Seiten dichten Satzes sind ~30 MB SVG im Cache plausibel.
- **Eingebettete Bilder wiegen schwer.** Sie stecken als Daten-URI in der
  Seite, die sie trägt, und Base64 kostet ein Drittel Aufschlag: Die Titelseite
  der Aequale-Partitur (zwei PNG, zusammen 562 KB) wiegt damit 773 KB statt
  23 KB. Betroffen ist nur diese eine Seite – die übrigen bleiben, was sie
  waren. Der Sidecar ist an dieser Stelle nicht gegengemessen.
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

**Die MuseScore-Version des lokalen Wegs hängt an einem eigenen Build.**
[AndiMb/scoreview-engine](https://github.com/AndiMb/scoreview-engine) trägt
4.7.4 (MuseScore als gepinnter, ungepatchter Submodul-Stand, Qt-frei); sie
zieht nicht von selbst nach, wenn MuseScore weitergeht – ein neuer Kern heißt,
die Engine zu bauen und die Tarball-URL hochzuziehen. Der Selbsttest der
Betriebsdiagnose prüft, ob die Zusagen aus M2/M4/M7 noch halten – dass eine
neuere MuseScore-Version verfügbar wäre, meldet er nicht.

**Alte Partituren bekommen lokal eine Ersatz-Notenschrift.** Für Dateien aus
MuseScore 1 bis 3 gelten die Stilvorgaben ihrer Zeit, und die nennen als
Notenschrift Emmentaler bzw. MScore Text. Die bringt der lokale Weg nicht mit –
er trägt Bravura und Leland, und jede weitere Schrift würde das
Auslieferungspaket vergrößern. Gezeichnet wird deshalb mit Bravura. Betroffen
sind nur die Glyphenformen: Der Stilwert bleibt „Emmentaler“, also greifen die
Satzregeln, die daran hängen, genauso wie in MuseScore – Seitenaufteilung und
Abstände stimmen. Der Sidecar hat die Originalschrift.

**Zwei Bildformate zeigt nur der Sidecar.** In die Partitur eingebettete
Bilder setzen beide Wege ins Notenbild. Der lokale Weg reicht sie unverändert
ins SVG durch und kennt dafür PNG, JPEG, GIF und BMP – die vier Formate, die
ein Browser selbst anzeigt. Die beiden übrigen, die MuseScore annimmt, bleiben
dort leer: ein SVG als Bild (dafür bräuchte die Qt-freie Engine einen eigenen
SVG-Renderer) und TIFF (das kein Browser dekodiert). Der Sidecar rastert ein
SVG-Bild mit; was er mit TIFF macht, hängt an den Bild-Plugins seines
AppImage und ist ungeprüft. Wirkung: an dieser Stelle bleibt im lokalen Weg
eine Lücke, der Rest der Seite ist unberührt.

**Keine Hervorhebung der Notenköpfe auf dem Sidecar-Weg.** Der klingende
Notenkopf wird nur eingefärbt, wo das SVG die Kennungen aus
[M10](architecture.md#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)
trägt – das tut der lokale Konvertierungsweg, nicht der Sidecar mit seinem
Stock-AppImage. Dort bleibt es beim Band, ohne Fehlermeldung: Die Einstellung
„klingende Noten einfärben" ist dann zwar wählbar, fällt aber still auf das Band
zurück. Wirkung: dieselbe Bedienung, weniger Führung im Notenbild.

**Die Version des Konvertierers wird nicht aufgezeichnet.** Der Viewer nennt den
Konvertierungs*weg* jeder Darstellung, aber nicht, welche MuseScore- bzw.
Engine-Version dabei lief: Der Sidecar meldet seine Version nur im
Job-unabhängigen `/health`, und die einzige Versionsangabe in `meta.json`
(`mscoreVersion`) ist die der Partitur, nicht die des Konvertierers. Wirkung:
Ein Satzunterschied ist auf den Weg zurückführbar, nicht auf eine
Versionsnummer.

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
  (`.woff2`, `.otf`, `.ttf`, `.ttc`) in ein Verzeichnis **außerhalb der App**
  und trägt es ein:

  ```sh
  occ config:app:set scoreview cjk_font_dir --value=/srv/scoreview-fonts
  ```

  Außerhalb der App, weil das ausgelieferte App-Verzeichnis **signiert** ist –
  jede zusätzliche Datei darin lässt Nextclouds Integritätsprüfung dauerhaft
  Alarm schlagen. Auf dem Sidecar-Weg gibt es diese Möglichkeit nicht: Sein
  Image bringt nur DejaVu und FreeFont mit (nachgesehen: 19 Fontdateien, keine
  CJK-Schrift), und es gibt keine Einstellung, ihm Fonts nachzureichen – dort
  hilft nur ein eigenes Image.
