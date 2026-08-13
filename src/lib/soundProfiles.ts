/* Sound profile definitions + Tone.js voice builders for the Sound Lab
   (试听) page. All voices share one API: triggerAttackRelease(duration, time).

   The three characters follow the drummers' onomatopoeia:
     鼓心 = "Dong" — deep pitched bass-drum thump
     鼓边 = "Dak"  — sharp crack, like a wooden stick breaking
     鼓棒 = "Dik"  — two sticks clicking together (dry wood tick)
*/

import * as Tone from "tone";

export interface ZoneVoice {
  volume: Tone.Param<"decibels">;
  triggerAttackRelease: (duration: string, time?: number) => void;
  dispose: () => void;
}

export interface VoiceSet {
  center: ZoneVoice;
  edge: ZoneVoice;
  rim: ZoneVoice;
  dispose: () => void;
}

export interface SoundProfile {
  id: string;
  name: string;
  zh: string;
  description: string;
}

export const SOUND_PROFILES: SoundProfile[] = [
  {
    id: "realKit",
    name: "Real Kit",
    zh: "实鼓采样",
    description:
      "Single hits from the Chinese kit: 鼓心 pitched down + lowpassed for more bass, 鼓边 pitched up + highpassed for extra brightness, dry 鼓棒 tick.",
  },
  {
    id: "current",
    name: "Current",
    zh: "当前音色",
    description:
      "The engine as deployed now: C2 membrane 鼓心, pink-noise 鼓边, white-noise 鼓棒.",
  },
  {
    id: "dongDakDik",
    name: "Dong · Dak · Dik",
    zh: "咚 · 哒 · 嘀",
    description:
      "鼓心 Dong: deep bass-drum thump. 鼓边 Dak: sharp wooden crack. 鼓棒 Dik: dry two-stick click.",
  },
  {
    id: "dongDakDikDeep",
    name: "Dong · Dak · Dik (Deep)",
    zh: "咚 · 哒 · 嘀（低沉）",
    description:
      "A lower, longer-ringing Dong; a brighter, more piercing Dak; a drier, higher Dik.",
  },
  {
    id: "dongDakDikSnappy",
    name: "Dong · Dak · Dik (Snappy)",
    zh: "咚 · 哒 · 嘀（清脆）",
    description:
      "A punchy, short Dong; a very tight Dak crack; an ultra-short Dik tick.",
  },
];

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

/* A single drum hit loaded from public/samples (one clean hit per file). */
async function makeSampleVoice(
  url: string,
  volume: number,
  opts?: {
    /** Slower playback = lower pitch (bassier); faster = brighter. */
    playbackRate?: number;
    lowpass?: number;
    highpass?: number;
  }
): Promise<ZoneVoice | null> {
  try {
    // Load the buffer first (await the promise) — player.loaded is a
    // boolean, not a Promise, so awaiting it returned instantly.
    const buffer = await Tone.ToneAudioBuffer.fromUrl(url);
    const player = new Tone.Player({
      url: buffer,
      loop: false,
      playbackRate: opts?.playbackRate ?? 1,
    });
    const out = new Tone.Volume(volume).toDestination();
    const fx: Tone.ToneAudioNode[] = [];
    if (opts?.lowpass) {
      fx.push(
        new Tone.Filter({ type: "lowpass", frequency: opts.lowpass, Q: 0.7 })
      );
    }
    if (opts?.highpass) {
      fx.push(
        new Tone.Filter({ type: "highpass", frequency: opts.highpass, Q: 0.7 })
      );
    }
    player.chain(...fx, out);
    return {
      volume: out.volume,
      triggerAttackRelease: (_duration, time) =>
        player.start(time ?? Tone.now()),
      dispose: () => {
        player.dispose();
        for (const f of fx) f.dispose();
        out.dispose();
      },
    };
  } catch {
    return null;
  }
}

