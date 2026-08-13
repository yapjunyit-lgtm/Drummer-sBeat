"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import * as Tone from "tone";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import CombineModal from "@/components/CombineModal";
import GroupEditorModal from "@/components/GroupEditorModal";
import GroupPreviewButton from "@/components/GroupPreviewButton";
import ScoreNoteModal from "@/components/ScoreNoteModal";
import ShareModal from "@/components/ShareModal";
import {
  claimShareInvite,
  cloudAvailable,
  parseCloudProject,
  pushProjectToCloud,
  subscribeScoreChanges,
  type SyncStatus,
} from "@/lib/cloud";
import { exportScorePdf } from "@/lib/exportPdf";
import {
  buildMeasureTickables,
  PATTERNS,
  ZONES,
  type PatternId,
} from "@/lib/notation";
import {
  activeDrummersForMeasure,
  createProject,
  DEFAULT_DRUMMER_COLORS,
  drummerColor,
  loadActiveProjectId,
  loadProjects,
  materializeMeasureDrummers,
  migrateLegacyDraft,
  saveActiveProjectId,
  saveProjects,
  SLOTS,
  SLOTS_PER_BEAT,
  SPAN,
  type DurationId,
  type Project,
  type RhythmGroup,
  type ScoreAnnotation,
  type ScoreNote,
  type ZoneId,
} from "@/lib/projects";
import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/* Domain types & constants                                            */
/* ------------------------------------------------------------------ */

type Selection = ZoneId | "eraser" | "note" | "select" | null;

interface StaveMetrics {
  measure: number;
  page: number;
  part: number;
  /** Measure origin and width — pure layout constants, so highlights line
      up exactly with the barlines regardless of VexFlow font metrics. */
  x: number;
  w: number;
  /** Note-area bounds (VexFlow), used only by click cells and the playhead. */
  startX: number;
  endX: number;
  /** Row origin and full grid pitch (DRUMMER_ROW_STEP), so the highlight
      tiles the ensemble rows with no gaps and no overlap. */
  y: number;
  height: number;
}

/* Rhythm palette: each entry is a duration (in 96 steps per measure) or a
   pattern. "8t" inserts a full-beat eighth-note triplet (3 hits). */
const DURATIONS: {
  id: DurationId;
  label: string;
  vex: string;
  slots: number;
  symbol: string;
}[] = [
  { id: "1", label: "Whole 全音符", vex: "1", slots: 96, symbol: "1" },
  { id: "2", label: "Half 二分音符", vex: "2", slots: 48, symbol: "2" },
  { id: "q", label: "Quarter 四分音符", vex: "q", slots: 24, symbol: "¼" },
  { id: "8", label: "Eighth 八分音符", vex: "8", slots: 12, symbol: "⅛" },
  { id: "16", label: "16th 十六分音符", vex: "16", slots: 6, symbol: "1/16" },
  { id: "32", label: "32nd 三十二分音符", vex: "32", slots: 3, symbol: "1/32" },
  { id: "8t", label: "Triplet 三连音", vex: "8", slots: 8, symbol: "3" },
];

const CELLS_PER_MEASURE = 8; // half-beat click targets per measure
const CELL_SLOTS = SLOTS / CELLS_PER_MEASURE; // 12 steps per click cell
const BEATS = 4;
const MEASURES_PER_SYSTEM = 4; // fixed measures per system line

const SYSTEMS_PER_PAGE = 14; // stave lines per PDF-style page
const PAGE_W = 860; // A4-ish page at screen scale
const PAGE_H = 1216;
const PAGE_MARGIN_X = 48;
/* Breathing room at the head (start) and back (end) of every measure's note
   area, so notes never crowd the clef/time signature or the end barline.
   Applied uniformly so spacing stays consistent across the whole row. */
const NOTE_AREA_INSET = 14;
const PAGE_MARGIN_TOP = 56;
const PAGE_MARGIN_BOTTOM = 64;
const ROW_H = 78; // tighter single-drummer rows (14 fit the A4 page height)
const DRUMMER_ROW_STEP = 102; // vertical pitch between stacked drummer rows
const SYSTEM_EXTRA = 24; // breathing room after a system's last row
/* Fixed gap between beats inside a measure, so neighbouring rhythm groups
   (e.g. 二连音 followed by 四连音) read as clearly separate. */
const BEAT_GAP = 7;
const MAX_MEASURES = 72; // 2 full pages at 9 systems × 4 measures each
/* Custom notehead glyphs (✕ / ▷) are drawn left-anchored with a fixed
   offset from their grid anchor at the 16pt note font; shifting them back by
   this amount centres the visible symbol on its input box. */
const NOTEHEAD_GLYPH_CENTER_FIX = 15;

const zoneById = (id: ZoneId) => ZONES.find((z) => z.id === id)!;

const overlaps = (n: ScoreNote, slot: number, span: number) =>
  !(slot + span <= n.slot || slot >= n.slot + SPAN[n.duration]);

/* Clamp a duration so it fits between a note's slot and the measure end. */
const fitDuration = (slot: number, requested: DurationId): DurationId => {
  if (slot + SPAN[requested] <= SLOTS) return requested;
  const remaining = SLOTS - slot;
  const best = DURATIONS.filter(
    (d) => d.id !== "8t" && d.slots <= remaining
  ).sort((a, b) => b.slots - a.slots)[0];
  return (best?.id ?? "32") as DurationId;
};

type DragItem = {
  kind: "zone" | "pattern" | "eraser" | "group";
  id: string;
};

/* ------------------------------------------------------------------ */
/* Palette item (draggable + clickable)                                */
/* ------------------------------------------------------------------ */

function PaletteItem({
  id,
  symbol,
  label,
  sub,
  selected,
  onClick,
}: {
  id: string;
  symbol: ReactNode;
  label: string;
  sub?: string;
  selected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={[
        "flex w-full cursor-grab items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors active:cursor-grabbing",
        selected
          ? "border-amber-500 bg-amber-500/10"
          : "border-zinc-700 bg-zinc-900 hover:border-zinc-500",
        isDragging && "opacity-40",
      ].join(" ")}
    >
      <span className="w-6 text-center text-xl leading-none">{symbol}</span>
      <span>
        <span className="block font-medium text-zinc-100">{label}</span>
        {sub && <span className="block text-xs text-zinc-500">{sub}</span>}
      </span>
    </button>
  );
}

/* Common Mix preset: shows the mixed-zone pattern as coloured dots so the
   combination (e.g. ●●▲▲) is obvious at a glance. */
/* ------------------------------------------------------------------ */
/* Categorized UI scaffolding                                          */
/* ------------------------------------------------------------------ */

/* A labelled cluster of controls for the top toolbar, so related actions
   (mode, clipboard, playback…) are grouped and quick to find. */
function ToolGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex min-w-0 flex-col gap-1 px-2 py-1",
        className ?? "",
      ].join(" ")}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {children}
      </div>
    </div>
  );
}

/* A collapsible sidebar category, so panels stay tidy and tools are one
   click away. */
