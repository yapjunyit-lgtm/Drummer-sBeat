/* Cloud sync + sharing for collections (big projects).
   Mirrors src/lib/cloud.ts for scores: pushes the collection document to
   Supabase, fetches visible/shared collections, manages collaborators and
   invites, and grants piece access when someone is given collection access.
   Everything degrades to local-only when Supabase is not configured. */

import { supabase } from "@/lib/supabase";
import {
  loadProjects,
  saveProjects,
  type Project,
} from "@/lib/projects";
import {
  loadCollections,
  saveCollections,
  type ScoreCollection,
} from "@/lib/collections";
import { getAccessToken } from "@/lib/cloud";

export type CollectionRole = "owner" | "editor" | "viewer";

export interface CollectionCollaborator {
  userId: string;
  role: "editor" | "viewer";
  invitedBy?: string | null;
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
}

export interface CloudCollection {
  collection: ScoreCollection;
  ownerId: string;
  revision: number;
  updatedAt: string;
  ownerName?: string;
  cloudRole: CollectionRole;
}

function isCollectionLike(value: unknown): value is ScoreCollection {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    Array.isArray(c.pieceIds) &&
    typeof c.notes === "object" &&
    c.notes !== null
  );
}

/* Push a collection to the cloud (save_collection RPC bumps revision). */
export async function pushCollectionToCloud(
  collection: ScoreCollection
): Promise<{ ok: boolean; revision?: number; error?: string }> {
  if (!supabase) return { ok: false, error: "cloud not configured" };
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return { ok: false, error: "not signed in" };
  const { data, error } = await supabase.rpc("save_collection", {
    p_id: collection.id,
    p_name: collection.name,
    p_description: collection.description ?? "",
    p_data: {
      pieceIds: collection.pieceIds,
      notes: collection.notes,
    },
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    revision: typeof data?.revision === "number" ? data.revision : undefined,
  };
}

/* Fetch every collection visible to the current user (owned or shared). */
export async function fetchVisibleCollections(): Promise<{
  collections: CloudCollection[];
  error?: string;
}> {
  if (!supabase) return { collections: [], error: "cloud not configured" };
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return { collections: [], error: "not signed in" };

  const { data: rows, error } = await supabase
    .from("collections")
    .select(
      "id, owner_id, name, description, data, revision, updated_at"
    )
    .order("updated_at", { ascending: false });
  if (error) return { collections: [], error: error.message };
  if (!rows || rows.length === 0) return { collections: [] };

  const ownerIds = [...new Set(rows.map((r) => r.owner_id as string))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username")
    .in("id", ownerIds);
  const names = new Map(
    (profiles ?? []).map((p) => [
      p.id,
      p.display_name || p.username || p.id.slice(0, 6),
    ])
  );

  const { data: collabs } = await supabase
    .from("collection_collaborators")
    .select("collection_id, role")
    .eq("user_id", userId)
    .in(
      "collection_id",
      rows.map((r) => r.id as string)
    );
  const collabRole = new Map<string, string>(
    (collabs ?? []).map((c) => [c.collection_id as string, c.role as string])
  );

  const result: CloudCollection[] = [];
  for (const row of rows) {
    const raw = row.data as unknown;
    if (!isCollectionLike(raw)) continue;
    const role: CollectionRole =
      row.owner_id === userId
        ? "owner"
        : collabRole.get(row.id as string) === "viewer"
          ? "viewer"
          : "editor";
    const collection: ScoreCollection = {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? "",
      pieceIds: raw.pieceIds,
      notes: raw.notes,
      ownerId: row.owner_id as string,
      revision: (row.revision as number) ?? 0,
      cloudRole: role,
      createdAt: Date.now(),
      updatedAt: new Date(row.updated_at as string).getTime(),
    };
    result.push({
      collection,
      ownerId: row.owner_id as string,
      revision: (row.revision as number) ?? 0,
      updatedAt: row.updated_at as string,
      ownerName: names.get(row.owner_id as string),
      cloudRole: role,
    });
  }
  return { collections: result };
}

/* Merge cloud collections into the local list (cloud wins when newer). */
export function mergeCloudCollections(
  local: ScoreCollection[],
  cloud: CloudCollection[]
): ScoreCollection[] {
  const byId = new Map(local.map((c) => [c.id, c]));
  for (const cc of cloud) {
    const existing = byId.get(cc.collection.id);
    if (
      !existing ||
      new Date(cc.updatedAt).getTime() > (existing?.updatedAt ?? 0) ||
      cc.revision > ((existing as { revision?: number } | undefined)?.revision ?? 0)
    ) {
      byId.set(cc.collection.id, {
        ...cc.collection,
        ownerId: cc.ownerId,
        revision: cc.revision,
        cloudRole: cc.cloudRole,
        updatedAt: new Date(cc.updatedAt).getTime(),
      });
    }
  }
  return [...byId.values()];
}

export function collectionCloudMeta(
  c: ScoreCollection
): { ownerId?: string; revision?: number; cloudRole?: CollectionRole } {
  return {
    ownerId: (c as unknown as { ownerId?: string }).ownerId,
    revision: (c as unknown as { revision?: number }).revision,
    cloudRole: (c as unknown as { cloudRole?: CollectionRole }).cloudRole,
  };
}

/* ------------------------------------------------------------------ */
/* Collaborators                                                       */
/* ------------------------------------------------------------------ */

export async function listCollectionCollaborators(
  collectionId: string
): Promise<{ collaborators: CollectionCollaborator[]; error?: string }> {
  if (!supabase) return { collaborators: [], error: "cloud not configured" };
  const { data, error } = await supabase
    .from("collection_collaborators")
    .select("user_id, role, invited_by, profiles(id, display_name, username, email)")
    .eq("collection_id", collectionId);
  if (error) return { collaborators: [], error: error.message };
  return {
    collaborators: (data ?? []).map((r) => ({
      userId: r.user_id as string,
      role: r.role as "editor" | "viewer",
      invitedBy: (r.invited_by as string | null) ?? null,
      displayName:
        (r.profiles as { display_name?: string } | null)?.display_name ?? null,
      username: (r.profiles as { username?: string } | null)?.username ?? null,
      email: (r.profiles as { email?: string } | null)?.email ?? null,
    })),
  };
}

/* Add a collaborator by email AND grant them editor access to every piece
   in the collection, so "edit everything in it" is automatic. */
export async function addCollectionCollaboratorByEmail(
  collection: ScoreCollection,
  email: string,
  role: "editor" | "viewer"
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "cloud not configured" };
  const { data: authData } = await supabase.auth.getUser();
  const me = authData.user?.id;
  if (!me) return { ok: false, error: "not signed in" };
  const clean = email.trim().toLowerCase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", clean)
    .maybeSingle();
  if (!profile) return { ok: false, error: "No user with that email 未找到该邮箱的用户" };
  if (profile.id === me) return { ok: false, error: "That is you 这是你自己" };

  const { error } = await supabase
    .from("collection_collaborators")
    .upsert(
      {
        collection_id: collection.id,
        user_id: profile.id,
        role,
        invited_by: me,
      },
      { onConflict: "collection_id,user_id" }
    );
  if (error) return { ok: false, error: error.message };

  if (role === "editor") {
    await grantPieceAccess(collection, profile.id);
  }
  return { ok: true };
}

/* Ensure a collaborator can edit every piece referenced by the collection. */
export async function grantPieceAccess(
  collection: ScoreCollection,
  userId: string
): Promise<void> {
  if (!supabase || collection.pieceIds.length === 0) return;
  for (const pid of collection.pieceIds) {
    await supabase.from("score_collaborators").upsert(
      {
        score_id: pid,
        user_id: userId,
        role: "editor",
        invited_by: userId,
      },
      { onConflict: "score_id,user_id" }
    );
  }
}

/* Re-grant access to all collaborators whenever the owner adds a piece. */
export async function grantPieceToAllCollaborators(
  collection: ScoreCollection
): Promise<void> {
  if (!supabase || collection.pieceIds.length === 0) return;
  const { collaborators } = await listCollectionCollaborators(collection.id);
  for (const c of collaborators) {
    if (c.role === "editor") {
      await grantPieceAccess(collection, c.userId);
    }
  }
}

export async function removeCollectionCollaborator(
  collectionId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "cloud not configured" };
  const { error } = await supabase
    .from("collection_collaborators")
    .delete()
    .eq("collection_id", collectionId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Invites (via API routes with the service role)                     */
/* ------------------------------------------------------------------ */

export async function createCollectionInvite(
  collectionId: string,
  role: "editor" | "viewer"
): Promise<{ token?: string; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { error: "not signed in" };
  const res = await fetch("/api/share/collection-invite", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ collectionId, role }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
  };
  if (!res.ok) return { error: json.error ?? "Invite failed 创建邀请失败" };
  return { token: json.token };
}

export async function claimCollectionInvite(
  token: string
): Promise<{ collection?: ScoreCollection; error?: string }> {
  const accessToken = await getAccessToken();
  const res = await fetch("/api/share/collection-claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken ?? ""}`,
    },
    body: JSON.stringify({ token }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: unknown;
    error?: string;
  };
  if (!res.ok || !json.data || !isCollectionLike(json.data)) {
    return { error: json.error ?? "Invalid share link 邀请链接无效" };
  }
  return { collection: json.data };
}

/* ------------------------------------------------------------------ */
/* Realtime                                                           */
/* ------------------------------------------------------------------ */

export function subscribeCollectionChanges(
  collectionId: string,
  onChange: (change: { revision: number; updatedAt: string; data?: unknown }) => void
): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`collection-changes:${collectionId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "collections",
        filter: `id=eq.${collectionId}`,
      },
      (payload) => {
        const row = payload.new as {
          revision?: number;
          updated_at?: string;
          data?: unknown;
        };
        onChange({
          revision: row.revision ?? 0,
          updatedAt: row.updated_at ?? "",
          data: row.data,
        });
      }
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/* Pull cloud collections into the local store (used by the dashboard). */
export async function syncCollectionsWithCloud(): Promise<void> {
  if (!supabase) return;
  const { collections } = await fetchVisibleCollections();
  if (collections.length === 0) return;
  const merged = mergeCloudCollections(loadCollections(), collections);
  saveCollections(merged);
}

/* Keep the local project list in sync when a collection references cloud
   pieces that are not yet local. */
export function adoptCollectionPieces(
  collection: ScoreCollection,
  cloudPieces: { project: Project }[]
): void {
  const local = loadProjects();
  const byId = new Map(local.map((p) => [p.id, p]));
  for (const { project } of cloudPieces) {
    if (!byId.has(project.id)) byId.set(project.id, project);
  }
  const next = [...byId.values()];
  if (next.length !== local.length) saveProjects(next);
}
