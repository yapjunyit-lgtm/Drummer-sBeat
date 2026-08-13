/* Shared 24 Festive Drums notation helpers used by the main score and the
   group editor: zone config, notehead glyphs, rests, beat patterns, and the
   VexFlow tickable builder (beams + tuplets are generated automatically). */

import type * as VexFlow from "vexflow";
import {
  SLOTS,
  SLOTS_PER_BEAT,
  SPAN,
  type DurationId,
  type ScoreNote,
  type ZoneId,
} from "@/lib/projects";

/* All zones share one staff line (e/4) so the notes sit aligned and low,
   balanced against the measure. The zones are told apart by their notehead
   shapes (● ✕ ▷), not by height. */
export const ZONES: {
  id: ZoneId;
  zh: string;
  en: string;
  key: string;
  symbol: string;
  cellClass: string;
}[] = [
  {
    id: "center",
    zh: "鼓心",
    en: "Drum Center",
    key: "e/4",
    symbol: "●",
    cellClass: "bg-red-500/80 border-red-400",
  },
  {
    id: "edge",
    zh: "鼓边",
    en: "Drum Edge",
    key: "e/4",
    symbol: "✕",
    cellClass: "bg-amber-500/80 border-amber-400",
  },
  {
    id: "rim",
    zh: "鼓棒",
    en: "Drumstick",
    key: "e/4",
    symbol: "▷",
    cellClass: "bg-sky-500/80 border-sky-400",
  },
];

/* Noteheads (from the MuseScore tutorial's drumset): center = normal round
   head, edge = X head, rim = right-pointing triangle. SMuFL code points:
   noteheadXBlack / noteheadTriangleRightWhite. */
export const NOTEHEAD_GLYPH: Record<ZoneId, string> = {
  center: "",
  edge: "\uE0A9",
  rim: "\uE0C1",
};

export const VEX_DURATION: Record<DurationId, string> = {
  1: "1",
  2: "2",
  q: "q",
  8: "8",
  16: "16",
  32: "32",
  "8t": "8",
};

/* Notes render at 13pt instead of VexFlow's 30pt default — compact enough
   that dense rhythms (e.g. 16 sixteenths) fit a fixed measure, and small
   enough that the first measure's notes clear the 4/4 time signature
   without squeezing the note area or shrinking the input boxes. */
const NOTE_FONT_SIZE = 13;

/* Largest rest that fits a gap: whole → half → quarter → eighth → 16th → 32nd. */
export const REST_ORDER: { vex: string; slots: number }[] = [
  { vex: "1r", slots: 96 },
  { vex: "2r", slots: 48 },
  { vex: "qr", slots: 24 },
  { vex: "8r", slots: 12 },
  { vex: "16r", slots: 6 },
  { vex: "32r", slots: 3 },
];

/* Beat-Block system: drummers pick “how many hits per beat” instead of note
   values. Offsets are within one beat (24 steps of the 96-step measure). */
export type PatternId =
  | "single"
  | "duplet"
  | "triplet"
  | "quad"
  | "fastSlow"
  | "slowFast"
  | "rest"
  | "halfRest"
  | "quadCCEE"
  | "quadCECE"
  | "quadCEEC"
  | "tripletCEE";

export const PATTERNS: {
  id: PatternId;
  label: string;
  short: string;
  span: number; // 24 = one beat, 12 = half beat
  hits: { offset: number; duration: DurationId }[];
  /** Optional per-hit zones for mixed presets (e.g. ●●▲▲). When absent,
      every hit takes the currently selected zone. */
  zones?: ZoneId[];
}[] = [
  {
    id: "single",
    label: "单音 1击/拍",
    short: "1",
    span: SLOTS_PER_BEAT,
    hits: [{ offset: 0, duration: "q" }],
  },
  {
    id: "duplet",
    label: "二连音 2击/拍",
    short: "2",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "8" },
      { offset: 12, duration: "8" },
    ],
  },
  {
    id: "triplet",
    label: "三连音 3击/拍",
    short: "3",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "8t" },
      { offset: 8, duration: "8t" },
      { offset: 16, duration: "8t" },
    ],
  },
  {
    id: "quad",
    label: "四连音 4击/拍",
    short: "4",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "16" },
      { offset: 6, duration: "16" },
      { offset: 12, duration: "16" },
      { offset: 18, duration: "16" },
    ],
  },
  {
    id: "fastSlow",
    label: "前快后慢",
    short: "≫",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "16" },
      { offset: 6, duration: "16" },
      { offset: 12, duration: "8" },
    ],
  },
  {
    id: "slowFast",
    label: "前慢后快",
    short: "≪",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "8" },
      { offset: 12, duration: "16" },
      { offset: 18, duration: "16" },
    ],
  },
  {
    id: "rest",
    label: "空拍",
    short: "𝄽",
    span: SLOTS_PER_BEAT,
    hits: [],
  },
  {
    id: "halfRest",
    label: "半空拍",
    short: "𝄾",
    span: 12,
    hits: [],
  },
  {
    id: "quadCCEE",
    label: "前心后边",
    short: "●●▲▲",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "16" },
      { offset: 6, duration: "16" },
      { offset: 12, duration: "16" },
      { offset: 18, duration: "16" },
    ],
    zones: ["center", "center", "edge", "edge"],
  },
  {
    id: "quadCECE",
    label: "交替",
    short: "●▲●▲",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "16" },
      { offset: 6, duration: "16" },
      { offset: 12, duration: "16" },
      { offset: 18, duration: "16" },
    ],
    zones: ["center", "edge", "center", "edge"],
  },
  {
    id: "quadCEEC",
    label: "心边边心",
    short: "●▲▲●",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "16" },
      { offset: 6, duration: "16" },
      { offset: 12, duration: "16" },
      { offset: 18, duration: "16" },
    ],
    zones: ["center", "edge", "edge", "center"],
  },
  {
    id: "tripletCEE",
    label: "心边边",
    short: "●▲▲",
    span: SLOTS_PER_BEAT,
    hits: [
      { offset: 0, duration: "8t" },
      { offset: 8, duration: "8t" },
      { offset: 16, duration: "8t" },
    ],
    zones: ["center", "edge", "edge"],
  },
];

