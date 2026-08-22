import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

const scoreSelect = document.getElementById("score-select");
const timingSelect = document.getElementById("timing-select");
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const audioEl = document.getElementById("audio");
const osmdContainer = document.getElementById("osmd-container");

let osmd = null;
let stepTimesMs = [];
let currentIndex = -1;
let rafHandle = null;

function setStatus(text, mismatch) {
  statusEl.textContent = text;
  statusEl.classList.toggle("mismatch", Boolean(mismatch));
}

async function fetchTimingEvents(url) {
  const text = await (await fetch(url)).text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const events = Array.from(doc.querySelectorAll("events > event")).map((el) => ({
    elid: Number(el.getAttribute("elid")),
    timeMs: Number(el.getAttribute("position")),
  }));
  events.sort((a, b) => a.timeMs - b.timeMs);
  return events;
}

// Walks the OSMD cursor from the start to the end once, purely to count how
// many distinct stop positions it has - this is the number we compare
// against the spos/mpos event count to decide whether ordinal 1:1 mapping
// (time[i] <-> cursor step i) is valid, per the Phase-1 Go/No-Go check.
function countCursorSteps(osmdInstance) {
  const cursor = osmdInstance.cursor;
  cursor.reset();
  let steps = 0;
  const MAX_STEPS = 20000; // safety guard against an unexpected infinite loop
  while (!cursor.iterator.EndReached && steps < MAX_STEPS) {
    steps++;
    cursor.next();
  }
  cursor.reset();
  return steps;
}

// If the OSMD cursor step count matches the timing-event count exactly, the
// two sequences correspond 1:1 in chronological order (both are "one entry
// per playback onset across all voices/parts"). If they don't match, we
// fall back to nearest-neighbour resampling and surface that as a visible
// mismatch instead of silently guessing.
function buildStepTimes(cursorStepCount, timingEvents) {
  const n = timingEvents.length;
  const m = cursorStepCount;
  if (n === 0 || m === 0) return { times: [], exact: false };
  if (n === m) {
    return { times: timingEvents.map((e) => e.timeMs), exact: true };
  }
  const times = new Array(m);
  for (let i = 0; i < m; i++) {
    const srcIdx = Math.min(n - 1, Math.round((i * (n - 1)) / Math.max(1, m - 1)));
    times[i] = timingEvents[srcIdx].timeMs;
  }
  return { times, exact: false };
}

function findStepIndex(times, timeMs) {
  let lo = 0;
  let hi = times.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= timeMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function moveCursorTo(index) {
  if (!osmd || stepTimesMs.length === 0 || index === currentIndex) return;
  const cursor = osmd.cursor;
  if (index === currentIndex + 1) {
    cursor.next();
  } else {
    cursor.reset();
    for (let i = 0; i < index; i++) cursor.next();
  }
  currentIndex = index;
}

function tick() {
  if (stepTimesMs.length > 0 && audioEl && !audioEl.paused && !audioEl.ended) {
    const idx = findStepIndex(stepTimesMs, audioEl.currentTime * 1000);
    moveCursorTo(idx);
  }
  rafHandle = requestAnimationFrame(tick);
}

async function loadScore(id, timingSource) {
  setStatus(`Lade ${id} ...`);
  currentIndex = -1;
  stepTimesMs = [];
  audioEl.pause();

  // Fresh instance per load, rather than reusing/clearing one, to avoid
  // carrying over any internal cursor/layout state between two very
  // differently shaped scores.
  osmdContainer.innerHTML = "";
  osmd = new OpenSheetMusicDisplay(osmdContainer, {
    autoResize: true,
    followCursor: true,
    drawTitle: true,
  });

  const base = `./scores/${id}/`;
  const musicXmlText = await (await fetch(base + "score.musicxml")).text();
  await osmd.load(musicXmlText);
  osmd.render();
  osmd.cursor.show();

  const cursorStepCount = countCursorSteps(osmd);

  const [sposEvents, mposEvents] = await Promise.all([
    fetchTimingEvents(base + "score.spos"),
    fetchTimingEvents(base + "score.mpos"),
  ]);
  const timingEvents = timingSource === "spos" ? sposEvents : mposEvents;

  const { times, exact } = buildStepTimes(cursorStepCount, timingEvents);
  stepTimesMs = times;

  audioEl.src = base + "audio.mp3";

  setStatus(
    [
      `OSMD-Cursor-Schritte: ${cursorStepCount}`,
      `spos-Events: ${sposEvents.length}`,
      `mpos-Events: ${mposEvents.length}`,
      `Aktive Timing-Quelle: ${timingSource} (${timingEvents.length} Events)`,
      exact
        ? "Ordinale 1:1-Zuordnung (Cursor-Schritte == Timing-Events)."
        : "ACHTUNG: Anzahl weicht ab - Fallback per Nearest-Neighbour-Resampling, keine echte 1:1-Zuordnung.",
    ].join("\n"),
    !exact,
  );

  osmd.cursor.reset();
}

audioEl.addEventListener("seeked", () => {
  if (stepTimesMs.length === 0) return;
  currentIndex = -1; // force the reset()+iterate path even for a tiny jump
  moveCursorTo(findStepIndex(stepTimesMs, audioEl.currentTime * 1000));
});

loadBtn.addEventListener("click", () => {
  loadScore(scoreSelect.value, timingSelect.value).catch((err) => {
    console.error(err);
    setStatus("Fehler: " + err.message, true);
  });
});

rafHandle = requestAnimationFrame(tick);
window.addEventListener("beforeunload", () => cancelAnimationFrame(rafHandle));

loadScore(scoreSelect.value, timingSelect.value).catch((err) => {
  console.error(err);
  setStatus("Fehler: " + err.message, true);
});
