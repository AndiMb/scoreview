# Translating ScoreView

ScoreView's user interface is written in English. The German translation is
maintained in this repository, and every other language comes from people
like you. A partial translation is welcome: anything not yet translated
simply shows up in English.

You do not need to install anything. A web browser and a GitHub account are
enough.

## How translations are stored

All translations live in [`scoreview/translationfiles/`](../scoreview/translationfiles/),
one folder per language, in the common gettext PO format:

```
scoreview/translationfiles/
  templates/scoreview.pot    every English string, translations empty - the template
  de/scoreview.po            German
  fr/scoreview.po            French (once someone adds it)
```

Each entry looks like this:

```po
#: src/components/ScoreBar.vue
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
   your language setting, for example `fr`, `es`, `it`, `nl`, `pt_BR` or
   `zh_Hans`. Check the `l10n/` folder of any Nextcloud app if you are unsure.
2. On GitHub, open [`scoreview/translationfiles/templates/scoreview.pot`](../scoreview/translationfiles/templates/scoreview.pot),
   click **Raw**, and copy the whole text.
3. Go to [`scoreview/translationfiles/`](../scoreview/translationfiles/), choose
   **Add file → Create new file**, and name it `<code>/scoreview.po`, for
   example `fr/scoreview.po`. Typing the `/` creates the folder.
4. Paste the text. At the top, fill in two header lines:

   ```po
   "Language: fr\n"
   "Plural-Forms: nplurals=2; plural=(n > 1);\n"
   ```

   `Language` must match the folder name. `Plural-Forms` is the standard
   gettext rule for your language. Nextcloud's own translation for your
   language has it at the end of any `l10n/<code>.js` file. ScoreView does not
   use plurals yet, but the line must be valid.
5. Translate as many `msgstr` entries as you like, then choose **Commit
   changes → Propose changes** and open the pull request.

## Improving an existing language

Open the language's `scoreview.po` on GitHub, click the pencil icon, edit, and
propose the change as a pull request. Empty `msgstr ""` entries are the ones
still missing. New strings appear there empty whenever the app gains a
feature.

If you prefer a desktop tool, [Poedit](https://poedit.net/) opens these files
directly.

## What the automatic check looks at

Every pull request runs `npm run l10n:check`. It fails, with a message naming
the entry, if

- a placeholder differs from the English original. `{name}`, `{n}` or `%s`
  must appear in your translation exactly as in `msgid`, though you may move
  them within the sentence. Don't translate the word inside the braces,
  `{name}` stays `{name}`.
- an entry's `msgid` does not exist in the template (usually a changed or
  outdated `msgid`), or an entry appears twice.
- the `Language` or `Plural-Forms` header is missing or does not match the
  folder.

Missing translations are **not** an error. The check prints how many strings
your language covers.

## Guidelines

- Use the terms Nextcloud already uses in your language, for example for
  "Files", "Share" or "Settings". Users see both side by side.
- Use the same form of address that Nextcloud uses in your language. German
  uses the informal "du".
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
