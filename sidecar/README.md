# MuseScore Sidecar

Docker-Image mit einer gepinnten MuseScore-Studio-Version (siehe
`Dockerfile`-`ARG`s), die als extrahiertes AppImage headless unter
`xvfb-run` läuft. Standard-Kommando ist die HTTP-API (Paket
`scoreview_sidecar`, gestartet über `wsgi.py` mit gunicorn); der
reine CLI-Modus aus Phase 1 bleibt als manueller Debug-Weg erreichbar
(siehe unten).

## Build

```sh
docker build -t scoreview-musescore-cli sidecar/
```

## HTTP-API (Phase 6: ein `--score-media`-Aufruf statt drei)

Asynchrone Job-API, ein Container läuft dauerhaft. Pflicht-Env-Var
`SCOREVIEW_SIDECAR_SECRET` - startet ohne diese absichtlich **nicht**
(kein unauthentifizierter Konvertierungsdienst).

```sh
MSYS_NO_PATHCONV=1 docker run -d --name scoreview-sidecar \
  -p 8765:8765 \
  -e SCOREVIEW_SIDECAR_SECRET=<zufälliges-secret> \
  --memory=2g --pids-limit=512 \
  scoreview-musescore-cli
```

**Ohne `--network` ist der Sidecar von Nextcloud aus nicht erreichbar.** Auf
Dockers Standard-Bridge gibt es keine Namensauflösung zwischen Containern;
`http://scoreview-sidecar:8765` – die Adresse, die in den Admin-Einstellungen
steht – läuft dann ins Leere, während `curl` vom Host aus tadellos
funktioniert. Der Container startet trotzdem fehlerfrei, und die
Betriebsdiagnose meldet schlicht „Konvertierungsdienst nicht erreichbar".
Beide Container müssen in dasselbe benutzerdefinierte Netz; wie das für die
Testumgebung aufgesetzt ist, steht unten unter „Aktuell laufende
Testumgebung" (`--network scoreview-net`). Der Befehl oben lässt das Flag
bewusst weg, weil der Netzname von der jeweiligen Installation abhängt – er
ist damit aber **kein vollständiger Startbefehl**. (Beim Nachbauen des
Containers in Phase 23/Schritt 5 genau darüber gestolpert.)

`--memory`/`--pids-limit` sind für den Produktivbetrieb empfohlen (Phase 12,
Minimum-Härtung): der Container lässt eine große C++/Qt-Codebasis
(`mscore4portable`) auf beliebigen, nicht vertrauenswürdigen `.mscz`-Uploads
los. Seit Phase 12 läuft der Konvertierungsprozess bereits **nicht mehr als
root** (eigener `scoreview`-Nutzer im Image, siehe `Dockerfile`).
`--network none` (wie ursprünglich im PLAN.md als Minimum genannt) ist
dagegen **nicht möglich**: derselbe Container muss die HTTP-API bedienen,
über die PHP die Konvertierung überhaupt erst einreicht - ganz ohne
Netzwerk gäbe es keinen Weg, den Container anzusprechen. Eine echte
Netzwerk-Isolation nur für den `mscore4portable`-Subprozess (nicht für den
ganzen Container) würde eine eigene Sandbox-Schicht brauchen (z.B. eine
Netzwerk-Namespace-Trennung innerhalb des Containers oder ein separates
Sandbox-Tool) und ist damit ein größeres, noch offenes Architekturthema,
kein einzelnes `docker run`-Flag - siehe PLAN.md Risiken.

Weitere Env-Vars (alle optional):

- `MSCORE_TIMEOUT_SECONDS` (Default `600`) - harter Timeout-Guard pro
  Konvertierung. Der Default lag bis Phase 20 bei `120` und war damit zu
  knapp: gemessen braucht eine Konvertierung **~5,4 s pro gerenderter Seite**
  plus ~1 s Grundlast (1/4/5-seitige Testpartituren: 6,3 s / 23,0 s /
  27,7 s auf der Testmaschine). Bei 120 s brach damit alles ab etwa **22
  Seiten** ab - also ausgerechnet die Orchesterpartituren, für die die App
  gedacht ist, und zwar mit einem nichtssagenden „timeout". 600 s decken
  rechnerisch ~110 Seiten ab. Wer sehr große Partituren erwartet, rechnet
  mit dieser Faustformel hoch (Seitenzahl × 5,4 s + Puffer); die Zahl hängt
  spürbar von der CPU ab, ist also als Größenordnung zu lesen, nicht als
  Garantie.
