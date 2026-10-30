-- Onboarding and people management: employee codes, employment type, and archive in place of delete.
--
-- Employees were never deletable (there is no delete policy, so attendance and location history stay
-- attached to a real profile). Archiving is the supported way to remove someone: it turns the profile
-- inactive, which already ends their app access through my_employee_org_id(), and it can be undone.
-- The server records when and by whom; clients only ask to archive or restore.

alter table public.employees
  add column employee_code text,
  add column employment_type text,
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id) on delete set null;

alter table public.employees
  add constraint employees_employee_code_format
    check (employee_code is null or employee_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$'),
  add constraint employees_employment_type_check
    check (employment_type is null
      or employment_type in ('full_time', 'part_time', 'contract', 'temporary', 'intern')),
  add constraint employees_archived_inactive
    check (archived_at is null or not is_active);

-- Codes are optional, but unique (ignoring case) inside an organization.
create unique index employees_organization_code_lower_key
  on public.employees (organization_id, lower(employee_code))
  where employee_code is not null;

create index employees_organization_archived_idx
  on public.employees (organization_id)
  where archived_at is not null;

create function public.stamp_employee_archive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.archived_at is not null then
      raise exception 'New employees cannot be created archived' using errcode = '22023';
    end if;
    new.archived_by := null;
    return new;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    -- Archiving someone who is still on site would leave an open session nobody can close.
    if old.user_id is not null and exists (
      select 1 from public.presence_sessions s
      where s.user_id = old.user_id
        and s.organization_id = old.organization_id
        and s.exit_timestamp is null
    ) then
      raise exception 'Check this employee out of their open site session before archiving them'
        using errcode = '22023';
    end if;
    new.archived_at := now();
    new.archived_by := (select auth.uid());
    new.is_active := false;
  elsif new.archived_at is not null then
    -- Already archived: keep the original record, and reactivate only through a restore.
    if new.is_active then
      raise exception 'Restore this employee before activating them' using errcode = '22023';
    end if;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  else
    new.archived_by := null;
  end if;
  return new;
end;
$$;

-- Runs before the identity guard (20) and account auto-linking (30).
create trigger employees_10_archive before insert or update on public.employees
  for each row execute function public.stamp_employee_archive();
