import { NextResponse } from "next/server";
import { serviceSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

/* Claim a collection share link: the caller becomes a collaborator and — for
   editor access — is granted editor access to every piece in the collection,
   so "can edit everything in it" is automatic. */
export async function POST(request: Request) {
  if (!serviceSupabase) {
    return NextResponse.json(
      { error: "Supabase is not configured 云服务未配置" },
      { status: 503 }
    );
  }

  const token = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    ""
  );
  if (!token) {
    return NextResponse.json({ error: "Not signed in 未登录" }, { status: 401 });
  }

  let userId: string;
  try {
    const { data, error } = await serviceSupabase.auth.getUser(token);
    if (error || !data.user) throw new Error(error?.message ?? "unauthorized");
    userId = data.user.id;
  } catch {
    return NextResponse.json({ error: "Invalid session 会话无效" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown;
  };
  const shareToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!shareToken) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const { data: invite } = await serviceSupabase
    .from("collection_invites")
    .select("collection_id, role, expires_at, created_by")
    .eq("token", shareToken)
    .maybeSingle();
  if (!invite) {
    return NextResponse.json(
      { error: "Invalid or expired share link 邀请链接无效或已过期" },
      { status: 404 }
    );
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Share link expired 邀请链接已过期" },
      { status: 410 }
    );
  }

  const collectionId = invite.collection_id as string;
  const { data: existing } = await serviceSupabase
    .from("collection_collaborators")
    .select("user_id")
    .eq("collection_id", collectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    await serviceSupabase
      .from("collection_collaborators")
      .update({ role: invite.role })
      .eq("collection_id", collectionId)
      .eq("user_id", userId);
  } else {
    await serviceSupabase
      .from("collection_collaborators")
      .insert({
        collection_id: collectionId,
        user_id: userId,
        role: invite.role,
        invited_by: invite.created_by ?? null,
      });
  }

  const { data: collection } = await serviceSupabase
    .from("collections")
    .select("id, owner_id, name, description, data, revision, updated_at")
    .eq("id", collectionId)
    .maybeSingle();
  if (!collection) {
    return NextResponse.json(
      { error: "Collection not found 项目集不存在" },
      { status: 404 }
    );
  }

  // Editor access = edit everything inside: grant each piece too.
  if (invite.role === "editor") {
    const data = collection.data as { pieceIds?: string[] };
    for (const pid of data?.pieceIds ?? []) {
      await serviceSupabase
        .from("score_collaborators")
        .upsert(
          { score_id: pid, user_id: userId, role: "editor" },
          { onConflict: "score_id,user_id" }
        );
    }
  }

  /* Return the full collection document (id, name, description + the
     pieceIds/notes payload) with ownership/revision metadata. The claim
     client needs id/name to validate and render the collection; returning
     only the bare jsonb (as before) made every valid link fail validation
     with "Invalid share link 邀请链接无效". */
  const data = (collection.data as { pieceIds?: string[]; notes?: unknown }) ??
    {};
  return NextResponse.json({
    data: {
      id: collection.id,
      name: collection.name,
      description: collection.description ?? "",
      pieceIds: Array.isArray(data.pieceIds) ? data.pieceIds : [],
      notes: data.notes ?? { blocks: [] },
    },
    ownerId: collection.owner_id,
    revision: collection.revision ?? 0,
    role: invite.role,
    updatedAt: collection.updated_at,
  });
}
