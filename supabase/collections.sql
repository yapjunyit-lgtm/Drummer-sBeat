-- Drummer's Beat · Collections cloud layer
-- Run in the Supabase SQL editor (after schema.sql + collaboration.sql).
-- Adds collections (big projects), collection collaborators/invites, RLS,
-- a save_collection RPC, and Realtime — mirroring the scores sharing model.

create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  description text,
  data        jsonb not null default '{}'::jsonb, -- { pieceIds, notes }
  revision    bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.collection_collaborators (
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (collection_id, user_id)
);

create table if not exists public.collection_invites (
  id         uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists collections_owner on public.collections (owner_id, updated_at desc);
create index if not exists collab_collection on public.collection_collaborators (collection_id);
create index if not exists collab_collection_user on public.collection_collaborators (user_id);
create index if not exists collection_invites_token on public.collection_invites (token);

alter table public.collections replica identity full;

-- SECURITY DEFINER helpers (same pattern as scores: avoid RLS recursion).
create or replace function public.collection_visible_to(v_collection_id uuid, v_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.collections c
    where c.id = v_collection_id and c.owner_id = v_user
  ) or exists (
    select 1 from public.collection_collaborators cc
    where cc.collection_id = v_collection_id and cc.user_id = v_user
  );
$$;

create or replace function public.collection_owned_by(v_collection_id uuid, v_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.collections c
    where c.id = v_collection_id and c.owner_id = v_user
  );
$$;

revoke all on function public.collection_visible_to(uuid, uuid) from public;
revoke all on function public.collection_owned_by(uuid, uuid) from public;
grant execute on function public.collection_visible_to(uuid, uuid) to anon, authenticated;
grant execute on function public.collection_owned_by(uuid, uuid) to anon, authenticated;

alter table public.collections enable row level security;
alter table public.collection_collaborators enable row level security;
alter table public.collection_invites enable row level security;

drop policy if exists collections_read on public.collections;
create policy collections_read on public.collections
  for select using (public.collection_visible_to(id, auth.uid()));

drop policy if exists collections_insert on public.collections;
create policy collections_insert on public.collections
  for insert with check (auth.uid() = owner_id);

drop policy if exists collections_update on public.collections;
create policy collections_update on public.collections
  for update using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.collection_collaborators cc
      where cc.collection_id = id and cc.user_id = auth.uid() and cc.role = 'editor'
    )
  );

drop policy if exists collections_delete on public.collections;
create policy collections_delete on public.collections
  for delete using (auth.uid() = owner_id);

drop policy if exists collection_collab_read on public.collection_collaborators;
create policy collection_collab_read on public.collection_collaborators
  for select using (
    user_id = auth.uid()
    or public.collection_owned_by(collection_id, auth.uid())
  );

drop policy if exists collection_collab_insert on public.collection_collaborators;
create policy collection_collab_insert on public.collection_collaborators
  for insert with check (public.collection_owned_by(collection_id, auth.uid()));

drop policy if exists collection_collab_delete on public.collection_collaborators;
create policy collection_collab_delete on public.collection_collaborators
  for delete using (public.collection_owned_by(collection_id, auth.uid()));

drop policy if exists collection_invites_owner on public.collection_invites;
create policy collection_invites_owner on public.collection_invites
  for all using (public.collection_owned_by(collection_id, auth.uid()))
  with check (public.collection_owned_by(collection_id, auth.uid()));

-- Realtime + grants (idempotent).
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'collections') then
    alter publication supabase_realtime add table public.collections;
  end if;
end $$;

grant select on table public.collections to supabase_realtime_admin;
grant select on table public.collections to anon, authenticated;
grant select on table public.collection_collaborators to supabase_realtime_admin;
grant select on table public.collection_collaborators to anon, authenticated;

-- save_collection RPC: atomic insert-or-update with revision bump.
create or replace function public.save_collection(
  p_id uuid,
  p_name text,
  p_description text,
  p_data jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.collections;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  insert into public.collections (id, owner_id, name, description, data, revision)
  values (p_id, v_user, p_name, p_description, p_data, 1)
  on conflict (id) do update
    set name = excluded.name,
        description = excluded.description,
        data = excluded.data,
        updated_at = now(),
        revision = public.collections.revision + 1
    where public.collections.owner_id = v_user
       or exists (
         select 1 from public.collection_collaborators cc
         where cc.collection_id = public.collections.id
           and cc.user_id = v_user and cc.role = 'editor'
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

revoke all on function public.save_collection(uuid, text, text, jsonb) from public;
grant execute on function public.save_collection(uuid, text, text, jsonb) to authenticated;
