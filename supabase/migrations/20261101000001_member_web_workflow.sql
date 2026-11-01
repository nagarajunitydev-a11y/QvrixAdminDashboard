-- One account can be an employee in a team and own a separate organization.
-- Creation grants admin rights only in the newly created organization.
create or replace function public.can_create_organization() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null)
    and not public.is_platform_admin()
    and not exists (select 1 from public.organizations o where o.created_by = (select auth.uid()));
$$;

-- The caller never supplies a user id, employee id, organization or recorded timestamp.
-- Browser location is an observation, as with mobile GPS; it is not proof against location spoofing.
create function public.web_clock(p_action text, p_site_id uuid default null,
  p_latitude double precision default null, p_longitude double precision default null,
  p_accuracy double precision default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_employee public.employees;
  v_site public.sites;
  v_rules jsonb;
  v_policy jsonb;
  v_schedule record;
  v_now timestamptz := clock_timestamp();
  v_stamp bigint := floor(extract(epoch from v_now) * 1000)::bigint;
  v_id bigint;
  v_distance double precision;
  v_today date;
  v_day date;
  v_weekday integer;
  v_start_time time;
  v_end_time time;
  v_start timestamptz;
  v_end timestamptz;
  v_offset integer;
  v_in_window boolean := false;
  v_restricted boolean;
begin
  if v_uid is null then raise insufficient_privilege using message = 'Sign in before recording attendance'; end if;
  if p_action is null or p_action not in ('in', 'out', 'heartbeat') then
    raise exception 'Choose clock in, clock out or heartbeat' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('web-clock:' || v_uid::text, 0));
  select e.* into v_employee from public.employees e
  join public.organizations o on o.id = e.organization_id and o.is_active
  where e.user_id = v_uid and e.is_active for update of e;
  if not found then raise insufficient_privilege using message = 'Join an active team before recording attendance'; end if;

  select s.id into v_id from public.presence_sessions s
    where s.user_id = v_uid and s.organization_id = v_employee.organization_id and s.exit_timestamp is null
    order by s.entry_timestamp desc limit 1;
  if p_action = 'heartbeat' then
    update public.presence_sessions set last_heartbeat = v_stamp
      where user_id = v_uid and organization_id = v_employee.organization_id and exit_timestamp is null;
    return v_id;
  end if;
  if p_action = 'out' then
    if v_id is null then raise exception 'You are already clocked out' using errcode = '22023'; end if;
    -- Ending a shift remains possible after site assignments or device policies change.
    update public.presence_sessions set exit_timestamp = greatest(v_stamp, entry_timestamp), closed_by = 'employee'
      where user_id = v_uid and organization_id = v_employee.organization_id and exit_timestamp is null;
    return v_id;
  end if;
  if v_id is not null then raise exception 'You are already clocked in. Refresh your shift status.' using errcode = '22023'; end if;
  select s.* into v_site from public.sites s
  join public.employee_sites es on es.site_id = s.id and es.employee_id = v_employee.id
    and es.organization_id = v_employee.organization_id
  where s.id = p_site_id and s.organization_id = v_employee.organization_id;
  if not found then raise insufficient_privilege using message = 'Choose one of your assigned work sites'; end if;
  v_rules := public.work_rules_for_employee(v_employee.id);
  v_policy := v_rules -> 'policy';
  if (v_policy ->> 'lock_to_registered_device')::boolean then
    raise insufficient_privilege using message = 'Your team requires your registered Employee app for clock-in';
  end if;
  if p_latitude is null or p_longitude is null or p_accuracy is null
    or not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180)
    or not (p_accuracy between 0 and 1000) then
    raise exception 'A current GPS location with valid accuracy is required. Allow location access and try again.' using errcode = '22023';
  end if;
  v_distance := 6371000 * 2 * asin(least(1, sqrt(
    power(sin(radians(p_latitude - v_site.latitude) / 2), 2)
    + cos(radians(v_site.latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - v_site.longitude) / 2), 2))));
  if (v_policy ->> 'require_inside_site')::boolean and v_distance + p_accuracy > v_site.radius_in_meters then
    raise insufficient_privilege using message = 'Your location must be inside the assigned site geofence. Move closer and try again.';
  end if;

  v_today := (v_now at time zone (v_rules ->> 'timezone'))::date;
  select * into v_schedule from public.timesheet_scope(v_employee.organization_id, v_today - 1, array[v_employee.id]);
  v_restricted := v_schedule.block_outside_schedule or v_schedule.early_clock_in_minutes is not null;
  if v_restricted and v_schedule.schedule_id is not null then
    -- Include the previous overnight shift and tomorrow's early clock-in window. Day split matches timesheets.
    for v_offset in -1..1 loop
      v_day := v_today + v_offset;
      v_weekday := extract(isodow from v_day)::integer;
      if not (v_weekday = any(v_schedule.working_days)) then continue; end if;
      if v_schedule.block_outside_schedule and exists (
        select 1 from public.holidays h where h.calendar_id = v_schedule.calendar_id and h.holiday_date = v_day
      ) then continue; end if;
      if v_schedule.schedule_type = 'fixed' then
        v_start_time := coalesce((v_schedule.day_times -> v_weekday::text ->> 'start')::time, v_schedule.start_time);
        v_end_time := coalesce((v_schedule.day_times -> v_weekday::text ->> 'end')::time, v_schedule.end_time);
        v_start := (v_day + v_start_time + case when v_start_time < v_schedule.day_split_time then interval '1 day' else interval '0' end)
          at time zone (v_rules ->> 'timezone');
        v_end := v_start + (v_end_time - v_start_time + case when v_end_time <= v_start_time then interval '1 day' else interval '0' end);
        if v_now >= v_start - make_interval(mins => coalesce(v_schedule.early_clock_in_minutes, 0)) and v_now < v_end then
          v_in_window := true;
        end if;
      elsif v_day = v_today then
        v_in_window := true;
      end if;
    end loop;
    if not v_in_window then raise insufficient_privilege using message = 'Clock-in is outside your allowed work schedule'; end if;
  end if;
  insert into public.presence_sessions (user_id, site_id, entry_timestamp, last_heartbeat, is_synced)
    values (v_uid, v_site.id, v_stamp, v_stamp, true) returning id into v_id;
  insert into public.location_logs (user_id, site_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside, is_synced)
    values (v_uid, v_site.id, p_latitude, p_longitude, p_accuracy, v_distance, v_stamp, v_distance <= v_site.radius_in_meters, true);
  return v_id;
end;
$$;
revoke execute on function public.web_clock(text, uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.web_clock(text, uuid, double precision, double precision, double precision) to authenticated;
