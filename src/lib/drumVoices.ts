"use client";

import * as Tone from "tone";
import { masterBus, ZONE_BASE_DB } from "@/lib/audioLevels";

export interface EngineZoneVoice {
  volume: Tone.Param<"decibels">;
  triggerAttackRelease: (duration: string, time?: number) => void;
  dispose: () => void;
}

/* Heart → gu-xin (center), Side → gu-bian (edge), Stick → gu-bang (rim).
   The supplied recordings are trimmed to one hit at their original pitch. */
async function buildSampleZoneVoice(
  url: string,
  volume: number,
  fallback: () => EngineZoneVoice
): Promise<EngineZoneVoice> {
  try {
    const buffer = await Tone.ToneAudioBuffer.fromUrl(url);
    const player = new Tone.Player({ url: buffer, loop: false });
    const out = new Tone.Volume(volume).connect(masterBus());
    player.connect(out);
    return {
      volume: out.volume,
      triggerAttackRelease: (_duration, time) => player.start(time ?? Tone.now()),
      dispose: () => {
        player.dispose();
        buffer.dispose();
        out.dispose();
      },
    };
  } catch {
    return fallback();
  }
}

function buildSynthCenterVoice(): EngineZoneVoice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.2 },
  }).connect(masterBus());
  synth.volume.value = ZONE_BASE_DB.center;
  return {
    volume: synth.volume,
    triggerAttackRelease: (duration, time) =>
      synth.triggerAttackRelease("C2", duration, time),
    dispose: () => synth.dispose(),
  };
}

function buildSynthEdgeVoice(): EngineZoneVoice {
  const filter = new Tone.Filter({
    type: "bandpass",
    frequency: 1800,
    Q: 1.2,
  }).connect(masterBus());
  const noise = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
  }).connect(filter);
  noise.volume.value = ZONE_BASE_DB.edge;
  return {
    volume: noise.volume,
    triggerAttackRelease: (duration, time) =>
      noise.triggerAttackRelease(duration, time),
    dispose: () => {
      noise.dispose();
      filter.dispose();
    },
  };
}

function buildSynthRimVoice(): EngineZoneVoice {
  const rimOut = new Tone.Volume(ZONE_BASE_DB.rim).connect(masterBus());
  const rimNoise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.022, sustain: 0, release: 0.015 },
  });
  const rimHp = new Tone.Filter({
    type: "highpass",
    frequency: 5000,
    Q: 0.7,
  });
  rimNoise.chain(rimHp, rimOut);
  const rimTick = new Tone.Oscillator({ type: "sine", frequency: 2400 });
  const rimTickEnv = new Tone.AmplitudeEnvelope({
    attack: 0.001,
    decay: 0.022,
    sustain: 0,
    release: 0.015,
  });
  rimTick.chain(rimTickEnv, rimOut);
  rimTick.start();
  return {
    volume: rimOut.volume,
    triggerAttackRelease: (duration: string, time?: number) => {
      rimNoise.triggerAttackRelease(duration, time);
      rimTickEnv.triggerAttackRelease(0.022, time);
    },
    dispose: () => {
      rimNoise.dispose();
      rimHp.dispose();
      rimTick.dispose();
      rimTickEnv.dispose();
      rimOut.dispose();
    },
  };
}

/* Independent voices keep each drummer's volume separate. */
export async function buildDrumVoices() {
  const [center, edge, rim] = await Promise.all([
    buildSampleZoneVoice(
      "/samples/gu-xin.wav", ZONE_BASE_DB.center, buildSynthCenterVoice
    ),
    buildSampleZoneVoice(
      "/samples/gu-bian.wav", ZONE_BASE_DB.edge, buildSynthEdgeVoice
    ),
    buildSampleZoneVoice(
      "/samples/gu-bang.wav", ZONE_BASE_DB.rim, buildSynthRimVoice
    ),
  ]);
  return { center, edge, rim };
}
