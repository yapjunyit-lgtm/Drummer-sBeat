-- Drummer's Beat · 节拍鼓韵
-- Collaboration layer (Phase 2): shared edit access.
--
-- Run this AFTER supabase/schema.sql in the Supabase SQL editor. It adds:
--   * profiles.email            – email lookups for inviting people
--   * scores.revision           – optimistic-concurrency counter
--   * score_collaborators       – who can edit/view a private score
--   * score_invites             – share links (token-based invitations)
--   * save_score() RPC          – atomic insert-or-update with revision bump
--   * Realtime publication      – live sync + presence for open scores

-- 1. Profiles: expose email for invite-by-email lookups ---------------------
alter table public.profiles add column if not exists email text;
create index if not exists profiles_email on public.profiles (email);

-- 2. Scores: revision counter for conflict detection ------------------------
alter table public.scores add column if not exists revision bigint not null default 0;

-- Realtime needs the full row (incl. the jsonb `data`) on UPDATE.
alter table public.scores replica identity full;

-- 3. Collaborators -----------------------------------------------------------
create table if not exists public.score_collaborators (
  score_id   uuid not null references public.scores(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (score_id, user_id)
);
create index if not exists collab_user on public.score_collaborators (user_id);

-- 4. Share-link invitations --------------------------------------------------
create table if not exists public.score_invites (
  id         uuid primary key default gen_random_uuid(),
  score_id   uuid not null references public.scores(id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists invites_token on public.score_invites (token);

-- 5. Row Level Security ------------------------------------------------------
alter table public.score_collaborators enable row level security;
alter table public.score_invites enable row level security;

-- SECURITY DEFINER helpers: cross-table checks from policies must run
-- without RLS, otherwise scores_read ⇄ collab_read recurse forever.
create or replace function public.score_visible_to(v_score_id uuid, v_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.scores s
    where s.id = v_score_id
      and (s.visibility = 'public' or s.owner_id = v_user)
  ) or exists (
    select 1 from public.score_collaborators c
    where c.score_id = v_score_id and c.user_id = v_user
  );
$$;

create or replace function public.score_owned_by(v_score_id uuid, v_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.scores s
    where s.id = v_score_id and s.owner_id = v_user
  );
$$;

revoke all on function public.score_visible_to(uuid, uuid) from public;
revoke all on function public.score_owned_by(uuid, uuid) from public;
grant execute on function public.score_visible_to(uuid, uuid) to anon, authenticated;
grant execute on function public.score_owned_by(uuid, uuid) to anon, authenticated;

drop policy if exists collab_read on public.score_collaborators;
create policy collab_read on public.score_collaborators
  for select using (
    user_id = auth.uid()
    or exists (
      select public.score_owned_by(score_id, auth.uid())
    )
  );

drop policy if exists collab_insert on public.score_collaborators;
create policy collab_insert on public.score_collaborators
  for insert with check (
    exists (
      select 1 from public.scores s
      where s.id = score_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists collab_delete on public.score_collaborators;
create policy collab_delete on public.score_collaborators
  for delete using (
    exists (
      select 1 from public.scores s
      where s.id = score_id and s.owner_id = auth.uid()
    )
  );

-- Invites are only visible/editable by the score owner.
drop policy if exists invites_owner on public.score_invites;
create policy invites_owner on public.score_invites
  for all using (
    exists (
      select 1 from public.scores s
      where s.id = score_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.scores s
      where s.id = score_id and s.owner_id = auth.uid()
    )
  );

-- Scores: readers may include collaborators; editors may update.
drop policy if exists scores_read on public.scores;
create policy scores_read on public.scores
  for select using (public.score_visible_to(id, auth.uid()));

drop policy if exists scores_update on public.scores;
create policy scores_update on public.scores
  for update using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.score_collaborators c
      where c.score_id = id
        and c.user_id = auth.uid()
        and c.role = 'editor'
    )
  );

-- score_elements mirror the parent score (readers include collaborators).
drop policy if exists elements_read on public.score_elements;
create policy elements_read on public.score_elements
  for select using (
    exists (
      select 1 from public.scores s
      where s.id = score_id
        and (s.visibility = 'public' or s.owner_id = auth.uid()
             or exists (
               select 1 from public.score_collaborators c
               where c.score_id = s.id and c.user_id = auth.uid()
             ))
    )
  );

-- 6. Realtime ----------------------------------------------------------------
-- pg_publication_tables makes this idempotent, so the file can be re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'scores'
  ) then
    alter publication supabase_realtime add table public.scores;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'score_collaborators'
  ) then
    alter publication supabase_realtime add table public.score_collaborators;
  end if;
end $$;

-- Tables created via raw SQL are missing the grants the Realtime engine
-- needs to read row changes (the dashboard's Realtime toggle adds these
-- automatically; the SQL editor does not).
-- Newer projects name the role supabase_realtime_admin; older use
-- supabase_realtime. Grant to whichever exists.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    grant select on table public.scores to supabase_realtime_admin;
    grant select on table public.score_collaborators to supabase_realtime_admin;
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_realtime') then
    grant select on table public.scores to supabase_realtime;
    grant select on table public.score_collaborators to supabase_realtime;
  end if;
end $$;
grant select on table public.scores to anon, authenticated;
grant select on table public.score_collaborators to anon, authenticated;

-- 7. save_score() RPC: atomic save with access control and revision bump -----
-- The client calls this instead of raw inserts/updates so that:
--   * first save creates the row owned by the caller,
--   * later saves only work for the owner or an editor collaborator,
--   * revision increments atomically (optimistic concurrency).
create or replace function public.save_score(
  p_id           uuid,
  p_title        text,
  p_description  text,
  p_bpm          int,
  p_time_signature text,
  p_data         jsonb,
  p_visibility   text default 'private'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.scores;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- One statement handles both first save (insert) and later saves (update).
  -- ON CONFLICT makes concurrent saves race-safe: the loser just bumps the
  -- revision again instead of failing on a duplicate key. The WHERE clause on
  -- the update path enforces owner-or-editor access; when it excludes the row,
  -- RETURNING yields nothing and we raise below.
  insert into public.scores
    (id, owner_id, title, description, bpm, time_signature, data, visibility, revision)
  values
    (p_id, v_user, p_title, p_description, p_bpm, p_time_signature, p_data, p_visibility, 1)
  on conflict (id) do update
    set title = excluded.title,
        description = excluded.description,
        bpm = excluded.bpm,
        time_signature = excluded.time_signature,
        data = excluded.data,
        visibility = excluded.visibility,
        updated_at = now(),
        revision = public.scores.revision + 1
    where public.scores.owner_id = v_user
       or exists (
         select 1 from public.score_collaborators c
         where c.score_id = public.scores.id
           and c.user_id = v_user
           and c.role = 'editor'
       )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no edit access';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'revision', v_row.revision,
    'owner_id', v_row.owner_id,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.save_score(uuid, text, text, int, text, jsonb, text) from public;
grant execute on function public.save_score(uuid, text, text, int, text, jsonb, text) to authenticated;
