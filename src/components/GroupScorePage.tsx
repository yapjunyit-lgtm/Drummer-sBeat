"use client";

import { useEffect, useRef, useState } from "react";
import { buildMeasureTickables, ZONES } from "@/lib/notation";
import { SLOTS, SPAN, type RhythmGroup } from "@/lib/projects";

const CELLS = 8; // half-beat click targets per measure
const CELL_SLOTS = SLOTS / CELLS;
const PAGE_W = 640;
const MARGIN_X = 24;
const ROW_H = 150; // vertical space per measure system
const PAGE_TOP = 42;

interface MeasureMetrics {
  startX: number;
  endX: number;
  y: number;
  height: number;
}

interface GroupScorePageProps {
  measures: RhythmGroup["measures"];
  measureNumber: number; // 1-based number of the first measure
  onCellClick: (measureIndex: number, cell: number) => void;
}

/* A mini MuseScore-style page for the group: each measure is its own system
   with the same hidden-line percussion staff, noteheads, beams, tuplets and
   rests as the main score, plus clickable half-beat cells for editing. */
export default function GroupScorePage({
  measures,
  measureNumber,
  onCellClick,
}: GroupScorePageProps) {
  const svgRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<MeasureMetrics[]>([]);
  const pageH = PAGE_TOP + measures.length * ROW_H + 24;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const VF = await import("vexflow/bravura");
      if (cancelled || !svgRef.current) return;
      svgRef.current.innerHTML = "";
      const renderer = new VF.Renderer(
        svgRef.current,
        VF.Renderer.Backends.SVG
      );
      renderer.resize(PAGE_W, pageH);
      const ctx = renderer.getContext();
      const allMetrics: MeasureMetrics[] = [];

      measures.forEach((slots, idx) => {
        const x = MARGIN_X;
        const y = PAGE_TOP + idx * ROW_H;
        const measureW = PAGE_W - MARGIN_X * 2;
        const stave = new VF.Stave(x, y, measureW);
        for (let l = 0; l < 5; l++) {
          stave.setConfigForLine(l, { visible: false });
        }
        // 4/4 time signature on the first measure, like the main score.
        if (idx === 0) stave.addTimeSignature("4/4");
        stave.setContext(ctx).draw();

        // Measure number, like the main score.
        ctx.save();
        ctx.setFont("11px sans-serif");
        ctx.fillText(String(measureNumber + idx), x + 2, y - 10);
        ctx.restore();

        const notes = slots.map((s) => ({
          id: "group",
          measure: 0,
          slot: s.slot,
          zone: s.zone,
          duration: s.duration,
        }));
        const { tickables, tuplets, beams } = buildMeasureTickables(notes, VF);
        const voice = new VF.Voice({ numBeats: 4, beatValue: 4 });
        voice.addTickables(tickables);
        new VF.Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        for (const beam of beams) beam.setContext(ctx).draw();
        for (const tuplet of tuplets) tuplet.setContext(ctx).draw();

        allMetrics.push({
          startX: stave.getNoteStartX(),
          endX: stave.getNoteEndX(),
          y: stave.getYForLine(0) - 8,
          height: stave.getYForLine(6) - stave.getYForLine(0) + 16,
        });
      });

      setMetrics(allMetrics);
    })();
    return () => {
      cancelled = true;
    };
  }, [measures, measureNumber, pageH]);

  return (
    <div
      className="score-page relative mx-auto"
      style={{ width: PAGE_W, height: pageH }}
    >
      <div ref={svgRef} />
      <div className="pointer-events-none absolute inset-0">
        {metrics.map((m, idx) => (
          <div
            key={idx}
            className="absolute left-0 right-0"
            style={{ top: m.y, height: m.height }}
          >
            {Array.from({ length: CELLS }, (_, i) => {
              const start = i * CELL_SLOTS;
              const note = (measures[idx] ?? []).find(
                (s) =>
                  s.slot < start + CELL_SLOTS &&
                  start < s.slot + SPAN[s.duration]
              );
              const zone = note
                ? ZONES.find((z) => z.id === note.zone)
                : undefined;
              const colW = (m.endX - m.startX) / CELLS;
              return (
                <button
                  key={i}
                  onClick={() => onCellClick(idx, i)}
                  aria-label={`Group score measure ${idx + 1} slot ${
                    i + 1
                  } 谱面第${idx + 1}小节槽位 ${i + 1}`}
                  style={{
                    left: m.startX + i * colW,
                    width: colW,
                    top: 0,
                    height: "100%",
                  }}
                  className={[
                    "pointer-events-auto absolute rounded-md border border-dashed transition-colors",
                    zone
                      ? zone.cellClass
                      : "border-zinc-700/60 hover:bg-zinc-700/30",
                  ].join(" ")}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
