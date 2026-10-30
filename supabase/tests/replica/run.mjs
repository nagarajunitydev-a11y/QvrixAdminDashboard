// Phase 2 migration test on a local PGlite replica: the live schema snapshot (baseline.sql) plus
// synthetic, production-shaped data. Never connects to the live database.
// Run: npm run test:db [-- path/to/migration.sql]
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
// Every migration from Phase 2 on, in version order, unless specific files are passed.
const migrationsDir = new URL('../../migrations/', import.meta.url)
const MIGRATIONS = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(migrationsDir).filter((name) => name >= '20261030000000').sort().map((name) => new URL(name, migrationsDir))
const db = new PGlite()
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const id = { m1: U(1), m2: U(2), m3: U(3), e1: U(11), e2: U(12), e3: U(13), p1: U(21), bAdmin: U(31), bEmp: U(32), bEmp2: U(33), aSup: U(34), u9: U(41) }
const now = Date.now(), H = 3600000
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra) } }
const q = async (sql, params) => (await db.query(sql, params)).rows
async function as(uid, fn, role = 'authenticated') {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role } : { role })])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec('reset role') }
}
async function err(fn) { try { await fn(); return null } catch (e) { return e.code || e.message } }
const n = async (uid, sql, params) => (await as(uid, () => q(sql, params)))[0].n

await db.exec(readFileSync(new URL('./baseline.sql', import.meta.url), 'utf8'))

// --- synthetic data shaped like production ---
const user = (k, email, appRole, userRole) => db.query(
  `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values ($1,$2,$3,$4, now())`,
  [id[k], email, appRole ? { role: appRole } : {}, userRole ? { role: userRole } : {}])
for (const k of ['m1', 'm2', 'm3']) await user(k, `${k}@qvrix.test`, 'manager', 'manager')
for (const k of ['e1', 'e2', 'e3']) await user(k, `${k}@qvrix.test`, null, null)
await db.exec(`
insert into departments (id, name) values ('${U(101)}','Operations'),('${U(102)}','Security'),('${U(103)}','Facilities');
insert into designations (id, name) values ('${U(111)}','Guard'),('${U(112)}','Supervisor'),('${U(113)}','Technician');
insert into shifts (id, name, start_time, end_time, department_id) values ('${U(121)}','Day','09:00','18:00','${U(101)}');
insert into sites (id, name, latitude, longitude, radius_in_meters) values
 ('${U(201)}','Site A1',12.97,77.59,200),('${U(202)}','Site A2',12.98,77.60,300),('${U(203)}','Site A3',12.99,77.61,500),
 ('${U(204)}','Site A4',13.0,77.62,150),('${U(205)}','Site A5',13.01,77.63,500);
insert into employees (id, user_id, first_name, last_name, email, department_id, designation_id, shift_id) values
 ('${U(301)}','${id.e1}','Emp','One','e1@qvrix.test','${U(101)}','${U(111)}','${U(121)}'),
 ('${U(302)}','${id.e2}','Emp','Two','e2@qvrix.test','${U(101)}','${U(111)}','${U(121)}'),
 ('${U(303)}','${id.e3}','Emp','Three','e3@qvrix.test',null,null,null),
 ('${U(304)}',null,'No','Account4','x4@qvrix.test',null,null,null),
 ('${U(305)}',null,'No','Account5','x5@qvrix.test',null,null,null),
 ('${U(306)}',null,'No','Account6','x6@qvrix.test',null,null,null);
insert into employee_sites (employee_id, site_id) values ('${U(301)}','${U(201)}'),('${U(301)}','${U(202)}'),('${U(302)}','${U(201)}'),
 ('${U(303)}','${U(203)}'),('${U(304)}','${U(204)}'),('${U(305)}','${U(205)}'),('${U(306)}','${U(201)}');
insert into presence_sessions (user_id, site_id, entry_timestamp, exit_timestamp, total_hours) values
 ('${id.e1}','${U(201)}',${now - 30 * H},${now - 22 * H},8),('${id.e1}','${U(201)}',${now - 5 * H},null,null),
 ('${id.e2}','${U(201)}',${now - 6 * H},null,null),('${id.m1}','${U(202)}',${now - 50 * H},${now - 49 * H},1);
insert into location_logs (user_id, site_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values
 ('${id.e1}','${U(201)}',12.97,77.59,10,5,${now - 60000},true),('${id.m1}','${U(202)}',12.98,77.60,12,10,${now - 49 * H},true);
insert into site_visits (user_id, site_id, entry_timestamp) values ('${id.e1}','${U(201)}',${now - 5 * H});
`)
const counts = `select (select count(*) from presence_sessions)::int s, (select count(*) from location_logs)::int l,
  (select count(*) from employees)::int e, (select count(*) from employee_sites)::int a`
