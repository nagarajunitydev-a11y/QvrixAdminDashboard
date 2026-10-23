-- Follow-up for both new and already migrated Crewtraxa projects.
-- Assign known accounts through the secured RPC; never expose auth.users to clients.
begin;

grant usage on schema public to authenticated;

create or replace function public.manage_organization_member(org uuid, member uuid, member_role text, member_status text)
returns void language plpgsql security definer set search_path='' as $$ begin
  -- Serialize membership changes with organization lifecycle changes.
  perform 1 from public.organizations where id=org for update;
  if not public.is_organization_admin(org) then
    raise exception 'Organization administrator required' using errcode='42501';
  end if;
  if member is null or member_role is null or member_role not in ('organization_admin','manager','supervisor','employee')
    or member_status is null or member_status not in ('active','suspended') then
    raise exception 'A user UUID, valid organization role, and membership status are required' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users where id=member) then
    raise exception 'Account not available. Invite the user to create and verify an account first' using errcode='22023';
  end if;
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=member)
    and not exists(select 1 from auth.users where id=member and email_confirmed_at is not null) then
    raise exception 'Verify the account email before assigning a new organization membership' using errcode='22023';
  end if;
  if exists(select 1 from public.organization_memberships where organization_id=org and user_id=member and role='organization_admin' and status='active')
    and (member_role<>'organization_admin' or member_status<>'active')
    and (select count(*) from public.organization_memberships where organization_id=org and role='organization_admin' and status='active')<=1 then
    raise exception 'Keep at least one active organization administrator' using errcode='22023';
  end if;
  insert into public.organization_memberships(organization_id,user_id,role,status) values(org,member,member_role,member_status)
  on conflict(organization_id,user_id) do update set role=excluded.role,status=excluded.status,updated_at=now();
end $$;

revoke all on function public.manage_organization_member(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.manage_organization_member(uuid,uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
