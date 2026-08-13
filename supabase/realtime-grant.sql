-- Drummer's Beat · the missing grant
-- This project's Realtime role is supabase_realtime_admin (not the older
-- supabase_realtime). Tables created via raw SQL never got SELECT granted
-- to it, so postgres_changes silently delivers nothing. This fixes that.

grant select on table public.scores to supabase_realtime_admin;
grant select on table public.score_collaborators to supabase_realtime_admin;

-- Verify: should show both tables with supabase_realtime_admin.
select table_name, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('scores', 'score_collaborators')
  and grantee like 'supabase_realtime%'
  and privilege_type = 'SELECT'
order by table_name;
