"use client";

import { useState } from "react";
import GroupComposer from "@/components/GroupComposer";
import type { RhythmGroup } from "@/lib/projects";

interface GroupEditorModalProps {
  open: boolean;
  groups: RhythmGroup[];
  initialGroupId: string | null;
  measureNumber: number;
  bpm: number;
  onRename: (id: string, name: string) => void;
  onUpdateMeasures: (id: string, measures: RhythmGroup["measures"]) => void;
  onDelete: (id: string) => void;
  onCreate: (name: string) => string;
  onInsert: (id: string) => void;
  onClose: () => void;
}

export default function GroupEditorModal({
  open,
  groups,
  initialGroupId,
  measureNumber,
  bpm,
  onRename,
  onUpdateMeasures,
  onDelete,
  onCreate,
  onInsert,
  onClose,
}: GroupEditorModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialGroupId);

  // Follow the initial group when the dialog is reopened for another group.
  const [prevInitial, setPrevInitial] = useState(initialGroupId);
  if (initialGroupId !== prevInitial) {
    setPrevInitial(initialGroupId);
    if (initialGroupId) setSelectedId(initialGroupId);
  }

  if (!open) return null;

  const group = groups.find((g) => g.id === (selectedId ?? initialGroupId));
  const totalHits = (group?.measures ?? []).reduce(
    (a, m) => a + m.length,
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100">
            Rhythm Group Editor 节奏组合编辑器
          </h2>
          <button
            onClick={onClose}
            aria-label="Close group editor 关闭组合编辑器"
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* Group picker + new + delete */}
        <div className="mb-3 flex items-center gap-2">
          <select
            value={group?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const id = onCreate("New Group 新组合");
              setSelectedId(id);
            }}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-amber-500 hover:text-amber-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New 新建
          </button>
          <button
            onClick={() => {
              if (
                group &&
                window.confirm(
                  `Delete "${group.name}"? 确定删除该组合吗？`
                )
              ) {
                onDelete(group.id);
              }
            }}
            disabled={!group}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-red-800 hover:text-red-400 disabled:opacity-40"
          >
            Delete 删除
          </button>
        </div>

        {/* Rename */}
        <input
          value={group?.name ?? ""}
          onChange={(e) => group && onRename(group.id, e.target.value)}
          aria-label="Group name 组合名称"
          placeholder="Group name 组合名称"
          className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
        />

        {/* Shared composer: measures, score page, tools */}
        {group && (
          <GroupComposer
            group={group}
            measureNumber={measureNumber}
            bpm={bpm}
            onChange={(g) => onUpdateMeasures(g.id, g.measures)}
          />
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Close 关闭
          </button>
          <button
            onClick={() => group && onInsert(group.id)}
            disabled={!group || totalHits === 0}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Insert into score 插入谱面 →
          </button>
        </div>
      </div>
    </div>
  );
}
