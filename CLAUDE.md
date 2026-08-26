# Arbeitshinweise für Claude Code

Nextcloud-App, die MuseScore-Partituren (`.mscz`) anzeigt und im Browser
abspielt. Diese Datei hält nur fest, was beim Arbeiten am Repo konstant und
nicht offensichtlich ist – **die fachliche Wahrheit steht in `docs/`**.

## Zuerst lesen

| Frage | Dokument |
|---|---|
| Warum ist das so gebaut? | `docs/architecture.md` – Aufbau, Entscheidungen E1–E5, Formatgrundlagen M1–M9 |
| Was ist gemessen, was ist offen? | `docs/limits.md` |
| Wie baue/teste ich? | `docs/development.md` |
| Wie wird das installiert? | `docs/installation.md` |
| Ein Fehlerbild einordnen | `docs/troubleshooting.md` |
| Sidecar-API und -Betrieb | `sidecar/README.md` |

`docs/history/plan.md` ist der **archivierte** Umsetzungsplan: Phasen,
Zwischenstände, Messreihen im Moment ihres Entstehens. Nachschlagen ja – er
begründet vieles ausführlicher, als eine Referenz es tun sollte –, aber nicht
fortschreiben und nicht als Stand der App zitieren. Neue Erkenntnisse gehören in
die Dokumente oben.

Nichts aus `docs/` in andere Dateien duplizieren – stattdessen dorthin
verweisen.

## Layout

| Pfad | Inhalt |
|---|---|
| `scoreview/` | Die Nextcloud-App (PHP in `lib/`, Vue 3 in `src/`) |
| `scoreview/converter/` | Lokaler Konvertierungsweg: Node + MuseScore als WebAssembly (webmscore) |
| `sidecar/` | Docker-Container mit MuseScore 4 + Flask-HTTP-API (Paket `scoreview_sidecar`, hinter gunicorn) |
| `docs/` | Die gepflegte Dokumentation |

Konvertiert wird über **einen von zwei Wegen** – Sidecar oder lokal –, die
dieselben Artefakte erzeugen (E3). Die Wahl wird an genau einer Stelle
ausgewertet (`ConvertScoreJob`); das Frontend kennt ausschließlich die HTTP-API
der App und erfährt nie, welcher Weg gelaufen ist. Dieses Leitprinzip bitte
nicht aufweichen – es ist der Grund, warum der zweite Weg keine Zeile im Viewer
gekostet hat.

## Befehle

Frontend, aus `scoreview/`:

```sh
npm run build       # Pflicht nach jeder Änderung unter src/ - js/ ist gitignored
npm run watch       # während der Frontend-Arbeit
npm test            # vitest, die reinen Module unter src/lib/ plus die l10n-Vollständigkeit
npm run lint        # ESLint (@nextcloud/eslint-config), --fix über npm run lint:fix
npm run stylelint   # Stylelint für die <style scoped>-Blöcke
npm run l10n:extract  # nach jedem neuen/geänderten t()/$l->t() - meldet fehlende/verwaiste Übersetzungen
```

Die reine Logik liegt bewusst in `src/lib/` (`scoreLayout.js`,
`mixerLayout.js`, `timingSync.js`, …) und ist dort ohne DOM, ohne
`AudioContext` und ohne Nextcloud testbar. Neue Logik dorthin, nicht in die
Komponenten.

Backend, ebenfalls aus `scoreview/`:

```sh
composer install                # einmalig, bringt phpunit + php-cs-fixer + OCP-Stubs
composer run test:unit          # PHPUnit gegen Interface-Mocks, keine Instanz nötig
composer run cs:check           # Nextcloud-Codingstandard, --fix über composer run cs:fix
```

Die PHP-Tests sind **reine Unit-Tests gegen `nextcloud/ocp`-Mocks** und laufen
in Sekunden ohne Container. `composer.json` hängt die OCP-Stubs dafür in
`autoload-dev` ein – das Paket selbst deklariert keinen Autoload, es ist für
Psalm gedacht. Wichtig: **im Release muss `--no-dev` laufen**, sonst würden die
Stubs mit ausgeliefert; die Release-Action prüft das eigens nach. Was echte
Nextcloud-Integration braucht (Routen, Migrationen, IAppData), bleibt Sache
eines Durchlaufs gegen die Testinstanz.

