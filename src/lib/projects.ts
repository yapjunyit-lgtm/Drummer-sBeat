/* Drummer's Beat · project store (localStorage until Supabase lands) */

import { scopedKey } from "@/lib/userScope";

export type ZoneId = "center" | "edge" | "rim";
export type DurationId = "1" | "2" | "q" | "8" | "16" | "32" | "8t";

/* One 4/4 measure is a 96-step grid (24 steps per beat), so whole notes,
   half notes, quarters, eighths, sixteenths, thirty-seconds and eighth-note
   triplets all fit as whole step counts. */
export const SLOTS = 96;
export const SLOTS_PER_BEAT = 24;
export const SPAN: Record<DurationId, number> = {
  1: 96,
  2: 48,
  q: 24,
  8: 12,
  16: 6,
  32: 3,
  "8t": 8,
};

export interface ScoreNote {
  id: string;
  measure: number; // 0-based measure index
  slot: number; // position in the 96-step measure grid (0..95)
  zone: ZoneId;
  duration: DurationId;
  /** 0-based drummer index. Multiple drummers play together, like a drum
      ensemble. Missing means drummer 0. */
  part?: number;
}

export interface RhythmGroupSlot {
  slot: number;
  zone: ZoneId;
  duration: DurationId;
}

export interface RhythmGroup {
  id: string;
  name: string;
  /** One array per measure; each measure is the 96-step grid. */
  measures: RhythmGroupSlot[][];
}

/** A text note/comment anchored to a measure (like MuseScore staff text). */
export interface ScoreAnnotation {
  id: string;
  measure: number; // 0-based measure index
  text: string;
  part?: number; // which drummer row the note belongs to (default 0)
  /** note = staff text comment; heading = section heading (listed in the
      score's table of contents). Both are freely placeable. */
  kind?: "note" | "heading";
  /** Free placement: page index + exact coordinates on the page. When
      present, the note is drawn at this position; otherwise it anchors to
      the measure row above. */
  page?: number;
  x?: number;
  y?: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  author?: string;
  authorRole?: "transcribed" | "music" | "custom";
  /** Visibility in the cloud community hub (private until published). */
  visibility?: "private" | "public";
  /** Cloud collaboration metadata (set when loaded from / pushed to Supabase). */
  ownerId?: string;
  revision?: number;
  cloudRole?: "owner" | "editor" | "viewer" | "local";
  /** How many drummers the score has (default 1). */
  drummers?: number;
  /** Per-drummer volume 0-100, parallel to drummers (default all 100). */
  drummerVolumes?: number[];
  /** Per-drummer UI color (hex), parallel to drummers. Used to label and
      distinguish drummer rows in the score (like track colors in a DAW). */
  drummerColors?: string[];
  /** Per measure, the ordered list of active drummer indices (0-based).
      Measures not listed (or listed as empty) default to every drummer.
      Inactive drummers are hidden in that measure and stay silent — the
      same idea as MuseScore hiding empty staves. */
  measureDrummers?: number[][];
  /** Text notes/comments attached to measures. */
  annotations?: ScoreAnnotation[];
  bpm: number;
  measures: number;
  notes: ScoreNote[];
  groups: RhythmGroup[];
  createdAt: number;
  updatedAt: number;
  /** 1 = legacy 8-step grid, 2 = 96-step grid. Missing means legacy. */
  schema?: 1 | 2;
}

const PROJECTS_KEY = "drummers-beat:projects:v1";
const ACTIVE_KEY = "drummers-beat:active-project:v1";
const LEGACY_DRAFT_KEY = "drummers-beat:stave-draft:v1";

const projectsKey = () => scopedKey(PROJECTS_KEY);
const activeKey = () => scopedKey(ACTIVE_KEY);
const draftKey = () => scopedKey(LEGACY_DRAFT_KEY);

const MAX_MEASURES = 72;

export const DEFAULT_DRUMMER_COLORS = [
  "#fbbf24", // Drummer 1 · amber
  "#22d3ee", // Drummer 2 · cyan
  "#e879f9", // Drummer 3 · fuchsia
  "#a3e635", // Drummer 4 · lime
  "#fb923c", // Drummer 5 · orange
  "#a78bfa", // Drummer 6 · violet
  "#34d399", // Drummer 7 · emerald
  "#fb7185", // Drummer 8 · rose
];

export function drummerColor(
  project: Pick<Project, "drummerColors">,
  part: number
): string {
  return (
    project.drummerColors?.[part] ??
    DEFAULT_DRUMMER_COLORS[part % DEFAULT_DRUMMER_COLORS.length]
  );
}

export function createProject(name: string): Project {
  return {
    id: crypto.randomUUID(),
    name,
    description: "",
    author: "",
    authorRole: "custom",
    drummers: 1,
    drummerVolumes: [60],
    drummerColors: [],
    measureDrummers: [],
    annotations: [],
    bpm: 120,
    measures: 4,
    notes: [],
    groups: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    schema: 2,
  };
}

/* Merge several projects into one combined score: measures are concatenated
   in the given order (drummer parts preserved), so the result renders and
   exports as a single PDF-style score book. */
