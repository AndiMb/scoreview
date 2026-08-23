# Arbeitshinweise für Claude Code

Nextcloud-App, die MuseScore-Partituren (`.mscz`) anzeigt und im Browser
abspielt. Diese Datei hält nur fest, was beim Arbeiten am Repo konstant und
nicht offensichtlich ist – **die fachliche Wahrheit steht in `PLAN.md`**.

## Zuerst lesen

`PLAN.md` im Wurzelverzeichnis ist das führende technische Dokument:
Architekturentscheidungen (E1–E3), verifizierte Messungen (M1–M7) und pro
Phase ein Abschnitt „Umsetzungsstand", der festhält, was tatsächlich
verifiziert wurde, was vom Plan abweicht und warum, und was bewusst offen
bleibt. Nichts daraus in andere Dateien duplizieren – stattdessen dorthin
verweisen.

## Layout

| Pfad | Inhalt |
|---|---|
| `scoreview/` | Die Nextcloud-App (PHP in `lib/`, Vue 3 in `src/`) |
| `sidecar/` | Docker-Container mit MuseScore 4 + kleiner Flask-HTTP-API |
| `spike/` | Vorarbeiten aus Phase 1, nicht Teil der App |

Der Sidecar ist zwingende Voraussetzung (siehe `PLAN.md` E3). Das Frontend
kennt ausschließlich die HTTP-API der App und erfährt nie, dass es ihn gibt –
dieses Leitprinzip bitte nicht aufweichen, es hält E3 revidierbar.

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
`mixerLayout.js`, `timingSync.js`) und ist dort ohne DOM, ohne
`AudioContext` und ohne Nextcloud testbar. Neue Logik dorthin, nicht in die
Komponenten.

Backend, ebenfalls aus `scoreview/`:

```sh
composer install                # einmalig, bringt phpunit + php-cs-fixer + OCP-Stubs
composer run test:unit          # PHPUnit gegen Interface-Mocks, keine Instanz nötig
composer run cs:check           # Nextcloud-Codingstandard, --fix über composer run cs:fix
```

Die PHP-Tests sind **reine Unit-Tests gegen `nextcloud/ocp`-Mocks** und
laufen in Sekunden ohne Container. `composer.json` hängt die OCP-Stubs dafür
in `autoload-dev` ein – das Paket selbst deklariert keinen Autoload, es ist
für Psalm gedacht. Wichtig: **im Release muss `--no-dev` laufen**, sonst
würden die Stubs mit ausgeliefert; die Release-Action prüft das eigens nach.
Was echte Nextcloud-Integration braucht (Routen, Migrationen, IAppData),
bleibt Sache eines Durchlaufs gegen die Testinstanz.

Sidecar, aus `sidecar/`:

```sh
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest      # Parser-Unit-Tests, ohne MuseScore/Xvfb/Container
```

Alles drei läuft zusätzlich in CI (`.github/workflows/ci.yml`).

## Testumgebung

Zwei Docker-Container, `nextcloud-test` (Port 8080) und `scoreview-sidecar`.
Details, Testnutzer und der Cron-Ersatzloop stehen in `sidecar/README.md`
und `scoreview/README.md`.

- **PHP/Templates wirken sofort** – `scoreview/` ist in den Container
  gemountet, es gibt keinen Deploy-Schritt.
- **Frontend braucht `npm run build`** – ausgeliefert wird `scoreview/js/`.
- **Sidecar braucht Neubau *und* neuen Container**:
  `docker build -t scoreview-musescore-cli sidecar/`, dann
  `docker rm -f scoreview-sidecar` und das `docker run` aus
  `sidecar/README.md`.
- **Kein System-Cron im Image.** Ohne den manuellen Loop laufen
  Background-Jobs nicht, und Konvertierungen bleiben auf „pending" stehen.
  Vor der Fehlersuche prüfen: `docker exec nextcloud-test ps aux | grep cron.php`.
- Passwörter der Testnutzer sind rotierbar und stehen bewusst nirgends im
  Repo. Bei Bedarf neu setzen:
  `docker exec -u www-data -e OC_PASS='…' nextcloud-test php occ user:resetpassword --password-from-env Andreas`

