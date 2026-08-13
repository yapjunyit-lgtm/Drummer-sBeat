# Drummer's Beat · 节拍鼓韵

Web application for 24 Festive Drums (二十四节令鼓) players and composers to
create, edit, share, and discover drum scores.

## Status

- ✅ MVP editor: 3-zone grid (鼓心 / 鼓边 / 鼓棒), per-beat subdivisions
  (quarter → sextuplet), Tone.js playback with synced playhead, local
  autosave, publish UI (stub API).
- ✅ Stave editor (MuseScore-style): VexFlow percussion staff with custom
  noteheads (● 鼓心 / ▲ 鼓边 / ✕ 鼓棒), drag-and-drop palette
  (@dnd-kit), duration palette, eraser, keyboard shortcuts (1/3/X/E/4/8),
  Tone.js playback with a moving playhead, local autosave.
- ✅ Project-based workflow: create / switch / rename / delete projects, each
  with its own score, BPM, measure count and settings (localStorage-backed).
- ✅ Rhythm groups: capture any measure as a reusable rhythm group, then
  insert it (click or drag) into any measure.
- ✅ Collaboration: Supabase-backed accounts (email/Google), cloud save,
  share links, invite-by-email, editor/viewer roles, realtime sync with
  revision-based conflict handling. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- ⏳ Phase 2: cloud save + accounts (Supabase).
- ⏳ Phase 3: community hub, likes, comments, bookmarks, forks.
- ⏳ Phase 4: SVG notation strip, PDF/PNG export, zh/en i18n.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000 — the stave editor lives at `/editor` and the
grid editor at `/grid`.

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript
- Tailwind CSS v4
- Tone.js (Web Audio playback)
- VexFlow 5 (stave rendering) + @dnd-kit (drag & drop)
- Supabase (auth, Postgres + RLS, realtime, storage)

## Cloud setup

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full guide. Short
version: create a Supabase project, run `supabase/schema.sql` then
`supabase/collaboration.sql` in the SQL editor, add the three env vars to
`.env.local`, and the app switches from local-only mode to full cloud
collaboration.