function makeMembraneVoice(opts: {
  pitch: string;
  pitchDecay: number;
  octaves: number;
  decay: number;
  release: number;
  volume: number;
}): ZoneVoice {
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
  return {
    volume: synth.volume,
    triggerAttackRelease: (duration, time) =>
      synth.triggerAttackRelease(opts.pitch, duration, time),
    dispose: () => synth.dispose(),
  };
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

/* Noise crack + a short tonal ping (wood body / stick pitch). */
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
      release: 0.015,
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
        p.env.triggerAttackRelease(Math.max(0.015, p.decay), time);
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

export async function buildVoiceSet(profileId: string): Promise<VoiceSet> {
  if (profileId === "realKit") {
    const center =
      (await makeSampleVoice("/samples/gu-xin.wav", -5, {
        // More solid: keep the deep pitch but let the mid body through so
        // the hit has a defined punch instead of a muddy rumble.
        playbackRate: 0.9,
        lowpass: 800,
      })) ??
      makeMembraneVoice({
        pitch: "C2",
        pitchDecay: 0.05,
        octaves: 3,
        decay: 0.45,
        release: 0.2,
        volume: -4,
      });
    const edge =
      (await makeSampleVoice("/samples/gu-bian.wav", -3, {
        // Brighter: pitch up ~2 semitones + highpass.
        playbackRate: 1.12,
        highpass: 2100,
      })) ??
      makeNoiseVoice({
        noiseType: "pink",
        filterType: "bandpass",
        frequency: 1800,
        q: 1.2,
        decay: 0.18,
        release: 0.08,
        volume: -2,
      });
    const rim =
      (await makeSampleVoice("/samples/gu-bang.wav", -11)) ??
      makeLayeredVoice({
        noiseType: "white",
        filterType: "highpass",
        frequency: 5000,
        q: 0.7,
        decay: 0.022,
        release: 0.015,
        volume: -11,
        tones: [{ type: "sine", frequency: 2400, decay: 0.022 }],
      });
    return {
      center,
      edge,
      rim,
      dispose() {
        center.dispose();
        edge.dispose();
        rim.dispose();
      },
    };
  }
  switch (profileId) {
    case "dongDakDik":
      return {
        // Dong: pitched bass-drum thump with a clear low fundamental.
        center: makeMembraneVoice({
          pitch: "D2",
          pitchDecay: 0.05,
          octaves: 3,
          decay: 0.55,
          release: 0.2,
          volume: -5,
        }),
        // Dak: woody crack — short band-passed noise + a low wood body ping.
        edge: makeLayeredVoice({
          noiseType: "pink",
          filterType: "bandpass",
          frequency: 1800,
          q: 1.6,
          decay: 0.06,
          release: 0.03,
          volume: -7,
          tones: [{ type: "sine", frequency: 900, decay: 0.045 }],
        }),
        // Dik: dry two-stick click — very short noise + high wood tick.
        rim: makeLayeredVoice({
          noiseType: "white",
          filterType: "highpass",
          frequency: 5000,
          q: 0.7,
          decay: 0.022,
          release: 0.015,
          volume: -11,
          tones: [{ type: "sine", frequency: 2400, decay: 0.022 }],
        }),
        dispose(this: VoiceSet) {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };

    case "dongDakDikDeep":
      return {
        // Dong: lower and longer — a big bass drum.
        center: makeMembraneVoice({
          pitch: "G1",
          pitchDecay: 0.08,
          octaves: 3,
          decay: 0.75,
          release: 0.3,
          volume: -5,
        }),
        // Dak: brighter, more piercing crack.
        edge: makeLayeredVoice({
          noiseType: "pink",
          filterType: "bandpass",
          frequency: 2600,
          q: 2,
          decay: 0.07,
          release: 0.03,
          volume: -7,
          tones: [{ type: "sine", frequency: 1200, decay: 0.05 }],
        }),
        // Dik: drier and higher.
        rim: makeLayeredVoice({
          noiseType: "white",
          filterType: "highpass",
          frequency: 6000,
          q: 0.7,
          decay: 0.02,
          release: 0.012,
          volume: -11,
          tones: [{ type: "sine", frequency: 3000, decay: 0.018 }],
        }),
        dispose(this: VoiceSet) {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };

    case "dongDakDikSnappy":
      return {
        // Dong: punchy and short.
        center: makeMembraneVoice({
          pitch: "D2",
          pitchDecay: 0.03,
          octaves: 3,
          decay: 0.35,
          release: 0.12,
          volume: -5,
        }),
        // Dak: very tight crack.
        edge: makeLayeredVoice({
          noiseType: "pink",
          filterType: "bandpass",
          frequency: 2200,
          q: 2.5,
          decay: 0.04,
          release: 0.02,
          volume: -7,
          tones: [{ type: "sine", frequency: 1500, decay: 0.03 }],
        }),
        // Dik: ultra-short tick.
        rim: makeLayeredVoice({
          noiseType: "white",
          filterType: "highpass",
          frequency: 5500,
          q: 0.7,
          decay: 0.015,
          release: 0.01,
          volume: -11,
          tones: [{ type: "sine", frequency: 2600, decay: 0.015 }],
        }),
        dispose(this: VoiceSet) {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };

    case "current":
    default:
      return {
        center: makeMembraneVoice({
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
        dispose(this: VoiceSet) {
          this.center.dispose();
          this.edge.dispose();
          this.rim.dispose();
        },
      };
  }
}
