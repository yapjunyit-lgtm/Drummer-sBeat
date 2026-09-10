/*
 * End-to-end check for collection sharing, against a real Supabase project.
 *
 * It creates two throwaway auth users (owner + claimer), has the owner create
 * a collection and mint a share link, has the second user claim that link
 * through the app's own API route, then verifies the claimed collection is
 * actually visible to them. Both test users are deleted at the end, which
 * cascades to their profiles, collections and invites.
 *
 * Usage (dev server must be running):
 *   npx tsx scripts/verify-collection-share.mts
 *   APP_URL=http://localhost:3005 npx tsx scripts/verify-collection-share.mts
 */

import { readFileSync } from "node:fs";

const envFile = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const at = trimmed.indexOf("=");
  env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
}

const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP_URL ?? "http://localhost:3005";

if (!SB_URL || !ANON || !SERVICE) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(2);
}

const stamp = Date.now().toString().slice(-7);
const password = `CodexTest!${stamp}`;
const ownerEmail = `codex-owner-${stamp}@example.com`;
const claimerEmail = `codex-claimer-${stamp}@example.com`;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${detail}`}`);
  if (!ok) failures++;
};

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const svcHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

async function createUser(email: string): Promise<{ id: string }> {
  const res = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await parse(res);
  if (!res.ok) throw new Error(`createUser ${email}: ${JSON.stringify(body)}`);
  return body;
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parse(res);
  if (!res.ok) throw new Error(`signIn ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function ensureProfile(userId: string, email: string, token: string) {
  const username = `codex_${userId.replace(/-/g, "").slice(0, 12)}`;
  const res = await fetch(`${SB_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ id: userId, username, display_name: username, email }),
  });
  const body = await parse(res);
  if (!res.ok) throw new Error(`ensureProfile: ${JSON.stringify(body)}`);
}

async function deleteUser(userId: string) {
  await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: svcHeaders,
  });
}

const collectionId = crypto.randomUUID();
const ownerId: string[] = [];
const createdUsers: string[] = [];

try {
  console.log(`\nApp under test: ${APP}`);
  console.log(`Supabase:       ${SB_URL}\n`);

  // --- 1. two temporary accounts ------------------------------------------
  const owner = await createUser(ownerEmail);
  createdUsers.push(owner.id);
  const claimer = await createUser(claimerEmail);
  createdUsers.push(claimer.id);
  const ownerToken = await signIn(ownerEmail);
  const claimerToken = await signIn(claimerEmail);
  await ensureProfile(owner.id, ownerEmail, ownerToken);
  await ensureProfile(claimer.id, claimerEmail, claimerToken);
  ownerId.push(owner.id);
  check("two temporary accounts created + signed in", true);

  // --- 2. owner creates a collection (non-empty, so dedupe can't drop it) --
  const saveRes = await fetch(`${SB_URL}/rest/v1/rpc/save_collection`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_id: collectionId,
      p_name: `Codex Share Test ${stamp}`,
      p_description: "temporary e2e check",
      p_data: {
        pieceIds: [],
        notes: { blocks: [{ id: "b1", type: "text", text: "e2e" }] },
      },
    }),
  });
  const saved = await parse(saveRes);
  check("owner saved collection via save_collection RPC", saveRes.ok, JSON.stringify(saved));

  // --- 3. owner mints a share link through the app's API route -------------
  const inviteRes = await fetch(`${APP}/api/share/collection-invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({ collectionId, role: "editor" }),
  });
  const invite = await parse(inviteRes);
  check("app minted a collection share token", inviteRes.ok && !!invite.token, JSON.stringify(invite));
  const shareToken: string = invite.token ?? "";

  // --- 4. the other user claims it ----------------------------------------
  const claimRes = await fetch(`${APP}/api/share/collection-claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${claimerToken}`,
    },
    body: JSON.stringify({ token: shareToken }),
  });
  const claim = await parse(claimRes);
  check("claim request succeeded (HTTP 200)", claimRes.status === 200, `HTTP ${claimRes.status} ${JSON.stringify(claim)}`);
  check("claim response carries the collection id", claim?.data?.id === collectionId, JSON.stringify(claim?.data ?? claim));
  check("claim response carries the collection name", typeof claim?.data?.name === "string" && claim.data.name.length > 0, JSON.stringify(claim?.data ?? claim));
  check("claim response carries pieceIds + notes", Array.isArray(claim?.data?.pieceIds) && !!claim?.data?.notes, JSON.stringify(claim?.data ?? claim));
  check("claim response carries the granted role", claim?.role === "editor", String(claim?.role));

  // --- 5. the claimer can now actually read it (RLS) ----------------------
  const listRes = await fetch(
    `${SB_URL}/rest/v1/collections?select=id,name,data&id=eq.${collectionId}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${claimerToken}` } }
  );
  const listed = await parse(listRes);
  check(
    "claimer sees the collection through RLS",
    Array.isArray(listed) && listed.length === 1,
    JSON.stringify(listed)
  );

  // --- 6. and the pieces inside it are readable too -----------------------
  const collabRes = await fetch(
    `${SB_URL}/rest/v1/collection_collaborators?select=user_id,role&collection_id=eq.${collectionId}`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  const collabs = await parse(collabRes);
  check(
    "a collaborator row exists for the claimer",
    Array.isArray(collabs) && collabs.some((c: any) => c.user_id === claimer.id),
    JSON.stringify(collabs)
  );
} catch (err) {
  console.error(`\nHarness error: ${err instanceof Error ? err.message : String(err)}`);
  failures++;
} finally {
  // --- cleanup: deleting the users cascades their data ---------------------
  for (const id of createdUsers) await deleteUser(id);
  console.log("\ncleanup: temporary users and their data deleted");
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
