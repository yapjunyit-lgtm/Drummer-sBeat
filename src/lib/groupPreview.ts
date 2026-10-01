"use client";

import * as Tone from "tone";
import { buildDrumVoices } from "@/lib/drumVoices";
import { SLOTS_PER_BEAT, type RhythmGroup } from "@/lib/projects";

/* Shared one-shot audio engine for previewing rhythm groups (鼓心 / 鼓边 /
   鼓棒), matching the sounds used by the main editor. */
let engine: ReturnType<typeof buildDrumVoices> | null = null;
let finishResolve: (() => void) | null = null;

function ensureEngine() {
  return (engine ??= buildDrumVoices());
}

/* Play a group once at the given BPM. Resolves when playback finishes. */
export async function previewGroup(
  group: RhythmGroup,
  bpm = 120
): Promise<void> {
  await Tone.start();
  const eng = await ensureEngine();

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
      if (n.zone === "center") eng.center.triggerAttackRelease("8n", t);
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
