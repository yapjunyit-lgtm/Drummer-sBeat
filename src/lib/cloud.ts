/* Cloud sync + collaboration helpers on top of Supabase.

   Everything here degrades gracefully: when Supabase is not configured or the
   user is signed out, functions return a null-ish/error result and the app
   keeps working purely on localStorage.

   Sync model (MVP): the full project JSON is stored in `scores.data` and each
   save bumps `scores.revision` atomically through the `save_score()` RPC.
   Realtime pushes remote updates into open editors; a revision guard keeps a
   stale editor from clobbering newer work (last-write-wins + auto refresh).
*/

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { migrateProjectSchema, type Project } from "@/lib/projects";

export type CloudRole = "owner" | "editor" | "viewer";
export type SyncStatus =
  | "local" // Supabase not configured
  | "signed-out"
  | "saving"
  | "synced"
  | "error";

export interface CollaboratorInfo {
  userId: string;
  role: "editor" | "viewer";
  invitedBy?: string | null;
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
}

export interface CloudScore {
  project: Project;
  ownerId: string;
  revision: number;
  visibility: "private" | "public";
  updatedAt: string;
  ownerName?: string;
  cloudRole: CloudRole;
}

export function cloudAvailable(): boolean {
  return isSupabaseConfigured && supabase !== null;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/* Ensure a profiles row exists for a signed-in user. Username is derived
   from the email prefix and sanitized to the schema constraint. */
export async function ensureProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: { full_name?: string; name?: string };
}): Promise<void> {
  if (!supabase) return;
  const email = (user.email ?? "").toLowerCase();
  const base = (email.split("@")[0] ?? "user")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  const username =
    base.length >= 3 ? base : `${base || "user"}${user.id.slice(0, 6)}`;
  const displayName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    email.split("@")[0] ??
    username;

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) {
    // Keep email in sync (it is used for invite-by-email lookups).
    await supabase
      .from("profiles")
      .update({ email, display_name: displayName })
      .eq("id", user.id);
    return;
  }

  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    username,
    display_name: displayName,
    email,
  });
  if (error && /duplicate key/i.test(error.message)) {
    // Username collision — retry with a short random suffix.
    await supabase.from("profiles").insert({
      id: user.id,
      username: `${username.slice(0, 17)}_${user.id.slice(0, 4)}`,
      display_name: displayName,
      email,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Save / load                                                         */
/* ------------------------------------------------------------------ */

export async function pushProjectToCloud(project: Project): Promise<{
  ok: boolean;
  revision?: number;
  error?: string;
}> {
  if (!supabase) return { ok: false, error: "cloud not configured" };
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) return { ok: false, error: "not signed in" };

  const { data, error } = await supabase.rpc("save_score", {
    p_id: project.id,
    p_title: project.name,
    p_description: project.description ?? null,
    p_bpm: project.bpm,
    p_time_signature: "4/4",
    p_data: {
      ...project,
      // Cloud columns are authoritative; don't persist them into the JSON.
      ownerId: undefined,
      revision: undefined,
      cloudRole: undefined,
    },
    p_visibility: project.visibility ?? "private",
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    revision: typeof data?.revision === "number" ? data.revision : undefined,
  };
}

function isProjectLike(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.bpm === "number" &&
    typeof p.measures === "number" &&
    Array.isArray(p.notes) &&
    Array.isArray(p.groups)
  );
}

/** Validate + migrate arbitrary JSON from the cloud into a Project. */
export function parseCloudProject(value: unknown): Project | null {
  return isProjectLike(value) ? migrateProjectSchema(value) : null;
}

/* Fetch every score row visible to the current user (owned, shared with me,
   or public), mapped back into Project objects with cloud metadata. */
export async function fetchVisibleScores(): Promise<{
  scores: CloudScore[];
  error?: string;
}> {
  if (!supabase) return { scores: [], error: "cloud not configured" };
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return { scores: [], error: "not signed in" };

  const { data: rows, error } = await supabase
    .from("scores")
    .select(
      "id, owner_id, title, description, bpm, time_signature, data, visibility, revision, updated_at"
    )
    .order("updated_at", { ascending: false });
  if (error) return { scores: [], error: error.message };
  if (!rows || rows.length === 0) return { scores: [] };

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

  /* Determine each score's role for the current user (owner / editor / viewer). */
  const { data: collabs } = await supabase
    .from("score_collaborators")
    .select("score_id, role")
    .eq("user_id", userId)
    .in(
      "score_id",
      rows.map((r) => r.id as string)
    );
  const collabRole = new Map<string, string>(
    (collabs ?? []).map((c) => [c.score_id as string, c.role as string])
  );

  const scores: CloudScore[] = [];
  for (const row of rows) {
    const raw = row.data as unknown;
    if (!isProjectLike(raw)) continue;
    const project = migrateProjectSchema(raw);
    project.ownerId = row.owner_id as string;
    project.revision = row.revision as number;
    project.cloudRole =
      row.owner_id === userId
        ? "owner"
        : collabRole.get(row.id as string) === "viewer"
          ? "viewer"
          : "editor";
    project.visibility = (row.visibility ?? "private") as "private" | "public";
    scores.push({
      project,
      ownerId: row.owner_id as string,
      revision: row.revision as number,
      visibility: (row.visibility ?? "private") as "private" | "public",
      updatedAt: row.updated_at as string,
      ownerName: names.get(row.owner_id as string),
      cloudRole: project.cloudRole,
    });
  }
  return { scores };
}

/* Merge a fetched cloud list into the local project list. Local wins when a
   project was edited more recently locally (or when the local copy has a
   newer revision); otherwise the cloud copy replaces the local one. */
export function mergeCloudProjects(
  local: Project[],
  cloud: CloudScore[]
): Project[] {
  const byId = new Map(local.map((p) => [p.id, p]));
  for (const c of cloud) {
    const existing = byId.get(c.project.id);
    if (!existing) {
      byId.set(c.project.id, c.project);
      continue;
    }
    const localTime = existing.updatedAt ?? 0;
    const cloudTime = new Date(c.updatedAt).getTime() || 0;
    const localRev = existing.revision ?? 0;
    if (cloudTime > localTime || c.revision > localRev) {
      byId.set(c.project.id, c.project);
    } else {
      // Keep the local copy but remember the cloud metadata.
      byId.set(c.project.id, {
        ...existing,
        ownerId: c.project.ownerId,
        revision: c.revision,
        cloudRole: c.project.cloudRole,
        visibility: c.project.visibility,
      });
    }
  }
  return [...byId.values()];
}

/* ------------------------------------------------------------------ */
/* Collaborators                                                       */
/* ------------------------------------------------------------------ */

export async function listCollaborators(
  scoreId: string
): Promise<{ collaborators: CollaboratorInfo[]; error?: string }> {
  if (!supabase) return { collaborators: [], error: "cloud not configured" };
  const { data, error } = await supabase
    .from("score_collaborators")
    .select("user_id, role, invited_by, profiles(id, display_name, username, email)")
    .eq("score_id", scoreId);
  if (error) return { collaborators: [], error: error.message };
  const collaborators: CollaboratorInfo[] = (data ?? []).map((r) => ({
    userId: r.user_id as string,
    role: r.role as "editor" | "viewer",
    invitedBy: (r.invited_by as string | null) ?? null,
    displayName:
      (r.profiles as { display_name?: string } | null)?.display_name ?? null,
    username: (r.profiles as { username?: string } | null)?.username ?? null,
    email: (r.profiles as { email?: string } | null)?.email ?? null,
  }));
  return { collaborators };
}

export async function addCollaboratorByEmail(
  scoreId: string,
  email: string,
  role: "editor" | "viewer"
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "cloud not configured" };
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return { ok: false, error: "not signed in" };
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { ok: false, error: "Invalid email 邮箱格式不正确" };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", clean)
    .maybeSingle();
  if (!profile) {
    return { ok: false, error: "No user with that email 未找到该邮箱的用户" };
  }
  if (profile.id === userId) {
    return { ok: false, error: "That is you 这是你自己" };
  }
  const { error } = await supabase
    .from("score_collaborators")
    .upsert(
      { score_id: scoreId, user_id: profile.id, role, invited_by: userId },
      { onConflict: "score_id,user_id" }
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removeCollaborator(
  scoreId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "cloud not configured" };
  const { error } = await supabase
    .from("score_collaborators")
    .delete()
    .eq("score_id", scoreId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setScoreVisibility(
  scoreId: string,
  visibility: "private" | "public"
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "cloud not configured" };
  const { error } = await supabase
    .from("scores")
    .update({ visibility })
    .eq("id", scoreId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Share links                                                         */
/* ------------------------------------------------------------------ */

export async function createShareInvite(
  scoreId: string,
  role: "editor" | "viewer"
): Promise<{ token?: string; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { error: "not signed in" };
  const res = await fetch("/api/share/invite", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ scoreId, role }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
  };
  if (!res.ok) return { error: json.error ?? "Invite failed 创建邀请失败" };
  return { token: json.token };
}

export async function claimShareInvite(
  token: string
): Promise<{ project?: Project; ownerName?: string; error?: string }> {
  const accessToken = await getAccessToken();
  const res = await fetch("/api/share/claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken ?? ""}`,
    },
    body: JSON.stringify({ token }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: unknown;
    ownerName?: string;
    error?: string;
  };
  if (!res.ok || !json.data) {
    return { error: json.error ?? "Invalid share link 邀请链接无效" };
  }
  if (!isProjectLike(json.data)) {
    return { error: "Corrupted score data 乐谱数据损坏" };
  }
  return {
    project: migrateProjectSchema(json.data),
    ownerName: json.ownerName,
  };
}

/* ------------------------------------------------------------------ */
/* Realtime                                                            */
/* ------------------------------------------------------------------ */

export function subscribeScoreChanges(
  scoreId: string,
  onChange: (change: {
    revision: number;
    updatedAt: string;
    data?: unknown;
  }) => void
): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`score-changes:${scoreId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "scores",
        filter: `id=eq.${scoreId}`,
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

export function subscribePresence(
  scoreId: string,
  userId: string,
  label: string,
  onUsers: (userIds: string[]) => void
): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client.channel(`presence:${scoreId}`, {
    config: { presence: { key: userId } },
  });
  const read = () => onUsers(Object.keys(channel.presenceState()));
  channel
    .on("presence", { event: "sync" }, read)
    .on("presence", { event: "join" }, read)
    .on("presence", { event: "leave" }, read)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ label, joinedAt: Date.now() });
      }
    });
  return () => {
    void client.removeChannel(channel);
  };
}
