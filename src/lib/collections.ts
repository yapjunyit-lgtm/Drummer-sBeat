/* Drummer's Beat · collections (big projects) store.

   A collection groups several existing scores ("pieces") and carries a main
   notes document (text / images / comments). Stored in localStorage like the
   project list; pieces are references to Project ids (no duplication). */

import { scopedKey } from "@/lib/userScope";

export type CollectionBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "list"; items: string[] }
  | { id: string; type: "image"; src: string; caption?: string }
  | { id: string; type: "comment"; text: string; createdAt: number };

export interface ScoreCollection {
  id: string;
  name: string;
  description: string;
  /** Cloud owner id (set when fetched from Supabase). */
  ownerId?: string;
  /** Cloud revision + role metadata (set when fetched from Supabase). */
  revision?: number;
  cloudRole?: "owner" | "editor" | "viewer";
  /** Ordered references to existing Project ids. */
  pieceIds: string[];
  notes: { blocks: CollectionBlock[] };
  createdAt: number;
  updatedAt: number;
}

const COLLECTIONS_KEY = "drummers-beat:collections:v1";
const collectionsKey = () => scopedKey(COLLECTIONS_KEY);

export function createCollection(name: string): ScoreCollection {
  return {
    id: crypto.randomUUID(),
    name,
    description: "",
    pieceIds: [],
    notes: { blocks: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function isBlock(value: unknown): value is CollectionBlock {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return typeof b.id === "string" && typeof b.type === "string";
}

function isCollection(value: unknown): value is ScoreCollection {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    Array.isArray(c.pieceIds) &&
    typeof c.notes === "object" &&
    c.notes !== null &&
    Array.isArray((c.notes as Record<string, unknown>).blocks) &&
    ((c.notes as Record<string, unknown>).blocks as unknown[]).every(isBlock)
  );
}

export function loadCollections(): ScoreCollection[] {
  try {
    const raw = localStorage.getItem(collectionsKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCollection);
  } catch {
    return [];
  }
}

export function saveCollections(list: ScoreCollection[]): void {
  try {
    localStorage.setItem(collectionsKey(), JSON.stringify(list));
  } catch {
    // Storage unavailable — ignore for MVP.
  }
}

export function updateCollection(
  list: ScoreCollection[],
  id: string,
  fn: (c: ScoreCollection) => ScoreCollection
): ScoreCollection[] {
  return list.map((c) =>
    c.id === id ? { ...fn(c), updatedAt: Date.now() } : c
  );
}

export function newBlockId(): string {
  return crypto.randomUUID();
}
