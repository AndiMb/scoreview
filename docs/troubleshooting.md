# Troubleshooting

**English** · [Deutsch](troubleshooting.de.md)

Sorted by symptom. The first place to look for any problem is
**Settings → Administration → ScoreView**: the status diagnostics there show
whether the sidecar is reachable, the state of the local path (process start,
Node.js, engine package), an active fallback in the browser, the SoundFont
state, the age of the last cron run and the number of conversions per status.

## A `.mscz` file only offers “Download”

Almost always a mimetype problem. The app registers the mimetype itself – on
installation, on update and after every upload
([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste) (German)). If it
stays wrong, check three things, in this order:

1. **Did the app update run?** The repair step is tied to `occ upgrade`; without
   a version change it does not run.
2. **Is cron running?** Freshly uploaded scores are corrected by a
   background job, not by an upload path. Without cron the job is never picked up (see
   [Installation, step 5](installation.md#5-make-sure-background-jobs-run)).
3. **Does the server report an error?** `apply()` deliberately swallows every
   failure and writes it to the log – where it then reads “mimetype could not be
   registered”.

Without a shell, you can check the mimetype over WebDAV:

```sh
curl -u <user> -X PROPFIND -H 'Depth: 0' \
  --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontenttype/></d:prop></d:propfind>' \
  'https://<instance>/remote.php/dav/files/<user>/path/Score.mscz'
```

The expected value is `application/x-musescore`. With a shell you can also
look directly in the database:

```sh
php -r '
require "/var/www/html/lib/base.php";
$db = \OCP\Server::get(\OCP\IDBConnection::class);
$qb = $db->getQueryBuilder();
$qb->select("fileid","path","mimetype")->from("filecache")
   ->where($qb->expr()->like("name", $qb->createNamedParameter("%.mscz")));
foreach ($qb->executeQuery()->fetchAll() as $row) { print_r($row); }
'
```

`mimetype` must be the ID of `application/x-musescore` – which you can find with
`SELECT * FROM oc_mimetypes WHERE mimetype LIKE '%musescore%'` –, not that of
`application/octet-stream`.

## “Edit” is missing in the Nextcloud app on the phone

The mobile apps get in through Nextcloud's Direct Editing
([E8](architecture.md#e8-eine-eigenständige-seite-für-die-mobilen-apps) (German)), and
its choice of editor depends **on the mimetype alone**. The fallback file action keyed to
the file extension, which takes over in the browser, has no counterpart there.

First check: does the server report the editor at all?

```sh
curl -u <user> -H 'OCS-APIRequest: true' -H 'Accept: application/json'   https://<instance>/ocs/v2.php/apps/files/api/v1/directEditing
```

Under `editors`, the response must contain an entry `scoreview` – with
`"mimetypes":["application/x-musescore"]`. If the entry is missing entirely, the app
is not enabled. If it is there and the menu item is still
missing, the **file's mimetype** is not `application/x-musescore` –
see the section at the very top.

Two quirks of the Android app that have already cost time (both verified in
the nextcloud/android source):

- **The editor list is cached.** The app reads it from its
  own database (`EditorUtils.getEditors()`) and only fetches it again when syncing the
  **root folder**, and even then only if the ETag of the
  server capabilities has changed (`RefreshFolderOperation`). Pull to refresh once at
  the top level.
- **The app also keeps each file's mimetype locally.** If it was
  corrected on the server, the **folder containing the score** must also be reloaded
  – otherwise `FileMenuFilter.filterEdit()` keeps comparing against the old
  value.

## In the app, tapping a `.mscz` opens a different application

Not a bug, but the Android app's precedence rule:
`FileOperationsHelper.openFile()` hands the file to **any installed app**
that can open the mimetype – Direct Editing is explicitly only
the fallback there (“first always try to use available apps”). Anyone who has, say, a
MuseScore app on the phone ends up there when tapping, and that app's
error message then looks as if it came from ScoreView.

In that case you reach ScoreView via **⋮ → “Edit”**. This cannot be changed
from the server; the decision is made on the device.

## The page in the app stays blank or only shows an error

Two causes, distinguishable by their behaviour.

**The app's loading screen stays up and reports a timeout after ten
seconds.** Then the page has not sent its `loaded()` – either the
script never started, or the bridge to the app is missing. If in doubt, rebuild `js/`
(`npm run build`).

**The page is there, but shows nothing of the score.** Then its
follow-up requests are not getting through. They identify themselves with a token in the
`X-ScoreView-Token` header; rejections come with a code in the response body:

| Response | Meaning |
|---|---|
| `401 no_session` | Neither a session nor a token – the header is missing |
| `401 token_expired` | Token expired or used up; the app then fetches a fresh one. Direct Editing tokens are valid for 12 h and are single-use tokens for `edit()` – reloading the WebView by hand therefore runs into the app's error page |
| `403 token_file_mismatch` | The token belongs to a different score |
| `403 token_folder_mismatch` | A new setlist is to be created outside the folder of the open score – with a token that is only possible there |
| `403 direct_token_required` | Companion tokens are only issued in exchange for the page's Direct Editing token, not from a session and not from another companion token |
| `401 companion_expired`, `companion_revoked`, `companion_invalid` | The companion token of a setlist piece has expired (12 h), been revoked (password change, deactivation, new `companion_secret`) or no longer matches the Direct Editing token. The page fetches a new one itself; if it persists, reopen the score in the app |
| `403 companion_purpose`, `companion_not_allowed` | A companion token on a route it is not meant for – a bug in the page, not a user error |
| `401 user_disabled` | The account is disabled |

## “The microphone is not available here”

Recording and intonation need the microphone; the message appears when the
browser refuses it. It comes with the **“Open in browser”** button, which
opens the same score in a new browser window. The causes, in this
order:

1. **In the Nextcloud app for Android** the microphone never works –
   its WebView does not grant it, and nothing can be done about that from ScoreView
   ([Limits](limits.md#mobile)). “Open in browser” is the
   intended route there.
2. **Permission was denied.** In the browser, allow it again for this site via the lock or
   settings icon next to the address.
3. **The page does not allow a microphone.** Nextcloud blocks it via
   `Feature-Policy`; the app only allows it under `/apps/files`, and only
   while recording or intonation is turned on. To check:

   ```sh
   curl -sI -u <user> https://<instance>/apps/files/ | grep -i feature-policy
   ```

   It must say `microphone 'self'` there, not `microphone 'none'`. If it says
   `'none'`, both features are turned off in the administration settings – or
   a reverse proxy sets its own policy.
4. **No secure context.** Over plain `http://` (except `localhost`) there is
   no microphone.

The other messages – “No microphone was found”, “… is being used by another
application” – refer to the device, not to the page.

## Clicking a setlist opens the text editor

A `*.setlist.md` is Markdown, and Markdown otherwise opens in the text editor in Files.
ScoreView claims the click through the order of the file actions
([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste) (German)).
If the Text app opens anyway:

- **Does the file name really end in `.setlist.md`?** `Concert.md` is not a
  setlist, `Concert.setlist.md` is.
- **Are the frontend and the app up to date?** After an update, do a hard reload once
  (`Ctrl`+`Shift`+`R`).
- **A new Nextcloud version may evaluate the order of the actions
  differently.** The **“Open as setlist”** entry in the file's (⋯) menu
  remains the way out.

In the mobile apps this is not a bug: they offer the Text app for Markdown.
There you open a score from the list, and ScoreView offers the
setlists from the same folder ([Limits](limits.md#setlist)).

## “Follow me” does not reach a device

Cron plays **no** part here – everything runs within the requests themselves.

- **Is the device following at all?** Navigating on its own (bar input, clicking
  a note, seeking, jumping to a rehearsal mark or note, loop) and its
  own transposition detach it from the leader; the badge then shows
  “Not following …” and the “Back to the leader” button. Page turning and zoom do not detach it.
- **Has it noticed the session yet?** Without a running session, a device only
  checks every 15 s. Anyone who opened the score before the start therefore waits up to 15 s.
- **Is the connection up?** The badge shows “disconnected” if a poll
  is not answered within 5 s. After a dead spot the device fetches the
  latest state by itself; a starting note that has become older than 2 s by then is
  deliberately no longer played.
- **Is the page in the background?** Only a visible page polls at the regular interval.
- **Can the device see the file?** Following requires file access; without it
  the server responds with 404.
- **Do the jumps arrive late?** Without `notify_push`, `follow_poll_ms` determines the
  delay; with `notify_push`, the status diagnostics show whether push actually
  works – if the service is not reachable behind the reverse proxy, the
  devices silently fall back to polling. The mobile apps always poll.
- **Several web servers?** Without a distributed cache (Redis), each device sees
  changes up to one second later
  ([E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht) (German)).

**Nobody comes along to the next piece of the setlist:**

- **Does the leader see “Could not take the session to the next
  piece”?** Then another leader is already running a session there, or
  the leader's own session has expired in the meantime. The leader has switched anyway;
  restart “Follow me” there if needed – this takes over a running session of
  another leader.
- **Was the device following?** A device that had detached is not taken along, but
  gets the notice “The leader has moved on to another piece”
  with “Go there”.
- **Is the device allowed to read the new piece?** Otherwise it gets a 404, and the
  viewer shows the error. Only devices that can see the file are taken along.
- **In the app:** the following device needs a companion token for the new piece,
  which it fetches itself – only while the session is running there and the token of the
  open page is valid. If that does not help, reopen the score in the
  app.

**Everything sounds higher or lower than written:** a transposition is
set – by the person themselves (stored per score) or by a
leader for everyone. The “Playback and practice” group then shows a dot; under
“Transpose” the value is shown and can be reset. Anyone who follows a leader
and then transposes on their own stops following.

## A recording cannot be saved

The recording then stays in the browser's memory, can be listened to and uploaded again via
“Save again” – until the page is reloaded. The
message names the reason:

| Response | Meaning | What helps |
|---|---|---|
| `400` | The file is not a recording made with ScoreView | record again in ScoreView |
| `409` | The maximum number of recordings for this score has been reached | replace the oldest one (the app asks) or delete one |
| `413` with a message from the app | The recording is longer than `max_recording_seconds` | record a shorter take or raise the limit |
| `413` without a message from the app (web server page) | The web server does not accept requests this large | `client_max_body_size` (nginx) to at least `20M`, see [Installation](installation.md#upload-size-for-recordings) |
| `507` “… all the storage allowed per person” | The per-person storage is full | delete older recordings, or raise `max_recording_bytes_per_user` |
| `507` “The storage for recordings on this server is full …” | The instance's storage for recordings is full | raise `max_recording_bytes_total` |
| `404` | The score is not (or no longer) reachable, or the recording belongs to someone else | – |

## A practice track cannot be saved

The message names the reason:

| Response | Meaning | What helps |
|---|---|---|
| `409` “… already exists” | A file with this name is already there | take the suggested name or “Replace” |
| `413` “The practice track is larger than allowed …” | The track is larger than `practice_track_max_mb` | save an excerpt (loop) or raise the limit ([Installation](installation.md#practice-tracks-and-offline-page)) |
| `413` without a message from the app (web server page) | The web server does not accept requests this large | raise `client_max_body_size` (nginx) |
| `507` “Not enough storage space.” | The quota of the owner of the target folder is full | free up space or choose a folder of your own |
| `403` “Saving here is not possible from the mobile app.” | In the app there is no freely chosen folder, and no export at all from a piece of a setlist | in the app, open the score itself and save next to it, or use the browser |
| `403` “You cannot save files in this folder.” | No write permission in the target folder, or the existing file cannot be modified | choose a folder of your own |
| `400` “This is not an MP3 file.” | The request body was not an MP3 – in the viewer only conceivable after an aborted render | save again |
| `404` | The score is not (or no longer) reachable, or practice tracks are turned off on this server | – |

**“Tracks for all parts” is missing:** only people who may create files next to the
score see the button. The export as a whole is missing if the
administration has turned it off, and on the offline page; as long as the sound
is not loaded, it says “The sound is not loaded yet.”

## The offline page stays empty or does not load without a network

- **Was it ever opened with a network?** The page sets itself up on the first
  visit with a network. Before that the browser does not know it and, without a network, shows
  its own error page. Remedy: open `/apps/scoreview/offline` once with a network
  until the list appears – ideally right
  after saving for offline use; the viewer points this out. On a phone it can
  then be added to the home screen.
- **Under which address?** The page only works under one form – with or
  without `index.php`, depending on how the instance builds its addresses. Under
  the other form it redirects when there is a network; a bookmark to the other form
  fails without a network. So set the bookmark **after** the redirect.
- **HTTPS?** Service workers only exist in a secure context. Over
  plain `http://` (except `localhost`) the page stays
  unusable without a network.
- **Does it show “Nothing saved for offline use yet”?** Then nothing has been saved for offline use
  in this browser for the signed-in account – saving applies per browser, and
  the page does not show entries of another account
  ([S10](architecture.md#s10-vorgemerktes-gehört-einem-konto-und-verschwindet-mit-der-anmeldung) (German)).
- **Was the person logged out?** If you open the page with a network without being logged in,
  Nextcloud redirects to the login, and this browser's saved content is
  deleted. Save it again after logging in.
- **“The offline page is turned off on this server”** or a 404: the
  administration has turned it off (`feature_offline`).

## “Removed by the browser – save it again”

The browser has deleted parts of the saved content. It is allowed to do so when space runs low,
because, in our measurements, it does not grant persistent storage (`navigator.storage.persist()`)
([Limits](limits.md#offline)). Remedy: save the piece or setlist
for offline use again in the viewer with a network, free up space on the device, and before
a concert open the offline page once more with a network – it then checks
every entry.

**“May be outdated”**, on the other hand, only means that the page could not reach the server when
it was opened; the entry is complete, just unchecked.

## “Save for offline use” is missing in the viewer

- **The mobile apps do not have it** – the offline page needs a
  browser. Via “Open in browser” it works there.
- **On the offline page itself** nothing is saved; that only works with a
  network from Files.
- **Turned off** by the administration (`feature_offline`).
- **“Open every piece once until it is shown”:** a piece of the
  setlist has not been converted yet. Only finished conversions are saved for offline use;
  open each piece once, then save again.

## Lyrics view or note names cannot be selected

The selection names the reason:

- **“This score has no lyrics.”** – that is how it is.
- **“These pages were set without the data this view needs.”**
  The score was converted by a sidecar that converts with MuseScore itself;
  stock MuseScore does not deliver lyric syllables and spellings
  ([E15](architecture.md#e15-fähigkeiten-statt-weg) (German)). A reconversion
  changes that only once the sidecar converts with the engine (see
  [The sidecar cannot convert with the engine](#the-sidecar-cannot-convert-with-the-engine))
  or the instance uses the local conversion path.
- **“This score has too much text for the lyrics view.”** More than
  20,000 syllables.
- **If the lyrics view shows “This part has no lyrics.”**, your
  own part has no text; change or deselect “My voice” (then the
  top part with text is used).

If the chosen display is not available for a score, the
viewer shows the pages with a notice and keeps the choice for the next
score.

## The sidecar cannot convert with the engine

The self-test reports *“The sidecar image cannot convert with "engine" – it
predates that choice”*, or variants fail with *“The sidecar image engraves no
display variants yet”*. The running image was built before ScoreView 1.24 and
only has MuseScore. Rebuild it from the root of the repository and replace the
container ([Updating](installation.md#updating)); until then, set the sidecar
to **MuseScore itself** in the settings. An update keeps existing sidecar
installations on MuseScore for exactly this reason.

## Parts, phone pages or concert pitch cannot be selected

Under **View → Pages and edition**, “Edition” and “Page format” name the reason when they
are greyed out:

- **“This server engraves no parts or phone pages …”** – the instance converts
  via a sidecar set to MuseScore itself, and stock MuseScore cannot engrave them
  ([E19](architecture.md#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild) (German)).
  The engine does – on the local path, on the sidecar once it is switched to
  the engine, and in the browser fallback.
- **A variant fails with “The conversion service is busy”** – both conversion
  slots of the sidecar were taken for 20 s. The server tries again a minute
  later; choosing the variant again is enough.
- **“Concert pitch” is missing** – no instrument in this score transposes, so
  there is nothing to show differently.
- **A stored part is missing from the list** – the score was converted before
  1.23.0. Opening it once converts it again; “Convert again” does the same at once.

When a chosen part or page format cannot be made, the viewer keeps showing the
score as the file has it, with a notice, and keeps the choice:

- **“Too many new parts or page formats in a short time.”** At most 20 new
  ones per person and hour (S4); ones already made do not count. Try again
  later.
- **“… could not be engraved.”** The details are in the Nextcloud log
  (`ScoreView: variant … failed`).

## On the iPhone the score is wider than the screen and does not follow sideways

Safari has enlarged the whole web page, not the score. The viewer cannot see
that zoom, so it keeps the page as wide as it believes the screen to be and
does not scroll sideways after the playing position.

- **Zoom back out** with two fingers on the Nextcloud header bar, or via
  **aA → 100 %** in Safari's address bar. Over the viewer itself Safari's
  zoom is switched off, so the gesture does not work there.
- **To enlarge the score**, use two fingers on the score or the zoom
  control in the bar – that zoom is the viewer's own, and the view follows
  the playing position with it.

## On a phone in landscape the score gets little height

Safari's bars, the header of Nextcloud's viewer and the control bar share the
little height there is. The control bar retracts to a thin line by itself
during playback, in performance mode and while following a leader; tap the
line to bring it back. Beyond that:

- **Use the system band** (View → Pages and edition). Each system there is as tall as the
  space allows, so the height the bar gives up goes straight to the music. In
  the page view, “Fit width” makes the page wider than the screen is tall.
- **Add the offline page to the home screen** for a concert or rehearsal
  (save the pieces for offline use first). Opened from the home screen, it
  runs without Safari's bars and without the Nextcloud header. This has not
  been checked on an iPhone.
- The rest is not up to ScoreView, see
  [Limits](limits.md#mobile).

## A score takes minutes to open the first time

It opens in the end, only late, and the next time it opens at once. That is no
fault: opening a score without a conversion queues the conversion, and cron
runs it on its next pass – with the usual 5-minute cron up to 5 minutes later,
on the sidecar path usually one pass more. Meanwhile, after two minutes, the
viewer says that the first opening can take a while.

A dedicated background job worker for ScoreView's jobs removes the wait; see
[Installation, step 5](installation.md#optional-open-new-scores-without-waiting-for-cron).
If the score never opens, see the next section.

## The conversion does not make progress

Background jobs are not running. Nextcloud's default mode `ajax` is not
reliable enough; it takes `cron` **and** a real cron invocation of `cron.php`:

```sh
occ background:cron
```

The status diagnostics report this case explicitly (“no run in the last
15 minutes”). See
[Installation, step 5](installation.md#5-make-sure-background-jobs-run).

**How to recognise it in the viewer.** After two minutes a notice pointing to
cron appears below the loading spinner; after half an hour the viewer gives up
with “The conversion was never finished”. Both are a statement about the
*instance*, not about the score – opening a different file does not help. The
notice alone proves nothing: with a working 5-minute cron it can appear as
well (see the previous section). The status diagnostics tell the two apart.

The same applies to a run that died along the way (a killed
cron pass, out of memory, container restart). The record then
stays at `processing`; after half an hour it is considered dead, is
reported as an error the next time the score is opened, and is queued again. “Convert
again” works on it again as well – unlike on a run that
is actually still working.

## “The conversion service could not be reached”

Applies to the sidecar path. Three causes, to be checked in this order:

1. **No shared Docker network.** On Docker's default bridge,
   container names do not resolve. The sidecar is running, `curl` from the host works,
   and Nextcloud still cannot reach it. Both containers must be in the same
   user-defined network (`--network`).
2. **SSRF protection.** Nextcloud blocks outgoing requests to internal
   host names. Without
   `occ config:system:set allow_local_remote_servers --value=true --type=boolean`
   every call fails with “violates local access rules”.
3. **Wrong secret.** The sidecar then responds with 401. The “Run conversion
   self-test” button on the administration page distinguishes the cases.

## The local conversion path does not work

The status diagnostics on the administration page answer the three questions
separately, because from the outside they all look the same:

- **“PHP is not allowed to start processes”** – `proc_open` is blocked via
  `disable_functions`. This can only be changed in the PHP configuration;
  where that is not possible, only the sidecar path remains.
- **“No Node.js runtime found”** – `node` is searched for via `PATH` and
  in the usual locations. PHP-FPM often runs with a stripped-down `PATH`;
  in that case enter the absolute path. Cross-check with the same account that
  Nextcloud runs under:
  ```sh
  sudo -u www-data /usr/bin/node --version
  ```
- **“The engine package (scoreview-engine) is missing”** – the app package lacks
  `converter/node_modules`. This happens when the app was installed from a Git checkout
  instead of a release tarball; there the directory is
  gitignored. Fix it with `npm ci` in `scoreview/converter/`.
- **“Deno … is too old”** – `node_path` points to Deno 1.x. Deno 2 or later
  is required; `deno upgrade` or a current binary fixes it.

**The conversion fails with “Access to this API has been restricted” or
“NotCapable” in the log.** That is the isolation of the converter
([S11](architecture.md#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis), German)
refusing an access. Normally the converter needs nothing beyond what it is
granted; the usual causes are a `cjk_font_dir` the web server account cannot
read, or a converter directory reached through a symlink that also points
somewhere else. **“Deno cannot grant access to a path containing a comma”**
names the path: move it (temp directory, `cjk_font_dir`) to one without a
comma, or use Node.js. The isolation cannot be switched off – that is on
purpose.

**The “Isolation” row is yellow.** The runtime cannot lock the converter in –
Node.js 18 or 20.0–20.6. Conversion works as before. Node.js 20.7 or later
locks the file system, Node.js 25 or later or Deno locks the network as well
([1a](installation.md#1a-path-a-provide-nodejs)).

The “Run conversion self-test” button converts a bundled
mini score via the
selected path and names the cause in plain language. The same by hand:

```sh
cd /var/www/html/custom_apps/scoreview/converter && node convert.mjs --selftest
```

## The status diagnostics show a “Fallback” row

Then the **browser** is currently converting, because the server cannot
([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall) (German)). That is not
an error, but a stopgap – the scores are visible and playable.

**The red row above it still matters**: it names the reason
why the server is not converting (see the two sections before this one). As long as
that reason persists, the following applies to every user:

- Every device downloads just over 7 MB of converter once on first open (14 MB
  unpacked).
- Nothing is cached permanently: every score is set again after every
  reload of the page, on every device.
- The “Convert new/changed scores immediately” switch has no effect, and the self-test still
  only checks the server path.

This is not fixed at the fallback but at its cause: provide Node
(path A) or make the sidecar reachable (path B). After the repair, the
fallback no longer applies the next time a score is opened – the stored verdict is valid for
at most five minutes and is discarded immediately by saving the settings and by the
self-test. Scores already set in the browser then show up
in the server cache as normal, as soon as they are opened once.

## The viewer reports “This score could not be set in this browser”

Two messages belong to the fallback and appear in no server log, because they
originate in the browser:

- **“… is too large to be set in this browser”** – the score
  is above `client_max_score_bytes` (default 10 MB). This is deliberately checked
  **before** the converter is loaded, so that just over 7 MB are not
  downloaded for nothing. The limit is an `occ`-only setting:
  ```sh
  occ config:app:set scoreview client_max_score_bytes --value 20971520
  ```
  Raising it is a promise to the weakest device in the choir –
  how much a tablet can handle has not been measured (see [Limits](limits.md)).
- **“… could not be set in this browser”** – the converter could not
  be loaded or could not be started. The technical detail below the message
  names the exact URL. Most common causes: the download was interrupted, or the
  page was loaded **before** the fallback became active – then exactly
  this document still carries the stricter CSP, and a reload is enough. If it
  persists, look for `securitypolicyviolation` in the browser console: a
  blocked web worker reports **only** there and nowhere else.

## “No sound: …” above the score view

The score view keeps working, only playback does not. If the text after the
colon reads “The server could not provide the SoundFont”, the cause is on the
server: the **SoundFont** row of the status diagnostics names it, the
Nextcloud log has it as “SoundFont could not be provided”, and
the browser console shows it as well. The usual causes:

- **The sidecar does not serve a SoundFont** – the image does not contain one
  (any more). Check and, if necessary, set `SCOREVIEW_SOUNDFONT_PATH`, see
  [`../sidecar/README.md`](../sidecar/README.md#konfiguration) (German):
  ```sh
  curl -s -H "X-ScoreView-Secret: <secret>" http://scoreview-sidecar:8765/soundfont/info
  ```
- **Silent on the local conversion path** – there is no image there that would bring a
  SoundFont along; the server fetches it from the network the first time something is played.
  If it cannot get there (no outgoing HTTPS, proxy, firewall), playback
  stays silent. Remedy: put the file somewhere yourself and enter the address
  under **SoundFont download URL**; see
  [Installation](installation.md#soundfont).
- **HTTP error with a SoundFont URL you entered yourself** – for the
  **Custom SoundFont URL**, the address must be reachable from the **browser**, not
  just from the server, and must allow CORS. For the **SoundFont download URL**,
  reachability from the server is enough; an empty field there means the default
  address, not “no SoundFont”.

## The sound lags behind the score cursor (or vice versa)

Almost always the **output latency** – strongest over Bluetooth headphones, where
codec buffers and the radio link make the difference (measured: 232 ms on an
Android phone versus 51 ms on a workstation); at ♩ = 120 that is almost
an eighth note. The app compensates for it **by itself**, as far as the browser
reports it – on Android with Bluetooth headphones it does (the 232 ms above came
from the automatic compensation, with the slider untouched).

If an offset remains anyway, the headphones do not report their delay
themselves, and exactly that share is missing from the automatic compensation. Remedy:
**Playback and practice → Tempo → “Sync picture and sound”**. Move the slider during
playback until the highlighted note matches what you hear. The
value is remembered per device – so on the phone with headphones it is a different one than on the
computer.

Whether the browser knows the latency on its own can also be checked without the app in
30 seconds: a YouTube video with a talking face on the same
device, with the same headphones. If it is lip-synchronous, the audio stack knows
the latency and the automatic compensation handles it; if it is not, the browser itself does not
know it and the slider does most of the work.

**Score → Info and diagnostics** shows the numbers for this: “measured”
comes from `getOutputTimestamp()`, “reported” from `baseLatency + outputLatency`,
“by hand” is the slider. A dash instead of a number means that the browser
says nothing about it.

## The sound crackles or drops out, the parts sound ragged together

Something different from the case above, even if it feels similar: here
the timing is right, but the synthesis cannot keep up on the device. You can
see it under **Score → Info and diagnostics** in the
**“Dropouts”** row – if a growing number appears there, it is the processing load; if it stays
at 0, it is the latency, and the section above applies.

For dropouts, reducing the load helps: close other tabs, zoom the score
out (less DOM per page), or read the score without sound
(“Continue without sound” while loading). A smaller SoundFont file also reduces the load,
see [Installation](installation.md#soundfont).

## The conversion fails

The viewer shows an understandable message, with the technical detail
next to it. The error codes:

| Code | Meaning | What helps |
|---|---|---|
| `sidecar_unreachable` | Service not reachable | see above |
| `sidecar_busy` | The sidecar was busy over many attempts (full queue) | it is resubmitted the next time the score is opened; under sustained load raise `SCOREVIEW_MAX_CONCURRENT`/`SCOREVIEW_MAX_QUEUED`, see [Sidecar](../sidecar/README.md) (German) |
| `sidecar_rejected` | File rejected (e.g. secret, size) | check the secret and `SCOREVIEW_MAX_UPLOAD_BYTES` |
| `too_large` | Score exceeds the limit | raise `max_score_bytes` (default 100 MB) or split the score |
| `timeout` | Conversion not finished in time | Sidecar: from submission, the app waits a fixed maximum of 300 s – at about 6 s per page, roughly 50 pages, see [Limits](limits.md). Raising `MSCORE_TIMEOUT_SECONDS` (default 600 s) therefore does not help; if the sidecar itself aborts, that is `conversion_failed`. Local: `local_timeout` (default 120 s) |
| `conversion_failed` | MuseScore itself failed | open the file in MuseScore; often a broken `.mscz`. On the local path, the converter's output is in `nextcloud.log` |
| `no_pages` | Conversion ran, but delivered no page | trigger the self-test; points to a problem in the image |
| `local_unavailable` | Local path selected, but not runnable | see [above](#the-local-conversion-path-does-not-work) |
| `stale` | A run was never finished | see [above](#the-conversion-does-not-make-progress) |
| `client_too_large`, `client_engine_unavailable` | Only with the fallback in the browser | see [above](#the-viewer-reports-this-score-could-not-be-set-in-this-browser) |
| `unknown` | Everything else | check `nextcloud.log` for the exception |

## The viewer shows an outdated version of the score

Two causes that feel similar and have to be handled separately.

**On the server**, a finished conversion stays in place as long as nobody touches the
file. On the local path there is one exception: when an update brought a newer
scoreview-engine, a score is converted again the next time it is opened, once,
with the usual wait. A conversion by the sidecar stays, and so does one where
only the app improved without a new engine, or where the origin still reports
“Unknown”. For those, the **“Convert again”** button under
**Score → Info and diagnostics** discards it and has it generated again; it
only appears with write permission on the file. For all scores of an instance
at once, `CURRENT_FORMAT_VERSION` is the lever (see
[Architecture](architecture.md#konvertierung-und-cache) (German)).

**In the browser**, an entry in the browser cache can linger that a normal
reload does not clear – Chrome does not revalidate subresources in that case.
A single hard reload (`Ctrl`+`Shift`+`R`) is enough; the artifact links
carry the conversion's timestamp and are then replaced automatically. Whether
the browser still runs the scripts of an older version shows under
**Score → Info and diagnostics**: “App version” is the version of the scripts
loaded, not the one installed on the server.

## The viewer reports HTTP 500

A cache format change is **not** a possible reason: the
`format_version` column marks every entry, and an entry with an older version –
or with a missing cache file – automatically triggers a reconversion
(see [Architecture](architecture.md#konvertierung-und-cache) (German)). If a 500
occurs, it is a different case: check `nextcloud.log` for the specific exception.

## “database is locked” (SQLite)

Cron runs too often and collides with parallel requests. Go back to the usual
interval (Nextcloud default: every 5 minutes) or switch to
MySQL/PostgreSQL.

## A newly added route returns 404

Concerns development, not operation. Nextcloud's `CachingRouter` stores the
complete compiled route table in the local cache for 3600 s, with the
**Host header as part of the key**. A new route therefore does not exist for requests
with the same host for up to an hour – and separately for each host:
the same request with `Host: localhost` instead of `Host: localhost:8080` hits a
different cache key and works immediately. That makes the symptom very
misleading.

Remedy: increase the app version in `appinfo/info.xml` and run `occ upgrade`
(the usual way), or clear the local cache – in the container setup most
easily by restarting the Nextcloud container.

In operation, the same symptom can occur after an app update if the files
were replaced but `occ upgrade` did not run: then the routes
that the new version brings with it respond with 404 – for example those of “Follow me”, setlists
or recordings, while the score itself can be opened. `occ upgrade`
fixes that and at the same time creates the new tables.
