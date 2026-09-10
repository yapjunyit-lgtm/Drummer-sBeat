/*
 * Checks what "delete a collection" does for each ownership case, using the
 * app's real client + the dashboard's exact delete call.
 *
 * Usage (dev server running): npx tsx scripts/verify-collection-delete.mts
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
const colStore = await import("../src/lib/collections");
const { setCurrentUserId } = await import("../src/lib/userScope");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failures++;
};

async function j(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const stamp = Date.now().toString().slice(-7);
const password = "CodexTest!" + stamp;
const svcHeaders = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" };
const createdUsers: string[] = [];

async function makeUser(role: string) {
  const email = `codex-${role}-${stamp}@example.com`;
  const created = await j(
    await realFetch(SB_URL + "/auth/v1/admin/users", {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
  );
  createdUsers.push(created.id);
  const session = await j(
    await realFetch(SB_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  );
  const username = "codex_" + String(created.id).replace(/-/g, "").slice(0, 12);
  await realFetch(SB_URL + "/rest/v1/profiles", {
    method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ id: created.id, username, display_name: username, email }),
  });
  return { id: created.id as string, email, token: session.access_token as string };
}

async function rowExists(id: string) {
  const rows = await j(
    await realFetch(SB_URL + "/rest/v1/collections?select=id&id=eq." + id, {
      headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE },
    })
  );
  return Array.isArray(rows) && rows.length === 1;
}

async function collaboratorExists(collectionId: string, userId: string) {
  const rows = await j(
    await realFetch(
      SB_URL +
        "/rest/v1/collection_collaborators?select=user_id&collection_id=eq." +
        collectionId +
        "&user_id=eq." +
        userId,
      { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } }
    )
  );
  return Array.isArray(rows) && rows.length === 1;
}

try {
  const owner = await makeUser("owner");
  const editor = await makeUser("editor");
  const collectionId = crypto.randomUUID();
  const name = "Delete Test " + stamp;

  await realFetch(SB_URL + "/rest/v1/rpc/save_collection", {
    method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + owner.token, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_id: collectionId,
      p_name: name,
      p_description: "",
      p_data: { pieceIds: [], notes: { blocks: [{ id: "b1", type: "text", text: "x" }] } },
    }),
  });
  const invite = await j(
    await realFetch(APP + "/api/share/collection-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + owner.token },
      body: JSON.stringify({ collectionId, role: "editor" }),
    })
  );

  // editor claims it and sees it in their own list
  await supabase!.auth.signOut();
  store.clear();
  await supabase!.auth.signInWithPassword({ email: editor.email, password });
  setCurrentUserId(editor.id);
  const claimed = await cc.claimCollectionInvite(invite.token);
  check("editor claimed the shared collection", !!claimed.collection, String(claimed.error ?? ""));
  colStore.saveCollections([...(claimed.collection ? [claimed.collection] : [])]);

  // editor removes it: not their row, so it can only be dismissed locally
  const editorRemoved = await cc.removeCollectionForUser(claimed.collection!, editor.id);
  check("editor's removal reports a dismissal", editorRemoved.dismissed, JSON.stringify(editorRemoved));
  check(
    "removal is honest when the server still has access",
    editorRemoved.ok || /still lists you as a collaborator/.test(editorRemoved.error ?? ""),
    JSON.stringify(editorRemoved)
  );
  check("cloud row survives (not the editor's to delete)", await rowExists(collectionId), "row vanished from cloud");
  check(
    "editor LEFT the collaboration (so it hides on every device)",
    !(await collaboratorExists(collectionId, editor.id)),
    "collaborator row still present -> run supabase/collection-leave-fix.sql"
  );

  const { collections: editorCloudAfterLeave } = await cc.fetchVisibleCollections();
  check(
    "editor's cloud fetch no longer returns it",
    !editorCloudAfterLeave.some((c) => c.collection.id === collectionId),
    "still visible to the editor in the cloud"
  );

  colStore.saveCollections(colStore.loadCollections().filter((c) => c.id !== collectionId));
  const { collections: editorCloud } = await cc.fetchVisibleCollections();
  const afterDismiss = cc.mergeCloudCollections(colStore.loadCollections(), editorCloud);
  check("dismissed collection does NOT come back on refresh", !afterDismiss.some((c) => c.id === collectionId), "it came back");

  colStore.unhideCollection(collectionId);
  const afterReopen = cc.mergeCloudCollections(colStore.loadCollections(), editorCloud);
  check("opening it again restores it", afterReopen.some((c) => c.id === collectionId), "still hidden");

  // owner removes it: that one is a real delete
  await supabase!.auth.signOut();
  store.clear();
  await supabase!.auth.signInWithPassword({ email: owner.email, password });
  setCurrentUserId(owner.id);
  const ownerRemoved = await cc.removeCollectionForUser(claimed.collection!, owner.id);
  check("owner's removal is a real delete", ownerRemoved.ok && !ownerRemoved.dismissed, JSON.stringify(ownerRemoved));
  check("cloud row gone after the owner deletes it", !(await rowExists(collectionId)), "row still there");

  /* The reported bug: a device holding a local copy WITHOUT owner/revision
     metadata used to skip the cloud delete entirely, so the collection came
     back on the next refresh. */
  const staleId = crypto.randomUUID();
  await realFetch(SB_URL + "/rest/v1/rpc/save_collection", {
    method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + owner.token, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_id: staleId,
      p_name: "Stale metadata " + stamp,
      p_description: "",
      p_data: { pieceIds: [], notes: { blocks: [] } },
    }),
  });
  const staleRemoved = await cc.removeCollectionForUser(
    {
      id: staleId,
      name: "Stale metadata",
      description: "",
      pieceIds: [],
      notes: { blocks: [] },
      createdAt: 0,
      updatedAt: 0,
    },
    owner.id
  );
  check(
    "delete works even when local metadata is missing",
    staleRemoved.ok && !staleRemoved.dismissed,
    JSON.stringify(staleRemoved)
  );
  check(
    "that collection is really gone from the cloud (no reappearing)",
    !(await rowExists(staleId)),
    "row still there -> it would come back on refresh"
  );

  const localOnly = await cc.removeCollectionForUser(
    {
      id: crypto.randomUUID(),
      name: "Local only",
      description: "",
      pieceIds: [],
      notes: { blocks: [] },
      createdAt: 0,
      updatedAt: 0,
    },
    owner.id
  );
  check("local-only collection removal needs no cloud call", localOnly.ok && !localOnly.dismissed, JSON.stringify(localOnly));

  const legacyId = await cc.removeCollectionForUser(
    {
      id: "legacy-non-uuid-id",
      name: "Legacy local collection",
      description: "",
      pieceIds: [],
      notes: { blocks: [] },
      createdAt: 0,
      updatedAt: 0,
    },
    owner.id
  );
  check(
    "legacy non-uuid id does not error (local-only data)",
    legacyId.ok && !legacyId.dismissed,
    JSON.stringify(legacyId)
  );

  // how the dashboard splits "my collections" from "shared with me"
  const base = {
    id: "",
    name: "c",
    description: "",
    pieceIds: [] as string[],
    notes: { blocks: [] as { id: string; type: "text"; text: string }[] },
    createdAt: 0,
    updatedAt: 0,
  };
  check("own list: local-only collection counts as mine", colStore.isOwnCollection({ ...base, id: "a" }, "me"));
  check("own list: collection I own in the cloud counts as mine", colStore.isOwnCollection({ ...base, id: "b", ownerId: "me" }, "me"));
  check("own list: another player's collection is excluded", !colStore.isOwnCollection({ ...base, id: "c", ownerId: "them", cloudRole: "editor" }, "me"));
  check("own list: owner role wins over owner id", colStore.isOwnCollection({ ...base, id: "d", ownerId: "them", cloudRole: "owner" }, "me"));
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
