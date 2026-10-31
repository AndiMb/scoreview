# ScoreView

**English** · [Deutsch](README.de.md)

[![CI](https://github.com/AndiMb/scoreview/actions/workflows/ci.yml/badge.svg)](https://github.com/AndiMb/scoreview/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

A Nextcloud app that shows MuseScore scores straight from Files and plays them
back in the browser – as faithful MuseScore notation with a playback cursor
that follows along in sync, instead of as a static PDF export.

Made for choir and ensemble work: the music looks like your own sheet music,
every part can be heard on its own, and every measure is one click away.

![The viewer with the playback cursor running](docs/img/viewer.png)

## What the app does

**Reading music.** MuseScore's own page rendering as vector graphics – zoom
without loss of quality, zoom presets, full screen, and an autoscroll that keeps
the current measure in the visible band – or, switched off, leaves the view
where you put it. Each user decides how the sounding
position is marked: coloured noteheads or a band, in a colour of their choice.
On a wide screen two pages stand side by side, like an open booklet – with
page 1 on the left or alone on the right. **Print** opens every page of the
score in its own page format for the browser's print dialog – on paper or as
a PDF, with or without your notes and stamps, with or without note names –
and **Save as PDF in Files** puts a PDF of the music next to the score.
Nextcloud's search finds a score by its title and composer, not only by its
file name.

**Hearing what you want to practice.** Playback is synthesized in the browser,
not played from a finished MP3. That is why you can adjust the volume of each
part, mute it or hear it solo, change the tempo in BPM and switch on a
metronome – on every beat, only on the downbeat, or with a quieter click on
every eighth. "My voice" brings one part to the front and keeps the others
quietly audible.

![Mixer with volume, mute and solo per part](docs/img/mixer.png)

**Targeted rehearsal.** Measure navigation with an always-visible measure
number, a loop over any range of measures, highlighted in the score, and a click
on a note jumps exactly there. **Show only the loop** fades everything
outside the passage, and a loop can be **saved** with a name – privately,
shared, or by a leader for particular voices – and set again with one tap.

**Taking notes.** Private, or shared with everyone who can see the file. Notes
are attached to a musical position rather than to pixels, so they survive a
re-render and a re-upload of the same score. Where no stamp fits, **draw in
the score** with finger, pen or mouse – a slur, a circle round an interval;
the drawing keeps to its measure and its part's staff also on phone pages and
in a part shown on its own.

![Note at measure 5, anchored to the musical position](docs/img/annotations.png)

**On a tablet at the music stand.** Touch controls, pinch zoom and a screen
that does not go to sleep during playback. In **Performance mode** only page
turning, zoom and moving to the next piece still work – an accidental tap
triggers nothing – and `PgDn`/`PgUp` or a Bluetooth pedal turn pages so that no
line is lost. Optionally light notes on a dark background; embedded images stay
unchanged.

**Practising.** While you hold the button, **Starting note** plays the note
of your own part at the current position or the key note of the current key. The
app remembers "My voice" per score and, if you like, places it on the right of
the stereo image and the others on the left. The **Speed trainer** raises the
tempo with every pass through the loop until it reaches the target tempo.
**Coach** plays your own part loudly on the piano, on the right, and the others
quietly on the left, and **Transpose** shifts the sound up or down by semitones –
and, where the server engraves it, the notes along with it.

**Your own part, engraved.** The **edition** shows a part on its own instead
of the full score: the parts stored in the file, or one MuseScore makes for
any other part. Transposing instruments can be shown **in concert pitch**.
MuseScore engraves each of these itself, the first time it is chosen, while
sound, notes and measure numbers stay those of the score
([Display variants](docs/limits.md#display-variants)).

**Practising on the go, reading on a phone.** A **practice track** saves exactly
what you are hearing right now – part, coach, tempo, transposition, optionally
only the loop or with metronome – as an MP3 next to the score in Files; the
Nextcloud app plays it offline and with controls on the lock screen. Anyone with
write access to the score's folder can create **Tracks for all parts** with one
click. For reading on a phone, **phone pages** set the score on pages the size of
the screen, with larger notes; the **system band** lays the systems out side by
side, each as tall as the screen, and the **lyrics view** shows only the text of
your own part with all verses, the sung syllable highlighted – or, with
**All parts**, the text of every part line by line, lighting up whichever
parts are singing right now. **Note names** can
be shown next to the noteheads – German, English or as solfège – and tapping a
note plays its pitch; **beat numbers** (“1 + 2 +”) can sit above the staff of
your part. With **"Save for offline use"**, a piece or an entire
setlist, sound included, is kept ready in the browser and opens without a
network through the app's offline page.

**In choir rehearsal.** Whoever owns a score appoints **leaders**, and every
leader can appoint more. Leaders write **notes for voices** that only the
addressed parts see – anyone who has not chosen a part yet sees them dimmed,
with the name of the part. On top of that come **stamps** (breath mark, caesura,
dynamics, fermata …) that sit at the musical position in the score. Measure
navigation understands **rehearsal marks**: "C" and "C+3" jump there. With
**"Follow me"** the leader sends the position, loop, starting note and a
transposition to all devices in the room, has them turn pages silently along
with the leader's own playback, and takes them along to the next piece in the
setlist – anyone who navigates on their own detaches and comes back with one
tap.

![The leader leads with "Follow me"; a note reaches one specific part](docs/img/rehearsal.png)

**In concert.** A **setlist** is a `*.setlist.md` file in Files, a list of links
to scores, editable in the text editor or in ScoreView. In the viewer you go
from piece to piece without having to switch on Performance mode, set the
zoom or load the SoundFont again.

**Hearing yourself.** **Own recordings**, playable in sync with the cursor and
accompaniment, can only be heard by the person who made them – unless a
leader **shares** one of theirs **with voices**: then the singers of those
parts hear their part sung by the leader, in sync with the score. **Intonation
feedback** shows a needle at the cursor while you sing and afterwards the spots
that were too sharp or too flat, came in early or late, or were cut short.
To learn the notes, **wait mode** stops before each of your notes until you
sing it. The **tuner** shows the note you are singing
with its octave, frequency and deviation in cents, spelled for the key at the
current position; its reference a′ (420–460 Hz) also tunes intonation and
playback. The microphone only runs when explicitly requested, and a
red dot shows what for.

**Keeping at it.** The **practice log** counts the minutes in which a score
plays or you record – per day and per piece, with days in a row. Leaders can
set a weekly goal for a piece. Only you see your time: no leader, no
leaderboard. **Scored singing** turns a run into points: a lane under the
score – or a stage with the lyrics – shows your notes as bars and your voice
as a line, and every note gets its colour and a word for pitch, onset and
length. A run sung through from the start of the piece or the loop is kept,
with your best per level and tempo and the measures worth practising; again
only you see it.

This also works in the Nextcloud mobile apps, with a few limitations: the
Android app does not grant access to the microphone; there, "Open in browser"
gets you further. And on mobile a setlist opens through one of its scores
rather than through the file itself. The offline page exists only in the
browser, not in the apps. The lyrics view and note names require the local
conversion path (see below). Administrators can switch off "Follow me",
recording, intonation, scored singing, practice tracks, the practice log and the offline page individually; what
the features cost and where they end is described in docs/limits.md under
[Rehearsal and concert features](docs/limits.md#rehearsal-and-concert-features)
and [Practising and reading on a phone](docs/limits.md#practising-and-reading-on-a-phone).

Keyboard in the viewer: `Space` play/stop · `←` `→` previous/next measure · `L` loop
· `+` `−` zoom · `0` page width · `PgDn` `PgUp` turn pages · `Ctrl+P` print.

Interface in English and German; more languages are welcome (see
[Contributing](#contributing)).

## How it works

An uploaded `.mscz` file is converted **once** on the server into score pages
(SVG), MIDI and timing data, and the result is cached. Opening it again does not
re-render; a new conversion is triggered by a change to the file, by an update
that brings a newer engine (on the local path, the next time the score is
opened) – or by the "Convert again" button in the viewer. Next to it, the viewer shows which of the two paths below
produced the pages on display. Audio playback happens client-side in the
browser, with a SoundFont that the app serves itself.

There are **two equivalent paths** for the conversion. They produce the same
result and differ only in what the server needs for them:

| | **Local** (default) | **Sidecar** |
|---|---|---|
| Requires | Node.js ≥ 18 on the Nextcloud server | a Docker host |
| MuseScore | MuseScore 4.7.6 as WebAssembly, in the app package | the same engine (default) or real MuseScore 4, in the container |
| Setup | nothing | start the container, enter address and secret |
| Lyrics view, note names, coloured noteheads, parts | yes | yes with the engine, no with MuseScore itself |
| Recommended if | you run no containers | you run some anyway |

The local path is the default because it is the only one that is ready right
after `app:enable`. Details in
[docs/architecture.md](docs/architecture.md) (German).

If the server can run **neither of them** – managed hosting without a Node
runtime and without containers – the user's browser does the conversion:
the same engine, the same result, but without a cache and with a one-time
download of just over 7 MB per device
([E7](docs/architecture.md#e7-konvertierung-im-browser-als-rückfall), German). This
fallback cannot be selected anywhere and only applies where nothing else would
work at all.

## Requirements

- Nextcloud 31–35, PHP 8.1–8.5
- One of the two conversion paths above – or neither: where managed hosting
  allows neither containers nor a Node runtime, the fallback in the browser
  steps in
  ([E7](docs/architecture.md#e7-konvertierung-im-browser-als-rückfall) (German)).
  Why server-side rendering is not possible there is explained under
  [E3](docs/architecture.md#e3-zwei-konvertierungswege-hinter-einer-api) (German).

## Installation

```sh
occ app:enable scoreview
```

Nothing more is needed for the conversion: the local path is the default, and
everything it needs apart from a Node.js runtime ships in the app package. The
server fetches the SoundFont itself on first playback (~23 MB, FluidR3Mono_GM) –
there is nothing to configure for that either.

If you want to run the sidecar instead, start it in addition, select it under
**Settings → Administration → ScoreView** and allow Nextcloud to access local
addresses (`allow_local_remote_servers`, see the
[guide](docs/installation.md#path-b-sidecar)):

```sh
docker build -f sidecar/Dockerfile -t scoreview-musescore-cli .
docker network create scoreview-net
docker network connect scoreview-net <nextcloud-container>
docker run -d --name scoreview-sidecar --network scoreview-net \
  -e SCOREVIEW_SIDECAR_SECRET="$(openssl rand -hex 32)" \
  --memory=2g --pids-limit=512 scoreview-musescore-cli
```

![Administration settings with path selection and status diagnostics](docs/img/admin.png)

Either way, one step remains, and it is needed only once: background jobs in `cron` mode. The
conversion depends on them, and so does registering the mimetype for `.mscz`,
which the app takes care of itself:
**[full guide](docs/installation.md)**.

For "Follow me" with many devices,
[notify_push](https://github.com/nextcloud/notify_push) is worthwhile: without
it, every device polls on its own during a session, which ties up two to three
CPU cores with 40 devices
([setup](docs/installation.md#rehearsal-and-concert)).

## Documentation

| Document | Contents |
|---|---|
| [Installation and configuration](docs/installation.md) | Step-by-step setup, settings, updating |
| [Architecture](docs/architecture.md) (German) | Structure, design decisions, data flow, format fundamentals |
| [Limits and restrictions](docs/limits.md) | Measured values, known gaps, what the app deliberately does not do |
| [Troubleshooting](docs/troubleshooting.md) | Symptoms and what helps |
| [Development](docs/development.md) (German) | Building, testing, conventions, release |
| [Sidecar](sidecar/README.md) (German) | Operation and HTTP API of the conversion service |

What changed from version to version is listed in the
[changelog](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (German). Bugs and feature requests go in
the [issues](https://github.com/AndiMb/scoreview/issues). How to contribute a
translation is described in [docs/translating.md](docs/translating.md).

## License and credits

ScoreView is licensed under AGPL-3.0-or-later, see [LICENSE](LICENSE).

- The engraving and conversion work is done by **MuseScore Studio** (GPL-3.0) –
  through the [scoreview-engine](https://github.com/AndiMb/scoreview-engine),
  MuseScore's engraving compiled Qt-free to WebAssembly – locally, in the
  browser and in the sidecar – or, if chosen, in the sidecar as a pinned
  AppImage.
- The **SoundFont** for playback is `FluidR3Mono_GM` (MIT) by default, the same
  one that ships with MuseScore. With the sidecar it comes from its MuseScore
  installation (MuseScore General by S. Christian Collins, MIT); otherwise the
  server fetches it from a preset address that can be overridden.
- Practice tracks are encoded in the browser by
  [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) (LGPL-3.0).
- The score in the images is Anton Bruckner's *Aequale Nr. 1* in the
  [OpenScore edition](https://musescore.com/openscore/scores/4074271) (CC0).
