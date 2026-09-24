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
  (lineare Regression über die drei Messpunkte). Die App wartet auf dem
  Sidecar-Weg fest höchstens 300 s ab dem Einreichen (`ConvertScoreJob`),
  rechnerisch rund 50 Seiten; `MSCORE_TIMEOUT_SECONDS` des Sidecars (Vorgabe
  600 s) liegt darüber und greift nur, wenn er kleiner gesetzt ist. Wer sehr
  große Partituren erwartet, rechnet mit `Seitenzahl × 6 s + Puffer` hoch. Die
  Zahl hängt spürbar von der CPU ab – Größenordnung, keine Garantie.
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
- **Warteschlange des Sidecars:** Höchstens `SCOREVIEW_MAX_QUEUED` (Vorgabe
  30) Aufträge warten; darüber antwortet er 503 mit `Retry-After`, und die App
  versucht es später erneut, statt die Partitur als gescheitert zu markieren.
  Hergeleitet aus der 300-s-Frist bei rund 10 s je Auftrag. Ein wartender
  Auftrag verfällt nach `SCOREVIEW_PENDING_MAX_AGE_SECONDS` (Vorgabe 3600 s).
- **Upload-Limit** (`SCOREVIEW_MAX_UPLOAD_BYTES`, Default 200 MB) liegt weit
  jenseits echter Partituren (größte Testdatei: 114 KB) und schützt nur gegen
  pathologische Uploads. Die App lehnt schon vorher ab: `max_score_bytes`,
  Vorgabe 100 MB, auf beiden Wegen.

**Die Messreihe stammt von 1–5-seitigen Partituren.** Alles darüber ist
Hochrechnung.

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
Ressourcenpaket nicht (4,7 MB). Der Glue selbst wiegt 48 KB.

Die Artefakte sind dieselben: `timing.json`, `measures.json` und `meta.json`
sind Byte für Byte identisch zu `node convert.mjs` derselben Partitur, die
SVG-Seite ist gleich lang (gemessen an der Minipartitur).

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

**Die Bedienung auf Telefonbreite.** Dass der Viewer in den mobilen Apps
überhaupt läuft, ist gemessen (siehe unten). Die Bedienleiste ist auf
Telefonbreite einzeilig – Play, Taktfeld, Anfangston, Schloss und „Mehr“, alles
Weitere steckt im Überlaufmenü –, geprüft in einem Chromium bei 360 × 780 px,
nicht am Gerät. Mixer, Notizen und der Setlisten-Editor sind dort benutzbar,
nicht bequem. Ein eigener Telefon-Modus wäre ein eigenes Vorhaben.

**Die WebView der mobilen Apps.** Gemessen auf einem Samsung Galaxy S23 mit der
Nextcloud-Android-App, Instanz über `adb reverse` als `http://localhost:8134`:
AudioWorklet und WebAssembly laufen, der Ton ist hörbar, `navigator.wakeLock`
wird erteilt. Abgeschaltet ist dort die **Vollbild-API**
(`document.fullscreenEnabled === false`) – der Vollbildknopf erscheint deshalb
nur, wo Vollbild möglich ist. Andere Geräte, andere Android-Versionen und die
iOS-App sind ungeprüft; die Brücke ist für beide Plattformen geschrieben, aber
nur auf Android nachgemessen.

Wichtig für jede Wiederholung dieser Messung: Sie braucht einen **sicheren
Kontext**. Über ein schlichtes `http://<LAN-IP>:8134` fehlen `navigator.wakeLock`
und `audioWorklet` ersatzlos – die Messung fällt dann negativ aus, ohne über
die WebView etwas auszusagen (in Chromium gegengeprüft).

**Der Rückfall im Browser über die mobilen Apps.** Er funktioniert dort
(gemessen), kostet aber dieselben rund 14 MB Engine je Öffnen wie am Desktop –
auf einer Mobilfunkverbindung ist das viel. Wo der Server konvertieren kann,
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
4.7.5 (MuseScore als gepinnter, ungepatchter Submodul-Stand, Qt-frei); sie
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
Bildschirms sind umgesetzt und im Browser verifiziert. Eine erste Erprobung auf
einem Android-Telefon (Chrome und Opera, Ton über Bluetooth-Kopfhörer) hat drei
Dinge gefunden, die auf dem Desktop unsichtbar bleiben. Alle drei sind behoben:

