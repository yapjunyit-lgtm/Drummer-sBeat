/*
 * Reproduces the RECIPIENT's client-side path for a shared collection using
 * the app's real modules: claim the link, store it locally (page effect),
 * then run the dashboard refresh/cleanup and see whether it survives.
 *
 * Usage (dev server running):  npx tsx scripts/verify-collection-share-client.mts
 */

import { readFileSync } from "node:fs";

const envFile = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const at = t.indexOf("=");
  process.env[t.slice(0, at).trim()] = t.slice(at + 1).trim();
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP = process.env.APP_URL ?? "http://localhost:3005";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
const realFetch = globalThis.fetch;
(globalThis as any).fetch = (input: any, init?: any) =>
  realFetch(typeof input === "string" && input.startsWith("/") ? APP + input : input, init);

const { supabase } = await import("../src/lib/supabase");
const cc = await import("../src/lib/collectionCloud");
const { loadCollections, saveCollections } = await import("../src/lib/collections");
const { setCurrentUserId } = await import("../src/lib/userScope");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failures++;
};

const stamp = Date.now().toString().slice(-7);
const password = "CodexTest!" + stamp;
const ownerEmail = "codex-owner-" + stamp + "@example.com";
const claimerEmail = "codex-claimer-" + stamp + "@example.com";
const svcHeaders = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" };

async function j(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const createdUsers: string[] = [];

async function createUser(email: string, tokenOut?: string[]) {
  const res = await realFetch(SB_URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await j(res);
  if (!res.ok) throw new Error("createUser: " + JSON.stringify(body));
  createdUsers.push(body.id);
  const signIn = await realFetch(SB_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await j(signIn);
  if (!signIn.ok) throw new Error("signIn: " + JSON.stringify(session));
  tokenOut?.push(session.access_token);
  const username = "codex_" + String(body.id).replace(/-/g, "").slice(0, 12);
  await realFetch(SB_URL + "/rest/v1/profiles", {
    method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ id: body.id, username, display_name: username, email }),
  });
  return body.id as string;
}

async function saveCollection(token: string, id: string, name: string, blocks: number) {
  const res = await realFetch(SB_URL + "/rest/v1/rpc/save_collection", {
    method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_id: id,
      p_name: name,
      p_description: "",
      p_data: {
        pieceIds: [],
        notes: { blocks: Array.from({ length: blocks }, (_, i) => ({ id: "b" + i, type: "text", text: "x" })) },
      },
    }),
  });
  if (!res.ok) console.log("   save_collection failed:", JSON.stringify(await j(res)));
}

try {
  const sharedName = "Dup Name " + stamp;
  const emptyId = crypto.randomUUID();
  const controlId = crypto.randomUUID();
  const ownerTokens: string[] = [];
  const ownerId = await createUser(ownerEmail, ownerTokens);
  const claimerId = await createUser(claimerEmail);
  const ownerToken = ownerTokens[0];

  await saveCollection(ownerToken, emptyId, sharedName, 0);
  await saveCollection(ownerToken, crypto.randomUUID(), sharedName, 2);
  await saveCollection(ownerToken, controlId, "Control " + stamp, 2);

  async function invite(collectionId: string) {
    const res = await realFetch(APP + "/api/share/collection-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + ownerToken },
      body: JSON.stringify({ collectionId, role: "editor" }),
    });
    const body = await j(res);
    if (!res.ok) throw new Error("invite: " + JSON.stringify(body));
    return body.token as string;
  }
  const emptyToken = await invite(emptyId);
  const controlToken = await invite(controlId);

  const signIn = await supabase!.auth.signInWithPassword({ email: claimerEmail, password });
  if (signIn.error) throw new Error("client sign-in: " + signIn.error.message);
  setCurrentUserId(claimerId);
  check("claimer signed in through the app client", true);
  void ownerId;

  const claimedEmpty = await cc.claimCollectionInvite(emptyToken);
  const claimedControl = await cc.claimCollectionInvite(controlToken);
  check("empty shared collection claimed", !!claimedEmpty.collection, String(claimedEmpty.error ?? ""));
  check("control shared collection claimed", !!claimedControl.collection, String(claimedControl.error ?? ""));

  saveCollections([
    ...loadCollections(),
    ...(claimedEmpty.collection ? [claimedEmpty.collection] : []),
    ...(claimedControl.collection ? [claimedControl.collection] : []),
  ]);
  check("both present locally after claiming", loadCollections().length === 2, "local count = " + loadCollections().length);

  const { collections: cloudList } = await cc.fetchVisibleCollections();
  const merged = cc.mergeCloudCollections(loadCollections(), cloudList);
  const deduped = await cc.dedupeEmptyCollections(merged, cloudList, claimerId);
  const ids = new Set(deduped.map((c) => c.id));
  check("empty shared collection SURVIVES dashboard cleanup", ids.has(emptyId), "it was dropped from the recipient list");
  check("control collection survives cleanup", ids.has(controlId));

  // ---- Part B: the OWNER's dashboard, where the shared row can be deleted --
  await supabase!.auth.signOut();
  store.clear();
  const ownerSignIn = await supabase!.auth.signInWithPassword({ email: ownerEmail, password });
  if (ownerSignIn.error) throw new Error("owner sign-in: " + ownerSignIn.error.message);
  setCurrentUserId(ownerId);

  const ownerCloud = await cc.fetchVisibleCollections();
  check(
    "owner's cloud fetch returns collections (not an empty list)",
    ownerCloud.collections.length >= 3,
    "fetchVisibleCollections returned " + ownerCloud.collections.length + " collections"
  );
  const ownerMerged = cc.mergeCloudCollections(loadCollections(), ownerCloud.collections);
  const ownerDeduped = await cc.dedupeEmptyCollections(ownerMerged, ownerCloud.collections, ownerId);
  const ownerIds = new Set(ownerDeduped.map((c) => c.id));
  check("owner still sees the collection they shared", ownerIds.has(emptyId), "dropped from the owner's list");


  const afterOwnerRun = await j(
    await realFetch(SB_URL + "/rest/v1/collections?select=id&id=eq." + emptyId, {
      headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE },
    })
  );
  check(
    "shared collection still exists in cloud after owner cleanup",
    Array.isArray(afterOwnerRun) && afterOwnerRun.length === 1,
    "row was DELETED, so the shared link now points at nothing"
  );

  // a recipient opens the very link the owner sent
  await supabase!.auth.signOut();
  store.clear();
  await supabase!.auth.signInWithPassword({ email: claimerEmail, password });
  setCurrentUserId(claimerId);
  const lateClaim = await cc.claimCollectionInvite(emptyToken);
  check("recipient can still claim the sent link", !!lateClaim.collection, String(lateClaim.error ?? ""));
} catch (err) {
  console.error("\nHarness error: " + (err instanceof Error ? err.message : String(err)));
  failures++;
} finally {
  await supabase?.auth.signOut();
  for (const id of createdUsers) {
    await realFetch(SB_URL + "/auth/v1/admin/users/" + id, { method: "DELETE", headers: svcHeaders });
  }
  console.log("\ncleanup: temporary users and their data deleted");
  console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
  process.exit(failures === 0 ? 0 : 1);
}
