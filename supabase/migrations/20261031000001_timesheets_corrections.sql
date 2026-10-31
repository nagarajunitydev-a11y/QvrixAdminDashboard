-- Phase 5: daily timesheets and manager corrections.
--
-- * Check-in sessions recorded by the app are never edited here. The app re-uploads its sessions
--   keyed on (user_id, site_id, entry_timestamp), so changing a stored session would create a
--   duplicate. A manager's change is stored beside it as a correction: add an entry, replace a
--   session's times, or remove a session. Corrections are never deleted; a newer one voids the
--   previous one, so every change keeps its author, time and reason.
-- * Timesheets are computed on the server from sessions, corrections, the employee's schedule,
--   holiday calendar and time-tracking policy, so the Console, the app and payroll read the same
--   numbers. They use the current schedule; approved pay periods (Phase 6) will keep their totals.

-- ---------------------------------------------------------------------------
-- 1. Corrections
-- ---------------------------------------------------------------------------

create table public.time_entry_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  employee_id uuid not null,
  kind text not null check (kind in ('add', 'replace', 'remove')),
  -- The app session this correction replaces or removes; null for an added entry.
  session_id bigint references public.presence_sessions (id),
  site_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  -- The correction this one took over from, if any.
  supersedes_id uuid references public.time_entry_corrections (id),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  constraint time_entry_corrections_employee_organization_fkey foreign key (employee_id, organization_id)
    references public.employees (id, organization_id),
  constraint time_entry_corrections_site_organization_fkey foreign key (site_id, organization_id)
    references public.sites (id, organization_id),
  constraint time_entry_corrections_target_check check ((kind = 'add') = (session_id is null)),
  constraint time_entry_corrections_times_check check (case
    when kind = 'remove' then start_at is null and end_at is null
    else start_at is not null and end_at is not null and end_at > start_at and end_at - start_at <= interval '24 hours'
  end),
  constraint time_entry_corrections_void_check check (
    (voided_at is null) = (void_reason is null)
    and (void_reason is null or char_length(btrim(void_reason)) between 3 and 500))
);
-- At most one correction in force per app session.
create unique index time_entry_corrections_one_active_per_session on public.time_entry_corrections (session_id)
  where session_id is not null and voided_at is null;
create index time_entry_corrections_employee_start_idx on public.time_entry_corrections (organization_id, employee_id, start_at);

create index presence_sessions_organization_entry_idx on public.presence_sessions (organization_id, entry_timestamp);

create trigger audit_time_entry_corrections_trigger after insert or update or delete on public.time_entry_corrections
  for each row execute function public.audit_trigger_func();

alter table public.time_entry_corrections enable row level security;
create policy time_entry_corrections_select on public.time_entry_corrections for select to authenticated
  using (organization_id in (select public.viewable_org_ids()));
-- Written only through the functions below.
revoke all on public.time_entry_corrections from anon, authenticated;
grant select on public.time_entry_corrections to authenticated;

-- ---------------------------------------------------------------------------
-- 2. What applies to each employee: schedule, holiday calendar and policy
--    (employee, then department, then the organization default)
-- ---------------------------------------------------------------------------

