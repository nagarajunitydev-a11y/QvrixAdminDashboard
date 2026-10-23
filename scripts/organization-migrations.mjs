import { readFile } from 'node:fs/promises'

export const organizationMigrations = [
  ['20261023000000', 'organizations'],
  ['20261023010000', 'organization_management'],
]

export function validateMigrationTarget(connectionString, frontendUrl) {
  let connection, frontend
  try { connection = new URL(connectionString); frontend = new URL(frontendUrl) }
  catch { throw new Error('A valid owner database URL and VITE_SUPABASE_URL are required') }
  const match = frontend.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)
  if (!match || frontend.protocol !== 'https:') throw new Error('Expected the configured Supabase project URL; custom domains require explicit deployment configuration')
  const ref = match[1]
  const direct = connection.hostname === `db.${ref}.supabase.co`
  const pooler = connection.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(connection.username).endsWith(`.${ref}`)
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || (!direct && !pooler))
    throw new Error(`Database target does not match configured Supabase project ${ref}`)
  if (connection.port && connection.port !== '5432') throw new Error('Migrations require a direct or session-pooler connection on port 5432')
  return ref
}

// query executes a single parameterized statement; exec executes a SQL batch.
// The same runner is tested with PostgreSQL/PGlite and used with pg remotely.
export async function migrateOrganizations(database) {
  await database.exec('begin')
  try {
    await database.exec("set local lock_timeout='5s'; set local statement_timeout='120s'")
    const registry = await database.query("select to_regclass('supabase_migrations.schema_migrations') as relation")
    if (!registry.rows[0].relation) throw new Error('Migration registry is absent. Inspect the live schema and reconcile the two existing base migrations with Supabase CLI before applying organization migrations')
    await database.exec('lock table supabase_migrations.schema_migrations in share row exclusive mode')
    const history = await database.query('select version from supabase_migrations.schema_migrations order by version')
    const versions = new Set(history.rows.map(row => row.version))
    for (const version of ['20260820000000', '20260821000000'])
      if (!versions.has(version)) throw new Error(`Base migration ${version} is not recorded. Verify its schema and reconcile history before deployment; do not replay base migrations over existing data`)
    let missingEarlierVersion = false
    for (const [version] of organizationMigrations) {
      if (!versions.has(version)) missingEarlierVersion = true
      else if (missingEarlierVersion) throw new Error('Organization migration history is out of order. Reconcile the catalog and registry before deployment')
    }
    const applied = []
    for (const [version, name] of organizationMigrations) {
      if (versions.has(version)) continue
      if (version === '20261023000000') {
        const partial = await database.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where (n.nspname='public' and c.relname in ('organizations','organization_memberships','organization_invitations','organization_site_access'))
            or (n.nspname='crewtraxa_private' and c.relname='platform_admins')`)
        if (partial.rows.length) throw new Error('Organization objects exist without a recorded migration. Reconcile the catalog and history before applying; no partial installation will be overwritten')
      }
      const sql = await readFile(new URL(`../supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8')
      // These checked-in files own a transaction for SQL Editor/CLI use.
      // Remove only the outer boundary so DDL and history commit atomically.
      if (!/^\s*(?:--[^\n]*\n\s*)*begin;/i.test(sql) || !/commit;\s*$/i.test(sql))
        throw new Error(`Migration ${version} must have an explicit outer transaction`)
      const body = sql.replace(/^(\s*(?:--[^\n]*\n\s*)*)begin;/i, '$1').replace(/commit;\s*$/i, '')
      await database.exec(body)
      await database.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [version, name, [sql]])
      applied.push(version)
    }
    // Do not commit registry entries if required API objects/grants are broken.
    await verifyOrganizationSchema(database)
    await database.exec("notify pgrst, 'reload schema'")
    await database.exec('commit')
    return applied
  } catch (error) {
    await database.exec('rollback')
    throw error
  }
}

export async function verifyOrganizationSchema(database) {
  for (const table of ['organizations','organization_memberships','organization_invitations','organization_site_access']) {
    const result = await database.query(`select c.relrowsecurity as rls,
      has_table_privilege('authenticated',c.oid,'SELECT') as member_select,
      has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as member_write,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
      exists(select 1 from pg_policy p where p.polrelid=c.oid) as policies
      from pg_class c where c.oid=to_regclass($1)`, [`public.${table}`])
    const row = result.rows[0]
    if (!row?.rls || !row.policies || !row.member_select || row.member_write || row.anon_access)
      throw new Error(`Schema verification failed for ${table}: expected RLS, read policies, authenticated SELECT, and no direct writes/anonymous access`)
  }
  const columns = await database.query(`select column_name from information_schema.columns where table_schema='public' and table_name='organization_memberships'`)
  for (const column of ['organization_id','user_id','role','status','created_at','updated_at'])
    if (!columns.rows.some(row => row.column_name === column)) throw new Error(`Missing organization_memberships.${column}`)
  const functions = await database.query(`select p.proname,p.prosecdef,p.proconfig,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as member_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)
  for (const name of ['is_platform_admin','validate_organization_selection','save_organization','list_organization_members','manage_organization_member','set_organization_site_access','create_organization_invitation','revoke_organization_invitation','accept_organization_invitation','update_organization_settings']) {
    const row = functions.rows.find(row => row.proname === name)
    if (!row?.prosecdef || !row.member_execute || row.anon_execute || !row.proconfig?.includes('search_path=""'))
      throw new Error(`Schema verification failed for RPC ${name}: expected secured definer, empty search_path and authenticated-only execution`)
  }
}
