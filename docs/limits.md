# Limits and known gaps

**English** · [Deutsch](limits.de.md)

What ScoreView does, where its measured limits lie and what it deliberately
does not cover. All numbers were measured on the running installation, not
estimated; where something is an extrapolation, it says so. References such
as E1 or M2 point to the design decisions and format notes in
[docs/architecture.md](architecture.md), which is in German.

## Measured values

Three scores, measured on an ordinary workstation – both conversion paths in
the same session, so the columns are comparable. “Sidecar” here is the sidecar
converting with MuseScore itself; with the engine it converts like the local
path (see below):

| Score | Pages | Measures | `.mscz` | Sidecar | local | SVG total (sidecar / local) | largest page | MIDI | Cache (sidecar / local) |
|---|---|---|---|---|---|---|---|---|---|
| Mini score | 1 | 5 | 30 KB | **8.1 s** | **0.8 s** | 107 / 52 KB | 107 / 52 KB | 0.4 KB | 111 / 55 KB |
| Choral piece | 4 | 58 | 114 KB | **25.6 s** | **1.2 s** | 3235 / 1148 KB | 1040 / 354 KB | 12.4 KB | 3291 / 1196 KB |
| Choral piece | 5 | 63 | 98 KB | **31.9 s** | **1.2 s** | 1173 / 813 KB | 302 / 210 KB | 8.3 KB | 1227 / 858 KB |

The MIDI is byte-for-byte identical on both paths
([E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api) (German)). The
SVG pages show the same picture but encode it differently: the engine places
each glyph once in `<defs>` and sets it with `<use>`, while MuseScore draws
every outline again – 35–70 % of the file size, depending on note density.

Derived from this:

- **Conversion time via the sidecar with MuseScore ≈ 6 s per page + 2 s base load**
  (linear regression over the three data points). On the sidecar path the app
  waits a fixed maximum of 300 s from submission (`ConvertScoreJob`), which
  works out to about 50 pages; the sidecar's `MSCORE_TIMEOUT_SECONDS` (default
  600 s) lies above that and only takes effect if it is set lower. Anyone
  expecting very large scores should extrapolate with
  `page count × 6 s + buffer`. The figure depends noticeably on the CPU – an
  order of magnitude, not a guarantee.
- **The sidecar with the engine converts like the local path.** Measured on
  the test instance against the sidecar's API, on `parts-test.mscz` (3 pages,
  five staves): 1.4–2.5 s with the engine, 30–32 s with MuseScore itself, the
  same score in the same container.