create function public.timesheet_scope(p_organization_id uuid, p_from date, p_employee_ids uuid[])
returns table (
  employee_id uuid, user_id uuid,
  -- Last day an archived employee belonged to the organization, in its time zone.
  archived_on date,
  schedule_id uuid, schedule_name text, schedule_type text, start_time time, end_time time,
  working_days smallint[], day_times jsonb, daily_minutes integer, breaks jsonb,
  auto_break_minutes integer, auto_break_after_minutes integer, day_split_time time,
  overtime_daily_after_minutes integer, overtime_double_after_minutes integer, overtime_weekly_after_minutes integer,
  overtime_rest_day_rate numeric, overtime_holiday_rate numeric,
  calendar_id uuid,
  early_clock_in_minutes integer, block_outside_schedule boolean,
  auto_clock_out_after_minutes integer, auto_clock_out_at time
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.user_id,
    (e.archived_at at time zone (select o.timezone from public.organizations o where o.id = e.organization_id))::date,
    s.id, s.name, s.schedule_type, s.start_time, s.end_time, s.working_days, s.day_times, s.daily_minutes, s.breaks,
    s.auto_break_minutes, s.auto_break_after_minutes, coalesce(s.day_split_time, '00:00'),
    s.overtime_daily_after_minutes, s.overtime_double_after_minutes, s.overtime_weekly_after_minutes,
    s.overtime_rest_day_rate, s.overtime_holiday_rate,
    coalesce(e.holiday_calendar_id, d.holiday_calendar_id, dc.id),
    p.early_clock_in_minutes, coalesce(p.block_outside_schedule, false),
    p.auto_clock_out_after_minutes, p.auto_clock_out_at
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.shifts ds on ds.organization_id = e.organization_id and ds.is_default
  left join public.shifts s on s.id = coalesce(e.shift_id, d.shift_id, ds.id)
  left join public.holiday_calendars dc on dc.organization_id = e.organization_id and dc.is_default
  left join lateral (
    select tp.early_clock_in_minutes, tp.block_outside_schedule, tp.auto_clock_out_after_minutes, tp.auto_clock_out_at
    from public.time_tracking_policies tp
    where tp.organization_id = e.organization_id and (tp.department_id = e.department_id or tp.department_id is null)
    order by tp.department_id nulls last
    limit 1
  ) p on true
  where e.organization_id = p_organization_id
    and (p_employee_ids is null or e.id = any (p_employee_ids))
    and (e.archived_at is null or e.archived_at >= p_from);
$$;

-- ---------------------------------------------------------------------------
-- 3. Time entries: app sessions with any correction applied, plus added entries
-- ---------------------------------------------------------------------------

create type public.timesheet_entry as (
  employee_id uuid,
  work_date date,
  -- 'app' for a session recorded by the app, 'manual' for an entry a manager added.
  source text,
  session_id bigint,
  correction_id uuid,
  site_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  -- End used for the timesheet: the recorded or corrected end, the policy's automatic check-out,
  -- or now for a session in progress. Null when the entry does not count.
  effective_end timestamptz,
  -- What the app recorded, for sessions a manager corrected.
  recorded_start timestamptz,
  recorded_end timestamptz,
  -- 'recorded', 'corrected', 'added' or 'removed'.
  status text,
  -- 'closed', 'in_progress', 'missing_check_out' or 'auto_check_out'.
  end_state text
);

create function public.timesheet_entry_rows(p_organization_id uuid, p_from date, p_to date, p_employee_ids uuid[])
returns setof public.timesheet_entry
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := (select o.timezone from public.organizations o where o.id = p_organization_id);
  -- Wide enough for any day split time; entries are then placed on their workday.
  v_lo timestamptz := (p_from - 1)::timestamp at time zone v_tz;
  v_hi timestamptz := (p_to + 2)::timestamp at time zone v_tz;
begin
  return query
  with scope as (
    select * from public.timesheet_scope(p_organization_id, p_from, p_employee_ids)
  ),
  raw as (
    select sc.employee_id, 'app'::text as source, ps.id as session_id, c.id as correction_id,
      coalesce(c.site_id, ps.site_id) as site_id,
      case when c.kind = 'replace' then c.start_at else to_timestamp(ps.entry_timestamp / 1000.0) end as start_at,
      case when c.kind = 'replace' then c.end_at
        when ps.exit_timestamp is not null then to_timestamp(ps.exit_timestamp / 1000.0) end as end_at,
      to_timestamp(ps.entry_timestamp / 1000.0) as recorded_start,
      case when ps.exit_timestamp is not null then to_timestamp(ps.exit_timestamp / 1000.0) end as recorded_end,
      case c.kind when 'replace' then 'corrected' when 'remove' then 'removed' else 'recorded' end as status
    from public.presence_sessions ps
    join scope sc on sc.user_id = ps.user_id
    left join public.time_entry_corrections c on c.session_id = ps.id and c.voided_at is null
    where ps.organization_id = p_organization_id
      and ps.entry_timestamp >= extract(epoch from v_lo) * 1000
      and ps.entry_timestamp < extract(epoch from v_hi) * 1000
    union all
    select c.employee_id, 'manual', null, c.id, c.site_id, c.start_at, c.end_at, null, null, 'added'
    from public.time_entry_corrections c
    join scope sc on sc.employee_id = c.employee_id
    where c.organization_id = p_organization_id and c.kind = 'add' and c.voided_at is null
      and c.start_at >= v_lo and c.start_at < v_hi
  ),
  placed as (
    select r.*,
      ((r.start_at at time zone v_tz) - sc.day_split_time::interval)::date as work_date,
      -- The policy's automatic check-out applies to what the app recorded, not to a manager's times.
      case when r.status = 'recorded' then least(
        r.start_at + make_interval(mins => sc.auto_clock_out_after_minutes),
        case when sc.auto_clock_out_at is not null then (
          (r.start_at at time zone v_tz)::date + sc.auto_clock_out_at
          + case when (r.start_at at time zone v_tz)::date + sc.auto_clock_out_at <= (r.start_at at time zone v_tz)
              then interval '1 day' else interval '0' end
        ) at time zone v_tz end
      ) end as cap
    from raw r
    join scope sc on sc.employee_id = r.employee_id
  )
  select p.employee_id, p.work_date, p.source, p.session_id, p.correction_id, p.site_id, p.start_at, p.end_at,
    case
      when p.status = 'removed' then null
      when p.end_at is not null then least(p.end_at, p.cap)
      when p.cap is not null and p.cap <= now() then p.cap
      -- An open session is in progress for up to a day; after that its end is unknown.
      when p.start_at > now() - interval '24 hours' then least(now(), p.cap)
    end,
    p.recorded_start, p.recorded_end, p.status,
    case
      when p.status = 'removed' then 'closed'
      when p.cap is not null and p.cap < coalesce(p.end_at, now()) then 'auto_check_out'
      when p.end_at is not null then 'closed'
      when p.start_at > now() - interval '24 hours' then 'in_progress'
      else 'missing_check_out'
    end
  from placed p
  where p.work_date between p_from and p_to;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Daily timesheet
-- ---------------------------------------------------------------------------

create type public.timesheet_day as (
  employee_id uuid,
  work_date date,
  -- 'working', 'rest', 'holiday', or 'unscheduled' when no schedule applies.
  day_type text,
  holiday_name text,
  schedule_id uuid,
  schedule_name text,
  first_in timestamptz,
  last_out timestamptz,
  entry_count integer,
  manual_count integer,
  -- Time between check-in and check-out, overlapping entries counted once.
  tracked_minutes integer,
  -- Unpaid break time deducted from tracked time.
  break_minutes integer,
  payroll_minutes integer,
  planned_minutes integer,
  regular_minutes integer,
  overtime_daily_minutes integer,
  overtime_double_minutes integer,
  overtime_weekly_minutes integer,
  overtime_rest_day_minutes integer,
  overtime_holiday_minutes integer,
  late_minutes integer,
  early_out_minutes integer,
  flags text[]
);

create function public.compute_timesheet(p_organization_id uuid, p_from date, p_to date, p_employee_ids uuid[])
returns setof public.timesheet_day
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := (select o.timezone from public.organizations o where o.id = p_organization_id);
  v_today date;
  -- Weekly overtime counts from Monday, so start there even if the range starts later.
  v_week_start date := p_from - (extract(isodow from p_from)::integer - 1);
  r record;
  v_day public.timesheet_day;
  v_employee uuid;
  v_week date;
  v_week_regular integer := 0;
  v_weekday integer;
  v_start_t time;
  v_end_t time;
  v_span integer;
  v_sched_start timestamptz;
  v_sched_end timestamptz;
  v_union_seconds numeric;
  v_unpaid_all integer;
  v_deducted numeric;
  v_break jsonb;
  v_bs time;
  v_be time;
  v_ws timestamptz;
  v_overlap numeric;
begin
  v_today := (now() at time zone v_tz)::date;
  for r in
    with scope as (
      select * from public.timesheet_scope(p_organization_id, v_week_start, p_employee_ids)
    ),
    entries as (
      select * from public.timesheet_entry_rows(p_organization_id, v_week_start, p_to, p_employee_ids)
    ),
    per_day as (
      select en.employee_id as entry_employee, en.work_date as entry_date,
        range_agg(tstzrange(en.start_at, en.effective_end)) filter (where en.effective_end > en.start_at) as worked,
        coalesce(sum(extract(epoch from en.effective_end - en.start_at)) filter (where en.effective_end > en.start_at), 0) as raw_seconds,
        min(en.start_at) filter (where en.status <> 'removed') as first_in,
        max(en.start_at) filter (where en.status <> 'removed') as last_start,
        max(en.effective_end) as last_out,
        count(*) filter (where en.status <> 'removed') as entry_count,
        count(*) filter (where en.status in ('added', 'corrected')) as manual_count,
        bool_or(en.end_state = 'in_progress') as in_progress,
        bool_or(en.end_state = 'missing_check_out') as missing,
        bool_or(en.end_state = 'auto_check_out') as auto_out,
        bool_or(en.effective_end - en.start_at > interval '16 hours') as long_entry
      from entries en
      group by en.employee_id, en.work_date
    )
    select sc.*, g.d::date as work_day, h.name as holiday_name,
      pd.worked, coalesce(pd.raw_seconds, 0) as raw_seconds, pd.first_in, pd.last_start, pd.last_out,
      coalesce(pd.entry_count, 0)::integer as entry_count, coalesce(pd.manual_count, 0)::integer as manual_count,
      coalesce(pd.in_progress, false) as in_progress, coalesce(pd.missing, false) as missing,
      coalesce(pd.auto_out, false) as auto_out, coalesce(pd.long_entry, false) as long_entry
    from scope sc
    cross join generate_series(v_week_start, p_to, interval '1 day') as g(d)
    left join public.holidays h on h.calendar_id = sc.calendar_id and h.holiday_date = g.d::date
    left join per_day pd on pd.entry_employee = sc.employee_id and pd.entry_date = g.d::date
    order by sc.employee_id, g.d
  loop
    v_weekday := extract(isodow from r.work_day)::integer;
    if r.employee_id is distinct from v_employee or r.work_day - (v_weekday - 1) <> v_week then
      v_employee := r.employee_id;
      v_week := r.work_day - (v_weekday - 1);
      v_week_regular := 0;
    end if;

    v_day := null;
    v_day.employee_id := r.employee_id;
    v_day.work_date := r.work_day;
    v_day.holiday_name := r.holiday_name;
    v_day.schedule_id := r.schedule_id;
    v_day.schedule_name := r.schedule_name;
    v_day.first_in := r.first_in;
    v_day.last_out := case when r.in_progress then null else r.last_out end;
    v_day.entry_count := r.entry_count;
    v_day.manual_count := r.manual_count;
    v_day.day_type := case
      when r.holiday_name is not null then 'holiday'
      when r.schedule_id is null then 'unscheduled'
      when v_weekday = any (r.working_days) then 'working'
      else 'rest'
    end;

    -- Scheduled hours on this day (usual hours for flexible schedules).
    if r.schedule_id is not null then
      v_start_t := coalesce((r.day_times -> v_weekday::text ->> 'start')::time, r.start_time);
      v_end_t := coalesce((r.day_times -> v_weekday::text ->> 'end')::time, r.end_time);
      v_sched_start := (r.work_day + v_start_t
        + case when v_start_t < r.day_split_time then interval '1 day' else interval '0' end) at time zone v_tz;
      v_span := (extract(epoch from v_end_t - v_start_t
        + case when v_end_t <= v_start_t then interval '1 day' else interval '0' end) / 60)::integer;
      v_sched_end := v_sched_start + make_interval(mins => v_span);
    end if;

    v_union_seconds := coalesce((select sum(extract(epoch from upper(x) - lower(x))) from unnest(r.worked) as x), 0);
    v_day.tracked_minutes := round(v_union_seconds / 60);

    -- Unpaid breaks: the worked time inside each break's window, up to its length. Breaks without a
    -- window are deducted once the app records them; the automatic break covers days without one.
    v_unpaid_all := 0;
    v_deducted := 0;
    for v_break in select value from jsonb_array_elements(coalesce(r.breaks, '[]'::jsonb)) loop
      if not (v_break ->> 'paid')::boolean then
        v_unpaid_all := v_unpaid_all + (v_break ->> 'minutes')::integer;
        if v_break ? 'start' and r.worked is not null then
          v_bs := (v_break ->> 'start')::time;
          v_be := (v_break ->> 'end')::time;
          v_ws := (r.work_day + v_bs + case when v_bs < r.day_split_time then interval '1 day' else interval '0' end) at time zone v_tz;
          v_overlap := coalesce((
            select sum(extract(epoch from upper(x) - lower(x)))
            from unnest(r.worked * tstzmultirange(tstzrange(v_ws,
              v_ws + (v_be - v_bs + case when v_be <= v_bs then interval '1 day' else interval '0' end)))) as x
          ), 0) / 60;
          v_deducted := v_deducted + least(v_overlap, (v_break ->> 'minutes')::integer);
        end if;
      end if;
    end loop;
    if r.auto_break_minutes is not null and v_day.tracked_minutes > r.auto_break_after_minutes then
      v_deducted := greatest(v_deducted, r.auto_break_minutes);
    end if;
    v_day.break_minutes := least(round(v_deducted), v_day.tracked_minutes);
    v_day.payroll_minutes := v_day.tracked_minutes - v_day.break_minutes;

    v_day.planned_minutes := case
      when r.schedule_id is null then null
      when v_day.day_type in ('rest', 'holiday') then 0
      when r.schedule_type = 'fixed' then greatest(v_span - v_unpaid_all, 0)
      when r.schedule_type = 'flexible' then r.daily_minutes
    end;

    -- Overtime. Work on a holiday or rest day counts at that day's rate when the schedule has one;
    -- otherwise the daily thresholds apply. Weekly overtime takes the regular time past the weekly
    -- threshold, on the days that cross it.
    v_day.overtime_daily_minutes := 0;
    v_day.overtime_double_minutes := 0;
    v_day.overtime_weekly_minutes := 0;
    v_day.overtime_rest_day_minutes := 0;
    v_day.overtime_holiday_minutes := 0;
    if v_day.day_type = 'holiday' and r.overtime_holiday_rate is not null then
      v_day.overtime_holiday_minutes := v_day.payroll_minutes;
    elsif v_day.day_type = 'rest' and r.overtime_rest_day_rate is not null then
      v_day.overtime_rest_day_minutes := v_day.payroll_minutes;
    else
      if r.overtime_double_after_minutes is not null then
        v_day.overtime_double_minutes := greatest(v_day.payroll_minutes - r.overtime_double_after_minutes, 0);
      end if;
      if r.overtime_daily_after_minutes is not null then
        v_day.overtime_daily_minutes := greatest(
          least(v_day.payroll_minutes, coalesce(r.overtime_double_after_minutes, v_day.payroll_minutes))
          - r.overtime_daily_after_minutes, 0);
      end if;
    end if;
    v_day.regular_minutes := v_day.payroll_minutes - v_day.overtime_daily_minutes - v_day.overtime_double_minutes
      - v_day.overtime_rest_day_minutes - v_day.overtime_holiday_minutes;
    if r.overtime_weekly_after_minutes is not null and v_day.regular_minutes > 0 then
      v_day.overtime_weekly_minutes :=
        greatest(v_week_regular + v_day.regular_minutes - r.overtime_weekly_after_minutes, 0)
        - greatest(v_week_regular - r.overtime_weekly_after_minutes, 0);
      v_week_regular := v_week_regular + v_day.regular_minutes;
      v_day.regular_minutes := v_day.regular_minutes - v_day.overtime_weekly_minutes;
    end if;

    v_day.late_minutes := 0;
    v_day.early_out_minutes := 0;
    if r.schedule_type = 'fixed' and v_day.day_type = 'working' and r.first_in is not null then
      v_day.late_minutes := greatest(round(extract(epoch from r.first_in - v_sched_start) / 60), 0);
      if v_day.last_out is not null then
        v_day.early_out_minutes := greatest(round(extract(epoch from v_sched_end - v_day.last_out) / 60), 0);
      end if;
    end if;

    v_day.flags := array[]::text[];
    if v_day.day_type = 'working' and coalesce(v_day.planned_minutes, 0) > 0 and r.entry_count = 0
       and ((r.schedule_type = 'fixed' and v_sched_end < now()) or (r.schedule_type = 'flexible' and r.work_day < v_today)) then
      v_day.flags := array_append(v_day.flags, 'absent');
    end if;
    if r.missing then v_day.flags := array_append(v_day.flags, 'missing_check_out'); end if;
    if r.in_progress then v_day.flags := array_append(v_day.flags, 'in_progress'); end if;
    if r.auto_out then v_day.flags := array_append(v_day.flags, 'auto_check_out'); end if;
    if r.manual_count > 0 then v_day.flags := array_append(v_day.flags, 'manual'); end if;
    if r.raw_seconds - v_union_seconds > 60 then v_day.flags := array_append(v_day.flags, 'overlap'); end if;
    if r.long_entry then v_day.flags := array_append(v_day.flags, 'long_entry'); end if;
    if v_day.late_minutes > 0 then v_day.flags := array_append(v_day.flags, 'late'); end if;
    if v_day.early_out_minutes > 0 then v_day.flags := array_append(v_day.flags, 'early_out'); end if;
    -- Policy rules the app will enforce once updated; until then the timesheet reports them.
    if r.schedule_id is not null and r.first_in is not null then
      if r.early_clock_in_minutes is not null and v_day.day_type = 'working'
         and r.first_in < v_sched_start - make_interval(mins => r.early_clock_in_minutes) then
        v_day.flags := array_append(v_day.flags, 'early_check_in');
      end if;
      if r.block_outside_schedule and (v_day.day_type in ('rest', 'holiday')
         or r.first_in < v_sched_start - make_interval(mins => coalesce(r.early_clock_in_minutes, 0))
         or r.last_start > v_sched_end) then
        v_day.flags := array_append(v_day.flags, 'outside_schedule');
      end if;
    end if;

    -- Days after an employee was archived are left out unless something was recorded on them.
    if r.work_day >= p_from and (r.archived_on is null or r.work_day <= r.archived_on or r.entry_count > 0) then
      return next v_day;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reading timesheets: Console roles for their organization, employees for themselves
-- ---------------------------------------------------------------------------

create function public.check_timesheet_range(p_from date, p_to date) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of up to 63 days' using errcode = '22023';
  end if;
end;
$$;

create function public.timesheet_days(p_organization_id uuid, p_from date, p_to date, p_employee_ids uuid[] default null)
returns setof public.timesheet_day
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.viewable_org_ids() as id where id = p_organization_id) then
    raise insufficient_privilege using message = 'You cannot view timesheets for this organization';
  end if;
  perform public.check_timesheet_range(p_from, p_to);
  return query select * from public.compute_timesheet(p_organization_id, p_from, p_to, p_employee_ids);
