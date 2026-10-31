# Changelog

All notable changes to ScoreView. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.27.2] – 2026-10-31

### Fixed

- Tapping a note in the system band now shows its name, as on pages. The
  tone sounded, but the name was sent to the page view, which the band does
  not show.

## [1.27.1] – 2026-10-30

### Changed

- Updated @nextcloud/dialogs to 8, @nextcloud/vue to 9.14 and
  @nextcloud/files to 4.1.1. Notices now appear at the bottom of the screen
  instead of the top.
- Updated the synthesizer to spessasynth 4.4. Playback, “My voice on the
  right, the others on the left” and the audio file sound as before. Since
  4.4 the synthesizer hands out a finished mix, so a panned part is now taken
  out of that mix and put back on its side. Measured against 4.3: the same
  levels left and right with the image on and off, solo, muted and while
  switching, and the same audio file with transposition, a′ = 442 Hz, slower
  tempo and a changed instrument.
- Conversion uses MuseScore 4.7.6 on both paths: scoreview-engine
  `v4.7.6-engine.2` on the local path and in the browser fallback, the
  MuseScore 4.7.6 AppImage in the sidecar. That AppImage unpacks readable
  for root only, so the sidecar image now opens it up for the user it runs
  as. A sidecar built from an older Dockerfile with 4.7.6 fails with exit
  code 126.

### Fixed

- A volta whose endings all lie beyond the repeats already played no longer
  cuts the score off there. Up to MuseScore 4.7.5, playback and the cursor
  stopped after the repeat. A score converted before keeps its old timing
  until “Convert again” under Score → Info and diagnostics.

## [1.27.0] – 2026-10-29

### Added

- Pin the tools you use all the time to the bar: every row in a menu has a
  pin, and pinned tools sit as buttons next to the menus – one tap instead of
  two or three, on a phone right at the front of the tools strip. Up to four,
  stored with your account. By default the mixer is pinned, and for a leader
  also “Leaders and Follow me”.

### Changed

- The menus of the bar are sorted by what a tool is about: **Playback and
  practice** (loop, metronome, tempo, mixer, transpose, coach, microphone
  tools, practice log), **View** (zoom, scrolling, note names, notes, pages
  and edition, colours) and **Score** (my part with the starting note, leaders,
  new setlist, print, audio file, offline, info). Frequent tools come first,
  settings below a line. The mixer is no longer hidden behind a metronome
  icon, and the rehearsal menu with its two entries is gone.
- “Appearance” and “Layout” are now **Colours** and **Pages and edition**;
  the renderer, “Convert again” and the playback diagnostics moved to their
  own page, **Score → Info and diagnostics**.

## [1.26.3] – 2026-10-29

### Fixed

- The name of a tapped note is shown over the notation, not behind it – in a
  chord the neighbouring heads painted through it.
- When a part or the phone page format cannot be engraved, the hint offers
  to try again or to dismiss it; before, it stayed until the choice changed
  and took a good part of a phone screen.
- Switching scores while a part or page format was still loading no longer
  leaves that hint over the next score.

## [1.26.2] – 2026-10-29

### Fixed

- The viewer keeps up on phones: menus open in about half the time, a note
  change during playback no longer re-renders the toolbar and its panels,
  and following the cursor reads no layout. The notation now sits in a
  document of its own, where none of Nextcloud's style rules reach it – on
  narrow screens one of them still re-checked every note of a score sitting
  in a shadow root.
- Pinch zoom follows the fingers: while they move the score is only scaled,
  and laid out anew once they let go.
- Opening a score and turning to a page block the screen less: note
  positions are measured when note names or counts first need them, and
  the system band prepares the system after the next one while it is idle.

## [1.26.1] – 2026-10-28

### Fixed

- Toolbar menus open and close without the long pause: the notation no
  longer sits where Nextcloud's style rules re-check it on every change in
  the page (measured: 3.3 s of style time per menu at phone-like CPU speed,
  now under 1 s). Playback keeps the main thread about a third as busy.

## [1.26.0] – 2026-10-27

### Added

- Draw in the score: with finger, pen or mouse, for a slur, a circle round an
  interval or anything no stamp covers. A drawing is a note like any other –
  private, shared, or from a leader for particular voices – and keeps to its
  measure and its part's staff on phone pages and in a part shown on its own.
- The lyrics view can show **All parts**: the text of every part line by
  line, named after its part, with the parts that are singing right now
  lit up.
- Practice log: the minutes in which a score plays or you record, per day,
  with this week, last week and days in a row. Leaders can set a weekly goal
  per piece. Only you see your own time – no leader, no leaderboard.
  Administrators can switch it off (`feature_practice_log`).
- Leaders can share their own recordings with voices: the singers of those
  parts hear their part sung by the leader, in sync with the score. The
  sharing can be taken back at any time.

## [1.25.3] – 2026-10-26

### Fixed

