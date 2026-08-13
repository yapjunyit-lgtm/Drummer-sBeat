-- Drummer's Beat · 节拍鼓韵
-- Supabase schema (Phase 2+). The editor already persists drafts locally;
-- this schema is the cloud layer for accounts, scores, and the community hub.
--
-- Design note: `scores.data` (jsonb) is the source of truth for rendering and
-- playback. `score_elements` is a normalized projection used for search,
-- filtering, and analytics (e.g. "scores with 鼓棒 accents").

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name text,
  bio         text,
  troupe      text, -- 鼓队/学校 affiliation
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table scores (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references profiles(id) on delete cascade,
  title          text not null,
  description    text,
  difficulty     smallint not null default 1 check (difficulty between 1 and 5),
  bpm            int not null default 120 check (bpm between 20 and 300),
  time_signature text not null default '4/4',
  data           jsonb not null default '{}'::jsonb, -- score document
  visibility     text not null default 'private'
                 check (visibility in ('private', 'public')),
  parent_score_id uuid references scores(id) on delete set null, -- fork lineage
  is_fork        boolean not null default false,
  like_count     int not null default 0,
  comment_count  int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Normalized projection of the score document (kept in sync by the app).
create table score_elements (
  id             uuid primary key default gen_random_uuid(),
  score_id       uuid not null references scores(id) on delete cascade,
  measure        int not null default 1,
  position       int not null, -- grid slot within the measure
  zone           text check (zone in ('center', 'edge', 'rim')),
  notehead       text check (notehead in ('normal', 'triangle', 'cross')),
  duration       text not null check (duration in ('w', 'h', 'q', '8', '16')),
  tuplet         int check (tuplet in (2, 3, 4) or tuplet is null),
  articulation   text check (articulation in ('accent', 'sticking_l', 'sticking_r', 'fermata') or articulation is null),
  velocity       numeric default 1 check (velocity between 0 and 1),
  created_at     timestamptz not null default now()
);

create table score_likes (
  user_id    uuid not null references profiles(id) on delete cascade,
  score_id   uuid not null references scores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, score_id)
);

create table score_bookmarks (
  user_id    uuid not null references profiles(id) on delete cascade,
  score_id   uuid not null references scores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, score_id)
);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  score_id   uuid not null references scores(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  parent_id  uuid references comments(id) on delete cascade, -- threaded replies
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scores_public_recent on scores (created_at desc) where visibility = 'public';
create index scores_owner        on scores (owner_id, updated_at desc);
create index elements_score      on score_elements (score_id, measure, position);
create index comments_score      on comments (score_id, created_at);

-- Row Level Security ----------------------------------------------------

alter table profiles enable row level security;
alter table scores enable row level security;
alter table score_elements enable row level security;
alter table score_likes enable row level security;
alter table score_bookmarks enable row level security;
alter table comments enable row level security;

-- Profiles: public to read, owner writes
create policy profiles_read  on profiles for select using (true);
create policy profiles_insert on profiles for insert with check (auth.uid() = id);
create policy profiles_update on profiles for update using (auth.uid() = id);

-- Scores: public scores are world-readable; private only for owner; owner writes
create policy scores_read   on scores for select
  using (visibility = 'public' or auth.uid() = owner_id);
create policy scores_insert on scores for insert with check (auth.uid() = owner_id);
create policy scores_update on scores for update using (auth.uid() = owner_id);
create policy scores_delete on scores for delete using (auth.uid() = owner_id);

-- Elements mirror the visibility of their parent score
create policy elements_read on score_elements for select
  using (exists (
    select 1 from scores s
    where s.id = score_id and (s.visibility = 'public' or s.owner_id = auth.uid())
  ));
create policy elements_write on score_elements for insert
  with check (exists (
    select 1 from scores s where s.id = score_id and s.owner_id = auth.uid()
  ));

-- Likes/bookmarks/comments: readable when the score is visible to you,
-- writable only by you. Same shape for score_bookmarks.
create policy likes_read on score_likes for select
  using (exists (
    select 1 from scores s
    where s.id = score_id and (s.visibility = 'public' or s.owner_id = auth.uid())
  ));
create policy likes_insert on score_likes for insert with check (auth.uid() = user_id);
create policy likes_delete on score_likes for delete using (auth.uid() = user_id);

create policy bookmarks_read on score_bookmarks for select
  using (exists (
    select 1 from scores s
    where s.id = score_id and (s.visibility = 'public' or s.owner_id = auth.uid())
  ));
create policy bookmarks_insert on score_bookmarks for insert with check (auth.uid() = user_id);
create policy bookmarks_delete on score_bookmarks for delete using (auth.uid() = user_id);

create policy comments_read on comments for select
  using (exists (
    select 1 from scores s
    where s.id = score_id and (s.visibility = 'public' or s.owner_id = auth.uid())
  ));
create policy comments_insert on comments for insert with check (auth.uid() = user_id);
create policy comments_delete on comments for delete using (auth.uid() = user_id);
create policy comments_update on comments for update using (auth.uid() = user_id);
