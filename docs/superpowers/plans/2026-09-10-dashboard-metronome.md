# Dashboard Metronome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone metronome practice session that opens from a button
on the dashboard and closes back to off, without ever touching the score
editor's or rhythm-group preview's audio timeline.

**Architecture:** Three small focused modules — pure beat math (no audio, no
DOM), a Tone-backed engine that owns a *private* lookahead scheduler on the
shared audio clock, and a user-scoped settings store — wrapped by one
self-contained panel component mounted from the dashboard. The engine never
touches `Tone.Transport`, which is what keeps it isolated.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4,
Tone.js 15.1.22 (already installed — no new dependencies).

**Spec:** this document. "Design research" below is the spec; the tasks
implement it.

## Global Constraints

Copy these verbatim into every task's requirements:

- **No new dependencies.** `tone@15.1.22` is already installed.
- **Never call any `Tone.Transport` member from metronome code.** Not `start`,
  `stop`, `cancel`, `bpm`, `seconds`, `position`, `schedule`, or
  `scheduleRepeat`. This is the whole point of the design — see *Isolation
  contract*.
- **Never read or write the active project's `bpm`.** The metronome has its own
  setting under its own storage key.
- **BPM range `40`–`240`**, matching the editor's slider
  (`src/components/StaveEditor.tsx:3428`).
- **Every storage key goes through `scopedKey()`** from `src/lib/userScope.ts`,
  wrapped in `try`/`catch` — the house pattern in `src/lib/projects.ts:287`.
- **All audio routes through `masterBus()`** from `src/lib/audioLevels.ts`.
- **Bilingual labels** (English + 中文), `amber-500` accents on the zinc
  palette, matching the existing dashboard.
- **Verification scripts run on plain Node.** Node 24.20 strips TypeScript
  natively, so `node scripts/verify-<name>.mts` works with no dev dependency
  (verified on this machine).

---

## Design research: which metronome structure fits

### 1. Timing model — **decided: private lookahead scheduler**

| Option | Verdict |
|---|---|
| `setInterval(60000 / bpm)` | **Rejected.** JS timers are subject to event-loop jitter and accumulate drift; a metronome that drifts is useless for practice. |
| `Tone.Transport` + `scheduleRepeat` | **Rejected.** Sample-accurate, but `Transport` is a per-`AudioContext` *singleton* that this app already drives from two other places. See below. |
| **Private lookahead scheduler on the audio clock** | **Chosen.** The same shape Tone uses internally, with zero shared state. |

The investigation that settles it:

- `Tone.Transport` is one global object per audio context
  (`node_modules/tone/build/esm/index.d.ts:26-36`).
- `src/lib/groupPreview.ts:61` calls `Tone.Transport.stop()` and line 62 calls
  `Tone.Transport.cancel()` — and `cancel()` with no argument clears the
  **entire** timeline, not just its own events.
- `src/components/StaveEditor.tsx` drives that same global `Transport` for score
  playback, with its own `bpm` and `position`.
- `src/app/dashboard/page.tsx:868` renders `GroupPreviewButton` — so the
  dashboard itself can start a preview.

Put a metronome on `Transport` and the first rhythm-group preview a user plays
silences it (and a running metronome would silence the preview). That directly
violates the "another session, don't mix" requirement. Hence: the metronome owns
a private scheduler and never references `Transport`.

The chosen model is the standard lookahead pattern: a coarse JS timer wakes
often and enqueues every click that falls in the next ~100 ms at an *absolute
audio-clock time*, so playback accuracy comes from the audio clock rather than
from JS timers. The numbers are not invented — the installed Tone context
defaults to `lookAhead: 0.1`, `updateInterval: 0.05`, `clockSource: "worker"`
(`node_modules/tone/build/esm/core/context/Context.js:78-81`). We use 25 ms /
100 ms.

### 2. Sound — **decided: synthesized clicks, no assets**

Two pre-built `Tone.Synth` voices (accent + normal), `C6` / `C5`, short
envelope. Rationale:

- The repo already synthesizes a click this way for 鼓棒 —
  `Tone.Oscillator` + `Tone.AmplitudeEnvelope` at
  `src/components/StaveEditor.tsx:1505`.
- Zero new assets, no load latency, works offline, and the timbre is tunable.
- `Tone.Synth` is monophonic and safely re-triggerable, so there is no per-click
  node allocation (the alternative — a fresh oscillator per click — churns the
  audio graph 2–8 times a second forever).

The drum samples (`public/samples/gu-xin.wav`, `gu-bian.wav`) are deliberately
**not** used: a woodblock/drum click competes with the drum material it is
supposed to keep time for.

Tuning note: if the square wave reads as harsh against the drum samples, swap
`type: "square"` for `"sine"` (softer) or `"triangle"` (between the two). Judge
it by ear against a running score.

### 3. Feature set — **decided for v1**

Chosen to match what the app already models, plus what practice actually needs:

