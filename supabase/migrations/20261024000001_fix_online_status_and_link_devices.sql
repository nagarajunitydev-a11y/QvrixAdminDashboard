-- Fix online status tracking and link unlinked devices
-- 1. Add last_heartbeat column to presence_sessions for staleness detection
-- 2. Create function to auto-update heartbeat from location_logs
-- 3. Link existing unlinked devices to employees where verifiable

-- Add last_heartbeat column to presence_sessions
alter table if exists public.presence_sessions
add column if not exists last_heartbeat bigint;

-- Add index for efficient stale session queries
create index if not exists idx_presence_sessions_last_heartbeat
on presence_sessions (last_heartbeat desc);

-- Function to update session heartbeat from latest location log
-- This can be called periodically or via trigger
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

-- Grant execute permission
grant execute on function public.update_session_heartbeats() to authenticated;

-- Function to mark stale sessions as exited (cleanup)
-- Sessions with no heartbeat for more than 15 minutes are considered stale
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

-- Link existing unlinked devices to employees
-- This matches auth.users (with role='employee') to employees by email
-- and also links presence_sessions/location_logs user_ids to employees
do $$
declare
    v_user record;
    v_employee_id uuid;
    v_linked_count integer := 0;
    v_device_linked_count integer := 0;
begin
    -- First, ensure all auth.users with role='employee' have linked employee records
    -- (This is also done by the trigger, but this handles any that were missed)
    for v_user in
        select u.id as user_id, u.email
        from auth.users u
        where coalesce(nullif(u.raw_user_meta_data->>'role', ''), '') = 'employee'
          and u.email is not null
    loop
        -- Try to link to existing employee by email
        update public.employees
        set user_id = v_user.user_id,
            updated_at = now()
        where email = v_user.email
          and user_id is null;

        if found then
            v_linked_count := v_linked_count + 1;
        end if;
    end loop;

    -- Now link any presence_sessions user_ids that have auth.users with role='employee'
    -- but no employee record yet - create minimal employee records
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

-- Create a view for frontend to easily get online status with heartbeat
create or replace view public.employee_online_status as
select
    e.id as employee_id,
    e.user_id,
    e.first_name,
    e.last_name,
    e.email,
    case
        when ps.id is not null and ps.exit_timestamp is null
             and ps.last_heartbeat > extract(epoch from now()) * 1000 - 900000  -- 15 min
        then 'online'
        when ps.id is not null and ps.exit_timestamp is null
        then 'stale'
        when ll.timestamp > extract(epoch from now()) * 1000 - 3600000  -- 1 hour
        then 'recent'
        else 'offline'
    end as status,
    ps.id as session_id,
    ps.site_id,
    ps.entry_timestamp,
    ps.exit_timestamp,
    ps.last_heartbeat,
    ll.timestamp as last_location_timestamp,
    ll.latitude as last_latitude,
    ll.longitude as last_longitude,
    ll.is_inside as last_is_inside,
    ll.site_id as last_site_id
from public.employees e
left join lateral (
    select *
    from public.presence_sessions
    where user_id = e.user_id
      and exit_timestamp is null
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
where e.user_id is not null;

grant select on public.employee_online_status to authenticated;

-- Also create a view for unlinked devices (auth users with role=employee but no employee record yet)
create or replace view public.unlinked_devices as
select
    u.id as user_id,
    u.email,
    u.raw_user_meta_data->>'role' as role,
    u.created_at as user_created_at,
    ps.id as session_id,
    ps.site_id,
    ps.entry_timestamp,
    ps.exit_timestamp,
    ps.last_heartbeat,
    ll.timestamp as last_location_timestamp,
    ll.latitude as last_latitude,
    ll.longitude as last_longitude,
    ll.is_inside as last_is_inside,
    ll.site_id as last_site_id,
    case
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
      and exit_timestamp is null
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