-- Phase 4: work schedules, holiday calendars and the time-tracking policy.
--
-- Rollout compatibility
-- * Work schedules extend public.shifts in place. Installed Android builds read shifts through a
--   narrow DTO (id, name, start_time, end_time) and ignore the new columns. start_time and end_time
--   stay required, so every schedule still has the hours the app shows.
-- * Department defaults move to departments.shift_id, so one schedule can serve several departments.
--   The old shifts.department_id link is copied there and its foreign key dropped (PostgREST would
--   otherwise see two relationships between shifts and departments). The column itself is kept,
--   unused, so no stored value is lost.
-- * Attendance records and what employees can read directly are unchanged. The app reads its
--   effective schedule, policy and holidays through my_work_rules().
-- * These rules are stored here. The Android app applies them once updated, and timesheets
--   (Phase 5) use them to compute planned hours, breaks and overtime.

-- ---------------------------------------------------------------------------
-- 1. Work schedules (public.shifts)
-- ---------------------------------------------------------------------------

alter table public.shifts
  add column schedule_type text not null default 'fixed',
  -- ISO weekdays: 1 = Monday ... 7 = Sunday.
  add column working_days smallint[] not null default '{1,2,3,4,5}',
  -- Fixed schedules only: hours for particular weekdays, e.g. {"6": {"start": "09:00", "end": "13:00"}}.
  add column day_times jsonb not null default '{}',
  -- Flexible schedules: hours to work each working day. Weekly flexible: hours to work each week.
  add column daily_minutes integer,
  add column weekly_minutes integer,
  -- Up to 5 of {"name": text, "minutes": 1-240, "paid": boolean, "start"?: "HH:MM", "end"?: "HH:MM"}.
  add column breaks jsonb not null default '[]',
  -- Unpaid minutes deducted when a day's tracked time passes the threshold.
  add column auto_break_minutes integer,
  add column auto_break_after_minutes integer,
  -- Time of day at which one workday ends and the next begins, for night shifts.
  add column day_split_time time not null default '00:00',
  add column overtime_daily_after_minutes integer,
  add column overtime_daily_rate numeric(4,2),
  add column overtime_double_after_minutes integer,
  add column overtime_double_rate numeric(4,2),
  add column overtime_weekly_after_minutes integer,
  add column overtime_weekly_rate numeric(4,2),
  add column overtime_rest_day_rate numeric(4,2),
  add column overtime_holiday_rate numeric(4,2),
  -- Applies to employees with no schedule of their own and none from their department.
  add column is_default boolean not null default false;

