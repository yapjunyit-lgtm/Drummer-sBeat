import { NextResponse } from "next/server";
import { serviceSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

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
    collectionId?: unknown;
    role?: unknown;
  };
  const collectionId =
    typeof body.collectionId === "string" ? body.collectionId : "";
  const role = body.role === "viewer" ? "viewer" : "editor";
  if (!collectionId) {
    return NextResponse.json(
      { error: "collectionId is required" },
      { status: 400 }
    );
  }

  const { data: collection } = await serviceSupabase
    .from("collections")
    .select("id")
    .eq("id", collectionId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!collection) {
    return NextResponse.json(
      { error: "Collection not found or not yours 项目集不存在或你不是所有者" },
      { status: 404 }
    );
  }

  const { data: invite, error } = await serviceSupabase
    .from("collection_invites")
    .insert({
      collection_id: collectionId,
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
