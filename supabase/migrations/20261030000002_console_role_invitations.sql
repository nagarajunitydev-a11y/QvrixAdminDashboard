-- Console roles by invitation.
--
-- Replaces set_organization_member, which attached any confirmed account to the calling
-- organization without its holder's consent. Its error also revealed whether an email had an
-- account, and list_organization_members then showed that account's last sign-in time.
--
-- Now an organization admin stores an invitation keyed by email. The response is the same
-- whether or not the email has an account, because auth.users is never consulted. Membership
-- starts only when the signed-in holder of that confirmed email accepts. Existing members are
-- unchanged.

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  email text not null check (
    email = lower(btrim(email)) and char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  role text not null check (role in ('org_admin', 'manager', 'supervisor')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  check (accepted_at is null or revoked_at is null)
);
-- One open invitation per person and organization; re-inviting refreshes it.
create unique index organization_invitations_one_open on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index organization_invitations_email_idx on public.organization_invitations (email)
  where accepted_at is null and revoked_at is null;

create trigger audit_organization_invitations_trigger after insert or update or delete on public.organization_invitations
  for each row execute function public.audit_trigger_func();

alter table public.organization_invitations enable row level security;
create policy organization_invitations_select on public.organization_invitations for select to authenticated
  using (organization_id in (select public.manageable_org_ids()));
revoke all on public.organization_invitations from anon, authenticated;
grant select on public.organization_invitations to authenticated;

-- Organization admins invite. Only this organization's own members are checked, which its
-- admins can already list; whether the email has a platform account is never revealed.
create function public.invite_organization_member(p_organization_id uuid, p_email text, p_role text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not exists (select 1 from public.admin_org_ids() as id where id = p_organization_id) then
    raise exception 'Organization admin access is required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('org_admin', 'manager', 'supervisor') then
    raise exception 'Role must be org_admin, manager or supervisor' using errcode = '22023';
  end if;
  if v_email is null or char_length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id and m.is_active and lower(u.email) = v_email
  ) then
    raise exception 'This person is already a member. Change their role in the member list.' using errcode = '23505';
  end if;

  update public.organization_invitations
  set role = p_role, invited_by = auth.uid(), created_at = now(), expires_at = now() + interval '14 days'
  where organization_id = p_organization_id and email = v_email and accepted_at is null and revoked_at is null
  returning id into v_id;
  if v_id is null then
    insert into public.organization_invitations (organization_id, email, role, invited_by)
    values (p_organization_id, v_email, p_role, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.list_organization_invitations(p_organization_id uuid)
returns table (id uuid, email text, role text, invited_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.manageable_org_ids() as id where id = p_organization_id) then
    raise exception 'Manager access to this organization is required' using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.role, i.created_at, i.expires_at
    from public.organization_invitations i
    where i.organization_id = p_organization_id and i.accepted_at is null and i.revoked_at is null
    order by i.created_at desc;
end;
$$;

create function public.revoke_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.organization_invitations
  where id = p_invitation_id and accepted_at is null and revoked_at is null
  for update;
  if v_org is null or not exists (select 1 from public.admin_org_ids() as id where id = v_org) then
    raise exception 'Organization admin access to an open invitation is required' using errcode = '42501';
  end if;
  update public.organization_invitations set revoked_at = now(), revoked_by = auth.uid() where id = p_invitation_id;
end;
$$;

-- Open invitations for the signed-in account's confirmed email.
create function public.my_console_invitations()
returns table (id uuid, organization_id uuid, organization_name text, role text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
    select i.id, o.id, o.name, i.role, i.expires_at
    from auth.users u
    join public.organization_invitations i
      on i.email = lower(u.email) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    join public.organizations o on o.id = i.organization_id and o.is_active
    where u.id = auth.uid() and u.email_confirmed_at is not null
    order by o.name;
end;
$$;

-- The invited person accepts or declines. This is the consent an organization cannot give itself.
create function public.respond_to_console_invitation(p_invitation_id uuid, p_accept boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.organization_invitations;
  v_uid uuid := auth.uid();
begin
  select i.* into v_invitation
  from public.organization_invitations i
  join auth.users u on u.id = v_uid and u.email_confirmed_at is not null and i.email = lower(u.email)
  join public.organizations o on o.id = i.organization_id and o.is_active
  where i.id = p_invitation_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  for update of i;
  if not found then
    raise exception 'This invitation is not available to this account' using errcode = '42501';
  end if;

  if not p_accept then
    update public.organization_invitations set revoked_at = now(), revoked_by = v_uid where id = p_invitation_id;
    return v_invitation.organization_id;
  end if;

  -- Accepting a lower role must not leave the organization without an active admin.
  if v_invitation.role <> 'org_admin' and exists (
    select 1 from public.organization_members m
    where m.organization_id = v_invitation.organization_id and m.user_id = v_uid and m.role = 'org_admin' and m.is_active
  ) and not exists (
    select 1 from public.organization_members m
    where m.organization_id = v_invitation.organization_id and m.user_id <> v_uid and m.role = 'org_admin' and m.is_active
  ) then
    raise exception 'An organization must keep at least one active admin' using errcode = '22023';
  end if;

  insert into public.organization_members (organization_id, user_id, role, created_by)
  values (v_invitation.organization_id, v_uid, v_invitation.role, v_invitation.invited_by)
  on conflict (organization_id, user_id) do update set role = excluded.role, is_active = true;
  update public.organization_invitations set accepted_at = now(), accepted_by = v_uid where id = p_invitation_id;
  return v_invitation.organization_id;
end;
$$;

-- Role changes apply only to people who are already members, so they cannot probe accounts.
create function public.set_organization_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  if not exists (select 1 from public.admin_org_ids() as id where id = p_organization_id) then
    raise exception 'Organization admin access is required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('org_admin', 'manager', 'supervisor') then
    raise exception 'Role must be org_admin, manager or supervisor' using errcode = '22023';
  end if;
  select role into v_current from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id and is_active
  for update;
  if v_current is null then
    raise exception 'This person is not an active member of the organization' using errcode = 'P0002';
  end if;
  if v_current = 'org_admin' and p_role <> 'org_admin' and not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id <> p_user_id and m.role = 'org_admin' and m.is_active
  ) then
    raise exception 'An organization must keep at least one active admin' using errcode = '22023';
  end if;
  update public.organization_members set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;
end;
$$;

-- A new organization's first admin is invited, not attached.
create or replace function public.create_organization(p_name text, p_slug text, p_timezone text default 'Asia/Kolkata',
  p_admin_email text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, timezone)
  values (btrim(p_name), lower(btrim(p_slug)), coalesce(p_timezone, 'Asia/Kolkata'))
  returning id into v_org;
  if nullif(btrim(p_admin_email), '') is not null then
    perform public.invite_organization_member(v_org, p_admin_email, 'org_admin');
  end if;
  return v_org;
end;
$$;

-- The Console also needs open invitations, including for accounts with no organization yet.
create or replace function public.my_console_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'timezone', o.timezone, 'is_active', o.is_active,
        'role', coalesce(m.role, 'platform_admin')
      ) order by o.name)
      from public.organizations o
      left join public.organization_members m
        on m.organization_id = o.id and m.user_id = (select auth.uid()) and m.is_active
      where o.id in (select public.viewable_org_ids())
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.organization_name) from public.my_console_invitations() i
    ), '[]'::jsonb)
  );
$$;

drop function public.set_organization_member(uuid, text, text);

revoke execute on function
  public.invite_organization_member(uuid, text, text), public.list_organization_invitations(uuid),
  public.revoke_organization_invitation(uuid), public.my_console_invitations(),
  public.respond_to_console_invitation(uuid, boolean), public.set_organization_member_role(uuid, uuid, text)
from public, anon;
grant execute on function
  public.invite_organization_member(uuid, text, text), public.list_organization_invitations(uuid),
  public.revoke_organization_invitation(uuid), public.my_console_invitations(),
  public.respond_to_console_invitation(uuid, boolean), public.set_organization_member_role(uuid, uuid, text)
to authenticated;

notify pgrst, 'reload schema';
