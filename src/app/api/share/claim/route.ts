import { NextResponse } from "next/server";
import { serviceSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

/* Anyone with a valid share token can claim access: they become a
   collaborator with the role on the invite, and the score is returned so the
   editor can load it. */
export async function POST(request: Request) {
  if (!serviceSupabase) {
    return NextResponse.json(
      { error: "Supabase is not configured 云服务未配置" },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Not signed in 未登录" }, { status: 401 });
  }

  let userId: string;
  try {
    const { data, error } = await serviceSupabase.auth.getUser(token);
    if (error || !data.user) throw new Error(error?.message ?? "unauthorized");
    userId = data.user.id;
  } catch {
    return NextResponse.json(
      { error: "Invalid session 会话无效" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown;
  };
  const shareToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!shareToken) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const { data: invite } = await serviceSupabase
    .from("score_invites")
    .select("score_id, role, expires_at, created_by")
    .eq("token", shareToken)
    .maybeSingle();
  if (!invite) {
    return NextResponse.json(
      { error: "Invalid or expired share link 邀请链接无效或已过期" },
      { status: 404 }
    );
  }
  if (
    invite.expires_at &&
    new Date(invite.expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: "Share link expired 邀请链接已过期" },
      { status: 410 }
    );
  }

  const scoreId = invite.score_id as string;

  // Make the caller a collaborator (or refresh the role).
  const { data: existing } = await serviceSupabase
    .from("score_collaborators")
    .select("user_id")
    .eq("score_id", scoreId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    await serviceSupabase
      .from("score_collaborators")
      .update({ role: invite.role })
      .eq("score_id", scoreId)
      .eq("user_id", userId);
  } else {
    await serviceSupabase
      .from("score_collaborators")
      .insert({
        score_id: scoreId,
        user_id: userId,
        role: invite.role,
        invited_by: invite.created_by ?? null,
      });
  }

  const { data: score } = await serviceSupabase
    .from("scores")
    .select("data, owner_id, title")
    .eq("id", scoreId)
    .maybeSingle();
  if (!score) {
    return NextResponse.json(
      { error: "Score not found 乐谱不存在" },
      { status: 404 }
    );
  }

  let ownerName: string | undefined;
  const { data: owner } = await serviceSupabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", score.owner_id as string)
    .maybeSingle();
  if (owner) {
    ownerName = owner.display_name || owner.username || undefined;
  }

  return NextResponse.json({
    data: score.data,
    ownerName,
    ownerId: score.owner_id,
    title: score.title,
  });
}