function PanelSection({
  title,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
      >
        <span
          className={`text-[10px] transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        {title}
        {badge && (
          <span className="ml-auto rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

/* A compact icon tool for the ribbon (Select / Eraser / Note sit on one
   line). Keeps dnd-kit draggable so tools can be dropped onto the score. */
function CompactToolButton({
  id,
  symbol,
  label,
  selected,
  onClick,
}: {
  id: string;
  symbol: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      aria-pressed={selected}
      className={[
        "flex min-w-20 flex-1 cursor-grab items-center justify-center gap-1 rounded-lg border px-2 py-1 text-center transition-colors active:cursor-grabbing",
        selected
          ? "border-amber-500 bg-amber-500/15 text-amber-300"
          : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500",
        isDragging && "opacity-40",
      ].join(" ")}
    >
      <span className="text-sm leading-none">{symbol}</span>
      <span className="whitespace-nowrap text-xs font-semibold">{label}</span>
    </button>
  );
}

/* Toggle for the select tool: whole measures vs individual notes. */
function SelectModeToggle({
  mode,
  onChange,
  full,
}: {
  mode: "measure" | "note";
  onChange: (mode: "measure" | "note") => void;
  /** Full-width variant for the sidebar: the two options split 50/50. */
  full?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Select by 选择方式"
      className={[
        "flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5",
        full ? "w-full" : "",
      ].join(" ")}
    >
      <button
        onClick={() => onChange("measure")}
        aria-pressed={mode === "measure"}
        className={[
          "rounded-md px-2 py-1 text-center text-[11px] font-semibold transition-colors",
          full ? "flex-1" : "",
          mode === "measure"
            ? "bg-amber-500/15 text-amber-300"
            : "text-zinc-400 hover:text-zinc-200",
        ].join(" ")}
      >
        Measure 小节
      </button>
      <button
        onClick={() => onChange("note")}
        aria-pressed={mode === "note"}
        className={[
          "rounded-md px-2 py-1 text-center text-[11px] font-semibold transition-colors",
          full ? "flex-1" : "",
          mode === "note"
            ? "bg-amber-500/15 text-amber-300"
            : "text-zinc-400 hover:text-zinc-200",
        ].join(" ")}
      >
        Note 音符
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drop target for one eighth-note slot                                */
/* ------------------------------------------------------------------ */

function SlotCell({
  measure,
  index,
  part,
  metrics,
  note,
  isCurrent,
  onClick,
  fullWidth,
  isNoteSelected,
}: {
  measure: number;
  index: number;
  part: number;
  metrics: StaveMetrics;
  note: ScoreNote | undefined;
  isCurrent: boolean;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Selection mode: click targets span the whole measure, not just the
      note area, so clicking near a barline still selects the measure. */
  fullWidth?: boolean;
  /** Note-level selection highlight (select-by-note mode). */
  isNoteSelected?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${measure}:${index}:${part}`,
  });
  const uniformColW = (metrics.endX - metrics.startX) / CELLS_PER_MEASURE;
  const colW = fullWidth ? metrics.w / CELLS_PER_MEASURE : uniformColW;
  // A compact square target sitting just below the notes, so the score
  // itself stays visible while each beat slot is still clickable.
  const box = Math.min(20, Math.max(12, colW - 5));
  // Match the beat-aware note layout: half-beat cells are centred within
  // their beat's band, with the same gap between beats as the notes.
  const beat = Math.floor(index / 2);
  const inBeat = index % 2;
  const beatW = (metrics.endX - metrics.startX - 3 * BEAT_GAP) / 4;
  const cellW = beatW / 2;
  const cellLeft = fullWidth
    ? metrics.x + index * colW
    : metrics.startX + beat * (beatW + BEAT_GAP) + inBeat * cellW;
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      aria-label={`Measure ${measure + 1}, part ${part + 1}, half-beat slot ${
        index + 1
      }`}
      style={{
        left: cellLeft + (colW - box) / 2,
        // Anchor to the staff line (which sits 80px below the row top), not
        // the row bottom — so the boxes stay "just below the notes" even
        // when the row pitch is tightened.
        top: 90,
        width: box,
        height: box,
      }}
      className={[
        "pointer-events-auto absolute rounded-md border border-dashed transition-colors",
        note
          ? note.zone === "center"
            ? ZONES[0].cellClass
            : note.zone === "edge"
              ? ZONES[1].cellClass
              : ZONES[2].cellClass
          : "border-zinc-700/60 hover:bg-zinc-700/30",
        isOver && "bg-zinc-500/40",
        isCurrent && "ring-2 ring-cyan-300",
        isNoteSelected && "!bg-lime-400/45 ring-2 ring-lime-300",
      ].join(" ")}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export default function StaveEditor() {
  const router = useRouter();
  const { status: authStatus, user } = useAuth();
  // The editor is an interactive client island: VexFlow, @dnd-kit and
  // localStorage all depend on the browser, and @dnd-kit's auto-generated
  // aria-describedby IDs use a module counter that differs between SSR and
  // hydration. Rendering only after mount avoids hydration mismatches.
  const [mounted, setMounted] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Selection>("center");
  const [pattern, setPattern] = useState<PatternId>("single");
  const [paintMode, setPaintMode] = useState(true);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [groupEditorInitial, setGroupEditorInitial] = useState<string | null>(
    null
  );
  const [groupTab, setGroupTab] = useState<"project" | "yours">("project");
  const [captureMeasure, setCaptureMeasure] = useState(0);
  /* Measure whose drummer layout is being edited in the left sidebar. */
  const [layoutMeasure, setLayoutMeasure] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  /* Sidebar categories: which panels are expanded (quick access). */
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(["tools", "edit", "measureParts", "groups"])
  );
  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  /* Ribbon tab currently shown (Word-style). */
  const [activeTab, setActiveTab] = useState<
    "home" | "notes" | "ensemble" | "score"
  >("home");
  const [currentPage, setCurrentPage] = useState(0);
  const [pageScale, setPageScale] = useState(1);
  const [fitAvailW, setFitAvailW] = useState(0);
  /* View-mode display: manual zoom (null = fit to column) and page layout
     (single page, or two pages side by side). */
  const [viewZoom, setViewZoom] = useState<number | null>(null);
  const [viewLayout, setViewLayout] = useState<"single" | "double">("single");
  const [exporting, setExporting] = useState(false);
  const [combineOpen, setCombineOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [syncFlag, setSyncFlag] = useState<"idle" | "saving" | "error">("idle");
  /* Derived sync status: static states (local / signed-out / synced) are
     computed during render; only saving/error transitions are state. */
  const syncStatus: SyncStatus = !cloudAvailable()
    ? "local"
    : authStatus !== "signed-in"
      ? "signed-out"
      : syncFlag === "saving"
        ? "saving"
        : syncFlag === "error"
          ? "error"
          : "synced";
  const [viewMode, setViewMode] = useState(false);
  const [activePart, setActivePart] = useState(0);
  const [noteModal, setNoteModal] = useState<{
    open: boolean;
    measure: number;
    part: number;
    /** Free placement position (page index + page coordinates). */
    page?: number;
    x?: number;
    y?: number;
    /** When editing an existing note, its id. */
    editId?: string;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  /* "Play From" mode: after pressing the Play From button, the next note
     clicked on the score becomes the playback start point. */
  const [playFromArm, setPlayFromArm] = useState(false);
  /* Incremented on every play/stop so stale Tone draw callbacks (scheduled
     for future notes) can never resurrect the playhead after a stop. */
  const playTokenRef = useRef(0);
  const [playhead, setPlayhead] = useState<{
    measure: number;
    slot: number;
    part: number;
  } | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [metrics, setMetrics] = useState<StaveMetrics[] | null>(null);
  /* Selection & clipboard: highlighted rows ("measure:part"), the paste
     anchor row, and the copied note content. Rows — not whole measures —
     are the selectable unit, so D1 and D2 can be picked independently. */
  const [selectedRows, setSelectedRows] = useState<Set<string>>(
    () => new Set()
  );
  /* Note-level selection ("measure:part:slot") for select-by-note mode. */
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(
    () => new Set()
  );
  /* Anchor note for Shift+click ranges in note mode. */
  const [noteRangeAnchor, setNoteRangeAnchor] = useState<string | null>(null);
  /* Select tool granularity: whole measure rows, or individual notes. */
  const [selectMode, setSelectMode] = useState<"measure" | "note">("measure");
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const clipboardRef = useRef<
    {
      measure: number;
      part: number;
      notes: {
        slot: number;
        zone: ZoneId;
        duration: DurationId;
      }[];
    }[]
  >(null);
  /* Undo/redo: project snapshots taken before each mutation through
     updateProject. Rapid edits (slider drags, typing bursts) coalesce into
     one undo step. */
  const projectRef = useRef<Project | null>(null);
  /* Local edits that still need a cloud push (set by updateProject/undo/redo,
     cleared after a successful push or after applying a remote revision). */
  const dirtyRef = useRef(false);
  /* Revision we last pushed (or applied), used to ignore our own echoes. */
  const lastPushedRevision = useRef<number | null>(null);
  /* Monotonic counter of local edits; lets an in-flight push detect whether
     newer edits landed while it was saving (and avoid clobbering them). */
  const editSeq = useRef(0);
  const shareClaimHandled = useRef(false);
  /* Project ids we already asked the cloud-push effect to upload (one-shot
     guard so opening a local-only project while signed in pushes it once). */
  const ensureCloudPushFor = useRef<string | null>(null);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastSnapshotAt = useRef(0);

  const vexRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scoreAreaRef = useRef<HTMLDivElement | null>(null);
  const scoreScrollRef = useRef<HTMLDivElement | null>(null);
  /* Last measure we scrolled to during playback (auto-follow). */
  const lastFollowMeasure = useRef<number | null>(null);
  const engineRef = useRef<{
    drummers: {
      center: Tone.MembraneSynth;
      edge: Tone.NoiseSynth;
      rim: Tone.NoiseSynth;
    }[];
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  /* Active project values (all edits flow through updateProject). */
  const bpm = project?.bpm ?? 120;
  const measureCount = project?.measures ?? 4;
  const notes = useMemo(() => project?.notes ?? [], [project?.notes]);
  const groups = useMemo(() => project?.groups ?? [], [project?.groups]);
  const annotations = useMemo(
    () => project?.annotations ?? [],
    [project?.annotations]
  );
  /* Every group across all projects, for the “Yours” tab. */
  const allGroups = useMemo(
    () =>
      projectsList.flatMap((p) =>
        p.groups.map((g) => ({ group: g, project: p }))
      ),
    [projectsList]
  );
  const yoursGroups = useMemo(
    () => allGroups.filter(({ project: p }) => p.id !== project?.id),
    [allGroups, project?.id]
  );
  const sourceMeasure = Math.min(captureMeasure, Math.max(0, measureCount - 1));
  // Drummer ensemble: count is the stored drummers or the highest note part.
  const maxPart = notes.reduce((mx, n) => Math.max(mx, n.part ?? 0), 0);
  const drummerCount = Math.max(project?.drummers ?? 1, maxPart + 1);
  const drummerVolumes = useMemo(
    () => project?.drummerVolumes ?? [],
    [project?.drummerVolumes]
  );
  const drummerColors = useMemo(
    () => project?.drummerColors ?? [],
    [project?.drummerColors]
  );
  const colorFor = useCallback(
    (part: number) => drummerColor({ drummerColors }, part),
    [drummerColors]
  );
  const multiDrummer = drummerCount > 1;
  const hasHeader =
    (project?.name ?? "").trim() !== "" ||
    (project?.description ?? "").trim() !== "" ||
    (project?.author ?? "").trim() !== "";
  const headerOffset = hasHeader ? 68 : 0;

  /* Per-measure drummer layout: each measure lists the drummers that play.
     Inactive drummers are hidden in that measure and stay silent — like
     MuseScore hiding empty staves. */
  const activeFor = useCallback(
    (m: number): number[] =>
      project ? activeDrummersForMeasure(project, m) : [0],
    [project]
  );

  /* View mode: drummer 1 always keeps a row; drummers 2+ are kept only in
     measures where they actually have notes (empty rows are removed). Edit
     mode keeps every row, ghosting drummers not assigned to the measure. */
  const viewPartsFor = useCallback(
    (m: number): number[] => {
      const parts = new Set<number>([0]); // D1 always remains
      for (const n of notes) {
        const p = n.part ?? 0;
        if (n.measure === m && p >= 1 && p < drummerCount) parts.add(p);
      }
      return Array.from(parts).sort((a, b) => a - b);
    },
    [drummerCount, notes]
  );

  const renderPartsFor = useCallback(
    (m: number): number[] =>
      viewMode
        ? viewPartsFor(m)
        : Array.from({ length: drummerCount }, (_, i) => i),
    [drummerCount, viewMode, viewPartsFor]
  );
  const isGhostRow = useCallback(
    (m: number, part: number) => !viewMode && !activeFor(m).includes(part),
    [activeFor, viewMode]
  );

  const systemsTotal = Math.ceil(measureCount / MEASURES_PER_SYSTEM);

  /* Single-drummer scores keep the classic fixed line height; multi-drummer
     edit mode keeps every row visible, while view mode sizes each system by
     the tallest measure (D1 + the drummers with notes). */
  const systemHeights = useMemo(() => {
    if (!multiDrummer) return Array.from({ length: systemsTotal }, () => ROW_H);
    if (!viewMode) {
      const fixed = drummerCount * DRUMMER_ROW_STEP + SYSTEM_EXTRA;
      return Array.from({ length: systemsTotal }, () => fixed);
    }
    const heights: number[] = [];
    for (let sys = 0; sys < systemsTotal; sys++) {
      const cols = Math.min(
        MEASURES_PER_SYSTEM,
        measureCount - sys * MEASURES_PER_SYSTEM
      );
      let maxRows = 1;
      for (let c = 0; c < cols; c++) {
        maxRows = Math.max(
          maxRows,
          viewPartsFor(sys * MEASURES_PER_SYSTEM + c).length
        );
      }
      heights.push(maxRows * DRUMMER_ROW_STEP + SYSTEM_EXTRA);
    }
    return heights;
  }, [
    drummerCount,
    measureCount,
    multiDrummer,
    systemsTotal,
    viewMode,
    viewPartsFor,
  ]);

  /* Pages pack systems greedily by height (MuseScore "add page" behaviour):
     single-drummer pages keep exactly SYSTEMS_PER_PAGE lines; multi-drummer
     pages fill until the next system would overflow. */
  const pageBounds = useMemo(() => {
    if (!multiDrummer) {
      return Array.from(
        { length: Math.ceil(systemsTotal / SYSTEMS_PER_PAGE) },
        (_, i) => ({
          start: i * SYSTEMS_PER_PAGE,
          end: Math.min((i + 1) * SYSTEMS_PER_PAGE, systemsTotal),
        })
      );
    }
    const available = (pageIndex: number) =>
      PAGE_H -
      PAGE_MARGIN_TOP -
      PAGE_MARGIN_BOTTOM -
      (pageIndex === 0 ? headerOffset : 0);
    const bounds: { start: number; end: number }[] = [];
    let i = 0;
    let pageIndex = 0;
    while (i < systemsTotal) {
      let h = 0;
      let j = i;
      while (j < systemsTotal) {
        const sysH = systemHeights[j];
        if (h + sysH > available(pageIndex) && j > i) break;
        h += sysH;
        j++;
      }
      bounds.push({ start: i, end: j });
      i = j;
      pageIndex++;
    }
    return bounds;
  }, [headerOffset, multiDrummer, systemHeights, systemsTotal]);

  /* Vertical offset of each system inside its page. */
  const pageSysOffsets = useMemo(
    () =>
      pageBounds.map((b) => {
        const offsets = [0];
        for (let k = b.start; k < b.end - 1; k++) {
          offsets.push(offsets[offsets.length - 1] + systemHeights[k]);
        }
        return offsets;
      }),
    [pageBounds, systemHeights]
  );

  const pageCount = pageBounds.length;
  // Clamped current page, so shrinking the project never leaves it blank.
  const page = Math.min(currentPage, Math.max(0, pageCount - 1));
  /* In view mode the user controls the zoom (default: fit the column). */
  const effectiveScale = viewMode
    ? viewZoom !== null
      ? viewZoom
      : viewLayout === "double"
        ? Math.min(1.5, Math.max(0.2, (fitAvailW - 48) / (PAGE_W * 2)))
        : pageScale
    : pageScale;
  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      setViewZoom((z) => {
        const base = z ?? pageScale;
        const next = Math.min(
          3,
          Math.max(0.3, Math.round(base * (1 + dir * 0.15) * 100) / 100)
        );
        return next;
      });
    },
    [pageScale]
  );
  const projectName = project?.name ?? "";
  const projectDescription = project?.description ?? "";
  const projectAuthor = project?.author ?? "";
  const projectAuthorRole = project?.authorRole ?? "custom";
  /* The layout selector is clamped so shrinking the score never leaves it
     pointing past the last measure. */
  const layoutMeasureClamped = Math.min(
    layoutMeasure,
    Math.max(0, measureCount - 1)
  );

  const updateProject = useCallback((fn: (p: Project) => Project) => {
    const prev = projectRef.current;
    if (!prev) return;
    const next = fn(prev);
    if (next !== prev) {
      dirtyRef.current = true;
      editSeq.current++;
      const now = Date.now();
      if (now - lastSnapshotAt.current > 500) {
        undoStack.current.push(prev);
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }
      lastSnapshotAt.current = now;
    }
    projectRef.current = next;
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    if (project) redoStack.current.push(project);
    setCanRedo(true);
    setCanUndo(undoStack.current.length > 0);
    lastSnapshotAt.current = 0;
    projectRef.current = prev;
    setProject(prev);
    dirtyRef.current = true;
    editSeq.current++;
    setSelectedRows(new Set());
    setSelectedNotes(new Set());
    setNoteRangeAnchor(null);
    setPasteTarget(null);
  }, [project]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    if (project) undoStack.current.push(project);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    lastSnapshotAt.current = 0;
    projectRef.current = next;
    setProject(next);
    dirtyRef.current = true;
    editSeq.current++;
    setSelectedRows(new Set());
    setSelectedNotes(new Set());
    setNoteRangeAnchor(null);
    setPasteTarget(null);
  }, [project]);

  const resetHistory = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
    lastSnapshotAt.current = 0;
  }, []);

  /* ------------------------------------------------------------------ */
  /* VexFlow rendering                                                   */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The "bravura" entry also registers the music font, so the score
      // glyphs render identically on every device (not just systems with
      // Bravura installed).
      const VF = await import("vexflow/bravura");
      if (cancelled) return;
      // The font DATA loads asynchronously after the module registers it. If
      // we draw before it is ready, glyph metrics fall back and every notehead
      // drifts off its grid — the "notes run away on a fresh load, then look
      // right after the font gets cached" bug. Wait for the fonts first.
      if (typeof document !== "undefined" && "fonts" in document) {
        await document.fonts.ready;
      }
      if (cancelled) return;

      const allMetrics: StaveMetrics[] = [];

      // MuseScore "Page view": fixed measures per system — each page has
      // SYSTEMS_PER_PAGE lines of MEASURES_PER_SYSTEM measures.
      const measureW =
        (PAGE_W - PAGE_MARGIN_X * 2) / MEASURES_PER_SYSTEM;
      for (let p = 0; p < pageCount; p++) {
        const target = vexRefs.current[p];
        if (!target) continue;
        target.innerHTML = "";
        const renderer = new VF.Renderer(target, VF.Renderer.Backends.SVG);
        renderer.resize(PAGE_W, PAGE_H);
        const ctx = renderer.getContext();

        // Title block on the first page: project name, description, author —
        // centred in Times New Roman, like a printed score header.
        const pageHasHeader = p === 0 && hasHeader;
        const authorLine =
          projectAuthor.trim() === ""
            ? ""
            : projectAuthorRole === "transcribed"
              ? `Transcribed By: ${projectAuthor.trim()}`
              : projectAuthorRole === "music"
                ? `Music By: ${projectAuthor.trim()}`
                : projectAuthor.trim();
        if (pageHasHeader) {
          ctx.save();
          // SVGContext.measureText is unreliable (detached measure element),
          // so measure widths with a real canvas for accurate centering.
          const measureCanvas = document
            .createElement("canvas")
            .getContext("2d")!;
          const centered = (text: string, size: number, yPos: number) => {
            if (!text.trim()) return;
            measureCanvas.font = `${size}px "Times New Roman", Times, serif`;
            const w = measureCanvas.measureText(text).width;
            ctx.setFont(`${size}px Times New Roman`);
            ctx.fillText(text, PAGE_W / 2 - w / 2, yPos);
          };
          centered(projectName, 22, 30);
          centered(projectDescription, 14, 54);
          // Composer/ensemble line right-aligned, like the troupe scores
          // (e.g. "隆中华鼓队 队长团创作").
          if (authorLine.trim() !== "") {
            measureCanvas.font = '12px "Times New Roman", Times, serif';
            const w = measureCanvas.measureText(authorLine).width;
            ctx.setFont("12px Times New Roman");
            ctx.fillText(authorLine, PAGE_W - PAGE_MARGIN_X - w, 74);
          }
          ctx.restore();
        }

        const bound = pageBounds[p];
        const sysStart = bound.start;
        const sysEnd = bound.end;
        for (let sys = sysStart; sys < sysEnd; sys++) {
          const cols = Math.min(
            MEASURES_PER_SYSTEM,
            measureCount - sys * MEASURES_PER_SYSTEM
          );
          /* MuseScore-style system grouping: when a system has more than one
             staff, draw a shared system-start barline spanning every row plus
             a thick bracket on the left (with top/bottom hooks). Solo
             sections keep a single ungrouped line. */
          let sysRows = drummerCount;
          if (viewMode) {
            sysRows = 1;
            for (let c = 0; c < cols; c++) {
              sysRows = Math.max(
                sysRows,
                renderPartsFor(sys * MEASURES_PER_SYSTEM + c).length
              );
            }
          }
          const sysRowTop =
            PAGE_MARGIN_TOP + headerOffset + pageSysOffsets[p][sys - sysStart];
          if (sysRows >= 2) {
            const staffTopY = sysRowTop + 40;
            const staffBottomY =
              sysRowTop + (sysRows - 1) * DRUMMER_ROW_STEP + 80;
            ctx.save();
            ctx.setLineWidth(1.2);
            ctx.setStrokeStyle("#18181b");
            // Shared system-start barline, continuous through the row gaps.
            ctx.beginPath();
            ctx.moveTo(PAGE_MARGIN_X, staffTopY);
            ctx.lineTo(PAGE_MARGIN_X, staffBottomY);
            ctx.stroke();
            // Thick system bracket with top and bottom hooks.
            // Close to the staves; the D1/D2 labels sit outside (left).
            const bx = PAGE_MARGIN_X - 8;
            ctx.setLineWidth(2.6);
            ctx.beginPath();
            ctx.moveTo(bx, staffTopY);
            ctx.lineTo(bx, staffBottomY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(bx, staffTopY);
            ctx.lineTo(bx + 6, staffTopY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(bx, staffBottomY);
            ctx.lineTo(bx + 6, staffBottomY);
            ctx.stroke();
            ctx.restore();
          }
          for (let c = 0; c < cols; c++) {
            const m = sys * MEASURES_PER_SYSTEM + c;
            const x = PAGE_MARGIN_X + c * measureW;
            const rowTop = sysRowTop;
            // Edit mode: every drummer row is shown (inactive rows are
            // ghosted). View mode: only active drummers get a row, so
            // measures with fewer players show fewer lines.
            const parts = renderPartsFor(m);
            parts.forEach((part, ri) => {
              const ghost = isGhostRow(m, part);
              const y = rowTop + ri * DRUMMER_ROW_STEP;
              const stave = new VF.Stave(x, y, measureW);
              // 24 Festive Drums notation (per the MuseScore tutorial and
              // real troupe scores): notes float on ONE visible staff line —
              // the bottom line of the hidden five-line staff — with the
              // unpitched percussion clef at each system start.
              for (let l = 0; l < 5; l++) {
                stave.setConfigForLine(l, { visible: l === 4 });
              }
              if (ghost) {
                stave.setStyle({ strokeStyle: "#94a3b8", fillStyle: "#94a3b8" });
              }
              // Final barline at the very end of the score.
              if (m === measureCount - 1) stave.setEndBarType(3);
              stave.setContext(ctx).draw();

              // The single staff line the notes sit on.
              const staffLineY = stave.getYForLine(4);

              // Unpitched percussion clef (two vertical bars + a horizontal
              // bar), centred on the staff line at each system start.
              if (c === 0) {
                ctx.save();
                ctx.setLineWidth(1.4);
                ctx.setStrokeStyle(ghost ? "#94a3b8" : "#18181b");
                const cx = x + 10;
                const half = 9;
                ctx.beginPath();
                ctx.moveTo(cx - 4, staffLineY - half);
                ctx.lineTo(cx - 4, staffLineY + half);
                ctx.moveTo(cx + 4, staffLineY - half);
                ctx.lineTo(cx + 4, staffLineY + half);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(cx - 6, staffLineY);
                ctx.lineTo(cx + 6, staffLineY);
                ctx.stroke();
                ctx.restore();
              }

              // 4/4 time signature (stacked digits) on the top row of each
              // page's first measure, like the reference scores.
              if (ri === 0 && m === sysStart * MEASURES_PER_SYSTEM) {
                ctx.save();
                ctx.setFont('bold 11px "Times New Roman", Times, serif');
                ctx.setFillStyle(ghost ? "#94a3b8" : "#18181b");
                const tx = x + 18;
                ctx.fillText("4", tx, staffLineY - 5);
                ctx.fillText("4", tx, staffLineY + 13);
                ctx.restore();
              }

              // Head/back breathing room: inset the note area from the row's
              // barlines for EVERY measure (uniform, so nothing looks
              // squeezed relative to its neighbours).
              stave.setNoteStartX(stave.getNoteStartX() + NOTE_AREA_INSET);

              // Measure number at each system start (top row only).
              if (c === 0 && ri === 0) {
                ctx.save();
                ctx.setFont("11px sans-serif");
                ctx.fillText(String(m + 1), x + 2, y - 10);
                ctx.restore();
              }

              // Colour-coded row labels make each drummer instantly
              // recognisable (D1 amber, D2 cyan, …); ghost rows are dimmed.
              if (multiDrummer) {
                const label = colorFor(part);
                ctx.save();
                ctx.setFont('bold 9px sans-serif');
                ctx.setFillStyle(ghost ? `${label}66` : label);
                // Outside the system bracket (to the left of it).
                ctx.fillText(`D${part + 1}`, x - 26, y + 17);
                ctx.restore();
              }

              const measureNotes = notes.filter(
                (n) => n.measure === m && (n.part ?? 0) === part
              );
              const { tickables, tuplets, beams, positions } =
                buildMeasureTickables(measureNotes, VF);
              if (ghost) {
                tickables.forEach((t) => {
                  // Inactive-drummer (ghost) rows keep the measure structure
                  // but show no content: rests become invisible so grey
                  // symbols don't sit "on top of" the neighbouring notes.
                  t.setStyle(
                    t.isRest()
                      ? { fillStyle: "transparent", strokeStyle: "transparent" }
                      : { fillStyle: "#94a3b8", strokeStyle: "#94a3b8" }
                  );
                });
              }
              const voice = new VF.Voice({ numBeats: BEATS, beatValue: 4 });
              try {
                voice.addTickables(tickables);
                new VF.Formatter()
                  .joinVoices([voice])
                  .formatToStave([voice], stave);
                // Grid alignment: centre every note/rest on its cell span so
                // noteheads lie exactly on their input boxes (the 8
                // half-beat cells per measure).
                const noteStart = stave.getNoteStartX();
                const noteEnd = stave.getNoteEndX();
                // Beat-aware layout: each beat's notes are centred within
                // their own band, with BEAT_GAP of air between beats.
                const noteArea = noteEnd - noteStart;
                const beatW = (noteArea - 3 * BEAT_GAP) / 4;
                for (const { tickable, slot, span } of positions) {
                  const beat = Math.floor(slot / SLOTS_PER_BEAT);
                  const inBeat = slot - beat * SLOTS_PER_BEAT;
                  const center = (inBeat + span / 2) / SLOTS_PER_BEAT;
                  let x = beat * (beatW + BEAT_GAP) + center * beatW;
                  // Every notehead (●, ✕, ▷ and rests) is a Bravura glyph
                  // drawn left-anchored with a fixed offset from its grid
                  // anchor, so shift it back to centre the visible symbol on
                  // the input box.
                  if (tickable.noteHeads[0]) {
                    x -= NOTEHEAD_GLYPH_CENTER_FIX;
                  }
                  tickable.getTickContext()?.setX(x);
                }
                voice.draw(ctx, stave);
                for (const beam of beams) beam.setContext(ctx).draw();
                for (const tuplet of tuplets) tuplet.setContext(ctx).draw();
              } catch (err) {
                // One malformed row must never take down the whole score.
                console.warn(
                  `Skipping unrenderable row measure=${m + 1} part=${
                    part + 1
                  }`,
                  err
                );
              }

              allMetrics.push({
                measure: m,
                page: p,
                part,
                x,
                w: measureW,
                startX: stave.getNoteStartX(),
                endX: stave.getNoteEndX(),
                y,
                height: DRUMMER_ROW_STEP,
              });
            });

            // Legacy measure-anchored notes (no free x/y): drawn above the
            // row they annotate. Each is wrapped in a group tagged with its
            // id so it can be clicked to edit and dragged to a new position
            // (dragging converts it to a free-placed note).
            const noteCanvas = document
              .createElement("canvas")
              .getContext("2d")!;
            for (const ann of annotations.filter(
              (a) => a.measure === m && a.x === undefined
            )) {
              const part = ann.part ?? 0;
              const annRow = parts.indexOf(part);
              if (annRow < 0) continue;
              const annY = rowTop + annRow * DRUMMER_ROW_STEP + 12;
              noteCanvas.font = 'italic 12px "Times New Roman", serif';
              const maxW = measureW - 8;
              let text = ann.text;
              if (noteCanvas.measureText(text).width > maxW) {
                while (
                  text.length > 1 &&
                  noteCanvas.measureText(text + "…").width > maxW
                ) {
                  text = text.slice(0, -1);
                }
                text += "…";
              }
              const annGrp = ctx.openGroup(
                "score-note",
                ann.id
              ) as unknown as SVGGElement;
              annGrp.setAttribute("data-ann-id", ann.id);
              annGrp.setAttribute("pointer-events", "auto");
              ctx.setFont('italic 12px "Times New Roman", serif');
              ctx.setFillStyle("#64748b");
              ctx.fillText(text, x + 2, annY);
              ctx.closeGroup();
            }
          }
        }

        // Freely placed notes: drawn at their exact stored position.
        for (const ann of annotations) {
          if (
            ann.page !== p ||
            ann.x === undefined ||
            ann.y === undefined
          ) {
            continue;
          }
          const annGrp = ctx.openGroup(
            "score-note",
            ann.id
          ) as unknown as SVGGElement;
          annGrp.setAttribute("data-ann-id", ann.id);
          annGrp.setAttribute("pointer-events", "auto");
          ctx.setFont('italic 12px "Times New Roman", serif');
          ctx.setFillStyle("#64748b");
          ctx.fillText(ann.text, ann.x, ann.y);
          ctx.closeGroup();
        }

        // Thicken the ✕ (edge) and ▷ (rim) notehead glyphs so their stroke
        // weight matches the filled ● (center) notehead. The glyphs are SVG
        // <text> elements with no stroke, so an outline of the same ink
        // colour makes them visibly bolder without changing their shapes.
        const svgEl = target.querySelector("svg");
        if (svgEl) {
          for (const t of svgEl.querySelectorAll("text")) {
            const glyph = t.textContent ?? "";
            if (glyph === "\uE0A9" || glyph === "\uE0C1") {
              t.setAttribute("stroke", "#18181b");
              t.setAttribute("stroke-width", "1.4");
            }
          }
        }

        // Make every score note interactive: click edits it, drag moves it.
        // Dragging updates the DOM in place (no re-render mid-drag) and
        // commits the final position on release.
        for (const annGrp of target.querySelectorAll("g[data-ann-id]")) {
          const annId = annGrp.getAttribute("data-ann-id");
          const textEl = annGrp.querySelector("text");
          if (!annId || !textEl) continue;
          const ann = annotations.find((a) => a.id === annId);
          if (!ann) continue;
          textEl.style.cursor = "move";
          textEl.style.userSelect = "none";
          textEl.dataset.moved = "0";

          textEl.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (viewMode) return;
            const pageEl = target.closest(".score-page") as HTMLElement | null;
            if (!pageEl) return;
            const rect = pageEl.getBoundingClientRect();
            const scale = rect.width / PAGE_W;
            const startClientX = e.clientX;
            const startClientY = e.clientY;
            const origin = annotations.find((a) => a.id === annId);
            if (!origin) return;
            let moved = false;
            let dx = 0;
            let dy = 0;
            const onMove = (ev: PointerEvent) => {
              dx = (ev.clientX - startClientX) / scale;
              dy = (ev.clientY - startClientY) / scale;
              if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
              annGrp.setAttribute(
                "transform",
                `translate(${Math.round(dx)},${Math.round(dy)})`
              );
            };
            const onUp = () => {
              textEl.removeEventListener("pointermove", onMove);
              textEl.removeEventListener("pointerup", onUp);
              textEl.dataset.moved = moved ? "1" : "0";
              if (!moved) return;
              const bbox = textEl.getBBox();
              const baseX =
                origin.x !== undefined
                  ? origin.x
                  : bbox.x + bbox.width / 2;
              const baseY =
                origin.y !== undefined
                  ? origin.y
                  : bbox.y + bbox.height / 2;
              updateProject((pr) => ({
                ...pr,
                annotations: (pr.annotations ?? []).map((a) =>
                  a.id === annId
                    ? {
                        ...a,
                        page: a.page ?? p,
                        x: Math.round(baseX + dx),
                        y: Math.round(baseY + dy),
                      }
                    : a
                ),
              }));
            };
            textEl.setPointerCapture?.(e.pointerId);
            textEl.addEventListener("pointermove", onMove);
            textEl.addEventListener("pointerup", onUp);
          });

          textEl.addEventListener("click", (e) => {
            e.stopPropagation();
            if (textEl.dataset.moved === "1") return;
            const a = annotations.find((x) => x.id === annId);
            if (!a) return;
            setNoteModal({
              open: true,
              measure: a.measure,
              part: a.part ?? 0,
              page: a.page,
              x: a.x,
              y: a.y,
              editId: a.id,
            });
          });
        }

        // Page number at the bottom, like a printed page.
        ctx.save();
        ctx.setFont("11px sans-serif");
        ctx.fillText(
          `${p + 1} / ${pageCount}`,
          PAGE_W / 2 - 18,
          PAGE_H - PAGE_MARGIN_BOTTOM / 2
        );
        ctx.restore();
      }
      setMetrics(allMetrics);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeFor,
    annotations,
    colorFor,
    drummerCount,
    hasHeader,
    headerOffset,
    isGhostRow,
    measureCount,
    multiDrummer,
    notes,
    pageBounds,
    pageCount,
    pageSysOffsets,
    projectAuthor,
    projectAuthorRole,
    projectDescription,
    projectName,
    renderPartsFor,
    systemsTotal,
    updateProject,
    viewMode,
  ]);

  /* ------------------------------------------------------------------ */
  /* Audio engine                                                        */
  /* ------------------------------------------------------------------ */

  const drummerVolumeDb = (volume: number | undefined) =>
    ((volume ?? 60) / 100) * 24 - 24; // 60 → -9.6 dB, 100 → 0 dB, 0 → -24 dB

  const ensureEngine = useCallback(async (count: number) => {
    await Tone.start();
    const base = engineRef.current ?? { drummers: [] };
    while (base.drummers.length < count) {
      // One voice per drummer so each has an independent volume.
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

      base.drummers.push({ center, edge, rim });
    }
    engineRef.current = base;
    return base;
  }, []);

  const applyDrummerVolumes = useCallback((volumes: number[]) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.drummers.forEach((d, i) => {
      const db = drummerVolumeDb(volumes[i]);
      d.center.volume.value = -4 + db;
      d.edge.volume.value = -6 + db;
      d.rim.volume.value = -10 + db;
    });
  }, []);

  /* Shared playback engine: starts (or stops) playback from a given point. */
  const startPlayback = useCallback(
    async (startMeasure: number, startSlot: number, startPart: number) => {
    if (isPlaying) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
      playTokenRef.current++;
      setPlayhead(null);
      setIsPlaying(false);
      return;
    }
    const token = ++playTokenRef.current;
    await ensureEngine(drummerCount);
    applyDrummerVolumes(drummerVolumes);
    Tone.Transport.bpm.value = bpm;
    Tone.Transport.seconds = 0;

    const beat = 60 / bpm;
    const startTime =
      (startMeasure * BEATS + startSlot / SLOTS_PER_BEAT) * beat;
    // The guide follows the selected note immediately: jump to its page and
    // place the playhead there as soon as playback begins.
    setPlayhead({ measure: startMeasure, slot: startSlot, part: startPart });
    const startPage = pageBounds.findIndex(
      (b) =>
        startMeasure >= b.start * MEASURES_PER_SYSTEM &&
        startMeasure < b.end * MEASURES_PER_SYSTEM
    );
    if (startPage >= 0) setCurrentPage(startPage);
    // Tone.Transport requires strictly increasing schedule times: sort notes
    // by (measure, slot, part), drop duplicates, then group notes that share
    // the same time (e.g. both parts hitting together) into one callback.
    const scheduled = [...notes]
      .filter((n) => activeFor(n.measure).includes(n.part ?? 0))
      .filter(
        (n) =>
          n.measure > startMeasure ||
          (n.measure === startMeasure && n.slot >= startSlot)
      )
      .sort(
        (a, b) =>
          a.measure - b.measure ||
          a.slot - b.slot ||
          (a.part ?? 0) - (b.part ?? 0)
      )
      .filter(
        (n, i, arr) =>
          i === 0 ||
          n.measure !== arr[i - 1].measure ||
          n.slot !== arr[i - 1].slot ||
          (n.part ?? 0) !== (arr[i - 1].part ?? 0)
      );

    const groups: ScoreNote[][] = [];
    for (const n of scheduled) {
      const last = groups[groups.length - 1];
      if (last && last[0].measure === n.measure && last[0].slot === n.slot) {
        last.push(n);
      } else {
        groups.push([n]);
      }
    }

    for (const group of groups) {
      // Relative to the chosen start, so the first note plays immediately.
      const time =
        (group[0].measure * BEATS + group[0].slot / SLOTS_PER_BEAT) * beat -
        startTime;
      Tone.Transport.schedule((t) => {
        const engine = engineRef.current;
        if (!engine) return;
        const voice =
          engine.drummers[group[0].part ?? 0] ?? engine.drummers[0];
        if (!voice) return;
        // Each instrument may only fire once per time (Tone requires strictly
        // increasing start times per instrument), so a same-time edge+edge
        // chord still sounds once per instrument.
        let centerHit = false;
        let edgeHit = false;
        let rimHit = false;
        for (const n of group) {
          const zone = zoneById(n.zone);
          if (zone.id === "center" && !centerHit) {
            centerHit = true;
            voice.center.triggerAttackRelease("C2", "8n", t);
          } else if (zone.id === "edge" && !edgeHit) {
            edgeHit = true;
            voice.edge.triggerAttackRelease("8n", t);
          } else if (zone.id === "rim" && !rimHit) {
            rimHit = true;
            voice.rim.triggerAttackRelease("32n", t);
          }
        }
        // Move the guide in sync with the audio: Draw expects the callback's
        // audio-context time, so schedule it here rather than with transport
        // seconds (which Tone.Draw would misread and drop).
        Tone.Draw.schedule(
          () => {
            if (playTokenRef.current !== token) return;
            const m = group[0].measure;
            setPlayhead({
              measure: m,
              slot: group[0].slot,
              part: group[0].part ?? 0,
            });
            // Auto page flip: keep the page containing the playing measure
            // visible while the score plays.
            setCurrentPage((prev) => {
              const tp = pageBounds.findIndex(
                (b) =>
                  m >= b.start * MEASURES_PER_SYSTEM &&
                  m < b.end * MEASURES_PER_SYSTEM
              );
              return tp >= 0 && tp !== prev ? tp : prev;
            });
          },
          t
        );
      }, time);
    }
    // Clear the playhead at the end of the project.
    Tone.Transport.schedule((t) => {
      Tone.Draw.schedule(() => {
        if (playTokenRef.current === token) setPlayhead(null);
      }, t);
    },
      measureCount * BEATS * beat - 0.01 - startTime
    );
    Tone.Transport.start();
    setIsPlaying(true);
  }, [
    activeFor,
    applyDrummerVolumes,
    bpm,
    drummerCount,
    drummerVolumes,
    ensureEngine,
    isPlaying,
    measureCount,
    notes,
    pageBounds,
  ]);

  /* Original play/pause button: always plays from the very beginning. */
  const handlePlay = useCallback(() => {
    void startPlayback(0, 0, 0);
  }, [startPlayback]);

  /* "Play From": the user clicks a note and playback starts there directly. */
  const handlePlayFromNote = useCallback(
    (measure: number, part: number, slot: number) => {
      setPlayFromArm(false);
      void startPlayback(measure, slot, part);
    },
    [startPlayback]
  );

  /* Auto-follow: while playing, keep the row containing the playhead in
     view. Only re-scroll when the measure changes, so rapid notes within a
     measure don't fight the scroll position. */
  useEffect(() => {
    if (!isPlaying || !playhead) return;
    const container = scoreScrollRef.current;
    if (!container) return;
    const measure = playhead.measure;
    if (lastFollowMeasure.current === measure) return;
    lastFollowMeasure.current = measure;
    const row = container.querySelector(
      `[data-play-row="${measure}:${playhead.part}"]`
    );
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isPlaying, playhead]);

  /* Reset the follow-scroll throttle when playback stops or restarts. */
  useEffect(() => {
    if (!isPlaying) lastFollowMeasure.current = null;
  }, [isPlaying]);

  useEffect(() => {
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

  /* Keep the latest project available to updateProject (used for undo
     snapshots), even when the project is replaced outside updateProject. */
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    return () => {
      Tone.Transport.stop();
      Tone.Transport.cancel();
      const engine = engineRef.current;
      if (engine) {
        engine.drummers.forEach((d) => {
          d.center.dispose();
          d.edge.dispose();
          d.rim.dispose();
        });
      }
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /* Note editing                                                        */
  /* ------------------------------------------------------------------ */

  /* Beat-Block insertion: convert a rhythm pattern into notes for one beat
     (or half beat for 半空拍). Rest patterns simply clear the span, and the
     renderer fills the silence with a standard rest. */
  const insertPatternAt = useCallback(
    (
      measure: number,
      cell: number,
      zone: ZoneId,
      pat: PatternId,
      part: number
    ) => {
      updateProject((p) => {
        const cellStart =
          Math.min(Math.max(cell, 0), CELLS_PER_MEASURE - 1) * CELL_SLOTS;
        const def = PATTERNS.find((x) => x.id === pat)!;
        const start =
          def.span === CELL_SLOTS
            ? cellStart
            : Math.floor(cell / 2) * SLOTS_PER_BEAT;
        const kept = p.notes.filter(
          (n) =>
            n.measure !== measure ||
            (n.part ?? 0) !== part ||
            !overlaps(n, start, def.span)
        );
        const inserted: ScoreNote[] = def.hits
          .filter((h) => start + h.offset < SLOTS)
          .map((h, i) => ({
            id: crypto.randomUUID(),
            measure,
            slot: start + h.offset,
            zone: def.zones?.[i] ?? zone,
            duration: h.duration,
            part,
          }));
        return {
          ...p,
          notes: [...kept, ...inserted],
        };
      });
    },
    [updateProject]
  );

  /* Click behavior: with a zone tool, clicking a placed note repaints its
     zone (keeping position/duration); clicking empty space inserts the
     currently selected beat pattern. With a pattern tool, clicking always
     (re)fills the beat with that pattern. */
  const paintOrInsert = useCallback(
    (measure: number, cell: number, zone: ZoneId, part: number) => {
      updateProject((p) => {
        const cellStart =
          Math.min(Math.max(cell, 0), CELLS_PER_MEASURE - 1) * CELL_SLOTS;

        // Rest patterns always clear their span, even if a zone tool is
        // still "armed" from a previous action.
        const isRestPattern = pattern === "rest" || pattern === "halfRest";
        if (paintMode && !isRestPattern) {
          const existing = p.notes.find(
            (n) =>
              n.measure === measure &&
              (n.part ?? 0) === part &&
              n.slot < cellStart + CELL_SLOTS &&
              cellStart < n.slot + SPAN[n.duration]
          );
          if (existing) {
            return {
              ...p,
              notes: p.notes.map((n) =>
                n.id === existing.id ? { ...n, zone } : n
              ),
            };
          }
        }

        const def = PATTERNS.find((x) => x.id === pattern)!;
        const start =
          def.span === CELL_SLOTS
            ? cellStart
            : Math.floor(cell / 2) * SLOTS_PER_BEAT;
        const kept = p.notes.filter(
          (n) =>
            n.measure !== measure ||
            (n.part ?? 0) !== part ||
            !overlaps(n, start, def.span)
        );
        const inserted: ScoreNote[] = def.hits
          .filter((h) => start + h.offset < SLOTS)
          .map((h, i) => ({
            id: crypto.randomUUID(),
            measure,
            slot: start + h.offset,
            zone: def.zones?.[i] ?? zone,
            duration: h.duration,
            part,
          }));
        return {
          ...p,
          notes: [...kept, ...inserted],
        };
      });
    },
    [paintMode, pattern, updateProject]
  );

  const eraseAt = useCallback(
    (measure: number, cell: number, part: number) => {
      updateProject((p) => {
        const cellStart =
          Math.min(Math.max(cell, 0), CELLS_PER_MEASURE - 1) * CELL_SLOTS;
        const target = p.notes.find(
          (n) =>
            n.measure === measure &&
            (n.part ?? 0) === part &&
            n.slot < cellStart + CELL_SLOTS &&
            cellStart < n.slot + SPAN[n.duration]
        );
        if (!target) return p;
        // Removing one triplet note clears the whole triplet beat.
        if (target.duration === "8t") {
          const beatStart = Math.floor(cell / 2) * SLOTS_PER_BEAT;
          return {
            ...p,
            notes: p.notes.filter(
              (n) =>
                !(
                  n.measure === measure &&
                  (n.part ?? 0) === part &&
                  n.duration === "8t" &&
                  n.slot >= beatStart &&
                  n.slot < beatStart + SLOTS_PER_BEAT
                )
            ),
          };
        }
        return {
          ...p,
          notes: p.notes.filter((n) => n.id !== target.id),
        };
      });
    },
    [updateProject]
  );

  const clearAll = useCallback(() => {
    if (isPlaying) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
      setPlayhead(null);
      setIsPlaying(false);
    }
    updateProject((p) => ({ ...p, notes: [] }));
  }, [isPlaying, updateProject]);

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      await exportScorePdf(scoreAreaRef.current, project?.name ?? "score");
    } catch (err) {
      console.error(err);
      window.alert("PDF export failed 导出失败，请重试。");
    } finally {
      setExporting(false);
    }
  };

  const saveNote = (text: string) => {
    if (!noteModal) return;
    updateProject((p) => {
      const list = p.annotations ?? [];
      if (noteModal.editId) {
        return {
          ...p,
          annotations: list.map((a) =>
            a.id === noteModal.editId ? { ...a, text } : a
          ),
        };
      }
      const next: ScoreAnnotation = {
        id: crypto.randomUUID(),
        measure: noteModal.measure,
        part: noteModal.part,
        text,
      };
      if (
        noteModal.page !== undefined &&
        noteModal.x !== undefined &&
        noteModal.y !== undefined
      ) {
        next.page = noteModal.page;
        next.x = noteModal.x;
        next.y = noteModal.y;
      }
      const added: ScoreAnnotation[] = [...list, next];
      return { ...p, annotations: added };
    });
    setNoteModal(null);
  };

  const deleteNote = () => {
    if (!noteModal) return;
    updateProject((p) => ({
      ...p,
      annotations: (p.annotations ?? []).filter(
        (a) =>
          noteModal.editId
            ? a.id !== noteModal.editId
            : !(
                a.measure === noteModal.measure &&
                (a.part ?? 0) === noteModal.part
              )
      ),
    }));
    setNoteModal(null);
  };

  const changeMeasureCount = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_MEASURES, Math.max(1, next));
      updateProject((p) => ({
        ...p,
        measures: clamped,
        notes: p.notes.filter((n) => n.measure < clamped),
        measureDrummers: (p.measureDrummers ?? []).slice(0, clamped),
      }));
      setPlayhead(null);
    },
    [updateProject]
  );

  /* Toggle whether a drummer plays in one measure. Deactivating removes
     that drummer's notes in the measure (their row disappears), so ask
     first when notes would be lost. */
  const toggleMeasurePart = useCallback(
    (measure: number, part: number) => {
      updateProject((p) => {
        const count = Math.max(1, p.drummers ?? 1);
        const md = materializeMeasureDrummers(p);
        const cur = md[measure];
        const isActive = cur.includes(part);
        if (isActive && cur.length <= 1) return p; // keep ≥1 drummer
        if (isActive) {
          const hasNotes = p.notes.some(
            (n) => n.measure === measure && (n.part ?? 0) === part
          );
          if (
            hasNotes &&
            !window.confirm(
              `Drummer ${part + 1} is hidden in measure ${measure + 1}. ` +
                `Their notes in this measure will be removed. 确定隐藏吗？`
            )
          ) {
            return p;
          }
        }
        const next = isActive
          ? cur.filter((i) => i !== part)
          : [...cur, part].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
        md[measure] = next;
        return {
          ...p,
          measureDrummers: md,
          notes: isActive
            ? p.notes.filter(
                (n) => !(n.measure === measure && (n.part ?? 0) === part)
              )
            : p.notes,
        };
      });
    },
    [updateProject]
  );

  /* Editing a ghost row in edit mode brings that drummer into the measure:
     they become active, so the row also appears in view mode. */
  const ensureMeasurePart = useCallback(
    (measure: number, part: number) => {
      updateProject((p) => {
        const md = materializeMeasureDrummers(p);
        const cur = md[measure] ?? [];
        if (cur.includes(part)) return p;
        md[measure] = [...cur, part].sort((a, b) => a - b);
        return { ...p, measureDrummers: md };
      });
    },
    [updateProject]
  );

  /* ------------------------------------------------------------------ */
  /* Rhythm groups: capture a measure, insert it anywhere                */
  /* ------------------------------------------------------------------ */

  /* Open the group editor: capture the source measure as a template for a
     new group, then let the drummer build/rename/edit it in the dialog. */
  const openGroupEditor = useCallback(() => {
    if (!project) return;
    const source = project.notes
      .filter(
        (n) => n.measure === sourceMeasure && (n.part ?? 0) === activePart
      )
      .sort((a, b) => a.slot - b.slot);
    const name = `Group ${project.groups.length + 1} 组合${
      project.groups.length + 1
    }`;
    const group: RhythmGroup = {
      id: crypto.randomUUID(),
      name,
      measures: [
        source.map((n) => ({
          slot: n.slot,
          zone: n.zone,
          duration: n.duration,
        })),
      ],
    };
    updateProject((p) => ({ ...p, groups: [...p.groups, group] }));
    setGroupEditorInitial(group.id);
    setGroupEditorOpen(true);
  }, [activePart, project, sourceMeasure, updateProject]);

  const createEmptyGroup = useCallback(
    (name: string) => {
      const id = crypto.randomUUID();
      updateProject((p) => ({
        ...p,
        groups: [...p.groups, { id, name, measures: [] }],
      }));
      return id;
    },
    [updateProject]
  );

  const renameGroup = useCallback(
    (id: string, name: string) => {
      updateProject((p) => ({
        ...p,
        groups: p.groups.map((g) => (g.id === id ? { ...g, name } : g)),
      }));
    },
    [updateProject]
  );

  const updateGroupMeasures = useCallback(
    (id: string, measures: RhythmGroup["measures"]) => {
      updateProject((p) => ({
        ...p,
        groups: p.groups.map((g) => (g.id === id ? { ...g, measures } : g)),
      }));
    },
    [updateProject]
  );

  const insertGroup = useCallback(
    (measure: number, cell: number, group: RhythmGroup, part: number) => {
      updateProject((p) => {
        const start =
          Math.min(Math.max(cell, 0), CELLS_PER_MEASURE - 1) * CELL_SLOTS;
        const inserted: ScoreNote[] = [];
        group.measures.forEach((measureSlots, mIdx) => {
          const targetMeasure = measure + mIdx;
          if (targetMeasure >= p.measures) return;
          for (const gs of measureSlots) {
            const abs = start + gs.slot;
            if (abs >= SLOTS) continue;
            const d = fitDuration(abs, gs.duration);
            inserted.push({
              id: crypto.randomUUID(),
              measure: targetMeasure,
              slot: abs,
              zone: gs.zone,
              duration: d,
              part,
            });
          }
        });
        if (inserted.length === 0) return p;
        const kept = p.notes.filter(
          (n) =>
            !inserted.some(
              (ins) =>
                ins.measure === n.measure &&
                (n.part ?? 0) === part &&
                overlaps(n, ins.slot, SPAN[ins.duration])
            )
        );
        return { ...p, notes: [...kept, ...inserted] };
      });
    },
    [updateProject]
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      const groupName =
        project?.groups.find((g) => g.id === groupId)?.name ?? "Group";
      if (
        !window.confirm(
          `Delete "${groupName}"? 确定删除该组合吗？`
        )
      ) {
        return;
      }
      updateProject((p) => ({
        ...p,
        groups: p.groups.filter((g) => g.id !== groupId),
      }));
      setActiveGroupId((cur) => (cur === groupId ? null : cur));
    },
    [project?.groups, updateProject]
  );

  const chooseZone = useCallback((z: ZoneId) => {
    setSelected(z);
    setPaintMode(true);
    setActiveGroupId(null);
  }, []);

  const choosePattern = useCallback((p: PatternId) => {
    setPattern(p);
    setPaintMode(false);
    setActiveGroupId(null);
  }, []);

  /* Bulk delete: remove every note (and text note) on the selected rows.
     Rows keep their structure — only the content is erased. */
  const deleteSelectedRows = useCallback(() => {
    if (selectedRows.size === 0 && selectedNotes.size === 0) return;
    const keys = selectedRows;
    const noteKeys = selectedNotes;
    updateProject((p) => ({
      ...p,
      notes: p.notes.filter(
        (n) =>
          !keys.has(`${n.measure}:${n.part ?? 0}`) &&
          !noteKeys.has(`${n.measure}:${n.part ?? 0}:${n.slot}`)
      ),
      annotations: (p.annotations ?? []).filter(
        (a) => !keys.has(`${a.measure}:${a.part ?? 0}`)
      ),
    }));
    setSelectedRows(new Set());
    setSelectedNotes(new Set());
    setNoteRangeAnchor(null);
  }, [selectedNotes, selectedRows, updateProject]);

  /* The eraser is linked to the selection: with rows highlighted, choosing
     the eraser bulk-deletes them; otherwise it arms single-note erasing. */
  const chooseEraser = useCallback(() => {
    if (selectedRows.size > 0 || selectedNotes.size > 0) {
      deleteSelectedRows();
      return;
    }
    setSelected("eraser");
    setActiveGroupId(null);
  }, [deleteSelectedRows, selectedNotes, selectedRows]);

  const chooseNote = useCallback(() => {
    setSelected("note");
    setActiveGroupId(null);
  }, []);

  /* Clicking a row with the select tool toggles that single drummer row in
     the highlight set, marks it as the paste anchor, and makes that drummer
     active so "Create Combo" captures the right part. */
  const toggleRowSelection = useCallback((measure: number, part: number) => {
    const key = `${measure}:${part}`;
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setPasteTarget(key);
    setActivePart(part);
  }, []);

  /* Switching granularity clears the other selection set. */
  const changeSelectMode = useCallback((mode: "measure" | "note") => {
    setSelectMode(mode);
    if (mode === "note") setSelectedRows(new Set());
    else setSelectedNotes(new Set());
    setNoteRangeAnchor(null);
  }, []);

  /* Toggle a single note ("measure:part:slot") in note mode. */
  const toggleNoteSelection = useCallback(
    (measure: number, part: number, slot: number) => {
      const key = `${measure}:${part}:${slot}`;
      setSelectedNotes((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setPasteTarget(`${measure}:${part}`);
      setActivePart(part);
    },
    []
  );

  /* ⌘C / Ctrl+C: copy every selected row's notes into the clipboard. */
  const copySelection = useCallback(() => {
    if (!project || (selectedRows.size === 0 && selectedNotes.size === 0)) {
      return;
    }
    // Note-level selection: group the picked notes by (measure, part) so the
    // clipboard keeps the same shape as row copies.
    if (selectedNotes.size > 0) {
      const groups = new Map<
        string,
        {
          measure: number;
          part: number;
          notes: { slot: number; zone: ZoneId; duration: DurationId }[];
        }
      >();
      for (const key of selectedNotes) {
        const [m, p, s] = key.split(":").map(Number);
        const note = project.notes.find(
          (n) => n.measure === m && (n.part ?? 0) === p && n.slot === s
        );
        if (!note) continue;
        const gk = `${m}:${p}`;
        if (!groups.has(gk)) {
          groups.set(gk, { measure: m, part: p, notes: [] });
        }
        groups.get(gk)!.notes.push({
          slot: note.slot,
          zone: note.zone,
          duration: note.duration,
        });
      }
      const copied = Array.from(groups.values()).sort(
        (a, b) => a.measure - b.measure || a.part - b.part
      );
      clipboardRef.current = copied;
      setHasClipboard(true);
      setSelectedNotes(new Set());
      setNoteRangeAnchor(null);
      void navigator.clipboard
        ?.writeText(
          JSON.stringify({ app: "drummers-beat", selection: copied })
        )
        .catch(() => {});
      return;
    }
    const rows = Array.from(selectedRows)
      .map((key) => {
        const [m, p] = key.split(":").map(Number);
        return { measure: m, part: p };
      })
      .sort((a, b) => a.measure - b.measure || a.part - b.part);
    const copied = rows.map(({ measure, part }) => ({
      measure,
      part,
      notes: project.notes
        .filter((n) => n.measure === measure && (n.part ?? 0) === part)
        .map((n) => ({ slot: n.slot, zone: n.zone, duration: n.duration })),
    }));
    clipboardRef.current = copied;
    setHasClipboard(true);
    setSelectedRows(new Set());
    setSelectedNotes(new Set());
    setNoteRangeAnchor(null);
    // Also put a portable JSON copy on the system clipboard.
    void navigator.clipboard
      ?.writeText(
        JSON.stringify({ app: "drummers-beat", selection: copied })
      )
      .catch(() => {});
  }, [project, selectedNotes, selectedRows]);

  /* ⌘V / Ctrl+V: paste the clipboard at the anchor measure. A single-part
     clip (e.g. only D1) adopts the target row's drummer, so you can paste
     D1 onto D2. A multi-part clip (D1 + D2 together) keeps each part on its
     own row, so both paste at once. Multi-measure clips keep their relative
     measure offsets. */
  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || clip.length === 0) return;
    const [anchorMeasure, anchorPart] = pasteTarget
      ? pasteTarget.split(":").map(Number)
      : [0, 0];
    const baseMeasure = clip[0].measure;
    const singlePart = new Set(clip.map((item) => item.part)).size === 1;
    updateProject((p) => {
      const md = materializeMeasureDrummers(p);
      // Compute the destination rows first (measure + part), so we can clear
      // them ONCE up front; otherwise each item's clear would wipe the notes
      // just pasted before it.
      const targets: { measure: number; part: number }[] = [];
      for (const item of clip) {
        const dest = anchorMeasure + (item.measure - baseMeasure);
        if (dest < 0 || dest >= p.measures) continue;
        targets.push({
          measure: dest,
          part: singlePart ? anchorPart : item.part,
        });
      }
      let notes = p.notes.filter(
        (n) =>
          !targets.some(
            (t) => n.measure === t.measure && (n.part ?? 0) === t.part
          )
      );
      const pasted: ScoreNote[] = [];
      for (const item of clip) {
        const dest = anchorMeasure + (item.measure - baseMeasure);
        if (dest < 0 || dest >= p.measures) continue;
        const part = singlePart ? anchorPart : item.part;
        for (const n of item.notes) {
          pasted.push({
            ...n,
            id: crypto.randomUUID(),
            measure: dest,
            part,
          });
        }
        if (item.notes.length > 0) {
          md[dest] = Array.from(
            new Set([...(md[dest] ?? []), part])
          ).sort((a, b) => a - b);
        }
      }
      // If two items wrote notes at the same slot (same measure + part), keep
      // the first one so the row never holds overlapping duplicates.
      const seenSlots = new Set<string>();
      notes = [
        ...notes,
        ...pasted.filter((n) => {
          const key = `${n.measure}:${n.part}:${n.slot}`;
          if (seenSlots.has(key)) return false;
          seenSlots.add(key);
          return true;
        }),
      ];
      return { ...p, notes, measureDrummers: md };
    });
    // Refresh the selection after pasting: clear the highlights so the score
    // shows a clean state. The paste anchor stays, so ⌘V can paste again at
    // the same spot or at a newly clicked row.
    setSelectedRows(new Set());
    setSelectedNotes(new Set());
    setNoteRangeAnchor(null);
  }, [pasteTarget, updateProject]);

  /* Build a rhythm group from the selected rows of the active drummer, then
     open the group editor to rename/edit it. */
  const createComboFromSelection = useCallback(() => {
    if (
      !project ||
      (selectedRows.size === 0 && selectedNotes.size === 0)
    ) {
      return;
    }
    let measures: { slot: number; zone: ZoneId; duration: DurationId }[][];
    if (selectedNotes.size > 0) {
      // Note mode: use exactly the picked notes of the active drummer.
      const byMeasure = new Map<
        number,
        { slot: number; zone: ZoneId; duration: DurationId }[]
      >();
      for (const key of selectedNotes) {
        const [m, p, s] = key.split(":").map(Number);
        if (p !== activePart) continue;
        const note = project.notes.find(
          (n) => n.measure === m && (n.part ?? 0) === p && n.slot === s
        );
        if (!note) continue;
        if (!byMeasure.has(m)) byMeasure.set(m, []);
        byMeasure.get(m)!.push({
          slot: note.slot,
          zone: note.zone,
          duration: note.duration,
        });
      }
      measures = Array.from(byMeasure.keys())
        .sort((a, b) => a - b)
        .map((m) => byMeasure.get(m)!.sort((a, b) => a.slot - b.slot));
    } else {
      measures = Array.from(selectedRows)
        .map((key) => {
          const [m, p] = key.split(":").map(Number);
          return { m, p };
        })
        .filter(({ p }) => p === activePart)
        .map(({ m }) => m)
        .filter((m, i, arr) => arr.indexOf(m) === i)
        .sort((a, b) => a - b)
        .map((m) =>
          project.notes
            .filter((n) => n.measure === m && (n.part ?? 0) === activePart)
            .sort((a, b) => a.slot - b.slot)
            .map((n) => ({
              slot: n.slot,
              zone: n.zone,
              duration: n.duration,
            }))
        );
    }
    const group: RhythmGroup = {
      id: crypto.randomUUID(),
      name: `Combo ${project.groups.length + 1} 组合${
        project.groups.length + 1
      }`,
      measures,
    };
    updateProject((p) => ({ ...p, groups: [...p.groups, group] }));
    setGroupEditorInitial(group.id);
    setGroupEditorOpen(true);
  }, [activePart, project, selectedNotes, selectedRows, updateProject]);

  const chooseGroup = useCallback((id: string) => {
    setActiveGroupId(id);
    setSelected(null);
  }, []);

  const handleSlotClick = useCallback(
    (
      measure: number,
      slot: number,
      part: number,
      shiftKey = false
    ) => {
      setLayoutMeasure(measure);
      // "Play From" is armed: the clicked note becomes the playback start.
      if (playFromArm) {
        const cellStart = slot * CELL_SLOTS;
        const note = notes.find(
          (n) =>
            n.measure === measure &&
            (n.part ?? 0) === part &&
            n.slot < cellStart + CELL_SLOTS &&
            cellStart < n.slot + SPAN[n.duration]
        );
        if (note) handlePlayFromNote(measure, part, note.slot);
        return;
      }
      if (selected === "select") {
        if (selectMode === "note") {
          const cellStart = slot * CELL_SLOTS;
          const note = notes.find(
            (n) =>
              n.measure === measure &&
              (n.part ?? 0) === part &&
              n.slot < cellStart + CELL_SLOTS &&
              cellStart < n.slot + SPAN[n.duration]
          );
          // Any cell click sets the paste anchor for this row, even when the
          // cell is empty, so pasting into an empty measure works.
          setPasteTarget(`${measure}:${part}`);
          if (note) {
            const key = `${measure}:${part}:${note.slot}`;
            if (shiftKey && noteRangeAnchor) {
              // Shift+click: select every note in reading order between the
              // anchor and this note, but only within the SAME drummer, so a
              // D1 range never sweeps up D2 notes along the way.
              const anchorPart = Number(noteRangeAnchor.split(":")[1]);
              if (part === anchorPart) {
                const ordered = [...notes]
                  .filter((n) => (n.part ?? 0) === anchorPart)
                  .sort((a, b) => a.measure - b.measure || a.slot - b.slot);
                const indexOf = (k: string) =>
                  ordered.findIndex(
                    (n) => `${n.measure}:${n.part ?? 0}:${n.slot}` === k
                  );
                const a = indexOf(noteRangeAnchor);
                const b = indexOf(key);
                if (a >= 0 && b >= 0) {
                  const [lo, hi] = a < b ? [a, b] : [b, a];
                  setSelectedNotes(
                    new Set(
                      ordered
                        .slice(lo, hi + 1)
                        .map((n) => `${n.measure}:${n.part ?? 0}:${n.slot}`)
                    )
                  );
                  setActivePart(part);
                }
              }
            } else {
              toggleNoteSelection(measure, part, note.slot);
              setNoteRangeAnchor(key);
            }
          }
        } else {
          toggleRowSelection(measure, part);
        }
        return;
      }
      if (!viewMode) ensureMeasurePart(measure, part);
      if (selected === "note") {
        // Free placement is handled by the page-level click handler, which
        // records the exact position (anywhere on the score).
        return;
      }
      if (activeGroupId) {
        const g =
          groups.find((gr) => gr.id === activeGroupId) ??
          allGroups.find(({ group }) => group.id === activeGroupId)?.group;
        if (g) insertGroup(measure, slot, g, part);
        return;
      }
      if (selected === "eraser") eraseAt(measure, slot, part);
      else if (selected) paintOrInsert(measure, slot, selected, part);
    },
    [
      activeGroupId,
      allGroups,
      ensureMeasurePart,
      eraseAt,
      groups,
      handlePlayFromNote,
      insertGroup,
      notes,
      noteRangeAnchor,
      paintOrInsert,
      playFromArm,
      selected,
      selectMode,
      toggleNoteSelection,
      toggleRowSelection,
      viewMode,
    ]
  );

  /* Note tool: click anywhere on a score page to place a note at that exact
     position. Clicking an existing note opens its editor instead. */
  const handleScorePageClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, p: number) => {
      if (selected !== "note" || viewMode) return;
      // Existing notes handle their own click (edit) and drag.
      if ((e.target as HTMLElement).closest?.("[data-ann-id]")) return;
      const pageEl = e.currentTarget;
      const rect = pageEl.getBoundingClientRect();
      const scale = rect.width / PAGE_W;
      const px = (e.clientX - rect.left) / scale;
      const py = (e.clientY - rect.top) / scale;

      // A note already sitting near the click → edit it.
      const hit = annotations.find(
        (a) =>
          a.page === p &&
          a.x !== undefined &&
          a.y !== undefined &&
          Math.abs(px - a.x) < 45 &&
          Math.abs(py - (a.y - 8)) < 16
      );
      if (hit) {
        setNoteModal({
          open: true,
          measure: hit.measure,
          part: hit.part ?? 0,
          page: hit.page,
          x: hit.x,
          y: hit.y,
          editId: hit.id,
        });
        return;
      }

      // Otherwise: nearest row gives the measure/drummer label; the note is
      // stored at the exact clicked coordinates.
      const row = metrics?.find(
        (r) =>
          r.page === p &&
          px >= r.x &&
          px <= r.x + r.w &&
          py >= r.y &&
          py <= r.y + r.height
      );
      const bound = pageBounds[p];
      const measure =
        row?.measure ?? (bound ? bound.start * MEASURES_PER_SYSTEM : 0);
      setNoteModal({
        open: true,
        measure,
        part: row?.part ?? 0,
        page: p,
        x: Math.round(px),
        y: Math.round(py),
      });
    },
    [annotations, metrics, pageBounds, selected, viewMode]
  );

  /* ------------------------------------------------------------------ */
  /* Project management                                                  */
  /* ------------------------------------------------------------------ */

  const deleteProject = useCallback(() => {
    if (!project) return;
    const ok = window.confirm(`Delete "${project.name}"? 确定删除该项目吗？`);
    if (!ok) return;
    // Remove the cloud copy too when we own it (fire-and-forget; RLS owner-only).
    if (cloudAvailable() && authStatus === "signed-in" && project.cloudRole !== "editor") {
      void supabase?.from("scores").delete().eq("id", project.id);
    }
    const rest = projectsList.filter((p) => p.id !== project.id);
    const nextList =
      rest.length > 0 ? rest : [createProject("Untitled Project 未命名项目")];
    saveProjects(nextList);
    setProjectsList(nextList);
    const next = nextList[0];
    setProject(next);
    saveActiveProjectId(next.id);
    setSelected("center");
    setCurrentPage(0);
    setActiveGroupId(null);
    setPlayhead(null);
    setSelectedRows(new Set());
    setSelectedNotes(new Set());
    setNoteRangeAnchor(null);
    setPasteTarget(null);
    projectRef.current = next;
    resetHistory();
    if (isPlaying) {
      Tone.Transport.stop();
      Tone.Transport.cancel();
      setIsPlaying(false);
    }
  }, [authStatus, isPlaying, project, projectsList, resetHistory]);

  const renameProject = useCallback(
    (name: string) => updateProject((p) => ({ ...p, name })),
    [updateProject]
  );

  /* ------------------------------------------------------------------ */
  /* Drag & drop                                                         */
  /* ------------------------------------------------------------------ */

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const [kind, id] = String(e.active.id).split(":");
    setDragItem({ kind: kind as DragItem["kind"], id });
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragItem(null);
      const { active, over } = e;
      if (!over) return;
      if (selected === "select") return;
      const [kind, id] = String(active.id).split(":");
      const overParts = String(over.id).split(":");
      if (overParts[0] !== "slot") return;
      const measure = Number(overParts[1]);
      const slot = Number(overParts[2]);
      const part = Number(overParts[3]) || 0;
      if (!viewMode) ensureMeasurePart(measure, part);
      if (kind === "zone") paintOrInsert(measure, slot, id as ZoneId, part);
      else if (kind === "pattern")
        insertPatternAt(
          measure,
          slot,
          selected &&
          selected !== "eraser" &&
          selected !== "note"
            ? selected
            : "center",
          id as PatternId,
          part
        );
      else if (kind === "eraser") eraseAt(measure, slot, part);
      else if (kind === "group") {
        const g =
          groups.find((gr) => gr.id === id) ??
          allGroups.find(({ group }) => group.id === id)?.group;
        if (g) insertGroup(measure, slot, g, part);
      }
    },
    [
      allGroups,
      ensureMeasurePart,
      eraseAt,
      groups,
      insertGroup,
      insertPatternAt,
      paintOrInsert,
      selected,
      viewMode,
    ]
  );

  /* ------------------------------------------------------------------ */
  /* Keyboard shortcuts (PRD: 1 = Center, 3 = Edge, X = Rim)             */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "1":
          chooseZone("center");
          e.preventDefault();
          break;
        case "3":
          chooseZone("edge");
          e.preventDefault();
          break;
        case "x":
        case "X":
          chooseZone("rim");
          e.preventDefault();
          break;
        case "e":
        case "E":
          chooseEraser();
          e.preventDefault();
          break;
        case "4":
          choosePattern("quad");
          e.preventDefault();
          break;
        case "t":
        case "T":
          choosePattern("triplet");
          e.preventDefault();
          break;
        case " ":
          e.preventDefault();
          void handlePlay();
          break;
        case "c":
        case "C":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            copySelection();
          }
          break;
        case "v":
        case "V":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            pasteClipboard();
          }
          break;
        case "a":
        case "A":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (selectMode === "note") {
              setSelectedNotes(
                new Set(
                  notes.map(
                    (n) => `${n.measure}:${n.part ?? 0}:${n.slot}`
                  )
                )
              );
              setPasteTarget(
                notes.length > 0
                  ? `${notes[0].measure}:${notes[0].part ?? 0}`
                  : "0:0"
              );
            } else {
              setSelectedRows(
                new Set(
                  Array.from({ length: measureCount }, (_, m) =>
                    Array.from(
                      { length: drummerCount },
                      (_, p) => `${m}:${p}`
                    )
                  ).flat()
                )
              );
              setPasteTarget("0:0");
            }
          }
          break;
        case "Delete":
        case "Backspace":
          if (selectedRows.size > 0 || selectedNotes.size > 0) {
            e.preventDefault();
            deleteSelectedRows();
          }
          break;
        case "z":
        case "Z":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
          }
          break;
        case "y":
        case "Y":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            redo();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    chooseEraser,
    choosePattern,
    chooseZone,
    copySelection,
    deleteSelectedRows,
    drummerCount,
    handlePlay,
    measureCount,
    notes,
    pasteClipboard,
    redo,
    selectedNotes,
    selectMode,
    selectedRows,
    undo,
  ]);

  /* ------------------------------------------------------------------ */
  /* Persistence: debounce the active project into the project list      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => {
      setProjectsList((prevList) => {
        const updated = { ...project, updatedAt: Date.now() };
        const next = prevList.some((p) => p.id === project.id)
          ? prevList.map((p) => (p.id === project.id ? updated : p))
          : [...prevList, updated];
        saveProjects(next);
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [project]);

  /* ------------------------------------------------------------------ */
  /* Cloud collaboration                                                 */
  /* ------------------------------------------------------------------ */

  /* Push dirty local edits to the cloud (debounced). Skipped in local mode
     or when signed out; the editor keeps working offline either way. */
  useEffect(() => {
    if (!mounted || !project) return;
    if (!cloudAvailable() || authStatus !== "signed-in" || !user) return;
    if (!dirtyRef.current) return;
    setSyncFlag("saving");
    const timer = window.setTimeout(() => {
      void (async () => {
        const pushedProject = projectRef.current;
        if (!pushedProject) return;
        const startedSeq = editSeq.current;
        const res = await pushProjectToCloud(pushedProject);
        if (res.ok) {
          lastPushedRevision.current = res.revision ?? null;
          const current = projectRef.current;
          if (current === pushedProject) {
            // Clean save — no edits landed while pushing.
            dirtyRef.current = false;
            setSyncFlag("idle");
            const updated: Project = {
              ...current,
              revision: res.revision,
              ownerId: current.ownerId ?? user.id,
              cloudRole: current.cloudRole ?? "owner",
              updatedAt: Date.now(),
            };
            projectRef.current = updated;
            setProject(updated);
            setProjectsList((prev) => {
              const next = prev.some((p) => p.id === updated.id)
                ? prev.map((p) => (p.id === updated.id ? updated : p))
                : [...prev, updated];
              saveProjects(next);
              return next;
            });
          } else if (editSeq.current === startedSeq) {
            // The project was replaced remotely while pushing — remote wins.
            dirtyRef.current = false;
            setSyncFlag("idle");
          } else {
            // Newer local edits landed during the flight — re-push them.
            dirtyRef.current = true;
            setSyncFlag("saving");
          }
        } else {
          setSyncFlag("error");
        }
      })();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [mounted, project, authStatus, user]);

  /* Ensure projects opened while signed in exist in the cloud, so they can
     be shared even before the first note is edited. Marks the project dirty
     once; the autosave effect above uploads it. */
  useEffect(() => {
    if (!mounted || !project || !cloudAvailable()) return;
    if (authStatus !== "signed-in" || !user) return;
    if (project.ownerId || project.revision != null) return;
    if (ensureCloudPushFor.current === project.id) return;
    ensureCloudPushFor.current = project.id;
    dirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, authStatus, project?.id, user?.id]);

  /* Realtime: apply remote edits to the open score when they are newer.
     Our own pushes are ignored via the revision echo guard. */
  useEffect(() => {
    if (!mounted || !project || !cloudAvailable() || authStatus !== "signed-in") {
      return;
    }
    const scoreId = project.id;
    const unsubscribe = subscribeScoreChanges(scoreId, (change) => {
      const current = projectRef.current;
      if (!current || current.id !== scoreId) return;
      // Never clobber unsaved local edits with a remote snapshot. The pending
      // local push will propagate them (last-write-wins), so the other side
      // still sees them — just a moment later.
      if (dirtyRef.current) return;
      const localRev = current.revision ?? 0;
      if (change.revision <= localRev) return;
      if (change.revision === lastPushedRevision.current) return; // our own echo
      const incoming = parseCloudProject(change.data);
      if (!incoming) return;
      dirtyRef.current = false;
      lastPushedRevision.current = change.revision;
      const updated: Project = {
        ...incoming,
        revision: change.revision,
        ownerId: current.ownerId ?? incoming.ownerId,
        cloudRole: current.cloudRole ?? "editor",
        visibility: incoming.visibility ?? current.visibility ?? "private",
        updatedAt: Date.now(),
      };
      projectRef.current = updated;
      setProject(updated);
      setProjectsList((prev) => {
        const next = prev.some((p) => p.id === updated.id)
          ? prev.map((p) => (p.id === updated.id ? updated : p))
          : [...prev, updated];
        saveProjects(next);
        return next;
      });
      resetHistory();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, authStatus, project?.id, user?.id]);

  /* Remote pull: poll the score's revision every few seconds and apply a
     newer revision (a collaborator's edits) when one appears. Realtime is
     also subscribed above as an accelerator where it works; polling keeps
     every project live regardless. */
  useEffect(() => {
    if (!mounted || !project || !cloudAvailable() || authStatus !== "signed-in") {
      return;
    }
    if (!supabase) return;
    const client = supabase;
    const scoreId = project.id;
    let cancelled = false;
    const poll = async () => {
      const { data: meta } = await client
        .from("scores")
        .select("revision")
        .eq("id", scoreId)
        .maybeSingle();
      if (cancelled || !meta) return;
      const remoteRev = (meta.revision as number) ?? 0;
      const current = projectRef.current;
      if (!current || current.id !== scoreId) return;
      if (remoteRev <= (current.revision ?? 0)) return;
      // Same guard as Realtime: don't overwrite edits made while fetching.
      if (dirtyRef.current) return;
      const { data: full } = await client
        .from("scores")
        .select("data, revision, updated_at")
        .eq("id", scoreId)
        .maybeSingle();
      if (cancelled || !full) return;
      const incoming = parseCloudProject(full.data);
      if (!incoming) return;
      lastPushedRevision.current = remoteRev;
      const updated: Project = {
        ...incoming,
        revision: remoteRev,
        ownerId: current.ownerId ?? incoming.ownerId,
        cloudRole: current.cloudRole ?? "editor",
        visibility: incoming.visibility ?? current.visibility ?? "private",
        updatedAt: Date.now(),
      };
      dirtyRef.current = false;
      projectRef.current = updated;
      setProject(updated);
      setProjectsList((prev) => {
        const next = prev.some((p) => p.id === updated.id)
          ? prev.map((p) => (p.id === updated.id ? updated : p))
          : [...prev, updated];
        saveProjects(next);
        return next;
      });
      resetHistory();
    };
    void (async () => {
      await poll();
    })();
    const interval = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, authStatus, project?.id, user?.id]);

  /* Share link deep link: /editor?share=<token> claims the invite and opens
     the shared score. Runs once after auth settles. */
  useEffect(() => {
    if (!mounted || shareClaimHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const share = params.get("share");
    if (!share) return;
    if (!cloudAvailable()) {
      shareClaimHandled.current = true;
      window.alert(
        "Cloud sharing is not configured yet — see docs/DEPLOYMENT.md 云服务尚未配置，无法打开分享链接"
      );
      history.replaceState(null, "", "/editor");
      return;
    }
    if (authStatus !== "signed-in") {
      // Wait for auth; redirect to login if the user is signed out.
      if (authStatus === "signed-out") {
        router.push(`/login?next=${encodeURIComponent(`/editor?share=${share}`)}`);
      }
      return;
    }
    shareClaimHandled.current = true;
    void (async () => {
      const res = await claimShareInvite(share);
      if (res.project) {
        const claimed: Project = {
          ...res.project,
          cloudRole: "editor",
          revision: 0,
          updatedAt: Date.now(),
        };
        dirtyRef.current = false;
        projectRef.current = claimed;
        setProject(claimed);
        setProjectsList((prev) => {
          const next = prev.some((p) => p.id === claimed.id)
            ? prev.map((p) => (p.id === claimed.id ? claimed : p))
            : [...prev, claimed];
          saveProjects(next);
          return next;
        });
        saveActiveProjectId(claimed.id);
        resetHistory();
        setCurrentPage(0);
        setViewMode(false);
        history.replaceState(null, "", "/editor");
      } else {
        window.alert(res.error ?? "Failed to open share link 打开分享链接失败");
        history.replaceState(null, "", "/editor");
      }
    })();
  }, [mounted, authStatus, resetHistory, router]);

  /* Load projects and the active one after mount. */
  useEffect(() => {
    // Deferred one tick so the first client render matches the server HTML
    // (the placeholder), then mount the editor and restore local data.
    const timer = setTimeout(() => {
      setMounted(true);
      try {
        let list = loadProjects();
        if (list.length === 0) {
          const legacy = migrateLegacyDraft();
          list = legacy
            ? [legacy]
            : [createProject("Untitled Project 未命名项目")];
          saveProjects(list);
        }
        setProjectsList(list);
        const activeId = loadActiveProjectId();
        const active = list.find((p) => p.id === activeId) ?? list[0];
        setProject(active);
        saveActiveProjectId(active.id);
        resetHistory();
        // Deep link from the dashboard: ?group=<id> opens the group editor
        // with that group selected.
        const groupParam = new URLSearchParams(window.location.search).get(
          "group"
        );
        if (groupParam && active.groups.some((g) => g.id === groupParam)) {
          setGroupEditorInitial(groupParam);
          setGroupEditorOpen(true);
        }
      } catch {
        const fallback = createProject("Untitled Project 未命名项目");
        setProjectsList([fallback]);
        setProject(fallback);
        saveProjects([fallback]);
        saveActiveProjectId(fallback.id);
        resetHistory();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [resetHistory]);

  /* Fit the current page to the actual score container: measure the column
     (ResizeObserver keeps it in sync as the layout changes), then scale the
     A4 sheet to fill it — usable on phones, laptops and big monitors. */
  useEffect(() => {
    const compute = () => {
      const el = scoreAreaRef.current;
      if (!el) return;
      const availW = el.clientWidth - 16;
      if (availW <= 0) return;
      // Fit the page to the score pane's width; tall pages scroll vertically
      // inside the pane (header and sidebar stay fixed).
      setFitAvailW(availW);
      setPageScale(Math.min(1.5, Math.max(0.35, availW / PAGE_W)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (scoreAreaRef.current) ro.observe(scoreAreaRef.current);
    // Bars above the score can change height (settings panel, wrapping), so
    // re-measure whenever the page layout changes.
    ro.observe(document.body);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [mounted]);

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  if (!mounted) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/70 text-sm text-zinc-500">
        Loading editor 加载编辑器…
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5">
        {/* Project settings: name, description and author — printed on the
            first page of the score, centred in Times New Roman. */}
        {showSettings && !viewMode && (
          <div className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Project Name 项目名称
              </span>
              <input
                value={project?.name ?? ""}
                onChange={(e) => renameProject(e.target.value)}
                name="projectName"
                autoComplete="off"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Author 作者
              </span>
              <div className="flex gap-2">
                <select
                  value={project?.authorRole ?? "custom"}
                  onChange={(e) =>
                    updateProject((p) => ({
                      ...p,
                      authorRole: e.target.value as Project["authorRole"],
                    }))
                  }
                  aria-label="Author role 作者标注"
                  className="w-44 shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-sm text-zinc-100"
                >
                  <option value="transcribed">Transcribed By 改编</option>
                  <option value="music">Music By 作曲</option>
                  <option value="custom">Custom 自定义</option>
                </select>
                <input
                  value={project?.author ?? ""}
                  onChange={(e) =>
                    updateProject((p) => ({ ...p, author: e.target.value }))
                  }
                  name="author"
                  autoComplete="off"
                  placeholder="Composer / troupe 作曲者 / 鼓队"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Description 描述
              </span>
              <textarea
                value={project?.description ?? ""}
                onChange={(e) =>
                  updateProject((p) => ({ ...p, description: e.target.value }))
                }
                name="description"
                autoComplete="off"
                rows={2}
                placeholder="Choreography notes, style, occasion… 编舞说明、风格、场合…"
                className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
              />
            </label>
          </div>
        )}

        {/* Ribbon toolbar: Word-style tabs with groups under each tab. The
            transport (play/BPM) stays visible as a quick-access area. */}
        {!viewMode && (
        <div className="shrink-0 bg-zinc-950/40">
          <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 px-2">
            {(
              [
                ["home", "🏠 Home 主页"],
                ["notes", "♪ Notes 音符"],
                ["ensemble", "🥁 Ensemble 鼓手"],
                ["score", "📄 Score 乐谱"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-pressed={activeTab === id}
                className={[
                  "border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
                  activeTab === id
                    ? "border-amber-500 text-amber-300"
                    : "border-transparent text-zinc-400 hover:text-zinc-100",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5 pl-1.5">
              <button
                onClick={() => {
                  if (isPlaying) {
                    Tone.Transport.stop();
                    Tone.Transport.cancel();
                    playTokenRef.current++;
                    setPlayhead(null);
                    setIsPlaying(false);
                  }
                  setPlayFromArm(true);
                }}
                title={
                  playFromArm
                    ? "Click a note to start 点击音符开始播放"
                    : "Play from a note 从音符开始播放"
                }
                className={[
                  "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  playFromArm
                    ? "border-cyan-400 bg-cyan-400/15 text-cyan-300"
                    : "border-zinc-700 text-zinc-300 hover:border-cyan-400 hover:text-cyan-300",
                ].join(" ")}
              >
                ▶ From 从..
              </button>
              <button
                onClick={handlePlay}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
                title="Play / pause 播放 / 暂停"
              >
                {isPlaying ? "■ Stop 停止" : "▶ Play 播放"}
              </button>
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <span className="font-semibold uppercase tracking-wider text-zinc-500">
                  BPM
                </span>
                <input
                  type="range"
                  min={40}
                  max={240}
                  name="bpm"
                  value={bpm}
                  onChange={(e) =>
                    updateProject((p) => ({
                      ...p,
                      bpm: Number(e.target.value),
                    }))
                  }
                  className="w-20 accent-amber-500"
                />
                <span className="w-8 text-right font-mono text-zinc-100">
                  {bpm}
                </span>
              </label>
              {syncStatus === "local" && (
                <span
                  title="Local mode — connect Supabase to share 本地模式，配置 Supabase 后可分享"
                  className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-500"
                >
                  Local 本地
                </span>
              )}
              {syncStatus === "signed-out" && (
                <a
                  href="/login?next=/editor"
                  title="Sign in to sync and share 登录后同步与分享"
                  className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-amber-300/90 transition-colors hover:border-amber-500 hover:text-amber-300"
                >
                  Sign in 登录
                </a>
              )}
              {syncStatus === "saving" && (
                <span className="animate-pulse rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-300">
                  ☁ Saving… 保存中
                </span>
              )}
              {syncStatus === "synced" && (
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                  ☁ Synced 已同步
                </span>
              )}
              {syncStatus === "error" && (
                <span
                  title="Cloud save failed — check your connection 云端保存失败"
                  className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300"
                >
                  Sync error 同步失败
                </span>
              )}
              <button
                onClick={() => setShareOpen(true)}
                title="Share & collaborate 分享协作"
                className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
              >
                🔗 Share 分享
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 pb-1.5 pt-1 [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-amber-400/70">
          {activeTab === "home" && (
          <ToolGroup label="Project 项目">
            <span
              className="max-w-24 truncate px-1 text-xs font-semibold text-zinc-200"
              title={project?.name ?? ""}
            >
              {project?.name ?? ""}
            </span>
            {project?.cloudRole === "editor" && (
              <span className="rounded-full border border-cyan-500/50 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                Shared 共享
              </span>
            )}
            {!viewMode && (
              <button
                onClick={() => setShowSettings((v) => !v)}
                className={[
                  "rounded-xl border px-3 py-2 text-sm transition-colors",
                  showSettings
                    ? "border-amber-500 text-amber-300"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500",
                ].join(" ")}
              >
                ⚙ Settings 设置
              </button>
            )}
            <button
              onClick={deleteProject}
              className="rounded-xl border border-red-900 px-3 py-2 text-sm text-red-400 transition-colors hover:border-red-700 hover:text-red-300"
              title="Delete project 删除项目"
            >
              Delete 删除
            </button>
          </ToolGroup>
          )}

          {activeTab === "home" && (
          <ToolGroup label="Mode 模式">
            <button
              onClick={() => setViewMode((v) => !v)}
              className={[
                "rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
                viewMode
                  ? "border-amber-500 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                  : "border-zinc-700 text-zinc-300 hover:border-amber-500 hover:text-amber-300",
              ].join(" ")}
            >
              {viewMode ? "✏️ Edit 编辑模式" : "👁 View 视图模式"}
            </button>
            {!viewMode && (
              <button
                onClick={() => {
                  setActiveGroupId(null);
                  setSelected(selected === "select" ? "center" : "select");
                }}
                aria-pressed={selected === "select"}
                className={[
                  "rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
                  selected === "select"
                    ? "border-lime-400 bg-lime-400/15 text-lime-300 hover:bg-lime-400/25"
                    : "border-zinc-700 text-zinc-300 hover:border-lime-400 hover:text-lime-300",
                ].join(" ")}
              >
                ☐ Select 选择
              </button>
            )}
            {selected === "select" && (
              <SelectModeToggle
                mode={selectMode}
                onChange={changeSelectMode}
              />
            )}
          </ToolGroup>
          )}

          {activeTab === "ensemble" && (
            <>
          <ToolGroup label="Ensemble 鼓手">
            <div
              role="group"
              aria-label="Drummers 鼓手"
              className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-700 p-1"
            >
            <span className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Drummer 鼓手
            </span>
            {Array.from({ length: drummerCount }, (_, pt) => (
              <button
                key={pt}
                onClick={() => setActivePart(pt)}
                aria-pressed={activePart === pt}
                style={
                  activePart === pt
                    ? {
                        backgroundColor: `${colorFor(pt)}22`,
                        color: colorFor(pt),
                        borderColor: `${colorFor(pt)}88`,
                      }
                    : undefined
                }
                className={[
                  "rounded-lg border border-transparent px-3 py-1.5 text-sm font-semibold transition-colors",
                  activePart === pt
                    ? ""
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                ].join(" ")}
              >
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{
                    backgroundColor: colorFor(pt),
                    opacity: activePart === pt ? 1 : 0.55,
                  }}
                />
                {pt + 1}
              </button>
            ))}
            <button
              onClick={() => {
                const next = Math.min(8, drummerCount + 1);
                if (next <= drummerCount) return;
                updateProject((p) => {
                  // The new drummer starts active everywhere; the composer
                  // can then hide them per measure with the layout panel.
                  const prev = Math.max(1, p.drummers ?? 1);
                  const md = materializeMeasureDrummers(p);
                  for (let m = 0; m < md.length; m++) {
                    if (!md[m].includes(prev)) md[m] = [...md[m], prev];
                  }
                  return {
                    ...p,
                    drummers: next,
                    drummerVolumes: [
                      ...(p.drummerVolumes ?? [60]),
                      60,
                    ],
                    drummerColors: [
                      ...(p.drummerColors ?? []),
                      DEFAULT_DRUMMER_COLORS[
                        (next - 1) % DEFAULT_DRUMMER_COLORS.length
                      ],
                    ],
                    measureDrummers: md,
                  };
                });
                setActivePart(drummerCount);
              }}
              aria-label="Add drummer 添加鼓手"
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
            >
              ＋
            </button>
            <button
              onClick={() => {
                if (drummerCount <= 1) return;
                const hasNotes = notes.some(
                  (n) => (n.part ?? 0) === drummerCount - 1
                );
                if (
                  hasNotes &&
                  !window.confirm(
                    `Remove drummer ${drummerCount} and their notes? 确定移除鼓手 ${
                      drummerCount
                    } 及其音符吗？`
                  )
                ) {
                  return;
                }
                const next = drummerCount - 1;
                updateProject((p) => ({
                  ...p,
                  drummers: next,
                  drummerVolumes: (p.drummerVolumes ?? [60]).slice(0, next),
                  drummerColors: (p.drummerColors ?? []).slice(0, next),
                  notes: p.notes.filter((n) => (n.part ?? 0) < next),
                  measureDrummers: (p.measureDrummers ?? []).map((list) =>
                    list.filter((i) => i < next)
                  ),
                }));
                setActivePart((cur) => Math.min(cur, next - 1));
              }}
              aria-label="Remove last drummer 移除最后一位鼓手"
              disabled={drummerCount <= 1}
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-300 transition-colors hover:border-red-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            </div>
          </ToolGroup>

          <ToolGroup label="Drummer Settings 鼓手设置">
            <label className="flex items-center justify-between gap-2 text-sm text-zinc-300">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Color 颜色
              </span>
              <input
                type="color"
                value={colorFor(activePart)}
                onChange={(e) => {
                  const v = e.target.value;
                  updateProject((p) => {
                    const colors = [...(p.drummerColors ?? [])];
                    while (colors.length <= activePart) {
                      colors.push(
                        DEFAULT_DRUMMER_COLORS[
                          colors.length % DEFAULT_DRUMMER_COLORS.length
                        ]
                      );
                    }
                    colors[activePart] = v;
                    return { ...p, drummerColors: colors };
                  });
                }}
                aria-label="Drummer color 鼓手颜色"
                className="h-7 w-10 cursor-pointer rounded border border-zinc-700 bg-transparent p-0.5"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Vol 音量
              </span>
              <input
                type="range"
                min={0}
                max={100}
                name="drummerVolume"
                value={drummerVolumes[activePart] ?? 60}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  updateProject((p) => {
                    const vols = [...(p.drummerVolumes ?? [60])];
                    while (vols.length <= activePart) vols.push(60);
                    vols[activePart] = v;
                    return { ...p, drummerVolumes: vols };
                  });
                }}
                className="w-24 accent-amber-500"
              />
              <span className="w-8 text-right font-mono text-zinc-100">
                {drummerVolumes[activePart] ?? 60}
              </span>
            </label>
          </ToolGroup>
            </>
          )}
          {!viewMode && activeTab === "home" && (
            <ToolGroup label="Clipboard 剪贴板">
              <span className="min-w-16 text-xs text-zinc-400">
                {selectedRows.size + selectedNotes.size > 0
                  ? `${selectedRows.size + selectedNotes.size} selected 已选择`
                  : "Select 选择"}
              </span>
              <button
                onClick={copySelection}
                disabled={selectedRows.size + selectedNotes.size === 0}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                title="⌘C / Ctrl+C"
              >
                Copy 复制
              </button>
              <button
                onClick={pasteClipboard}
                disabled={!hasClipboard}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                title="⌘V / Ctrl+V"
              >
                Paste 粘贴
              </button>
              <button
                onClick={deleteSelectedRows}
                disabled={selectedRows.size + selectedNotes.size === 0}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                title="Delete selected rows 删除所选 · Del / Backspace"
              >
                ⌫ Delete Selected 删除所选
              </button>
              <button
                onClick={createComboFromSelection}
                disabled={selectedRows.size + selectedNotes.size === 0}
                className="rounded-xl border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ✦ Create Combo 创建组合
              </button>
            </ToolGroup>
          )}
          {activeTab === "score" && (
          <ToolGroup label="Export 导出">
            <button
              onClick={() => setCombineOpen(true)}
              className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
              title="Combine with other projects 与其他项目合并"
            >
              ✦ Combine 合并
            </button>
            <button
              onClick={handleExportPdf}
              disabled={exporting}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? "Preparing… 准备中" : "⬇ Download PDF 下载PDF"}
            </button>
          </ToolGroup>
          )}
          {!viewMode && activeTab === "score" && (
            <ToolGroup label="Score 乐谱">
              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <span className="text-zinc-500">Measures 小节</span>
                <button
                  onClick={() => changeMeasureCount(measureCount - 1)}
                  aria-label="Decrease measures 减少小节"
                  className="h-7 w-7 rounded-lg border border-zinc-700 transition-colors hover:border-zinc-500"
                >
                  −
                </button>
                <span className="w-6 text-center font-mono text-zinc-100">
                  {measureCount}
                </span>
                <button
                  onClick={() => changeMeasureCount(measureCount + 1)}
                  aria-label="Increase measures 增加小节"
                  className="h-7 w-7 rounded-lg border border-zinc-700 transition-colors hover:border-zinc-500"
                >
                  +
                </button>
              </div>
            </ToolGroup>
          )}
          {activeTab === "notes" && (
            <div className="grid w-full grid-cols-12 gap-x-6">
              <ToolGroup label="Sound Zones 音色" className="col-span-12 sm:col-span-4">
                <div className="grid w-full grid-cols-3 gap-1.5">
                  {ZONES.map((z) => (
                    <button
                      key={z.id}
                      onClick={() => chooseZone(z.id)}
                      aria-pressed={selected === z.id}
                      title={z.en}
                      className={[
                        "flex h-12 w-full items-center justify-center gap-2 rounded-xl border px-2 text-base font-semibold transition-colors",
                        selected === z.id
                          ? "border-amber-500 bg-amber-500/15 text-amber-300"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100",
                      ].join(" ")}
                    >
                      <span
                        className={
                          z.id === "center"
                            ? "text-red-400"
                            : z.id === "edge"
                              ? "text-amber-400"
                              : "text-sky-400"
                        }
                      >
                        {z.symbol}
                      </span>
                      <span>{z.zh}</span>
                    </button>
                  ))}
                </div>
              </ToolGroup>
              <ToolGroup
                label="Rhythm Patterns 节奏型"
                className="col-span-12 sm:col-span-5"
              >
                <div className="grid w-full grid-cols-4 gap-1">
                  {PATTERNS.filter((pt) => !pt.zones).map((pt) => (
                    <button
                      key={pt.id}
                      onClick={() => choosePattern(pt.id)}
                      aria-pressed={pattern === pt.id && !paintMode}
                      title={pt.label}
                      className={[
                        "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
                        pattern === pt.id && !paintMode
                          ? "border-amber-500 bg-amber-500/15 text-amber-300"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100",
                      ].join(" ")}
                    >
                      <span className="shrink-0 font-mono">{pt.short}</span>
                      <span className="truncate">{pt.label}</span>
                    </button>
                  ))}
                </div>
              </ToolGroup>
              <ToolGroup
                label="Common Mixes 常用混合"
                className="col-span-12 sm:col-span-3"
              >
                <div className="grid w-full grid-cols-2 gap-1">
                  {PATTERNS.filter((pt) => pt.zones).map((pt) => (
                    <button
                      key={pt.id}
                      onClick={() => choosePattern(pt.id)}
                      aria-pressed={pattern === pt.id && !paintMode}
                      title={pt.label}
                      className={[
                        "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
                        pattern === pt.id && !paintMode
                          ? "border-amber-500 bg-amber-500/15 text-amber-300"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100",
                      ].join(" ")}
                    >
                      <span className="flex shrink-0 items-center gap-0.5 font-mono">
                        {Array.from(pt.short).map((ch, i) => (
                          <span
                            key={i}
                            className={
                              ch === "●"
                                ? "text-red-400"
                                : ch === "▲"
                                  ? "text-amber-400"
                                  : ch === "✕"
                                    ? "text-amber-400"
                                    : "text-sky-400"
                            }
                          >
                            {ch}
                          </span>
                        ))}
                      </span>
                      <span className="truncate">{pt.label}</span>
                    </button>
                  ))}
                </div>
              </ToolGroup>
            </div>
          )}
          </div>
        </div>
        )}
        {/* View mode is distraction-free: only the Edit toggle remains. */}
        {viewMode && (
          <div className="flex shrink-0 items-center justify-center px-3 py-2">
            <button
              onClick={() => setViewMode(false)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
            >
              ✏️ Edit 编辑模式
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 lg:flex-row lg:overflow-hidden">
          {/* Left palette */}
          {!viewMode && (
          <aside className="order-2 w-full shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 lg:order-none lg:h-full lg:w-60 lg:overflow-y-auto">
            <div className="divide-y divide-zinc-800/70">
            <PanelSection
              title="Tools 工具"
              open={openSections.has("tools")}
              onToggle={() => toggleSection("tools")}
            >
              <div className="flex flex-col gap-1.5">
                <CompactToolButton
                  id="select:select"
                  symbol="☐"
                  label="Select 选择"
                  selected={selected === "select"}
                  onClick={() => {
                    setActiveGroupId(null);
                    setSelected(selected === "select" ? "center" : "select");
                  }}
                />
                <CompactToolButton
                  id="eraser:eraser"
                  symbol="⌫"
                  label="Eraser 橡皮"
                  selected={selected === "eraser"}
                  onClick={chooseEraser}
                />
                <CompactToolButton
                  id="note:note"
                  symbol="✎"
                  label="Note 备注"
                  selected={selected === "note"}
                  onClick={chooseNote}
                />
                {selected === "select" && (
                  <SelectModeToggle
                    mode={selectMode}
                    onChange={changeSelectMode}
                    full
                  />
                )}
              </div>
            </PanelSection>

            <PanelSection
              title="Edit 编辑"
              open={openSections.has("edit")}
              onToggle={() => toggleSection("edit")}
            >
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={undo}
                  disabled={!canUndo}
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Undo 撤销 · ⌘Z / Ctrl+Z"
                >
                  ↩ <span>Undo 撤销</span>
                </button>
                <button
                  onClick={redo}
                  disabled={!canRedo}
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Redo 重做 · ⌘⇧Z / Ctrl+Y"
                >
                  ↪ <span>Redo 重做</span>
                </button>
                <button
                  onClick={clearAll}
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  ✕ <span>Clear 清空</span>
                </button>
              </div>
            </PanelSection>

            {multiDrummer && (
              <PanelSection
                title="Measure Parts 分声部"
                open={openSections.has("measureParts")}
                onToggle={() => toggleSection("measureParts")}
              >
                <div className="mb-2 flex items-center gap-2 text-sm text-zinc-300">
                  <span className="text-zinc-500">Measure 小节</span>
                  <button
                    onClick={() =>
                      setLayoutMeasure(
                        Math.max(0, layoutMeasureClamped - 1)
                      )
                    }
                    aria-label="Previous measure 上一小节"
                    className="h-7 w-7 rounded-lg border border-zinc-700 transition-colors hover:border-zinc-500"
                  >
                    ‹
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={measureCount}
                    value={layoutMeasureClamped + 1}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        setLayoutMeasure(
                          Math.min(measureCount - 1, Math.max(0, v - 1))
                        );
                      }
                    }}
                    aria-label="Measure number 小节编号"
                    className="w-14 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-center font-mono text-zinc-100"
                  />
                  <button
                    onClick={() =>
                      setLayoutMeasure(
                        Math.min(
                          measureCount - 1,
                          layoutMeasureClamped + 1
                        )
                      )
                    }
                    aria-label="Next measure 下一小节"
                    className="h-7 w-7 rounded-lg border border-zinc-700 transition-colors hover:border-zinc-500"
                  >
                    ›
                  </button>
                  <span className="ml-auto text-xs text-zinc-500">
                    / {measureCount}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {Array.from({ length: drummerCount }, (_, pt) => {
                    const activeParts = activeFor(layoutMeasureClamped);
                    const active = activeParts.includes(pt);
                    const locked = active && activeParts.length <= 1;
                    return (
                      <button
                        key={pt}
                        onClick={() =>
                          toggleMeasurePart(layoutMeasureClamped, pt)
                        }
                        aria-pressed={active}
                        disabled={locked}
                        title={
                          locked
                            ? "At least one drummer must play 至少保留一位鼓手"
                            : undefined
                        }
                        className={[
                          "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed",
                          active
                            ? "border-amber-500/60 bg-amber-500/10 text-zinc-100 hover:bg-amber-500/20"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-600",
                        ].join(" ")}
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: colorFor(pt),
                            opacity: active ? 1 : 0.35,
                          }}
                        >
                        </span>
                        <span className="font-semibold">
                          Drummer {pt + 1} 鼓手{pt + 1}
                        </span>
                        <span className="ml-auto text-xs">
                          {active ? "Play 参与" : "Rest 休止"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-zinc-500">
                  View mode keeps drummer 1 in every measure; drummers 2+
                  appear only where they have notes: empty rows are removed
                  (e.g. drummer 2 stops playing after measure 8). These
                  toggles assign a drummer to a measure (editing a ghost row
                  adds them automatically). At least one drummer always
                  plays.
                </p>
              </PanelSection>
            )}

            <PanelSection
              title="Rhythm Groups 节奏组合"
              open={openSections.has("groups")}
              onToggle={() => toggleSection("groups")}
            >

              {/* Sliding-door tabs: Project (current project) vs Yours (all
                  groups saved across your other projects). */}
              <div className="relative mb-2 grid grid-cols-2 rounded-lg border border-zinc-700 bg-zinc-950/50 p-1">
                <span
                  aria-hidden
                  className={[
                    "absolute inset-y-1 left-1 w-[calc(50%-0.5rem)] rounded-md bg-amber-500/25 transition-transform duration-200",
                    groupTab === "yours"
                      ? "translate-x-[calc(100%+0.25rem)]"
                      : "",
                  ].join(" ")}
                />
                <button
                  onClick={() => setGroupTab("project")}
                  className={[
                    "relative z-10 rounded-md px-2 py-1.5 text-xs transition-colors",
                    groupTab === "project"
                      ? "font-semibold text-amber-300"
                      : "text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                >
                  Project 本项目
                </button>
                <button
                  onClick={() => setGroupTab("yours")}
                  className={[
                    "relative z-10 rounded-md px-2 py-1.5 text-xs transition-colors",
                    groupTab === "yours"
                      ? "font-semibold text-amber-300"
                      : "text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                >
                  Yours 我的
                </button>
              </div>

              {groupTab === "project" ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      value={sourceMeasure + 1}
                      onChange={(e) =>
                        setCaptureMeasure(Number(e.target.value) - 1)
                      }
                      aria-label="Capture source measure 创建来源小节"
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                    >
                      {Array.from({ length: measureCount }, (_, i) => (
                        <option key={i} value={i + 1}>
                          M{i + 1}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={openGroupEditor}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
                    >
                      Capture / Edit 创建 / 编辑
                    </button>
                  </div>
                  {groups.length === 0 ? (
                    <p className="text-xs leading-5 text-zinc-600">
                      Capture a measure or build your own group in the editor,
                      then click a group and click any slot to insert it.
                      创建或编辑节奏组合，点击组合后再点谱面槽位插入。
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {groups.map((g) => (
                        <div key={g.id} className="flex items-center gap-1">
                          <div className="min-w-0 flex-1">
                            <PaletteItem
                              id={`group:${g.id}`}
                              symbol="▤"
                              label={g.name}
                              sub={`${g.measures.reduce(
                                (a, m) => a + m.length,
                                0
                              )} hits · ${g.measures.length} bar${
                                g.measures.length > 1 ? "s" : ""
                              } · click slot to insert`}
                              selected={activeGroupId === g.id}
                              onClick={() => chooseGroup(g.id)}
                            />
                          </div>
                          <button
                            onClick={() => deleteGroup(g.id)}
                            aria-label={`Delete ${g.name}`}
                            className="rounded-lg border border-zinc-700 px-2.5 py-2 text-zinc-500 transition-colors hover:border-red-800 hover:text-red-400"
                          >
                            ×
                          </button>
                          <GroupPreviewButton group={g} bpm={bpm} />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : yoursGroups.length === 0 ? (
                <p className="text-xs leading-5 text-zinc-600">
                  No groups in your other projects yet. Capture one anywhere
                  and it will appear here. 其他项目还没有节奏组合，去任意项目
                  创建后就会出现在这里。
                </p>
              ) : (
                <div className="space-y-2">
                  {yoursGroups.map(({ group: g, project: p }) => (
                    <div key={g.id} className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <PaletteItem
                          id={`group:${g.id}`}
                          symbol="▤"
                          label={g.name}
                          sub={`${p.name} · ${g.measures.reduce(
                            (a, m) => a + m.length,
                            0
                          )} hits · click slot to insert`}
                          selected={activeGroupId === g.id}
                          onClick={() => chooseGroup(g.id)}
                        />
                      </div>
                      <GroupPreviewButton group={g} bpm={p.bpm} />
                    </div>
                  ))}
                </div>
              )}
            </PanelSection>

            <PanelSection
              title="Shortcuts 快捷键"
              open={openSections.has("shortcuts")}
              onToggle={() => toggleSection("shortcuts")}
            >
              <div className="rounded-xl bg-zinc-950/60 p-3 text-xs leading-5 text-zinc-500">
                <span className="font-semibold text-zinc-400">
                  Keyboard 快捷键
                </span>
                <br />
                1 · 鼓心 &nbsp;3 · 鼓边 &nbsp;X · 鼓棒
                <br />
                E · eraser &nbsp;4 · 四连音 &nbsp;T · 三连音
                <br />
                Space · play/stop &nbsp;⌘C / ⌘V · copy/paste
                <br />
                ⌘A · select all &nbsp;Del · delete selection
                <br />
                ⌘Z · undo &nbsp;⌘⇧Z / ⌘Y · redo
              </div>
            </PanelSection>
            </div>
          </aside>
          )}

          {/* Center stave canvas */}
          <div
            ref={scoreScrollRef}
            className="order-1 flex min-w-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 lg:order-none lg:min-h-0 lg:overflow-auto"
          >
          {/* Page navigation + view-mode zoom/layout, fixed and centred
              above the score. */}
          <div className="sticky top-0 z-20 -mx-1 mb-2 flex justify-center">
            <div className="flex items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-2.5 py-1 text-xs text-zinc-300 shadow-lg">
              <button
                onClick={() => setCurrentPage(Math.max(0, page - 1))}
                disabled={page === 0}
                aria-label="Previous page 上一页"
                className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-zinc-100 disabled:opacity-40"
              >
                ‹
              </button>
              <select
                value={page + 1}
                onChange={(e) => setCurrentPage(Number(e.target.value) - 1)}
                aria-label="Page selector 页码选择"
                className="rounded-md bg-transparent px-1.5 py-0.5 text-xs text-zinc-100"
              >
                {Array.from({ length: pageCount }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1} / {pageCount}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  setCurrentPage(Math.min(pageCount - 1, page + 1))
                }
                disabled={page >= pageCount - 1}
                aria-label="Next page 下一页"
                className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-zinc-100 disabled:opacity-40"
              >
                ›
              </button>
              {viewMode && (
                <>
                  <span className="mx-1 h-4 w-px bg-zinc-700" />
                  <button
                    onClick={() => zoomStep(-1)}
                    aria-label="Zoom out 缩小"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-zinc-100"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setViewZoom(null)}
                    title="Fit to column 适应宽度"
                    className="rounded-full px-1.5 font-semibold text-zinc-300 transition-colors hover:text-zinc-100"
                  >
                    {Math.round(effectiveScale * 100)}%
                  </button>
                  <button
                    onClick={() => zoomStep(1)}
                    aria-label="Zoom in 放大"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-zinc-100"
                  >
                    +
                  </button>
                  <span className="mx-1 h-4 w-px bg-zinc-700" />
                  <button
                    onClick={() => setViewLayout("single")}
                    aria-pressed={viewLayout === "single"}
                    title="One page per view 单页显示"
                    className={[
                      "rounded-full px-2 py-0.5 font-semibold transition-colors",
                      viewLayout === "single"
                        ? "bg-amber-500/15 text-amber-300"
                        : "text-zinc-400 hover:text-zinc-100",
                    ].join(" ")}
                  >
                    1pg
                  </button>
                  <button
                    onClick={() => setViewLayout("double")}
                    aria-pressed={viewLayout === "double"}
                    title="Two pages side by side 双页并排"
                    className={[
                      "rounded-full px-2 py-0.5 font-semibold transition-colors",
                      viewLayout === "double"
                        ? "bg-amber-500/15 text-amber-300"
                        : "text-zinc-400 hover:text-zinc-100",
                    ].join(" ")}
                  >
                    2pg
                  </button>
                </>
              )}
            </div>
          </div>
          {/* Page view: one page, or two side by side in view mode; zoom is
              user-controlled in view mode, auto-fit otherwise. */}
          <div
            ref={scoreAreaRef}
            className={
              viewMode && viewLayout === "double"
                ? "relative flex min-h-[60vh] flex-1 items-start justify-center gap-5 lg:min-h-0"
                : "relative min-h-[60vh] flex-1 lg:min-h-0"
            }
          >
          {Array.from({ length: pageCount }, (_, p) => (
            <div
              key={p}
              onClick={(e) => handleScorePageClick(e, p)}
              className={[
                "score-page relative overflow-hidden",
                viewMode && viewLayout === "double" ? "" : "mx-auto",
                p === page || (viewMode && viewLayout === "double" && p === page + 1)
                  ? ""
                  : "hidden",
              ].join(" ")}
              style={{
                width: PAGE_W * effectiveScale,
                height: PAGE_H * effectiveScale,
              }}
            >
                <div
                  className="relative origin-top-left"
                  style={{
                    width: PAGE_W,
                    height: PAGE_H,
                    transform: `scale(${effectiveScale})`,
                  }}
                >
                  <div
                    ref={(el) => {
                      vexRefs.current[p] = el;
                    }}
                  />

                  {/* Click/drop targets + playhead overlay for this page */}
                  <div className="pointer-events-none absolute inset-0">
                    {metrics
                      ?.filter((row) => row.page === p)
                      .map((row) => {
                        return (
                          <div
                            key={`${row.measure}-${row.part}`}
                            data-play-row={`${row.measure}:${row.part}`}
                            className="absolute left-0 right-0"
                            style={{ top: row.y, height: row.height }}
                          >
                            {selectedRows.has(`${row.measure}:${row.part}`) && (
                              <div
                                className="selection-highlight pointer-events-none absolute rounded-md bg-lime-400/40 ring-2 ring-lime-300 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                                style={{
                                  left: row.x,
                                  top: 0,
                                  width: row.w,
                                  height: "100%",
                                }}
                              />
                            )}
                            {hasClipboard &&
                              pasteTarget === `${row.measure}:${row.part}` &&
                              selected === "select" && (
                                <div
                                  className="paste-highlight pointer-events-none absolute rounded-md ring-2 ring-cyan-400/90"
                                  style={{
                                    left: row.x,
                                    top: 0,
                                    width: row.w,
                                    height: "100%",
                                  }}
                                />
                              )}
                            {!viewMode &&
                              Array.from(
                                { length: CELLS_PER_MEASURE },
                                (_, i) => {
                                  const cellStart = i * CELL_SLOTS;
                                  const note = notes.find(
                                    (n) =>
                                      n.measure === row.measure &&
                                      (n.part ?? 0) === row.part &&
                                      n.slot < cellStart + CELL_SLOTS &&
                                      cellStart <
                                        n.slot + SPAN[n.duration]
                                  );
                                  return (
                                    <SlotCell
                                      key={i}
                                      measure={row.measure}
                                      index={i}
                                      part={row.part}
                                      metrics={row}
                                      note={note}
                                      isCurrent={
                                        playhead?.measure === row.measure &&
                                        playhead.part === row.part &&
                                        Math.floor(
                                          playhead.slot / CELL_SLOTS
                                        ) === i
                                      }
                                      onClick={(e) =>
                                        handleSlotClick(
                                          row.measure,
                                          i,
                                          row.part,
                                          e.shiftKey
                                        )
                                      }
                                      fullWidth={selected === "select"}
                                      isNoteSelected={
                                        !!note &&
                                        selectedNotes.has(
                                          `${row.measure}:${row.part}:${note.slot}`
                                        )
                                      }
                                    />
                                  );
                                }
                              )}
                            {playhead?.measure === row.measure &&
                              playhead.part === row.part && (
                              <div
                                className="absolute bottom-[-12px] top-[-12px] w-0.5 bg-cyan-400 transition-transform duration-75"
                                style={{
                                  left: row.startX,
                                  transform: `translateX(${
                                    (playhead.slot / SLOTS) *
                                    (row.endX - row.startX)
                                  }px)`,
                                }}
                              />
                              )}
                          </div>
                        );
                      })}
                  </div>
                </div>
            </div>
          ))}
          </div>
            {!viewMode && (
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                24 Festive Drums notation (MuseScore tutorial style): notes
                float on a single staff line (● 鼓心, ✕ 鼓边, ▷ 鼓棒) with a
                percussion clef, barlines and measure numbers, on PDF-style
                A4 pages. Rhythm palette: whole 1, half 2, quarter ¼, eighth
                ⅛, 16th 1/16, 32nd 1/32, and triplet 3 per beat. Each
                project autosaves its score.
              </p>
            )}
          </div>
        </div>

        <DragOverlay>
          {dragItem && (
            <div className="rounded-xl border border-amber-500 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 shadow-xl">
              {dragItem.kind === "zone"
                ? `${zoneById(dragItem.id as ZoneId).symbol} ${
                    zoneById(dragItem.id as ZoneId).zh
                  }`
                : dragItem.kind === "pattern"
                  ? PATTERNS.find((pt) => pt.id === dragItem.id)?.label ??
                    "Pattern"
                  : dragItem.kind === "group"
                    ? groups.find((g) => g.id === dragItem.id)?.name ?? "Group"
                    : "Eraser 橡皮"}
            </div>
          )}
        </DragOverlay>
        </div>
      </DndContext>

      <GroupEditorModal
        open={groupEditorOpen}
        groups={groups}
        initialGroupId={groupEditorInitial}
        measureNumber={sourceMeasure + 1}
        bpm={bpm}
        onRename={renameGroup}
        onUpdateMeasures={updateGroupMeasures}
        onDelete={deleteGroup}
        onCreate={createEmptyGroup}
        onInsert={(id) => {
          const g = groups.find((gr) => gr.id === id);
          if (g) {
            insertGroup(sourceMeasure, 0, g, activePart);
            setGroupEditorOpen(false);
          }
        }}
        onClose={() => setGroupEditorOpen(false)}
      />

      <ScoreNoteModal
        open={noteModal?.open ?? false}
        existing={
          noteModal?.open
            ? (noteModal.editId
                ? (annotations.find((a) => a.id === noteModal.editId) ?? null)
                : (annotations.find(
                    (a) =>
                      a.measure === noteModal.measure &&
                      (a.part ?? 0) === noteModal.part
                  ) ?? null))
            : null
        }
        measureNumber={(noteModal?.measure ?? 0) + 1}
        partNumber={noteModal?.part ?? 0}
        pageNumber={noteModal?.page ?? null}
        onSave={saveNote}
        onDelete={deleteNote}
        onClose={() => setNoteModal(null)}
      />

      <CombineModal
        key={String(combineOpen)}
        open={combineOpen}
        onClose={() => setCombineOpen(false)}
        projects={projectsList}
        defaultIncluded={project ? [project.id] : []}
        onCreate={(combined) => {
          dirtyRef.current = true;
          editSeq.current++;
          const list = [...projectsList, combined];
          saveProjects(list);
          setProjectsList(list);
          setProject(combined);
          saveActiveProjectId(combined.id);
          projectRef.current = combined;
          resetHistory();
          setCurrentPage(0);
          setViewMode(false);
          setCombineOpen(false);
        }}
      />

      <ShareModal
        key={`${String(shareOpen)}:${project?.id ?? ""}`}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        project={project}
        onVisibilityChange={(visibility) =>
          updateProject((p) => ({ ...p, visibility }))
        }
      />
    </>
  );
}