- The starting note no longer follows a part's slider. Since 1.25.2 the mixer
  also controls an instrument's further sounds that never play in the score
  (a contrabass's pizzicato, say), and the starting note could land on one of
  them: muting that part, or soloing another, silenced it.
- Choosing an instrument in the mixer changes all of a row's sounds, not only
  the first: a contrabass set to cello no longer goes on plucking as a
  contrabass. Choosing the row's own instrument again gives each sound back.

## [1.25.2] – 2026-10-26

### Fixed

- Chord symbols that MuseScore plays as piano chords now have a row of their
  own in the mixer (“Chord symbols”), so they can be turned down or muted.
  Before, no slider reached them, and they always played.
- A mixer row now controls every channel of its part: the further sounds of
  an instrument (pizzicato, tremolo, mute) follow its slider, mute and solo.
  When a melody started with a rest under chord symbols, its slider moved the
  chords instead of the melody. In a score with a piano on two staves, the
  sliders acted on the wrong channels.
- On the desktop in fullscreen, the bar's menus open again. They opened
  outside the fullscreen view and stayed invisible.
- On the iPhone, the fullscreen inside the page now covers the Viewer's
  header. Before, the header lay over the bar, and only its ✕ could be
  tapped (#15).

## [1.25.1] – 2026-10-25

### Fixed

- Following the playing, the system band now turns at once instead of
  gliding. At the end of a system the next note already stands right of the
  screen, and on a phone a glide took up to 850 ms – for that long the cursor
  was out of view at every system. Turning by hand (pedal, “Back to the
  playing position”) still glides.
- On a phone, the score now reaches the bottom of the screen: Nextcloud's
  Viewer kept a header's height free below it, and the file list showed
  through – 50 of 325 px held sideways.

### Development

- `npm run audit` runs on Windows too.
- `npm run test:coverage` measures the test coverage of `src/lib`, the
  composables and the converter's transformation.

## [1.25.0] – 2026-10-25

### Added

- **Zoom in the system band**: the zoom buttons, `+`/`-`/`0` and two fingers
  now work in the band too, from 50 to 300 % of a default size, kept per
  device. A system zoomed taller than the band scrolls up and down in it.

### Changed

- In the system band a staff is at most 48 px tall at the default size. A
  one-staff part held upright filled the whole height before – a staff of
  130 px with three notes to a screen.

### Fixed

- After switching to a part, phone pages, concert pitch or transposed notes,
  the system band kept showing the previous picture under the new systems and
  cursor: staves were cut off and the cursor ran out of view.
- A hint above the system band (such as the offer of phone pages) pushed its
  lowest staves off the screen.
- When the bar retracts on a phone held sideways, or the band otherwise
  changes size, the band keeps its place instead of jumping elsewhere.
- On a phone held sideways, the Practice and View groups were taller than the
  screen and some of their entries – among them Layout – could not be
  reached. The groups, the setlist and the rehearsal marks now scroll within
  the room on screen.

## [1.24.0] – 2026-10-25

### Added

- **The sidecar converts with the scoreview-engine as well**, and an
  administrator chooses which: the engine (the default for new
  installations) or MuseScore itself. With the engine, a sidecar delivers
  everything the local path does – coloured note heads, lyrics view, note
  names, beat numbers, major/minor for the key note, and parts, phone pages,
  concert pitch and transposed notes, engraved in 3–4 s as on the local path.
  A base conversion takes 1.4–2.5 s instead of 30–32 s for a three-page
  score. The image also carries the CJK fonts the app package leaves out, so
  Chinese, Japanese and Korean lyrics come out as text. MuseScore itself
  stays selectable for the original music font of old scores and SVG images
  in a score. The choice is under Settings → Administration → ScoreView, or
  `occ config:app:set scoreview sidecar_renderer --value=engine|musescore`;
  the self-test checks the selected one.

### Changed

- **The sidecar image is built from the repository root**:
  `docker build -f sidecar/Dockerfile -t scoreview-musescore-cli .` – the
  image now contains the app's converter. An installation that already runs a
  sidecar keeps MuseScore after the update, because its image has no engine
  yet; rebuild the image and switch afterwards.
- A display variant that failed because the conversion service was busy or
  unreachable may be tried again after a minute instead of an hour.

## [1.23.0] – 2026-10-25

### Added

- **Parts, phone pages, concert pitch and transposed notes**, engraved by
  MuseScore itself instead of being worked around in the browser. Under
  View → Layout, “Edition” shows a part on its own – the parts the file
  stores, or one made for any other part – and “Page format” sets the score on
  pages the size of a phone screen, upright or landscape, with notes about
  twice as large. Scores with transposing instruments can be shown in concert
  pitch, and “Transpose the notes too” lets the notation follow the sound's
  transposition. Playback, mixer, notes, loops and “Follow me” go on as before:
  a variant changes the picture, not the piece, and keeps the score's time
  line and measure numbers. A variant is made when first chosen, in 3–4 s,
  and kept; print and the PDF file take the one on screen, the offline page
  the one last shown on that device. The edition is remembered per score, the
  page format per device. Available on the local conversion path and in the
  browser fallback; the sidecar cannot engrave them, and the choice says so.
  Needs scoreview-engine `v4.7.5-engine.6`.

- **Rhythm feedback** after a recording: next to “too sharp/too flat”, the
  list of problem spots now says when a note came in **early or late** and
  when it was **cut short** before a rest, in milliseconds. The onset is the
  start of the syllable, consonant or glide included, and is judged only
  where one can be heard – after silence or a change of pitch; a note tied to
  the same pitch is reported as not evaluable. The summary adds the average
  onset (“Onsets on average 35 ms late”), and a note head shows the worst of
  pitch, onset and end. Checked with a real voice on the desktop: a
  well-timed take came out green throughout.
- **Wait mode** for learning notes (“Wait for my note” under Intonation):
  playback stops just before each note of your part and goes on once you sing
  it – any octave, ±50 cents. While waiting, the accompaniment that was
  playing keeps sounding, and your own part stays silent for the whole mode.
  Metronome, speed trainer, recording and following a leader cannot run at
  the same time.
- **Adjustable reference pitch** a′ (420–460 Hz, in the tuner) instead of a
  fixed 440 Hz. It is one setting per user for everything that hears or
  plays pitch: the tuner, intonation, wait mode, the playback with its start
  tone, and the MP3 export. A recording keeps the reference it was sung
  against, so changing the setting later does not re-judge it.

### Changed

- **Local conversion under Node is about seven times faster.** Node optimised
  the engine's WebAssembly in the background and waited for that work before
  the process could end – 23–29 s for a conversion whose work was done after
  3.5 s, measured with Node 20. The converter now runs with
  `--liftoff-only`: 3–4 s. Deno was not affected.
- Every score is converted once more when it is next opened, for the list of
  stored parts in its metadata.

## [1.21.2] – 2026-10-24

### Changed

- **More room for the score in the mobile apps.** The page the Nextcloud apps
  open no longer has a header row of its own with file name and ✕. The ✕ now
  sits in the control bar next to fullscreen (behind “More” on a phone), and
  the score starts right below the bar – in landscape that row and the bar
  took about a third of the height. Android's back gesture still closes in
  one tap.

## [1.21.1] – 2026-10-24

### Fixed

- **No sound on the iPhone with the ring/silent switch set to silent** (#23),
  although Safari showed its speaker icon. Safari treated ScoreView's sound
  as ambient audio, which iOS mutes in silent mode. ScoreView now declares it
  as media playback, as music and video apps do, and as playback with
  recording while the microphone is on. Other apps' audio pauses when
  ScoreView starts to sound; reading a score alone leaves it playing. Older
  iOS versions (before 16.4) and other browsers are unchanged.

### Changed

- **The notice after two minutes of converting** no longer suggests a fault
  only: with a 5-minute cron the first opening of a score can take that long.
  It now says so and still points to cron if it never finishes (#22).
- **Documentation:** a dedicated background job worker for ScoreView's jobs
  opens new scores within seconds instead of at the next cron run –
  installation step 5 and troubleshooting (#22).

## [1.21.0] – 2026-10-24

### Added

- **“My part” in the View group** (#18): a row that names your part and lets
  you choose another or none, without opening the mixer and also without
  sound. The mixer says which part is yours above its rows.
- **Fullscreen where the browser has none** (#20): in the Nextcloud Android
  app and on the iPhone the fullscreen button now switches to fullscreen
  inside the page – the score gets the whole view, the control bar retracts
  during playback, and the back button leaves it. The system bars stay; only
  the app could hide them.

### Changed

- **100 % in the mixer is the score's own mix** (#17): every part starts at
  the volume set in MuseScore, and the sliders scale from there. “My part”
  and the coach keep the balance of the score as well.

### Fixed

- **Parts played at unexpected volumes while every slider showed 100 %**
  (#17): the mixer sent its volumes only when a slider moved, so untouched
  parts played at MuseScore's volume and touched ones louder; a mixer closed
  and opened again also showed 100 % for a part still playing quieter or
  muted. The mix is now applied as soon as the sound is loaded and survives
  closing the mixer.
- **The system band did not scroll inside a system wider than the screen**
  (#21), so the playhead ran off the right edge. It now turns pages: shortly
  before the cursor reaches the edge, the band moves on by most of a screen
  and keeps what was just played on the left. Page Down and a pedal turn
  pages inside a wide system too.

## [1.20.1] – 2026-10-18

### Fixed

- **Local conversion with Node 20 aborted** before converting anything
  (`Assertion failed: !path_prefix.empty()`), since 1.19.0: the sandbox
  granted the output directory twice, once with a trailing slash and once as
  its resolved path, and Node 20's permission model crashes on that pair
  (Node 22 and 24 do not). Each directory is now granted once. Affects the
  Node of Debian 13, among others.
- **Note heads of “my part” were sometimes not coloured** (intonation, focus
  on my part, note names and beat counts for my part) in scores that start
  with a title or text page: the page without staves reported that staves
  cannot be mapped to parts, and whichever page loaded last decided.

## [1.20.0] – 2026-10-18

### Changed

- **More height for the score on a phone in landscape** (#15): where the
  control bar takes 15 % or more of the viewer's height – a phone held
  sideways, where there is no fullscreen – it retracts to the progress line
  after 3 s, as it already did in fullscreen. Tap the line to bring it back.
- The bar now also retracts **in performance mode and while following a
  leader**, not only during playback, in fullscreen as well.
- In that situation the viewer offers the **system band** once, as it already
  did below 600 px width.

### Fixed

- The retracted bar was 44 px tall instead of 8 px in Files: Nextcloud's
  global button style gave the line a minimum height and a margin.

## [1.19.0] – 2026-10-18

### Added

- **Deno as a runtime for the local converter** (#16): enter the path to
  `deno` (2 or later) in the existing “Path to node or deno” setting. Deno
  locks the converter in completely – no other files, no network, no
  processes, no environment. The automatic search still looks for `node`
  only; Bun is not supported, as it has no permission model.
- **The local converter runs isolated** on every runtime that can: it may
  read its own directory, the score and the CJK font directory, and write
  its output directory – nothing else. Node.js 20.7 to 24 lock the file
  system and processes, Node.js 25 and later the network as well; Node.js 18
  and 20.0–20.6 convert as before, without isolation. The converter also no
  longer inherits the web server's environment variables.
- New **Isolation** row in the status diagnostics: full, partial (network
  open) or none, with what to install for more.

### Changed

- CI checks the local converter under Node.js 18, 20, 22, 26 and Deno, each
  time through the app's own command line and with a probe that tries what
  the sandbox must block.

## [1.18.0] – 2026-10-17

### Added

- **Two pages side by side** in the page view, from a page area 900 px wide:
  page 1 on the left (default) or alone on the right, like a booklet, set
  under View → Layout. The zoom presets fit the pair, and `PgDn`/`PgUp` or a
  pedal turn a whole row. A phone in landscape and a narrow window stay
  single; the setting says why.
- **Save as PDF in Files** on the print page: the PDF of the music is written
  in the browser, from the page SVGs both conversion paths deliver, and put
  next to the score – vector, in the score's page format; a second save asks
  before replacing. Notes, stamps and note names stay with the print dialog.
  New admin limit “Maximum size of one PDF file” (default 50 MB).
- **Title and composer in Nextcloud's search**: scores are found by title,
  subtitle, composer and lyricist, only within the searcher's own files, and
  a hit opens the score in Files. Scores converted before are made findable
  by the update, without a reconversion.

### Changed

- Practice tracks and the PDF file share one way of saving next to the score
  (`SiblingFileService`); behaviour and error codes of practice tracks are
  unchanged.

## [1.17.0] – 2026-10-17

### Added

- **Time signature per measure from the engine** (scoreview-engine
  v4.7.5-engine.5: `measureFacts`, a tick per chord in `noteSpellings`). The
  metronome and the count-in now click the conducted beats – two in 6/8,
  three in 9/8, a pickup as it is – instead of estimating them from the
  measure's length; practice tracks follow. Scores converted earlier are
  reconverted the next time they are opened (format version 5). Without the
  engine's facts the MIDI's time signatures are read, and failing those the
  old estimate remains.
- **Beat numbers** over the notes (“Note names and counting” under View):
  “1 2 3 4” on the beats, “+” between them, every eighth in compound metres,
  on all staves or only on my part. Only with the engine's data; the setting
  says when it is unavailable.
- **Show only the loop**: with a loop running, everything outside it steps
  back – veiled on the pages, dropped from the system band, dimmed in the
  lyrics view.
- **Saved loops**: a running loop can be saved with a name, privately, shared
  or – by a leader – for particular voices, and set again with one tap from
  the loop page. Saved loops are notes with an end measure: they survive a
  re-upload, count towards the 500 notes per person and score, and are
  deleted in the Notes panel.

### Changed

- The converter self-test checks the time signature facts on a new fixture
  with a pickup, a 3/4 and a 6/8 measure (`timesig-test.mscz`).

## [1.16.0] – 2026-10-17

### Added

- **Printing.** “Print” in the View group (or `Ctrl`/`Cmd+P` in the viewer)
  opens a print page that holds every page of the score in the score's own
  page format, ready for the browser's print dialog – “Save as PDF” keeps the
  notation as vectors. Notes, note texts and stamps go on paper on request,
  placed exactly as on screen; note names follow the viewer setting. The page
  converts in the browser where the server cannot, like the viewer.
- **Metronome subdivisions.** Besides “Every beat” and “Downbeat only”,
  “Eighth notes” adds a quieter click between the beats – in the viewer and in
  practice tracks saved with the metronome.
- **Tuner.** Under Practice, next to recording and intonation: the sounding
  note with octave, frequency and deviation in cents on a needle, named in
  the note-name system of the viewer and spelled for the key at the current
  position. Reference a′ = 440 Hz. It hangs on the administration's
  “Intonation” switch and runs on the shared microphone chain, storing
  nothing.

### Changed

- Keyboard shortcuts without a modifier no longer react while `Ctrl` or `Cmd`
  is held – `Ctrl+L` now reaches the browser's address bar instead of toggling
  the loop.
- The viewer's Content Security Policy directives live in one place
  (`Service\ViewerPolicy`), shared by the Files page, the offline page and
  the print page.

## [1.15.1] – 2026-10-17

### Fixed

- **On the iPhone the view keeps following the playing position sideways.**
  Safari zoomed the whole web page when a field such as the measure number
  was tapped, or when two fingers landed on the bar or the system band. The
  score then stood wider than the screen, and since that zoom is invisible
  to the viewer, it no longer scrolled after the music within a page. Input
  fields on touch devices now use a font size that Safari does not zoom
  into, and Safari's own pinch zoom is switched off across the whole viewer;
  two fingers on the score still zoom it the viewer's way. (#13)

## [1.15.0] – 2026-10-17

### Added

- **Autoscroll can be switched off** (“Scroll along with playback” under
  View, remembered per account). The view then stays where it was put while
  the music plays on – in the pages, the system band and the lyrics view
  alike. A jump of one's own (measure field, rehearsal mark, arrow keys, a
  note from the list) and a jump of the leader in “Follow me” still bring
  the position into view. Once it has left the screen, a button leads back
  to it; switching autoscroll on again does the same. (#12)

## [1.14.4] – 2026-10-16

### Security

- **“Follow me” can no longer be taken over through a score of one's own.**
  Anyone who owned any score could start a session on it and move that
  session onto a score shared with them read-only, then lead everyone
  following there. Leadership now only carries over to a piece of the same
  owner; elsewhere it needs the leader role on that piece.
- **The SoundFont error no longer reveals the server's configuration.** When
  the SoundFont could not be provided, the answer to the viewer included the
  technical cause, which can name the configured download address and
  internal host names. That cause now only goes to the server log.

### Fixed

- **Restarting “Follow me” on an earlier piece no longer sends followers
  away.** After moving on and coming back within half an hour, every device
  that joined was sent on to the piece the session had moved to before.
- **A move that fails half-way leaves nothing behind.** If someone else took
  over the session while it was moving, the move could point their followers
  to the new piece, or leave an unled session there for half an hour.
- **A pinned score survives a refresh that loses the network.** The offline
  page now downloads into a separate cache and takes it over only when
  everything arrived; before, a broken refresh could leave a score that
  counted as complete but stayed blank offline.
- **Sound offline after an app update.** The offline page could not find the
  synthesizer it had stored with the pinned scores and stayed silent until it
  had been used once online.
- **The offline page no longer deletes the pinned scores of the person using
  it** when it was loaded from the cache under another account. It now asks
  the server who is signed in before removing anything.
- **Practice tracks land next to the right piece.** Switching pieces while a
  track was rendering, for example when the leader moved on, saved it next
  to the new piece. Switching or closing now cancels the export, and
  cancelling and restarting no longer lets two exports run into each other.
- **A practice track that cannot be written because the file is locked** (a
  sync client) or blocked by an access rule now gets a clear message instead
  of a server error.
- **Seeking after the end of a piece no longer starts it** when no SoundFont
  is configured.
- **The starting note and the transposition name a key the same way** – with
  six accidentals both say F♯ now, where the starting note said G♭.
- **Media keys do nothing once the viewer is closed.**

### Changed

- **The system band follows playback with less work per note.** Only the
  system showing the cursor redraws on each note, scrolling no longer
  measures every system, a piece change loads the band once instead of twice,
  and a page shown in several systems is fetched and prepared once.
- **Note names relative to the key are labelled faster** – the key of each
  note is looked up once per score instead of once per notehead.

## [1.14.3] – 2026-10-13

### Fixed

- **Following playback keeps the whole system in view.** At a zoom where a
  system is about as tall as the screen, the view could stop on a new
  system with empty space above it and the lowest staff cut off. A system
  that fits on screen is now always shown whole; one taller than the screen
  is aligned at its top edge.
- **No more white gaps in the system band.** The next system only started
  loading once it was already on screen, and a system narrower than the
  screen could leave the one after it blank until the band had scrolled
  on. Systems now load ahead of the scroll position in both cases.

## [1.14.2] – 2026-10-13

### Fixed

- **A changed SoundFont now reaches every browser.** The SoundFont the app
  delivers itself was cached by browsers for a year under one fixed address,
  so after a new sidecar image or a changed download URL every device that
  had played before kept the old one. Its address now carries its version,
  like the score artifacts do; each device downloads the SoundFont once more
  after this update. The offline page notices a new SoundFont, stores it and
  removes the old one.

## [1.14.1] – 2026-10-11

### Fixed

- **Count-in from rest.** Since 1.14.0 the audio output rests while the
  score is paused. On Android over Bluetooth the first count-in click then
  came late and sounded too close to the second, because the output needs a
  moment to start after waking. The whole count-in, together with the
  moment playback starts, is now planned on the audio clock in one go, so a
  slow start moves every click alike. Checked by ear on a Galaxy S23 with
  Bluetooth headphones.

## [1.14.0] – 2026-10-11

### Added

- **Community translations.** ScoreView can now be translated into any
  language by pull request, right in GitHub's web editor. No tools are needed.
  Translations live as gettext PO files under `scoreview/translationfiles/`.
  A partial translation shows the untranslated strings in English, never in
  German. CI checks every language for broken placeholders and outdated
  entries; only German has to be complete. See
  [docs/translating.md](docs/translating.md). Files saved with Poedit work
  as they are, and translator comments are kept when the template changes.
- **Formal German.** Users who chose "Deutsch (Sie)" (`de_DE`) see the German
  interface instead of English. It uses the same informal wording as `de`.
- **English documentation.** The README, installation guide, troubleshooting
  guide and limits are now written in English, with a maintained German
  translation next to each (`*.de.md`). CI reports a German file that is
  older than its English original, as well as any broken link or anchor in
  the documentation. Screenshots exist in both languages.

### Changed

- The files Nextcloud reads (`l10n/*.js`, `l10n/*.json`) are generated by
  `npm run build` and no longer committed. Shipped translations are
  unchanged.
- The bug report template is in English; reports in German are still
  welcome.
- **Less battery drain on phones and tablets.** A paused score now costs
  next to nothing besides the screen:
  - The viewer's time loop sleeps while nothing moves. It used to redraw
    60 times a second for as long as the viewer was open.
  - The audio output rests a few seconds after the music stops. Microphone,
    count-in and listening back keep it awake for as long as they need it.
  - The live intonation needle redraws only when its value changes, at most
    about 12 times a second, and switches off when the page is hidden.
  - The Files page loads only a small entry point. The viewer itself is
    loaded when a score is opened: 0.2 MB instead of 2.2 MB of JavaScript
    on every folder change.
- **"Follow me" polls by role.** Followers keep the full rate, so jumps still
  arrive within a second. The leader's own device asks every 5 s and a
  detached device every 15 s. Without a session, the search slows down to
  every 60 s after two minutes without use, and a tap makes it fast again.
  A detached device no longer keeps the screen on.
- **Waiting for a conversion** polls every 2 s at first, then less often (up
  to every 15 s), and not at all while the page is hidden.
- Pages scrolled slightly out of view are no longer fetched and sanitised
  again, and one-finger scrolling over the score no longer waits for the
  page's script.
- **Technical messages are in English.** The technical detail of a failed
  conversion, log messages, `occ` and migration output, and the error texts
  of the sidecar and the local converter are now English. The messages shown
  in the interface are still translated. Error messages already stored from
  earlier conversions stay as they are until the score is converted again.

### Fixed

- **Untranslated messages.** The status diagnostics showed three causes of a
  non-working local conversion path ("PHP is not allowed to start
  processes", "No Node.js runtime found", "The engine package is missing")
  in German regardless of the language setting. "No sound: …" in the viewer
  did the same with the server's SoundFont error. Both are now translated;
  the technical cause of a SoundFont failure remains in the log and the
  browser console.

<!-- Entries below this line are in German. -->
*Older entries are in German.*

## [1.13.0] – 2026-10-10

### Neu

- **Mitblättern bei „Folgt mir“.** Spielt die Leitung ab, laufen Cursor,
  Mitscrollen und Zeitanzeige der Folgegeräte mit – ohne Ton, in der Probe
  wird live gesungen. Hält die Leitung an, bleiben die Geräte an ihrer
  Stelle stehen; wer selbst navigiert, löst sich wie bei einem Sprung.
  Übertragen wird ein Stand mit Serverzeit, kein Strom von Zeiten.

### Behoben

- **Sprung der Leitung kommt bei starkem Zoom nicht ins Bild.** Bei
  „Folgt mir“ sprang auf dem Folgegerät zwar die Markierung, die Ansicht
  blieb aber stehen oder fuhr zur vorigen Stelle: Das Nachführen maß den
  Cursor, bevor er neu gezeichnet war, und lag die Stelle auf einer noch
  nicht geladenen Seite, scrollte es nur grob zu deren Anfang. Während der
  Wiedergabe richtete das die nächste Note, im Stillstand kam keine. Das
  gilt ebenso für einen Sprung über das Taktfeld.
- **Ruckeln bei der Wiedergabe in Files, zweiter Teil.** Die Zeitanzeige
  ersetzte jede Sekunde ihren Textknoten, und die Fortschrittslinie der
  eingefahrenen Leiste im Vollbild schrieb in jedem Bild ihre Breite ins
  `style`-Attribut – beides löst in Files über Nextclouds `:has()`-Regeln
  eine Stil-Neuberechnung über den ganzen Baum aus. Am Desktop sinkt die
  Stilzeit während der Wiedergabe von 331 auf 19 ms je 4 s, am Galaxy S23
  laufen die Seiten mit 49 statt 44 fps, das Systemband mit 33 statt 29.
- **Tonnamen überdecken Vorzeichen und Wiederholungspunkte.** Sie standen
  immer links vom Kopf; jetzt weichen sie nach unten, oben oder rechts aus,
  wo links kein Platz ist, auch im Akkord. Bei lesbarem Zoom sind sie
  größer.
- **Engine-Vorschlag blieb nach einem Fehlschlag für immer aus.** Konnte der
  tägliche Lauf den Pull Request nicht anlegen, blieb sein Branch stehen und
  galt an allen Folgetagen als „schon vorgeschlagen“. Jetzt räumt der Lauf
  den Branch wieder ab und nennt die nötige Repo-Einstellung.

## [1.12.0] – 2026-10-08

### Neu

- **Übe-Tracks als MP3 in Files.** „Als Audiodatei speichern“ in der Gruppe
  Üben rendert genau das, was man gerade hört – Mixer, Coach, Tempo,
  Transposition, auf Wunsch mit Metronom oder nur den Loop – im Browser als
  MP3 und legt es neben die Partitur, in einen Unterordner „Übe-Tracks“ oder
  einen selbst gewählten Ordner. Die Datei trägt Titel, Stimme und Mischung im
  Namen und als ID3-Angaben. Unterwegs spielt sie jeder Player, auch die
  Nextcloud-App offline und mit Steuerung auf dem Sperrbildschirm. Gemessen:
  ein Chorsatz von 76 s in 7 s am Desktop, mit demselben Kern 191 s Musik am
  Galaxy S23 in 16 s. Die Dateien
  zählen gegen das Kontingent der Ordnerbesitzerin
  ([E13](docs/architecture.md#e13-übe-tracks-sind-dateien-in-files)).
- **Tracks für alle Stimmen.** Wer neben der Partitur Dateien anlegen darf,
  erzeugt mit einem Klick je Stimme einen Coach-Track im Ordner „Übe-Tracks“;
  vorhandene werden ersetzt.
- **Coach.** Die eigene Stimme klingt als Klavier laut und rechts, die übrigen
  leise links. Ein Regler „Andere Stimmen“ setzt deren Pegel, auch ohne Coach;
  er ersetzt den bisher festen Wert von „Meine Stimme“.
- **Transponieren.** In Halbtönen (−12 … +12), nur der Klang – das Notenbild
  bleibt. Anfangston, Intonation und Übe-Track hören mit. Der Wert gilt je
  Partitur und wird wie Coach und Pegel auf dem Server gespeichert. Ist er
  gesetzt, trägt die Gruppe Üben einen Punkt.
- **Systemband für das Handy.** Die Systeme stehen nebeneinander, jedes so hoch
  wie der Bildschirm, waagerecht zu scrollen; `Bild↓` und ein Pedal gehen ein
  System weiter. Ausgeschnitten aus MuseScores eigenem
  Seitenbild, Cursor, Notizen und Stempel bleiben. Wer auf schmalem Bildschirm
  öffnet, bekommt es einmal angeboten.
- **Liedtext-Ansicht.** Nur der Text der eigenen Stimme, alle Strophen
  untereinander; die gesungene Silbe leuchtet, bei Wiederholungen in der
  richtigen Strophe. Ein Tipp auf ein Wort springt dorthin, Ziehen setzt einen
  Loop.
- **Tonnamen und Note antippen.** Neben jedem Notenkopf auf Wunsch der Name:
  deutsch (mit H und B), englisch, feste oder relative Solmisation, für die
  eigene Stimme oder alle. Er nennt die geschriebene Note, Fis bleibt Fis. Ein
  Tipp auf eine Note spielt bei stehender Wiedergabe ihren Ton.
- **„Folgt mir“ über das Ende eines Stücks hinaus.** Schaltet die Leitung in
  der Setliste weiter, kommen alle Folgenden mit – auch wer die Setliste nicht
  offen hat, in der App ebenso. Wer sich gelöst hat, bekommt einen Hinweis mit
  „Dorthin wechseln“. Auf dem neuen Stück führt die Leitung weiter, auch wenn
  sie dort keine Leitungsrolle hat; Stimmnotizen und Stempel bleiben dort den
  eigenen Leitungen vorbehalten
  ([E10](docs/architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
- **Eine Transposition der Leitung gilt für alle Folgenden**, ohne deren
  eigene Einstellung zu überschreiben. Wer selbst transponiert, folgt nicht
  mehr.
- **Noten und Ton ohne Netz.** „Offline vormerken“ in der Gruppe Ansicht legt
  ein Stück oder eine ganze Setliste samt Klang im Browser ab. Ohne Netz öffnet
  man sie über die Offline-Seite `/apps/scoreview/offline` – wiedergeben,
  blättern, Mixer, Loop, Tempo, Transposition gehen; was einen Server braucht
  (Notizen setzen, Leitung, Aufnahme, Übe-Tracks), fehlt dort. Die Seite muss
  einmal mit Netz geöffnet werden und lässt sich zum Startbildschirm
  hinzufügen; beim Öffnen mit Netz bringt sie Vorgemerktes auf den neuen
  Stand. Nur im Browser, nicht in den mobilen Apps
  ([E14](docs/architecture.md#e14-eine-offline-seite-mit-eigenem-service-worker)).
- **Titel und Medientasten.** Während der Wiedergabe kennt das System Titel
  und Stimme; am Desktop wirken die Medientasten. Am Handy läuft der Ton bei
  gesperrtem Bildschirm weiter, eine Steuerung auf dem Sperrbildschirm gibt es
  für Web Audio aber nicht – beim ersten Sperren weist der Viewer einmal auf
  den Übe-Track hin.
- **Verwaltung:** Unter „Üben unterwegs“ lassen sich Übe-Tracks
  (`feature_practice_export`) und die Offline-Seite (`feature_offline`)
  einzeln abschalten, beide sind voreingestellt an. Die Größe eines Übe-Tracks
  begrenzt `practice_track_max_mb` (Vorgabe 60 MB).

### Geändert

- **Neue Engine `v4.7.5-engine.4`** mit Liedtextsilben und der Schreibweise
  je Notenkopf in `meta.json`; das Cache-Format steigt auf 4. Vorhandene
  Partituren werden beim nächsten Öffnen einmal neu konvertiert. Liedtext-Ansicht
  und Tonnamen gibt es nur mit diesen Daten, also nicht auf dem Sidecar-Weg;
  die Auswahl sagt dann warum
  ([E15](docs/architecture.md#e15-fähigkeiten-statt-weg)).
- **Neue Routen:** `PUT /api/scores/{fileId}/practice`,
  `POST /api/scores/{fileId}/practice-tracks`, `POST …/follow/move`,
  `GET …/follow/companion` und die Offline-Seite unter `/offline`. Nach dem
  Update `occ upgrade` laufen lassen, sonst antworten sie bis zu einer Stunde
  mit 404.

### Sicherheit

- **Vorgemerktes gehört einem Konto.** Die Offline-Seite zeigt nur Einträge der
  angemeldeten Person und löscht fremde. Weil Nextcloud den Browserspeicher
  beim Abmelden in Chrome nicht räumt, löscht die App alles Vorgemerkte, sobald
  die Offline-Seite mit Netz nachweislich zum Login umgeleitet wird; ein
  Captive Portal räumt nichts. Bis dahin bleibt es auf dem Gerät ohne Netz
  lesbar; auf geteilten Geräten nicht vormerken
  ([S10](docs/architecture.md#s10-vorgemerktes-gehört-einem-konto-und-verschwindet-mit-der-anmeldung)).
- **Begleit-Token für „Folgt mir“ nur für das Umzugsziel.** Ein Folgegerät in
  der App bekommt ein Token nur für eine Partitur, zu der die Sitzung seiner
  geöffneten Partitur tatsächlich umgezogen ist, und nur, wenn es sie lesen
  darf ([S1](docs/architecture.md#s1-begleit-token-sind-an-zweck-datei-und-direct-editing-token-gebunden)).
- **Dateinamen, die die App anlegt** (Setlisten und Übe-Tracks), verlieren
  Steuer- und Richtungszeichen, mit denen sich eine Endung optisch verdrehen
  ließe, und sind auf 120 Zeichen bzw. 240 Bytes begrenzt
  ([S2](docs/architecture.md#s2-schreiben-mit-token-nur-um-die-partitur-herum)).

- **Abhängigkeiten mit bekannten Lücken angehoben:** DOMPurify 3.4.16
  (GHSA-p98j-92pf-mc4p; betrifft nur den von ScoreView nicht genutzten
  `IN_PLACE`-Modus), axios 1.20.0 über `@nextcloud/axios`, dazu zur Bauzeit
  webpack-dev-middleware und brace-expansion. `@nextcloud/vue` 9.13.1 bringt
  einen Fix für die Ebenenlage aufgeklappter Auswahllisten mit.
- **Die Sicherheitsprüfung in CI kennt datierte Ausnahmen** (`npm run audit`,
  `tools/audit-allowlist.json`). Die erste gilt bis 2027-01-06 für braces
  (GHSA-vfj7-8cjw-p6xm): Dafür gibt es keine bereinigte Version, und braces
  läuft nur zur Bauzeit.

### Behoben

- **Mitscrollen bei starkem Zoom.** Das Ende des eigenen, weichen
  Nachführens galt als Scrollen von Hand und hielt das Mitscrollen 2,5 s an:
  Waagerecht lief der Cursor aus dem Bild, und beim Systemwechsel blieb die
  Ansicht rechts stehen, bis die Pause ablief. Jetzt folgt sie laufend und
  springt beim Systemwechsel sofort an den Anfang des nächsten Systems.
- **Ruckeln bei der Wiedergabe in Files.** Cursor und Positionsregler
  schrieben bei jedem Notenschritt bzw. in jedem Bild ein `style`-Attribut;
  in Files löst das über Nextclouds `:has()`-Regeln jedes Mal eine
  Stil-Neuberechnung über den ganzen Baum aus. Der Cursor ist jetzt ein
  SVG-Rechteck, der Regler läuft in 250-ms-Schritten – rund ein Viertel der
  Stilzeit. Das weiche Gleiten des Cursor-Bands entfällt dabei.

## [1.11.0] – 2026-09-24

### Geändert

- **Die Bedienleiste ordnet ihre Werkzeuge in drei Gruppen:** Üben (Loop,
  Tempo, Metronom, Anfangston, Mixer, Aufnahme), Ansicht (Zoom, Darstellung,
  Meine Stimme, Notizen) und Probe (Leitung und „Folgt mir“, neue Setliste).
  Draußen bleiben Transport und Vollbild. Werkzeuge mit eigenem Bedienfeld
  öffnen innerhalb der Gruppe eine Unterseite statt eines zweiten
  Aufklappers. Ist in einer Gruppe etwas eingeschaltet, trägt ihr Knopf einen
  Punkt. Für die Leitung steht die Probe-Gruppe vorn.

### Behoben

- **Auf Tabletbreite (etwa 700–1200 px) überlagerten sich Suchlauf, Zeit und
  Taktfeld mit den Werkzeugen.** Die Leiste schaltete fest ab 700 px auf
  kompakt um, gerechnet für neun Werkzeuge, inzwischen waren es bis zu
  vierzehn. Sie schaltet jetzt um, sobald der Transport tatsächlich
  überläuft.

## [1.10.2] – 2026-09-24

### Behoben

- **Der lokale Konvertierungsweg lief unter PHP 8.1 und 8.2 nie.** Die App las
  den Exitcode von `node` über `proc_close()`, nachdem `proc_get_status()` den
  beendeten Prozess schon eingesammelt hatte – vor PHP 8.3 liefert
  `proc_close()` dann `-1`. `node --version` galt damit immer als gescheitert,
  die Voreinstellung fand nie eine Node-Laufzeit, und der Rückfall im Browser
  verdeckte das still. Der Exitcode kommt jetzt aus `proc_get_status()`; ein
  Test mit echtem Prozess läuft in der PHP-8.1-Achse der CI mit.
- **Eine späte Statusantwort lud nach einem Stückwechsel noch einmal.**
  Schaltete die Setliste weiter oder schloss man den Viewer, während der
  Statusabruf lief, lud dessen Antwort die gerade offene Partitur ein zweites
  Mal und startete bei „wird konvertiert“ einen zweiten Abfragestrang samt
  zweiter Zeitschleife. Dasselbe Rennen ließ Notizen des vorigen Stücks im
  nächsten erscheinen. Beide verwerfen überholte Antworten jetzt.
- **Ein ausgelasteter Sidecar schaltete alle auf den Browser um.** Der Sidecar
  begrenzt seine Warteschlange jetzt (`SCOREVIEW_MAX_QUEUED`) und antwortet
  darüber mit 503; die App versucht es dann später erneut, statt die Partitur
  als gescheitert zu führen oder den Rückfall auszulösen. Erst nach 20
  Versuchen endet es mit einem eigenen Fehler (`sidecar_busy`).
- **Wiedergabe:** Scheiterte der Aufbau des Players, blieb sein AudioContext
  offen, und ein unlesbares MIDI ließ die Ladeanzeige für immer stehen (jetzt
  mit Frist). Ein abgestürzter Worker der Intonation ließ „Auswertung läuft“
  stehen; eine verworfene Auswertung rechnete im Hintergrund weiter und hielt
  die Live-Nadel auf. Eine ungespeicherte Aufnahme erscheint nur noch bei
  ihrer eigenen Partitur – „Analysieren“ wertete sie sonst gegen die Noten des
  nächsten Stücks aus.
- **Ein Settings-POST ohne ein Feld überschrieb die Einstellung** – ohne
  `conversionBackend` wechselte er still auf den Sidecar, ohne
  `eagerConversion` schaltete er die Sofortkonvertierung ab. Fehlende Felder
  bleiben jetzt unverändert.
- **Der Speicherdeckel für Aufnahmen ließ sich mit parallelen Uploads
  überschreiten.** Die Summen werden nach dem Speichern erneut geprüft.
- **Aufräumen:** Die gemerkte Stimmwahl („Meine Stimme“) blieb nach dem Löschen
  einer Partitur für immer in den Nutzereinstellungen; der Sidecar ließ nach
  einem Zeitlimit Xvfb-Sperrdateien liegen und konnte zwei Läufe auf dieselbe
  Displaynummer setzen.

### Sicherheit

- **Delegierte Admins konnten auf dem Server Programme starten.** Wer die
  ScoreView-Einstellungen delegiert bekommen hatte, durfte den Pfad zu `node`
  setzen, den der Server anschließend ausführt, und Adressen, die er selbst
  abruft. Diese vier Felder ändert jetzt nur noch die Gruppe `admin`, und
  geänderte Werte werden geprüft ([S9](docs/architecture.md#s9-was-programme-startet-oder-adressen-abruft-stellt-nur-ein-voller-admin-ein)).
- **Drosselung und Obergrenzen:** „Folgt mir“ starten, beenden und beitreten
  sowie Notizen anlegen und ändern sind gedrosselt; je Person und Partitur gibt
  es höchstens 500 Notizen. Die Personensuche für Leitungen prüft weniger
  fremde Dateibäume, der lokale Konverter deckelt seine Ausgabe, und das
  Sidecar-Image ist per Digest und Prüfsumme festgelegt.

### Geändert

- **Beim Abspielen rendert der Viewer nicht mehr in jedem Frame ganz neu.**
  Zeitanzeige, Seekbar und Positionslinie hängen allein an der Zeit, alle
  Seiten bekommen stabile Props, und die Live-Intonation färbt nicht mehr bei
  jedem Rahmen alle ausgewerteten Noten neu.
- Index auf `scoreview_annotations(user_id)` für das Löschen eines Kontos.

## [1.10.1] – 2026-09-24

### Behoben

- **„engine initialisation failed“ beim Konvertieren im Browser nach einem
  Engine-Wechsel.** Die Route der Engine trug ihre Version nur als `?v=` am
  Glue. `scoreview.lib.wasm` und `scoreview.lib.data` fordert der Glue aber
  relativ zu seiner eigenen URL an, und dabei fällt der Query-String weg. Beide
  Dateien lagen damit unter einer unversionierten URL ein Jahr lang als
  `immutable` im Browsercache. Ein Browser, der die Engine schon einmal
  geladen hatte, setzte nach dem Wechsel von 4.7.4 auf 4.7.5 die alte `.wasm`
  unter den neuen Glue und scheiterte bei jedem Öffnen, ohne dass Neuladen
  half. Betroffen war vor allem die Nextcloud-Android-App, deren WebView ihren
  Cache nie von selbst räumt. Die Version steht jetzt im Pfad
  (`/api/engine/{version}/{name}`) und gilt damit für alle drei Dateien. Ein
  vergifteter Cache heilt sich dadurch von selbst, weil die neuen URLs dort
  nie vorkamen.

## [1.10.0] – 2026-09-24

### Neu

- **Anfangston, Stereobild und Speed-Trainer zum Üben.** Ein Knopf in der
  Leiste spielt, solange man ihn hält, den Ton der eigenen Stimme an der
  gerade sichtbaren Stelle – zwischen zwei Phrasen den nächsten Einsatz – oder
  den Grundton der Tonart, als Klavierton durch dieselbe Ausgabekette wie die
  Musik. „Meine Stimme“ merkt sich die App jetzt je Partitur auf dem Server
  (`/api/scores/{fileId}/my-part`); bisher ging die Wahl bei jedem Öffnen
  verloren, und Anfangston, Stimmnotizen und Intonation hängen alle daran. Auf
  Wunsch liegt die eigene Stimme rechts im Stereobild und der Rest links. Der
  Speed-Trainer hebt das Tempo mit jedem Loop-Durchlauf um einen Schritt bis
  zum Zieltempo und endet, sobald jemand selbst am Tempo dreht.

- **Aufführungsmodus, Blättern per Taste und Pedal, helle Noten auf Dunkel.**
  Im Aufführungsmodus wirken nur Blättern, Zoom, „nächstes Stück“ und der
  Sprung einer Leitung; verlassen wird er, indem man das Schloss eine Sekunde
  hält. Welche Bedienung wann wirkt, entscheidet eine einzige Stelle
  (`interactionPolicy.js`), die Unbekanntes sperrt. `Bild↓`/`Bild↑` – und damit
  die meisten Bluetooth-Pedale – blättern so, dass das letzte vollständig
  sichtbare System oben steht und keine Zeile verloren geht; im
  Aufführungsmodus auch ohne Fokus im Viewer. Der Bildschirm bleibt wach,
  solange gespielt, aufgeführt oder gefolgt wird. Die Notenfarbe folgt auf
  Wunsch dem dunklen Theme, per CSS und ohne das SVG anzufassen; eingebettete
  Bilder bleiben unverändert.

- **Leitungsrolle, Stimmnotizen, Stempel und Studierbuchstaben für die
  Chorprobe.** Die Eigentümerin einer Partitur – ohne Eigentümerin, wer
  Schreibrecht hat – kann Leitungen ernennen und abberufen; die Rolle ergänzt
  die Dateirechte und setzt Dateizugriff voraus
  ([E9](docs/architecture.md#e9-die-leitungsrolle-ergänzt-die-dateirechte)).
  Leitungen richten Notizen an einzelne Stimmen, die jede Stimme hervorgehoben
  und die übrigen zurückgenommen sieht, und setzen Stempel – Atemzeichen,
  Zäsur, Dynamik, Fermate und mehr –, die an Takt und Anteil hängen und mit dem
  Zoom skalieren. Die Taktnavigation nimmt „C“ und „C+3“ an, zeigt die Stelle
  als „47 (C+3)“ und bietet die Buchstaben als Schnellwahl.

- **„Folgt mir“.** Eine Leitung schickt Stelle, Loop und Anfangston an alle
  Geräte mit derselben Partitur. Übertragen wird ein Zustand mit Zählern statt
  eines Befehlsstroms: Ein Gerät nach einem Funkloch holt den letzten Stand,
  nichts wird nachgespielt, und ein Anfangston, der älter als 2 s ankommt,
  bleibt stumm
  ([E10](docs/architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
  Ohne weitere Einrichtung fragen die Geräte alle 800 ms ab (einstellbar
  500–3000 ms), aus dem Cache beantwortet und ohne Datenbank. Gemessen: Tipp →
  Sprung p50 595 ms, p95 945 ms; 40 Geräte kosten 2–3 CPU-Kerne. Ist
  `notify_push` eingerichtet, schickt der Server stattdessen ein Ereignis, und
  die Last entfällt weitgehend; die Betriebsdiagnose zeigt, ob Push greift, und
  rät ab 20 Geräten dazu. Neue Abhängigkeit: `@nextcloud/notify_push`.

- **Setlisten.** Eine Datei `*.setlist.md` – Markdown mit einer Liste von Links
  auf Partituren – öffnet sich per Klick in ScoreView; der Viewer wechselt von
  Stück zu Stück, ohne Aufführungsmodus, Zoom oder SoundFont neu zu laden
  ([E11](docs/architecture.md#e11-die-setliste-als-markdown-datei)). Aus einer
  offenen Partitur heraus bietet er die Setlisten ihres Ordners an. Der Editor
  fügt Stücke über Nextclouds Dateiauswahl hinzu und ordnet per Ziehen; er
  ersetzt nur die erste Liste und lässt allen übrigen Text der Datei stehen.
  Aufgelöst wird jeder Eintrag aus Sicht der Leserin – was eine Sängerin nicht
  sehen darf, fehlt nur für sie. Neue Abhängigkeit: `@nextcloud/dialogs`.

- **Eigene Aufnahmen und Rückmeldung zur Intonation.** Aufgenommen wird mono
  mit 16 kHz, gespeichert in den App-Daten statt in Files; eine Aufnahme hört
  nur, wer sie gemacht hat. Abgehört wird sie im selben AudioContext wie die
  Begleitung, beide Latenzen ausgeglichen – gemessen liegt sie 42–52 ms hinter
  dem Cursor und bis zu 22 ms vor der Begleitung. Die Intonation zeigt live
  eine Nadel am Cursor und danach, aus der gespeicherten Aufnahme neu
  berechnet, die Stellen mit mehr als 25 bzw. 50 Cent Abweichung; auf dem
  lokalen Konvertierungsweg färben sich zusätzlich die Notenköpfe der eigenen
  Stimme. Das Mikrofon läuft nur auf ausdrücklichen Wunsch, ein roter Punkt in
  der Leiste zeigt wofür und schaltet es ab. Grenzen je Partitur, je Aufnahme,
  je Person und für die Instanz schützen den Speicher, der gegen kein
  Kontingent zählt.

- **Alles auch in den mobilen Apps.** Setliste, Leiten, Folgen, Stempel und
  Einstellungen gehen auf der Seite für die Nextcloud-Apps. Weitere Stücke
  einer Setliste erreicht sie über kurzlebige Begleit-Token, die nur gegen ihr
  Direct-Editing-Token, nur für Stücke derselben Setliste und nie aus einem
  anderen Begleit-Token entstehen
  ([E8](docs/architecture.md#e8-eine-eigenständige-seite-für-die-mobilen-apps));
  widerrufen lassen sie sich alle mit
  `occ config:app:delete scoreview companion_secret`. Die Leiste passt auf
  360 px in eine Zeile. Das Mikrofon gibt die Android-App nicht frei; dort
  führt „Im Browser öffnen“ weiter.

### Geändert

- **Die Engine des lokalen Wegs steht auf `v4.7.5-engine.3`** und schreibt
  Tonarten mit Dur/Moll und Studierbuchstaben in `meta.json` (`keySigs`,
  `rehearsalMarks`). Der Sidecar liefert die Felder nicht; dort kommen
  Buchstaben und Tonarten aus dem MIDI, das auf beiden Wegen byteweise gleich
  ist, nur ohne Dur/Moll
  ([E12](docs/architecture.md#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)).
  `CURRENT_FORMAT_VERSION` steigt auf 3: Jede bereits konvertierte Partitur
  wird beim nächsten Öffnen einmal neu konvertiert, damit sie die Felder
  bekommt.

- **Anzeigeeinstellungen werden auch in den mobilen Apps gespeichert.**
  `POST /api/preferences` nimmt jetzt das Direct-Editing-Token an; bisher
  wirkten Hervorhebung und Farbe dort nur bis zum Schließen.

- **Das Mikrofon ist auf der Files-Seite freigegeben**, solange Aufnahme oder
  Intonation eingeschaltet sind. Nextcloud sperrt es sonst auf jeder Seite per
  `Feature-Policy`. Freigegeben wird nur unter `/apps/files` und auf der Seite
  der mobilen Apps; Dashboard, Talk und alle übrigen Seiten bleiben gesperrt.
  Wer das nicht will, schaltet beide Funktionen in der Verwaltung ab.

- **Neue Admin-Einstellungen im Abschnitt „Probe und Konzert“:** Schalter für
  Leitung/„Folgt mir“, Aufnahme und Intonation, das Abfrageintervall und die
  vier Speichergrenzen der Aufnahmen. Neue Routen und Tabellen verlangen
  `occ upgrade`.

### Behoben

- **Ein Suchlauf setzte Stummschaltung, Solo und Lautstärke im Mixer zurück.**
  spessasynth setzt bei jedem Suchlauf – und damit bei jedem Loop-Rücksprung –
  den Synthesizer zurück und spielt die Controller aus dem MIDI nach, und
  MuseScore schreibt die Kanal-Lautstärke an den Anfang jeder Spur. Ein
  stummgeschalteter Kanal stand nach dem ersten Durchlauf wieder auf voller
  Lautstärke. Die Einstellungen des Mixers sind jetzt per `lockController`
  gegen den Sequencer verriegelt.

- **Ein Suchlauf setzte das im Mixer gewählte Instrument zurück**, aus
  demselben Grund: Der Reset endet mit einem Programmwechsel auf 0, danach
  spielt der Sequencer den aus dem MIDI nach. Die gewählte Trompete klang nach
  dem ersten Loop wieder als Chorstimme. Jetzt verriegelt über `presetLock`.

- **Auf dem lokalen Konvertierungsweg wurden keine Notenlinien erkannt.** Die
  Engine schreibt sie als Gruppe mit Transformation statt als Polylinie mit
  absoluten Punkten; der Viewer kannte nur die zweite Form und fand 0 statt 10
  Notenzeilen je Seite. „Meine Zeile“ blieb deshalb wirkungslos. Beide Formen
  werden jetzt gelesen.

- **Die Loop-Flaggen waren auf dem Notenpapier kaum zu sehen.** Sie benutzten
  Nextclouds Farbvariablen für Flächen, die auf dem weißen Papier fast
  verschwinden; sie haben jetzt eigene Farben mit Kontrast zum Papier, hell wie
  dunkel.

- **Der Punkt einer eigenen Notiz war unter Nextcloud 34 kaum zu sehen.**
  `--color-warning` ist dort eine Flächenfarbe (hell #FFEEC5, dunkel #3D3010);
  der Punkt kam damit auf 1,15:1 zum weißen und 1,32:1 zum dunklen Papier. Er
  hat jetzt wie die Loop-Flaggen eine eigene Farbe je Notenmodus, mit
  mindestens 3:1 zum Papier.

- **Die Punkte geteilter Notizen und der Stimmnotizen waren bei gekreuzten
  Farben kaum zu sehen.** Sie nahmen Primär- und Warntextfarbe des
  Nextcloud-Themes, lagen aber auf dem Papier, das dem Notenmodus folgt: Bei
  hellen Noten auf Dunkel unter hellem Theme kam der Stimmnotizpunkt auf
  2,0:1, bei dunklen Noten auf Weiß unter dunklem Theme auf 1,15:1. Beide haben
  jetzt wie der eigene Punkt eine Farbe je Notenmodus (bei Standard-Theme
  dieselbe wie bisher), mit mindestens 3:1 zum Papier in allen zwölf
  Kombinationen. Umgekehrt folgen die Stempel in Palette und Notizliste jetzt
  dem Theme statt dem Notenmodus – sie stehen in der Leiste, nicht auf dem
  Papier, und ein hellblauer Stempel auf weißer Leiste kam auf 2,2:1.

- **Der Rahmen einer verwaisten Notiz war unter Nextcloud 34 praktisch
  unsichtbar.** Er nahm `--color-warning`, das dort eine Flächenfarbe ist
  (1,15:1 hell, 1,39:1 dunkel zum Grund der Leiste). Jetzt
  `--color-element-warning` mit 3,5:1 bzw. 11,9:1.

- **Ein zweiter Tipp der Leitung kurz nach dem ersten ging verloren.** Solange
  eine Änderung von „Folgt mir“ unterwegs war, waren die Knöpfe gesperrt; wer
  binnen einer Antwortzeit (gemessen rund 70 ms) von „B“ auf „C“
  umentschied, schickte alle nach B. Die Knöpfe bleiben jetzt bedienbar: Was
  während einer Anfrage getippt wird, geht gleich danach als eine Anfrage
  hinaus, von Stelle und Loop nur der neueste Stand, ein Anfangston nie
  verdrängt. Weiterhin läuft je Gerät nur eine Anfrage zur Zeit, sodass ein
  älterer Sprung nie einen neueren überholt; ein kleines Rad neben „Folgt mir“
  zeigt, dass noch etwas unterwegs ist
  ([E10](docs/architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).

- **Der AudioWorklet-Prozessor der Wiedergabe konnte nach einem Update aus dem
  Browser-Cache kommen.** `audioWorklet.addModule()` lädt ihn unter einer
  festen Adresse, an der kein Versionsparameter hing – ein Browser durfte nach
  einem App-Update den alten Stand weiterverwenden. Seine Adresse und die des
  neuen Aufnahme-Worklets tragen jetzt die App-Version.

## [1.9.3] – 2026-09-23

### Behoben

- **Die Engine des lokalen Konvertierungswegs steht auf
  `v4.7.5-engine.2`.** Derselbe MuseScore-Kern 4.7.5 wie zuvor, dieselben
  Artefakte – der Selbsttest misst unverändert 20 markierte Segmente und
  0,98 SVG-Einheiten größten Notenkopfabstand. Der Stand bringt gehärtete
  Dateizugriffe und beseitigte Speicherlecks mit. Die eine Schwäche, die
  darin schwer wiegt – eine Partitur konnte einen Pfad außerhalb des
  Ressourcenbaums benennen –, traf ScoreView nicht: Hier läuft die Engine
  als WebAssembly unter Node und damit in einem reinen Hauptspeicher-
  Dateisystem, in dem es nichts vom Server zu erreichen gibt. Betroffen war
  die native Kommandozeile, die diese App nicht benutzt.

### Geändert

- **`@nextcloud/babel-config` entfernt – das Paket war nie verdrahtet.** Es
  stand seit dem Grundgerüst in den Entwicklungsabhängigkeiten, aber es gibt
  weder `babel.config.js` noch `.babelrc` noch einen `babel`-Schlüssel, über
  den es eingebunden worden wäre; der `babel-loader` aus
  `@nextcloud/webpack-vue-config` lief die ganze Zeit ohne Presets.
  Aufgefallen ist es erst, als die Aktualisierung auf 2.0.0 die Installation
  zerlegte: Die Version verlangt `@babel/core ^8`, `@nextcloud/webpack-vue-config`
  besteht auf `^7.22.9` – ein unauflösbarer Konflikt um ein Paket ohne
  Wirkung. Ein Vergleichsbau belegt, dass die Bundles byteweise unverändert
  entstehen; das Lockfile verliert dabei gut 1600 Zeilen, den gesamten
  `@babel/preset-env`-Baum.

- **Der Frontend-Build läuft auf Node 24 statt 22.** `@nextcloud/files` 4.1.0
  verlangt `^24 || >=26`; auf Node 22 blieb das eine `EBADENGINE`-Warnung,
  während `engines` in `package.json` weiterhin 22 zusagte – eine Zusage, die
  ihre eigenen Abhängigkeiten nicht mehr deckte. Die Zusage lautet jetzt
  `^24.0.0`, und zwar ohne Oder-Zweig: `@nextcloud/vue` 9.13.0 deckt
  `^20.11 || ^22 || ^24` ab, `@nextcloud/files` 4.1.0 `^24 || >=26` –
  gemeinsam bleibt genau Node 24 übrig. CI und Release-Workflow bauen
  entsprechend. Nur der Bau ist betroffen: Der ausgelieferte Tarball bringt
  `js/` fertig mit, auf dem Server läuft dafür kein Node.

  Unberührt bleibt der lokale Konvertierungsweg, der auf dem Server sehr wohl
  Node braucht – `converter/` sagt weiterhin `>=18` zu und wird gegen 18 und
  22 geprüft.

- **Nextcloud 35 wird hart geprüft statt weich.** Die obere Achse der
  Backend-Matrix lief gegen den beweglichen Zweig `dev-stable35` und durfte
  deshalb rot werden, ohne den Lauf zu stoppen – `nextcloud/ocp` gab es nicht
  anders. Seit dem 4. September 2026 ist v35.0.0 veröffentlicht, die Achse
  steht jetzt auf `^35.0` und zählt wie jede andere. Die Zwischenachse
  `^34.0` entfällt damit: Geprüft werden wieder genau die beiden Enden, die
  `info.xml` zusagt.

- **`@nextcloud/vue` auf 9.13.0, `@nextcloud/files` auf 4.1.0.** Die neue
  Fassung von `@nextcloud/vue` führt `@nextcloud/files` als optionalen peer ab
  4.1.0; das hebt die Version mit an.

## [1.9.2] – 2026-09-16

### Behoben

- **In den mobilen Nextcloud-Apps fehlte „Bearbeiten", und ScoreView war dort
  nicht erreichbar.** Deren Editorauswahl vergleicht ausschließlich den
  Mimetype der Datei; stand `.mscz` auf `application/octet-stream`, blieb der
  Menüpunkt aus. Die Zuordnung `.mscz` → `application/x-musescore` liest
  Nextcloud aber nur aus `config/mimetypemapping.json` und nie aus einer App –
  auf verwaltetem Hosting war der mobile Einstieg damit überhaupt nicht
  herstellbar, und auf einer eigenen Instanz hing er an zwei `occ`-Aufrufen,
  die niemand vermutet, solange der Browser funktioniert.

  Die App trägt den Mimetype jetzt selbst ein: bei Installation und Update über
  einen Repair-Step, und nach jedem Upload über einen Background-Job. Beides
  benutzt dieselben öffentlichen Schnittstellen, die auch
  `occ maintenance:mimetype:update-db` benutzt, und berichtigt den ganzen
  Bestand auf einmal – Gruppenordner und Freigaben eingeschlossen, ohne
  `occ files:scan`. Nicht abgedeckt bleiben das eigene Dateisymbol und die
  Erkennung im Moment des Uploads; beides braucht weiterhin Schreibzugriff auf
  `config/`.

### Geändert

- **Dokumentation zum Mimetype richtiggestellt.**
  `occ maintenance:mimetype:update-db` zieht den Bestand sehr wohl mit, sobald
  der Mimetype neu in die Datenbank kommt – die bisherige Aussage, dafür sei
  zusätzlich `occ files:scan` nötig, galt nur für einen bereits eingetragenen
  Mimetype (dort hilft `--repair-filecache`). Dazu neu in
  [docs/troubleshooting.de.md](docs/troubleshooting.de.md): eine PROPFIND-Probe für
  den Mimetype ohne Shell, und warum das **Antippen** einer `.mscz` in der
  Android-App bei einer fremden Anwendung landet statt bei ScoreView –
  installierte Apps haben dort Vorrang, Direct Editing ist nur der Rückfall.

## [1.9.1] – 2026-09-15

### Behoben

- **Eine abgebrochene Konvertierung sperrte die Partitur dauerhaft.** Starb der
  Prozess mitten im Lauf – OOM-Kill, abgewürgter Cron-Durchgang, Neustart des
  Containers –, blieb der Datensatz für immer auf `processing`. Von da an war
  jeder Ausweg zu: Der Hintergrundjob übersprang ihn als „läuft schon",
  „Neu konvertieren" verweigerte aus demselben Grund, und aufgeräumt wurde er
  nie. Es half nur ein Eingriff in die Datenbank oder ein erneuter Upload.
  Ein solcher Lauf gilt jetzt nach einer halben Stunde als tot und wird beim
  nächsten Öffnen als Fehler gemeldet – samt neuem Versuch. Der Knopf
  „Neu konvertieren" greift an ihm wieder, an einem tatsächlich laufenden
  weiterhin nicht.

- **Der Viewer drehte sich endlos, wenn die Hintergrundverarbeitung stillstand.**
  Läuft kein Cron, entsteht serverseitig gar kein Datensatz, der Statusendpunkt
  antwortet dauerhaft „wird konvertiert", und der Viewer fragte im
  Zweisekundentakt weiter – ohne Grenze und ohne Hinweis. Nach zwei Minuten
  steht jetzt der wahrscheinliche Grund unter dem Kreisel, nach einer halben
  Stunde wird abgebrochen. Die Auskunft gab es bisher nur in der
  Betriebsdiagnose der Administration.

- **Ein zu langer Notizanker endete als Serverfehler.** `anchorEtag` war das
  einzige frei bestimmbare Feld der Notiz-Schnittstelle ohne Prüfung und lief
  ungeprüft in eine Spalte der Breite 64. Jetzt eine saubere 400er-Antwort.

- **Seiten waren unter zwei Namen abrufbar.** `page-01` löste auf dieselbe Datei
  auf wie `page-1`, obwohl die Prüfung das ausschloss – bei durchgehend
  unveränderlich ausgelieferten Antworten hieß das dieselbe Seite zweimal im
  Browsercache.

### Geändert

- **Der Konvertierungsdienst muss ein vertrauter Dienst bleiben – und kann es
  jetzt nicht mehr nur aus Gewohnheit sein.** Die Artefaktpfade aus seiner
  Antwort werden geprüft, bevor daraus eine Adresse wird; ein präparierter Pfad
  hätte die Anfrage samt Zugangsgeheimnis auf einen fremden Host lenken können.

- **Notenbilder und Partiturdateien werden als Anhang ausgeliefert.** Sie sind
  Material für den Viewer, kein Dokument, das ein Browser selbst darstellen
  soll. Am Viewer ändert das nichts – er holt sie ohnehin per XHR.

- **Der lokale Konverter dreht nicht mehr leer.** Schloss der Kindprozess seine
  Ausgabekanäle, ohne sich zu beenden, lief die Warteschleife bis zur
  Zeitgrenze auf voller CPU; seine Fehlerausgabe wuchs dabei unbegrenzt im
  Speicher.

### Intern

- **Die Rechteprüfung der Endpunkte steht unter Test.** Wer welche Partitur
  sehen, neu konvertieren und mit geteilten Notizen versehen darf, entscheiden
  die Controller – geprüft wurden bisher nur die Dienste darunter. 71 neue
  Testfälle.

- **Die Zusage „Nextcloud 31–35" wird an beiden Enden geprüft.** Getestet wurde
  bislang ausschließlich gegen die Schnittstellen von Nextcloud 31, obwohl
  `info.xml` bis 35 verspricht – für PHP, Node und Python galt der Grundsatz
  „eine ungeprüfte Zusage ist keine" längst, für Nextcloud selbst nicht.

- **Sicherheitsmeldungen der Abhängigkeiten laufen wöchentlich in CI**, als
  eigener Job, damit eine neue Meldung nicht die Testergebnisse verdeckt.

## [1.9.0] – 2026-09-14

### Neu

- **Partituren lassen sich jetzt aus den mobilen Nextcloud-Apps öffnen.** Sie
  laden keine Skripte der Dateien-Seite und kennen Nextclouds Weboberfläche
  nicht – bisher bot eine `.mscz` dort nur „Herunterladen“ an. ScoreView meldet
  sich nun als **Direct Editor** an: Die App blendet „Bearbeiten“ ein und
  öffnet eine eigenständige Seite mit demselben Viewer, nur ohne Nextclouds
  Oberfläche drumherum – mit einer schmalen Kopfzeile aus Dateiname und
  Schließkreuz, weil dort kein Wirt eines stellt
  ([E8](docs/architecture.md#e8-eine-eigenständige-seite-für-die-mobilen-apps)).

  Wichtig: Dieser Weg hängt **allein am Mimetype**. Die Ersatz-Dateiaktion auf
  der Endung, die im Browser einspringt, hat in der App keine Entsprechung –
  ohne registriertes `application/x-musescore` bleibt der Menüpunkt aus (siehe
  [Installation, Schritt 4](docs/installation.de.md#4-mimetype-in-der-regel-nichts-zu-tun)).

  Gemessen auf einem Samsung Galaxy S23 mit der Android-App: AudioWorklet und
  WebAssembly laufen, der Ton ist hörbar, der Bildschirm bleibt an. Nur die
  Vollbild-API ist in der WebView abgeschaltet – der Vollbildknopf erscheint
  deshalb ab sofort nur dort, wo Vollbild überhaupt möglich ist.

### Geändert

- **MuseScore 4.7.5 auf beiden Konvertierungswegen** (scoreview-engine
  `v4.7.5-engine.1`, Sidecar-AppImage 4.7.5.260831071). Die Zusagen aus M2, M4
  und M7 hat der Konverter-Selbsttest mit der neuen Engine unverändert
  bestätigt.
- **`GET /api/engine/{name}` antwortet jetzt ohne Anmeldung.** Die eigenständige
  Seite lädt die Engine mit `import(engineUrl)`, und ein nativer dynamischer
  Import kann keinen Ausweis tragen – der Rückfall im Browser wäre dort sonst
  unerreichbar. Was die Route ausliefert, sind appeigene Bauartefakte: für jede
  Instanz dieselben Bytes, kein Nutzerinhalt, dieselbe Art Material, die
  Nextcloud unter `/apps/<app>/js/` ohnehin ohne Anmeldung ausliefert. Alle
  übrigen Routen bleiben unverändert geschützt.

## [1.8.2] – 2026-09-14

### Behoben

- **Eine `.mscz` bot auf manchen Instanzen nur „Herunterladen" an, obwohl die
  Ersatz-Dateiaktion dafür da ist.** Betroffen war jeder Server, dessen
  Files-App noch `@nextcloud/files` v3 mitbringt und die Aktionsliste im
  globalen Array `_nc_fileactions` führt. Der Eintrag dort hängte an der
  Abfrage, ob der neue Ablageort `_nc_files_scope.v4_0` fehlt – den legt aber
  schon der Import von `@nextcloud/files` v4 selbst an, die Abfrage war also
  nie wahr. Die Aktion landete damit ausschließlich an einem Ort, den solche
  Server nicht lesen, und blieb ohne Fehlermeldung unsichtbar. Sie wird jetzt
  bedingungslos in beiden Listen eingetragen (E6). Besonders spürbar auf
  verwaltetem Hosting: Dort gibt es kein `occ`, die Dateiaktion ist der einzige
  Weg in den Viewer.
- **Ein fehlendes `OCA.Viewer` nahm die Dateiaktion mit.** Die Registrierung beim
  Viewer steht im Modulrumpf, noch vor der Dateiaktion; ohne Viewer-App – oder
  wenn deren Skript erst nach unserem lädt – brach dort ein `TypeError` das
  ganze Modul ab, und mit ihm den zweiten Einstieg. Sie wird jetzt übersprungen,
  wenn es nichts zu registrieren gibt; die Dateiaktion entsteht in jedem Fall.

## [1.8.1] – 2026-09-04

### Behoben

- **Das Schließkreuz lag auf dem letzten Knopf der Bedienleiste.** Betroffen war
  der Einstieg über die eigene Dateiaktion (dort, wo `.mscz` nicht als Mimetype
  registriert ist): Das Modal setzte sein Kreuz in die rechte obere Ecke des
  Inhalts – genau auf den Vollbildknopf, beide Zeichen übereinander. Das Kreuz
  sitzt jetzt in der Kopfzeile neben dem Dateinamen, also dort, wo es der
  reguläre Weg über Nextclouds Viewer ohnehin hat.

## [1.8.0] – 2026-09-04

Eine erste Erprobung auf einem Android-Telefon – mit Bluetooth-Kopfhörern, wie
es in einer Probe zugeht – hat drei Dinge zutage gefördert, die auf dem Desktop
unsichtbar bleiben. Alle drei sind hier behoben.

### Behoben

- **Der Cursor lief dem Ton voraus.** Die Audiouhr meldet, was an das
  Ausgabegerät *übergeben* wurde; hörbar wird es erst nach der Ausgabelatenz –
  am Desktop 10–30 ms, über Bluetooth 150–300 ms, bei ♩ = 120 also bis zu einer
  Achtelnote. Der Notencursor rechnet diese Latenz jetzt heraus und zeigt, was
  gerade zu *hören* ist. Metronom und Loop laufen bewusst weiter auf der
  ungerechneten Zeit, weil sie gegen dieselbe Audiouhr terminieren. Neu ist
  außerdem ein Regler **„Bild und Ton abgleichen"** (bei Tempo und Metronom):
  Ob der Browser den Bluetooth-Anteil überhaupt meldet, hängt am Kopfhörer –
  was er nicht meldet, lässt sich dort von Hand nachstellen. Der Wert wird pro
  Gerät gemerkt, nicht am Nutzerkonto: Er gehört zum Kopfhörer, nicht zur
  Person.
- **Das Anhalten sprang über die letzten Millisekunden hinweg.** Was beim
  Pausieren noch im Ausgabepuffer stand, wurde verworfen, galt aber als
  gespielt – beim Fortsetzen fehlte es. Jetzt hält die Wiedergabe an der
  zuletzt gehörten Stelle an.
- **Das automatische Nachführen setzte auf dem Telefon aus und holte ruckweise
  nach.** Manuelles Scrollen wurde bisher aus `scroll`-Ereignissen erschlossen;
  mobile Browser blenden ihre Adressleiste beim Scrollen aber ein und aus und
  erzeugen dabei Ereignisse, die von keinem Finger stammen. Die App deutete
  daraufhin ihr eigenes Nachführen als Eingriff und pausierte sich selbst.
  Erkannt wird jetzt die Geste – ob ein Finger auf dem Glas liegt, meldet der
  Browser. Weite Sprünge (Seitenwechsel) springen außerdem, statt über mehrere
  Bildschirmhöhen zu gleiten.
- **Metronomklick und Musik konnten auseinandergehen.** Der Klick hatte einen
  eigenen AudioContext; auf Android sind das zwei unabhängig gepufferte
  Ausgabe-Streams. Er benutzt jetzt den der Wiedergabe, wo es einen gibt.
- **Der Cursor zitterte auf schwacher Hardware**, weil manche Android-Builds
  die Audiouhr in groben Schritten fortschreiben. Die Anzeige wird zwischen
  zwei Fortschreibungen vorausberechnet.

### Geändert

- **Die Abspielsteuerung bleibt einzeilig.** Auf Telefonbreite brauchte sie
  rechnerisch rund 780 px und brach damit auf drei Zeilen um – dauerhaft etwa
  18 % der Bildschirmhöhe, auch im Vollbild. Draußen bleibt jetzt nur, was
  während des Singens gebraucht wird (Wiedergabe, Suchlauf, Takt); die
  Werkzeuge kommen über einen „Mehr"-Knopf auf Abruf. Ein aktives Werkzeug –
  ein laufendes Metronom, ein gesetzter Loop – bleibt als Punkt am Knopf
  sichtbar. Auf breiten Schirmen ändert sich nichts.
- **Im Vollbild zieht sich die Leiste während der Wiedergabe zusammen.** Nach
  drei Sekunden ohne Berührung bleibt eine Fortschrittslinie stehen, die sich
  antippen lässt. Bewusst keine vollständige Ausblendung: Ein Tipp auf die
  Partitur springt bereits an die getippte Note.

### Hinzugefügt

- **Diagnose der Wiedergabe** im Aufklapper „Darstellung", neben der Herkunft:
  Ausgabelatenz (gemessen, gemeldet und von Hand getrennt ausgewiesen),
  Tonausgabe, Aussetzer und Bildrate. Der Anlass ist, dass „die Wiedergabe
  synchronisiert nicht sauber" zwei ganz verschiedene Ursachen hat, die sich
  gleich anfühlen: Die Anzeige läuft dem Ton voraus, oder der Ton setzt aus,
  weil die Synthese auf dem Gerät nicht mitkommt. Aus der Ferne ist das nicht
  zu unterscheiden, auf dem Gerät mit einem Blick.

## [1.7.0] – 2026-09-03

### Hinzugefügt

- **ScoreView läuft jetzt auch dort, wo der Server gar nicht konvertieren
  kann.** Bisher brauchte die App entweder eine Node.js-Laufzeit auf dem Server
  oder einen Sidecar-Container; auf verwaltetem Hosting gibt es beides nicht,
  und die App war dort nicht betreibbar. Fehlt beides, konvertiert nun der
  **Browser der Nutzerin** – dieselbe Engine (MuseScore als WebAssembly), die
  sonst auf dem Server läuft, und dieselben Artefakte: `timing.json`,
  `measures.json` und `meta.json` sind Byte für Byte identisch zum
  Serverergebnis. Der Viewer sieht keinen Unterschied; angezeigt wird die
  Herkunft trotzdem („Gesetzt von diesem Browser").

  Das ist ausdrücklich ein **Rückfall**, kein dritter Konvertierungsweg: Er
  steht nirgends zur Wahl und greift nur, wenn der eingestellte Weg nicht
  laufen kann. Wo der Server konvertieren kann, ändert sich nichts – kein
  zusätzlicher Download, keine zusätzliche Anfrage, unveränderte CSP. Eine
  bereits fertige Konvertierung wird auch dann ausgeliefert, wenn der Server
  seine Node-Laufzeit inzwischen verloren hat; gerechnet wird nur, wo es nichts
  gibt.

  Was er kostet, steht in
  [E7](docs/architecture.md#e7-konvertierung-im-browser-als-rückfall) und ist
  kein Kleingedrucktes: Jedes Gerät lädt einmal rund 14 MB Konverter (7,3 MB
  über die Leitung), **zwischengespeichert wird nichts**, und jede Partitur
  wird bei jedem Öffnen neu gesetzt. Deshalb bricht eine eigene, kleinere
  Größenschranke (`client_max_score_bytes`, Vorgabe 10 MB) ab, *bevor* der
  Konverter geladen wird.

- **Die Betriebsdiagnose sagt, wenn der Rückfall greift** – als eigene Zeile
  neben der weiterhin roten Zeile mit der Ursache. Dass die App trotzdem läuft,
  soll nicht verbergen, warum der Server nicht konvertiert. Der Schalter
  „sofort konvertieren" weist in diesem Zustand darauf hin, dass er wirkungslos
  ist.

- **Fortschritt während der Konvertierung im Browser** – „Konverter wird
  geladen (rund 14 MB, einmal je Browser) …", danach seitenweise. Ohne diese
  Angabe stünde beim ersten Öffnen minutenlang ein stummer Kreisel.

### Geändert

- Die Antwort des Statusendpunkts kennt einen fünften Wert (`client`). Ältere,
  nicht neu gebaute Frontends warten darauf vergeblich – nach einem Update also
  einmal neu laden.

## [1.6.0] – 2026-09-03

### Hinzugefügt

- **Partituren mit eingebetteten Bildern lassen sich auch auf dem lokalen
  Konvertierungsweg öffnen.** Bisher lehnte die App sie dort ab, bevor die
  Konvertierung überhaupt begann: Die scoreview-engine stürzte an so einer
  Partitur schon beim Laden ab, und der Viewer riet auf den Sidecar-Container
  auszuweichen. Die Engine setzt Bilder jetzt selbst – sie legt die
  Originalbytes als Daten-URI in die Seite, die sie trägt. Erkannt werden PNG,
  JPEG, GIF und BMP; zu den beiden Formaten, die dabei leer bleiben, siehe
  [Grenzwerte](docs/limits.de.md#bekannte-lücken). Ein alter Fehlerdatensatz
  bleibt stehen, bis die Partitur neu konvertiert wird – dafür gibt es den
  Knopf unten. Der Absturz war als
  [scoreview-engine#3](https://github.com/AndiMb/scoreview-engine/issues/3)
  gemeldet.

- **„Neu konvertieren" im Viewer** – im Aufklapper der Anzeigeeinstellungen,
  direkt unter der Angabe, womit die Seiten gesetzt wurden. Eine einmal fertige
  Konvertierung bleibt sonst liegen, solange niemand die Datei anfasst: Eine
  App-Fassung, die besser setzt, erreichte bestehende Partituren bisher nur
  über ein Hochzählen der Cache-Formatversion – das trifft jede Partitur der
  Instanz statt der einen, um die es geht. Der Knopf verwirft die gespeicherte
  Konvertierung samt Cache-Ordner und lässt sie neu erzeugen; er erscheint nur
  dort, wo Schreibrecht auf die Datei besteht, denn der Cache hängt an der
  Datei und gilt für alle, die sie öffnen.

- **Die Hervorhebung der klingenden Stelle lässt sich einstellen** – Form und
  Farbe, je Nutzerin gespeichert und damit auf jedem Gerät dieselbe. Zur Wahl
  stehen die eingefärbten Notenköpfe oder ein Band an der klingenden Stelle,
  dazu sechs Farbvorschläge und ein freier Farbwähler. Voreingestellt ist jetzt
  ein kräftiges Rot statt des bisherigen Blaus: Blau war aus
  Notenständer-Entfernung kaum auszumachen, und das Band war zusätzlich so
  blass, dass es auf hellen Bildschirmen unterging.
- **Der Viewer sagt, womit die angezeigten Seiten gesetzt wurden** – im selben
  Aufklapper: der Konvertierungsweg (Sidecar-Container oder scoreview-engine
  auf dem Server) und, getrennt davon, die MuseScore-Version, mit der die
  Partitur geschrieben wurde. Aufgezeichnet wird der Weg beim Konvertieren, denn
  die Admin-Einstellung sagt nur, was *jetzt* gilt – eine vor einem Wechsel
  konvertierte Partitur stammt weiterhin vom alten Weg. Vor dieser Fassung
  konvertierte Partituren melden „unbekannt", bis sie neu konvertiert werden.
- **Der klingende Notenkopf wird eingefärbt**, statt nur von einem Band
  überdeckt zu werden. Der SVG-Export der scoreview-engine schreibt zu jedem
  gezeichneten Element, zu welchem Segment, welcher Notenzeile und welcher
  Stimme es gehört – und die Segmentnummer ist dieselbe, die `timing.json`
  vergibt (M10). Das Band tritt dafür zurück, sobald Notenköpfe leuchten –
  zwei Anzeigen derselben Stelle sind eine zu viel. Auf dem Sidecar-Weg bleibt
  es unverändert beim Band: MuseScore selbst schreibt diese Kennungen nicht.
- Ein zweiter Einstieg in den Viewer: eine Dateiaktion auf der Endung `.mscz`,
  die eine Partitur in einem eigenen Vollbildfenster öffnet. Sie greift genau
  dann, wenn Nextclouds Viewer es nicht tut – wenn der Mimetype nicht
  registriert ist oder eine vorhandene Datei noch nicht neu eingelesen wurde.
  Damit ist die App auch dort benutzbar, wo niemand `occ` ausführen kann.

### Behoben

- **Eine nicht erreichbare SoundFont-Quelle endete als Serverfehler statt als
  Hinweis.** Der Auslieferungs-Endpunkt fing die falsche Ausnahmeklasse: Er
  fing `SidecarException`, die Beschaffung über eine konfigurierte
  `soundfont_fetch_url` wirft aber deren Basisklasse `ConverterException`.
  Damit lief genau der Fall ins Leere, für den es diese Einstellung überhaupt
  gibt – erste Wiedergabe auf dem lokalen Konvertierungsweg, Quelle nicht
  erreichbar, nichts im Cache: Statt der gemeinten 503-Antwort mit lesbarer
  Meldung, die der Viewer anzeigt, während er ohne Ton benutzbar bleibt, kam
  ein nackter 500, und die Warnung landete nicht einmal im Log. Der
  Sidecar-Weg war nicht betroffen. Der Endpunkt fängt jetzt die Basisklasse,
  wie es die Hintergrundjobs schon taten.
- **Eine präparierte Partitur konnte über das `style`-Attribut eine fremde
  Adresse ins Notenbild holen.** Der Sanitizer verbietet das
  `<style`-*Element* ausdrücklich damit, dass ein `url(...)` darin externe
  Ressourcen zieht und so den Aufruf verrät – dieselbe Schreibweise stand
  jedoch im gleichnamigen *Attribut* offen, das die Allowlist braucht.
  DOMPurify parst kein CSS, `style="fill:url(http://…)"` blieb also
  wortgleich stehen. Ein tatsächlicher Abruf war dabei nicht nachweisbar
  (Browser lösen externe SVG-Paint-Server nicht auf, und Nextclouds
  `img-src` griffe ohnehin) – die Allowlist gab aber eine Zusage, die sie
  nicht einhielt. `url(...)` ist im Attribut jetzt auf lokale
  `#`-Fragmente beschränkt.
- **Der Text einer Notiz war nach oben unbegrenzt.** `content` ist das
  einzige frei formulierte Feld der App und wird bei jedem Öffnen der
  Partitur mit ausgeliefert; eine Notiz konnte so groß werden, wie die
  Anfragegröße der Instanz zuließ. Jetzt gelten 10000 Zeichen, im
  Eingabefeld und auf dem Server. Ebenfalls eingegrenzt: der musikalische
  Anker, dessen Taktnummer ab 1 zählt und dessen Anteil im Takt zwischen 0
  und 1 liegt – nach oben bleibt die Taktnummer bewusst frei, denn ein
  Anker jenseits der Partitur ist ein regulärer Zustand und wird als
  verwaist angezeigt.
- **Eine neu konvertierte Partitur blieb im Browser die alte.** Die
  Auslieferungsrouten der Artefakte versprachen `immutable` – dass sich unter
  dieser URL nie etwas ändert –, trugen den Cache-Schlüssel aber gar nicht in
  der URL: der etag stand nur im serverseitigen Cache-Pfad. Nach einer
  Neukonvertierung, und ebenso nach einer Bearbeitung der `.mscz`, zeigte der
  Browser deshalb weiter die alten Seiten; Neuladen half nicht, weil Chrome
  Unterressourcen dabei nicht revalidiert und `immutable` es ausdrücklich
  verbietet. Sichtbar wurde die neue Fassung erst nach hartem Neuladen oder in
  einem frischen Profil. Die URLs tragen jetzt etag und Zeitstempel der
  Konvertierung.
- **Auf dem lokalen Konvertierungsweg war die Hervorhebung unsichtbar.** Zwei
  Ursachen, beide seit der Umstellung auf die scoreview-engine: Die Engine
  hängt die Segmentkennung an eine Gruppe statt an das gezeichnete Element, und
  das `fill`-Attribut am Glyph gewann gegen die geerbte Farbe – die Notenköpfe
  blieben schwarz. Zugleich malt sie einen weißen Hintergrundpfad ohne
  `class`-Attribut, den die bisherige Regel nicht erwischte; er deckte das Band
  vollständig zu. Beides ist jetzt für beide Konvertierungswege geregelt.
- **Beim Blättern zeigte die folgende Seite Buchstaben und Ziffern statt
  Noten.** Die scoreview-engine legt jede Glyphe einmal als `<path id="g0">`
  ab und verweist rund 1200-mal je Seite darauf – die Nummerierung beginnt aber
  auf jeder Seite wieder bei Null. Solche Verweise löst der Browser im ganzen
  Dokument auf, nicht innerhalb der eigenen Seite, und der Viewer hält beim
  Scrollen mehrere Seiten gleichzeitig geladen: Die neue Seite griff deshalb
  auf die gleichnamigen Glyphen der vorherigen zu. Der Satz reparierte sich
  scheinbar von selbst, sobald die vorherige Seite weit genug entfernt und
  freigegeben war. Die Kennungen werden jetzt beim Einbetten je Seite eindeutig
  gemacht. Betroffen war nur der lokale Weg; der Sidecar schreibt gar keine
  Kennungen.
- **Partituren aus MuseScore 1 bis 3 wurden mit den Stilvorgaben von
  MuseScore 4 gesetzt.** Die scoreview-engine lieferte die Vorgaben nicht mit,
  die MuseScore für ältere Dateien lädt – im Log stand `failed load style:
  legacy-style-defaults-v2.mss`, im Notenbild ein Satz, der nicht der seiner
  Zeit war. Gegen echtes MuseScore 4 geprüft: Eine MuseScore-2-Datei wird dort
  6 Seiten und wurde hier 5; jetzt sind es auf beiden Seiten 6. Ein
  MuseScore-3-Export derselben Partitur behält seine vier Seiten, setzt sie
  aber anders – und trifft damit MuseScores Bild. Die Vorgaben liegen jetzt im
  Ressourcenpaket der Engine. Eine Ersatzschrift bleibt – siehe
  [Grenzwerte](docs/limits.de.md#bekannte-lücken). Bereits konvertierte alte
  Partituren behalten ihr Bild, bis sie neu konvertiert werden.
- **Fehlermeldungen des lokalen Konverters nannten einen Stack-Frame statt der
  Ursache.** Gesucht wurde die letzte nicht leere Zeile der Fehlerausgabe – bei
  einem Node-Stacktrace ist das immer ein `at …`-Frame, die Meldung steht
  darüber. Jetzt steht die Ursache in der Oberfläche.
- **Ein Fehlerzustand blieb unübersetzt.** `local_unavailable` – der lokale
  Weg ist eingestellt, aber nicht lauffähig – hatte im Viewer keinen eigenen
  Satz und erschien als „unbekannter Fehler".
- **Nach einem SoundFont-Wechsel blieb die Wiedergabe stumm.** Beim Schreiben
  in die bestehende Cache-Datei übernahm Nextclouds Dateicache die neue Größe
  nicht – dort stand weiter die der Vorgängerin, und der
  Auslieferungs-Endpunkt schickt genau diese Zahl als `Content-Length`. Der
  Browser wartete damit auf Bytes, die nie kamen; ein Fehler stand nirgends.
  Gemessen an einem Wechsel von 40 auf 23,7 MB: angekündigt wurden 39.978.561
  Bytes, geliefert 23.712.790. Betroffen war jeder Wechsel der SoundFont-Quelle
  (anderes Sidecar-Image, andere Download-URL); bei gleichbleibender Datei
  stimmte die alte Zahl. Die Datei wird jetzt neu angelegt statt überschrieben.

### Geändert

- **Voreingestellt ist jetzt der lokale Konvertierungsweg statt des Sidecars.**
  Er ist der einzige, der nach `occ app:enable scoreview` schon fertig ist:
  Alles, was er braucht, liegt im App-Paket, und die Node-Laufzeit findet er
  selbst. Der Sidecar setzt einen zweiten Container *und* eine eingetragene
  Adresse voraus – als Voreinstellung hieß er „nach der Installation passiert
  erst einmal gar nichts", ohne dass der Oberfläche anzusehen wäre, warum.
  **Bestehende Installationen bleiben, wo sie sind:** Wo eine Sidecar-Adresse
  eingetragen ist, schreibt eine einmalige Migration den bis dahin nur
  impliziten Wert ausdrücklich fest, bevor die neue Voreinstellung greifen
  könnte.
- **Das SoundFont hat auf dem lokalen Weg eine voreingestellte Adresse.** Ohne
  Sidecar gibt es kein Image, aus dem sich eines nehmen ließe, und mitliefern
  lässt es sich nicht – der App Store nimmt nur Archive bis 20 MB, die
  MuseScore-WebAssembly belegt davon den Großteil. Bisher blieb die App
  deshalb stumm, bis jemand eine Adresse eintrug, und „kein Ton" war von außen
  nicht als fehlende Einstellung zu erkennen. Der Server holt jetzt beim ersten
  Abspielen `FluidR3Mono_GM.sf3` (~23 MB, MIT-lizenziert, dasselbe SoundFont,
  das auch MuseScore mitbringt) aus einem Release-Asset dieses Projekts; das
  Feld **SoundFont-Download-URL** überschreibt die Adresse weiterhin. Auf dem
  Sidecar-Weg ändert sich nichts – dort kommt es wie bisher aus dem Container,
  nichts wird aus dem Netz geladen.
- Die Betriebsdiagnose meldet „SoundFont noch nicht geholt" nicht mehr rot,
  sondern als Hinweis. Direkt nach der Installation ist das der Normalzustand
  und kein Fehler: Geholt wird beim ersten Abspielen.
- **Der lokale Konvertierungsweg läuft jetzt auf der
  [scoreview-engine](https://github.com/AndiMb/scoreview-engine)**
  (`v4.7.4-engine.2`): derselbe MuseScore-Kern 4.7.4, aber Qt-frei gebaut
  (MuseScore als ungepatchtes, gepinntes Submodul). Halber Wasm-Fußabdruck
  (9 statt 17,5 MB), rund dreimal schnellere Konvertierung, und die
  `duration` in den Metadaten entspricht jetzt der von Desktop-MuseScore –
  bisher stammte sie aus einem veralteten Zwischenstand. Die Engine ist
  korpus-geprüft: 569 Testpartituren gegen die bisherige Ausgabe, jede
  Abweichung gegen Desktop-MuseScore 4.7.4 geprüft und einzeln begründet.
  Text steht im SVG jetzt als referenzierte Glyph-Umrisse (`<defs>`/`<use>`,
  etwa halbe Dateigröße); der SVG-Sanitizer des Viewers lässt genau diese
  lokale Referenzform zu – Nebenbefund dabei: seine Allowlists waren
  wegen `USE_PROFILES` bisher wirkungslos, jetzt gelten sie wirklich.
  Die Notenkopf-Lageprobe des Selbsttests liest beide Glyph-Formen.
- Das App-Paket wird rund 5 MB kleiner, und die Zusatzfonts für CJK-Liedtexte
  werden wieder gelesen: Die Engine (`v4.7.4-engine.3`) bringt einen
  Brotli-Decoder mit, liefert ihre eigenen Schriften als woff2 aus (4,8 statt
  9,3 MB) und nimmt `.woff2` auch aus `cjk_font_dir` entgegen.

## [1.0.0] – 2026-08-26

Erste öffentliche Fassung.

### Notendarstellung

- MuseScores eigener SVG-Satz statt eines Neusatzes im Browser: Das Seitenbild
  entspricht dem, was MuseScore selbst druckt.
- Zoom ohne Qualitätsverlust, Zoom-Presets, Vollbild, Autoscroll im Sichtband,
  dauerhaft sichtbare Taktangabe.
- Nur sichtbare Seiten liegen im DOM; weggescrollte werden wieder freigegeben.

### Wiedergabe

- MIDI wird im Browser synthetisiert, gegen ein SoundFont, das die App selbst
  ausliefert – ohne Konfiguration und ohne fremden Host.
- Wiedergabe-Cursor, der synchron mitläuft – ein schmales Band je Notenzeile
  hinter den klingenden Noten statt eines Balkens über das ganze System.
- Ein Klick auf eine Note springt dorthin.
- Tempo in BPM, Mixer mit Lautstärke, Mute und Solo je Stimme, „meine
  Stimme"-Preset.
- Metronom auf jedem Schlag oder nur auf dem Taktanfang, Einzähler vor dem
  Start.
- Taktnavigation, Loop über einen Taktbereich mit Markierung im Notenbild,
  Tastaturkürzel.

### Notizen

- Text an einer musikalischen Position (Takt und Anteil im Takt), nicht an
  Pixelkoordinaten – Notizen überstehen ein Neurendern und einen Re-Upload
  derselben Partitur.
- Privat oder geteilt; geteilte Notizen hängen an den Dateirechten, nicht an
  einer eigenen Rechteverwaltung.
- **Auf Wunsch direkt im Notenbild** über dem zugehörigen System, statt nur im
  Panel: „In Takt 10 bitte forte" ist damit beim Singen lesbar, ohne etwas
  aufzuklappen. Mehrere Notizen am selben Takt stapeln sich, statt sich zu
  überlagern.

### Die eigene Stimme

- Wer im Mixer „meine Stimme" wählt, bekommt sie **auch im Notenbild markiert** –
  ein durchgehender Streifen unter der eigenen Zeile, das Gegenstück zum
  Buntstiftstrich.
- **„Nur meine Zeile"** nimmt die übrigen Stimmen zurück, statt sie zu
  entfernen: Das Seitenbild bleibt dasselbe (kein Reflow, E2), die
  Nachbarstimmen sind zur Orientierung noch schemenhaft da.
- Beides erscheint nur, wenn sich die Notenzeilen den Stimmen zweifelsfrei
  zuordnen lassen. Bei einem Klavierauszug oder einer Partitur mit
  ausgeblendeten leeren Zeilen bleibt es aus – eine falsche Markierung wäre
  schlimmer als keine.

### Betrieb

- **Zwei Konvertierungswege zur Wahl**, die dieselben Artefakte erzeugen: der
  Sidecar-Container mit echtem MuseScore 4, oder – ohne Container – MuseScore
  als WebAssembly, ausgeführt von der Node-Laufzeit des Servers. Siehe
  [E3](docs/architecture.md#e3-zwei-konvertierungswege-hinter-einer-api).
- Cache je `(fileId, etag)`, unveränderlich ausgeliefert; ein
  Cache-Formatwechsel invalidiert sich über `format_version` selbst.
- Betriebsdiagnose und Selbsttest auf der Verwaltungsseite – für beide
  Konvertierungswege, mit denselben Prüfungen.
- Aufräumjob für Cache und Notizen gelöschter Dateien und Konten.
- Verständliche Konvertierungsfehler mit Fehlercode statt roher Ausgaben.

### Oberfläche

- Touch-Bedienung mit Pinch-Zoom und Wachhalten des Bildschirms, für das Tablet
  am Notenständer.
- Deutsch und Englisch, Vollständigkeit der Übersetzungen durch einen Test
  abgesichert.

### Bekannt offen

Siehe [docs/limits.de.md](docs/limits.de.md) – insbesondere D.C./D.S./Coda-Sprünge,
Orchesterpartituren, Offlinebetrieb und die Verpackung als AppAPI/ExApp.

[1.27.2]: https://github.com/AndiMb/scoreview/compare/v1.27.1...v1.27.2
[1.27.1]: https://github.com/AndiMb/scoreview/compare/v1.27.0...v1.27.1
[1.27.0]: https://github.com/AndiMb/scoreview/compare/v1.26.3...v1.27.0
[1.26.3]: https://github.com/AndiMb/scoreview/compare/v1.26.2...v1.26.3
[1.26.2]: https://github.com/AndiMb/scoreview/compare/v1.26.1...v1.26.2
[1.26.1]: https://github.com/AndiMb/scoreview/compare/v1.26.0...v1.26.1
[1.26.0]: https://github.com/AndiMb/scoreview/compare/v1.25.3...v1.26.0
[1.25.3]: https://github.com/AndiMb/scoreview/compare/v1.25.2...v1.25.3
[1.25.2]: https://github.com/AndiMb/scoreview/compare/v1.25.1...v1.25.2
[1.25.1]: https://github.com/AndiMb/scoreview/compare/v1.25.0...v1.25.1
[1.25.0]: https://github.com/AndiMb/scoreview/compare/v1.24.0...v1.25.0
[1.24.0]: https://github.com/AndiMb/scoreview/compare/v1.23.0...v1.24.0
[1.23.0]: https://github.com/AndiMb/scoreview/compare/v1.21.2...v1.23.0
[1.20.1]: https://github.com/AndiMb/scoreview/compare/v1.20.0...v1.20.1
[1.20.0]: https://github.com/AndiMb/scoreview/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/AndiMb/scoreview/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/AndiMb/scoreview/compare/v1.17.0...v1.18.0
[1.17.0]: https://github.com/AndiMb/scoreview/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/AndiMb/scoreview/compare/v1.15.1...v1.16.0
[1.15.1]: https://github.com/AndiMb/scoreview/compare/v1.15.0...v1.15.1
[1.15.0]: https://github.com/AndiMb/scoreview/compare/v1.14.4...v1.15.0
[1.14.4]: https://github.com/AndiMb/scoreview/compare/v1.14.3...v1.14.4
[1.14.3]: https://github.com/AndiMb/scoreview/compare/v1.14.2...v1.14.3
[1.14.2]: https://github.com/AndiMb/scoreview/compare/v1.14.1...v1.14.2
[1.14.1]: https://github.com/AndiMb/scoreview/compare/v1.14.0...v1.14.1
[1.14.0]: https://github.com/AndiMb/scoreview/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/AndiMb/scoreview/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/AndiMb/scoreview/compare/v1.11.0...v1.12.0
[1.0.0]: https://github.com/AndiMb/scoreview/releases/tag/v1.0.0
