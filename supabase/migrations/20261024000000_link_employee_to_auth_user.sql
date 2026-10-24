-- Link employee records to auth users on first sign-in
-- This trigger automatically populates employees.user_id when a user with role 'employee' is created/updated

-- Function to link an auth user to their employee record by email
create or replace function public.link_employee_to_auth_user(p_user_id uuid, p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Only process users with 'employee' role
    if p_role <> 'employee' then
        return;
    end if;

    if p_email is null then
        return;
    end if;

    -- Try to find an existing employee record with matching email and no user_id yet
    update public.employees
    set user_id = p_user_id,
        updated_at = now()
    where email = p_email
      and user_id is null;

    -- If no existing record was updated, create a basic employee record
    -- (This handles the case where the mobile app user signs up before admin creates profile)
    if not found then
        insert into public.employees (user_id, first_name, last_name, email, is_active)
        values (
            p_user_id,
            -- Extract first name from email (before @ or .)
            case
                when p_email like '%@%' then split_part(p_email, '@', 1)
                else p_email
            end,
            -- Last name defaults to empty; admin can update later
            '',
            p_email,
            true
        )
        on conflict (email) do update
        set user_id = excluded.user_id,
            updated_at = now()
        where employees.user_id is null;
    end if;
end;
$$;

-- Trigger function for auth.users changes
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text;
    v_email text;
begin
    -- Extract role from user_metadata
    v_role := coalesce(nullif(new.raw_user_meta_data->>'role', ''), '');
    v_email := new.email;

    -- Call linking function for INSERT and UPDATE (role change to employee)
    if (tg_op = 'INSERT') or (tg_op = 'UPDATE' and v_role = 'employee') then
        perform public.link_employee_to_auth_user(new.id, v_email, v_role);
    end if;

    return new;
end;
$$;

-- Drop existing trigger if exists (idempotent)
drop trigger if exists on_auth_user_change on auth.users;

-- Create trigger on auth.users for INSERT and UPDATE
create trigger on_auth_user_change
after insert or update on auth.users
for each row execute function public.handle_auth_user_change();

-- Also link any existing employee records that have matching auth users but null user_id
-- This is a one-time backfill for existing data
do $$
declare
    v_record record;
begin
    for v_record in
        select u.id as user_id, u.email, u.raw_user_meta_data->>'role' as role
        from auth.users u
        where coalesce(nullif(u.raw_user_meta_data->>'role', ''), '') = 'employee'
          and u.email is not null
    loop
        perform public.link_employee_to_auth_user(v_record.user_id, v_record.email, v_record.role);
    end loop;
end $$;

-- Grant execute permission to authenticated role so the trigger can run
grant execute on function public.link_employee_to_auth_user(uuid, text, text) to authenticated;
grant execute on function public.handle_auth_user_change() to authenticated;