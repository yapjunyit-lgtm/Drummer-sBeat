# Drummer's Beat · Deployment Guide 部署指南

## Recommended architecture

**Next.js on Vercel (frontend) + Supabase (managed Postgres, Auth, Realtime).**

Why this combination:

- The existing `supabase/schema.sql` already models users, scores (jsonb
  document), likes and comments — Supabase gives us that Postgres schema plus
  Row-Level Security for free.
- Supabase Auth provides email/password + Google sign-in, so "who is editing"
  is a solved problem.
- Supabase Realtime provides live sync (`postgres_changes`) and presence
  ("3 people editing now") without running a websocket server.
- Vercel is a one-command deploy for the Next.js app and scales to zero cost
  for a hobby project.

Alternatives we evaluated and why we did not pick them:

| Option | Verdict |
| --- | --- |
| Firebase / Firestore | Realtime works, but it throws away the existing Postgres schema and RLS design; per-document rules are clunkier for jsonb scores. |
| Liveblocks | Excellent collaboration primitives, but adds a third-party service + cost and locks the score document into its storage model. |
| Yjs + WebRTC | Great offline-first sync, but discovery/persistence still need a server, and auth is DIY. |
| PocketBase (self-hosted) | Viable, but you manage a server; Supabase is managed and matches the schema we already wrote. |

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project** (free tier is
   enough). Pick a region close to your users (e.g. Singapore for Malaysia).
2. In the SQL Editor, run `supabase/schema.sql` first, then
   `supabase/collaboration.sql`. The second file adds:
   - `profiles.email` (invite-by-email lookups)
   - `scores.revision` (optimistic concurrency)
   - `score_collaborators` (who can edit/view)
   - `score_invites` (share links)
   - the `save_score()` RPC (atomic save + revision bump)
   - Realtime publication for `scores` and `score_collaborators`

## 2. Configure Auth

Project Settings → **Authentication**:

- **Providers → Email**: enable it. For development, set "Confirm email" to
  **Off** so sign-up works instantly (turn it back on for production).
- **Providers → Google**: enable it, then copy the **callback URL shown inside
  the Google provider panel** (it looks like
  `https://<project-ref>.supabase.co/auth/v1/callback`). In Google Cloud
  Console add that URL — and only that URL — to **Authorized redirect URIs**.
  The app URL (e.g. `http://localhost:3000`) belongs in Supabase's own
  **URL Configuration → Redirect URLs**, not in Google. Full click-by-click
  steps: see "Google sign-in setup" below.
- **URL Configuration**: add `http://localhost:3000` as a redirect URL while
  developing, plus your production URL.

## 3. Environment variables

Create `.env.local` (never commit it — it is already git-ignored):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>           # Project Settings → API
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>       # server-only! never expose
```

The app runs fine without these — everything falls back to local-only mode
(the header shows `Local 本地`). Sharing and accounts simply appear disabled
until the variables exist.

## 4. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign up, and create a project. To test sharing
with two people, use two browsers (or one normal + one incognito window) and
sign in with two accounts.

## 5. Deploy

### Vercel

1. Push the repo to GitHub/GitLab and import it in Vercel.
2. Add the three env vars above in **Project → Settings → Environment
   Variables** (production + preview).
3. Deploy — `npm run build` is used automatically.

### Anywhere else

```bash
npm run build
npm start
```

Point your reverse proxy at port 3000. Next.js 16 requires Node 20+.

## Collaboration model (how "share edit access" works)

1. **Invite by email** — the owner enters an email; the app looks up the
   profile, adds a collaborator row with role `editor` or `viewer`, and the
   recipient sees the score in **Shared with me** on the dashboard.
2. **Share link** — the owner clicks *Create*; a random token is stored in
   `score_invites` (valid 7 days). Anyone who opens
   `/editor?share=<token>` and signs in becomes a collaborator with that role.
3. **Policies** — RLS lets:
   - owners and `editor` collaborators update a score row,
   - owners add/remove collaborators and create invites,
   - everyone with access read the score.
4. **Sync** — the editor saves the whole project JSON to `scores.data` via
   the `save_score()` RPC, which bumps `revision` atomically. Realtime pushes
   remote edits into every open editor; a revision guard prevents a stale
   editor from overwriting newer work.
5. **Conflict strategy (MVP)** — last-write-wins with auto-refresh. Two people
   editing the same measure at the same instant resolve to whoever saved
   first; the second editor's client then shows the remote revision. Phase 2
   of collaboration (if needed) is Yjs/CRDT for character-level merge or
   per-measure locks.

## Known limitations (MVP)

- Deleting a project locally also deletes the cloud row only when you own it;
  cloud deletion is not broadcast to collaborators in realtime yet.
- Public visibility publishes the score for the community hub, but the hub
  feed itself is still Phase 3.
- Presence shows "N online" in the Share dialog only; it is not yet a full
  multi-cursor editor.

## Google sign-in setup (click-by-click)

### Part A — Google Cloud Console

1. Go to <https://console.cloud.google.com> and sign in.
2. In the top project selector, create a project (e.g. "Drummer's Beat").
3. ☰ menu → **APIs & Services** → **OAuth consent screen**.
4. User type **External** → **Create**. Fill in the app name, support email,
   and developer contact email → **Save and Continue** (skip scopes, then
   **Save and Continue** again).
5. On the consent screen, add the email(s) you want to test with under
   **Test users** (while the app is in "Testing" mode), or click **Publish
   app** for production.
6. ☰ menu → **APIs & Services** → **Credentials** → **+ Create Credentials**
   → **OAuth client ID**.
7. Application type: **Web application**. Name it anything (e.g. "Web").
8. Under **Authorized redirect URIs** → **+ Add URI**, paste exactly the URL
   Supabase showed in its Google provider panel:
   `https://cxwhfejnxjzmejdedojj.supabase.co/auth/v1/callback`
   (no trailing slash, `https`, exact project ref).
9. **Create** → copy the **Client ID** and **Client Secret**.

### Part B — Supabase

1. Project → **Authentication** → **Providers** → **Google** → enable.
2. Paste the Client ID and Client Secret → **Save**.
3. **Authentication** → **URL Configuration**:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: add `http://localhost:3000/**`
   (This lets Supabase send the user back to the app after Google auth.)

### Part C — test

1. Hard-refresh http://localhost:3000/login (no server restart needed).
2. Click **Continue with Google**, pick an account, and you should land on the
   dashboard signed in.

Common failure: `redirect_uri_mismatch` means the URI in Google does not
byte-for-byte match the one Supabase displays (check trailing slash / http).
