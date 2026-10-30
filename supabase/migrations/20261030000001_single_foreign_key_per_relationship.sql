-- Fixes PGRST201 ("more than one relationship was found") introduced by 20261030000000.
--
-- That migration added composite foreign keys such as
--   employees (department_id, organization_id) -> departments (id, organization_id)
-- next to the original single-column keys. PostgREST then sees two relationships for the same
-- pair and refuses every embed, e.g. employees?select=*,departments(name).
--
-- The composite keys enforce everything the single-column keys did (the referenced row must
-- exist; NULL references are allowed) and also that both rows share an organization, so the
-- single-column keys are redundant. Dropping them leaves one relationship per pair. No data,
-- column or index changes.

alter table public.employees
  drop constraint employees_department_id_fkey,
  drop constraint employees_designation_id_fkey,
  drop constraint employees_shift_id_fkey;
alter table public.shifts drop constraint shifts_department_id_fkey;
alter table public.employee_sites
  drop constraint employee_sites_employee_id_fkey,
  drop constraint employee_sites_site_id_fkey;
alter table public.presence_sessions drop constraint presence_sessions_site_id_fkey;
alter table public.site_visits drop constraint site_visits_site_id_fkey;
alter table public.location_logs drop constraint location_logs_site_id_fkey;

-- PostgREST caches relationships; reload so embeds work immediately.
notify pgrst, 'reload schema';
