// The one injection key between ScoreViewer.vue and the parts of the viewer
// it renders as components of their own (ViewerBar.vue, ScoreStage.vue,
// ViewerHints.vue, ViewerPanels.vue).
//
// The viewer wires some forty composables together. A child that works with
// many of them - the bar reaches playback, loop, navigation, the starting
// note, the zoom and a dozen more - gets the instances themselves through
// provide/inject instead of sixty props. Each is wrapped in reactive(), so a
// template reads `loop.active` and writes `v-model="loop.fromMeasure"` as
// it would read a prop; the refs inside stay the composable's own, so
// nothing is copied and nothing can drift.
//
// What the context holds (ScoreViewer.vue setup() builds it):
//   playback, loop, trainer, metronome, navigation, startTone, performance,
//   microphone, prefs, zoom, myPart, annotations, leaderRoles, follow, session,
//   scoreFacts, conversion, bar, practiceExport, offlineStore, waitMode,
//   practiceLog, tuner, mix, recorder, intonation, singScore, bandZoom,
//   paging
//                  - the composables of the same name (prefs =
//                    useViewerPreferences, trainer = useSpeedTrainer,
//                    bar = useBarLayout, leaderRoles = useLeaders - not
//                    `leaders`, the composable's own list of them)
//   autoScroller   - useAutoScroll (not `autoScroll`: that is the switch)
//   sing           - what the singing lane shows (useSingView.js)
//   panels         - the open cards (useViewerPanels.js)
//   setlistNav     - the setlist (useSetlist.js)
//   variant        - the display variant (useScoreVariant.js)
//   display        - what the picture shows (useScoreDisplay.js) and the
//                    zoom of the layout on screen (`activeZoom`)
//   features       - the administration's switches (lib/featureFlags.js)
//   view           - the viewer's own state and actions that more than one
//                    part needs: the open file, transposition, "my part",
//                    the switches of the bar, and the user's actions that
//                    end following a leader (loop, saved loop, print);
//                    for the stage the scrolling element's function ref
//                    (`scrollRef`), the pages' state and the tone of a
//                    tapped note; for the panels the shared recordings,
//                    the keys of the score and opening the part choice
//
// Only for components the viewer renders itself: a child elsewhere has no
// viewer to inject from.

export const VIEWER_CONTEXT = Symbol('scoreview.viewerContext')
