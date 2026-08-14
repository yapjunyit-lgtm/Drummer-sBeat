"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { cloudAvailable } from "@/lib/cloud";
import {
  addCollectionCollaboratorByEmail,
  createCollectionInvite,
  listCollectionCollaborators,
  removeCollectionCollaborator,
  type CollectionCollaborator,
} from "@/lib/collectionCloud";
import type { ScoreCollection } from "@/lib/collections";

function displayName(c: CollectionCollaborator): string {
  return c.displayName || c.username || c.email || c.userId.slice(0, 6);
}

/* Share a whole collection: collaborators get access to the collection AND
   editor access to every piece inside it. */
export default function CollectionShareModal({
  open,
  onClose,
  collection,
}: {
  open: boolean;
  onClose: () => void;
  collection: ScoreCollection | null;
}) {
  const { status, user } = useAuth();
  const [collaborators, setCollaborators] = useState<CollectionCollaborator[]>(
    []
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !collection) return;
    void (async () => {
      const { collaborators: list } = await listCollectionCollaborators(
        collection.id
      );
      setCollaborators(list);
    })();
  }, [open, collection]);

  if (!open || !collection) return null;

  const isOwner = collection.ownerId === undefined || collection.ownerId === user?.id;

  const addByEmail = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setMessage(null);
    const res = await addCollectionCollaboratorByEmail(
      collection,
      email,
      role
    );
    if (res.ok) {
      setEmail("");
      setMessage({ kind: "ok", text: "Added 已添加" });
      const { collaborators: list } = await listCollectionCollaborators(
        collection.id
      );
      setCollaborators(list);
    } else {
      setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
    }
    setBusy(false);
  };

  const makeLink = async () => {
    setBusy(true);
    setMessage(null);
    const res = await createCollectionInvite(collection.id, role);
    if (res.token) {
      setShareLink(`${location.origin}/collections/${collection.id}?share=${res.token}`);
      setMessage({
        kind: "ok",
        text: "Link created — anyone with it can join for 7 days. 链接已生成，7 天内有效。",
      });
    } else {
      setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
    }
    setBusy(false);
  };

  const remove = async (userId: string) => {
    setBusy(true);
    setMessage(null);
    const res = await removeCollectionCollaborator(collection.id, userId);
    if (res.ok) {
      setMessage({ kind: "ok", text: "Removed 已移除" });
      const { collaborators: list } = await listCollectionCollaborators(
        collection.id
      );
      setCollaborators(list);
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
              <h2 className="text-lg font-bold">Share Collection 分享项目集</h2>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {collection.name}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close 关闭"
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
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
                connect Supabase. 配置 Supabase 后即可分享项目集。
              </p>
            </div>
          )}

          {cloudAvailable() && status !== "signed-in" && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-950/50 p-4 text-xs text-zinc-400">
              <Link
                href="/login?next=/dashboard"
                className="font-semibold text-amber-300 hover:underline"
              >
                Sign in 登录
              </Link>{" "}
              to share this collection. 登录后即可分享。
            </div>
          )}

          {cloudAvailable() && status === "signed-in" && (
            <>
              <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-200">
                Editors can open and edit <strong>every piece</strong> in this
                collection, not just the notes. 协作者可编辑项目集内所有乐谱。
              </p>

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
                    <div className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                      {user?.email?.split("@")[0] ?? "You"}
                      <span className="ml-2 text-xs text-zinc-500">(you 你)</span>
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
                      {isOwner ? (
                        <>
                          <select
                            value={c.role}
                            disabled={busy}
                            onChange={(e) =>
                              void addByEmailWith(c, e.target.value as "editor" | "viewer")
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
                            className="shrink-0 rounded-lg border border-red-900 px-2 py-1 text-xs text-red-400 hover:border-red-700"
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

              {isOwner && (
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
                        className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
                      >
                        Add 添加
                      </button>
                    </div>
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
                        className="shrink-0 rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:border-amber-500 hover:text-amber-300 disabled:opacity-50"
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
                          className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
                        >
                          Copy 复制
                        </button>
                      )}
                    </div>
                  </section>
                </>
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
      </div>
    </div>
  );

  function addByEmailWith(c: CollectionCollaborator, newRole: "editor" | "viewer") {
    if (!c.email) {
      setMessage({ kind: "error", text: "Cannot change role without email 缺少邮箱，无法修改权限" });
      return;
    }
    setBusy(true);
    void (async () => {
      const res = await addCollectionCollaboratorByEmail(
        collection!,
        c.email!,
        newRole
      );
      if (res.ok) {
        const { collaborators: list } = await listCollectionCollaborators(
          collection!.id
        );
        setCollaborators(list);
      } else {
        setMessage({ kind: "error", text: res.error ?? "Failed 失败" });
      }
      setBusy(false);
    })();
  }
}