end;
$$;

create function public.timesheet_entries(p_organization_id uuid, p_employee_id uuid, p_from date, p_to date)
returns setof public.timesheet_entry
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.viewable_org_ids() as id where id = p_organization_id) then
    raise insufficient_privilege using message = 'You cannot view timesheets for this organization';
  end if;
  perform public.check_timesheet_range(p_from, p_to);
  return query select * from public.timesheet_entry_rows(p_organization_id, p_from, p_to, array[p_employee_id])
    order by start_at;
end;
$$;

create function public.my_timesheet(p_from date, p_to date)
returns setof public.timesheet_day
language plpgsql stable security definer set search_path = '' as $$
declare
  v_employee public.employees;
begin
  select * into v_employee from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then
    raise insufficient_privilege using message = 'This account has no active employee profile';
  end if;
  perform public.check_timesheet_range(p_from, p_to);
  return query select * from public.compute_timesheet(v_employee.organization_id, p_from, p_to, array[v_employee.id]);
end;
$$;

create function public.my_timesheet_entries(p_from date, p_to date)
returns setof public.timesheet_entry
language plpgsql stable security definer set search_path = '' as $$
declare
  v_employee public.employees;
begin
  select * into v_employee from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then
    raise insufficient_privilege using message = 'This account has no active employee profile';
  end if;
  perform public.check_timesheet_range(p_from, p_to);
  return query select * from public.timesheet_entry_rows(v_employee.organization_id, p_from, p_to, array[v_employee.id])
    order by start_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Corrections by managers. Times are given in the organization's time zone.