export function combineProjects(
  name: string,
  ordered: Project[]
): Project {
  const maxDrummers = Math.max(1, ...ordered.map((p) => p.drummers ?? 1));
  const notes: ScoreNote[] = [];
  const measureDrummers: number[][] = [];
  const annotations: ScoreAnnotation[] = [];
  let offset = 0;
  for (const src of ordered) {
    for (const n of src.notes) {
      notes.push({
        ...n,
        id: crypto.randomUUID(),
        measure: n.measure + offset,
      });
    }
    for (let m = 0; m < src.measures; m++) {
      measureDrummers.push(
        activeDrummersForMeasure(src, m).filter((i) => i < maxDrummers)
      );
    }
    for (const a of src.annotations ?? []) {
      annotations.push({
        ...a,
        id: crypto.randomUUID(),
        measure: a.measure + offset,
      });
    }
    offset += src.measures;
  }
  const first = ordered[0];
  return {
    id: crypto.randomUUID(),
    name,
    description: `Combined from ${ordered.length} projects 由 ${ordered.length} 个项目合并`,
    author: first?.author ?? "",
    authorRole: first?.authorRole ?? "custom",
    drummers: maxDrummers,
    drummerVolumes: Array.from({ length: maxDrummers }, () => 60),
    drummerColors: Array.from(
      { length: maxDrummers },
      (_, i) => DEFAULT_DRUMMER_COLORS[i % DEFAULT_DRUMMER_COLORS.length]
    ),
    measureDrummers,
    annotations,
    bpm: first?.bpm ?? 120,
    measures: offset,
    notes,
    groups: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    schema: 2,
  };
}

/* Which drummers play in a measure. Missing/empty entries mean "every
   drummer", so existing projects keep working without migration. */
export function activeDrummersForMeasure(
  project: Pick<Project, "drummers" | "measureDrummers">,
  measure: number
): number[] {
  const count = Math.max(1, project.drummers ?? 1);
  const list = project.measureDrummers?.[measure];
  if (Array.isArray(list) && list.length > 0) {
    return [...new Set(list)]
      .filter((i) => i >= 0 && i < count)
      .sort((a, b) => a - b);
  }
  return Array.from({ length: count }, (_, i) => i);
}

/* Materialise a full measureDrummers grid (one entry per measure), so
   callers can mutate a single measure without guessing at defaults. */
export function materializeMeasureDrummers(
  project: Pick<Project, "drummers" | "measureDrummers" | "measures">,
  measures = project.measures
): number[][] {
  return Array.from({ length: measures }, (_, m) =>
    activeDrummersForMeasure(project, m)
  );
}

/* Migrate projects saved on the old eighth-note grid (8 steps/measure) to
   the 96-step grid by scaling every slot by 12. */
export function migrateProjectSchema(project: Project): Project {
  const scale = project.schema === 2 ? 1 : 12;
  const groups: RhythmGroup[] = project.groups.map((g) => {
    const legacy = (g as { slots?: RhythmGroupSlot[] }).slots;
    const measures = Array.isArray(g.measures)
      ? g.measures
      : legacy
        ? [legacy]
        : [];
    return {
      ...g,
      measures:
        scale === 1
          ? measures
          : measures.map((m) =>
              m.map((s) => ({ ...s, slot: Math.round(s.slot * scale) }))
            ),
    };
  });
  return {
    ...project,
    schema: 2,
    notes:
      scale === 1
        ? project.notes
        : project.notes.map((n) => ({
            ...n,
            slot: Math.round(n.slot * scale),
          })),
    groups,
  };
}

function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.bpm === "number" &&
    typeof p.measures === "number" &&
    Array.isArray(p.notes) &&
    Array.isArray(p.groups)
  );
}

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(projectsKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProject).map(migrateProjectSchema);
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  try {
    localStorage.setItem(projectsKey(), JSON.stringify(projects));
  } catch {
    // Storage unavailable — ignore for MVP.
  }
}

export function loadActiveProjectId(): string | null {
  try {
    return localStorage.getItem(activeKey());
  } catch {
    return null;
  }
}

export function saveActiveProjectId(id: string): void {
  try {
    localStorage.setItem(activeKey(), id);
  } catch {
    // Storage unavailable — ignore for MVP.
  }
}

/* Migrate the pre-project single-draft format into a default project. */
export function migrateLegacyDraft(): Project | null {
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return null;
    const draft = JSON.parse(raw) as {
      bpm?: number;
      measures?: number;
      notes?: ScoreNote[];
    };
    if (!Array.isArray(draft.notes)) return null;

    const project = createProject("Untitled Project 未命名项目");
    project.bpm = typeof draft.bpm === "number" ? draft.bpm : 120;
    project.measures = Math.min(
      MAX_MEASURES,
      Math.max(1, draft.measures ?? 4)
    );
    project.notes = draft.notes
      .filter(
        (n) =>
          Number.isInteger(n.slot) &&
          n.slot >= 0 &&
          n.slot < 8 &&
          (n.measure === undefined ||
            (Number.isInteger(n.measure) &&
              n.measure >= 0 &&
              n.measure < project.measures)) &&
          (n.zone === "center" || n.zone === "edge" || n.zone === "rim") &&
          (n.duration === "q" || n.duration === "8")
      )
      .map((n) => ({
        ...n,
        measure: n.measure ?? 0,
        slot: n.slot * 12,
        id: crypto.randomUUID(),
      }));
    localStorage.removeItem(draftKey());
    return project;
  } catch {
    return null;
  }
}
