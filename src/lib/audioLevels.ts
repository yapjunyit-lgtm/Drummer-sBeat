/* Shared output levels for every drum voice in the app.

   Why this module exists: the samples themselves are fine (gu-xin peaks at
   -2.2 dBFS, gu-bian at -7.3 dBFS), but the voices used to attenuate by
   13-20 dB before they reached the speakers. At the default drummer volume
   (60) the effective levels were:

       鼓心 center  -13.6 dB      鼓边 edge  -11.6 dB
       鼓棒 rim     -19.6 dB

   which is why the score was barely audible even at full system volume. The
   levels below raise everything into a usable range and route every voice
   through one master bus (gain → brickwall limiter) so the extra level does
   not clip when several drummers hit at once. */

import * as Tone from "tone";

/** Overall output boost, applied once for the whole app. */
export const MASTER_GAIN_DB = 4;

/** Brickwall ceiling — leaves a hair of headroom so stacked hits can't clip. */
export const LIMITER_CEILING_DB = -1;

/** Per-zone level at drummer volume 100. The relationship keeps the approved
    balance (鼓边 a touch above 鼓心) while lifting the 鼓棒 click, which was
    the hardest of the three to hear. */
export const ZONE_BASE_DB = {
  center: 0,
  edge: 2,
  rim: -4,
} as const;

/** Drummer-volume curve. The per-drummer slider stays 0-100; 100 is unity
    gain and the old default of 60 now sits at -4.8 dB instead of -9.6 dB. */
export const DRUMMER_VOLUME_SPAN_DB = 12;

export function drummerVolumeDb(volume: number | undefined): number {
  return ((volume ?? 60) / 100) * DRUMMER_VOLUME_SPAN_DB - DRUMMER_VOLUME_SPAN_DB;
}

let masterBusNode: Tone.Volume | null = null;

/** The single master bus every voice connects to: gain → limiter → speakers.
    Created lazily so it is only built once audio has actually started. */
export function masterBus(): Tone.Volume {
  if (!masterBusNode) {
    const limiter = new Tone.Limiter(LIMITER_CEILING_DB).toDestination();
    masterBusNode = new Tone.Volume(MASTER_GAIN_DB).connect(limiter);
  }
  return masterBusNode;
}
