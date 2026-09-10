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
    not a number at all (`Number(undefined)` is NaN, which is not a miss). */
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
