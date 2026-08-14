"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AuthButton from "@/components/AuthButton";
import AuthGate from "@/components/AuthGate";
import CollectionShareModal from "@/components/CollectionShareModal";
import CombineModal from "@/components/CombineModal";
import GroupPreviewButton from "@/components/GroupPreviewButton";
import ShareModal from "@/components/ShareModal";
import { useAuth } from "@/components/AuthProvider";
import {
  createCollection,
  loadCollections,
  saveCollections,
  type ScoreCollection,
} from "@/lib/collections";
import {
  fetchVisibleCollections,
  mergeCloudCollections,
} from "@/lib/collectionCloud";
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
  const [collections, setCollections] = useState<ScoreCollection[]>([]);
  const [shared, setShared] = useState<CloudScore[]>([]);
  const [dashTab, setDashTab] = useState<"scores" | "collections" | "groups">(
    "scores"
  );
  const [combineOpen, setCombineOpen] = useState(false);
  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [shareCollection, setShareCollection] =
    useState<ScoreCollection | null>(null);
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
    const collLocal = loadCollections();
    const { collections: cloudColl } = await fetchVisibleCollections();
    const mergedColl = mergeCloudCollections(collLocal, cloudColl);
    saveCollections(mergedColl);
    setCollections(mergedColl);
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
      setCollections(loadCollections());
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

  const createNewCollection = () => {
    const c = createCollection(
      `New Collection ${collections.length + 1} 新项目集${collections.length + 1}`
    );
    const next = [...collections, c];
    saveCollections(next);
    setCollections(next);
    router.push(`/collections/${c.id}`);
  };

  const deleteCollection = (id: string) => {
    if (!window.confirm("Delete this collection? 确定删除该项目集吗？")) return;
    const next = collections.filter((c) => c.id !== id);
    saveCollections(next);
    setCollections(next);
  };

  // All rhythm groups across all projects (favourites arrive later).
  const groupsList = projects.flatMap((p) =>
    p.groups.map((g) => ({ group: g, project: p }))
  );

  return (
    <AuthGate>
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-6">
        <div>
          <Link
            href="/"
            className="inline-block text-sm text-zinc-500 transition-colors hover:text-zinc-200"
          >
            ← Drummer&apos;s Beat
          </Link>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight">
            Project Dashboard 项目工作台
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
                  ? (
                      <>
                        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-current align-middle" />
                        Live 实时
                      </>
                    )
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
                className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:opacity-50"
                title="Sync projects to the cloud 同步到云端"
              >
                {syncing ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                    Syncing… 同步中
                  </>
                ) : (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M17.5 19a4.5 4.5 0 0 0 .9-8.9 6 6 0 0 0-11.6 1.6A3.8 3.8 0 0 0 6.5 19z" />
                      <path d="m9 15 3 3 3-3" />
                      <path d="M12 18v-7" />
                    </svg>
                    Sync 同步
                  </>
                )}
              </button>
            </>
          )}
          <button
            onClick={() => setCombineOpen(true)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="m12 3 1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />
              <path d="M19 15.5v4M17 17.5h4" opacity=".8" />
            </svg>
            Combine 合并
          </button>
          <button
            onClick={createNewProject}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="mr-1.5 inline h-4 w-4 align-text-bottom"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Project 新建项目
          </button>
          <AuthButton />
        </div>
      </header>

      {/* Ribbon categories, like the editor's tab bar. */}
      <div className="mb-6 flex gap-1 border-b border-zinc-800">
        {(
          [
            ["scores", "♪ Scores 乐谱"],
            ["collections", "▤ Collections 项目集"],
            ["groups", "≋ Groups 组合"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setDashTab(id)}
            aria-pressed={dashTab === id}
            className={[
              "border-b-2 px-4 py-2 text-sm font-semibold transition-colors",
              dashTab === id
                ? "border-amber-500 text-amber-300"
                : "border-transparent text-zinc-400 hover:text-zinc-100",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

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
          {dashTab === "scores" && (
          <>
          {/* Projects */}
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              My Projects 我的项目 · {projects.length}
            </h2>
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
              <div className="mb-3 flex justify-center text-3xl text-amber-400/70">
                <svg viewBox="0 0 32 32" fill="none" className="h-9 w-9" aria-hidden="true">
                  <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="2.4" />
                  <circle cx="16" cy="16" r="5.5" fill="currentColor" opacity=".7" />
                </svg>
              </div>
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
                          aria-label="Share 分享"
                          className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                            <circle cx="18" cy="5" r="2.6" />
                            <circle cx="6" cy="12" r="2.6" />
                            <circle cx="18" cy="19" r="2.6" />
                            <path d="m8.6 10.8 6.8-4.1M8.6 13.2l6.8 4.1" />
                          </svg>
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
          </>
          )}

          {dashTab === "collections" && (
          <>
          {/* Collections */}
          <section className="mb-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Collections 项目集 · {collections.length}
              </h2>
              <button
                onClick={createNewCollection}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New Collection 新建项目集
              </button>
            </div>
            {collections.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
                <div className="mb-3 flex justify-center text-3xl text-amber-400/70">
                  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-9 w-9" aria-hidden="true">
                    <rect x="6" y="6" width="20" height="20" rx="4" opacity=".85" />
                    <rect x="10.5" y="10.5" width="11" height="11" rx="2" opacity=".45" />
                  </svg>
                </div>
                Group multiple scores and add notes, pictures and comments.
                Create your first collection. 将多首乐谱分组，并添加笔记、图片和评论。
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {collections.map((c) => (
                  <div
                    key={c.id}
                    className="group rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-amber-500/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/collections/${c.id}`}
                        className="min-w-0"
                      >
                        <h3 className="truncate font-semibold text-zinc-100 group-hover:text-amber-300">
                          {c.name}
                        </h3>
                      </Link>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {c.cloudRole === "editor" && (
                          <span className="rounded-full border border-cyan-500/50 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                            Shared 共享
                          </span>
                        )}
                        <button
                          onClick={() => setShareCollection(c)}
                          title="Share collection 分享项目集"
                          className="shrink-0 rounded-lg border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
                        >
                          🔗
                        </button>
                        <button
                          onClick={() => deleteCollection(c.id)}
                          aria-label="Delete collection 删除项目集"
                          className="shrink-0 rounded-lg border border-red-900 px-2 py-0.5 text-xs text-red-400 hover:border-red-700"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="h-3 w-3" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                      {c.description || "No description 无描述"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                        {c.pieceIds.length} pieces 曲目
                      </span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                        {c.notes.blocks.length} notes 笔记
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          </>
          )}

          {dashTab === "scores" && (
          <>
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
                        {c.cloudRole === "editor" ? (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="mr-0.5 inline h-3 w-3 align-text-bottom" aria-hidden="true">
                              <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" />
                              <path d="m14 6 3 3" />
                            </svg>
                            Editor 编辑
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="mr-0.5 inline h-3 w-3 align-text-bottom" aria-hidden="true">
                              <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
                              <circle cx="12" cy="12" r="2.8" />
                            </svg>
                            Viewer 查看
                          </>
                        )}
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
          </>
          )}

          {dashTab === "groups" && (
          <>
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New Group 新建组合
              </button>
            </div>
            {groupsList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
              <div className="mb-3 flex justify-center text-3xl text-amber-400/70">
                <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-9 w-9" aria-hidden="true">
                  <path d="M4 18v-4M10 18v-8M16 18v-3M22 18v-6" />
                  <circle cx="4" cy="8" r="2.4" fill="currentColor" stroke="none" />
                </svg>
              </div>
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
                    <span className="text-amber-400/80">
                      <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6" aria-hidden="true">
                        <path d="M4 18v-4M10 18v-8M16 18v-3M22 18v-6" />
                        <circle cx="4" cy="8" r="2.4" fill="currentColor" stroke="none" />
                      </svg>
                    </span>
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
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true">
                        <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
                      </svg>
                      Favourite 收藏
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          </>
          )}
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
      <CollectionShareModal
        key={shareCollection?.id ?? "none"}
        open={shareCollection !== null}
        onClose={() => setShareCollection(null)}
        collection={shareCollection}
      />
    </main>
    </AuthGate>
  );
}
