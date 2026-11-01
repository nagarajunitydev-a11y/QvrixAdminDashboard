-- Explain a signed-in account's next step without confusing missing membership with employee access.
-- Does not change role grants, organization creation eligibility or row-level security.
create or replace function public.my_console_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_platform_admin', public.is_platform_admin(),
    'can_create_organization', public.can_create_organization(),
    'access_block_reason', case
      when public.can_create_organization() or public.is_platform_admin() then null
      when exists (select 1 from public.employees e
        where e.user_id = (select auth.uid()) and e.is_active) then 'employee'
      when exists (select 1 from auth.users u
        where u.id = (select auth.uid()) and u.email_confirmed_at is null) then 'confirm_email'
      when exists (select 1 from public.organizations o
        where o.created_by = (select auth.uid())) then 'organization_unavailable'
      else 'role_required'
    end,
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
