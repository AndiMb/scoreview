# Fachliche Dokumentation

Wie die Engineering-Skills die fachliche Dokumentation dieses Repos lesen
sollen, bevor sie sich im Code umsehen.

## Vor dem Erkunden lesen

- **`CONTEXT.md`** im Wurzelverzeichnis, oder
- **`CONTEXT-MAP.md`** im Wurzelverzeichnis, falls vorhanden: sie zeigt auf je
  ein `CONTEXT.md` pro Kontext. Alle zum Thema passenden lesen.
- **`docs/adr/`**: die ADRs lesen, die den Bereich berühren, an dem gearbeitet
  wird. In Repos mit mehreren Kontexten zusätzlich `src/<kontext>/docs/adr/`
  für kontextgebundene Entscheidungen.

Fehlt eine dieser Dateien, **stillschweigend weiterarbeiten**. Ihr Fehlen nicht
melden und nicht vorsorglich vorschlagen, sie anzulegen. Das Skill
`/domain-modeling` (erreichbar über `/grill-with-docs` und
`/improve-codebase-architecture`) legt sie an, sobald ein Begriff oder eine
Entscheidung tatsächlich geklärt wird.

Für dieses Repo gilt zusätzlich: Die fachliche Wahrheit steht heute in
`docs/` (`architecture.md`, `limits.md`, `development.md`, `troubleshooting.md`,
`sidecar/README.md`), siehe die Tabelle "Zuerst lesen" in `CLAUDE.md`. Ein
`CONTEXT.md` ersetzt das nicht, es kommt bei Bedarf daneben.

## Dateistruktur

Ein Kontext (der Normalfall, und der Stand dieses Repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── src/
```

Mehrere Kontexte (erkennbar an `CONTEXT-MAP.md` im Wurzelverzeichnis):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← systemweite Entscheidungen
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← kontextgebundene Entscheidungen
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Das Vokabular des Glossars benutzen

Benennt eine Ausgabe einen fachlichen Begriff (in einem Issue-Titel, einem
Refactoring-Vorschlag, einer Hypothese, einem Testnamen), dann in der Fassung,
die `CONTEXT.md` festlegt. Nicht auf Synonyme ausweichen, die das Glossar
ausdrücklich vermeidet.

Fehlt der gebrauchte Begriff im Glossar, ist das ein Signal: Entweder wird hier
Sprache erfunden, die das Projekt nicht benutzt (dann noch einmal nachdenken),
oder es ist eine echte Lücke (dann für `/domain-modeling` vormerken).

## Widersprüche zu ADRs benennen

Widerspricht eine Ausgabe einem bestehenden ADR, dann offen sagen statt es
stillschweigend zu übergehen:

> *Widerspricht ADR-0007 (…), lohnt aber eine Neubewertung, weil …*
