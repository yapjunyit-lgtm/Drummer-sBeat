# Collections (Big Projects) — Design Spec

## Goal

A new "big project" layer on top of the existing score projects. A collection
groups several existing scores ("pieces") and carries a main notes document
(text, images, comments) that opens directly inside the project.

## Decisions (approved with the user)

- **Pieces reference existing scores.** A collection stores `pieceIds`
  pointing at existing `Project` ids. No duplication; edits, PDF export,
  sharing, and combine flows keep working unchanged.
- **Lightweight block notes.** No rich-text library. The document is a list
  of typed blocks; text supports `**bold**`; comments are standalone blocks.
  Images are stored inline (data URLs) for v1 and move to Supabase Storage
  later.

## Data model

Stored under `drummers-beat:collections:v1` (localStorage, like projects).

```ts
type CollectionBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "list"; items: string[] }
  | { id: string; type: "image"; src: string; caption?: string }
  | { id: string; type: "comment"; text: string; createdAt: number };

interface ScoreCollection {
  id: string;
  name: string;
  description: string;
  pieceIds: string[];                 // ordered references to Project ids
  notes: { blocks: CollectionBlock[] };
  createdAt: number;
  updatedAt: number;
}
```

## Screens

### Dashboard

- New **Collections 项目集** section (beside My Projects).
- Create / rename / delete collections; cards show piece count + updated date.

### `/collections/[id]`

- Header: name + description (editable).
- **Pieces 曲目** panel: resolved pieces in order; add via a picker of My
  Projects, remove, reorder with ↑↓, open a piece in the existing editor.
- **Notes 笔记** panel: block editor — add heading / text / list / image /
  comment; edit and delete blocks; move up/down; insert pictures (file →
  data URL).
- Debounced autosave to localStorage.

## Out of scope (v1)

- Threaded comment replies, drag-and-drop reorder, tables/alignment,
  image editing, public collection sharing, Supabase sync for collections.

## Cloud path (later)

`collections`, `collection_items`, notes as jsonb — same RLS / collaborator
pattern already used for scores; images move to Supabase Storage.
