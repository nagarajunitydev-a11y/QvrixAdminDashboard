-- Crewtraxa Workforce: incremental tenancy migration for the checked-in schema.
-- Run after both existing migrations. No authority is inferred from user_metadata.
begin;

-- Unknown schemas require inspection instead of silently leaving a tenant table exposed.
do $$ declare n text; begin
  foreach n in array array['profiles','attendance','alerts','devices','reports','site_visits'] loop
    if to_regclass('public.' || n) is not null then
      raise exception 'Preflight: public.% exists outside the checked-in schema. Extend this migration with its keys and policies before deployment.', n;
    end if;
  end loop;
end $$;

create schema if not exists crewtraxa_private;
revoke all on schema crewtraxa_private from public, anon, authenticated;
create table crewtraxa_private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  status text not null default 'active' check (status in ('active','suspended')),
  timezone text not null default 'Asia/Kolkata',
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  branding jsonb not null default '{}' check (jsonb_typeof(branding) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.validate_organization_configuration() returns trigger
language plpgsql security invoker set search_path='' as $$
declare color text; channel float8; linear float8[] := '{}'; position integer; luminance float8;
begin
  if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Unknown time zone'; end if;
  if new.branding ? 'display_name' and (jsonb_typeof(new.branding->'display_name')<>'string' or length(new.branding->>'display_name')>160) then
    raise exception 'Brand display name must be text of at most 160 characters';
  end if;
  if new.branding ? 'accent_color' then
    color:=new.branding->>'accent_color';
    if jsonb_typeof(new.branding->'accent_color')<>'string' or color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Accent color must be a six-digit hex color'; end if;
    for position in 0..2 loop
      channel:=get_byte(decode(substr(color,2),'hex'),position)/255.0;
      linear:=array_append(linear,case when channel<=0.04045 then channel/12.92 else power((channel+0.055)/1.055,2.4) end);
    end loop;
    luminance:=0.2126*linear[1]+0.7152*linear[2]+0.0722*linear[3];
    if 1.05/(luminance+0.05)<4.5 then raise exception 'Choose a darker accent color with adequate contrast for white text'; end if;
  end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger organization_configuration before insert or update on public.organizations
for each row execute function public.validate_organization_configuration();

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('organization_admin','manager','supervisor','employee')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create index organization_memberships_user on public.organization_memberships(user_id, organization_id);
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  email text not null check (length(email) between 3 and 320),
  role text not null check (role in ('organization_admin','manager','supervisor','employee')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index organization_invitations_org on public.organization_invitations(organization_id);

-- A stable, designated organization preserves existing IDs, timestamps and relationships.
insert into public.organizations(id,name,timezone)
values ('00000000-0000-4000-8000-000000000001','Existing organization','Asia/Kolkata');
insert into public.organization_memberships(organization_id,user_id,role)
select '00000000-0000-4000-8000-000000000001', id, 'employee' from auth.users;
-- Verified operators must explicitly bootstrap administrators; metadata never grants authority.

do $$ declare t text; begin
  foreach t in array array['sites','departments','designations','shifts','employees','employee_sites','location_logs','presence_sessions','audit_logs'] loop
    execute format('alter table public.%I add column organization_id uuid references public.organizations(id)',t);
    execute format('update public.%I set organization_id = %L where organization_id is null',t,'00000000-0000-4000-8000-000000000001');
    execute format('alter table public.%I alter column organization_id set not null',t);
    execute format('create index %I on public.%I(organization_id)',t || '_organization_idx',t);
  end loop;
end $$;
-- The legacy audit trigger is replaced before any backfill involving audited entities.
create or replace function public.audit_trigger_func() returns trigger
language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; old_data jsonb; begin
  if tg_op = 'DELETE' then row_data := to_jsonb(old); else row_data := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then old_data := to_jsonb(old); end if;
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_values,new_values)
  values ((row_data->>'organization_id')::uuid, auth.uid(), tg_op, tg_table_name,
    coalesce(row_data->>'id', concat(row_data->>'employee_id',':',row_data->>'site_id')),
    old_data, case when tg_op <> 'DELETE' then row_data end);
  if tg_op = 'DELETE' then return old; end if; return new;
end $$;

-- Tenant uniqueness replaces global uniqueness, preserving current spelling semantics.
do $$ declare c record; begin
  for c in select conrelid::regclass as tbl,conname from pg_constraint
    where contype='u' and conrelid in ('public.employees'::regclass,'public.departments'::regclass,'public.designations'::regclass)
      and array_length(conkey,1)=1 loop
    execute format('alter table %s drop constraint %I', c.tbl,c.conname);
  end loop;
end $$;
alter table public.employees add unique(organization_id,email), add unique(organization_id,user_id), add unique(organization_id,id);
alter table public.departments add unique(organization_id,name), add unique(organization_id,id);
alter table public.designations add unique(organization_id,name), add unique(organization_id,id);
alter table public.shifts add unique(organization_id,id);
alter table public.sites add unique(organization_id,id);
alter table public.employees add foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id),
  add foreign key(organization_id,department_id) references public.departments(organization_id,id),
  add foreign key(organization_id,designation_id) references public.designations(organization_id,id),
  add foreign key(organization_id,shift_id) references public.shifts(organization_id,id);
