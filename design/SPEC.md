# Drummer's Beat · Redesign Spec v1 — "The Stage"

Scope: **visual-only overhaul**. Functionality, routes, copy, form fields, and
interaction behavior are unchanged. This document maps every original UI
element to its redesigned treatment. Tokens are canonical in `tokens.css`.

---

## 1. Concept

The score is written on a stage, not a screen. The **score sheet is the
spotlighted performer**; all chrome is quiet, dark stage machinery around it.

- Warm "stage ink" neutrals replace cool zinc (drum-skin warmth).
- One accent: **stage gold** (`#F2A93B`) — CTAs, selection, playhead only.
- **Geist Mono becomes the signature** for every number (BPM, measures, counts,
  slots, shortcuts) — instrument-panel character.
- Status colors stay semantic and gain icons/dots so color is never the only
  signal: emerald = live/saved/ok, cyan = shared/collaborator, red = danger,
  gold = warn.

## 2. Token summary (see `tokens.css` for the full sheet)

| Layer | Decision |
|---|---|
| Background | `#0E0C0A` warm near-black (was zinc-950 `#09090b`, cool) |
| Surfaces | 3 steps: `#161310` cards · `#1E1A15` wells/toolbars · `#29231B` inputs |
| Borders | one hairline token `rgba(255,255,255,.07)`, strong variant `.14` |
| Text | `#FAF7F2` primary · `#A8A098` secondary (7:1) · `#857C70` tertiary (4.5:1) |
| Accent | gold `#F2A93B`, text on gold `#1A130A` (11:1) |
| Score sheet | warm paper `#FFFDF8` + ink `#17140F`, 20px radius, tinted deep shadow |
| Radius lock | controls 10 · cards 16 · panels 20 · pills full |
| Type | Geist Sans UI; Geist Mono data; scale 11–60px; labels 11px/0.12em only per section group |
| Motion | 150–320ms, `cubic-bezier(.16,1,.3,1)`; press scale, hover lift, modal fade+rise, live dot pulse, playhead sweep; all killed under `prefers-reduced-motion` |

## 3. Component mapping (original → redesign)

### Global

| Original (Tailwind) | Redesign | Notes |
|---|---|---|
| `bg-zinc-950 text-zinc-100` body | `bg:#0E0C0A` / `text:#FAF7F2` | warm ink |
| `rounded-lg/xl/2xl` mixed | radius tokens 10/16/20/full | shape consistency lock |
| `border-zinc-700/800` | `--hair` / `--hair-strong` | single border token |
| Unicode/emoji glyphs (`● ▲ ✕ ▷ ♪ 🔗 ☁ ✦ ＋ 👁 ✏️ ☆ ▤`) | inline SVG icon set (stroke 1.75, one family) | ✕→`x` for close, dedicated `eraser` for clear |
| `text-zinc-500/600` meta | `--tx2` / `--tx3` | raised to WCAG AA |
| `:focus-visible` amber outline | gold 2px + offset (kept) | unchanged behavior |
| `::selection` amber | gold 30% (kept) | unchanged |
| `button:active scale(.98)` | kept | unchanged |
| uppercase `tracking-wider` on every header | `section-label` 11px/0.12em, **max one per section group** | kills eyebrow noise |

### Landing (`page.tsx`)

| Original | Redesign |
|---|---|
| text-only wordmark | brand mark: drum ring + center strike (SVG, gold) |
| `● ✕ ▷` zone row (ambiguous glyphs) | three SVG zone marks (center dot / rim hit / stick) |
| 4 identical `border-t` text rows | asymmetric 2×2 feature grid, gold icon per cell, hover lift |
| no visual anchor | sticky "score sheet" card (mini stave, gold measure highlight) |
| `bg-amber-500` CTA | gold `btn-gold` with tinted shadow, `#1A130A` text (was zinc-950) |
| centered layout | kept centered (hero is a manifesto); features go asymmetric |

### Dashboard (`dashboard/page.tsx`)