- **BPM** 40–240: numeric input + slider (the editor's range).
- **Tap tempo**: averaged over the last few taps.
- **Beats per measure** 2–12 with an accented downbeat. The score grid is 4/4
  (`src/lib/projects.ts:8-10`, 96 slots / 24 per beat), so 4 is the default, but
  a practice tool should not be locked to it.
- **Subdivision**: quarter / eighth / sixteenth / triplet / sextuplet —
  deliberately the same vocabulary as the editor's palette
  (`src/lib/notation.ts:96`).
- **Count-in**: one measure before the pattern proper.
- **Visual beat indicator** synced to the audio clock, plus **volume**.
- Keyboard: `Space` start/stop, `Esc` close, `T` tap.

### 4. Where it lives — **recommendation, flagged for confirmation**

The plan assumes a **full-screen session panel over the dashboard**: a button
opens it, a button or `Esc` closes it back to off. Reasons:

- It matches the request literally ("at the dashboard", "button to open … back
  to off") and the dashboard's existing modal convention (`CombineModal`,
  `ShareModal`, `CollectionShareModal`).
- `src/app/dashboard/page.tsx` is already 935 lines; a route would push shared
  state around, a panel does not.
- Closing and opening a panel avoids re-running the dashboard's cloud fetch,
  which a route navigation would trigger.
- A full-screen panel also makes the preview collision impossible in practice,
  because the dashboard behind it is not interactive.

**Alternative:** a `/metronome` route. The engine module below is
surface-agnostic — mounting it from a route instead of a panel changes only
Tasks 4 and 5, not Tasks 1–3. Confirm before Task 4 if a route is preferred.

---

## Isolation contract ("don't mix")

Four rules, each defending against a specific failure:

1. **No `Tone.Transport` access, ever.** Enforced mechanically: the three
   metronome lib files must not contain the string `Transport`.
2. **No shared state with score playback.** The metronome's BPM and time
   signature live under their own key (`drummers-beat:metronome:v1`) and are
   never read from or written to a `Project`.
3. **Everything created is disposed on stop.** Voices and the output node are
   disposed in `stop()`, and `stop()` runs on close, on unmount, and on
   `pagehide`.
4. **`Tone.start()` fires only from the Start gesture.** No autoplay attempt on
   mount.

The failure this prevents: `Tone.getContext()` is a module-level singleton that
survives Next.js client-side navigation, so a metronome that is not torn down
keeps clicking after the user has navigated away.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/metronome.ts` (new) | Pure beat math and types. No `tone`, no DOM — so plain Node can check it. |
| `src/lib/metronomeSettings.ts` (new) | User-scoped localStorage persistence and validation. |
| `src/lib/metronomeEngine.ts` (new) | Tone-backed voices and the private lookahead scheduler. Owns lifecycle. |
| `src/components/MetronomeSession.tsx` (new) | The session UI: controls, beat indicator, keyboard, focus. |
| `src/app/dashboard/page.tsx` (modify) | The open/close button and mount point only. |
| `scripts/verify-metronome.mts` (new) | Node-run checks for the math and settings validation. |
| `README.md` (modify) | One status line. |

---

### Task 1: Pure beat math

**Files:**

- Create: `src/lib/metronome.ts`
- Create: `scripts/verify-metronome.mts`

**Interfaces:**

- Produces: `BPM_MIN`, `BPM_MAX`, `type Subdivision`,
  `TICKS_PER_BEAT: Record<Subdivision, number>`, `interface MetronomeSettings`,
  `DEFAULT_SETTINGS`, `clampBpm(bpm: number): number`,
  `tickInterval(bpm: number, subdivision: Subdivision): number`,
  `tickRole(index, settings)` returning
  `{ inMeasure, beat, isDownbeat, isBeat }`,
  `bpmFromTaps(taps: number[]): number | null`.

- [ ] **Step 1: Write the failing check**

Create `scripts/verify-metronome.mts`. Match the plain-Node style of
`scripts/verify-collection-delete.mts` — this repo has no test framework:

```ts
/*
 * Checks the metronome's beat math. Pure logic only — no audio, no browser.
 *
 * Usage: node scripts/verify-metronome.mts
 */

import {
  BPM_MAX,
  BPM_MIN,
  bpmFromTaps,
  clampBpm,
  tickInterval,
  tickRole,
  type MetronomeSettings,
} from "../src/lib/metronome";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

const base: MetronomeSettings = {
  bpm: 120,
  beatsPerMeasure: 4,
  subdivision: "quarter",
  accentDownbeat: true,
  volume: 70,
  countIn: false,
};

console.log("clampBpm");
check("clamps low", clampBpm(1), BPM_MIN);
check("clamps high", clampBpm(9999), BPM_MAX);
check("rounds", clampBpm(120.6), 121);
check("rejects NaN", clampBpm(Number.NaN), 120);

console.log("tickInterval");
check("120bpm quarter = 0.5s", tickInterval(120, "quarter"), 0.5);
check("120bpm eighth = 0.25s", tickInterval(120, "eighth"), 0.25);
check("60bpm triplet = 1/3s", tickInterval(60, "triplet"), 1 / 3);
check("120bpm sextuplet = 1/12s", tickInterval(120, "sextuplet"), 1 / 12);

console.log("tickRole — 4/4 quarter");
check("index 0 is the downbeat", tickRole(0, base), {
  inMeasure: 0,
  beat: 0,
  isDownbeat: true,
  isBeat: true,
});
check("index 3 is beat 4", tickRole(3, base), {
  inMeasure: 3,
  beat: 3,
  isDownbeat: false,
  isBeat: true,
});
check("index 4 wraps", tickRole(4, base), {
  inMeasure: 0,
  beat: 0,
  isDownbeat: true,
  isBeat: true,
});
check("negative index (count-in) stays on grid", tickRole(-4, base), {
  inMeasure: 0,
  beat: 0,
  isDownbeat: true,
  isBeat: true,
});

console.log("tickRole — 4/4 sixteenth");
const sixteenths: MetronomeSettings = { ...base, subdivision: "sixteenth" };
check("index 4 is beat 2", tickRole(4, sixteenths), {
  inMeasure: 4,
  beat: 1,
  isDownbeat: false,
  isBeat: true,
});
check("index 1 is a sub-click off the beat", tickRole(1, sixteenths), {
  inMeasure: 1,
  beat: 0,
  isDownbeat: false,
  isBeat: false,
});

console.log("tickRole — 3/4");
check("3/4 wraps after 3", tickRole(3, { ...base, beatsPerMeasure: 3 }), {
  inMeasure: 0,
  beat: 0,
  isDownbeat: true,
  isBeat: true,
});

console.log("bpmFromTaps");
check("single tap is not enough", bpmFromTaps([1000]), null);
check("500ms apart = 120", bpmFromTaps([0, 500, 1000, 1500]), 120);
check("600ms apart = 100", bpmFromTaps([0, 600, 1200]), 100);
check("jitter averages out", bpmFromTaps([0, 500, 1010, 1500]), 120);
check("clamps absurd gaps", bpmFromTaps([0, 5000]), BPM_MIN);

console.log(
  failures === 0
    ? "\nAll metronome math checks passed."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node scripts/verify-metronome.mts`
Expected: fails to resolve `../src/lib/metronome` — the module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/metronome.ts`:

```ts
/* Metronome beat math.

   Deliberately free of Tone.js and the DOM so the beat grid can be verified by
   plain Node (scripts/verify-metronome.mts). The audio side — voices and the
   scheduler — lives in metronomeEngine.ts. */

export const BPM_MIN = 40;
export const BPM_MAX = 240;

/** How one beat is divided into clicks, matching the editor's palette
    (quarter → sextuplet, see src/lib/notation.ts). */
export type Subdivision =
  | "quarter"
  | "eighth"
  | "sixteenth"
  | "triplet"
  | "sextuplet";

export const TICKS_PER_BEAT: Record<Subdivision, number> = {
  quarter: 1,
  eighth: 2,
  sixteenth: 4,
  triplet: 3,
  sextuplet: 6,
};

/** The metronome's own settings. Deliberately not part of `Project` — this is
    a standalone practice session and must not touch a score's BPM. */
export interface MetronomeSettings {
  bpm: number;
  beatsPerMeasure: number;
  subdivision: Subdivision;
  accentDownbeat: boolean;
  volume: number; // 0-100
  countIn: boolean;
}

export const DEFAULT_SETTINGS: MetronomeSettings = {
  bpm: 120,
  beatsPerMeasure: 4,
  subdivision: "quarter",
  accentDownbeat: true,
  volume: 70,
  countIn: false,
};

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_SETTINGS.bpm;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
}

/** Seconds between two consecutive clicks. */
export function tickInterval(bpm: number, subdivision: Subdivision): number {
  return 60 / clampBpm(bpm) / TICKS_PER_BEAT[subdivision];
}

/** Where a click sits inside the measure. `index` is a monotonically
    increasing click counter, so count-in (negative) values still resolve onto
    the same grid. */
export function tickRole(
  index: number,
  settings: MetronomeSettings
): {
  inMeasure: number;
  beat: number;
  isDownbeat: boolean;
  isBeat: boolean;
} {
  const perBeat = TICKS_PER_BEAT[settings.subdivision];
  const perMeasure = settings.beatsPerMeasure * perBeat;
  const inMeasure = ((index % perMeasure) + perMeasure) % perMeasure;
  return {
    inMeasure,
    beat: Math.floor(inMeasure / perBeat),
    isDownbeat: inMeasure === 0,
    isBeat: inMeasure % perBeat === 0,
  };
}

/** Average tap gaps → BPM. `taps` are timestamps in milliseconds. */
export function bpmFromTaps(taps: number[]): number | null {
  if (taps.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < taps.length; i++) {
    const gap = taps[i] - taps[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return clampBpm(60000 / average);
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `node scripts/verify-metronome.mts`
Expected: every line `ok`, then `All metronome math checks passed.`, exit 0.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/metronome.ts scripts/verify-metronome.mts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metronome.ts scripts/verify-metronome.mts
git commit -m "feat(metronome): pure beat math + node checks"
```

---

### Task 2: Settings persistence

**Files:**

- Create: `src/lib/metronomeSettings.ts`
- Modify: `scripts/verify-metronome.mts`

**Interfaces:**

- Consumes: everything from Task 1.
- Produces: `loadMetronomeSettings(): MetronomeSettings`,
  `saveMetronomeSettings(settings: MetronomeSettings): void`.

Storage key is `drummers-beat:metronome:v1`, resolved through `scopedKey()` so
each signed-in account keeps its own tempo on a shared device — the same rule
the rest of the app follows.

- [ ] **Step 1: Write the failing check**

Add this block to `scripts/verify-metronome.mts`, **after** the `bpmFromTaps`
checks and **before** the final summary `console.log`. Node has no
`localStorage`, so stub it the way `scripts/verify-collection-delete.mts` does:

```ts
console.log("settings persistence");
{
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const { loadMetronomeSettings, saveMetronomeSettings } = await import(
    "../src/lib/metronomeSettings"
  );

  check("empty storage falls back to defaults", loadMetronomeSettings(), base);

  saveMetronomeSettings({ ...base, bpm: 88, subdivision: "triplet" });
  check("round-trips what was saved", loadMetronomeSettings(), {
    ...base,
    bpm: 88,
    subdivision: "triplet",
  });

  store.set(
    "drummers-beat:metronome:v1",
    JSON.stringify({ bpm: 9999, subdivision: "nonsense", volume: -50 })
  );
  check("repairs junk values", loadMetronomeSettings(), {
    ...base,
    bpm: BPM_MAX,
    volume: 0,
  });

  store.set("drummers-beat:metronome:v1", "{not json");
  check("survives corrupt json", loadMetronomeSettings(), base);
}
```

Note the top-level `await`: a `.mts` file is already an ES module, so this is
valid, but the `await import` must stay below the static imports.

- [ ] **Step 2: Run it to confirm it fails**

Run: `node scripts/verify-metronome.mts`
Expected: `Cannot find module '../src/lib/metronomeSettings'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/metronomeSettings.ts`:

```ts
/* Metronome settings persistence.

   Its own storage key, never the active project's: the metronome is a
   standalone practice session, so opening it must not disturb the score you
   were working on and vice versa. Scoped per user like the rest of the app, so
   two accounts on one device keep separate tempos. */

import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_SETTINGS,
  TICKS_PER_BEAT,
  type MetronomeSettings,
  type Subdivision,
} from "@/lib/metronome";
import { scopedKey } from "@/lib/userScope";

const BASE_KEY = "drummers-beat:metronome:v1";

function metronomeKey(): string {
  return scopedKey(BASE_KEY);
}

/** Clamp whatever was in storage onto a sane number, falling back when it is
    not a number at all (`Number(undefined)` is NaN, not a miss). */
function intInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isSubdivision(value: unknown): value is Subdivision {
  return typeof value === "string" && value in TICKS_PER_BEAT;
}

export function loadMetronomeSettings(): MetronomeSettings {
  try {
    const raw = localStorage.getItem(metronomeKey());
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MetronomeSettings>;
    return {
      bpm: intInRange(parsed.bpm, DEFAULT_SETTINGS.bpm, BPM_MIN, BPM_MAX),
      beatsPerMeasure: intInRange(
        parsed.beatsPerMeasure,
        DEFAULT_SETTINGS.beatsPerMeasure,
        2,
        12
      ),
      subdivision: isSubdivision(parsed.subdivision)
        ? parsed.subdivision
        : DEFAULT_SETTINGS.subdivision,
      accentDownbeat: parsed.accentDownbeat !== false,
      volume: intInRange(parsed.volume, DEFAULT_SETTINGS.volume, 0, 100),
      countIn: parsed.countIn === true,
    };
  } catch {
    // Storage unavailable or corrupt — the metronome still works, it just
    // forgets the tempo.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveMetronomeSettings(settings: MetronomeSettings): void {
  try {
    localStorage.setItem(metronomeKey(), JSON.stringify(settings));
  } catch {
    // Storage unavailable — ignore, matching src/lib/projects.ts.
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `node scripts/verify-metronome.mts`
Expected: all `ok`, summary line, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metronomeSettings.ts scripts/verify-metronome.mts
git commit -m "feat(metronome): user-scoped settings persistence"
```

---

### Task 3: The engine

**Files:**

- Create: `src/lib/metronomeEngine.ts`

**Interfaces:**

- Consumes: `tickInterval`, `tickRole`, `MetronomeSettings` (Task 1);
  `masterBus` (`src/lib/audioLevels.ts`).
- Produces: `interface BeatInfo { beat: number; isDownbeat: boolean; isBeat: boolean; isCountIn: boolean }`
  and `class MetronomeEngine` with
  `start(settings, onBeat: (info: BeatInfo) => void): void`,
  `update(settings: MetronomeSettings): void`, `stop(): void`, and
  `get running(): boolean`.

This is the task that must not be sloppy. Two rules carry the whole design:
schedule on the time you were handed, never on `Tone.now()`; and never
reference `Transport`.

- [ ] **Step 1: Write the implementation**

Create `src/lib/metronomeEngine.ts`:

```ts
"use client";

/* Standalone metronome engine.

   Why this does NOT use Tone.Transport — Transport is a per-AudioContext
   singleton and this app already drives it from two places: score playback in
   StaveEditor.tsx and rhythm-group previews in groupPreview.ts. A preview calls
   Tone.Transport.cancel(), which clears the ENTIRE timeline, and the dashboard
   itself renders a preview button (dashboard/page.tsx). A metronome on the
   shared Transport would therefore be silenced — or would silence a preview —
   the moment the other ran. This engine instead owns a private lookahead
   scheduler on the same audio clock, so the two can never interfere.

   Scheduling shape (the same one Tone's own clock uses — Context.js defaults to
   lookAhead 0.1 / updateInterval 0.05): a coarse JS timer wakes often and
   enqueues every click falling inside the next SCHEDULE_AHEAD seconds at an
   absolute audio-clock time. Accuracy comes from the audio clock, not the JS
   timer, so main-thread jank cannot make it drift. A blocked main thread just
   means more clicks get enqueued per wake, and each one still lands on time. */

import * as Tone from "tone";
import { masterBus } from "@/lib/audioLevels";
import { tickInterval, tickRole, type MetronomeSettings } from "@/lib/metronome";

/** How often the JS timer wakes to enqueue upcoming clicks (ms). */
const LOOKAHEAD_MS = 25;
/** How far ahead of the audio clock clicks are enqueued (seconds). */
const SCHEDULE_AHEAD = 0.1;
/** If we fell further behind than this, drop the backlog instead of dumping a
    burst of already-past clicks (happens when a tab is throttled). */
const RESYNC_BEHIND = 0.25;

export interface BeatInfo {
  beat: number; // 0-based beat within the measure
  isDownbeat: boolean;
  isBeat: boolean;
  isCountIn: boolean;
}

/** Maps the 0-100 UI volume onto a dB trim: 100 is reference level, 0 mutes. */
function volumeToDb(volume: number): number {
  const clamped = Math.min(100, Math.max(0, volume));
  return -30 + (clamped / 100) * 30;
}

export class MetronomeEngine {
  private out: Tone.Volume | null = null;
  private accentVoice: Tone.Synth | null = null;
  private beatVoice: Tone.Synth | null = null;
  private timer: number | null = null;
  private nextTickTime = 0;
  private tickIndex = 0;
  private settings: MetronomeSettings | null = null;

  get running(): boolean {
    return this.timer !== null;
  }

  /** Call from the user's Start gesture — that call is what unlocks the
      AudioContext, so it must not be moved into an effect. */
  start(settings: MetronomeSettings, onBeat: (info: BeatInfo) => void): void {
    if (this.running) return;
    this.settings = settings;
    this.buildVoices();
    this.applyVolume(settings.volume);
    // A count-in is the same grid started one measure early: negative indices
    // resolve onto the downbeat and the UI labels them as count-in.
    this.tickIndex = settings.countIn ? -settings.beatsPerMeasure : 0;
    this.nextTickTime = Tone.getContext().currentTime + SCHEDULE_AHEAD;
    this.timer = window.setInterval(() => this.pump(onBeat), LOOKAHEAD_MS);
  }

  /** Live edits (bpm / subdivision / volume) apply without a restart, so the
      tempo can be nudged while it plays. */
  update(settings: MetronomeSettings): void {
    this.settings = settings;
    this.applyVolume(settings.volume);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.disposeVoices();
  }

  private buildVoices(): void {
    if (this.out) return;
    // masterBus() carries the app-wide gain + limiter; this node is the
    // metronome's own trim, so its level is independent of the drum voices.
    this.out = new Tone.Volume(volumeToDb(this.settings?.volume ?? 70)).connect(
      masterBus()
    );
    // Tone.Synth is monophonic and safely re-triggerable — exactly a
    // metronome's needs, and no per-click node allocation.
    const voice = () =>
      new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
      }).connect(this.out as Tone.Volume);
    this.accentVoice = voice();
    this.beatVoice = voice();
  }

  private applyVolume(volume: number): void {
    if (this.out) this.out.volume.value = volumeToDb(volume);
  }

  private disposeVoices(): void {
    this.accentVoice?.dispose();
    this.beatVoice?.dispose();
    this.out?.dispose();
    this.accentVoice = null;
    this.beatVoice = null;
    this.out = null;
  }

  /** Enqueues every click that falls inside the lookahead window. */
  private pump(onBeat: (info: BeatInfo) => void): void {
    const settings = this.settings;
    if (!settings) return;
    const now = Tone.getContext().currentTime;
    if (this.nextTickTime < now - RESYNC_BEHIND) {
      this.nextTickTime = now + SCHEDULE_AHEAD;
    }
    while (this.nextTickTime < now + SCHEDULE_AHEAD) {
      this.scheduleTick(this.nextTickTime, settings, onBeat);
      this.nextTickTime += tickInterval(settings.bpm, settings.subdivision);
    }
  }

  private scheduleTick(
    time: number,
    settings: MetronomeSettings,
    onBeat: (info: BeatInfo) => void
  ): void {
    const index = this.tickIndex++;
    const role = tickRole(index, settings);
    const accent = role.isDownbeat && settings.accentDownbeat;
    const voice = accent ? this.accentVoice : this.beatVoice;
    // Always the `time` we were handed, never Tone.now() — that single detail
    // is what keeps the grid sample-accurate.
    voice?.triggerAttackRelease(accent ? "C6" : "C5", "32n", time);
    // Draw runs its own requestAnimationFrame loop against the audio clock and
    // needs no Transport, so the flash lands with the click rather than when we
    // happened to schedule it.
    Tone.Draw.schedule(
      () =>
        onBeat({
          beat: role.beat,
          isDownbeat: role.isDownbeat,
          isBeat: role.isBeat,
          isCountIn: index < 0,
        }),
      time
    );
  }
}
```

- [ ] **Step 2: Verify the isolation rule holds mechanically**

Run: `rg -n "Transport" src/lib/metronome.ts src/lib/metronomeEngine.ts src/lib/metronomeSettings.ts`
Expected: no matches. Any hit is a design violation, not a style nit.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/metronomeEngine.ts`
Expected: no errors.

- [ ] **Step 4: Ear-check the engine before building UI on it**

The engine has no UI yet, so prove it is audible and steady first. Temporarily
add a throwaway client component with one button that creates a
`MetronomeEngine`, calls `start(DEFAULT_SETTINGS, console.log)` on click, and
calls `stop()` on a second click. Mount it on `/dashboard`, then confirm:

- clicks are steady and evenly spaced;
- the first click of each measure is higher-pitched (accent);
- calling `update({ ...DEFAULT_SETTINGS, bpm: 180 })` mid-run speeds it up
  without a stutter or a dropped beat;
- the second button stops it dead.

Delete the throwaway component before the Task 3 commit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metronomeEngine.ts
git commit -m "feat(metronome): isolated lookahead engine on the audio clock"
```

---

### Task 4: The session panel

**Files:**

- Create: `src/components/MetronomeSession.tsx`

**Interfaces:**

- Consumes: `MetronomeEngine`, `BeatInfo` (Task 3); `loadMetronomeSettings`,
  `saveMetronomeSettings` (Task 2); `DEFAULT_SETTINGS`, `BPM_MIN`, `BPM_MAX`,
  `bpmFromTaps`, `clampBpm`, `TICKS_PER_BEAT`, `Subdivision` (Task 1).
- Produces:
  `export default function MetronomeSession({ open, onClose }: { open: boolean; onClose: () => void })`.

If the surface decision in *Design research §4* changes to a `/metronome` route,
only this task and Task 5 change: drop the `open` prop for a route-level mount
and keep everything else identical.

- [ ] **Step 1: Build the component skeleton**

Create `src/components/MetronomeSession.tsx`. The state and lifecycle below are
the load-bearing part; the markup in Step 2 is styling over it.

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetronomeEngine, type BeatInfo } from "@/lib/metronomeEngine";
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_SETTINGS,
  bpmFromTaps,
  clampBpm,
  type MetronomeSettings,
  type Subdivision,
} from "@/lib/metronome";
import {
  loadMetronomeSettings,
  saveMetronomeSettings,
} from "@/lib/metronomeSettings";