alter table public.shifts add foreign key(organization_id,department_id) references public.departments(organization_id,id);
alter table public.employee_sites add foreign key(organization_id,employee_id) references public.employees(organization_id,id),
  add foreign key(organization_id,site_id) references public.sites(organization_id,id);
alter table public.location_logs add foreign key(organization_id,site_id) references public.sites(organization_id,id),
  add foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id);
alter table public.presence_sessions add foreign key(organization_id,site_id) references public.sites(organization_id,id),
  add foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id);
create index location_logs_org_time on public.location_logs(organization_id,timestamp desc);
create index presence_sessions_org_time on public.presence_sessions(organization_id,entry_timestamp desc);
create index employee_sites_org_employee on public.employee_sites(organization_id,employee_id,site_id);
create table public.organization_site_access (
  organization_id uuid not null, user_id uuid not null, site_id uuid not null,
  primary key(organization_id,user_id,site_id),
  foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id),
  foreign key(organization_id,site_id) references public.sites(organization_id,id) on delete cascade
);

create function public.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from crewtraxa_private.platform_admins where user_id=auth.uid())
$$;
create function public.organization_role(org uuid) returns text language sql stable security definer set search_path='' as $$
  select case when public.is_platform_admin() then 'platform_super_admin' else
    (select m.role from public.organization_memberships m where m.organization_id=org and m.user_id=auth.uid() and m.status='active') end
  from public.organizations o where o.id=org and o.status='active'
