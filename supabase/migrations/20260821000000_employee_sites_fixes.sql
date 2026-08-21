-- Fixes for the Employee Assignments (employee_sites) feature.

-- Managers had INSERT but no DELETE policy, so RLS silently rejected
-- unassignment (supabase-js .delete() reports success with 0 affected rows).
drop policy if exists "employee_sites_delete" on employee_sites;
create policy "employee_sites_delete" on employee_sites for delete
  using (get_user_role() = 'manager');

-- Duplicate protection: the composite primary key (employee_id, site_id)
-- defined in 20260820000000_admin_schema.sql already rejects duplicate
-- active assignments for the same employee + site (Postgres 23505).
