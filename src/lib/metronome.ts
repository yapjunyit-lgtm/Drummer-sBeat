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
