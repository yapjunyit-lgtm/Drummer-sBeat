-- Drummer's Beat · one-row Realtime diagnosis
-- Run this and paste the single row it returns.
select
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime') as published_tables,

  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'scores')
    as scores_published,

  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'score_collaborators')
    as collab_published,

  (select count(*) from pg_roles where rolname like '%realtime%')
    as realtime_roles,

  (select string_agg(rolname, ', ' order by rolname)
    from pg_roles where rolname like '%realtime%') as role_names,

  (select string_agg(pubname, ', ' order by pubname)
    from pg_publication) as all_publications;