- `SCOREVIEW_MAX_UPLOAD_BYTES` (Default `209715200`, 200 MB) - Upload-
  Größenlimit; größere Requests werden von Flask mit `413` abgelehnt,
  bevor MuseScore überhaupt startet.
- `SCOREVIEW_JOB_TTL_SECONDS` (Default `600`) - wie lange die Dateien
  eines fertigen (`ready`/`error`) Jobs nach Abschluss noch abrufbar
  bleiben, bevor ein Hintergrund-Thread sie von der Platte räumt. Kein
  Ersatz für die eigentliche Abholung durch `ConvertScoreJob` (die passiert
  sofort nach `ready`), sondern ein Sicherheitsnetz gegen unbegrenztes
  Wachstum von `SCOREVIEW_JOBS_DIR` (vorher: kein Aufräumen, siehe
  PLAN.md Phase 6).
- `SCOREVIEW_SOUNDFONT_PATH` (Default: automatische Suche) - welches
  SoundFont über `GET /soundfont` ausgeliefert wird. Ohne Angabe wird der
  erste vorhandene Kandidat genommen, in dieser Reihenfolge:
  `/usr/share/sounds/sf3/MuseScore_General_Lite.sf3`,
  `…/MuseScore_General.sf3`, `…/default-GM.sf3`. Alle drei stammen aus dem
  Debian-Paket `musescore-general-soundfont-small` (MuseScore General von
  S. Christian Collins, MIT) und überleben das `apt-get remove musescore`
  im Dockerfile, weil sie in einem eigenen Paket liegen.
  Das ebenfalls im Image liegende `/opt/musescore/share/…/MS Basic.sf3`
  (aus dem AppImage) ist bewusst **nicht** Default: es steht unter
  MuseScores eigenen Bedingungen statt unter einer schlichten permissiven
  Lizenz, seine Weiterverteilung an Browser ist deshalb eine
  Betreiberentscheidung. Wer es (oder ein beliebiges anderes SF2/SF3)
  will, setzt diese Variable.

### Endpunkte

- `GET /health` - kein Auth, liefert `ok`.
- `POST /convert` (Header `X-ScoreView-Secret`, Multipart-Feld `file` =
  `.mscz`) → `202 {"jobId": "..."}`. Start sofort, Konvertierung läuft im
  Hintergrund-Thread.
- `GET /convert/{jobId}` →
  `{"status": "pending"|"processing"|"ready"|"error", ...}`. Bei `ready`
  zusätzlich `files`:
  ```json
  {
    "pages": ["/convert/{jobId}/artifact/page-1", "/convert/{jobId}/artifact/page-2", "..."],
    "midi": "/convert/{jobId}/artifact/midi",
    "timingJson": "/convert/{jobId}/artifact/timing",
    "measuresJson": "/convert/{jobId}/artifact/measures",
    "metaJson": "/convert/{jobId}/artifact/meta"
  }
  ```
  bei `error` zusätzlich `error` (Freitext aus der fehlgeschlagenen
  `mscore4portable`-Ausgabe).
- `GET /convert/{jobId}/artifact/{name}` - **eine** Auslieferungsroute für
  alle Artefakte (seit Phase 23/Schritt 5; vorher fünf fast identische
  Handler, siehe Codereview-Befund B2). Gültige Namen sind eine Allowlist,
  kein Dateipfad:
- `…/artifact/page-{n}` (1-indiziert) - SVG-Seite `n`.
- `…/artifact/midi` - MIDI-Datei (siehe PLAN.md E1 - Synthese
  passiert im Browser, hier gibt es kein Audio mehr).
