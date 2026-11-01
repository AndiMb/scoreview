<!-- translation-of: limits.md sha256:d8dac2ce08d2 -->
# Grenzwerte und bekannte Einschränkungen

[English](limits.md) · **Deutsch** — Die englische Fassung ist maßgeblich.

Was ScoreView leistet, wo die gemessenen Grenzen liegen und was bewusst nicht
abgedeckt ist. Alle Zahlen sind an der laufenden Installation gemessen, nicht
geschätzt; wo etwas Hochrechnung ist, steht es dabei.

## Gemessene Werte

Drei Partituren, gemessen auf einer gewöhnlichen Arbeitsmaschine – beide
Konvertierungswege in derselben Sitzung, damit die Spalten vergleichbar sind.
„Sidecar“ ist hier der Sidecar, der mit MuseScore selbst konvertiert; mit der
Engine konvertiert er wie der lokale Weg (siehe unten):

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

- **Konvertierungsdauer über den Sidecar mit MuseScore ≈ 6 s pro Seite + 2 s Grundlast**
  (lineare Regression über die drei Messpunkte). Die App wartet auf dem
  Sidecar-Weg fest höchstens 300 s ab dem Einreichen (`ConvertScoreJob`),
  rechnerisch rund 50 Seiten; `MSCORE_TIMEOUT_SECONDS` des Sidecars (Vorgabe
  600 s) liegt darüber und greift nur, wenn er kleiner gesetzt ist. Wer sehr
  große Partituren erwartet, rechnet mit `Seitenzahl × 6 s + Puffer` hoch. Die
  Zahl hängt spürbar von der CPU ab – Größenordnung, keine Garantie.
- **Der Sidecar mit der Engine konvertiert wie der lokale Weg.** Gemessen auf
  der Testinstanz gegen die API des Sidecars, an `parts-test.mscz` (3 Seiten,
  fünf Notenzeilen): 1,4–2,5 s mit der Engine, 30–32 s mit MuseScore selbst –
  dieselbe Partitur im selben Container.
