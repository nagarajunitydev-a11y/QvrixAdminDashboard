create extension if not exists "uuid-ossp";

-- ============================================================
-- EXISTING TABLES (recreated via IF NOT EXISTS for idempotency)
-- ============================================================

create table if not exists sites (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    latitude double precision not null,
    longitude double precision not null,
    radius_in_meters real not null default 500,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create table if not exists location_logs (
    id bigint generated always as identity primary key,
    user_id uuid references auth.users not null,
    site_id uuid references sites,
    latitude double precision not null,
    longitude double precision not null,
    accuracy real not null,
    distance_to_site real not null,
    timestamp bigint not null,
    is_inside boolean not null,
    is_synced boolean not null default false,
    created_at timestamp with time zone default now()
);

create table if not exists presence_sessions (
    id bigint generated always as identity primary key,
    user_id uuid references auth.users not null,
    site_id uuid references sites not null,
    entry_timestamp bigint not null,
    exit_timestamp bigint,
    total_hours double precision,
    is_synced boolean not null default false,
    created_at timestamp with time zone default now()
);

-- ============================================================
-- NEW TABLES (Employee Management module)
-- ============================================================

create table if not exists departments (
    id uuid primary key default uuid_generate_v4(),
    name text not null unique,
    description text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create table if not exists designations (
    id uuid primary key default uuid_generate_v4(),
    name text not null unique,
    description text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create table if not exists shifts (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    start_time time not null,
    end_time time not null,
    department_id uuid references departments,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create table if not exists employees (
    id uuid primary key default uuid_generate_v4(),
    -- Nullable: admins create employee profiles before the employee's auth
    -- account exists; user_id gets linked when they first sign in.
    user_id uuid references auth.users unique,
    first_name text not null,
    last_name text not null,
    email text not null unique,
    phone text,
    department_id uuid references departments,
    designation_id uuid references designations,
    shift_id uuid references shifts,
    is_active boolean not null default true,
    hire_date date,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create table if not exists employee_sites (
    employee_id uuid references employees not null,
    site_id uuid references sites not null,
    assigned_at timestamp with time zone default now(),
    primary key (employee_id, site_id)
);

create table if not exists audit_logs (
    id bigint generated always as identity primary key,
    user_id uuid references auth.users,
    action text not null,
    table_name text not null,
    record_id text,
    old_values jsonb,
    new_values jsonb,
    created_at timestamp with time zone default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_location_logs_user_id on location_logs(user_id);
create index if not exists idx_location_logs_site_id on location_logs(site_id);
create index if not exists idx_location_logs_timestamp on location_logs(timestamp desc);
create index if not exists idx_presence_sessions_user_id on presence_sessions(user_id);
create index if not exists idx_employees_email on employees(email);
create index if not exists idx_employees_department on employees(department_id);
create index if not exists idx_employee_sites_site on employee_sites(site_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table sites enable row level security;
alter table location_logs enable row level security;
alter table presence_sessions enable row level security;
alter table departments enable row level security;
alter table designations enable row level security;
alter table shifts enable row level security;
alter table employees enable row level security;
alter table employee_sites enable row level security;
alter table audit_logs enable row level security;

-- Allow creating employee profiles before their auth account exists
-- (idempotent fix for existing databases created with the old schema)
alter table employees alter column user_id drop not null;

-- Role helper function
-- MUST be security definer: it reads auth.users, which the anon/authenticated
-- roles cannot access directly. As invoker, every RLS policy calling this
-- function fails with "permission denied for table users" -> HTTP 403.
create or replace function get_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(nullif(u.raw_user_meta_data->>'role', ''), '')
    from auth.users u
    where u.id = auth.uid()
$$;

-- Explicit grants (Supabase defaults normally cover these; kept for safety)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;

-- sites: managers can manage, employees can read
drop policy if exists "sites_select" on sites;
drop policy if exists "sites_mutate" on sites;
create policy "sites_select" on sites for select using (get_user_role() = 'manager');
create policy "sites_mutate" on sites for all using (get_user_role() = 'manager')
  with check (get_user_role() = 'manager');

-- location_logs: employees can insert/read own, managers can read all
drop policy if exists "location_logs_select" on location_logs;
drop policy if exists "location_logs_insert" on location_logs;
create policy "location_logs_select" on location_logs for select
  using (user_id = auth.uid() or get_user_role() = 'manager');
create policy "location_logs_insert" on location_logs for insert
  with check (user_id = auth.uid());

-- presence_sessions: employees can read/insert own, managers can read all
drop policy if exists "presence_sessions_select" on presence_sessions;
drop policy if exists "presence_sessions_insert" on presence_sessions;
create policy "presence_sessions_select" on presence_sessions for select
  using (user_id = auth.uid() or get_user_role() = 'manager');
create policy "presence_sessions_insert" on presence_sessions for insert
  with check (user_id = auth.uid());

-- departments/designations/shifts: managers only (admin data)
drop policy if exists "departments_policy" on departments;
drop policy if exists "designations_policy" on designations;
drop policy if exists "shifts_policy" on shifts;
create policy "departments_policy" on departments for all using (get_user_role() = 'manager')
  with check (get_user_role() = 'manager');
create policy "designations_policy" on designations for all using (get_user_role() = 'manager')
  with check (get_user_role() = 'manager');
create policy "shifts_policy" on shifts for all using (get_user_role() = 'manager')
  with check (get_user_role() = 'manager');

-- employees: managers can CRUD; employees limited to own record
drop policy if exists "employees_select" on employees;
drop policy if exists "employees_insert" on employees;
drop policy if exists "employees_update" on employees;
create policy "employees_select" on employees for select
  using ((user_id = auth.uid() and get_user_role() = 'employee') or get_user_role() = 'manager');
create policy "employees_insert" on employees for insert
  with check (get_user_role() = 'manager');
create policy "employees_update" on employees for update
  using (get_user_role() = 'manager') with check (get_user_role() = 'manager');

-- employee_sites: managers can manage all; employees can read own
drop policy if exists "employee_sites_select" on employee_sites;
drop policy if exists "employee_sites_insert" on employee_sites;
create policy "employee_sites_select" on employee_sites for select
  using (employee_id in (select id from employees where user_id = auth.uid())
         or get_user_role() = 'manager');
create policy "employee_sites_insert" on employee_sites for insert
  with check (get_user_role() = 'manager');

-- audit_logs: managers can read and insert only
drop policy if exists "audit_logs_select" on audit_logs;
drop policy if exists "audit_logs_insert" on audit_logs;
create policy "audit_logs_select" on audit_logs for select
  using (get_user_role() = 'manager');
create policy "audit_logs_insert" on audit_logs for insert
  with check (get_user_role() = 'manager');

-- ============================================================
-- AUDIT TRIGGER
-- ============================================================

create or replace function audit_trigger_func()
returns trigger as $$
declare
    v_user_id uuid := auth.uid();
    v_action text;
begin
    if tg_op = 'INSERT' then
        v_action := 'INSERT';
        insert into audit_logs (user_id, action, table_name, record_id, new_values)
        values (v_user_id, v_action, tg_table_name, coalesce(new.id::text, ''), to_jsonb(new));
        return new;
    elsif tg_op = 'UPDATE' then
        v_action := 'UPDATE';
        insert into audit_logs (user_id, action, table_name, record_id, old_values, new_values)
        values (v_user_id, v_action, tg_table_name, coalesce(new.id::text, ''), to_jsonb(old), to_jsonb(new));
        return new;
    elsif tg_op = 'DELETE' then
        v_action := 'DELETE';
        insert into audit_logs (user_id, action, table_name, record_id, old_values)
        values (v_user_id, v_action, tg_table_name, coalesce(old.id::text, ''), to_jsonb(old));
        return old;
    end if;
    return null;
end;
$$ language plpgsql security definer;

drop trigger if exists audit_employees_trigger on employees;
drop trigger if exists audit_departments_trigger on departments;
drop trigger if exists audit_shifts_trigger on shifts;
drop trigger if exists audit_designations_trigger on designations;
create trigger audit_employees_trigger
    after insert or update or delete on employees
    for each row execute function audit_trigger_func();
create trigger audit_departments_trigger
    after insert or update or delete on departments
    for each row execute function audit_trigger_func();
create trigger audit_shifts_trigger
    after insert or update or delete on shifts
    for each row execute function audit_trigger_func();
create trigger audit_designations_trigger
    after insert or update or delete on designations
    for each row execute function audit_trigger_func();
