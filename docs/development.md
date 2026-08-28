# Entwicklung

Was zum Mitarbeiten nötig ist: Aufbau, Befehle, Tests, Konventionen und der Weg
zu einem Release. Wie die App funktioniert, steht in
[Architektur](architecture.md).

## Repo-Layout

| Pfad | Inhalt |
|---|---|
| `scoreview/` | Die Nextcloud-App: PHP in `lib/`, Vue 3 in `src/`. Nur dieses Verzeichnis wird als Release-Tarball gepackt. |
| `scoreview/converter/` | Der lokale Konvertierungsweg: Node + MuseScore als WebAssembly ([E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api)) |
| `sidecar/` | Docker-Image mit MuseScore 4 und HTTP-API (Paket `scoreview_sidecar`, hinter gunicorn) |
| `docs/` | Diese Dokumentation |

## Frontend

Aus `scoreview/`:

```sh
npm ci
npm run build        # Pflicht nach jeder Änderung unter src/ - js/ ist gitignored
npm run watch        # während der Frontend-Arbeit
npm test             # vitest: die reinen Module unter src/lib/ plus die l10n-Vollständigkeit
npm run lint         # ESLint (@nextcloud/eslint-config), --fix über npm run lint:fix
npm run stylelint    # Stylelint für die <style scoped>-Blöcke
npm run l10n:extract # nach jedem neuen/geänderten t() - meldet fehlende und verwaiste Übersetzungen
```

Die reine Logik liegt bewusst in `src/lib/` und ist dort ohne DOM, ohne
`AudioContext` und ohne Nextcloud testbar. **Neue Logik gehört dorthin, nicht in
die Komponenten** – sonst ist sie nur noch im Browser prüfbar.

Der Viewer mountet einen eigenen zweiten Vue-Baum neben dem von Nextclouds
Viewer (begründet in `src/viewer.js`). Wer an der UI-Basis arbeitet, muss
deshalb **im Viewer** verifizieren, nicht auf der Einstellungsseite – dort
verhalten sich `@nextcloud/vue`-Komponenten anders.

## Backend

Ebenfalls aus `scoreview/`:

```sh
composer install         # einmalig, bringt phpunit + php-cs-fixer + OCP-Stubs
composer run test:unit   # PHPUnit gegen Interface-Mocks, keine Nextcloud-Instanz nötig
composer run cs:check    # Nextcloud-Codingstandard, --fix über composer run cs:fix
```

Die PHP-Tests sind reine Unit-Tests gegen `nextcloud/ocp`-Mocks und laufen in
Sekunden ohne Container. `composer.json` hängt die OCP-Stubs dafür in
`autoload-dev` ein – das Paket selbst deklariert keinen Autoload, es ist für
Psalm gedacht. **Im Release muss `composer install --no-dev` laufen**, sonst
würden die Stubs mit ausgeliefert; die Release-Action prüft das eigens nach.

Was echte Nextcloud-Integration braucht (Routen, Migrationen, IAppData), bleibt
Sache eines Durchlaufs gegen eine Testinstanz.

## Sidecar

Aus `sidecar/`:

```sh
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest   # Parser-Unit-Tests, ohne MuseScore/Xvfb/Container
```

Das Image neu bauen und den Container ersetzen:

```sh
docker build -t scoreview-musescore-cli sidecar/
docker rm -f scoreview-sidecar
docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET="<secret>" scoreview-musescore-cli
```

`--network` nicht vergessen – ohne das Flag startet der Container fehlerfrei, ist
aber von Nextcloud aus nicht erreichbar.

## Lokaler Konverter

Aus `scoreview/converter/`:

```sh
npm ci                       # laedt rund 11 MB webmscore als Release-Tarball
node convert.mjs --selftest  # echte Konvertierung, prueft M2/M4/M7
node convert.mjs partitur.mscz /tmp/out   # schreibt die Artefakte einzeln
```