alter table public.shifts
  add constraint shifts_schedule_type_check
    check (schedule_type in ('fixed', 'flexible', 'weekly_flexible')),
  add constraint shifts_working_days_check
    check (cardinality(working_days) between 1 and 7 and working_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  add constraint shifts_targets_check check (case schedule_type
    when 'fixed' then daily_minutes is null and weekly_minutes is null
    when 'flexible' then daily_minutes is not null and daily_minutes between 1 and 1440 and weekly_minutes is null
    else weekly_minutes is not null and weekly_minutes between 1 and 10080 and daily_minutes is null
  end),
  add constraint shifts_auto_break_check check (
    (auto_break_minutes is null) = (auto_break_after_minutes is null)
    and (auto_break_minutes is null
      or (auto_break_minutes between 1 and 240 and auto_break_after_minutes between 1 and 1440))),
  add constraint shifts_overtime_daily_check check (
    (overtime_daily_after_minutes is null) = (overtime_daily_rate is null)
    and (overtime_daily_after_minutes is null or overtime_daily_after_minutes between 1 and 1440)),
  add constraint shifts_overtime_double_check check (
    (overtime_double_after_minutes is null) = (overtime_double_rate is null)
    and (overtime_double_after_minutes is null or (overtime_daily_after_minutes is not null
      and overtime_double_after_minutes > overtime_daily_after_minutes
      and overtime_double_after_minutes <= 1440
      and overtime_double_rate >= overtime_daily_rate))),
  add constraint shifts_overtime_weekly_check check (
    (overtime_weekly_after_minutes is null) = (overtime_weekly_rate is null)
    and (overtime_weekly_after_minutes is null or overtime_weekly_after_minutes between 1 and 10080)),
  add constraint shifts_overtime_rates_check check (
    coalesce(overtime_daily_rate, 1) between 1 and 5 and coalesce(overtime_double_rate, 1) between 1 and 5
    and coalesce(overtime_weekly_rate, 1) between 1 and 5 and coalesce(overtime_rest_day_rate, 1) between 1 and 5
    and coalesce(overtime_holiday_rate, 1) between 1 and 5);

create unique index shifts_one_default_per_organization on public.shifts (organization_id) where is_default;

comment on column public.shifts.department_id is
  'Superseded by departments.shift_id in 20261031000000. Kept so no stored value is lost; no longer read or written.';
comment on column public.shifts.start_time is
  'Fixed: start of each working day unless day_times overrides it. Flexible: usual start, used for reminders and the outside-schedule rule.';

-- Readable messages for the parts a check constraint cannot describe. Each step runs only after the
-- previous one passed, because SQL does not promise to evaluate AND from left to right.
create function public.validate_work_schedule() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_clock constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  v_key text;
  v_value jsonb;
  v_ok boolean;
  v_unpaid integer := 0;
  v_day smallint;
  v_start time;
  v_end time;
begin
  new.working_days := array(select distinct d from unnest(new.working_days) as d order by d);
  if new.start_time = new.end_time then
    raise exception 'The start and end times must be different' using errcode = '22023';
  end if;

  if jsonb_typeof(new.breaks) is distinct from 'array' then
    raise exception 'Breaks must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(new.breaks) > 5 then
    raise exception 'A schedule can have up to 5 breaks' using errcode = '22023';
  end if;
  for v_value in select value from jsonb_array_elements(new.breaks) loop
    v_ok := jsonb_typeof(v_value) = 'object';
    if v_ok then
      v_ok := v_value - array['name', 'minutes', 'paid', 'start', 'end'] = '{}'::jsonb
        and jsonb_typeof(v_value -> 'name') is not distinct from 'string'
        and jsonb_typeof(v_value -> 'minutes') is not distinct from 'number'
        and jsonb_typeof(v_value -> 'paid') is not distinct from 'boolean'
        and (v_value ? 'start') = (v_value ? 'end');
    end if;
    if v_ok then
      v_ok := char_length(btrim(v_value ->> 'name')) between 1 and 40
        and (v_value ->> 'minutes') ~ '^[0-9]{1,3}$'
        and (not (v_value ? 'start')
          or (coalesce(v_value ->> 'start', '') ~ v_clock and coalesce(v_value ->> 'end', '') ~ v_clock
            and v_value ->> 'start' <> v_value ->> 'end'));
    end if;
    if v_ok then
      v_ok := (v_value ->> 'minutes')::integer between 1 and 240;
    end if;
    if not coalesce(v_ok, false) then
      raise exception 'Each break needs a name, a length of 1 to 240 minutes, whether it is paid, and an optional start and end time'
        using errcode = '22023';
    end if;
    if not (v_value ->> 'paid')::boolean then
      v_unpaid := v_unpaid + (v_value ->> 'minutes')::integer;
    end if;
  end loop;

  if jsonb_typeof(new.day_times) is distinct from 'object' then
    raise exception 'Day hours must be an object keyed by weekday' using errcode = '22023';
  end if;
  if new.schedule_type <> 'fixed' and new.day_times <> '{}'::jsonb then
    raise exception 'Only fixed schedules can set different hours for particular days' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(new.day_times) loop
    v_ok := v_key ~ '^[1-7]$';
    if v_ok then
      v_ok := v_key::smallint = any (new.working_days);
    end if;
    if not v_ok then
      raise exception 'Only working days can have their own hours' using errcode = '22023';
    end if;
    v_ok := jsonb_typeof(v_value) = 'object';
    if v_ok then
      v_ok := v_value - array['start', 'end'] = '{}'::jsonb
        and coalesce(v_value ->> 'start', '') ~ v_clock and coalesce(v_value ->> 'end', '') ~ v_clock
        and v_value ->> 'start' <> v_value ->> 'end';
    end if;
    if not coalesce(v_ok, false) then
      raise exception 'Each day with its own hours needs different start and end times (HH:MM)' using errcode = '22023';
    end if;
  end loop;

  -- On a fixed schedule, unpaid breaks must leave working time on every day.
  if new.schedule_type = 'fixed' and v_unpaid > 0 then
    foreach v_day in array new.working_days loop
      v_start := coalesce((new.day_times -> v_day::text ->> 'start')::time, new.start_time);
      v_end := coalesce((new.day_times -> v_day::text ->> 'end')::time, new.end_time);
      if v_unpaid >= extract(epoch from (v_end - v_start + case when v_end <= v_start then interval '1 day' else interval '0' end)) / 60 then
        raise exception 'Unpaid breaks must be shorter than every working day' using errcode = '22023';
      end if;
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger shifts_20_validate_schedule before insert or update on public.shifts
  for each row execute function public.validate_work_schedule();

-- Making a record the organization default hands the role over from the previous one.
-- SECURITY INVOKER: the caller's own update rights apply to the record that loses the role.
create function public.keep_single_default() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_default and (tg_op = 'INSERT' or not old.is_default) then
    execute format('update public.%I set is_default = false where organization_id = $1 and is_default and id <> $2', tg_table_name)
      using new.organization_id, new.id;
  end if;
  return new;
end;
$$;

create trigger shifts_15_single_default before insert or update of is_default on public.shifts
  for each row execute function public.keep_single_default();

-- ---------------------------------------------------------------------------
-- 2. Holiday calendars
-- ---------------------------------------------------------------------------

create table public.holiday_calendars (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Applies to employees with no calendar of their own and none from their department.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holiday_calendars_id_organization_key unique (id, organization_id)
);
create unique index holiday_calendars_organization_name_key on public.holiday_calendars (organization_id, lower(btrim(name)));
create unique index holiday_calendars_one_default_per_organization on public.holiday_calendars (organization_id) where is_default;

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  calendar_id uuid not null,
  holiday_date date not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  constraint holidays_calendar_organization_fkey foreign key (calendar_id, organization_id)
    references public.holiday_calendars (id, organization_id) on delete cascade,
  constraint holidays_calendar_date_key unique (calendar_id, holiday_date)
);
create index holidays_organization_date_idx on public.holidays (organization_id, holiday_date);

