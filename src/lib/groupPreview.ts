"use client";

import * as Tone from "tone";
import { SLOTS_PER_BEAT, type RhythmGroup } from "@/lib/projects";

/* Shared one-shot audio engine for previewing rhythm groups (鼓心 / 鼓边 /
   鼓圆), matching the sounds used by the main editor. */
let engine: {
  center: Tone.MembraneSynth;
  edge: Tone.NoiseSynth;
  rim: Tone.NoiseSynth;
} | null = null;
let finishResolve: (() => void) | null = null;

function ensureEngine() {
  if (engine) return engine;

  const center = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.2 },
  }).toDestination();
  center.volume.value = -4;

  const edgeFilter = new Tone.Filter({
    type: "bandpass",
    frequency: 1800,
    Q: 1.2,
  }).toDestination();
  const edge = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
  }).connect(edgeFilter);
  edge.volume.value = -6;

  const rimFilter = new Tone.Filter({
    type: "highpass",
    frequency: 4500,
    Q: 0.8,
  }).toDestination();
  const rim = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.04 },
  }).connect(rimFilter);
  rim.volume.value = -10;

  engine = { center, edge, rim };
  return engine;
}

/* Play a group once at the given BPM. Resolves when playback finishes. */
export async function previewGroup(
  group: RhythmGroup,
  bpm = 120
): Promise<void> {
  await Tone.start();
  const eng = ensureEngine();

  // Interrupt any preview that is still playing.
  Tone.Transport.stop();
  Tone.Transport.cancel();
  if (finishResolve) finishResolve();

  Tone.Transport.bpm.value = bpm;
  Tone.Transport.seconds = 0;

  const beat = 60 / bpm;
  const notes: { measure: number; slot: number; zone: string }[] = [];
  group.measures.forEach((mSlots, m) =>
    mSlots.forEach((s) =>
      notes.push({ measure: m, slot: s.slot, zone: s.zone })
    )
  );
  notes.sort((a, b) => a.measure - b.measure || a.slot - b.slot);

  // Tone.Transport requires strictly increasing times.
  const scheduled = notes.filter(
    (n, i, arr) =>
      i === 0 || n.measure !== arr[i - 1].measure || n.slot !== arr[i - 1].slot
  );

  for (const n of scheduled) {
    const time = (n.measure * 4 + n.slot / SLOTS_PER_BEAT) * beat;
    Tone.Transport.schedule((t) => {
      if (n.zone === "center") eng.center.triggerAttackRelease("C2", "8n", t);
      else if (n.zone === "edge") eng.edge.triggerAttackRelease("8n", t);
      else eng.rim.triggerAttackRelease("32n", t);
    }, time);
  }

  const total = group.measures.length * 4 * beat;
  return new Promise<void>((resolve) => {
    finishResolve = () => {
      finishResolve = null;
      resolve();
    };
    Tone.Transport.schedule(() => {
      Tone.Transport.stop();
      finishResolve?.();
    }, total + 0.02);
    Tone.Transport.start();
  });
}
