-- Fix employee linking, outside count, and checkout status
-- 1. Ensure employees are properly linked to auth.users
-- 2. Add checkout status tracking
-- 3. Create proper views for accurate status computation

-- ============================================================
-- 1. Fix employee linking - ensure all employees with auth users are linked
-- ============================================================

-- Re-run the linking logic to catch any missed records
do $$
declare
    v_user record;
    v_linked_count integer := 0;
    v_device_linked_count integer := 0;
begin
    -- Link auth.users with role='employee' to existing employee records by email
    for v_user in
        select u.id as user_id, u.email
        from auth.users u
        where coalesce(nullif(u.raw_user_meta_data->>'role', ''), '') = 'employee'
          and u.email is not null
    loop
        update public.employees
        set user_id = v_user.user_id,
            updated_at = now()
        where email = v_user.email
          and user_id is null;

        if found then
            v_linked_count := v_linked_count + 1;
        end if;
    end loop;

    -- Create employee records for auth.users with role='employee' that have presence data but no employee record
    for v_user in
        select distinct ps.user_id, u.email
        from public.presence_sessions ps
        join auth.users u on u.id = ps.user_id
        where coalesce(nullif(u.raw_user_meta_data->>'role', ''), '') = 'employee'
          and u.email is not null
          and not exists (select 1 from public.employees e where e.user_id = ps.user_id)
    loop
        insert into public.employees (user_id, first_name, last_name, email, is_active)
        values (
            v_user.user_id,
            case when v_user.email like '%@%' then split_part(v_user.email, '@', 1) else v_user.email end,
            '',
            v_user.email,
            true
        )
        on conflict (email) do update
        set user_id = excluded.user_id,
            updated_at = now()
        where employees.user_id is null;

        v_device_linked_count := v_device_linked_count + 1;
    end loop;

    -- Also link from location_logs for any users not in presence_sessions
    for v_user in
        select distinct ll.user_id, u.email
        from public.location_logs ll
        join auth.users u on u.id = ll.user_id
        where coalesce(nullif(u.raw_user_meta_data->>'role', ''), '') = 'employee'
          and u.email is not null
          and not exists (select 1 from public.employees e where e.user_id = ll.user_id)
    loop
        insert into public.employees (user_id, first_name, last_name, email, is_active)
        values (
            v_user.user_id,
            case when v_user.email like '%@%' then split_part(v_user.email, '@', 1) else v_user.email end,
            '',
            v_user.email,
            true
        )
        on conflict (email) do update
        set user_id = excluded.user_id,
            updated_at = now()
        where employees.user_id is null;

        v_device_linked_count := v_device_linked_count + 1;
    end loop;

    raise notice 'Linked % existing employee records, created % new employee records from devices', v_linked_count, v_device_linked_count;
end $$;

-- ============================================================
-- 2. Ensure last_heartbeat column exists and add checkout timestamp tracking
-- ============================================================

-- Add last_heartbeat column if not exists
alter table if exists public.presence_sessions
add column if not exists last_heartbeat bigint;

-- Add index for efficient stale session queries
create index if not exists idx_presence_sessions_last_heartbeat
on presence_sessions (last_heartbeat desc);

-- Add index for active sessions lookup
create index if not exists idx_presence_sessions_active
on presence_sessions (user_id, site_id) where exit_timestamp is null;

-- ============================================================
-- 3. Function to update session heartbeat from latest location log
-- ============================================================
create or replace function public.update_session_heartbeats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_updated integer := 0;
begin
    -- Update last_heartbeat for active sessions based on latest location log
    update public.presence_sessions ps
    set last_heartbeat = ll.timestamp
    from (
        select user_id, site_id, max(timestamp) as timestamp
        from public.location_logs
        where timestamp > extract(epoch from now()) * 1000 - 3600000  -- last hour
        group by user_id, site_id
    ) ll
    where ps.user_id = ll.user_id
      and ps.site_id = ll.site_id
      and ps.exit_timestamp is null
      and (ps.last_heartbeat is null or ps.last_heartbeat < ll.timestamp);

    get diagnostics v_updated = row_count;
    return v_updated;
end;
$$;

grant execute on function public.update_session_heartbeats() to authenticated;

-- ============================================================
-- 4. Function to mark stale sessions as exited (cleanup)
-- ============================================================
create or replace function public.mark_stale_sessions_exited(p_timeout_minutes integer default 15)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_updated integer := 0;
    v_cutoff bigint;
begin
    v_cutoff := extract(epoch from now()) * 1000 - (p_timeout_minutes * 60000);

    -- Exit sessions that have no heartbeat or stale heartbeat
    update public.presence_sessions
    set exit_timestamp = v_cutoff,
        total_hours = (v_cutoff - entry_timestamp) / 3600000.0,
        is_synced = false
    where exit_timestamp is null
      and (last_heartbeat is null or last_heartbeat < v_cutoff);

    get diagnostics v_updated = row_count;
    return v_updated;
