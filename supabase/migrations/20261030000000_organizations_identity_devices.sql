-- Phase 2: organizations, console roles, verified employee identity, device registry
-- and attendance integrity.
--
-- Rollout compatibility
-- * Installed Android builds and the deployed Console never send organization_id.
--   Triggers derive it from trusted server data (the employee profile, the site, or the
--   caller's only organization), so both clients keep working unchanged.
-- * Every existing row moves into one default organization. Existing managers (trusted
--   app_metadata.role = 'manager') become its organization admins, so nobody loses
--   access. No row is deleted.
-- * Authorization stays in RLS. Policies read organization membership, never editable
--   user_metadata. Employee-facing policies only ever narrow (sites become
--   organization-scoped instead of readable by every signed-in account).

-- ---------------------------------------------------------------------------
-- 1. Organizations, console members and platform administrators
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Platform super admins. No API path writes this table; the project owner grants it in SQL.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

-- Console roles. Field employees are identified by public.employees, not by membership.
create table public.organization_members (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('org_admin', 'manager', 'supervisor')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function public.validate_organization() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_validate before insert or update on public.organizations
  for each row execute function public.validate_organization();
create trigger organization_members_touch before update on public.organization_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Role helpers used by every policy. Set-returning helpers let policies use
--    `organization_id in (select ...)`, which Postgres evaluates once per query.
-- ---------------------------------------------------------------------------

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins p where p.user_id = (select auth.uid()));
$$;

create function public.org_ids_with_role(p_roles text[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.organizations o where public.is_platform_admin()
  union
  select m.organization_id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id and o.is_active
  where m.user_id = (select auth.uid()) and m.is_active and m.role = any (p_roles);
$$;

create function public.viewable_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select public.org_ids_with_role(array['org_admin', 'manager', 'supervisor']);
$$;

create function public.manageable_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select public.org_ids_with_role(array['org_admin', 'manager']);
$$;

create function public.admin_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select public.org_ids_with_role(array['org_admin']);
$$;

-- ---------------------------------------------------------------------------
-- 3. Default organization and organization columns on every tenant table
-- ---------------------------------------------------------------------------

insert into public.organizations (name, slug) values ('Qvrix', 'qvrix');

do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'qvrix');
  v_table text;
begin
  foreach v_table in array array[
    'sites', 'shifts', 'departments', 'designations', 'employees', 'employee_sites',
    'presence_sessions', 'location_logs', 'site_visits'
  ] loop
    execute format('alter table public.%I add column organization_id uuid references public.organizations(id)', v_table);
    execute format('update public.%I set organization_id = $1', v_table) using v_org;
    execute format('alter table public.%I alter column organization_id set not null', v_table);
    execute format('create index %I on public.%I (organization_id)', v_table || '_organization_idx', v_table);
  end loop;

  -- Audit rows written before this migration all belong to the only organization.
  alter table public.audit_logs add column organization_id uuid references public.organizations(id);
  update public.audit_logs set organization_id = v_org;

  insert into public.organization_members (organization_id, user_id, role)
  select v_org, u.id, 'org_admin' from auth.users u
  where u.raw_app_meta_data ->> 'role' = 'manager';
end;
$$;

create index audit_logs_organization_idx on public.audit_logs (organization_id, created_at desc);

-- Organization of the signed-in field employee. Inactive profiles read nothing.
create function public.my_employee_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.organization_id from public.employees e
  where e.user_id = (select auth.uid()) and e.is_active;
$$;

-- Reference names are unique per organization, not across the platform.
alter table public.departments drop constraint departments_name_key;
alter table public.departments add constraint departments_organization_name_key unique (organization_id, name);
alter table public.designations drop constraint designations_name_key;
alter table public.designations add constraint designations_organization_name_key unique (organization_id, name);

-- Email is unique inside an organization, ignoring case. A platform-wide constraint would let one
-- organization reserve an address and block another from adding that person.
alter table public.employees drop constraint employees_email_key;
create unique index employees_organization_email_lower_key on public.employees (organization_id, lower(email));

-- Composite keys let foreign keys prove both sides of a reference share an organization.
alter table public.sites add constraint sites_id_organization_key unique (id, organization_id);
alter table public.employees add constraint employees_id_organization_key unique (id, organization_id);
alter table public.departments add constraint departments_id_organization_key unique (id, organization_id);
alter table public.designations add constraint designations_id_organization_key unique (id, organization_id);
alter table public.shifts add constraint shifts_id_organization_key unique (id, organization_id);

alter table public.employees
  add constraint employees_department_organization_fkey foreign key (department_id, organization_id)
    references public.departments (id, organization_id),
  add constraint employees_designation_organization_fkey foreign key (designation_id, organization_id)
    references public.designations (id, organization_id),
  add constraint employees_shift_organization_fkey foreign key (shift_id, organization_id)
    references public.shifts (id, organization_id);
alter table public.shifts
  add constraint shifts_department_organization_fkey foreign key (department_id, organization_id)
    references public.departments (id, organization_id);
alter table public.employee_sites
  add constraint employee_sites_employee_organization_fkey foreign key (employee_id, organization_id)
    references public.employees (id, organization_id),
  add constraint employee_sites_site_organization_fkey foreign key (site_id, organization_id)
    references public.sites (id, organization_id);
alter table public.presence_sessions
  add constraint presence_sessions_site_organization_fkey foreign key (site_id, organization_id)
    references public.sites (id, organization_id);
alter table public.site_visits
  add constraint site_visits_site_organization_fkey foreign key (site_id, organization_id)
    references public.sites (id, organization_id);
alter table public.location_logs
  add constraint location_logs_site_organization_fkey foreign key (site_id, organization_id)
    references public.sites (id, organization_id);

-- ---------------------------------------------------------------------------
-- 4. Organization stamping. Clients cannot choose or change a row's organization.
-- ---------------------------------------------------------------------------

-- Field activity belongs to the employee's organization. An account that is not linked
-- to an employee yet uses the site's organization; its rows still never get a guessed name.
create function public.stamp_activity_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_employee_org uuid;
  v_site_org uuid;
begin
  select e.organization_id into v_employee_org from public.employees e where e.user_id = new.user_id;
  if new.site_id is not null then
    select s.organization_id into v_site_org from public.sites s where s.id = new.site_id;
  end if;
  if v_employee_org is not null and v_site_org is not null and v_employee_org <> v_site_org then
    raise exception 'This site belongs to a different organization than the employee'
      using errcode = '42501';
  end if;
  new.organization_id := coalesce(v_employee_org, v_site_org);
  -- 42501 keeps the Android outbox retrying instead of dropping the record.
  if new.organization_id is null then
    raise exception 'This account has no employee profile in any organization yet'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Console-managed records default to the caller's organization when they manage exactly one.
create function public.default_managed_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_orgs uuid[];
begin
  if new.organization_id is null then
    select array_agg(id) into v_orgs from public.manageable_org_ids() as id;
    if coalesce(array_length(v_orgs, 1), 0) <> 1 then
      raise exception 'Choose the organization for this record' using errcode = '23502';
    end if;
    new.organization_id := v_orgs[1];
  end if;
  return new;
end;
$$;

create function public.stamp_assignment_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_employee_org uuid;
  v_site_org uuid;
begin
  select e.organization_id into v_employee_org from public.employees e where e.id = new.employee_id;
  select s.organization_id into v_site_org from public.sites s where s.id = new.site_id;
  if v_employee_org is not null and v_site_org is not null and v_employee_org <> v_site_org then
    raise exception 'The employee and the site belong to different organizations'
      using errcode = '42501';
  end if;
  new.organization_id := coalesce(v_employee_org, new.organization_id);
  return new;
end;
$$;

create function public.prevent_organization_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Records cannot be moved between organizations' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['presence_sessions', 'location_logs', 'site_visits'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_activity_organization()',
      v_table || '_10_stamp_organization', v_table);
  end loop;
  foreach v_table in array array['sites', 'shifts', 'departments', 'designations', 'employees'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.default_managed_organization()',
      v_table || '_10_default_organization', v_table);
  end loop;
  foreach v_table in array array[
    'sites', 'shifts', 'departments', 'designations', 'employees', 'employee_sites',
    'presence_sessions', 'location_logs', 'site_visits'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_organization_change()',
      v_table || '_05_keep_organization', v_table);
  end loop;
end;
$$;

create trigger employee_sites_10_stamp_organization before insert on public.employee_sites
  for each row execute function public.stamp_assignment_organization();

-- ---------------------------------------------------------------------------
-- 5. Attendance integrity. Employees may close their own open records, but cannot
--    rewrite who, where or when a check-in happened. Hours are always derived.
--    These guards are SECURITY INVOKER on purpose: current_user is 'authenticated'
--    for app requests and the owner inside trusted SECURITY DEFINER maintenance RPCs.
-- ---------------------------------------------------------------------------

alter table public.presence_sessions
  add column closed_by text check (closed_by in ('employee', 'auto_stale', 'manager')),
  add constraint presence_sessions_exit_after_entry
    check (exit_timestamp is null or exit_timestamp >= entry_timestamp);

create function public.guard_presence_session() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_app_request boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' and v_app_request then
    if new.user_id is distinct from old.user_id
       or new.site_id is distinct from old.site_id
       or new.entry_timestamp is distinct from old.entry_timestamp then
      raise exception 'Check-in details cannot be changed after they are recorded'
        using errcode = '42501';
    end if;
    -- A real check-out may replace an automatic stale-session closure, nothing else.
    if old.exit_timestamp is not null
       and new.exit_timestamp is distinct from old.exit_timestamp
       and old.closed_by is distinct from 'auto_stale' then
      raise exception 'A completed check-out cannot be changed' using errcode = '42501';
    end if;
    new.last_heartbeat := old.last_heartbeat;
    new.closed_by := old.closed_by;
  end if;

  if new.exit_timestamp is null then
    new.total_hours := null;
    new.closed_by := null;
  else
    new.total_hours := (new.exit_timestamp - new.entry_timestamp) / 3600000.0;
    if v_app_request and (tg_op = 'INSERT' or new.exit_timestamp is distinct from old.exit_timestamp) then
      new.closed_by := 'employee';
    end if;
  end if;
  return new;
end;
$$;

create trigger presence_sessions_20_guard before insert or update on public.presence_sessions
  for each row execute function public.guard_presence_session();

create function public.guard_site_visit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') then
    if new.user_id is distinct from old.user_id
       or new.site_id is distinct from old.site_id
       or new.entry_timestamp is distinct from old.entry_timestamp then
      raise exception 'Site entry details cannot be changed after they are recorded'
        using errcode = '42501';
    end if;
    if old.exit_timestamp is not null and new.exit_timestamp is distinct from old.exit_timestamp then
      raise exception 'A completed site visit cannot be changed' using errcode = '42501';
    end if;
  end if;
  new.duration_hours := case
    when new.exit_timestamp is null then null
    else (new.exit_timestamp - new.entry_timestamp) / 3600000.0
  end;
  return new;
end;
$$;

create trigger site_visits_20_guard before insert or update on public.site_visits
  for each row execute function public.guard_site_visit();

-- ---------------------------------------------------------------------------
-- 6. Verified employee identity. An employee profile is an invitation. It is linked to a
--    sign-in account only with proof that does not come from the inviting organization:
--    * the account holder accepts it while signed in with that confirmed email, or
--    * server-controlled app_metadata names both the employee role and this organization, or
--    * a platform admin links it.
--    Organization managers cannot attach an existing account to their organization, and
--    nothing is inferred from names or device labels.
-- ---------------------------------------------------------------------------

create function public.guard_employee_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (tg_op = 'INSERT' and new.user_id is not null)
       or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
      raise exception 'Employee accounts are linked only through verified account linking'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create function public.auto_link_employee_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if new.user_id is null and (tg_op = 'INSERT' or new.email is distinct from old.email) then
    select u.id into v_user
    from auth.users u
    where lower(u.email) = lower(new.email)
      and u.email_confirmed_at is not null
      and u.raw_app_meta_data ->> 'role' = 'employee'
      and u.raw_app_meta_data ->> 'organization_id' = new.organization_id::text
      and not exists (select 1 from public.employees e where e.user_id = u.id)
      and (select count(*) from auth.users u2 where lower(u2.email) = lower(new.email)) = 1;
    if found then
      new.user_id := v_user;
    end if;
  end if;
  return new;
end;
$$;

-- Trigger names order execution: the guard sees the client's values before auto-linking.
create trigger employees_20_guard_identity before insert or update on public.employees
  for each row execute function public.guard_employee_identity();
create trigger employees_30_auto_link_account before insert or update of email on public.employees
  for each row execute function public.auto_link_employee_account();

-- Called by the existing auth.users trigger. It no longer creates placeholder employee
-- profiles from an email address: every profile now belongs to an organization, so only
-- an organization can create it. It links only inside the organization named in the
-- account's server-controlled app_metadata.
create or replace function public.link_employee_to_auth_user(p_user_id uuid, p_email text, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org text;
begin
  if p_role is distinct from 'employee' or p_email is null then
    return;
  end if;
  if exists (select 1 from public.employees e where e.user_id = p_user_id) then
    return;
  end if;
  if (select count(*) from auth.users u where lower(u.email) = lower(p_email)) <> 1 then
    return;
  end if;
  select u.raw_app_meta_data ->> 'organization_id' into v_org from auth.users u where u.id = p_user_id;
  update public.employees
  set user_id = p_user_id, updated_at = now()
  where organization_id::text = v_org and lower(email) = lower(p_email) and user_id is null;
end;
$$;

-- Invitations waiting for the signed-in account: unlinked profiles in active organizations
-- that use the caller's confirmed email. Called by the Crewtraxa Employee app.
create function public.my_employee_invitations()
returns table (employee_id uuid, organization_id uuid, organization_name text, first_name text, last_name text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
    select e.id, o.id, o.name, e.first_name, e.last_name
    from auth.users u
    join public.employees e on lower(e.email) = lower(u.email) and e.user_id is null and e.is_active
    join public.organizations o on o.id = e.organization_id and o.is_active
    where u.id = auth.uid() and u.email_confirmed_at is not null
      and not exists (select 1 from public.employees x where x.user_id = u.id)
    order by o.name;
end;
$$;

-- The account holder accepts one invitation. This is the consent an organization cannot give itself.
create function public.accept_employee_invitation(p_employee_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_employee public.employees;
begin
  select e.* into v_employee
  from public.employees e
  join auth.users u on u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = lower(e.email)
  join public.organizations o on o.id = e.organization_id and o.is_active
  where e.id = p_employee_id and e.user_id is null and e.is_active
  for update of e;
  if not found then
    raise exception 'This invitation is not available to this account' using errcode = '42501';
  end if;
  if exists (select 1 from public.employees e where e.user_id = auth.uid()) then
    raise exception 'This account already belongs to an employee profile' using errcode = '23505';
  end if;
  update public.employees set user_id = auth.uid(), updated_at = now() where id = p_employee_id;
  return v_employee.organization_id;
end;
$$;

-- Platform operator tool: unlinked profiles whose email has exactly one confirmed account.
-- Not available to organization managers, so they cannot probe which emails have accounts.
create function public.employee_account_candidates(p_organization_id uuid)
returns table (employee_id uuid, user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required' using errcode = '42501';
  end if;
  return query
    select e.id, u.id, u.email::text
    from public.employees e
    join auth.users u on lower(u.email) = lower(e.email) and u.email_confirmed_at is not null
    where e.organization_id = p_organization_id
      and e.user_id is null
      and not exists (select 1 from public.employees x where x.user_id = u.id)
      and (select count(*) from auth.users u2 where lower(u2.email) = lower(e.email)) = 1;
end;
$$;

-- Platform operator override for accounts that cannot accept their invitation in the app.
create function public.link_employee_account(p_employee_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_employee public.employees;
  v_users uuid[];
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required' using errcode = '42501';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if v_employee.user_id is not null then
    raise exception 'This employee is already linked to an account' using errcode = '23505';
  end if;
  select array_agg(u.id) into v_users from auth.users u
  where lower(u.email) = lower(v_employee.email) and u.email_confirmed_at is not null;
  if coalesce(array_length(v_users, 1), 0) <> 1 then
    raise exception 'No single confirmed account uses this employee''s email address'
      using errcode = 'P0002';
  end if;
  if exists (select 1 from public.employees e where e.user_id = v_users[1]) then
    raise exception 'That account is already linked to another employee' using errcode = '23505';
  end if;
  update public.employees set user_id = v_users[1], updated_at = now() where id = p_employee_id;
  return v_users[1];
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Device registry. Identity always comes from the signed-in account; a device
--    record only describes the phone and who verifiably holds it.
-- ---------------------------------------------------------------------------

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  -- Null only for an account with no employee profile and no recorded site activity.
  organization_id uuid references public.organizations(id),
  -- Random per-installation UUID generated by the app.
  install_id text not null unique
    check (install_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- SHA-256 of a hardware-scoped identifier; recognises the same phone after a reinstall.
  hardware_hash text check (hardware_hash ~ '^[0-9a-f]{64}$'),
  platform text not null default 'android' check (platform in ('android', 'ios')),
  manufacturer text check (char_length(manufacturer) <= 100),
  model text check (char_length(model) <= 100),
  os_version text check (char_length(os_version) <= 50),
  app_version text check (char_length(app_version) <= 50),
  app_build integer,
  user_id uuid references auth.users(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  -- Another account signed in on this phone; it waits for a manager decision.
  pending_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'pending_review', 'revoked')),
  tracking_status text check (tracking_status in ('tracking', 'idle', 'permission_denied', 'location_disabled', 'unknown')),
  last_seen_at timestamptz,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index devices_organization_idx on public.devices (organization_id);
create index devices_user_idx on public.devices (user_id);
create index devices_hardware_idx on public.devices (hardware_hash);

create trigger devices_touch before update on public.devices
  for each row execute function public.touch_updated_at();

create table public.device_assignments (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id),
  organization_id uuid references public.organizations(id),
  user_id uuid not null references auth.users(id),
  employee_id uuid references public.employees(id) on delete set null,
  method text not null check (method in ('self_registration', 'admin_approval', 'admin_assignment')),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('reassigned', 'revoked')),
  check (ended_at is null or ended_at >= assigned_at)
);
create unique index device_assignments_one_open on public.device_assignments (device_id) where ended_at is null;
create index device_assignments_organization_idx on public.device_assignments (organization_id, assigned_at desc);

create table public.device_events (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id),
  organization_id uuid references public.organizations(id),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'registered', 'reinstalled', 'unlinked_account', 'account_mismatch', 'multiple_devices',
    'reassignment_approved', 'reassignment_rejected', 'assigned', 'revoked', 'reactivated'
  )),
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index device_events_device_idx on public.device_events (device_id, created_at desc);
create index device_events_organization_idx on public.device_events (organization_id, created_at desc);

create function public.record_device_event(
  p_device_id uuid, p_organization_id uuid, p_user_id uuid, p_event text, p_details jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.device_events (device_id, organization_id, user_id, event_type, details, created_by)
  values (p_device_id, p_organization_id, p_user_id, p_event, coalesce(p_details, '{}'::jsonb), auth.uid());
$$;

-- Called by the app after sign-in and on each sync. Returns the device's review state.
create function public.register_device(
  p_install_id text,
  p_hardware_hash text default null,
  p_platform text default 'android',
  p_manufacturer text default null,
  p_model text default null,
  p_os_version text default null,
  p_app_version text default null,
  p_app_build integer default null,
  p_tracking_status text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_employee public.employees;
  v_org uuid;
  v_device public.devices;
  v_other_devices uuid[];
begin
  if v_uid is null then
    raise exception 'Sign in to register this device' using errcode = '42501';
  end if;
  if p_install_id is null
     or p_install_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid installation identifier' using errcode = '22023';
  end if;

  select * into v_employee from public.employees where user_id = v_uid;
  v_org := v_employee.organization_id;
  if v_org is null then
    -- Unlinked accounts are shown to the organization whose sites they used.
    select ps.organization_id into v_org from public.presence_sessions ps
    where ps.user_id = v_uid order by ps.entry_timestamp desc limit 1;
  end if;

  select * into v_device from public.devices where install_id = p_install_id for update;
  if not found and p_hardware_hash is not null then
    select * into v_device from public.devices
    where hardware_hash = p_hardware_hash
    order by last_seen_at desc nulls last limit 1
    for update;
    if found then
      perform public.record_device_event(v_device.id, coalesce(v_device.organization_id, v_org), v_uid,
        'reinstalled', jsonb_build_object('previous_install_id', v_device.install_id));
      update public.devices set install_id = p_install_id where id = v_device.id;
    end if;
  end if;

  if v_device.id is null then
    insert into public.devices (
      organization_id, install_id, hardware_hash, platform, manufacturer, model, os_version,
      app_version, app_build, user_id, employee_id, status, tracking_status, last_seen_at
    ) values (
      v_org, p_install_id, p_hardware_hash, coalesce(p_platform, 'android'), left(p_manufacturer, 100),
      left(p_model, 100), left(p_os_version, 50), left(p_app_version, 50), p_app_build, v_uid, v_employee.id,
      case when v_employee.id is null then 'pending_review' else 'active' end,
      p_tracking_status, now()
    ) returning * into v_device;
    insert into public.device_assignments (device_id, organization_id, user_id, employee_id, method)
    values (v_device.id, v_org, v_uid, v_employee.id, 'self_registration');
    perform public.record_device_event(v_device.id, v_org, v_uid, 'registered', '{}'::jsonb);
    if v_employee.id is null then
      perform public.record_device_event(v_device.id, v_org, v_uid, 'unlinked_account', '{}'::jsonb);
    end if;
    select array_agg(d.id) into v_other_devices from public.devices d
    where d.user_id = v_uid and d.id <> v_device.id and d.status = 'active'
      and d.last_seen_at > now() - interval '30 days';
    if v_other_devices is not null then
      perform public.record_device_event(v_device.id, v_org, v_uid, 'multiple_devices',
        jsonb_build_object('other_device_ids', to_jsonb(v_other_devices)));
    end if;
  else
    update public.devices set
      hardware_hash = coalesce(p_hardware_hash, hardware_hash),
      manufacturer = coalesce(left(p_manufacturer, 100), manufacturer),
      model = coalesce(left(p_model, 100), model),
      os_version = coalesce(left(p_os_version, 50), os_version),
      app_version = coalesce(left(p_app_version, 50), app_version),
      app_build = coalesce(p_app_build, app_build),
      tracking_status = coalesce(p_tracking_status, tracking_status),
      organization_id = coalesce(organization_id, v_org),
      last_seen_at = now()
    where id = v_device.id;

    if v_device.status = 'revoked' then
      null; -- A revoked phone keeps its holder; only a manager can reactivate it.
    elsif v_device.user_id = v_uid then
      -- Pick up an employee link made since the last registration.
      if v_device.employee_id is distinct from v_employee.id then
        update public.devices set
          employee_id = v_employee.id,
          status = case when pending_user_id is null and v_employee.id is not null then 'active' else status end
        where id = v_device.id;
        update public.device_assignments set employee_id = v_employee.id, organization_id = coalesce(organization_id, v_org)
        where device_id = v_device.id and ended_at is null;
      end if;
    elsif v_device.user_id is null then
      update public.devices set
        user_id = v_uid, employee_id = v_employee.id,
        status = case when v_employee.id is null then 'pending_review' else 'active' end
      where id = v_device.id;
      insert into public.device_assignments (device_id, organization_id, user_id, employee_id, method)
      values (v_device.id, coalesce(v_device.organization_id, v_org), v_uid, v_employee.id, 'self_registration');
    elsif v_device.pending_user_id is distinct from v_uid then
      update public.devices set pending_user_id = v_uid, status = 'pending_review' where id = v_device.id;
      perform public.record_device_event(v_device.id, coalesce(v_device.organization_id, v_org), v_uid,
        'account_mismatch', jsonb_build_object('holder_user_id', v_device.user_id, 'signed_in_user_id', v_uid));
    end if;
  end if;

  select * into v_device from public.devices where id = v_device.id;
  return jsonb_build_object(
    'device_id', v_device.id,
    'status', v_device.status,
    'is_holder', v_device.user_id = v_uid
  );
end;
$$;

-- A manager must manage every organization a device decision touches.
create function public.require_device_manager(p_device public.devices, p_other_org uuid default null)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_device.id is null then
    raise exception 'Device not found' using errcode = 'P0002';
  end if;
  if (p_device.organization_id is null and p_other_org is null and not public.is_platform_admin())
     or (p_device.organization_id is not null
         and not exists (select 1 from public.manageable_org_ids() as id where id = p_device.organization_id))
     or (p_other_org is not null
         and not exists (select 1 from public.manageable_org_ids() as id where id = p_other_org)) then
    raise exception 'Manager access to this device is required' using errcode = '42501';
  end if;
end;
$$;

create function public.review_device_reassignment(p_device_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_device public.devices;
  v_target public.employees;
begin
  select * into v_device from public.devices where id = p_device_id for update;
  if v_device.pending_user_id is null then
    perform public.require_device_manager(v_device);
    raise exception 'This device has no pending account change' using errcode = '22023';
  end if;
  select * into v_target from public.employees where user_id = v_device.pending_user_id;
  perform public.require_device_manager(v_device, v_target.organization_id);

  if p_approve then
    update public.device_assignments set ended_at = now(), end_reason = 'reassigned'
    where device_id = v_device.id and ended_at is null;
    update public.devices set
      user_id = v_device.pending_user_id,
      employee_id = v_target.id,
      organization_id = coalesce(v_target.organization_id, organization_id),
      pending_user_id = null,
      status = case when v_target.id is null then 'pending_review' else 'active' end
    where id = v_device.id;
    insert into public.device_assignments (device_id, organization_id, user_id, employee_id, method, assigned_by)
    values (v_device.id, coalesce(v_target.organization_id, v_device.organization_id), v_device.pending_user_id,
      v_target.id, 'admin_approval', auth.uid());
    perform public.record_device_event(v_device.id, coalesce(v_target.organization_id, v_device.organization_id),
      v_device.pending_user_id, 'reassignment_approved',
      jsonb_build_object('previous_user_id', v_device.user_id, 'note', p_note));
  else
    update public.devices set
      pending_user_id = null,
      status = case when employee_id is null then 'pending_review' else 'active' end
    where id = v_device.id;
    perform public.record_device_event(v_device.id, v_device.organization_id, v_device.pending_user_id,
      'reassignment_rejected', jsonb_build_object('note', p_note));
  end if;
end;
$$;

create function public.assign_device(p_device_id uuid, p_employee_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_device public.devices;
  v_employee public.employees;
begin
  select * into v_device from public.devices where id = p_device_id for update;
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  perform public.require_device_manager(v_device, v_employee.organization_id);
  if v_device.status = 'revoked' then
    raise exception 'Reactivate this device before assigning it' using errcode = '22023';
  end if;
  if v_employee.user_id is null then
    raise exception 'Link this employee to their account before assigning a device' using errcode = '22023';
  end if;

  update public.device_assignments set ended_at = now(), end_reason = 'reassigned'
  where device_id = v_device.id and ended_at is null;
  update public.devices set
    user_id = v_employee.user_id, employee_id = v_employee.id,
    organization_id = v_employee.organization_id, pending_user_id = null, status = 'active'
  where id = v_device.id;
  insert into public.device_assignments (device_id, organization_id, user_id, employee_id, method, assigned_by)
  values (v_device.id, v_employee.organization_id, v_employee.user_id, v_employee.id, 'admin_assignment', auth.uid());
  perform public.record_device_event(v_device.id, v_employee.organization_id, v_employee.user_id, 'assigned',
    jsonb_build_object('previous_user_id', v_device.user_id, 'note', p_note));
end;
$$;

create function public.set_device_status(p_device_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_device public.devices;
begin
  if p_status not in ('active', 'revoked') then
    raise exception 'Status must be active or revoked' using errcode = '22023';
  end if;
  select * into v_device from public.devices where id = p_device_id for update;
  perform public.require_device_manager(v_device);
  if v_device.status = p_status then
    return;
  end if;
  update public.devices set status = case
    when p_status = 'revoked' then 'revoked'
    when pending_user_id is null and employee_id is not null then 'active'
    else 'pending_review'
  end
  where id = v_device.id;
  perform public.record_device_event(v_device.id, v_device.organization_id, v_device.user_id,
    case when p_status = 'revoked' then 'revoked' else 'reactivated' end,
    jsonb_build_object('note', p_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Organization administration RPCs
-- ---------------------------------------------------------------------------

-- Everything the Console needs to decide access and offer organization switching.
create function public.my_console_access() returns jsonb
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
    ), '[]'::jsonb)
  );
$$;

create function public.create_organization(p_name text, p_slug text, p_timezone text default 'Asia/Kolkata',
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
    perform public.set_organization_member(v_org, p_admin_email, 'org_admin');
  end if;
  return v_org;
end;
$$;

create function public.list_organization_members(p_organization_id uuid)
returns table (user_id uuid, email text, role text, is_active boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.manageable_org_ids() as id where id = p_organization_id) then
    raise exception 'Manager access to this organization is required' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.role, m.is_active, m.created_at, u.last_sign_in_at
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
    order by m.is_active desc, u.email;
end;
$$;

create function public.set_organization_member(p_organization_id uuid, p_email text, p_role text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_users uuid[];
begin
  if not exists (select 1 from public.admin_org_ids() as id where id = p_organization_id) then
    raise exception 'Organization admin access is required' using errcode = '42501';
  end if;
  if p_role not in ('org_admin', 'manager', 'supervisor') then
    raise exception 'Role must be org_admin, manager or supervisor' using errcode = '22023';
  end if;
  select array_agg(u.id) into v_users from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null;
  if coalesce(array_length(v_users, 1), 0) <> 1 then
    raise exception 'No single confirmed account uses this email address' using errcode = 'P0002';
  end if;
  if p_role <> 'org_admin' and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = v_users[1] and m.role = 'org_admin' and m.is_active
  ) and not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id <> v_users[1] and m.role = 'org_admin' and m.is_active
  ) then
    raise exception 'An organization must keep at least one active admin' using errcode = '22023';
  end if;
  insert into public.organization_members (organization_id, user_id, role, created_by)
  values (p_organization_id, v_users[1], p_role, auth.uid())
  on conflict (organization_id, user_id) do update set role = excluded.role, is_active = true;
  return v_users[1];
end;
$$;

create function public.deactivate_organization_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admin_org_ids() as id where id = p_organization_id) then
    raise exception 'Organization admin access is required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_user_id and m.role = 'org_admin' and m.is_active
  ) and not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id <> p_user_id and m.role = 'org_admin' and m.is_active
  ) then
    raise exception 'An organization must keep at least one active admin' using errcode = '22023';
  end if;
  update public.organization_members set is_active = false
  where organization_id = p_organization_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Maintenance RPCs only touch organizations the caller manages
-- ---------------------------------------------------------------------------

create or replace function public.mark_stale_sessions_exited(p_timeout_minutes integer default 15)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  updated integer;
  cutoff bigint;
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_service and not exists (select 1 from public.manageable_org_ids()) then
    raise insufficient_privilege using message = 'Manager access is required';
  end if;
  if p_timeout_minutes is null or p_timeout_minutes <= 0 or p_timeout_minutes > 1440 then
    raise invalid_parameter_value using message = 'Timeout must be between 1 and 1440 minutes';
  end if;
  cutoff := extract(epoch from now()) * 1000 - (p_timeout_minutes::bigint * 60000);
  update public.presence_sessions
  set exit_timestamp = greatest(entry_timestamp, cutoff),
      closed_by = 'auto_stale',
      is_synced = false
  where exit_timestamp is null and entry_timestamp <= cutoff
    and (last_heartbeat is null or last_heartbeat < cutoff)
    and (v_service or organization_id in (select public.manageable_org_ids()));
  get diagnostics updated = row_count;
  return updated;
end;
$$;

create or replace function public.update_session_heartbeats()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  updated integer;
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_service and not exists (select 1 from public.manageable_org_ids()) then
    raise insufficient_privilege using message = 'Manager access is required';
  end if;
  update public.presence_sessions ps set last_heartbeat = logs.timestamp
  from (
    select user_id, site_id, max(timestamp) as timestamp from public.location_logs
    where timestamp > extract(epoch from now()) * 1000 - 3600000
    group by user_id, site_id
  ) logs
  where ps.user_id = logs.user_id and ps.site_id = logs.site_id and ps.exit_timestamp is null
    and (ps.last_heartbeat is null or ps.last_heartbeat < logs.timestamp)
    and (v_service or ps.organization_id in (select public.manageable_org_ids()));
  get diagnostics updated = row_count;
  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Audit trail: organization-aware, and covering sites, assignments, attendance
--     corrections, memberships and devices
-- ---------------------------------------------------------------------------

create or replace function public.audit_trigger_func()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_record text := coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'employee_id', v_row ->> 'site_id', v_row ->> 'user_id'));
  v_org uuid := coalesce(v_row ->> 'organization_id', case when tg_table_name = 'organizations' then v_row ->> 'id' end)::uuid;
begin
  insert into public.audit_logs (user_id, action, table_name, record_id, old_values, new_values, organization_id)
  values (
    auth.uid(), tg_op, tg_table_name, coalesce(v_record, ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    v_org
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger audit_sites_trigger after insert or update or delete on public.sites
  for each row execute function public.audit_trigger_func();
create trigger audit_employee_sites_trigger after insert or update or delete on public.employee_sites
  for each row execute function public.audit_trigger_func();
create trigger audit_presence_sessions_trigger after update or delete on public.presence_sessions
  for each row execute function public.audit_trigger_func();
create trigger audit_organizations_trigger after insert or update or delete on public.organizations
  for each row execute function public.audit_trigger_func();
create trigger audit_organization_members_trigger after insert or update or delete on public.organization_members
  for each row execute function public.audit_trigger_func();
create trigger audit_devices_trigger after insert or update or delete on public.devices
  for each row execute function public.audit_trigger_func();

-- ---------------------------------------------------------------------------
-- 11. Row level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organization_members enable row level security;
alter table public.devices enable row level security;
alter table public.device_assignments enable row level security;
alter table public.device_events enable row level security;

-- Replace every policy that granted access through the platform-wide manager role.
drop policy "Authenticated users can read sites" on public.sites;
drop policy sites_select on public.sites;
drop policy sites_mutate on public.sites;
drop policy shifts_policy on public.shifts;
drop policy departments_policy on public.departments;
drop policy designations_policy on public.designations;
drop policy employees_select on public.employees;
drop policy employees_insert on public.employees;
drop policy employees_update on public.employees;
drop policy employee_sites_select on public.employee_sites;
drop policy employee_sites_insert on public.employee_sites;
drop policy employee_sites_delete on public.employee_sites;
drop policy presence_sessions_select on public.presence_sessions;
drop policy location_logs_select on public.location_logs;
drop policy "Employees read their visits" on public.site_visits;
drop policy audit_logs_select on public.audit_logs;
-- Audit rows are written only by triggers; nobody may forge them through the API.
drop policy audit_logs_insert on public.audit_logs;

-- Kept unchanged (already limited to the caller's own rows):
--   employees "Employees can read their own record", employee_sites "Employees can read
--   their own site assignments", shifts_select_assigned_employee, presence_sessions_insert,
--   presence_sessions_update_own (column changes limited by guard_presence_session),
--   location_logs_insert, "Employees create their visits", "Employees close their visits".

create policy sites_select on public.sites for select to authenticated
  using (organization_id in (select public.viewable_org_ids()) or organization_id = (select public.my_employee_org_id()));
create policy sites_insert on public.sites for insert to authenticated
  with check (organization_id in (select public.manageable_org_ids()));
create policy sites_update on public.sites for update to authenticated
  using (organization_id in (select public.manageable_org_ids()))
  with check (organization_id in (select public.manageable_org_ids()));
create policy sites_delete on public.sites for delete to authenticated
  using (organization_id in (select public.manageable_org_ids()));

do $$
declare
  v_table text;
begin
  foreach v_table in array array['shifts', 'departments', 'designations'] loop
    execute format('create policy %I on public.%I for select to authenticated using (organization_id in (select public.viewable_org_ids()))',
      v_table || '_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (organization_id in (select public.manageable_org_ids()))',
      v_table || '_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (organization_id in (select public.manageable_org_ids())) with check (organization_id in (select public.manageable_org_ids()))',
      v_table || '_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (organization_id in (select public.manageable_org_ids()))',
      v_table || '_delete', v_table);
  end loop;
end;
$$;

-- Employees keep the previous rule set: managers read, create and update; nobody deletes.
create policy employees_select on public.employees for select to authenticated
  using (organization_id in (select public.viewable_org_ids()));
create policy employees_insert on public.employees for insert to authenticated
  with check (organization_id in (select public.manageable_org_ids()));
create policy employees_update on public.employees for update to authenticated
  using (organization_id in (select public.manageable_org_ids()))
  with check (organization_id in (select public.manageable_org_ids()));

create policy employee_sites_select on public.employee_sites for select to authenticated
  using (organization_id in (select public.viewable_org_ids()));
create policy employee_sites_insert on public.employee_sites for insert to authenticated
  with check (organization_id in (select public.manageable_org_ids()));
create policy employee_sites_delete on public.employee_sites for delete to authenticated
  using (organization_id in (select public.manageable_org_ids()));

create policy presence_sessions_select on public.presence_sessions for select to authenticated
  using (user_id = (select auth.uid()) or organization_id in (select public.viewable_org_ids()));
create policy location_logs_select on public.location_logs for select to authenticated
  using (user_id = (select auth.uid()) or organization_id in (select public.viewable_org_ids()));
create policy site_visits_select on public.site_visits for select to authenticated
  using (user_id = (select auth.uid()) or organization_id in (select public.viewable_org_ids()));

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id in (select public.manageable_org_ids())
    or (organization_id is null and (select public.is_platform_admin())));

create policy organizations_select on public.organizations for select to authenticated
  using (id in (select public.viewable_org_ids()) or id = (select public.my_employee_org_id()));
create policy organizations_update on public.organizations for update to authenticated
  using (id in (select public.admin_org_ids()))
  with check (id in (select public.admin_org_ids()));

create policy organization_members_select on public.organization_members for select to authenticated
  using (user_id = (select auth.uid()) or organization_id in (select public.viewable_org_ids()));

create policy platform_admins_select_own on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

create policy devices_select on public.devices for select to authenticated
  using (user_id = (select auth.uid())
    or organization_id in (select public.viewable_org_ids())
    or (organization_id is null and (select public.is_platform_admin())));
create policy device_assignments_select on public.device_assignments for select to authenticated
  using (user_id = (select auth.uid())
    or organization_id in (select public.viewable_org_ids())
    or (organization_id is null and (select public.is_platform_admin())));
create policy device_events_select on public.device_events for select to authenticated
  using (organization_id in (select public.viewable_org_ids())
    or (organization_id is null and (select public.is_platform_admin())));

-- New tables are read-only through the API; all writes go through the RPCs above.
revoke all on public.organizations, public.platform_admins, public.organization_members,
  public.devices, public.device_assignments, public.device_events from anon, authenticated;
grant select on public.organizations, public.platform_admins, public.organization_members,
  public.devices, public.device_assignments, public.device_events to authenticated;
grant update (name, timezone) on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Views gain organization_id; unlinked accounts are routed to the organization
--     whose sites they used and no longer need a trusted role to appear.
-- ---------------------------------------------------------------------------

create or replace view public.employee_online_status with (security_invoker = true, security_barrier = true) as
select e.id as employee_id, e.user_id, e.first_name, e.last_name, e.email, e.is_active,
  case
    when ps.id is not null and ps.exit_timestamp is not null then 'checked-out'
    when ps.id is not null and ps.exit_timestamp is null
      and ps.last_heartbeat::numeric > extract(epoch from now()) * 1000 - 900000 then 'online'
    when ps.id is not null and ps.exit_timestamp is null then 'stale'
    when ll."timestamp"::numeric > extract(epoch from now()) * 1000 - 3600000 then 'recent'
    else 'offline'
  end as status,
  ps.id as session_id, ps.site_id, ps.entry_timestamp, ps.exit_timestamp, ps.total_hours, ps.last_heartbeat,
  ll."timestamp" as last_location_timestamp, ll.latitude as last_latitude, ll.longitude as last_longitude,
  ll.is_inside as last_is_inside, ll.site_id as last_site_id, ll.distance_to_site as last_distance_to_site,
  e.organization_id
from public.employees e
left join lateral (
  select p.id, p.site_id, p.entry_timestamp, p.exit_timestamp, p.total_hours, p.last_heartbeat
  from public.presence_sessions p where p.user_id = e.user_id
  order by p.entry_timestamp desc limit 1
) ps on true
left join lateral (
  select l."timestamp", l.latitude, l.longitude, l.is_inside, l.site_id, l.distance_to_site
  from public.location_logs l where l.user_id = e.user_id
  order by l."timestamp" desc limit 1
) ll on true
where e.user_id is not null and e.is_active = true;

create or replace view public.employees_outside_site with (security_invoker = true, security_barrier = true) as
select e.id as employee_id, e.user_id, e.first_name, e.last_name, e.email,
  ll.site_id, ll."timestamp", ll.is_inside, ll.distance_to_site,
  s.name as site_name, s.latitude as site_latitude, s.longitude as site_longitude, s.radius_in_meters,
  e.organization_id
from public.employees e
join lateral (
  select l.site_id, l."timestamp", l.is_inside, l.distance_to_site
  from public.location_logs l
  where l.user_id = e.user_id and l."timestamp"::numeric > extract(epoch from now()) * 1000 - 3600000
  order by l."timestamp" desc limit 1
) ll on true
join public.sites s on s.id = ll.site_id
where e.user_id is not null and e.is_active = true and ll.is_inside = false and ll.distance_to_site > s.radius_in_meters;

-- Deliberately keeps definer access to auth.users (emails), filtered by organization role.
create or replace view public.unlinked_devices with (security_barrier = true) as
select u.id as user_id, u.email, u.raw_app_meta_data ->> 'role' as role, u.created_at as user_created_at,
  ps.id as session_id, ps.site_id, ps.entry_timestamp, ps.exit_timestamp, ps.total_hours, ps.last_heartbeat,
  ll."timestamp" as last_location_timestamp, ll.latitude as last_latitude, ll.longitude as last_longitude,
  ll.is_inside as last_is_inside, ll.site_id as last_site_id,
  case
    when ps.id is not null and ps.exit_timestamp is not null then 'checked-out'
    when ps.id is not null and ps.exit_timestamp is null
      and ps.last_heartbeat::numeric > extract(epoch from now()) * 1000 - 900000 then 'online'
    when ps.id is not null and ps.exit_timestamp is null then 'stale'
    when ll."timestamp"::numeric > extract(epoch from now()) * 1000 - 3600000 then 'recent'
    else 'offline'
  end as status,
  coalesce(ps.organization_id, ll.organization_id) as organization_id
from auth.users u
left join lateral (
  select p.id, p.site_id, p.entry_timestamp, p.exit_timestamp, p.total_hours, p.last_heartbeat, p.organization_id
  from public.presence_sessions p where p.user_id = u.id
  order by p.entry_timestamp desc limit 1
) ps on true
left join lateral (
  select l."timestamp", l.latitude, l.longitude, l.is_inside, l.site_id, l.organization_id
  from public.location_logs l where l.user_id = u.id
  order by l."timestamp" desc limit 1
) ll on true
where u.email is not null
  and not exists (select 1 from public.employees e where e.user_id = u.id)
  and not exists (select 1 from public.organization_members m where m.user_id = u.id)
  and not exists (select 1 from public.platform_admins p where p.user_id = u.id)
  and (coalesce(ps.organization_id, ll.organization_id) in (select public.viewable_org_ids())
    or (select public.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- 13. Function privileges: RPCs for signed-in users only, trigger helpers for nobody
-- ---------------------------------------------------------------------------

revoke execute on function
  public.touch_updated_at(), public.validate_organization(), public.stamp_activity_organization(),
  public.default_managed_organization(), public.stamp_assignment_organization(),
  public.prevent_organization_change(), public.guard_presence_session(), public.guard_site_visit(),
  public.guard_employee_identity(), public.auto_link_employee_account(),
  public.record_device_event(uuid, uuid, uuid, text, jsonb),
  public.require_device_manager(public.devices, uuid)
from public, anon, authenticated;

revoke execute on function
  public.is_platform_admin(), public.org_ids_with_role(text[]), public.viewable_org_ids(),
  public.manageable_org_ids(), public.admin_org_ids(), public.my_employee_org_id(),
  public.employee_account_candidates(uuid), public.link_employee_account(uuid),
  public.my_employee_invitations(), public.accept_employee_invitation(uuid),
  public.register_device(text, text, text, text, text, text, text, integer, text),
  public.review_device_reassignment(uuid, boolean, text), public.assign_device(uuid, uuid, text),
  public.set_device_status(uuid, text, text), public.my_console_access(),
  public.create_organization(text, text, text, text), public.list_organization_members(uuid),
  public.set_organization_member(uuid, text, text), public.deactivate_organization_member(uuid, uuid)
from public, anon;

grant execute on function
  public.is_platform_admin(), public.org_ids_with_role(text[]), public.viewable_org_ids(),
  public.manageable_org_ids(), public.admin_org_ids(), public.my_employee_org_id(),
  public.employee_account_candidates(uuid), public.link_employee_account(uuid),
  public.my_employee_invitations(), public.accept_employee_invitation(uuid),
  public.register_device(text, text, text, text, text, text, text, integer, text),
  public.review_device_reassignment(uuid, boolean, text), public.assign_device(uuid, uuid, text),
  public.set_device_status(uuid, text, text), public.my_console_access(),
  public.create_organization(text, text, text, text), public.list_organization_members(uuid),
  public.set_organization_member(uuid, text, text), public.deactivate_organization_member(uuid, uuid)
to authenticated;