-- A holiday belongs to its calendar's organization. RLS still decides whether the caller may write it.
create function public.stamp_holiday_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.organization_id := coalesce(
    (select c.organization_id from public.holiday_calendars c where c.id = new.calendar_id),
    new.organization_id);
  return new;
end;
$$;

create trigger holiday_calendars_10_default_organization before insert on public.holiday_calendars
  for each row execute function public.default_managed_organization();
create trigger holiday_calendars_15_single_default before insert or update of is_default on public.holiday_calendars
  for each row execute function public.keep_single_default();
create trigger holiday_calendars_20_touch before update on public.holiday_calendars
  for each row execute function public.touch_updated_at();
create trigger holidays_10_stamp_organization before insert on public.holidays
  for each row execute function public.stamp_holiday_organization();

-- ---------------------------------------------------------------------------
-- 3. Department and employee choices. Resolution order: employee, then department, then the
--    organization default. A record in use cannot be deleted (the foreign keys block it).
-- ---------------------------------------------------------------------------

alter table public.departments
  add column shift_id uuid,
  add column holiday_calendar_id uuid,
  add constraint departments_shift_organization_fkey foreign key (shift_id, organization_id)
    references public.shifts (id, organization_id),
  add constraint departments_holiday_calendar_organization_fkey foreign key (holiday_calendar_id, organization_id)
    references public.holiday_calendars (id, organization_id);

