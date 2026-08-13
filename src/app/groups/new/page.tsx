"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import GroupComposer from "@/components/GroupComposer";
import {
  createProject,
  loadProjects,
  saveActiveProjectId,
  saveProjects,
  type RhythmGroup,
} from "@/lib/projects";

export default function NewGroupPage() {
  const router = useRouter();
  const [group, setGroup] = useState<RhythmGroup>({
    id: crypto.randomUUID(),
    name: "New Group 新组合",
    measures: [[]],
  });

  const totalHits = group.measures.reduce((a, m) => a + m.length, 0);

  /* Save the temporary group into the most recently edited project (or a new
     one) and return to the dashboard. */
  const addToDashboard = () => {
    let list = loadProjects();
    if (list.length === 0) {
      list = [createProject("Untitled Project 未命名项目")];
    }
    const target = [...list].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    )[0];
    const name =
      group.name === "New Group 新组合"
        ? `New Group ${target.groups.length + 1} 新组合${
            target.groups.length + 1
          }`
        : group.name;
    const saved = { ...group, name };
    const updated = {
      ...target,
      groups: [...target.groups, saved],
      updatedAt: Date.now(),
    };
    saveProjects(list.map((p) => (p.id === target.id ? updated : p)));
    saveActiveProjectId(target.id);
    router.push("/dashboard");
  };

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8"
    >
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-200"
          >
            ← Project Dashboard 项目工作台
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            New Rhythm Group 新建节奏组合
          </h1>
        </div>
      </header>

      <input
        value={group.name}
        onChange={(e) => setGroup((g) => ({ ...g, name: e.target.value }))}
        aria-label="Group name 组合名称"
        name="groupName"
        autoComplete="off"
        placeholder="Group name 组合名称"
        className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
      />

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
        <GroupComposer group={group} measureNumber={1} onChange={setGroup} />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
        >
          Cancel 取消
        </button>
        <button
          onClick={addToDashboard}
          disabled={totalHits === 0}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ＋ Add to dashboard 添加到工作台
        </button>
      </div>
    </main>
  );
}
