-- Read-only. Run as database owner in the SQL Editor for the configured project.
select current_database(), current_user;
-- Also detect a differently named table or a relation in an unexposed schema.
select n.nspname as schema_name, c.relname, c.relkind, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema')
 and c.relname ~ '(organization|membership)'
order by n.nspname, c.relname;
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name='organization_memberships'
order by table_schema, ordinal_position;
select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid=to_regclass('public.organization_memberships');
select has_schema_privilege('authenticated','public','USAGE') as authenticated_public_usage;
-- Role/database overrides can supersede the Data API Dashboard settings.
select r.rolname, d.datname, s.setconfig
from pg_db_role_setting s
left join pg_roles r on r.oid=s.setrole
left join pg_database d on d.oid=s.setdatabase
where exists(select 1 from unnest(s.setconfig) setting where setting like 'pgrst.%');
select name, to_regclass('public.' || name) as relation
from (values ('organizations'), ('organization_memberships'),
 ('organization_invitations'), ('organization_site_access')) as required(name);
select to_regprocedure('public.is_platform_admin()') as platform_check,
       to_regprocedure('public.validate_organization_selection(uuid)') as selection_check;
-- Include every RPC used by the console, even when it is absent.
with required(name) as (values
 ('is_platform_admin'), ('validate_organization_selection'), ('save_organization'),
 ('list_organization_members'), ('manage_organization_member'),
 ('set_organization_site_access'), ('create_organization_invitation'),
 ('revoke_organization_invitation'), ('accept_organization_invitation'),
 ('update_organization_settings'))
select r.name, p.oid::regprocedure as signature,
 pg_get_function_arguments(p.oid) as named_arguments,
 pg_get_function_result(p.oid) as result_type,
 p.prosecdef as security_definer, p.proconfig as configuration,
 has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
 has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
 pg_get_functiondef(p.oid) as definition
from required r left join pg_proc p on p.proname=r.name
 and p.pronamespace=(select oid from pg_namespace where nspname='public')
order by r.name;
-- Locate existing identity/role models before deciding which migration is appropriate.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema in ('public','crewtraxa_private')
 and table_name ~ '(organization|membership|profile|role|admin)'
order by table_schema, table_name, ordinal_position;
-- Return migration history if this project uses Supabase's migration registry.
do $$ declare history jsonb; begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
   execute 'select jsonb_agg(to_jsonb(m)) from (select version, name from supabase_migrations.schema_migrations order by version) m' into history;
   raise notice 'Supabase migration history: %', history;
 else
   raise notice 'No Supabase migration registry exists; inspect the project deployment history.';
 end if;
end $$;
select c.relname, c.relrowsecurity,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('organizations','organization_memberships','organization_invitations','organization_site_access');
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename like 'organization%'
order by tablename, policyname;
-- If relations/functions exist, inspect Data API exposed schemas (must include public)
-- and grants/policies above before making changes. Never disable RLS to repair access.
-- Once the schema is correct, run separately: NOTIFY pgrst, 'reload schema';
