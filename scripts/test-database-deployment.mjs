import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { migrateOrganizations, validateMigrationTarget } from './organization-migrations.mjs'

const frontend = 'https://eqyycmmbcesrtxuawyyb.supabase.co'
assert.equal(validateMigrationTarget('postgresql://postgres:placeholder@db.eqyycmmbcesrtxuawyyb.supabase.co:5432/postgres', frontend), 'eqyycmmbcesrtxuawyyb')
assert.equal(validateMigrationTarget('postgresql://postgres.eqyycmmbcesrtxuawyyb:placeholder@aws-0-test.pooler.supabase.com:5432/postgres', frontend), 'eqyycmmbcesrtxuawyyb')
for (const url of ['postgresql://postgres:placeholder@db.wrongproject.supabase.co/postgres', 'postgresql://postgres.wrongproject:placeholder@aws-0-test.pooler.supabase.com/postgres', 'postgresql://postgres.eqyycmmbcesrtxuawyyb:placeholder@aws-0-test.pooler.supabase.com:6543/postgres'])
  assert.throws(() => validateMigrationTarget(url,frontend))

const db = new PGlite({ extensions: { uuid_ossp } })
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`)
  for (const file of ['20260820000000_admin_schema.sql','20260821000000_employee_sites_fixes.sql'])
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'))
  await db.exec("insert into sites(name,latitude,longitude) values('Preserved legacy site',10,20)")
  await assert.rejects(migrateOrganizations(db),/registry is absent/)
  await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[])')
  await assert.rejects(migrateOrganizations(db),/Base migration/)
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20260820000000','admin_schema'),('20260821000000','employee_sites_fixes')")
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20261023010000','organization_management')")
  await assert.rejects(migrateOrganizations(db),/history is out of order/)
  await db.exec("delete from supabase_migrations.schema_migrations where version='20261023010000'")
  await db.exec('create table public.organizations(id uuid)')
  await assert.rejects(migrateOrganizations(db),/objects exist without a recorded migration/)
  await db.exec('drop table public.organizations')
  // Failure in the follow-up must roll back the initial DDL, backfill and registry.
  const failing = {
    query: db.query.bind(db),
    exec: sql => {
      if (sql.includes('Assign known accounts through the secured RPC')) throw new Error('Injected deployment failure')
      return db.exec(sql)
    },
  }
  await assert.rejects(migrateOrganizations(failing),/Injected deployment failure/)
  assert.equal((await db.query("select to_regclass('public.organizations') as relation")).rows[0].relation,null)
  assert.equal((await db.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n,2)
  assert.equal((await db.query('select name from sites')).rows[0].name,'Preserved legacy site')
  assert.deepEqual(await migrateOrganizations(db),['20261023000000','20261023010000'])
  assert.deepEqual(await migrateOrganizations(db),[])
  assert.equal((await db.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n,4)
  assert.equal((await db.query('select name from sites')).rows[0].name,'Preserved legacy site')
  await db.exec('grant update on organization_memberships to authenticated')
  await assert.rejects(migrateOrganizations(db),/Schema verification failed/)
  console.log('PASS: migration project validation, baseline/partial-installation guards, atomic DDL/history rollback, real deployment, repeat deployment, preserved data, and grant drift detection.')
} finally { await db.close() }
