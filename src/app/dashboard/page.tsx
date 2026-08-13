"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AuthButton from "@/components/AuthButton";
import CombineModal from "@/components/CombineModal";
import GroupPreviewButton from "@/components/GroupPreviewButton";
import ShareModal from "@/components/ShareModal";
import { useAuth } from "@/components/AuthProvider";
import {
  cloudAvailable,
  fetchVisibleScores,
  mergeCloudProjects,
  pushProjectToCloud,
  type CloudScore,
} from "@/lib/cloud";
import { supabase } from "@/lib/supabase";
import {
  createProject,
  loadProjects,
  saveActiveProjectId,
  saveProjects,
  type Project,
} from "@/lib/projects";

export default function DashboardPage() {
  const router = useRouter();
  const { status: authStatus, user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [shared, setShared] = useState<CloudScore[]>([]);
  const [combineOpen, setCombineOpen] = useState(false);
  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<
    "connecting" | "live" | "offline"
  >("connecting");
  const [justUpdated, setJustUpdated] = useState(false);
  const refreshTimer = useRef<number | null>(null);
  const updatedTimer = useRef<number | null>(null);
  /* Only show shared scores while signed in (derived, so no effect resets). */
  const visibleShared =
    authStatus === "signed-in" && cloudAvailable() ? shared : [];

  /* Pull the latest cloud state into the dashboard (used on sign-in, on
     manual Sync, and by the Realtime subscription below). */
  const refreshFromCloud = useCallback(async () => {
    const { scores } = await fetchVisibleScores();
    const local = loadProjects();
    const merged = mergeCloudProjects(local, scores);
    saveProjects(merged);
    setProjects(merged);
    setShared(scores.filter((s) => s.ownerId !== user?.id));
  }, [user?.id]);

  const flashUpdated = useCallback(() => {
    setJustUpdated(true);
    if (updatedTimer.current) window.clearTimeout(updatedTimer.current);
    updatedTimer.current = window.setTimeout(() => {
      setJustUpdated(false);
    }, 2000);
  }, []);

  useEffect(() => {
    // Deferred one tick so the first render matches the server HTML.
    const timer = setTimeout(() => {
      setProjects(loadProjects());
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  /* Pull cloud scores into the dashboard whenever the auth state settles. */
  useEffect(() => {
    if (!mounted || authStatus !== "signed-in" || !cloudAvailable()) return;
    void (async () => {
      const { scores } = await fetchVisibleScores();
      const local = loadProjects();
      const merged = mergeCloudProjects(local, scores);
      saveProjects(merged);
      setProjects(merged);
      setShared(scores.filter((s) => s.ownerId !== user?.id));
    })();
  }, [mounted, authStatus, user?.id]);

  /* Live dashboard: whenever any score we can see changes (someone edits it
     or shares it with us), refresh the list automatically. Uses a light
     revision poll (works on every project) + Realtime as an accelerator. */
  useEffect(() => {
    if (!mounted || authStatus !== "signed-in" || !cloudAvailable()) return;
    if (!supabase || !user) return;
    const client = supabase;
    let cancelled = false;
    let failCount = 0;
    let lastSig = "";
    const poll = async () => {
      try {
        const { data, error } = await client
          .from("scores")
          .select("id, revision, updated_at");
        if (cancelled) return;
        if (error) throw error;
        failCount = 0;
        setLiveStatus("live");
        const sig = (data ?? [])
          .map((r) => `${r.id}:${r.revision}:${r.updated_at}`)
          .join("|");
        if (sig !== lastSig) {
          lastSig = sig;
          void refreshFromCloud();
          flashUpdated();
        }
      } catch {
        if (!cancelled) {
          failCount += 1;
          if (failCount >= 3) setLiveStatus("offline");
        }
      }
    };
    void (async () => {
      await poll();
    })();
    const interval = window.setInterval(() => void poll(), 6000);
    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        void refreshFromCloud();
      }, 600);
    };
    const channel = client
      .channel("dashboard-scores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        (payload) => {
          console.info("[Drummer's Beat] dashboard: scores change", {
            id: (payload.new as { id?: string } | null)?.id,
            event: payload.eventType,
          });
          scheduleRefresh();
          flashUpdated();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "score_collaborators",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          console.info("[Drummer's Beat] dashboard: new collaborator");
          scheduleRefresh();
          flashUpdated();
        }
      )
      .subscribe();
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      if (updatedTimer.current) window.clearTimeout(updatedTimer.current);
      cancelled = true;
      window.clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [mounted, authStatus, user, refreshFromCloud, flashUpdated]);

  /* Manual sync: push every local project I own to the cloud, then pull. */
  const syncNow = async () => {
    if (!user) return;
    setSyncing(true);
    setSyncNote(null);
    let pushed = 0;
    for (const p of loadProjects()) {
      if (p.ownerId && p.ownerId !== user.id) continue;
      const res = await pushProjectToCloud(p);
      if (res.ok) pushed++;
    }
    await refreshFromCloud();
    setSyncing(false);
    setSyncNote(`Synced ${pushed} projects 已同步 ${pushed} 个项目`);
  };

  const createNewProject = () => {
    const p = createProject(
      `New Project ${projects.length + 1} 新项目${projects.length + 1}`
    );
    const next = [...projects, p];
    saveProjects(next);
    setProjects(next);
    saveActiveProjectId(p.id);
    router.push("/editor");
  };

  // All rhythm groups across all projects (favourites arrive later).
  const groupsList = projects.flatMap((p) =>
    p.groups.map((g) => ({ group: g, project: p }))
  );

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-200"
          >
            ← Drummer&apos;s Beat
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Project Dashboard 项目工作台
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {cloudAvailable() && authStatus === "signed-in" && (
            <>
              <span
                title="Live sync status 实时同步状态"
                className={[
                  "rounded-full border px-3 py-1.5 text-xs font-semibold",
                  liveStatus === "live"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                    : liveStatus === "connecting"
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                      : "border-red-500/50 bg-red-500/10 text-red-300",
                ].join(" ")}
              >
                {liveStatus === "live"
                  ? "● Live 实时"
                  : liveStatus === "connecting"
                    ? "Connecting… 连接中"
                    : "Offline 离线"}
              </span>
              {justUpdated && (
                <span className="animate-pulse rounded-full border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                  Updated 已更新
                </span>
              )}
              <button
                onClick={() => void syncNow()}
                disabled={syncing}
                className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:opacity-50"
                title="Sync projects to the cloud 同步到云端"
              >
                {syncing ? "Syncing… 同步中" : "☁ Sync 同步"}
              </button>
            </>
          )}
          <button
            onClick={() => setCombineOpen(true)}
            className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
          >
            ✦ Combine 合并
          </button>
          <button
            onClick={createNewProject}
            className="rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
          >
            ＋ New Project 新建项目
          </button>
          <AuthButton />
        </div>
      </header>

      {syncNote && (
        <div className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          {syncNote}
        </div>
      )}

      {!mounted ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/70 text-sm text-zinc-500">
          Loading projects 加载项目…
        </div>
      ) : (
        <>
          {/* Projects */}
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              My Projects 我的项目 · {projects.length}
            </h2>
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
                <div className="mb-3 text-3xl text-zinc-600">♪</div>
                No projects yet. Create your first one to get started. 还没有
                项目，先新建一个吧。
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="group rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 text-left transition-colors hover:border-amber-500/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href="/editor"
                        onClick={() => saveActiveProjectId(p.id)}
                        className="min-w-0"
                      >
                        <h3 className="truncate font-semibold text-zinc-100 group-hover:text-amber-300">
                          {p.name}
                        </h3>
                      </Link>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {p.cloudRole === "editor" && (
                          <span
                            title="Shared with you 他人共享"
                            className="rounded-full border border-cyan-500/50 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300"
                          >
                            Shared 共享
                          </span>
                        )}
                        <span className="text-xs text-zinc-500">
                          {p.updatedAt
                            ? new Date(p.updatedAt).toLocaleDateString()
                            : "·"}
                        </span>
                        <button
                          onClick={() => setShareProject(p)}
                          title="Share 分享"
                          className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
                        >
                          🔗
                        </button>
                      </div>
                    </div>
                    <Link
                      href="/editor"
                      onClick={() => saveActiveProjectId(p.id)}
                      className="mt-3 block"
                    >
                      <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                          {p.measures} bars 小节
                        </span>
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                          {p.bpm} BPM
                        </span>
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                          {p.notes.length} notes 音符
                        </span>
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                          {p.groups.length} groups 组合
                        </span>
                      </div>
                      <div className="mt-4 text-xs text-amber-400 opacity-0 transition-opacity group-hover:opacity-100">
                        Open 打开 →
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Shared with me */}
          {visibleShared.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Shared with me 与我共享 · {visibleShared.length}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {visibleShared.map((c) => (
                  <div
                    key={c.project.id}
                    className="rounded-2xl border border-cyan-500/30 bg-zinc-900/60 p-5 transition-colors hover:border-cyan-400/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 truncate font-semibold text-zinc-100">
                        {c.project.name}
                      </h3>
                      <span className="shrink-0 rounded-full border border-cyan-500/50 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                        {c.cloudRole === "editor" ? "✏️ Editor 编辑" : "👁 Viewer 查看"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      by {c.ownerName ?? "owner"} · {c.project.measures} bars 小节 ·{" "}
                      {c.project.bpm} BPM · updated{" "}
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </p>
                    <button
                      onClick={() => {
                        saveActiveProjectId(c.project.id);
                        const local = loadProjects();
                        saveProjects(
                          local.some((p) => p.id === c.project.id)
                            ? local.map((p) =>
                                p.id === c.project.id ? c.project : p
                              )
                            : [...local, c.project]
                        );
                        router.push("/editor");
                      }}
                      className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-cyan-400"
                    >
                      Open 打开
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Rhythm groups across all projects */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Rhythm Groups 节奏组合 · {groupsList.length}
              </h2>
              <button
                onClick={() => router.push("/groups/new")}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
              >
                ＋ New Group 新建组合
              </button>
            </div>
            {groupsList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
                <div className="mb-3 text-3xl text-zinc-600">▤</div>
                No rhythm groups yet. Capture one in the editor and it will
                appear here. 还没有节奏组合，去编辑器里创建吧。
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
                {groupsList.map(({ group, project }) => (
                  <div
                    key={group.id}
                    className="flex items-center gap-3 border-b border-zinc-800/70 px-5 py-3 last:border-b-0"
                  >
                    <span className="text-lg">▤</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-zinc-100">
                        {group.name}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {project.name} · {group.measures.length} bar
                        {group.measures.length > 1 ? "s" : ""} ·{" "}
                        {group.measures.reduce((a, m) => a + m.length, 0)} hits
                      </div>
                    </div>
                    <GroupPreviewButton group={group} bpm={project.bpm} />
                    <Link
                      href="/editor"
                      onClick={() => saveActiveProjectId(project.id)}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
                    >
                      Open 打开
                    </Link>
                    <button
                      disabled
                      title="Favourites coming soon 收藏功能即将上线"
                      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-600"
                    >
                      ☆ Favourite 收藏
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <CombineModal
        key={String(combineOpen)}
        open={combineOpen}
        onClose={() => setCombineOpen(false)}
        projects={projects}
        defaultIncluded={[]}
        onCreate={(combined) => {
          const next = [...projects, combined];
          saveProjects(next);
          setProjects(next);
          saveActiveProjectId(combined.id);
          setCombineOpen(false);
          router.push("/editor");
        }}
      />
      <ShareModal
        key={shareProject?.id ?? "none"}
        open={shareProject !== null}
        onClose={() => setShareProject(null)}
        project={shareProject}
        onVisibilityChange={(visibility) => {
          if (!shareProject) return;
          const updated = { ...shareProject, visibility };
          setShareProject(updated);
          const next = loadProjects().map((p) =>
            p.id === updated.id ? updated : p
          );
          saveProjects(next);
          setProjects(next);
        }}
      />
    </main>
  );
}
