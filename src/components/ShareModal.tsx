"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  addCollaboratorByEmail,
  cloudAvailable,
  createShareInvite,
  listCollaborators,
  pushProjectToCloud,
  removeCollaborator,
  setScoreVisibility,
  subscribePresence,
  type CollaboratorInfo,
} from "@/lib/cloud";
import type { Project } from "@/lib/projects";

function displayName(c: CollaboratorInfo): string {
  return c.displayName || c.username || c.email || c.userId.slice(0, 6);
}

/* Share/edit access for a project. The owner can toggle visibility, invite
   people by email, generate a share link, and manage roles. Editors can view
   the list; local-mode projects show the cloud-setup notice instead. */
export default function ShareModal({
  open,
  onClose,
  project,
  onVisibilityChange,
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  onVisibilityChange?: (visibility: "private" | "public") => void;
}) {
  const { status, user } = useAuth();
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [online, setOnline] = useState<string[]>([]);

  const isOwner = project?.cloudRole === "owner" || project?.cloudRole == null;
  const canManage = isOwner && status === "signed-in";

  const refresh = useCallback(async () => {
    if (!project || !cloudAvailable() || status !== "signed-in") return;
    const { collaborators: list } = await listCollaborators(project.id);
    setCollaborators(list);
  }, [project, status]);

  useEffect(() => {
    if (!open) return;
    if (!project) return;
    void (async () => {
      const { collaborators: list } = await listCollaborators(project.id);
      setCollaborators(list);
    })();
    if (user && project.cloudRole !== "viewer") {
      const name =
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        user.email?.split("@")[0] ??
        "You";
      const unsub = subscribePresence(
        project.id,
        user.id,
        name,
        setOnline
      );
      return unsub;
    }
  }, [open, project, user, refresh]);

  if (!open || !project) return null;

  const addByEmail = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setMessage(null);
    const saved = await pushProjectToCloud(project);
    if (!saved.ok) {
      setMessage({
        kind: "error",
        text:
          saved.error === "no edit access"
            ? "You don't have edit access to this score — ask the owner to share it with you. 你没有该乐谱的编辑权限，请联系所有者。"
            : `Could not save to cloud: ${saved.error ?? "unknown error"} 无法保存到云端`,
      });
      setBusy(false);
      return;
    }
    const res = await addCollaboratorByEmail(project.id, email, role);
    if (res.ok) {
      setEmail("");
      setMessage({ kind: "ok", text: "Added 已添加" });
      await refresh();
    } else {
      setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
    }
    setBusy(false);
  };

  const makeLink = async () => {
    setBusy(true);
    setMessage(null);
    const saved = await pushProjectToCloud(project);
    if (!saved.ok) {
      setMessage({
        kind: "error",
        text:
          saved.error === "no edit access"
            ? "You don't have edit access to this score — ask the owner to share it with you. 你没有该乐谱的编辑权限，请联系所有者。"
            : `Could not save to cloud: ${saved.error ?? "unknown error"} 无法保存到云端`,
      });
      setBusy(false);
      return;
    }
    const res = await createShareInvite(project.id, role);
    if (res.token) {
      setShareLink(`${location.origin}/editor?share=${res.token}`);
      setMessage({
        kind: "ok",
        text: "Link created — anyone with it can join for 7 days. 链接已生成，7 天内有效。",
      });
    } else {
      setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
    }
    setBusy(false);
  };

  const changeVisibility = async (v: "private" | "public") => {
    setBusy(true);
    setMessage(null);
    const res = await setScoreVisibility(project.id, v);
    if (res.ok) {
      onVisibilityChange?.(v);
      setMessage({ kind: "ok", text: "Saved 已保存" });
    } else {
      setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
    }
    setBusy(false);
  };

  const remove = async (userId: string) => {
    setBusy(true);
    setMessage(null);
    const res = await removeCollaborator(project.id, userId);
    if (res.ok) {
      setMessage({ kind: "ok", text: "Removed 已移除" });
      await refresh();
    } else {
      setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
    }
    setBusy(false);
  };

  const changeRole = async (c: CollaboratorInfo, newRole: "editor" | "viewer") => {
    if (!c.email) {
      setMessage({ kind: "error", text: "Cannot change role without email 缺少邮箱，无法修改权限" });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await addCollaboratorByEmail(project.id, c.email, newRole);
    if (res.ok) {
      setMessage({ kind: "ok", text: "Role updated 权限已更新" });
      await refresh();
    } else {
      setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
    }
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/75 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-800 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold">Share Project 分享项目</h2>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {project.name}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close 关闭"
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {!cloudAvailable() && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs leading-5 text-amber-200">
              <p className="font-semibold">Cloud sharing is not configured yet.</p>
              <p className="mt-1">
                Follow <span className="font-mono">docs/DEPLOYMENT.md</span> to
                connect Supabase — then you can invite people and edit together.
                配置 Supabase 后即可邀请协作者共同编辑。
              </p>
            </div>
          )}

          {cloudAvailable() && status !== "signed-in" && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-950/50 p-4 text-xs text-zinc-400">
              <Link href="/login?next=/editor" className="font-semibold text-amber-300 hover:underline">
                Sign in 登录
              </Link>{" "}
              to share this project. 登录后即可分享。
            </div>
          )}

          {cloudAvailable() && status === "signed-in" && (
            <>
              {/* Visibility */}
              <section className="mb-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Access 访问权限
                </h3>
                <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-1">
                  {(["private", "public"] as const).map((v) => (
                    <button
                      key={v}
                      disabled={!canManage}
                      onClick={() => void changeVisibility(v)}
                      className={[
                        "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        (project.visibility ?? "private") === v
                          ? v === "public"
                            ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/60"
                            : "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600"
                          : "text-zinc-500 hover:text-zinc-300",
                      ].join(" ")}
                    >
                      {v === "private" ? "🔒 Private 私有" : "🌍 Public 公开"}
                    </button>
                  ))}
                </div>
                {project.visibility === "public" && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Anyone with the app can view this score in the community
                    hub. Editors can still edit. 公开乐谱所有人可见。
                  </p>
                )}
              </section>

              {/* People */}
              <section className="mb-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  People with access 协作者 · {collaborators.length + 1}
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-zinc-950">
                      {(user?.email ?? user?.id ?? "")[0]?.toUpperCase() ?? "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-100">
                        {user?.user_metadata?.full_name ??
                          user?.email?.split("@")[0] ??
                          "You"}
                        <span className="ml-2 text-xs font-normal text-zinc-500">
                          (you 你)
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300">
                      Owner 所有者
                    </span>
                  </div>

                  {collaborators.map((c) => (
                    <div
                      key={c.userId}
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-bold text-cyan-300">
                        {displayName(c)[0]?.toUpperCase() ?? "?"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-zinc-100">
                          {displayName(c)}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          {c.email}
                        </div>
                      </div>
                      {canManage ? (
                        <>
                          <select
                            value={c.role}
                            disabled={busy}
                            onChange={(e) =>
                              void changeRole(
                                c,
                                e.target.value as "editor" | "viewer"
                              )
                            }
                            aria-label="Role 权限"
                            className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
                          >
                            <option value="editor">✏️ Edit 编辑</option>
                            <option value="viewer">👁 View 查看</option>
                          </select>
                          <button
                            disabled={busy}
                            onClick={() => void remove(c.userId)}
                            aria-label="Remove 移除"
                            className="shrink-0 rounded-lg border border-red-900 px-2 py-1 text-xs text-red-400 transition-colors hover:border-red-700"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <span className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                          {c.role === "editor" ? "✏️ Edit 编辑" : "👁 View 查看"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {canManage && (
                <>
                  {/* Invite by email */}
                  <section className="mb-5">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Invite by email 邮箱邀请
                    </h3>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="friend@example.com"
                        className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                      />
                      <select
                        value={role}
                        onChange={(e) =>
                          setRole(e.target.value as "editor" | "viewer")
                        }
                        aria-label="Role 权限"
                        className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-sm text-zinc-200"
                      >
                        <option value="editor">Edit 编辑</option>
                        <option value="viewer">View 查看</option>
                      </select>
                      <button
                        disabled={busy || !email.trim()}
                        onClick={() => void addByEmail()}
                        className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                      >
                        Add 添加
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-500">
                      The person must have an account with that email. 对方需使用该邮箱注册。
                    </p>
                  </section>

                  {/* Share link */}
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Share link 分享链接
                    </h3>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={shareLink ?? ""}
                        placeholder="Generate a link 生成链接"
                        className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100"
                      />
                      <button
                        disabled={busy}
                        onClick={() => void makeLink()}
                        className="shrink-0 rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-amber-500 hover:text-amber-300 disabled:opacity-50"
                      >
                        {shareLink ? "New 重新生成" : "Create 生成"}
                      </button>
                      {shareLink && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            void navigator.clipboard?.writeText(shareLink);
                            setMessage({ kind: "ok", text: "Copied 已复制" });
                          }}
                          className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                        >
                          Copy 复制
                        </button>
                      )}
                    </div>
                  </section>
                </>
              )}

              {project.cloudRole === "viewer" && (
                <p className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
                  You have view access to this score. Ask the owner to upgrade
                  you to editor to make changes. 你拥有查看权限，如需编辑请联系所有者。
                </p>
              )}
            </>
          )}

          {message && (
            <p
              className={
                message.kind === "ok"
                  ? "mt-4 text-xs text-emerald-400"
                  : "mt-4 text-xs text-red-400"
              }
            >
              {message.text}
            </p>
          )}
        </div>

        {cloudAvailable() && status === "signed-in" && online.length > 0 && (
          <div className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
            <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            {online.length} online now 正在编辑 · {online.length} 人
          </div>
        )}
      </div>
    </div>
  );
}