| Original | Redesign |
|---|---|
| 5–6 header buttons in one row | grouped: status chip first, then ghost actions, one gold primary, avatar; wraps on mobile |
| `● Live 实时` text chip | dot + label chip, emerald, pulsing dot |
| `☁ Sync` / `✦ Combine` text buttons | icon + label ghost buttons |
| `＋ New Project` gold | gold with plus icon |
| count `· 2` plain text | mono `count-chip` pill |
| uniform `zinc-900/60` cards | surface-1 cards, gold hairline hover, 1px lift, "Open →" reveal on hover |
| 3 identical dashed empty states | one composed empty state (drum + beat dashes SVG), title + guidance |
| rhythm groups rows | icon + name/sub (mono stats), gold play icon-button, ghost Open, disabled Favourite with star icon |

### Login (`login/page.tsx`)

| Original | Redesign |
|---|---|
| card `zinc-900/70` | surface-1 panel, 20px radius, modal shadow |
| flat inputs blending into card | `surface-3` fill + hairline border + gold focus border |
| text-only Google button | standard G mark + label |
| no brand | gold drum mark above title, drum-glow behind card |
| divider `or 或者` | kept, hairline + muted label |

### Editor (`StaveEditor.tsx`)

| Original | Redesign |
|---|---|
| 4 same-color chrome rows (page header, transport, tool rows) + sidebar | slim page bar (hairline) → transport dock (surface-1) → tool rail (surface-2); three distinct levels |
| `▶ Play 播放` gold | kept as gold primary; label/icon swap to Stop while playing |
| BPM slider | gold-filled range with mono value; fill tracks the thumb |
| status pills all identical (`Saved/Live/Error`) | distinct chips: emerald check "Saved", pulsing dot "Live", red error; icon+dot+label |
| tiny `text-[11px]` buttons | tool buttons: icon + zh label, gold fill when active |
| duplicate "Select" in MODE + TOOLS | renamed segments "View 视图 / Select 选择" (mode) vs sidebar "Select 选择" (tool); visual hierarchy separates them |
| `Untitled Proje..` raw truncation | ellipsis with `min-width:0`, project name in top bar + mono metadata |
| white score canvas | warm paper sheet, 20px radius, deep tinted shadow, gold current-measure highlight, mono measure numbers, gold playhead sweep |
| floating measure pill | sticky pill, mono `1 / 8`, chevron icon buttons, zoom readout |
| sidebar sections | consistent 11px group labels, segmented Project/Yours, kbd chips for shortcuts |
| `Clear 清空` with ✕ | `x` icon retained but danger-tinted, label present |

### Modals (`ShareModal`, `CombineModal`, `GroupEditorModal`, `ScoreNoteModal`)

| Original | Redesign |
|---|---|
| `bg-zinc-950/75` scrim | `rgb(10 8 6/.72)` + backdrop blur |
| card + instant appearance | 20px panel, entrance fade + 10px rise (220ms), Escape/backdrop close |
| access `Private/Public` buttons | segmented control with lock/globe icons |
| role `✏️/👁` emoji options | plain-text options (native select cannot host SVG); role shown via chip |
| people rows | avatar (gold owner / cyan collaborator) + name + email (mono) + role select + remove |
| presence footer | dot + "N online now 正在编辑 · N 人" |

## 4. Accessibility notes

- All body/meta text ≥ 4.5:1 in both dark chrome and white sheet (verified in
  token values; `--tx2` on `--bg` ≈ 7:1, gold/`--on-acc` ≈ 11:1).
- Focus visible = gold 2px + 2px offset on every interactive element.
- Status is never color-only: every chip carries an icon or dot and a label.
- Touch targets ≥ 32px (icon buttons) and ≥ 40px (buttons); `touch-action: manipulation`.
- `prefers-reduced-motion` disables all transitions/animations (inherited from
  the app's global CSS, reproduced in the mockup).

## 5. Delivered files

| File | Purpose |
|---|---|
| `tokens.css` | canonical token sheet (primitive → semantic → component) |
| `redesign-mockup.html` | self-contained visual preview: landing, dashboard, login, editor, share modal, empty state; hash-switchable screens (`#landing` `#dashboard` `#login` `#editor` `#share`), working hover/focus/play/segmented states |
| `SPEC.md` | this mapping document |

## 6. Porting to the app (future, only if requested)

1. Copy `tokens.css` values into `globals.css` `:root` and `@theme inline`.
2. Add an icon component (inline SVG) and sweep unicode glyphs.
3. Replace component class strings per the mapping table; structure untouched.