- Der Cursor lief dem Ton um die Ausgabelatenz voraus (Bluetooth). Sie wird
  jetzt ausgeglichen.
- Das automatische Nachführen setzte auf dem Telefon aus und holte ruckweise
  nach, weil die ein- und ausfahrende Browserleiste als manuelles Scrollen galt.
- Die Transportleiste brach auf Telefonbreite auf drei Zeilen um (~18 % der
  Bildschirmhöhe, auch im Vollbild).

**Gemessene Ausgabelatenz**, abgelesen an der Diagnose im Aufklapper
„Darstellung":

| Gerät | Ausgabe | Ausgeglichen |
|---|---|---|
| Android-Telefon | Bluetooth-Kopfhörer | **232 ms** |
| Arbeitsmaschine | eingebaut | **51 ms** |

Beide Werte stammen aus der **Automatik**, bei unangetastetem Regler. Damit ist
die Frage beantwortet, für die es zunächst nur eine Vermutung gab: **Chrome auf
Android meldet den Bluetooth-Anteil der Ausgabelatenz**, die App trägt ihn ohne
Zutun. Bild und Ton passen auf beiden Geräten zusammen.

Der Regler „Bild und Ton abgleichen" bleibt für den Fall, dass ein Kopfhörer
seine Verzögerung nicht selbst nennt – dann fehlt der Automatik genau dieser
Anteil, und er ist nirgends ablesbar außer am eigenen Ohr. **Wie viele
Kopfhörer das betrifft, ist ungeprüft**; gemessen ist ein einziges Paar an
einem einzigen Telefon.

Nicht erprobt ist weiterhin **eine ganze Probe am Notenständer**, und
gegengeprüft ist die Wirkung nur in Chrome – **ob Operas hakendes Scrollen
tatsächlich an der früheren Zeitfenster-Heuristik lag, steht aus.**

**Offlinebetrieb.** Im Probenraum ist WLAN oft schlecht oder gar nicht vorhanden.
Die Artefakte sind unveränderlich und aggressiv cachebar, was günstig ist – aber
Nextclouds Viewer ist keine installierbare Web-App, und das SoundFont wiegt
~23 MB (Vorgabe) bzw. ~40 MB (aus dem Sidecar). Ob die App ohne Netz brauchbar ist, ist ungeprüft.

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
- **Ohne laufende Sitzung** fragt ein Gerät nur alle 15 s, ob eine begonnen hat.
  Wer den Viewer vor der Leitung öffnet, folgt also erst nach bis zu 15 s. In
  einem Tab im Hintergrund fragt es dann gar nicht und holt die Frage beim
  Zurückkehren sofort nach.
- **Starten, Beenden und Beitreten sind auf je 30 Aufrufe je Minute
  begrenzt**, das Senden der Stelle auf 120. Mobile Apps zählen dabei je
  IP-Adresse (siehe unten bei der Leitung).
