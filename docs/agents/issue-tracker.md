# Issue-Tracker: GitHub

Issues und Spezifikationen zu diesem Repo liegen als GitHub-Issues. Alle
Operationen laufen über die `gh`-CLI. Das Repo leitet `gh` selbst aus
`git remote -v` ab, solange es innerhalb des Klons aufgerufen wird.

## Konventionen

- **Issue anlegen**: `gh issue create --title "..." --body "..."`. Für
  mehrzeilige Bodies ein Here-Doc benutzen.
- **Issue lesen**: `gh issue view <nummer> --comments`, Kommentare bei Bedarf
  über `jq` filtern und die Labels mitholen.
- **Issues auflisten**:
  `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
  mit passenden `--label`- und `--state`-Filtern.
- **Kommentieren**: `gh issue comment <nummer> --body "..."`
- **Labels setzen/entfernen**: `gh issue edit <nummer> --add-label "..."` bzw.
  `--remove-label "..."`
- **Schließen**: `gh issue close <nummer> --comment "..."`

## Pull Requests als Triage-Fläche

**Pull Requests als Anfragekanal (PRs as a request surface): nein.**
_(Auf `ja` setzen, wenn fremde PRs in diesem Repo als Feature-Wünsche gelten;
`/triage` liest dieses Flag.)_

Steht das Flag auf `ja`, durchlaufen PRs dieselben Labels und Zustände wie
Issues, nur mit den `gh pr`-Entsprechungen:

- **PR lesen**: `gh pr view <nummer> --comments`, den Diff über
  `gh pr diff <nummer>`.
- **Fremde PRs zur Triage auflisten**:
  `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`,
  danach nur `authorAssociation` `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` oder
  `NONE` behalten (`OWNER`/`MEMBER`/`COLLABORATOR` verwerfen).
- **Kommentieren / labeln / schließen**: `gh pr comment`,
  `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub teilt einen Nummernraum zwischen Issues und PRs: Ein bloßes `#42` kann
beides sein. Auflösen über `gh pr view 42`, mit `gh issue view 42` als
Rückfall.

## Wenn ein Skill sagt "an den Issue-Tracker veröffentlichen"

Ein GitHub-Issue anlegen.

## Wenn ein Skill sagt "das zugehörige Ticket holen"

`gh issue view <nummer> --comments` ausführen.

## Wayfinding

Benutzt von `/wayfinder`. Die **Map** ist ein einzelnes Issue, die Tickets sind
dessen **Kind-Issues**.

- **Map**: ein Issue mit Label `wayfinder:map`, im Body Notes /
  Decisions-so-far / Fog. Anlegen über
  `gh issue create --label wayfinder:map`.
- **Kind-Ticket**: ein Issue, das als GitHub-Sub-Issue an der Map hängt
  (`gh api` auf den Sub-Issues-Endpunkt). Wo Sub-Issues nicht aktiv sind,
  stattdessen in eine Task-Liste im Map-Body eintragen und `Part of #<map>`
  oben in den Body des Kindes schreiben. Labels: `wayfinder:<typ>`
  (`research`/`prototype`/`grilling`/`task`). Sobald übernommen, wird das
  Ticket der treibenden Person zugewiesen.
- **Blockierung**: GitHubs **native Issue-Dependencies**, die kanonische, in
  der Oberfläche sichtbare Darstellung. Kante setzen mit
  `gh api --method POST repos/<owner>/<repo>/issues/<kind>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  wobei `<blocker-db-id>` die numerische **Datenbank-ID** des Blockers ist
  (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, *nicht* die `#nummer`
  und nicht die `node_id`). GitHub meldet
  `issue_dependencies_summary.blocked_by` (nur offene Blocker, das lebende
  Gatter). Wo Dependencies fehlen, ersatzweise eine Zeile
  `Blocked by: #<n>, #<n>` oben im Body des Kindes. Ein Ticket ist frei, wenn
  jeder Blocker geschlossen ist.
- **Frontier-Abfrage**: die offenen Kinder der Map auflisten
  (`gh issue list --state open`, begrenzt auf ihre Sub-Issues bzw. die
  Task-Liste), alles mit offenem Blocker
  (`issue_dependencies_summary.blocked_by > 0` oder ein offenes Issue in der
  `Blocked by`-Zeile) oder mit Zuweisung verwerfen; das erste in Map-Reihenfolge
  gewinnt.
- **Übernehmen**: `gh issue edit <n> --add-assignee @me`, der erste Schreibzugriff
  der Sitzung.
- **Abschließen**: `gh issue comment <n> --body "<antwort>"`, dann
  `gh issue close <n>`, dann einen Kontextzeiger (Gist + Link) an
  Decisions-so-far in der Map anhängen.
