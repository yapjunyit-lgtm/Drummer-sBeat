"use client";

import { useState } from "react";
import type { ScoreAnnotation } from "@/lib/projects";

interface ScoreNoteModalProps {
  open: boolean;
  existing: ScoreAnnotation | null;
  measureNumber: number;
  partNumber: number;
  /** Page the note sits on (free placement); null for legacy measure notes. */
  pageNumber?: number | null;
  kind?: "note" | "heading";
  onSave: (text: string, kind: "note" | "heading") => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function ScoreNoteModal({
  open,
  existing,
  measureNumber,
  partNumber,
  pageNumber,
  kind,
  onSave,
  onDelete,
  onClose,
}: ScoreNoteModalProps) {
  const [text, setText] = useState(existing?.text ?? "");
  const [noteKind, setNoteKind] = useState<"note" | "heading">(
    existing?.kind ?? kind ?? "note"
  );

  // Follow the annotation when the dialog opens for a different note.
  const [prevExisting, setPrevExisting] = useState(existing);
  if (existing !== prevExisting) {
    setPrevExisting(existing);
    setText(existing?.text ?? "");
    setNoteKind(existing?.kind ?? kind ?? "note");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100">
            Score Note 备注
          </h2>
          <button
            onClick={onClose}
            aria-label="Close note editor 关闭备注"
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <p className="mb-3 text-xs text-zinc-500">
          Measure 小节 {measureNumber} · Drummer 鼓手 {partNumber + 1}
          {typeof pageNumber === "number"
            ? ` · Page 页 ${pageNumber + 1}`
            : ""}
        </p>

        <div className="mb-3 flex gap-1 rounded-lg border border-zinc-700 bg-zinc-950/40 p-1">
          {(["note", "heading"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setNoteKind(k)}
              className={[
                "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                noteKind === k
                  ? k === "heading"
                    ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/60"
                    : "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {k === "heading" ? "H Heading 标题" : "¶ Note 备注"}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          name="scoreNote"
          autoComplete="off"
          rows={4}
          autoFocus
          placeholder="Choreography note, technique hint, section name… 编舞说明、技巧提示、段落名称…"
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
        />

        <div className="mt-4 flex items-center justify-between">
          {existing ? (
            <button
              onClick={() => {
                if (window.confirm("Delete this note? 确定删除该备注吗？")) {
                  onDelete();
                }
              }}
              className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 hover:border-red-700 hover:text-red-300"
            >
              Delete 删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
            >
              Cancel 取消
            </button>
            <button
              onClick={() =>
                onSave(
                  text.trim() === ""
                    ? noteKind === "heading"
                      ? "Heading 标题"
                      : "备注 Note"
                    : text,
                  noteKind
                )
              }
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
            >
              Save 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