$$;
create function public.is_organization_admin(org uuid) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.organization_role(org) in ('platform_super_admin','organization_admin'),false)
$$;
create function public.can_access_site(org uuid, site uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.organization_role(org) is not null and (
    public.is_organization_admin(org) or
    (public.organization_role(org) in ('manager','supervisor') and exists(select 1 from public.organization_site_access a where a.organization_id=org and a.user_id=auth.uid() and a.site_id=site)) or
    exists(select 1 from public.employee_sites a join public.employees e on e.id=a.employee_id and e.organization_id=a.organization_id
      where a.organization_id=org and a.site_id=site and e.user_id=auth.uid() and e.is_active))
$$;
create function public.can_manage_site(org uuid, site uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_organization_admin(org) or (public.organization_role(org)='manager' and exists(
    select 1 from public.organization_site_access a where a.organization_id=org and a.user_id=auth.uid() and a.site_id=site))
$$;
create function public.can_access_employee(org uuid, employee uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.organization_role(org) is not null and (public.is_organization_admin(org) or exists(
    select 1 from public.employees e where e.organization_id=org and e.id=employee and (e.user_id=auth.uid() or
    (public.organization_role(org) in ('manager','supervisor') and exists(select 1 from public.employee_sites a
      join public.organization_site_access s on s.organization_id=a.organization_id and s.site_id=a.site_id and s.user_id=auth.uid()
      where a.organization_id=org and a.employee_id=employee)))))
$$;
create function public.can_manage_employee(org uuid, employee uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_organization_admin(org) or (public.organization_role(org)='manager' and public.can_access_employee(org,employee))
$$;
create function public.can_read_tracking(org uuid, person uuid, site uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.organization_role(org) is not null and (person=auth.uid() or public.is_organization_admin(org) or
    (public.organization_role(org) in ('manager','supervisor') and public.can_access_site(org,site) and exists(
      select 1 from public.employees e where e.organization_id=org and e.user_id=person and public.can_access_employee(org,e.id))))
$$;
create function public.can_upload_tracking(org uuid, person uuid, site uuid) returns boolean language sql stable security definer set search_path='' as $$
  select person=auth.uid() and public.organization_role(org) is not null and
    (site is null or exists(select 1 from public.employee_sites a join public.employees e on e.id=a.employee_id and e.organization_id=a.organization_id
      where a.organization_id=org and a.site_id=site and e.user_id=person and e.is_active))
$$;

-- Old mobile queues carry stable site/user IDs. Derive the tenant from those IDs,
-- never from the console's active selection or a JWT's editable user metadata.
create function public.bind_record_organization() returns trigger language plpgsql security invoker set search_path='' as $$
declare r jsonb:=to_jsonb(new); inferred uuid; candidates integer; begin
  if tg_op='UPDATE' then
    if new.organization_id is distinct from old.organization_id then raise exception 'Record organization is immutable' using errcode='42501'; end if;
    if tg_table_name in ('location_logs','presence_sessions') and
      ((r->>'user_id') is distinct from (to_jsonb(old)->>'user_id') or (r->>'site_id') is distinct from (to_jsonb(old)->>'site_id')) then
      raise exception 'Tracking identity is immutable' using errcode='42501';
    end if;
    if tg_table_name='presence_sessions' and (r->>'entry_timestamp') is distinct from (to_jsonb(old)->>'entry_timestamp') then
      raise exception 'Session entry is immutable' using errcode='42501';
    end if;
    if current_user='authenticated' and tg_table_name='employees' and (r->>'user_id') is distinct from (to_jsonb(old)->>'user_id') and not public.is_organization_admin(new.organization_id) then
      raise exception 'Only administrators may link employee login accounts' using errcode='42501';
    end if;
    return new;
  end if;
  if new.organization_id is null then
    if nullif(r->>'site_id','') is not null then
      select organization_id into inferred from public.sites where id=(r->>'site_id')::uuid;
    elsif nullif(r->>'employee_id','') is not null then
      select organization_id into inferred from public.employees where id=(r->>'employee_id')::uuid;
    else
      select count(*), (array_agg(m.organization_id))[1] into candidates,inferred
        from public.organization_memberships m join public.organizations o on o.id=m.organization_id
        where m.user_id=coalesce((r->>'user_id')::uuid,auth.uid()) and m.status='active' and o.status='active';
      if candidates<>1 then raise exception 'Explicit organization_id required for an ambiguous or unauthorized upload' using errcode='22023'; end if;
    end if;
    if inferred is null then raise exception 'Cannot determine authorized organization' using errcode='22023'; end if;
    new.organization_id:=inferred;
  end if;
  return new;
end $$;

do $$ declare t text; p record; begin
  foreach t in array array['sites','departments','designations','shifts','employees','employee_sites','location_logs','presence_sessions','audit_logs'] loop
    execute format('create trigger bind_organization before insert or update on public.%I for each row execute function public.bind_record_organization()',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy tenant_fence on public.%I as restrictive for all to authenticated using (public.organization_role(organization_id) is not null) with check (public.organization_role(organization_id) is not null)',t);
  end loop;
end $$;
create policy sites_read on public.sites for select to authenticated using(public.can_access_site(organization_id,id));
create policy sites_insert on public.sites for insert to authenticated with check(public.is_organization_admin(organization_id));
create policy sites_update on public.sites for update to authenticated using(public.can_manage_site(organization_id,id)) with check(public.can_manage_site(organization_id,id));
create policy sites_delete on public.sites for delete to authenticated using(public.can_manage_site(organization_id,id));
create policy employees_read on public.employees for select to authenticated using(public.can_access_employee(organization_id,id));
create policy employees_insert on public.employees for insert to authenticated with check(public.is_organization_admin(organization_id));
create policy employees_update on public.employees for update to authenticated using(public.can_manage_employee(organization_id,id)) with check(public.can_manage_employee(organization_id,id));
create policy employees_delete on public.employees for delete to authenticated using(public.can_manage_employee(organization_id,id));
create policy assignment_read on public.employee_sites for select to authenticated using(public.can_access_employee(organization_id,employee_id) and public.can_access_site(organization_id,site_id));
create policy assignment_insert on public.employee_sites for insert to authenticated with check(public.can_manage_employee(organization_id,employee_id) and public.can_manage_site(organization_id,site_id));
create policy assignment_delete on public.employee_sites for delete to authenticated using(public.can_manage_employee(organization_id,employee_id) and public.can_manage_site(organization_id,site_id));
create policy logs_read on public.location_logs for select to authenticated using(public.can_read_tracking(organization_id,user_id,site_id));
create policy logs_insert on public.location_logs for insert to authenticated with check(public.can_upload_tracking(organization_id,user_id,site_id));
create policy sessions_read on public.presence_sessions for select to authenticated using(public.can_read_tracking(organization_id,user_id,site_id));
create policy sessions_insert on public.presence_sessions for insert to authenticated with check(public.can_upload_tracking(organization_id,user_id,site_id));
-- Start/End Shift updates the same authorized session; it never changes tenant/user/site.
create policy sessions_update on public.presence_sessions for update to authenticated
  using(user_id=auth.uid() and public.organization_role(organization_id) is not null)
  with check(user_id=auth.uid() and public.organization_role(organization_id) is not null);
create policy audit_read on public.audit_logs for select to authenticated using(public.is_organization_admin(organization_id));
revoke insert,update,delete on public.audit_logs from authenticated;
do $$ declare t text; begin
  foreach t in array array['departments','designations','shifts'] loop
    execute format('create policy config_read on public.%I for select to authenticated using (public.organization_role(organization_id) is not null)',t);
    execute format('create policy config_manage on public.%I for all to authenticated using (public.organization_role(organization_id) in (''platform_super_admin'',''organization_admin'',''manager'')) with check (public.organization_role(organization_id) in (''platform_super_admin'',''organization_admin'',''manager''))',t);
  end loop;
end $$;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_site_access enable row level security;
revoke all on public.organizations,public.organization_memberships,public.organization_invitations,public.organization_site_access from anon,authenticated;
grant select on public.organizations,public.organization_memberships,public.organization_invitations,public.organization_site_access to authenticated;
create policy organization_read on public.organizations for select to authenticated using(public.is_platform_admin() or exists(
  select 1 from public.organization_memberships m where m.organization_id=id and m.user_id=auth.uid() and m.status='active'));
create policy memberships_read on public.organization_memberships for select to authenticated using(user_id=auth.uid() or public.is_organization_admin(organization_id) or public.is_platform_admin());
create policy invitations_read on public.organization_invitations for select to authenticated using(public.is_organization_admin(organization_id));
create policy scopes_read on public.organization_site_access for select to authenticated using(user_id=auth.uid() or public.is_organization_admin(organization_id));

create function public.save_organization(org uuid, org_name text, org_status text, org_timezone text, org_settings jsonb default '{}', org_branding jsonb default '{}')
returns public.organizations language plpgsql security definer set search_path='' as $$
declare result public.organizations; begin
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  if not exists(select 1 from pg_timezone_names where name=org_timezone) then raise exception 'Unknown time zone'; end if;
  if org is null then
    insert into public.organizations(name,status,timezone,settings,branding) values(org_name,org_status,org_timezone,org_settings,org_branding) returning * into result;
  else
    update public.organizations set name=org_name,status=org_status,timezone=org_timezone,settings=org_settings,branding=org_branding,updated_at=now() where id=org returning * into result;
    if not found then raise exception 'Organization not found'; end if;
  end if;
  return result;
end $$;
create function public.update_organization_settings(org uuid, org_timezone text, org_settings jsonb, org_branding jsonb)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.organizations where id=org for update;
  if not public.is_organization_admin(org) then raise exception 'Organization administrator required' using errcode='42501'; end if;
  if not exists(select 1 from pg_timezone_names where name=org_timezone) then raise exception 'Unknown time zone'; end if;
  update public.organizations set timezone=org_timezone,settings=org_settings,branding=org_branding,updated_at=now() where id=org;
end $$;
create function public.manage_organization_member(org uuid, member uuid, member_role text, member_status text)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.organizations where id=org for update;
  if not public.is_organization_admin(org) then raise exception 'Organization administrator required' using errcode='42501'; end if;
  if exists(select 1 from public.organization_memberships where organization_id=org and user_id=member and role='organization_admin' and status='active')
    and (member_role<>'organization_admin' or member_status<>'active')
    and (select count(*) from public.organization_memberships where organization_id=org and role='organization_admin' and status='active')<=1 then
      raise exception 'Keep at least one active organization administrator';
  end if;
  insert into public.organization_memberships(organization_id,user_id,role,status) values(org,member,member_role,member_status)
  on conflict(organization_id,user_id) do update set role=excluded.role,status=excluded.status,updated_at=now();
end $$;
create function public.set_organization_site_access(org uuid, member uuid, site uuid, enabled boolean)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.organizations where id=org for update;
  if not public.is_organization_admin(org) then raise exception 'Organization administrator required' using errcode='42501'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=org and user_id=member and role in ('manager','supervisor') and status='active') then raise exception 'An active manager or supervisor membership is required'; end if;
  if enabled then insert into public.organization_site_access values(org,member,site) on conflict do nothing;
  else delete from public.organization_site_access where organization_id=org and user_id=member and site_id=site; end if;
end $$;
create function public.create_organization_invitation(org uuid, invite_email text, invite_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token text:=gen_random_uuid()::text || gen_random_uuid()::text; invite uuid; begin
  perform 1 from public.organizations where id=org for update;
  if not public.is_organization_admin(org) then raise exception 'Organization administrator required' using errcode='42501'; end if;
  insert into public.organization_invitations(organization_id,email,role,token_hash,invited_by)
  values(org,lower(btrim(invite_email)),invite_role,encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid()) returning id into invite;
  return jsonb_build_object('id',invite,'token',token);
end $$;
create function public.revoke_organization_invitation(invite uuid) returns void language plpgsql security definer set search_path='' as $$ begin
  update public.organization_invitations set revoked_at=now() where id=invite and public.is_organization_admin(organization_id) and accepted_at is null;
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
end $$;
create function public.accept_organization_invitation(token text) returns uuid language plpgsql security definer set search_path='' as $$
declare inv public.organization_invitations; verified_email text; begin
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Sign in with a verified email address' using errcode='42501'; end if;
  select * into inv from public.organization_invitations where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
  if not found or inv.email<>verified_email or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at<=now()
    or not exists(select 1 from public.organizations where id=inv.organization_id and status='active')
    or not (exists(select 1 from crewtraxa_private.platform_admins where user_id=inv.invited_by) or exists(
      select 1 from public.organization_memberships where organization_id=inv.organization_id and user_id=inv.invited_by and role='organization_admin' and status='active')) then
    raise exception 'Invitation invalid or unavailable' using errcode='42501';
  end if;
  -- Invitations cannot silently overwrite an existing role or reactivate a suspended member.
  insert into public.organization_memberships(organization_id,user_id,role) values(inv.organization_id,auth.uid(),inv.role) on conflict do nothing;
  update public.employees set user_id=auth.uid() where organization_id=inv.organization_id and lower(email)=verified_email and user_id is null
    and not exists(select 1 from public.employees where organization_id=inv.organization_id and user_id=auth.uid());
  update public.organization_invitations set accepted_at=now() where id=inv.id;
  return inv.organization_id;
end $$;
-- Validates selection against live membership on every switch (selection is not authority).
create function public.validate_organization_selection(org uuid) returns text language plpgsql security definer set search_path='' as $$
declare result text:=public.organization_role(org); begin
  if result is null then raise exception 'Organization unavailable or access revoked' using errcode='42501'; end if;
  return result;
end $$;
-- Retire metadata-based authority, including for older callers of the old helper.
create or replace function public.get_user_role() returns text language sql stable security definer set search_path='' as $$
  select case when public.is_platform_admin() then 'platform_super_admin' else null end
$$;


create function public.list_organization_members(org uuid)
returns table(organization_id uuid,user_id uuid,email text,role text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$ begin
  if not public.is_organization_admin(org) then raise exception 'Organization administrator required' using errcode='42501'; end if;
  return query select m.organization_id,m.user_id,u.email::text,m.role,m.status,m.created_at
    from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=org;
end $$;

-- No helper is anonymously callable; trigger functions cannot be invoked as RPCs.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('is_platform_admin','organization_role','is_organization_admin','can_access_site','can_manage_site','can_access_employee','can_manage_employee','can_read_tracking','can_upload_tracking','bind_record_organization','audit_trigger_func','save_organization','update_organization_settings','manage_organization_member','set_organization_site_access','create_organization_invitation','revoke_organization_invitation','accept_organization_invitation','validate_organization_selection','get_user_role','list_organization_members','validate_organization_configuration') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.signature::text not like '%%bind_record_organization%%' and f.signature::text not like '%%audit_trigger_func%%' and f.signature::text not like '%%validate_organization_configuration%%' then
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
end $$;
alter default privileges in schema public revoke all on tables from anon,authenticated;
notify pgrst, 'reload schema';
commit;
