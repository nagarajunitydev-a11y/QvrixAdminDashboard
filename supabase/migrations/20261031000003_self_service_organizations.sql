-- Self-service organizations and the setup wizard.
--
-- Until now only platform admins created organizations. A signed-in account with a confirmed email,
-- no Console role and no employee profile can now create one organization and becomes its admin.
-- The Console then walks that admin through setup (company details, working hours, time-tracking
-- rules, sites, people). Progress is stored on the organization, so setup resumes after signing in
-- again. Organizations that already exist are marked as set up and keep the Getting Started checklist.

alter table public.organizations
  add column country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column industry text check (industry is null or industry in (
    'construction', 'facility_management', 'security_services', 'manufacturing', 'logistics', 'retail',
    'healthcare', 'hospitality', 'field_services', 'agriculture', 'education', 'technology', 'other')),
  add column team_size text check (team_size is null or team_size in ('1-10', '11-50', '51-200', '201-500', '500+')),
  -- The account that created the organization through self-service; null for platform-created ones.
  add column created_by uuid references auth.users (id) on delete set null,
  -- The next setup step to show its admins; 'done' once setup is finished or skipped.
  add column onboarding_step text not null default 'company'
    check (onboarding_step in ('company', 'schedule', 'rules', 'sites', 'team', 'done')),
  add column onboarding_completed_at timestamptz;

-- One self-service organization per account.
create unique index organizations_one_per_creator on public.organizations (created_by) where created_by is not null;

update public.organizations set onboarding_step = 'done', onboarding_completed_at = now();

-- Organization admins record setup progress and company details; created_by stays server-controlled.
grant update (country_code, industry, team_size, onboarding_step, onboarding_completed_at) on public.organizations to authenticated;

create function public.can_create_organization() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null)
    and not public.is_platform_admin()
    and not exists (select 1 from public.organization_members m where m.user_id = (select auth.uid()) and m.is_active)
    and not exists (select 1 from public.employees e where e.user_id = (select auth.uid()) and e.is_active)
    and not exists (select 1 from public.organizations o where o.created_by = (select auth.uid()));
$$;

create function public.create_my_organization(p_name text, p_timezone text, p_country_code text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_org uuid;
  v_tries integer := 0;
begin
  if not public.can_create_organization() then
    raise insufficient_privilege using message =
      'This account cannot create an organization. Confirm your email address first. Accounts that already '
      'belong to an organization, have an employee profile or created an organization cannot create another.';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Give the organization a name of 2 to 120 characters' using errcode = '22023';
  end if;

  -- Readable, unique web-safe identifier: "Acme Facilities" -> acme-facilities, acme-facilities-3f9a2, ...
  v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from left(coalesce(nullif(v_base, ''), 'organization'), 50));
  if char_length(v_base) < 2 then
    v_base := v_base || '-org';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_tries := v_tries + 1;
    if v_tries > 20 then
      raise exception 'Could not find a free identifier for this name; try a different name' using errcode = '23505';
    end if;
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  insert into public.organizations (name, slug, timezone, country_code, created_by, onboarding_step)
  values (v_name, v_slug, coalesce(nullif(btrim(p_timezone), ''), 'Asia/Kolkata'),
    upper(nullif(btrim(p_country_code), '')), v_uid, 'company')
  returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role, created_by)
  values (v_org, v_uid, 'org_admin', v_uid);
  return v_org;
end;
$$;

-- Adds whether this account may create an organization, and each organization's setup progress.
create or replace function public.my_console_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
    'can_create_organization', public.can_create_organization(),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'timezone', o.timezone, 'is_active', o.is_active,
        'role', coalesce(m.role, 'platform_admin'),
        'country_code', o.country_code, 'onboarding_step', o.onboarding_step,
        'onboarding_completed_at', o.onboarding_completed_at
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

revoke execute on function public.can_create_organization() from public, anon, authenticated;
revoke execute on function public.create_my_organization(text, text, text) from public, anon;
grant execute on function public.create_my_organization(text, text, text) to authenticated;
