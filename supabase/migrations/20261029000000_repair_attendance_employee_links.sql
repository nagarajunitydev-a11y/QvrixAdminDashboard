-- Attendance user_id references auth.users.id, not employees.id or a device ID.
-- Some verified mobile accounts have attendance but no employee-role metadata,
-- so the auth linker intentionally did not populate their existing profiles.
-- Repair only unambiguous, verified identities with recorded attendance. Do not
-- infer names, create profiles, overwrite links, or change auth roles/triggers.
with verified_matches as (
  select e.id as employee_id, u.id as auth_user_id
  from public.employees e
  join auth.users u on u.email = e.email
  where e.user_id is null
    and u.email_confirmed_at is not null
    and exists (select 1 from public.presence_sessions ps where ps.user_id = u.id)
    and not exists (select 1 from public.employees linked where linked.user_id = u.id)
    and (select count(*) from public.employees candidate
         where lower(btrim(candidate.email)) = lower(btrim(e.email))) = 1
    and (select count(*) from auth.users candidate
         where lower(btrim(candidate.email)) = lower(btrim(u.email))) = 1
)
update public.employees e
set user_id = verified_matches.auth_user_id,
    updated_at = now()
from verified_matches
where e.id = verified_matches.employee_id
  and e.user_id is null;