/* Build the VexFlow tickables for one measure: notes sorted by slot, standard
   rests for gaps, triplet groups (bracket + number), and beamed runs of
   8ths/16ths/32nds. Callers draw the voice, then the returned tuplets/beams. */
export function buildMeasureTickables(
  measureNotes: ScoreNote[],
  VF: typeof VexFlow
): {
  tickables: VexFlow.StaveNote[];
  tuplets: VexFlow.Tuplet[];
  beams: VexFlow.Beam[];
  /** Grid metadata for each tickable (slot + span in the 96-step measure),
      so the renderer can centre every note/rest on its input box. */
  positions: {
    tickable: VexFlow.StaveNote;
    slot: number;
    span: number;
  }[];
} {
  const sorted = [...measureNotes].sort(
    (a, b) => a.slot - b.slot || SPAN[b.duration] - SPAN[a.duration]
  );
  const tickables: VexFlow.StaveNote[] = [];
  const tuplets: VexFlow.Tuplet[] = [];
  const beams: VexFlow.Beam[] = [];
  const positions: {
    tickable: VexFlow.StaveNote;
    slot: number;
    span: number;
  }[] = [];
  let beamRun: { sn: VexFlow.StaveNote; dur: DurationId }[] = [];

  const flushBeam = () => {
    if (beamRun.length >= 2) {
      beams.push(new VF.Beam(beamRun.map((b) => b.sn)));
    }
    beamRun = [];
  };

  const addStaveNote = (note: ScoreNote, span = SPAN[note.duration]) => {
    const zone = ZONES.find((z) => z.id === note.zone)!;
    const sn = new VF.StaveNote({
      keys: [zone.key],
      duration:
        note.duration === "8t" ? "8" : VEX_DURATION[note.duration],
    });
    sn.setFont({ size: NOTE_FONT_SIZE });
    // Shorten the stems (default is 35px) so each note stays compact and
    // the row doesn't look tall.
    sn.setStemLength(22);
    // These percussion notes float on the lowest staff line, so point their
    // stems upward; downward stems would run through the input boxes that
    // sit just below the notes. (setStemDirection snapshots the stem
    // extension, so it must run AFTER setStemLength.)
    sn.setStemDirection(1);
    // Noteheads are built in the constructor with the default font, so apply
    // the smaller size to each head directly (this also shrinks their widths,
    // letting dense rhythms fit a fixed measure).
    for (const nh of sn.noteHeads) nh.setFont({ size: NOTE_FONT_SIZE });
    const glyph = NOTEHEAD_GLYPH[note.zone];
    if (glyph && sn.noteHeads.length > 0) {
      sn.noteHeads[0].text = glyph;
    }
    tickables.push(sn);
    positions.push({
      tickable: sn,
      slot: note.slot,
      span,
    });
    return sn;
  };

  const addRest = (gap: number, from: number) => {
    let left = gap;
    let at = from;
    for (const r of REST_ORDER) {
      while (left >= r.slots) {
        const rest = new VF.StaveNote({ keys: ["e/4"], duration: r.vex });
        rest.setFont({ size: NOTE_FONT_SIZE });
        for (const nh of rest.noteHeads) nh.setFont({ size: NOTE_FONT_SIZE });
        tickables.push(rest);
        positions.push({ tickable: rest, slot: at, span: r.slots });
        at += r.slots;
        left -= r.slots;
      }
    }
  };

  let cursor = 0;
  for (const note of sorted) {
    if (note.slot > cursor) {
      flushBeam();
      addRest(note.slot - cursor, cursor);
    }
    if (note.slot < cursor) continue; // already covered

    if (note.duration === "8t" && note.slot % SLOTS_PER_BEAT === 0) {
      flushBeam();
      const run = sorted.filter(
        (n) =>
          n.duration === "8t" &&
          n.slot >= note.slot &&
          n.slot < note.slot + SLOTS_PER_BEAT
      );
      if (run.length === 3) {
        const tripletNotes = run.map((n) => addStaveNote(n, 8));
        tuplets.push(
          new VF.Tuplet(tripletNotes, {
            numNotes: 3,
            notesOccupied: 2,
            bracketed: true,
            ratioed: false,
          })
        );
        cursor = note.slot + SLOTS_PER_BEAT;
        continue;
      }
    }

    const sn = addStaveNote(
      note,
      note.duration === "8t" ? 12 : SPAN[note.duration]
    );
    // An orphaned triplet note is drawn as a normal eighth note, so it must
    // also occupy an eighth's worth of grid space; otherwise the trailing
    // rest overfills the 4/4 measure ("Too many ticks").
    cursor = note.slot + (note.duration === "8t" ? 12 : SPAN[note.duration]);
    const d = note.duration;
    if (d === "8" || d === "16" || d === "32") {
      if (beamRun.length > 0 && beamRun[beamRun.length - 1].dur !== d) {
        flushBeam();
      }
      beamRun.push({ sn, dur: d });
    } else {
      flushBeam();
    }
  }
  flushBeam();
  if (cursor < SLOTS) addRest(SLOTS - cursor, cursor);

  return { tickables, tuplets, beams, positions };
}