-- ---------------------------------------------------------------------------

create function public.prepare_time_correction(
  p_organization_id uuid, p_start timestamp, p_end timestamp, p_reason text,
  out start_at timestamptz, out end_at timestamptz, out reason text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := (select o.timezone from public.organizations o where o.id = p_organization_id);
begin
  if p_organization_id is null
     or not exists (select 1 from public.manageable_org_ids() as id where id = p_organization_id) then
    raise insufficient_privilege using message = 'Manager access is required to correct time entries';
  end if;
  reason := btrim(coalesce(p_reason, ''));
  if char_length(reason) not between 3 and 500 then
    raise exception 'Give a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  if p_start is null and p_end is null then
    return;
  end if;
  start_at := p_start at time zone v_tz;
  end_at := p_end at time zone v_tz;
  if start_at is null or end_at is null or end_at <= start_at then
    raise exception 'The end must be after the start' using errcode = '22023';
  end if;
  if end_at - start_at > interval '24 hours' then
    raise exception 'An entry can be at most 24 hours long' using errcode = '22023';
  end if;
  if end_at > now() + interval '5 minutes' then
    raise exception 'Entries cannot end in the future' using errcode = '22023';
  end if;
end;
$$;

-- The active correction for a session or the given correction, and the employee it belongs to.
create function public.locate_time_entry(p_session_id bigint, p_correction_id uuid,
  out organization_id uuid, out employee_id uuid, out session_id bigint, out site_id uuid,
  out active public.time_entry_corrections)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_session public.presence_sessions;
begin
  if (p_session_id is null) = (p_correction_id is null) then
    raise exception 'Choose one time entry' using errcode = '22023';
  end if;
  if p_session_id is not null then
    select * into v_session from public.presence_sessions ps where ps.id = p_session_id;
    if not found then
      raise exception 'Time entry not found' using errcode = 'P0002';
    end if;
    organization_id := v_session.organization_id;
    session_id := v_session.id;
    site_id := v_session.site_id;
    select e.id into employee_id from public.employees e
    where e.user_id = v_session.user_id and e.organization_id = v_session.organization_id;
    select * into active from public.time_entry_corrections c where c.session_id = p_session_id and c.voided_at is null;
  else
    select * into active from public.time_entry_corrections c where c.id = p_correction_id;
    if not found then
      raise exception 'Time entry not found' using errcode = 'P0002';
    end if;
    organization_id := active.organization_id;
    employee_id := active.employee_id;
    session_id := active.session_id;
    site_id := active.site_id;
  end if;
  -- Hide whether the entry exists from people who cannot manage its organization.
  if not exists (select 1 from public.manageable_org_ids() as id where id = organization_id) then
    raise insufficient_privilege using message = 'Manager access is required to correct time entries';
  end if;
  if employee_id is null then
    raise exception 'This check-in belongs to an account with no employee profile; link the account first'
      using errcode = '22023';
  end if;
  if p_correction_id is not null and active.voided_at is not null then
    raise exception 'This correction has already been changed; refresh and edit the current entry' using errcode = '22023';
  end if;
end;
$$;

create function public.void_time_correction(p_correction_id uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.time_entry_corrections
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = p_reason
  where id = p_correction_id and voided_at is null;
$$;

create function public.add_time_entry(p_employee_id uuid, p_site_id uuid, p_start timestamp, p_end timestamp, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (select e.organization_id from public.employees e where e.id = p_employee_id);
  v_times record;
  v_id uuid;
begin
  select * into v_times from public.prepare_time_correction(v_org, p_start, p_end, p_reason);
  if v_times.start_at is null then
    raise exception 'Give a start and an end' using errcode = '22023';
  end if;
  insert into public.time_entry_corrections (organization_id, employee_id, kind, site_id, start_at, end_at, reason, created_by)
  values (v_org, p_employee_id, 'add', p_site_id, v_times.start_at, v_times.end_at, v_times.reason, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.edit_time_entry(p_session_id bigint, p_correction_id uuid, p_site_id uuid,
  p_start timestamp, p_end timestamp, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_target record;
  v_times record;
  v_id uuid;
begin
  select * into v_target from public.locate_time_entry(p_session_id, p_correction_id);
  select * into v_times from public.prepare_time_correction(v_target.organization_id, p_start, p_end, p_reason);
  if v_times.start_at is null then
    raise exception 'Give a start and an end' using errcode = '22023';
  end if;
  if (v_target.active).id is not null then
    perform public.void_time_correction((v_target.active).id, 'Replaced by a newer correction');
  end if;
  insert into public.time_entry_corrections (organization_id, employee_id, kind, session_id, site_id, start_at, end_at,
    reason, supersedes_id, created_by)
  values (v_target.organization_id, v_target.employee_id,
    case when v_target.session_id is null then 'add' else 'replace' end,
    v_target.session_id, coalesce(p_site_id, v_target.site_id), v_times.start_at, v_times.end_at,
    v_times.reason, (v_target.active).id, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.remove_time_entry(p_session_id bigint, p_correction_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_target record;
  v_times record;
  v_id uuid;
begin
  select * into v_target from public.locate_time_entry(p_session_id, p_correction_id);
  select * into v_times from public.prepare_time_correction(v_target.organization_id, null, null, p_reason);
  if (v_target.active).kind = 'remove' then
    raise exception 'This entry is already removed' using errcode = '22023';
  end if;
  if (v_target.active).id is not null then
    perform public.void_time_correction((v_target.active).id,
      case when v_target.session_id is null then v_times.reason else 'Replaced by a newer correction' end);
  end if;
  -- An added entry is simply withdrawn; an app session gets a removal record.
  if v_target.session_id is null then
    return (v_target.active).id;
  end if;
  insert into public.time_entry_corrections (organization_id, employee_id, kind, session_id, reason, supersedes_id, created_by)
  values (v_target.organization_id, v_target.employee_id, 'remove', v_target.session_id, v_times.reason,
    (v_target.active).id, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Goes back to what the app recorded for a session.
create function public.restore_time_entry(p_session_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target record;
  v_times record;
begin
  select * into v_target from public.locate_time_entry(p_session_id, null);
  select * into v_times from public.prepare_time_correction(v_target.organization_id, null, null, p_reason);
  if (v_target.active).id is null then
    raise exception 'This entry has no correction to undo' using errcode = '22023';
  end if;
  perform public.void_time_correction((v_target.active).id, v_times.reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.timesheet_scope(uuid, date, uuid[]), public.timesheet_entry_rows(uuid, date, date, uuid[]),
  public.compute_timesheet(uuid, date, date, uuid[]), public.check_timesheet_range(date, date),
  public.prepare_time_correction(uuid, timestamp, timestamp, text), public.locate_time_entry(bigint, uuid),
  public.void_time_correction(uuid, text)
from public, anon, authenticated;

revoke execute on function
  public.timesheet_days(uuid, date, date, uuid[]), public.timesheet_entries(uuid, uuid, date, date),
  public.my_timesheet(date, date), public.my_timesheet_entries(date, date),
  public.add_time_entry(uuid, uuid, timestamp, timestamp, text),
  public.edit_time_entry(bigint, uuid, uuid, timestamp, timestamp, text),
  public.remove_time_entry(bigint, uuid, text), public.restore_time_entry(bigint, text)
from public, anon;

grant execute on function
  public.timesheet_days(uuid, date, date, uuid[]), public.timesheet_entries(uuid, uuid, date, date),
  public.my_timesheet(date, date), public.my_timesheet_entries(date, date),
  public.add_time_entry(uuid, uuid, timestamp, timestamp, text),
  public.edit_time_entry(bigint, uuid, uuid, timestamp, timestamp, text),
  public.remove_time_entry(bigint, uuid, text), public.restore_time_entry(bigint, text)
to authenticated;