Ein Browser-Test läuft über `playwright-core` gegen das gecachte Chromium
unter `%LOCALAPPDATA%\ms-playwright\`, gesteuert aus kleinen Wegwerf-Skripten
im Scratch-Verzeichnis. Für Tonprüfungen gilt der Fallstrick aus `PLAN.md`
Phase 9: der Abgriff muss den Ausgangsindex mitführen, sonst misst er nur
den Effektbus und meldet fälschlich „kein Ton".

## Konventionen

- **Deutsch** für Kommentare, Dokumentation und Commit-Messages, letztere in
  ASCII-Umschrift (`ue`/`ae`/`oe`/`ss`), passend zur bestehenden Historie.
- **UI-Texte dagegen: englische Quellstrings, Deutsch ist eine im Repo
  gepflegte Übersetzung** (E4 in `PLAN.md`, umgesetzt in Phase 14) –
  `l10n/de.json` für PHP (`$l->t('…')`), `l10n/de.js` für den Browser
  (`t('scoreview', '…')`/lokaler `t()`-Wrapper in den Vue-Komponenten).
  Grund: Nextclouds l10n-Format benutzt den Quellstring selbst als
  Übersetzungsschlüssel – deutsche Schlüssel würden jede weitere Sprache aus
  dem Deutschen übersetzen und die Rückfallsprache bei fehlender
  Übersetzungsdatei wäre Deutsch statt Englisch. Nach jedem neuen/geänderten
  `t()`/`$l->t()`-Aufruf `npm run l10n:extract` laufen lassen (meldet
  fehlende und verwaiste Übersetzungen) – `npm test` schlägt sonst über
  `tools/l10n.test.js` fehl, weil Nextclouds `JSResourceLocator` eine
  fehlende Übersetzungsdatei sonst stillschweigend ignoriert und der Fehler
  nie auffiele. Nicht übersetzt wird Inhalt aus der Partitur selbst
  (Stimmennamen, Titel, Komponist, GM-Instrumentennamen) – das ist Material,
  keine Oberfläche.
- **Kommentare erklären das Warum**, nicht das Was – vor allem bei
  Entscheidungen, die von außen falsch aussehen. Der Bestand ist so
  geschrieben; bitte in dieser Dichte weiterführen statt sie zu verwässern.
- Commit-Messages beschreiben Ursache und Wirkung, nicht nur den Fix. Kurze
  Betreffzeile, dann ein Fließtext-Body.
- Nach Änderungen an Routen oder ausgelieferten Assets die Version in
  `appinfo/info.xml` erhöhen (Cache-Busting hängt daran) und `occ upgrade`
  laufen lassen.
- Ein Commit passiert nur, wenn er ausdrücklich gewünscht ist, ein Push
  ebenso. Alles liegt auf `master`; das Remote ist `origin`
  (`git@github.com:AndiMb/scoreview.git`) und **öffentlich** – vor dem Push
  darauf achten, dass weder Geheimnisse noch fremdlizenziertes Material
  mitgehen (siehe „Nie committen").

## Fallstricke, die schon Zeit gekostet haben

Alle ausführlich in `scoreview/README.md#troubleshooting`:

- **Neue Route liefert 404.** Nextclouds `CachingRouter` cacht die
  kompilierte Routentabelle eine Stunde lang, keyed nach Host-Header.
  Version hochzählen + `occ upgrade`, oder Container neu starten.
- **`.mscz` bietet nur „Herunterladen" an.** Mimetype-Registrierung wirkt
  nicht rückwirkend; `occ files:scan <Nutzer>` ist zusätzlich nötig.
- **Viewer meldet 500 nach einem Pipeline-Umbau.** Für Cache-Formatwechsel
  existiert kein Migrationspfad; betroffene `scoreview_conversions`-Zeilen
  löschen.
- **Antivirus unter Windows** kann Dateien in `scoreview/node_modules`
  (`stb-vorbis`) quarantänieren und damit die Audiobibliothek im Build
  unbrauchbar machen, ohne dass der Build fehlschlägt.

## Nie committen

`.gitignore` deckt das ab, aber bewusst wissen: Testpartituren unter
`spike/test-scores/` sind nicht garantiert frei lizenziert und bleiben
draußen – einzige Ausnahme ist die selbst erstellte `repeat-test.*`.
Ebenso draußen: `scoreview/js/` (Build-Artefakte) und `node_modules/`.
