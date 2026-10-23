-- Execute only as the database owner after verifying the user's identity.
-- First: SET crewtraxa.bootstrap_user_id = 'the-verified-auth-user-uuid';
begin;
do $$
declare admin_id uuid := nullif(current_setting('crewtraxa.bootstrap_user_id',true),'')::uuid;
begin
  if admin_id is null then raise exception 'Set crewtraxa.bootstrap_user_id to a verified auth.users UUID first'; end if;
  if not exists(select 1 from auth.users where id=admin_id and email_confirmed_at is not null) then
    raise exception 'Bootstrap user must have a verified email address';
  end if;
  insert into crewtraxa_private.platform_admins(user_id) values(admin_id) on conflict do nothing;
  insert into public.organization_memberships(organization_id,user_id,role,status)
  values('00000000-0000-4000-8000-000000000001',admin_id,'organization_admin','active')
  on conflict(organization_id,user_id) do update set role='organization_admin',status='active',updated_at=now();
end $$;
commit;