end;
$$;

grant execute on function public.mark_stale_sessions_exited(integer) to authenticated;

-- ============================================================
-- 5. Create comprehensive view for employee online status with checkout support
-- ============================================================
drop view if exists public.employee_online_status;

create view public.employee_online_status as
select
    e.id as employee_id,
    e.user_id,
    e.first_name,
    e.last_name,
    e.email,
    e.is_active,
    case
        -- Checked out: session exists but has exit_timestamp
        when ps.id is not null and ps.exit_timestamp is not null
        then 'checked-out'
        -- Online: active session with recent heartbeat (15 min)
        when ps.id is not null and ps.exit_timestamp is null
             and ps.last_heartbeat > extract(epoch from now()) * 1000 - 900000
        then 'online'
        -- Stale: active session but no recent heartbeat
        when ps.id is not null and ps.exit_timestamp is null
        then 'stale'
        -- Recent location but no active session
        when ll.timestamp > extract(epoch from now()) * 1000 - 3600000
        then 'recent'
        else 'offline'
    end as status,
    ps.id as session_id,
    ps.site_id,
    ps.entry_timestamp,
    ps.exit_timestamp,
    ps.total_hours,
    ps.last_heartbeat,
    ll.timestamp as last_location_timestamp,
    ll.latitude as last_latitude,
    ll.longitude as last_longitude,
    ll.is_inside as last_is_inside,
    ll.site_id as last_site_id,
    ll.distance_to_site as last_distance_to_site
from public.employees e
left join lateral (
    select *
    from public.presence_sessions
    where user_id = e.user_id
    order by entry_timestamp desc
    limit 1
) ps on true
left join lateral (
    select *
    from public.location_logs
    where user_id = e.user_id
    order by timestamp desc
    limit 1
) ll on true
where e.user_id is not null and e.is_active = true;

grant select on public.employee_online_status to authenticated;

-- ============================================================
-- 6. Create view for unlinked devices (auth users with role=employee but no employee record)
-- ============================================================
drop view if exists public.unlinked_devices;

create view public.unlinked_devices as
select
    u.id as user_id,
    u.email,
    u.raw_user_meta_data->>'role' as role,
    u.created_at as user_created_at,
    ps.id as session_id,
    ps.site_id,
    ps.entry_timestamp,
    ps.exit_timestamp,
    ps.total_hours,
    ps.last_heartbeat,
    ll.timestamp as last_location_timestamp,
    ll.latitude as last_latitude,
    ll.longitude as last_longitude,
    ll.is_inside as last_is_inside,
    ll.site_id as last_site_id,
    case
        when ps.id is not null and ps.exit_timestamp is not null
        then 'checked-out'
        when ps.id is not null and ps.exit_timestamp is null
             and ps.last_heartbeat > extract(epoch from now()) * 1000 - 900000
        then 'online'
        when ps.id is not null and ps.exit_timestamp is null
        then 'stale'
        when ll.timestamp > extract(epoch from now()) * 1000 - 3600000
        then 'recent'
        else 'offline'
    end as status
from auth.users u
left join lateral (
    select *
    from public.presence_sessions
    where user_id = u.id
    order by entry_timestamp desc
    limit 1
) ps on true
left join lateral (
    select *
    from public.location_logs
    where user_id = u.id
    order by timestamp desc
    limit 1
) ll on true
where coalesce(nullif(u.raw_user_meta_data->>'role', ''), '') = 'employee'
  and u.email is not null
  and not exists (select 1 from public.employees e where e.user_id = u.id);

grant select on public.unlinked_devices to authenticated;

-- ============================================================
-- 7. Create view for accurate "outside site" count
-- Only counts employees with recent location showing outside geofence
-- ============================================================
drop view if exists public.employees_outside_site;

create view public.employees_outside_site as
select
    e.id as employee_id,
    e.user_id,
    e.first_name,
    e.last_name,
    e.email,
    ll.site_id,
    ll.timestamp,
    ll.is_inside,
    ll.distance_to_site,
    s.name as site_name,
    s.latitude as site_latitude,
    s.longitude as site_longitude,
    s.radius_in_meters
from public.employees e
join lateral (
    select *
    from public.location_logs
    where user_id = e.user_id
      and timestamp > extract(epoch from now()) * 1000 - 3600000  -- last hour
    order by timestamp desc
    limit 1
) ll on true
join public.sites s on s.id = ll.site_id
where e.user_id is not null
  and e.is_active = true
  and ll.is_inside = false
  and ll.distance_to_site > s.radius_in_meters;

grant select on public.employees_outside_site to authenticated;