"use client";

/* Standalone metronome engine.

   Why this deliberately avoids Tone's global transport: that object is a
   per-AudioContext singleton, and this app already drives it from two places —
   score playback in StaveEditor.tsx and rhythm-group previews in
   groupPreview.ts. A preview calls cancel() on it, which clears the ENTIRE
   timeline, and the dashboard itself renders a preview button
   (dashboard/page.tsx:868). A metronome sharing that timeline would be silenced
   — or would silence a preview — the moment the other ran. This engine owns a
   private lookahead scheduler on the same audio clock instead, so the two can
   never interfere.

   Isolation check: these metronome files must never name the global transport
   object, so the identifier is absent from them by design — see the plan's
   isolation contract.

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
    const out = new Tone.Volume(volumeToDb(this.settings?.volume ?? 70)).connect(
      masterBus()
    );
    this.out = out;
    // Tone.Synth is monophonic and safely re-triggerable — exactly a
    // metronome's needs, and no per-click node allocation.
    const voice = () =>
      new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
      }).connect(out);
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
    // needs no transport, so the flash lands with the click rather than when we
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
