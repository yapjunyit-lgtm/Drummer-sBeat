"use client";

import { useEffect, useRef, useState } from "react";
import { previewGroup } from "@/lib/groupPreview";
import type { RhythmGroup } from "@/lib/projects";

export default function GroupPreviewButton({
  group,
  bpm = 120,
}: {
  group: RhythmGroup;
  bpm?: number;
}) {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);
  const totalHits = group.measures.reduce((a, m) => a + m.length, 0);
  const durationMs =
    Math.max(300, (group.measures.length * 4 * 60000) / bpm + 250);

  const play = () => {
    setPlaying(true);
    void previewGroup(group, bpm).finally(() => setPlaying(false));
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setPlaying(false), durationMs);
  };

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  return (
    <button
      onClick={play}
      disabled={totalHits === 0}
      aria-label={`Preview ${group.name} 试听${group.name}`}
      title="Preview sound 试听"
      className={[
        "rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
        playing
          ? "border-amber-400 bg-amber-500/20 text-amber-300"
          : "border-zinc-700 text-zinc-300 hover:border-amber-500 hover:text-amber-300",
        totalHits === 0 && "cursor-not-allowed opacity-40",
      ].join(" ")}
    >
      {playing ? "■" : "▶"}
    </button>
  );
}