Lokaler Konverter, aus `scoreview/converter/`:

```sh
npm ci                       # laedt webmscore als Release-Tarball (~11 MB)
node convert.mjs --selftest  # echte Konvertierung, prueft M2/M4/M7
```

Die reine Umformung liegt in `converter/lib/artifacts.mjs` und laeuft in
`npm test` der App mit. **`converter/node_modules` ist gitignored** und muss im
Release-Tarball trotzdem enthalten sein – das erledigt `release.yml`.

Sidecar, aus `sidecar/`:

```sh
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest      # Parser-Unit-Tests, ohne MuseScore/Xvfb/Container
```

Alles davon läuft zusätzlich in CI (`.github/workflows/ci.yml`).

## Testumgebung

Zwei Docker-Container, `nextcloud-test` (Port 8080) und `scoreview-sidecar`.
Fuer den lokalen Konvertierungsweg braucht `nextcloud-test` zusaetzlich eine
Node-Laufzeit (`apt-get install -y nodejs`, das Image bringt keine mit);
umgestellt wird mit
`occ config:app:set scoreview conversion_backend --value local`.
Aufsetzen wie in `docs/installation.md`; die Besonderheiten der lokalen
Testinstanz stehen in `docs/development.md#testumgebung`.

- **PHP/Templates wirken sofort** – `scoreview/` ist in den Container
  gemountet, es gibt keinen Deploy-Schritt.
- **Frontend braucht `npm run build`** – ausgeliefert wird `scoreview/js/`.
- **Sidecar braucht Neubau *und* neuen Container**:
  `docker build -t scoreview-musescore-cli sidecar/`, dann
  `docker rm -f scoreview-sidecar` und das `docker run` aus
  `sidecar/README.md`. **`--network scoreview-net` nicht vergessen** – ohne
  das Flag startet der Container fehlerfrei, ist aber von Nextcloud aus
  nicht per Containernamen erreichbar (Dockers Standard-Bridge kennt keine
  Namensauflösung), und die Betriebsdiagnose meldet nur
  „Konvertierungsdienst nicht erreichbar".
- **Kein System-Cron im Image.** Ohne den manuellen Loop laufen
  Background-Jobs nicht, und Konvertierungen bleiben auf „pending" stehen.
  Vor der Fehlersuche prüfen: `docker exec nextcloud-test ps aux | grep cron.php`.
  Der Loop:
  `docker exec -d -u www-data nextcloud-test sh -c 'while true; do php -f /var/www/html/cron.php; sleep 15; done'`
  – kürzer als 15 s taktet er sich unter SQLite in „database is locked".
- Passwörter der Testnutzer sind rotierbar und stehen bewusst nirgends im
  Repo. Bei Bedarf neu setzen:
  `docker exec -u www-data -e OC_PASS='…' nextcloud-test php occ user:resetpassword --password-from-env Andreas`

