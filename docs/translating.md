# Translating ScoreView

ScoreView's user interface is written in English. The maintainer keeps the
German translation (`de`) complete, so please don't open pull requests for it;
every other language comes from people like you. A partial translation is welcome: anything not yet translated
simply shows up in English.

You do not need to install anything. A web browser and a GitHub account are
enough.

## How translations are stored

All translations live in [`scoreview/translationfiles/`](../scoreview/translationfiles/),
one folder per language, in the common gettext PO format:

```
scoreview/translationfiles/
  templates/scoreview.pot    every English string, translations empty - the template
  de/scoreview.po            German (maintained with the app)
  fr/scoreview.po            French (once someone adds it)
```

There is no `de_DE/` folder: formal German ("Deutsch (Sie)") is generated
from `de` when the app is built.

Each entry looks like this:

```po
#: src/components/ScoreAnnotations.vue src/components/ScoreViewer.vue
msgid "Measure {n}"
msgstr "Mesure {n}"
```

- `msgid` is the English original. **Never change it**: it is the key that
  connects your translation to the app.
- `msgstr` is your translation. Leave it empty (`""`) if you are not sure. An
  empty entry shows up in English, which is better than a wrong guess.
- `#:` tells you where the string is used. `src/` is the browser interface,
  `lib/` and `templates/` are messages from the server.

## Adding a new language

1. Find your language code in Nextcloud. It is the code Nextcloud uses for
   your language setting: a lowercase language, optionally followed by
   `_REGION` or `@variant`, for example `fr`, `es`, `nl`, `pt_BR`, `zh_Hans`
   or `sr@latin`. Every code appears as a file name in
   [Nextcloud's `core/l10n` folder](https://github.com/nextcloud/server/tree/master/core/l10n).
2. On GitHub, open [`scoreview/translationfiles/templates/scoreview.pot`](../scoreview/translationfiles/templates/scoreview.pot),
   click **Raw**, and copy the whole text. Leave the `.pot` itself unchanged;
   the check fails if it no longer matches the app.
3. Go to [`scoreview/translationfiles/`](../scoreview/translationfiles/), choose
   **Add file → Create new file**, and name it `<code>/scoreview.po`, for
   example `fr/scoreview.po`. Typing the `/` creates the folder.
4. Paste the text. At the top, change the two existing lines
   `"Language: \n"` and `"Plural-Forms: nplurals=INTEGER; plural=EXPRESSION;\n"`
   so that they read, for French:

   ```po
   "Language: fr\n"
   "Plural-Forms: nplurals=2; plural=(n > 1);\n"
   ```

   `Language` must match the folder name. `Plural-Forms` is the standard
   gettext rule for your language: open `<code>.js` in the `core/l10n` folder
   linked above and copy the last quoted text, for example
   `"nplurals=2; plural=(n > 1);"`. ScoreView does not use plurals yet, but
   the line must be valid.
5. Translate as many `msgstr` entries as you like, then click
   **Commit changes…**, then **Propose changes**, and on the next page
   **Create pull request**. GitHub creates your own copy (fork) of the
   repository automatically.

## Improving an existing language

Open the language's `scoreview.po` on GitHub, click the pencil icon, edit, and
propose the change as a pull request. Empty `msgstr ""` entries are the ones
still missing. New strings appear there empty whenever the app gains a
feature.

If you prefer a desktop tool, [Poedit](https://poedit.net/) opens and saves
these files directly; its line wrapping and extra header lines are fine, and
your own comments (Poedit's "Comment" field) are kept. Entries marked as
*Needs work* (`#, fuzzy` in the file) count as untranslated and are not
shipped, so clear the mark once you have checked the text.

## What the automatic check looks at

Every pull request runs `npm run l10n:check`. For a first contribution, a
maintainer has to approve the run; the result is under **Details** next to
the check on your pull request. It fails, with a message naming the entry, if

- a placeholder differs from the English original. `{name}`, `{n}`, `%s`,
  `%d` or `%1$s` must appear in your translation exactly as in `msgid`, each
  as often as there, though you may move them within the sentence. Don't
  translate the word inside the braces, `{name}` stays `{name}`.
- an entry's `msgid` does not exist in the template (usually a changed or
  outdated `msgid`), or an entry appears twice.
- the folder name is not a Nextcloud language code, the `Language` header is
  missing or differs from the folder name, or `Plural-Forms` is missing or
  malformed.
- a line cannot be read at all. The message names the line number.

Missing translations are **not** an error (only German must be complete). The
check prints how many strings your language covers, for example
`[l10n:fr] 120/508 ok`.

## Guidelines

- Use the terms Nextcloud already uses in your language, for example for
  "Files", "Share" or "Settings". Users see both side by side.
- Use the same form of address that Nextcloud uses in your language. German
  uses the informal "du"; users who choose formal German (`de_DE`) see this
  text too.
- Musical terms should match what choirs and ensembles in your language
  actually say. A measure might be *Takt*, *mesure* or *compás*.
- Do not translate content that comes from the score itself, such as part
  names, titles, composers or instrument names. The app does not pass these
  through translation anyway.
- Keep `…` (one character) and typographic quotes as they suit your language.

## After your pull request is merged

The app files Nextcloud reads (`scoreview/l10n/<code>.js` and `.json`) are
generated from your `.po` file when the app is built. Your translation ships
with the next release, and no further step is needed from you.
