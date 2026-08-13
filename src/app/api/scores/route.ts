import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: unknown;
    description?: unknown;
    difficulty?: unknown;
    bpm?: unknown;
    timeSignature?: unknown;
    visibility?: unknown;
    data?: unknown;
  };

  if (typeof body.title !== "string" || body.title.trim() === "" || !body.data) {
    return NextResponse.json(
      { error: "title and data are required" },
      { status: 400 }
    );
  }

  // TODO (Phase 2/3): insert into Supabase `scores` table using the server
  // Supabase client. Row Level Security enforces that the authenticated user
  // can only create scores they own (`auth.uid() = owner_id`).
  //
  // const { data, error } = await supabase
  //   .from("scores")
  //   .insert({ ... })
  //   .select("id")
  //   .single();

  const id = crypto.randomUUID();
  return NextResponse.json(
    {
      id,
      status: "published",
      note: "Stub endpoint — Supabase persistence lands in Phase 2.",
    },
    { status: 201 }
  );
}