alter table public.employees
  add column holiday_calendar_id uuid,
  add constraint employees_holiday_calendar_organization_fkey foreign key (holiday_calendar_id, organization_id)
    references public.holiday_calendars (id, organization_id);

-- Carry the old shift-to-department link over: each department gets its earliest linked schedule.
update public.departments d set shift_id = s.id
from (
  select distinct on (department_id) id, department_id
  from public.shifts where department_id is not null
  order by department_id, created_at, id
) s
where s.department_id = d.id;

alter table public.shifts drop constraint shifts_department_organization_fkey;

create index departments_shift_idx on public.departments (shift_id) where shift_id is not null;
create index employees_shift_idx on public.employees (shift_id) where shift_id is not null;
create index departments_holiday_calendar_idx on public.departments (holiday_calendar_id) where holiday_calendar_id is not null;
create index employees_holiday_calendar_idx on public.employees (holiday_calendar_id) where holiday_calendar_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Time-tracking policy: one for the organization, optionally replaced per department
-- ---------------------------------------------------------------------------

create table public.time_tracking_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- Null for the organization policy; otherwise this department's replacement for it.
  department_id uuid,
  require_inside_site boolean not null default false,
  lock_to_registered_device boolean not null default false,
  -- Null: no limit on how early someone may check in before their schedule starts.
  early_clock_in_minutes integer check (early_clock_in_minutes between 0 and 720),
  block_outside_schedule boolean not null default false,
  auto_clock_out_after_minutes integer check (auto_clock_out_after_minutes between 30 and 1440),
  auto_clock_out_at time,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_tracking_policies_department_organization_fkey foreign key (department_id, organization_id)
    references public.departments (id, organization_id) on delete cascade,
  constraint time_tracking_policies_scope_key unique nulls not distinct (organization_id, department_id)
);

create function public.stamp_policy_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

create trigger time_tracking_policies_10_default_organization before insert on public.time_tracking_policies
  for each row execute function public.default_managed_organization();
create trigger time_tracking_policies_20_stamp before insert or update on public.time_tracking_policies
  for each row execute function public.stamp_policy_change();

do $$
declare
  v_table text;
begin
  foreach v_table in array array['holiday_calendars', 'holidays', 'time_tracking_policies'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_organization_change()',
      v_table || '_05_keep_organization', v_table);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger_func()',
      'audit_' || v_table || '_trigger', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Effective rules for one employee, and the app's read of its own
-- ---------------------------------------------------------------------------

