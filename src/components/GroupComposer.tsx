"use client";

import { useState } from "react";
import GroupPreviewButton from "@/components/GroupPreviewButton";
import GroupScorePage from "@/components/GroupScorePage";
import { PATTERNS, ZONES, type PatternId } from "@/lib/notation";
import {
  SLOTS,
  SPAN,
  type RhythmGroup,
  type ZoneId,
} from "@/lib/projects";

const CELLS = 8; // half-beat cells in one 4/4 measure
const CELL_SLOTS = SLOTS / CELLS; // 12 steps per cell

type Tool = ZoneId | "eraser";

interface GroupComposerProps {
  group: RhythmGroup;
  measureNumber: number; // 1-based number of the first measure
  bpm?: number;
  onChange: (next: RhythmGroup) => void;
}

/* Shared group-editing surface (used by the editor modal and the standalone
   "new group" page): a live score page plus beat-block tools. */
export default function GroupComposer({
  group,
  measureNumber,
  bpm = 120,
  onChange,
}: GroupComposerProps) {
  const [tool, setTool] = useState<Tool>("center");
  const [pattern, setPattern] = useState<PatternId>("single");
  const [paintMode, setPaintMode] = useState(true);

  const measures = group.measures;

  const updateMeasures = (next: RhythmGroup["measures"]) =>
    onChange({ ...group, measures: next });

  const cellNote = (measureIdx: number, i: number) => {
    const start = i * CELL_SLOTS;
    return (measures[measureIdx] ?? []).find(
      (s) => s.slot < start + CELL_SLOTS && start < s.slot + SPAN[s.duration]
    );
  };

  const handleCellClick = (measureIdx: number, i: number) => {
    const slots = measures[measureIdx] ?? [];
    const start = i * CELL_SLOTS;
    const existing = cellNote(measureIdx, i);
    if (tool === "eraser") {
      if (existing) {
        updateMeasures(
          measures.map((m, mi) =>
            mi === measureIdx ? m.filter((s) => s !== existing) : m
          )
        );
      }
      return;
    }
    const isRestPattern = pattern === "rest" || pattern === "halfRest";
    if (paintMode && !isRestPattern && existing) {
      updateMeasures(
        measures.map((m, mi) =>
          mi === measureIdx
            ? m.map((s) => (s === existing ? { ...s, zone: tool } : s))
            : m
        )
      );
      return;
    }
    // Beat-Block insertion, same as the main score.
    const def = PATTERNS.find((p) => p.id === pattern)!;
    const patStart =
      def.span === CELL_SLOTS ? start : Math.floor(i / 2) * 24;
    const kept = slots.filter(
      (s) =>
        !(s.slot < patStart + def.span && patStart < s.slot + SPAN[s.duration])
    );
    const added = def.hits
      .filter((h) => patStart + h.offset < SLOTS)
      .map((h, hi) => ({
        slot: patStart + h.offset,
        zone: def.zones?.[hi] ?? tool,
        duration: h.duration,
      }));
    updateMeasures(
      measures.map((m, mi) =>
        mi === measureIdx
          ? [...kept, ...added].sort((a, b) => a.slot - b.slot)
          : m
      )
    );
  };

  const addMeasure = () => updateMeasures([...measures, []]);
  const removeMeasure = () => {
    if (measures.length <= 1) return;
    updateMeasures(measures.slice(0, -1));
  };

  return (
    <div>
      {/* Measure controls */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Measures 小节
        </span>
        <button
          onClick={removeMeasure}
          disabled={measures.length <= 1}
          aria-label="Remove last measure 删除最后小节"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span className="w-8 text-center font-mono text-zinc-100">
          {measures.length}
        </span>
        <button
          onClick={addMeasure}
          aria-label="Add measure 增加小节"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <div className="ml-auto">
          <GroupPreviewButton group={group} bpm={bpm} />
        </div>
      </div>

      {/* Score page with the same editing functions as the main score */}
      <div className="mb-4 rounded-xl bg-zinc-950/50 p-4">
        <GroupScorePage
          measures={measures}
          measureNumber={measureNumber}
          onCellClick={handleCellClick}
        />
      </div>

      {/* Zone tools */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Hit 音色
        </span>
        {ZONES.map((z) => (
          <button
            key={z.id}
            onClick={() => {
              setTool(z.id);
              setPaintMode(true);
            }}
            className={[
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              tool === z.id && paintMode
                ? "border-amber-400 bg-amber-500/25 text-zinc-100"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500",
            ].join(" ")}
          >
            {z.symbol} {z.zh}
          </button>
        ))}
        <button
          onClick={() => setTool("eraser")}
          className={[
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            tool === "eraser"
              ? "border-red-400 bg-red-500/25 text-zinc-100"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500",
          ].join(" ")}
        >
          ⌫ Eraser 橡皮
        </button>
      </div>

      {/* Rhythm patterns, same as the main score */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Pattern 节奏型
        </span>
        {PATTERNS.map((pt) => (
          <button
            key={pt.id}
            onClick={() => {
              setPattern(pt.id);
              setPaintMode(false);
            }}
            className={[
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              pattern === pt.id && !paintMode
                ? "border-amber-400 bg-amber-500/25 text-zinc-100"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500",
            ].join(" ")}
          >
            {pt.short} {pt.label.split(" ")[0]}
          </button>
        ))}
      </div>

      <p className="mb-4 text-xs text-zinc-500">
        {measures.length} bar{measures.length > 1 ? "s" : ""} · 8 half-beat
        slots each. Click the score to place the selected pattern with the
        chosen hit color; click a placed note to repaint it. 每小节 8 个半拍
        槽位，点击谱面放入节奏型，再点已放音符改色。
      </p>
    </div>
  );
}
