# Testpartituren

Material für Tests am Konvertierungsdienst.

**Regel:** `.mscz` und verwandte Formate sind in diesem Verzeichnis
gitignored, weil die Lizenzlage beliebiger Partituren nicht sicher frei ist –
nicht stillschweigend committen, auch nicht versehentlich per `git add -A`.
Wer hier eigenes Material ablegt, um an größeren Partituren zu messen, lässt es
lokal liegen.

## `repeat-test.musicxml` / `repeat-test.mscz`

Die einzige committete Ausnahme: selbst erstellt, lizenzklar, fünf Takte, eine
Stimme. `../selftest-score.mscz` ist eine Kopie davon und wird ins Image gebacken
– sie ist die Partitur, die `GET /selftest` konvertiert.

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
