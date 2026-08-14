"use client";

import { useState } from "react";
import { combineProjects, type Project } from "@/lib/projects";

/* Modal to combine several projects into one score book: pick projects,
   arrange the order with up/down, name it, then create the merged score. */
export default function CombineModal({
  open,
  onClose,
  projects,
  defaultIncluded,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  /** Project ids to pre-include (e.g. the project open in the editor). */
  defaultIncluded: string[];
  onCreate: (combined: Project) => void;
}) {
  // The parent remounts this modal (key) each time it opens, so the initial
  // values below always reflect the current project list.
  const [name, setName] = useState(
    () => `Combined Score 合集 ${projects.length + 1}`
  );
  const [included, setIncluded] = useState<string[]>(() =>
    defaultIncluded.filter((id) => projects.some((p) => p.id === id))
  );

  if (!open) return null;

  const toggle = (id: string) => {
    setIncluded((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const move = (id: string, dir: -1 | 1) => {
    setIncluded((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const ordered = included
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is Project => Boolean(p));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="text-lg font-bold">Combine Projects 合并项目</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Pick projects, arrange the sequence, then create one combined
            score. 选择项目、排列顺序后合并为一份乐谱。
          </p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Combined Name 合集名称
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Score Book 我的乐谱集"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
            />
          </label>

          <div className="mb-4">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Order 顺序 · {ordered.length}
            </span>
            {ordered.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-xs text-zinc-500">
                Select projects below 从下方选择项目
              </p>
            ) : (
              <div className="space-y-1.5">
                {ordered.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
                  >
                    <span className="w-5 text-center font-mono text-xs text-zinc-500">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                      {p.name}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {p.measures} bars
                    </span>
                    <button
                      onClick={() => move(p.id, -1)}
                      disabled={i === 0}
                      aria-label="Move up 上移"
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-xs text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                        <path d="m6 14.5 6-6 6 6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => move(p.id, 1)}
                      disabled={i === ordered.length - 1}
                      aria-label="Move down 下移"
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-700 text-xs text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                        <path d="m6 9.5 6 6 6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => toggle(p.id)}
                      aria-label={`Remove ${p.name}`}
                      className="h-6 w-6 rounded-md border border-zinc-700 text-xs text-zinc-400 transition-colors hover:border-red-800 hover:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Available Projects 可选项目
            </span>
            <div className="space-y-1">
              {projects.map((p) => {
                const checked = included.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={[
                      "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      checked
                        ? "border-amber-500/60 bg-amber-500/10 text-zinc-100"
                        : "border-zinc-800 text-zinc-300 hover:border-zinc-600",
                    ].join(" ")}
                  >
                    <span className="text-amber-400">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                        {checked ? (
                          <>
                            <rect x="4" y="4" width="16" height="16" rx="3" />
                            <path d="m9 12 2 2 4-4" />
                          </>
                        ) : (
                          <rect x="4" y="4" width="16" height="16" rx="3" />
                        )}
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {p.measures} bars 小节
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500"
          >
            Cancel 取消
          </button>
          <button
            onClick={() =>
              onCreate(
                combineProjects(name.trim() || "Combined Score 合集", ordered)
              )
            }
            disabled={ordered.length < 2 || !name.trim()}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 inline h-4 w-4 align-text-bottom" aria-hidden="true">
              <path d="m12 3 1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />
              <path d="M19 15.5v4M17 17.5h4" opacity=".8" />
            </svg>
            Combine 合并
          </button>
        </div>
      </div>
    </div>
  );
}