- **Mehrere Webserver ohne verteilten Cache:** Der lokale Cache gilt dann
  höchstens eine Sekunde, danach liest der nächste Aufruf die Datenbank –
  ein Lesezugriff je Sekunde und Datei (siehe
  [E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).

### Leitung

- **Eine Leitung kraft Schreibrecht erscheint nicht in der Liste der
  Leitungen** (Dateien ohne Eigentümerin, etwa in Gruppenordnern). Sie hat die
  Rolle trotzdem; die Liste zeigt die Eigentümerin und die Ernannten.
- **Die Suche nach Personen zum Ernennen ist auf 30 Aufrufe je Minute
  begrenzt.** Anfragen aus den mobilen Apps sind für Nextclouds Begrenzung
  anonym und zählen je IP-Adresse – ein ganzer Chor hinter einem NAT teilt sich
  dieses Kontingent. Gesucht wird ohnehin nur von Leitungen.

### Notizen

- **Höchstens 500 Notizen je Person und Partitur**, alle Sichtbarkeiten und
  Stempel zusammen; darüber antwortet der Server 409. Zwei gleichzeitige
  Anfragen können die Grenze um eine Notiz überschreiten.
- **Anlegen und Ändern sind auf je 60 Aufrufe je Minute begrenzt** – wer
  Stempel sehr schnell hintereinander setzt, bekommt kurz „Zu viele Änderungen“.

### Setliste

- **Grenzen:** höchstens 256 KB und 200 Einträge je Setliste. Aus einer
  Partitur heraus („Weg 2“) sucht der Viewer nur im Ordner dieser Partitur und
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
- **Die Referenzstimmung ist fest: a' = 440 Hz.** Ein Chor, der als Ganzes
  absinkt, wird gegen 440 bewertet, nicht gegen sich selbst.
- **Oktaven werden gefaltet.** Ein Tenor, der die Altstimme eine Oktave tiefer
  singt, singt sie richtig; eine Oktave daneben fällt also nicht auf.
- **Farbige Notenköpfe nur auf dem lokalen Konvertierungsweg**, und nur, wo
  jede Stimme eine eigene Notenzeile hat. Sonst bleibt es ohne Fehlermeldung
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
  sieht ([Installation](installation.md#probe-und-konzert)).
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

- **Auf dem Sidecar-Weg kein Dur/Moll beim Grundton.** Stock-MuseScore schreibt
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

### Offene Prüfungen

Umgesetzt und im Browser geprüft, aber **nicht am Gerät**:

- alle Gerätetests der mobilen Apps zu Setliste, Leiten, Folgen und Mikrofon
  (Android über `adb reverse`, siehe oben; ein iOS-Gerät fehlt ganz);
- das Wachhalten des Bildschirms im Aufführungsmodus und beim Folgen – ohne
  Fenster nur gegen eine nachgebaute `navigator.wakeLock` geprüft;
- eine ganze Probe mit echten Stimmen, echtem WLAN und `notify_push`.

## Was die App bewusst nicht tut

- **Kein serverseitiges Rendern auf verwaltetem Hosting.** Der lokale
  Konvertierungsweg braucht eine Node.js-Laufzeit und die Erlaubnis, Prozesse
  zu starten; in PHP allein lässt sich das Wasm-Modul nicht ausführen – die
  Gründe stehen in
  [E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api).
  **Betreibbar ist die App dort trotzdem**, aber anders: Der Browser
  konvertiert ([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)).
  Was dabei entfällt, steht dort und ist kein Kleingedrucktes – es gibt keinen
  Cache, jedes Gerät lädt einmal rund 14 MB und rechnet jede Partitur bei jedem
  Öffnen neu.
- **Kein Servercache für das, was der Browser gesetzt hat.** Die Artefakte
  aus dem Rückfall gehen nicht zum Server zurück. Ein Upload wäre eine neue
  Vertrauensgrenze – der Server lieferte an alle Leser einer Datei aus, was ein
  einzelner Browser erzeugt hat ([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)).
- **Kein Reflow.** Das Seitenbild ist MuseScores A4-Satz
  ([E2](architecture.md#e2-musescore-svg-statt-neusatz-im-browser)).
  „Bildschirmfüllend" ist eine Skalierung, kein Umbruch. Echter Umbruch bräuchte
  ein zweites serverseitiges Layout.
- **Kein Bearbeiten von Partituren.** ScoreView zeigt und spielt; es korrigiert
  nichts in der `.mscz`.
- **Keine Aufnahmen für andere.** Eine Aufnahme hört nur, wer sie gemacht hat;
  sie liegt in den App-Daten, nicht in Files, und lässt sich nicht teilen.
- **Kein Long-Polling für „Folgt mir“.** Jedes wartende Gerät belegte einen
  PHP-Worker; abgefragt wird kurz, beschleunigt durch `notify_push`, wo es
  eingerichtet ist ([E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
- **Kein Direct Editor für Markdown.** ScoreView erschiene sonst in den
  mobilen Apps bei jeder `.md`-Datei; Setlisten öffnen sich dort über eine
  Partitur.
- **Keine eigene Seite in Nextcloud.** Eingestiegen wird ausschließlich aus
  Files – über Nextclouds Viewer, die Dateiaktion auf der Endung oder die auf
  `*.setlist.md`
  ([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste))
  – und aus den mobilen Apps über Direct Editing; `/apps/scoreview/`
  antwortet bewusst 404. Setlisten sind Dateien in Files, keine eigene
  Verwaltung der App.
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