Die reine Umformungslogik liegt in `lib/artifacts.mjs` und ist ohne Wasm
testbar; ihre Tests laufen in `npm test` der App mit (vitest sammelt das
Verzeichnis mit ein). Alles, was webmscore selbst braucht, deckt der Selbsttest
ab – lokal wie in CI.

Welches webmscore installiert wird, steht als **Release-Tarball-URL** in
`converter/package.json`. Eine neue MuseScore-Version heißt: im Fork
[AndiMb/webmscore](https://github.com/AndiMb/webmscore) bauen, ein Release
setzen, hier die URL hochziehen, `npm install` laufen lassen und den Selbsttest
prüfen. Die Datei `converter/selftest-score.mscz` ist eine Kopie von
`sidecar/testdata/repeat-test.mscz` – dieselbe Partitur, die auch der Sidecar
für seinen Selbsttest benutzt; sie enthält Wiederholung, Volta und D.C., damit
M7 überhaupt prüfbar ist.

## CI

`.github/workflows/ci.yml` fährt alle Sprachen des Repos: Frontend (Build,
vitest, ESLint, Stylelint, l10n-Vollständigkeit), Backend (Syntaxprüfung,
Codingstandard, PHPUnit über mehrere PHP-Versionen), lokaler Konverter (echte
Konvertierung mit webmscore, auf Node 18 und 22) und Sidecar (pytest über
mehrere Python-Versionen). Was lokal grün ist, ist es dort in aller Regel auch.

Dazu ein eigener Job, der `appinfo/info.xml` gegen das Schema des App Stores
validiert. Der Store lehnt beim Hochladen ab, was nicht passt – also erst
nach dem Tag, wenn die Version schon vergeben ist.

`.github/dependabot.yml` hält die Abhängigkeiten wöchentlich aktuell, in vier
getrennten Bäumen (App, lokaler Konverter, PHP-Dev-Pakete, Sidecar) plus den
GitHub Actions; jeder dieser Pull Requests läuft durch dieselbe CI. Für
`webmscore4` greift das nicht – die Abhängigkeit hängt an einer Release-URL,
und die kennt keine Registry. Dieser Sprung bleibt Handarbeit.

## Übersetzungen

Die Quellstrings sind Englisch, Deutsch ist eine im Repo gepflegte Übersetzung
([E4](architecture.md#e4-englische-quellstrings-deutsch-als-gepflegte-übersetzung)):
`l10n/de.json` für PHP (`$l->t('…')`), `l10n/de.js` für den Browser
(`t('scoreview', '…')`).

Nach jedem neuen oder geänderten `t()`/`$l->t()`-Aufruf:

```sh
npm run l10n:extract
```

Das meldet fehlende und verwaiste Übersetzungen. `npm test` schlägt sonst fehl –
absichtlich: Nextclouds `JSResourceLocator` ignoriert eine fehlende
Übersetzungsdatei stillschweigend, ein vergessener String fiele also nie auf.

Nicht übersetzt wird Inhalt aus der Partitur selbst (Stimmennamen, Titel,
Komponist, GM-Instrumentennamen) – das ist Material, keine Oberfläche.

## Testumgebung

Zwei Container: eine Nextcloud-Instanz und `scoreview-sidecar`, aufgesetzt wie in
[Installation](installation.md) beschrieben. Dabei zu wissen:

- **PHP und Templates wirken sofort**, wenn `scoreview/` in den Container
  gemountet ist – kein Deploy-Schritt.
- **Frontend braucht `npm run build`** – ausgeliefert wird `scoreview/js/`.
- **Sidecar braucht Neubau und neuen Container**, siehe oben.
- **Kein System-Cron im schlichten `nextcloud`-Image.** Ohne einen Ersatz laufen
  Background-Jobs nicht und Konvertierungen bleiben auf `pending` stehen. Für
  eine Testinstanz genügt ein Loop im Container; kürzer als etwa 15 Sekunden
  sollte er nicht takten, sonst kollidiert er unter SQLite mit parallelen
  Anfragen („database is locked").

Für Tonprüfungen im Browser gilt ein Fallstrick: Der Abgriff muss den
Ausgangsindex mitführen, sonst misst er nur den Effektbus und meldet fälschlich
„kein Ton".

## Konventionen

- **Deutsch** für Kommentare, Dokumentation und Commit-Messages, letztere in
  ASCII-Umschrift (`ue`/`ae`/`oe`/`ss`), passend zur bestehenden Historie.
- **Englisch** für UI-Texte im Quelltext, siehe
  [Übersetzungen](#übersetzungen).
- **Kommentare erklären das Warum**, nicht das Was – vor allem bei
  Entscheidungen, die von außen falsch aussehen. Der Bestand ist so geschrieben;
  bitte in dieser Dichte weiterführen statt sie zu verwässern.
- Commit-Messages beschreiben Ursache und Wirkung, nicht nur den Fix. Kurze
  Betreffzeile, dann ein Fließtext-Body.
- Nach Änderungen an Routen oder ausgelieferten Assets die Version in
  `appinfo/info.xml` erhöhen (daran hängt das Cache-Busting) und `occ upgrade`
  laufen lassen. Der Grund steht unter
  [Troubleshooting](troubleshooting.md#eine-neu-hinzugefügte-route-liefert-404).

## Release

Ein Tag `v*` löst `.github/workflows/release.yml` aus. Die Action baut das
Frontend, installiert die PHP-Abhängigkeiten ohne Dev-Pakete **und den lokalen
Konverter samt webmscore**, stellt daraus den Auslieferungsbaum zusammen,
signiert ihn, packt ihn und hängt ihn an das GitHub-Release.

Der Umweg über die Action ist notwendig, nicht bequem: `scoreview/js/` ist
gitignored, ein direkt aus dem Repo gepacktes `scoreview/` enthielte also **kein
einziges Frontend-Bundle** und wäre unbrauchbar. Der Tarball muss aus einem
echten Build entstehen, nicht aus einem Checkout. Dasselbe gilt für den
Konverter: Eine Instanz ohne Container hat kein npm, mit dem sie webmscore
nachholen könnte.

**Vorgeschaltet ist die komplette CI**: `release.yml` ruft `ci.yml` per
`workflow_call` auf und baut erst, wenn alles grün ist. Eine Version, die
Linter, Tests, Codingstandard oder den Konverter-Selbsttest nicht besteht,
wird gar nicht erst gepackt – geschweige denn signiert oder an den App Store
gemeldet.

Direkt nach dem Checkout prüft die Action außerdem, dass der Tag zur Version
in `appinfo/info.xml` passt und dass `CHANGELOG.md` einen Abschnitt
`## [<Version>]` enthält. Beides kostet eine Sekunde und fängt zwei Fehler
ab, die sonst erst auf einer fremden Instanz bzw. im App Store auffielen –
der Store zieht seine Release-Notes aus genau diesem Abschnitt.

**Die Reihenfolge ist wesentlich:** erst den Auslieferungsbaum zusammenstellen,
dann signieren, dann packen. Die Signatur listet jede Datei einzeln auf – würde
erst signiert und danach beim Packen etwas ausgeschlossen, meldete die
Integritätsprüfung auf jeder Instanz fehlende Dateien.

### Was nicht mit ins Paket geht

Der App Store nimmt Archive nur **bis 20 MB** an. Ausgeschlossen sind deshalb
drei Posten, die zur Laufzeit niemand braucht:

| Posten | Größe | Warum entbehrlich |
|---|---|---|
| `webmscore.lib.symbols` | 6,1 MB | Symboltabelle, nur zum Debuggen des Wasm-Moduls |
| Browser-Bundles von webmscore | 1,0 MB | Der Konverter läuft unter Node, nicht im Browser |
| `@librescore/fonts` | 4,2 MB | Nur für chinesische, japanische und koreanische Liedtexte; nachrüstbar über `cjk_font_dir` (siehe [Grenzwerte](limits.md#bekannte-lücken)) |

Das Paket liegt damit bei rund 14 statt 18 MB. Die Action bricht ab, wenn der
Tarball die 20 MB überschreitet – lieber dort auffallen als nach dem Hochladen.

## Veröffentlichung im App Store

Der Nextcloud App Store nimmt **nur signierte Apps** an. Die drei folgenden
Schritte sind einmalig; danach genügt ein Tag.

### 1. Zertifikat beantragen

Schlüssel und Zertifikatsanfrage erzeugen – der private Schlüssel bleibt
geheim und gehört **niemals ins Repo**:

```sh
openssl req -nodes -newkey rsa:4096 -keyout scoreview.key -out scoreview.csr -subj "/CN=scoreview"
```

Die `scoreview.csr` als Pull Request bei
[nextcloud/app-certificate-requests](https://github.com/nextcloud/app-certificate-requests)
einreichen, mit Link auf dieses Repo. Nextcloud stellt daraufhin
`scoreview.crt` aus.

### 2. API-Token holen

Im App-Store-Konto unter *Settings → API Token*. Er ersetzt Benutzername und
Passwort beim Hochladen.

### 3. Als Repository-Secrets hinterlegen

Unter *Settings → Secrets and variables → Actions*:

| Secret | Inhalt |
|---|---|
| `APP_PRIVATE_KEY` | Inhalt von `scoreview.key` |
| `APP_CERTIFICATE` | Inhalt von `scoreview.crt` |
| `APPSTORE_TOKEN` | Der API-Token |

Alle drei sind optional: Fehlen sie, baut die Action trotzdem ein
(unsigniertes) Paket und lädt nichts hoch – so kommt auch ein Fork zu einem
Tarball.

### Ein Release fahren

```sh
# Version in scoreview/appinfo/info.xml setzen und in CHANGELOG.md einen
# Abschnitt "## [1.0.0]" anlegen - die Action prüft beides gegen den Tag
git tag v1.0.0
git push origin v1.0.0
```

Die Action baut, signiert, hängt den Tarball an das GitHub-Release und meldet
ihn beim App Store an. Dessen Prüfung lädt das Archiv selbst herunter und
verifiziert die Signatur gegen das Zertifikat – deshalb passiert die Anmeldung
erst, nachdem die Datei am Release hängt.

Von Hand ginge dasselbe so:

```sh
openssl dgst -sha512 -sign scoreview.key scoreview.tar.gz | openssl base64 -A

curl -X POST https://apps.nextcloud.com/api/v1/apps/releases \
  -H "Authorization: Token <token>" \
  -H 'Content-Type: application/json' \
  -d '{"download": "https://…/scoreview.tar.gz", "signature": "<signatur>", "nightly": false}'
```

## Fallstricke

**Antivirus unter Windows** quarantäniert
`scoreview/node_modules/stb-vorbis/dist/index.js` (bestätigt: Windows Defender).
Mal schlägt der Build hart fehl, mal liefert er nur eine kaputte Audiobibliothek
aus. Die Datei kommt bei jedem `npm install` zurück und ist Sekunden später
wieder weg – eine Neuinstallation hilft also nicht. Ausweg, ohne an den
Antivirus-Einstellungen zu drehen: im Container bauen, mit `node_modules` in
einem Docker-Volume statt auf dem Windows-Dateisystem.

```sh
# aus dem Wurzelverzeichnis des Repos
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd)/scoreview:/app" \
  -v scoreview-nodemodules:/app/node_modules \
  -w /app node:22-bookworm sh -c "npm ci && npm run build"
```

Achtung: Ein fehlgeschlagener Webpack-Lauf räumt `js/` vorher leer – nach einem
Abbruch fehlt also auch das Viewer-Bundle in der Testinstanz, bis einmal
vollständig gebaut wurde.

**Testpartituren** unter `sidecar/testdata/` sind nicht garantiert frei
lizenziert und bleiben draußen; einzige Ausnahme ist die selbst erstellte
`repeat-test.*`. Ebenso draußen: `scoreview/js/` (Build-Artefakte) und
`node_modules/`. Das Remote ist öffentlich – vor dem Push darauf achten, dass
weder Geheimnisse noch fremdlizenziertes Material mitgehen.
