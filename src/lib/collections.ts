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
const HIDDEN_KEY = "drummers-beat:hidden-collections:v1";
const hiddenKey = () => scopedKey(HIDDEN_KEY);

/* Collections the user removed from their dashboard.

   A collection shared with you cannot be deleted from the cloud — you do not
   own the row, so Row Level Security refuses the delete and the collection
   reappears on the next refresh. Dismissing it locally is what makes "remove"
   stick; opening the collection's page again clears the dismissal. */
export function loadHiddenCollectionIds(): string[] {
  try {
    const raw = localStorage.getItem(hiddenKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function saveHiddenCollectionIds(ids: string[]): void {
  try {
    localStorage.setItem(hiddenKey(), JSON.stringify([...new Set(ids)]));
  } catch {
    // Storage unavailable — ignore.
  }
}

export function hideCollection(id: string): void {
  saveHiddenCollectionIds([...loadHiddenCollectionIds(), id]);
}

export function unhideCollection(id: string): void {
  saveHiddenCollectionIds(loadHiddenCollectionIds().filter((x) => x !== id));
}

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

/* Which collections belong to the signed-in user. Local-only collections
   (no cloud metadata yet) count as yours; anything carrying another player's
   owner id does not, even if you can open it. */
export function isOwnCollection(
  c: ScoreCollection,
  userId: string | undefined
): boolean {
  return (
    c.ownerId === undefined || c.ownerId === userId || c.cloudRole === "owner"
  );
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
