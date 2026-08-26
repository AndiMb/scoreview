# Mitarbeiten

Fehler, Wünsche und Fragen gehören in die
[Issues](https://github.com/AndiMb/scoreview/issues). Bei einem Fehlerbericht
hilft, was auf der Verwaltungsseite unter **Einstellungen → Verwaltung →
ScoreView** steht (Betriebsdiagnose) und ob der Fall in
[docs/troubleshooting.md](docs/troubleshooting.md) schon beschrieben ist.

## Bevor du Code schickst

Einmal die drei Testläufe des Repos grün bekommen – dieselben, die auch die CI
fährt:

```sh
cd scoreview
npm ci && npm test && npm run lint && npm run stylelint && npm run build
composer install && composer run cs:check && composer run test:unit

cd ../sidecar
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest

# Der lokale Konvertierungsweg - laedt rund 11 MB webmscore
cd ../scoreview/converter
npm ci && node convert.mjs --selftest
```

Setup, Testumgebung und die Fallstricke, die schon Zeit gekostet haben, stehen
in [docs/development.md](docs/development.md).

## Worauf es in diesem Repo ankommt

- **Neue Logik gehört nach `scoreview/src/lib/`** – ohne DOM, ohne
  `AudioContext`, ohne Nextcloud und damit ohne Browser testbar. Nicht in die
  Komponenten.
- **Das Frontend kennt nur die HTTP-API der App.** Es darf nirgends erfahren,
  über welchen Weg konvertiert wurde – oder dass es zwei gibt
  ([E3](docs/architecture.md#e3-zwei-konvertierungswege-hinter-einer-api)). Genau
  deshalb war der zweite Weg ein reiner Backend-Austausch.
- **UI-Strings sind Englisch**, Deutsch ist eine gepflegte Übersetzung. Nach
  jedem neuen `t()`-Aufruf `npm run l10n:extract` laufen lassen, sonst schlägt
  `npm test` fehl.
- **Kommentare erklären das Warum**, nicht das Was – vor allem bei
  Entscheidungen, die von außen falsch aussehen.
- **Deutsch** für Kommentare, Dokumentation und Commit-Messages, letztere in
  ASCII-Umschrift (`ue`/`ae`/`oe`/`ss`), passend zur bestehenden Historie. Kurze
  Betreffzeile, dann ein Fließtext-Body, der Ursache und Wirkung beschreibt.
- Nach Änderungen an Routen oder ausgelieferten Assets die Version in
  `scoreview/appinfo/info.xml` erhöhen – daran hängt das Cache-Busting.

Warum die App so gebaut ist, wie sie gebaut ist, steht in
[docs/architecture.md](docs/architecture.md). Wer eine der Entscheidungen
E1–E5 antasten will, findet dort ihre Begründung.