create function public.work_rules_for_employee(p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_employee public.employees;
  v_department public.departments;
  v_shift public.shifts;
  v_shift_source text;
  v_calendar public.holiday_calendars;
  v_calendar_source text;
  v_policy public.time_tracking_policies;
  v_policy_source text := 'default';
  v_timezone text;
  v_today date;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then
    return null;
  end if;
  select * into v_department from public.departments where id = v_employee.department_id;
  select o.timezone into v_timezone from public.organizations o where o.id = v_employee.organization_id;
  v_today := (now() at time zone v_timezone)::date;

  if v_employee.shift_id is not null then
    select * into v_shift from public.shifts where id = v_employee.shift_id;
    v_shift_source := 'employee';
  elsif v_department.shift_id is not null then
    select * into v_shift from public.shifts where id = v_department.shift_id;
    v_shift_source := 'department';
  else
    select * into v_shift from public.shifts where organization_id = v_employee.organization_id and is_default;
    v_shift_source := case when found then 'organization' end;
  end if;

  if v_employee.holiday_calendar_id is not null then
    select * into v_calendar from public.holiday_calendars where id = v_employee.holiday_calendar_id;
    v_calendar_source := 'employee';
  elsif v_department.holiday_calendar_id is not null then
    select * into v_calendar from public.holiday_calendars where id = v_department.holiday_calendar_id;
    v_calendar_source := 'department';
  else
    select * into v_calendar from public.holiday_calendars where organization_id = v_employee.organization_id and is_default;
    v_calendar_source := case when found then 'organization' end;
  end if;

  if v_employee.department_id is not null then
    select * into v_policy from public.time_tracking_policies
    where organization_id = v_employee.organization_id and department_id = v_employee.department_id;
    if found then v_policy_source := 'department'; end if;
  end if;
  if v_policy_source = 'default' then
    select * into v_policy from public.time_tracking_policies
    where organization_id = v_employee.organization_id and department_id is null;
    if found then v_policy_source := 'organization'; end if;
  end if;

  return jsonb_build_object(
    'employee_id', v_employee.id,
    'organization_id', v_employee.organization_id,
    'timezone', v_timezone,
    'schedule', case when v_shift.id is not null then
      to_jsonb(v_shift) - array['organization_id', 'department_id', 'is_default', 'created_at', 'updated_at']
        || jsonb_build_object('source', v_shift_source) end,
    'policy', jsonb_build_object(
      'require_inside_site', coalesce(v_policy.require_inside_site, false),
      'lock_to_registered_device', coalesce(v_policy.lock_to_registered_device, false),
      'early_clock_in_minutes', v_policy.early_clock_in_minutes,
      'block_outside_schedule', coalesce(v_policy.block_outside_schedule, false),
      'auto_clock_out_after_minutes', v_policy.auto_clock_out_after_minutes,
      'auto_clock_out_at', v_policy.auto_clock_out_at,
      'source', v_policy_source),
    'holiday_calendar', case when v_calendar.id is not null then
      jsonb_build_object('id', v_calendar.id, 'name', v_calendar.name, 'source', v_calendar_source) end,
    -- Recent and upcoming holidays, enough for offline use over a year.
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'name', h.name) order by h.holiday_date)
      from public.holidays h
      where h.calendar_id = v_calendar.id and h.holiday_date between v_today - 31 and v_today + 366
    ), '[]'::jsonb)
  );
end;
$$;

-- The signed-in employee's own rules. Null for accounts with no active employee profile.
create function public.my_work_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.work_rules_for_employee(e.id) from public.employees e
  where e.user_id = (select auth.uid()) and e.is_active;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row level security. Console viewers read; managers maintain schedules and holidays;
--    only organization admins change the time-tracking policy. Employees use my_work_rules().
-- ---------------------------------------------------------------------------

alter table public.holiday_calendars enable row level security;
alter table public.holidays enable row level security;
alter table public.time_tracking_policies enable row level security;

do $$
declare
  v_table text;
  v_writers text;
begin
  foreach v_table in array array['holiday_calendars', 'holidays', 'time_tracking_policies'] loop
    v_writers := case when v_table = 'time_tracking_policies' then 'admin_org_ids' else 'manageable_org_ids' end;
    execute format('create policy %I on public.%I for select to authenticated using (organization_id in (select public.viewable_org_ids()))',
      v_table || '_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (organization_id in (select public.%s()))',
      v_table || '_insert', v_table, v_writers);
    execute format('create policy %I on public.%I for update to authenticated using (organization_id in (select public.%s())) with check (organization_id in (select public.%s()))',
      v_table || '_update', v_table, v_writers, v_writers);
    execute format('create policy %I on public.%I for delete to authenticated using (organization_id in (select public.%s()))',
      v_table || '_delete', v_table, v_writers);
  end loop;
end;
$$;

revoke all on public.holiday_calendars, public.holidays, public.time_tracking_policies from anon, authenticated;
grant select, insert, update, delete on public.holiday_calendars, public.holidays, public.time_tracking_policies to authenticated;

revoke execute on function
  public.validate_work_schedule(), public.keep_single_default(), public.stamp_holiday_organization(),
  public.stamp_policy_change(), public.work_rules_for_employee(uuid)
from public, anon, authenticated;

revoke execute on function public.my_work_rules() from public, anon;
grant execute on function public.my_work_rules() to authenticated;
