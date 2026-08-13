/* Sound profile definitions + Tone.js voice builders for the Sound Lab
   (试听) page. The editor engine reuses the chosen profile's builders.
   Each profile renders 鼓心 / 鼓边 / 鼓棒 with a distinct character. */

import * as Tone from "tone";

export interface ZoneVoice {
  volume: Tone.Param<"decibels">;
  triggerAttackRelease: (duration: string, time?: number) => void;
  dispose: () => void;
}

export interface VoiceSet {
  center: Tone.MembraneSynth;
  edge: ZoneVoice;
  rim: ZoneVoice;
  dispose: () => void;
}

export interface SoundProfile {
  id: string;
  name: string;
  zh: string;
  description: string;
  /** Pitch used to trigger the 鼓心 membrane (e.g. "C2", "A1"). */
  centerNote: string;
}

export const SOUND_PROFILES: SoundProfile[] = [
  {
    id: "current",
    name: "Current",
    zh: "当前音色",
    description:
      "The engine as it is now: C2 membrane 鼓心, pink-noise 鼓边, white-noise 鼓棒.",
    centerNote: "C2",
  },
  {
    id: "taiko",
    name: "Taiko Ensemble",
    zh: "太鼓组合",
    description:
      "Deep A1 taiko 鼓心 with long resonance, rimshot 鼓边 with a metallic ring, woodblock 鼓棒.",
    centerNote: "A1",
  },
  {
    id: "tomSnareClaves",
    name: "Low Tom · Snare · Claves",
    zh: "落地鼓 · 军鼓 · 木鱼",
    description:
      "Round low-tom 鼓心, side-stick 鼓边, pitched claves 鼓棒 — the GM percussion mapping.",
    centerNote: "C2",
  },
  {
    id: "dryStudio",
    name: "Dry Studio",
    zh: "干净工作室",
    description:
      "Punchy kick 鼓心, tight electric-snare 鼓边, ultra-short stick click 鼓棒.",
    centerNote: "G1",
  },
];

/* ------------------------------------------------------------------ */
/* Small builders                                                      */
/* ------------------------------------------------------------------ */

function makeMembrane(opts: {
  pitch: string;
  pitchDecay: number;
  octaves: number;
  decay: number;
  release: number;
  volume: number;
}): Tone.MembraneSynth {
  const synth = new Tone.MembraneSynth({
    pitchDecay: opts.pitchDecay,
    octaves: opts.octaves,
    envelope: {
      attack: 0.001,
      decay: opts.decay,
      sustain: 0,
      release: opts.release,
    },
  }).toDestination();
  synth.volume.value = opts.volume;
  return synth;
}

function makeNoiseVoice(opts: {
  noiseType: "white" | "pink";
  filterType: "bandpass" | "highpass";
  frequency: number;
  q: number;
  decay: number;
  release: number;
  volume: number;
}): ZoneVoice {
  const out = new Tone.Volume(opts.volume).toDestination();
  const noise = new Tone.NoiseSynth({
    noise: { type: opts.noiseType },
    envelope: {
      attack: 0.001,
      decay: opts.decay,
      sustain: 0,
      release: opts.release,
    },
  });
  const filter = new Tone.Filter({
    type: opts.filterType,
    frequency: opts.frequency,
    Q: opts.q,
  });
  noise.chain(filter, out);
  return {
    volume: out.volume,
    triggerAttackRelease: (duration, time) =>
      noise.triggerAttackRelease(duration, time),
    dispose: () => {
      noise.dispose();
      filter.dispose();
      out.dispose();
    },
  };
}

