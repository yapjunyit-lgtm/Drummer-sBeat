-- Drummer's Beat · Realtime diagnostics + fix
-- Run this once in the Supabase SQL editor, then paste the result back.
-- It will NOT error if some role is missing — every step is guarded.

-- 1. Diagnostics: publication membership, realtime-ish roles, table grants.
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

select rolname
from pg_roles
where rolname in (
  'anon', 'authenticated', 'service_role',
  'supabase_realtime', 'supabase_realtime_admin', 'realtime'
)
order by rolname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('scores', 'score_collaborators')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee;

-- 2. Make sure both tables are published (idempotent).
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

-- 3. Grant the client roles SELECT on both tables.
grant select on table public.scores to anon, authenticated;
grant select on table public.score_collaborators to anon, authenticated;

-- 4. Grant the Realtime role(s) only if they exist on this project.
--    (Newer projects use supabase_realtime_admin; older use supabase_realtime.)
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