- **Lokal sind rund 0,45 s davon Grundlast** – Prozessstart plus Instanziierung
  des Wasm-Moduls. Die eigentliche Konvertierung dauert 0,4–0,8 s, also
  etwa 0,1 s pro Seite. Der lokale Weg gewinnt vor allem, weil er keine
  PNG/PDF/MusicXML mitrendert, die anschließend verworfen werden
  ([M2](architecture.md#m2-schlüssel-im---score-media-json)).
- **Die SVG-Größe schwankt stark pro Seite** (302 KB gegen 1040 KB je nach
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
- **Warteschlange des Sidecars:** Höchstens `SCOREVIEW_MAX_QUEUED` (Vorgabe
  30) Aufträge warten; darüber antwortet er 503 mit `Retry-After`, und die App
  versucht es später erneut, statt die Partitur als gescheitert zu markieren.
  Hergeleitet aus der 300-s-Frist bei rund 10 s je Auftrag. Ein wartender
  Auftrag verfällt nach `SCOREVIEW_PENDING_MAX_AGE_SECONDS` (Vorgabe 3600 s).
- **Upload-Limit** (`SCOREVIEW_MAX_UPLOAD_BYTES`, Default 200 MB) liegt weit
  jenseits echter Partituren (größte Testdatei: 566 KB) und schützt nur gegen
  pathologische Uploads. Die App lehnt schon vorher ab: `max_score_bytes`,
  Vorgabe 100 MB, auf beiden Wegen.

- **Unter Node läuft der Konverter mit `--liftoff-only`.** Ohne die Option
  optimiert Node das 9,5 MB große WebAssembly-Modul der Engine im Hintergrund
  und wartet beim Beenden des Prozesses auf diese Arbeit: gemessen mit Node
  20.19, eine Konvertierung, deren eigentliche Arbeit nach 3,5 s erledigt war,
  dauerte insgesamt 23–29 s; mit der Option 3,2–4,0 s bei Partituren von einer
  bis fünf Seiten. Deno wartet nicht (4,3 s so oder so) und läuft ohne sie.

**Die Server-Messreihe stammt von 1–5-seitigen Partituren.** Alles darüber
ist Hochrechnung.

### Konvertierung im Browser

Dieselbe Engine im Browser statt in Node
([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)), gemessen auf
derselben Maschine in einem Chromium ohne Fenster:

| Partitur | Seiten | `.mscz` | im Browser | davon Start der Engine |
|---|---|---|---|---|
| Minipartitur | 1 | 30 KB | **0,4 s** | 0,36 s |
| Chorsatz | 5 | 98 KB | **0,7 s** | 0,57 s |
| Chorsatz | 28 | 185 KB | **1,0 s** | 0,74 s |
| Chorsatz | 4 | 566 KB | **0,4 s** | 0,34 s |

Auf einem Rechner ist der Browser damit nicht langsamer als der Node-Weg. Dazu
kommt einmalig der Download der Engine: 14 MB roh, rund **7,3 MB über die
Leitung** – das Wasm wird komprimiert übertragen (9,0 → 2,6 MB), das
Ressourcenpaket nicht (4,7 MB). Der Glue geht komprimiert mit 48 KB über die
Leitung.

Die Artefakte sind dieselben: `timing.json`, `measures.json` und `meta.json`
sind Byte für Byte identisch zu `node convert.mjs` derselben Partitur, die
SVG-Seite ist gleich lang (gemessen an der Minipartitur).

### Abschottung des lokalen Konverters

Was eine Konvertierung auf Weg A außer der Partitur und ihrem
Ausgabeverzeichnis erreichen kann
([S11](architecture.md#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis)).
Gemessen unter Linux mit einem Prüfskript, das jedes davon versucht, mit den
Flags, die die App setzt:

| | Node 18 | Node 20.7–24 | Node 25, 26 | Deno 2 |
|---|---|---|---|---|
| Andere Dateien lesen oder schreiben | möglich | gesperrt | gesperrt | gesperrt |
| Prozesse starten | möglich | gesperrt | gesperrt | gesperrt |
| Netz | möglich | **möglich** | gesperrt | gesperrt |
| Umgebungsvariablen | lesbar¹ | lesbar¹ | lesbar¹ | gesperrt |
| Stufe in der Diagnose | keine | teilweise | vollständig | vollständig |

¹ Die App startet den Konverter mit einer minimalen Umgebung (`PATH`, `LANG`)
statt der des Webservers; zu lesen gibt es also nichts.

- **Node 20.0–20.6** werten von mehreren `--allow-fs-read` nur das letzte aus;
  der Konverter könnte sein eigenes Verzeichnis und die Partitur nicht
  zugleich lesen. Sie laufen ohne Abschottung, wie Node 18.
- **Die Engine braucht nichts von dem Gesperrten** – keine Worker, keine
  Prozesse, kein Netz –, gemessen auch an einer Partitur mit 4 Seiten und
  58 Takten.
- **Die Dauer bleibt gleich:** Der Selbsttest braucht unter Node wie unter
  Deno 0,7–0,8 s.
- **Unter Deno darf kein freigegebener Pfad ein Komma enthalten.** Deno trennt
  Freigaben an Kommas und kennt kein Escape dafür. Ein solcher Lauf wird mit
  Nennung des Pfads abgelehnt, statt mehr freizugeben oder ohne Abschottung zu
  laufen. Betroffen ist praktisch ein App- oder Temp-Verzeichnis oder ein
  `cjk_font_dir` mit Komma im Pfad.

## Bekannte Lücken

**D.C./D.S./Coda-Sprünge.** MuseScores `--score-media` rollt sie nicht in
zusätzliche Timing-Events aus – geprüft mit handgeschriebenem MusicXML als
Eingabe, siehe [M7](architecture.md#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht).
Ob eine in der MuseScore-GUI angelegte Jump/Marker-Struktur ausgerollt wird, ist
ungeprüft. Wirkung im Fehlerfall: Der Cursor bleibt an einem Sprung stehen,
statt mitzuspringen; die restliche Partitur bleibt normal navigierbar. Reguläre
Wiederholungen und Volten funktionieren gemessen korrekt.

**Große Partituren.** Orchesterpartituren sind nicht gemessen. Die
Server-Messreihe oben stammt von Chorsätzen bis fünf Seiten; im Browser ist
zusätzlich ein 28-seitiger Chorsatz gemessen.

**Mehr als 16 MIDI-Kanäle.** MuseScore gibt jedem Klang eines Instruments einen
eigenen Kanal – Streichern drei, Akkordsymbolen einen weiteren – und zählt die
Kanäle nach dem sechzehnten auf einem weiteren MIDI-Port wieder ab 0. Die
Wiedergabe beachtet den Port, der Mixer nicht: Er kennt die Kanäle einer Stimme
ohne ihren Port. Einer Stimme auf einem weiteren Port kann deshalb die
Mixerzeile fehlen, oder ihr Regler wirkt auf eine Stimme des ersten Ports.
Nicht gemessen – eine Partitur mit mehr als 16 Kanälen ist noch nicht
ausprobiert; eine Blasorchester- oder Orchesterpartitur ist die Probe.

**Metronom und Taktart.** Mit der Taktart je Takt aus der Engine
(`measureFacts`, lokaler Weg und Rückfall im Browser ab `v4.7.5-engine.5`)
klickt das Metronom die dirigierten Schläge: 6/8 und 9/8 in punktierten
Vierteln mit drei Unterteilungen, ein Auftakt mit so vielen Schlägen, wie in
seine Länge passen, gezählt wie die Taktart es täte. Ohne sie – der Sidecar,
der mit MuseScore selbst konvertiert, eine Konvertierung von vor 1.17 – kommen die Schläge aus den
Taktart-Ereignissen des MIDI, die MuseScore je Wechsel schreibt, einen
Auftakt aber als eigene Taktart seiner Länge; und wo auch die fehlen, aus
der Taktdauer und dem Viertel-Tempo. Der Einzähler zählt immer Schläge, keine
Unterteilungen.

**Die Bedienung auf Telefonbreite.** Dass der Viewer in den mobilen Apps
überhaupt läuft, ist gemessen (siehe unten). Die Bedienleiste ist auf
Telefonbreite einzeilig – Play, Taktfeld, Anfangston, Schloss und „Werkzeuge“,
alles Weitere steckt im Überlaufmenü –, geprüft in einem Chromium bei 360 × 780 px,
nicht am Gerät. Mixer, Notizen und der Setlisten-Editor sind dort benutzbar,
nicht bequem. Zum Lesen auf dem Telefon gibt es das Systemband und die
Liedtext-Ansicht; ihre Grenzen stehen unter
[Üben und Lesen auf dem Handy](#üben-und-lesen-auf-dem-handy).

**Die WebView der mobilen Apps.** Gemessen auf einem Samsung Galaxy S23 mit der
Nextcloud-Android-App, Instanz über `adb reverse` als `http://localhost:8134`:
AudioWorklet und WebAssembly laufen, der Ton ist hörbar, `navigator.wakeLock`
wird erteilt. Abgeschaltet ist dort die **Vollbild-API**
(`document.fullscreenEnabled === false`): Die WebView der App setzt kein
`onShowCustomView` um, und ohne das kann keine Seite ins Vollbild – geprüft im
Quelltext der Nextcloud-Android-App 35.0.1, in der auch die übrigen
Direct-Editing-Editoren (Text, Collabora, ONLYOFFICE, Whiteboard) kein Vollbild
haben. Der Vollbildknopf schaltet dort deshalb ein Vollbild *innerhalb der
Seite*: Die Noten bekommen die ganze Ansicht, und die Bedienleiste fährt
während der Wiedergabe ein, auch hochkant. Androids Status- und
Navigationsleiste bleiben; ausblenden könnte sie nur die App. Andere Geräte, andere Android-Versionen und die
iOS-App sind ungeprüft; die Brücke ist für beide Plattformen geschrieben, aber
nur auf Android nachgemessen.

Wichtig für jede Wiederholung dieser Messung: Sie braucht einen **sicheren
Kontext**. Über ein schlichtes `http://<LAN-IP>:8134` fehlen `navigator.wakeLock`
und `audioWorklet` ersatzlos – die Messung fällt dann negativ aus, ohne über
die WebView etwas auszusagen (in Chromium gegengeprüft).

**Der Rückfall im Browser über die mobilen Apps.** Er funktioniert dort
(gemessen) und kostet wie am Desktop einmal je Engine-Version rund 7,3 MB
Download (14 MB entpackt) – auf einer Mobilfunkverbindung ist das viel. Wo der Server konvertieren kann,
tritt der Fall nicht ein.

**Konvertierung im Browser auf echten Geräten.** Alle Zahlen dazu stammen von
einem Desktop-Chromium. Wie lange ein Tablet oder Telefon braucht und ab
welcher Partiturgröße der Tab am Speicher stirbt, ist **ungeprüft** – der
Wasm-Heap liegt im Web Worker und ist von der Seite aus nicht messbar. Davon
hängt der Vorgabewert von `client_max_score_bytes` ab (10 MB), der bis dahin
geschätzt ist. In Node sind über fünf Durchläufe rund 105 MB Heap gemessen;
mobile Browser beenden Tabs erfahrungsgemäß früher als ein Desktop.

**Klangqualität.** Der Browser-Mixdown liegt rund 7 dB unter MuseScores eigenem
Render; die Stimmentrennung stimmt. Ein pauschaler Verstärkungsfaktor ist
bewusst nicht eingebaut (Clipping-Risiko in lauten Passagen). Ein Übe-Track
dagegen wird nach dem Rendern auf −1 dBFS Spitze normalisiert (höchstens
+12 dB) – dort ist das ganze Stück vorher bekannt. Der Unterschied
stammt vor allem aus der SoundFont-Wahl und fehlenden Master-Effekten. Wer
besseren Klang braucht, hinterlegt ein eigenes SoundFont – siehe
[Installation](installation.de.md#soundfont).

**Der lokale Konvertierungsweg unter Last.** Gemessen ist er an einer einzelnen
Maschine mit einer Partitur nach der anderen. Wie sich mehrere gleichzeitige
Konvertierungen verhalten, ist ungeprüft: Jeder Lauf ist ein eigener Prozess mit
rund 130–250 MB Speicherbedarf, und anders als beim Sidecar begrenzt nichts ihre
Zahl (dort tut das eine Semaphore). Auf einem kleinen Server kann eine
Sammel-Vorabkonvertierung (`eager_conversion`) deshalb spürbar werden.

**Die MuseScore-Version des lokalen Wegs hängt an einem eigenen Build.**
[AndiMb/scoreview-engine](https://github.com/AndiMb/scoreview-engine) trägt
4.7.6 (MuseScore als gepinnter, ungepatchter Submodul-Stand, Qt-frei); sie
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
Abstände stimmen. Der Sidecar hat die Originalschrift, wenn er mit MuseScore
selbst konvertiert; mit der Engine zeichnet er wie der lokale Weg.

**Zwei Bildformate zeigt nur MuseScore selbst auf dem Sidecar.** In die
Partitur eingebettete Bilder setzen beide Wege ins Notenbild. Die Engine – auf
dem lokalen Weg wie auf dem Sidecar – reicht sie unverändert
ins SVG durch und kennt dafür PNG, JPEG, GIF und BMP – die vier Formate, die
ein Browser selbst anzeigt. Die beiden übrigen, die MuseScore annimmt, bleiben
dort leer: ein SVG als Bild (dafür bräuchte die Qt-freie Engine einen eigenen
SVG-Renderer) und TIFF (das kein Browser dekodiert). MuseScore selbst rastert
ein SVG-Bild mit; was es mit TIFF macht, hängt an den Bild-Plugins seines
AppImage und ist ungeprüft. Wirkung: Mit der Engine bleibt an dieser Stelle
eine Lücke, der Rest der Seite ist unberührt. Ein Sidecar lässt sich für
solche Partituren auf MuseScore umstellen – allerdings für alle, nicht je
Partitur.

**Keine Hervorhebung der Notenköpfe, wenn der Sidecar mit MuseScore selbst
konvertiert.** Der klingende Notenkopf wird nur eingefärbt, wo das SVG die
Kennungen aus
[M10](architecture.md#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)
trägt – die schreibt die Engine, auf dem lokalen Weg wie auf dem Sidecar;
Stock-MuseScore schreibt sie nicht. Dort bleibt es beim Band, ohne Fehlermeldung: Die Einstellung
„klingende Noten einfärben" ist dann zwar wählbar, fällt aber still auf das Band
zurück. Wirkung: dieselbe Bedienung, weniger Führung im Notenbild. Dasselbe
gilt für die farbigen Notenköpfe der Intonation (siehe
[Mikrofon, Aufnahme und Intonation](#mikrofon-aufnahme-und-intonation)).

**Die Version des Konvertierers wird nicht aufgezeichnet.** Der Viewer nennt den
Konvertierungs*weg* jeder Darstellung, aber nicht, welche MuseScore- bzw.
Engine-Version dabei lief: Der Sidecar meldet seine Version nur im
Job-unabhängigen `/health`, und die einzige Versionsangabe in `meta.json`
(`mscoreVersion`) ist die der Partitur, nicht die des Konvertierers. Wirkung:
Ein Satzunterschied ist auf den Weg zurückführbar, nicht auf eine
Versionsnummer.

**Tablet- und Telefon-Hardware.** Touch-Bedienung, Pinch-Zoom und Wachhalten des
Bildschirms sind umgesetzt und im Browser verifiziert. Erprobt auf einem
Android-Telefon (Chrome und Opera, Ton über Bluetooth-Kopfhörer) sind drei
Dinge, die auf dem Desktop unsichtbar bleiben:

- Die Ausgabelatenz (Bluetooth) wird ausgeglichen; der Cursor läuft dem Ton
  nicht voraus.
- Das Nachführen erkennt manuelles Scrollen an der Geste; die ein- und
  ausfahrende Browserleiste gilt nicht als Eingriff.
- Die Transportleiste bleibt auf Telefonbreite einzeilig.

**Gemessene Ausgabelatenz**, abgelesen an der Diagnose unter
„Info und Diagnose“:

| Gerät | Ausgabe | Ausgeglichen |
|---|---|---|
| Android-Telefon | Bluetooth-Kopfhörer | **232 ms** |
| Arbeitsmaschine | eingebaut | **51 ms** |

Beide Werte stammen aus der **Automatik**, bei unangetastetem Regler. Damit ist
belegt: **Chrome auf Android meldet den Bluetooth-Anteil der
Ausgabelatenz**, die App trägt ihn ohne
Zutun. Bild und Ton passen auf beiden Geräten zusammen.

Der Regler „Bild und Ton abgleichen" bleibt für den Fall, dass ein Kopfhörer
seine Verzögerung nicht selbst nennt – dann fehlt der Automatik genau dieser
Anteil, und er ist nirgends ablesbar außer am eigenen Ohr. **Wie viele
Kopfhörer das betrifft, ist ungeprüft**; gemessen ist ein einziges Paar an
einem einzigen Telefon.

Nicht erprobt ist weiterhin **eine ganze Probe am Notenständer**, und
gegengeprüft ist die Wirkung nur in Chrome – **ob das Nachführen in Opera
ebenso glatt läuft, ist nicht geprüft.**

**Offlinebetrieb nur über die Offline-Seite.** Der Viewer in Files lädt ohne
Netz nicht; ohne Netz geht nur, was vorher vorgemerkt wurde, und nur über die
Offline-Seite ([Offline](#offline)).

## Probe- und Konzertfunktionen

### „Folgt mir“

Gemessen an der Testinstanz (Docker Desktop, 12 vCPU, SQLite im WAL-Modus,
Apache prefork), ohne `notify_push`, Abfrageabstand 800 ms:

| Messung | Ergebnis |
|---|---|
| Tipp der Leitung → Sprung auf dem Folgegerät (Browser, drei Folgegeräte) | p50 **595 ms**, p95 **945 ms** |
| Zwei Tipps der Leitung auf verschiedene Studierbuchstaben, Abstand 11–65 ms bzw. 74–263 ms (je 20×, drei Folgegeräte) | Leitung, Server und alle Folgegeräte **20/20** am zweiten; der erste ist nie zuletzt angekommen |
| Last: 40 Geräte gegen den echten Endpunkt, Leitung schreibt alle 3 s | p95 Ende-zu-Ende **771 ms**, 0 Fehler, 0 „database is locked“, **2,0–2,8 Kerne** |
| CPU je Abfrage | rund **50 ms**, fast alles für den Start von Nextcloud; Datei- und Cache-Zugriff sind ein kleiner Teil |

Daraus folgt für den Betrieb:

- **Ohne Push kostet eine Folgesitzung etwa 50 ms CPU je Gerät und Abfrage**,
  bei 40 Geräten also 2–3 Kerne für die Dauer der Probe. Auf einem kleinen
  Server (2–4 Kerne) ist das zu viel; die Betriebsdiagnose rät ab 20 Geräten
  zu `notify_push`. Ein größeres `follow_poll_ms` senkt die Last linear und
  verzögert die Sprünge entsprechend.
- **Über echtes WLAN kommt die Rundlaufzeit dazu.** Die Zahlen oben stammen aus
  einem Netz ohne Funkstrecke; realistisch ist ein p95 knapp über einer
  Sekunde. Einzelne Ausreißer von 2–4 s traten in der Lastmessung etwa alle
  2–3 Minuten auf (Ursache ungeklärt, vermutlich Docker/WSL oder Apache
  prefork).
- **Mit `notify_push`** holt jedes Gerät den Zustand nur bei einer Änderung.
  Dieser Weg ist **nur per Unit-Test geprüft** – die Testinstanz hat kein
  `notify_push`. Eine Latenzmessung damit steht aus.
- **Die mobilen Apps fragen immer ab.** `notify_push` meldet sich über eine
  Sitzung an, die die Direct-Editing-Seite nicht hat.
- **Ohne laufende Sitzung** fragt ein Gerät alle 15 s, ob eine begonnen hat –
  zwei Minuten lang, nachdem es geöffnet, sichtbar oder berührt wurde, danach
  alle 60 s. Wer den Viewer lange vor der Leitung öffnet und nicht berührt,
  folgt also erst nach bis zu 60 s; ein Tipp auf den Bildschirm lässt es
  wieder schnell fragen. In einem Tab im Hintergrund fragt es gar nicht und
  holt die Frage beim Zurückkehren sofort nach. Push verkürzt das nicht: Der
  Server schickt nur an Geräte, die einer laufenden Sitzung beigetreten sind.
- **Das Gerät der Leitung und ein gelöstes Gerät fragen selten** (alle 5 s
  und alle 15 s): Die Leitung kennt den Stand aus den Antworten auf ihre
  eigenen Änderungen, ein gelöstes Gerät muss nur das Ende der Sitzung
  bemerken.
- **Mitblättern** folgt der Wiedergabe der Leitung mit dem Abfrageabstand als
  Verzögerung für Start, Halt und Sprünge; dazwischen rechnet jedes Gerät
  selbst. Gemessen am Desktop mit einem Folgegerät: nach 8 s Wiedergabe
  dieselbe Sekunde und derselbe Takt wie die Leitung; in der Nextcloud-App
  am Galaxy S23 läuft es ebenso mit, ohne Ton. Ein Fehler bleibt um
  die halbe Antwortzeit stehen (die Serverzeit wird an der Antwort geschätzt).
- **Starten, Beenden und Beitreten sind auf je 30 Aufrufe je Minute
  begrenzt**, das Senden der Stelle auf 120. Mobile Apps zählen dabei je
  IP-Adresse (siehe unten bei der Leitung).
- **Mehrere Webserver ohne verteilten Cache:** Der lokale Cache gilt dann
  höchstens eine Sekunde, danach liest der nächste Aufruf die Datenbank –
  ein Lesezugriff je Sekunde und Datei (siehe
  [E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
- **Der Wechsel zum nächsten Stück dauert gemessen rund 3 s** bis zum
  Folgegerät, einschließlich Laden der neuen Partitur (zwei Browser an der
  Testinstanz, Desktop). Mit einem Folgegerät in der Nextcloud-App ist der
  Wechsel abgenommen (Galaxy S23), die Dauer dort nicht gemessen.
- **Nur die Leitung, die die Sitzung führt, nimmt sie mit.** Führt auf dem
  nächsten Stück schon jemand anderes, bleibt diese Sitzung; die Leitung
  wechselt allein, ihre Folgenden bleiben stehen.
- **Die Sitzung zieht nur zu einem Stück derselben Eigentümerin mit**, wenn
  die Leitung dort keine Leitungsrolle hat. Ein Stück aus einem anderen Konto
  oder aus einem Gruppenordner verlangt die Leitungsrolle auf genau diesem
  Stück; sonst wechselt die Leitung allein und sieht eine Fehlermeldung. Ohne
  diese Regel könnte jede Person über eine eigene Partitur die Folgenden einer
  geteilten übernehmen.
- **Auf einem mitgenommenen Stück fehlt der Leitung die Rolle**, wenn sie dort
  keine Leitung ist: Stelle, Loop, Anfangston und Transposition gehen,
  Stimmnotizen und Stempel nicht
  ([E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
- **Wer das nächste Stück nicht lesen darf, sieht dort eine Fehlermeldung.**
  Vorab prüfen lässt sich das von der Leitung aus nicht – sie sieht die Rechte
  der anderen nicht.
- **Eine Transposition der Leitung gilt für alle Folgenden** und wird bei
  ihnen nicht gespeichert; wer selbst transponiert, folgt nicht mehr.

### Leitung

- **Eine Leitung kraft Schreibrecht erscheint nicht in der Liste der
  Leitungen** (Dateien ohne Eigentümerin, etwa in Gruppenordnern). Sie hat die
  Rolle trotzdem; die Liste zeigt die Eigentümerin und die Ernannten.
- **Die Suche nach Personen zum Ernennen ist auf 30 Aufrufe je Minute
  begrenzt.** Anfragen aus den mobilen Apps sind für Nextclouds Begrenzung
  anonym und zählen je IP-Adresse – ein ganzer Chor hinter einem NAT teilt sich
  dieses Kontingent. Gesucht wird ohnehin nur von Leitungen.

### Notizen

- **Höchstens 500 Notizen je Person und Partitur**, alle Sichtbarkeiten,
  Stempel und gespeicherte Loops zusammen; darüber antwortet der Server 409.
  Zwei gleichzeitige Anfragen können die Grenze um eine Notiz überschreiten.
- **Ein gespeicherter Loop ist eine Notiz mit Endtakt.** Er übersteht einen
  Re-Upload wie eine Notiz; liegt sein Ende einmal jenseits der Partitur,
  erscheint er als verwaist und lässt sich nicht setzen. Loops für Stimmen
  verhalten sich wie Stimmnotizen: ohne gewählte Stimme gedimmt, für die
  anderen Stimmen verborgen. Einen gespeicherten Loop setzen geht auf der
  Offline-Seite, einen speichern nicht.
- **„Nur den Loop zeigen“ dimmt, es bricht nicht um.** Die Seiten
  verschleiern die Takte außerhalb des Loops, das Systemband zeigt nur die
  Systeme, die der Loop berührt, die Liedtext-Ansicht dimmt die übrigen
  Blöcke (E2: kein Reflow). Der Schalter ist eine Sitzungswahl und endet mit
  dem Loop.
- **Anlegen und Ändern sind auf je 60 Aufrufe je Minute begrenzt** – wer
  Stempel sehr schnell hintereinander setzt, bekommt kurz „Zu viele Änderungen“.
- **Eine Zeichnung ist ein paar Striche, kein Bild:** höchstens 40 Striche und
  800 Punkte nach dem Glätten, jeder Punkt höchstens 400 Linienabstände von
  dort, wo die Zeichnung begann. Sie zählt als eine Notiz und wird geändert,
  indem man sie löscht und neu zeichnet.
- **Eine Zeichnung gehört zu der Notenzeile, auf der sie begann.** Wo sich
  Zeilen und Stimmen nicht zuordnen lassen, gehört sie stattdessen zum
  System; dann bleibt sie in der Partitur, wo sie gezeichnet wurde, landet
  aber im Stimmenauszug über der falschen Zeile. Eine Zeichnung auf der Zeile
  einer Stimme erscheint im Auszug einer anderen Stimme nicht. Striche, die
  neben allen Takten beginnen, werden nicht gespeichert.
- **Gezeichnet wird auf den Seiten.** Wer im Systemband oder in der
  Liedtext-Ansicht zu zeichnen beginnt, kommt auf die Seiten; im Band
  erscheinen die Zeichnungen trotzdem.

### Setliste

- **Grenzen:** höchstens 256 KB und 200 Einträge je Setliste. Aus einer
  Partitur heraus sucht der Viewer nur im Ordner dieser Partitur und
  nimmt höchstens 20 Setlisten. Die Auswahl um die Partitur für den Editor
  reicht bis Tiefe 2, mit höchstens 200 Treffern und 100 besuchten Ordnern.
- **Rohe Pfade werden nicht %-dekodiert** – nur Linkziele. Wer in einen rohen
  Pfad `%20` schreibt, meint damit wörtlich `%20`.
- **Eine nicht eingerückte Zeile direkt nach einem Eintrag beendet die Liste.**
  Bewusst abweichend von CommonMark
  ([E11](architecture.md#e11-die-setliste-als-markdown-datei)); wer darunter
  weiterschreiben will, lässt eine Leerzeile oder rückt ein.
- **Absolute Pfade gelten im Baum der jeweiligen Leserin.** In einer geteilten
  Liste zeigt `/Chor/Kyrie.mscz` bei jeder, die sie liest, auf ihre eigene
  Datei dieses Namens – oder auf keine. Relative Pfade sind für geteilte
  Listen deshalb die bessere Wahl.
- **Nextclouds Viewer zeigt nach einem Stückwechsel weiter den ursprünglichen
  Dateinamen** in seiner Kopfzeile, wenn die Setliste aus einer Partitur
  heraus geöffnet wurde. Die Setlisten-Leiste nennt das richtige Stück.
- **Ein Pedal oder eine Taste für „nächstes Stück“ gibt es nicht.** Pedale
  blättern innerhalb eines Stücks; der Wechsel geht über die Setlisten-Leiste.
- **Mobil nur über eine Partitur.** Die Apps bieten für `*.setlist.md` Text an,
  nicht ScoreView; eine Setliste öffnet sich dort über eine ihrer Partituren.
  Im Editor lassen sich mobil nur Stücke aus dem Ordner der offenen Partitur
  hinzufügen, und über ein Stück aus der Liste heraus (Begleit-Token) nur
  umordnen und entfernen – Nextclouds Dateiauswahl braucht eine Sitzung.

### Mikrofon, Aufnahme und Intonation

**Gemessener Versatz einer Aufnahme**, in Chromium mit einer Datei als
Mikrofon, nach dem Ausgleich beider Latenzen:

| gegen | Versatz |
|---|---|
| den Cursor | **+42 … +52 ms** (die Aufnahme liegt später) |
| die Begleitung | **−22 … 0 ms** |

spessasynth gleicht eine Abweichung seiner eigenen Zeit erst ab 50 ms nach;
darunter bleibt sie stehen, und das betrifft den Cursor ebenso. An echten
Geräten und mit echter Eingangslatenz ist das nicht nachgemessen.

- **Das Einschwingen ist nicht gemessen.** Die Intonation verwirft die
  ersten **100 ms** jeder Note (`skipAttackMs`); ob das für Laienstimmen
  reicht, steht aus.
- **Der Einsatz ist der Beginn der Silbe**, bewertet nur dort, wo einer zu
  hören ist: nach Stille oder nach einem Tonhöhenwechsel. Nach Stille ist es
  die Stelle, an der der Pegel anstieg, einen Konsonanten eingeschlossen;
  nach einer anderen Note die Stelle, an der die Stimme sie verließ, ein
  Gleiten eingeschlossen. Eine Note, die an dieselbe Tonhöhe gebunden ist, hat
  keinen eigenen Einsatz und ist „nicht auswertbar“; das Ende einer Note („zu
  kurz“) wird nur vor einer Pause bewertet, „zu lang“ nie. An der stabilen
  Tonhöhe gemessen lag eine echte Stimme etwa 40 ms zu spät, weil sich die
  Tonhöhe erst einschwingt, wenn die Silbe schon begonnen hat. Gemessen mit
  synthetischen Tönen liegt der erkannte Einsatz nach Stille −2 … +8 ms und
  nach einem Tonhöhenwechsel +7 … +17 ms neben dem echten; abgezogen werden
  3 und 10 ms. Ein Einsatz ist bis **60 ms** zu früh oder zu spät grün – nie
  unter 55 ms, damit der Versatz gegen den Cursor allein keine Note gelb
  macht – und bis 120 ms gelb. Ein langer stimmloser Konsonant deutlich vor
  dem Schlag zählt als zu früh. Ein früher Einsatz muss auf dem neuen Ton
  bleiben: Eine Stimme, die ihn streift und zurückgeht, ist noch auf der
  vorigen Note – 40 ct zu tief einen Halbton über der nächsten Note gesungen,
  läsen sich die Täler ihres Vibratos sonst als diese Note, etwa 130 ms zu früh.
- **Gemessen mit einer echten Stimme** (Bass, Arbeitsplatz mit Kopfhörern,
  Begleitung in vollem Tempo, 79 s): 128 von 129 bewerteten Einsätzen waren
  grün, Median +1 ms (10 % früher als −26 ms, 10 % später als +27 ms); bei
  38 Noten gab es keinen Einsatz zu bewerten. Auf demselben Rechner lag die
  Aufnahme **+5 ms** hinter der Partitur, gemessen mit dem Metronom über den
  Lautsprecher.
- **Verschobene Einsätze, an dieser Aufnahme nachgestellt**: ganze Phrasen
  der Aufnahme innerhalb ihrer Pausen verschoben, jede dritte unverändert
  gelassen. Um 150 ms zu früh wurden 82 % der Noten markiert (jeder
  Phrasenanfang), um 150 ms zu spät 62 % (13 von 17 Phrasenanfängen), um
  80 ms 85 % und 72 %, der Rest knapp im Grünen. Die unveränderten Phrasen
  blieben grün, und jede um 60 % gekürzte Schlussnote wurde markiert. Eine
  Note, die später kommt als ihre eigene Länge minus etwa 100 ms, ist **nicht
  auswertbar**, nicht zu spät: Die Stimme liegt dann schon in der Zeit der
  nächsten Note, und an der Tonhöhe allein ist nicht zu erkennen, welche
  gemeint ist. In diesem Stück (abgesetzte Viertel bei ♩ = 180, etwa 316 ms) gilt das
  ab etwa 250 ms zu spät.
- **Langsameres Tempo, geprüft mit der eigenen Wiedergabe als Mikrofon**
  (Arbeitsplatz, die Bassstimme solo, im Browser zurückgeführt, 40 s
  Partitur; Klavier- und Fagottklang): Bei 100 %, 70 % und 50 % Tempo lag der
  Median der Einsätze innerhalb von 2 ms (−55 … −57 ms mit Klavier – die
  Ausgabelatenz, die die App abzieht und die eine Rückführung nicht hat) und
  wanderte von der ersten zur zweiten Hälfte nicht. Die Umrechnung zwischen
  Echtzeit und Partiturzeit stimmt; wie eine Stimme ihre Einsätze bei
  langsamerem Tempo setzt, ist eine andere Frage. **Noch nicht geprüft**:
  absichtlich daneben singen, andere Stimmlagen, eine Stimme bei langsamerem
  Tempo, Handys.
- **Der Warte-Modus ist zum Töne-Lernen, nicht für den Rhythmus.** Die
  Wiedergabe hält 30 ms vor jeder Note der eigenen Stimme an, die mindestens
  200 ms dauert, und läuft weiter, sobald das Mikrofon den Ton 60 ms lang
  gehört hat (±50 Cent, in jeder Oktave). Gemessen in Chromium mit einer
  Datei als Mikrofon: Der Halt kam 6 … 10 ms nach dem geplanten Moment, nie
  nach dem Einsatz, und die Wiedergabe lief 89 ms nach dem ersten passenden
  Rahmen weiter; mit einem falschen Ton ging es nie weiter. Beim Warten klingt
  die Begleitung, die gerade spielte, weiter. Geht es weiter, werden diese
  Noten neu angeschlagen – ein kurzer neuer Einsatz, kein nahtloses
  Weiterklingen. Die eigene Stimme ist für den ganzen Modus stumm; wer
  währenddessen ihre Lautstärke im Mixer ändert, bekommt beim Beenden die
  alte zurück. **Mit einer echten Stimme und am Handy noch nicht geprüft.**
- **Der Stimmton a' ist eine Einstellung je Nutzer, 420–460 Hz in ganzen
  Hertz** (Vorgabe 440, einzustellen im Stimmgerät). Er gilt für Stimmgerät,
  Intonation, Warte-Modus, die Wiedergabe samt Anfangston und den MP3-Export.
  Gemessen in Chromium: Bei 442 klang die Wiedergabe 7,89 Cent höher als bei
  440 (erwartet 7,85), und das Stimmgerät zeigte bei beiden dieselbe
  Abweichung in Cent. Eine Aufnahme behält den Stimmton, gegen den sie
  gesungen wurde. Barockstimmung mit 415 Hz liegt außerhalb des Bereichs;
  sie ist ein Halbton tiefer (Transponieren −1) bei 440. Ein Chor, der als
  Ganzes absinkt, wird weiterhin gegen die Einstellung bewertet, nicht gegen
  sich selbst.
- **Das Stimmgerät zeigt eine Stimme.** Es nutzt dieselbe Analyse wie die
  Intonation (Median über 120 ms, höchstens zwölfmal je Sekunde erneuert); ein
  Signal ohne klare Tonhöhe – zwei Stimmen, Atem, ein Akkord – zeigt nichts
  statt einer Schätzung, und nach 300 ms Stille erlischt die Anzeige. Die
  Note wird nach der Tonart an der aktuellen Stelle so geschrieben, wie
  MuseScore sie schriebe (in F-Dur B, in G-Dur Fis). Geprüft mit synthetischen
  Signalen, noch nicht mit einer echten Stimme am Handy
  ([Offene Prüfungen](#offene-prüfungen)). In der Android-App nicht verfügbar,
  wie alles, was das Mikrofon braucht.
- **Oktaven werden gefaltet.** Ein Tenor, der die Altstimme eine Oktave tiefer
  singt, singt sie richtig; eine Oktave daneben fällt also nicht auf.
- **Farbige Notenköpfe nur, wo die Engine konvertiert** (lokal, auf dem
  Sidecar mit der Engine, im Browser), und nur, wo
  jede Stimme eine eigene Notenzeile hat. Ein Kopf zeigt den schlechtesten
  Wert aus Tonhöhe, Einsatz und Ende; welcher es war, sagt die Liste. Sonst bleibt es ohne Fehlermeldung
  bei der Nadel und der Liste der Problemstellen
  ([M10](architecture.md#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)).
- **Bei Wiederholungen zeigt die Färbung den zuletzt bewerteten Durchgang.**
  Derselbe Notenkopf steht für beide Durchgänge
  ([M7](architecture.md#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht)).
- **Das Tempo der Aufnahme übernimmt die Begleitung beim Start des
  Abhörens** – eine Aufnahme lässt sich nicht strecken. Eine spätere Änderung
  des Tempos während des Abhörens wird nicht nachgeführt.
- **Uploads brauchen eine Webserver-Grenze von mindestens ~20 MB** (bei nginx
  `client_max_body_size`). Eine Aufnahme von 10 min wiegt rund 19 MB; darunter
  scheitert das Speichern mit 413 vom Webserver, bevor die App die Anfrage
  sieht ([Installation](installation.de.md#uploadgröße-für-aufnahmen)).
- **Ein Upload belegt Platz im temporären Verzeichnis, nicht im
  `memory_limit`.** Der Rumpf geht ab 2 MB in eine Zwischendatei
  (`php://temp`), geprüft wird nur der Kopf, und IAppData schreibt aus dem
  Strom. Bei der größten erlaubten Aufnahme (`max_recording_seconds` = 3600,
  rund 115 MB) braucht das temporäre Verzeichnis also je gleichzeitigem
  Upload so viel Platz; was darüber liegt, lehnt die App mit 413 ab, bevor
  sie es annimmt.
- **Die Obergrenze je Partitur hält auch bei gleichzeitigen Uploads, die
  Speichergrenzen nur ungefähr.** Nach dem Einfügen zählt die App nach: Mit
  bestätigtem Ersetzen geht die nächstälteste, ohne nimmt der später
  eingetroffene Upload seine Aufnahme zurück (bei exakt gleichzeitigen können
  es beide sein). Die Grenzen für den Speicher je Person und der Instanz kann
  ein gleichzeitiger Upload um höchstens seine eigene Größe überschreiten.
- **Eine Mikrofon-Erlaubnis gilt innerhalb von Files für alle Skripte dort**,
  wie bei Talk. Die App gibt das Mikrofon nur auf Seiten unter `/apps/files`
  frei; feiner als je Dokument lässt sich eine Richtlinie nicht setzen.
- **Nicht gespeicherte Aufnahmen überleben kein Neuladen der Seite.** Scheitert
  das Speichern, bleibt die Aufnahme im Speicher und lässt sich erneut
  speichern – bis die Seite neu geladen wird. Das steht in der Oberfläche.

### Partiturfakten und Stempel

- **Mit MuseScore selbst auf dem Sidecar kein Dur/Moll beim Grundton.** Stock-MuseScore schreibt
  keine Tonarten in `meta.json`, und im MIDI ist das Moll-Byte immer 0
  ([M11](architecture.md#m11-was-midi-und-svg-über-studierbuchstaben-und-tonarten-tragen)).
  Der Anfangston „Grundton“ spielt dort die Dur-Tonika der Vorzeichnung –
  in c-Moll also es statt c. Studierbuchstaben kommen auf beiden Wegen.
- **Mehrtaktpausen:** Die Taktzählung der Engine weicht dann von der des
  Viewers ab. Der Viewer nimmt Buchstaben und Tonarten in diesem Fall aus dem
  MIDI und übernimmt den Modus aus der Engine nur, wo er eindeutig ist
  ([E12](architecture.md#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)).
- **Stimmstempel stehen über dem System, wenn sich Zeilen und Stimmen nicht
  zuordnen lassen** – etwa sechs Stimmen auf fünf Notenzeilen. Der Stempel ist
  dann da, aber nicht an der Zeile seiner Stimme.
- **Mit MuseScore selbst auf dem Sidecar keine Liedtext-Ansicht und keine
  Tonnamen.** Beides braucht Listen, die nur die Engine schreibt; siehe
  [Darstellungen](#darstellungen).

### Übetagebuch

- **Gezählt wird, was klingt:** die Wiedergabe der Partitur oder eine
  laufende Aufnahme, je Person, Partitur und lokalem Kalendertag. Üben mit dem
  Stimmgerät oder mit einem Übe-Track außerhalb des Viewers zählt nicht.
- **Die eigene Zeit sieht nur man selbst** – auch Leitungen und Verwaltung
  sehen in der App nichts davon; eine Rangliste gibt es nicht. Das Wochenziel
  einer Partitur gilt für alle gleich und wird von ihren Leitungen gesetzt
  (5–1200 Minuten).
- **Grenzen:** Ein Gerät meldet höchstens 300 Sekunden auf einmal, höchstens
  einen Tag pro Tag, und nur für einen Tag, der höchstens einen Tag vom
  Serverdatum abweicht. Ein Gerät ohne Netz verliert, was es gezählt hat,
  während die Seite geschlossen wurde; ein Tab, der in den Hintergrund geht,
  meldet vorher noch.
- **Aufbewahrt 400 Tage**, danach entfernt sie das tägliche Aufräumen; die
  Ansicht zeigt diese Woche, die letzte Woche und die Tage in Folge. Wer sein
  Konto löscht, löscht sein Tagebuch; ein Ziel bleibt, wenn das Konto seiner
  Leitung geht.

### Singen mit Wertung

- **Die Stufen sind gesetzt, nicht gemessen.** Grün für den Ton bis ±50 Cent
  (Einsteiger), ±25 (Chor, wie die Intonation) oder ±15 (Streng); grün für
  den Einsatz bis 120 ms bei Einsteiger, sonst 60 ms; Streng verengt statt
  dessen den gelben Bereich (100 ms statt 120). Keine Stufe geht unter 60 ms – darunter
  würde der gemessene Versatz des Cursors bewertet, nicht die Stimme. Ob die
  Stufen zu Laienstimmen passen, ist mit echten Sängerinnen noch nicht
  geprüft.
- **Gemessen mit einer synthetischen Stimme** (Chromium, ein erzeugter Ton
  als Mikrofon, der Wiedergabe folgend): exakt gesungen 100 % auf Einsteiger
  und Chor; 40 Cent zu tief jede Note gelb und rund 50 %; jede fünfte Note
  150 ms zu spät, genau diese „spät“; nach 40 % ihrer Länge abgesetzte Noten
  „zu kurz“, ihr Ton zählt weiter. In keinem Durchgang ging ein Rahmen
  verloren. Innerhalb eines Durchgangs liegt die mittlere Hälfte der Einsätze
  in 4–23 ms, über einen Durchgang von 98 s drifteten die Einsätze der
  synthetischen Stimme aber um bis zu etwa 50 ms, und zwischen Durchgängen
  schwankte der Median von −45 bis −65 ms: Der erzeugte Ton hält seine eigene
  Uhr, die Wiedergabe korrigiert ihre Zeit erst ab 50 ms (siehe oben). Eine
  Sängerin folgt dem Klang, die Drift sollte eine echte Stimme also nicht
  treffen – mit einer echten nicht geprüft. Ein 150 ms später Einsatz wird in
  diesem Test deshalb nicht immer als spät erkannt (7 von 11).
- **Das Stichwort unter einer Note kommt etwa 250 ms nach ihrem Ende** – erst
  dann liegen die Rahmen vor, die das Ende bewerten. Die gesungene Linie
  selbst läuft live.
- **Kopfhörer.** Ohne sie gelangt die Begleitung ins Mikrofon und wird als
  Gesang gehört – in Unisono-Stellen wertet sie mit. Die App kann beides nicht
  unterscheiden.
- **Eine Stimme je Gerät.** Gewertet wird die als meine gewählte Stimme; zwei
  Personen an einem Mikrofon zählen als eine Stimme.
- **Im Divisi zählt die nächstliegende Note** des Akkords; die übrigen Noten
  des Akkords bleiben grau.
- **Gespeichert werden nur durchgesungene Durchgänge** vom Anfang des Stücks
  oder des Loops bis zu seinem Ende, ohne Sprung, Tempowechsel oder
  Warte-Modus – nur die Zusammenfassung, kein Ton. Höchstens 200 je Person,
  Partitur, Stufe und Taktbereich; die ältesten gehen zuerst. Wer das Konto
  löscht, löscht sie. Niemand sonst sieht sie, auch keine Leitung und keine
  Verwaltung.

### Für Stimmen freigegebene Aufnahmen

- **Nur Leitungen geben frei, und nur ihre eigenen Aufnahmen.** Zurücknehmen
  geht immer, auch nach dem Verlust der Rolle; Löschen bleibt bei der Person,
  die aufgenommen hat. Die Aufnahme zählt weiter gegen deren Speichergrenzen.
- **Freigegeben heißt: alle mit Zugriff auf die Datei können sie abrufen.**
  Welche Stimmen sie sehen, entscheidet der Browser wie bei Stimmnotizen –
  wer keine Stimme gewählt hat, sieht sie gedimmt, mit dem Namen der Stimme.

### Mobil

- **Kein Mikrofon in der Android-App.** Ihre WebView gibt es nicht frei
  (Quellcode: kein `RECORD_AUDIO`, kein `onPermissionRequest`), und ScoreView
  kann das nicht ändern. Aufnahme und Intonation gehen dort über „Im Browser
  öffnen“. Für die iOS-App spricht der Quellcode dafür, dass es mit einer
  Systemrückfrage bei jedem Öffnen geht; gemessen ist es nicht.
- **„Im Browser öffnen“ ist am Android- und am iOS-Gerät ungeprüft**, ebenso,
  ob ein Pedal in der WebView den Fokus bekommt.
- **Ein Wechsel des Begleit-Geheimnisses wirkt nach bis zu 3 s**, solange der
  Server den alten Wert noch aus APCu liest.
- **Ein Telefon quer behält nur einen Teil seiner Höhe für die Noten.** Wo die
  Bedienleiste 15 % oder mehr der Höhe des Viewers belegt, fährt sie während
  der Wiedergabe, im Aufführungsmodus und beim Folgen einer Leitung zu einer
  dünnen Fortschrittslinie ein, wie im Vollbild; ein Tipp auf die Linie holt
  sie zurück. Was bleibt, gehört nicht ScoreView: Safaris eigene Leisten (eine
  Webseite kann am iPhone nicht ins Vollbild, und Safari verkleinert seine
  Leisten nur, wenn die Seite selbst scrollt) und Nextclouds Viewer, der 50 px
  für seine Kopfzeile mit Dateiname und ✕ und weitere 50 px unter den Noten
  freihält. Gemessen in Files mit einem Chromium, das ein Telefon quer
  nachbildet (844 × 340 px, also nach rund 50 px Safari-Leisten): Der Viewer
  bekommt 240 px, die stehende Leiste belegt 59 davon, und zur 8-px-Linie
  eingefahren wächst die Notenfläche von 132 auf 183 px. Am iPhone ist das
  nicht gemessen ([Fehlersuche](troubleshooting.de.md#am-telefon-quer-bleibt-den-noten-wenig-höhe)).
  Der Vollbildknopf schaltet dort, wo der Browser kein Vollbild anbietet wie
  am iPhone, ein Vollbild innerhalb der Seite: Der Viewer bedeckt dann auch
  Nextclouds Kopf- und Fußzeile, und die Leiste fährt auch hochkant ein.
  Geprüft in einem Chromium mit abgeschalteter Vollbild-API (390 × 700 px:
  Der Viewer wächst von 600 auf 700 px); nicht am iPhone.

### Offene Prüfungen

Umgesetzt und im Browser geprüft, aber **nicht am Gerät**:

- alle Gerätetests der mobilen Apps zu Setliste, Leiten, Folgen und Mikrofon
  (Android über `adb reverse`, siehe oben; ein iOS-Gerät fehlt ganz);
- das Wachhalten des Bildschirms im Aufführungsmodus und beim Folgen – ohne
  Fenster nur gegen eine nachgebaute `navigator.wakeLock` geprüft;
- eine ganze Probe mit echten Stimmen, echtem WLAN und `notify_push`;
- die Geräteabnahme der Übe- und Lesefunktionen am Galaxy S23, siehe
  [Am Gerät offen](#am-gerät-offen);
- das Stimmgerät mit einer echten Stimme am Galaxy S23 und die
  Metronom-Unterteilungen über Bluetooth;
- Zählzeiten und Loop-Fokus am Galaxy S23 bei Seitenbreite sowie die
  Stilkosten der Zählzeiten während der Wiedergabe (sie sind SVG-Text, also
  werden keine erwartet, gemessen ist es nicht);
- der Druck aus Safari auf iPadOS („Teilen → Drucken“): ob der Dialog das
  Seitenformat aus der Partitur übernimmt und ohne leeres letztes Blatt endet.

## Üben und Lesen auf dem Handy

### Übe-Tracks

| Messung | Ergebnis |
|---|---|
| Export in der App, Desktop-Chromium: Chorsatz mit 5 Stimmen | 76 s Musik in **7 s**, 1,24 MB |
| Messaufbau mit demselben Kern (spessasynth im Worker, lamejs, 128 kbit/s), Desktop | 76 s in 6,7 s · 191 s in 14,2 s (3,08 MB) |
| derselbe Messaufbau, Galaxy S23, Chrome | 76 s in 8,3 s · 191 s in **15,9 s**, davon 11,8 s Kodieren |

- **Das Kodieren kostet rund dreimal so viel wie das Rendern.** Am S23 dauert
  der Export 10–25 % länger als am Desktop. Ein Mittelklassegerät ist nicht
  gemessen; das Ziel „4 min Musik in höchstens 60 s“ ist am S23 mit großem
  Abstand erfüllt.
- **Rund 1 MB je Minute Musik** (128 kbit/s stereo). Die Grenze
  `practice_track_max_mb` (Vorgabe 60 MB) reicht damit für eine Stunde. Der
  Webserver vor Nextcloud muss Anfragen dieser Größe annehmen
  ([Installation](installation.de.md#übe-tracks-und-offline-seite)).
- **Ein Track zählt gegen das Kontingent der Ordnerbesitzerin** – bei einem
  geteilten Ordner also gegen das der Person, der er gehört. Die App hat dafür
  keine eigene Grenze und räumt keine Tracks auf.
- **Tracks für alle Stimmen ersetzen ohne Rückfrage**, was im Unterordner
  „Übe-Tracks“ unter demselben Namen liegt; ein einzelner Track fragt vorher.
- **Der Name des Unterordners folgt der Voreinstellungssprache der Instanz.**
  Wechselt sie, entsteht beim nächsten Mal ein zweiter Ordner.
- **Mobil nur neben die Partitur.** Mit dem Token der App gibt es keinen frei
  gewählten Ordner (keine Dateiauswahl ohne Sitzung), aus einem Stück einer
  Setliste heraus (Begleit-Token) gar keinen Export.

### Sperrbildschirm

Gemessen am Galaxy S23: Die Wiedergabe **läuft bei gesperrtem Bildschirm
weiter**, in Chrome (rund 10 s gesperrt, lückenlos) und in der Nextcloud-App
(von Hand). Eine **Steuerung auf dem Sperrbildschirm erscheint für Web Audio
nicht**, auch nicht über ein `<audio>` mit `MediaStream`, und die
Kopfhörertaste wirkt nicht. Daran kann die App nichts ändern; der Ausweg ist
der Übe-Track, den jeder Player mit Steuerung abspielt. Eine Sperre über
mehrere Minuten ist nicht gemessen.

### Darstellungen

- **Liedtext-Ansicht und Tonnamen nur mit den Daten der Engine.** Sie brauchen
  `lyricSyllables` bzw. `noteSpellings`, und die schreibt nur die Engine – auf
  dem lokalen Konvertierungsweg, auf dem Sidecar mit der Engine und beim
  Rückfall im Browser. Mit MuseScore selbst auf dem Sidecar sind beide nicht
  wählbar und sagen warum; eine Neukonvertierung
  dort ändert daran nichts
  ([E15](architecture.md#e15-fähigkeiten-statt-weg)). Das Systemband geht auf
  beiden Wegen.
- **Ein Cache-Eintrag unter `CURRENT_FORMAT_VERSION` 5** wird beim nächsten
  Öffnen neu konvertiert und bekommt dabei die Listen.
- **Zählzeiten brauchen ebenfalls die Engine**: die Taktart je Takt und einen
  Tick je Akkord (`measureFacts`, `noteSpellings[].tick`). Mit MuseScore
  selbst auf dem Sidecar sagt die Einstellung, warum es sie nicht gibt. Die Zahlen folgen
  einer Stimme (der ersten) und stehen in einer Reihe über der Notenzeile:
  „1 2 3 4“ auf den Schlägen, „+“ auf den Hälften dazwischen in einfachen
  Taktarten, jedes Achtel nummeriert in zusammengesetzten; Triolen,
  Sechzehntel und alles andere außerhalb dieses Rasters bleiben leer statt
  falsch. Ein Auftakt wird von seinem Ende her gezählt. Die Lesbarkeit am
  Telefon bei Seitenbreite ist nicht geprüft
  ([Offene Prüfungen](#offene-prüfungen)).
- **Über 20 000 Silben gibt es keine Liedtext-Ansicht** – die Engine lässt die
  Liste dann ganz weg, statt sie abzuschneiden.
- **Die gesungene Strophe folgt den ausgerollten Wiederholungen:** Das n-te
  Auftreten einer Stelle singt Strophe n. Wo eine Partitur Strophen über
  Sprünge verteilt, die nicht ausgerollt werden (D.C./D.S., siehe
  [Bekannte Lücken](#bekannte-lücken)), leuchtet die falsche Strophe.
- **Stilkosten des Notenbilds:** Jedes Seiten-SVG liegt in einem eigenen
  Dokument (einem Rahmen ohne Quelle), außer Reichweite von Nextclouds rund
  1900 globalen Selektoren, und auf einer eigenen Compositor-Ebene. Gemessen
  an vier Seiten eines Chorsatzes (14 100 SVG-Knoten): Eine Änderung in der
  Leiste prüft rund 650–930 Elemente neu statt 17 300. In einem Fenster in
  Handygröße bei vierfach gedrosselter CPU öffnet das Menü „Tools“ in
  240–420 ms (mit dem Notenbild in einem Shadow-Root: 580–1080 ms) und
  schließt in rund 200 ms (500–550 ms). Während der Wiedergabe ist der
  Hauptthread am Desktop rund 110 ms je Sekunde belegt, im Fenster in
  Handygröße 300–320 ms (vorher Seiten 430, Band 480 ms). Der Pinch-Zoom
  zeigt, solange sich die Finger bewegen, eine skalierte Vorschau und setzt
  die Seiten erst beim Loslassen einmal neu. Am Galaxy S23 (Chrome,
  Energiesparmodus an) läuft ein Pinch auf den Seiten mit 50 fps und im
  Systemband mit 39 fps (mit Layout in jedem Bild: 37 und 27 fps).
- **Systemband:** gemessen an einem Chorsatz mit 10 Systemen, Scrollen mit
  rund 60 fps am Desktop. Am Galaxy S23 (Chrome, ohne Energiesparmodus)
  während der Wiedergabe: Seiten 49 fps (10 % der Bilder über 33 ms),
  Systemband 33 fps (p95 67 ms). In Files kostet **jede Änderung eines
  `style`-Attributs und jedes Ersetzen von Kindknoten** eine
  Stil-Neuberechnung über rund 7000 Elemente (Nextclouds `:has()`-Regeln,
  u. a. mit `[style*=…]`, an `body` und am Viewer; gemessen ~70 ms je
  Änderung am Desktop). Was sich während der Wiedergabe bewegt, vermeidet
  beides: Cursor und Fortschrittslinie sind SVG-Rechtecke, die Zeitanzeige
  ändert nur ihren Textknoten (`directives/nodeText.js`), der
  Positionsregler läuft in 250-ms-Schritten. Am Desktop bleiben damit 19 ms
  Stilzeit je 4 s Wiedergabe. Das Band bleibt teurer als die Seitenansicht:
  Es färbt die klingenden Noten in drei geladenen Seiten-SVGs (am S23 rund
  1,5 s Stilzeit je 15 s). Im Energiesparmodus drosselt das Telefon schon
  eine leere Seite auf 24 fps.
  Die Grenzen der Systeme kommen aus den Notenlinien, mit begrenztem Rand
  darüber und darunter – was weit darüber hinausragt, kann angeschnitten
  werden.
- **Zwei Seiten nebeneinander** nur in der Seitenansicht und erst ab einer
  Notenfläche von 900 px Breite – gemessen an der Fläche, nicht am Gerät: Ein
  Telefon quer bleibt einspaltig, ein schmales Desktop-Fenster auch. Die
  Einstellung (aus, Seite 1 links, Seite 1 rechts) sagt, was über dieser
  Breite geschieht; darunter nennt sie den Grund. Wer über das Paar hinaus
  hineinzoomt, schiebt waagerecht, die Reihe klappt nicht in eine Spalte um.
  Geblättert wird reihenweise; eine Reihe, die höher ist als der Ausschnitt,
  nach Systemen.
- **Tonnamen stehen links neben dem Kopf**, wo Platz ist; sonst darunter,
  darüber oder rechts davon (`lib/noteLabelLayout.js`). Hindernisse sind
  Vorzeichen, Wiederholungspunkte, Hälse, Punkte, Pausen, Liedtext und
  Nachbarköpfe; Bögen, Balken und Hilfslinien nicht. Die Breite eines Namens
  ist geschätzt, nicht gemessen. Bei Seitenbreite am Telefon (Köpfe rund
  4 px) bleiben sie bei 9 px und drängen sich – lesbar werden sie erst mit
  Zoom, bei Systemhöhe etwa 16 px.
- **„Nur meine Stimme“ bei Tonnamen** wirkt nur, wo sich Notenzeilen den
  Stimmen zuordnen lassen; sonst stehen Namen an allen Zeilen.
- **Passt die Zahl der Köpfe eines Segments nicht zur Liste**, bleibt dieses
  Segment ohne Namen und ohne Ton beim Antippen, statt falsche zu zeigen.

### Drucken

Die Druckseite hält alle Seiten einer Partitur zugleich und überlässt den Rest
dem Druckdialog des Browsers
([E16](architecture.md#e16-drucken-aus-den-seiten-svgs)). Gemessen in einem
Desktop-Chromium:

| Partitur | Seiten | SVG gesamt | DOM-Knoten | Bereit | PDF | PDF-Größe | Speicher des Tabs |
|---|---|---|---|---|---|---|---|
| Chorsatz | 4 | 0,8 MB | 9 900 | 0,7 s | 0,4 s | 0,9 MB, 4 Seiten, A4 | +60 MB |
| Chorsatz | 28 | 3,2 MB | 33 000 | 0,5 s (Artefakte im Cache) | 0,5 s | 0,8 MB, 28 Seiten | +150 MB |

Die PDF hält die Noten als Vektorpfade – in keiner der beiden Dateien fanden
sich Bildobjekte. Abgeleitet: rund 5 MB Speicher je Seite; eine Obergrenze gibt
es nicht, eine 100-seitige Partitur sollte deutlich unter 1 GB bleiben.

- **Nur im Browser, mit Sitzung.** Die mobilen Apps drucken über „Im Browser
  öffnen“; die Offline-Seite hat keinen Druckknopf – ihr Service Worker
  deckt die Druckseite nicht ab.
- **Wo der Browser konvertiert** ([Konvertierung im Browser](#konvertierung-im-browser)),
  konvertiert die Druckseite die Partitur erneut: Auf diesem Weg gibt es
  keinen Cache, und die Engine (rund 7 MB) wird je Browser einmal geladen.
- **Seitenformat aus der Partitur.** `@page` nimmt die Größe aus `meta.json`;
  das Blatt ist so breit wie die Seite der Partitur, ohne Browserränder.
  Chromium hält sich daran. Ob Safari auf iPadOS das Seitenformat von der
  Seite übernimmt, ist **ungeprüft** ([Offene Prüfungen](#offene-prüfungen)).
- **Gedruckt wird nichts, bevor jedes Blatt geladen ist**; der Druckknopf
  bleibt bis dahin gesperrt.
- **Notizen und Stempel sind voreingestellt aus** und werden je Druck
  eingeschaltet; „Tonnamen“ folgt der Einstellung des Viewers, und „nur meine
  Stimme“ braucht Notenzeilen, die sich Stimmen zuordnen lassen, wie im
  Viewer. Die Blätter sind immer hell, gleich welches Notenthema der
  Bildschirm zeigt.
- **Was auch der Viewer nicht aufs Papier bringt:** Cursor, Loop-Marken, die
  Hervorhebung von „meine Stimme“, Intonationsfarben.

### PDF-Datei

„Als PDF in Dateien speichern“ auf der Druckseite schreibt die PDF im Browser
und legt sie neben die Partitur
([E16](architecture.md#e16-drucken-aus-den-seiten-svgs)). Gemessen in einem
Desktop-Chromium mit dem eigenen Schreiber der App:

| Partitur | Seiten | Weg | Schreiben | PDF-Größe | Abweichende Pixel gegen das SVG |
|---|---|---|---|---|---|
| Chorsatz | 4 | Engine / Sidecar | 0,6 s / 0,6 s | 0,7 MB / 1,2 MB | höchstens 0,012 % je Seite |
| Chorsatz | 28 | Engine / Sidecar | 0,9 s / 0,6 s | 0,7 MB / 2,0 MB | höchstens 0,004 % je Seite |
| Partitur mit einem PNG und einem JPEG | 1 | Engine / Sidecar | 0,2 s / 0,1 s | 20 KB / 30 KB | 0,000 % |

Verglichen wurde bei 100 dpi mit einem Pixel Toleranz für die Kantenglättung.
In der App, vom Klick bis zur Datei in Files (Seiten erneut laden,
schreiben, hochladen), dauerte es 0,8–1,0 s für die 4 Seiten und 1,0–1,7 s
für die 28 Seiten, auf beiden Wegen.

- **Nur das Notenbild.** Notizen, Stempel, Tonnamen und Zählzeiten stehen
  nicht in der Datei; die trägt der Druckdialog.
- **Vektor, keine eingebettete Schrift:** Text in der PDF lässt sich nicht
  markieren oder durchsuchen, wie beim Druckdialog.
- **Unterstützt** ist das SVG, das beide Konvertierungswege schreiben: Pfade,
  Polylinien, Polygone, Glyphen, Matrizen, eingebettete Bilder. Alles andere
  (Text, Verläufe, Clip-Pfade, Bögen, Transparenz) nennt die Druckseite und
  lässt es weg, statt es anzunähern.
- **Bilder:** JPEG unverändert; PNG, GIF und BMP als RGB auf Weiß – ein
  durchsichtiges Bild bekommt weißen Grund.
- **Größe je Datei** `pdf_max_mb` (Vorgabe 50 MB, 5–500).
- **Ohne `CompressionStream`** (ältere Browser) wird unkomprimiert
  geschrieben, etwa dreimal so groß.
- **Nur wo neben der Partitur angelegt werden darf;** sonst fehlt der Knopf,
  ebenso auf der Seite der mobilen Apps (sie hat keine Druckseite).
- **Ein zweites Speichern fragt,** ob ersetzt werden soll; still
  überschrieben wird nichts.

### Suche

Titel, Untertitel, Komponist und Textdichter einer Partitur findet die
globale Suche von Nextcloud
([E17](architecture.md#e17-suche-über-die-konvertierungstabelle)).

- **Nur auf dem Server konvertierte Partituren.** Eine im Browser
  konvertierte ([Konvertierung im Browser](#konvertierung-im-browser)) hat
  keinen Eintrag und ist nur über ihren Dateinamen zu finden, mit Nextclouds
  eigener Dateisuche.
- **Partituren von vor 1.18** füllt das Update einmal aus dem, was ihre
  Konvertierung schon hat – ohne Neukonvertierung. Eine Partitur ohne Titel
  und Komponist bietet nichts zum Finden.
- **Rechte werden beim Lesen geprüft:** Ein Treffer außerhalb der eigenen
  Dateien fällt spurlos weg; eine nur-lesend geteilte Partitur wird gefunden.
- **Teilwortsuche, kein Volltextindex.** Durchsucht werden die vier Felder
  oben in Kleinbuchstaben, höchstens 1024 Bytes; kein Liedtext. Für eine
  Chor-Instanz mit hunderten Partituren sind das Millisekunden; zehntausende
  bräuchten einen Index.
- **Das Symbol eines Treffers** ist das Dateisymbol, das Nextcloud für
  `.mscz` hat; ein Vorschaubild einer Partitur gibt es nicht.

### Offline

Gemessen ist das Muster am Desktop und im Handybrowser (Galaxy S23, Chrome):
Der Worker registriert sich, steuert die Offline-Seite, und nach dem Trennen
vom Netz kommt die Seite aus dem Cache.

| Messung | Ergebnis |
|---|---|
| Speicher, den der Browser zuteilt | Desktop 7,8 GB · S23 **10,7 GB**; 300 MB in 1,3 s geschrieben |
| `navigator.storage.persist()` | **verweigert** (Desktop und S23) |
| Platz | das SoundFont einmal für alle Einträge (~23 MB, aus dem Sidecar ~40 MB), dazu je Partitur ihr Cache, siehe [Gemessene Werte](#gemessene-werte) |

- **Der Browser darf Vorgemerktes räumen.** Weil `persist()` verweigert wird,
  kann er den Cache bei Platzmangel löschen. Die Offline-Seite erkennt das
  („Vom Browser entfernt“) und sagt es; vor einem Konzert die Seite noch einmal
  mit Netz öffnen.
- **Abmelden räumt in Chrome nicht sofort.** Nextcloud schickt
  `Clear-Site-Data` beim Abmelden nur über HTTPS und nie an Chrome, auch nicht
  an Chrome auf Android; gemessen bleiben Cache und Worker dort nach dem
  Abmelden liegen. Die App räumt erst, wenn die Offline-Seite das nächste Mal
  **mit Netz** aufgerufen und zum Login umgeleitet wird
  ([S10](architecture.md#s10-vorgemerktes-gehört-einem-konto-und-verschwindet-mit-der-anmeldung)).
  Bis dahin bleibt die zwischengespeicherte Offline-Seite samt Vorgemerktem
  auf diesem Gerät **ohne Netz lesbar**, auch nach dem Abmelden – einschließlich
  der Kennung (`uid`) der zuletzt angemeldeten Person. Eine Umleitung auf ein
  Captive Portal oder eine SSO-Zwischenseite räumt bewusst nicht. Folge: ein
  Konto je Browser bzw. Gerät, und auf geteilten Geräten nichts vormerken.
- **Ein Konto je Offline-Cache.** Merkt im selben Browser ein anderes Konto
  vor oder öffnet es die Offline-Seite, löscht die App die Einträge des
  vorigen samt aller ihrer URLs; auch eigene Einträge, die davon etwas
  mitbenutzten (etwa das SoundFont), gelten danach als beschädigt.
- **Nur im Browser, nicht in den mobilen Apps.** Die Direct-Editing-Seite hat
  keinen eigenen Pfad für einen Worker; dort gibt es kein Vormerken. Ob die
  WebView der Android-App überhaupt Service Worker zulässt, ist nicht geprüft.
- **Einmal mit Netz öffnen.** Die Offline-Seite richtet sich beim ersten
  Besuch mit Netz ein. Wer vormerkt, die Seite aber nie online geöffnet hat,
  bekommt ohne Netz die Fehlerseite des Browsers.
- **Aktualisiert wird nur beim Öffnen der Offline-Seite mit Netz**, nicht im
  Hintergrund. Ändert sich eine Partitur danach, zeigt das Gerät ohne Netz den
  vorgemerkten Stand.
- **Offline fehlt, was einen Server braucht:** Notizen und Stempel setzen
  (vorgemerkte erscheinen im Stand des Vormerkens), Leitung und „Folgt mir“,
  Aufnahme und Intonation, Übe-Tracks, Vormerken und Setlisten bearbeiten.
  Wiedergabe, Mixer, Loop, Tempo, Metronom, Anfangston, Transposition, Coach
  und die Darstellungen gehen.

### Am Gerät offen

Am Galaxy S23 im Browser (Chrome) abgenommen: Übe-Track in 8,8 s
(Duckwerk, ganzer Mix), Vormerken in 1,1 s, die Offline-Seite und die
Wiedergabe ohne erreichbaren Server, Systemband, Liedtext-Ansicht und
Tonnamen im Bild. In der Nextcloud-App (Android) folgt das S23 einer
Leitung im Browser über den Wechsel zum nächsten Stück der Setliste hinweg
(Begleit-Token für das neue Stück). **Noch offen:**

- eine Sperre über mehrere Minuten bei laufender Wiedergabe;
- ein Übe-Track aus der Nextcloud-App heraus und an einem Mittelklassegerät;
- der Stückwechsel mit drei Folgegeräten zugleich;
- ein Pedal im Systemband – Tasten erreichen den Viewer nur, wenn er den
  Fokus hat, wie beim Blättern der Seiten.

## Darstellungsvarianten

Eine Stimme für sich, Seiten in Handygröße, klingende Notation und Noten,
die mit dem Klang mittransponiert werden – jeweils von MuseScore selbst
gesetzt, bei Bedarf ([E19](architecture.md#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)).
Verfügbar auf dem lokalen Konvertierungsweg, auf dem Sidecar mit der Engine
und im Rückfall im Browser; ein Sidecar, der mit MuseScore selbst konvertiert,
setzt keine, dort bleibt die Wahl ausgegraut und nennt den Grund.

Gemessen auf der Testinstanz (Node 20.19, die eigene Testpartitur
`parts-test.mscz`, 24 Takte, fünf Notenzeilen):

| | Seiten | Zeit je Lauf |
|---|---|---|
| Partitur, wie in der Datei | 3 | – (Grundkonvertierung) |
| Gespeicherter Auszug „Frauenstimmen“ (zwei Notenzeilen) | 1 | 3–4 s |
| Erzeugte Klarinettenstimme, Handyseite, einen Ton tiefer | 1 | 3–4 s |
| Partitur auf Handyseiten, hochkant oder quer | 7 | 3–4 s |
| Partitur klingend notiert | 3 | 3–4 s |

- **Je Lauf 3–4 s auf dem Server**, gemessen über die Variantenroute samt
  Anfrage (auf der langsamen Testinstanz rund 6 s, davon 1,5 s deren
  Anfragezeit). Eine schon gesetzte Variante antwortet wie jedes andere
  gecachte Artefakt. Unter Deno 2.9: 4,3 s. Über den Sidecar mit der Engine
  (Node 22 im Image): 3,9 s über die Variantenroute, also dasselbe.
- **Speicher**: Eine erzeugte Stimme braucht weniger als die
  Grundkonvertierung – 122–124 gegenüber 174–190 MB Prozessspeicher bei
  vier- und fünfseitigen Chorsätzen.
- **Handyseiten brauchen etwa 2,3-mal so viele Seiten** wie A4 (7 statt 3);
  die Noten erscheinen auf einem hochkant gehaltenen Handy etwa doppelt so
  groß.
- **Höchstens 8 Varianten je Fassung** bleiben liegen, die am längsten nicht
  geöffnete fällt zuerst weg; **höchstens 20 neue Läufe je Person und Stunde**
  (S4). Das Abrufen einer vorhandenen Variante zählt nicht.
- **Notizen und Stempel** werden gegen die Partitur gespeichert, gleich, was
  beim Anlegen zu sehen war; eine Variante zeigt sie an derselben Note, oder
  am Takt, wo sie diese Note nicht hat. Stempel für Stimmen erscheinen nur auf
  den Notenzeilen, die die Variante zeichnet.
- **Endlosansichten wurden gemessen und weggelassen.** MuseScores waagrechte
  und senkrechte Endlosdarstellung setzen die ganze Partitur auf eine Seite:
  bei einem vierseitigen Chorsatz 13 915 statt höchstens 4 170 Knoten in
  einem SVG, 30 Zoomschritte in 980 statt 506 ms – und das wächst mit jeder
  Seite.

Bekannte Schwächen der Handyseiten: Auf einer queren Handyseite passt ein
großes System unter Umständen nicht unter den Titel, der dann seine erste
Seite für sich hat; und der Stimmname, der am linken Rand des Titelrahmens
steht, kann auf der schmalen Hochkant-Seite einen langen Titel überdecken.
Beides ist MuseScores Satz des Rahmens auf kleinem Papier.

## Was die App bewusst nicht tut

- **Kein serverseitiges Rendern auf verwaltetem Hosting.** Der lokale
  Konvertierungsweg braucht eine Node.js-Laufzeit und die Erlaubnis, Prozesse
  zu starten; in PHP allein lässt sich das Wasm-Modul nicht ausführen – die
  Gründe stehen in
  [E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api).
  **Betreibbar ist die App dort trotzdem**, aber anders: Der Browser
  konvertiert ([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)).
  Was dabei entfällt, steht dort und ist kein Kleingedrucktes – es gibt keinen
  Cache, jedes Gerät lädt einmal gut 7 MB (14 MB entpackt) und rechnet jede Partitur bei jedem
  Öffnen neu.
- **Kein Servercache für das, was der Browser gesetzt hat.** Die Artefakte
  aus dem Rückfall gehen nicht zum Server zurück. Ein Upload wäre eine neue
  Vertrauensgrenze – der Server lieferte an alle Leser einer Datei aus, was ein
  einzelner Browser erzeugt hat ([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)).
- **Kein Reflow.** Das Seitenbild ist MuseScores Satz
  ([E2](architecture.md#e2-musescore-svg-statt-neusatz-im-browser)).
  „Seitenbreite einpassen“ und „Ganze Seite einpassen“ skalieren, sie brechen
  nicht um. Handyseiten ([Darstellungsvarianten](#darstellungsvarianten)) sind
  ein fester Satz auf kleinerem Papier, kein Umbruch: auch sie skalieren nur.
  Das Systemband schneidet aus dem Seitenbild aus; umbrechen darf nur der Text
  der Liedtext-Ansicht.
- **Kein Bearbeiten von Partituren.** ScoreView zeigt und spielt; es korrigiert
  nichts in der `.mscz`.
- **Keine Aufnahmen für andere – außer der Leitung, für Stimmen
  vorgesungen.** Eine Aufnahme hört nur, wer sie gemacht hat; sie liegt in den
  App-Daten, nicht in Files. Der einzige Weg hinaus ist eine Leitung, die eine
  eigene Aufnahme für Stimmen freigibt
  ([E21](architecture.md#e21-aufnahmen-der-leitung-für-stimmen)).
  Übe-Tracks sind dagegen synthetisiert und bewusst Dateien in Files
  ([E13](architecture.md#e13-übe-tracks-sind-dateien-in-files)).
- **Keine Rangliste der Übezeit.** Das Übetagebuch zeigt jeder Person nur die
  eigene Zeit ([E20](architecture.md#e20-übetagebuch-ohne-bestenliste)).
- **Kein Long-Polling für „Folgt mir“.** Jedes wartende Gerät belegte einen
  PHP-Worker; abgefragt wird kurz, beschleunigt durch `notify_push`, wo es
  eingerichtet ist ([E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
- **Kein Direct Editor für Markdown.** ScoreView erschiene sonst in den
  mobilen Apps bei jeder `.md`-Datei; Setlisten öffnen sich dort über eine
  Partitur.
- **Kein eigener Einstieg in Partituren.** Eingestiegen wird ausschließlich
  aus Files – über Nextclouds Viewer, die Dateiaktion auf der Endung oder die
  auf `*.setlist.md`
  ([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste))
  – und aus den mobilen Apps über Direct Editing; `/apps/scoreview/`
  antwortet bewusst 404. Die einzige eigene Seite, `/apps/scoreview/offline`,
  zeigt nur Vorgemerktes
  ([E14](architecture.md#e14-eine-offline-seite-mit-eigenem-service-worker)).
  Setlisten sind Dateien in Files, keine eigene Verwaltung der App.
- **Keine Steuerung auf dem Sperrbildschirm für die Wiedergabe im Viewer.**
  Web Audio bekommt sie nicht ([Sperrbildschirm](#sperrbildschirm)); dafür gibt
  es den Übe-Track.
- **Kein transponiertes Notenbild, wenn der Sidecar mit MuseScore selbst
  konvertiert.** Dort wird nur der Klang transponiert; die Noten und die
  Tonnamen bleiben, wie sie geschrieben sind. Mit der Engine – lokal, auf dem
  Sidecar, im Browser – können die Noten mitgehen
  ([Darstellungsvarianten](#darstellungsvarianten)).
- **Kein Stift-/Freihand-Layer.** Notizen sind Text an einem musikalischen Anker.
  Freie Striche wären eine zweite Datenart, deren Anker ein Pfad statt eines
  Punktes sein müsste – und die anders als Text ein Neurendern der Partitur
  nicht übersteht, weil ein Strich an Pixeln hängt und nicht an einem Takt.
- **Keine Stimmenauszüge, wenn der Sidecar mit MuseScore selbst
  konvertiert.** Dort nimmt „Nur meine Zeile" die übrigen Stimmen optisch
  zurück, und die Seite behält ihr Layout samt der Leerräume, wo die anderen
  Zeilen stehen. Mit der Engine wird eine Stimme für sich gesetzt
  ([Darstellungsvarianten](#darstellungsvarianten)).
- **Kein Sandboxing von MuseScore selbst über den Container hinaus.** Der
  Container läuft non-root mit Speicher- und PID-Limit; eine
  Netzwerk-Isolation nur für den Konvertierungs-Subprozess bräuchte eine eigene
  Sandbox-Schicht. Die Engine im selben Container ist weiter eingesperrt, wie
  auf dem lokalen Weg mit Node 22: Jeder Lauf liest nur seine Partitur und
  schreibt nur seine Ausgabe, startet keine Prozesse und sieht nichts von der
  Umgebung des Containers – das Netz bleibt offen, wie in der Tabelle unter
  [Abschottung des lokalen Konverters](#abschottung-des-lokalen-konverters).
  Siehe [Sicherheit](../sidecar/README.md#sicherheit).
- **Nur Deutsch und Englisch.** Eine weitere Sprache ist das Hinzufügen einer
  Datei, keine Umstellung ([E4](architecture.md#e4-englische-quellstrings-deutsch-als-gepflegte-übersetzung)).
- **Keine Verpackung als AppAPI/ExApp.** Der Sidecar läuft als eigener
  Container, nicht von Nextcloud verwaltet.
- **Keine mitgelieferte Node-Laufzeit.** Der lokale Weg benutzt das `node` des
  Servers; die App bringt keines mit und lädt auch keines nach (wie es etwa
  Nextclouds `recognize` tut).
- **Keine CJK-Fonts im App-Store-Paket.** Auf dem lokalen Konvertierungsweg
  setzt MuseScore chinesische, japanische und koreanische Liedtexte deshalb als
  Ersatzkästchen; alles andere ist unberührt. Die Fonts wiegen 4,2 MB, und der
  App Store nimmt Archive nur bis 30 MiB an, von denen das Paket schon rund
  21 MB belegt. Wer sie braucht, legt Fontdateien
  (`.woff2`, `.otf`, `.ttf`, `.ttc`) in ein Verzeichnis **außerhalb der App**
  und trägt es ein:

  ```sh
  occ config:app:set scoreview cjk_font_dir --value=/srv/scoreview-fonts
  ```

  Außerhalb der App, weil das ausgelieferte App-Verzeichnis **signiert** ist –
  jede zusätzliche Datei darin lässt Nextclouds Integritätsprüfung dauerhaft
  Alarm schlagen. Der Sidecar braucht nichts davon, wenn er mit der Engine
  konvertiert: Sein Image kennt keine Größengrenze und bringt die Schriften
  mit, die das App-Paket weglässt (nachgesehen: beide laden unter dem
  Berechtigungsmodell). MuseScore selbst im selben Image hat nur DejaVu und
  FreeFont (19 Fontdateien, keine CJK-Schrift), und es gibt keine Einstellung,
  ihm Fonts nachzureichen.