- **Locally, about 0.45 s of that is base load** – process start plus
  instantiation of the Wasm module. The actual conversion takes 0.4–0.8 s,
  i.e. about 0.1 s per page. The local path wins mainly because it does not
  also render PNG/PDF/MusicXML that would be discarded afterwards
  ([M2](architecture.md#m2-schlüssel-im---score-media-json)).
- **SVG size varies strongly per page** (302 KB versus 1040 KB depending on
  note density, a factor of ~3.4). An extrapolation of "page count × average"
  is therefore rough. For 30 pages of dense writing, ~30 MB of SVG in the
  cache is plausible.
- **Embedded images weigh heavily.** They sit as a data URI in the page that
  carries them, and Base64 adds a third on top: the title page of the Aequale
  score (two PNGs, 562 KB together) thus weighs 773 KB instead of 23 KB. Only
  that one page is affected – the others stay as they were. The sidecar has
  not been cross-checked on this point.
- **MIDI remains negligible** (< 15 KB), as expected in
  [E1](architecture.md#e1-midi-statt-mp3-als-audioartefakt).
- **DOM load in the browser:** ~640–1370 nodes per rendered page. Only visible
  pages are rendered, and pages scrolled out of view are released again –
  with a five-page score, 1–2 pages are in the DOM during operation instead of
  all five. The DOM load therefore does not grow with the length of the score.
- **Interaction:** 30 zoom changes in 485–493 ms (~16 ms per change) at
  ~5500–6400 nodes. Smooth on desktop hardware.
- **Sidecar queue:** at most `SCOREVIEW_MAX_QUEUED` (default 30) jobs wait;
  beyond that it answers 503 with `Retry-After`, and the app tries again later
  instead of marking the score as failed. Derived from the 300 s deadline at
  about 10 s per job. A waiting job expires after
  `SCOREVIEW_PENDING_MAX_AGE_SECONDS` (default 3600 s).
- **Upload limit** (`SCOREVIEW_MAX_UPLOAD_BYTES`, default 200 MB) lies far
  beyond real scores (largest test file: 566 KB) and only protects against
  pathological uploads. The app rejects earlier: `max_score_bytes`, default
  100 MB, on both paths.

- **Under Node, the converter runs with `--liftoff-only`.** Without it,
  Node optimises the engine's 9.5 MB WebAssembly module in the background and
  waits for that work when the process ends: measured with Node 20.19, a
  conversion whose actual work was done after 3.5 s took 23–29 s in total;
  with the flag 3.2–4.0 s on scores of one to five pages. Deno does not wait
  (4.3 s either way) and runs without it.

**The server measurement series comes from 1–5-page scores.** Everything
beyond that is extrapolation.

### Conversion in the browser

The same engine in the browser instead of in Node
([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall) (German)), measured
on the same machine in a headless Chromium:

| Score | Pages | `.mscz` | in the browser | of which engine start |
|---|---|---|---|---|
| Mini score | 1 | 30 KB | **0.4 s** | 0.36 s |
| Choral piece | 5 | 98 KB | **0.7 s** | 0.57 s |
| Choral piece | 28 | 185 KB | **1.0 s** | 0.74 s |
| Choral piece | 4 | 566 KB | **0.4 s** | 0.34 s |

On the same machine the browser is therefore no slower than the Node path. On
top of that comes a one-time download of the engine: 14 MB raw, about
**7.3 MB over the wire** – the Wasm is transferred compressed (9.0 → 2.6 MB),
the resource package is not (4.7 MB). The glue code goes over the wire compressed,
at 48 KB.

The artifacts are the same: `timing.json`, `measures.json` and `meta.json` are
byte-for-byte identical to `node convert.mjs` for the same score, and the SVG
page has the same length (measured on the mini score).

### Isolation of the local converter

What a conversion on path A can reach besides the score and its output
directory
([S11](architecture.md#s11-der-lokale-konverter-sieht-nur-die-partitur-und-sein-ergebnis) (German)).
Measured on Linux with a probe that tries each of these, using the flags the
app sets:

| | Node 18 | Node 20.7–24 | Node 25, 26 | Deno 2 |
|---|---|---|---|---|
| Other files, read or write | possible | blocked | blocked | blocked |
| Start processes | possible | blocked | blocked | blocked |
| Network | possible | **possible** | blocked | blocked |
| Environment variables | readable¹ | readable¹ | readable¹ | blocked |
| Level in the diagnostics | none | partial | full | full |

¹ The app starts the converter with a minimal environment (`PATH`, `LANG`)
instead of the web server's, so there is nothing to read.

- **Node 20.0–20.6** honour only the last of several `--allow-fs-read`
  flags; the converter could not read its own directory and the score at
  the same time. They run without isolation, like Node 18.
- **The engine needs none of the blocked capabilities** – no workers, no
  processes, no network – also measured with a 4-page, 58-measure score.
- **Duration is unchanged:** the self-test takes 0.7–0.8 s under Node and
  Deno alike.
- **Under Deno, no granted path may contain a comma.** Deno splits grants at
  commas and has no way to escape one. Such a run is refused with the path
  named, instead of granting more or running without isolation. Affected in
  practice: an app or temp directory path, or `cjk_font_dir`, with a comma
  in it.

## Known gaps

**D.C./D.S./coda jumps.** MuseScore's `--score-media` does not unroll them into
additional timing events – checked with hand-written MusicXML as input, see
[M7](architecture.md#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht) (German).
Whether a jump/marker structure created in the MuseScore GUI is unrolled has
not been checked. Effect when it fails: the cursor stops at a jump instead of
jumping along; the rest of the score remains navigable as normal. Regular
repeats and voltas were measured to work correctly.

**Large scores.** Orchestral scores have not been measured. The server
measurement series above comes from choral pieces of up to five pages; in the
browser, a 28-page choral piece was measured as well.

**More than 16 MIDI channels.** MuseScore gives every sound of an instrument a
channel of its own – strings three, chord symbols one more – and numbers the
channels past the 16th again from 0 on a further MIDI port. Playback follows
the port, the mixer does not: it knows a part's channels without their port.
A part on a further port can therefore lack its mixer row, or its slider can
act on a part of the first port. Not measured – no score with more than 16
channels has been tried yet; a wind band or orchestral score is the test.

**Metronome and time signature.** With the engine's time signature per
measure (`measureFacts`, local path and browser fallback since
`v4.7.5-engine.5`) the metronome clicks the conducted beats: 6/8 and 9/8 in
dotted quarters with three subdivisions, a pickup with as many beats as fit
its length, counted as the signature would. Without it – the sidecar
converting with MuseScore itself, a conversion from before 1.17 – the beats come from the MIDI's time signature
events, which MuseScore writes per change but with a pickup as a signature of
its own length, and where even those are missing, from the measure's length
and the quarter-note tempo. The count-in always counts beats, not
subdivisions.

**Operation at phone width.** That the viewer runs in the mobile apps at all
has been measured (see below). At phone width the control bar is a single row –
play, measure field, starting note, lock and “Tools”, with everything else in
the overflow menu – checked in a Chromium at 360 × 780 px, not on a device. The
mixer, notes and the setlist editor are usable there, but not comfortable. For
reading on a phone there are the system band and the lyrics view; their limits
are listed under
[Practising and reading on a phone](#practising-and-reading-on-a-phone).

**The WebView of the mobile apps.** Measured on a Samsung Galaxy S23 with the
Nextcloud Android app, instance via `adb reverse` as `http://localhost:8134`:
AudioWorklet and WebAssembly run, the sound is audible, `navigator.wakeLock` is
granted. What is switched off there is the **Fullscreen API**
(`document.fullscreenEnabled === false`): the app's WebView does not implement
`onShowCustomView`, and without it no page can go fullscreen – checked in the
source of the Nextcloud Android app 35.0.1, where the other Direct Editing
editors (Text, Collabora, ONLYOFFICE, Whiteboard) have no fullscreen either.
The fullscreen button therefore switches to fullscreen *inside the page*
there: the score gets the whole view and the control bar retracts during
playback, also upright. Android's status and navigation bars stay; only the app
could hide them. Other devices, other Android versions and
the iOS app have not been checked; the bridge is written for both platforms but
only verified on Android.

Important for any repetition of this measurement: it needs a **secure
context**. Over a plain `http://<LAN-IP>:8134`, `navigator.wakeLock` and
`audioWorklet` are simply missing – the measurement then comes out negative
without saying anything about the WebView (cross-checked in Chromium).

**The browser fallback via the mobile apps.** It works there (measured) and, as
on the desktop, costs about 7.3 MB of download once per engine version (14 MB
unpacked) – that is a lot on a mobile connection. Where the server can convert,
this case does not occur.

**Conversion in the browser on real devices.** All figures for it come from a
desktop Chromium. How long a tablet or phone takes, and at which score size the
tab dies of memory exhaustion, is **unchecked** – the Wasm heap lives in the
Web Worker and cannot be measured from the page. The default value of
`client_max_score_bytes` (10 MB) depends on this and is an estimate until then.
In Node, about 105 MB of heap was measured over five runs; in practice, mobile
browsers kill tabs earlier than a desktop does.

**Sound quality.** The browser mixdown is about 7 dB below MuseScore's own
render; the part separation is correct. A blanket gain factor is deliberately
not built in (risk of clipping in loud passages). A practice track, by
contrast, is normalised to −1 dBFS peak after rendering (at most +12 dB) –
there the whole piece is known in advance. The difference stems mainly from
the choice of SoundFont and missing master effects. Anyone who needs better
sound can provide their own SoundFont – see
[Installation](installation.md#soundfont).

**The local conversion path under load.** It was measured on a single machine
with one score after another. How several simultaneous conversions behave has
not been checked: each run is a separate process needing about 130–250 MB of
memory, and unlike with the sidecar, nothing limits their number (there, a
semaphore does). On a small server a bulk pre-conversion (`eager_conversion`)
can therefore become noticeable.

**The MuseScore version of the local path depends on a dedicated build.**
[AndiMb/scoreview-engine](https://github.com/AndiMb/scoreview-engine) carries
4.7.6 (MuseScore as a pinned, unpatched submodule revision, Qt-free); it does
not follow along by itself when MuseScore moves on – a new core means building
the engine and bumping the tarball URL. The self-test in the status
diagnostics checks whether the guarantees from M2/M4/M7 still hold – it does
not report that a newer MuseScore version would be available.

**Old scores get a substitute music font locally.** Files from MuseScore 1 to
3 are governed by the style defaults of their time, and those name Emmentaler
or MScore Text as the music font. The local path does not ship these – it
carries Bravura and Leland, and every additional font would enlarge the
distribution package. Drawing is therefore done with Bravura. Only the glyph
shapes are affected: the style value remains “Emmentaler”, so the engraving
rules tied to it apply just as in MuseScore – page breaks and spacing are
correct. The sidecar has the original font when it converts with MuseScore
itself; with the engine it draws like the local path.

**Two image formats are shown only by MuseScore itself on the sidecar.** Both
paths place images embedded in the score into the notation. The engine – on
the local path and on the sidecar alike – passes them through
unchanged into the SVG and supports PNG, JPEG, GIF and BMP for this – the four
formats a browser displays by itself. The other two that MuseScore accepts
stay blank there: an SVG as an image (the Qt-free engine would need its own
SVG renderer for that) and TIFF (which no browser decodes). MuseScore itself
rasterises an SVG image along with the page; what it does with TIFF depends on
the image plugins of its AppImage and has not been checked. Effect: with the
engine a gap remains at that spot; the rest of the page is unaffected. A
sidecar can be switched to MuseScore for such scores – for all of them,
though, not per score.

**No note-head highlighting when the sidecar converts with MuseScore
itself.** The sounding note head is only coloured where the SVG carries the
identifiers from
[M10](architecture.md#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg)
– the engine writes them, on the local path and on the sidecar; stock
MuseScore does not. There it falls back to the band, without an error message: the setting
“Colour the sounding notes” can still be selected but silently falls back to
the band. Effect: the same controls, less guidance in the notation. The same
applies to the coloured note heads of intonation (see
[Microphone, recording and intonation](#microphone-recording-and-intonation)).

**The converter version is not recorded.** The viewer names the conversion
*path* of every rendering, but not which MuseScore or engine version ran: the
sidecar reports its version only in the job-independent `/health`, and the
only version field in `meta.json` (`mscoreVersion`) is that of the score, not
of the converter. Effect: a difference in engraving can be traced to the path,
not to a version number.

**Tablet and phone hardware.** Touch controls, pinch zoom and keeping the
screen awake are implemented and verified in the browser. Three things
that stay invisible on the desktop have been tried on an Android phone (Chrome
and Opera, sound via Bluetooth headphones):

- The output latency (Bluetooth) is compensated; the cursor does not run ahead
  of the sound.
- Autoscroll recognises manual scrolling by the gesture; the browser bar
  sliding in and out does not count as an intervention.
- The transport bar stays a single row at phone width.

**Measured output latency**, read from the diagnostics under “Info and
diagnostics”:

| Device | Output | Compensated |
|---|---|---|
| Android phone | Bluetooth headphones | **232 ms** |
| Workstation | built-in | **51 ms** |

Both values come from the **automatic setting**, with the slider untouched.
This establishes that **Chrome on Android reports the Bluetooth share of the
output latency**, and the app accounts for it without any intervention.
Picture and sound match on both devices.

The slider “Sync picture and sound” remains for the case where a pair of
headphones does not report its own delay – then the automatic setting lacks
exactly that share, and it cannot be read off anywhere except by one's own
ear. **How many headphones this affects has not been checked**; a single pair
was measured on a single phone.

Still untested is **a whole rehearsal at the music stand**, and the effect has
only been cross-checked in Chrome – **whether autoscroll runs just as
smoothly in Opera has not been checked.**

**Offline use only via the offline page.** The viewer in Files does not load
without a network; without a network, only what was saved beforehand works,
and only via the offline page ([Offline](#offline)).

## Rehearsal and concert features

### “Follow me”

Measured on the test instance (Docker Desktop, 12 vCPU, SQLite in WAL mode,
Apache prefork), without `notify_push`, polling interval 800 ms:

| Measurement | Result |
|---|---|
| Leader's tap → jump on the following device (browser, three following devices) | p50 **595 ms**, p95 **945 ms** |
| Two taps by the leader on different rehearsal marks, 11–65 ms or 74–263 ms apart (20× each, three following devices) | Leader, server and all following devices **20/20** on the second; the first never arrived last |
| Load: 40 devices against the real endpoint, leader writes every 3 s | p95 end-to-end **771 ms**, 0 errors, 0 “database is locked”, **2.0–2.8 cores** |
| CPU per poll | about **50 ms**, almost all of it for starting Nextcloud; file and cache access are a small part |

For operation this means:

- **Without push, a follow session costs about 50 ms of CPU per device and
  poll**, so with 40 devices 2–3 cores for the duration of the rehearsal. On a
  small server (2–4 cores) that is too much; the status diagnostics
  recommend `notify_push` from 20 devices. A larger `follow_poll_ms` lowers the
  load linearly and delays the jumps correspondingly.
- **Over real Wi-Fi, the round-trip time comes on top.** The figures above
  come from a network without a radio link; a realistic p95 is just over one
  second. Individual outliers of 2–4 s occurred in the load measurement about
  every 2–3 minutes (cause unclear, probably Docker/WSL or Apache prefork).
- **With `notify_push`**, each device fetches the state only when it changes.
  This path is **only checked by unit tests** – the test instance has no
  `notify_push`. A latency measurement with it is still pending.
- **The mobile apps always poll.** `notify_push` registers via a session,
  which the Direct Editing page does not have.
- **Without a running session**, a device asks every 15 s whether one has
  started, for two minutes after it was opened, became visible or was
  touched, and every 60 s after that. Anyone who opens the viewer well before
  the leader and does not touch it thus follows only after up to 60 s; a tap
  on the screen makes it ask quickly again. In a background tab it does not
  ask at all and catches up immediately on returning. Push does not shorten
  this: the server only pushes to devices that joined a running session.
- **The leader's own device and a detached device poll slowly** (every 5 s
  and every 15 s): the leader learns the state from the answers to its own
  changes, a detached device only has to notice the end of the session.
- **Following playback** tracks the leader's playback with the polling
  interval as the delay for start, stop and jumps; in between, each device
  calculates by itself. Measured on the desktop with one following device:
  after 8 s of playback, the same second and the same measure as the leader;
  in the Nextcloud app on the Galaxy S23 it follows along just the same,
  without sound. An error of around half the response time remains (the
  server time is estimated from the response).
- **Starting, ending and joining are each limited to 30 calls per minute**,
  sending the position to 120. Mobile apps are counted per IP address (see
  Leaders below).
- **Several web servers without a distributed cache:** the local cache is then
  valid for at most one second, after which the next call reads the
  database – one read per second and file (see
  [E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht) (German)).
- **Switching to the next piece takes about 3 s, measured**, until it reaches
  the following device, including loading the new score (two browsers on the
  test instance, desktop). With a following device in the Nextcloud app the
  switch has passed acceptance testing (Galaxy S23), the duration there not measured.
- **Only the leader who is leading the session takes it along.** If someone
  else is already leading on the next piece, that session stays; the leader
  switches alone, and their followers stay where they are.
- **The session only goes along to a piece of the same owner** if the leader
  holds no leader role there. A piece from another account, or one in a group
  folder, needs the leader role on that piece itself; otherwise the leader
  switches alone and sees an error message. Without this rule, anyone could
  take over a shared score's followers through a score of their own.
- **On a piece the session was taken along to, the leader lacks the role** if
  they are not a leader there: position, loop, starting note and
  transposition work, notes for voices and stamps do not
  ([E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
- **Anyone not allowed to read the next piece sees an error message there.**
  This cannot be checked in advance from the leader's side – the leader cannot
  see the others' permissions.
- **A transposition by the leader applies to all followers** and is not saved
  for them; anyone who transposes themselves stops following.

### Leaders

- **A leader by virtue of write permission does not appear in the list of
  leaders** (files without an owner, e.g. in group folders). They still have
  the role; the list shows the owner and the appointed leaders.
- **The search for people to appoint is limited to 30 calls per minute.**
  For Nextcloud's rate limiting, requests from the mobile apps are anonymous
  and are counted per IP address – a whole choir behind a NAT shares this
  quota. Only leaders search anyway.

### Notes

- **At most 500 notes per person and score**, all visibilities, stamps and
  saved loops together; beyond that the server answers 409. Two simultaneous
  requests can exceed the limit by one note.
- **A saved loop is a note with an end measure.** It survives a re-upload
  like a note does; once its end lies beyond the score it is shown as
  orphaned and cannot be set. Loops for voices behave like notes for voices:
  dimmed without a chosen part, hidden for the other parts. Setting a saved
  loop works on the offline page, saving one does not.
- **“Show only the loop” dims, it does not rewrap.** The pages veil the
  measures outside the loop, the system band shows only the systems the loop
  touches, the lyrics view dims the other blocks (E2: no reflow). The switch
  is a session choice and ends with the loop.
- **Creating and changing are each limited to 60 calls per minute** – anyone
  setting stamps very quickly in a row briefly gets “Too many changes in a
  short time”.
- **A drawing is a few marks, not a picture:** at most 40 strokes and 800
  points after smoothing, each point within 400 staff spaces of where the
  drawing began. It counts as one note, and is changed by deleting it and
  drawing again.
- **A drawing belongs to the staff it began on.** Where staves and parts
  cannot be matched, it belongs to the system instead; then it stays where it
  was drawn in the full score, but lands above the wrong staff in a part
  shown on its own. A drawing on a part's staff is not shown in another
  part's edition. Strokes that begin beside every measure are not saved.
- **Drawing happens on the pages.** Starting it from the system band or the
  lyrics view switches to pages; the drawings show in the band all the same.

### Setlist

- **Limits:** at most 256 KB and 200 entries per setlist. From within a score,
  the viewer only searches the folder of that score and takes at most 20
  setlists. The selection around the score for the editor reaches down to
  depth 2, with at most 200 hits and 100 visited folders.
- **Raw paths are not %-decoded** – only link targets. Anyone writing `%20` in
  a raw path literally means `%20`.
- **A non-indented line directly after an entry ends the list.** A deliberate
  deviation from CommonMark
  ([E11](architecture.md#e11-die-setliste-als-markdown-datei) (German)); anyone who
  wants to keep writing below it leaves a blank line or indents.
- **Absolute paths apply in the tree of the respective reader.** In a shared
  list, `/Chor/Kyrie.mscz` points, for everyone who reads it, to their own
  file of that name – or to none. Relative paths are therefore the better
  choice for shared lists.
- **Nextcloud's viewer keeps showing the original file name** in its header
  after a piece switch, if the setlist was opened from within a score. The
  setlist bar names the correct piece.
- **There is no pedal or key for “Next piece”.** Pedals turn pages within a
  piece; switching goes via the setlist bar.
- **On mobile only via a score.** For `*.setlist.md` the apps offer Text, not
  ScoreView; a setlist opens there via one of its scores. On mobile, the editor
  can only add pieces from the folder of the open score, and via a piece from
  the list (companion token) only reorder and remove – Nextcloud's file picker
  needs a session.

### Microphone, recording and intonation

**Measured offset of a recording**, in Chromium with a file as the
microphone, after compensating both latencies:

| against | Offset |
|---|---|
| the cursor | **+42 … +52 ms** (the recording is later) |
| the accompaniment | **−22 … 0 ms** |

spessasynth only corrects a deviation of its own time from 50 ms upwards;
below that it remains, and this affects the cursor as well. This has not been
re-measured on real devices and with real input latency.

- **The attack has not been measured.** Intonation discards the first
  **100 ms** of each note (`skipAttackMs`); whether that is enough for amateur
  voices is still open.
- **The onset is where the syllable begins**, and it is judged only where
  one can be heard: after silence or after a change of pitch. After silence
  it is where the level rose, a consonant included; after another note it is
  where the voice left that note, a glide included. A note tied to the same
  pitch has no onset of its own and is “not evaluable”; the end of a note
  (“too short”) is judged only before a rest, never “too long”. Judged from
  the stable pitch instead, a real voice read some 40 ms late, because the
  pitch settles only after the syllable has begun. Measured with synthetic
  tones, the detected onset lies −2 … +8 ms from the real one after silence
  and +7 … +17 ms after a change of pitch; 3 and 10 ms are subtracted. An
  onset is green up to **60 ms** early or late – never less than 55 ms, so
  that the offset against the cursor alone cannot make a note yellow – and
  yellow up to 120 ms. A long voiceless consonant placed well before the beat
  counts as early.
- **Measured with a real voice** (bass, desktop with headphones, accompaniment
  at full tempo, 79 s): 128 of 129 judged onsets were green, median +1 ms (10 %
  earlier than −26 ms, 10 % later than +27 ms); 38 notes had no onset to
  judge. On the same machine the recording lagged the score by **+5 ms**,
  measured with the metronome through the loudspeaker.
- **Misplaced onsets, simulated on that take**: whole phrases of the
  recording moved inside their rests, every third one left as it was. Moved
  150 ms early, 82 % of the notes were flagged (every phrase start); moved
  150 ms late, 62 % (13 of 17 phrase starts); moved 80 ms, 85 % and 72 %,
  the rest just inside green. The untouched phrases stayed green, and every
  final note cut short by 60 % was flagged. A note sung later than its own
  length minus some 100 ms is **not evaluable**, not late: the voice is then
  already in the next note's time, and pitch alone does not tell which note
  it is. In that piece (detached crotchets at ♩ = 180, about 316 ms) this applies
  from about 250 ms late.
- **Slower tempo, checked with the app's own playback as the microphone**
  (desktop, the bass part solo, fed back inside the browser, 40 s of score;
  piano and bassoon sound): at 100 %, 70 % and 50 % tempo the median onset
  stayed within 2 ms (−55 … −57 ms with piano, the output latency the app
  subtracts and a loop-back does not have) and did not drift from the first
  half to the second. The conversion between real time and score time holds;
  how a voice places its onsets at a slower tempo is a different question.
  **Not yet checked**: a singer missing on purpose, other voices, a voice at a
  slower tempo, phones.
- **Wait mode is for learning notes, not rhythm.** Playback stops 30 ms
  before each note of your part that lasts at least 200 ms and goes on once
  the microphone has heard the note for 60 ms (±50 cents, any octave).
  Measured in Chromium with a file as the microphone: the stop came 6 … 10 ms
  after its planned moment, never after the onset, and playback went on
  89 ms after the first matching frame; it never went on with a wrong note.
  While waiting, the accompaniment that was playing is held. When playback
  goes on, those notes are struck again – a short new attack, not a seamless
  continuation. Your own part is silent for the whole mode; a change to its
  volume in the mixer meanwhile is undone when the mode ends. **Not yet
  checked with a real voice, nor on a phone.**
- **The reference pitch a' is one setting per user, 420–460 Hz in whole Hz**
  (default 440, set in the tuner). It applies to the tuner, intonation, wait
  mode, the playback with its start tone, and the MP3 export. Measured in
  Chromium: at 442 the playback sounded 7.89 cents higher than at 440
  (expected 7.85), and the tuner read the same deviation in cents at both. A
  recording keeps the reference it was sung against. Baroque pitch at 415 Hz
  lies outside the range; it is a semitone down (Transpose −1) at 440. A
  choir that sinks as a whole is still judged against the setting, not
  against itself.
- **The tuner shows one voice.** It uses the same analysis as intonation
  (median over 120 ms, refreshed at most 12 times per second); a signal
  without a clear pitch – two voices, breath, a chord – shows nothing rather
  than a guess, and the reading clears after 300 ms of silence. The note is
  spelled for the key at the current position the way MuseScore would spell
  it (in F major B♭, in G major F♯). Checked with synthetic signals, not yet
  with a real voice on a phone ([Open checks](#open-checks)). Not available in
  the Android app, like everything that needs the microphone.
- **Octaves are folded.** A tenor singing the alto part an octave lower sings
  it correctly; an octave off therefore goes unnoticed.
- **Coloured note heads only where the engine converts** (locally, on the
  sidecar with the engine, in the browser), and only where
  each part has its own staff. A head shows the worst of pitch, onset and
  end; the list says which it was. Otherwise it stays, without an error message,
  with the needle and the list of problem spots
  ([M10](architecture.md#m10-die-engine-schreibt-segment-notenzeile-und-stimme-ins-svg) (German)).
- **With repeats, the colouring shows the most recently evaluated pass.** The
  same note head stands for both passes
  ([M7](architecture.md#m7-wiederholungen-rollen-sich-aus-dcdscoda-nicht)).
- **The accompaniment takes the recording's tempo when playback of the
  recording starts** – a recording cannot be stretched. A later change of tempo
  while the recording is played back is not tracked.
- **Uploads need a web server limit of at least ~20 MB** (with nginx,
  `client_max_body_size`). A 10 min recording weighs about 19 MB; below that,
  saving fails with 413 from the web server before the app sees the request
  ([Installation](installation.md#upload-size-for-recordings)).
- **An upload takes up space in the temporary directory, not in
  `memory_limit`.** From 2 MB, the body goes into a temporary file
  (`php://temp`), only the header is checked, and IAppData writes from the
  stream. For the largest permitted recording (`max_recording_seconds` = 3600,
  about 115 MB), the temporary directory thus needs that much space per
  simultaneous upload; anything above that is rejected by the app with 413
  before it accepts it.
- **The per-score maximum holds even with simultaneous uploads, the storage
  limits only approximately.** After inserting, the app counts again: with a
  confirmed replacement, the next-oldest goes; without one, the upload that
  arrived later withdraws its recording (with exactly simultaneous ones it can
  be both). A simultaneous upload can exceed the per-person and instance
  storage limits by at most its own size.
- **A microphone permission within Files applies to all scripts there**, as
  with Talk. The app only enables the microphone on pages under
  `/apps/files`; a policy cannot be set more finely than per document.
- **Unsaved recordings do not survive a page reload.** If saving fails, the
  recording stays in memory and can be saved again – until the page is
  reloaded. The interface says so.

### Score facts and stamps

- **With MuseScore itself on the sidecar, no major/minor for the key note.** Stock MuseScore
  writes no key signatures into `meta.json`, and in the MIDI the minor byte is
  always 0
  ([M11](architecture.md#m11-was-midi-und-svg-über-studierbuchstaben-und-tonarten-tragen) (German)).
  The starting note “Key note” there plays the major tonic of the key
  signature – in C minor, E♭ instead of C. Rehearsal marks come through on both
  paths.
- **Multimeasure rests:** the engine's measure count then differs from the
  viewer's. In that case the viewer takes rehearsal marks and key signatures
  from the MIDI and adopts the mode from the engine only where it is
  unambiguous
  ([E12](architecture.md#e12-partiturfakten-aus-der-engine-mit-midi-rückfall)).
- **Part stamps sit above the system when staves and parts cannot be
  matched** – for instance six parts on five staves. The stamp is then there,
  but not at the staff of its part.
- **With MuseScore itself on the sidecar, no lyrics view and no note names.**
  Both need lists that only the engine writes; see [Views](#views).

### Practice log

- **Counted is what sounds:** playback of the score or a running recording,
  per person, score and local calendar day. Practising with the tuner or
  from a practice track outside the viewer does not count.
- **Only the person sees their time** – also leaders and admins see nothing
  of it in the app; there is no ranking. The weekly goal of a score is the
  same for everyone and set by its leaders (5–1200 minutes).
- **Bounds:** a device reports at most 300 seconds at a time, at most a day
  per day, and only for a day within one day of the server's date. A device
  that is offline loses what it counted while the page was closed; a hidden
  tab still reports when it is hidden.
- **Kept for 400 days**, then removed by the daily cleanup; the panel shows
  this week, last week and the days in a row. Deleting an account deletes its
  log; a goal stays when its leader's account goes.

### Recordings shared with voices

- **Only leaders share, and only their own recordings.** Taking a sharing
  back works always, also after losing the role; deleting stays with the
  person who recorded. The recording keeps counting against that person's
  storage limits.
- **Shared means: everyone with access to the file can fetch it.** Which
  parts see it is decided in the browser, like notes for voices – someone
  without a chosen part sees it dimmed, with the name of the part.

### Mobile

- **No microphone in the Android app.** Its WebView does not grant it (source
  code: no `RECORD_AUDIO`, no `onPermissionRequest`), and ScoreView cannot
  change that. Recording and intonation work there via “Open in browser”. For
  the iOS app, the source code suggests that it works with a system prompt
  every time it is opened; this has not been measured.
- **“Open in browser” has not been checked on Android or iOS devices**, nor
  whether a pedal gets focus in the WebView.
- **A change of the companion secret takes effect after up to 3 s**, as long
  as the server still reads the old value from APCu.
- **A phone in landscape keeps only part of its height for the score.** Where
  the control bar takes 15 % or more of the viewer's height, it retracts to a
  thin progress line during playback, in performance mode and while following
  a leader, as it does in fullscreen; a tap on the line brings it back. What
  stays is not ScoreView's: Safari's own bars (a web page cannot go fullscreen
  on the iPhone, and Safari only shrinks its bars when the page itself
  scrolls) and Nextcloud's viewer, which keeps 50 px for its header with the
  file name and ✕ and another 50 px below the score. Measured in Files in a
  Chromium emulating a phone in landscape (844 × 340 px, that is after about
  50 px of Safari bars): the viewer gets 240 px, the standing bar takes 59 of
  them, and retracted to its 8 px line the score's area grows from 132 to
  183 px. On an iPhone this has not been measured
  ([Troubleshooting](troubleshooting.md#on-a-phone-in-landscape-the-score-gets-little-height)).
  The fullscreen button, where the browser offers no fullscreen as on the
  iPhone, switches to fullscreen inside the page: the viewer then also covers
  Nextcloud's header and footer, and the bar retracts upright as well.
  Checked in a Chromium with the Fullscreen API switched off (390 × 700 px:
  the viewer grows from 600 to 700 px); not on an iPhone.

### Open checks

Implemented and checked in the browser, but **not on a device**:

- all device tests of the mobile apps for setlists, leading, following and the
  microphone (Android via `adb reverse`, see above; an iOS device is missing
  entirely);
- keeping the screen awake in performance mode and while following – without a
  window, only checked against a mocked `navigator.wakeLock`;
- a whole rehearsal with real voices, real Wi-Fi and `notify_push`;
- the device acceptance of the practising and reading features on the
  Galaxy S23, see [Open on the device](#open-on-the-device);
- the tuner with a real voice on the Galaxy S23, and the metronome
  subdivisions over Bluetooth;
- beat numbers and the loop focus on the Galaxy S23 at page width, and the
  style cost of the beat numbers during playback (they are SVG text, so none
  is expected, but it is not measured);
- printing from Safari on iPadOS (“Share → Print”): whether the dialog takes
  the page size from the score and ends without an empty last sheet.

## Practising and reading on a phone

### Practice tracks

| Measurement | Result |
|---|---|
| Export in the app, desktop Chromium: choral piece with 5 parts | 76 s of music in **7 s**, 1.24 MB |
| Test setup with the same core (spessasynth in the worker, lamejs, 128 kbit/s), desktop | 76 s in 6.7 s · 191 s in 14.2 s (3.08 MB) |
| the same test setup, Galaxy S23, Chrome | 76 s in 8.3 s · 191 s in **15.9 s**, of which 11.8 s encoding |

- **Encoding costs about three times as much as rendering.** On the S23 the
  export takes 10–25 % longer than on the desktop. A mid-range device has not
  been measured; the target "4 min of music in at most 60 s" is met on the S23
  by a wide margin.
- **About 1 MB per minute of music** (128 kbit/s stereo). The limit
  `practice_track_max_mb` (default 60 MB) is therefore enough for an hour. The
  web server in front of Nextcloud must accept requests of that size
  ([Installation](installation.md#practice-tracks-and-offline-page)).
- **A track counts against the quota of the folder owner** – for a shared
  folder, that of the person it belongs to. The app has no limit of its own for
  this and does not clean up tracks.
- **Tracks for all parts replace without asking** whatever lies under the same
  name in the “Practice tracks” subfolder; a single track asks first.
- **The name of the subfolder follows the instance's default language.** If it
  changes, a second folder is created the next time.
- **On mobile only next to the score.** With the app's token there is no
  freely chosen folder (no file picker without a session), and from a piece of
  a setlist (companion token) no export at all.

### Lock screen

Measured on the Galaxy S23: playback **continues while the screen is locked**,
in Chrome (locked for about 10 s, without gaps) and in the Nextcloud app (by
hand). **Lock-screen controls do not appear for Web Audio**, not even via an
`<audio>` with a `MediaStream`, and the headphone button has no effect. The
app cannot change this; the way out is the practice track, which any player
plays with controls. A lock lasting several minutes has not been measured.

### Views

- **Lyrics view and note names only with the engine's data.** They need
  `lyricSyllables` or `noteSpellings`, and only the engine writes those – on
  the local conversion path, on the sidecar with the engine and in the
  browser fallback. With MuseScore itself on the sidecar neither can be
  selected, and both say why; a reconversion there does not change
  that ([E15](architecture.md#e15-fähigkeiten-statt-weg) (German)). The system band
  works on both paths.
- **A cache entry below `CURRENT_FORMAT_VERSION` 5** is reconverted the next
  time it is opened and gets the lists in the process.
- **Beat numbers need the engine as well**: the time signature per measure
  and a tick per chord (`measureFacts`, `noteSpellings[].tick`). With
  MuseScore itself on the sidecar the setting says why it is unavailable. The numbers follow
  one voice (the first) and sit in a row above the staff: “1 2 3 4” on the
  beats, “+” on the halves between them in simple metres, every eighth
  numbered in compound metres; triplets, sixteenths and anything else off
  that grid stay blank rather than wrong. A pickup is counted from its end.
  Readability on a phone at page width has not been checked
  ([Open checks](#open-checks)).
- **Above 20,000 syllables there is no lyrics view** – the engine then omits
  the list entirely instead of truncating it.
- **The verse sung follows the unrolled repeats:** the n-th occurrence of a
  passage sings verse n. Where a score distributes verses across jumps that are
  not unrolled (D.C./D.S., see [Known gaps](#known-gaps)), the wrong verse
  lights up.
- **Style cost of the notation:** each page SVG sits in a document of its
  own (a frame without a source), out of reach of Nextcloud's ~1,900 global
  selectors, and on a compositor layer of its own. Measured with four pages
  of a choral piece (14,100 SVG nodes): a change in the toolbar restyles
  about 650–930 elements instead of 17,300. In a phone-sized window at 4×
  CPU throttling, opening the Tools menu takes 240–420 ms (with the notation
  in a shadow root: 580–1,080 ms), closing it about 200 ms (500–550 ms).
  During playback the main thread is busy about 110 ms per second on the
  desktop and 300–320 ms in the phone-sized window (pages 430, band 480 ms
  before). Pinch zoom shows a scaled preview while the fingers move and lays
  the pages out once, when they let go. On a Galaxy S23 (Chrome, power
  saving mode on) a pinch runs at 50 fps on the pages and 39 fps in the
  system band (with the layout per frame: 37 and 27 fps).
- **System band:** measured on a choral piece with 10 systems, scrolling at
  about 60 fps on the desktop. On the Galaxy S23 (Chrome, without power saving
  mode) during playback: pages 49 fps (10 % of frames over 33 ms), system band
  33 fps (p95 67 ms). In Files, **every change of a `style` attribute and
  every replacement of child nodes** costs a style recalculation over about
  7000 elements (Nextcloud's `:has()` rules, including some with
  `[style*=…]`, on `body` and on the viewer; measured ~70 ms per change on the
  desktop). What moves during playback avoids both: the cursor and progress
  line are SVG rectangles, the time display only changes its text node
  (`directives/nodeText.js`), and the position slider moves in 250 ms steps.
  On the desktop this leaves 19 ms of style time per 4 s of playback. The band
  remains more expensive than the page view: it colours the sounding notes in
  three loaded page SVGs (on the S23 about 1.5 s of style time per 15 s). In
  power saving mode the phone throttles even an empty page to 24 fps.
  The boundaries of the systems come from the staff lines, with a limited
  margin above and below – anything reaching far beyond that may be cut off.
- **Two pages side by side** only in the page view and only from a page area
  of 900 px width – measured on the area, not the device: a phone in
  landscape stays single, a narrow desktop window too. The setting
  (off, page 1 on the left, page 1 on the right) says what happens above
  that width; below it, the setting names the reason. Zooming in beyond
  the pair scrolls sideways, the row does not fold into one column.
  Paging goes row by row; a row taller than the view is paged by systems.
- **Note names sit to the left of the note head** where there is room;
  otherwise below, above or to the right of it (`lib/noteLabelLayout.js`).
  Obstacles are accidentals, repeat dots, stems, dots, rests, lyrics and
  neighbouring note heads; slurs, beams and ledger lines are not. The width of
  a name is estimated, not measured. At page width on a phone (note heads
  about 4 px) they stay at 9 px and crowd together – they only become legible
  with zoom, at a system height of about 16 px.
- **“Only my part” for note names** only takes effect where staves can be
  matched to parts; otherwise names appear on all staves.
- **If the number of note heads in a segment does not match the list**, that
  segment stays without names and without sound on tapping, rather than
  showing wrong ones.

### Printing

The print page holds every page of a score at once and leaves the rest to the
browser's print dialog
([E16](architecture.md#e16-drucken-aus-den-seiten-svgs) (German)). Measured in
a desktop Chromium:

| Score | Pages | SVG total | DOM nodes | Ready | PDF | PDF size | Memory of the tab |
|---|---|---|---|---|---|---|---|
| Choral piece | 4 | 0.8 MB | 9 900 | 0.7 s | 0.4 s | 0.9 MB, 4 pages, A4 | +60 MB |
| Choral piece | 28 | 3.2 MB | 33 000 | 0.5 s (artifacts cached) | 0.5 s | 0.8 MB, 28 pages | +150 MB |

The PDF keeps the notation as vector paths – no image objects were found in
either file. Derived: about 5 MB of memory per page; no page limit is set, a
100-page score should stay well under 1 GB.

- **Only in the browser, with a session.** The mobile apps print through
  “Open in browser”; the offline page has no print button – its service
  worker does not cover the print page.
- **Where the browser converts** ([Conversion in the browser](#conversion-in-the-browser)),
  the print page converts the score again: there is no cache on that path,
  and the engine download (about 7 MB) happens once per browser.
- **Page format from the score.** `@page` takes the size from `meta.json`;
  the sheet is as wide as the score's page, without browser margins. Chromium
  honours this. Whether Safari on iPadOS takes the page size from the page
  is **unchecked** ([Open checks](#open-checks)).
- **Nothing prints before every sheet has loaded**; the Print button stays
  locked until then.
- **Notes and stamps are off by default** and switch on per print; “Note
  names” follows the viewer setting, and “only my part” needs staves that
  map to parts, as in the viewer. The sheets are always light, whatever the
  note theme on screen.
- **What the viewer does not show on paper either:** the cursor, loop
  markers, the highlight of “my part”, intonation colours.

### PDF file

“Save as PDF in Files” on the print page writes the PDF in the browser and
puts it next to the score
([E16](architecture.md#e16-drucken-aus-den-seiten-svgs) (German)). Measured
in a desktop Chromium with the app's own writer:

| Score | Pages | Path | Writing | PDF size | Differing pixels against the SVG |
|---|---|---|---|---|---|
| Choral piece | 4 | engine / sidecar | 0.6 s / 0.6 s | 0.7 MB / 1.2 MB | at most 0.012 % per page |
| Choral piece | 28 | engine / sidecar | 0.9 s / 0.6 s | 0.7 MB / 2.0 MB | at most 0.004 % per page |
| Score with a PNG and a JPEG | 1 | engine / sidecar | 0.2 s / 0.1 s | 20 KB / 30 KB | 0.000 % |

Pixels were compared at 100 dpi with a tolerance of one pixel for
antialiasing. In the app, from the click to the file in Files (loading the
pages again, writing, uploading), it took 0.8–1.0 s for the 4 pages and
1.0–1.7 s for the 28 pages, on both paths.

- **The music only.** Notes, stamps, note names and beat numbers are not in
  the file; the print dialog carries them.
- **Vector, no embedded font:** text in the PDF cannot be selected or
  searched, as in the print dialog.
- **What is supported** is the SVG both conversion paths write: paths,
  polylines, polygons, glyphs, matrices, embedded images. Anything else
  (text, gradients, clip paths, arcs, transparency) is named on the print
  page and left out, not approximated.
- **Images:** JPEG as it is; PNG, GIF and BMP as RGB on white – a transparent
  image gets a white background.
- **Size per file** `pdf_max_mb` (default 50 MB, 5–500).
- **Without `CompressionStream`** (older browsers) the file is written
  uncompressed, about three times as large.
- **Only where files may be created** next to the score; the button is
  missing otherwise, and on the mobile apps' page (it has no print page).
- **A second save asks** whether to replace the file; nothing is overwritten
  silently.

### Search

Title, subtitle, composer and lyricist of a score are found by Nextcloud's
global search
([E17](architecture.md#e17-suche-über-die-konvertierungstabelle) (German)).

- **Only scores converted on the server.** A score converted in the browser
  ([Conversion in the browser](#conversion-in-the-browser)) has no entry and
  is found by its file name only, through Nextcloud's own file search.
- **Scores from before 1.18** are filled once by the update, from what their
  conversion already holds – no reconversion. A score without title and
  composer has nothing to find.
- **Access is checked on reading:** a hit outside the searcher's own files
  is left out without a trace; a score shared read-only is found.
- **A substring search, no full-text index.** Searched are the four fields
  above in lower case, at most 1024 bytes; no lyrics. For a choir instance
  with hundreds of scores this takes milliseconds; tens of thousands would
  want an index.
- **The icon of a hit** is the file icon Nextcloud has for `.mscz`; there is
  no preview image of a score.

### Offline

The pattern has been measured on the desktop and in the phone browser
(Galaxy S23, Chrome): the worker registers, controls the offline page, and
after disconnecting from the network the page comes from the cache.

| Measurement | Result |
|---|---|
| Storage the browser allocates | desktop 7.8 GB · S23 **10.7 GB**; 300 MB written in 1.3 s |
| `navigator.storage.persist()` | **denied** (desktop and S23) |
| Space | the SoundFont once for all entries (~23 MB, from the sidecar ~40 MB), plus each score's cache, see [Measured values](#measured-values) |

- **The browser may clear saved items.** Because `persist()` is denied, it can
  delete the cache when space runs short. The offline page detects this
  (“Removed by the browser – save it again”) and says so; before a concert,
  open the page once more with a network connection.
- **Logging out does not clear immediately in Chrome.** Nextcloud only sends
  `Clear-Site-Data` on logout over HTTPS and never to Chrome, not even to
  Chrome on Android; as measured, the cache and worker remain there after
  logging out. The app only clears when the offline page is next called
  **with a network connection** and redirected to the login
  ([S10](architecture.md#s10-vorgemerktes-gehört-einem-konto-und-verschwindet-mit-der-anmeldung) (German)).
  Until then the cached offline page, including saved items, remains
  **readable without a network** on that device, even after logging out –
  including the identifier (`uid`) of the person last logged in. A redirect to
  a captive portal or an SSO interstitial page deliberately does not clear.
  Consequence: one account per browser or device, and save nothing on shared
  devices.
- **One account per offline cache.** If another account saves something in the
  same browser or opens the offline page, the app deletes the previous
  account's entries along with all their URLs; the new account's own entries
  that shared any of them (such as the SoundFont) then count as damaged as
  well.
- **Only in the browser, not in the mobile apps.** The Direct Editing page has
  no path of its own for a worker; there is no saving for offline use there.
  Whether the Android app's WebView allows service workers at all has not been
  checked.
- **Open once with a network connection.** The offline page sets itself up on
  the first visit with a network connection. Anyone who saves items but has
  never opened the page online gets the browser's error page without a
  network.
- **Updates happen only when the offline page is opened with a network
  connection**, not in the background. If a score changes afterwards, the
  device shows the saved state without a network.
- **Offline, whatever needs a server is missing:** setting notes and stamps
  (saved ones appear as they were when saved), leading and “Follow me”,
  recording and intonation, practice tracks, saving for offline use and
  editing setlists. Playback, mixer, loop, tempo, metronome, starting note,
  transposition, coach and the views work.

### Open on the device

Passed acceptance testing on the Galaxy S23 in the browser (Chrome): practice track in 8.8 s
(Duckwerk, full mix), saving for offline use in 1.1 s, the offline page and
playback without a reachable server, system band, lyrics view and note names
in the picture. In the Nextcloud app (Android), the S23 follows a leader in the
browser across the switch to the next piece of the setlist (companion token
for the new piece). **Still open:**

- a lock lasting several minutes during playback;
- a practice track from within the Nextcloud app and on a mid-range device;
- the piece switch with three following devices at once;
- a pedal in the system band – keys only reach the viewer when it has focus,
  as with turning pages.

## Display variants

A part on its own, pages the size of a phone screen, concert pitch, and notes
transposed along with the sound – each engraved by MuseScore itself, on
demand ([E19](architecture.md#e19-darstellungsvarianten-dieselbe-zeit-ein-anderes-bild) (German)).
Available on the local conversion path, on the sidecar with the engine, and
in the browser fallback; a sidecar that converts with MuseScore itself engraves
none, and there the choices stay greyed out with the reason.

Measured on the test instance (Node 20.19, the own test score
`parts-test.mscz`, 24 measures, five staves):

| | Pages | Time per run |
|---|---|---|
| Full score, as in the file | 3 | – (base conversion) |
| Stored part “Frauenstimmen” (two staves) | 1 | 3–4 s |
| Generated clarinet part, phone page, a tone lower | 1 | 3–4 s |
| Full score on phone pages, upright or landscape | 7 | 3–4 s |
| Full score in concert pitch | 3 | 3–4 s |

- **Per run 3–4 s on the server**, measured through the variant route
  including the request (about 6 s on the slow test instance, of which 1.5 s
  is that instance's request time). A variant already made answers like any
  cached artifact. Under Deno 2.9: 4.3 s. Via the sidecar with the engine
  (Node 22 in the image): 3.9 s through the variant route, the same.
- **Memory**: a generated part needs less than the base conversion – 122–124
  against 174–190 MB of process memory on 4- and 5-page choral pieces.
- **Phone pages take about 2.3 times as many pages** as A4 (7 instead of 3);
  the notes appear about twice as large on a phone held upright.
- **At most 8 variants per score version** are kept, the least recently
  opened goes first; **at most 20 new runs per person and hour** (S4).
  Reading a variant that exists does not count.
- **Notes and stamps** are stored against the full score, whatever was on
  screen when they were made; a variant shows them at the same note, or at
  the measure where it has no such note. Stamps for parts appear only on the
  staves the variant draws.
- **Continuous views were measured and left out.** MuseScore's horizontal
  and vertical continuous view put the whole score on one page: on a
  four-page choral piece 13,915 instead of at most 4,170 nodes in one SVG,
  30 zoom steps in 980 instead of 506 ms – and growing with every page.

Known shortcomings of the phone pages: on a landscape phone page a large
system may not fit under the title, which then has its first page to itself;
and the part name, set at the left edge of the title frame, can overlap a
long title on the narrow upright page. Both are MuseScore's layout of the
frame on a small page.

## What the app deliberately does not do

- **No server-side rendering on managed hosting.** The local conversion path
  needs a Node.js runtime and permission to start processes; the Wasm module
  cannot be run in PHP alone – the reasons are in
  [E3](architecture.md#e3-zwei-konvertierungswege-hinter-einer-api) (German).
  **The app can still be operated there**, but differently: the browser
  converts ([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)).
  What is lost in the process is stated there and is not small print – there
  is no cache, each device downloads a good 7 MB once (14 MB unpacked) and
  recomputes every score each time it is opened.
- **No server cache for what the browser has engraved.** The artifacts from
  the fallback do not go back to the server. An upload would be a new trust
  boundary – the server would deliver to all readers of a file what a single
  browser produced ([E7](architecture.md#e7-konvertierung-im-browser-als-rückfall)).
- **No reflow.** The page image is MuseScore's engraving
  ([E2](architecture.md#e2-musescore-svg-statt-neusatz-im-browser)).
  “Fit page width” and “Fit whole page” scale, they do not rewrap. Phone pages
  ([Display variants](#display-variants)) are a fixed engraving on smaller
  paper, not a reflow: they too only scale. The system band cuts from the page
  image; only the text of the lyrics view may wrap.
- **No editing of scores.** ScoreView shows and plays; it does not correct
  anything in the `.mscz`.
- **No recordings for others – except a leader's, sung for voices.** A
  recording can only be heard by the person who made it; it lives in the app
  data, not in Files. The one way out is a leader sharing an own recording
  with parts
  ([E21](architecture.md#e21-aufnahmen-der-leitung-für-stimmen) (German)).
  Practice tracks, by contrast, are synthesised and deliberately files in Files
  ([E13](architecture.md#e13-übe-tracks-sind-dateien-in-files)).
- **No ranking of practice time.** The practice log shows each person their
  own time only
  ([E20](architecture.md#e20-übetagebuch-ohne-bestenliste) (German)).
- **No long polling for “Follow me”.** Each waiting device would occupy a PHP
  worker; polling is short, accelerated by `notify_push` where it is set up
  ([E10](architecture.md#e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht)).
- **No Direct Editor for Markdown.** ScoreView would otherwise appear in the
  mobile apps for every `.md` file; setlists open there via a score.
- **No entry point of its own for scores.** Entry is exclusively from Files –
  via Nextcloud's viewer, the file action on the extension or the one on
  `*.setlist.md`
  ([E6](architecture.md#e6-drei-einstiege-in-files--mimetype-dateiendung-setliste))
  – and from the mobile apps via Direct Editing; `/apps/scoreview/`
  deliberately answers 404. The only page of its own,
  `/apps/scoreview/offline`, only shows saved items
  ([E14](architecture.md#e14-eine-offline-seite-mit-eigenem-service-worker)).
  Setlists are files in Files, not a separate management feature of the app.
- **No lock-screen controls for playback in the viewer.** Web Audio does not
  get them ([Lock screen](#lock-screen)); the practice track exists for
  that.
- **No transposed notation when the sidecar converts with MuseScore itself.**
  There it is only the sound that is transposed; the notes and the note names
  stay as written. With the engine – locally, on the sidecar, in the browser –
  the notes can follow ([Display variants](#display-variants)).
- **No pen/freehand layer.** Notes are text at a musical anchor. Free strokes
  would be a second kind of data whose anchor would have to be a path instead
  of a point – and which, unlike text, would not survive a re-rendering of the
  score, because a stroke is tied to pixels and not to a measure.
- **No parts when the sidecar converts with MuseScore itself.** There “Show
  only my part” visually dims the other parts, and the page keeps its layout,
  including the empty space where the other staves are. With the engine a part
  is engraved on its own ([Display variants](#display-variants)).
- **No sandboxing of MuseScore itself beyond the container.** The container
  runs non-root with memory and PID limits; network isolation just for the
  conversion subprocess would need a sandbox layer of its own. The engine in
  the same container is locked in further, like on the local path with Node
  22: each run reads only its score and writes only its output, starts no
  processes and sees none of the container's environment – the network stays
  open, as in the table under
  [Isolation of the local converter](#isolation-of-the-local-converter). See
  [Security](../sidecar/README.md#sicherheit).
- **Only German and English.** Another language means adding a file, not
  reworking anything ([E4](architecture.md#e4-englische-quellstrings-deutsch-als-gepflegte-übersetzung)).
- **No packaging as AppAPI/ExApp.** The sidecar runs as a separate container,
  not managed by Nextcloud.
- **No bundled Node runtime.** The local path uses the server's `node`; the
  app does not ship one and does not download one either (as Nextcloud's
  `recognize` does, for instance).
- **No CJK fonts in the App Store package.** On the local conversion path,
  MuseScore therefore sets Chinese, Japanese and Korean lyrics as replacement
  boxes; everything else is unaffected. The fonts weigh 4.2 MB, and the App
  Store only accepts archives up to 30 MiB, of which the package already
  takes about 21 MB. Anyone who needs them places font
  files (`.woff2`, `.otf`, `.ttf`, `.ttc`) in a directory **outside the app**
  and registers it:

  ```sh
  occ config:app:set scoreview cjk_font_dir --value=/srv/scoreview-fonts
  ```

  Outside the app, because the delivered app directory is **signed** – any
  additional file in it makes Nextcloud's integrity check raise an alarm
  permanently. The sidecar needs none of this when it converts with the
  engine: its image has no size limit and carries the fonts the app package
  leaves out (checked: both load under the permission model). MuseScore itself
  in the same image only has DejaVu and FreeFont (19 font files, no CJK font),
  and there is no setting to supply it with fonts afterwards.