const before = (await q(counts))[0]

// --- apply the migration as its owner ---
for (const migration of MIGRATIONS) await db.exec(readFileSync(migration, 'utf8'))
console.log(`migrations applied: ${MIGRATIONS.length}`)

// PostgREST can only embed a related table (e.g. employees?select=departments(name)) when exactly
// one foreign key links the pair; a second one fails every such read with PGRST201.
const ambiguous = await q(`select conrelid::regclass::text as t, confrelid::regclass::text as r, count(*)::int as n
  from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace
    and confrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  group by 1, 2 having count(*) > 1`)
ok('every table pair has one relationship (PostgREST embeds resolve)', ambiguous.length === 0, JSON.stringify(ambiguous))

// T1 backfill and access preservation
const qvrix = (await q(`select id from organizations where slug='qvrix'`))[0].id
for (const t of ['sites', 'shifts', 'departments', 'designations', 'employees', 'employee_sites', 'presence_sessions', 'location_logs', 'site_visits', 'audit_logs'])
  ok(`backfill ${t}`, (await q(`select count(*)::int n from ${t} where organization_id is distinct from $1`, [qvrix]))[0].n === 0)
ok('no rows lost', JSON.stringify(before) === JSON.stringify((await q(counts))[0]))
ok('managers became org admins', (await q(`select count(*)::int n from organization_members where role='org_admin'`))[0].n === 3)
const m1Access = (await as(id.m1, () => q(`select public.my_console_access() a`)))[0].a
ok('m1 console access', m1Access.organizations.length === 1 && m1Access.organizations[0].role === 'org_admin', JSON.stringify(m1Access))
ok('employee has no console access', (await as(id.e1, () => q(`select public.my_console_access() a`)))[0].a.organizations.length === 0)
ok('m1 sees 5 sites', await n(id.m1, `select count(*)::int n from sites`) === 5)
ok('m1 sees 6 employees', await n(id.m1, `select count(*)::int n from employees`) === 6)
ok('e1 sees org sites', await n(id.e1, `select count(*)::int n from sites`) === 5)
ok('e1 reads only own employee row', await n(id.e1, `select count(*)::int n from employees`) === 1)
ok('e1 reads only own assignments', await n(id.e1, `select count(*)::int n from employee_sites`) === 2)
ok('e1 reads assigned shift', await n(id.e1, `select count(*)::int n from shifts`) === 1)

// T2 second organization through the platform admin RPC
await db.exec(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values
 ('${id.p1}','p1@platform.test','{}',now()),('${id.bAdmin}','admin@beta.test','{}',now()),
 ('${id.bEmp}','worker@beta.test','{"role":"employee"}',now()),('${id.bEmp2}','worker2@beta.test','{}',now()),
 ('${id.aSup}','sup@qvrix.test','{}',now()),('${id.u9}','u9@unknown.test','{}',now());
 insert into platform_admins (user_id) values ('${id.p1}');`)
ok('non-platform cannot create org', await err(() => as(id.m1, () => q(`select create_organization('X','x-org')`))) === '42501')
const beta = (await as(id.p1, () => q(`select create_organization('Beta Builders','beta','Asia/Kolkata','admin@beta.test') id`)))[0].id
ok('first admin is invited, not attached', (await q(`select count(*)::int n from organization_members where organization_id=$1`, [beta]))[0].n === 0)
const bAdminAccess = (await as(id.bAdmin, () => q(`select public.my_console_access() a`)))[0].a
ok('invited admin sees the invitation, not the organization', bAdminAccess.organizations.length === 0 && bAdminAccess.invitations.length === 1 && bAdminAccess.invitations[0].role === 'org_admin', JSON.stringify(bAdminAccess))
await as(id.bAdmin, () => q(`select respond_to_console_invitation($1, true)`, [bAdminAccess.invitations[0].id]))
ok('beta admin membership after accepting', (await q(`select role from organization_members where organization_id=$1 and user_id=$2`, [beta, id.bAdmin]))[0]?.role === 'org_admin')
ok('bad timezone rejected', await err(() => as(id.p1, () => q(`select create_organization('Y','y-org','Mars/Base')`))) === '22023')
ok('platform admin sees both orgs in console', (await as(id.p1, () => q(`select public.my_console_access() a`)))[0].a.organizations.length === 2)

// T3 console-managed records stamp the caller's only organization
const bSite = (await as(id.bAdmin, () => q(`insert into sites (name, latitude, longitude, radius_in_meters) values ('Beta Yard',19.07,72.87,250) returning id, organization_id`)))[0]
ok('site stamped beta', bSite.organization_id === beta)
ok('beta admin sees 1 site', await n(id.bAdmin, `select count(*)::int n from sites`) === 1)
ok('m1 still sees 5 sites', await n(id.m1, `select count(*)::int n from sites`) === 5)
ok('cross-org site insert blocked', await err(() => as(id.bAdmin, () => q(`insert into sites (name, latitude, longitude, organization_id) values ('Sneaky',1,1,$1)`, [qvrix]))) === '42501')
ok('cross-org site update matches nothing', await n(id.bAdmin, `with u as (update sites set name='x' where organization_id='${qvrix}' returning 1) select count(*)::int n from u`) === 0)
ok('moving a site between orgs blocked', await err(() => as(id.p1, () => q(`update sites set organization_id=$1 where id=$2`, [qvrix, bSite.id]))) === '42501')
ok('same department name in another org', await err(() => as(id.bAdmin, () => q(`insert into departments (name) values ('Operations')`))) === null)
ok('platform admin with two orgs must choose', await err(() => as(id.p1, () => q(`insert into departments (name) values ('Ambiguous')`))) === '23502')
ok('cross-org department reference blocked', await err(() => as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email,department_id) values ('a','b','dept@beta.test',$1)`, [U(101)]))) === '23503')

