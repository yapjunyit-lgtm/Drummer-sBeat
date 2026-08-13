import { NextResponse } from "next/server";
import { serviceSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

/* Owner-only: mint a share link (score_invites row). The caller must be the
   score owner; the resulting token lets anyone with the link claim the role. */
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
    scoreId?: unknown;
    role?: unknown;
  };
  const scoreId = typeof body.scoreId === "string" ? body.scoreId : "";
  const role = body.role === "viewer" ? "viewer" : "editor";
  if (!scoreId) {
    return NextResponse.json({ error: "scoreId is required" }, { status: 400 });
  }

  const { data: score } = await serviceSupabase
    .from("scores")
    .select("id")
    .eq("id", scoreId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!score) {
    // Do not leak whether the score exists.
    return NextResponse.json(
      { error: "Score not found or not yours 乐谱不存在或你不是所有者" },
      { status: 404 }
    );
  }

  const { data: invite, error } = await serviceSupabase
    .from("score_invites")
    .insert({
      score_id: scoreId,
      role,
      created_by: userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("token")
    .single();
  if (error || !invite) {
    return NextResponse.json(
      { error: error?.message ?? "Invite creation failed 创建邀请失败" },
      { status: 500 }
    );
  }

  return NextResponse.json({ token: invite.token }, { status: 201 });
}
