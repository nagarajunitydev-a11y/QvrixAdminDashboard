-- Timesheets leave out the days before an employee joined.
--
-- compute_timesheet (20261031000001) listed every day of the range, so employees added this month
-- were marked absent on every earlier working day. A day now counts from the later of the employee's
-- hire date and the day their profile was added, unless something was recorded on it (for example an
-- entry a manager added for an earlier day). Nothing else in the calculation changes.

create or replace function public.compute_timesheet(p_organization_id uuid, p_from date, p_to date, p_employee_ids uuid[])
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
      -- First day the employee could have worked: the later of the hire date and the day the profile was added.
      greatest(e.hire_date, (e.created_at at time zone v_tz)::date) as employed_from,
      pd.worked, coalesce(pd.raw_seconds, 0) as raw_seconds, pd.first_in, pd.last_start, pd.last_out,
      coalesce(pd.entry_count, 0)::integer as entry_count, coalesce(pd.manual_count, 0)::integer as manual_count,
      coalesce(pd.in_progress, false) as in_progress, coalesce(pd.missing, false) as missing,
      coalesce(pd.auto_out, false) as auto_out, coalesce(pd.long_entry, false) as long_entry
    from scope sc
    join public.employees e on e.id = sc.employee_id
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

    -- Days before an employee joined or after they were archived are left out unless something was
    -- recorded on them, so nobody is absent before they started.
    if r.work_day >= p_from
       and (r.entry_count > 0 or ((r.employed_from is null or r.work_day >= r.employed_from)
         and (r.archived_on is null or r.work_day <= r.archived_on))) then
      return next v_day;
    end if;
  end loop;
end;
$$;

revoke execute on function public.compute_timesheet(uuid, date, date, uuid[]) from public, anon, authenticated;