/// T4 verified identity: links need proof from the account holder or the server, never the inviting organization
await db.query(`update auth.users set raw_app_meta_data = jsonb_build_object('role', 'employee', 'organization_id', $1::text) where id = $2`, [beta, id.bEmp])
const bEmpRow = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Beta','Worker','worker@beta.test') returning id, user_id`)))[0]
ok('server-assigned employee auto-linked in its organization', bEmpRow.user_id === id.bEmp)
const bEmp2Row = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Beta','Worker2','WORKER2@beta.test') returning id, user_id`)))[0]
ok('account without server assignment not auto-linked', bEmp2Row.user_id === null)
// Takeover attempts: another organization invites accounts that belong elsewhere.
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'qvrix.new@qvrix.test',$2,now())`, [U(53), { role: 'employee', organization_id: qvrix }])
const hijack = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Taken','Over','qvrix.new@qvrix.test') returning id, user_id`)))[0]
ok('another organization cannot auto-claim an assigned account', hijack.user_id === null)
const managerProfile = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Qvrix','Manager','m1@qvrix.test') returning id, user_id`)))[0]
ok('another organization cannot claim a manager account', managerProfile.user_id === null)
ok('managers cannot list account candidates', await err(() => as(id.bAdmin, () => q(`select * from employee_account_candidates($1)`, [beta]))) === '42501')
ok('managers cannot link accounts', await err(() => as(id.bAdmin, () => q(`select link_employee_account($1)`, [hijack.id]))) === '42501')
ok('m1 has not been moved into beta', await n(id.m1, `select count(*)::int n from sites`) === 5 && (await q(`select count(*)::int n from employees where user_id=$1`, [id.m1]))[0].n === 0)
ok('same email allowed in another organization (no reservation)', await err(() => as(id.m1, () => q(`insert into employees (first_name,last_name,email) values ('Q','Worker2','worker2@beta.test')`))) === null)
// The account holder chooses which invitation to accept.
const invitations = await as(id.bEmp2, () => q(`select * from my_employee_invitations()`))
ok('account holder sees invitations by organization name', invitations.map((row) => row.organization_name).join() === 'Beta Builders,Qvrix', JSON.stringify(invitations))
ok('nobody sees invitations for another email', (await as(id.e1, () => q(`select * from my_employee_invitations()`))).length === 0)
ok('cannot accept an invitation for another email', await err(() => as(id.bEmp2, () => q(`select accept_employee_invitation($1)`, [hijack.id]))) === '42501')
ok('accepting links the chosen organization', (await as(id.bEmp2, () => q(`select accept_employee_invitation($1) o`, [bEmp2Row.id])))[0].o === beta)
ok('profile now linked', (await q(`select user_id from employees where id=$1`, [bEmp2Row.id]))[0].user_id === id.bEmp2)
const qvrixInvite = invitations.find((row) => row.organization_id === qvrix)
ok('second invitation refused once linked', await err(() => as(id.bEmp2, () => q(`select accept_employee_invitation($1)`, [qvrixInvite.employee_id]))) === '23505')
ok('no invitations after linking', (await as(id.bEmp2, () => q(`select * from my_employee_invitations()`))).length === 0)
// Platform operator override.
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'ops@beta.test','{}',now())`, [U(54)])
const opsRow = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Ops','Lead','ops@beta.test') returning id`)))[0]
const cands = await as(id.p1, () => q(`select * from employee_account_candidates($1)`, [beta]))
ok('platform candidates carry no sign-in data', cands.some((row) => row.employee_id === opsRow.id) && cands.every((row) => !('last_sign_in_at' in row)), JSON.stringify(cands))
ok('platform admin links an account', (await as(id.p1, () => q(`select link_employee_account($1) u`, [opsRow.id])))[0].u === U(54))
ok('second link refused', await err(() => as(id.p1, () => q(`select link_employee_account($1)`, [opsRow.id]))) === '23505')
ok('direct user_id edit blocked', await err(() => as(id.bAdmin, () => q(`update employees set user_id=$1 where id=$2`, [id.u9, hijack.id]))) === '42501')
ok('direct user_id insert blocked', await err(() => as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email,user_id) values ('a','b','c@beta.test',$1)`, [id.u9]))) === '42501')
ok('case-insensitive duplicate email blocked within an organization', await err(() => as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('a','b','Worker@Beta.test')`))) === '23505')
ok('profile edit keeps link', (await as(id.bAdmin, () => q(`update employees set phone='123' where id=$1 returning user_id`, [bEmpRow.id])))[0].user_id === id.bEmp)
await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Late','Account','late@beta.test'),('Wrong','Org','wrong@beta.test')`))
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'late@beta.test',$2,now())`, [U(51), { role: 'employee', organization_id: beta }])
ok('auth trigger links a later account assigned to this organization', (await q(`select user_id from employees where email='late@beta.test'`))[0].user_id === U(51))
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'wrong@beta.test',$2,now())`, [U(55), { role: 'employee', organization_id: qvrix }])
ok('auth trigger ignores a profile in another organization', (await q(`select user_id from employees where email='wrong@beta.test'`))[0].user_id === null)
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'nobody@nowhere.test','{"role":"employee"}',now())`, [U(52)])
ok('no placeholder profile created', (await q(`select count(*)::int n from employees where email='nobody@nowhere.test'`))[0].n === 0)

// T5 field activity: stamping, cross-org rejection, attendance integrity
ok('beta worker sees only beta sites', await n(id.bEmp, `select count(*)::int n from sites`) === 1)
const t0 = now - 2 * H
const s1 = (await as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp, total_hours) values ($1,$2,$3,99) returning organization_id, total_hours`, [id.bEmp, bSite.id, t0])))[0]
ok('session stamped beta, hours derived', s1.organization_id === beta && s1.total_hours === null, JSON.stringify(s1))
ok('cross-org session rejected (retryable)', await err(() => as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3)`, [id.bEmp, U(201), t0]))) === '42501')
ok('idempotent re-upload', await err(() => as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3) on conflict (user_id, site_id, entry_timestamp) do nothing`, [id.bEmp, bSite.id, t0]))) === null)
ok('entry time immutable', await err(() => as(id.bEmp, () => q(`update presence_sessions set entry_timestamp=$1 where user_id=$2`, [t0 - H, id.bEmp]))) === '42501')
const exit = (await as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1, total_hours=50 where user_id=$2 and site_id=$3 and entry_timestamp=$4 returning total_hours, closed_by`, [t0 + 2 * H, id.bEmp, bSite.id, t0])))[0]
ok('checkout accepted, hours derived', exit.total_hours === 2 && exit.closed_by === 'employee', JSON.stringify(exit))
ok('checkout retry with same value', await err(() => as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1 where user_id=$2 and entry_timestamp=$3`, [t0 + 2 * H, id.bEmp, t0]))) === null)
ok('completed checkout immutable', await err(() => as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1 where user_id=$2 and entry_timestamp=$3`, [t0 + 5 * H, id.bEmp, t0]))) === '42501')
ok('exit before entry rejected', await err(() => as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp, exit_timestamp) values ($1,$2,$3,$4)`, [id.bEmp, bSite.id, t0 + 9 * H, t0 + 8 * H]))) === '23514')
const ll = (await as(id.e1, () => q(`insert into location_logs (user_id, site_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values ($1,$2,1,1,5,3,$3,true) returning organization_id`, [id.e1, U(201), now])))[0]
ok('old Android payload stamped', ll.organization_id === qvrix)
ok('site-less log for linked employee', (await as(id.e1, () => q(`insert into location_logs (user_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values ($1,1,1,5,3,$2,false) returning organization_id`, [id.e1, now + 1])))[0].organization_id === qvrix)
ok('spoofed organization ignored', (await as(id.e1, () => q(`insert into location_logs (user_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside, organization_id) values ($1,1,1,5,3,$2,false,$3) returning organization_id`, [id.e1, now + 2, beta])))[0].organization_id === qvrix)
ok('unlinked account with no site rejected (retryable)', await err(() => as(id.u9, () => q(`insert into location_logs (user_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values ($1,1,1,5,3,$2,false)`, [id.u9, now]))) === '42501')
ok('unlinked account at a site is accepted', (await as(id.u9, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3) returning organization_id`, [id.u9, U(203), now - H])))[0].organization_id === qvrix)
ok('site visit hours derived', (await as(id.e1, () => q(`update site_visits set exit_timestamp=$1, duration_hours=99 where user_id=$2 returning duration_hours`, [now - 3 * H, id.e1])))[0].duration_hours === 2)
ok('site visit exit immutable', await err(() => as(id.e1, () => q(`update site_visits set exit_timestamp=$1 where user_id=$2`, [now - 2 * H, id.e1]))) === '42501')
ok('employee cannot fake heartbeat', (await as(id.e1, () => q(`update presence_sessions set last_heartbeat=$1 where user_id=$2 and exit_timestamp is null returning last_heartbeat`, [now, id.e1])))[0].last_heartbeat === null)
ok('employee cannot touch others', await n(id.e1, `with u as (update presence_sessions set exit_timestamp=${now} where user_id='${id.e2}' returning 1) select count(*)::int n from u`) === 0)

// T6 isolation of reads
ok('m1 cannot see beta sessions', await n(id.m1, `select count(*)::int n from presence_sessions where organization_id=$1`, [beta]) === 0)
ok('beta admin sees beta sessions only', await n(id.bAdmin, `select count(distinct organization_id)::int n from presence_sessions`) === 1)
ok('beta admin sees no qvrix logs', await n(id.bAdmin, `select count(*)::int n from location_logs`) === 0)
ok('online view isolated', await n(id.bAdmin, `select count(*)::int n from employee_online_status where organization_id <> $1`, [beta]) === 0)
ok('outside-site view isolated', await n(id.bAdmin, `select count(*)::int n from employees_outside_site`) === 0)
ok('organizations isolated', await n(id.m1, `select count(*)::int n from organizations`) === 1 && await n(id.p1, `select count(*)::int n from organizations`) === 2)
ok('worker sees own org only', await n(id.bEmp, `select count(*)::int n from organizations`) === 1)
const unl = await as(id.m1, () => q(`select user_id, email, organization_id from unlinked_devices`))
ok('unlinked account routed to its site org', unl.length === 1 && unl[0].user_id === id.u9 && unl[0].organization_id === qvrix, JSON.stringify(unl))
ok('other org cannot see that unlinked account', await n(id.bAdmin, `select count(*)::int n from unlinked_devices`) === 0)
ok('employees cannot see unlinked accounts', await n(id.e1, `select count(*)::int n from unlinked_devices`) === 0)
ok('cross-org assignment blocked', await err(() => as(id.bAdmin, () => q(`insert into employee_sites (employee_id, site_id) values ($1,$2)`, [bEmpRow.id, U(201)]))) === '42501')
ok('same-org assignment allowed', await err(() => as(id.bAdmin, () => q(`insert into employee_sites (employee_id, site_id) values ($1,$2)`, [bEmpRow.id, bSite.id]))) === null)
ok('anon sees nothing', (await as(null, () => q(`select count(*)::int n from sites`), 'anon'))[0].n === 0)
ok('anon cannot read organizations', await err(() => as(null, () => q(`select count(*) from organizations`), 'anon')) === '42501')

/// T7 Console roles by invitation: no account probing, no attachment without consent
const invite = (uid, org, email, role) => as(uid, () => q(`select invite_organization_member($1,$2,$3) id`, [org, email, role]))
const supInvite = (await invite(id.m1, qvrix, 'sup@qvrix.test', 'supervisor'))[0].id
const unknownInvite = await err(() => invite(id.m1, qvrix, 'nobody-here@unknown.test', 'manager'))
const knownInvite = await err(() => invite(id.m1, qvrix, 'E2@Qvrix.test', 'manager'))
ok('same response whether or not the email has an account', unknownInvite === null && knownInvite === null)
ok('invitation email stored normalized', (await q(`select count(*)::int n from organization_invitations where email='e2@qvrix.test'`))[0].n === 1)
ok('an invitation grants nothing', (await q(`select count(*)::int n from organization_members where user_id in ($1,$2)`, [id.e2, id.aSup]))[0].n === 0)
ok('invitee has no Console access before accepting', (await as(id.e2, () => q(`select public.my_console_access() a`)))[0].a.organizations.length === 0)
const pending = await as(id.m1, () => q(`select * from list_organization_invitations($1)`, [qvrix]))
ok('pending list shows only what the admin typed', pending.length === 3 && pending.every((row) => !('user_id' in row) && !('last_sign_in_at' in row)), JSON.stringify(pending))
ok('invitees are not listed as members', !(await as(id.m1, () => q(`select * from list_organization_members($1)`, [qvrix]))).some((row) => row.email === 'e2@qvrix.test'))
ok('other organizations cannot read the invitations', await err(() => as(id.bAdmin, () => q(`select * from list_organization_invitations($1)`, [qvrix]))) === '42501' && await n(id.bAdmin, `select count(*)::int n from organization_invitations where organization_id = $1`, [qvrix]) === 0)
ok('other organizations cannot invite', await err(() => invite(id.bAdmin, qvrix, 'x@qvrix.test', 'manager')) === '42501')
ok('employees cannot invite', await err(() => invite(id.e1, qvrix, 'x@qvrix.test', 'manager')) === '42501')
ok('invalid email rejected', await err(() => invite(id.m1, qvrix, 'not-an-email', 'manager')) === '22023')
ok('existing members cannot be re-invited', await err(() => invite(id.m1, qvrix, 'M2@qvrix.test', 'supervisor')) === '23505')
ok('old attach-by-email function removed', await err(() => as(id.m1, () => q(`select set_organization_member($1,'e3@qvrix.test','manager')`, [qvrix]))) === '42883')
const e2Invites = await as(id.e2, () => q(`select * from my_console_invitations()`))
ok('invitee sees the invitation with the organization name', e2Invites.length === 1 && e2Invites[0].organization_name === 'Qvrix' && e2Invites[0].role === 'manager', JSON.stringify(e2Invites))
ok('nobody else sees it', (await as(id.e1, () => q(`select * from my_console_invitations()`))).length === 0)
ok('cannot accept an invitation for another email', await err(() => as(id.e1, () => q(`select respond_to_console_invitation($1, true)`, [e2Invites[0].id]))) === '42501')
await as(id.e2, () => q(`select respond_to_console_invitation($1, false)`, [e2Invites[0].id]))
ok('declining grants nothing and closes the invitation', (await q(`select count(*)::int n from organization_members where user_id=$1`, [id.e2]))[0].n === 0 && (await as(id.e2, () => q(`select * from my_console_invitations()`))).length === 0)
ok('a declined invitation cannot be accepted', await err(() => as(id.e2, () => q(`select respond_to_console_invitation($1, true)`, [e2Invites[0].id]))) === '42501')
await invite(id.m1, qvrix, 'e2@qvrix.test', 'manager')
const e2Again = (await as(id.e2, () => q(`select * from my_console_invitations()`)))[0]
ok('accepting creates the membership', (await as(id.e2, () => q(`select respond_to_console_invitation($1, true) o`, [e2Again.id])))[0].o === qvrix
  && (await q(`select role from organization_members where user_id=$1 and organization_id=$2`, [id.e2, qvrix]))[0]?.role === 'manager')
ok('accepted invitation cannot be reused', await err(() => as(id.e2, () => q(`select respond_to_console_invitation($1, true)`, [e2Again.id]))) === '42501')
ok('accepted member is listed', (await as(id.m1, () => q(`select * from list_organization_members($1)`, [qvrix]))).some((row) => row.email === 'e2@qvrix.test'))
ok('managers cannot invite (admins only)', await err(() => invite(id.e2, qvrix, 'x@qvrix.test', 'supervisor')) === '42501')
const e3Invite = (await invite(id.m1, qvrix, 'e3@qvrix.test', 'supervisor'))[0].id
await db.query(`update organization_invitations set expires_at = now() - interval '1 day' where id=$1`, [e3Invite])
ok('expired invitations are hidden and refused', (await as(id.e3, () => q(`select * from my_console_invitations()`))).length === 0
  && await err(() => as(id.e3, () => q(`select respond_to_console_invitation($1, true)`, [e3Invite]))) === '42501')
ok('other organizations cannot revoke', await err(() => as(id.bAdmin, () => q(`select revoke_organization_invitation($1)`, [e3Invite]))) === '42501')
await as(id.m1, () => q(`select revoke_organization_invitation($1)`, [e3Invite]))
ok('admins revoke open invitations', (await q(`select revoked_at is not null r from organization_invitations where id=$1`, [e3Invite]))[0].r === true)
await as(id.aSup, () => q(`select respond_to_console_invitation($1, true)`, [supInvite]))
ok('role changes only for existing members', await err(() => as(id.m1, () => q(`select set_organization_member_role($1,$2,'manager')`, [qvrix, U(53)]))) === 'P0002')
ok('admins change a member role', await err(() => as(id.m1, () => q(`select set_organization_member_role($1,$2,'supervisor')`, [qvrix, id.e2]))) === null
  && (await q(`select role from organization_members where user_id=$1 and organization_id=$2`, [id.e2, qvrix]))[0].role === 'supervisor')
ok('invitations are audited', (await q(`select count(*)::int n from audit_logs where table_name='organization_invitations' and organization_id=$1`, [qvrix]))[0].n >= 5)
// Roles: supervisors read, cannot write; last admin protected
ok('supervisor reads attendance', await n(id.aSup, `select count(*)::int n from presence_sessions`) > 0)
ok('supervisor cannot create sites', await err(() => as(id.aSup, () => q(`insert into sites (name, latitude, longitude, organization_id) values ('No',1,1,$1)`, [qvrix]))) === '42501')
ok('supervisor cannot read audit', await n(id.aSup, `select count(*)::int n from audit_logs`) === 0)
ok('supervisor cannot invite', await err(() => invite(id.aSup, qvrix, 'x@qvrix.test', 'supervisor')) === '42501')
ok('last beta admin protected', await err(() => as(id.bAdmin, () => q(`select deactivate_organization_member($1,$2)`, [beta, id.bAdmin]))) === '22023')
ok('last admin cannot demote self', await err(() => as(id.bAdmin, () => q(`select set_organization_member_role($1,$2,'manager')`, [beta, id.bAdmin]))) === '22023')
ok('members listed with email', (await as(id.m1, () => q(`select * from list_organization_members($1)`, [qvrix]))).some(r => r.email === 'sup@qvrix.test'))
ok('org admin renames own org', await err(() => as(id.bAdmin, () => q(`update organizations set name='Beta Builders Pvt Ltd' where id=$1`, [beta]))) === null)
ok('org admin cannot rename other org', await n(id.bAdmin, `with u as (update organizations set name='x' where id='${qvrix}' returning 1) select count(*)::int n from u`) === 0)

// T8 audit trail
ok('audit cannot be forged', await err(() => as(id.m1, () => q(`insert into audit_logs (action, table_name, organization_id) values ('X','sites',$1)`, [qvrix]))) !== null)
ok('site changes audited with org', await n(id.bAdmin, `select count(*)::int n from audit_logs where table_name='sites' and organization_id=$1`, [beta]) === 1)
ok('m1 cannot see beta audit', await n(id.m1, `select count(*)::int n from audit_logs where organization_id=$1`, [beta]) === 0)
ok('checkout audited', (await q(`select count(*)::int n from audit_logs where table_name='presence_sessions' and user_id=$1`, [id.bEmp]))[0].n >= 1)
ok('assignment audited', (await q(`select count(*)::int n from audit_logs where table_name='employee_sites' and organization_id=$1`, [beta]))[0].n === 1)

// T9 devices
const inst = '11111111-2222-4333-8444-555555555555', hw = 'a'.repeat(64)
const d1 = (await as(id.bEmp, () => q(`select register_device($1,$2,'android','Samsung','SM-A145','14','1.4.0',14,'tracking') r`, [inst, hw])))[0].r
ok('device registered active', d1.status === 'active' && d1.is_holder === true, JSON.stringify(d1))
ok('heartbeat keeps one device', (await as(id.bEmp, () => q(`select register_device($1,$2) r`, [inst, hw])))[0].r.device_id === d1.device_id)
ok('employee sees own device', await n(id.bEmp, `select count(*)::int n from devices`) === 1)
const d2 = (await as(id.bEmp2, () => q(`select register_device($1) r`, [inst])))[0].r
ok('other account on same phone needs review', d2.status === 'pending_review' && d2.is_holder === false, JSON.stringify(d2))
ok('mismatch event recorded', await n(id.bAdmin, `select count(*)::int n from device_events where event_type='account_mismatch'`) === 1)
ok('repeat login does not duplicate the event', (await as(id.bEmp2, () => q(`select register_device($1) r`, [inst]))) && await n(id.bAdmin, `select count(*)::int n from device_events where event_type='account_mismatch'`) === 1)
ok('other org cannot see device', await n(id.m1, `select count(*)::int n from devices`) === 0)
ok('other org cannot approve', await err(() => as(id.m1, () => q(`select review_device_reassignment($1,true)`, [d1.device_id]))) === '42501')
ok('supervisor cannot approve', await err(() => as(id.aSup, () => q(`select review_device_reassignment($1,true)`, [d1.device_id]))) === '42501')
await as(id.bAdmin, () => q(`select review_device_reassignment($1,true,'handover')`, [d1.device_id]))
const dev = (await q(`select user_id, employee_id, status, pending_user_id from devices where id=$1`, [d1.device_id]))[0]
ok('approved reassignment', dev.user_id === id.bEmp2 && dev.employee_id === bEmp2Row.id && dev.status === 'active' && dev.pending_user_id === null, JSON.stringify(dev))
const hist = (await q(`select count(*)::int n, count(ended_at)::int ended from device_assignments where device_id=$1`, [d1.device_id]))[0]
ok('assignment history kept', hist.n === 2 && hist.ended === 1, JSON.stringify(hist))
const re = (await as(id.bEmp2, () => q(`select register_device($1,$2) r`, ['99999999-2222-4333-8444-555555555555', hw])))[0].r
ok('reinstall recognised by hardware hash', re.device_id === d1.device_id && re.is_holder, JSON.stringify(re))
const ud = (await as(id.u9, () => q(`select register_device($1) r`, ['77777777-2222-4333-8444-555555555555'])))[0].r
ok('unlinked account device pending', ud.status === 'pending_review')
ok('unlinked device visible to site org', await n(id.m1, `select count(*)::int n from devices`) === 1)
ok('devices not writable directly', await err(() => as(id.bAdmin, () => q(`update devices set status='active'`))) === '42501')
await as(id.bAdmin, () => q(`select assign_device($1,$2,'company phone')`, [d1.device_id, bEmpRow.id]))
ok('admin assignment', (await q(`select user_id from devices where id=$1`, [d1.device_id]))[0].user_id === id.bEmp)
await as(id.bAdmin, () => q(`select set_device_status($1,'revoked','lost')`, [d1.device_id]))
ok('revoked device stays revoked on login', (await as(id.bEmp, () => q(`select register_device($1) r`, ['99999999-2222-4333-8444-555555555555'])))[0].r.status === 'revoked')
ok('revoked device cannot be assigned', await err(() => as(id.bAdmin, () => q(`select assign_device($1,$2)`, [d1.device_id, bEmpRow.id]))) === '22023')
ok('bad install id rejected', await err(() => as(id.bEmp, () => q(`select register_device('Device 39235d6e')`))) === '22023')
ok('anon cannot register', await err(() => as(null, () => q(`select register_device($1)`, [inst]), 'anon')) === '42501')
ok('device events isolated', await n(id.m1, `select count(*)::int n from device_events where organization_id=$1`, [beta]) === 0)

// T10 maintenance RPCs stay inside the caller's organizations
await db.query(`update presence_sessions set last_heartbeat=null`)
const closed = (await as(id.bAdmin, () => q(`select mark_stale_sessions_exited(15) n`)))[0].n
ok('beta admin closes only beta sessions', closed === 0 && (await q(`select count(*)::int n from presence_sessions where organization_id=$1 and exit_timestamp is null`, [qvrix]))[0].n >= 2)
const t1 = now - 4 * H
await as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3)`, [id.bEmp, bSite.id, t1]))
ok('stale close counts', (await as(id.bAdmin, () => q(`select mark_stale_sessions_exited(15) n`)))[0].n === 1)
ok('stale close marked', (await q(`select closed_by from presence_sessions where user_id=$1 and entry_timestamp=$2`, [id.bEmp, t1]))[0].closed_by === 'auto_stale')
const real = (await as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1 where user_id=$2 and entry_timestamp=$3 returning closed_by, total_hours`, [t1 + 3 * H, id.bEmp, t1])))[0]
ok('real checkout replaces auto close', real.closed_by === 'employee' && real.total_hours === 3, JSON.stringify(real))
ok('employees cannot run maintenance', await err(() => as(id.e1, () => q(`select mark_stale_sessions_exited(15)`))) === '42501')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