const SUBDIVISION_LABELS: Record<Subdivision, string> = {
  quarter: "Quarter 四分",
  eighth: "Eighth 八分",
  sixteenth: "Sixteenth 十六分",
  triplet: "Triplet 三连音",
  sextuplet: "Sextuplet 六连音",
};

export default function MetronomeSession({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const engineRef = useRef<MetronomeEngine | null>(null);
  const [settings, setSettings] = useState<MetronomeSettings>(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState<BeatInfo | null>(null);
  const tapsRef = useRef<number[]>([]);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /* Load saved settings when the panel opens, and remember what had focus so
     closing can hand it back. Loaded here rather than in state initialisation
     so the dashboard's server-rendered first paint stays untouched. */
  useEffect(() => {
    if (!open) return;
    setSettings(loadMetronomeSettings());
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    startButtonRef.current?.focus();
  }, [open]);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setRunning(false);
    setBeat(null);
  }, []);

  /* Closing and unmounting both must silence the engine: the Tone context
     survives client-side navigation, so a missed cleanup keeps clicking on the
     next page. */
  useEffect(() => {
    if (!open) {
      stop();
      restoreFocusRef.current?.focus();
    }
    return () => {
      engineRef.current?.stop();
    };
  }, [open, stop]);

  /* A reload or tab close must not leave an orphaned interval behind. */
  useEffect(() => {
    const onHide = () => engineRef.current?.stop();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const start = useCallback(() => {
    if (!engineRef.current) engineRef.current = new MetronomeEngine();
    engineRef.current.start(settings, setBeat);
    setRunning(true);
  }, [settings]);

  /* Live edits apply without a restart, so tempo can be nudged while playing;
     saving on every change keeps the panel forgetful-by-default-free. */
  useEffect(() => {
    if (running) engineRef.current?.update(settings);
    saveMetronomeSettings(settings);
  }, [settings, running]);

  const tap = useCallback(() => {
    tapsRef.current = [...tapsRef.current, performance.now()].slice(-5);
    const tapped = bpmFromTaps(tapsRef.current);
    if (tapped !== null) setSettings((s) => ({ ...s, bpm: tapped }));
  }, []);

  const toggle = useCallback(() => {
    if (running) stop();
    else start();
  }, [running, start, stop]);

  const close = useCallback(() => {
    stop();
    onClose();
  }, [onClose, stop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.code === "Space" && !typing) {
        event.preventDefault();
        toggle();
      } else if ((event.key === "t" || event.key === "T") && !typing) {
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, toggle, tap]);

  /* Read once: the beat flash is the only animation here, and a reduce-motion
     user should still get the beat — just without the scale. */
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  if (!open) return null;

  /* …markup — see Step 2… */
}
```

- [ ] **Step 2: Fill in the markup**

Wrap everything in a backdrop plus a centred panel:
`fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm`
for the backdrop, and
`w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl`
for the panel. Give the panel `role="dialog"`, `aria-modal="true"` and
`aria-labelledby` pointing at the heading's `id`. Clicking the backdrop (not the
panel) calls `close()`.

Inside, in order:

1. **Header** — heading `Metronome 节拍器` (the `id` referenced above) and a
   Close button labelled `Close 关闭`, plus the shortcut hint
   `Space start/stop · T tap · Esc close`.
2. **Beat indicator** — `settings.beatsPerMeasure` dots in a row. Fill the dot
   at `beat?.beat` while running; give the downbeat (index 0) the
   `bg-amber-500` treatment and the others `bg-zinc-600`. Show a
   `Count-in 预备` label while `beat?.isCountIn`. Apply
   `scale-125 transition-transform` only when `!reduceMotion`. Mark the row
   `aria-hidden="true"` — announcing every beat would flood a screen reader, and
   the audio already conveys it.
3. **Tempo row** — `input type="number"` bound to `settings.bpm` with
   `min={BPM_MIN}` / `max={BPM_MAX}` that writes through `clampBpm`, a
   `type="range"` slider over the same range, and a `Tap 点击` button wired to
   `tap`. Show the current BPM in a `font-mono` span, matching the editor's
   transport row.
4. **Meter row** — a beats-per-measure `<select>` covering 2–12, and a
   subdivision `<select>` built from `SUBDIVISION_LABELS`. Both need
   `aria-label`s since the visible label is a heading, not a `<label>`.
5. **Toggles** — `Accent downbeat 重音首拍` and `Count-in 预备拍`, bound to
   `settings.accentDownbeat` / `settings.countIn` with `aria-pressed`.
6. **Volume** — a slider bound to `settings.volume`, labelled
   `Volume 音量`.
7. **Primary transport** — `Start 开始` / `Stop 停止`, carrying
   `ref={startButtonRef}`, `aria-pressed={running}`, and the `amber-500` primary
   treatment from the dashboard's "New Project" button. Wiring is `toggle`.

- [ ] **Step 3: Self-review against the requirements**

Re-read the component and confirm each of these is present and correct:

- [ ] `start()` is only reachable from a click or key handler — never an effect.
- [ ] Closing the panel, unmounting, and `pagehide` all call `stop()`.
- [ ] Focus moves to Start on open and returns to the opener on close.
- [ ] `Esc`, `Space`, and `T` are ignored while focus is in a field.
- [ ] Reduced motion keeps the beat indicator working without the scale.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/MetronomeSession.tsx`
Expected: no errors. `react-hooks/exhaustive-deps` warnings count as errors here
— fix them rather than suppressing them.

- [ ] **Step 5: Commit**

```bash
git add src/components/MetronomeSession.tsx
git commit -m "feat(metronome): session panel UI"
```

---

### Task 5: Dashboard entry point

**Files:**

- Modify: `src/app/dashboard/page.tsx` (imports at the top; the header action
  group around lines 440–487; the modal render near the end of the tree)

**Interfaces:**

- Consumes: `MetronomeSession` (Task 4).
- Produces: nothing downstream.

This task deliberately touches as little of the dashboard as possible — the
935-line file gets a button, a state flag, and a mount, nothing more.

- [ ] **Step 1: Add the state and the import**

Add `import MetronomeSession from "@/components/MetronomeSession";` beside the
other component imports, and next to
`const [combineOpen, setCombineOpen] = useState(false);`:

```tsx
const [metronomeOpen, setMetronomeOpen] = useState(false);
```

- [ ] **Step 2: Add the button**

Insert it in the header action group **before** the Combine button, so the
destructive and primary actions stay rightmost. Reuse the Combine button's
exact class list so the row stays visually consistent:

```tsx
<button
  onClick={() => setMetronomeOpen(true)}
  className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
  title="Standalone practice metronome 独立节拍器"
>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
    aria-hidden="true"
  >
    <path d="M12 3 5 20h14L12 3Z" />
    <path d="M12 3v9" />
    <path d="m15.5 8.5-3.5 3.5" />
  </svg>
  Metronome 节拍器
</button>
```

- [ ] **Step 3: Mount the panel**

Beside the existing `CombineModal` / `ShareModal` renders, near the end of the
returned tree:

```tsx
<MetronomeSession
  open={metronomeOpen}
  onClose={() => setMetronomeOpen(false)}
/>
```

The metronome reads no project or cloud data, so it must not become a reason for
the dashboard to refetch anything. Do not wire it into the scores, collections,
or realtime effects.

- [ ] **Step 4: Verify nothing else moved**

Run: `git diff --stat`
Expected: `src/app/dashboard/page.tsx` only, with a small insertion count — no
reformatting and no reordering of existing blocks.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(dashboard): open the metronome from the header"
```

---

### Task 6: Harden, document, verify end to end

**Files:**

- Modify: `README.md` (status list)
- Modify: `src/components/MetronomeSession.tsx` (only if the walkthrough below
  finds a gap)

**Interfaces:** none new.

- [ ] **Step 1: Run the full gate**

```bash
npx tsc --noEmit
npx eslint
node scripts/verify-metronome.mts
npm run build
```

Expected: all clean, checks pass, build succeeds.

- [ ] **Step 2: Walk the manual QA list in a browser**

Run `npm run dev`, sign in, and confirm each of these:

- [ ] The button opens the panel; `Esc`, the Close button, and a backdrop click
      each close it back to off.
- [ ] Start produces steady clicks; the first beat of each measure is accented
      and the first dot flashes on it.
- [ ] Changing BPM mid-run changes tempo smoothly — no stutter, no restart, no
      double-click.
- [ ] Changing subdivision adds evenly spaced sub-clicks, with the beat still
      landing on the dot.
- [ ] Count-in plays one measure of clicks labelled `Count-in` before the
      pattern proper.
- [ ] Tap tempo converges on a steady tapped tempo and clamps at 40 and 240.
- [ ] The volume slider changes the click level without changing the drum
      voices' level.
- [ ] **Isolation:** open the metronome and start it, then go to the Groups tab
      and play a rhythm-group preview — the preview must sound normally.
- [ ] **Isolation:** close the metronome, start a preview, then open the
      metronome — it must stay silent until Start is pressed.
- [ ] **Isolation:** with the metronome running, navigate to `/editor`. No
      clicks continue there, and score playback is unaffected.
- [ ] Settings survive a page reload, and two different signed-in accounts on
      the same browser keep separate tempos.
- [ ] Keyboard: `Space` toggles, `T` taps, `Esc` closes, and typing in the BPM
      field triggers none of them.
- [ ] With the OS set to reduce motion, the beat indicator still tracks the beat
      but does not scale-animate.
- [ ] Tab order enters the panel and does not reach the dashboard behind it.

- [ ] **Step 3: Update the README**

Add one line to the status list, matching the existing voice:

```markdown
- ✅ Standalone metronome: dashboard-launched practice session with its own
  lookahead scheduler (isolated from score playback), adjustable BPM, tap
  tempo, time signature, subdivisions, accent, count-in and a synced beat
  indicator.
```

- [ ] **Step 4: Commit**

```bash
git add README.md src/components/MetronomeSession.tsx
git commit -m "docs(metronome): status + hardening pass"
```

---

## Deviations during implementation

Recorded so the plan matches what actually shipped. Each was forced by a
verification, not a preference.

1. **Verify scripts need explicit `.ts` import extensions.** Node's ESM
   resolver does not guess extensions (proved: extensionless → `ERR_MODULE_NOT_FOUND`,
   `./x.ts` → loads). `moduleResolution: "bundler"` rejected that with TS5097,
   so `tsconfig.json` gained `"allowImportingTsExtensions": true` (harmless
   without emit, and already `noEmit`). Run command is now
   `node --import ./scripts/alias-hook.mjs scripts/verify-metronome.mts`.
2. **`scripts/alias-hook.mjs` added.** `src/lib` imports siblings exclusively
   through the `@/lib/...` alias (verified: zero relative sibling imports), so
   loading `metronomeSettings.ts` from plain Node needs that alias taught to
   Node. The hook registers a resolve mapping for `@/` and tries the extensions
   Node will not guess. Source style was left untouched.
3. **The panel is mount-scoped, not `open`-prop driven.** The dashboard renders
   it only while open, and settings load in a `useState` lazy initialiser.
   Reason: the repo's React 19 lint rule `react-hooks/set-state-in-effect`
   rejects `setState` in an effect body, and the original `open` effect would
   additionally have written defaults over the just-loaded settings on first
   open.
4. **Settings save on user action, not in an effect.** Same root cause, and it
   removes the first-open overwrite window entirely.
5. **Task 3's isolation grep stays exact.** The rationale comment names the
   global transport in lowercase prose only, so `rg -n "Transport"` over the
   three metronome lib files returns nothing — the invariant is "these files
   never name the object", which is checkable.
6. **Runtime verification is outstanding.** `npx tsc --noEmit`,
   `npx eslint`, and the Node checks all pass, but this build environment cannot
   load native bindings (`@next/swc-darwin-arm64` and `lightningcss` both fail
   with a code-signature `Team IDs` error), so `next build` and `next dev`
   return 500. Confirmed pre-existing: an isolated `main` worktree fails
   identically. The audio behaviour has therefore **not** been heard yet — see
   Task 6 Step 2 for the manual list.

## Out of scope for v1

- Practice speed trainer (automatic tempo ramp over N measures).
- Polyrhythms or a multi-voice metronome.
- A preset tempo library or named practice sessions.
- Linking the metronome to a score's BPM, or scrubbing a score *with* it — that
  is exactly the "mixing" this design forbids.
- Recording or exporting the click.
- Any server-side persistence; the metronome is local-only.
