# Installation and configuration

**English** · [Deutsch](installation.de.md)

ScoreView consists of the Nextcloud app and a conversion path. There are
**two to choose from**, and they deliver the same result
([E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api) (German)):

| | **Path A: Local** (default) | **Path B: Sidecar** |
|---|---|---|
| Requires | Node.js ≥ 18 or Deno ≥ 2 on the Nextcloud server | a Docker host |
| MuseScore | MuseScore 4.7.5 as WebAssembly, in the app package | real MuseScore 4 in the container |
| SoundFont | fetched by the server itself from a preset address | shipped with the container |
| To set up | nothing | start the container, enter address and secret |
| Coloured noteheads, lyrics view, note names | yes | no – stock MuseScore does not deliver the data ([E15](architecture.md#e15-fähigkeiten-statt-weg), German) |
| Parts, phone pages, concert pitch, transposed notes | yes, engraved on demand ([Display variants](limits.md#display-variants)) | no ([E19](architecture.md#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild), German) |
| Recommended if | no containers are running | containers are running anyway |

**Path A is the default and needs no configuration.** Where a Node runtime is
available, the app is ready for use after `occ app:enable scoreview`; what
remains are steps 4 and 5 below, which apply to both paths. For path B, allow
15 minutes.

**And if neither works?** On managed hosting – no Node runtime, no containers,
`proc_open` disabled – the app converts in the user's browser
([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall), German). There is
nothing to set up for this: the fallback kicks in on its own as soon as the
server cannot convert, and it shows up in the status diagnostics. All you
need to know is what it costs – every device downloads just over 7 MB once (14 MB
unpacked), and nothing is cached on the server. Where the server can convert,
it is not active.

## Requirements

- Nextcloud 31 to 35
- PHP 8.1 to 8.5
- SQLite, MySQL/MariaDB or PostgreSQL
- Background jobs in `cron` mode (step 5)
- Depending on the path: **A** a Node.js runtime, version 18 or later, or
  Deno 2 or later, on the Nextcloud server, and PHP must be allowed to start processes (`proc_open` not
  blocked via `disable_functions`). **B** a Docker host – the same machine as
  Nextcloud or a different one, reachable over HTTP. **Neither** is also
  possible: then the browser converts (see above); this requires a browser that
  supports WebAssembly and Web Workers – that is, any current one.
- On path A, the server needs outgoing HTTPS once: it fetches the SoundFont
  on first playback. Where that is not possible, an address of your
  own takes the place of the preset one – see [SoundFont](#soundfont).

The `occ` commands below are written as they run on a native installation. On a
container installation, prefix them with `docker exec -u www-data
<container> php`.

## 1a. Path A: Provide Node.js

For the local path there is nothing to build and nothing to start – the
converter comes ready-made in the app package (`scoreview/converter/`, about
15 MB). All that is needed is a Node.js runtime that the Nextcloud process is
allowed to start:

```sh
node --version   # must report v18 or newer
```

**The official Nextcloud Docker image does not include one.** Add it there:

```sh
docker exec <container> sh -c 'apt-get update && apt-get install -y nodejs'
```

On a native installation, use the distribution's package manager. For this to
survive an image update, the line belongs in your own Dockerfile based
on `FROM nextcloud:…` rather than in the running container.

The converter itself is pure JavaScript and WebAssembly, and therefore
independent of operating system and processor architecture – there is nothing
to compile.

**Isolation.** Every conversion runs locked in: it may read the score and
write its result, nothing else
([S11](architecture.md#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis), German).
How far that goes depends on the runtime – Node.js 20.7 to 24 lock the file
system and processes but not the network, Node.js 25 and later and Deno lock
everything, Node.js 18 nothing
([Limits](limits.md#isolation-of-the-local-converter)). The status
diagnostics show the level in the **Isolation** row. Nothing needs to be
switched on for it.

**Deno instead of Node.js.** If the distribution's Node.js cannot block
network access, Deno can: install the official binary (for example to
`/usr/local/bin/deno`, see [deno.com](https://deno.com)) where the Nextcloud
process may run it, and enter its path as `node_path` (step 3). The app does
not search for Deno by itself – it is a choice, not something picked up
because it happens to be installed. Deno 2 or later is required; Bun is not
supported, as it cannot isolate the converter.

## 1b. Path B: Start the sidecar

Build the image (it contains a pinned MuseScore Studio version):

```sh
docker build -t scoreview-musescore-cli sidecar/
```

Create a shared network so that Nextcloud can reach the sidecar by its
container name, and start the container:

```sh
docker network create scoreview-net
docker network connect scoreview-net <nextcloud-container>

docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET="$(openssl rand -hex 32)" \
  --memory=2g --pids-limit=512 \
  scoreview-musescore-cli
```

Make a note of the secret – step 3 needs it. Without
`SCOREVIEW_SIDECAR_SECRET` the container deliberately refuses to start: an
unauthenticated conversion service that accepts arbitrary files should not come
into existence by accident.

> **Don't forget `--network`.** Docker's default bridge has no name resolution
> between containers. The container then starts without errors, `curl` from the
> host works perfectly – but Nextcloud cannot reach it, and the status
> diagnostics only show the **Conversion** row in red, with a cURL message
> about name resolution.

`--memory` and `--pids-limit` are recommended for production: the container
turns a large C++/Qt code base loose on untrusted `.mscz` uploads. Details and
further environment variables are in
[`../sidecar/README.md`](../sidecar/README.md) (German).

If you want to run the sidecar on a different machine or without Docker, the
options are described under
[Deployment](../sidecar/README.md#bereitstellung) (German).

## 2. Install the app

Via the Nextcloud App Store, or unpack the `scoreview.tar.gz` archive of a
[GitHub release](https://github.com/AndiMb/scoreview/releases) into `apps/` so
that `apps/scoreview` is created. A Git checkout of `scoreview/` is not
enough: the frontend bundle (`js/`) and the converter engine
(`converter/node_modules`) are not checked in; they are only created by the
build ([Development](development.md) (German)). Then:

```sh
occ app:enable scoreview
occ upgrade
```

## 3. Configure the conversion path

Under **Settings → Administration → ScoreView** the choice is at the very top;
below it, it shows whatever has to be entered for the selected path. The
local path is the default.

### Path A: Local

**There is nothing to configure here.** If `node` is in one of the usual
places, the app finds it on its own; the server fetches the SoundFont on first
playback from a preset address (see [SoundFont](#soundfont)). Only if `node`
lives elsewhere does it need to be specified:

```sh
occ config:app:set scoreview node_path --value=/usr/bin/node   # only if needed
```

The same setting takes Deno, for full isolation (see
[1a](#1a-path-a-provide-nodejs)):

```sh
occ config:app:set scoreview node_path --value=/usr/local/bin/deno
```

### Path B: Sidecar

Select the sidecar, and enter its URL (e.g. `http://scoreview-sidecar:8765`)
and the secret from step 1b. Alternatively on the command line:

```sh
occ config:app:set scoreview conversion_backend --value=sidecar
occ config:app:set scoreview sidecar_url --value="http://scoreview-sidecar:8765"
occ config:app:set scoreview sidecar_secret --value="<secret>" --sensitive
```

Nextcloud blocks outgoing requests to local and internal host names (SSRF
protection). Without the following setting, every sidecar call fails with
"violates local access rules" – Collabora and OnlyOffice integrations need the
same setting. This also applies to a sidecar on a different host, as long as it
is reachable under a private IP or an internal name:

```sh
occ config:system:set allow_local_remote_servers --value=true --type=boolean
```

### Verify

On the administration page, one button checks the status and a second one,
**"Run conversion self-test"**, starts the self-test: a real conversion of the
bundled mini score via the selected path, including a check of every guarantee
the app relies on. Trigger it once after every change of the MuseScore version.

## 4. Mimetype (usually nothing to do)

So that a `.mscz` counts as `application/x-musescore`, **the app registers the
mimetype itself** – on installation, on every update, and again after every
upload
([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste) (German)).
This needs neither `occ` nor write access to `config/`; it works just the same
on managed hosting.

You can check this without a shell, using a user's credentials:

```sh
curl -u <user> -X PROPFIND -H 'Depth: 0' \
  --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontenttype/></d:prop></d:propfind>' \
  'https://<instance>/remote.php/dav/files/<user>/path/score.mscz'
```

If it says `application/x-musescore`, everything is fine. If it says
`application/octet-stream`, either the app update has not run yet, or the score
was only just uploaded and the responsible background job has not run yet (see
step 5 – without cron it stays pending).

### What registering by hand adds

There are two things an app cannot do, both purely cosmetic or a matter of
timing:

- **The dedicated file icon.** It depends on `mimetypealiases.json` and on
  `occ maintenance:mimetype:update-js`.
- **Detection on upload.** For this, Nextcloud consults its own mapping table;
  a freshly uploaded score therefore carries `application/octet-stream` until
  the next cron run.

If you have `occ` and want both, copy the contents of
`scoreview/appinfo/mimetypemapping.json` and
`scoreview/appinfo/mimetypealiases.json` into the server's
`config/mimetypemapping.json` and `config/mimetypealiases.json` respectively –
keep any other existing entries, don't overwrite them; Nextcloud only overlays
the file in `config/` on the bundled one via `array_replace`, so the default mappings
are preserved. Then:

```sh
occ maintenance:mimetype:update-db
occ maintenance:mimetype:update-js
```

`update-db` **also updates existing files**: for every mimetype not yet in the
database, it also updates all filecache rows with the matching extension –
across all storages, group folders and shares included. An `occ files:scan` is
not needed for this. Only if the mimetype was already registered do existing
files remain untouched; then
`occ maintenance:mimetype:update-db --repair-filecache` helps.

## 5. Make sure background jobs run

Conversions run as a background job. Nextcloud's default mode `ajax` is not
reliable enough for this: jobs visibly stay at `pending` if no page request
triggers them. After two minutes the viewer says that the first opening can
take a while and points to cron; after half an hour it gives up – so without a
running cron, a score cannot be opened at all.

```sh
occ background:cron
```

This requires a real cron on the server that calls `cron.php` regularly
(Nextcloud default: every 5 minutes). The status diagnostics on the
administration page check this as well and report when the last run was too
long ago.

### Optional: open new scores without waiting for cron

Opening a score that has no conversion yet only *queues* the conversion, and
cron picks it up on its next run. With the usual 5-minute cron, the first
opening of a new score therefore waits:

| Conversion path | Without a worker | With a worker |
|---|---|---|
| Local | 0–5 min until the next cron run, plus the conversion | about 1 s, plus the conversion |
| Sidecar | usually one more cron run for the result, so about 5–10 min | about 1 s, plus the conversion; the sidecar is asked every few seconds |

The conversion itself takes about a second on the local path and 6 s per page
on the sidecar path (see [Limits](limits.md#measured-values)). A score that
was uploaded after ScoreView was installed is usually converted already,
because the upload queues it as well. The wait hits existing files, and every
score once more after an update that changes the cached format.

Nextcloud's `occ background-job:worker` removes the wait. Given job classes, it
runs only those and checks for new ones every second; cron keeps running all
other jobs. Try it by hand first (adjust the path to your installation):

```sh
sudo -u www-data php /var/www/nextcloud/occ background-job:worker \
  --stop_after=2m \
  'OCA\ScoreView\BackgroundJob\ConvertScoreJob' \
  'OCA\ScoreView\BackgroundJob\PollConversionJob' \
  'OCA\ScoreView\BackgroundJob\RegisterMimetypeJob'
```

`RegisterMimetypeJob` is optional: it corrects the type of freshly uploaded
`.mscz` files, which otherwise only offer “Download” until the next cron run.

To run it permanently, use a systemd unit such as
`/etc/systemd/system/scoreview-worker.service`. systemd reads a backslash as
the start of an escape sequence, so the class names need it doubled there:

```ini
[Unit]
Description=ScoreView conversion worker
After=network.target

[Service]
User=www-data
ExecStart=/usr/bin/php /var/www/nextcloud/occ background-job:worker --stop_after=1h 'OCA\\ScoreView\\BackgroundJob\\ConvertScoreJob' 'OCA\\ScoreView\\BackgroundJob\\PollConversionJob' 'OCA\\ScoreView\\BackgroundJob\\RegisterMimetypeJob'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload
systemctl enable --now scoreview-worker
```

With the official Docker image, which has no systemd, run the same command in
a second container from the same image, with the same volumes and network as
the Nextcloud container, as user `www-data` and with `--restart always`.

Two things to know when running it:

- **The worker keeps the code it loaded.** After an update of ScoreView, the
  new code takes effect when the worker restarts – with `--stop_after=1h` and
  `Restart=always` at most one hour later. `systemctl restart
  scoreview-worker` makes it immediate.
- **The worker does not check for maintenance mode.** Stop the unit before a
  Nextcloud upgrade and start it again afterwards.

The worker does not replace cron: Nextcloud's other background jobs, and
ScoreView's cleanup, still need it.

## SoundFont

Playback is synthesised in the browser
([E1](architecture.md#e1-midi-statt-mp3-als-audioartefakt) (German)) and needs
a SoundFont for it. Where it comes from depends on the selected path.

**In both cases there is nothing to do** – only the way it gets there differs.

**Path A: from a preset address.** Without a sidecar there is no image to take
a SoundFont from, and it cannot be bundled: the App Store only accepts archives
up to 30 MiB, and the package already takes about 21 MB. The **server**
therefore fetches the file from the network once and then delivers it itself;
the preset is `FluidR3Mono_GM.sf3` (~23 MB, MIT-licensed, the same SoundFont
that MuseScore ships with) as a release asset of this project.

The **SoundFont download URL** field overrides this address. It only needs to
be reachable from the server and needs no CORS. It is fetched once per URL – if
you later put a different file at the same address, enter a new address (for
example with `?v=2` appended) or discard the cached state with
`occ config:app:delete scoreview soundfont_cache_version`; saving the same
address again does not trigger a new download.

**Path B: from the container.** If a sidecar is running, the app fetches the
SoundFont from there, because its MuseScore installation already ships one –
nothing is downloaded from the network. The browser never talks to the sidecar
in the process; the app stores the file in its IAppData cache and delivers it
itself.

The first request after a fresh installation transfers the SoundFont to the
browser once: ~23 MB on path A (`FluidR3Mono_GM`), ~40 MB on path B
(`MuseScore_General_Lite` from the sidecar image). After that, the server-side
cache and `Cache-Control: immutable` take effect. The SoundFont's address
carries its version, so a different file – a new sidecar image, a changed
download URL – reaches every browser without clearing any cache; each device
then downloads it once more. On path B, the new version becomes known as soon
as anything requests the SoundFont, at the latest the next device without a
copy.

The **Custom SoundFont URL** field is something else: an override where the
**browser** loads directly from this address. It must then be reachable from
the browser and allow CORS; the app adds the host to the `connect-src` policy
automatically. An empty field means: the app delivers it itself.

## Rehearsal and concert

Leaders, "Follow me", own recordings, intonation feedback, practice tracks
and the offline page are switched on after installation and need nothing
further. Under **Settings → Administration → ScoreView**, sections
**Rehearsal and concert** and **Practising on the go**, they can be switched
off individually; a switched-off feature disappears from the viewer, and its
endpoints respond with 404. A few things are still worth knowing.

### `notify_push` for "Follow me" (recommended)

Without push, every following device polls the server every 800 ms during a
session. That costs about 50 ms of CPU per device and request – with 40 singers,
2–3 cores for the duration of the rehearsal
([Limits](limits.md#follow-me)). With the
[`notify_push`](https://github.com/nextcloud/notify_push) app, the server sends
an event on every change, and the devices only query then. ScoreView needs no
setting of its own for this: if `notify_push` is installed and set up, it is
used; otherwise the devices poll.

```sh
occ app:install notify_push
occ notify_push:setup   # guides you through the service and the reverse proxy
```

The status diagnostics show under **"Follow me"** whether push is in
effect, and recommend installing it once there are about 20 following devices. Where
`notify_push` is not an option, a larger **Polling interval**
(`follow_poll_ms`, 500–3000 ms) lowers the load – at the cost of jumps arriving later.
The mobile apps always poll, even with `notify_push`.

"Follow me" does not need a cron run: everything happens within the requests
themselves.

### Upload size for recordings

A recording is uploaded as one WAV file, about 19 MB at the default maximum of
600 s. The web server in front of Nextcloud must accept requests of this size –
for nginx, `client_max_body_size` at least `20M` (Nextcloud's recommended nginx
configuration sets more anyway). The PHP limits
`upload_max_filesize`/`post_max_size` do not matter; the app reads the request
body itself and enforces its own limit. If you raise `max_recording_seconds`,
allow for about 32 KB per second.

Recordings are stored in the app data (IAppData) and count against **no** user
quota. That is why the app has its own limits, configurable in the
administration settings (in MB there) or via `occ` (in bytes):

```sh
occ config:app:set scoreview max_recordings_per_score --value 5
occ config:app:set scoreview max_recording_seconds --value 600
occ config:app:set scoreview max_recording_bytes_per_user --value 209715200    # 200 MB
occ config:app:set scoreview max_recording_bytes_total --value 5368709120      # 5 GB
```

Values outside the permitted range are clamped when read (see the table below).

### Microphone

Nextcloud blocks the microphone on every page via `Feature-Policy`. ScoreView
allows it on the pages under `/apps/files` and on the page for the mobile apps,
and only while recording or intonation is switched on – the Dashboard, Talk and
everything else remain unaffected. A permission granted by the browser then
applies within Files to all scripts there, as with Talk. If you don't want
that, switch off recording and intonation; ScoreView then stops allowing the microphone.

The microphone requires a secure context, i.e. HTTPS (or `localhost`).

### Companion tokens for the mobile apps

For setlists, the app issues short-lived companion tokens from the page for the
mobile apps (at most 12 h,
[E8](architecture.md#e8-eine-eigenständige-seite-für-die-mobilen-apps) (German)).
The app creates the secret for them on installation and update. Revoking all
issued tokens at once means discarding it:

```sh
occ config:app:delete scoreview companion_secret
```

A new one is created on next use; the change takes effect everywhere within
3 s at most. A rejected request makes the page fetch new tokens itself, as long
as its Direct Editing token is still valid. The tokens of an individual person
also expire when they change their password or their account is disabled.

The same applies to the tokens a following device gets in the app when a leader
takes their "Follow me" session on to the next piece.

### Practice tracks and offline page

The **Practising on the go** section of the administration page has two
switches and one limit.

**Practice tracks as MP3 files in Files** (`feature_practice_export`). The
browser renders the current mix as an MP3 and places it next to the score, in a
"Practice tracks" subfolder or a folder of one's own choosing
([E13](architecture.md#e13-übe-tracks-sind-dateien-in-files) (German)). The
files count against the folder owner's quota like any other file; there is
therefore no separate storage limit as for recordings, only one per file:

```sh
occ config:app:set scoreview practice_track_max_mb --value 60   # 5-500, in MB
```

A track takes up about 1 MB per minute of music. As with recordings, the web
server must accept requests of this size – for nginx, `client_max_body_size` at
least as large as the longest tracks expected; the PHP limits do not matter.
The name of the subfolder is in the instance's default language
(`default_language` in `config.php`), so that it has the same name for
everyone.

**Offline page** (`feature_offline`). People use **Save for offline use** on scores
or setlists in the viewer and open them without a network via `/apps/scoreview/offline`
([E14](architecture.md#e14-eine-offline-seite-mit-eigenem-service-worker), German).
Data is stored only in the person's browser; the server needs nothing for this.
When switched off, the page, service worker and manifest respond with 404, and
the viewer no longer offers "Save for offline use"; whatever has already been
saved stays in
the respective browser until the person removes it. Two things are worth
knowing:

- A service worker requires a secure context, i.e. HTTPS (or `localhost`).
- Content saved for offline use is bound to the device and, in Chrome, survives logging out
  until the offline page is opened again with a network
  ([Limits](limits.md#offline)). On devices shared by several people, nobody
  should mark anything.

An external SoundFont (`soundfont_url`) needs nothing further: the offline page
allows its origin in its own CSP.

## Settings at a glance

| Key | Where | Meaning |
|---|---|---|
| `conversion_backend` | Administration | `local` (default) or `sidecar` |
| `node_path` | Administration¹ | Path to `node` or `deno`; empty = search the usual places for `node` (path A). Absolute, program name `node`, `nodejs` or `deno` (also `node20`, `.exe`) |
| `soundfont_fetch_url` | Administration¹ | Address from which the server fetches the SoundFont once; empty = preset address (path A) |
| `sidecar_url` | Administration¹ | Address of the conversion service (path B) |
| `sidecar_secret` | Administration¹ | Shared secret, stored as sensitive and hidden in `occ config:list` (path B) |
| `soundfont_url` | Administration | Override: the browser loads directly from this address |
| `eager_conversion` | Administration | Convert immediately on upload instead of on first opening |
| `local_timeout` | `occ` only | Time limit of a local conversion run in seconds (default 120) |
| `cjk_font_dir` | `occ` only | Directory with additional fonts for CJK lyrics, outside the app (path A) |
| `max_score_bytes` | `occ` only | Upper limit of the file size (default 100 MB) |
| `client_max_score_bytes` | `occ` only | Upper limit for conversion **in the browser**, much smaller (default 10 MB). Checked before the browser loads the engine |
| `feature_follow_session` | Administration | Leaders and "Follow me" (default on) |
| `feature_recording` | Administration | Own recordings (default on) |
| `feature_intonation` | Administration | Intonation feedback (default on) |
| `feature_score_follower` | `occ` only | Intended for score following via microphone, not functional yet (default off) |
| `feature_practice_export` | Administration | Practice tracks as MP3 in Files (default on) |
| `practice_track_max_mb` | Administration | Maximum size of a practice track in MB (default 60, 5–500) |
| `feature_offline` | Administration | Offline page and "Save for offline use" (default on) |
| `follow_poll_ms` | Administration | Polling interval of "Follow me" without push, in ms (default 800, allowed 500–3000) |
| `max_recordings_per_score` | Administration | Recordings per person and score (default 5, 1–50) |
| `max_recording_seconds` | Administration | Maximum length of a recording in seconds (default 600, 10–3600) |
| `max_recording_bytes_per_user` | Administration (MB), `occ` (bytes) | Storage for recordings per person (default 200 MB, 10 MB–100 GB) |
| `max_recording_bytes_total` | Administration (MB), `occ` (bytes) | Storage for recordings across the whole instance (default 5 GB, 100 MB–10 TB) |
| `companion_secret` | `occ` only | Secret of the companion tokens, stored as sensitive; deleting it revokes all of them ([above](#companion-tokens-for-the-mobile-apps)) |

¹ On the administration page, only members of the `admin` group can change
these, not groups to which the ScoreView settings are delegated – the server
starts this path as a program or fetches these addresses itself
([S9](architecture.md#s9-was-programme-startet-oder-adressen-abruft-stellt-nur-ein-voller-admin-ein) (German)).
When set via `occ`, the restriction does not apply.

## Checking that everything works

1. Open **Settings → Administration → ScoreView**. The status diagnostics
   show the status of the selected conversion path, the SoundFont status, the
   cron age and the number of conversions per status. If there is a
   **Fallback** row, the browser is currently converting – the row above it
   states the reason why the server is not.
2. Upload a `.mscz` file in Files and click it. The first time, the conversion
   visibly starts; after that, the same file opens from the cache.

If something gets stuck: [Troubleshooting](troubleshooting.md).

## Updating

App updates run the usual way (`occ upgrade`).

The local converter comes with the app package and needs no separate step.

The sidecar, by contrast, is updated separately – rebuild it, remove the old
container, start a new one with the same parameters:

```sh
docker build -t scoreview-musescore-cli sidecar/
docker rm -f scoreview-sidecar
docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET="<secret>" \
  --memory=2g --pids-limit=512 \
  scoreview-musescore-cli
```

After a change of the MuseScore version in the image, trigger the **self-test**
before the image goes into production. Scores that have already been converted
remain valid; a change of the cache format invalidates them automatically (see
[Architecture](architecture.md#konvertierung-und-cache) (German)).
