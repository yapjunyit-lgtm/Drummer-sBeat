"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  loadCollections,
  newBlockId,
  saveCollections,
  updateCollection,
  type CollectionBlock,
  type ScoreCollection,
} from "@/lib/collections";
import {
  loadProjects,
  saveActiveProjectId,
  type Project,
} from "@/lib/projects";

/* Render **bold** segments inside plain text. */
function renderBold(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-zinc-100">
        {part}
      </strong>
    ) : (
      part
    )
  );
}

const BLOCK_STYLE: Record<CollectionBlock["type"], string> = {
  heading:
    "text-lg font-bold text-zinc-100",
  text: "text-sm leading-6 text-zinc-300",
  list: "text-sm leading-6 text-zinc-300",
  image: "",
  comment:
    "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100",
};

export default function CollectionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [collections, setCollections] = useState<ScoreCollection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* Close the enlarged image preview with Escape. */
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    const t = setTimeout(() => {
      setCollections(loadCollections());
      setProjects(loadProjects());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const collection = collections.find((c) => c.id === params.id) ?? null;

  /* Debounced autosave. */
  const saveTimer = useRef<number | null>(null);
  const commit = (next: ScoreCollection[]) => {
    setCollections(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveCollections(next);
    }, 350);
  };

  const mutate = (fn: (c: ScoreCollection) => ScoreCollection) => {
    if (!collection) return;
    commit(updateCollection(collections, collection.id, fn));
  };

  const pieces = collection
    ? collection.pieceIds
        .map((id) => projects.find((p) => p.id === id))
        .filter((p): p is Project => Boolean(p))
    : [];

  if (!collection) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <Link
          href="/dashboard"
          className="text-sm text-zinc-500 hover:text-zinc-200"
        >
          ← Dashboard 项目工作台
        </Link>
        <p className="mt-6 text-sm text-zinc-500">
          Collection not found 找不到该项目集
        </p>
      </main>
    );
  }

  /* Block operations */
  /* eslint-disable react-hooks/purity -- event handler: creates ids/time */
  const addBlock = (type: CollectionBlock["type"]) => {
    const block: CollectionBlock =
      type === "heading"
        ? { id: newBlockId(), type, text: "Heading 标题" }
        : type === "text"
          ? { id: newBlockId(), type, text: "" }
          : type === "list"
            ? { id: newBlockId(), type, items: [""] }
            : type === "image"
              ? { id: newBlockId(), type, src: "" }
              : { id: newBlockId(), type, text: "", createdAt: Date.now() };
    mutate((c) => ({ ...c, notes: { blocks: [...c.notes.blocks, block] } }));
  };
  /* eslint-enable react-hooks/purity */

  const patchBlock = (id: string, patch: Partial<CollectionBlock>) => {
    mutate((c) => ({
      ...c,
      notes: {
        blocks: c.notes.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as CollectionBlock) : b)),
      },
    }));
  };

  const deleteBlock = (id: string) => {
    mutate((c) => ({
      ...c,
      notes: { blocks: c.notes.blocks.filter((b) => b.id !== id) },
    }));
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    mutate((c) => {
      const blocks = [...c.notes.blocks];
      const j = index + dir;
      if (j < 0 || j >= blocks.length) return c;
      [blocks[index], blocks[j]] = [blocks[j], blocks[index]];
      return { ...c, notes: { blocks } };
    });
  };

  const addPiece = (id: string) => {
    if (!collection.pieceIds.includes(id)) {
      mutate((c) => ({ ...c, pieceIds: [...c.pieceIds, id] }));
    }
    setPickerOpen(false);
  };

  const removePiece = (id: string) => {
    mutate((c) => ({ ...c, pieceIds: c.pieceIds.filter((x) => x !== id) }));
  };

  const movePiece = (id: string, dir: -1 | 1) => {
    mutate((c) => {
      const i = c.pieceIds.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.pieceIds.length) return c;
      const ids = [...c.pieceIds];
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...c, pieceIds: ids };
    });
  };

  const openPiece = (id: string) => {
    saveActiveProjectId(id);
    router.push("/editor");
  };

  const insertImage = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        mutate((c) => ({
          ...c,
          notes: {
            blocks: [
              ...c.notes.blocks,
              { id: newBlockId(), type: "image" as const, src: reader.result as string },
            ],
          },
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const availablePieces = projects.filter(
    (p) => !collection.pieceIds.includes(p.id)
  );

  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <Link
        href="/dashboard"
        className="text-sm text-zinc-500 transition-colors hover:text-zinc-200"
      >
        ← Dashboard 项目工作台
      </Link>

      {/* Header */}
      <div className="mt-3 mb-8">
        <input
          value={collection.name}
          onChange={(e) => mutate((c) => ({ ...c, name: e.target.value }))}
          aria-label="Collection name 项目集名称"
          className="w-full bg-transparent text-2xl font-bold tracking-tight text-zinc-100 outline-none"
        />
        <textarea
          value={collection.description}
          onChange={(e) =>
            mutate((c) => ({ ...c, description: e.target.value }))
          }
          rows={2}
          aria-label="Collection description 描述"
          placeholder="Describe this collection… 描述这个项目集…"
          className="mt-1 w-full resize-y bg-transparent text-sm text-zinc-500 outline-none placeholder:text-zinc-700"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pieces */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Pieces 曲目 · {pieces.length}
            </h2>
            <button
              onClick={() => setPickerOpen(true)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-300"
            >
              ＋ Add 添加
            </button>
          </div>

          {pieces.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-700 p-6 text-center text-xs text-zinc-500">
              No pieces yet — add scores from My Projects. 还没有曲目，从“我的项目”中添加。
            </p>
          ) : (
            <div className="space-y-2">
              {pieces.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2.5"
                >
                  <button
                    onClick={() => openPiece(p.id)}
                    className="min-w-0 flex-1 truncate text-left text-sm text-zinc-200 transition-colors hover:text-amber-300"
                    title="Open in editor 在编辑器中打开"
                  >
                    {p.name}
                  </button>
                  <span className="shrink-0 text-xs text-zinc-600">
                    {p.measures} bars
                  </span>
                  <button
                    onClick={() => movePiece(p.id, -1)}
                    disabled={i === 0}
                    aria-label="Move up 上移"
                    className="h-6 w-6 rounded-md border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => movePiece(p.id, 1)}
                    disabled={i === pieces.length - 1}
                    aria-label="Move down 下移"
                    className="h-6 w-6 rounded-md border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removePiece(p.id)}
                    aria-label="Remove 移除"
                    className="h-6 w-6 rounded-md border border-red-900 text-xs text-red-400 hover:border-red-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {pickerOpen && (
            <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Add a score 添加乐谱
              </p>
              {availablePieces.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  All your scores are already in this collection.
                </p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {availablePieces.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addPiece(p.id)}
                      className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-amber-300"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Main Notes 主笔记
          </h2>

          <div className="mb-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => addBlock("heading")}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300"
            >
              H Heading 标题
            </button>
            <button
              onClick={() => addBlock("text")}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300"
            >
              ¶ Text 文字
            </button>
            <button
              onClick={() => addBlock("list")}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300"
            >
              • List 列表
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300"
            >
              🖼 Image 图片
            </button>
            <button
              onClick={() => addBlock("comment")}
              className="rounded-lg border border-amber-500/50 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/10"
            >
              💬 Comment 评论
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) insertImage(f);
                e.target.value = "";
              }}
            />
          </div>

          <div className="space-y-2">
            {collection.notes.blocks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-700 p-6 text-center text-xs text-zinc-500">
                Add notes, pictures and comments here. 在这里添加笔记、图片和评论。
              </p>
            ) : (
              collection.notes.blocks.map((block, i) => (
                <div
                  key={block.id}
                  className="group relative rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5"
                >
                  {block.type === "heading" && (
                    <input
                      value={block.text}
                      onChange={(e) =>
                        patchBlock(block.id, { text: e.target.value })
                      }
                      aria-label="Heading 标题"
                      className="w-full bg-transparent text-lg font-bold text-zinc-100 outline-none"
                    />
                  )}

                  {block.type === "text" &&
                    (editingTextId === block.id ? (
                      <textarea
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => {
                          patchBlock(block.id, { text: draft });
                          setEditingTextId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingTextId(null);
                        }}
                        aria-label="Text 文字"
                        className="w-full resize-y bg-transparent text-sm leading-6 text-zinc-300 outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setDraft(block.text);
                          setEditingTextId(block.id);
                        }}
                        className="block w-full text-left text-sm leading-6 text-zinc-300"
                      >
                        {block.text ? (
                          renderBold(block.text)
                        ) : (
                          <span className="text-zinc-600">Empty text — click to edit 空文字，点击编辑</span>
                        )}
                      </button>
                    ))}

                  {block.type === "list" && (
                    <textarea
                      value={block.items.join("\n")}
                      onChange={(e) =>
                        patchBlock(block.id, { items: e.target.value.split("\n") })
                      }
                      aria-label="List 列表"
                      placeholder="One item per line 每行一项"
                      className="w-full resize-y bg-transparent text-sm leading-6 text-zinc-300 outline-none"
                    />
                  )}

                  {block.type === "image" && (
                    <div>
                      {block.src && (
                        <button
                          type="button"
                          onClick={() => setLightbox(block.src)}
                          className="block w-full cursor-zoom-in rounded-lg border-0 bg-transparent p-0"
                          title="Enlarge 放大"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={block.src}
                            alt={block.caption ?? "note image"}
                            className="mb-1 max-h-64 w-full rounded-lg object-contain"
                          />
                        </button>
                      )}
                      <input
                        value={block.caption ?? ""}
                        onChange={(e) =>
                          patchBlock(block.id, { caption: e.target.value })
                        }
                        placeholder="Caption 图注"
                        className="w-full bg-transparent text-xs text-zinc-500 outline-none placeholder:text-zinc-700"
                      />
                    </div>
                  )}

                  {block.type === "comment" && (
                    <div className={BLOCK_STYLE.comment}>
                      <p className="text-sm leading-6 text-amber-100">
                        {renderBold(block.text)}
                      </p>
                      <p className="mt-1 text-[10px] text-amber-500/70">
                        {new Date(block.createdAt).toLocaleString()}
                      </p>
                    </div>
                  )}

                  {/* Block controls */}
                  <div className="absolute -right-2 -top-2 hidden gap-1 rounded-lg border border-zinc-700 bg-zinc-800 p-0.5 group-hover:flex">
                    <button
                      onClick={() => moveBlock(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up 上移"
                      className="h-5 w-5 text-[10px] text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveBlock(i, 1)}
                      disabled={i === collection.notes.blocks.length - 1}
                      aria-label="Move down 下移"
                      className="h-5 w-5 text-[10px] text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => deleteBlock(block.id)}
                      aria-label="Delete 删除"
                      className="h-5 w-5 text-[10px] text-red-400 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Enlarged image preview */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label="Enlarged image 图片放大预览"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Enlarged note image 放大的笔记图片"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            aria-label="Close 关闭"
            className="absolute right-5 top-5 rounded-full border border-zinc-600 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-400"
          >
            ✕ Close 关闭
          </button>
        </div>
      )}
    </main>
  );
}
