# Testpartituren

Material für Tests am Konvertierungsdienst.

**Regel:** `.mscz` und verwandte Formate sind in diesem Verzeichnis
gitignored, weil die Lizenzlage beliebiger Partituren nicht sicher frei ist –
nicht stillschweigend committen, auch nicht versehentlich per `git add -A`.
Wer hier eigenes Material ablegt, um an größeren Partituren zu messen, lässt es
lokal liegen.

## `repeat-test.musicxml` / `repeat-test.mscz`

Eine der zwei committeten Ausnahmen: selbst erstellt, lizenzklar, fünf Takte, eine
Stimme. `scoreview/converter/selftest-score.mscz` ist eine Kopie davon: die
Partitur des Selbsttests auf dem lokalen Weg und im Image die, die
`GET /selftest` mit MuseScore konvertiert.

Struktur: Takt 1 (Wiederholungsanfang) · Takt 2 (Volta 1, Wiederholungsende) ·
Takt 3 (Volta 2) · Takt 4 („Fine") · Takt 5 („D.C. al Fine"). Damit deckt sie
genau die Zusage ab, auf der der Cursor steht: Wiederholungen und Volten müssen
sich in mehrfach auftretende `elid`-Events ausrollen.

Die `.mscz` entsteht reproduzierbar aus der MusicXML-Quelle:

```sh
mscore4portable repeat-test.musicxml -o repeat-test.mscz
```

Sie liegt trotzdem bei, damit `--score-media` ohne Zwischenschritt direkt darauf
laufen kann.

**Zum D.C.-Teil:** Die Markierung ist als reiner MusicXML-Hinweis
(`<sound dacapo="yes"/>`) codiert. MuseScore übernimmt das beim Import **nicht**
als Sprunganweisung, sondern nur als Text – ein echter Sprungtest bräuchte eine
in der MuseScore-GUI angelegte Jump/Marker-Struktur. Deshalb bleibt der
D.C.-Fall ungeprüft, siehe
[M7](../../docs/architecture.md#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht).

## `keys-marks-test.mscz`

Die zweite Ausnahme, ebenfalls selbst erstellt: `repeat-test.mscz` mit zwei
Zusätzen im MSCX – eine Tonart c-Moll (`concertKey` −3, `mode` minor) in
Takt 1 und ein Wechsel nach D-Dur (2, major) in Takt 4, dazu die
Studierbuchstaben A, B und C in den Takten 1, 3 und 4.

`scoreview/converter/keys-marks-test.mscz` ist eine Kopie davon. Der
Selbsttest des lokalen Konvertierungswegs (`node convert.mjs --selftest`)
prüft an ihr die Felder `keySigs` und `rehearsalMarks`, die nur die
scoreview-engine in `meta.json` schreibt. Der Sidecar kennt sie nicht
(Stock-MuseScore) und benutzt die Datei deshalb nicht.

## `lyrics-test.mscz`

Die dritte Ausnahme, selbst erstellt und reproduzierbar aus
`keys-marks-test.mscz` erzeugt (`python lyrics-test.gen.py` in diesem
Verzeichnis): Sopran und Bass, Takt 1–2 dreimal wiederholt mit drei
Strophen, danach ein Schluss „A-men". Zusammen 56 Silben.

`scoreview/converter/lyrics-test.mscz` ist eine Kopie davon. Der Selbsttest
des lokalen Wegs prüft daran `lyricSyllables` und `noteSpellings`: die Zahl
der Silben und Strophen, „Hal-le-lu-ja" mit seinen Silbenarten, dass jede
Silbe auf eine elid aus `timing.json` zeigt und dass die Notenköpfe je
Segment, Notenzeile und Stimme mit dem SVG übereinstimmen. Der Sidecar kennt
diese Felder nicht und benutzt die Datei deshalb nicht.

## `timesig-test.mscz` / `timesig-test.mscx`

Die vierte Ausnahme, von Hand geschrieben (die Quelle liegt als
`timesig-test.mscx` daneben, die `.mscz` ist nur ihr Zip-Container): eine
Stimme, ein Viertel Auftakt in 4/4, ein voller 4/4-Takt, ein 3/4- und ein
6/8-Takt – genau die Takte, bei denen eine Schätzung der Schläge aus der
Taktdauer danebenliegt.

`scoreview/converter/timesig-test.mscz` ist eine Kopie davon. Der Selbsttest
des lokalen Wegs prüft daran `measureFacts` der Engine (ab
`v4.7.5-engine.5`): Taktart und tatsächliche Länge je Takt (480, 1920, 1440,
1440 Ticks) und die aufsteigenden `tick`-Werte der `noteSpellings`. Der
Sidecar kennt das Feld nicht und benutzt die Datei deshalb nicht.

## `parts-test.mscz`

Die fünfte Ausnahme, selbst erstellt (CC0, steht so in der Datei) für die
Darstellungsvarianten
([E19](../../docs/architecture.md#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild)):
Sopran und Alt mit Liedtext, Klarinette in B (transponierend, in den Takten
14–21 eine Pause, im Auszug eine Mehrtaktpause), Klavier auf zwei
Notenzeilen; 24 Takte, eine Wiederholung mit Volta, ein Zeilenumbruch und
ein Abschnittsumbruch nach Takt 12, ab dem MuseScore wieder bei 1 zählt.
Gespeichert sind die Auszüge „Sopran“ und „Frauenstimmen“ (Sopran und Alt);
für Klarinette und Klavier gibt es keinen, die erzeugt die Engine.

Entsteht reproduzierbar mit MuseScore 4.7 selbst, ohne Handarbeit in der
Oberfläche (`MS=<MuseScore4> sh parts-test.build.sh`): `parts-test.gen.py`
schreibt die MusicXML, MuseScore macht daraus die `.mscz`, ein XML-Eingriff
setzt den Abschnittsumbruch, `--score-parts` erzeugt die Auszüge mit ihren
Verknüpfungen zur Partitur (`<linkedTo>` auf deren EIDs),
`parts-test.assemble.py` legt sie als gespeicherte Auszüge in die Datei, und
MuseScore speichert das Ergebnis noch einmal – damit ist es eine Datei, die
MuseScore selbst geschrieben hat.

`scoreview/converter/parts-test.mscz` ist eine Kopie davon. Der Selbsttest
des lokalen Wegs prüft daran `excerpts` und `hasTransposingParts` und drei
Varianten gegen die vier Invarianten. Der Sidecar setzt keine Varianten und
benutzt die Datei deshalb nicht.

