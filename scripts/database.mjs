import pg from 'pg'
import { loadEnv } from 'vite'
import { readFile } from 'node:fs/promises'
import { migrateOrganizations, validateMigrationTarget } from './organization-migrations.mjs'
const connectionString = process.env.CREWTRAXA_DATABASE_URL
if (!connectionString) { console.error('Database deployment NOT RUN: configure CREWTRAXA_DATABASE_URL securely for Supabase project eqyycmmbcesrtxuawyyb. The public anon key cannot run migrations. Required migrations: 20261023000000_organizations.sql and 20261023010000_organization_management.sql.'); process.exit(1) }
const env = loadEnv('production',process.cwd(),'VITE_')
try { console.log('Verified migration target:', validateMigrationTarget(connectionString,env.VITE_SUPABASE_URL)) }
catch(error) { console.error(error.message); process.exit(1) }
// URL SSL options must not override certificate verification in pg.
const secureUrl = new URL(connectionString)
for (const option of ['sslmode','sslcert','sslkey','sslrootcert']) secureUrl.searchParams.delete(option)
let ca
if (process.env.CREWTRAXA_DATABASE_CA_FILE) {
 try { ca = await readFile(process.env.CREWTRAXA_DATABASE_CA_FILE,'utf8') }
 catch { console.error('Unable to read CREWTRAXA_DATABASE_CA_FILE'); process.exit(1) }
}
const client = new pg.Client({ connectionString: secureUrl.toString(), ssl: { rejectUnauthorized: true, ...(ca ? {ca} : {}) }, connectionTimeoutMillis: 15000 })
try {
 await client.connect()
 const inventory = await client.query(`select c.relname as table_name,c.relrowsecurity as rls_enabled,
   array_agg(a.attname order by a.attnum) as columns
   from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   where n.nspname='public' and c.relkind='r' group by c.relname,c.relrowsecurity order by c.relname`)
 const policies = await client.query(`select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname`)
 console.log(JSON.stringify({ tables: inventory.rows, policies: policies.rows },null,2))
 const registry = await client.query("select to_regclass('supabase_migrations.schema_migrations') as relation")
 if(registry.rows[0].relation) console.log('Migration history:', (await client.query('select version,name from supabase_migrations.schema_migrations order by version')).rows)
 else console.log('Migration registry absent: reconcile verified base schema/history with Supabase CLI before --apply.')
 if (process.argv.includes('--apply')) {
  const applied = await migrateOrganizations({query:client.query.bind(client),exec:sql=>client.query(sql)})
  console.log('Organization migrations committed and recorded:', applied.length ? applied.join(', ') : 'already applied; schema verified')
  console.log('Bootstrap a verified administrator, then run authenticated live API/browser tests before releasing the console.')
 }
} catch(error) { console.error('Database operation failed:',error.message); process.exitCode=1 } finally { await client.end() }
