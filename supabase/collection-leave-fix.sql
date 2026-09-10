-- Drummer's Beat · let a collaborator leave a shared collection
--
-- Run once in the Supabase SQL editor (Project -> SQL Editor -> New query -> Run).
--
-- Why: "Remove from my list" on a collection shared with you must take effect
-- on the server, otherwise the collection keeps coming back on other devices
-- (and after a refresh on the same device). That means deleting your own row
-- from collection_collaborators -- but the existing policies only allow the
-- *owner* to remove collaborators, so the collaborator's delete silently
-- affected nothing.
--
-- Row Level Security combines permissive policies with OR, so this adds to the
-- existing owner policy instead of replacing it. It only ever lets a user
-- delete their own collaborator row; nobody can touch someone else's.

drop policy if exists collection_collab_leave on public.collection_collaborators;
create policy collection_collab_leave on public.collection_collaborators
  for delete using (user_id = auth.uid());

-- Same idea for scores, so leaving a shared score works the same way.
drop policy if exists score_collab_leave on public.score_collaborators;
create policy score_collab_leave on public.score_collaborators
  for delete using (user_id = auth.uid());