- `…/artifact/timing` - `timing.json`, aus `sposXML` geparst.
- `…/artifact/measures` - `measures.json`, aus `mposXML`
  geparst (für Taktnavigation, nicht für den Notenschritt-Cursor - siehe
  „spos vs. mpos" unten).
- `…/artifact/meta` - `meta.json`, die von MuseScore gelieferte
  `metadata` unverändert (Titel, Takte, `tracks[]`/`parts[]` für den
  Mixer - siehe M6).
- `GET /selftest` (Header `X-ScoreView-Secret`) → `{"ok": true|false,
  "error": "…"|null, "details": {…}}`. Konvertiert die mitgelieferte
  Minipartitur (`selftest-score.mscz`, Kopie von
  `spike/test-scores/repeat-test.mscz`) und prüft das Ergebnis auf die
  Zusagen, auf denen die App aufbaut: alle erwarteten `--score-media`-
  Schlüssel vorhanden (M2), mindestens eine SVG-Seite, Timing-Events und
  Elementkoordinaten vorhanden (M4), Event-Zeiten monoton steigend, **und
  mindestens ein `elid` mehrfach** – letzteres ist die M7-Zusage, dass
  MuseScore Wiederholungen ausrollt; bricht sie, wäre der Cursor bei
  Wiederholungen still falsch statt sichtbar kaputt.

  Antwortet auch im Negativfall mit **HTTP 200 und `ok: false`** (gleiche
  Überlegung wie bei `/soundfont/info`: ein 5xx wäre von „Sidecar nicht
  erreichbar" nicht zu unterscheiden). `details.musescoreVersion` kommt aus
  einer zur Bauzeit gesetzten ENV, nicht aus `mscore4portable --version` –
  der Aufruf braucht einen X-Server und mischt Qt-Rauschen in die Ausgabe.

  Gedacht für **MuseScore-Versionspflege**: nach einem Wechsel der
  `MUSESCORE_VERSION`/`MUSESCORE_BUILD`-ARGs im Dockerfile einmal aufrufen,
  bevor das Image produktiv geht. Die Nextcloud-Admin-Seite (Einstellungen →
  Verwaltung → ScoreView) hat dafür einen Knopf. Dauert eine echte
  Konvertierung lang (~7–8 s), läuft deshalb **nicht** automatisch beim
  Containerstart: das würde jeden Start verzögern und einen sonst
  benutzbaren Sidecar bei einem Teilproblem gar nicht hochkommen lassen.

- `GET /soundfont/info` →
  `{"available": true, "name": "...", "size": 39978561, "version": "<sha256>"}`
  bzw. `{"available": false}`. Bewusst **200 auch im Negativfall**: ein 404
  wäre für den HTTP-Client auf PHP-Seite ein Fehler und ließe „Image bringt
  kein SoundFont mit" nicht mehr von „Sidecar nicht erreichbar"
  unterscheiden.
- `GET /soundfont` - das SoundFont selbst (SF3, ~40 MB). Nicht pro Job,
  sondern eine feste Datei des Images. Die PHP-Seite lädt sie einmal in
  ihren IAppData-Cache (`Service\SoundFontService`) und liefert sie dem
  Browser danach selbst aus - der Browser spricht nie mit dem Sidecar.
  `version` aus `/soundfont/info` ist der Content-Hash und dient dort als
  Cache-Schlüssel und HTTP-ETag: ein SoundFont-Wechsel im Image
  invalidiert damit automatisch jeden Browser-Cache.

Alle Endpunkte außer `/health` verlangen den Header
`X-ScoreView-Secret`.

### `timing.json` / `measures.json`-Schema

Beide Dateien haben dieselbe Form (ein gemeinsamer Parser im Sidecar,
`_parse_pos_xml`, erzeugt beide aus `sposXML` bzw. `mposXML` - identischer
`<score><elements>/<events></score>`-Aufbau, siehe PLAN.md M7):

```json
{
  "events": [{"elid": 0, "timeMs": 0}, "..."],
  "elements": {
    "0": {"page": 0, "x": 1122.05, "y": 2114.17, "w": 2182.33, "h": 330.71}
  }
}
```

`events` ist nach `timeMs` sortiert. Koordinaten sind **bereits durch 12
geteilt** (siehe M4) und liegen direkt in SVG-Einheiten der zugehörigen
`page-N.svg`-`viewBox` - der Client rechnet nicht um.

Ein `elid` kann in `events` **mehrfach** auftreten (Wiederholungen/Volta,
siehe M7) - das ist der Normalfall, kein Sonderfall. Ein einzelnes `elid`
in `elements` deckt beide/alle Vorkommen ab, weil es exakt eine
Notenkopf-/Takt-Position auf der Seite beschreibt, unabhängig davon, wie
oft sie beim Abspielen durchlaufen wird.

**Bekannte Lücke (M7):** D.C./D.S./Coda-Sprünge werden von
`--score-media` nicht in zusätzliche `events`-Vorkommen aufgelöst - mit
handgeschriebenem MusicXML als Eingabe jedenfalls nicht (getestet gegen
`spike/test-scores/repeat-test.mscz`, siehe PLAN.md M7 für Details und
vermutete Ursache). Aus der MuseScore-GUI stammende Partituren mit
echtem Jump/Marker-Element sind damit **nicht** verifiziert.

## Gemessene Grenzwerte (Phase 20)

Alle Zahlen am 2026-08-23 gegen die laufende Testumgebung gemessen, nicht
geschätzt. Sie stammen von 1–5-seitigen Partituren; alles darüber ist
**Hochrechnung**, weil kein größeres Testmaterial vorliegt (siehe PLAN.md
Phase 20, „Was offen bleibt").

| Partitur | Seiten | Takte | `.mscz` | Konvertierung | SVG gesamt | größte Seite | MIDI | Cache gesamt |
|---|---|---|---|---|---|---|---|---|
| `repeat-test` | 1 | 5 | 30 KB | **6,3 s** | 107 KB | 107 KB | 0,4 KB | 111 KB |
| `duckwerk` | 4 | 58 | 114 KB | **23,0 s** | 3236 KB | 1041 KB | 12,4 KB | 5038 KB |
| `wwimf` | 5 | 63 | 98 KB | **27,7 s** | 1174 KB | 303 KB | 8,3 KB | 4623 KB |

Daraus abgeleitet:

- **Konvertierungsdauer ≈ 5,4 s/Seite + 1 s Grundlast** (lineare Regression
  über die drei Messpunkte). Bestimmt den Default von
  `MSCORE_TIMEOUT_SECONDS` (siehe oben).
- **SVG-Größe schwankt stark pro Seite** (303 KB vs. 1041 KB je nach
  Notendichte, Faktor ~3,4) - eine Hochrechnung „Seitenzahl × Durchschnitt"
  ist deshalb grob. Für 30 Seiten dichten Satzes sind ~30 MB SVG im Cache
  plausibel.
- **MIDI bleibt vernachlässigbar** (< 15 KB), wie in E1/M2 erwartet.
- **DOM-Last im Browser**: ~640–1370 Knoten pro gerenderter Seite (gemessen
  an beiden mehrseitigen Partituren). Die Lazy-Ladung greift nachweislich
  (bei `wwimf` war vor dem Scrollen nur **1 von 5** Seiten geladen), aber
  geladene Seiten werden **nicht wieder freigegeben** - wer eine
  30-Seiten-Partitur einmal ganz durchscrollt, hat danach grob 40.000
  SVG-Knoten im DOM. Auf Desktop-Hardware blieb die Bedienung dabei flüssig
  (30 Zoom-Änderungen in 485–493 ms, also ~16 ms pro Änderung bei ~5500–6400
  Knoten); ob das bei ~40.000 Knoten und auf Tablet-Hardware noch gilt, ist
  **ungeprüft**.
- **Upload-Limit** (`SCOREVIEW_MAX_UPLOAD_BYTES`, Default 200 MB) ist von
  echten Partituren weit entfernt (größte Testdatei: 114 KB) und dient nur
  als Schutz gegen pathologische Uploads.

## Bereitstellung jenseits von Docker (Phase 21, Konzept)

Bewusst ein **Konzept, keine Umsetzung** – die Entscheidung berührt E3 und
sollte nicht nebenbei fallen. Ausgangslage: der Sidecar ist Pflicht (E3),
und damit ist seine Installation die eigentliche Hürde für alle, die kein
Docker neben Nextcloud betreiben können oder wollen.

Vier Wege, mit ihren echten Kosten:

1. **AppAPI/ExApp** (der im Plan zugesagte Weg). Installation über die
   Nextcloud-UI, Nextcloud verwaltet den Container. Löst die Hürde für
   Instanzen, die AppAPI anbieten – verschiebt sie für alle anderen nur.
   Braucht ein eigenes Manifest, ein registriertes Image und eine
   Umstellung von „Admin trägt URL+Secret ein" auf „AppAPI vergibt beides".
   **Nicht umgesetzt**, siehe unten.
2. **Nativ auf dem Nextcloud-Host** (systemd-Service + venv). Kein Docker
   nötig, aber MuseScore muss samt Qt/X-Abhängigkeiten auf den Host –
   genau das, was der Container heute kapselt. Realistisch nur mit einem
   distributionsspezifischen Paket oder dem AppImage plus `xvfb`. Der
   Härtungsgewinn aus Phase 12 (eigener Nutzer, `--memory`, `--pids-limit`)
   müsste über systemd-Direktiven (`User=`, `MemoryMax=`, `TasksMax=`,
   `PrivateTmp=`, `ProtectSystem=strict`) nachgebaut werden.
3. **Separater Host** (der Sidecar spricht ohnehin nur HTTP). Funktioniert
   schon heute unverändert – `sidecar_url` zeigt dann auf eine andere
   Maschine. Voraussetzung: TLS und ein echtes Secret, denn der
   Konvertierungsdienst nimmt beliebige Dateien entgegen. Das ist der Weg,
   der dem High-Performance-Backend-Muster (`nextcloud-talk`) am nächsten
   kommt.
4. **Gar kein Sidecar** (clientseitiges Rendern). Würde E3 aufheben, ist
   aber laut E3 an MuseScore-3-Stand gebunden und damit für aktuelle
   `.mscz`-Dateien untauglich. Bleibt verworfen.

Empfehlung: (3) ist heute schon möglich und sollte dokumentiert bleiben,
(1) ist der Weg für die Breite, (2) nur für Betreiber, die ohnehin alles
nativ fahren.

## Aufräumen (Phase 6)

Zwei unabhängige Mechanismen, beide nötig:

- **Erledigte Jobs**: Hintergrund-Thread (`reap_expired_jobs`) löscht
  Job-Metadaten und `SCOREVIEW_JOBS_DIR/<jobId>/` `SCOREVIEW_JOB_TTL_SECONDS`
  nach Abschluss (`ready` oder `error`).
- **Hängende/abgebrochene Jobs** (Container-Neustart mitten in einer
  Konvertierung): Job-Status lebt nur im Prozessspeicher - nach einem
  Neustart ist die Job-ID unbekannt, `SCOREVIEW_JOBS_DIR` kann verwaiste
  Arbeitsverzeichnisse enthalten. Für den Prototyp nicht automatisiert
  aufgeräumt (kein Neustart-sicherer Job-Zustand nötig, siehe unten) -
  bei Bedarf manuell: `docker exec scoreview-sidecar rm -rf
  /tmp/scoreview-jobs/*`.

Job-Status nur im Prozessspeicher (kein Neustart-sicherer Job-Queue nötig
für den Prototyp - `ConvertScoreJob` auf PHP-Seite sieht einen
fehlenden/fehlgeschlagenen Job nach einem Sidecar-Neustart und übermittelt
einfach neu).

End-to-end gegen beide Testpartituren verifiziert (2026-08-23, gegen den
in Phase 6 umgestellten Konvertierung): `repeat-test.mscz` (1 Seite, siehe
M7) und die SATB-Partitur (4 Seiten, `tracks`/`parts` mit 5 Stimmen +
Metronom, siehe M6) liefern beide `status: ready` mit allen fünf
Dateiarten. Ein Prozessstart statt drei, messbar an der Laufzeit
gegenüber Phase 3. Fehlerpfade geprüft: unbekannte `jobId` → 404,
fehlendes `file`-Feld → 400, fehlender/falscher `X-ScoreView-Secret` →
401 (auch auf den Datei-Endpunkten, nicht nur `/convert/{jobId}` selbst -
die Job-Existenz wird erst NACH der Secret-Prüfung offengelegt), kaputte
`.mscz` → Job landet sichtbar auf `status: error` statt zu hängen.

## CLI-Modus (manuelles Debugging)

Für Diagnose ohne HTTP-Layer den Default-Entrypoint überschreiben:

```sh
docker run --rm --entrypoint /usr/local/bin/entrypoint.sh \
  -v <hostdir>:/data scoreview-musescore-cli \
  /data/stück.mscz --score-media > stück.media.json
```

`--score-media` schreibt ein einzelnes JSON-Objekt auf stdout, dem ~12
Zeilen Qt-Logausgabe vorausgehen (siehe M3) - die eigentliche
JSON-Nutzlast beginnt am ersten `\n{\n`. Alle Binäranteile (`svgs`,
`pngs`, `pdf`, `midi`, `sposXML`, `mposXML`, `mxml`) sind
**base64-kodierte Strings** innerhalb des JSON, `svgs`/`pngs` zusätzlich
als Liste (eine pro Seite).

Timeout-Guard per Env-Var überschreibbar (Default 120s, gilt für beide
Modi):

```sh
docker run --rm --entrypoint /usr/local/bin/entrypoint.sh \
  -e MSCORE_TIMEOUT_SECONDS=300 -v <hostdir>:/data \
  scoreview-musescore-cli /data/stück.mscz --score-media > stück.media.json
```

**Windows/Git-Bash-Falle:** Git Bashs automatische Pfad-Umwandlung
verstümmelt `/data/...`-Argumente. Mit `MSYS_NO_PATHCONV=1` vor `docker run`
umgehen. Dateinamen mit Nicht-ASCII-Zeichen (z.B. Umlauten) können beim
Hochladen über `curl -F` in Git Bash ebenfalls scheitern (400 „file
required", obwohl die Datei existiert) - im Zweifel unter einem
ASCII-Namen zwischenkopieren.

## spos vs. mpos: beide werden verwendet (Phase 6, geändert gegenüber Phase 1)

Beide sind wohlgeformtes XML mit zwei Blöcken:

- `<elements>`: `id` → x/y/sx/sy-Position auf der gedruckten Seite
  (12x SVG-Einheiten, siehe M4).
- `<events>`: `elid` → `position` (Zeit in **Millisekunden**, innerhalb
  einer Datei monoton steigend sortiert vom Sidecar). Gleichzeitige
  Noten/Akkorde über mehrere Stimmen/Systeme erzeugen **einen**
  gemeinsamen Event (kein doppelter Zeitstempel).

Im Phase-1-Spike (OSMD-Cursor-Ansatz) wurde `mpos` verworfen, weil es
strukturell zu grob für einen Notenschritt-Cursor war. Das war richtig
für diesen Zweck - **aber ein anderer Zweck**: Mit dem Umstieg auf den
elid-basierten Overlay-Cursor (Phase 8, kein OSMD mehr, kein
Schrittzählen mehr) ist die alte Ordinal-Zuordnungsfrage gegenstandslos.
`mpos` liefert jetzt exakt das, wofür es gedacht ist - Taktgrenzen für
die Taktnavigation (`measures.json`, Phase 10) - und wird dafür wieder
exportiert und geparst.

## Aktuell laufende Testumgebung

Für den Ende-zu-Ende-Test der Konvertierungs-Pipeline bereits so aufgesetzt
und weiterhin so belassen (kein Docker-Compose, weiterhin manuell verwaltet,
wie im Plan für den Prototyp vorgesehen):

```sh
docker network create scoreview-net
docker network connect scoreview-net nextcloud-test
docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET=<secret> scoreview-musescore-cli

docker exec -u www-data nextcloud-test php occ config:app:set scoreview sidecar_url --value="http://scoreview-sidecar:8765"
docker exec -u www-data nextcloud-test php occ config:app:set scoreview sidecar_secret --value="<secret>"
```

**Background-Jobs ausführen:** Das schlichte `nextcloud`-Image hat keinen
System-Cron. Nextclouds Default-Modus "ajax" reicht für den Prototyp nicht
zuverlässig (Jobs blieben sichtbar für immer auf `pending` hängen, wenn kein
Seitenaufruf sie anstößt). Einmalig auf `cron` umstellen und einen simplen
Ersatz-Loop im Container starten:

```sh
docker exec -u www-data nextcloud-test php occ background:cron
docker exec -d -u www-data nextcloud-test sh -c 'while true; do php -f /var/www/html/cron.php; sleep 15; done'
```

Der Loop überlebt einen Container-Neustart **nicht** (kein systemd/Supervisor
im Image) - nach einem Neustart von `nextcloud-test` erneut ausführen, sonst
bleiben neu eingereihte Jobs (z. B. `ConvertScoreJob`) unbegrenzt auf
`pending` stehen und der Viewer dreht sich endlos.

**Wichtig:** Nextcloud blockiert per Default abgehende HTTP-Anfragen an
lokale/interne Hostnamen (SSRF-Schutz) - ohne folgende Einstellung schlägt
jeder Sidecar-Aufruf mit „violates local access rules" fehl. Dieselbe
Einstellung brauchen z. B. auch Collabora/OnlyOffice-Sidecar-Integrationen:

```sh
docker exec -u www-data nextcloud-test php occ config:system:set allow_local_remote_servers --value=true --type=boolean
```

## Docker-Compose-Skizze (spätere, sauberere Variante)

```yaml
services:
  scoreview-sidecar:
    build: ./sidecar
    networks: [scoreview-net]
    environment:
      SCOREVIEW_SIDECAR_SECRET: ${SCOREVIEW_SIDECAR_SECRET}
    # ports: ["8765:8765"]  # nur nötig, wenn nicht nur Nextcloud selbst zugreift

networks:
  scoreview-net:
```