function makeLayeredVoice(opts: {
  noiseType: "white" | "pink";
  filterType: "bandpass" | "highpass";
  frequency: number;
  q: number;
  decay: number;
  release: number;
  volume: number;
  tones: { type: "sine" | "triangle" | "square"; frequency: number; decay: number }[];
}): ZoneVoice {
  const out = new Tone.Volume(opts.volume).toDestination();
  const noise = new Tone.NoiseSynth({
    noise: { type: opts.noiseType },
    envelope: {
      attack: 0.001,
      decay: opts.decay,
      sustain: 0,
      release: opts.release,
    },
  });
  const filter = new Tone.Filter({
    type: opts.filterType,
    frequency: opts.frequency,
    Q: opts.q,
  });
  noise.chain(filter, out);

  const pings = opts.tones.map((tone) => {
    const osc = new Tone.Oscillator({ type: tone.type, frequency: tone.frequency });
    const env = new Tone.AmplitudeEnvelope({
      attack: 0.001,
      decay: tone.decay,
      sustain: 0,
      release: 0.02,
    });
    osc.chain(env, out);
    osc.start();
    return { osc, env, decay: tone.decay };
  });

  return {
    volume: out.volume,
    triggerAttackRelease: (duration, time) => {
      noise.triggerAttackRelease(duration, time);
      for (const p of pings) {
        p.env.triggerAttackRelease(Math.max(0.02, p.decay), time);
      }
    },
    dispose: () => {
      noise.dispose();
      filter.dispose();
      for (const p of pings) {
        p.osc.dispose();
        p.env.dispose();
      }
      out.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export function buildVoiceSet(profileId: string): VoiceSet {
  switch (profileId) {
    case "taiko":
      return {
        center: makeMembrane({
          pitch: "A1",
          pitchDecay: 0.12,
          octaves: 5,
          decay: 0.75,
          release: 0.3,
          volume: -6,
        }),
        edge: makeLayeredVoice({
          noiseType: "pink",
          filterType: "bandpass",
          frequency: 2400,
          q: 2.2,
          decay: 0.14,
          release: 0.05,
          volume: -8,
          tones: [{ type: "triangle", frequency: 2700, decay: 0.09 }],
        }),
        rim: makeLayeredVoice({
          noiseType: "white",
          filterType: "highpass",
          frequency: 5200,
          q: 0.8,
          decay: 0.035,
          release: 0.02,
          volume: -12,
          tones: [{ type: "sine", frequency: 1900, decay: 0.03 }],
        }),
        dispose() {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };

    case "tomSnareClaves":
      return {
        center: makeMembrane({
          pitch: "C2",
          pitchDecay: 0.08,
          octaves: 4,
          decay: 0.6,
          release: 0.2,
          volume: -6,
        }),
        edge: makeLayeredVoice({
          noiseType: "white",
          filterType: "bandpass",
          frequency: 2000,
          q: 2.5,
          decay: 0.1,
          release: 0.04,
          volume: -8,
          tones: [{ type: "sine", frequency: 3200, decay: 0.06 }],
        }),
        rim: makeLayeredVoice({
          noiseType: "white",
          filterType: "highpass",
          frequency: 3000,
          q: 0.7,
          decay: 0.02,
          release: 0.015,
          volume: -12,
          // Claves: the pitched wooden tone is the main character.
          tones: [
            { type: "sine", frequency: 1250, decay: 0.06 },
            { type: "sine", frequency: 2500, decay: 0.03 },
          ],
        }),
        dispose() {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };

    case "dryStudio":
      return {
        center: makeMembrane({
          pitch: "G1",
          pitchDecay: 0.05,
          octaves: 3,
          decay: 0.35,
          release: 0.1,
          volume: -6,
        }),
        edge: makeNoiseVoice({
          noiseType: "white",
          filterType: "bandpass",
          frequency: 2800,
          q: 3,
          decay: 0.1,
          release: 0.03,
          volume: -8,
        }),
        rim: makeNoiseVoice({
          noiseType: "white",
          filterType: "highpass",
          frequency: 6000,
          q: 0.8,
          decay: 0.02,
          release: 0.015,
          volume: -12,
        }),
        dispose() {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };

    case "current":
    default:
      return {
        center: makeMembrane({
          pitch: "C2",
          pitchDecay: 0.05,
          octaves: 3,
          decay: 0.45,
          release: 0.2,
          volume: -4,
        }),
        edge: makeNoiseVoice({
          noiseType: "pink",
          filterType: "bandpass",
          frequency: 1800,
          q: 1.2,
          decay: 0.18,
          release: 0.08,
          volume: -6,
        }),
        rim: makeNoiseVoice({
          noiseType: "white",
          filterType: "highpass",
          frequency: 4500,
          q: 0.8,
          decay: 0.07,
          release: 0.04,
          volume: -10,
        }),
        dispose() {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };
  }
}