Ein Browser-Test läuft über `playwright-core` gegen das gecachte Chromium
unter `%LOCALAPPDATA%\ms-playwright\`, gesteuert aus kleinen Wegwerf-Skripten
im Scratch-Verzeichnis. Für Tonprüfungen gilt der Fallstrick aus
`docs/development.md`: der Abgriff muss den Ausgangsindex mitführen, sonst
misst er nur den Effektbus und meldet fälschlich „kein Ton".

## Konventionen

- **Deutsch** für Kommentare, Dokumentation und Commit-Messages, letztere in
  ASCII-Umschrift (`ue`/`ae`/`oe`/`ss`), passend zur bestehenden Historie.
- **UI-Texte dagegen: englische Quellstrings, Deutsch ist eine im Repo
  gepflegte Übersetzung** (E4 in `docs/architecture.md`) – `l10n/de.json` für
  PHP (`$l->t('…')`), `l10n/de.js` für den Browser (`t('scoreview', '…')`).
  Grund: Nextclouds l10n-Format benutzt den Quellstring selbst als
  Übersetzungsschlüssel – deutsche Schlüssel würden jede weitere Sprache aus
  dem Deutschen übersetzen und die Rückfallsprache bei fehlender
  Übersetzungsdatei wäre Deutsch statt Englisch. Nach jedem neuen/geänderten
  `t()`/`$l->t()`-Aufruf `npm run l10n:extract` laufen lassen – `npm test`
  schlägt sonst über `tools/l10n.test.js` fehl, weil Nextclouds
  `JSResourceLocator` eine fehlende Übersetzungsdatei stillschweigend
  ignoriert und der Fehler nie auffiele. Nicht übersetzt wird Inhalt aus der
  Partitur selbst (Stimmennamen, Titel, Komponist, GM-Instrumentennamen) – das
  ist Material, keine Oberfläche.
- **Kommentare erklären das Warum**, nicht das Was – vor allem bei
  Entscheidungen, die von außen falsch aussehen. Der Bestand ist so
  geschrieben; bitte in dieser Dichte weiterführen statt sie zu verwässern.
  **Keine Prozess-Chronik im Code**: nicht „Phase 17 hat gemessen, dass …",
  sondern „gemessen: …". Referenzen auf `E1`–`E5`/`M1`–`M9` sind erwünscht,
  sie zeigen auf `docs/architecture.md`.
- Commit-Messages beschreiben Ursache und Wirkung, nicht nur den Fix. Kurze
  Betreffzeile, dann ein Fließtext-Body.
- Nach Änderungen an Routen oder ausgelieferten Assets die Version in
  `appinfo/info.xml` erhöhen (Cache-Busting hängt daran) und `occ upgrade`
  laufen lassen. Nennenswerte Änderungen gehören in `CHANGELOG.md`.
- Ein Commit passiert nur, wenn er ausdrücklich gewünscht ist, ein Push
  ebenso. Alles liegt auf `master`; das Remote ist `origin`
  (`git@github.com:AndiMb/scoreview.git`) und **öffentlich** – vor dem Push
  darauf achten, dass weder Geheimnisse noch fremdlizenziertes Material
  mitgehen (siehe „Nie committen").

## Fallstricke, die schon Zeit gekostet haben

Alle ausführlich in `docs/troubleshooting.md`:

- **Neue Route liefert 404.** Nextclouds `CachingRouter` cacht die
  kompilierte Routentabelle eine Stunde lang, keyed nach Host-Header.
  Version hochzählen + `occ upgrade`, oder Container neu starten.
- **`.mscz` bietet nur „Herunterladen" an.** Mimetype-Registrierung wirkt
  nicht rückwirkend; `occ files:scan <Nutzer>` ist zusätzlich nötig.
- **Antivirus unter Windows** quarantäniert `scoreview/node_modules/stb-vorbis/dist/index.js`
  (bestätigt: Windows Defender, ThreatID 2147842389, zuletzt am 2026-08-24).
  Mal schlägt der Build damit hart fehl, mal liefert er nur eine kaputte
  Audiobibliothek aus. Die Datei kommt bei jedem `npm install` zurück und ist
  Sekunden später wieder weg – eine Neuinstallation hilft also nicht.
  **Ausweg ohne Antivirus-Einstellungen zu ändern** (die sind eine
  Nutzerentscheidung, keine, die eine Sitzung treffen sollte): im Container
  bauen, mit `node_modules` in einem Docker-Volume statt auf dem
  Windows-Dateisystem – dort scannt Defender nicht.

  ```sh
  # aus dem Wurzelverzeichnis des Repos
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$(pwd)/scoreview:/app" \
    -v scoreview-nodemodules:/app/node_modules \
    -w /app node:22-bookworm sh -c "npm ci && npm run build"
  ```

  Achtung: Ein fehlgeschlagener Webpack-Lauf räumt `js/` vorher leer – nach
  einem Abbruch fehlt also auch das Viewer-Bundle in der Testinstanz, bis
  einmal vollständig gebaut wurde.

## Nie committen

`.gitignore` deckt das ab, aber bewusst wissen: Testpartituren unter
`sidecar/testdata/` sind nicht garantiert frei lizenziert und bleiben draußen –
einzige Ausnahme ist die selbst erstellte `repeat-test.*`. Ebenso draußen:
`scoreview/js/` (Build-Artefakte), `node_modules/` und das lokale
Wegwerf-Verzeichnis `spike/`.
