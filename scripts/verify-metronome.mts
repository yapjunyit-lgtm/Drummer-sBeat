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
} from "../src/lib/metronome.ts";

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
